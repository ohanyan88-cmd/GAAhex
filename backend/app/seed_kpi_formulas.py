"""Seed formula_spec onto 4-6 of the 14 seeded kpi_def rows.

SPEC §3 / §9 ships 14 stage KPIs (lead_capture_rate, validation_rate, … ). Step 4's
`seed_pipeline.py` seeded the row metadata (key/name/owner_module/bound_stage_key) but
left `formula` and `formula_spec` NULL because the runtime engine wasn't yet built.

This seeder fills `formula_spec` for the KPIs whose data is fully available on a
fresh M0 demo DB. The other ~8 require explicit stage attribution on `record`
(deferred) or workflow_def-bound numerators (deferred to the workflow engine);
they're left NULL on purpose, and the engine returns value=None + reason='no formula'
when asked for them — real-data-only posture, no fake numbers.

Idempotent: an UPDATE … WHERE formula_spec IS NULL re-run is a no-op once the spec
is set. A future spec edit therefore needs a manual UPDATE or a new migration; this
matches how Step 4's seeder behaves on `seed_canonical_pipeline_if_empty`.

Call site: `backend/app/main.py` lifespan, AFTER `seed_canonical_pipeline_if_empty()`
(which inserts the kpi_def rows) and BEFORE `seed_default_records_run()`. Sequencing
that way means freshly-booted demo tenants get the formulas without manual SQL.
"""
from __future__ import annotations

import logging

from sqlalchemy import select, update

from .db import OwnerSessionLocal as SessionLocal  # privileged: seeding bypasses RLS
from .models import Tenant
from .models.kernel_defs import KpiDef


_log = logging.getLogger("gaahex.seed_kpi_formulas")


# Mapping kpi_key → formula_spec JSON. Order is documentary; the seeder iterates
# `.items()` and applies each independently. See KPI-ENGINE.md for the rationale
# behind each formula's shape; comments below summarise.
KPI_FORMULAS: dict[str, dict] = {
    # Marketing — leads / day (over the full population on M0; a since_days
    # date-window on the numerator is a config edit once `record.created_at`
    # filtering is wired into the count spec; engine supports the `rate` shape).
    "lead_capture_rate": {
        "type": "rate",
        "since_days": 30,
        "numerator": {
            "type": "count",
            "table": "record",
            "where": {"entity_key": "lead"},
        },
        "_human": "leads in the population / 30 days (M0 approximation)",
    },

    # Pre-Sales — qualified leads / total leads. Pre-Sales owns the gate; the
    # data lives in record.data.status (the §7 status standardization seeded
    # QUALIFIED as a member of the lead status set).
    "validation_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "lead", "data.status": "QUALIFIED"},
        },
        "denominator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "lead"},
        },
        "_human": "qualified leads / all leads",
    },

    # Sales Agent — closed-won deals / all deals. Deal status WON aligns with
    # the §7 deal status set seeded by Step 5.
    "deal_conversion": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "deal", "data.status": "WON"},
        },
        "denominator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "deal"},
        },
        "_human": "WON deals / all deals",
    },

    # Revenue Control — control_pass=TRUE / control_pass not null. The SPEC §3
    # Stage 8 gate writes the verdict on `order.control_pass`; NULL = pending,
    # TRUE = passed, FALSE = explicitly failed. Denominator excludes pending
    # so the rate measures "of orders that have been judged, what passed".
    "control_pass_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "order",
            "where": {"control_pass": True},
        },
        "denominator": {
            "type": "count", "table": "order",
            "where": {"control_pass__not_null": True},
        },
        "_human": "orders with control_pass=TRUE / orders judged (not NULL)",
    },

    # Billing (Activation) — ACTIVE subs / all subs. Subscription.status ∈
    # {ACTIVE, SUSPENDED, CANCELLED}; ACTIVE is the activation success surface.
    "activation_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "subscription",
            "where": {"status": "ACTIVE"},
        },
        "denominator": {
            "type": "count", "table": "subscription",
        },
        "_human": "ACTIVE subscriptions / all subscriptions",
    },

    # Billing — first-payment rate. PAID invoices / all issued+paid invoices.
    # Approximation: counts any PAID invoice rather than strictly "first per
    # customer"; for an M0 dashboard the gross figure is what stakeholders
    # actually want. Refinement is a config edit, not engine change.
    "first_payment_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "invoice",
            "where": {"status": "PAID"},
        },
        "denominator": {
            "type": "count", "table": "invoice",
        },
        "_human": "PAID invoices / all invoices (M0 approximation of first-payment)",
    },

    # Sales Agent — contract close rate. SIGNED contracts / all contracts.
    # contract is config-driven (entity_def 'contract'); status comes from data.status.
    "contract_close_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "contract", "data.status": "SIGNED"},
        },
        "denominator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "contract"},
        },
        "_human": "SIGNED contracts / all contracts",
    },

    # Orders — order creation accuracy. Orders that passed control / orders that have been judged.
    # M0 approximation: an order is "accurate" if it ever reached control_pass=TRUE (any later
    # cancellation reflects business choice, not creation error). Same source as control_pass_rate
    # but from the Orders module's framing.
    "order_creation_accuracy": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "order",
            "where": {"control_pass": True},
        },
        "denominator": {
            "type": "count", "table": "order",
        },
        "_human": "orders that passed control / all orders",
    },

    # Field Ops — install success rate. Workitems of kind=installation in status COMPLETED /
    # all installation workitems. install_workitem == real install dispatch in M0.
    "install_success_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "workitem",
            "where": {"kind": "installation", "status": "COMPLETED"},
        },
        "denominator": {
            "type": "count", "table": "workitem",
            "where": {"kind": "installation"},
        },
        "_human": "COMPLETED installation workitems / all installation workitems",
    },

    # Field Ops / NOC — connection success rate. Services in ACTIVE status / all services.
    # An ACTIVE service implies the connection was provisioned and link is up.
    "connection_success_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "service",
            "where": {"status": "ACTIVE"},
        },
        "denominator": {
            "type": "count", "table": "service",
        },
        "_human": "ACTIVE services / all services",
    },

    # Customer Care — 30-day retention. ACTIVE subscriptions whose first PAID invoice is
    # >30 days ago / all subscriptions that ever had a first PAID invoice. M0 approximation:
    # uses subscription.created_at since a per-subscription "first payment" join is non-trivial
    # for the basic engine; refinement is a config edit when the engine grows joins.
    "thirty_day_retention": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "subscription",
            "where": {"status": "ACTIVE", "created_at__before_days": 30},
        },
        "denominator": {
            "type": "count", "table": "subscription",
            "where": {"created_at__before_days": 30},
        },
        "_human": "ACTIVE subscriptions >30d old / all subscriptions >30d old (M0 approximation)",
    },

    # === R-07: previously deferred — source data now exists ===
    "assignment_sla_compliance": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "workitem",
            "where": {
                "first_response_at__not_null": True,
                "first_response_at__lte_assigned_at_plus_hours_4": True,
            },
        },
        "denominator": {
            "type": "count", "table": "workitem",
            "where": {"assigned_at__not_null": True},
        },
        "_human": "workitems with first response within 4 h of assignment / all assigned workitems",
    },
    "feasibility_pass_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "coverage_check", "data.result": "PASS"},
        },
        "denominator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "coverage_check"},
        },
        "_human": "coverage_check records with result=PASS / total coverage checks",
    },
    "schedule_fill_rate": {
        "type": "ratio",
        "numerator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "schedule_slot", "data.status": "FILLED"},
        },
        "denominator": {
            "type": "count", "table": "record",
            "where": {"entity_key": "schedule_slot"},
        },
        "_human": "schedule_slots with status=FILLED / total schedule_slots",
    },
}


# Per-KPI human-readable `formula` text mirror — drives the display column;
# never executed. Pulled out so the structured KPI_FORMULAS map stays clean.
_HUMAN_FORMULA = {k: v["_human"] for k, v in KPI_FORMULAS.items()}

# The structured formula_spec — strip the `_human` annotation before writing.
_CLEAN_FORMULAS = {
    k: {ks: kv for ks, kv in v.items() if ks != "_human"}
    for k, v in KPI_FORMULAS.items()
}


async def seed_kpi_formulas_if_missing() -> dict[str, int]:
    """Idempotent: UPDATE kpi_def SET formula_spec=... WHERE key=... AND formula_spec IS NULL.

    Walks every tenant × every entry in KPI_FORMULAS. Skips rows that already have a
    `formula_spec` set (so a custom-tuned spec is never silently overwritten).

    Returns:
        dict with keys `updated` (count of rows actually written), `tenants` (count
        scanned), `kpis` (count of KPI keys in the catalog). 0 updated on a re-run.
    """
    async with SessionLocal() as s:
        tenants = (await s.execute(select(Tenant))).scalars().all()
        if not tenants:
            _log.info("seed_kpi_formulas: no tenants — nothing to seed")
            return {"updated": 0, "tenants": 0, "kpis": len(_CLEAN_FORMULAS)}

        updated = 0
        for t in tenants:
            for kpi_key, spec in _CLEAN_FORMULAS.items():
                human = _HUMAN_FORMULA.get(kpi_key)
                stmt = (
                    update(KpiDef)
                    .where(
                        KpiDef.tenant_id == t.id,
                        KpiDef.key == kpi_key,
                        KpiDef.formula_spec.is_(None),
                    )
                    .values(formula_spec=spec, formula=human)
                )
                res = await s.execute(stmt)
                if res.rowcount:
                    updated += res.rowcount
        await s.commit()

    _log.info(
        "seed_kpi_formulas: %d kpi_def row(s) updated across %d tenant(s) "
        "(catalog size %d)", updated, len(tenants), len(_CLEAN_FORMULAS),
    )
    return {"updated": updated, "tenants": len(tenants), "kpis": len(_CLEAN_FORMULAS)}


if __name__ == "__main__":
    import asyncio
    print("kpi-formula seed result:", asyncio.run(seed_kpi_formulas_if_missing()))
