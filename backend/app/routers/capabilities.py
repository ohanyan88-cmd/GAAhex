"""GET /api/me/capabilities — effective-rights snapshot for the current user.

Returns a stable, read-only view of what the authenticated user may do so the
frontend can gate UI without trial-and-error 403s.  This endpoint COMPUTES from
the existing role/permission data; it does NOT change enforcement.  Backend 403s
remain the source of truth.

Register this router in main.py BEFORE records.router (the generic /api/{slug}
catch-all) so the fixed path /api/me/capabilities is not swallowed as a slug.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import EntityDef, User
from ..access import load_grants, can, role_keys
from .auth import current_user

router = APIRouter(prefix="/api/me", tags=["capabilities"])

_VERBS = ("view", "create", "edit", "delete")


@router.get("/capabilities")
async def get_capabilities(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return the caller's effective capabilities.

    Shape:
    {
      "role": ["sales_agent", ...],          # all role keys held
      "can_configure": false,                 # mirrors auth.me
      "entities": {
        "<entity_key>": {
          "view":    true|false,
          "create":  true|false,
          "edit":    true|false,
          "delete":  true|false,
          "read_only": true|false             # view=true AND create+edit+delete all false
        },
        ...
      }
    }

    `read_only` at the top level is true when the user can view at least one
    entity but holds no create/edit/delete anywhere — useful for disabling all
    write affordances globally.

    Field-level access (FieldDef.config.view_roles / edit_roles) is intentionally
    omitted here; it is already surfaced per-field in GET /meta/entities/{slug}.
    """
    grants = await load_grants(s, user)
    admin: bool = can(grants, "config", "manage")
    roles: list[str] = sorted(role_keys(grants))

    # Pull every active entity definition for this tenant.
    ents = (await s.execute(
        select(EntityDef)
        .where(EntityDef.tenant_id == user.tenant_id, EntityDef.status != "retired")
        .order_by(EntityDef.order, EntityDef.key)
    )).scalars().all()

    entities: dict = {}
    any_write = False   # tracks whether the user has ANY write perm across all entities

    for ent in ents:
        perms = {verb: can(grants, ent.key, verb) for verb in _VERBS}
        has_write = perms["create"] or perms["edit"] or perms["delete"]
        if has_write:
            any_write = True
        entities[ent.key] = {
            **perms,
            # read_only per entity: can view but nothing writable on this specific entity
            "read_only": perms["view"] and not has_write,
        }

    # Top-level read_only: user can view something but has NO write perm anywhere.
    # Useful for global "viewer mode" UI hint.
    can_view_any = any(v["view"] for v in entities.values()) if entities else False
    read_only_global = can_view_any and not any_write

    return {
        "role": roles,
        "can_configure": admin,
        "read_only": read_only_global,
        "entities": entities,
    }
