"""Catalog seeder: promotes the hardcoded enterprise-nav module stubs into REAL config-driven
entities. Each spec below becomes an EntityDef + FieldDefs + StatusDefs + (optional) WorkflowDef +
PermissionDefs — exactly what POST /meta/entities does — so it renders as a full CRUD page via the
generic /api/{slug} router and EntityView. Idempotent: skips any entity whose key/slug already exists.

Run standalone:  python -m app.seed_catalog   (also called from main.py lifespan)
The matching nav-id -> slug wiring lives in frontend/src/nav-config.ts (ENTITY_SLUGS).
"""
from sqlalchemy import select

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import (
    Tenant, EntityDef, FieldDef, StatusDef, WorkflowDef, PermissionDef,
)


def f(key, label, ftype, required=False, **cfg):
    d = {"key": key, "label": label, "type": ftype, "required": required}
    if cfg:
        d["config"] = cfg
    return d


def st(key, label, initial=False):
    return {"key": key, "label": label, "is_initial": initial}


def tr(frm, to):
    return {"from": frm, "to": to, "guard": None}


def e(key, label, plural, slug, icon, fields, statuses=None, transitions=None):
    return {"key": key, "label": label, "label_plural": plural, "route_slug": slug,
            "icon": icon, "fields": fields, "statuses": statuses or [], "transitions": transitions or []}


# Common little lifecycles
_OPEN_CLOSED = [st("OPEN", "Open", True), st("CLOSED", "Closed")]
_DRAFT_FLOW = [st("DRAFT", "Draft", True), st("ACTIVE", "Active"), st("ARCHIVED", "Archived")]


ENTITY_CATALOG = [
    # ---- CRM ----
    e("interaction", "Interaction", "Interactions", "interactions", "phone",
      [f("customer", "Customer", "ref", target="customer"),
       f("ticket", "Ticket", "ref", target="ticket"),
       f("channel", "Channel", "select", True, options=["call", "email", "chat", "sms", "note", "other"]),
       f("direction", "Direction", "select", True, options=["inbound", "outbound", "internal"]),
       f("subject", "Subject", "text"),
       f("body", "Notes", "textarea", True),
       f("occurred_at", "Occurred At", "datetime")]),
    e("opportunity", "Opportunity", "Opportunities", "opportunities", "arrow-right",
      [f("name", "Name", "text", True), f("customer", "Customer", "ref", target="customer"),
       f("amount", "Amount", "money"), f("close_date", "Close Date", "date")],
      [st("OPEN", "Open", True), st("WON", "Won"), st("LOST", "Lost")],
      [tr("OPEN", "WON"), tr("OPEN", "LOST")]),
    e("quote", "Quote", "Quotes", "quotes", "edit",
      [f("number", "Number", "text", True), f("customer", "Customer", "ref", target="customer"),
       f("amount", "Amount", "money"), f("valid_until", "Valid Until", "date")],
      [st("DRAFT", "Draft", True), st("SENT", "Sent"), st("ACCEPTED", "Accepted"), st("REJECTED", "Rejected")],
      [tr("DRAFT", "SENT"), tr("SENT", "ACCEPTED"), tr("SENT", "REJECTED")]),
    e("contract", "Contract", "Contracts", "contracts", "folder",
      [f("title", "Title", "text", True), f("customer", "Customer", "ref", target="customer"),
       f("value", "Value", "money"), f("start_date", "Start", "date"), f("end_date", "End", "date")],
      [st("DRAFT", "Draft", True), st("ACTIVE", "Active"), st("EXPIRED", "Expired"), st("TERMINATED", "Terminated")],
      [tr("DRAFT", "ACTIVE"), tr("ACTIVE", "EXPIRED"), tr("ACTIVE", "TERMINATED")]),
    e("campaign", "Campaign", "Campaigns", "campaigns", "mail",
      [f("name", "Name", "text", True), f("channel", "Channel", "select", options=["email", "sms", "social"]),
       f("budget", "Budget", "money"), f("start_date", "Start", "date"), f("end_date", "End", "date")],
      [st("PLANNED", "Planned", True), st("ACTIVE", "Active"), st("COMPLETED", "Completed")],
      [tr("PLANNED", "ACTIVE"), tr("ACTIVE", "COMPLETED")]),
    e("promotion", "Promotion", "Promotions", "promotions", "sparkle",
      [f("name", "Name", "text", True), f("code", "Code", "text"), f("discount_pct", "Discount %", "number"),
       f("valid_from", "From", "date"), f("valid_until", "Until", "date")],
      [st("ACTIVE", "Active", True), st("EXPIRED", "Expired")], [tr("ACTIVE", "EXPIRED")]),
    e("segment", "Segment", "Segments", "segments", "layers",
      [f("name", "Name", "text", True), f("description", "Description", "textarea"), f("criteria", "Criteria", "textarea")]),
    e("partnership", "Partnership", "Partnerships", "partnerships", "building",
      [f("name", "Name", "text", True), f("partner_type", "Type", "select", options=["reseller", "vendor", "technology"]),
       f("contact_email", "Contact Email", "email")],
      [st("ACTIVE", "Active", True), st("INACTIVE", "Inactive")], [tr("ACTIVE", "INACTIVE"), tr("INACTIVE", "ACTIVE")]),
    e("loyalty_member", "Loyalty Member", "Loyalty Members", "loyalty-members", "arrow-right",
      [f("customer", "Customer", "ref", target="customer"), f("tier", "Tier", "select", options=["bronze", "silver", "gold"]),
       f("points", "Points", "number")]),

    # ---- Orders ----
    e("order", "Order", "Orders", "orders", "archive",
      [f("number", "Number", "text", True), f("customer", "Customer", "ref", target="customer"),
       f("total", "Total", "money")],
      [st("NEW", "New", True), st("FULFILLING", "Fulfilling"), st("COMPLETED", "Completed"), st("CANCELLED", "Cancelled")],
      [tr("NEW", "FULFILLING"), tr("FULFILLING", "COMPLETED"), tr("NEW", "CANCELLED")]),
    e("change_order", "Change Order", "Change Orders", "change-orders", "edit",
      [f("order_ref", "Order", "ref", target="order"), f("description", "Description", "textarea")],
      _OPEN_CLOSED, [tr("OPEN", "CLOSED")]),

    # ---- Support ----
    e("complaint", "Complaint", "Complaints", "complaints", "edit",
      [f("customer", "Customer", "ref", target="customer"), f("subject", "Subject", "text", True),
       f("detail", "Detail", "textarea")],
      [st("OPEN", "Open", True), st("RESOLVED", "Resolved")], [tr("OPEN", "RESOLVED")]),
    e("escalation", "Escalation", "Escalations", "escalations", "arrow-right",
      [f("ticket_ref", "Ticket", "ref", target="ticket"), f("reason", "Reason", "textarea"),
       f("level", "Level", "select", options=["L1", "L2", "L3"])],
      [st("OPEN", "Open", True), st("RESOLVED", "Resolved")], [tr("OPEN", "RESOLVED")]),
    e("kb_article", "KB Article", "Knowledge Base", "kb-articles", "bookmark",
      [f("title", "Title", "text", True), f("body", "Body", "textarea"), f("category", "Category", "text")],
      _DRAFT_FLOW, [tr("DRAFT", "ACTIVE"), tr("ACTIVE", "ARCHIVED")]),

    # ---- Billing ----
    e("discount", "Discount", "Discounts", "discounts", "dollar",
      [f("name", "Name", "text", True), f("kind", "Kind", "select", options=["percent", "fixed"]), f("amount", "Amount", "number")]),
    e("credit_note", "Credit Note", "Credit Notes", "credit-notes", "receipt",
      [f("number", "Number", "text", True), f("customer", "Customer", "ref", target="customer"), f("amount", "Amount", "money")],
      [st("DRAFT", "Draft", True), st("ISSUED", "Issued"), st("APPLIED", "Applied")],
      [tr("DRAFT", "ISSUED"), tr("ISSUED", "APPLIED")]),
    e("tax_rule", "Tax Rule", "Tax Rules", "tax-rules", "shield",
      [f("name", "Name", "text", True), f("rate_pct", "Rate %", "number"), f("region", "Region", "text")]),

    # ---- Network ----
    e("site", "Site", "Sites / POPs", "sites", "server",
      [f("name", "Name", "text", True), f("address", "Address", "text"), f("kind", "Kind", "select", options=["POP", "datacenter", "tower"])],
      [st("PLANNED", "Planned", True), st("LIVE", "Live"), st("DECOMMISSIONED", "Decommissioned")],
      [tr("PLANNED", "LIVE"), tr("LIVE", "DECOMMISSIONED")]),
    e("olt", "OLT", "OLTs", "olts", "server",
      [f("name", "Name", "text", True), f("site", "Site", "ref", target="site"), f("ip", "IP", "text"), f("ports", "Ports", "number")]),
    e("router", "Router", "Routers", "routers", "server",
      [f("name", "Name", "text", True), f("site", "Site", "ref", target="site"), f("ip", "IP", "text"), f("model", "Model", "text")]),
    e("switch", "Switch", "Switches", "switches", "server",
      [f("name", "Name", "text", True), f("site", "Site", "ref", target="site"), f("ip", "IP", "text"), f("ports", "Ports", "number")]),
    e("tower", "Tower", "BTS / Towers", "towers", "server",
      [f("name", "Name", "text", True), f("site", "Site", "ref", target="site"), f("lat", "Latitude", "text"), f("lng", "Longitude", "text")]),
    e("device", "Device", "Devices", "devices", "server",
      [f("name", "Name", "text", True), f("kind", "Kind", "select", options=["ONT", "CPE", "modem", "other"]),
       f("serial", "Serial", "text"), f("customer", "Customer", "ref", target="customer")],
      [st("STOCK", "In Stock", True), st("DEPLOYED", "Deployed"), st("FAULTY", "Faulty")],
      [tr("STOCK", "DEPLOYED"), tr("DEPLOYED", "FAULTY"), tr("FAULTY", "STOCK")]),
    e("vlan", "VLAN", "VLANs", "vlans", "layers",
      [f("vid", "VLAN ID", "number", True), f("name", "Name", "text"), f("site", "Site", "ref", target="site")]),
    e("alarm", "Alarm", "Alarms", "alarms", "inbox",
      [f("source", "Source", "text", True), f("severity", "Severity", "select", options=["info", "minor", "major", "critical"]),
       f("message", "Message", "textarea")],
      [st("OPEN", "Open", True), st("ACKED", "Acknowledged"), st("CLEARED", "Cleared")],
      [tr("OPEN", "ACKED"), tr("ACKED", "CLEARED")]),
    e("incident", "Incident", "Incidents", "incidents", "inbox",
      [f("title", "Title", "text", True), f("severity", "Severity", "select", options=["sev1", "sev2", "sev3"]),
       f("summary", "Summary", "textarea")],
      [st("OPEN", "Open", True), st("MITIGATED", "Mitigated"), st("RESOLVED", "Resolved")],
      [tr("OPEN", "MITIGATED"), tr("MITIGATED", "RESOLVED")]),
    e("outage", "Outage", "Outages", "outages", "inbox",
      [f("area", "Area", "text", True), f("cause", "Cause", "textarea"), f("started_at", "Started", "datetime")],
      [st("ACTIVE", "Active", True), st("RESTORED", "Restored")], [tr("ACTIVE", "RESTORED")]),

    # ---- Field Operations ----
    e("work_order", "Work Order", "Work Orders", "work-orders", "rows",
      [f("title", "Title", "text", True), f("customer", "Customer", "ref", target="customer"),
       f("scheduled_at", "Scheduled", "datetime"), f("location", "Location", "text")],
      [st("OPEN", "Open", True), st("SCHEDULED", "Scheduled"), st("DONE", "Done")],
      [tr("OPEN", "SCHEDULED"), tr("SCHEDULED", "DONE")]),
    e("maintenance_job", "Maintenance Job", "Maintenance Jobs", "maintenance-jobs", "gear",
      [f("title", "Title", "text", True), f("site", "Site", "ref", target="site"), f("due_date", "Due", "date")],
      [st("OPEN", "Open", True), st("DONE", "Done")], [tr("OPEN", "DONE")]),

    # ---- Inventory ----
    e("warehouse", "Warehouse", "Warehouses", "warehouses", "package",
      [f("name", "Name", "text", True), f("location", "Location", "text")]),
    e("stock_item", "Stock Item", "Stock", "stock-items", "package",
      [f("sku", "SKU", "text", True), f("name", "Name", "text"), f("qty", "Quantity", "number"),
       f("warehouse", "Warehouse", "ref", target="warehouse")]),
    e("stock_movement", "Stock Movement", "Movements", "stock-movements", "arrow-right",
      [f("item", "Item", "ref", target="stock_item"), f("direction", "Direction", "select", options=["in", "out", "transfer"]),
       f("qty", "Quantity", "number")]),
    e("supplier", "Supplier", "Suppliers", "suppliers", "building",
      [f("name", "Name", "text", True), f("contact_email", "Email", "email"), f("phone", "Phone", "phone")]),
    e("purchase_order", "Purchase Order", "Purchase Orders", "purchase-orders", "edit",
      [f("number", "Number", "text", True), f("supplier", "Supplier", "ref", target="supplier"), f("total", "Total", "money")],
      [st("DRAFT", "Draft", True), st("ORDERED", "Ordered"), st("RECEIVED", "Received")],
      [tr("DRAFT", "ORDERED"), tr("ORDERED", "RECEIVED")]),
    e("goods_receipt", "Goods Receipt", "Goods Receipts", "goods-receipts", "archive",
      [f("po_ref", "Purchase Order", "ref", target="purchase_order"), f("received_at", "Received", "datetime")]),
    e("asset", "Asset", "Assets", "assets", "package",
      [f("tag", "Asset Tag", "text", True), f("name", "Name", "text"), f("kind", "Kind", "text")],
      [st("ACTIVE", "Active", True), st("RETIRED", "Retired")], [tr("ACTIVE", "RETIRED")]),
    e("vehicle", "Vehicle", "Fleet / Vehicles", "vehicles", "truck",
      [f("plate", "Plate", "text", True), f("model", "Model", "text"), f("driver", "Driver", "ref", target="user")]),

    # ---- Finance ----
    e("expense", "Expense", "Expenses", "expenses", "dollar",
      [f("description", "Description", "text", True), f("amount", "Amount", "money"), f("category", "Category", "text")],
      [st("SUBMITTED", "Submitted", True), st("APPROVED", "Approved"), st("REJECTED", "Rejected")],
      [tr("SUBMITTED", "APPROVED"), tr("SUBMITTED", "REJECTED")]),
    e("budget", "Budget", "Budgets", "budgets", "receipt",
      [f("name", "Name", "text", True), f("period", "Period", "text"), f("amount", "Amount", "money")]),
    e("vendor_payment", "Vendor Payment", "Vendor Payments", "vendor-payments", "building",
      [f("supplier", "Supplier", "ref", target="supplier"), f("amount", "Amount", "money"), f("due_date", "Due", "date")],
      [st("PENDING", "Pending", True), st("PAID", "Paid")], [tr("PENDING", "PAID")]),

    # ---- HR ----
    e("employee", "Employee", "Employees", "employees", "users",
      [f("name", "Name", "text", True), f("email", "Email", "email"), f("title", "Title", "text"),
       f("department", "Department", "ref", target="department")],
      [st("ACTIVE", "Active", True), st("ONLEAVE", "On Leave"), st("TERMINATED", "Terminated")],
      [tr("ACTIVE", "ONLEAVE"), tr("ONLEAVE", "ACTIVE"), tr("ACTIVE", "TERMINATED")]),
    e("department", "Department", "Departments", "departments", "building",
      [f("name", "Name", "text", True), f("head", "Head", "ref", target="user")]),
    e("leave_request", "Leave Request", "Leave Requests", "leave-requests", "calendar",
      [f("employee", "Employee", "ref", target="employee"), f("kind", "Kind", "select", options=["annual", "sick", "unpaid"]),
       f("from_date", "From", "date"), f("to_date", "To", "date")],
      [st("PENDING", "Pending", True), st("APPROVED", "Approved"), st("REJECTED", "Rejected")],
      [tr("PENDING", "APPROVED"), tr("PENDING", "REJECTED")]),
    e("payroll_run", "Payroll Run", "Payroll Runs", "payroll-runs", "dollar",
      [f("period", "Period", "text", True), f("total", "Total", "money")],
      [st("DRAFT", "Draft", True), st("PROCESSED", "Processed")], [tr("DRAFT", "PROCESSED")]),
    e("candidate", "Candidate", "Recruitment", "candidates", "users",
      [f("name", "Name", "text", True), f("email", "Email", "email"), f("role", "Role", "text")],
      [st("APPLIED", "Applied", True), st("INTERVIEW", "Interview"), st("HIRED", "Hired"), st("REJECTED", "Rejected")],
      [tr("APPLIED", "INTERVIEW"), tr("INTERVIEW", "HIRED"), tr("INTERVIEW", "REJECTED")]),
    e("performance_review", "Performance Review", "Performance Reviews", "performance-reviews", "chart",
      [f("employee", "Employee", "ref", target="employee"), f("period", "Period", "text"), f("rating", "Rating", "number")]),
    e("training_course", "Training Course", "Training", "training-courses", "bookmark",
      [f("title", "Title", "text", True), f("provider", "Provider", "text"), f("hours", "Hours", "number")]),

    # ---- Communications ----
    e("email_template", "Email Template", "Email Templates", "email-templates", "mail",
      [f("name", "Name", "text", True), f("subject", "Subject", "text"), f("body", "Body", "textarea")]),
    e("sms_template", "SMS Template", "SMS Templates", "sms-templates", "message",
      [f("name", "Name", "text", True), f("body", "Body", "textarea")]),
    e("broadcast_campaign", "Broadcast Campaign", "Broadcast Campaigns", "broadcast-campaigns", "mail",
      [f("name", "Name", "text", True), f("channel", "Channel", "select", options=["email", "sms"]), f("body", "Body", "textarea")],
      [st("DRAFT", "Draft", True), st("SENT", "Sent")], [tr("DRAFT", "SENT")]),

    # ---- Documents ----
    e("document", "Document", "Documents", "documents", "folder",
      [f("name", "Name", "text", True), f("kind", "Kind", "text"), f("url", "URL", "text")]),
    e("document_template", "Document Template", "Document Templates", "document-templates", "edit",
      [f("name", "Name", "text", True), f("body", "Body", "textarea")]),

    # ---- Projects ----
    e("project", "Project", "Projects", "projects", "layers",
      [f("name", "Name", "text", True), f("owner", "Owner", "ref", target="user"), f("due_date", "Due", "date")],
      [st("PLANNING", "Planning", True), st("ACTIVE", "Active"), st("DONE", "Done")],
      [tr("PLANNING", "ACTIVE"), tr("ACTIVE", "DONE")]),
    e("milestone", "Milestone", "Milestones", "milestones", "arrow-right",
      [f("project", "Project", "ref", target="project"), f("name", "Name", "text", True), f("due_date", "Due", "date")],
      _OPEN_CLOSED, [tr("OPEN", "CLOSED")]),
    e("risk", "Risk", "Risks", "risks", "inbox",
      [f("title", "Title", "text", True), f("likelihood", "Likelihood", "select", options=["low", "med", "high"]),
       f("impact", "Impact", "select", options=["low", "med", "high"])],
      [st("OPEN", "Open", True), st("MITIGATED", "Mitigated"), st("CLOSED", "Closed")],
      [tr("OPEN", "MITIGATED"), tr("MITIGATED", "CLOSED")]),

    # ---- Legal & Compliance ----
    e("legal_case", "Legal Case", "Legal Cases", "legal-cases", "archive",
      [f("title", "Title", "text", True), f("counterparty", "Counterparty", "text"), f("detail", "Detail", "textarea")],
      [st("OPEN", "Open", True), st("CLOSED", "Closed")], [tr("OPEN", "CLOSED")]),
    e("policy", "Policy", "Policies", "policies", "bookmark",
      [f("name", "Name", "text", True), f("body", "Body", "textarea")], _DRAFT_FLOW,
      [tr("DRAFT", "ACTIVE"), tr("ACTIVE", "ARCHIVED")]),
    e("consent_record", "Consent Record", "Consent Records", "consent-records", "shield",
      [f("customer", "Customer", "ref", target="customer"), f("purpose", "Purpose", "text"),
       f("granted", "Granted", "boolean")]),
    e("legal_hold", "Legal Hold", "Legal Holds", "legal-holds", "lock",
      [f("name", "Name", "text", True), f("scope", "Scope", "textarea")],
      [st("ACTIVE", "Active", True), st("RELEASED", "Released")], [tr("ACTIVE", "RELEASED")]),
    e("compliance_rule", "Compliance Rule", "Compliance Rules", "compliance-rules", "shield",
      [f("name", "Name", "text", True), f("requirement", "Requirement", "textarea")]),
    e("risk_register", "Risk Register Entry", "Risk Registers", "risk-registers", "inbox",
      [f("title", "Title", "text", True), f("owner", "Owner", "ref", target="user"), f("score", "Score", "number")]),

    # ---- Administration ----
    e("sla_policy", "SLA Policy", "SLA Policies", "sla-policies", "clock",
      [f("name", "Name", "text", True), f("response_mins", "Response (min)", "number"), f("resolve_mins", "Resolve (min)", "number")]),
    e("routing_rule", "Routing Rule", "Routing Rules", "routing-rules", "arrow-right",
      [f("name", "Name", "text", True), f("condition", "Condition", "textarea"), f("target", "Target", "text")]),
    e("notification_rule", "Notification Rule", "Notification Rules", "notification-rules", "mail",
      [f("name", "Name", "text", True), f("event", "Event", "text"), f("channel", "Channel", "select", options=["email", "sms", "inapp"])]),
    e("integration", "Integration", "Integrations", "integrations", "layers",
      [f("name", "Name", "text", True), f("kind", "Kind", "text"), f("config_json", "Config", "textarea")],
      [st("ENABLED", "Enabled", True), st("DISABLED", "Disabled")], [tr("ENABLED", "DISABLED"), tr("DISABLED", "ENABLED")]),

    # ---- Self-Service (employee "My Requests" catalog) ----
    # request_type: the FieldDef/select schema only supports a FLAT list of string options
    # (records._check_type does `value not in opts`; meta only handles a flat `options` list), so the
    # ~25 types are stored as a flat list with each label prefixed by its category ("Category · Type").
    # The separator is written as a · escape (pure-ASCII source) so the middle dot survives
    # regardless of how the interpreter decodes this file's source encoding.
    e("request", "Request", "My Requests", "requests", "inbox",
      [f("request_type", "Request Type", "select", True, options=[
          # Time Off
          "Time Off · Vacation request", "Time Off · Day-off request", "Time Off · Sick leave",
          "Time Off · Unpaid leave", "Time Off · Remote / WFH request", "Time Off · Schedule change",
          "Time Off · Overtime declaration", "Time Off · Business trip request",
          # Finance
          "Finance · Salary advance", "Finance · Expense reimbursement",
          "Finance · Payslip / income certificate", "Finance · Compensation inquiry",
          # IT & Access
          "IT & Access · Equipment request", "IT & Access · Access / permission request",
          "IT & Access · Password reset / account unlock", "IT & Access · Software / license request",
          "IT & Access · Hardware repair",
          # Administrative
          "Administrative · Employment certificate / reference letter",
          "Administrative · Personal data update", "Administrative · Workspace request",
          "Administrative · Corporate SIM / signature / card",
          # Development
          "Development · Training request", "Development · Internal transfer request",
          "Development · Performance review request", "Development · Grievance / complaint",
      ]),
       f("subject", "Subject", "text", True),
       f("details", "Details", "textarea"),
       f("priority", "Priority", "select", options=["Low", "Normal", "High", "Urgent"], default="Normal"),
       f("sla_due", "SLA Due", "datetime")],
      [st("DRAFT", "Draft", True), st("OPEN", "Open"), st("IN_REVIEW", "In Review"),
       st("APPROVED", "Approved"), st("REJECTED", "Rejected"), st("CLOSED", "Closed")],
      [tr("DRAFT", "OPEN"), tr("OPEN", "IN_REVIEW"), tr("IN_REVIEW", "APPROVED"),
       tr("IN_REVIEW", "REJECTED"), tr("APPROVED", "CLOSED"), tr("REJECTED", "CLOSED")]),
]


async def _create_entity(s, tenant_id, spec) -> bool:
    exists = (await s.execute(
        select(EntityDef).where(
            EntityDef.tenant_id == tenant_id,
            (EntityDef.key == spec["key"]) | (EntityDef.route_slug == spec["route_slug"]),
        )
    )).scalar_one_or_none()
    if exists:
        return False
    ent = EntityDef(tenant_id=tenant_id, key=spec["key"], label=spec["label"],
                    label_plural=spec["label_plural"], route_slug=spec["route_slug"], icon=spec.get("icon"))
    s.add(ent)
    await s.flush()
    for i, fld in enumerate(spec["fields"], start=1):
        s.add(FieldDef(tenant_id=tenant_id, entity_def_id=ent.id, key=fld["key"],
                       label=fld.get("label", fld["key"]), type=fld["type"],
                       required=bool(fld.get("required")), order=i, config=fld.get("config")))
    for i, status in enumerate(spec["statuses"], start=1):
        s.add(StatusDef(tenant_id=tenant_id, entity_def_id=ent.id, key=status["key"],
                        label=status.get("label", status["key"]), order=i,
                        is_initial=bool(status.get("is_initial"))))
    if spec["transitions"]:
        s.add(WorkflowDef(tenant_id=tenant_id, entity_def_id=ent.id, key=f'{spec["key"]}_lifecycle',
                          label=f'{spec["label"]} Lifecycle', config={"transitions": spec["transitions"]}))
    for verb in ("view", "create", "edit", "delete"):
        s.add(PermissionDef(tenant_id=tenant_id, key=f'{spec["key"]}.{verb}',
                            label=f'{verb} {spec["key"]}', group=spec["key"]))
    return True


async def seed_catalog_if_missing() -> int:
    """Create every catalog entity for every tenant that doesn't already have it. Idempotent."""
    created = 0
    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            for spec in ENTITY_CATALOG:
                if await _create_entity(s, t.id, spec):
                    created += 1
        await s.commit()
    return created


async def seed_entity_if_missing(entity_key: str) -> int:
    """Create a single catalog entity (by key) for every tenant that doesn't already have it. Idempotent."""
    spec = next((s for s in ENTITY_CATALOG if s["key"] == entity_key), None)
    if spec is None:
        raise ValueError(f"No catalog spec found for entity key '{entity_key}'")
    created = 0
    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            if await _create_entity(s, t.id, spec):
                created += 1
        await s.commit()
    return created


if __name__ == "__main__":
    import asyncio
    print("catalog entities created:", asyncio.run(seed_catalog_if_missing()))
