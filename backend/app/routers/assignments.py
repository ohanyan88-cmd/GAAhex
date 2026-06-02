"""Assignments endpoints (Module 1: Security).

An Assignment binds a User to a RoleDef at a specific OrgNode (the scope anchor).
The access kernel walks Assignments at login to derive each user's effective
grants — see app.access.load_grants. This router exposes the CRUD surface for
the Studio Users pane: add a role to a user, remove a role from a user.

Read is gated on current_user (any authenticated tenant member may inspect
their own org's user→role bindings — they already see them in the Users pane).
Writes are gated on config.manage; every mutation emits an audit Event.

Tenant scope: every read/write filters Assignment.tenant_id == caller's tenant_id.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User, Assignment, RoleDef, OrgNode
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage assignments")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="assignment",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


def _assignment_out(a: Assignment, r: RoleDef, n: OrgNode) -> dict:
    return {
        "id": str(a.id),
        "user_id": str(a.user_id),
        "role_id": str(r.id),
        "role_key": r.key,
        "role_label": r.label,
        "node_id": str(n.id),
        "node_code": n.code,
        "node_name": n.name,
        "node_path": str(n.path),
    }


# ---------------------------------------------------------------------------
# READ
# ---------------------------------------------------------------------------
@router.get("")
async def list_assignments(
    user_id: uuid.UUID | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List assignments. Optional ?user_id= filter."""
    q = (
        select(Assignment, RoleDef, OrgNode)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.tenant_id == user.tenant_id)
        .order_by(RoleDef.key)
    )
    if user_id is not None:
        q = q.where(Assignment.user_id == user_id)
    rows = (await s.execute(q)).all()
    return [_assignment_out(a, r, n) for a, r, n in rows]


# ---------------------------------------------------------------------------
# WRITE — gated on config.manage
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def create_assignment(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create an assignment. Body: {user_id, role_id, node_id}.

    All three IDs must live in the caller's tenant. Duplicate (user,role,node)
    triples return 409. Audit-logged.
    """
    await _require_config_manage(s, user)

    def _uuid(field: str) -> uuid.UUID:
        raw = payload.get(field)
        if not raw:
            raise HTTPException(422, f"{field} is required")
        try:
            return uuid.UUID(str(raw))
        except (ValueError, TypeError):
            raise HTTPException(422, f"{field} is not a valid id")

    target_user_id = _uuid("user_id")
    role_id = _uuid("role_id")
    node_id = _uuid("node_id")

    # All three must belong to this tenant.
    target_user = (await s.execute(
        select(User).where(User.id == target_user_id, User.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if target_user is None:
        raise HTTPException(404, "User not found in this tenant")

    role = (await s.execute(
        select(RoleDef).where(RoleDef.id == role_id, RoleDef.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if role is None:
        raise HTTPException(404, "Role not found in this tenant")

    node = (await s.execute(
        select(OrgNode).where(OrgNode.id == node_id, OrgNode.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if node is None:
        raise HTTPException(404, "Org node not found in this tenant")

    # Duplicate check — (user, role, node) tuple is the natural key.
    dup = (await s.execute(
        select(Assignment).where(
            Assignment.tenant_id == user.tenant_id,
            Assignment.user_id == target_user_id,
            Assignment.role_id == role_id,
            Assignment.node_id == node_id,
        )
    )).scalar_one_or_none()
    if dup is not None:
        raise HTTPException(409, "This user already holds that role at that node")

    a = Assignment(
        tenant_id=user.tenant_id,
        user_id=target_user_id,
        role_id=role_id,
        node_id=node_id,
    )
    s.add(a)
    await s.flush()

    out = _assignment_out(a, role, node)
    await workflow.emit(s, user.tenant_id, "CREATE", "assignment", a.id, user.id,
                        {"user_id": str(target_user_id), "role_key": role.key,
                         "node_path": str(node.path)})
    await s.commit()
    return out


@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete an assignment. Audit-logged. Returns {ok: true, id}."""
    await _require_config_manage(s, user)

    row = (await s.execute(
        select(Assignment, RoleDef, OrgNode)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.id == assignment_id, Assignment.tenant_id == user.tenant_id)
    )).first()
    if row is None:
        raise HTTPException(404, "Assignment not found")

    a, role, node = row
    aid = a.id
    target_user_id = a.user_id
    role_key = role.key
    node_path = str(node.path)

    await s.delete(a)
    await workflow.emit(s, user.tenant_id, "DELETE", "assignment", aid, user.id,
                        {"user_id": str(target_user_id), "role_key": role_key,
                         "node_path": node_path})
    await s.commit()
    return {"ok": True, "id": str(aid)}
