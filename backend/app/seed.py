from sqlalchemy import select, func
from sqlalchemy_utils import Ltree

from .db import SessionLocal
from .models import Tenant, OrgNode, User, EntityDef, FieldDef, StatusDef
from .security import hash_password


async def seed_if_empty() -> None:
    """Seed a demo tenant + a 2-level org tree + a demo admin user, only if the DB is empty."""
    async with SessionLocal() as s:
        if (await s.execute(select(func.count()).select_from(Tenant))).scalar_one():
            return

        tenant = Tenant(name="Demo ISP")
        s.add(tenant)
        await s.flush()

        group = OrgNode(tenant_id=tenant.id, type="Group", name="Demo ISP Group", code="grp", path=Ltree("grp"))
        s.add(group)
        await s.flush()

        region = OrgNode(tenant_id=tenant.id, parent_id=group.id, type="Region", name="Yerevan", code="yerevan", path=Ltree("grp.yerevan"))
        s.add(region)
        await s.flush()

        team = OrgNode(tenant_id=tenant.id, parent_id=region.id, type="Team", name="Sales Team 1", code="sales1", path=Ltree("grp.yerevan.sales1"))
        s.add(team)
        await s.flush()

        admin = User(
            tenant_id=tenant.id, primary_node_id=group.id,
            email="admin@demo.isp", name="Demo Admin", password_hash=hash_password("admin123"),
        )
        s.add(admin)
        await s.commit()


async def seed_meta_if_empty() -> None:
    """Seed the 'Lead' entity AS CONFIG (no hardcoded model) — proves the metadata engine."""
    async with SessionLocal() as s:
        if (await s.execute(select(func.count()).select_from(EntityDef))).scalar_one():
            return
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return

        lead = EntityDef(
            tenant_id=tenant.id, key="lead", label="Lead", label_plural="Leads",
            route_slug="leads", icon="users",
        )
        s.add(lead)
        await s.flush()

        s.add_all([
            FieldDef(tenant_id=tenant.id, entity_def_id=lead.id, key="name", label="Name", type="text", required=True, order=1),
            FieldDef(tenant_id=tenant.id, entity_def_id=lead.id, key="phone", label="Phone", type="phone", required=False, order=2),
            FieldDef(tenant_id=tenant.id, entity_def_id=lead.id, key="status", label="Status", type="status", required=False, order=3),
        ])
        s.add_all([
            StatusDef(tenant_id=tenant.id, entity_def_id=lead.id, key="NEW", label="New", order=1, is_initial=True),
            StatusDef(tenant_id=tenant.id, entity_def_id=lead.id, key="CONTACTED", label="Contacted", order=2),
            StatusDef(tenant_id=tenant.id, entity_def_id=lead.id, key="QUALIFIED", label="Qualified", order=3),
        ])
        await s.commit()
