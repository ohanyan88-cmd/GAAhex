"""Step 5 — SPEC §7 Status Standardization seeder.

Seeds the LOCKED status vocabularies from SPEC §7 (lines 281-293 of
`GAAex_Cross_Module_Architecture_SPEC.md`) into the existing `status_def` table. Idempotent —
re-runs are safe and cheap.

SPEC §7 verbatim (the 9 sets we seed):

    General:    Draft · New · Open · In Progress · Waiting · Pending Approval · Approved ·
                Rejected · Completed · Cancelled · Closed · Archived
    Lead:       New · Working · Qualified · Disqualified · Converted
    Contract:   Draft · Sent · Signed · Active · Amended · Terminated · Expired
    Order:      Created · In Validation · Validated · Rejected · Fulfilled · Cancelled
    Ticket:     New · Assigned · In Progress · Waiting for Customer · Waiting for Internal ·
                Escalated · Resolved · Closed · Reopened
    Work Order: New · Scheduled · Assigned · On Route · In Progress · Completed · Failed ·
                Rescheduled · Cancelled
    Invoice:    Draft · Issued · Sent · Partially Paid · Paid · Overdue · Cancelled · Credited
    Payment:    Pending · Successful · Failed · Refunded · Partially Refunded · Reconciled ·
                Chargeback
    Service:    Pending · Active · Suspended · Disconnected · Cancelled · Provisioning Failed ·
                Under Maintenance

The Pipeline-Stage set is NOT seeded here — those rows live in `stage_def` (Step 4), keyed to §3,
not as `status_def` lifecycle values.

------------------------------------------------------------------------------------------------
SPEC set → entity_def.key mapping
------------------------------------------------------------------------------------------------
    General     → sentinel 'general' EntityDef (created on demand — see _ensure_general_entity)
    Lead        → sentinel 'lead' EntityDef    (created on demand — Step 1 SPEC build; no catalog
                                                Lead entity ships yet, but the SPEC §7 vocabulary
                                                still anchors to a queryable row. See
                                                _SENTINEL_DEFS docstring.)
    Contract    → 'contract'
    Order       → 'order'                            (config-driven catalog entity; the first-class
                                                      `"order"` table is seeded by app.routers.orders
                                                      via a separate path)
    Ticket      → 'ticket' AND 'helpdesk_ticket'     (codebase has both — GAAex CRM-baseline ticket
                                                      vs. helpdesk-module ticket; both get the same
                                                      SPEC §7 vocabulary)
    Work Order  → 'work_order' AND 'workitem'        (workitem is GAAex's first-class work-order
                                                      table; work_order is the catalog entity)
    Invoice     → 'invoice'                          (config-driven entity if defined; first-class
                                                      `invoice` table is separate)
    Payment     → sentinel 'payment' EntityDef (created on demand — Step 1 SPEC build; first-class
                                                payment ledger table has no catalog entity_def, so
                                                we anchor the §7 vocabulary on a sentinel like Lead.)
    Service     → 'service'                          (config-driven entity if defined; first-class
                                                      `service` table is separate)

When NO entity_def matches a SPEC set candidate list for a given tenant AND the set isn't covered
by an on-demand sentinel (General / Lead / Payment), the seeder logs a WARNING listing what it
couldn't apply and SKIPS that set — it'll be seeded once the entity is added.

------------------------------------------------------------------------------------------------
Terminal-status choices (per SPEC §7 reading + judgment, documented per set)
------------------------------------------------------------------------------------------------
General:
    - Cancelled   = terminal (work was abandoned before completion)
    - Closed      = terminal (lifecycle finished)
    - Archived    = terminal (moved out of active circulation)
    - Rejected    = terminal (decision = no, no further progression)
    - Completed   = terminal (work done)
    NOT terminal: Draft, New, Open, In Progress, Waiting, Pending Approval, Approved (Approved is
    a decision but typically advances to Completed/Closed via workflow — kept non-terminal)

Lead:
    - Disqualified = terminal (decision = lead is not viable; no further work)
    - Converted    = terminal (lead became a customer/contract — record retained for audit but the
                     lead lifecycle is done; SPEC §3 stage flow continues on the converted entity)
    NOT terminal: New, Working, Qualified (Qualified advances to Deal)

Contract:
    - Terminated  = terminal (ended early by either party)
    - Expired     = terminal (reached natural end-of-term)
    NOT terminal: Draft, Sent, Signed, Active, Amended (Amended is a versioning state, not end)

Order:
    - Rejected    = terminal (failed Stage 8 Control Gate or upstream validation)
    - Fulfilled   = terminal (order delivered)
    - Cancelled   = terminal (abandoned before fulfillment)
    NOT terminal: Created, In Validation, Validated (all active progression states)

Ticket:
    - Closed      = terminal (lifecycle done — reopen creates a new transition into Reopened,
                    so Closed itself IS an end state until that explicit reopen happens)
    - Resolved    = terminal-ish but kept NON-terminal because per SPEC §7 the workflow allows
                    Resolved → Closed (final) or Resolved → Reopened (back to In Progress). The
                    actual lifecycle end is Closed, not Resolved.
    - Reopened    = NOT terminal (it's a re-entry state into active work)
    NOT terminal: New, Assigned, In Progress, Waiting for Customer, Waiting for Internal,
                  Escalated, Resolved, Reopened

Work Order:
    - Completed   = terminal (work done successfully)
    - Failed      = terminal (work could not be completed; needs a new WO if retry desired)
    - Cancelled   = terminal (work order abandoned before execution)
    NOT terminal: New, Scheduled, Assigned, On Route, In Progress, Rescheduled (Rescheduled is a
                  re-planning state, work resumes)

Invoice:
    - Paid        = terminal (collected; financial cycle done for this invoice — SPEC §0.3 says
                    invoices are NEVER deleted, only state-changed; Paid is the success terminal)
    - Cancelled   = terminal (voided before payment)
    - Credited    = terminal (offset by a credit note — closed financially)
    NOT terminal: Draft, Issued, Sent, Partially Paid, Overdue (Overdue is a problem state that
                  can become Paid via collections, so NOT terminal)

Payment:
    - Reconciled    = terminal (matched against bank statement — accounting cycle complete)
    - Chargeback    = terminal (disputed by customer's bank; the payment record is closed —
                      remediation goes through a separate collections/dispute case)
    - Failed        = terminal (gateway rejected; a new payment attempt is a NEW payment record)
    NOT terminal: Pending, Successful (Successful advances to Reconciled via end-of-day batch),
                  Refunded (a refund may itself be reconciled later), Partially Refunded (same)

Service:
    - Disconnected  = terminal-ish — kept TERMINAL because per SPEC §6 Service → ... a disconnected
                      service is closed from active circulation; reconnection creates a new service
                      record or reactivates via a workflow that transitions OUT of Disconnected.
                      Following the same pattern as Closed/Cancelled.
    - Cancelled     = terminal (service order cancelled before provisioning completed, or service
                      formally ended)
    - Provisioning Failed = terminal (the provisioning attempt failed; a retry is a new attempt;
                      this status records the failed attempt)
    NOT terminal: Pending, Active, Suspended (Suspended → Active is a normal re-entry), Under
                  Maintenance (transient state)

These choices are encoded in the SPEC_STATUS_SETS table below via the `terminal` set on each set.

------------------------------------------------------------------------------------------------
Conflict / uniqueness
------------------------------------------------------------------------------------------------
The `status_def` table's unique constraint is `(entity_def_id, key)` — NOT `(tenant_id,
entity_def_id, key)`. This is fine because `entity_def_id` is itself tenant-scoped via
`entity_def`, so the tuple `(entity_def_id, key)` is implicitly tenant-scoped too. The seeder uses
`pg_insert(...).on_conflict_do_nothing(index_elements=["entity_def_id", "key"])` to match.

Call site: `backend/app/main.py` lifespan, AFTER `seed_canonical_pipeline_if_empty()` (Step 4) and
BEFORE `seed_default_records_run()`.
"""
from __future__ import annotations

import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import EntityDef, StatusDef, Tenant


_log = logging.getLogger("gaaex.seed_statuses")


# Sentinel entity_def for the General status set. SPEC §7's General vocabulary isn't bound to a
# specific record kind — it's the cross-entity baseline. We anchor it to a queryable EntityDef
# row keyed 'general' so the rows are reachable via the standard status_def lookup path.
_GENERAL_KEY = "general"
_GENERAL_DEF = {
    "key": _GENERAL_KEY,
    "label": "General",
    "label_plural": "General",
    "route_slug": "general",
    "icon": "tag",
    "status": "system",
    "order": 9999,  # parked far down the sidebar; system entity, not surfaced as nav by default
}

# ----------------------------------------------------------------------------------------------
# Sentinel entity_defs for SPEC §7 sets whose record kind exists as a first-class table only
# (no catalog entity_def). Without these shells the status vocabulary has nothing to attach to.
#
# `lead`:
#     SPEC §3 places Lead at the start of the customer-lifecycle pipeline, but the GAAex codebase
#     (as of Step 1) carries lead state on the `opportunity` / pipeline-stage tables and has no
#     catalog `lead` EntityDef. We create a `lead` sentinel so SPEC §7's 5-status vocabulary
#     (New, Working, Qualified, Disqualified, Converted) can be seeded. When a real Lead entity
#     ships (Step 6 or later), that catalog entry should keep the `lead` key — the sentinel
#     becomes the real row with no data loss because every status_def already points to it.
#
# `payment`:
#     `payment` is a first-class kernel table (payment ledger lines) — there is no catalog
#     entity_def by that key. Same shell pattern as `lead`: sentinel exists purely so the SPEC §7
#     Payment vocabulary (Pending … Chargeback) has an entity_def to anchor against. The
#     first-class `payment` row table is unchanged.
#
# Both are marked `status='system'` (hidden from the regular catalog/sidebar) and parked at
# `order=9999` so they don't fight for nav real estate. They behave EXACTLY like the existing
# `general` sentinel — same idempotent INSERT, same lookup path.
# ----------------------------------------------------------------------------------------------
_LEAD_KEY = "lead"
_LEAD_DEF = {
    "key": _LEAD_KEY,
    "label": "Lead",
    "label_plural": "Leads",
    "route_slug": "leads",
    "icon": "target",
    "status": "system",
    "order": 9999,
}

_PAYMENT_KEY = "payment"
_PAYMENT_DEF = {
    "key": _PAYMENT_KEY,
    "label": "Payment",
    "label_plural": "Payments",
    "route_slug": "payments",
    "icon": "receipt",
    "status": "system",
    "order": 9999,
}

# Map of sentinel-key → entity_def spec. Used by `_ensure_sentinel_entity()` below so we don't
# have to write a near-identical function per sentinel. The 'General' sentinel pre-dates this
# generalization (it still has its own dedicated function for clarity in the audit log), but new
# sentinels go here.
_SENTINEL_DEFS: dict[str, dict] = {
    _LEAD_KEY: _LEAD_DEF,
    _PAYMENT_KEY: _PAYMENT_DEF,
}


def _to_status_key(display: str) -> str:
    """Convert a SPEC §7 display label to its UPPER_SNAKE status key.

    Examples:
        "Draft"                 → "DRAFT"
        "In Progress"           → "IN_PROGRESS"
        "Partially Paid"        → "PARTIALLY_PAID"
        "Waiting for Customer"  → "WAITING_FOR_CUSTOMER"
        "On Route"              → "ON_ROUTE"
        "Provisioning Failed"   → "PROVISIONING_FAILED"
        "Under Maintenance"     → "UNDER_MAINTENANCE"
    """
    # Replace any run of non-alphanumeric with a single underscore, then upper-case.
    snake = re.sub(r"[^A-Za-z0-9]+", "_", display).strip("_").upper()
    return snake


# SPEC §7 sets — verbatim labels in their LOCKED order. Each entry's structure:
#   {
#       "spec_set":  human name of the SPEC §7 set,
#       "candidates": tuple of entity_def.key candidates (first match wins; multiple candidates
#                     when the codebase uses different keys for the same SPEC concept),
#       "all_candidates_get_statuses": when True, EVERY matching candidate gets the status set
#                                      (used for Ticket and Work Order which have parallel
#                                      catalog+first-class definitions),
#       "labels":    list of (display_label) strings in SPEC order — index 0 is the initial status,
#       "terminal":  set of display labels that are terminal per the reasoning above.
#   }
SPEC_STATUS_SETS: list[dict] = [
    {
        "spec_set": "General",
        "candidates": (_GENERAL_KEY,),
        "all_candidates_get_statuses": False,
        "labels": [
            "Draft", "New", "Open", "In Progress", "Waiting", "Pending Approval", "Approved",
            "Rejected", "Completed", "Cancelled", "Closed", "Archived",
        ],
        "terminal": {"Rejected", "Completed", "Cancelled", "Closed", "Archived"},
    },
    {
        "spec_set": "Lead",
        "candidates": ("lead",),
        "all_candidates_get_statuses": False,
        "labels": ["New", "Working", "Qualified", "Disqualified", "Converted"],
        "terminal": {"Disqualified", "Converted"},
    },
    {
        "spec_set": "Contract",
        "candidates": ("contract",),
        "all_candidates_get_statuses": False,
        "labels": ["Draft", "Sent", "Signed", "Active", "Amended", "Terminated", "Expired"],
        "terminal": {"Terminated", "Expired"},
    },
    {
        "spec_set": "Order",
        "candidates": ("order",),
        "all_candidates_get_statuses": False,
        "labels": ["Created", "In Validation", "Validated", "Rejected", "Fulfilled", "Cancelled"],
        "terminal": {"Rejected", "Fulfilled", "Cancelled"},
    },
    {
        "spec_set": "Ticket",
        "candidates": ("ticket", "helpdesk_ticket"),
        # Both candidate entity_defs (if present) get the same SPEC §7 ticket vocabulary.
        "all_candidates_get_statuses": True,
        "labels": [
            "New", "Assigned", "In Progress", "Waiting for Customer", "Waiting for Internal",
            "Escalated", "Resolved", "Closed", "Reopened",
        ],
        # Resolved is NOT terminal (can move to Closed or Reopened); Closed is terminal.
        # Reopened is NOT terminal (re-entry into active work).
        "terminal": {"Closed"},
    },
    {
        "spec_set": "Work Order",
        "candidates": ("work_order", "workitem"),
        "all_candidates_get_statuses": True,
        "labels": [
            "New", "Scheduled", "Assigned", "On Route", "In Progress", "Completed", "Failed",
            "Rescheduled", "Cancelled",
        ],
        "terminal": {"Completed", "Failed", "Cancelled"},
    },
    {
        "spec_set": "Invoice",
        "candidates": ("invoice",),
        "all_candidates_get_statuses": False,
        "labels": [
            "Draft", "Issued", "Sent", "Partially Paid", "Paid", "Overdue", "Cancelled",
            "Credited",
        ],
        "terminal": {"Paid", "Cancelled", "Credited"},
    },
    {
        "spec_set": "Payment",
        "candidates": ("payment",),
        "all_candidates_get_statuses": False,
        "labels": [
            "Pending", "Successful", "Failed", "Refunded", "Partially Refunded", "Reconciled",
            "Chargeback",
        ],
        "terminal": {"Failed", "Reconciled", "Chargeback"},
    },
    {
        "spec_set": "Service",
        "candidates": ("service",),
        "all_candidates_get_statuses": False,
        "labels": [
            "Pending", "Active", "Suspended", "Disconnected", "Cancelled", "Provisioning Failed",
            "Under Maintenance",
        ],
        "terminal": {"Disconnected", "Cancelled", "Provisioning Failed"},
    },
]


async def _ensure_general_entity(s, tenant_id: uuid.UUID) -> uuid.UUID:
    """Create-or-fetch the sentinel 'general' EntityDef for a tenant. Idempotent.

    Returns the EntityDef's id. Uses `pg_insert(...).on_conflict_do_nothing()` keyed on the
    existing `uq_entity_def_key` constraint (`tenant_id, key`). If the row already exists, the
    INSERT is a no-op and we SELECT the existing id.
    """
    stmt = (
        pg_insert(EntityDef.__table__)
        .values(tenant_id=tenant_id, **_GENERAL_DEF)
        .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
    )
    await s.execute(stmt)
    row_id = (await s.execute(
        select(EntityDef.id).where(
            EntityDef.tenant_id == tenant_id,
            EntityDef.key == _GENERAL_KEY,
        )
    )).scalar_one()
    return row_id


async def _ensure_sentinel_entity(s, tenant_id: uuid.UUID, sentinel_key: str) -> uuid.UUID:
    """Create-or-fetch a sentinel EntityDef (lead / payment) for a tenant. Idempotent.

    Behaves identically to `_ensure_general_entity` but parameterised over `_SENTINEL_DEFS` so
    the same code path covers every SPEC §7 set whose record kind is a first-class table without
    a catalog entry. Returns the entity_def.id.
    """
    spec = _SENTINEL_DEFS[sentinel_key]
    stmt = (
        pg_insert(EntityDef.__table__)
        .values(tenant_id=tenant_id, **spec)
        .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
    )
    await s.execute(stmt)
    row_id = (await s.execute(
        select(EntityDef.id).where(
            EntityDef.tenant_id == tenant_id,
            EntityDef.key == sentinel_key,
        )
    )).scalar_one()
    return row_id


async def seed_status_standardization_if_empty() -> dict[str, int]:
    """Seed SPEC §7 status sets into `status_def`. Idempotent.

    For each tenant × each SPEC §7 set:
      1. Resolve the target entity_def_id(s) — the General set lands on a sentinel 'general'
         entity_def (created on demand); every other set targets the first (or all, for Ticket /
         Work Order) matching catalog/first-class entity_def by candidate key.
      2. For each target, INSERT every status in the SPEC list with `pg_insert(...).on_conflict_
         do_nothing(index_elements=["entity_def_id", "key"])` — re-runs insert zero new rows.
      3. The first status in each set carries `is_initial=True`; statuses in the set's `terminal`
         block carry `is_terminal=True`.

    Returns a dict mapping `"<entity_def.key>"` → rows actually inserted for that entity (summed
    across tenants). Sets that didn't match any entity_def for ANY tenant produce a single WARNING
    listing them (so it's visible in boot logs) — they'll be seeded on a later boot once the
    missing entity_defs land.
    """
    inserted_by_key: dict[str, int] = {}
    sets_skipped_any_tenant: list[str] = []

    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_statuses: no tenants — nothing to seed")
            return {}

        # Per-tenant: which SPEC sets did we end up skipping? Aggregated for a final WARN.
        # (We don't fail; the entity may simply not exist yet — Step 6 + future catalog additions
        # will create them, and a subsequent boot will fill in the statuses.)
        per_tenant_skipped: dict[uuid.UUID, list[str]] = {t.id: [] for t in tenants}

        for tenant in tenants:
            # Single SELECT: every EntityDef for this tenant indexed by key.
            tenant_entities: dict[str, uuid.UUID] = {
                row.key: row.id
                for row in (await s.execute(
                    select(EntityDef.id, EntityDef.key).where(EntityDef.tenant_id == tenant.id)
                )).all()
            }

            for spec_set in SPEC_STATUS_SETS:
                set_name = spec_set["spec_set"]
                candidates: tuple[str, ...] = spec_set["candidates"]
                all_get = spec_set["all_candidates_get_statuses"]

                # --- Resolve targets -------------------------------------------------------------
                target_entity_ids: list[tuple[str, uuid.UUID]] = []  # [(entity_key, entity_id), …]

                if set_name == "General":
                    # The General set is unconditional — create the sentinel entity if missing.
                    gen_id = await _ensure_general_entity(s, tenant.id)
                    target_entity_ids = [(_GENERAL_KEY, gen_id)]
                elif set_name in ("Lead", "Payment"):
                    # SPEC §7 sets whose record kind is a first-class table (or doesn't have a
                    # catalog entity_def yet). Create the sentinel on demand — same pattern as
                    # General — so the SPEC vocabulary always has an anchor row. See the
                    # `_SENTINEL_DEFS` comment block for the rationale per key.
                    sentinel_key = candidates[0]  # ("lead",) / ("payment",)
                    ent_id = await _ensure_sentinel_entity(s, tenant.id, sentinel_key)
                    target_entity_ids = [(sentinel_key, ent_id)]
                    # Refresh the local index so a subsequent set that names the same key (none
                    # today, but keeps the loop honest) doesn't re-trigger _ensure_*.
                    tenant_entities[sentinel_key] = ent_id
                else:
                    if all_get:
                        # Ticket / Work Order — seed every candidate that exists.
                        for k in candidates:
                            if k in tenant_entities:
                                target_entity_ids.append((k, tenant_entities[k]))
                    else:
                        # First matching candidate wins.
                        for k in candidates:
                            if k in tenant_entities:
                                target_entity_ids.append((k, tenant_entities[k]))
                                break

                if not target_entity_ids:
                    per_tenant_skipped[tenant.id].append(set_name)
                    continue

                # --- Insert statuses for each target ---------------------------------------------
                labels: list[str] = spec_set["labels"]
                terminal: set[str] = spec_set["terminal"]

                for entity_key, entity_id in target_entity_ids:
                    # is_initial dedup — the catalog seeder runs BEFORE this one and may have
                    # already declared an initial status with a DIFFERENT key (e.g. order: catalog
                    # says NEW, SPEC §7 says CREATED). The (entity_def_id, key) on_conflict guard
                    # below would happily insert a SECOND is_initial=TRUE row, which then breaks
                    # `seed_default_records.py`'s `scalar_one_or_none()` lookup with
                    # MultipleResultsFound. Precedence: the existing initial wins; SPEC §7 ADDS the
                    # missing statuses but doesn't try to claim a different initial.
                    existing_initial_keys = {
                        row[0]
                        for row in (await s.execute(
                            select(StatusDef.key).where(
                                StatusDef.entity_def_id == entity_id,
                                StatusDef.is_initial == True,  # noqa: E712
                            )
                        )).all()
                    }
                    defer_initial = bool(existing_initial_keys)
                    if defer_initial:
                        _log.info(
                            "seed_statuses: entity %r already has initial status(es) %s — SPEC §7 "
                            "set %r will seed with is_initial=False (existing initial wins).",
                            entity_key, sorted(existing_initial_keys), set_name,
                        )

                    for idx, label in enumerate(labels, start=1):
                        key = _to_status_key(label)
                        stmt = (
                            pg_insert(StatusDef.__table__)
                            .values(
                                tenant_id=tenant.id,
                                entity_def_id=entity_id,
                                key=key,
                                label=label,
                                order=idx,
                                is_initial=(idx == 1 and not defer_initial),
                                is_terminal=(label in terminal),
                            )
                            .on_conflict_do_nothing(
                                index_elements=["entity_def_id", "key"]
                            )
                        )
                        res = await s.execute(stmt)
                        if res.rowcount:
                            inserted_by_key[entity_key] = (
                                inserted_by_key.get(entity_key, 0) + res.rowcount
                            )

        await s.commit()

        # Aggregate skip list — only WARN once per set name, listing tenants if needed.
        skip_summary: dict[str, list[uuid.UUID]] = {}
        for tid, skipped in per_tenant_skipped.items():
            for name in skipped:
                skip_summary.setdefault(name, []).append(tid)

        for name, tids in skip_summary.items():
            sets_skipped_any_tenant.append(name)
            _log.warning(
                "seed_statuses: SPEC §7 set %r has no matching entity_def for %d tenant(s) "
                "(%s) — skipped; will be seeded once the entity_def lands.",
                name, len(tids), ", ".join(str(t) for t in tids),
            )

    total = sum(inserted_by_key.values())
    _log.info(
        "seed_statuses: %d status_def row(s) inserted across %d entity_def key(s); "
        "skipped sets (no entity_def): %s",
        total, len(inserted_by_key),
        ", ".join(sets_skipped_any_tenant) if sets_skipped_any_tenant else "none",
    )
    return inserted_by_key


if __name__ == "__main__":
    import asyncio
    print("seed_statuses result:", asyncio.run(seed_status_standardization_if_empty()))
