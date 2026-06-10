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


_log = logging.getLogger("gaahex.seed_pipeline")


# Canonical Customer Lifecycle — 14 rows, MIRRORS the frontend SST
# (`frontend/src/lib/lifecycle.ts` → LIFECYCLE_STAGES). That file is the single source
# of truth; this list is its backend projection (same key/name/sequence/owner, lowercased
# keys). Reconciled 2026-06-11 (supersedes the legacy SPEC §3 set — see RECONCILIATION note
# at the bottom of this file).
#
#   • ONE accountable owner per stage (B5).
#   • Order is installation (#9) → config (#10): field tech connects the ONU, THEN NOC
#     registers/provisions it on the OLT.
#   • #7 order_validated is THE control gate (Validation, independent of Sales).
#   • #10 config is measured by `config_success_rate` (COMPLETED config workitems / all) — same
#     shape as install_success_rate; returns 0 honestly until config workitems exist (post-OLT).
#   • The legacy `service_qualification` stage + its `feasibility_pass_rate` KPI are dropped
#     (no equivalent in the SST — feasibility folded into validated_lead's exit condition).
#
# Tuple shape: (sequence, stage_key, stage_name, owner_module, exit_gate,
#               kpi_key | None, kpi_name | None, is_control_gate)
CANONICAL_PIPELINE: list[tuple[int, str, str, str, str, str | None, str | None, bool]] = [
    (1,  "lead",                  "Lead",                  "Sales",
        "Mandatory fields complete",
        "lead_capture_rate",         "Lead Capture Rate",            False),
    (2,  "validated_lead",         "Validated Lead",        "Sales",
        "Coverage=YES, Reachable, Intent≥threshold",
        "validation_rate",           "Validation Rate",              False),
    (3,  "assigned",               "Assigned",              "Sales",
        "Agent acceptance ≤ SLA",
        "assignment_sla_compliance", "Assignment SLA Compliance",    False),
    (4,  "deal",                   "Deal",                  "Sales",
        "Offer accepted (digital)",
        "deal_conversion",           "Deal Conversion",              False),
    (5,  "contract_signed",        "Contract Signed",       "Sales",
        "Signed contract validated",
        "contract_close_rate",       "Contract Close Rate",          False),
    (6,  "order_created",          "Order Created",         "Back Office",
        "Order record with valid tariff + product",
        "order_creation_accuracy",   "Order Creation Accuracy",      False),
    # --- STAGE 7: THE CONTROL GATE (independent validator) -----------------------------------
    (7,  "order_validated",        "Order Validated",       "Validation",
        "KYC + Credit/Risk + Fraud + Tariff/Product match = ALL PASS",
        "control_pass_rate",         "Control Pass Rate",            True),
    # -----------------------------------------------------------------------------------------
    (8,  "scheduling",             "Scheduling",            "Dispatch Team",
        "Slot within capacity window",
        "schedule_fill_rate",        "Schedule Fill Rate",           False),
    (9,  "installation",           "Installation",          "Technical Department",
        "Install complete, ONU connected on-site",
        "install_success_rate",      "Install Success Rate",         False),
    (10, "config",                 "Config",                "NOC",
        "ONU registered on OLT, service profile bound",
        "config_success_rate",       "Config Success Rate",          False),
    (11, "connection_test",        "Connection Test",       "NOC",
        "Link up, signal confirmed",
        "connection_success_rate",   "Connection Success Rate",      False),
    (12, "payment_confirmed",      "Payment Confirmed",     "Billing",
        "First payment cleared",
        "first_payment_rate",        "First Payment Rate",           False),
    (13, "activation",             "Activation",            "Billing",
        "Account live, billing cycle started",
        "activation_rate",           "Activation Rate",              False),
    (14, "monitoring",             "Monitoring",            "NOC",
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
        # Owner-session seeding is intentionally cross-tenant — bypass the tenant-filter audit.
        await s.connection(execution_options={"audit_tenant_filter": False})
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
                # A stage may have NO KPI yet (kkey is None — e.g. `config`); skip the kpi_def row.
                if kkey is not None:
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


# ── RECONCILIATION note (2026-06-11) — SPEC §3 standard divergence, FLAGGED ────────────────
# This pipeline previously implemented the LOCKED SPEC §3 stage set verbatim. By owner decision
# (Gev), the **frontend Customer Lifecycle (`lifecycle.ts` LIFECYCLE_STAGES) is now the single
# source of truth**, and this backend list is its projection. That means we deliberately diverge
# from the original SPEC §3 table on these points — the standard doc (`docs/standards/`) should be
# amended to match, or this exception recorded there:
#   • `qualified` → `validated_lead`; `order_validation` → `order_validated`;
#     `connection` → `connection_test`; `payment` → `payment_confirmed` (renamed).
#   • `service_qualification` stage + its `feasibility_pass_rate` KPI REMOVED (feasibility folded
#     into validated_lead's exit condition).
#   • New `config` stage at #10 (after installation) with NO KPI yet (gap — KPI TBD).
#   • Control gate moved from old #8 to #7 (order_validated); relative order (validate → schedule)
#     is preserved, so `kernel.control_gate` semantics are unchanged.
#   • Permission keys (`order_validation.*`) are an IMMUTABLE registry namespace and were left
#     untouched — they intentionally no longer string-match the stage key.
# The `SST-1` drift rule (tools/check_drift.py) now hard-locks this list to lifecycle.ts.


if __name__ == "__main__":
    import asyncio
    print("canonical pipeline seed result:", asyncio.run(seed_canonical_pipeline_if_empty()))
