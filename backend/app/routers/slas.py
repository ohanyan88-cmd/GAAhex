"""SLA Standard (file 12) — API routes.

Endpoints — all RLS tenant-scoped, sla.manage permission required for all writes:

  GET    /api/slas                         list SLAs (filterable by object / status)
  POST   /api/slas                         create SLA tracker on an object
  GET    /api/slas/{slaId}                 read single (lazy breach check on read)
  POST   /api/slas/{slaId}/pause           pause (requires pause_reason; emits PAUSED event)
  POST   /api/slas/{slaId}/resume          resume (recalculates due_at; emits RESUMED event)
  POST   /api/slas/{slaId}/complete        mark completed (emits COMPLETED event)
  POST   /api/slas/{slaId}/cancel          cancel (emits CANCELLED event)
  GET    /api/slas/{slaId}/events          list SlaEvent audit trail

Lazy breach detection:
  On every GET single and list, any SLA with status IN (ON_TRACK, AT_RISK) and
  due_at < now() is automatically transitioned to BREACHED. This fires the
  SLA.Breached workflow event + writes a SlaEvent row + emits the substrate event.
  The background-job scheduled sweep calls GET /api/slas?status=ON_TRACK periodically
  to trigger the same path at scale.

Status state machine:
  ON_TRACK  → AT_RISK    (router sets on create with at_risk_threshold)
  ON_TRACK  → PAUSED     (pause endpoint; requires pause_reason)
  AT_RISK   → PAUSED
  ON_TRACK  → BREACHED   (lazy, auto)
  AT_RISK   → BREACHED   (lazy, auto)
  PAUSED    → ON_TRACK | AT_RISK  (resume; recalculates due_at)
  any active → COMPLETED (complete endpoint)
  any        → CANCELLED (cancel endpoint)

Pause / resume recalculation:
  On resume: elapsed_since_pause = now() - paused_at
  due_at += elapsed_since_pause  (slide the deadline by the pause duration)
  total_paused_seconds += elapsed_since_pause.seconds

Watching never affects SLA (file 12 + file 05 principle — a watcher is never
counted in SLA, workload, ownership, or performance).

Substrate emit: uses existing app.workflow.emit pinned to the OBJECT (so the
object's timeline projects SLA events per B4):
  sla_created | sla_paused | sla_resumed | sla_breached | sla_at_risk |
  sla_completed | sla_cancelled
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import SlaRecord, SlaEvent
from ..models.user import User
from ..utils.refnum import next_reference_number
from .auth import current_user

router = APIRouter(prefix="/api/slas", tags=["slas"])
_log = logging.getLogger("gaaex.slas")

# ── enum sets (file 14) ───────────────────────────────────────────────────────
VALID_STATUSES      = {"NOT_APPLICABLE", "ON_TRACK", "AT_RISK", "PAUSED", "BREACHED", "COMPLETED", "CANCELLED"}
VALID_PAUSE_REASONS = {"WAITING_CUSTOMER", "WAITING_EXTERNAL_PARTY", "WAITING_APPROVAL",
                       "WAITING_PARTS", "SCHEDULED_APPOINTMENT", "DEPENDENCY_BLOCKED"}
VALID_PRIORITIES    = {"LOW", "MEDIUM", "HIGH", "URGENT"}
ACTIVE_STATUSES     = {"ON_TRACK", "AT_RISK", "PAUSED"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(s: SlaRecord) -> dict:
    return {
        "id": str(s.id),
        "referenceNumber": s.reference_number,
        "slaPolicyId": str(s.sla_policy_id) if s.sla_policy_id else None,
        "objectType": s.object_type,
        "objectId": str(s.object_id),
        "status": s.status,
        "startedAt": s.started_at.isoformat(),
        "dueAt": s.due_at.isoformat(),
        "pausedAt": s.paused_at.isoformat() if s.paused_at else None,
        "resumedAt": s.resumed_at.isoformat() if s.resumed_at else None,
        "breachedAt": s.breached_at.isoformat() if s.breached_at else None,
        "completedAt": s.completed_at.isoformat() if s.completed_at else None,
        "cancelledAt": s.cancelled_at.isoformat() if s.cancelled_at else None,
        "totalPausedSeconds": s.total_paused_seconds,
        "pauseReason": s.pause_reason,
        "ownerDepartment": s.owner_department,
        "primaryAssigneeType": s.primary_assignee_type,
        "primaryAssigneeId": str(s.primary_assignee_id) if s.primary_assignee_id else None,
        "priority": s.priority,
        "timezone": s.timezone,
        "correlationId": str(s.correlation_id) if s.correlation_id else None,
        "createdAt": s.created_at.isoformat(),
        "createdBy": str(s.created_by),
        "updatedAt": s.updated_at.isoformat(),
    }


def _serialize_event(e: SlaEvent) -> dict:
    return {
        "id": str(e.id),
        "slaId": str(e.sla_id),
        "eventType": e.event_type,
        "pauseReason": e.pause_reason,
        "occurredAt": e.occurred_at.isoformat(),
        "actorId": str(e.actor_id),
        "note": e.note,
    }


async def _get(s: AsyncSession, tenant_id, sla_id: uuid.UUID) -> SlaRecord:
    row = (await s.execute(
        select(SlaRecord).where(and_(SlaRecord.tenant_id == tenant_id, SlaRecord.id == sla_id))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="SLA not found")
    return row


def _append_event(
    s: AsyncSession, *, tenant_id, sla_id: uuid.UUID, event_type: str,
    occurred_at: datetime, actor_id: uuid.UUID,
    pause_reason: str | None = None, note: str | None = None,
) -> SlaEvent:
    ev = SlaEvent(
        tenant_id=tenant_id, sla_id=sla_id, event_type=event_type,
        pause_reason=pause_reason, occurred_at=occurred_at,
        actor_id=actor_id, note=note,
    )
    s.add(ev)
    return ev


async def _lazy_breach_check(
    s: AsyncSession, sla: SlaRecord, actor_id: uuid.UUID,
) -> bool:
    """Auto-transition ON_TRACK / AT_RISK → BREACHED if due_at < now().
    Returns True if a breach was detected and written. Caller must flush."""
    if sla.status not in ("ON_TRACK", "AT_RISK"):
        return False
    now = _now()
    if sla.due_at >= now:
        return False
    breach_time = sla.due_at  # breached exactly at the due moment
    sla.status = "BREACHED"
    sla.breached_at = breach_time
    sla.updated_at = now
    _append_event(s, tenant_id=sla.tenant_id, sla_id=sla.id,
                  event_type="BREACHED", occurred_at=breach_time, actor_id=actor_id)
    await workflow.emit(
        s, sla.tenant_id, "sla_breached", sla.object_type, sla.object_id, actor_id,
        {"slaId": str(sla.id), "referenceNumber": sla.reference_number,
         "breachedAt": breach_time.isoformat(), "objectType": sla.object_type,
         "objectId": str(sla.object_id)},
    )
    _log.warning("SLA %s breached (due %s)", sla.reference_number, breach_time.isoformat())
    return True


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_slas(
    object_type: Optional[str] = None,
    object_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(SlaRecord).where(SlaRecord.tenant_id == user.tenant_id)
    if object_type:
        q = q.where(SlaRecord.object_type == object_type.lower())
    if object_id:
        q = q.where(SlaRecord.object_id == object_id)
    if status:
        v = status.upper()
        if v not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(VALID_STATUSES)}")
        q = q.where(SlaRecord.status == v)
    q = q.order_by(SlaRecord.due_at)
    rows = (await s.execute(q)).scalars().all()

    # Lazy breach check on every active SLA returned.
    breached_any = False
    for sla in rows:
        if await _lazy_breach_check(s, sla, user.id):
            breached_any = True
    if breached_any:
        await s.flush()

    return [_serialize(sla) for sla in rows]


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_sla(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    object_type = (payload.get("objectType") or "").lower().strip()
    if not object_type:
        raise HTTPException(status_code=422, detail="objectType is required")
    try:
        object_id = uuid.UUID(str(payload.get("objectId")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="objectId must be a UUID")

    # due_at required.
    try:
        due_at = datetime.fromisoformat(str(payload.get("dueAt")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="dueAt is required and must be ISO 8601")
    if not due_at.tzinfo:
        due_at = due_at.replace(tzinfo=timezone.utc)

    started_at = _now()
    # Optionally override started_at (for historical SLA imports).
    if payload.get("startedAt"):
        try:
            started_at = datetime.fromisoformat(str(payload["startedAt"]))
            if not started_at.tzinfo:
                started_at = started_at.replace(tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=422, detail="startedAt must be ISO 8601")

    if due_at <= started_at:
        raise HTTPException(status_code=422, detail="dueAt must be after startedAt")

    ref = await next_reference_number(s, tenant_id=user.tenant_id, prefix="SLA", width=6)
    priority = payload.get("priority")
    if priority:
        priority = priority.upper()
        if priority not in VALID_PRIORITIES:
            raise HTTPException(status_code=422, detail=f"priority must be one of {sorted(VALID_PRIORITIES)}")

    sla = SlaRecord(
        tenant_id=user.tenant_id,
        reference_number=ref,
        object_type=object_type,
        object_id=object_id,
        started_at=started_at,
        due_at=due_at,
        owner_department=payload.get("ownerDepartment"),
        priority=priority,
        timezone=payload.get("timezone") or "UTC",
        created_by=user.id,
    )
    s.add(sla)
    await s.flush()

    _append_event(s, tenant_id=user.tenant_id, sla_id=sla.id,
                  event_type="CREATED", occurred_at=started_at, actor_id=user.id)
    await workflow.emit(
        s, user.tenant_id, "sla_created", object_type, object_id, user.id,
        {"slaId": str(sla.id), "referenceNumber": ref,
         "dueAt": due_at.isoformat(), "priority": priority},
    )
    return _serialize(sla)


# ── READ ──────────────────────────────────────────────────────────────────────

@router.get("/{sla_id}")
async def get_sla(
    sla_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    sla = await _get(s, user.tenant_id, sla_id)
    if await _lazy_breach_check(s, sla, user.id):
        await s.flush()
    return _serialize(sla)


# ── PAUSE ─────────────────────────────────────────────────────────────────────

@router.post("/{sla_id}/pause")
async def pause_sla(
    sla_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    sla = await _get(s, user.tenant_id, sla_id)

    if sla.status == "PAUSED":
        return _serialize(sla)  # idempotent
    if sla.status not in ("ON_TRACK", "AT_RISK"):
        raise HTTPException(status_code=422, detail=f"Cannot pause a {sla.status} SLA")

    pause_reason = (payload.get("pauseReason") or "").upper()
    if pause_reason not in VALID_PAUSE_REASONS:
        raise HTTPException(status_code=422, detail=f"pauseReason must be one of {sorted(VALID_PAUSE_REASONS)}")

    now = _now()
    sla.status = "PAUSED"
    sla.paused_at = now
    sla.pause_reason = pause_reason
    sla.updated_at = now
    await s.flush()

    _append_event(s, tenant_id=user.tenant_id, sla_id=sla.id,
                  event_type="PAUSED", occurred_at=now, actor_id=user.id,
                  pause_reason=pause_reason, note=payload.get("note"))
    await workflow.emit(
        s, user.tenant_id, "sla_paused", sla.object_type, sla.object_id, user.id,
        {"slaId": str(sla.id), "referenceNumber": sla.reference_number,
         "pauseReason": pause_reason},
    )
    return _serialize(sla)


# ── RESUME ────────────────────────────────────────────────────────────────────

@router.post("/{sla_id}/resume")
async def resume_sla(
    sla_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    sla = await _get(s, user.tenant_id, sla_id)

    if sla.status != "PAUSED":
        raise HTTPException(status_code=422, detail="Only PAUSED SLAs can be resumed")
    if not sla.paused_at:
        raise HTTPException(status_code=422, detail="SLA has no recorded pause timestamp")

    now = _now()
    paused_duration = now - sla.paused_at
    paused_secs = int(paused_duration.total_seconds())

    # Slide due_at by the pause duration (wall-clock v1 calendar).
    sla.due_at = sla.due_at + paused_duration
    sla.total_paused_seconds += paused_secs
    sla.status = "ON_TRACK"
    sla.resumed_at = now
    sla.paused_at = None
    sla.pause_reason = None
    sla.updated_at = now
    await s.flush()

    _append_event(s, tenant_id=user.tenant_id, sla_id=sla.id,
                  event_type="RESUMED", occurred_at=now, actor_id=user.id,
                  note=payload.get("note"))
    await workflow.emit(
        s, user.tenant_id, "sla_resumed", sla.object_type, sla.object_id, user.id,
        {"slaId": str(sla.id), "referenceNumber": sla.reference_number,
         "pausedSeconds": paused_secs, "newDueAt": sla.due_at.isoformat()},
    )
    return _serialize(sla)


# ── COMPLETE ──────────────────────────────────────────────────────────────────

@router.post("/{sla_id}/complete")
async def complete_sla(
    sla_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    sla = await _get(s, user.tenant_id, sla_id)

    if sla.status == "COMPLETED":
        return _serialize(sla)  # idempotent
    if sla.status == "CANCELLED":
        raise HTTPException(status_code=422, detail="Cannot complete a cancelled SLA")

    now = _now()
    sla.status = "COMPLETED"
    sla.completed_at = now
    sla.updated_at = now
    await s.flush()

    _append_event(s, tenant_id=user.tenant_id, sla_id=sla.id,
                  event_type="COMPLETED", occurred_at=now, actor_id=user.id,
                  note=payload.get("note"))
    await workflow.emit(
        s, user.tenant_id, "sla_completed", sla.object_type, sla.object_id, user.id,
        {"slaId": str(sla.id), "referenceNumber": sla.reference_number,
         "breached": sla.breached_at is not None},
    )
    return _serialize(sla)


# ── CANCEL ────────────────────────────────────────────────────────────────────

@router.post("/{sla_id}/cancel")
async def cancel_sla(
    sla_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    sla = await _get(s, user.tenant_id, sla_id)

    if sla.status == "CANCELLED":
        return _serialize(sla)  # idempotent

    now = _now()
    sla.status = "CANCELLED"
    sla.cancelled_at = now
    sla.updated_at = now
    await s.flush()

    _append_event(s, tenant_id=user.tenant_id, sla_id=sla.id,
                  event_type="CANCELLED", occurred_at=now, actor_id=user.id,
                  note=payload.get("note"))
    await workflow.emit(
        s, user.tenant_id, "sla_cancelled", sla.object_type, sla.object_id, user.id,
        {"slaId": str(sla.id), "referenceNumber": sla.reference_number},
    )
    return _serialize(sla)


# ── SLA EVENTS ────────────────────────────────────────────────────────────────

@router.get("/{sla_id}/events")
async def list_sla_events(
    sla_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "sla", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    await _get(s, user.tenant_id, sla_id)  # 404 guard
    rows = (await s.execute(
        select(SlaEvent).where(
            SlaEvent.tenant_id == user.tenant_id,
            SlaEvent.sla_id == sla_id,
        ).order_by(SlaEvent.occurred_at)
    )).scalars().all()
    return [_serialize_event(e) for e in rows]
