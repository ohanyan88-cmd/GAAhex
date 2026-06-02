"""SPEC §1 Left-Navigation registry — read-only API (PREPARE, NOT YET MOUNTED).

GET `/api/nav` returns the tenant's nav tree as
`[{group_key, group_name, group_order, modules: [{...}]}, ...]` so the UI can render
the side-nav from data instead of hardcoding it (zero-bespoke directive).

PREPARE-only — Gev gates activation. The `app.include_router(nav_registry.router)`
line in `app/main.py` is intentionally commented out with a TODO until Gev replies
'approved §1 nav'. Importing this module is safe (no side-effects).

Tenant isolation:
  - `current_user` binds `gaahex.tenant_id` GUC on the session.
  - Both `nav_group` and `nav_module` carry the `tenant_isolation` RLS policy
    (`USING tenant_id = NULLIF(current_setting('gaahex.tenant_id'), '')::uuid`), so
    the queries below are inherently scoped to the caller's tenant.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.nav_module import NavGroup, NavModule
from .auth import current_user


router = APIRouter(prefix="/api/nav", tags=["nav"])


@router.get("")
async def get_nav(
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
) -> list[dict]:
    """Return the nav tree for the caller's tenant.

    Shape:
        [
          {
            "group_key": "workspace",
            "group_name": "Workspace",
            "group_order": 1,
            "icon": null,
            "modules": [
              {
                "key": "home", "name": "Home", "order": 1, "icon": null,
                "placement": "V", "owner_record_keys": null,
                "route": "/home", "status": "active"
              },
              ...
            ]
          },
          ...
        ]

    Sorted by group `order` then module `order`. Inactive rows (status != 'active')
    are excluded — the UI sees only what should be rendered.
    """
    groups = (await s.execute(
        select(NavGroup)
        .where(NavGroup.tenant_id == user.tenant_id, NavGroup.status == "active")
        .order_by(NavGroup.order_)
    )).scalars().all()

    modules = (await s.execute(
        select(NavModule)
        .where(NavModule.tenant_id == user.tenant_id, NavModule.status == "active")
        .order_by(NavModule.group_id, NavModule.order_)
    )).scalars().all()

    by_group: dict = {}
    for m in modules:
        by_group.setdefault(m.group_id, []).append({
            "key": m.key,
            "name": m.name,
            "order": m.order_,
            "icon": m.icon,
            "placement": m.placement,
            "owner_module": m.owner_module,
            "owner_record_keys": m.owner_record_keys,
            "route": m.route,
            "status": m.status,
        })

    return [
        {
            "group_key": g.key,
            "group_name": g.name,
            "group_order": g.order_,
            "icon": g.icon,
            "modules": by_group.get(g.id, []),
        }
        for g in groups
    ]
