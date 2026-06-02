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
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api", tags=["roles"])


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    """SPEC §0.2 (Step 7): role/permission CRUD flows through the kernel default-deny gate on
    `role_def.manage` in addition to the legacy `config.manage` role check."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    try:
        await assert_can(s, user, action="manage", entity_key="role_def",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


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
    await workflow.emit(s, user.tenant_id, "CREATE", "role_def", role.id, user.id,
                        {"key": key, "label": label, "permissions": list(permissions)})
    await s.commit()
    return _role_out(role)


@router.patch("/roles/{role_id}")
async def update_role(role_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update a role's label and/or replace its permission set.

    Request: {label?: str, permissions?: [permKey, ...]}
    Response: {id, key, label, permissions: [permKey, ...]}

    SPEC §4.5 mandatory-approval gate: a PATCH that mutates the role's `permissions`
    array is a `role_perm_change` per SPEC §4.5 (broadens or narrows what every holder
    of this role can do) and requires an APPROVED Approval row covering this role.
    A pure label edit (no permissions key in payload) is presentation only and passes
    through. First call parks a PENDING approval and returns 202; once decided
    APPROVED via PATCH /api/mandatory-approvals/{id}/decide, the second call performs
    the mutation and consumes the approval (EXECUTED).
    """
    await _require_config_manage(s, user)
    role = await _get_role(s, user.tenant_id, role_id)

    # SPEC §4.5 — `role_perm_change`. Trigger only when the permissions array is being
    # replaced (a label-only edit is not a permission change).
    perm_change = "permissions" in payload
    approved_approval = None
    if perm_change:
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="role_perm_change",
                target_entity_key="role_def",
                target_record_id=role.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="role_perm_change",
                requested_by_user_id=user.id,
                target_entity_key="role_def",
                target_record_id=role.id,
                payload={"role_key": role.key,
                         "from_permissions": list(role.permissions or []),
                         "to_permissions": payload.get("permissions")},
            )
            await s.commit()
            raise HTTPException(202, detail={
                "status": "approval_required",
                "approval_id": str(approval.id),
                "action_type": "role_perm_change",
            })
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="role_perm_change",
            target_entity_key="role_def",
            target_record_id=role.id,
        )

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
        await workflow.emit(s, user.tenant_id, "UPDATE", "role_def", role.id, user.id,
                            {"key": role.key, "changed": list(changed.keys())})
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
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
    await workflow.emit(s, user.tenant_id, "DELETE", "role_def", rid, user.id,
                        {"key": rkey})
    await s.commit()
