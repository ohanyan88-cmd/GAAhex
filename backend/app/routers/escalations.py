"""Escalation Standard (file 02 / file 14) — API routes.

Endpoints — all RLS tenant-scoped, escalation.manage permission required for all
operations (single cross-cutting permission key, file 15):

  POST /api/escalations                       create (status=PENDING)
  GET  /api/escalations                       list (filterable by source / status / trigger / level)
  GET  /api/escalations/{escalationId}        read single
  POST /api/escalations/{escalationId}/activate   PENDING -> ACTIVE (idempotent on ACTIVE)
  POST /api/escalations/{escalationId}/resolve    ACTIVE  -> RESOLVED (idempotent on RESOLVED)
  POST /api/escalations/{escalationId}/cancel     PENDING|ACTIVE -> CANCELLED (idempotent on CANCELLED)

Status state machine (router-enforced):
  PENDING -> ACTIVE | CANCELLED
  ACTIVE  -> RESOLVED | CANCELLED
  RESOLVED / CANCELLED  terminal

D11 — escalation is a MOVE, not a duplicate: the source assignment is
reassigned to the target; no second parallel membership is created.

Substrate emit (workflow.emit, pinned to the SOURCE entity so the source
object's timeline projects escalation events per B4):
  escalation_created    Escalation.Created
  escalation_activated  Escalation.Activated
  escalation_resolved   Escalation.Resolved
  escalation_cancelled  Escalation.Cancelled

All events carry category=ESCALATION. Lowercase snake_case type_ matches the
Attachment / SLA precedent.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models.escalation import (
    Escalation,
    ESCALATION_TRIGGERS,
    ESCALATION_TARGETS,
    ESCALATION_LEVELS,
    ESCALATION_STATUSES,
)
from ..models.user import User
from .auth import current_user

router = APIRouter(prefix="/api/escalations", tags=["escalations"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(e: Escalation) -> dict:
    return {
        "id": str(e.id),
        "tenantId": str(e.tenant_id),
        "sourceEntityType": e.source_entity_type,
        "sourceEntityId": str(e.source_entity_id),
        "trigger": e.trigger,
        "targetType": e.target_type,
        "targetId": str(e.target_id),
        "level": e.level,
        "status": e.status,
        "reason": e.reason,
        "triggeredAt": e.triggered_at.isoformat() if e.triggered_at else None,
        "triggeredBy": str(e.triggered_by),
        "resolvedAt": e.resolved_at.isoformat() if e.resolved_at else None,
        "resolvedBy": str(e.resolved_by) if e.resolved_by else None,
        "resolutionNote": e.resolution_note,
        "createdAt": e.created_at.isoformat(),
    }


async def _get(s: AsyncSession, tenant_id, escalation_id: uuid.UUID) -> Escalation:
    e = (await s.execute(
        select(Escalation).where(
            Escalation.tenant_id == tenant_id,
            Escalation.id == escalation_id,
        )
    )).scalar_one_or_none()
    if e is None:
        raise HTTPException(status_code=404, detail="Escalation not found")
    return e


async def _require_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "escalation", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")


def _parse_uuid(raw, field: str) -> uuid.UUID:
    if raw is None:
        raise HTTPException(status_code=422, detail=f"{field} is required")
    try:
        return uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field} must be a UUID")


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_escalation(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a new Escalation (status=PENDING).

    Body:
      sourceEntityType   (required, string)
      sourceEntityId     (required, uuid)
      trigger            (required, EscalationTrigger)
      targetType         (required, EscalationTarget)
      targetId           (required, uuid)
      level              (required, EscalationLevel)
      reason             (optional, free text)
    """
    await _require_manage(s, user)

    source_entity_type = (payload.get("sourceEntityType") or "").strip().lower()
    if not source_entity_type:
        raise HTTPException(status_code=422, detail="sourceEntityType is required")
    source_entity_id = _parse_uuid(payload.get("sourceEntityId"), "sourceEntityId")

    trigger = (payload.get("trigger") or "").strip().upper()
    if trigger not in ESCALATION_TRIGGERS:
        raise HTTPException(status_code=422, detail=f"trigger must be one of {sorted(ESCALATION_TRIGGERS)}")

    target_type = (payload.get("targetType") or "").strip().upper()
    if target_type not in ESCALATION_TARGETS:
        raise HTTPException(status_code=422, detail=f"targetType must be one of {sorted(ESCALATION_TARGETS)}")
    target_id = _parse_uuid(payload.get("targetId"), "targetId")

    level = (payload.get("level") or "").strip().upper()
    if level not in ESCALATION_LEVELS:
        raise HTTPException(status_code=422, detail=f"level must be one of {sorted(ESCALATION_LEVELS)}")

    reason = payload.get("reason")
    if reason is not None and not isinstance(reason, str):
        raise HTTPException(status_code=422, detail="reason must be a string")

    e = Escalation(
        tenant_id=user.tenant_id,
        source_entity_type=source_entity_type,
        source_entity_id=source_entity_id,
        trigger=trigger,
        target_type=target_type,
        target_id=target_id,
        level=level,
        status="PENDING",
        reason=reason,
        triggered_by=user.id,
    )
    s.add(e)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "escalation_created",
        source_entity_type, source_entity_id, user.id,
        {
            "escalationId": str(e.id),
            "trigger": trigger,
            "targetType": target_type,
            "targetId": str(target_id),
            "level": level,
            "reason": reason,
        },
        event_name="Escalation.Created",
        category="ESCALATION",
    )
    return _serialize(e)


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_escalations(
    source_entity_type: Optional[str] = None,
    source_entity_id: Optional[uuid.UUID] = None,
    status: Optional[str] = None,
    trigger: Optional[str] = None,
    level: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List escalations in the caller's tenant, with optional filters."""
    await _require_manage(s, user)

    q = select(Escalation).where(Escalation.tenant_id == user.tenant_id)
    if source_entity_type:
        q = q.where(Escalation.source_entity_type == source_entity_type.lower())
    if source_entity_id is not None:
        q = q.where(Escalation.source_entity_id == source_entity_id)
    if status:
        s_up = status.upper()
        if s_up not in ESCALATION_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(ESCALATION_STATUSES)}")
        q = q.where(Escalation.status == s_up)
    if trigger:
        t_up = trigger.upper()
        if t_up not in ESCALATION_TRIGGERS:
            raise HTTPException(status_code=422, detail=f"trigger must be one of {sorted(ESCALATION_TRIGGERS)}")
        q = q.where(Escalation.trigger == t_up)
    if level:
        l_up = level.upper()
        if l_up not in ESCALATION_LEVELS:
            raise HTTPException(status_code=422, detail=f"level must be one of {sorted(ESCALATION_LEVELS)}")
        q = q.where(Escalation.level == l_up)

    q = q.order_by(Escalation.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(e) for e in rows]


# ── READ SINGLE ───────────────────────────────────────────────────────────────

@router.get("/{escalation_id}")
async def get_escalation(
    escalation_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    await _require_manage(s, user)
    e = await _get(s, user.tenant_id, escalation_id)
    return _serialize(e)


# ── ACTIVATE (PENDING -> ACTIVE) ──────────────────────────────────────────────

@router.post("/{escalation_id}/activate")
async def activate_escalation(
    escalation_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Activate a PENDING escalation. Idempotent: ACTIVE returns unchanged.
    Refuses RESOLVED or CANCELLED (terminal states).
    """
    await _require_manage(s, user)
    e = await _get(s, user.tenant_id, escalation_id)

    if e.status == "ACTIVE":
        return _serialize(e)  # idempotent
    if e.status in ("RESOLVED", "CANCELLED"):
        raise HTTPException(status_code=422, detail=f"Cannot activate escalation in {e.status} state")
    if e.status != "PENDING":
        raise HTTPException(status_code=422, detail=f"Unexpected status: {e.status}")

    e.status = "ACTIVE"
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "escalation_activated",
        e.source_entity_type, e.source_entity_id, user.id,
        {
            "escalationId": str(e.id),
            "trigger": e.trigger,
            "targetType": e.target_type,
            "targetId": str(e.target_id),
            "level": e.level,
        },
        event_name="Escalation.Activated",
        category="ESCALATION",
    )
    return _serialize(e)


# ── RESOLVE (ACTIVE -> RESOLVED) ──────────────────────────────────────────────

@router.post("/{escalation_id}/resolve")
async def resolve_escalation(
    escalation_id: uuid.UUID,
    payload: Optional[dict] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Resolve an ACTIVE escalation. Body: {"resolutionNote": "..."}.

    Idempotent: RESOLVED returns unchanged.
    Refuses PENDING (must activate first) or CANCELLED (terminal).
    """
    await _require_manage(s, user)
    e = await _get(s, user.tenant_id, escalation_id)

    if e.status == "RESOLVED":
        return _serialize(e)  # idempotent
    if e.status == "PENDING":
        raise HTTPException(status_code=422, detail="Cannot resolve a PENDING escalation; activate it first")
    if e.status == "CANCELLED":
        raise HTTPException(status_code=422, detail="Cannot resolve a CANCELLED escalation")
    if e.status != "ACTIVE":
        raise HTTPException(status_code=422, detail=f"Unexpected status: {e.status}")

    body = payload or {}
    resolution_note = body.get("resolutionNote")
    if resolution_note is not None and not isinstance(resolution_note, str):
        raise HTTPException(status_code=422, detail="resolutionNote must be a string")

    now = _now()
    e.status = "RESOLVED"
    e.resolved_at = now
    e.resolved_by = user.id
    e.resolution_note = resolution_note
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "escalation_resolved",
        e.source_entity_type, e.source_entity_id, user.id,
        {
            "escalationId": str(e.id),
            "trigger": e.trigger,
            "targetType": e.target_type,
            "targetId": str(e.target_id),
            "level": e.level,
            "resolutionNote": resolution_note,
        },
        event_name="Escalation.Resolved",
        category="ESCALATION",
    )
    return _serialize(e)


# ── CANCEL (PENDING|ACTIVE -> CANCELLED) ──────────────────────────────────────

@router.post("/{escalation_id}/cancel")
async def cancel_escalation(
    escalation_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Cancel an escalation. Idempotent: CANCELLED returns unchanged.
    Refuses RESOLVED (terminal).
    """
    await _require_manage(s, user)
    e = await _get(s, user.tenant_id, escalation_id)

    if e.status == "CANCELLED":
        return _serialize(e)  # idempotent
    if e.status == "RESOLVED":
        raise HTTPException(status_code=422, detail="Cannot cancel a RESOLVED escalation")
    if e.status not in ("PENDING", "ACTIVE"):
        raise HTTPException(status_code=422, detail=f"Unexpected status: {e.status}")

    e.status = "CANCELLED"
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "escalation_cancelled",
        e.source_entity_type, e.source_entity_id, user.id,
        {
            "escalationId": str(e.id),
            "trigger": e.trigger,
            "targetType": e.target_type,
            "targetId": str(e.target_id),
            "level": e.level,
        },
        event_name="Escalation.Cancelled",
        category="ESCALATION",
    )
    return _serialize(e)
