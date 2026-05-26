from sqlalchemy import select, func
from sqlalchemy_utils import Ltree

from .db import SessionLocal
from .models import (
    Tenant, OrgNode, User, EntityDef, FieldDef, StatusDef,
    PermissionDef, RoleDef, Assignment,
)
from .security import hash_password


async def seed_if_empty() -> None:
    """Demo tenant + 2-level org tree + demo admin user."""
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
    """The 'Lead' entity AS CONFIG (no hardcoded model)."""
    async with SessionLocal() as s:
        if (await s.execute(select(func.count()).select_from(EntityDef))).scalar_one():
            return
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return

        lead = EntityDef(tenant_id=tenant.id, key="lead", label="Lead", label_plural="Leads", route_slug="leads", icon="users")
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

        # second entity, also AS CONFIG — proves the engine generalizes (and gives M3 a second
        # entity to scope permissions against)
        ticket = EntityDef(tenant_id=tenant.id, key="ticket", label="Ticket", label_plural="Tickets", route_slug="tickets", icon="ticket")
        s.add(ticket)
        await s.flush()
        s.add_all([
            FieldDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="subject", label="Subject", type="text", required=True, order=1),
            FieldDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="priority", label="Priority", type="select", required=False, order=2,
                     config={"options": ["Low", "Normal", "High", "Urgent"]}),
            FieldDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="status", label="Status", type="status", required=False, order=3),
        ])
        s.add_all([
            StatusDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="OPEN", label="Open", order=1, is_initial=True),
            StatusDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="IN_PROGRESS", label="In Progress", order=2),
            StatusDef(tenant_id=tenant.id, entity_def_id=ticket.id, key="RESOLVED", label="Resolved", order=3),
        ])
        await s.commit()


async def seed_access_if_empty() -> None:
    """Permissions + roles + assignments AS CONFIG, plus a 2nd user (Agent) to prove scoping."""
    async with SessionLocal() as s:
        if (await s.execute(select(func.count()).select_from(RoleDef))).scalar_one():
            return
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return
        nodes = {n.code: n for n in (await s.execute(select(OrgNode).where(OrgNode.tenant_id == tenant.id))).scalars().all()}
        group, team = nodes.get("grp"), nodes.get("sales1")

        # permission catalog
        for ekey in ("lead", "ticket"):
            for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
                s.add(PermissionDef(tenant_id=tenant.id, key=f"{ekey}.{verb}", label=f"{vl} {ekey}", group=ekey))

        super_admin = RoleDef(tenant_id=tenant.id, key="super_admin", label="Super Admin", permissions=["*"], scope="tenant")
        manager = RoleDef(tenant_id=tenant.id, key="manager", label="Manager", scope="subtree",
                          permissions=["lead.view", "lead.create", "lead.edit", "lead.delete",
                                       "ticket.view", "ticket.create", "ticket.edit", "ticket.delete"])
        sales_agent = RoleDef(tenant_id=tenant.id, key="sales_agent", label="Sales Agent", scope="node",
                              permissions=["lead.view", "lead.create", "lead.edit"])
        s.add_all([super_admin, manager, sales_agent])
        await s.flush()

        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one_or_none()
        if admin and group:
            s.add(Assignment(tenant_id=tenant.id, user_id=admin.id, role_id=super_admin.id, node_id=group.id))

        agent_user = User(
            tenant_id=tenant.id, primary_node_id=team.id if team else None,
            email="agent@demo.isp", name="Demo Agent", password_hash=hash_password("agent123"),
        )
        s.add(agent_user)
        await s.flush()
        if team:
            s.add(Assignment(tenant_id=tenant.id, user_id=agent_user.id, role_id=sales_agent.id, node_id=team.id))
        await s.commit()
