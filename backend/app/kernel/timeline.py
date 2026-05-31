"""SPEC §8 Customer Timeline — append-only feed sourced from the audit `event` table.

This module is a thin, deterministic projector over the audit log. SPEC §0.4 says the audit log
is append-only (DB triggers `prevent_update_event` / `prevent_delete_event` from alembic revision
`b70ef3b98e27` enforce this at the database layer). The timeline never edits — it READS the audit
log and labels the rows. Whatever is in the audit log IS the timeline; deletion of a record does
not erase its history.

SPEC §8 enumerates 13 timeline event types:

    Lead created · Contract signed · Service installed · Service activated ·
    Invoice issued · Payment received · Ticket opened · Ticket closed ·
    Work order completed · Service suspended · Service restored ·
    Communication sent · Document uploaded.

`classify_event` maps a raw `Event` row to one of those 13 (or returns None if the row is not
timeline-eligible — most audit rows aren't: assignments, sla_breach, action_failed, etc.).

Customer linkage:
    - The customer Record itself has `record_id == customer_id` on its own events ("lead"/"customer"
      created/transition rows). So `event.record_id == customer_id` catches them directly.
    - Most "child" records — invoice, payment, helpdesk_ticket, service, subscription — carry a
      `customer_id` foreign-key column on their own table. We resolve child rows by joining the
      audit event's `record_id` back to the owning entity's table; rows whose customer_id matches
      the target customer are included.
    - Payment events live under `entity_key="invoice"` (see billing.py: workflow.emit(..., "payment",
      "invoice", inv.id, ...)). They are picked up via the invoice → customer_id join.

The implementation is deliberately simple — one read of the audit table + small per-entity lookup
queries to resolve `customer_id` on child rows. No automation, no push, no realtime: a GET-time
projection. Future steps may add a materialized view; SPEC §8 doesn't require it.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Event, Record, User
from ..models.billing import Invoice
from ..models.helpdesk import HelpdeskTicket
from ..models.service import Service


# ---------------------------------------------------------------------------
# SPEC §8 — 13 timeline event types
# ---------------------------------------------------------------------------
#
# Reference table: declarative mapping of the 13 SPEC §8 timeline items to the
# (event.type, event.entity_key) pair that produces them. Some entity_keys appear
# multiple times in SPEC (service: installed / activated / suspended / restored) —
# those are disambiguated by payload status transitions inside `classify_event`.
# Some SPEC items (contract / work_order / communication / document) refer to
# entities that may not yet be wired in the current build — their classifier
# rules are present so they will project correctly the moment those entities
# start emitting audit events.
SPEC_8_TIMELINE_KINDS: tuple[str, ...] = (
    "lead", "contract", "service", "invoice", "payment", "ticket",
    "work_order", "communication", "document",
)

# Status sentinels — kept here (not hardcoded in classify_event) so a future
# status-set rename can be done in one place without scanning the engine.
_STATUS_CONTRACT_SIGNED = "SIGNED"
_STATUS_TICKET_CLOSED = ("CLOSED", "RESOLVED")
_STATUS_WORK_ORDER_DONE = ("COMPLETED", "DONE")
_STATUS_SERVICE_ACTIVE = "ACTIVE"
_STATUS_SERVICE_SUSPENDED = "SUSPENDED"


def classify_event(row: Event) -> tuple[str, str] | None:
    """Map an audit `Event` row to a SPEC §8 timeline (kind, label) — or None if not eligible.

    Returns:
        (kind, label) where `kind` is a short SPEC §8 category and `label` is the
        human one-liner ("Lead created", "Invoice issued", ...). Returns None for
        every other event in the audit log — that is the FILTER side of the timeline.

    The if/elif chain follows SPEC §8's order. Service transitions are payload-aware
    (restored vs activated vs suspended depends on the from/to status pair).
    """
    et = row.type or ""
    ek = row.entity_key or ""
    payload = row.data or {}

    # --- Lead created --------------------------------------------------------
    if et == "create" and ek == "lead":
        return ("lead", "Lead created")

    # --- Contract signed -----------------------------------------------------
    # Contract status transitions are emitted as type="transition" with
    # {"from": ..., "to": "SIGNED"} (mirrors the invoice/subscription pattern).
    if et == "transition" and ek == "contract" and payload.get("to") == _STATUS_CONTRACT_SIGNED:
        return ("contract", "Contract signed")

    # --- Service lifecycle (4 SPEC items, all on entity_key="service") ------
    if ek == "service":
        if et == "create":
            return ("service", "Service installed")
        if et == "transition":
            new = payload.get("to")
            old = payload.get("from")
            # Restored: SUSPENDED → ACTIVE (must check BEFORE plain "activated")
            if new == _STATUS_SERVICE_ACTIVE and old == _STATUS_SERVICE_SUSPENDED:
                return ("service", "Service restored")
            # Suspended: anything → SUSPENDED
            if new == _STATUS_SERVICE_SUSPENDED:
                return ("service", "Service suspended")
            # Activated: PENDING/any → ACTIVE (not restored)
            if new == _STATUS_SERVICE_ACTIVE:
                return ("service", "Service activated")
        # Fall through: any other service event (resource_allocated, update name) is not timeline-eligible.

    # --- Invoice issued ------------------------------------------------------
    # Two emit patterns produce an "issued" invoice (see billing.py):
    #   1. POST /invoices/{id}/issue → type="transition" {"from":"DRAFT","to":"ISSUED"}
    #   2. billing-cycle batch run   → type="create" on the invoice (already ISSUED)
    # We treat (1) as the canonical event so that DRAFT invoices don't land on the
    # customer timeline until they are actually issued. SPEC §8 says "Invoice issued".
    if et == "transition" and ek == "invoice" and payload.get("to") == "ISSUED":
        return ("invoice", "Invoice issued")

    # --- Payment received ----------------------------------------------------
    # Payments are emitted with type="payment" against entity_key="invoice" — see
    # billing.py line 557. Data carries {payment_id, amount, method, paid_sum, invoice_status}.
    if et == "payment" and ek == "invoice":
        return ("payment", "Payment received")

    # --- Ticket opened / closed ---------------------------------------------
    # SPEC §8 says "Ticket"; the codebase emits under entity_key="helpdesk_ticket"
    # (helpdesk.py). The classifier treats both keys as the same SPEC category.
    if ek in ("helpdesk_ticket", "ticket"):
        if et == "create":
            return ("ticket", "Ticket opened")
        if et == "transition" and payload.get("to") in _STATUS_TICKET_CLOSED:
            return ("ticket", "Ticket closed")

    # --- Work order completed -----------------------------------------------
    # SPEC §8 lists "Work order completed" only — create/assign rows are not on the timeline.
    if ek in ("work_order", "workorder"):
        if et == "transition" and payload.get("to") in _STATUS_WORK_ORDER_DONE:
            return ("work_order", "Work order completed")

    # --- Communication sent --------------------------------------------------
    # Communications (CRM § Workspace) emit on entity_key="communication" or — in the
    # current build — "interaction" (CRM channel log). We treat both as the SPEC §8
    # "Communication sent" item so the existing interaction events project today and
    # the eventual "communication" entity projects when it lands.
    if et == "create" and ek in ("communication", "interaction"):
        return ("communication", "Communication sent")

    # --- Document uploaded --------------------------------------------------
    if et == "create" and ek == "document":
        return ("document", "Document uploaded")

    return None


# ---------------------------------------------------------------------------
# Customer linkage — child rows reference the customer
# ---------------------------------------------------------------------------
#
# An audit event's record_id points at the OWNING record (an invoice id, a service
# id, a ticket id), not directly at the customer. To project the customer timeline
# we need to resolve, for each entity_key that participates, which `record_id` set
# belongs to which customer.
#
# Strategy: per-entity_key index queries that map record_id → customer_id. Small
# tenants run instantly; large tenants pay one indexed scan per entity_key with a
# bounded `WHERE customer_id = :id` filter so the working set is tiny.


async def _collect_record_ids_for_customer(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> dict[str, set[uuid.UUID]]:
    """For each entity_key that can carry timeline-eligible events, return the set
    of record_ids belonging to this customer.

    The customer Record itself is keyed as ("customer", {customer_id}) so the
    customer's OWN lead/customer events project too.
    """
    out: dict[str, set[uuid.UUID]] = {}

    # The customer record itself — events with record_id == customer_id are direct.
    # We include both the historical "lead" key (pre-conversion) and the current
    # "customer" key — both can carry events for the same record id over its lifetime.
    cust_record = (await s.execute(
        select(Record).where(
            Record.tenant_id == tenant_id, Record.id == customer_id
        )
    )).scalar_one_or_none()
    if cust_record is not None:
        out.setdefault("customer", set()).add(customer_id)
        out.setdefault("lead", set()).add(customer_id)
        # Also welcome a "contract" record whose `data.customer_id` references this customer.
        # Contracts (when wired) are config-driven records on entity_key="contract" with a
        # ref field. We project them via a generic data.customer_id lookup below.

    # Invoice → customer_id
    inv_ids = (await s.execute(
        select(Invoice.id).where(
            Invoice.tenant_id == tenant_id, Invoice.customer_id == customer_id
        )
    )).scalars().all()
    if inv_ids:
        out["invoice"] = set(inv_ids)

    # Payment events on entity_key="invoice" — already covered by inv_ids above
    # (workflow.emit emits payment under entity_key="invoice"; record_id is the invoice id).

    # Service → customer_id
    svc_ids = (await s.execute(
        select(Service.id).where(
            Service.tenant_id == tenant_id, Service.customer_id == customer_id
        )
    )).scalars().all()
    if svc_ids:
        out["service"] = set(svc_ids)

    # Subscription → customer_id (not directly on SPEC §8 timeline but its
    # transitions feed nothing; keeping it OUT of the timeline keeps the feed clean.)

    # HelpdeskTicket → customer_id (entity_key "helpdesk_ticket")
    t_ids = (await s.execute(
        select(HelpdeskTicket.id).where(
            HelpdeskTicket.tenant_id == tenant_id, HelpdeskTicket.customer_id == customer_id
        )
    )).scalars().all()
    if t_ids:
        out["helpdesk_ticket"] = set(t_ids)
        # Also accept the generic "ticket" entity_key (in case a future config-driven ticket
        # uses the bare key — classify_event treats both the same).
        out["ticket"] = set(t_ids)

    # Generic config-driven records (contracts, work_orders, documents, communications,
    # interactions) that carry a `data.customer_id` reference. Single tenant-scoped scan
    # restricted to the in-scope entity_keys — the JSONB filter pulls only rows linked to
    # this customer. The pre-scope hint via entity_key avoids a full-table scan.
    cust_str = str(customer_id)
    generic_keys = ("contract", "work_order", "document", "communication", "interaction")
    data_rows = (await s.execute(
        select(Record.id, Record.entity_key, Record.data).where(
            Record.tenant_id == tenant_id,
            Record.entity_key.in_(generic_keys),
        )
    )).all()
    for rid, ek, data in data_rows:
        ref = (data or {}).get("customer_id") if isinstance(data, dict) else None
        if isinstance(ref, str) and ref == cust_str:
            out.setdefault(ek, set()).add(rid)

    return out


async def _actor_names(s: AsyncSession, tenant_id: uuid.UUID, events: Iterable[Event]) -> dict[str, str]:
    """Resolve actor_user_id → display name for the events in this page."""
    ids = {ev.actor_user_id for ev in events if ev.actor_user_id}
    if not ids:
        return {}
    rows = (await s.execute(
        select(User.id, User.name).where(User.tenant_id == tenant_id, User.id.in_(ids))
    )).all()
    return {str(i): n for i, n in rows}


def _payload_excerpt(payload: dict | None) -> dict:
    """A compact subset of an event's payload — enough for the UI to render a chip
    or a hover summary without dumping the entire JSON blob. Excludes large/repetitive
    keys (the full payload is always available via /api/activity)."""
    if not isinstance(payload, dict):
        return {}
    out: dict = {}
    for k in ("from", "to", "amount", "method", "subject", "priority", "number",
              "queue_id", "name", "type", "channel", "direction", "invoice_status",
              "due_at", "sla_due_at"):
        if k in payload:
            out[k] = payload[k]
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_customer_timeline(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    customer_id: uuid.UUID,
    limit: int = 50,
    before_ts: datetime | None = None,
) -> list[dict]:
    """SPEC §8 customer timeline — newest-first feed of classified audit events.

    Args:
        s:            async DB session (caller's, already tenant-scoped).
        tenant_id:    the calling user's tenant.
        customer_id:  the customer Record id to build the timeline for.
        limit:        max items returned (router clamps to 200).
        before_ts:    cursor — if given, only events strictly older than this UTC
                      timestamp are returned. Newest-first => use the last item's
                      `at` value to fetch the next page.

    Returns:
        A list of dicts (newest first):
            {
              id: str,                  # event row id (stable across pages)
              at: ISO-8601 str,         # event.created_at
              kind: str,                # SPEC §8 category (lead/invoice/...)
              label: str,               # human one-liner per SPEC §8
              entity_key: str,          # source entity_key from the audit row
              record_id: str | None,    # the audit row's record_id
              actor_user_id: str | None,
              actor_name: str | None,
              payload_excerpt: dict,    # tiny subset of event.data, see _payload_excerpt
            }

    SPEC §0.4 append-only — the underlying `event` table cannot be UPDATEd or
    DELETEd (DB triggers `prevent_update_event` / `prevent_delete_event`). This
    function never writes; it is a read-only projection.
    """
    if limit <= 0:
        limit = 50
    if limit > 500:
        limit = 500

    # 1) Resolve the customer's record-id sets, keyed by entity_key.
    sets = await _collect_record_ids_for_customer(
        s, tenant_id=tenant_id, customer_id=customer_id
    )
    if not sets:
        return []

    # 2) Pull events whose (entity_key, record_id) falls into the sets. We can't
    #    express that as one IN clause across pairs cleanly without a join, so we
    #    over-fetch by (entity_key IN keys) AND record_id IN union(all sets), then
    #    filter pair-by-pair in Python. The overscan is bounded — the union of all
    #    children for one customer is small (10s, not 1000s).
    all_record_ids: set[uuid.UUID] = set()
    for ids in sets.values():
        all_record_ids.update(ids)
    if not all_record_ids:
        return []

    keys = list(sets.keys())
    # Payment-on-invoice: events with entity_key="invoice" and type="payment" use the
    # invoice's record_id; that id is already in sets["invoice"] so the query covers it.
    q = (
        select(Event)
        .where(
            Event.tenant_id == tenant_id,
            Event.entity_key.in_(keys),
            Event.record_id.in_(all_record_ids),
        )
        .order_by(Event.created_at.desc())
    )
    if before_ts is not None:
        q = q.where(Event.created_at < before_ts)
    # Pull a generous superset so the classifier-filter has room to land `limit` keepers.
    q = q.limit(limit * 4)
    rows = (await s.execute(q)).scalars().all()

    # 3) Pair-precise filter — entity_key X's events must have record_id in sets[X].
    paired: list[Event] = []
    for ev in rows:
        ids = sets.get(ev.entity_key or "")
        if ids is None:
            continue
        if ev.record_id is None or ev.record_id not in ids:
            continue
        paired.append(ev)

    # 4) Classify, drop misses, materialise the response shape.
    actor_map = await _actor_names(s, tenant_id, paired)
    out: list[dict] = []
    for ev in paired:
        c = classify_event(ev)
        if c is None:
            continue
        kind, label = c
        aid = str(ev.actor_user_id) if ev.actor_user_id else None
        out.append({
            "id": str(ev.id),
            "at": ev.created_at.isoformat() if ev.created_at else None,
            "kind": kind,
            "label": label,
            "entity_key": ev.entity_key,
            "record_id": str(ev.record_id) if ev.record_id else None,
            "actor_user_id": aid,
            "actor_name": actor_map.get(aid) if aid else None,
            "payload_excerpt": _payload_excerpt(ev.data),
        })
        if len(out) >= limit:
            break
    return out


__all__ = [
    "SPEC_8_TIMELINE_KINDS",
    "classify_event",
    "get_customer_timeline",
]
