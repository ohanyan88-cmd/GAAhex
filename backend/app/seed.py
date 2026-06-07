import os
import uuid

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy_utils import Ltree

from .config import _set_the_tenant_id
from .db import OwnerSessionLocal as SessionLocal   # seeding runs privileged (bypasses RLS)
from .models import (
    Tenant, OrgNode, User, EntityDef, FieldDef, StatusDef, WorkflowDef,
    PermissionDef, RoleDef, Assignment, Record, FeatureFlag,
)
from .models.customer_user import CustomerUser
from .security import hash_password
from .geo_armenia import (
    ARMAVIR_REGION as _GEO_REGION,
    ARMAVIR_CITIES as _GEO_CITIES,
    ARMAVIR_VILLAGES as _GEO_VILLAGES,
    dicts as _dicts,
)


# Canonical tenant-controlled business feature flags (Q5 / FEATURE_GATING_POLICY.md system #2).
# Each tenant gets one row per key, default OFF — the tenant opts in via PATCH
# /api/feature-flags. New M1 business flags get appended here; deploy-shape keys
# (radius / olt_provisioning / import_engine / warehouse) stay env-var-only and
# MUST NOT be added here (policy §5.2, anti-pattern §6).
_CANONICAL_BUSINESS_FLAGS: tuple[tuple[str, str], ...] = (
    ("dunning_automation", "Dunning Automation"),
)


# CRM entity keys that participate in the standard view/create/edit/delete permission matrix.
_CRM_ENTITIES = ["lead", "customer", "contact", "deal", "ticket"]


def _permission_specs(tenant_id) -> list[dict]:
    """Single source of truth for every PermissionDef row the demo tenant needs.

    Every entry the bulk insert in build_access_config / _refresh_permission_catalog writes
    lives here — adding a new perm means adding a row here and nothing else.
    """
    specs: list[dict] = []

    # CRM × 4 verbs (view/create/edit/delete) — drives the entity-record router gates.
    for ekey in _CRM_ENTITIES:
        for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
            specs.append({"tenant_id": tenant_id, "key": f"{ekey}.{verb}", "label": f"{vl} {ekey}", "group": ekey})

    # B31 Helpdesk: real-model permissions (helpdesk_ticket CRUD + helpdesk_queue view/manage).
    for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
        specs.append({"tenant_id": tenant_id, "key": f"helpdesk_ticket.{verb}", "label": f"{vl} helpdesk ticket", "group": "helpdesk"})
    for verb, vl in (("view", "View"), ("manage", "Manage")):
        specs.append({"tenant_id": tenant_id, "key": f"helpdesk_queue.{verb}", "label": f"{vl} helpdesk queue", "group": "helpdesk"})

    # B32 WorkItems: real-model permissions (assign-work-to-a-person loop + field dispatch).
    for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
        specs.append({"tenant_id": tenant_id, "key": f"workitem.{verb}", "label": f"{vl} work item", "group": "workitem"})

    # B33 Payment gateway: online payment orders (view = see/reconcile, collect = initiate/confirm).
    for verb, vl in (("view", "View"), ("collect", "Collect")):
        specs.append({"tenant_id": tenant_id, "key": f"payment_order.{verb}", "label": f"{vl} payment order", "group": "payments"})

    # Self-service "My Requests" catalog — every user (all roles) can CRUD their own requests.
    for verb, vl in (("view", "View"), ("create", "Create"), ("edit", "Edit"), ("delete", "Delete")):
        specs.append({"tenant_id": tenant_id, "key": f"request.{verb}", "label": f"{vl} request", "group": "request"})

    # Governance audit log — SuperAdmin-tier read perm gating /api/audit-log.
    # NOT bundled into manager/sales_agent: super_admin's "*" already covers it.
    specs.append({"tenant_id": tenant_id, "key": "audit.view", "label": "View audit log", "group": "governance"})

    # Comment Standard (file 04) — 6 keys from the locked Permission Registry (file 15).
    # Cross-cutting, not bundled into any default role: admin/Studio handles per-tenant grants.
    # view_internal also gates SYSTEM-typed comments (file 04: SYSTEM is internal-visibility).
    for verb, vl in (
        ("create",         "Create comment"),
        ("edit",           "Edit comment"),
        ("delete",         "Delete comment"),
        ("view_internal",  "View internal comments (incl. SYSTEM)"),
        ("view_external",  "View external comments"),
        ("view_private",   "View private comments"),
        # Operational moderation: soft-delete + resolve/reopen ANY user's comment within scope.
        # Does NOT permit editing other-user content (deletes, doesn't ghost-edit). Does NOT bypass
        # `hold` (hold beats every role incl. moderate and configuration.manage; file 04).
        ("moderate",       "Moderate comments (soft-delete + resolve/reopen any user's comment)"),
    ):
        specs.append({"tenant_id": tenant_id, "key": f"comment.{verb}", "label": vl, "group": "comment"})

    # Watcher / Subscriber Standard (file 05) — 6 keys from the locked Permission Registry (file 15).
    # Cross-cutting, not bundled into any default role. Watching never grants permission and never
    # counts toward KPI / SLA / workload (file 05 principle). manage_others = supervisor/admin scope.
    for verb, vl in (
        ("view",          "View watchers on an object"),
        ("add",           "Add a watcher to an object"),
        ("remove",        "Remove a watcher from an object"),
        ("pause",         "Pause watcher notifications"),
        ("resume",        "Resume paused watcher notifications"),
        ("manage_others", "Manage other users' watchers (supervisor scope)"),
    ):
        specs.append({"tenant_id": tenant_id, "key": f"watch.{verb}", "label": vl, "group": "watch"})

    # Task Standard (file 05) — 10 keys from the locked Permission Registry (file 15).
    # Cross-cutting; admin/Studio handles per-tenant role grants.
    # task.comment / task.attach are sub-permissions that gate the Comment + Attachment
    # sub-resources on a task (separate from the top-level comment.* and attachment.* keys).
    for verb, vl in (
        ("view",     "View tasks"),
        ("create",   "Create tasks"),
        ("edit",     "Edit task fields"),
        ("assign",   "Assign / reassign task owner and assignee"),
        ("complete", "Complete a task (requires resolution)"),
        ("cancel",   "Cancel a task (requires reason + resolution)"),
        ("reopen",   "Reopen a completed or cancelled task"),
        ("delete",   "Delete a task (soft)"),
        ("comment",  "Add comments to a task"),
        ("attach",   "Upload attachments to a task"),
    ):
        specs.append({"tenant_id": tenant_id, "key": f"task.{verb}", "label": vl, "group": "task"})

    # SLA Standard (file 12) — 1 key from the locked Permission Registry (file 15).
    # Single cross-cutting permission for full SLA management (create / read / pause / resume /
    # mark complete / cancel). Watching never affects SLA (file 12 principle).
    specs.append({"tenant_id": tenant_id, "key": "sla.manage", "label": "Manage SLAs", "group": "sla"})

    # Attachment Standard (file 04) — 6 keys from the locked Permission Registry (file 15).
    # Sensitive categories (IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, CONTRACT)
    # require stricter grants; downloads of sensitive attachments are audited.
    for verb, vl in (
        ("view",         "View attachments"),
        ("download",     "Download attachment files"),
        ("upload",       "Upload attachments"),
        ("delete",       "Delete attachments (soft)"),
        ("reference",    "Reference an attachment from another object"),
        ("view_deleted", "View deleted attachment metadata"),
    ):
        specs.append({"tenant_id": tenant_id, "key": f"attachment.{verb}", "label": vl, "group": "attachment"})

    # Notification Standard (file 05) — 4 keys from the locked Permission Registry (file 15).
    for verb, vl in (
        ("view",                "View notifications"),
        ("manage_preferences",  "Manage notification preferences"),
        ("acknowledge",         "Acknowledge notifications"),
        ("dismiss",             "Dismiss notifications"),
        ("manage",              "Manage notification system (run sweeps, admin inbox)"),
    ):
        specs.append({"tenant_id": tenant_id, "key": f"notification.{verb}", "label": vl, "group": "notification"})

    # Wave A — Communication Standard (file 12) — 2 keys.
    for verb, vl in (("view", "View communications"), ("send", "Send communications")):
        specs.append({"tenant_id": tenant_id, "key": f"communication.{verb}", "label": vl, "group": "communication"})

    # Wave A — Configuration Standard (file 08) — Super Admin scope.
    specs.append({"tenant_id": tenant_id, "key": "configuration.manage",
                  "label": "Manage system configuration (Super Admin scope)", "group": "configuration"})

    # Wave A — Escalation Standard (file 02) — single cross-cutting key.
    specs.append({"tenant_id": tenant_id, "key": "escalation.manage",
                  "label": "Manage escalations", "group": "escalation"})

    # Wave A — Relationship / Entity Link Standard (file 12) — 2 keys.
    specs.append({"tenant_id": tenant_id, "key": "relationship.create",
                  "label": "Create relationships between entities", "group": "relationship"})
    specs.append({"tenant_id": tenant_id, "key": "relationship.delete",
                  "label": "Archive relationships", "group": "relationship"})

    # Wave A — Import / Export Standard (file 08) — 2 keys.
    specs.append({"tenant_id": tenant_id, "key": "import.run", "label": "Run import jobs", "group": "import_export"})
    specs.append({"tenant_id": tenant_id, "key": "export.run", "label": "Run export jobs", "group": "import_export"})

    return specs


async def _refresh_permission_catalog(s, tenant_id) -> None:
    """Idempotent bulk insert of the canonical PermissionDef catalog for `tenant_id`.

    Skips rows that already exist via ON CONFLICT on uq_permission_def_key (tenant_id, key),
    so new perms automatically appear in existing tenants on next boot without drift.
    """
    await s.execute(
        pg_insert(PermissionDef)
        .values(_permission_specs(tenant_id))
        .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
    )
    await s.commit()


async def seed_if_empty() -> None:
    """Demo tenant + 2-level org tree + demo admin user.

    Single-tenant mode: if GAAHEX_TENANT_ID is set, the demo Tenant is created with that exact UUID
    so the env-pinned config matches the DB row. Idempotent: if any Tenant already exists, reuse
    its id (and warm the THE_TENANT_ID cache) without creating another.
    """
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit
        # listener so legitimate seed queries don't trip dev-mode warnings.
        await s.connection(execution_options={"audit_tenant_filter": False})
        existing = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
        if existing is not None:
            # Idempotent: pre-warm the cache so the rest of the app shares the same id.
            _set_the_tenant_id(existing.id)
            # Re-apply the full permission catalog so newly-added perms reach existing tenants.
            await _refresh_permission_catalog(s, existing.id)
            return

        pinned_id_str = os.environ.get("GAAHEX_TENANT_ID")
        tenant_kwargs = {"name": "Demo ISP"}
        if pinned_id_str:
            tenant_kwargs["id"] = uuid.UUID(pinned_id_str)
        tenant = Tenant(**tenant_kwargs)
        s.add(tenant)
        await s.flush()
        _set_the_tenant_id(tenant.id)

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
            department="Executive",   # SPEC §4.1 Department layer (M0 demo backfill)
        )
        s.add(admin)

        # Baseline parties — needed by the Accounts page holder-picker. Without these,
        # creating an Account from the UI is blocked (zero options in the dropdown).
        # dev_bulk also seeds parties, but that's opt-in via GAAHEX_DEV_SEED; these 3
        # are unconditional so the picker is never empty.
        from .models.party import Party
        for p_name, p_type in (
            ("Demo ISP Holdings", "organization"),
            ("Acme Corp", "organization"),
            ("Demo Admin (individual)", "individual"),
        ):
            s.add(Party(tenant_id=tenant.id, name=p_name, type=p_type))

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


# ── Lead field set (single source of truth — reused by build_crm_entities + the lead-field
# re-provision script). Each non-status field carries a `section` in its config so the form
# renders grouped. Deep Technical / Billing / detailed-Installation fields are deliberately
# deferred to the post-conversion Customer / Service records (Standard 11: lead → customer).
# Region / City / Village dropdown options — per-language {hy,en,ru} objects; the form
# shows only the current system language and allows a typed value if it isn't listed.
# Region is Armavir only for now; City + Village carry the Armavir marz (app/geo_armenia.py).
# Cascade (Village filtered by City) lands once the city→village grouping is supplied.
_REGION_OPTS = _dicts([_GEO_REGION])
_CITY_OPTS = _dicts(_GEO_CITIES)
_VILLAGE_OPTS = _dicts(_GEO_VILLAGES)
# Demo sales roster — the rep who owns the lead (top strip, beside Type & Source).
_SALES_REPS = [
    "Aram Petrosyan", "Lilit Hakobyan", "Davit Sargsyan", "Anush Grigoryan",
    "Tigran Avetisyan", "Mariam Karapetyan", "Narek Hovhannisyan", "Gohar Manukyan",
]
B2C = "Individual (B2C)"
B2B = "Business (B2B)"


def _sec(section: str, extra: dict | None = None) -> dict:
    return {"section": section, **(extra or {})}


# `segments` in a field's config gates which lead Type shows it — fields without it are common
# to both. The form filters by the chosen segment so B2C and B2B see different forms.
_LEAD_FIELDS = [
    # Personal — identity + contact merged into one section
    ("segment", "Type", "select", False, _sec("Personal", {"options": [B2C, B2B], "header": True})),
    ("name", "Name", "text", True, _sec("Personal")),
    ("surname", "Surname", "text", False, _sec("Personal")),
    ("patronymic", "Patronic Name", "text", False, _sec("Personal")),
    ("company_name", "Company Name", "text", False, _sec("Personal", {"segments": [B2B]})),
    ("tax_id", "Tax ID / Reg №", "text", False, _sec("Personal", {"segments": [B2B]})),
    ("phone", "Primary Phone", "phone", False, _sec("Personal")),
    ("secondary_phone", "Second Phone", "phone", False, _sec("Personal")),
    ("landline", "Landline Phone", "phone", False, _sec("Personal")),
    ("whatsapp", "WhatsApp", "text", False, _sec("Personal")),
    ("telegram", "Telegram", "text", False, _sec("Personal")),
    ("email", "Email", "email", False, _sec("Personal")),
    # ID document — kept at the bottom of the Personal section
    ("document_type", "Document Type", "select", False, _sec("Personal", {"options": ["ID", "Passport"], "segments": [B2C]})),
    ("document_number", "Document Number", "text", False, _sec("Personal", {"segments": [B2C]})),
    ("issued_by", "Issued By", "text", False, _sec("Personal", {"segments": [B2C]})),
    ("issue_date", "Issue Date", "date", False, _sec("Personal", {"segments": [B2C]})),
    ("date_of_birth", "Date of Birth", "date", False, _sec("Personal", {"segments": [B2C]})),
    ("registration_address", "Registration Address", "text", False, _sec("Personal")),
    # Service — interest first, then where it gets installed
    ("service_type", "Service Type", "select", False, _sec("Service", {"options": ["Internet", "TV", "VoIP", "Bundle"]})),
    ("package", "Package", "select", False, _sec("Service", {"options": ["50 Mbps", "100 Mbps", "300 Mbps"]})),
    ("contract_term", "Contract Term", "select", False, _sec("Service", {"options": ["Monthly", "12 Months", "24 Months"]})),
    ("region", "Region", "select", False, _sec("Service", {"i18n_options": _REGION_OPTS, "allow_custom": True})),
    ("city", "City", "select", False, _sec("Service", {"i18n_options": _CITY_OPTS, "allow_custom": True})),
    ("village", "Village", "select", False, _sec("Service", {"i18n_options": _VILLAGE_OPTS, "allow_custom": True})),
    ("address", "Address", "text", False, _sec("Service")),
    ("landmark", "Landmark", "text", False, _sec("Service")),
    # Top strip — Source + owning Sales Representative sit beside Type (all header fields)
    ("source", "Source", "select", False, _sec("Sales", {"options": ["D2D", "Facebook", "Website", "Referral", "Call Center", "Shop", "Corporate"], "header": True})),
    ("sales_representative", "Representative", "select", False, _sec("Sales", {"options": _SALES_REPS, "header": True})),
    # Notes & Attachments — one section, notes textarea beside the document dropzone
    ("notes", "General Notes", "textarea", False, _sec("Notes & Attachments")),
    # Documents — ID / passport / agreement / other (drag-drop or click to attach)
    ("attachments", "Documents", "file", False, _sec("Notes & Attachments")),
    # Lifecycle (no section — managed by workflow)
    ("status", "Status", "status", False, None),
]


async def build_crm_entities(s, t) -> None:
    """Build the baseline CRM module (Lead, Customer, Contact, Deal, Ticket) for tenant `t` AS CONFIG.
    Reusable by the demo seed AND by tenant provisioning — no emptiness guard here (callers guard)."""
    # ---- CRM: Lead ----
    await _make_entity(
        s, t, "lead", "Lead", "Leads", "leads", "users",
        fields=_LEAD_FIELDS,
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
        transitions=[
            {"from": "OPEN", "to": "IN_PROGRESS", "guard": None},
            {"from": "OPEN", "to": "RESOLVED", "guard": None},
            {"from": "IN_PROGRESS", "to": "RESOLVED", "guard": None},
            {"from": "IN_PROGRESS", "to": "OPEN", "guard": None},
            {"from": "RESOLVED", "to": "OPEN", "guard": None},
        ],
    )


async def seed_meta_if_empty() -> None:
    """Seed the CRM module (Lead, Customer, Contact, Deal) + Ticket — all AS CONFIG (demo tenant)."""
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
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
    # One bulk insert with ON CONFLICT DO NOTHING — safe on fresh tenants AND on tenants where a
    # subset of perms already exists from an older build. Catalog lives in _permission_specs.
    await s.execute(
        pg_insert(PermissionDef)
        .values(_permission_specs(tenant_id))
        .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
    )

    def perms(entities, verbs):
        return [f"{e}.{v}" for e in entities for v in verbs]

    _helpdesk_full = ["helpdesk_ticket.view", "helpdesk_ticket.create", "helpdesk_ticket.edit",
                      "helpdesk_ticket.delete", "helpdesk_queue.view", "helpdesk_queue.manage"]
    _workitem_full = ["workitem.view", "workitem.create", "workitem.edit", "workitem.delete"]
    _payment_order_perms = ["payment_order.view", "payment_order.collect"]
    _request_perms = ["request.view", "request.create", "request.edit", "request.delete"]
    super_admin = RoleDef(tenant_id=tenant_id, key="super_admin", label="Super Admin", permissions=["*"], scope="tenant")
    manager = RoleDef(tenant_id=tenant_id, key="manager", label="Manager", scope="subtree",
                      permissions=perms(_CRM_ENTITIES, ["view", "create", "edit", "delete"]) + _helpdesk_full + _workitem_full + _payment_order_perms + _request_perms)
    sales_agent = RoleDef(tenant_id=tenant_id, key="sales_agent", label="Sales Agent", scope="node",
                          permissions=perms(["lead", "contact", "deal"], ["view", "create", "edit"]) + ["customer.view"]
                          + ["helpdesk_ticket.view", "helpdesk_ticket.create", "helpdesk_ticket.edit"]
                          + ["workitem.view", "workitem.create", "workitem.edit"]
                          + _payment_order_perms + _request_perms)

    # SPEC §4.3 roles — positive-grant lists ("Can access" column). The matching `cannot` lists
    # are seeded into `role_def_deny` by `seed_role_boundaries_if_empty()` on the same boot, which
    # picks up these RoleDefs automatically once they exist. All scoped `subtree` by default — the
    # final scope per role is tuneable in Studio later.
    #
    # Wildcards: `entity.*` grants every verb on that entity (matches the kernel `_grants` reader).
    executive = RoleDef(
        tenant_id=tenant_id, key="executive", label="Executive", scope="tenant",
        # Read-mostly: dashboards, KPIs, reports, financial summaries.
        permissions=[
            "dashboard.view", "kpi.view", "report.view",
            "invoice.view", "payment.view", "billing_account.view",
            "customer.view", "order.view", "service.view",
        ] + _request_perms,
    )
    customer_care = RoleDef(
        tenant_id=tenant_id, key="customer_care", label="Customer Care", scope="subtree",
        # Customers, tickets, tasks, comms, KB, billing/payment/service status.
        permissions=[
            "customer.view", "customer.edit",
            "ticket.*", "helpdesk_ticket.*", "helpdesk_queue.view",
            "workitem.view", "workitem.create", "workitem.edit",
            "communication.view", "communication.create",
            "kb_article.view",
            "invoice.view", "payment.view", "service.view", "billing_account.view",
        ] + _request_perms,
    )
    billing_role = RoleDef(
        tenant_id=tenant_id, key="billing", label="Billing", scope="subtree",
        # Billing accounts, invoices, payments, collections, revenue assurance.
        permissions=[
            "billing_account.*", "invoice.*", "payment.*",
            "credit_note.*", "collection_case.*",
            "revenue_assurance.view",
            "customer.view",
        ] + _payment_order_perms + _request_perms,
    )
    revenue_control = RoleDef(
        tenant_id=tenant_id, key="revenue_control", label="Revenue Control", scope="tenant",
        # Orders, Order Validation, Revenue Assurance.
        permissions=[
            "order.*", "order_validation.*",
            "revenue_assurance.view",
            "customer.view", "invoice.view", "payment.view",
        ] + _request_perms,
    )
    network_noc = RoleDef(
        tenant_id=tenant_id, key="network_noc", label="Network / NOC", scope="tenant",
        # NOC, Monitoring, Alarms, Incidents, GIS, Topology, Provisioning, Service/Resource/Asset Inventory.
        permissions=[
            "alarm.*", "incident.*", "outage.*",
            "site.*", "olt.*", "router.*", "switch.*", "tower.*", "device.*", "vlan.*",
            "service.*", "asset.view", "stock_item.view",
            "workitem.view", "workitem.create", "workitem.edit",
        ] + _request_perms,
    )
    field_technician = RoleDef(
        tenant_id=tenant_id, key="field_technician", label="Field Technician", scope="node",
        # Assigned work orders, address/contact, equipment, checklist, photos, service status.
        permissions=[
            "workitem.view", "workitem.edit",
            "work_order.view", "work_order.edit",
            "customer.view",
            "communication.create",
            "asset.view", "device.view",
            "service.view",
        ] + _request_perms,
    )
    finance = RoleDef(
        tenant_id=tenant_id, key="finance", label="Finance", scope="tenant",
        # Finance, accounting, billing summaries, revenue reports, payments, collections.
        permissions=[
            "expense.*", "budget.*", "vendor_payment.*",
            "invoice.view", "payment.view", "billing_account.view",
            "credit_note.view", "collection_case.view",
            "report.view", "revenue_assurance.view",
        ] + _request_perms,
    )
    hr = RoleDef(
        tenant_id=tenant_id, key="hr", label="HR", scope="tenant",
        # Employees, recruitment, performance, attendance, leave, employee docs.
        permissions=[
            "employee.*", "department.*",
            "candidate.*", "performance_review.*", "training_course.*",
            "leave_request.*", "payroll_run.view",
        ] + _request_perms,
    )

    s.add_all([
        super_admin, manager, sales_agent,
        executive, customer_care, billing_role, revenue_control,
        network_noc, field_technician, finance, hr,
    ])
    await s.flush()
    return {
        "super_admin": super_admin, "manager": manager, "sales_agent": sales_agent,
        "executive": executive, "customer_care": customer_care, "billing": billing_role,
        "revenue_control": revenue_control, "network_noc": network_noc,
        "field_technician": field_technician, "finance": finance, "hr": hr,
    }


async def seed_access_if_empty() -> None:
    """Permissions + roles + assignments AS CONFIG, plus a 2nd user (Agent) to prove scoping."""
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
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
            department="Sales",   # SPEC §4.1 Department layer (M0 demo backfill)
        )
        s.add(agent_user)
        await s.flush()
        if team:
            s.add(Assignment(tenant_id=tenant.id, user_id=agent_user.id, role_id=sales_agent.id, node_id=team.id))
        await s.commit()


# SPEC §4.3 role specs — checked-by-key idempotency so existing deployments backfill the 8 roles
# missing from `build_access_config`'s original 3-role list. Kept as a (key, label, scope, perms)
# tuple list so `seed_spec_roles_if_missing()` doesn't depend on `build_access_config`'s flush
# side-effects.
_SPEC_ROLE_SPECS: list[tuple[str, str, str, list[str]]] = [
    ("executive", "Executive", "tenant", [
        "dashboard.view", "kpi.view", "report.view",
        "invoice.view", "payment.view", "billing_account.view",
        "customer.view", "order.view", "service.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("customer_care", "Customer Care", "subtree", [
        "customer.view", "customer.edit",
        "ticket.*", "helpdesk_ticket.*", "helpdesk_queue.view",
        "workitem.view", "workitem.create", "workitem.edit",
        "communication.view", "communication.create",
        "kb_article.view",
        "invoice.view", "payment.view", "service.view", "billing_account.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("billing", "Billing", "subtree", [
        "billing_account.*", "invoice.*", "payment.*",
        "credit_note.*", "collection_case.*",
        "revenue_assurance.view",
        "customer.view",
        "payment_order.view", "payment_order.collect",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("revenue_control", "Revenue Control", "tenant", [
        "order.*", "order_validation.*",
        "revenue_assurance.view",
        "customer.view", "invoice.view", "payment.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("network_noc", "Network / NOC", "tenant", [
        "alarm.*", "incident.*", "outage.*",
        "site.*", "olt.*", "router.*", "switch.*", "tower.*", "device.*", "vlan.*",
        "service.*", "asset.view", "stock_item.view",
        "workitem.view", "workitem.create", "workitem.edit",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("field_technician", "Field Technician", "node", [
        "workitem.view", "workitem.edit",
        "work_order.view", "work_order.edit",
        "customer.view",
        "communication.create",
        "asset.view", "device.view",
        "service.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("finance", "Finance", "tenant", [
        "expense.*", "budget.*", "vendor_payment.*",
        "invoice.view", "payment.view", "billing_account.view",
        "credit_note.view", "collection_case.view",
        "report.view", "revenue_assurance.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    ("hr", "HR", "tenant", [
        "employee.*", "department.*",
        "candidate.*", "performance_review.*", "training_course.*",
        "leave_request.*", "payroll_run.view",
        "request.view", "request.create", "request.edit", "request.delete",
    ]),
    # Workspace module role_def keys (see app/routers/workspace.py ROLE_DEF_TO_WORKSPACE). These
    # exist so admins can assign users to a role whose key matches the workspace layout — the
    # frontend's "My Work" page morphs accordingly. Empty permission set on purpose: admins assign
    # the right permission grants manually in Studio (the workspace module is layout-only, it does
    # NOT carry baseline rights). Idempotent: skipped if `(tenant_id, key)` already exists.
    ("sales_d2d",          "D2D Sales Agent",      "node",   []),
    ("sales_retail",       "Retail Shop Agent",    "node",   []),
    ("sales_b2b",          "B2B Account Manager",  "node",   []),
    ("billing_specialist", "Billing Specialist",   "tenant", []),
    ("executive",          "Executive",            "tenant", []),  # no-op if the SPEC §4.3 row above already exists
    ("noc_engineer",       "NOC Engineer",         "tenant", []),
]


async def seed_spec_roles_if_missing() -> int:
    """SPEC §4.3 — ensure the 8 SPEC roles exist for every tenant. Idempotent: checks per
    `(tenant_id, role.key)` and inserts only what's missing. `seed_role_boundaries_if_empty()`
    automatically picks up new role rows on the same boot and seeds their `cannot` lists.

    Returns the count of RoleDef rows inserted this run (across all tenants)."""
    inserted = 0
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            existing_keys = {
                k for (k,) in (await s.execute(
                    select(RoleDef.key).where(RoleDef.tenant_id == t.id)
                )).all()
            }
            for key, label, scope, permissions in _SPEC_ROLE_SPECS:
                if key in existing_keys:
                    continue
                s.add(RoleDef(
                    tenant_id=t.id, key=key, label=label,
                    permissions=permissions, scope=scope,
                ))
                inserted += 1
        if inserted:
            await s.commit()
    return inserted


async def backfill_demo_user_departments() -> int:
    """SPEC §4.1 Department layer — set `user.department` on the two demo users when NULL.

    Idempotent: only writes to rows where `department IS NULL`, so manual edits in Studio (or any
    later seed) are preserved. Migration `a7b3c9d5e1f2` added the column NULL-by-default; this
    helper backfills the M0 demo so the kernel runs in strict 4-layer mode for the demo session
    instead of the transitional role-only fallback.

    Returns the count of rows updated this run.
    """
    DEMO_DEPT_BY_EMAIL = {
        "admin@demo.isp": "Executive",
        "agent@demo.isp": "Sales",
    }
    updated = 0
    async with SessionLocal() as s:
        # Owner-session backfill is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        for email, dept in DEMO_DEPT_BY_EMAIL.items():
            user = (await s.execute(
                select(User).where(User.email == email)
            )).scalar_one_or_none()
            if user is None or user.department is not None:
                continue
            user.department = dept
            updated += 1
        if updated:
            await s.commit()
    return updated


async def seed_portal_if_empty() -> None:
    """Create one demo CustomerUser for the first customer Record (idempotent).

    Demo portal creds: portal@demo.isp / portal123
    Tenant is resolved dynamically at login (no hardcoded UUID here).
    """
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        if (await s.execute(select(func.count()).select_from(CustomerUser))).scalar_one():
            return
        tenant = (await s.execute(select(Tenant))).scalars().first()
        if not tenant:
            return
        # Find the first customer Record in this tenant
        customer_record = (await s.execute(
            select(Record).where(
                Record.tenant_id == tenant.id,
                Record.entity_key == "customer",
            )
        )).scalars().first()
        if not customer_record:
            return
        s.add(CustomerUser(
            tenant_id=tenant.id,
            customer_id=customer_record.id,
            email="portal@demo.isp",
            password_hash=hash_password("portal123"),
            name="Demo Customer GAAhex",
            is_active=True,
        ))
        await s.commit()


# ── SM-5 — bootstrap helpers callable from both lifespan (main.py) and conftest ──

async def seed_business_flags_if_empty() -> None:
    """Idempotently seed the canonical tenant-controlled business feature flags
    (Q5 / FEATURE_GATING_POLICY.md system #2).

    For every existing tenant, ensures a ``FeatureFlag`` row exists for every key
    in ``_CANONICAL_BUSINESS_FLAGS``. Default enabled=False — each tenant opts in
    by flipping via ``PATCH /api/feature-flags/<id>`` (audit-logged via
    ``workflow.emit``).

    Safe to call repeatedly: existing rows are not touched. New tenants pick up
    the canonical set the next time this seed runs.

    Constraint (policy §5.2 / anti-pattern §6): only **tenant business
    preferences** belong here. Deploy-shape gates (radius / olt_provisioning /
    import_engine / warehouse) stay env-var-only — adding them to this seed
    would violate the feature-gating policy.
    """
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the
        # tenant-filter audit listener.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            return
        for tenant in tenants:
            for key, label in _CANONICAL_BUSINESS_FLAGS:
                existing = (await s.execute(
                    select(FeatureFlag.id).where(  # noqa: tenant-filter — owner-session cross-tenant idempotent seed; per-tenant uniqueness enforced by unique constraint (tenant_id, key)
                        FeatureFlag.tenant_id == tenant.id,
                        FeatureFlag.key == key,
                    )
                )).scalar_one_or_none()
                if existing is not None:
                    continue
                s.add(FeatureFlag(
                    tenant_id=tenant.id,
                    key=key,
                    label=label,
                    enabled=False,
                ))
        await s.commit()


async def apply_test_seeds() -> None:
    """Run the minimum seed set the test fixture depends on.

    Both ``main.py:lifespan`` and ``tests/conftest.py`` historically called these
    four functions verbatim. Now they share one call so a future "added a 5th
    seed to main, forgot conftest" can't silently regress the test environment.

    ``main.py`` keeps its broader seed list AFTER calling this — the test seed
    set is deliberately minimal so the suite stays fast.
    """
    from .seed_demo_loop import seed_demo_loop_if_empty
    await seed_if_empty()
    await seed_meta_if_empty()
    await seed_access_if_empty()
    # demo-loop seed guards on an empty subscription table — it MUST run before any
    # test creates subscriptions, or it becomes a no-op for the whole session.
    await seed_demo_loop_if_empty()
    # Q5 — tenant-controlled business flags. Must run AFTER seed_if_empty (which
    # creates the tenant row) so there's a tenant to attach flag rows to.
    await seed_business_flags_if_empty()
