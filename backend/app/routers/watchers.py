"""Watcher / Subscriber Standard (file 05) — API routes.

Endpoints — all RLS tenant-scoped, all permission-gated:

  GET    /api/{entityKey}/{id}/watchers                  list watchers on an object
  POST   /api/{entityKey}/{id}/watchers                  add a watcher
  DELETE /api/{entityKey}/{id}/watchers/{watcherId}      remove (soft: status=REMOVED)
  POST   /api/{entityKey}/{id}/watchers/{watcherId}/pause    pause notifications
  POST   /api/{entityKey}/{id}/watchers/{watcherId}/resume   resume notifications
  PATCH  /api/{entityKey}/{id}/watchers/{watcherId}/preferences  update scope/priority/frequency

Gate matrix (file 05 + file 15):

  watch.view          list / read watchers on an object
  watch.add           add a self-watcher (watcher_id = calling user's employee id)
                      OR watch.manage_others to add any principal
  watch.remove        remove own watch; watch.manage_others to remove another's
  watch.pause         pause own; watch.manage_others to pause another's
  watch.resume        resume own; watch.manage_others to resume another's
  watch.manage_others  full supervisor scope across all verbs above

"Own" check: watcher_type='EMPLOYEE' AND watcher_id == user.id (the simplest
self-reference). ROLE / DEPARTMENT / TEAM watches always require manage_others
(you can't add a whole department as a watcher for yourself).

Watching principle (file 05 — must NEVER be violated):
  * Watching never grants permission on the target object.
  * Watching never counts toward KPI / SLA / workload / performance impact.
  * Removed / paused watchers receive no notifications.

Status state machine:
  ACTIVE → PAUSED   (pause)
  PAUSED → ACTIVE   (resume)
  ACTIVE → REMOVED  (remove) — terminal per row; re-watching creates a NEW row
  PAUSED → REMOVED  (remove) — same terminal

Substrate emit: uses existing app.workflow.emit append-only store; lowercase
free-string type_ values pinned to the TARGET object (so the target's timeline
naturally projects watcher events — file 04 B4 projection principle):
  watch_added | watch_removed | watch_paused | watch_resumed |
  watch_scope_changed | watch_preference_changed

Unique-active invariant is enforced at the DB layer
(uq_watcher_active_target_principal partial unique index); the router does a
pre-check for a cleaner 409 message, but the DB is authoritative.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import Watcher
from ..models.user import User
from .auth import current_user

router = APIRouter(prefix="/api", tags=["watchers"])

_VALID_WATCHER_TYPES = {"EMPLOYEE", "ROLE", "DEPARTMENT", "TEAM"}
_VALID_STATUSES      = {"ACTIVE", "PAUSED", "REMOVED"}
_VALID_SCOPES        = {"OBJECT_ONLY", "OBJECT_AND_CHILDREN", "OBJECT_AND_RELATED"}
_VALID_PRIORITIES    = {"LOW", "NORMAL", "HIGH", "CRITICAL"}
_VALID_FREQUENCIES   = {"IMMEDIATE", "HOURLY_DIGEST", "DAILY_DIGEST", "WEEKLY_DIGEST", "DISABLED"}

# Mention-watcher default expiry — 30 days, configurable when the Configuration
# infrastructure (file 08) lands.
MENTION_WATCHER_EXPIRY_DAYS = 30


def _serialize(w: Watcher) -> dict:
    return {
        "id": str(w.id),
        "targetEntityType": w.target_entity_type,
        "targetEntityId": str(w.target_entity_id),
        "watcherType": w.watcher_type,
        "watcherId": str(w.watcher_id),
        "status": w.status,
        "source": w.source,
        "scope": w.scope,
        "priority": w.priority,
        "notificationFrequency": w.notification_frequency,
        "watchReason": w.watch_reason,
        "expiresAt": w.expires_at.isoformat() if w.expires_at else None,
        "pausedAt": w.paused_at.isoformat() if w.paused_at else None,
        "removedAt": w.removed_at.isoformat() if w.removed_at else None,
        "createdAt": w.created_at.isoformat(),
        "createdBy": str(w.created_by),
    }


def _is_own(w: Watcher, user: User) -> bool:
    """True when the watcher represents the calling user themselves."""
    return w.watcher_type == "EMPLOYEE" and w.watcher_id == user.id


async def _get(s: AsyncSession, tenant_id, watcher_id: uuid.UUID) -> Watcher:
    row = (await s.execute(
        select(Watcher).where(and_(Watcher.tenant_id == tenant_id, Watcher.id == watcher_id))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Watcher not found")
    return row


async def _get_on_target(
    s: AsyncSession, tenant_id, entity_key: str, parent_id: uuid.UUID, watcher_id: uuid.UUID,
) -> Watcher:
    row = (await s.execute(
        select(Watcher).where(and_(
            Watcher.tenant_id == tenant_id,
            Watcher.id == watcher_id,
            Watcher.target_entity_type == entity_key,
            Watcher.target_entity_id == parent_id,
        ))
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Watcher not found")
    return row


# ──────────────────────────────────────────────────────────────────────────────
# LIST
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{entity_key}/{parent_id}/watchers")
async def list_watchers(
    entity_key: str,
    parent_id: uuid.UUID,
    status: Optional[str] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List watchers on (entity_key, parent_id). watch.view required."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "view"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Watcher).where(and_(
        Watcher.tenant_id == user.tenant_id,
        Watcher.target_entity_type == entity_key,
        Watcher.target_entity_id == parent_id,
    ))
    if status:
        status = status.upper()
        if status not in _VALID_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(_VALID_STATUSES)}")
        q = q.where(Watcher.status == status)
    q = q.order_by(Watcher.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(w) for w in rows]


# ──────────────────────────────────────────────────────────────────────────────
# ADD
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{entity_key}/{parent_id}/watchers", status_code=201)
async def add_watcher(
    entity_key: str,
    parent_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Add a watcher. Self-watch (EMPLOYEE + own id) requires watch.add.
    Any other principal (ROLE, DEPARTMENT, TEAM, or another EMPLOYEE) requires watch.manage_others."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "add"):
        raise HTTPException(status_code=403, detail="Access denied")

    wtype = (payload.get("watcherType") or "EMPLOYEE").upper()
    if wtype not in _VALID_WATCHER_TYPES:
        raise HTTPException(status_code=422, detail=f"watcherType must be one of {sorted(_VALID_WATCHER_TYPES)}")

    raw_wid = payload.get("watcherId")
    try:
        wid = uuid.UUID(str(raw_wid)) if raw_wid else user.id
    except (ValueError, AttributeError):
        raise HTTPException(status_code=422, detail="watcherId must be a UUID")

    # Non-EMPLOYEE types or watching on-behalf-of another user requires manage_others.
    is_self = (wtype == "EMPLOYEE" and wid == user.id)
    if not is_self and not can(grants, "watch", "manage_others"):
        raise HTTPException(status_code=403, detail="watch.manage_others required to add a watcher for another principal")

    # Pre-check uniqueness for a clean 409 (DB partial unique is the authoritative guard).
    existing = (await s.execute(
        select(Watcher).where(and_(
            Watcher.tenant_id == user.tenant_id,
            Watcher.target_entity_type == entity_key,
            Watcher.target_entity_id == parent_id,
            Watcher.watcher_type == wtype,
            Watcher.watcher_id == wid,
            Watcher.status == "ACTIVE",
        ))
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="An active watcher for this principal already exists")

    scope = (payload.get("scope") or "OBJECT_ONLY").upper()
    if scope not in _VALID_SCOPES:
        raise HTTPException(status_code=422, detail=f"scope must be one of {sorted(_VALID_SCOPES)}")
    priority = (payload.get("priority") or "NORMAL").upper()
    if priority not in _VALID_PRIORITIES:
        raise HTTPException(status_code=422, detail=f"priority must be one of {sorted(_VALID_PRIORITIES)}")
    frequency = (payload.get("notificationFrequency") or "IMMEDIATE").upper()
    if frequency not in _VALID_FREQUENCIES:
        raise HTTPException(status_code=422, detail=f"notificationFrequency must be one of {sorted(_VALID_FREQUENCIES)}")

    source = (payload.get("source") or "MANUAL").upper()
    expires_at = None
    if source == "MENTION":
        expires_at = datetime.now(timezone.utc) + timedelta(days=MENTION_WATCHER_EXPIRY_DAYS)

    w = Watcher(
        tenant_id=user.tenant_id,
        target_entity_type=entity_key,
        target_entity_id=parent_id,
        watcher_type=wtype,
        watcher_id=wid,
        source=source,
        scope=scope,
        priority=priority,
        notification_frequency=frequency,
        watch_reason=payload.get("watchReason"),
        expires_at=expires_at,
        created_by=user.id,
    )
    s.add(w)
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "watch_added", entity_key, parent_id, user.id,
        {"watchId": str(w.id), "watcherType": wtype, "watcherId": str(wid), "source": source, "scope": scope},
    )
    return _serialize(w)


# ──────────────────────────────────────────────────────────────────────────────
# REMOVE
# ──────────────────────────────────────────────────────────────────────────────

@router.delete("/{entity_key}/{parent_id}/watchers/{watcher_id}")
async def remove_watcher(
    entity_key: str,
    parent_id: uuid.UUID,
    watcher_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Soft-remove (status → REMOVED, terminal). Own watch requires watch.remove.
    Another principal's watch requires watch.manage_others."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "remove"):
        raise HTTPException(status_code=403, detail="Access denied")

    w = await _get_on_target(s, user.tenant_id, entity_key, parent_id, watcher_id)
    if w.status == "REMOVED":
        return _serialize(w)  # idempotent

    if not _is_own(w, user) and not can(grants, "watch", "manage_others"):
        raise HTTPException(status_code=403, detail="watch.manage_others required to remove another user's watcher")

    w.status = "REMOVED"
    w.removed_at = datetime.now(timezone.utc)
    w.removed_by = user.id
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "watch_removed", entity_key, parent_id, user.id,
        {"watchId": str(w.id), "watcherType": w.watcher_type, "watcherId": str(w.watcher_id),
         "byManager": not _is_own(w, user)},
    )
    return _serialize(w)


# ──────────────────────────────────────────────────────────────────────────────
# PAUSE + RESUME
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{entity_key}/{parent_id}/watchers/{watcher_id}/pause")
async def pause_watcher(
    entity_key: str,
    parent_id: uuid.UUID,
    watcher_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Pause → PAUSED. Own watch requires watch.pause; another's requires watch.manage_others."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "pause"):
        raise HTTPException(status_code=403, detail="Access denied")

    w = await _get_on_target(s, user.tenant_id, entity_key, parent_id, watcher_id)
    if w.status == "REMOVED":
        raise HTTPException(status_code=422, detail="Cannot pause a removed watcher")
    if w.status == "PAUSED":
        return _serialize(w)  # idempotent

    if not _is_own(w, user) and not can(grants, "watch", "manage_others"):
        raise HTTPException(status_code=403, detail="watch.manage_others required to pause another user's watcher")

    w.status = "PAUSED"
    w.paused_at = datetime.now(timezone.utc)
    w.paused_by = user.id
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "watch_paused", entity_key, parent_id, user.id,
        {"watchId": str(w.id), "watcherType": w.watcher_type, "watcherId": str(w.watcher_id)},
    )
    return _serialize(w)


@router.post("/{entity_key}/{parent_id}/watchers/{watcher_id}/resume")
async def resume_watcher(
    entity_key: str,
    parent_id: uuid.UUID,
    watcher_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Resume → ACTIVE. Own watch requires watch.resume; another's requires watch.manage_others."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "resume"):
        raise HTTPException(status_code=403, detail="Access denied")

    w = await _get_on_target(s, user.tenant_id, entity_key, parent_id, watcher_id)
    if w.status == "REMOVED":
        raise HTTPException(status_code=422, detail="Cannot resume a removed watcher")
    if w.status == "ACTIVE":
        return _serialize(w)  # idempotent

    if not _is_own(w, user) and not can(grants, "watch", "manage_others"):
        raise HTTPException(status_code=403, detail="watch.manage_others required to resume another user's watcher")

    w.status = "ACTIVE"
    w.paused_at = None
    w.paused_by = None
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "watch_resumed", entity_key, parent_id, user.id,
        {"watchId": str(w.id), "watcherType": w.watcher_type, "watcherId": str(w.watcher_id)},
    )
    return _serialize(w)


# ──────────────────────────────────────────────────────────────────────────────
# PREFERENCES (scope / priority / frequency)
# ──────────────────────────────────────────────────────────────────────────────

@router.patch("/{entity_key}/{parent_id}/watchers/{watcher_id}/preferences")
async def update_preferences(
    entity_key: str,
    parent_id: uuid.UUID,
    watcher_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Update scope, priority, or notification_frequency. Own watch requires watch.view
    (watchers always configure their own preferences); another's requires watch.manage_others."""
    grants = await load_grants(s, user)
    if not can(grants, "watch", "view"):
        raise HTTPException(status_code=403, detail="Access denied")

    w = await _get_on_target(s, user.tenant_id, entity_key, parent_id, watcher_id)
    if w.status == "REMOVED":
        raise HTTPException(status_code=422, detail="Cannot update preferences on a removed watcher")

    if not _is_own(w, user) and not can(grants, "watch", "manage_others"):
        raise HTTPException(status_code=403, detail="watch.manage_others required to update another user's preferences")

    changed: dict = {}
    if "scope" in payload:
        v = (payload["scope"] or "").upper()
        if v not in _VALID_SCOPES:
            raise HTTPException(status_code=422, detail=f"scope must be one of {sorted(_VALID_SCOPES)}")
        if w.scope != v:
            changed["scope"] = {"from": w.scope, "to": v}
            w.scope = v
    if "priority" in payload:
        v = (payload["priority"] or "").upper()
        if v not in _VALID_PRIORITIES:
            raise HTTPException(status_code=422, detail=f"priority must be one of {sorted(_VALID_PRIORITIES)}")
        if w.priority != v:
            changed["priority"] = {"from": w.priority, "to": v}
            w.priority = v
    if "notificationFrequency" in payload:
        v = (payload["notificationFrequency"] or "").upper()
        if v not in _VALID_FREQUENCIES:
            raise HTTPException(status_code=422, detail=f"notificationFrequency must be one of {sorted(_VALID_FREQUENCIES)}")
        if w.notification_frequency != v:
            changed["notificationFrequency"] = {"from": w.notification_frequency, "to": v}
            w.notification_frequency = v

    if not changed:
        return _serialize(w)  # nothing actually changed — no event noise

    await s.flush()

    event_type = "watch_scope_changed" if "scope" in changed else "watch_preference_changed"
    await workflow.emit(
        s, user.tenant_id, event_type, entity_key, parent_id, user.id,
        {"watchId": str(w.id), "changes": changed},
    )
    return _serialize(w)
