"""SPEC §4.5 — Mandatory Approvals kernel.

SPEC §4.5 enumerates 12 high-stakes business actions that MUST go through an approval
workflow before they can execute. The kernel half — what this module provides — is the
typed exception `ApprovalRequired`, the canonical action-type set, and the small set of
helpers that drive the approval state machine.

The actual ENFORCEMENT (wiring `assert_approval_or_raise` into the refund / credit-note /
invoice-cancel / service-suspend / ... mutation paths) is a separate adoption effort.
This module is the scaffolding; the routers above the kernel line will adopt it
incrementally, exactly like the §0.2 `assert_can` adoption rolled out in Step 7.

State machine (forward-only — see `Approval` model docstring for the full rationale):

    PENDING (default) -> APPROVED | REJECTED -> EXECUTED

Audit (SPEC §0.4 append-only): every state transition emits an Event via `workflow.emit`.
Event types: `create approval`, `update approval`, `execute approval`.

Public surface:
    - ApprovalRequired              — typed exception, raised by `assert_approval_or_raise`
    - MANDATORY_APPROVAL_ACTIONS    — frozenset of the 12 SPEC §4.5 action types
    - assert_approval_or_raise      — gate: refuse the action when no APPROVED approval exists
    - create_approval_request       — idempotent: parks a PENDING approval
    - decide_approval               — flips PENDING -> APPROVED | REJECTED (once)
    - mark_approval_executed        — flips APPROVED -> EXECUTED (once, after action runs)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.approval import Approval


# ---------------------------------------------------------------------------- typed exception

class ApprovalRequired(Exception):
    """SPEC §4.5 — action requires a mandatory approval but no APPROVED row covers it.

    Routers catch this and either:
      - create a new `Approval(PENDING)` via `create_approval_request` and return HTTP 202
        "approval queued"; or
      - surface the existing PENDING / REJECTED approval and return HTTP 409 "approval
        already pending" / "approval was rejected".

    The exception carries `action_type` and `payload` so the catching router can construct
    the parking row without re-deriving them from the request.
    """

    def __init__(self, action_type: str, payload: dict | None = None):
        self.action_type = action_type
        self.payload = payload or {}
        super().__init__(
            f"SPEC §4.5: action '{action_type}' requires a mandatory approval "
            "(no APPROVED row covers this request)"
        )


# ---------------------------------------------------------------------------- canonical action set

#: SPEC §4.5 — the 12 mandatory-approval action types. Verbatim from the SPEC. Adding a
#: new action means appending here in one place; every gate that calls
#: `assert_approval_or_raise(action_type=...)` immediately enforces it.
MANDATORY_APPROVAL_ACTIONS: frozenset[str] = frozenset({
    "high_discount",
    "refund",
    "credit_note",
    "invoice_cancel",
    "service_suspend",
    "contract_change",
    "payment_adjust",
    "customer_delete",
    "asset_writeoff",
    "procurement",
    "role_perm_change",
    "workflow_override",
})


# ---------------------------------------------------------------------------- helpers

async def _emit_audit(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    type_: str,
    approval: Approval,
    actor_user_id: uuid.UUID | None,
    extra: dict | None = None,
) -> None:
    """Emit an audit Event via the workflow engine. Local import to avoid a
    workflow <-> kernel import cycle (workflow imports from app.access; we keep the
    kernel pure-import-clean by lazy-loading)."""
    from .. import workflow

    data: dict[str, Any] = {
        "approval_id": str(approval.id),
        "action_type": approval.action_type,
        "status": approval.status,
    }
    if approval.target_entity_key:
        data["target_entity_key"] = approval.target_entity_key
    if approval.target_record_id:
        data["target_record_id"] = str(approval.target_record_id)
    if extra:
        data.update(extra)

    await workflow.emit(
        s,
        tenant_id,
        type_,
        "approval",
        approval.id,
        actor_user_id,
        data,
    )


# ---------------------------------------------------------------------------- kernel API

async def assert_approval_or_raise(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    action_type: str,
    target_entity_key: str | None = None,
    target_record_id: uuid.UUID | None = None,
) -> None:
    """SPEC §4.5 gate. Refuse the action unless a matching APPROVED approval row exists.

    Looks up an `Approval` row for (tenant_id, action_type, target_entity_key,
    target_record_id) in APPROVED status. The semantics are forward-only:

      - APPROVED row exists -> ok, fall through (caller proceeds to execute).
      - APPROVED row already EXECUTED -> raise ApprovalRequired (cannot double-execute).
      - PENDING / REJECTED row exists -> raise ApprovalRequired (caller surfaces it).
      - No row at all -> raise ApprovalRequired (caller may create a PENDING).

    The caller distinguishes the "new request" vs "in-progress" case by then querying
    for the row themselves (the gate stays pure — read-only, idempotent).

    Note on `assert_can`: this gate is COMPOSED with `assert_can` (SPEC §0.2 default-deny),
    not a replacement. The router pattern is:
        await assert_can(s, user, action='refund', entity_key='invoice', ...)
        await assert_approval_or_raise(s, tenant_id=..., action_type='refund', ...)
    so callers must hold the role grant AND the approval row.
    """
    q = select(Approval).where(
        Approval.tenant_id == tenant_id,
        Approval.action_type == action_type,
    )
    if target_entity_key is not None:
        q = q.where(Approval.target_entity_key == target_entity_key)
    if target_record_id is not None:
        q = q.where(Approval.target_record_id == target_record_id)

    rows = (await s.execute(q)).scalars().all()

    # Look for an APPROVED row that hasn't been executed yet.
    for row in rows:
        if row.status == "APPROVED":
            return  # gate passes — caller may proceed

    # No usable approval — raise so the router can surface PENDING/REJECTED/EXECUTED state
    # or queue a new PENDING.
    raise ApprovalRequired(action_type=action_type, payload={
        "target_entity_key": target_entity_key,
        "target_record_id": str(target_record_id) if target_record_id else None,
    })


async def find_approved_approval(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    action_type: str,
    target_entity_key: str | None = None,
    target_record_id: uuid.UUID | None = None,
) -> Approval | None:
    """SPEC §4.5 router helper. Locate an APPROVED (not-yet-EXECUTED) approval row that
    matches the action+target tuple, or return None.

    Used by adopter routers right after `assert_approval_or_raise` passes — the gate
    confirms an APPROVED row exists, then the router needs the row itself so it can call
    `mark_approval_executed(approval_id=...)` after the mutation succeeds. Keeping this
    helper alongside the gate keeps the per-router boilerplate to ~3 lines.
    """
    q = select(Approval).where(
        Approval.tenant_id == tenant_id,
        Approval.action_type == action_type,
        Approval.status == "APPROVED",
    )
    if target_entity_key is not None:
        q = q.where(Approval.target_entity_key == target_entity_key)
    if target_record_id is not None:
        q = q.where(Approval.target_record_id == target_record_id)
    return (await s.execute(q)).scalars().first()


async def create_approval_request(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    action_type: str,
    requested_by_user_id: uuid.UUID,
    target_entity_key: str | None = None,
    target_record_id: uuid.UUID | None = None,
    payload: dict,
) -> Approval:
    """Idempotent: if a PENDING / APPROVED approval already exists for the same
    (tenant, action_type, target_record_id, requested_by) tuple, return it unchanged.
    Otherwise insert a new PENDING row and emit a `create approval` audit Event.

    The dedupe key intentionally INCLUDES `requested_by`: two different users asking
    for the same action on the same record should each get their own approval row
    (they may carry different justifications in the payload). The dedupe protects
    against a single user double-submitting (UI retry, browser back).

    REJECTED rows are NOT considered for dedupe — a previous rejection doesn't block
    a fresh attempt with a new payload (the rejection is preserved for audit).
    EXECUTED rows are also not considered (the action already completed; a brand-new
    request is a brand-new attempt).
    """
    # Idempotency check — match on the dedupe key.
    q = select(Approval).where(
        Approval.tenant_id == tenant_id,
        Approval.action_type == action_type,
        Approval.requested_by == requested_by_user_id,
        Approval.status.in_(["PENDING", "APPROVED"]),
    )
    if target_entity_key is not None:
        q = q.where(Approval.target_entity_key == target_entity_key)
    else:
        q = q.where(Approval.target_entity_key.is_(None))
    if target_record_id is not None:
        q = q.where(Approval.target_record_id == target_record_id)
    else:
        q = q.where(Approval.target_record_id.is_(None))

    existing = (await s.execute(q)).scalars().first()
    if existing is not None:
        return existing

    row = Approval(
        tenant_id=tenant_id,
        action_type=action_type,
        target_entity_key=target_entity_key,
        target_record_id=target_record_id,
        requested_by=requested_by_user_id,
        payload=payload or {},
        status="PENDING",
    )
    s.add(row)
    await s.flush()

    await _emit_audit(
        s,
        tenant_id=tenant_id,
        type_="create approval",
        approval=row,
        actor_user_id=requested_by_user_id,
        extra={"payload": payload or {}},
    )
    return row


async def decide_approval(
    s: AsyncSession,
    *,
    approval_id: uuid.UUID,
    decided_by_user_id: uuid.UUID,
    decision: str,
    reason: str | None = None,
) -> Approval:
    """Flip a PENDING approval to APPROVED or REJECTED. Single-step — cannot decide
    a non-PENDING row. Emits `update approval` audit Event.

    Args:
        decision: 'APPROVED' or 'REJECTED' (case-sensitive).
        reason:   optional human-readable justification, stored on the row.

    Raises:
        ValueError: if the decision is not one of the two allowed values, or if the
                    approval is not in PENDING state.
    """
    if decision not in ("APPROVED", "REJECTED"):
        raise ValueError(
            f"decide_approval: decision must be 'APPROVED' or 'REJECTED', got {decision!r}"
        )

    row = (await s.execute(
        select(Approval).where(Approval.id == approval_id)
    )).scalar_one_or_none()
    if row is None:
        raise ValueError(f"decide_approval: approval {approval_id} not found")
    if row.status != "PENDING":
        raise ValueError(
            f"decide_approval: approval {approval_id} is {row.status}, not PENDING — "
            "forward-only state machine refuses re-decision"
        )

    row.status = decision
    row.decided_by = decided_by_user_id
    row.decided_at = datetime.now(timezone.utc)
    if reason is not None:
        row.decision_reason = reason
    await s.flush()

    await _emit_audit(
        s,
        tenant_id=row.tenant_id,
        type_="update approval",
        approval=row,
        actor_user_id=decided_by_user_id,
        extra={"decision": decision, "reason": reason},
    )
    return row


async def mark_approval_executed(
    s: AsyncSession,
    *,
    approval_id: uuid.UUID,
    actor_user_id: uuid.UUID | None = None,
) -> Approval:
    """Flip an APPROVED approval to EXECUTED. Called by the action's mutation path
    AFTER the action has run successfully — closes the gate so the same approval
    can't be re-used.

    Emits `execute approval` audit Event.

    Raises:
        ValueError: if the approval is not in APPROVED state (cannot execute a
                    PENDING / REJECTED / already-EXECUTED row).
    """
    row = (await s.execute(
        select(Approval).where(Approval.id == approval_id)
    )).scalar_one_or_none()
    if row is None:
        raise ValueError(f"mark_approval_executed: approval {approval_id} not found")
    if row.status != "APPROVED":
        raise ValueError(
            f"mark_approval_executed: approval {approval_id} is {row.status}, not APPROVED — "
            "forward-only state machine refuses execution"
        )

    row.status = "EXECUTED"
    row.executed_at = datetime.now(timezone.utc)
    await s.flush()

    await _emit_audit(
        s,
        tenant_id=row.tenant_id,
        type_="execute approval",
        approval=row,
        actor_user_id=actor_user_id,
    )
    return row
