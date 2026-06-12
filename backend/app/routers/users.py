"""Users endpoints (Batch 32 + Module 1 Security extension).

Read side is the assignee/agent picker that serves selectors across the app
(WorkItems, Helpdesk) — any authenticated user may list their tenant's users.

Write side (Module 1: Security):
    POST   /api/users           — create user (config.manage)
    PATCH  /api/users/{id}      — update user (config.manage; refuse self password reset via this route? no — allowed)
    DELETE /api/users/{id}      — soft delete (status='INACTIVE'); refuse self-delete; (config.manage)

All writes emit an audit Event through workflow.emit, following the same
pattern as helpdesk.py / org_nodes.py.

The GET serializer is extended to include each user's `assignments`
(role+node tuples) so the Users pane can show role chips inline.
"""

import uuid

from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import APIRouter, Depends, HTTPException

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User, Assignment, RoleDef, OrgNode
from ..access import load_grants, can
from ..security import hash_password
from .. import workflow
from .auth import current_user, validate_password_strength, revoke_all_refresh_tokens_for_user

router = APIRouter(prefix="/api/users", tags=["users"])


class UserCreateIn(BaseModel):
    name: str
    email: str
    password: str
    primary_node_id: uuid.UUID | None = None


class UserUpdateIn(BaseModel):
    name: str | None = None
    email: str | None = None
    password: str | None = None
    primary_node_id: uuid.UUID | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _require_config_manage(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage users")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="app_user",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


async def _user_assignments(s: AsyncSession, tenant_id, user_id: uuid.UUID) -> list[dict]:
    """List a user's role+node assignments, denormalized for the pane."""
    rows = (await s.execute(
        select(Assignment, RoleDef, OrgNode)
        .join(RoleDef, RoleDef.id == Assignment.role_id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.user_id == user_id, Assignment.tenant_id == tenant_id)
        .order_by(RoleDef.key)
    )).all()
    return [
        {
            "id": str(a.id),
            "role_id": str(r.id),
            "role_key": r.key,
            "role_label": r.label,
            "node_id": str(n.id),
            "node_code": n.code,
            "node_name": n.name,
            "node_path": str(n.path),
        }
        for a, r, n in rows
    ]


def _user_basic(u: User) -> dict:
    """Serialize a User without assignments (no password_hash)."""
    return {
        "id": str(u.id),
        "name": u.name,
        "email": u.email,
        "primary_node_id": str(u.primary_node_id) if u.primary_node_id else None,
        "status": u.status,
        "avatar_url": u.avatar_url,
    }


async def _user_full(s: AsyncSession, u: User) -> dict:
    """Serialize a User with their assignments — used by GET endpoints."""
    out = _user_basic(u)
    out["assignments"] = await _user_assignments(s, u.tenant_id, u.id)
    return out


async def _get_user(s: AsyncSession, tenant_id, user_id: uuid.UUID) -> User:
    u = (await s.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if u is None:
        raise HTTPException(404, "User not found")
    return u


# ---------------------------------------------------------------------------
# READ
# ---------------------------------------------------------------------------
@router.get("")
async def list_users(
    q: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List users in the caller's tenant + each user's role assignments.

    Filter by tenant_id == caller's tenant_id. Optional ?q= substring match
    on name/email. Order by name (nulls last), then email.
    """
    query = select(User).where(User.tenant_id == user.tenant_id)

    if q:
        q_lower = q.lower()
        query = query.where(
            (func.lower(User.name).contains(q_lower))
            | (func.lower(User.email).contains(q_lower))
        )

    query = query.order_by(User.name.asc().nullslast(), User.email.asc())
    rows = (await s.execute(query)).scalars().all()
    return [await _user_full(s, u) for u in rows]


@router.get("/{user_id}")
async def get_user(
    user_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Get one user + their assignments. Same tenant scope."""
    u = await _get_user(s, user.tenant_id, user_id)
    return await _user_full(s, u)


# ---------------------------------------------------------------------------
# WRITE — gated on config.manage
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def create_user(
    payload: UserCreateIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a user. Body: {name, email, password, primary_node_id?}.

    Duplicate email → 409. Audit-logged.
    """
    await _require_config_manage(s, user)

    name = (payload.name or "").strip()
    email = str(payload.email).strip().lower()
    password = payload.password or ""
    if not name:
        raise HTTPException(422, "name is required")
    validate_password_strength(password)  # 422 on weak

    primary_node_id = None
    if payload.primary_node_id:
        primary_node_id = payload.primary_node_id
        # Confirm node lives in caller's tenant.
        node = (await s.execute(
            select(OrgNode).where(OrgNode.id == primary_node_id, OrgNode.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if node is None:
            raise HTTPException(422, "primary_node_id not found in this tenant")

    # Duplicate-email check (email is globally unique on the table — 409 with a clean message
    # rather than a 500 IntegrityError).
    clash = (await s.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A user with email '{email}' already exists")

    new_user = User(
        tenant_id=user.tenant_id,
        primary_node_id=primary_node_id,
        email=email,
        name=name,
        password_hash=hash_password(password),
        status="ACTIVE",
    )
    s.add(new_user)
    await s.flush()  # assign new_user.id for audit + response

    out = await _user_full(s, new_user)
    await workflow.emit(s, user.tenant_id, "CREATE", "app_user", new_user.id, user.id,
                        {"name": name, "email": email})
    await s.commit()
    return out


@router.patch("/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdateIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Update a user. Body (all optional): {name, email, primary_node_id, password}.

    Duplicate email → 409. Audit-logged.
    """
    await _require_config_manage(s, user)
    target = await _get_user(s, user.tenant_id, user_id)

    changed: dict = {}

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(422, "name cannot be empty")
        if name != target.name:
            changed["name"] = name
            target.name = name

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        if email != target.email:
            clash = (await s.execute(
                select(User).where(User.email == email, User.id != target.id)
            )).scalar_one_or_none()
            if clash:
                raise HTTPException(409, f"A user with email '{email}' already exists")
            changed["email"] = email
            target.email = email

    if "primary_node_id" in payload.model_fields_set:
        pn = payload.primary_node_id
        if pn is None:
            target.primary_node_id = None
            changed["primary_node_id"] = None
        else:
            node = (await s.execute(
                select(OrgNode).where(OrgNode.id == pn, OrgNode.tenant_id == user.tenant_id)
            )).scalar_one_or_none()
            if node is None:
                raise HTTPException(422, "primary_node_id not found in this tenant")
            target.primary_node_id = pn
            changed["primary_node_id"] = str(pn)

    if payload.password is not None:
        pw = payload.password
        validate_password_strength(pw)
        target.password_hash = hash_password(pw)
        changed["password"] = "***"

    out = await _user_full(s, target)
    if changed:
        await workflow.emit(s, user.tenant_id, "UPDATE", "app_user", target.id, user.id,
                            {"changed": list(changed.keys())})
    await s.commit()
    return out


@router.delete("/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Soft-delete a user — sets status='INACTIVE'. Refuses self-delete (422).
    Audit-logged. Idempotent: an already-INACTIVE user is a no-op (200, status unchanged).
    """
    await _require_config_manage(s, user)
    if user_id == user.id:
        raise HTTPException(422, "You cannot deactivate your own account.")

    target = await _get_user(s, user.tenant_id, user_id)

    was = target.status
    revoked = 0
    if was != "INACTIVE":
        target.status = "INACTIVE"
        await workflow.emit(s, user.tenant_id, "DELETE", "app_user", target.id, user.id,
                            {"email": target.email, "previous_status": was})
        # S6 remediation 2026-06-04: soft-deactivation must also revoke every still-live refresh
        # token for the target. login/refresh both already enforce status=='ACTIVE' (S2), but a
        # token that's still in the DB as non-revoked is a liability for incident response and
        # for accurate session telemetry — burn them all down here.
        revoked = await revoke_all_refresh_tokens_for_user(s, target.id)  # tenant-filter-ok: — target is tenant-confirmed by _get_user above
    await s.commit()
    return {"ok": True, "id": str(target.id), "status": target.status, "refresh_tokens_revoked": revoked}
