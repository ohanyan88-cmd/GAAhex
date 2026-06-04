"""Deletion / Archive / Restore Standard (file 12 — D14) — generic lifecycle router.

The orthogonal data-lifecycle axis lives on each table as `deletion_state`, a
SEPARATE column from each entity's business `status`. Five values:

    ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED

This router exposes a single polymorphic API surface so every business object
that carries the `deletion_state` column (20 tables, rolled out by migration
`6bf1bea1e0cd`) gets archive / restore / soft-delete / purge for free.

Endpoints (all under `/api/lifecycle`):

  GET    /api/lifecycle/{entity_type}/{id}/state     current deletion_state + audit timestamps
  POST   /api/lifecycle/{entity_type}/{id}/archive   any non-terminal → ARCHIVED
  POST   /api/lifecycle/{entity_type}/{id}/restore   ARCHIVED or SOFT_DELETED → ACTIVE
  DELETE /api/lifecycle/{entity_type}/{id}           any non-PURGED → SOFT_DELETED
  POST   /api/lifecycle/{entity_type}/{id}/purge     SOFT_DELETED → PURGED (super-admin only)

Permission gates (file 15 — Object.Action lowercase verb mapping):

  GET state      → `{entity_type}.view`  (with `*` wildcard fallback)
  archive        → `{entity_type}.edit`
  restore        → `{entity_type}.edit`
  delete         → `{entity_type}.delete`
  purge          → `configuration.manage`  (super-admin scope)

Transitions — forbidden moves return 422; idempotent moves return current state
without a no-op event so the audit log stays clean:

  ACTIVE      → ARCHIVED                    OK         (sets archived_at)
  ACTIVE      → SOFT_DELETED                OK         (sets deleted_at)
  ARCHIVED    → ACTIVE                      OK         (sets restored_at)
  ARCHIVED    → SOFT_DELETED                OK         (sets deleted_at)
  ARCHIVED    → ARCHIVED                    idempotent (returns current state)
  SOFT_DELETED → ACTIVE                     OK         (sets restored_at)
  SOFT_DELETED → SOFT_DELETED               idempotent
  SOFT_DELETED → ARCHIVED                   FORBIDDEN  (must restore first)
  SOFT_DELETED → PURGED                     OK         (super-admin)
  PURGED      → anything                    FORBIDDEN  (terminal)

Purge note: v1 only flips `deletion_state` to PURGED. Actual hard-delete of the
row is deferred to a retention job — the router never calls `s.delete()`.

Substrate emit — events pin to the target object so its timeline projects them
naturally (file 04 B4). All four lifecycle events are uppercase Object.Action
pairs in the LIFECYCLE category (file 06 E13/E14):

  object_archived     → Object.Archived
  object_restored     → Object.Restored
  object_soft_deleted → Object.SoftDeleted
  object_purged       → Object.Purged
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import (
    Record, HelpdeskTicket, Task, WorkItem, SlaRecord, Watcher,
    Approval, PendingApproval, Subscription, Invoice, Payment, CreditNote,
    Order, OrderItem, Communication, Configuration, Escalation,
    Relationship, ImportJob, ExportJob,
)
from ..models.user import User
from ..services.privacy import anonymize_customer
from .auth import current_user


_log = logging.getLogger("gaahex.lifecycle")


router = APIRouter(prefix="/api/lifecycle", tags=["lifecycle"])


# Hardcoded entity_type → SQLAlchemy model. New entity types are added here
# only after the deletion_state migration has rolled out to their table.
ENTITY_MAP: dict[str, type] = {
    "record": Record,
    "helpdesk_ticket": HelpdeskTicket,
    "task": Task,
    "workitem": WorkItem,
    "sla_record": SlaRecord,
    "watcher": Watcher,
    "approval": Approval,
    "pending_approval": PendingApproval,
    "subscription": Subscription,
    "invoice": Invoice,
    "payment": Payment,
    "credit_note": CreditNote,
    "order": Order,
    "order_item": OrderItem,
    "communication": Communication,
    "configuration": Configuration,
    "escalation": Escalation,
    "relationship": Relationship,
    "import_job": ImportJob,
    "export_job": ExportJob,
}


# State enum (file 12 — D14).
ACTIVE = "ACTIVE"
ARCHIVED = "ARCHIVED"
SOFT_DELETED = "SOFT_DELETED"
PURGED = "PURGED"


def _check_lifecycle_perm(grants, entity_type: str, verb: str) -> bool:
    """Check `{entity_type}.{verb}` with the standard `*` wildcard fallback.

    Uses the existing `access.can` machinery (which already understands `*`,
    `{entity}.*`, and `{entity}.{verb}` shapes), so superuser grants holding
    `*` continue to work without per-entity wiring.
    """
    return can(grants, entity_type, verb)


def _resolve_model(entity_type: str) -> type:
    """entity_type → SQLAlchemy model class or 404 if unsupported."""
    model = ENTITY_MAP.get(entity_type)
    if model is None:
        raise HTTPException(
            status_code=404,
            detail="Entity type not supported by lifecycle router",
        )
    return model


async def _load(s: AsyncSession, model: type, tenant_id, entity_id: uuid.UUID):
    """Tenant-scoped load by id, or 404. RLS GUC already filters by tenant; the
    explicit tenant_id predicate is defense-in-depth and gives a clean 404 for
    cross-tenant lookups in tests that bypass RLS via OwnerSessionLocal."""
    row = (await s.execute(
        select(model).where(and_(model.tenant_id == tenant_id, model.id == entity_id))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Entity not found")
    return row


def _serialize_state(entity_type: str, row) -> dict:
    """Standard state response — uniform across all 20 entity types."""
    return {
        "entityType": entity_type,
        "entityId": str(row.id),
        "deletionState": row.deletion_state,
        "archivedAt": row.archived_at.isoformat() if row.archived_at else None,
        "deletedAt": row.deleted_at.isoformat() if row.deleted_at else None,
        "restoredAt": row.restored_at.isoformat() if row.restored_at else None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# GET state
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{entity_type}/{entity_id}/state")
async def get_state(
    entity_type: str,
    entity_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return current deletion_state + audit timestamps for any supported entity."""
    model = _resolve_model(entity_type)
    grants = await load_grants(s, user)
    if not _check_lifecycle_perm(grants, entity_type, "view"):
        raise HTTPException(status_code=403, detail="Access denied")
    row = await _load(s, model, user.tenant_id, entity_id)
    return _serialize_state(entity_type, row)


# ──────────────────────────────────────────────────────────────────────────────
# ARCHIVE
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{entity_type}/{entity_id}/archive")
async def archive(
    entity_type: str,
    entity_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Transition to ARCHIVED. Idempotent on ARCHIVED. Forbidden from PURGED or
    SOFT_DELETED (must restore first if soft-deleted).

    Sets `archived_at = now()` on the transition; existing audit timestamps are
    preserved (the row already carries its history)."""
    model = _resolve_model(entity_type)
    grants = await load_grants(s, user)
    if not _check_lifecycle_perm(grants, entity_type, "edit"):
        raise HTTPException(status_code=403, detail="Access denied")
    row = await _load(s, model, user.tenant_id, entity_id)

    if row.deletion_state == ARCHIVED:
        return _serialize_state(entity_type, row)  # idempotent
    if row.deletion_state == PURGED:
        raise HTTPException(status_code=422, detail="Cannot archive a purged entity")
    if row.deletion_state == SOFT_DELETED:
        raise HTTPException(
            status_code=422,
            detail="Cannot archive a soft-deleted entity — restore first",
        )

    prev_state = row.deletion_state
    row.deletion_state = ARCHIVED
    row.archived_at = datetime.now(timezone.utc)
    await s.flush()

    note = (payload or {}).get("note")
    await workflow.emit(
        s, user.tenant_id, "object_archived", entity_type, row.id, user.id,
        {"from": prev_state, "to": ARCHIVED, "note": note},
        event_name="Object.Archived", category="LIFECYCLE",
    )
    return _serialize_state(entity_type, row)


# ──────────────────────────────────────────────────────────────────────────────
# RESTORE
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{entity_type}/{entity_id}/restore")
async def restore(
    entity_type: str,
    entity_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Transition to ACTIVE. Allowed from ARCHIVED or SOFT_DELETED.
    Forbidden from PURGED (terminal) and from ACTIVE (no-op — returns current)."""
    model = _resolve_model(entity_type)
    grants = await load_grants(s, user)
    if not _check_lifecycle_perm(grants, entity_type, "edit"):
        raise HTTPException(status_code=403, detail="Access denied")
    row = await _load(s, model, user.tenant_id, entity_id)

    if row.deletion_state == ACTIVE:
        return _serialize_state(entity_type, row)  # idempotent
    if row.deletion_state == PURGED:
        raise HTTPException(status_code=422, detail="Cannot restore a purged entity")
    if row.deletion_state not in (ARCHIVED, SOFT_DELETED):
        # PENDING_PURGE or any unknown value — refuse rather than guess.
        raise HTTPException(
            status_code=422,
            detail=f"Cannot restore from deletion_state={row.deletion_state}",
        )

    prev_state = row.deletion_state
    row.deletion_state = ACTIVE
    row.restored_at = datetime.now(timezone.utc)
    await s.flush()

    note = (payload or {}).get("note")
    await workflow.emit(
        s, user.tenant_id, "object_restored", entity_type, row.id, user.id,
        {"from": prev_state, "to": ACTIVE, "note": note},
        event_name="Object.Restored", category="LIFECYCLE",
    )
    return _serialize_state(entity_type, row)


# ──────────────────────────────────────────────────────────────────────────────
# SOFT DELETE
# ──────────────────────────────────────────────────────────────────────────────

@router.delete("/{entity_type}/{entity_id}")
async def soft_delete(
    entity_type: str,
    entity_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Transition to SOFT_DELETED. Idempotent. Forbidden from PURGED.

    Sets `deleted_at = now()`. The row is NEVER hard-deleted here — purge does
    the metadata flip; the retention job is the only thing that ever calls
    `s.delete()` on a lifecycle-managed row."""
    model = _resolve_model(entity_type)
    grants = await load_grants(s, user)
    if not _check_lifecycle_perm(grants, entity_type, "delete"):
        raise HTTPException(status_code=403, detail="Access denied")
    row = await _load(s, model, user.tenant_id, entity_id)

    if row.deletion_state == SOFT_DELETED:
        return _serialize_state(entity_type, row)  # idempotent
    if row.deletion_state == PURGED:
        raise HTTPException(status_code=422, detail="Cannot soft-delete a purged entity")

    prev_state = row.deletion_state
    row.deletion_state = SOFT_DELETED
    row.deleted_at = datetime.now(timezone.utc)
    await s.flush()

    note = (payload or {}).get("note")
    await workflow.emit(
        s, user.tenant_id, "object_soft_deleted", entity_type, row.id, user.id,
        {"from": prev_state, "to": SOFT_DELETED, "note": note},
        event_name="Object.SoftDeleted", category="LIFECYCLE",
    )
    return _serialize_state(entity_type, row)


# ──────────────────────────────────────────────────────────────────────────────
# PURGE (super-admin)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{entity_type}/{entity_id}/purge")
async def purge(
    entity_type: str,
    entity_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Transition SOFT_DELETED → PURGED. Super-admin only (`configuration.manage`).

    V1 contract: this flips `deletion_state` to PURGED only. The row itself
    stays in place — a later retention job performs the actual hard-delete on
    rows whose `deletion_state == 'PURGED'` and whose retention window has
    elapsed. The router NEVER calls `s.delete()` on a lifecycle-managed row.

    Refused from any state other than SOFT_DELETED — a row must be soft-deleted
    first (a deliberate two-step gate that prevents accidental nuking of an
    ACTIVE or ARCHIVED row by a single super-admin call)."""
    model = _resolve_model(entity_type)
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    row = await _load(s, model, user.tenant_id, entity_id)

    if row.deletion_state == PURGED:
        return _serialize_state(entity_type, row)  # idempotent terminal
    if row.deletion_state != SOFT_DELETED:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Cannot purge from deletion_state={row.deletion_state} — "
                "entity must be soft-deleted first"
            ),
        )

    prev_state = row.deletion_state
    row.deletion_state = PURGED
    # Note: no purged_at column in v1 (file 12 — D14 defers purged_at /
    # purge_scheduled_at / reason fields). The Event payload carries the
    # actor + timestamp authoritatively.
    await s.flush()

    note = (payload or {}).get("note")
    await workflow.emit(
        s, user.tenant_id, "object_purged", entity_type, row.id, user.id,
        {"from": prev_state, "to": PURGED, "note": note},
        event_name="Object.Purged", category="LIFECYCLE",
    )

    # C4 — PURGED is no longer decorative for customer-type entities. We invoke the GDPR
    # Article 17 anonymization service so the underlying PII on the customer Record (+ linked
    # CustomerUser) is actually scrubbed. Financial / audit rows are preserved per the
    # Article 17 financial-retention exception (handled inside anonymize_customer).
    #
    # The two-tier mapping below decides which entity_types are "customer-like":
    #   * entity_type == "record" AND row.entity_key == "customer" — the canonical case.
    #   * any future explicit customer entity_type can be added here.
    # For every other entity_type we log a single info line documenting that purge stayed at
    # column-flip-only — the retention sweep will hard-delete the row when its window elapses.
    is_customer = (entity_type == "record" and getattr(row, "entity_key", None) == "customer")
    if is_customer:
        try:
            summary = await anonymize_customer(s, user.tenant_id, row.id)
            await workflow.emit(
                s, user.tenant_id, "CUSTOMER_PURGED_PII_ANONYMIZED", "customer", row.id, user.id,
                {
                    "redactedFields": summary.get("redacted_fields", []),
                    "triggeredBy": "lifecycle.purge",
                },
                event_name="Customer.PiiAnonymized",
                category="SECURITY",
            )
        except ValueError as exc:
            # Defensive: anonymize_customer raises on a non-customer Record. We already
            # gated on entity_key='customer' above, so this should be unreachable — but if
            # the row was concurrently mutated we surface the failure rather than silently
            # leaving PII in place.
            raise HTTPException(status_code=422, detail=f"Anonymization failed: {exc}")
    else:
        _log.info(
            "lifecycle.purge: anonymization not implemented for entity_type=%s — "
            "column flip only (deletion_state=PURGED); the retention job will hard-delete "
            "this row when its window elapses.",
            entity_type,
        )

    return _serialize_state(entity_type, row)
