"""List-presentation preset seeder — page_config ListPreset for config-driven entity list pages.

Every entity LIST page (EntityView) renders from a per-(tenant, page_key=slug) page_config descriptor
stored under ``config.list`` (the ListPreset). This is what lets Leads and Orders share ONE generic
renderer with ZERO per-entity code in the frontend — their look IS this config. The Leads preset below
reproduces the bespoke Leads table exactly (borderless flat grid, the five curated columns + widths,
Table/Kanban/Cards switcher, kanban stages, card chips); Orders mirrors the same style with its own
columns/stages.

These presets are CANONICAL / code-owned (the source of truth for the Leads/Orders look), so the
seeder UPSERTS them — definition changes here apply on the next startup. (When superadmin in-place
editing of these pages lands, revisit to merge rather than overwrite.)
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models.tenant import Tenant
from .models.page_config import PageConfig

_log = logging.getLogger("gaahex.seed_list_presets")

# Column widths + kanban stage keys here reproduce the prior hardcoded Leads look 1:1. Stage labels are
# NOT stored here — the frontend resolves them from def.statuses (the SST), so they can never drift.
PRESETS: dict[str, dict] = {
    "leads": {"list": {
        "flat": True,
        "viewModes": ["table", "kanban", "cards"],
        "defaultView": "table",
        "recentLimit": 20,
        "statusHeader": "Stage",
        "idPrefix": "LED-",
        "columns": [
            {"key": "ref",     "label": "Lead ID",   "role": "id",      "width": 120},
            {"key": "name",    "label": "Full Name", "role": "primary", "width": 200},
            {"key": "address", "label": "Address",   "role": "plain",   "width": 220},
            {"key": "phone",   "label": "Phone",     "role": "plain",   "width": 150},
            {"key": "email",   "label": "Email",     "role": "plain",   "width": 210},
        ],
        "stageWidth": 180,
        "kanbanStages": ["LEAD", "VALIDATED_LEAD", "ASSIGNED", "DEAL", "CONTRACT_SIGNED", "ORDER_CREATED"],
        "cardChips": ["phone", "email", "address"],
    }},
    "orders": {"list": {
        "flat": True,
        "viewModes": ["table", "kanban", "cards"],
        "defaultView": "table",
        "recentLimit": 20,
        "statusHeader": "Stage",
        "columns": [
            {"key": "number",   "label": "Order ID", "role": "id",      "width": 120},
            {"key": "customer", "label": "Customer", "role": "primary", "width": 220},
            {"key": "total",    "label": "Total",    "role": "plain",   "width": 150},
        ],
        "stageWidth": 180,
        "kanbanStages": ["ORDER_VALIDATED", "SCHEDULING", "CONFIG",
                         "INSTALLATION", "CONNECTION_TEST", "PAYMENT_CONFIRMED", "ACTIVATION"],
        "cardChips": ["total"],
    }},
}


async def seed_list_presets_if_missing() -> dict:
    """Insert a page_config ListPreset for each pipeline entity per tenant, if not already present."""
    inserted = 0
    async with SessionLocal() as s:
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
        tenants = (await s.execute(select(Tenant))).scalars().all()
        for t in tenants:
            for page_key, config in PRESETS.items():
                existing = (await s.execute(
                    select(PageConfig).where(
                        PageConfig.tenant_id == t.id, PageConfig.page_key == page_key
                    )
                )).scalar_one_or_none()
                # Canonical, code-owned presets → upsert (overwrite) so definition changes apply.
                if existing is None:
                    s.add(PageConfig(tenant_id=t.id, page_key=page_key, config=config))
                    inserted += 1
                elif existing.config != config:
                    existing.config = config
                    inserted += 1
        await s.commit()
    _log.info("seed_list_presets: inserted %d page_config preset(s) across all tenants", inserted)
    return {"presets": inserted}
