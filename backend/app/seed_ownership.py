"""Step 3 ownership-matrix seeder — backfills `entity_def.owner_module` from SPEC §2.2.

SPEC reference: `GAAex_Cross_Module_Architecture_SPEC.md` §2 Ownership Model, especially the §2.2
Ownership Matrix. Every record kind has exactly one owner module (invariant #1, SPEC §0.1). The
kernel facade `app.kernel.assert_writer_owns_record` enforces it at the application layer by
looking up `entity_def.owner_module`; until that column is populated, the facade is a no-op. This
module is the populator.

Idempotent:
    - For every `EntityDef` matching a §2.2 record, SET `owner_module` IF currently NULL.
    - NEVER overrides an existing non-NULL value (Studio edits / manual overrides survive
      subsequent boots).
    - Safe to re-run on every cold start; cheap (one SELECT + ≤N UPDATEs).

Coverage:
    - SPEC §2.2 has 37 records. About 30 of them have a 1:1 EntityDef row in the demo seed or the
      catalog (see `seed.py::build_crm_entities` + `seed_catalog.py::ENTITY_CATALOG`).
    - A handful of SPEC §2.2 records are FIRST-CLASS TABLES (Invoice, Credit Note, Payment,
      Collection Case, Billing Account, Service, Order, Work Order, Workflow Instance, AI Insight),
      not config-driven entities. Those rows don't exist as `entity_def` rows and never will — they
      live in their own typed tables (`invoice`, `payment`, `"order"`, `service`, `workitem`, ...).
      Single-owner enforcement on those tables is a separate code path (a first-class ownership
      map) and lands in a later step. For each SPEC record with no matching `entity_def`, we log a
      WARNING listing what we couldn't apply — but we DO NOT fail.

Call site:
    `backend/app/main.py` lifespan, after every other seeder (entity_def rows must exist first).
"""
from __future__ import annotations

import logging

from sqlalchemy import select, update

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import EntityDef


_log = logging.getLogger("gaaex.seed_ownership")


# SPEC §2.2 record → owner_module string.
#
# Source of truth = SPEC §2.2 Ownership Matrix (lines 116-154 of
# `GAAex_Cross_Module_Architecture_SPEC.md`). The owner_module strings are taken VERBATIM from the
# matrix's "Owner Module" column (parenthetical qualifiers like "(Billing & Revenue)" and
# "(Employees)" are preserved). Any reskinning of module names goes through this file.
#
# Each row maps a SPEC record name to:
#   (entity_def.key candidates, owner_module)
#
# The first key in the candidate tuple that resolves to a real EntityDef row wins. Multiple keys
# are listed when the GAAex codebase has used different identifiers for the same SPEC record (e.g.
# "ticket" in the baseline CRM seed vs. "helpdesk_ticket" in the helpdesk model).
#
# When NO candidate resolves for a given tenant, the SPEC record is reported as "first-class /
# unmapped" — Step 4+ handles those via a separate first-class ownership table.
SPEC_OWNERSHIP_MATRIX: list[tuple[str, tuple[str, ...], str]] = [
    # (SPEC record name, candidate entity_def.key tuple, owner_module)
    ("Customer",           ("customer",),                       "Customers"),
    ("Contact",            ("contact",),                        "Customers"),
    ("Lead",               ("lead",),                           "Pipeline"),
    ("Pipeline Item",      ("pipeline_item", "deal", "opportunity"), "Pipeline"),
    ("Contract",           ("contract",),                       "Contracts"),
    ("Coverage Check",     ("coverage_check",),                 "Coverage & GIS"),
    ("Order",              ("order",),                          "Orders (Billing & Revenue)"),
    ("Task",               ("task",),                           "Tasks"),
    ("Ticket",             ("helpdesk_ticket", "ticket"),       "Tickets"),
    ("Project",            ("project",),                        "Projects"),
    ("Invoice",            ("invoice",),                        "Invoices"),
    ("Credit Note",        ("credit_note",),                    "Invoices"),
    ("Payment",            ("payment",),                        "Payments"),
    ("Collection Case",    ("collection_case",),                "Collections"),
    ("Billing Account",    ("billing_account",),                "Billing Accounts"),
    ("Service",            ("service",),                        "Service Inventory"),
    ("Work Order",         ("work_order", "workitem"),          "Work Orders"),
    ("Asset",              ("asset",),                          "Asset Management"),
    ("Resource",           ("resource",),                       "Resource Inventory"),
    ("Stock Item",         ("stock_item",),                     "Stock Inventory"),
    ("Communication",      ("communication", "interaction"),    "Communications"),
    ("Document",           ("document",),                       "Document Management"),
    ("Knowledge Article",  ("kb_article", "knowledge_article"), "Knowledge Base"),
    ("Campaign",           ("campaign",),                       "Campaigns"),
    ("Calendar Event",     ("calendar_event",),                 "Calendar"),
    ("Announcement",       ("announcement",),                   "Announcements"),
    ("SLA Policy",         ("sla_policy",),                     "SLA Management"),
    ("Incident / Outage",  ("incident", "outage"),              "Incidents & Outages"),
    ("Alarm",              ("alarm",),                          "Network Monitoring"),
    ("Tariff Plan",        ("tariff_plan",),                    "Tariff Plans"),
    ("Product",            ("product",),                        "Product Catalog"),
    ("Employee",           ("employee",),                       "HR (Employees)"),
    ("Vendor",             ("vendor", "supplier"),              "Procurement"),
    ("Purchase Order",     ("purchase_order",),                 "Procurement"),
    ("Report",             ("report",),                         "Reports"),
    ("AI Insight",         ("ai_insight",),                     "AI Insights"),
    ("Workflow Instance",  ("workflow_instance",),              "Workflow Engine"),
]


async def seed_ownership_matrix_if_empty() -> int:
    """Backfill `entity_def.owner_module` per SPEC §2.2.

    For every tenant × every SPEC §2.2 record, look up the first matching EntityDef (by key
    candidate list) and SET `owner_module` IF the column is currently NULL. Existing non-NULL
    values are NEVER overwritten — Studio edits and manual overrides survive subsequent boots.

    Returns the count of EntityDef rows actually updated. SPEC records with no matching EntityDef
    (the first-class records: Invoice, Payment, Order, Service, Work Order, etc.) are collected
    and logged as a single WARNING per tenant — they're handled by a separate first-class
    ownership map in Step 4+, not here.
    """
    updated_total = 0
    async with SessionLocal() as s:
        # Load every existing EntityDef once — single SELECT covers all tenants and all keys.
        rows = (await s.execute(select(EntityDef.id, EntityDef.tenant_id, EntityDef.key,
                                       EntityDef.owner_module))).all()
        if not rows:
            _log.info("seed_ownership: no entity_def rows present — nothing to backfill")
            return 0

        # Index: tenant_id -> {key: (id, owner_module)}
        by_tenant: dict = {}
        for row_id, tenant_id, key, owner_module in rows:
            by_tenant.setdefault(tenant_id, {})[key] = (row_id, owner_module)

        for tenant_id, tenant_rows in by_tenant.items():
            unmapped: list[str] = []
            for spec_name, candidates, owner_module in SPEC_OWNERSHIP_MATRIX:
                # Find the first candidate key that exists for THIS tenant.
                hit = next((tenant_rows[k] for k in candidates if k in tenant_rows), None)
                if hit is None:
                    unmapped.append(spec_name)
                    continue
                row_id, existing_owner = hit
                if existing_owner:
                    # Honor manual overrides — Studio edits survive boot.
                    continue
                await s.execute(
                    update(EntityDef)
                    .where(EntityDef.id == row_id)
                    .values(owner_module=owner_module)
                )
                updated_total += 1

            if unmapped:
                # Expected for SPEC records that are first-class tables (Invoice, Payment, etc.).
                # WARN so it's visible in boot logs but DON'T fail — Step 4+ handles those.
                _log.warning(
                    "seed_ownership: tenant %s — %d SPEC §2.2 record(s) have no matching "
                    "entity_def row (first-class tables / not yet defined): %s",
                    tenant_id, len(unmapped), ", ".join(unmapped),
                )

        await s.commit()
    _log.info("seed_ownership: backfilled owner_module on %d entity_def row(s)", updated_total)
    return updated_total


if __name__ == "__main__":
    import asyncio
    print("owner_module rows updated:", asyncio.run(seed_ownership_matrix_if_empty()))
