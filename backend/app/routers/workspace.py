"""Workspace role resolution — picks the workspace layout for the signed-in user.

The "My Work" page in the frontend morphs based on the caller's resolved workspace role. The set of
valid workspace-role keys is a small fixed vocabulary that maps 1:1 to layouts in the frontend's
LayoutRegistry — NOT to the role_def.key namespace, which is broader and shifts as Studio adds
custom roles. This router translates between the two.

Resolution order (first match wins):
  1. user.workspace_role_override  — manual user choice (Workspace > "Change layout" UI)
  2. user.primary_role_key         — admin-set primary (Studio > Users > Set primary role)
  3. Derived from Assignment.role.key via ROLE_DEF_TO_WORKSPACE, picking the highest-priority match
  4. 'general' fallback

Both override and primary are validated against VALID_WORKSPACE_ROLES on write; a value that's no
longer in the registry is treated as if it were NULL (graceful: the layout was removed but the user
shouldn't 500). Fixed paths under "/api/me" — registered BEFORE records.router (which owns
"/api/{slug}") so this isn't swallowed as an entity slug. Mirrors the pattern in me.py.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.access import Assignment, RoleDef
from .auth import current_user

router = APIRouter(prefix="/api/me", tags=["workspace"])


# Valid workspace-role keys — the frontend LayoutRegistry's complete vocabulary. Anything outside
# this set is rejected on PATCH and ignored on read (falls through to the next resolution step).
VALID_WORKSPACE_ROLES: frozenset[str] = frozenset({
    "ceo", "d2d_agent", "retail_agent", "b2b_am",
    "support_t1", "support_t2", "field_tech",
    "noc_engineer", "billing_spec", "general",
})


# role_def.key  →  workspace role key. Not every role_def maps — only the ones the workspace has a
# layout for. Roles outside this dict (e.g. "customer_care") simply don't contribute and the
# resolver moves on to the next assignment / falls back to 'general'.
ROLE_DEF_TO_WORKSPACE: dict[str, str] = {
    "super_admin":          "ceo",
    "executive":            "ceo",
    "admin":                "ceo",
    "sales_b2b":            "b2b_am",
    "sales_d2d":            "d2d_agent",
    "sales_retail":         "retail_agent",
    "sales_agent":          "b2b_am",   # generic sales rolls into B2B account-manager workspace
    "support_l1":           "support_t1",
    "support_l2":           "support_t2",
    "support_agent":        "support_t1",
    "field_tech":           "field_tech",
    "field_technician":     "field_tech",
    "technician":           "field_tech",
    "noc_engineer":         "noc_engineer",
    "noc_operator":         "noc_engineer",
    "billing_specialist":   "billing_spec",
    "finance_clerk":        "billing_spec",
}


# Priority order for the "derived" branch — when a user has multiple assignments, the highest-
# priority workspace role wins (executive layouts trump operational ones; specialists trump
# generalists). Lower index == higher priority.
_DERIVED_PRIORITY: list[str] = [
    "ceo",
    "b2b_am",
    "support_t2",
    "support_t1",
    "field_tech",
    "noc_engineer",
    "billing_spec",
    "d2d_agent",
    "retail_agent",
]


# Human-readable labels — frontend pairs these with the resolved key in the workspace header.
ROLE_LABELS: dict[str, str] = {
    "ceo": "Executive",
    "d2d_agent": "Door-to-Door Agent",
    "retail_agent": "Retail Shop Agent",
    "b2b_am": "B2B Account Manager",
    "support_t1": "Support Agent (Tier 1)",
    "support_t2": "Support Agent (Tier 2)",
    "field_tech": "Field Technician",
    "noc_engineer": "Network Engineer",
    "billing_spec": "Billing Specialist",
    "general": "Team Member",
}


class WorkspaceRoleOverrideIn(BaseModel):
    """PATCH body. `override` may be a valid workspace-role key, or null to clear."""
    override: str | None = None


def _label_for(role_key: str) -> str:
    """Lookup label with a safe fallback (title-cased key) — keeps the API contract intact even if
    a new layout is added without updating ROLE_LABELS."""
    return ROLE_LABELS.get(role_key, role_key.replace("_", " ").title())


async def _derive_from_assignments(s: AsyncSession, user: User) -> str | None:
    """Pick the highest-priority workspace role across the user's assignments. Returns None when
    none of the user's role_def.keys are mappable."""
    rows = (await s.execute(
        select(RoleDef.key)  # tenant-filter-ok: cross-tenant — RLS-scoped session; query joins user-owned Assignments
        .join(Assignment, Assignment.role_id == RoleDef.id)
        .where(Assignment.user_id == user.id)
    )).all()

    candidates: set[str] = set()
    for (role_key,) in rows:
        ws = ROLE_DEF_TO_WORKSPACE.get(role_key)
        if ws and ws in VALID_WORKSPACE_ROLES:
            candidates.add(ws)

    if not candidates:
        return None

    for ws in _DERIVED_PRIORITY:
        if ws in candidates:
            return ws
    # Any candidate not in the priority list — return one deterministically (sorted) rather than
    # silently dropping it. Shouldn't happen given ROLE_DEF_TO_WORKSPACE only maps into the priority
    # set, but defensive in case a future addition gets out of sync.
    return sorted(candidates)[0]


@router.get("/workspace-role")
async def get_workspace_role(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return the resolved workspace role for the signed-in user.

    Response: {"resolved_role": str, "label": str, "source": "override"|"primary"|"derived"|"fallback"}
    """
    # Reload on the RLS-subject session so the user's columns are fresh (the dep-injected user came
    # from an owner session at login). Pattern mirrors me.py._own_row.
    row = (await s.execute(select(User).where(User.id == user.id))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — RLS-scoped self-reload (mirrors me.py._own_row)
    if row is None:
        raise HTTPException(404, "User not found")

    # 1. Manual override wins. Stale/removed override keys (no longer in registry) silently fall
    #    through — the user's saved choice points at a layout that no longer exists.
    if row.workspace_role_override and row.workspace_role_override in VALID_WORKSPACE_ROLES:
        return {
            "resolved_role": row.workspace_role_override,
            "label": _label_for(row.workspace_role_override),
            "source": "override",
        }

    # 2. Admin-set primary.
    if row.primary_role_key and row.primary_role_key in VALID_WORKSPACE_ROLES:
        return {
            "resolved_role": row.primary_role_key,
            "label": _label_for(row.primary_role_key),
            "source": "primary",
        }

    # 3. Derived from assignments — highest-priority mappable role_def wins.
    derived = await _derive_from_assignments(s, row)
    if derived is not None:
        return {
            "resolved_role": derived,
            "label": _label_for(derived),
            "source": "derived",
        }

    # 4. Fallback — no role at all (a freshly-created user with no assignments yet).
    return {
        "resolved_role": "general",
        "label": _label_for("general"),
        "source": "fallback",
    }


@router.patch("/workspace-role")
async def set_workspace_role_override(
    body: WorkspaceRoleOverrideIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Set or clear the caller's workspace_role_override.

    Body: {"override": "ceo"}  → sets the override.
    Body: {"override": null}    → clears it (resolution falls back to primary/derived/fallback).

    Returns the freshly-resolved role payload (same shape as GET).
    """
    override = body.override
    if override is not None and override not in VALID_WORKSPACE_ROLES:
        raise HTTPException(
            400,
            f"Invalid workspace role '{override}'. Allowed: {sorted(VALID_WORKSPACE_ROLES)}",
        )

    row = (await s.execute(select(User).where(User.id == user.id))).scalar_one_or_none()  # tenant-filter-ok: cross-tenant — RLS-scoped self-reload (mirrors me.py._own_row)
    if row is None:
        raise HTTPException(404, "User not found")

    row.workspace_role_override = override
    await s.commit()

    # Re-resolve and return — saves the frontend a follow-up GET round-trip.
    return await get_workspace_role(user=row, s=s)
