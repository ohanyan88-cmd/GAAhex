"""Coverage for the KPI computation engine — kernel/kpi_engine.py + routers/kpis.py.

The shared session conftest creates the schema via Base.metadata.create_all and only
runs `seed_if_empty / seed_meta_if_empty / seed_access_if_empty` — so the 14 SPEC §3
kpi_def rows aren't seeded automatically. We bootstrap a minimum kpi_def set inline
via SessionLocal (mirroring the test_accounts pattern) — that keeps this suite
hermetic from the boot lifespan and lets us assert against a known-shape kpi catalog
even when another suite races on the shared DB.

Test surface:
  1. /api/kpis lists the catalog (metadata only; no compute)
  2. /api/kpis/{key}/value computes a `rate` shape (lead_capture_rate)
  3. /api/kpis/{key}/value computes a `ratio` shape (deal_conversion) — value bound 0..1
  4. /api/kpis/values returns a list; owner_module filter actually filters
  5. Cache: a second call within 60s sets from_cache=True
  6. Malformed spec maps to 422 (authoring error, not 500)
  7. Unknown key maps to 404
"""
from __future__ import annotations

import uuid

import pytest

from app.db import SessionLocal
from app.models.kernel_defs import KpiDef


# ---------------------------------------------------------------- fixtures

# The seed_pipeline / seed_kpi_formulas seeders run at app boot via lifespan, but the
# test conftest spins a clean DB + runs ONLY the three early seeders (seed/meta/access).
# So this fixture lays down the minimum 5-KPI catalog the tests need against the admin's
# tenant. Idempotent on key — re-running the suite is a no-op.
@pytest.fixture(scope="session", autouse=True)
async def _seed_kpi_catalog(client, admin):
    """Insert (or update) a 5-KPI catalog for the admin's tenant.

    Resolves the tenant_id via /auth/me (which uses the same admin token the rest of
    the suite uses), then upserts via raw SQLAlchemy. Captures the IDs for later test
    cleanup if needed (not currently needed — UNIQUE on (tenant_id, key) makes this
    safely idempotent).
    """
    me = (await client.get("/auth/me", headers=admin)).json()
    tenant_id = uuid.UUID(me["tenant_id"])

    catalog = [
        # rate: numerator / since_days
        ("lead_capture_rate", "Lead Capture Rate", "Marketing", None, {
            "type": "rate", "since_days": 30,
            "numerator": {"type": "count", "table": "record", "where": {"entity_key": "lead"}},
        }),
        # ratio: WON deals / all deals (denominator may be 0 on a fresh DB — engine returns None+reason)
        ("deal_conversion", "Deal Conversion", "Sales Agent", "deal", {
            "type": "ratio",
            "numerator":   {"type": "count", "table": "record", "where": {"entity_key": "deal", "data.status": "WON"}},
            "denominator": {"type": "count", "table": "record", "where": {"entity_key": "deal"}},
        }),
        # ratio: order.control_pass=TRUE / order.control_pass IS NOT NULL
        ("control_pass_rate", "Control Pass Rate", "Revenue Control", "order_validation", {
            "type": "ratio",
            "numerator":   {"type": "count", "table": "order", "where": {"control_pass": True}},
            "denominator": {"type": "count", "table": "order", "where": {"control_pass__not_null": True}},
        }),
        # ratio: ACTIVE subs / all subs
        ("activation_rate", "Activation Rate", "Billing (Activation)", "activation", {
            "type": "ratio",
            "numerator":   {"type": "count", "table": "subscription", "where": {"status": "ACTIVE"}},
            "denominator": {"type": "count", "table": "subscription"},
        }),
        # NO formula — exercises the "no formula" reason path
        ("validation_rate", "Validation Rate", "Pre-Sales", "qualified", None),
    ]

    async with SessionLocal() as s:
        for key, name, owner, stage_key, spec in catalog:
            existing = (await s.execute(
                __import__("sqlalchemy").select(KpiDef).where(
                    KpiDef.tenant_id == tenant_id, KpiDef.key == key,
                )
            )).scalar_one_or_none()
            if existing:
                existing.name = name
                existing.owner_module = owner
                existing.bound_stage_key = stage_key
                existing.formula_spec = spec
                # Reset the cache so tests get a fresh compute on first call.
                existing.last_computed_at = None
                existing.last_computed_value = None
            else:
                s.add(KpiDef(
                    tenant_id=tenant_id, key=key, name=name, owner_module=owner,
                    bound_stage_key=stage_key, formula_spec=spec,
                ))
        await s.commit()


# ---------------------------------------------------------------- tests

async def test_list_kpis_returns_metadata(client, admin):
    rows = (await client.get("/api/kpis", headers=admin)).json()
    keys = {r["key"] for r in rows}
    # At minimum the five we seeded must show up; other suites may add more, that's fine.
    assert {"lead_capture_rate", "deal_conversion", "control_pass_rate",
            "activation_rate", "validation_rate"} <= keys
    # Metadata shape — has_formula is True only when formula_spec is set
    by_key = {r["key"]: r for r in rows}
    assert by_key["lead_capture_rate"]["has_formula"] is True
    assert by_key["validation_rate"]["has_formula"] is False
    assert by_key["control_pass_rate"]["owner_module"] == "Revenue Control"


async def test_lead_capture_rate_value(client, admin):
    """rate shape — value is a number (numerator/since_days); units == 'ratio'."""
    body = (await client.get("/api/kpis/lead_capture_rate/value", headers=admin)).json()
    assert body["key"] == "lead_capture_rate"
    assert body["owner_module"] == "Marketing"
    assert body["unit"] == "ratio"   # rate
    # value is a non-negative float (could be 0 if no leads); denominator is since_days
    assert body["value"] is not None
    assert body["value"] >= 0
    assert body["denominator"] == 30  # default since_days
    assert isinstance(body["numerator"], int)


async def test_deal_conversion_value_bounds(client, admin):
    """ratio shape — value is 0..1 OR None+reason='denominator zero' on an empty DB."""
    body = (await client.get("/api/kpis/deal_conversion/value", headers=admin)).json()
    assert body["key"] == "deal_conversion"
    assert body["unit"] == "percent"
    if body["value"] is None:
        # No deals at all → denominator 0 → engine returns None + reason; never a fake 0.
        assert body["reason"] == "denominator zero"
        assert body["denominator"] == 0
    else:
        assert 0.0 <= body["value"] <= 1.0
        assert body["numerator"] <= body["denominator"]


async def test_validation_rate_no_formula(client, admin):
    """A kpi_def with formula_spec=NULL returns value=None + reason='no formula'."""
    body = (await client.get("/api/kpis/validation_rate/value", headers=admin)).json()
    assert body["value"] is None
    assert body["reason"] == "no formula"
    assert body["unit"] == "count"   # default unit when there's no spec


async def test_values_endpoint_filtered_by_owner_module(client, admin):
    """/api/kpis/values?owner_module=Marketing returns ONLY Marketing-owned KPIs."""
    rows = (await client.get("/api/kpis/values?owner_module=Marketing", headers=admin)).json()
    assert isinstance(rows, list) and len(rows) >= 1
    for r in rows:
        assert r["owner_module"] == "Marketing"


async def test_unknown_kpi_returns_404(client, admin):
    r = await client.get("/api/kpis/does_not_exist/value", headers=admin)
    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()


async def test_cache_returns_from_cache_on_repeat(client, admin):
    """First call computes fresh (from_cache=False), second call within 60s is cached.

    Uses a NEW kpi_def key per run so we're guaranteed a cold cache regardless of which
    other tests have already exercised the catalog. The `rate` shape is the safest —
    its denominator is `since_days`, so value is always defined even on empty data.
    """
    me = (await client.get("/auth/me", headers=admin)).json()
    tenant_id = uuid.UUID(me["tenant_id"])
    key = f"cache_probe_{uuid.uuid4().hex[:6]}"
    async with SessionLocal() as s:
        s.add(KpiDef(
            tenant_id=tenant_id, key=key, name="Cache Probe", owner_module="Test",
            formula_spec={
                "type": "rate", "since_days": 30,
                "numerator": {"type": "count", "table": "record", "where": {"entity_key": "lead"}},
            },
        ))
        await s.commit()

    first = (await client.get(f"/api/kpis/{key}/value", headers=admin)).json()
    assert first["value"] is not None
    assert first["from_cache"] is False, f"cold cache should miss, got {first!r}"

    second = (await client.get(f"/api/kpis/{key}/value", headers=admin)).json()
    assert second["from_cache"] is True, f"warm cache should hit, got {second!r}"
    # Cache may serialize floats with fewer decimal places; compare with tolerance.
    import math
    v1, v2 = first["value"], second["value"]
    if isinstance(v1, float) and isinstance(v2, float):
        assert math.isclose(v1, v2, rel_tol=1e-4), f"cached value diverged: {v1} vs {v2}"
    else:
        assert v2 == v1


async def test_malformed_formula_spec_returns_422(client, admin):
    """A kpi_def whose formula_spec.type is bogus surfaces as 422 (authoring error)."""
    me = (await client.get("/auth/me", headers=admin)).json()
    tenant_id = uuid.UUID(me["tenant_id"])
    key = f"bogus_kpi_{uuid.uuid4().hex[:6]}"
    async with SessionLocal() as s:
        s.add(KpiDef(
            tenant_id=tenant_id, key=key, name="Bogus", owner_module="Test",
            formula_spec={"type": "not_a_real_shape"},
        ))
        await s.commit()

    r = await client.get(f"/api/kpis/{key}/value", headers=admin)
    assert r.status_code == 422, r.text
    assert "kpi evaluation error" in r.json()["detail"].lower()
