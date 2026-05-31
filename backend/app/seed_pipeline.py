"""Step 4 — canonical pipeline seeder (SPEC §3 + §9).

Seeds the 14 LOCKED pipeline stages from SPEC §3 (Lead → Monitoring) plus their matching KPI rows
(one KPI per stage per §3 / §9). Idempotent: uses `pg_insert(...).on_conflict_do_nothing()` keyed on
the table's unique constraint (`tenant_id`, `key`) so re-runs are safe and cheap.

SPEC §3 control rule (verbatim, line 187 of the SPEC):

    "Stage 8 is the single mandatory gate between Sales and Fulfillment. The validator (Revenue
    Control) is organizationally separate from the order creator (Sales). No order advances to
    Scheduling without Control Pass = TRUE."

`stage_def.is_control_gate` is therefore `True` ONLY for stage 8 (`order_validation`); every other
row is `False`. The kernel function `app.kernel.assert_can_advance_to_scheduling` enforces the
runtime half (Step 4 also); the role-gate ("only Revenue Control may flip control_pass to TRUE")
lands with the full default-deny matrix in Step 6.

Call site: `backend/app/main.py` lifespan, AFTER `seed_catalog_if_missing()` (so the catalog
entities like `order` exist) and BEFORE `seed_default_records_run()`.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import Tenant
from .models.kernel_defs import StageDef, KpiDef


_log = logging.getLogger("gaaex.seed_pipeline")


# SPEC §3 Canonical Pipeline (LOCKED) — 14 rows, verbatim from the SPEC §3 table (lines 170-185).
# Stage 8 is the ONLY control gate. KPI keys are the snake_case projection of each stage's KPI name.
#
# Tuple shape: (sequence, stage_key, stage_name, owner_module, exit_gate,
#               kpi_key, kpi_name, is_control_gate)
CANONICAL_PIPELINE: list[tuple[int, str, str, str, str, str, str, bool]] = [
    (1,  "lead",                  "Lead",                  "Marketing",
        "Mandatory fields complete",
        "lead_capture_rate",         "Lead Capture Rate",            False),
    (2,  "qualified",              "Qualified",             "Pre-Sales",
        "Coverage=YES, Reachable, Intent≥threshold",
        "validation_rate",           "Validation Rate",              False),
    (3,  "assigned",               "Assigned",              "Sales Ops",
        "Agent acceptance ≤ SLA",
        "assignment_sla_compliance", "Assignment SLA Compliance",    False),
    (4,  "deal",                   "Deal",                  "Sales Agent",
        "Offer accepted (digital)",
        "deal_conversion",           "Deal Conversion",              False),
    (5,  "contract_signed",        "Contract Signed",       "Sales Agent",
        "Signed contract validated",
        "contract_close_rate",       "Contract Close Rate",          False),
    (6,  "service_qualification",  "Service Qualification", "Coverage & GIS",
        "Coverage/feasibility = PASS",
        "feasibility_pass_rate",     "Feasibility Pass Rate",        False),
    (7,  "order_created",          "Order Created",         "Orders",
        "Order record with valid tariff + product",
        "order_creation_accuracy",   "Order Creation Accuracy",      False),
    # --- STAGE 8: THE CONTROL GATE -----------------------------------------------------------
    (8,  "order_validation",       "Order Validation",      "Revenue Control",
        "KYC + Credit/Risk + Fraud + Tariff/Product match = ALL PASS",
        "control_pass_rate",         "Control Pass Rate",            True),
    # -----------------------------------------------------------------------------------------
    (9,  "scheduling",             "Scheduling",            "Dispatch",
        "Slot within capacity window",
        "schedule_fill_rate",        "Schedule Fill Rate",           False),
    (10, "installation",           "Installation",          "Field Ops",
        "Install complete, signal confirmed",
        "install_success_rate",      "Install Success Rate",         False),
    (11, "connection",             "Connection",            "Field Ops / NOC",
        "Link up, device provisioned",
        "connection_success_rate",   "Connection Success Rate",      False),
    (12, "payment",                "Payment",               "Billing",
        "First payment cleared",
        "first_payment_rate",        "First Payment Rate",           False),
    (13, "activation",             "Activation",            "Billing (Activation)",
        "Account live, billing cycle started",
        "activation_rate",           "Activation Rate",              False),
    (14, "monitoring",             "Monitoring",            "Customer Care / NOC",
        "Continuous post-activation",
        "thirty_day_retention",      "30-Day Retention",             False),
]


async def seed_canonical_pipeline_if_empty() -> dict[str, int]:
    """Seed the 14 SPEC §3 canonical pipeline rows + their bound KPIs for every tenant.

    Idempotent — uses `pg_insert(...).on_conflict_do_nothing()` keyed on the existing
    `uq_stage_def_key` / `uq_kpi_def_key` unique constraints (both are `(tenant_id, key)`). Re-runs
    are cheap and safe.

    For each tenant × each of the 14 stages:
        1) INSERT a stage_def row (Lead .. Monitoring); the `is_control_gate` flag is True only for
           `order_validation` (stage 8). The row also carries `kpi_def_key` pointing at the matching
           KPI.
        2) INSERT a kpi_def row bound to that stage via `bound_stage_key`. The KPI's `owner_module`
           matches the stage's owner per the SPEC §3 table.

    Returns:
        dict with keys `stages_inserted` and `kpis_inserted` — the count of rows actually written
        (0 on a fully-seeded re-run).
    """
    stages_inserted = 0
    kpis_inserted = 0
    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_pipeline: no tenants — nothing to seed")
            return {"stages_inserted": 0, "kpis_inserted": 0}

        for t in tenants:
            for (seq, skey, sname, sowner, exit_gate,
                 kkey, kname, is_gate) in CANONICAL_PIPELINE:

                # ----- stage_def: tenant-scoped, idempotent on (tenant_id, key) -----
                stage_stmt = (
                    pg_insert(StageDef.__table__)
                    .values(
                        tenant_id=t.id,
                        key=skey,
                        name=sname,
                        owner_module=sowner,
                        sequence=seq,
                        exit_gate=exit_gate,
                        kpi_def_key=kkey,
                        is_control_gate=is_gate,
                    )
                    .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
                )
                res = await s.execute(stage_stmt)
                if res.rowcount:
                    stages_inserted += res.rowcount

                # ----- kpi_def: bound to this stage; idempotent on (tenant_id, key) -----
                # Per SPEC §0 invariant 7: one KPI = one owner = one formula = one valid denominator.
                # The structural UNIQUE(tenant_id, key) constraint enforces the "one owner per key"
                # half. `formula` and `denominator` are left NULL here — those land with the KPI
                # engine in a later step; the seeder's job is to register the catalog row.
                kpi_stmt = (
                    pg_insert(KpiDef.__table__)
                    .values(
                        tenant_id=t.id,
                        key=kkey,
                        name=kname,
                        owner_module=sowner,
                        formula=None,
                        denominator=None,
                        bound_stage_key=skey,
                        bound_workflow_key=None,
                    )
                    .on_conflict_do_nothing(index_elements=["tenant_id", "key"])
                )
                res = await s.execute(kpi_stmt)
                if res.rowcount:
                    kpis_inserted += res.rowcount

        await s.commit()

    _log.info(
        "seed_pipeline: %d stage_def + %d kpi_def row(s) inserted across %d tenant(s)",
        stages_inserted, kpis_inserted, len(tenants),
    )
    return {"stages_inserted": stages_inserted, "kpis_inserted": kpis_inserted}


if __name__ == "__main__":
    import asyncio
    print("canonical pipeline seed result:", asyncio.run(seed_canonical_pipeline_if_empty()))
