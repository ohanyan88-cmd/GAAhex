"""Relationship / Entity Link Standard (file 12) — API routes.

Endpoints — all RLS tenant-scoped, all permission-gated:

  POST   /api/relationships                          create  (relationship.create)
  GET    /api/relationships                          list    (relationship.create)
  GET    /api/relationships/{id}                     read    (relationship.create)
  PATCH  /api/relationships/{id}                     update  (relationship.create)
  DELETE /api/relationships/{id}                     archive (relationship.delete)
  GET    /api/relationships/graph?entity_type&entity_id  graph view (relationship.create)

Permission keys (file 15 §relationship, line 38-39):
  relationship.create  — Create relationships between entities
  relationship.delete  — Archive relationships

File 12 §visibility: "a user sees a relationship only if they can view both sides".
v1 leaves the both-sides view gate to the records router (clients that load the
related entities will be default-denied at the entity router). The Relationship
row itself respects tenant RLS only — closing the both-sides gate at the
relationship layer is a tracked follow-up.

Duplicate-active behaviour:
  Active duplicate of the same (source, target, type) is fenced by the partial
  UNIQUE INDEX `uq_relationship_active_pair WHERE status='ACTIVE'`. A POST that
  collides returns 409. An ARCHIVED row of the same shape does NOT block a fresh
  ACTIVE create — the partial index excludes archived rows.

Substrate emit (workflow.emit, pinned to the SOURCE entity so the source
timeline projects the event — file 12 §timeline):
  relationship_created | relationship_updated | relationship_archived

  event_name follows the canonical "<Object>.<Action>" form (E13 file 06):
  Relationship.Created | Relationship.Updated | Relationship.Archived
  category = LIFECYCLE (file 14 EventCategory).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_, or_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models.relationship import Relationship
from ..models.user import User
from .auth import current_user


router = APIRouter(prefix="/api/relationships", tags=["relationships"])


VALID_RELATIONSHIP_TYPES = {
    "RELATED_TO", "PARENT_OF", "CHILD_OF", "DEPENDS_ON", "BLOCKED_BY",
    "DUPLICATES", "DUPLICATED_BY", "OWNS", "USED_BY", "ASSOCIATED_WITH",
    "REPLACES", "REPLACED_BY", "CONNECTED_TO", "BILLED_TO", "SERVES",
    "LOCATED_AT", "ASSIGNED_TO",
}
VALID_DIRECTIONS = {"DIRECTED", "BIDIRECTIONAL"}
VALID_STATUSES = {"ACTIVE", "INACTIVE", "ARCHIVED"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(r: Relationship) -> dict:
    return {
        "id": str(r.id),
        "referenceNumber": r.reference_number,
        "sourceEntityType": r.source_entity_type,
        "sourceEntityId": str(r.source_entity_id),
        "targetEntityType": r.target_entity_type,
        "targetEntityId": str(r.target_entity_id),
        "relationshipType": r.relationship_type,
        "direction": r.direction,
        "status": r.status,
        "description": r.description,
        "validFrom": r.valid_from.isoformat() if r.valid_from else None,
        "validUntil": r.valid_until.isoformat() if r.valid_until else None,
        "createdAt": r.created_at.isoformat(),
        "createdBy": str(r.created_by),
        "updatedAt": r.updated_at.isoformat(),
        "updatedBy": str(r.updated_by) if r.updated_by else None,
    }


async def _get(s: AsyncSession, tenant_id, rel_id: uuid.UUID) -> Relationship:
    row = (await s.execute(
        select(Relationship).where(and_(
            Relationship.tenant_id == tenant_id,
            Relationship.id == rel_id,
        ))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    return row


async def _next_ref(s: AsyncSession, tenant_id) -> str:
    """REL-000001 counter. Races under high concurrency; the
    `uq_relationship_reference_number` UNIQUE is the authoritative fence."""
    n = (await s.execute(
        select(func.count()).select_from(Relationship).where(Relationship.tenant_id == tenant_id)
    )).scalar_one()
    return f"REL-{n + 1:06d}"


def _validate_enum(val: str | None, name: str, valid: set[str]) -> str:
    if val is None:
        raise HTTPException(status_code=422, detail=f"{name} is required")
    v = str(val).upper()
    if v not in valid:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {sorted(valid)}")
    return v


def _parse_uuid(val, name: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(val))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{name} must be a UUID")


from ..utils.dt import parse_iso_dt as _parse_iso_dt_canon  # BL-5 — single source


def _parse_iso(val, name: str) -> datetime | None:
    """BL-5 — thin wrapper over ``app.utils.dt.parse_iso_dt`` (optional=True).

    Accepts existing ``datetime`` instances unchanged (some callers pass already-
    parsed datetimes via the entity_def coercion path).
    """
    if isinstance(val, datetime):
        return val
    return _parse_iso_dt_canon(val, name, optional=True)


# ──────────────────────────────────────────────────────────────────────────────
# CREATE
# ──────────────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_relationship(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "create"):
        raise HTTPException(status_code=403, detail="Access denied")

    source_type = (payload.get("sourceEntityType") or "").strip().lower()
    target_type = (payload.get("targetEntityType") or "").strip().lower()
    if not source_type or not target_type:
        raise HTTPException(status_code=422, detail="sourceEntityType and targetEntityType are required")
    source_id = _parse_uuid(payload.get("sourceEntityId"), "sourceEntityId")
    target_id = _parse_uuid(payload.get("targetEntityId"), "targetEntityId")

    rel_type = _validate_enum(payload.get("relationshipType"), "relationshipType", VALID_RELATIONSHIP_TYPES)
    direction = _validate_enum(payload.get("direction") or "DIRECTED", "direction", VALID_DIRECTIONS)
    status = (payload.get("status") or "ACTIVE")
    status = _validate_enum(status, "status", VALID_STATUSES)

    description = payload.get("description")
    valid_from = _parse_iso(payload.get("validFrom"), "validFrom")
    valid_until = _parse_iso(payload.get("validUntil"), "validUntil")

    ref = await _next_ref(s, user.tenant_id)
    r = Relationship(
        tenant_id=user.tenant_id,
        reference_number=ref,
        source_entity_type=source_type,
        source_entity_id=source_id,
        target_entity_type=target_type,
        target_entity_id=target_id,
        relationship_type=rel_type,
        direction=direction,
        status=status,
        description=description,
        valid_from=valid_from,
        valid_until=valid_until,
        created_by=user.id,
        updated_by=user.id,
    )
    s.add(r)
    try:
        await s.flush()
    except IntegrityError as e:
        await s.rollback()
        # Either the partial-active unique pair OR the reference_number unique tripped.
        msg = str(e.orig) if hasattr(e, "orig") else str(e)
        if "uq_relationship_active_pair" in msg:
            raise HTTPException(
                status_code=409,
                detail="An ACTIVE relationship of this type already exists between these entities",
            )
        if "uq_relationship_reference_number" in msg:
            raise HTTPException(status_code=409, detail=f"Reference number collision: {ref}")
        raise HTTPException(status_code=409, detail="Duplicate relationship")

    # Substrate emit — pin to source so source's timeline projects the event.
    await workflow.emit(
        s, user.tenant_id, "relationship_created",
        source_type, source_id, user.id,
        {
            "relationshipId": str(r.id),
            "referenceNumber": ref,
            "relationshipType": rel_type,
            "direction": direction,
            "targetEntityType": target_type,
            "targetEntityId": str(target_id),
        },
        event_name="Relationship.Created", category="LIFECYCLE",
    )
    return _serialize(r)


# ──────────────────────────────────────────────────────────────────────────────
# LIST
# ──────────────────────────────────────────────────────────────────────────────

@router.get("")
async def list_relationships(
    source_entity_type: Optional[str] = Query(default=None),
    source_entity_id: Optional[uuid.UUID] = Query(default=None),
    target_entity_type: Optional[str] = Query(default=None),
    target_entity_id: Optional[uuid.UUID] = Query(default=None),
    relationship_type: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "create"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Relationship).where(Relationship.tenant_id == user.tenant_id)
    if source_entity_type:
        q = q.where(Relationship.source_entity_type == source_entity_type.lower())
    if source_entity_id is not None:
        q = q.where(Relationship.source_entity_id == source_entity_id)
    if target_entity_type:
        q = q.where(Relationship.target_entity_type == target_entity_type.lower())
    if target_entity_id is not None:
        q = q.where(Relationship.target_entity_id == target_entity_id)
    if relationship_type:
        rt = relationship_type.upper()
        if rt not in VALID_RELATIONSHIP_TYPES:
            raise HTTPException(status_code=422, detail=f"relationship_type must be one of {sorted(VALID_RELATIONSHIP_TYPES)}")
        q = q.where(Relationship.relationship_type == rt)
    if status:
        st = status.upper()
        if st not in VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(VALID_STATUSES)}")
        q = q.where(Relationship.status == st)
    q = q.order_by(Relationship.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(r) for r in rows]


# ──────────────────────────────────────────────────────────────────────────────
# GRAPH (entity-centric — both source-side and target-side rows)
# Declared BEFORE /{rel_id} so the literal "graph" path doesn't try to parse as UUID.
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/graph")
async def relationship_graph(
    entity_type: str = Query(...),
    entity_id: uuid.UUID = Query(...),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Returns every Relationship where (entity_type, entity_id) appears on either
    side, with a per-row `side` indicator ("source" | "target") so the caller can
    render direction correctly even for bidirectional rows.
    """
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "create"):
        raise HTTPException(status_code=403, detail="Access denied")

    et = entity_type.lower()
    q = select(Relationship).where(and_(
        Relationship.tenant_id == user.tenant_id,
        or_(
            and_(Relationship.source_entity_type == et, Relationship.source_entity_id == entity_id),
            and_(Relationship.target_entity_type == et, Relationship.target_entity_id == entity_id),
        ),
    )).order_by(Relationship.created_at)
    rows = (await s.execute(q)).scalars().all()

    out = []
    for r in rows:
        d = _serialize(r)
        d["side"] = "source" if (r.source_entity_type == et and r.source_entity_id == entity_id) else "target"
        out.append(d)
    return out


# ──────────────────────────────────────────────────────────────────────────────
# READ
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{rel_id}")
async def get_relationship(
    rel_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "create"):
        raise HTTPException(status_code=403, detail="Access denied")
    r = await _get(s, user.tenant_id, rel_id)
    return _serialize(r)


# ──────────────────────────────────────────────────────────────────────────────
# UPDATE
# ──────────────────────────────────────────────────────────────────────────────

@router.patch("/{rel_id}")
async def update_relationship(
    rel_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Mutates status / description / valid_until. Source/target/type are immutable
    (a wrong link is archived + recreated, not edited in place).
    """
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "create"):
        raise HTTPException(status_code=403, detail="Access denied")
    r = await _get(s, user.tenant_id, rel_id)

    before = {"status": r.status, "description": r.description,
              "validUntil": r.valid_until.isoformat() if r.valid_until else None}

    if "status" in payload:
        r.status = _validate_enum(payload["status"], "status", VALID_STATUSES)
    if "description" in payload:
        r.description = payload["description"]
    if "validUntil" in payload:
        r.valid_until = _parse_iso(payload["validUntil"], "validUntil")

    r.updated_at = _now()
    r.updated_by = user.id
    try:
        await s.flush()
    except IntegrityError as e:
        await s.rollback()
        msg = str(e.orig) if hasattr(e, "orig") else str(e)
        if "uq_relationship_active_pair" in msg:
            raise HTTPException(
                status_code=409,
                detail="Update would create a duplicate ACTIVE relationship",
            )
        raise HTTPException(status_code=409, detail="Duplicate relationship")

    after = {"status": r.status, "description": r.description,
             "validUntil": r.valid_until.isoformat() if r.valid_until else None}
    await workflow.emit(
        s, user.tenant_id, "relationship_updated",
        r.source_entity_type, r.source_entity_id, user.id,
        {"relationshipId": str(r.id), "before": before, "after": after},
        event_name="Relationship.Updated", category="LIFECYCLE",
    )
    return _serialize(r)


# ──────────────────────────────────────────────────────────────────────────────
# DELETE (soft → ARCHIVED)
# ──────────────────────────────────────────────────────────────────────────────

@router.delete("/{rel_id}")
async def archive_relationship(
    rel_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "relationship", "delete"):
        raise HTTPException(status_code=403, detail="Access denied")
    r = await _get(s, user.tenant_id, rel_id)
    if r.status == "ARCHIVED":
        return _serialize(r)  # idempotent

    r.status = "ARCHIVED"
    r.updated_at = _now()
    r.updated_by = user.id
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "relationship_archived",
        r.source_entity_type, r.source_entity_id, user.id,
        {"relationshipId": str(r.id), "referenceNumber": r.reference_number,
         "relationshipType": r.relationship_type},
        event_name="Relationship.Archived", category="LIFECYCLE",
    )
    return _serialize(r)
