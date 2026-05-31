"""Roles & Permissions management endpoints.

Exposes the RoleDef / PermissionDef tables via a REST API for the Studio
configuration pane. Role permissions are stored as a JSONB list of permission
key strings on RoleDef.permissions — this router reads and writes that column
directly. Writes are gated by config.manage (same as all other Studio endpoints).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import RoleDef, PermissionDef, User
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api", tags=["roles"])


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")


async def _get_role(s: AsyncSession, tenant_id, role_id: uuid.UUID) -> RoleDef:
    role = (await s.execute(
        select(RoleDef).where(RoleDef.tenant_id == tenant_id, RoleDef.id == role_id)
    )).scalar_one_or_none()
    if not role:
        raise HTTPException(404, f"Role '{role_id}' not found")
    return role


def _role_out(role: RoleDef) -> dict:
    return {
        "id": str(role.id),
        "key": role.key,
        "label": role.label,
        "permissions": list(role.permissions or []),
    }


@router.get("/roles")
async def list_roles(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """List all roles for the tenant.

    Response: [{id, key, label, permissions: [permKey, ...]}]
    """
    roles = (await s.execute(
        select(RoleDef).where(RoleDef.tenant_id == user.tenant_id).order_by(RoleDef.key)
    )).scalars().all()
    return [_role_out(r) for r in roles]


@router.get("/permissions")
async def list_permissions(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """List all permission definitions for the tenant.

    Response: [{key, label, group}]
    """
    perms = (await s.execute(
        select(PermissionDef).where(PermissionDef.tenant_id == user.tenant_id).order_by(PermissionDef.group, PermissionDef.key)
    )).scalars().all()
    return [{"key": p.key, "label": p.label, "group": p.group} for p in perms]


@router.post("/roles", status_code=201)
async def create_role(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a role.

    Request: {key: str, label: str, permissions: [permKey, ...]}
    Response: {id, key, label, permissions: [permKey, ...]}
    """
    await _require_config_manage(s, user)

    key = (payload.get("key") or "").strip()
    label = (payload.get("label") or "").strip()
    if not key or not label:
        raise HTTPException(422, "key and label are required")

    clash = (await s.execute(
        select(RoleDef).where(RoleDef.tenant_id == user.tenant_id, RoleDef.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A role with key '{key}' already exists")

    permissions = payload.get("permissions") or []
    if not isinstance(permissions, list):
        raise HTTPException(422, "permissions must be a list of permission key strings")

    role = RoleDef(
        tenant_id=user.tenant_id,
        key=key,
        label=label,
        permissions=list(permissions),
    )
    s.add(role)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "role_def", role.id, user.id,
                        {"key": key, "label": label, "permissions": list(permissions)})
    await s.commit()
    return _role_out(role)


@router.patch("/roles/{role_id}")
async def update_role(role_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update a role's label and/or replace its permission set.

    Request: {label?: str, permissions?: [permKey, ...]}
    Response: {id, key, label, permissions: [permKey, ...]}
    """
    await _require_config_manage(s, user)
    role = await _get_role(s, user.tenant_id, role_id)

    changed: dict = {}
    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        if v != role.label:
            role.label = v
            changed["label"] = v

    if "permissions" in payload:
        permissions = payload["permissions"]
        if not isinstance(permissions, list):
            raise HTTPException(422, "permissions must be a list of permission key strings")
        role.permissions = list(permissions)   # full replacement
        changed["permissions"] = list(permissions)

    if changed:
        await workflow.emit(s, user.tenant_id, "update", "role_def", role.id, user.id,
                            {"key": role.key, "changed": list(changed.keys())})
    await s.commit()
    return _role_out(role)


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(role_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a role definition. Any existing assignments referencing this role will be cascade-
    deleted or will become dangling depending on FK constraints — check assignment cleanup
    separately if needed."""
    await _require_config_manage(s, user)
    role = await _get_role(s, user.tenant_id, role_id)
    rid = role.id
    rkey = role.key
    await s.delete(role)
    await workflow.emit(s, user.tenant_id, "delete", "role_def", rid, user.id,
                        {"key": rkey})
    await s.commit()
