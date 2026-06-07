"""Catalog seeder: promotes the hardcoded enterprise-nav module stubs into REAL config-driven
entities. Each spec below becomes an EntityDef + FieldDefs + StatusDefs + (optional) WorkflowDef +
PermissionDefs — exactly what POST /meta/entities does — so it renders as a full CRUD page via the
generic /api/{slug} router and EntityView. Idempotent: skips any entity whose key/slug already exists.

Run standalone:  python -m app.seed_catalog   (also called from main.py lifespan)
The matching nav-id -> slug wiring lives in frontend/src/nav-config.ts (ENTITY_SLUGS).
"""
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

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


# Common lifecycles
_OPEN_CLOSED    = [st("OPEN", "Open", True), st("CLOSED", "Closed")]
_DRAFT_FLOW     = [st("DRAFT", "Draft", True), st("ACTIVE", "Active"), st("ARCHIVED", "Archived")]
_ACTIVE_INACTIVE = [st("ACTIVE", "Active", True), st("INACTIVE", "Inactive")]
_PENDING_DONE   = [st("PENDING", "Pending", True), st("DONE", "Done")]


ENTITY_CATALOG = [

    # ═══════════════════════════════════════════════════════════════════
    # CRM & COMMERCIAL
    # ═══════════════════════════════════════════════════════════════════

    e("interaction", "Interaction", "Interactions", "interactions", "phone",
      [f("customer",      "Customer",      "ref",      target="customer"),
       f("ticket",        "Ticket",        "ref",      target="ticket"),
       # Canonical CommunicationChannel / CommunicationDirection per standard 14 (UPPER_SNAKE).
       f("channel",       "Channel",       "select",   True,  options=["WHATSAPP","MESSENGER","SMS","EMAIL","CALLS","INTERNAL_CHAT","PORTAL_MESSAGE","SYSTEM_MESSAGE"]),
       f("direction",     "Direction",     "select",   True,  options=["INBOUND","OUTBOUND","INTERNAL","SYSTEM"]),
       f("subject",       "Subject",       "text"),
       f("body",          "Notes",         "textarea", True),
       f("duration_mins", "Duration (min)","number"),
       f("assigned_to",   "Agent",         "ref",      target="user"),
       f("occurred_at",   "Occurred At",   "datetime"),
       f("outcome",       "Outcome",       "select",   options=["resolved","follow_up","escalated","no_action"])]),

    e("opportunity", "Opportunity", "Opportunities", "opportunities", "arrow-right",
      [f("name",         "Name",          "text",  True),
       f("customer",     "Customer",      "ref",   True,  target="customer"),
       f("lead",         "Source Lead",   "ref",          target="lead"),
       f("amount",       "Amount",        "money"),
       f("tariff_plan",  "Plan",          "ref",          target="tariff_plan"),
       f("close_date",   "Close Date",    "date"),
       f("probability",  "Probability %", "number"),
       f("source",       "Source",        "text"),
       f("assigned_to",  "Owner",         "ref",          target="user"),
       f("notes",        "Notes",         "textarea")],
      [st("OPEN","Open",True), st("WON","Won"), st("LOST","Lost")],
      [tr("OPEN","WON"), tr("OPEN","LOST")]),

    e("quote", "Quote", "Quotes", "quotes", "edit",
      [f("number",       "Quote #",       "text",  True),
       f("customer",     "Customer",      "ref",   True,  target="customer"),
       f("tariff_plan",  "Plan",          "ref",          target="tariff_plan"),
       f("amount",       "Total",         "money", True),
       f("discount",     "Discount",      "money"),
       f("valid_until",  "Valid Until",   "date",  True),
       f("notes",        "Notes",         "textarea"),
       f("prepared_by",  "Prepared By",   "ref",          target="user")],
      [st("DRAFT","Draft",True), st("SENT","Sent"), st("ACCEPTED","Accepted"), st("REJECTED","Rejected"), st("EXPIRED","Expired")],
      [tr("DRAFT","SENT"), tr("SENT","ACCEPTED"), tr("SENT","REJECTED"), tr("SENT","EXPIRED")]),

    e("contract", "Contract", "Contracts", "contracts", "folder",
      [f("title",           "Title",          "text",  True),
       f("customer",        "Customer",       "ref",   True,  target="customer"),
       f("contract_number", "Contract #",     "text"),
       f("value",           "Value",          "money"),
       f("start_date",      "Start",          "date",  True),
       f("end_date",        "End",            "date"),
       f("auto_renew",      "Auto-Renew",     "boolean"),
       f("tariff_plan",     "Plan",           "ref",          target="tariff_plan"),
       f("signed_by",       "Signed By",      "text"),
       f("notes",           "Notes",          "textarea")],
      [st("DRAFT","Draft",True), st("ACTIVE","Active"), st("EXPIRED","Expired"), st("TERMINATED","Terminated")],
      [tr("DRAFT","ACTIVE"), tr("ACTIVE","EXPIRED"), tr("ACTIVE","TERMINATED")]),

    e("campaign", "Campaign", "Campaigns", "campaigns", "mail",
      [f("name",           "Name",           "text",   True),
       f("channel",        "Channel",        "select", options=["email","sms","social","push"]),
       f("target_segment", "Target Segment", "ref",           target="segment"),
       f("budget",         "Budget",         "money"),
       f("start_date",     "Start",          "date"),
       f("end_date",       "End",            "date"),
       f("owner",          "Owner",          "ref",           target="user"),
       f("goal",           "Goal",           "textarea"),
       f("sent_count",     "Sent",           "number"),
       f("open_rate",      "Open Rate %",    "number")],
      [st("PLANNED","Planned",True), st("ACTIVE","Active"), st("COMPLETED","Completed"), st("CANCELLED","Cancelled")],
      [tr("PLANNED","ACTIVE"), tr("ACTIVE","COMPLETED"), tr("ACTIVE","CANCELLED"), tr("PLANNED","CANCELLED")]),

    e("promotion", "Promotion", "Promotions", "promotions", "sparkle",
      [f("name",           "Name",           "text",   True),
       f("code",           "Promo Code",     "text"),
       f("discount_type",  "Type",           "select", True,  options=["percent","fixed_amd"]),
       f("discount_value", "Value",          "number", True),
       f("min_months",     "Min Contract Months","number"),
       f("max_uses",       "Max Uses",       "number"),
       f("used_count",     "Used",           "number"),
       f("valid_from",     "From",           "date",   True),
       f("valid_until",    "Until",          "date"),
       f("applicable_to",  "Applicable To",  "select", options=["new_customers","existing_customers","all"])],
      [st("ACTIVE","Active",True), st("EXPIRED","Expired"), st("DISABLED","Disabled")],
      [tr("ACTIVE","EXPIRED"), tr("ACTIVE","DISABLED")]),

    e("segment", "Segment", "Segments", "segments", "layers",
      [f("name",            "Name",            "text",     True),
       f("description",     "Description",     "textarea"),
       f("criteria",        "Criteria",        "textarea"),
       f("customer_count",  "Customer Count",  "number"),
       f("updated_segment", "Last Calculated", "datetime")]),

    e("partnership", "Partnership", "Partnerships", "partnerships", "building",
      [f("name",              "Name",          "text",   True),
       f("partner_type",      "Type",          "select", True, options=["reseller","vendor","technology","affiliate"]),
       f("contact_name",      "Contact Name",  "text"),
       f("contact_email",     "Email",         "email"),
       f("contact_phone",     "Phone",         "phone"),
       f("commission_pct",    "Commission %",  "number"),
       f("agreement_signed",  "Agreement Signed","boolean"),
       f("notes",             "Notes",         "textarea")],
      [st("ACTIVE","Active",True), st("INACTIVE","Inactive"), st("TERMINATED","Terminated")],
      [tr("ACTIVE","INACTIVE"), tr("INACTIVE","ACTIVE"), tr("ACTIVE","TERMINATED")]),

    e("sales_channel", "Sales Channel", "Sales Channels", "sales-channels", "building",
      [f("name",            "Name",           "text",   True),
       f("type",            "Type",           "select", True, options=["direct","reseller","online","retail","agent"]),
       f("manager",         "Manager",        "ref",          target="user"),
       f("region",          "Region",         "text"),
       f("commission_pct",  "Commission %",   "number"),
       f("target_monthly",  "Monthly Target", "money")],
      _ACTIVE_INACTIVE,
      [tr("ACTIVE","INACTIVE"), tr("INACTIVE","ACTIVE")]),

    e("loyalty_member", "Loyalty Member", "Loyalty Members", "loyalty-members", "arrow-right",
      [f("customer",     "Customer",     "ref",    True,  target="customer"),
       f("tier",         "Tier",         "select", True,  options=["bronze","silver","gold","platinum"]),
       f("points",       "Points Balance","number"),
       f("total_earned", "Total Earned", "number"),
       f("enrolled_at",  "Enrolled",     "date"),
       f("expires_at",   "Expires",      "date")]),

    # ═══════════════════════════════════════════════════════════════════
    # ORDERS
    # ═══════════════════════════════════════════════════════════════════

    e("order", "Order", "Orders", "orders", "archive",
      [f("number",   "Number",  "text",  True),
       f("customer", "Customer","ref",   True,  target="customer"),
       f("total",    "Total",   "money")],
      [st("NEW","New",True), st("FULFILLING","Fulfilling"), st("COMPLETED","Completed"), st("CANCELLED","Cancelled")],
      [tr("NEW","FULFILLING"), tr("FULFILLING","COMPLETED"), tr("NEW","CANCELLED")]),

    e("change_order", "Change Order", "Change Orders", "change-orders", "edit",
      [f("order_ref",   "Order",       "ref",      True,  target="order"),
       f("description", "Description", "textarea", True),
       f("reason",      "Reason",      "textarea"),
       f("requested_by","Requested By","ref",             target="user")],
      _OPEN_CLOSED, [tr("OPEN","CLOSED")]),

    # ═══════════════════════════════════════════════════════════════════
    # SUPPORT
    # ═══════════════════════════════════════════════════════════════════

    e("complaint", "Complaint", "Complaints", "complaints", "edit",
      [f("customer",    "Customer",   "ref",     True,  target="customer"),
       f("subject",     "Subject",    "text",    True),
       f("category",    "Category",   "select",  options=["billing","service_quality","staff","technical","coverage","other"]),
       f("detail",      "Detail",     "textarea"),
       f("assigned_to", "Assigned To","ref",            target="user"),
       f("resolution",  "Resolution", "textarea"),
       f("resolved_at", "Resolved At","datetime")],
      [st("OPEN","Open",True), st("UNDER_REVIEW","Under Review"), st("RESOLVED","Resolved"), st("CLOSED","Closed")],
      [tr("OPEN","UNDER_REVIEW"), tr("UNDER_REVIEW","RESOLVED"), tr("RESOLVED","CLOSED")]),

    e("escalation", "Escalation", "Escalations", "escalations", "arrow-right",
      [f("ticket_ref",          "Ticket",           "ref",     True,  target="ticket"),
       f("reason",              "Reason",           "textarea",True),
       f("level",               "Level",            "select",  True,  options=["L1","L2","L3","management"]),
       f("escalated_to",        "Escalated To",     "ref",            target="user"),
       f("escalated_by",        "Escalated By",     "ref",            target="user"),
       f("expected_resolution", "Expected Resolution","datetime"),
       f("notes",               "Notes",            "textarea")],
      [st("OPEN","Open",True), st("IN_PROGRESS","In Progress"), st("RESOLVED","Resolved")],
      [tr("OPEN","IN_PROGRESS"), tr("IN_PROGRESS","RESOLVED")]),

    e("kb_article", "KB Article", "Knowledge Base", "kb-articles", "bookmark",
      [f("title",        "Title",       "text",     True),
       f("category",     "Category",    "text",     True),
       f("body",         "Content",     "textarea", True),
       f("tags",         "Tags",        "text"),
       f("author",       "Author",      "ref",             target="user"),
       f("views",        "View Count",  "number"),
       f("helpful_votes","Helpful",     "number")],
      [st("DRAFT","Draft",True), st("REVIEW","Review"), st("ACTIVE","Active"), st("ARCHIVED","Archived")],
      [tr("DRAFT","REVIEW"), tr("REVIEW","ACTIVE"), tr("ACTIVE","ARCHIVED"), tr("REVIEW","DRAFT")]),

    # ═══════════════════════════════════════════════════════════════════
    # BILLING & REVENUE
    # ═══════════════════════════════════════════════════════════════════

    e("tariff_plan", "Tariff Plan", "Tariff Plans", "tariff-plans", "bookmark",
      [f("name",            "Plan Name",         "text",    True),
       f("code",            "Plan Code",         "text"),
       f("description",     "Description",       "textarea"),
       f("technology",      "Technology",        "select",  options=["fiber","gpon","cable","wireless","dsl"]),
       f("speed_down",      "Download (Mbps)",   "number",  True),
       f("speed_up",        "Upload (Mbps)",     "number",  True),
       f("data_cap_gb",     "Data Cap (GB)",     "number"),
       f("price_monthly",   "Monthly Price",     "money",   True),
       f("price_setup",     "Setup Fee",         "money"),
       f("contract_months", "Min Contract (mo)", "number"),
       f("features",        "Features",          "textarea"),
       f("is_public",       "Show on Portal",    "boolean")],
      [st("DRAFT","Draft",True), st("ACTIVE","Active"), st("RETIRED","Retired")],
      [tr("DRAFT","ACTIVE"), tr("ACTIVE","RETIRED")]),

    e("collection_case", "Collection Case", "Collections", "collections", "inbox",
      [f("customer",      "Customer",          "ref",     True,  target="customer"),
       f("amount_due",    "Amount Due",        "money",   True),
       f("overdue_days",  "Overdue (days)",    "number"),
       f("reason",        "Reason",            "text"),
       f("assigned_to",   "Collector",         "ref",            target="user"),
       f("last_contact",  "Last Contact",      "datetime"),
       f("next_action",   "Next Action",       "text"),
       f("promise_date",  "Promise to Pay",    "date")],
      [st("OPEN","Open",True), st("IN_PROGRESS","In Progress"), st("RESOLVED","Resolved"), st("WRITTEN_OFF","Written Off"), st("LEGAL","Legal")],
      [tr("OPEN","IN_PROGRESS"), tr("IN_PROGRESS","RESOLVED"), tr("IN_PROGRESS","WRITTEN_OFF"), tr("IN_PROGRESS","LEGAL")]),

    e("discount", "Discount", "Discounts", "discounts", "dollar",
      [f("name",         "Name",          "text",   True),
       f("kind",         "Kind",          "select", True, options=["percent","fixed"]),
       f("amount",       "Amount",        "number", True),
       f("max_amount",   "Max Cap",       "money"),
       f("applicable_to","Applies To",    "select", options=["all","new_customers","specific_plan"]),
       f("min_months",   "Min Contract Months","number")]),

    e("credit_note", "Credit Note", "Credit Notes", "credit-notes", "receipt",
      [f("number",     "CN #",       "text",     True),
       f("customer",   "Customer",   "ref",      True,  target="customer"),
       f("invoice_id", "Invoice",    "text"),
       f("amount",     "Amount",     "money",    True),
       f("reason",     "Reason",     "textarea", True),
       f("issued_by",  "Issued By",  "ref",             target="user")],
      [st("DRAFT","Draft",True), st("ISSUED","Issued"), st("APPLIED","Applied"), st("VOID","Void")],
      [tr("DRAFT","ISSUED"), tr("ISSUED","APPLIED"), tr("ISSUED","VOID")]),

    e("tax_rule", "Tax Rule", "Tax Rules", "tax-rules", "shield",
      [f("name",           "Name",           "text",   True),
       f("rate_pct",       "Rate %",         "number", True),
       f("region",         "Region",         "text"),
       f("tax_type",       "Type",           "select", options=["VAT","income","municipal","other"]),
       f("applies_to",     "Applies To",     "text"),
       f("effective_from", "Effective From", "date")]),

    # ═══════════════════════════════════════════════════════════════════
    # NETWORK & INFRASTRUCTURE
    # ═══════════════════════════════════════════════════════════════════

    e("site", "Site", "Sites / POPs", "sites", "server",
      [f("name",            "Site Name",      "text",   True),
       f("code",            "Site Code",      "text"),
       f("kind",            "Kind",           "select", True, options=["POP","datacenter","tower","node","hub"]),
       f("address",         "Address",        "text",   True),
       f("lat",             "Latitude",       "text"),
       f("lon",             "Longitude",      "text"),
       f("capacity_ports",  "Total Ports",    "number"),
       f("power_kw",        "Power (kW)",     "number"),
       f("owner",           "Responsible",    "ref",          target="user"),
       f("notes",           "Notes",          "textarea")],
      [st("PLANNED","Planned",True), st("UNDER_CONSTRUCTION","Under Construction"), st("LIVE","Live"), st("DECOMMISSIONED","Decommissioned")],
      [tr("PLANNED","UNDER_CONSTRUCTION"), tr("UNDER_CONSTRUCTION","LIVE"), tr("LIVE","DECOMMISSIONED")]),

    e("olt", "OLT", "OLTs", "olts", "server",
      [f("name",         "Name",        "text",  True),
       f("site",         "Site",        "ref",   True,  target="site"),
       f("ip",           "IP Address",  "text",  True),
       f("model",        "Model",       "text"),
       f("vendor",       "Vendor",      "text"),
       f("ports",        "Port Count",  "number"),
       f("firmware",     "Firmware",    "text"),
       f("serial",       "Serial #",    "text"),
       f("installed_at", "Installed",   "date")],
      [st("ACTIVE","Active",True), st("MAINTENANCE","Maintenance"), st("DECOMMISSIONED","Decommissioned")],
      [tr("ACTIVE","MAINTENANCE"), tr("MAINTENANCE","ACTIVE"), tr("ACTIVE","DECOMMISSIONED")]),

    e("router", "Router", "Routers", "routers", "server",
      [f("name",      "Name",       "text",  True),
       f("site",      "Site",       "ref",   True,  target="site"),
       f("ip",        "IP Address", "text",  True),
       f("model",     "Model",      "text"),
       f("vendor",    "Vendor",     "text"),
       f("bgp_as",    "BGP AS",     "text"),
       f("serial",    "Serial #",   "text"),
       f("firmware",  "Firmware",   "text"),
       f("role",      "Role",       "select", options=["core","distribution","edge","access"])],
      [st("ACTIVE","Active",True), st("MAINTENANCE","Maintenance"), st("DECOMMISSIONED","Decommissioned")],
      [tr("ACTIVE","MAINTENANCE"), tr("MAINTENANCE","ACTIVE"), tr("ACTIVE","DECOMMISSIONED")]),

    e("switch", "Switch", "Switches", "switches", "server",
      [f("name",    "Name",       "text",  True),
       f("site",    "Site",       "ref",   True,  target="site"),
       f("ip",      "IP Address", "text"),
       f("model",   "Model",      "text"),
       f("vendor",  "Vendor",     "text"),
       f("ports",   "Port Count", "number"),
       f("serial",  "Serial #",   "text"),
       f("layer",   "Layer",      "select", options=["L2","L3"])],
      [st("ACTIVE","Active",True), st("MAINTENANCE","Maintenance"), st("DECOMMISSIONED","Decommissioned")],
      [tr("ACTIVE","MAINTENANCE"), tr("MAINTENANCE","ACTIVE"), tr("ACTIVE","DECOMMISSIONED")]),

    e("tower", "Tower", "BTS / Towers", "towers", "server",
      [f("name",               "Name",              "text",  True),
       f("site",               "Site",              "ref",   True,  target="site"),
       f("lat",                "Latitude",          "text",  True),
       f("lng",                "Longitude",         "text",  True),
       f("height_m",           "Height (m)",        "number"),
       f("technology",         "Technology",        "select", options=["LTE","5G","WiMAX","GPON","other"]),
       f("owner",              "Owner",             "text"),
       f("coverage_radius_km", "Coverage Radius (km)","number")],
      [st("PLANNED","Planned",True), st("ACTIVE","Active"), st("MAINTENANCE","Maintenance"), st("DECOMMISSIONED","Decommissioned")],
      [tr("PLANNED","ACTIVE"), tr("ACTIVE","MAINTENANCE"), tr("MAINTENANCE","ACTIVE"), tr("ACTIVE","DECOMMISSIONED")]),

    e("device", "Device", "Devices", "devices", "server",
      [f("name",         "Name",          "text",   True),
       f("kind",         "Kind",          "select", True,  options=["ONT","CPE","modem","router","switch","other"]),
       f("serial",       "Serial #",      "text",   True),
       f("mac",          "MAC Address",   "text"),
       f("model",        "Model",         "text"),
       f("vendor",       "Vendor",        "text"),
       f("customer",     "Customer",      "ref",           target="customer"),
       f("ip_assigned",  "Assigned IP",   "text"),
       f("installed_at", "Installed",     "date"),
       f("firmware",     "Firmware",      "text")],
      [st("STOCK","In Stock",True), st("DEPLOYED","Deployed"), st("FAULTY","Faulty"), st("RMA","RMA"), st("RETIRED","Retired")],
      [tr("STOCK","DEPLOYED"), tr("DEPLOYED","FAULTY"), tr("FAULTY","RMA"), tr("RMA","STOCK"), tr("DEPLOYED","RETIRED")]),

    e("vlan", "VLAN", "VLANs", "vlans", "layers",
      [f("vid",     "VLAN ID",   "number", True),
       f("name",    "Name",      "text"),
       f("site",    "Site",      "ref",           target="site"),
       f("purpose", "Purpose",   "select", options=["customer","management","uplink","voice","iptv"]),
       f("subnet",  "Subnet",    "text"),
       f("gateway", "Gateway IP","text"),
       f("notes",   "Notes",     "text")]),

    e("alarm", "Alarm", "Alarms", "alarms", "inbox",
      [f("source",      "Source",      "text",     True),
       f("device",      "Device",      "ref",             target="device"),
       f("site",        "Site",        "ref",             target="site"),
       f("severity",    "Severity",    "select",   True,  options=["info","minor","major","critical"]),
       f("message",     "Message",     "textarea", True),
       f("first_seen",  "First Seen",  "datetime"),
       f("last_seen",   "Last Seen",   "datetime"),
       f("count",       "Occurrences", "number"),
       f("assigned_to", "Assigned To", "ref",             target="user")],
      [st("OPEN","Open",True), st("ACKED","Acknowledged"), st("CLEARED","Cleared")],
      [tr("OPEN","ACKED"), tr("ACKED","CLEARED"), tr("OPEN","CLEARED")]),

    e("incident", "Incident", "Incidents", "incidents", "inbox",
      [f("title",               "Title",              "text",     True),
       f("severity",            "Severity",           "select",   True, options=["SEV1","SEV2","SEV3","SEV4"]),
       f("summary",             "Summary",            "textarea", True),
       f("affected_area",       "Affected Area",      "text"),
       f("affected_customers",  "Affected Customers", "number"),
       f("root_cause",          "Root Cause",         "textarea"),
       f("resolution",          "Resolution",         "textarea"),
       f("assigned_to",         "Incident Commander", "ref",             target="user"),
       f("started_at",          "Started",            "datetime"),
       f("resolved_at",         "Resolved",           "datetime")],
      [st("OPEN","Open",True), st("INVESTIGATING","Investigating"), st("MITIGATED","Mitigated"), st("RESOLVED","Resolved"), st("POST_MORTEM","Post-Mortem")],
      [tr("OPEN","INVESTIGATING"), tr("INVESTIGATING","MITIGATED"), tr("MITIGATED","RESOLVED"), tr("RESOLVED","POST_MORTEM")]),

    e("outage", "Outage", "Outages", "outages", "inbox",
      [f("area",                "Area",               "text",     True),
       f("cause",               "Cause",              "select",   options=["fiber_cut","power","hardware","planned","unknown"]),
       f("description",         "Description",        "textarea"),
       f("affected_customers",  "Affected Customers", "number"),
       f("site",                "Site",               "ref",             target="site"),
       f("started_at",          "Started",            "datetime", True),
       f("restored_at",         "Restored",           "datetime"),
       f("rca",                 "Root Cause Analysis","textarea"),
       f("reported_by",         "Reported By",        "ref",             target="user")],
      [st("ACTIVE","Active",True), st("PARTIALLY_RESTORED","Partially Restored"), st("RESTORED","Restored")],
      [tr("ACTIVE","PARTIALLY_RESTORED"), tr("PARTIALLY_RESTORED","RESTORED"), tr("ACTIVE","RESTORED")]),

    # ═══════════════════════════════════════════════════════════════════
    # FIELD OPERATIONS
    # ═══════════════════════════════════════════════════════════════════

    e("work_order", "Work Order", "Work Orders", "work-orders", "rows",
      [f("title",         "Title",          "text",     True),
       f("customer",      "Customer",       "ref",      True,  target="customer"),
       f("type",          "Type",           "select",   options=["installation","repair","maintenance","upgrade","removal"]),
       f("scheduled_at",  "Scheduled",      "datetime"),
       f("location",      "Location",       "text",     True),
       f("assigned_to",   "Technician",     "ref",             target="user"),
       f("contact_name",  "On-Site Contact","text"),
       f("contact_phone", "Contact Phone",  "phone"),
       f("notes",         "Notes",          "textarea"),
       f("completed_at",  "Completed",      "datetime"),
       f("result",        "Result",         "textarea")],
      [st("OPEN","Open",True), st("SCHEDULED","Scheduled"), st("IN_PROGRESS","In Progress"), st("DONE","Done"), st("CANCELLED","Cancelled")],
      [tr("OPEN","SCHEDULED"), tr("SCHEDULED","IN_PROGRESS"), tr("IN_PROGRESS","DONE"), tr("OPEN","CANCELLED"), tr("SCHEDULED","CANCELLED")]),

    e("maintenance_job", "Maintenance Job", "Maintenance Jobs", "maintenance-jobs", "gear",
      [f("title",        "Title",          "text",     True),
       f("site",         "Site",           "ref",      True,  target="site"),
       f("kind",         "Kind",           "select",   options=["preventive","corrective","emergency","upgrade"]),
       f("assigned_to",  "Assigned To",    "ref",             target="user"),
       f("due_date",     "Due",            "date"),
       f("duration_hrs", "Est. Hours",     "number"),
       f("description",  "Description",    "textarea"),
       f("result",       "Result",         "textarea")],
      [st("PLANNED","Planned",True), st("IN_PROGRESS","In Progress"), st("DONE","Done"), st("CANCELLED","Cancelled")],
      [tr("PLANNED","IN_PROGRESS"), tr("IN_PROGRESS","DONE"), tr("PLANNED","CANCELLED")]),

    e("coverage_check", "Coverage Check", "Coverage Checks", "coverage-checks", "shield",
      [f("address",      "Address",        "text",  True),
       f("lat",          "Latitude",       "text"),
       f("lon",          "Longitude",      "text"),
       f("customer",     "Customer",       "ref",          target="customer"),
       f("technology",   "Technology",     "select", options=["fiber","gpon","wireless","cable"]),
       f("result",       "Result",         "select", True, options=["PASS","FAIL","PENDING"]),
       f("nearest_pop",  "Nearest POP",    "ref",          target="site"),
       f("distance_m",   "Distance (m)",   "number"),
       f("notes",        "Notes",          "textarea"),
       f("checked_at",   "Checked",        "datetime"),
       f("checked_by",   "Checked By",     "ref",          target="user")],
      [st("PENDING","Pending",True), st("PASS","Pass"), st("FAIL","Fail")],
      [tr("PENDING","PASS"), tr("PENDING","FAIL")]),

    e("schedule_slot", "Schedule Slot", "Schedule Slots", "schedule-slots", "calendar",
      [f("title",      "Title",       "text",  True),
       f("date",       "Date",        "date",  True),
       f("time_from",  "Start Time",  "text"),
       f("time_to",    "End Time",    "text"),
       f("tech",       "Technician",  "ref",   True,  target="user"),
       f("customer",   "Customer",    "ref",          target="customer"),
       f("work_order", "Work Order",  "ref",          target="work_order"),
       f("location",   "Location",    "text"),
       f("notes",      "Notes",       "textarea")],
      [st("OPEN","Open",True), st("FILLED","Filled"), st("IN_PROGRESS","In Progress"), st("DONE","Done"), st("CANCELLED","Cancelled")],
      [tr("OPEN","FILLED"), tr("FILLED","IN_PROGRESS"), tr("IN_PROGRESS","DONE"), tr("OPEN","CANCELLED"), tr("FILLED","CANCELLED")]),

    # ═══════════════════════════════════════════════════════════════════
    # INVENTORY & PROCUREMENT
    # ═══════════════════════════════════════════════════════════════════

    e("warehouse", "Warehouse", "Warehouses", "warehouses", "package",
      [f("name",     "Name",     "text",  True),
       f("location", "Address",  "text",  True),
       f("manager",  "Manager",  "ref",          target="user"),
       f("capacity", "Capacity", "number"),
       f("notes",    "Notes",    "textarea")]),

    e("stock_item", "Stock Item", "Stock", "stock-items", "package",
      [f("sku",          "SKU",         "text",   True),
       f("name",         "Name",        "text",   True),
       f("category",     "Category",    "select", options=["ONT","router","cable","SFP","tool","consumable","other"]),
       f("qty",          "Quantity",    "number", True),
       f("qty_reserved", "Reserved",    "number"),
       f("unit_cost",    "Unit Cost",   "money"),
       f("warehouse",    "Warehouse",   "ref",          target="warehouse"),
       f("min_stock",    "Min Stock",   "number"),
       f("supplier",     "Supplier",    "ref",          target="supplier"),
       f("notes",        "Notes",       "text")]),

    e("stock_movement", "Stock Movement", "Movements", "stock-movements", "arrow-right",
      [f("item",          "Item",         "ref",    True,  target="stock_item"),
       f("direction",     "Direction",    "select", True,  options=["in","out","transfer"]),
       f("qty",           "Quantity",     "number", True),
       f("from_warehouse","From",         "ref",          target="warehouse"),
       f("to_warehouse",  "To",           "ref",          target="warehouse"),
       f("reason",        "Reason",       "text"),
       f("reference",     "Reference",    "text"),
       f("moved_by",      "Moved By",     "ref",          target="user")]),

    e("supplier", "Supplier", "Suppliers", "suppliers", "building",
      [f("name",          "Name",          "text",  True),
       f("contact_name",  "Contact",       "text"),
       f("contact_email", "Email",         "email", True),
       f("phone",         "Phone",         "phone"),
       f("address",       "Address",       "text"),
       f("tax_id",        "Tax ID",        "text"),
       f("bank_details",  "Bank Details",  "textarea"),
       f("payment_terms", "Payment Terms", "text"),
       f("notes",         "Notes",         "textarea")],
      [st("ACTIVE","Active",True), st("INACTIVE","Inactive"), st("BLACKLISTED","Blacklisted")],
      [tr("ACTIVE","INACTIVE"), tr("INACTIVE","ACTIVE"), tr("ACTIVE","BLACKLISTED")]),

    e("purchase_order", "Purchase Order", "Purchase Orders", "purchase-orders", "edit",
      [f("number",      "PO #",              "text",  True),
       f("supplier",    "Supplier",          "ref",   True,  target="supplier"),
       f("total",       "Total",             "money", True),
       f("currency",    "Currency",          "text"),
       f("due_date",    "Expected Delivery", "date"),
       f("description", "Description",       "textarea"),
       f("assigned_to", "Created By",        "ref",          target="user"),
       f("approved_by", "Approved By",       "ref",          target="user"),
       f("notes",       "Notes",             "textarea")],
      [st("DRAFT","Draft",True), st("ORDERED","Ordered"), st("PARTIALLY_RECEIVED","Partially Received"), st("RECEIVED","Received"), st("CANCELLED","Cancelled")],
      [tr("DRAFT","ORDERED"), tr("ORDERED","PARTIALLY_RECEIVED"), tr("PARTIALLY_RECEIVED","RECEIVED"), tr("ORDERED","RECEIVED"), tr("DRAFT","CANCELLED"), tr("ORDERED","CANCELLED")]),

    e("goods_receipt", "Goods Receipt", "Goods Receipts", "goods-receipts", "archive",
      [f("po_ref",             "Purchase Order",  "ref",      True,  target="purchase_order"),
       f("received_at",        "Received",        "datetime", True),
       f("received_by",        "Received By",     "ref",             target="user"),
       f("notes",              "Notes",           "textarea"),
       f("condition",          "Condition",       "select",   options=["good","damaged","partial"]),
       f("quantity_received",  "Qty Received",    "number")]),

    e("asset", "Asset", "Assets", "assets", "package",
      [f("tag",            "Asset Tag",     "text",  True),
       f("name",           "Name",          "text",  True),
       f("kind",           "Kind",          "select", options=["network_equipment","vehicle","office_equipment","tool","other"]),
       f("serial",         "Serial #",      "text"),
       f("model",          "Model",         "text"),
       f("purchase_date",  "Purchase Date", "date"),
       f("purchase_price", "Purchase Price","money"),
       f("book_value",     "Book Value",    "money"),
       f("location",       "Location",      "text"),
       f("assigned_to",    "Assigned To",   "ref",          target="user"),
       f("warranty_until", "Warranty Until","date"),
       f("notes",          "Notes",         "textarea")],
      [st("ACTIVE","Active",True), st("RETIRED","Retired"), st("WRITTEN_OFF","Written Off")],
      [tr("ACTIVE","RETIRED"), tr("ACTIVE","WRITTEN_OFF"), tr("RETIRED","WRITTEN_OFF")]),

    e("vehicle", "Vehicle", "Fleet / Vehicles", "vehicles", "truck",
      [f("plate",            "Plate Number",     "text",   True),
       f("model",            "Model",            "text",   True),
       f("make",             "Make",             "text"),
       f("year",             "Year",             "number"),
       f("vin",              "VIN",              "text"),
       f("driver",           "Default Driver",   "ref",          target="user"),
       f("insurance_until",  "Insurance Until",  "date"),
       f("technical_until",  "Tech Inspection",  "date"),
       f("mileage",          "Mileage (km)",     "number"),
       f("fuel_type",        "Fuel",             "select", options=["petrol","diesel","electric","hybrid"]),
       f("notes",            "Notes",            "text")],
      [st("AVAILABLE","Available",True), st("IN_USE","In Use"), st("MAINTENANCE","Maintenance"), st("RETIRED","Retired")],
      [tr("AVAILABLE","IN_USE"), tr("IN_USE","AVAILABLE"), tr("AVAILABLE","MAINTENANCE"), tr("MAINTENANCE","AVAILABLE"), tr("AVAILABLE","RETIRED")]),

    # ═══════════════════════════════════════════════════════════════════
    # FINANCE
    # ═══════════════════════════════════════════════════════════════════

    e("expense", "Expense", "Expenses", "expenses", "dollar",
      [f("description", "Description",  "text",   True),
       f("amount",      "Amount",       "money",  True),
       f("category",    "Category",     "select", True,  options=["travel","equipment","software","meals","training","other"]),
       f("submitted_by","Submitted By", "ref",           target="user"),
       f("approved_by", "Approved By",  "ref",           target="user"),
       f("receipt_url", "Receipt URL",  "text"),
       f("expense_date","Date",         "date"),
       f("project",     "Project",      "ref",           target="project")],
      [st("SUBMITTED","Submitted",True), st("APPROVED","Approved"), st("REJECTED","Rejected"), st("PAID","Paid")],
      [tr("SUBMITTED","APPROVED"), tr("SUBMITTED","REJECTED"), tr("APPROVED","PAID")]),

    e("budget", "Budget", "Budgets", "budgets", "receipt",
      [f("name",       "Name",        "text",  True),
       f("period",     "Period",      "text",  True),
       f("department", "Department",  "ref",          target="department"),
       f("amount",     "Total Budget","money", True),
       f("spent",      "Spent",       "money"),
       f("remaining",  "Remaining",   "money"),
       f("owner",      "Owner",       "ref",          target="user"),
       f("notes",      "Notes",       "textarea")]),

    e("vendor_payment", "Vendor Payment", "Vendor Payments", "vendor-payments", "building",
      [f("supplier",        "Supplier",       "ref",    True,  target="supplier"),
       f("purchase_order",  "Purchase Order", "ref",          target="purchase_order"),
       f("amount",          "Amount",         "money",  True),
       f("due_date",        "Due Date",       "date",   True),
       f("paid_date",       "Paid Date",      "date"),
       f("payment_method",  "Method",         "select", options=["bank_transfer","cash","card"]),
       f("reference",       "Reference #",    "text"),
       f("notes",           "Notes",          "text")],
      [st("PENDING","Pending",True), st("PAID","Paid"), st("OVERDUE","Overdue"), st("DISPUTED","Disputed")],
      [tr("PENDING","PAID"), tr("PENDING","OVERDUE"), tr("PENDING","DISPUTED"), tr("DISPUTED","PAID")]),

    # ═══════════════════════════════════════════════════════════════════
    # HR & PEOPLE
    # ═══════════════════════════════════════════════════════════════════

    e("employee", "Employee", "Employees", "employees", "users",
      [f("name",        "Full Name",    "text",  True),
       f("email",       "Work Email",   "email", True),
       f("phone",       "Phone",        "phone"),
       f("title",       "Job Title",    "text"),
       f("department",  "Department",   "ref",          target="department"),
       f("manager",     "Manager",      "ref",          target="employee"),
       f("hire_date",   "Hire Date",    "date"),
       f("birth_date",  "Date of Birth","date"),
       f("id_number",   "ID/Passport",  "text"),
       f("salary",      "Salary",       "money"),
       f("bank_account","Bank Account", "text"),
       f("address",     "Address",      "text")],
      [st("ACTIVE","Active",True), st("ON_LEAVE","On Leave"), st("TERMINATED","Terminated")],
      [tr("ACTIVE","ON_LEAVE"), tr("ON_LEAVE","ACTIVE"), tr("ACTIVE","TERMINATED")]),

    e("department", "Department", "Departments", "departments", "building",
      [f("name",       "Name",          "text",  True),
       f("code",       "Code",          "text"),
       f("head",       "Department Head","ref",         target="user"),
       f("parent_dept","Parent Dept",   "ref",          target="department"),
       f("cost_center","Cost Center",   "text"),
       f("headcount",  "Headcount",     "number")]),

    e("leave_request", "Leave Request", "Leave Requests", "leave-requests", "calendar",
      [f("employee",    "Employee",    "ref",    True,  target="employee"),
       f("kind",        "Type",        "select", True,  options=["annual","sick","unpaid","maternity","paternity","bereavement"]),
       f("from_date",   "From",        "date",   True),
       f("to_date",     "To",          "date",   True),
       f("days",        "Days",        "number"),
       f("reason",      "Reason",      "textarea"),
       f("approved_by", "Approved By", "ref",           target="user")],
      [st("PENDING","Pending",True), st("APPROVED","Approved"), st("REJECTED","Rejected"), st("CANCELLED","Cancelled")],
      [tr("PENDING","APPROVED"), tr("PENDING","REJECTED"), tr("APPROVED","CANCELLED")]),

    e("payroll_run", "Payroll Run", "Payroll Runs", "payroll-runs", "dollar",
      [f("period",         "Period",       "text",  True),
       f("total",          "Total Amount", "money", True),
       f("employee_count", "Employees",    "number"),
       f("run_by",         "Run By",       "ref",          target="user"),
       f("approved_by",    "Approved By",  "ref",          target="user"),
       f("payment_date",   "Payment Date", "date"),
       f("notes",          "Notes",        "textarea")],
      [st("DRAFT","Draft",True), st("REVIEWED","Reviewed"), st("APPROVED","Approved"), st("PROCESSED","Processed")],
      [tr("DRAFT","REVIEWED"), tr("REVIEWED","APPROVED"), tr("APPROVED","PROCESSED")]),

    e("candidate", "Candidate", "Recruitment", "candidates", "users",
      [f("name",           "Full Name",     "text",   True),
       f("email",          "Email",         "email",  True),
       f("phone",          "Phone",         "phone"),
       f("role",           "Role Applied",  "text",   True),
       f("department",     "Department",    "ref",           target="department"),
       f("source",         "Source",        "select", options=["referral","linkedin","job_board","website","agency"]),
       f("cv_url",         "CV URL",        "text"),
       f("notes",          "Notes",         "textarea"),
       f("interview_date", "Interview Date","datetime")],
      [st("APPLIED","Applied",True), st("SCREENING","Screening"), st("INTERVIEW","Interview"), st("OFFER","Offer"), st("HIRED","Hired"), st("REJECTED","Rejected")],
      [tr("APPLIED","SCREENING"), tr("SCREENING","INTERVIEW"), tr("INTERVIEW","OFFER"), tr("OFFER","HIRED"), tr("SCREENING","REJECTED"), tr("INTERVIEW","REJECTED"), tr("OFFER","REJECTED")]),

    e("performance_review", "Performance Review", "Performance Reviews", "performance-reviews", "chart",
      [f("employee",        "Employee",        "ref",      True,  target="employee"),
       f("period",          "Period",          "text",     True),
       f("reviewer",        "Reviewer",        "ref",             target="user"),
       f("rating",          "Overall Rating",  "number",   True),
       f("goals_achieved",  "Goals Achieved",  "textarea"),
       f("strengths",       "Strengths",       "textarea"),
       f("improvements",    "Areas to Improve","textarea"),
       f("next_goals",      "Next Period Goals","textarea")],
      [st("DRAFT","Draft",True), st("SUBMITTED","Submitted"), st("ACKNOWLEDGED","Acknowledged"), st("FINAL","Final")],
      [tr("DRAFT","SUBMITTED"), tr("SUBMITTED","ACKNOWLEDGED"), tr("ACKNOWLEDGED","FINAL")]),

    e("training_course", "Training Course", "Training", "training-courses", "bookmark",
      [f("title",            "Title",         "text",  True),
       f("provider",         "Provider",      "text"),
       f("category",         "Category",      "select", options=["technical","soft_skills","compliance","management"]),
       f("hours",            "Duration (hrs)","number"),
       f("cost",             "Cost",          "money"),
       f("scheduled_at",     "Scheduled",     "datetime"),
       f("max_participants", "Max Participants","number"),
       f("notes",            "Notes",         "textarea")],
      [st("PLANNED","Planned",True), st("OPEN","Open"), st("IN_PROGRESS","In Progress"), st("COMPLETED","Completed"), st("CANCELLED","Cancelled")],
      [tr("PLANNED","OPEN"), tr("OPEN","IN_PROGRESS"), tr("IN_PROGRESS","COMPLETED"), tr("PLANNED","CANCELLED")]),

    # ═══════════════════════════════════════════════════════════════════
    # COMMUNICATIONS
    # ═══════════════════════════════════════════════════════════════════

    e("email_template", "Email Template", "Email Templates", "email-templates", "mail",
      [f("name",      "Name",       "text",     True),
       f("category",  "Category",   "select",   options=["billing","support","marketing","system"]),
       f("subject",   "Subject",    "text",     True),
       f("body",      "Body (HTML)","textarea", True),
       f("variables", "Variables",  "text")]),

    e("sms_template", "SMS Template", "SMS Templates", "sms-templates", "message",
      [f("name",       "Name",      "text",     True),
       f("category",   "Category",  "select",   options=["billing","support","marketing","otp","alert"]),
       f("body",       "Message",   "textarea", True),
       f("char_count", "Char Count","number")]),

    e("broadcast_campaign", "Broadcast Campaign", "Broadcast Campaigns", "broadcast-campaigns", "mail",
      [f("name",             "Name",           "text",     True),
       f("channel",          "Channel",        "select",   True, options=["email","sms"]),
       f("subject",          "Subject",        "text"),
       f("body",             "Message",        "textarea", True),
       f("target_segment",   "Segment",        "ref",            target="segment"),
       f("scheduled_at",     "Send At",        "datetime"),
       f("sender_name",      "Sender Name",    "text"),
       f("recipient_count",  "Recipients",     "number")],
      [st("DRAFT","Draft",True), st("SCHEDULED","Scheduled"), st("SENT","Sent"), st("CANCELLED","Cancelled")],
      [tr("DRAFT","SCHEDULED"), tr("SCHEDULED","SENT"), tr("DRAFT","SENT"), tr("SCHEDULED","CANCELLED")]),

    # ═══════════════════════════════════════════════════════════════════
    # DOCUMENTS
    # ═══════════════════════════════════════════════════════════════════

    e("document", "Document", "Documents", "documents", "folder",
      [f("name",        "Name",          "text",  True),
       f("kind",        "Type",          "select", options=["contract","invoice","certificate","permit","policy","other"]),
       f("url",         "File URL",      "text"),
       f("customer",    "Customer",      "ref",          target="customer"),
       f("expiry_date", "Expiry Date",   "date"),
       f("uploaded_by", "Uploaded By",   "ref",          target="user"),
       f("notes",       "Notes",         "text")],
      [st("DRAFT","Draft",True), st("ACTIVE","Active"), st("EXPIRED","Expired"), st("ARCHIVED","Archived")],
      [tr("DRAFT","ACTIVE"), tr("ACTIVE","EXPIRED"), tr("ACTIVE","ARCHIVED")]),

    e("document_template", "Document Template", "Document Templates", "document-templates", "edit",
      [f("name",      "Name",     "text",     True),
       f("category",  "Category", "select",   options=["contract","quote","invoice","letter","notice"]),
       f("body",      "Template", "textarea", True),
       f("variables", "Variables","text"),
       f("owner",     "Owner",    "ref",             target="user")],
      [st("DRAFT","Draft",True), st("ACTIVE","Active"), st("ARCHIVED","Archived")],
      [tr("DRAFT","ACTIVE"), tr("ACTIVE","ARCHIVED")]),

    # ═══════════════════════════════════════════════════════════════════
    # PROJECTS
    # ═══════════════════════════════════════════════════════════════════

    e("project", "Project", "Projects", "projects", "layers",
      [f("name",        "Name",         "text",     True),
       f("description", "Description",  "textarea"),
       f("owner",       "Project Manager","ref",    True,  target="user"),
       f("start_date",  "Start",        "date"),
       f("due_date",    "Due",          "date"),
       f("budget",      "Budget",       "money"),
       f("customer",    "Customer",     "ref",             target="customer"),
       f("priority",    "Priority",     "select",   options=["low","normal","high","critical"])],
      [st("PLANNING","Planning",True), st("ACTIVE","Active"), st("ON_HOLD","On Hold"), st("DONE","Done"), st("CANCELLED","Cancelled")],
      [tr("PLANNING","ACTIVE"), tr("ACTIVE","ON_HOLD"), tr("ON_HOLD","ACTIVE"), tr("ACTIVE","DONE"), tr("ACTIVE","CANCELLED")]),

    e("milestone", "Milestone", "Milestones", "milestones", "arrow-right",
      [f("project",        "Project",      "ref",    True,  target="project"),
       f("name",           "Name",         "text",   True),
       f("description",    "Description",  "textarea"),
       f("due_date",       "Due",          "date",   True),
       f("owner",          "Owner",        "ref",           target="user"),
       f("completion_pct", "Completion %", "number")],
      [st("OPEN","Open",True), st("IN_PROGRESS","In Progress"), st("DONE","Done"), st("MISSED","Missed")],
      [tr("OPEN","IN_PROGRESS"), tr("IN_PROGRESS","DONE"), tr("IN_PROGRESS","MISSED")]),

    e("risk", "Risk", "Risks", "risks", "inbox",
      [f("title",      "Title",      "text",     True),
       f("project",    "Project",    "ref",             target="project"),
       f("likelihood", "Likelihood", "select",   True,  options=["low","medium","high"]),
       f("impact",     "Impact",     "select",   True,  options=["low","medium","high"]),
       f("score",      "Risk Score", "number"),
       f("owner",      "Owner",      "ref",             target="user"),
       f("mitigation", "Mitigation", "textarea"),
       f("due_date",   "Review Date","date")],
      [st("OPEN","Open",True), st("MITIGATED","Mitigated"), st("ACCEPTED","Accepted"), st("CLOSED","Closed")],
      [tr("OPEN","MITIGATED"), tr("OPEN","ACCEPTED"), tr("MITIGATED","CLOSED"), tr("ACCEPTED","CLOSED")]),

    # ═══════════════════════════════════════════════════════════════════
    # LEGAL & COMPLIANCE
    # ═══════════════════════════════════════════════════════════════════

    e("legal_case", "Legal Case", "Legal Cases", "legal-cases", "archive",
      [f("title",        "Title",         "text",     True),
       f("case_number",  "Case #",        "text"),
       f("counterparty", "Counterparty",  "text",     True),
       f("category",     "Category",      "select",   options=["debt_recovery","regulatory","employment","contract","other"]),
       f("lawyer",       "Lawyer/Firm",   "text"),
       f("court",        "Court",         "text"),
       f("filing_date",  "Filed",         "date"),
       f("hearing_date", "Next Hearing",  "date"),
       f("amount_claim", "Amount in Dispute","money"),
       f("detail",       "Detail",        "textarea")],
      [st("OPEN","Open",True), st("IN_PROGRESS","In Progress"), st("SETTLED","Settled"), st("WON","Won"), st("LOST","Lost"), st("CLOSED","Closed")],
      [tr("OPEN","IN_PROGRESS"), tr("IN_PROGRESS","SETTLED"), tr("IN_PROGRESS","WON"), tr("IN_PROGRESS","LOST"), tr("SETTLED","CLOSED"), tr("WON","CLOSED"), tr("LOST","CLOSED")]),

    e("policy", "Policy", "Policies", "policies", "bookmark",
      [f("name",           "Name",          "text",     True),
       f("category",       "Category",      "select",   options=["HR","IT","security","compliance","operational"]),
       f("body",           "Content",       "textarea", True),
       f("owner",          "Owner",         "ref",             target="user"),
       f("effective_date", "Effective Date","date"),
       f("review_date",    "Review Date",   "date"),
       f("version",        "Version",       "text")],
      _DRAFT_FLOW,
      [tr("DRAFT","ACTIVE"), tr("ACTIVE","ARCHIVED")]),

    e("consent_record", "Consent Record", "Consent Records", "consent-records", "shield",
      [f("customer",    "Customer",   "ref",      True,  target="customer"),
       f("purpose",     "Purpose",    "text",     True),
       f("granted",     "Granted",    "boolean",  True),
       f("granted_at",  "Granted At", "datetime"),
       f("revoked_at",  "Revoked At", "datetime"),
       f("method",      "Method",     "select",   options=["web","paper","verbal","email"]),
       f("notes",       "Notes",      "text")]),

    e("legal_hold", "Legal Hold", "Legal Holds", "legal-holds", "lock",
      [f("name",        "Name",       "text",     True),
       f("scope",       "Scope",      "textarea", True),
       f("case_ref",    "Legal Case", "ref",             target="legal_case"),
       f("placed_by",   "Placed By",  "ref",             target="user"),
       f("placed_at",   "Placed",     "datetime"),
       f("released_at", "Released",   "datetime")],
      [st("ACTIVE","Active",True), st("RELEASED","Released")],
      [tr("ACTIVE","RELEASED")]),

    e("compliance_rule", "Compliance Rule", "Compliance Rules", "compliance-rules", "shield",
      [f("name",        "Name",         "text",     True),
       f("regulation",  "Regulation",   "text"),
       f("requirement", "Requirement",  "textarea", True),
       f("owner",       "Owner",        "ref",             target="user"),
       f("review_date", "Review Date",  "date"),
       f("status_note", "Compliance Note","textarea")]),

    e("risk_register", "Risk Register Entry", "Risk Registers", "risk-registers", "inbox",
      [f("title",      "Title",    "text",   True),
       f("category",   "Category", "select", options=["operational","financial","legal","technical","reputational"]),
       f("owner",      "Owner",    "ref",    True,  target="user"),
       f("likelihood", "Likelihood","select", options=["low","medium","high"]),
       f("impact",     "Impact",   "select", options=["low","medium","high"]),
       f("score",      "Score",    "number"),
       f("mitigation", "Mitigation","textarea"),
       f("review_date","Review Date","date")],
      [st("IDENTIFIED","Identified",True), st("ASSESSED","Assessed"), st("MITIGATED","Mitigated"), st("ACCEPTED","Accepted"), st("CLOSED","Closed")],
      [tr("IDENTIFIED","ASSESSED"), tr("ASSESSED","MITIGATED"), tr("ASSESSED","ACCEPTED"), tr("MITIGATED","CLOSED"), tr("ACCEPTED","CLOSED")]),

    # ═══════════════════════════════════════════════════════════════════
    # ADMINISTRATION
    # ═══════════════════════════════════════════════════════════════════

    e("sla_policy", "SLA Policy", "SLA Policies", "sla-policies", "clock",
      [f("name",                "Name",              "text",    True),
       f("priority",            "Applies To Priority","select", options=["low","normal","high","critical"]),
       f("response_mins",       "First Response (min)","number",True),
       f("resolve_mins",        "Resolution (min)",  "number",  True),
       f("business_hours_only", "Business Hours Only","boolean"),
       f("escalate_after_mins", "Escalate After (min)","number")]),

    e("routing_rule", "Routing Rule", "Routing Rules", "routing-rules", "arrow-right",
      [f("name",         "Name",        "text",    True),
       f("condition",    "Condition",   "textarea",True),
       f("target_queue", "Target Queue","text"),
       f("target_user",  "Assign To",   "ref",            target="user"),
       f("priority",     "Priority",    "number"),
       f("is_active",    "Active",      "boolean")]),

    e("notification_rule", "Notification Rule", "Notification Rules", "notification-rules", "mail",
      [f("name",           "Name",          "text",    True),
       f("event",          "Trigger Event", "text",    True),
       f("channel",        "Channel",       "select",  True, options=["email","sms","inapp","push"]),
       f("template",       "Template",      "text"),
       f("recipient_type", "Recipient",     "select",  options=["customer","assigned_user","admin","all"]),
       f("condition",      "Condition",     "text"),
       f("is_active",      "Active",        "boolean")]),

    e("integration", "Integration", "Integrations", "integrations", "layers",
      [f("name",      "Name",       "text",    True),
       f("kind",      "Type",       "select",  True, options=["payment_gateway","sms_provider","email_provider","crm","erp","billing","other"]),
       f("base_url",  "Base URL",   "text"),
       f("auth_type", "Auth Type",  "select",  options=["api_key","oauth2","basic","hmac"]),
       f("config_json","Configuration","textarea"),
       f("is_active", "Active",     "boolean")],
      [st("ENABLED","Enabled",True), st("DISABLED","Disabled")],
      [tr("ENABLED","DISABLED"), tr("DISABLED","ENABLED")]),

    # ═══════════════════════════════════════════════════════════════════
    # SELF-SERVICE (employee "My Requests" catalog)
    # ═══════════════════════════════════════════════════════════════════

    e("request", "Request", "My Requests", "requests", "inbox",
      [f("request_type", "Request Type", "select", True, options=[
          "Time Off · Vacation request", "Time Off · Day-off request", "Time Off · Sick leave",
          "Time Off · Unpaid leave", "Time Off · Remote / WFH request", "Time Off · Schedule change",
          "Time Off · Overtime declaration", "Time Off · Business trip request",
          "Finance · Salary advance", "Finance · Expense reimbursement",
          "Finance · Payslip / income certificate", "Finance · Compensation inquiry",
          "IT & Access · Equipment request", "IT & Access · Access / permission request",
          "IT & Access · Password reset / account unlock", "IT & Access · Software / license request",
          "IT & Access · Hardware repair",
          "Administrative · Employment certificate / reference letter",
          "Administrative · Personal data update", "Administrative · Workspace request",
          "Administrative · Corporate SIM / signature / card",
          "Development · Training request", "Development · Internal transfer request",
          "Development · Performance review request", "Development · Grievance / complaint",
       ]),
       f("subject",      "Subject",    "text",     True),
       f("details",      "Details",    "textarea"),
       f("priority",     "Priority",   "select",   options=["Low","Normal","High","Urgent"]),
       f("submitted_by", "Submitted By","ref",            target="user"),
       f("assigned_to",  "Assigned To","ref",             target="user"),
       f("sla_due",      "SLA Due",    "datetime"),
       f("resolution",   "Resolution", "textarea")],
      [st("DRAFT","Draft",True), st("OPEN","Open"), st("IN_REVIEW","In Review"),
       st("APPROVED","Approved"), st("REJECTED","Rejected"), st("CLOSED","Closed")],
      [tr("DRAFT","OPEN"), tr("OPEN","IN_REVIEW"), tr("IN_REVIEW","APPROVED"),
       tr("IN_REVIEW","REJECTED"), tr("APPROVED","CLOSED"), tr("REJECTED","CLOSED")]),

    # Employee benefits catalog (My Profile → My Benefits) — informational reference content,
    # no lifecycle (it's read-only company-provided perks; rows are seeded, not employee-created).
    e("benefit", "Benefit", "Benefits", "benefits", "briefcase",
      [f("title",  "Title",  "text", True),
       f("value",  "Value",  "text"),
       f("note",   "Note",   "text"),
       f("detail", "Detail", "textarea")]),
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
    # Root-cause guard: `seed_access_if_empty` (run earlier in main.py lifespan) also creates
    # PermissionDefs for the `request` entity via build_access_config. Without this check, the
    # catalog seed would re-insert request.{view,create,edit,delete} for the same tenant and
    # hit `uq_permission_def_key (tenant_id, key)`. We check-before-insert per key.
    perm_keys = [f'{spec["key"]}.{verb}' for verb in ("view", "create", "edit", "delete")]
    existing_keys = set((await s.execute(
        select(PermissionDef.key).where(
            PermissionDef.tenant_id == tenant_id,
            PermissionDef.key.in_(perm_keys),
        )
    )).scalars().all())
    new_perms = [
        {"tenant_id": tenant_id, "key": k, "label": f'{k.split(".", 1)[1]} {spec["key"]}', "group": spec["key"]}
        for k in perm_keys if k not in existing_keys
    ]
    if new_perms:
        await s.execute(
            pg_insert(PermissionDef).values(new_perms).on_conflict_do_nothing(
                index_elements=["tenant_id", "key"]
            )
        )
    return True


async def seed_catalog_if_missing() -> int:
    """Create every catalog entity for every tenant that doesn't already have it. Idempotent."""
    created = 0
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
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
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            if await _create_entity(s, t.id, spec):
                created += 1
        await s.commit()
    return created


if __name__ == "__main__":
    import asyncio
    print("catalog entities created:", asyncio.run(seed_catalog_if_missing()))
