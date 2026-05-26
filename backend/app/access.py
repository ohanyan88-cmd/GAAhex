"""Access-control enforcement: Permission + Org Scope (the M3 slice of doc 12).

Roles/permissions are config; this is the fixed engine that interprets them.
"""
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Assignment, RoleDef, OrgNode, User


@dataclass
class Grant:
    permissions: set
    scope: str        # node | subtree | tenant
    node_path: str    # ltree path of the assignment's org node
    role_key: str = ""  # the RoleDef.key behind this grant (for field-level role gating)


async def load_grants(s: AsyncSession, user: User) -> list[Grant]:
    rows = (await s.execute(
        select(RoleDef, OrgNode.path)
        .join(Assignment, Assignment.role_id == RoleDef.id)
        .join(OrgNode, OrgNode.id == Assignment.node_id)
        .where(Assignment.user_id == user.id, Assignment.tenant_id == user.tenant_id)
    )).all()
    return [Grant(set(role.permissions or []), role.scope, str(path), role.key) for role, path in rows]


def role_keys(grants: list[Grant]) -> set[str]:
    """The set of RoleDef keys the caller holds — derived from already-loaded grants."""
    return {g.role_key for g in grants if g.role_key}


def _has_perm(perms: set, entity_key: str, verb: str) -> bool:
    return "*" in perms or f"{entity_key}.*" in perms or f"{entity_key}.{verb}" in perms


def _scope_ok(scope: str, grant_path: str, record_path: str | None) -> bool:
    if scope == "tenant":
        return True
    if record_path is None:          # no specific record (handled by caller)
        return True
    if scope == "node":
        return record_path == grant_path
    if scope == "subtree":
        return record_path == grant_path or record_path.startswith(grant_path + ".")
    return False


def can(grants: list[Grant], entity_key: str, verb: str, record_path: str | None = None) -> bool:
    """True if any grant gives `entity_key.verb` AND its scope covers `record_path`."""
    for g in grants:
        if _has_perm(g.permissions, entity_key, verb) and _scope_ok(g.scope, g.node_path, record_path):
            return True
    return False


def in_view_scope(grants: list[Grant], entity_key: str, record_path: str | None) -> bool:
    """For list filtering: can the user *view* a record at this path?"""
    return can(grants, entity_key, "view", record_path)


# ---- field-level access (visible vs editable per role; rules live in FieldDef.config) ----
#
# A field may declare `{"view_roles": [...], "edit_roles": [...]}` in its config. Both optional:
#   - no `view_roles` ⇒ visible to anyone who can view the record (default-open)
#   - no `edit_roles`  ⇒ editable by anyone who can edit the record (default-open)
# `is_admin` (a config.manage holder) bypasses both gates so Studio/super-admins are never locked
# out of a field they must manage — keep this consistent across meta + records enforcement.

def can_view_field(config: dict | None, caller_roles: set[str], is_admin: bool = False) -> bool:
    if is_admin:
        return True
    roles = (config or {}).get("view_roles")
    if not roles:
        return True
    return bool(caller_roles & set(roles))


def can_edit_field(config: dict | None, caller_roles: set[str], is_admin: bool = False) -> bool:
    if is_admin:
        return True
    roles = (config or {}).get("edit_roles")
    if not roles:
        return True
    return bool(caller_roles & set(roles))
