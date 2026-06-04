"""Procurement — purchase-order submit endpoint (SPEC §4.5 path 'procurement').

Purchase orders are config-driven Records (entity_key='purchase_order'), seeded with status
set {DRAFT, ORDERED, RECEIVED} and transitions DRAFT→ORDERED→RECEIVED. Read/list/create go
through the generic record router at /api/purchase-orders; this dedicated POST handles the
high-stakes DRAFT→ORDERED transition because it must sit behind the SPEC §4.5 mandatory-
approval gate.

What 'submit' means:
  - The PO moves from DRAFT to ORDERED (commitment to a supplier).
  - Once ORDERED the company is bound to pay; it's a financial commitment.
  - SPEC §4.5 mandates an approval before any such commitment lands.
  - The submit endpoint stamps submitted_at, submitted_by_user_id, and supplier_ref onto
    record.data so the audit trail is self-contained.

Gates applied (in order):
  1. assert_can('edit', 'purchase_order')     — Step 7 default-deny matrix
  2. _owner_gate(table='purchase_order',
                 writer_module='Procurement') — SPEC §0.1 / §2.2 single-owner
  3. assert_approval_or_raise(
        action_type='procurement',
        target_entity_key='purchase_order')  — SPEC §4.5 mandatory approval

Fixed-path namespace: /api/purchase-orders/{po_id}/submit. Registered BEFORE records.router.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from .. import workflow
from ..utils.http_errors import approval_required  # PC-2
from ..kernel import (
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from .auth import current_user

router = APIRouter(prefix="/api", tags=["procurement"])


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _po(r: Record) -> dict:
    d = dict(r.data or {})
    return {
        "id": str(r.id),
        "entity_key": r.entity_key,
        "status": r.status,
        "number": d.get("number"),
        "supplier": d.get("supplier"),
        "total": d.get("total"),
        "submission": d.get("submission"),
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
    }


async def _owner_gate(s: AsyncSession) -> None:
    try:
        await assert_writer_owns_record_firstclass(
            s, table_name="purchase_order", writer_module="Procurement",
        )
    except OwnerViolation as e:
        raise HTTPException(409, detail=str(e))


@router.post("/purchase-orders/{po_id}/submit", status_code=200)
async def submit_purchase_order(
    po_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §4.5 path 'procurement' — submit a purchase order (DRAFT → ORDERED).

    Body: {"reason": str (required), "supplier_ref": str (optional — external PO / quote ref)}

    Gates:
      1. assert_can('edit', 'purchase_order') — Step 7 default-deny matrix.
      2. SPEC §0.1 owner gate: writer_module='Procurement'.
      3. SPEC §4.5 mandatory approval gate: first call → 202 with PENDING approval; after a
         SuperAdmin decides APPROVED via /api/mandatory-approvals/{id}/decide, a second call
         performs the status mutation (DRAFT → ORDERED) and marks the approval EXECUTED.

    Status guards:
      - purchase_order must be in DRAFT status to submit (ORDERED/RECEIVED → 409).
      - Idempotency: already ORDERED → 409 with a descriptive message.
    """
    po = (await s.execute(
        select(Record).where(
            Record.id == po_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "purchase_order",
        )
    )).scalar_one_or_none()
    if po is None:
        raise HTTPException(404, "Purchase order not found")

    if po.status == "ORDERED":
        raise HTTPException(409, "purchase_order is already ORDERED")
    if po.status == "RECEIVED":
        raise HTTPException(409, "purchase_order is already RECEIVED — cannot re-submit")
    if po.status not in (None, "DRAFT"):
        raise HTTPException(409, f"cannot submit a purchase_order in status '{po.status}'")

    # Step 7 layer-1 default-deny.
    try:
        await assert_can(s, user, action="edit", entity_key="purchase_order",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # First-class owner gate (SPEC §0.1 / §2.2).
    await _owner_gate(s)

    # Validate input.
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "reason is required for procurement submission")
    reason = reason[:500]
    supplier_ref = str(payload.get("supplier_ref") or "").strip()[:200]

    d = dict(po.data or {})

    # SPEC §4.5 approval gate.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="procurement",
            target_entity_key="purchase_order",
            target_record_id=po.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="procurement",
            requested_by_user_id=user.id,
            target_entity_key="purchase_order",
            target_record_id=po.id,
            payload={
                "po_id": str(po.id),
                "po_number": d.get("number"),
                "total": d.get("total"),
                "supplier": d.get("supplier"),
                "reason": reason,
                "supplier_ref": supplier_ref,
            },
        )
        await s.commit()
        raise approval_required(approval.id, "procurement")

    # Approval exists — find + consume it.
    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="procurement",
        target_entity_key="purchase_order",
        target_record_id=po.id,
    )

    # Apply the DRAFT → ORDERED state mutation.
    old_status = po.status or "DRAFT"
    now = datetime.now(timezone.utc)
    po.status = "ORDERED"
    new_data = dict(po.data or {})
    new_data["submission"] = {
        "reason": reason,
        "supplier_ref": supplier_ref,
        "submitted_at": now.isoformat(),
        "submitted_by_user_id": str(user.id),
        "previous_status": old_status,
    }
    po.data = new_data

    await workflow.emit(s, user.tenant_id, "submit", "purchase_order", po.id, user.id, {
        "old_status": old_status,
        "new_status": "ORDERED",
        "reason": reason,
        "supplier_ref": supplier_ref,
        "po_number": d.get("number"),
        "total": d.get("total"),
    })

    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(po)
    return _po(po)
