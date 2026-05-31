"""Step 6 — SPEC §4.3 role hard-denials seeder.

Seeds the LOCKED role.cannot lists from SPEC §4.3 (lines 199-212 of
`GAAex_Cross_Module_Architecture_SPEC.md`) into the `role_def_deny` table introduced in Step 6's
alembic migration (`a7b3c9d5e1f2`). Idempotent — re-runs insert zero new rows.

------------------------------------------------------------------------------------------------
SPEC §4.3 verbatim — Role Boundaries (cannot lists are enforced, not advisory)
------------------------------------------------------------------------------------------------

| Role            | Can access                          | Hard denials                              |
|-----------------|-------------------------------------|-------------------------------------------|
| Admin           | Everything except editing/deleting audit log         | Edit/delete audit log    |
| Executive       | Dashboards, KPIs, reports, financial summaries       | Edit operational records (unless granted) |
| Sales           | Pipeline, Customers, Campaigns, Channels, Product Catalog, own tasks/comms | Accounting, system settings, network config, Order Validation |
| Customer Care   | Customers, Tickets, Tasks, Comms, KB, billing/payment/service status | Edit invoice amounts, payment records, network config |
| Billing         | Billing Accounts, Invoices, Payments, Collections, Revenue Assurance | Edit network assets, service provisioning, pipeline stages |
| Revenue Control | Orders, Order Validation, Revenue Assurance          | Create deals/contracts (separation of duties) |
| Network / NOC   | NOC, Monitoring, Alarms, Incidents, GIS, Topology, Provisioning, Service/Resource/Asset Inventory | Full finance, HR, legal, sensitive billing |
| Field Technician| Assigned work orders, address, contact, equipment, checklist, photos, service status | Customer financial history, other techs' work, system settings |
| Finance         | Finance, Accounting, billing summaries, revenue reports, Payments, Collections | Network config, private customer comms |
| HR              | Employees, Recruitment, Performance, Attendance, Leave, employee docs | Customer billing, network ops, sales pipeline |

------------------------------------------------------------------------------------------------
Mapping SPEC text → (denied_action, denied_entity_key, reason) tuples
------------------------------------------------------------------------------------------------

The kernel `_deny_matches` (in `app/kernel/invariants.py`) parses two equivalent encodings:
    a) Compound form  — `denied_action = 'invoice.edit'`, `denied_entity_key = NULL`
                        (the SPEC text style — copies the SPEC line verbatim)
    b) Structured form — `denied_action = 'edit'`, `denied_entity_key = 'invoice'`
                        (the typed style — matches the kernel's `(entity_key, action)` pair shape)

Wildcards: `denied_action = '*'` matches any verb; trailing `.*` on a compound (e.g.
`audit.*`) matches any verb on that entity; `denied_entity_key = NULL` matches any entity.

We use the COMPOUND form throughout below — the rows then read like the SPEC text.

------------------------------------------------------------------------------------------------
Role key resolution
------------------------------------------------------------------------------------------------

SPEC §4.3 names ten roles. The codebase's baseline `seed.py` seeds three (`super_admin`,
`manager`, `sales_agent`) — see `build_access_config()`. SPEC roles map to existing role keys:

  Admin           → super_admin              (existing M0 demo role; SPEC §4.3 "Admin" is the
                                              all-powerful role minus the audit-log carve-out)
  Sales           → sales_agent              (existing M0 demo role for sales work)
  Executive       → executive                (not present in M0 demo; row inserted only IF role
                                              exists. Future role gets boundaries on first boot.)
  Customer Care   → customer_care            (same — created lazily by future seeds)
  Billing         → billing                  (same)
  Revenue Control → revenue_control          (same)
  Network / NOC   → network_noc              (same)
  Field Technician→ field_technician         (same)
  Finance         → finance                  (same)
  HR              → hr                       (same)

The seeder runs per-tenant: for each existing RoleDef whose key matches a SPEC §4.3 role, it
inserts the corresponding deny rows (idempotent via the COALESCE-keyed unique index). Roles that
don't yet exist for a tenant are silently skipped — a later boot picks them up automatically the
moment they're seeded.

Call site: `backend/app/main.py` lifespan, AFTER `seed_access_if_empty()` (so RoleDefs exist).
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import RoleDef, RoleDeny


_log = logging.getLogger("gaaex.seed_role_boundaries")


# (role_key, [(denied_action, denied_entity_key, reason), ...])
#
# `denied_entity_key` is set to None when the SPEC text uses a compound form like `audit.*` —
# the kernel parses the dotted action and matches it without needing entity_key separately.
#
# Where the SPEC text is generic ("Edit operational records", "Customer financial history"), the
# closest concrete keys are encoded. Free-form SPEC phrases that DON'T map to a stable key are
# documented but skipped (e.g. "unless granted" in Executive is a workflow exception, not a deny).
SPEC_ROLE_BOUNDARIES: list[tuple[str, list[tuple[str, str | None, str]]]] = [
    # Admin — the SPEC §0.4 invariant: audit log cannot be edited or deleted by ANY role,
    # including Admin. We encode this as a literal hard-deny on the admin/super_admin role too.
    ("super_admin", [
        ("audit.edit",   None, "SPEC §0.4 audit append-only — no role may edit audit log"),
        ("audit.delete", None, "SPEC §0.4 audit append-only — no role may delete audit log"),
        ("audit_log.edit",   None, "SPEC §0.4 audit append-only (audit_log entity alias)"),
        ("audit_log.delete", None, "SPEC §0.4 audit append-only (audit_log entity alias)"),
    ]),
    # Executive — read-mostly; SPEC §4.3 says "Edit operational records (unless granted)".
    # The "unless granted" carve-out is a workflow/per-record exception, not a blanket deny on
    # specific entities, so we keep this conservative: deny ".edit" on the four big operational
    # entities. Studio can layer per-record grants on top later.
    ("executive", [
        ("customer.edit",         None, "SPEC §4.3 Executive read-mostly — edit denied unless granted"),
        ("order.edit",            None, "SPEC §4.3 Executive read-mostly — edit denied unless granted"),
        ("invoice.edit",          None, "SPEC §4.3 Executive read-mostly — edit denied unless granted"),
        ("workitem.edit",         None, "SPEC §4.3 Executive read-mostly — edit denied unless granted"),
    ]),
    # Sales — cannot do accounting, system settings, network config, or Order Validation.
    ("sales_agent", [
        ("accounting.*",          None, "SPEC §4.3 Sales — no accounting access"),
        ("system.*",              None, "SPEC §4.3 Sales — no system settings"),
        ("network.config.*",      None, "SPEC §4.3 Sales — no network config"),
        ("order_validation.*",    None, "SPEC §4.3 Sales — Order Validation belongs to Revenue Control"),
        ("audit.*",               None, "SPEC §4.3 Sales — no audit access"),
    ]),
    # Customer Care — can't edit invoice amounts, payment records, network config.
    ("customer_care", [
        ("invoice.edit",          None, "SPEC §4.3 Customer Care — invoice amounts immutable to this role"),
        ("payment.*",             None, "SPEC §4.3 Customer Care — payment records protected"),
        ("network.config.*",      None, "SPEC §4.3 Customer Care — no network config"),
    ]),
    # Billing — can't edit network assets, service provisioning, pipeline stages.
    ("billing", [
        ("network.asset.edit",    None, "SPEC §4.3 Billing — no network asset edits"),
        ("service.provision.*",   None, "SPEC §4.3 Billing — no service provisioning"),
        ("pipeline.advance",      None, "SPEC §4.3 Billing — pipeline movement belongs to Sales/Ops"),
        ("stage.advance",         None, "SPEC §4.3 Billing — stage advance belongs to Sales/Ops"),
    ]),
    # Revenue Control — separation of duties: cannot create deals or contracts.
    ("revenue_control", [
        ("deal.create",           None, "SPEC §4.3 Revenue Control — separation of duties (no deal creation)"),
        ("contract.create",       None, "SPEC §4.3 Revenue Control — separation of duties (no contract creation)"),
    ]),
    # Network / NOC — no finance, HR, legal, or sensitive billing.
    ("network_noc", [
        ("finance.*",             None, "SPEC §4.3 Network/NOC — no finance"),
        ("hr.*",                  None, "SPEC §4.3 Network/NOC — no HR"),
        ("legal.*",               None, "SPEC §4.3 Network/NOC — no legal"),
        ("billing.sensitive.*",   None, "SPEC §4.3 Network/NOC — no sensitive billing"),
    ]),
    # Field Technician — no customer financial history, no other techs' work, no system settings.
    ("field_technician", [
        ("customer.financial.*",  None, "SPEC §4.3 Field Tech — no customer financial history"),
        ("workitem.view.others",  None, "SPEC §4.3 Field Tech — own work items only"),
        ("system.settings.*",     None, "SPEC §4.3 Field Tech — no system settings"),
    ]),
    # Finance — no network config, no private customer comms.
    ("finance", [
        ("network.config.*",      None, "SPEC §4.3 Finance — no network config"),
        ("customer.comm.private", None, "SPEC §4.3 Finance — no private customer comms"),
    ]),
    # HR — no customer billing, no network ops, no pipeline.
    ("hr", [
        ("customer.billing.*",    None, "SPEC §4.3 HR — no customer billing"),
        ("network.ops.*",         None, "SPEC §4.3 HR — no network ops"),
        ("pipeline.*",            None, "SPEC §4.3 HR — no sales pipeline"),
    ]),
]


async def seed_role_boundaries_if_empty() -> dict[str, int]:
    """Seed SPEC §4.3 role hard-denials into role_def_deny.

    Per tenant, for each (role_key → deny tuples) in SPEC_ROLE_BOUNDARIES, INSERT every deny row
    that doesn't already exist (idempotent via the COALESCE-keyed unique index on
    `(tenant_id, role_id, denied_action, COALESCE(denied_entity_key, '__any__'))`).

    Returns a dict { role_key: rows_inserted } summarizing what the seeder did THIS run. Roles
    that don't yet exist for a tenant are silently skipped (no row counted). Roles that DO exist
    but are already fully-denied yield 0 rows on subsequent runs — proving idempotency.
    """
    inserted_by_role: dict[str, int] = {}
    async with SessionLocal() as s:
        # All RoleDefs across all tenants, indexed by (tenant_id, key).
        roles = (await s.execute(
            select(RoleDef.id, RoleDef.tenant_id, RoleDef.key)
        )).all()
        if not roles:
            _log.info("seed_role_boundaries: no role_def rows present — nothing to seed")
            return {}

        # Index: (tenant_id, role_key) -> role_id
        by_key: dict[tuple, uuid.UUID] = {(tid, k): rid for rid, tid, k in roles}

        for role_key, denials in SPEC_ROLE_BOUNDARIES:
            # Find every (tenant, role) pair matching this SPEC role key — every tenant gets the
            # full deny set inserted in one shot.
            matching = [(tid, rid) for (tid, k), rid in by_key.items() if k == role_key]
            if not matching:
                continue
            run_count = 0
            for tenant_id, role_id in matching:
                for denied_action, denied_entity_key, reason in denials:
                    # Idempotency: pre-check existence against the COALESCE-keyed unique index
                    # shape (NULL entity_key normalized to a sentinel). SQLAlchemy's pg_insert
                    # `on_conflict_do_nothing` can't target a partial/functional unique INDEX
                    # by name (it's not a CONSTRAINT in Postgres), and `index_elements` with a
                    # COALESCE expression won't pair cleanly across asyncpg's prepare path.
                    # A SELECT-then-INSERT is fine here: the seeder runs once per boot and
                    # exists-checks are O(1) with the existing index.
                    existing = (await s.execute(
                        select(RoleDeny.id).where(
                            RoleDeny.tenant_id == tenant_id,
                            RoleDeny.role_id == role_id,
                            RoleDeny.denied_action == denied_action,
                            func.coalesce(RoleDeny.denied_entity_key, "__any__")
                                == (denied_entity_key or "__any__"),
                        )
                    )).first()
                    if existing:
                        continue
                    s.add(RoleDeny(
                        id=uuid.uuid4(),
                        tenant_id=tenant_id,
                        role_id=role_id,
                        denied_action=denied_action,
                        denied_entity_key=denied_entity_key,
                        reason=reason,
                    ))
                    await s.flush()
                    run_count += 1
            if run_count:
                inserted_by_role[role_key] = run_count

        await s.commit()
    _log.info(
        "seed_role_boundaries: inserted %d deny row(s) across %d role(s) per SPEC §4.3",
        sum(inserted_by_role.values()), len(inserted_by_role),
    )
    return inserted_by_role


if __name__ == "__main__":
    import asyncio
    print("role_def_deny rows inserted:", asyncio.run(seed_role_boundaries_if_empty()))
