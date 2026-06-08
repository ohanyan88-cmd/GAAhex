"""Approval inbox + decisions (Phase-1 M12).

A workflow transition flagged `approval` parks a PendingApproval instead of moving the record
(see workflow.request_approval). This router lets eligible approvers list and decide them:
approve completes the parked move; reject leaves the record at its current status. Eligibility
reuses the workflow engine's approver resolution (covering role-holder of a qualifying role).

File 02 (Approval Ownership Standard) extension: the SPEC §4.5 `Approval` table also
hangs off this router for the 5-value `ApprovalDecision` actions — APPROVE/REJECT already
landed via /api/mandatory-approvals; the remaining three (DELEGATE, REQUEST_CHANGES,
CANCEL_REQUEST) plus a digital `sign` step are mounted here at:

    POST /api/approvals/{id}/delegate         decision=DELEGATE, status stays PENDING
    POST /api/approvals/{id}/request-changes  decision=REQUEST_CHANGES, status stays PENDING
    POST /api/approvals/{id}/cancel-request   decision=CANCEL_REQUEST, status -> CANCELLED
    POST /api/approvals/{id}/sign             stamp signature_method + value + signed_at

These look up by Approval.id (not PendingApproval.id) — a different table from the existing
/approve and /reject endpoints, but no route-path collision since the action segment differs.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import EntityDef, Record, User
from ..models.approval import PendingApproval, Approval
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
        await workflow.emit(s, user.tenant_id, "TRANSITION", pa.entity_key, rec.id, user.id,
                            {"from": frm, "to": pa.to_status})

    pa.status = "APPROVED"
    pa.approver_user_id = user.id
    pa.decided_at = datetime.now(timezone.utc)
    if payload and isinstance(payload.get("note"), str) and payload["note"]:
        pa.note = payload["note"][:2000]

    await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="TRANSITION", entity_key=pa.entity_key,
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
    if payload and isinstance(payload.get("note"), str) and payload["note"]:
        pa.note = payload["note"][:2000]

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


# ─────────────────────────────────────────────────────────────────────────────
# File 02 — Approval Ownership Standard extension: DELEGATE / REQUEST_CHANGES /
# CANCEL_REQUEST / SIGN routes on the SPEC §4.5 `Approval` table.
# ─────────────────────────────────────────────────────────────────────────────


def _serialize_approval(a: Approval) -> dict:
    """Wire shape for an `Approval` row — mirrors mandatory_approvals._serialize and
    additionally surfaces the file-02 decision / delegation / signature columns."""
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
        # File 02 extension columns
        "decision": a.decision,
        "delegated_to_user_id": str(a.delegated_to_user_id) if a.delegated_to_user_id else None,
        "change_request_note": a.change_request_note,
        "signature_method": a.signature_method,
        "signature_value": a.signature_value,
        "signed_at": a.signed_at.isoformat() if a.signed_at else None,
    }


async def _load_approval(s: AsyncSession, tenant_id, approval_id) -> Approval:
    """Tenant-scoped lookup on the `Approval` table; 404 is the only failure mode."""
    a = (await s.execute(
        select(Approval).where(Approval.id == approval_id, Approval.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Approval not found")
    return a


async def _gate_decide(s: AsyncSession, user: User) -> None:
    """Shared kernel default-deny gate for the file-02 decision actions. Mirrors the
    `mandatory_approvals.decide` gate — caller needs `approval.approve` (or wildcard).
    Re-used for /sign as well per Approval Ownership Standard §Digital Signature: signing
    is a privileged action by an approver."""
    try:
        await assert_can(s, user, action="approve", entity_key="approval")
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


@router.post("/{approval_id}/delegate")
async def delegate(approval_id: uuid.UUID, payload: dict,
                   user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """File 02: forward this approval request to another user. Stamps
    decision=DELEGATE + delegated_to_user_id + decided_by + decided_at, but leaves
    `status` at PENDING — the delegate must still decide it. Re-delegating is allowed
    while the row is PENDING."""
    delegated_to_raw = payload.get("delegatedToUserId") or payload.get("delegated_to_user_id")
    if not delegated_to_raw:
        raise HTTPException(422, "delegatedToUserId is required")
    try:
        delegated_to = uuid.UUID(str(delegated_to_raw))
    except (TypeError, ValueError):
        raise HTTPException(422, "delegatedToUserId must be a valid UUID")
    note = payload.get("note")

    a = await _load_approval(s, user.tenant_id, approval_id)
    if a.status != "PENDING":
        raise HTTPException(409, f"Approval is {a.status}, not PENDING — cannot delegate")
    await _gate_decide(s, user)

    # Verify the delegate exists in the same tenant — refuse cross-tenant delegation.
    delegate_user = (await s.execute(
        select(User).where(User.id == delegated_to, User.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if delegate_user is None:
        raise HTTPException(422, "delegatedToUserId is not a valid tenant user")

    a.decision = "DELEGATE"
    a.delegated_to_user_id = delegated_to
    a.decided_by = user.id
    a.decided_at = datetime.now(timezone.utc)
    if note:
        a.decision_reason = note
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "update approval", "approval", a.id, user.id,
        {"decision": "DELEGATE", "delegated_to_user_id": str(delegated_to), "note": note},
        event_name="Approval.Delegated",
        category="APPROVAL",
    )

    await s.commit()
    await s.refresh(a)
    return _serialize_approval(a)


@router.post("/{approval_id}/request-changes")
async def request_changes(approval_id: uuid.UUID, payload: dict,
                          user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """File 02: ask the requester to revise their submission. Stamps
    decision=REQUEST_CHANGES + change_request_note + decided_by + decided_at, but leaves
    `status` at PENDING — the requester edits the payload and the row continues toward
    a final APPROVE/REJECT."""
    note = (payload.get("changeRequestNote") or payload.get("change_request_note") or "").strip()
    if not note:
        raise HTTPException(422, "changeRequestNote is required")

    a = await _load_approval(s, user.tenant_id, approval_id)
    if a.status != "PENDING":
        raise HTTPException(409, f"Approval is {a.status}, not PENDING — cannot request changes")
    await _gate_decide(s, user)

    a.decision = "REQUEST_CHANGES"
    a.change_request_note = note
    a.decided_by = user.id
    a.decided_at = datetime.now(timezone.utc)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "update approval", "approval", a.id, user.id,
        {"decision": "REQUEST_CHANGES", "change_request_note": note},
        event_name="Approval.ChangesRequested",
        category="APPROVAL",
    )

    await s.commit()
    await s.refresh(a)
    return _serialize_approval(a)


@router.post("/{approval_id}/cancel-request")
async def cancel_request(approval_id: uuid.UUID, payload: dict | None = None,
                         user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """File 02: terminate a PENDING approval as CANCELLED. Forward-only — only PENDING
    rows can be cancelled (an APPROVED/REJECTED/EXECUTED row is past the cancellation
    window). Stamps decision=CANCEL_REQUEST and flips status to the new terminal
    CANCELLED state."""
    body = payload or {}
    reason = body.get("reason") or body.get("note")

    a = await _load_approval(s, user.tenant_id, approval_id)
    if a.status != "PENDING":
        raise HTTPException(409, f"Approval is {a.status}, not PENDING — cannot cancel")
    await _gate_decide(s, user)

    a.decision = "CANCEL_REQUEST"
    a.status = "CANCELLED"
    a.decided_by = user.id
    a.decided_at = datetime.now(timezone.utc)
    if reason:
        a.decision_reason = reason
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "update approval", "approval", a.id, user.id,
        {"decision": "CANCEL_REQUEST", "status": "CANCELLED", "reason": reason},
        event_name="Approval.Cancelled",
        category="APPROVAL",
    )

    await s.commit()
    await s.refresh(a)
    return _serialize_approval(a)


@router.post("/{approval_id}/sign")
async def sign(approval_id: uuid.UUID, payload: dict,
               user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """File 02 §Digital Signature: attach a verified signature to an Approval row.
    Stamps signature_method + signature_value + signed_at. Permitted from any non-
    CANCELLED state — signing a PENDING row records a held-pen action, signing an
    APPROVED row records the formal approval signature, signing an EXECUTED row
    backstops the audit trail. CANCELLED rows refuse (409)."""
    method = (payload.get("signatureMethod") or payload.get("signature_method") or "").strip()
    value = (payload.get("signatureValue") or payload.get("signature_value") or "").strip()
    if not method:
        raise HTTPException(422, "signatureMethod is required")
    if not value:
        raise HTTPException(422, "signatureValue is required")

    a = await _load_approval(s, user.tenant_id, approval_id)
    if a.status == "CANCELLED":
        raise HTTPException(409, "Approval is CANCELLED — cannot sign")
    await _gate_decide(s, user)

    a.signature_method = method
    a.signature_value = value
    a.signed_at = datetime.now(timezone.utc)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "update approval", "approval", a.id, user.id,
        {"signature_method": method, "signed_at": a.signed_at.isoformat()},
        event_name="Approval.Signed",
        category="APPROVAL",
    )

    await s.commit()
    await s.refresh(a)
    return _serialize_approval(a)
