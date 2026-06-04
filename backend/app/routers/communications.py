"""Customer Communication Standard (file 12) — API routes.

Endpoints — all RLS tenant-scoped, all permission-gated via app.access.can:

  POST   /api/communications                       create (status=DRAFT)
  GET    /api/communications                       list (filterable)
  GET    /api/communications/{id}                  read single
  POST   /api/communications/{id}/send             DRAFT → QUEUED
  POST   /api/communications/{id}/mark-delivered   QUEUED|SENT → DELIVERED + sent_at
  POST   /api/communications/{id}/mark-read        DELIVERED → READ
  POST   /api/communications/{id}/archive          any → ARCHIVED

Permission gates (file 15):
  communication.view  list / read
  communication.send  create / send / state transitions / archive

Reference number COM-000001 issued at create via per-tenant SELECT COUNT+1; the
DB UNIQUE (tenant_id, reference_number) is the fence against the race.

Substrate emit (app.workflow.emit) — pinned to related_entity_type +
related_entity_id so the related object's Timeline projection picks the events up
(file 04 B4). Free-string lowercase type_ values:

  communication_created | communication_sent | communication_delivered |
  communication_read | communication_archived
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import Communication
from ..models.communication import (
    COMMUNICATION_CHANNELS,
    COMMUNICATION_DIRECTIONS,
    COMMUNICATION_PARTICIPANT_TYPES,
)
from ..models.user import User
from ..utils.refnum import next_reference_number
from .auth import current_user

router = APIRouter(prefix="/api", tags=["communications"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(c: Communication) -> dict:
    """Serialize one Communication row → camelCase response shape."""
    return {
        "id": str(c.id),
        "referenceNumber": c.reference_number,
        "tenantId": str(c.tenant_id),
        "channel": c.channel,
        "direction": c.direction,
        "relatedEntityType": c.related_entity_type,
        "relatedEntityId": str(c.related_entity_id) if c.related_entity_id else None,
        "participantType": c.participant_type,
        "participantId": str(c.participant_id) if c.participant_id else None,
        "subject": c.subject,
        "messageBody": c.message_body,
        "contentReference": c.content_reference,
        "status": c.status,
        "createdAt": c.created_at.isoformat(),
        "createdBy": str(c.created_by),
        "sentAt": c.sent_at.isoformat() if c.sent_at else None,
        "receivedAt": c.received_at.isoformat() if c.received_at else None,
        "correlationId": str(c.correlation_id) if c.correlation_id else None,
        "eventId": str(c.event_id) if c.event_id else None,
    }


async def _get(s: AsyncSession, tenant_id, communication_id: uuid.UUID) -> Communication:
    """Load one tenant-scoped communication or 404. RLS already filters by tenant."""
    row = (await s.execute(
        select(Communication).where(and_(
            Communication.tenant_id == tenant_id,
            Communication.id == communication_id,
        ))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Communication not found")
    return row


def _parse_uuid_opt(value, field_name: str) -> uuid.UUID | None:
    if value is None or value == "":
        return None
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a UUID")


# ──────────────────────────────────────────────────────────────────────────────
# CREATE
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/communications", status_code=201)
async def create_communication(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a Communication in status=DRAFT.

    Required: channel, direction.
    Optional: relatedEntityType + relatedEntityId, participantType + participantId,
              subject, messageBody, contentReference, correlationId.
    """
    grants = await load_grants(s, user)
    # File 15 — communication.send authorises authoring; communication.view alone is read-only.
    if not (can(grants, "communication", "send") or can(grants, "communication", "view")):
        raise HTTPException(status_code=403, detail="Access denied")
    if not can(grants, "communication", "send"):
        raise HTTPException(status_code=403, detail="Access denied")

    channel = (payload.get("channel") or "").upper()
    if channel not in COMMUNICATION_CHANNELS:
        raise HTTPException(
            status_code=422,
            detail=f"channel must be one of {sorted(COMMUNICATION_CHANNELS)}",
        )

    direction = (payload.get("direction") or "").upper()
    if direction not in COMMUNICATION_DIRECTIONS:
        raise HTTPException(
            status_code=422,
            detail=f"direction must be one of {sorted(COMMUNICATION_DIRECTIONS)}",
        )

    participant_type = payload.get("participantType")
    if participant_type is not None:
        participant_type = str(participant_type).upper()
        if participant_type not in COMMUNICATION_PARTICIPANT_TYPES:
            raise HTTPException(
                status_code=422,
                detail=f"participantType must be one of {sorted(COMMUNICATION_PARTICIPANT_TYPES)}",
            )

    related_entity_type = payload.get("relatedEntityType")
    if related_entity_type is not None:
        related_entity_type = str(related_entity_type).lower()
    related_entity_id = _parse_uuid_opt(payload.get("relatedEntityId"), "relatedEntityId")
    participant_id = _parse_uuid_opt(payload.get("participantId"), "participantId")
    correlation_id = _parse_uuid_opt(payload.get("correlationId"), "correlationId")

    # BL-4 — single canonical reference-number issuer. Backed by per-tenant Postgres
    # SEQUENCE (utils/refnum.next_reference_number) which is MVCC-exempt and serves
    # distinct values to every concurrent caller. The previous COUNT+1 + 5-iteration
    # IntegrityError retry loop is gone — under contention it could exhaust → HTTP 500.
    ref = await next_reference_number(s, tenant_id=user.tenant_id, prefix="COM", width=6)
    c = Communication(
        reference_number=ref,
        tenant_id=user.tenant_id,
        channel=channel,
        direction=direction,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        participant_type=participant_type,
        participant_id=participant_id,
        subject=payload.get("subject"),
        message_body=payload.get("messageBody"),
        content_reference=payload.get("contentReference"),
        status="DRAFT",
        created_by=user.id,
        correlation_id=correlation_id,
    )
    s.add(c)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "communication_created",
        c.related_entity_type or "communication",
        c.related_entity_id or c.id,
        user.id,
        {
            "communicationId": str(c.id),
            "referenceNumber": c.reference_number,
            "channel": c.channel,
            "direction": c.direction,
            "participantType": c.participant_type,
            "participantId": str(c.participant_id) if c.participant_id else None,
        },
        event_name="Communication.Created",
        category="COMMUNICATION",
        correlation_id=c.correlation_id,
    )
    return _serialize(c)


# ──────────────────────────────────────────────────────────────────────────────
# LIST
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/communications")
async def list_communications(
    related_entity_type: str | None = None,
    related_entity_id: uuid.UUID | None = None,
    channel: str | None = None,
    status: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List communications visible to the caller, filtered by optional query keys."""
    grants = await load_grants(s, user)
    if not can(grants, "communication", "view"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Communication).where(Communication.tenant_id == user.tenant_id)
    if related_entity_type is not None:
        q = q.where(Communication.related_entity_type == related_entity_type.lower())
    if related_entity_id is not None:
        q = q.where(Communication.related_entity_id == related_entity_id)
    if channel is not None:
        q = q.where(Communication.channel == channel.upper())
    if status is not None:
        q = q.where(Communication.status == status.upper())
    q = q.order_by(Communication.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(c) for c in rows]


# ──────────────────────────────────────────────────────────────────────────────
# READ
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/communications/{communication_id}")
async def get_communication(
    communication_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "communication", "view"):
        raise HTTPException(status_code=403, detail="Access denied")
    c = await _get(s, user.tenant_id, communication_id)
    return _serialize(c)


# ──────────────────────────────────────────────────────────────────────────────
# STATE TRANSITIONS
# ──────────────────────────────────────────────────────────────────────────────

async def _emit_state(s: AsyncSession, user: User, c: Communication, type_: str, event_name: str) -> None:
    """Fan a state-change event to the substrate, pinned to the related object."""
    await workflow.emit(
        s, user.tenant_id, type_,
        c.related_entity_type or "communication",
        c.related_entity_id or c.id,
        user.id,
        {
            "communicationId": str(c.id),
            "referenceNumber": c.reference_number,
            "channel": c.channel,
            "status": c.status,
        },
        event_name=event_name,
        category="COMMUNICATION",
        correlation_id=c.correlation_id,
    )


@router.post("/communications/{communication_id}/send")
async def send_communication(
    communication_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """DRAFT → QUEUED. The channel adapter (v2) picks it up from there."""
    grants = await load_grants(s, user)
    if not can(grants, "communication", "send"):
        raise HTTPException(status_code=403, detail="Access denied")
    c = await _get(s, user.tenant_id, communication_id)
    if c.status != "DRAFT":
        raise HTTPException(
            status_code=422,
            detail=f"Cannot send from status={c.status}; expected DRAFT",
        )
    c.status = "QUEUED"
    await s.flush()
    await _emit_state(s, user, c, "communication_sent", "Communication.Sent")
    return _serialize(c)


@router.post("/communications/{communication_id}/mark-delivered")
async def mark_delivered(
    communication_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """QUEUED|SENT → DELIVERED. Stamps sent_at if not already set."""
    grants = await load_grants(s, user)
    if not can(grants, "communication", "send"):
        raise HTTPException(status_code=403, detail="Access denied")
    c = await _get(s, user.tenant_id, communication_id)
    if c.status not in ("QUEUED", "SENT"):
        raise HTTPException(
            status_code=422,
            detail=f"Cannot mark delivered from status={c.status}; expected QUEUED or SENT",
        )
    c.status = "DELIVERED"
    if c.sent_at is None:
        c.sent_at = _now()
    await s.flush()
    await _emit_state(s, user, c, "communication_delivered", "Communication.Delivered")
    return _serialize(c)


@router.post("/communications/{communication_id}/mark-read")
async def mark_read(
    communication_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """DELIVERED → READ."""
    grants = await load_grants(s, user)
    if not can(grants, "communication", "send"):
        raise HTTPException(status_code=403, detail="Access denied")
    c = await _get(s, user.tenant_id, communication_id)
    if c.status != "DELIVERED":
        raise HTTPException(
            status_code=422,
            detail=f"Cannot mark read from status={c.status}; expected DELIVERED",
        )
    c.status = "READ"
    await s.flush()
    await _emit_state(s, user, c, "communication_read", "Communication.Read")
    return _serialize(c)


@router.post("/communications/{communication_id}/archive")
async def archive_communication(
    communication_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Archive any non-ARCHIVED row. Terminal. Idempotent for already-ARCHIVED."""
    grants = await load_grants(s, user)
    if not can(grants, "communication", "send"):
        raise HTTPException(status_code=403, detail="Access denied")
    c = await _get(s, user.tenant_id, communication_id)
    if c.status == "ARCHIVED":
        return _serialize(c)  # idempotent
    c.status = "ARCHIVED"
    await s.flush()
    await _emit_state(s, user, c, "communication_archived", "Communication.Archived")
    return _serialize(c)
