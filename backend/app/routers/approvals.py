"""Approval inbox + decisions (Phase-1 M12).

A workflow transition flagged `approval` parks a PendingApproval instead of moving the record
(see workflow.request_approval). This router lets eligible approvers list and decide them:
approve completes the parked move; reject leaves the record at its current status. Eligibility
reuses the workflow engine's approver resolution (covering role-holder of a qualifying role).
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import EntityDef, Record, User
from ..models.approval import PendingApproval
from .. import workflow, notify_hooks
from .auth import current_user

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


def _serialize(pa: PendingApproval) -> dict:
    return {
        "id": str(pa.id),
        "entity_key": pa.entity_key,
        "record_id": str(pa.record_id),
        "from_status": pa.from_status,
        "to_status": pa.to_status,
        "status": pa.status,
        "requested_by": str(pa.requested_by) if pa.requested_by else None,
        "approver_user_id": str(pa.approver_user_id) if pa.approver_user_id else None,
        "note": pa.note,
        "decided_at": pa.decided_at.isoformat() if pa.decided_at else None,
        "created_at": pa.created_at.isoformat() if pa.created_at else None,
    }


async def _load(s: AsyncSession, tenant_id, approval_id) -> PendingApproval:
    pa = (await s.execute(
        select(PendingApproval).where(PendingApproval.id == approval_id, PendingApproval.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not pa:
        raise HTTPException(404, "Approval not found")
    return pa


async def _resolve(s: AsyncSession, tenant_id, pa: PendingApproval):
    """Fetch the entity, record, and (re-resolved) transition spec behind an approval.
    The transition may be None if the workflow config changed since the request."""
    ent = (await s.execute(
        select(EntityDef).where(EntityDef.tenant_id == tenant_id, EntityDef.key == pa.entity_key)
    )).scalar_one_or_none()
    rec = (await s.execute(
        select(Record).where(Record.id == pa.record_id, Record.tenant_id == tenant_id)
    )).scalar_one_or_none()
    tr = None
    if ent and rec:
        transitions = await workflow.get_transitions(s, ent.id)
        tr = workflow.find_transition(transitions, pa.from_status, pa.to_status)
    return ent, rec, tr


async def _is_eligible(s: AsyncSession, tenant_id, user: User, rec: Record | None, tr: dict | None) -> bool:
    if rec is None:
        return False
    approvers = await workflow.eligible_approvers(s, tenant_id=tenant_id, record=rec, transition=tr or {})
    return user.id in set(approvers)


@router.get("")
async def list_approvals(status: str = "PENDING", user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Approvals the caller may act on, filtered by `status` (default PENDING). An approval is shown
    only if the caller is an eligible approver for its transition (covering approver-role holder)."""
    rows = (await s.execute(
        select(PendingApproval).where(
            PendingApproval.tenant_id == user.tenant_id, PendingApproval.status == status
        ).order_by(PendingApproval.created_at)
    )).scalars().all()
    out = []
    for pa in rows:
        _ent, rec, tr = await _resolve(s, user.tenant_id, pa)
        if await _is_eligible(s, user.tenant_id, user, rec, tr):
            out.append(_serialize(pa))
    return out


@router.post("/{approval_id}/approve")
async def approve(approval_id: uuid.UUID, payload: dict | None = None,
                  user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Approve a pending transition: complete the move (status → to_status, transition Event +
    on-enter actions), mark APPROVED, and notify the requester. Eligible approvers only."""
    pa = await _load(s, user.tenant_id, approval_id)
    if pa.status != "PENDING":
        raise HTTPException(409, f"Approval already {pa.status}")
    _ent, rec, tr = await _resolve(s, user.tenant_id, pa)
    if rec is None:
        raise HTTPException(404, "Record not found")
    if not await _is_eligible(s, user.tenant_id, user, rec, tr):
        raise HTTPException(403, "Not an eligible approver")
    if pa.requested_by is not None and pa.requested_by == user.id:
        raise HTTPException(403, "You cannot approve your own request")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements eligibility check.
    try:
        await assert_can(s, user, action="approve", entity_key="approval",
                         region_id=getattr(rec, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    if tr is not None:
        await workflow.complete_transition(s, tenant_id=user.tenant_id, entity_key=pa.entity_key,
                                           record=rec, transition=tr, actor_user_id=user.id)
    else:
        # the transition no longer exists in config — apply the bare status move, skip actions
        frm = rec.status
        rec.status = pa.to_status
        await workflow.emit(s, user.tenant_id, "transition", pa.entity_key, rec.id, user.id,
                            {"from": frm, "to": pa.to_status})

    pa.status = "APPROVED"
    pa.approver_user_id = user.id
    pa.decided_at = datetime.now(timezone.utc)
    if payload and payload.get("note"):
        pa.note = payload["note"]

    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="transition", entity_key=pa.entity_key,
                            record=rec, actor_user_id=user.id, extra={"from": pa.from_status, "to": pa.to_status})
    await _notify_requester(s, user.tenant_id, pa, rec, "approved")

    await s.commit()
    await s.refresh(pa)
    return _serialize(pa)


@router.post("/{approval_id}/reject")
async def reject(approval_id: uuid.UUID, payload: dict | None = None,
                 user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Reject a pending transition: the record stays at from_status; mark REJECTED + notify the
    requester. Eligible approvers only."""
    pa = await _load(s, user.tenant_id, approval_id)
    if pa.status != "PENDING":
        raise HTTPException(409, f"Approval already {pa.status}")
    _ent, rec, tr = await _resolve(s, user.tenant_id, pa)
    if not await _is_eligible(s, user.tenant_id, user, rec, tr):
        raise HTTPException(403, "Not an eligible approver")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements eligibility check.
    try:
        await assert_can(s, user, action="reject", entity_key="approval",
                         region_id=getattr(rec, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    pa.status = "REJECTED"
    pa.approver_user_id = user.id
    pa.decided_at = datetime.now(timezone.utc)
    if payload and payload.get("note"):
        pa.note = payload["note"]

    await workflow.emit(s, user.tenant_id, "approval_rejected", pa.entity_key, pa.record_id, user.id,
                        {"from": pa.from_status, "to": pa.to_status, "approval_id": str(pa.id)})
    await _notify_requester(s, user.tenant_id, pa, rec, "rejected")

    await s.commit()
    await s.refresh(pa)
    return _serialize(pa)


async def _notify_requester(s: AsyncSession, tenant_id, pa: PendingApproval, rec: Record | None, decision: str) -> None:
    """Tell the original requester their request was approved/rejected. Fail-soft."""
    if not pa.requested_by:
        return
    try:
        from .notifications import emit_notification
        context = {
            "from_status": pa.from_status, "to_status": pa.to_status, "decision": decision,
            "id": str(pa.record_id), "record_id": str(pa.record_id),
            "status": rec.status if rec else None,
        }
        await emit_notification(s, tenant_id=tenant_id, def_key=f"{pa.entity_key}.approval_{decision}",
                                user_id=pa.requested_by, entity_key=pa.entity_key,
                                record_id=pa.record_id, context=context)
    except Exception:
        return
