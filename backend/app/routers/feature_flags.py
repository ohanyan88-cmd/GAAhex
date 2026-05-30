"""Feature-flag CRUD — tenant-scoped, DB-backed, audit-logged on every write.

Auth gates:
  - GET  /api/feature-flags          authenticated (any user — flags are read for client eval)
  - POST/PATCH/DELETE                config.manage
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Event
from ..models.feature_flag import FeatureFlag
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api/feature-flags", tags=["feature-flags"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _out(flag: FeatureFlag) -> dict:
    return {
        "id": str(flag.id),
        "key": flag.key,
        "label": flag.label,
        "enabled": flag.enabled,
        "role_scope": flag.role_scope,
        "created_at": flag.created_at.isoformat() if flag.created_at else None,
        "updated_at": flag.updated_at.isoformat() if flag.updated_at else None,
    }


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed: config.manage required")


async def _get_flag(s: AsyncSession, tenant_id: uuid.UUID, flag_id: uuid.UUID) -> FeatureFlag:
    flag = (await s.execute(
        select(FeatureFlag).where(
            FeatureFlag.tenant_id == tenant_id,
            FeatureFlag.id == flag_id,
        )
    )).scalar_one_or_none()
    if not flag:
        raise HTTPException(404, f"Feature flag '{flag_id}' not found")
    return flag


# ── schemas ───────────────────────────────────────────────────────────────────

class FlagCreate(BaseModel):
    key: str
    label: str
    enabled: bool = False
    role_scope: str | None = None


class FlagPatch(BaseModel):
    enabled: bool | None = None
    role_scope: str | None = None


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_flags(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List all feature flags for the tenant (sorted by key). Any authenticated user."""
    rows = (await s.execute(
        select(FeatureFlag)
        .where(FeatureFlag.tenant_id == user.tenant_id)
        .order_by(FeatureFlag.key)
    )).scalars().all()
    return [_out(r) for r in rows]


@router.post("", status_code=201)
async def create_flag(
    body: FlagCreate,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a feature flag. Requires config.manage."""
    await _require_config_manage(s, user)

    # Uniqueness check (DB constraint also enforces, but gives a clean 409)
    existing = (await s.execute(
        select(FeatureFlag).where(
            FeatureFlag.tenant_id == user.tenant_id,
            FeatureFlag.key == body.key,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Feature flag key '{body.key}' already exists for this tenant")

    now = datetime.now(timezone.utc)
    flag = FeatureFlag(
        id=uuid.uuid4(),
        tenant_id=user.tenant_id,
        key=body.key,
        label=body.label,
        enabled=body.enabled,
        role_scope=body.role_scope,
        created_at=now,
        updated_at=now,
    )
    s.add(flag)
    await s.commit()
    return _out(flag)


@router.patch("/{flag_id}")
async def patch_flag(
    flag_id: uuid.UUID,
    body: FlagPatch,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Update enabled and/or role_scope. Emits an audit Event. Requires config.manage."""
    await _require_config_manage(s, user)
    flag = await _get_flag(s, user.tenant_id, flag_id)

    before = {"enabled": flag.enabled, "role_scope": flag.role_scope}

    if body.enabled is not None:
        flag.enabled = body.enabled
    if body.role_scope is not None:
        flag.role_scope = body.role_scope if body.role_scope != "" else None

    # Stamp updated_at in Python so we never rely on onupdate in async context
    flag.updated_at = datetime.now(timezone.utc)

    after = {"enabled": flag.enabled, "role_scope": flag.role_scope}

    # Audit event
    s.add(Event(
        tenant_id=user.tenant_id,
        type="feature_flag.update",
        entity_key="feature_flag",
        actor_user_id=user.id,
        data={
            "flag_id": str(flag.id),
            "flag_key": flag.key,
            "before": before,
            "after": after,
        },
    ))
    await s.commit()
    return _out(flag)


@router.delete("/{flag_id}", status_code=204)
async def delete_flag(
    flag_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete a feature flag. Requires config.manage."""
    await _require_config_manage(s, user)
    flag = await _get_flag(s, user.tenant_id, flag_id)
    await s.delete(flag)
    await s.commit()
