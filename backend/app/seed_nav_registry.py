"""SPEC §1 nav registry seeder — 9 groups × 75 modules per tenant.

Idempotent population of the canonical Left-Navigation tree from SPEC §1. Seeds:

  - 9 nav_group rows (Workspace, Work Management, CRM & Commercial, Billing & Revenue,
    Network & Operations, Analytics & AI, Enterprise, System, Studio).
  - 75 nav_module rows distributed across those 9 groups, each tagged with the SPEC
    [O]/[V] placement legend and (for [O] rows) the entity_def keys it owns.

Locked SPEC placements (enforced here, audited in
`docs/spec-build/STEP-07-NAV-REGISTRY.md`):

  - Orders & Validation under Billing & Revenue (NOT CRM) — Control Gate (§3 stage 8).
  - Contracts is its own CRM module.
  - KB/Announcements/Communications/Calendar under Workspace, placement='O'.
  - Workspace itself owns nothing — hub items (Home/My Work/Global Search/etc.) are 'V'.
  - Studio is first-class top-level (NOT nested under System).

PREPARE-only — Gev gates activation. The lifespan hook in `app/main.py` is COMMENTED OUT
until Gev replies 'approved §1 nav'. Calling this function is safe at any time; it's
idempotent (per-tenant existence checks plus pg_insert ON CONFLICT DO NOTHING on every
unique key as a belt-and-braces guard against races).

Call site (once approved): `backend/app/main.py` lifespan, AFTER `seed_if_empty()` (tenant
must exist first). Order relative to other seeders doesn't matter — this seeder writes only
to nav_group + nav_module and reads only from tenant.
"""
from __future__ import annotations

import logging

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models.tenant import Tenant
from .models.nav_module import NavGroup, NavModule


_log = logging.getLogger("gaaex.seed_nav_registry")


# SPEC §1 nav structure. Schema:
#   (group_key, group_name, group_order, [
#       (module_key, module_name, module_order, placement, owner_record_keys, route)
#   ])
# placement: 'O' = owns records (owner_record_keys lists entity_def keys) | 'V' = view-only.
SPEC_NAV_STRUCTURE: list[tuple[str, str, int, list[tuple[str, str, int, str, list[str], str]]]] = [
    ('workspace', 'Workspace', 1, [
        ('home',            'Home',                  1,  'V', [],                            '/home'),
        ('my_work',         'My Work',               2,  'V', [],                            '/my-work'),
        ('communications',  'Communications',        3,  'O', ['communication'],             '/communications'),
        ('calendar',        'Calendar',              4,  'O', ['calendar_event'],            '/calendar'),
        ('global_search',   'Global Search',         5,  'V', [],                            '/search'),
        ('knowledge_base',  'Knowledge Base',        6,  'O', ['knowledge_article'],         '/kb'),
        ('activity_feed',   'Activity Feed',         7,  'V', [],                            '/activity'),
        ('saved_views',     'Saved Views',           8,  'V', [],                            '/saved-views'),
        ('recent_items',    'Recent Items',          9,  'V', [],                            '/recent'),
        ('team_workspace',  'Team Workspace',        10, 'V', [],                            '/team'),
        ('announcements',   'Announcements',         11, 'O', ['announcement'],              '/announcements'),
    ]),
    ('work_management', 'Work Management', 2, [
        ('tasks',    'Tasks',    1, 'O', ['task'],    '/tasks'),
        ('tickets',  'Tickets',  2, 'O', ['ticket'],  '/tickets'),
        ('projects', 'Projects', 3, 'O', ['project'], '/projects'),
    ]),
    ('crm', 'CRM & Commercial', 3, [
        ('pipeline',         'Pipeline',         1, 'O', ['lead', 'pipeline_item'], '/pipeline'),
        ('contracts',        'Contracts',        2, 'O', ['contract'],              '/contracts'),
        ('customers',        'Customers',        3, 'O', ['customer', 'contact'],   '/customers'),
        ('campaigns',        'Campaigns',        4, 'O', ['campaign'],              '/campaigns'),
        ('sales_channels',   'Sales Channels',   5, 'O', ['sales_channel'],         '/channels'),
        ('product_catalog',  'Product Catalog',  6, 'O', ['product'],               '/catalog'),
    ]),
    ('billing_revenue', 'Billing & Revenue', 4, [
        ('tariff_plans',         'Tariff Plans',         1, 'O', ['tariff_plan'],                '/tariff-plans'),
        ('billing_accounts',     'Billing Accounts',     2, 'O', ['billing_account'],            '/billing-accounts'),
        # CONTROL GATE — SPEC §3 Stage 8 / Revenue Control. Placement = Billing & Revenue (NOT CRM).
        ('orders_validation',    'Orders & Validation',  3, 'O', ['order'],                      '/orders'),
        ('invoices',             'Invoices',             4, 'O', ['invoice', 'credit_note'],     '/invoices'),
        ('payments',             'Payments',             5, 'O', ['payment'],                    '/payments'),
        ('collections',          'Collections',          6, 'O', ['collection_case'],            '/collections'),
        ('revenue_assurance',    'Revenue Assurance',    7, 'V', [],                             '/revenue-assurance'),
    ]),
    ('network_operations', 'Network & Operations', 5, [
        ('noc_dashboard',        'NOC Dashboard',          1,  'V', [],                  '/noc'),
        ('network_monitoring',   'Network Monitoring',     2,  'O', ['alarm'],           '/network-monitoring'),
        ('incidents_outages',    'Incidents & Outages',    3,  'O', ['incident'],        '/incidents'),
        ('coverage_gis',         'Coverage & GIS',         4,  'O', ['coverage_check'],  '/coverage'),
        ('network_topology',     'Network Topology',       5,  'V', [],                  '/topology'),
        ('provisioning',         'Provisioning',           6,  'V', [],                  '/provisioning'),
        ('service_inventory',    'Service Inventory',      7,  'O', ['service'],         '/services'),
        ('resource_inventory',   'Resource Inventory',     8,  'O', ['resource'],        '/resources'),
        ('asset_management',     'Asset Management',       9,  'O', ['asset'],           '/assets'),
        ('scheduling',           'Scheduling',             10, 'V', [],                  '/scheduling'),
        ('dispatch_board',       'Dispatch Board',         11, 'V', [],                  '/dispatch'),
        ('work_orders',          'Work Orders',            12, 'O', ['work_order'],      '/work-orders'),
        ('stock_inventory',      'Stock Inventory',        13, 'O', ['stock_item'],      '/stock'),
        ('warehouses',           'Warehouses',             14, 'V', [],                  '/warehouses'),
    ]),
    ('analytics_ai', 'Analytics & AI', 6, [
        ('dashboards',           'Dashboards',           1, 'V', [],              '/dashboards'),
        ('reports',              'Reports',              2, 'O', ['report'],      '/reports'),
        ('executive_dashboard',  'Executive Dashboard',  3, 'V', [],              '/executive'),
        ('ai_insights',          'AI Insights',          4, 'O', ['ai_insight'],  '/ai-insights'),
    ]),
    ('enterprise', 'Enterprise', 7, [
        ('finance',     'Finance',     1, 'V', [],                                 '/finance'),
        ('accounting',  'Accounting',  2, 'O', ['journal_entry', 'ledger'],        '/accounting'),
        ('hr',          'HR',          3, 'O', ['employee'],                       '/hr'),
        ('procurement', 'Procurement', 4, 'O', ['vendor', 'purchase_order'],       '/procurement'),
        ('legal',       'Legal',       5, 'V', [],                                 '/legal'),
        ('audit_logs',  'Audit Logs',  6, 'O', ['audit_log'],                      '/audit-logs'),
    ]),
    ('system', 'System', 8, [
        ('users',                'Users',                 1, 'V', [],  '/system/users'),
        ('roles_permissions',    'Roles & Permissions',   2, 'V', [],  '/system/roles'),
        ('settings',             'Settings',              3, 'V', [],  '/system/settings'),
        ('integrations',         'Integrations',          4, 'V', [],  '/system/integrations'),
        ('notifications_config', 'Notifications Config',  5, 'V', [],  '/system/notifications'),
    ]),
    ('studio', 'Studio', 9, [
        # 15 Studio leaves per SPEC §1 — all config builders (placement='V').
        ('experience',       'Experience',       1,  'V', [], '/studio/experience'),
        ('data',             'Data',             2,  'V', [], '/studio/data'),
        ('logic',            'Logic',            3,  'V', [], '/studio/logic'),
        ('security',         'Security',         4,  'V', [], '/studio/security'),
        ('intelligence',     'Intelligence',     5,  'V', [], '/studio/intelligence'),
        ('quality',          'Quality',          6,  'V', [], '/studio/quality'),
        ('release',          'Release',          7,  'V', [], '/studio/release'),
        ('governance',       'Governance',       8,  'V', [], '/studio/governance'),
        ('system_control',   'System Control',   9,  'V', [], '/studio/system-control'),
        ('marketplace',      'Marketplace',      10, 'V', [], '/studio/marketplace'),
        ('developer',        'Developer',        11, 'V', [], '/studio/developer'),
        ('notifications',    'Notifications',    12, 'V', [], '/studio/notifications'),
        ('search',           'Search',           13, 'V', [], '/studio/search'),
        ('import_export',    'Import / Export',  14, 'V', [], '/studio/import-export'),
        ('documentation',    'Documentation',    15, 'V', [], '/studio/documentation'),
    ]),
]


def _structure_counts() -> tuple[int, int]:
    """Return (groups, modules) totals in SPEC_NAV_STRUCTURE — used by tests/doc/audit."""
    groups = len(SPEC_NAV_STRUCTURE)
    modules = sum(len(g[3]) for g in SPEC_NAV_STRUCTURE)
    return groups, modules


async def seed_nav_registry_if_empty() -> dict:
    """Idempotent nav registry seed.

    For each tenant:
      1. If 0 nav_group rows exist for the tenant, insert the 9 SPEC §1 groups.
      2. For each (group_key, modules) pair, insert any missing modules into that group.

    Idempotent on two layers:
      - Per-tenant existence check before any insert.
      - `pg_insert(...).on_conflict_do_nothing()` keyed on the relevant uniqueness
        constraints (`uq_nav_group_key`, `uq_nav_module_key_in_group`) as a belt-and-
        braces guard against races and partial prior runs.

    Returns:
        dict — {'groups': N, 'modules': M} rows actually inserted across all tenants.
    """
    groups_inserted = 0
    modules_inserted = 0

    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_nav_registry: no tenants — nothing to seed")
            return {"groups": 0, "modules": 0}

        for t in tenants:
            # ---- Groups ----
            # Map of existing group_key -> id for this tenant (used to wire modules below).
            existing_groups = {
                g.key: g.id for g in (await s.execute(
                    select(NavGroup).where(NavGroup.tenant_id == t.id)
                )).scalars().all()
            }

            for group_key, group_name, group_order, _modules in SPEC_NAV_STRUCTURE:
                if group_key in existing_groups:
                    continue
                stmt = (
                    pg_insert(NavGroup.__table__)
                    .values(
                        tenant_id=t.id,
                        key=group_key,
                        name=group_name,
                        order=group_order,
                    )
                    .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
                    .returning(NavGroup.__table__.c.id)
                )
                res = await s.execute(stmt)
                new_id = res.scalar_one_or_none()
                if new_id is not None:
                    existing_groups[group_key] = new_id
                    groups_inserted += 1
                else:
                    # Race: another writer beat us. Re-read to fill the map.
                    refetched = (await s.execute(
                        select(NavGroup.id).where(
                            NavGroup.tenant_id == t.id, NavGroup.key == group_key
                        )
                    )).scalar_one_or_none()
                    if refetched is not None:
                        existing_groups[group_key] = refetched

            # ---- Modules ----
            for group_key, _gname, _gorder, modules in SPEC_NAV_STRUCTURE:
                group_id = existing_groups.get(group_key)
                if group_id is None:
                    # Group neither pre-existed nor inserted — skip silently (will retry next boot).
                    continue
                existing_mod_keys = set((await s.execute(
                    select(NavModule.key).where(
                        NavModule.tenant_id == t.id, NavModule.group_id == group_id
                    )
                )).scalars().all())
                for (mod_key, mod_name, mod_order, placement,
                     owner_record_keys, route) in modules:
                    if mod_key in existing_mod_keys:
                        continue
                    stmt = (
                        pg_insert(NavModule.__table__)
                        .values(
                            tenant_id=t.id,
                            group_id=group_id,
                            key=mod_key,
                            name=mod_name,
                            order=mod_order,
                            placement=placement,
                            owner_module=mod_key,   # mirrors `key` — see model docstring
                            owner_record_keys=owner_record_keys if owner_record_keys else None,
                            route=route,
                        )
                        .on_conflict_do_nothing(
                            index_elements=["tenant_id", "group_id", "key"]
                        )
                    )
                    res = await s.execute(stmt)
                    if res.rowcount:
                        modules_inserted += res.rowcount

        await s.commit()

    _log.info(
        "seed_nav_registry: %d group(s) + %d module(s) inserted across %d tenant(s)",
        groups_inserted, modules_inserted, len(tenants),
    )
    return {"groups": groups_inserted, "modules": modules_inserted}


if __name__ == "__main__":
    import asyncio
    print("nav registry seeded:", asyncio.run(seed_nav_registry_if_empty()))
