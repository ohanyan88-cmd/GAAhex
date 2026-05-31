"""Asset Management — write-off endpoint (SPEC §4.5 path 'asset_writeoff').

Assets are config-driven Records (entity_key='asset'), seeded with status set
{ACTIVE, RETIRED, WRITTEN_OFF}. Read/list/create go through the generic record router at
/api/assets; this dedicated POST handles the high-stakes write-off transition because it must
sit behind SPEC §4.5's mandatory-approval gate.

A write-off:
  - is a permanent terminal status (distinct from RETIRED — a planned end-of-service)
  - records reason + residual_amount (luma) + written_off_at + written_off_by_user_id on the
    Record's `data` JSONB
  - emits an audit Event with old/new status + the writeoff payload

Gates applied (in order):
  1. assert_can('edit', 'asset')       — Step 7 default-deny matrix
  2. _owner_gate(table='asset',
                 writer_module='Asset Management')   — SPEC §0.1 / §2.2 single-owner
  3. assert_approval_or_raise(
        action_type='asset_writeoff')  — SPEC §4.5 mandatory approval

Fixed-path namespace: /api/assets/{asset_id}/writeoff. This router must be registered BEFORE
records.router so the path doesn't get eaten by the generic /api/{slug}/{id} catch-all.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from .auth import current_user

router = APIRouter(prefix="/api", tags=["assets"])


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _asset(r: Record) -> dict:
    d = dict(r.data or {})
    return {
        "id": str(r.id),
        "entity_key": r.entity_key,
        "status": r.status,
        "tag": d.get("tag"),
        "name": d.get("name"),
        "kind": d.get("kind"),
        "writeoff": d.get("writeoff"),
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
    }


async def _owner_gate(s: AsyncSession) -> None:
    try:
        await assert_writer_owns_record_firstclass(
            s, table_name="asset", writer_module="Asset Management",
        )
    except OwnerViolation as e:
        raise HTTPException(409, detail=str(e))


@router.post("/assets/{asset_id}/writeoff", status_code=200)
async def writeoff_asset(
    asset_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §4.5 path 'asset_writeoff' — transition an asset to WRITTEN_OFF.

    Body: {"reason": str (required), "residual_amount": int_luma (optional, default 0),
           "written_off_at": ISO8601 (optional, default now)}

    Gates:
      1. assert_can('edit', 'asset') — Step 7 default-deny matrix.
      2. SPEC §0.1 owner gate: writer_module='Asset Management'.
      3. SPEC §4.5 mandatory approval gate: first call → 202 with PENDING approval; after
         a SuperAdmin decides APPROVED via /api/mandatory-approvals/{id}/decide, a second
         call performs the writeoff and marks the approval EXECUTED.

    Status guards:
      - asset must exist in caller's tenant
      - asset.status must not already be 'WRITTEN_OFF' (idempotency / re-writeoff is rejected)
    """
    asset = (await s.execute(
        select(Record).where(
            Record.id == asset_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "asset",
        )
    )).scalar_one_or_none()
    if asset is None:
        raise HTTPException(404, "Asset not found")

    if asset.status == "WRITTEN_OFF":
        raise HTTPException(409, "asset is already WRITTEN_OFF")

    # Step 7 layer-1 default-deny.
    try:
        await assert_can(s, user, action="edit", entity_key="asset",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # First-class owner gate (SPEC §0.1 / §2.2).
    await _owner_gate(s)

    # Validate inputs.
    reason = str(payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(422, "reason is required for asset_writeoff")
    reason = reason[:500]

    try:
        residual_amount = int(payload.get("residual_amount") or 0)
    except (TypeError, ValueError):
        raise HTTPException(422, "residual_amount must be an integer (luma)")
    if residual_amount < 0:
        raise HTTPException(422, "residual_amount must be ≥ 0")

    # SPEC §4.5 approval gate.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="asset_writeoff",
            target_entity_key="asset",
            target_record_id=asset.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="asset_writeoff",
            requested_by_user_id=user.id,
            target_entity_key="asset",
            target_record_id=asset.id,
            payload={
                "asset_id": str(asset.id),
                "tag": (asset.data or {}).get("tag"),
                "current_status": asset.status,
                "reason": reason,
                "residual_amount": residual_amount,
                "currency_minor": "luma",
            },
        )
        await s.commit()
        raise HTTPException(202, detail={
            "status": "approval_required",
            "approval_id": str(approval.id),
            "action_type": "asset_writeoff",
        })

    # Approval exists — find + consume it.
    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="asset_writeoff",
        target_entity_key="asset",
        target_record_id=asset.id,
    )

    # Apply writeoff: status mutation + writeoff metadata stamp.
    old_status = asset.status
    now = datetime.now(timezone.utc)
    asset.status = "WRITTEN_OFF"
    new_data = dict(asset.data or {})
    new_data["writeoff"] = {
        "reason": reason,
        "residual_amount": residual_amount,
        "currency_minor": "luma",
        "written_off_at": now.isoformat(),
        "written_off_by_user_id": str(user.id),
        "previous_status": old_status,
    }
    asset.data = new_data

    await workflow.emit(s, user.tenant_id, "writeoff", "asset", asset.id, user.id, {
        "old_status": old_status,
        "new_status": "WRITTEN_OFF",
        "reason": reason,
        "residual_amount": residual_amount,
    })

    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(asset)
    return _asset(asset)
