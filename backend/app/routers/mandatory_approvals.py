"""SPEC §4.5 Mandatory Approvals router — CRUD + decide + execute.

This router exposes the kernel.approvals state machine over HTTP. It is distinct from
the existing `routers/approvals.py` (which manages M12 workflow-transition parking via
the PendingApproval table). The two systems share the conceptual word "approval" but
operate on different data — see SPEC-4-5-APPROVALS.md for the relationship.

Endpoints (all tenant-scoped via the current user's session):

    GET    /api/mandatory-approvals                  list with optional ?status= filter
    GET    /api/mandatory-approvals/{id}             detail
    POST   /api/mandatory-approvals                  create a new PENDING request (idempotent)
    PATCH  /api/mandatory-approvals/{id}/decide      flip PENDING -> APPROVED | REJECTED
    POST   /api/mandatory-approvals/{id}/execute     flip APPROVED -> EXECUTED

The /decide route is gated by `assert_can(action='approve', entity_key='approval')` —
the §0.2 default-deny matrix from Step 6/7. Holders of the existing `super_admin` role
have wildcard grants and so pass through; tenants who want a dedicated "approver" role
can add an `approval.approve` permission to a Studio-built role at any time.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.approval import Approval
from ..kernel import (
    AccessDenied,
    MANDATORY_APPROVAL_ACTIONS,
    assert_can,
    create_approval_request,
    decide_approval,
    mark_approval_executed,
)
from .auth import current_user

router = APIRouter(prefix="/api/mandatory-approvals", tags=["mandatory-approvals"])


# ---------------------------------------------------------------------------- serializer

def _serialize(a: Approval) -> dict:
    return {
        "id": str(a.id),
        "tenant_id": str(a.tenant_id),
        "action_type": a.action_type,
        "target_entity_key": a.target_entity_key,
        "target_record_id": str(a.target_record_id) if a.target_record_id else None,
        "requested_by": str(a.requested_by),
        "requested_at": a.requested_at.isoformat() if a.requested_at else None,
        "payload": a.payload or {},
        "status": a.status,
        "decided_by": str(a.decided_by) if a.decided_by else None,
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
        "decision_reason": a.decision_reason,
        "executed_at": a.executed_at.isoformat() if a.executed_at else None,
    }


async def _load(s: AsyncSession, tenant_id: uuid.UUID, approval_id: uuid.UUID) -> Approval:
    a = (await s.execute(
        select(Approval).where(
            Approval.id == approval_id,
            Approval.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Approval not found")
    return a


# ---------------------------------------------------------------------------- endpoints

@router.get("")
async def list_approvals(
    status: Optional[str] = None,
    action_type: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List mandatory approvals for the caller's tenant, newest first.

    Query params:
        status:      optional filter — PENDING | APPROVED | REJECTED | EXECUTED.
        action_type: optional filter — one of the SPEC §4.5 action types.
    """
    q = select(Approval).where(Approval.tenant_id == user.tenant_id)
    if status:
        q = q.where(Approval.status == status)
    if action_type:
        q = q.where(Approval.action_type == action_type)
    q = q.order_by(Approval.requested_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(a) for a in rows]


@router.get("/{approval_id}")
async def get_approval(
    approval_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Fetch a single approval by id (tenant-scoped)."""
    a = await _load(s, user.tenant_id, approval_id)
    return _serialize(a)


@router.post("", status_code=201)
async def create_approval(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a new PENDING approval request. Idempotent: a second submission with the
    same (action_type, target_entity_key, target_record_id, requested_by) tuple returns
    the existing PENDING / APPROVED row instead of creating a duplicate.

    Request body:
        {
          "action_type": "high_discount" | ... (one of MANDATORY_APPROVAL_ACTIONS),
          "target_entity_key": "invoice" | null,
          "target_record_id": "<uuid>" | null,
          "payload": { ... arbitrary justification / parameters ... }
        }
    """
    action_type = (payload.get("action_type") or "").strip()
    if not action_type:
        raise HTTPException(422, "action_type is required")
    if action_type not in MANDATORY_APPROVAL_ACTIONS:
        raise HTTPException(
            422,
            f"action_type must be one of the SPEC §4.5 action types: "
            f"{sorted(MANDATORY_APPROVAL_ACTIONS)}",
        )

    target_entity_key = payload.get("target_entity_key")
    target_record_id_raw = payload.get("target_record_id")
    target_record_id: uuid.UUID | None = None
    if target_record_id_raw:
        try:
            target_record_id = uuid.UUID(str(target_record_id_raw))
        except (TypeError, ValueError):
            raise HTTPException(422, "target_record_id must be a valid UUID")

    body_payload = payload.get("payload") or {}
    if not isinstance(body_payload, dict):
        raise HTTPException(422, "payload must be an object")

    row = await create_approval_request(
        s,
        tenant_id=user.tenant_id,
        action_type=action_type,
        requested_by_user_id=user.id,
        target_entity_key=target_entity_key,
        target_record_id=target_record_id,
        payload=body_payload,
    )
    await s.commit()
    await s.refresh(row)
    return _serialize(row)


@router.patch("/{approval_id}/decide")
async def decide(
    approval_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Decide a PENDING approval — APPROVED or REJECTED. Forward-only: a second decision
    on the same row is refused (409).

    Body: {"decision": "APPROVED" | "REJECTED", "reason"?: str}

    Gate: SPEC §0.2 default-deny — caller needs the `approval.approve` permission
    (super_admin holds it via wildcard; tenant-built roles can add it through Studio).
    """
    decision = (payload.get("decision") or "").strip().upper()
    if decision not in ("APPROVED", "REJECTED"):
        raise HTTPException(422, "decision must be 'APPROVED' or 'REJECTED'")
    reason = payload.get("reason")

    # Load first so a 404 fires before the permission check (avoids leaking existence).
    a = await _load(s, user.tenant_id, approval_id)
    if a.status != "PENDING":
        raise HTTPException(409, f"Approval is {a.status}, not PENDING — cannot re-decide")

    # SPEC §0.2 default-deny kernel gate.
    try:
        await assert_can(s, user, action="approve", entity_key="approval")
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    try:
        row = await decide_approval(
            s,
            approval_id=approval_id,
            decided_by_user_id=user.id,
            decision=decision,
            reason=reason,
        )
    except ValueError as e:
        # Defensive: the PENDING check above should have caught the state error first.
        raise HTTPException(409, detail=str(e))

    await s.commit()
    await s.refresh(row)
    return _serialize(row)


@router.post("/{approval_id}/execute")
async def execute(
    approval_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Mark an APPROVED approval as EXECUTED. Called by the action's mutation path
    after the action ran (refund posted, invoice cancelled, customer soft-deleted, …)
    so the same approval cannot be re-used.

    Forward-only: a non-APPROVED row (PENDING / REJECTED / already-EXECUTED) returns 409.
    """
    a = await _load(s, user.tenant_id, approval_id)
    if a.status != "APPROVED":
        raise HTTPException(409, f"Approval is {a.status}, not APPROVED — cannot execute")

    try:
        row = await mark_approval_executed(
            s,
            approval_id=approval_id,
            actor_user_id=user.id,
        )
    except ValueError as e:
        raise HTTPException(409, detail=str(e))

    await s.commit()
    await s.refresh(row)
    return _serialize(row)
