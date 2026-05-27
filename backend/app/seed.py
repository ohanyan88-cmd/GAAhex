from sqlalchemy import select, func
from sqlalchemy_utils import Ltree

from .db import OwnerSessionLocal as SessionLocal   # seeding runs privileged (bypasses RLS)
from .models import (
    Tenant, OrgNode, User, EntityDef, FieldDef, StatusDef, WorkflowDef,
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


async def _make_entity(s, tenant_id, key, label, plural, slug, icon, fields, statuses=None, transitions=None):
    """Create one config-driven entity: EntityDef + FieldDefs + StatusDefs + (optional) WorkflowDef.
    fields:       [(key, label, type, required, config)]
    statuses:     [(key, label, is_initial)]
    transitions:  [{"from","to","guard"}]
    """
    ent = EntityDef(tenant_id=tenant_id, key=key, label=label, label_plural=plural, route_slug=slug, icon=icon)
    s.add(ent)
    await s.flush()
    for i, (fk, fl, ft, req, cfg) in enumerate(fields, start=1):
        s.add(FieldDef(tenant_id=tenant_id, entity_def_id=ent.id, key=fk, label=fl, type=ft, required=req, order=i, config=cfg))
    for i, (sk, sl, init) in enumerate(statuses or [], start=1):
        s.add(StatusDef(tenant_id=tenant_id, entity_def_id=ent.id, key=sk, label=sl, order=i, is_initial=init))
    if transitions:
        s.add(WorkflowDef(tenant_id=tenant_id, entity_def_id=ent.id, key=f"{key}_lifecycle",
                          label=f"{label} Lifecycle", config={"transitions": transitions}))
    return ent


async def build_crm_entities(s, t) -> None:
    """Build the baseline CRM module (Lead, Customer, Contact, Deal, Ticket) for tenant `t` AS CONFIG.
    Reusable by the demo seed AND by tenant provisioning — no emptiness guard here (callers guard)."""
    # ---- CRM: Lead ----
    await _make_entity(
        s, t, "lead", "Lead", "Leads", "leads", "users",
        fields=[
            ("name", "Name", "text", True, None),
            ("phone", "Phone", "phone", False, None),
            ("email", "Email", "email", False, None),
            ("source", "Source", "select", False, {"options": ["Website", "Referral", "Cold Call", "Ad"]}),
            ("status", "Status", "status", False, None),
        ],
        statuses=[("NEW", "New", True), ("CONTACTED", "Contacted", False), ("QUALIFIED", "Qualified", False),
                  ("CONVERTED", "Converted", False), ("LOST", "Lost", False)],
        transitions=[
            {"from": "NEW", "to": "CONTACTED", "guard": "phone != None and phone != ''"},
            {"from": "CONTACTED", "to": "QUALIFIED", "guard": None},
            {"from": "QUALIFIED", "to": "CONVERTED", "guard": None},
            {"from": "CONTACTED", "to": "LOST", "guard": None},
            {"from": "QUALIFIED", "to": "LOST", "guard": None},
        ],
    )

    # ---- CRM: Customer ----
    await _make_entity(
        s, t, "customer", "Customer", "Customers", "customers", "building",
        fields=[
            ("name", "Name", "text", True, None),
            ("email", "Email", "email", False, None),
            ("phone", "Phone", "phone", False, None),
            ("plan", "Plan", "select", False, {"options": ["Basic", "Pro", "Enterprise"]}),
            ("status", "Status", "status", False, None),
        ],
        statuses=[("PROSPECT", "Prospect", True), ("ACTIVE", "Active", False),
                  ("SUSPENDED", "Suspended", False), ("CHURNED", "Churned", False)],
        transitions=[
            {"from": "PROSPECT", "to": "ACTIVE", "guard": "email != None and email != ''"},
            {"from": "ACTIVE", "to": "SUSPENDED", "guard": None},
            {"from": "SUSPENDED", "to": "ACTIVE", "guard": None},
            {"from": "ACTIVE", "to": "CHURNED", "guard": None},
            {"from": "SUSPENDED", "to": "CHURNED", "guard": None},
        ],
    )

    # ---- CRM: Contact (linked to a customer) ----
    await _make_entity(
        s, t, "contact", "Contact", "Contacts", "contacts", "user",
        fields=[
            ("name", "Name", "text", True, None),
            ("email", "Email", "email", False, None),
            ("phone", "Phone", "phone", False, None),
            ("title", "Title", "text", False, None),
            ("customer", "Customer", "ref", False, {"target": "customer"}),
        ],
    )

    # ---- CRM: Deal ----
    await _make_entity(
        s, t, "deal", "Deal", "Deals", "deals", "pipeline",
        fields=[
            ("title", "Title", "text", True, None),
            ("value", "Value", "money", False, None),
            ("customer", "Customer", "ref", False, {"target": "customer"}),
            ("status", "Status", "status", False, None),
        ],
        statuses=[("OPEN", "Open", True), ("WON", "Won", False), ("LOST", "Lost", False)],
        transitions=[
            {"from": "OPEN", "to": "WON", "guard": None},
            {"from": "OPEN", "to": "LOST", "guard": None},
        ],
    )

    # ---- Support: Ticket ----
    await _make_entity(
        s, t, "ticket", "Ticket", "Tickets", "tickets", "ticket",
        fields=[
            ("subject", "Subject", "text", True, None),
            ("priority", "Priority", "select", False, {"options": ["Low", "Normal", "High", "Urgent"]}),
            ("status", "Status", "status", False, None),
        ],
        statuses=[("OPEN", "Open", True), ("IN_PROGRESS", "In Progress", False), ("RESOLVED", "Resolved", False)],
    )


async def seed_meta_if_empty() -> None:
    """Seed the CRM module (Lead, Customer, Contact, Deal) + Ticket — all AS CONFIG (demo tenant)."""
    async with SessionLocal() as s:
        if (await s.execute(select(func.count()).select_from(EntityDef))).scalar_one():
            return
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return
        await build_crm_entities(s, tenant.id)
        await s.commit()


async def build_access_config(s, tenant_id) -> dict:
    """Build the baseline permission catalog + the three roles (super_admin, manager, sales_agent)
    for tenant `tenant_id`. Reusable by the demo seed AND by provisioning. Flushes (so role ids are
    available) but does NOT commit. Returns the three RoleDefs by key."""
    crm = ["lead", "customer", "contact", "deal", "ticket"]
    for ekey in crm:
        for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
            s.add(PermissionDef(tenant_id=tenant_id, key=f"{ekey}.{verb}", label=f"{vl} {ekey}", group=ekey))

    # B31 Helpdesk: real-model permissions (helpdesk_ticket CRUD + helpdesk_queue view/manage).
    for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
        s.add(PermissionDef(tenant_id=tenant_id, key=f"helpdesk_ticket.{verb}", label=f"{vl} helpdesk ticket", group="helpdesk"))
    for verb, vl in (("view", "View"), ("manage", "Manage")):
        s.add(PermissionDef(tenant_id=tenant_id, key=f"helpdesk_queue.{verb}", label=f"{vl} helpdesk queue", group="helpdesk"))

    # B32 WorkItems: real-model permissions (assign-work-to-a-person loop + field dispatch).
    for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
        s.add(PermissionDef(tenant_id=tenant_id, key=f"workitem.{verb}", label=f"{vl} work item", group="workitem"))

    # B33 Payment gateway: online payment orders (view = see/reconcile, collect = initiate/confirm).
    for verb, vl in (("view", "View"), ("collect", "Collect")):
        s.add(PermissionDef(tenant_id=tenant_id, key=f"payment_order.{verb}", label=f"{vl} payment order", group="payments"))

    def perms(entities, verbs):
        return [f"{e}.{v}" for e in entities for v in verbs]

    _helpdesk_full = ["helpdesk_ticket.view", "helpdesk_ticket.create", "helpdesk_ticket.edit",
                      "helpdesk_ticket.delete", "helpdesk_queue.view", "helpdesk_queue.manage"]
    _workitem_full = ["workitem.view", "workitem.create", "workitem.edit", "workitem.delete"]
    _payment_order_perms = ["payment_order.view", "payment_order.collect"]
    super_admin = RoleDef(tenant_id=tenant_id, key="super_admin", label="Super Admin", permissions=["*"], scope="tenant")
    manager = RoleDef(tenant_id=tenant_id, key="manager", label="Manager", scope="subtree",
                      permissions=perms(crm, ["view", "create", "edit", "delete"]) + _helpdesk_full + _workitem_full + _payment_order_perms)
    sales_agent = RoleDef(tenant_id=tenant_id, key="sales_agent", label="Sales Agent", scope="node",
                          permissions=perms(["lead", "contact", "deal"], ["view", "create", "edit"]) + ["customer.view"]
                          + ["helpdesk_ticket.view", "helpdesk_ticket.create", "helpdesk_ticket.edit"]
                          + ["workitem.view", "workitem.create", "workitem.edit"]
                          + _payment_order_perms)
    s.add_all([super_admin, manager, sales_agent])
    await s.flush()
    return {"super_admin": super_admin, "manager": manager, "sales_agent": sales_agent}


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

        roles = await build_access_config(s, tenant.id)
        super_admin, sales_agent = roles["super_admin"], roles["sales_agent"]

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
