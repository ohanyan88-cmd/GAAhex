"""SPEC §0.6 canonical region seeder — minimal one-region-per-tenant starter.

Seeds a single demo `region` row per tenant matching the existing dev_bulk demo data
context (Yerevan ISP). Idempotent — per-tenant existence check before any insert, plus
`pg_insert(...).on_conflict_do_nothing()` keyed on the `uq_region_code` unique
constraint as a second-line guard against races.

Why minimal: this round only establishes the canonical home for region_id (SPEC §0.6).
FK wiring from existing operational-table region_id columns and the multi-region demo
expansion (Gyumri, Vanadzor, …) are deferred to follow-up steps. See
`docs/kernel-build/SPEC-0-6-REGIONS.md` for the full deferred-list.

Call site: `backend/app/main.py` lifespan, AFTER `seed_if_empty()` (tenant must exist
first) and BEFORE the SPEC-driven seeders (pipeline / status / records / ownership /
role boundaries) — so any future SPEC seeder that wants to reference a default region
finds one already present.
"""
from __future__ import annotations

import logging

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import Tenant, Region


_log = logging.getLogger("gaahex.seed_regions")


# The single starter row inserted per tenant on a fresh boot. Matches the demo Yerevan
# ISP context already established by `seed_if_empty()` (which seeds a `Region` org_node
# named "Yerevan" — this is the canonical-table mirror of that, not a duplicate).
_DEFAULT_REGION = {
    "code": "YER",
    "name": "Yerevan",
    "region_type": "region",
    "status": "active",
    "timezone": "Asia/Yerevan",
    "locale": "hy-AM",
}


async def seed_demo_regions_if_empty() -> int:
    """Seed a minimal demo region per tenant if none exist.

    For each tenant: if 0 region rows exist for that tenant, INSERT one default
    Yerevan row (`{code:'YER', name:'Yerevan', region_type:'region', ...}`).

    Idempotent — checks per tenant for any existing region rows before insert and uses
    `on_conflict_do_nothing` on `uq_region_code` as a belt-and-braces guard.

    Returns:
        int — total count of rows inserted this run (0 on a fully-seeded re-run).
    """
    inserted = 0
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_regions: no tenants — nothing to seed")
            return 0

        for t in tenants:
            existing = (await s.execute(
                select(func.count()).select_from(Region).where(Region.tenant_id == t.id)
            )).scalar_one()
            if existing:
                continue
            stmt = (
                pg_insert(Region.__table__)
                .values(tenant_id=t.id, **_DEFAULT_REGION)
                .on_conflict_do_nothing(index_elements=["tenant_id", "code"])
            )
            res = await s.execute(stmt)
            if res.rowcount:
                inserted += res.rowcount

        await s.commit()

    _log.info(
        "seed_regions: %d region row(s) inserted across %d tenant(s)",
        inserted, len(tenants),
    )
    return inserted


if __name__ == "__main__":
    import asyncio
    print("regions seeded:", asyncio.run(seed_demo_regions_if_empty()))
