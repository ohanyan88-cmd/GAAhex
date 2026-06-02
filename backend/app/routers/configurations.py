"""Configuration Standard (file 08) — API routes.

Endpoints — all RLS tenant-scoped, configuration.manage permission required for
ALL reads and writes (Super Admin scope, file 15 line 33-34):

  POST   /api/configurations                create a new configuration
  GET    /api/configurations                list (filter by ?scope= / ?key=)
  GET    /api/configurations/{id}           read single
  PATCH  /api/configurations/{id}           update value / status (bumps version)
  GET    /api/configurations/{id}/history   list ConfigurationHistory rows
  POST   /api/configurations/resolve        resolve most-specific live ACTIVE config

Resolution precedence (most-specific first):
  USER > ROLE > DEPARTMENT > TENANT > GLOBAL > ENVIRONMENT

The resolve endpoint takes a key + scope_hints dict and walks the precedence
list returning the first matching ACTIVE configuration.

Substrate emit via app.workflow.emit (event_name + category set per file 06
EventName / EventCategory):
  configuration_created             → Configuration.Created
  configuration_updated             → Configuration.Updated
  configuration_status_changed      → Configuration.StatusChanged
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models.configuration import (
    Configuration, ConfigurationHistory,
    VALID_SCOPES, VALID_STATUSES, SCOPE_PRECEDENCE,
)
from ..models.user import User
from .auth import current_user

router = APIRouter(prefix="/api/configurations", tags=["configurations"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(c: Configuration) -> dict:
    return {
        "id": str(c.id),
        "referenceNumber": c.reference_number,
        "tenantId": str(c.tenant_id),
        "configurationKey": c.configuration_key,
        "scope": c.scope,
        "configurationValue": c.configuration_value,
        "status": c.status,
        "version": c.version,
        "description": c.description,
        "changeReason": c.change_reason,
        "createdAt": c.created_at.isoformat(),
        "createdBy": str(c.created_by),
        "updatedAt": c.updated_at.isoformat(),
        "updatedBy": str(c.updated_by) if c.updated_by else None,
    }


def _serialize_history(h: ConfigurationHistory) -> dict:
    return {
        "id": str(h.id),
        "configurationId": str(h.configuration_id),
        "version": h.version,
        "configurationValue": h.configuration_value,
        "changeReason": h.change_reason,
        "changedAt": h.changed_at.isoformat(),
        "changedBy": str(h.changed_by),
    }


def _validate_enum(value: str | None, name: str, valid: set[str]) -> str:
    if value is None:
        raise HTTPException(status_code=422, detail=f"{name} is required")
    v = str(value).upper()
    if v not in valid:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {sorted(valid)}")
    return v


async def _get(s: AsyncSession, tenant_id, cfg_id: uuid.UUID) -> Configuration:
    row = (await s.execute(
        select(Configuration).where(
            and_(Configuration.tenant_id == tenant_id, Configuration.id == cfg_id)
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Configuration not found")
    return row


async def _next_ref(s: AsyncSession, tenant_id) -> str:
    """CFG-000001 counter. UNIQUE (tenant_id, reference_number) is the
    concurrency fence — duplicates raise IntegrityError at the DB layer."""
    n = (await s.execute(
        select(func.count()).select_from(Configuration).where(
            Configuration.tenant_id == tenant_id
        )
    )).scalar_one()
    return f"CFG-{n + 1:06d}"


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_configuration(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    key = (payload.get("configurationKey") or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="configurationKey is required")

    scope = _validate_enum(payload.get("scope"), "scope", VALID_SCOPES)

    value = payload.get("configurationValue")
    if value is None:
        raise HTTPException(status_code=422, detail="configurationValue is required")

    status_in = payload.get("status", "ACTIVE")
    status = _validate_enum(status_in, "status", VALID_STATUSES)

    ref = await _next_ref(s, user.tenant_id)
    cfg = Configuration(
        tenant_id=user.tenant_id,
        reference_number=ref,
        configuration_key=key,
        scope=scope,
        configuration_value=value,
        status=status,
        version=1,
        description=payload.get("description"),
        change_reason=payload.get("changeReason"),
        created_by=user.id,
        updated_by=user.id,
    )
    s.add(cfg)
    try:
        await s.flush()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(
            status_code=409,
            detail="A configuration with the same (configurationKey, scope) already exists",
        )

    # Initial v1 history row.
    s.add(ConfigurationHistory(
        tenant_id=user.tenant_id,
        configuration_id=cfg.id,
        version=1,
        configuration_value=value,
        change_reason=payload.get("changeReason"),
        changed_by=user.id,
    ))
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "configuration_created",
        "configuration", cfg.id, user.id,
        {"configurationId": str(cfg.id), "referenceNumber": ref,
         "configurationKey": key, "scope": scope, "status": status},
        event_name="Configuration.Created", category="SYSTEM",
    )
    return _serialize(cfg)


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_configurations(
    scope: str | None = None,
    key: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Configuration).where(Configuration.tenant_id == user.tenant_id)
    if scope:
        scope_v = str(scope).upper()
        if scope_v not in VALID_SCOPES:
            raise HTTPException(
                status_code=422,
                detail=f"scope must be one of {sorted(VALID_SCOPES)}",
            )
        q = q.where(Configuration.scope == scope_v)
    if key:
        q = q.where(Configuration.configuration_key == key)
    q = q.order_by(Configuration.created_at)
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(c) for c in rows]


# ── READ ──────────────────────────────────────────────────────────────────────

@router.get("/{cfg_id}")
async def get_configuration(
    cfg_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    cfg = await _get(s, user.tenant_id, cfg_id)
    return _serialize(cfg)


# ── PATCH (update value / status) ─────────────────────────────────────────────

@router.patch("/{cfg_id}")
async def update_configuration(
    cfg_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Update configuration_value and/or status — bumps version, writes a
    ConfigurationHistory row, sets updated_at + updated_by.

    Emits configuration_updated (value change) and/or configuration_status_changed.
    """
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    cfg = await _get(s, user.tenant_id, cfg_id)

    has_value_change = "configurationValue" in payload
    has_status_change = "status" in payload
    new_status = None
    old_status = cfg.status

    if has_status_change:
        new_status = _validate_enum(payload.get("status"), "status", VALID_STATUSES)

    if "description" in payload:
        cfg.description = payload.get("description")

    # Only bump version if value or status changed.
    if has_value_change or (has_status_change and new_status != old_status):
        if has_value_change:
            new_value = payload.get("configurationValue")
            if new_value is None:
                raise HTTPException(
                    status_code=422,
                    detail="configurationValue cannot be null on update",
                )
            cfg.configuration_value = new_value
        if has_status_change:
            cfg.status = new_status

        cfg.version = cfg.version + 1
        cfg.change_reason = payload.get("changeReason")
        cfg.updated_at = _now()
        cfg.updated_by = user.id

        s.add(ConfigurationHistory(
            tenant_id=user.tenant_id,
            configuration_id=cfg.id,
            version=cfg.version,
            configuration_value=cfg.configuration_value,
            change_reason=payload.get("changeReason"),
            changed_by=user.id,
        ))
        await s.flush()

        if has_value_change:
            await workflow.emit(
                s, user.tenant_id, "configuration_updated",
                "configuration", cfg.id, user.id,
                {"configurationId": str(cfg.id),
                 "referenceNumber": cfg.reference_number,
                 "configurationKey": cfg.configuration_key,
                 "scope": cfg.scope, "version": cfg.version},
                event_name="Configuration.Updated", category="SYSTEM",
            )
        if has_status_change and new_status != old_status:
            await workflow.emit(
                s, user.tenant_id, "configuration_status_changed",
                "configuration", cfg.id, user.id,
                {"configurationId": str(cfg.id),
                 "referenceNumber": cfg.reference_number,
                 "configurationKey": cfg.configuration_key,
                 "scope": cfg.scope,
                 "fromStatus": old_status, "toStatus": new_status},
                event_name="Configuration.StatusChanged", category="SYSTEM",
            )
    else:
        # description-only change: still touches updated_at/updated_by but no
        # new version / history row.
        if "description" in payload:
            cfg.updated_at = _now()
            cfg.updated_by = user.id
            await s.flush()

    return _serialize(cfg)


# ── HISTORY ───────────────────────────────────────────────────────────────────

@router.get("/{cfg_id}/history")
async def list_history(
    cfg_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")
    # Verify cfg exists in this tenant (404 isolation).
    await _get(s, user.tenant_id, cfg_id)
    rows = (await s.execute(
        select(ConfigurationHistory).where(
            and_(
                ConfigurationHistory.tenant_id == user.tenant_id,
                ConfigurationHistory.configuration_id == cfg_id,
            )
        ).order_by(ConfigurationHistory.version.desc())
    )).scalars().all()
    return [_serialize_history(h) for h in rows]


# ── RESOLVE (most-specific match) ─────────────────────────────────────────────

@router.post("/resolve")
async def resolve_configuration(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Resolve the most-specific live ACTIVE Configuration for a given key.

    Body:
      {
        "key": "feature.x",
        "scope_hints": {
          "USER": true | false,
          "ROLE": true | false,
          "DEPARTMENT": true | false,
          "TENANT": true | false,
          "GLOBAL": true | false,
          "ENVIRONMENT": true | false
        }
      }

    A True hint means "the caller wants to allow this scope as a match".
    Walks SCOPE_PRECEDENCE (USER → ENVIRONMENT) and returns the first ACTIVE
    row whose scope is allowed. Returns 404 if nothing matches.
    """
    grants = await load_grants(s, user)
    if not can(grants, "configuration", "manage"):
        raise HTTPException(status_code=403, detail="Access denied")

    key = (payload.get("key") or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="key is required")
    hints = payload.get("scope_hints") or {}
    if not isinstance(hints, dict):
        raise HTTPException(status_code=422, detail="scope_hints must be an object")

    # Default: all scopes allowed.
    allowed = {scope for scope in SCOPE_PRECEDENCE
               if hints.get(scope, True)}
    if not allowed:
        raise HTTPException(status_code=422, detail="No scopes allowed in scope_hints")

    rows = (await s.execute(
        select(Configuration).where(
            and_(
                Configuration.tenant_id == user.tenant_id,
                Configuration.configuration_key == key,
                Configuration.status == "ACTIVE",
                Configuration.scope.in_(list(allowed)),
            )
        )
    )).scalars().all()

    by_scope = {r.scope: r for r in rows}
    for scope in SCOPE_PRECEDENCE:
        if scope in by_scope:
            return _serialize(by_scope[scope])

    raise HTTPException(
        status_code=404,
        detail=f"No active configuration found for key {key!r}",
    )
