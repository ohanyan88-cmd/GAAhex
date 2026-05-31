"""Role permission shim — non-destructively grant ``request.*`` perms to existing roles.

Historical note
---------------
This module used to ALSO insert 2–3 "Sample Name 1 / Sample Config 1 / starter record
created for demonstration purposes." rows into every empty entity in the catalog. Those
rows looked like placeholder mock data on real list pages and violated the doctrine of
"real data only — empty/skeleton when missing, never kit-style mock fallbacks."

That seeder is gone. Today the demo data path is:

  - ``seed_demo_loop_if_empty()`` — one realistic customer + ticket for the daily loop.
  - ``seed_dev_bulk_if_empty()`` (env-gated by ``GAAEX_DEV_SEED``) — 10 Armenian-ISP
    customers with the full cross-referenced tree (parties / accounts / contacts /
    subscriptions / invoices / payments / tickets / work-items / sites / devices /
    employees / orders).

Catalog entities the dev bulk seeder doesn't populate render the proper EmptyState
("No <entity> yet — create the first one to get started.") on first boot, which is
the doctrine-correct behavior.

What survives here is the perms-grant task — a separate idempotent migration-ish
step we still want to run at boot.

Run standalone::

    cd backend
    .venv/Scripts/python.exe -c "import asyncio; from app.seed_default_records import run; asyncio.run(run())"
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from .db import OwnerSessionLocal as SessionLocal
from .models import Tenant

_log = logging.getLogger("gaaex.seed_default_records")


async def grant_request_perms_to_existing_roles() -> None:
    """Non-destructively add ``request.*`` perms to existing ``manager`` and
    ``sales_agent`` RoleDef rows in every tenant. Idempotent — only adds missing
    entries; an unrelated role's permissions are left alone."""
    _request_perms = ["request.view", "request.create", "request.edit", "request.delete"]

    from .models import RoleDef

    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()

        for tenant in tenants:
            roles = list((await s.execute(
                select(RoleDef).where(
                    RoleDef.tenant_id == tenant.id,
                    RoleDef.key.in_(["manager", "sales_agent"]),
                )
            )).scalars().all())

            for role in roles:
                existing_perms: list = list(role.permissions or [])
                missing = [p for p in _request_perms if p not in existing_perms]
                if missing:
                    role.permissions = existing_perms + missing
                    _log.info(
                        "Added %s to role '%s' in tenant %s",
                        missing, role.key, tenant.id,
                    )

        await s.commit()


async def run() -> None:
    """Single entry-point for standalone execution and lifespan wiring."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
    await grant_request_perms_to_existing_roles()


if __name__ == "__main__":
    import asyncio
    asyncio.run(run())
