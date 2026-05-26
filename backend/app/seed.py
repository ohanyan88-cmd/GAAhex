from sqlalchemy import select, func
from sqlalchemy_utils import Ltree

from .db import SessionLocal
from .models import Tenant, OrgNode


async def seed_if_empty() -> None:
    """Seed a demo tenant + a 2-level org tree, only if the DB is empty."""
    async with SessionLocal() as s:
        existing = (await s.execute(select(func.count()).select_from(Tenant))).scalar_one()
        if existing:
            return

        tenant = Tenant(name="Demo ISP")
        s.add(tenant)
        await s.flush()

        group = OrgNode(
            tenant_id=tenant.id, type="Group", name="Demo ISP Group",
            code="grp", path=Ltree("grp"),
        )
        s.add(group)
        await s.flush()

        region = OrgNode(
            tenant_id=tenant.id, parent_id=group.id, type="Region", name="Yerevan",
            code="yerevan", path=Ltree("grp.yerevan"),
        )
        s.add(region)
        await s.flush()

        team = OrgNode(
            tenant_id=tenant.id, parent_id=region.id, type="Team", name="Sales Team 1",
            code="sales1", path=Ltree("grp.yerevan.sales1"),
        )
        s.add(team)
        await s.commit()
