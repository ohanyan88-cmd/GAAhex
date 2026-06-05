"""Feature-flag CRUD, auth gates, audit-event emission, and the tenant_flag
server-side helper (Q5 — per-tenant business preferences).

The CRUD tests at the top of this file exercise the HTTP surface (frontend
``useFlag()`` reads via that). The tenant_flag.is_flag_enabled_for_tenant
helper tests + KT-M1-5 at the bottom exercise the server-side reader path
that backend services use (see docs/standards/FEATURE_GATING_POLICY.md).
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.db import OwnerSessionLocal
from app.models import FeatureFlag, Tenant
from app.scheduler import _resolve_tenant_gates, _TENANT_FLAG_GATED_JOBS
from app.services import tenant_flag


# ── helpers ──────────────────────────────────────────────────────────────────

FLAG_URL = "/api/feature-flags"


async def _create(client, headers, key="new-dashboard", label="New Dashboard", **kw):
    body = {"key": key, "label": label, **kw}
    r = await client.post(FLAG_URL, headers=headers, json=body)
    return r


# ── CRUD round-trip ───────────────────────────────────────────────────────────

async def test_feature_flag_crud(client, admin):
    # CREATE
    r = await _create(client, admin, key="crud-flag", label="CRUD Flag")
    assert r.status_code == 201, r.text
    flag = r.json()
    assert flag["key"] == "crud-flag"
    assert flag["label"] == "CRUD Flag"
    assert flag["enabled"] is False
    assert flag["role_scope"] is None
    fid = flag["id"]

    # LIST — flag appears
    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    keys = [f["key"] for f in r.json()]
    assert "crud-flag" in keys

    # PATCH enabled
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True

    # PATCH role_scope
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"role_scope": "super_admin"})
    assert r.status_code == 200
    assert r.json()["role_scope"] == "super_admin"

    # DELETE
    r = await client.delete(f"{FLAG_URL}/{fid}", headers=admin)
    assert r.status_code == 204

    # LIST — flag gone
    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    keys = [f["key"] for f in r.json()]
    assert "crud-flag" not in keys


# ── 403 for non-admin on writes ───────────────────────────────────────────────

async def test_feature_flag_403_on_write(client, agent):
    """An agent (no config.manage) cannot create, patch or delete flags."""
    # POST
    r = await _create(client, agent, key="agent-flag", label="Agent Flag")
    assert r.status_code == 403, r.text

    # We need a valid flag id for PATCH/DELETE — create one as admin first.
    # Since the admin fixture is session-scoped, create inline via a separate token.
    # To keep this self-contained we just test with a fake uuid — the auth gate fires first.
    fake_id = "00000000-0000-0000-0000-000000000001"
    r = await client.patch(f"{FLAG_URL}/{fake_id}", headers=agent, json={"enabled": True})
    assert r.status_code == 403

    r = await client.delete(f"{FLAG_URL}/{fake_id}", headers=agent)
    assert r.status_code == 403


# ── audit event emitted on patch ──────────────────────────────────────────────

async def test_feature_flag_audit_event_on_patch(client, admin):
    # Create a flag
    r = await _create(client, admin, key="audit-flag", label="Audit Flag")
    assert r.status_code == 201, r.text
    fid = r.json()["id"]

    # Patch it
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"enabled": True})
    assert r.status_code == 200

    # Verify an audit event exists for this flag_id
    r = await client.get(
        "/api/audit-log",
        headers=admin,
        params={"event_type": "FEATURE_FLAG.UPDATE", "limit": 50},
    )
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    matching = [e for e in events if e.get("data", {}).get("flag_id") == fid]
    assert len(matching) >= 1, "Expected at least one audit event for the patched flag"
    ev = matching[0]
    assert ev["data"]["after"]["enabled"] is True
    assert ev["data"]["before"]["enabled"] is False

    # Cleanup
    await client.delete(f"{FLAG_URL}/{fid}", headers=admin)


# ── list sorted by key ────────────────────────────────────────────────────────

async def test_feature_flag_list_sorted(client, admin):
    created_ids = []
    for key in ["zzz-flag", "aaa-flag", "mmm-flag"]:
        r = await _create(client, admin, key=key, label=key)
        if r.status_code == 201:
            created_ids.append(r.json()["id"])

    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    all_keys = [f["key"] for f in r.json()]
    # Assert our three are in sorted order relative to each other
    our_keys = [k for k in all_keys if k in ("aaa-flag", "mmm-flag", "zzz-flag")]
    assert our_keys == ["aaa-flag", "mmm-flag", "zzz-flag"]

    for fid in created_ids:
        await client.delete(f"{FLAG_URL}/{fid}", headers=admin)


# ────────────────────────────────────────────────────────────────────────────
# tenant_flag.is_flag_enabled_for_tenant — server-side per-tenant reader
# (Q5 / FEATURE_GATING_POLICY.md system #2)
# ────────────────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def two_tenants():
    """Stand up an isolated extra tenant in addition to the demo tenant. Yields
    (demo_tenant_id, extra_tenant_id). Cleans up the extra tenant after.

    Used by the Q5 helper tests + KT-M1-5 to prove per-tenant isolation.
    """
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        demo_tenant_id = (await s.execute(select(Tenant.id).order_by(Tenant.created_at))).scalars().first()
        extra = Tenant(name=f"Q5 Extra Tenant ({uuid.uuid4().hex[:6]})")
        s.add(extra)
        await s.commit()
        extra_tenant_id = extra.id

    yield demo_tenant_id, extra_tenant_id

    # Teardown — cleans up any FeatureFlag rows on the extra tenant first, then
    # the tenant itself. Owner session, audit bypass.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        await s.execute(delete(FeatureFlag).where(FeatureFlag.tenant_id == extra_tenant_id))
        await s.execute(delete(Tenant).where(Tenant.id == extra_tenant_id))
        await s.commit()


@pytest_asyncio.fixture
async def cleanup_demo_q5_flag():
    """Reset the demo tenant's dunning_automation flag back to enabled=False
    after a test that flipped it. Idempotent — no-op if the seed row doesn't
    exist yet (shouldn't happen post-seed but defensive)."""
    yield
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        demo_tenant_id = (await s.execute(select(Tenant.id).order_by(Tenant.created_at))).scalars().first()
        row = (await s.execute(
            select(FeatureFlag).where(
                FeatureFlag.tenant_id == demo_tenant_id,
                FeatureFlag.key == "dunning_automation",
            )
        )).scalar_one_or_none()
        if row is not None and row.enabled:
            row.enabled = False
            await s.commit()


async def test_tenant_flag_helper_returns_enabled_value(two_tenants):
    """When a FeatureFlag row exists for (tenant, key), the helper returns its
    ``enabled`` value — not the ``default`` parameter."""
    _, extra_tenant_id = two_tenants
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        s.add(FeatureFlag(
            tenant_id=extra_tenant_id,
            key="kt_q5_helper_on",
            label="Q5 Helper Test (ON)",
            enabled=True,
        ))
        s.add(FeatureFlag(
            tenant_id=extra_tenant_id,
            key="kt_q5_helper_off",
            label="Q5 Helper Test (OFF)",
            enabled=False,
        ))
        await s.commit()

        # Helper reads the row even with default=True — the row wins.
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "kt_q5_helper_on", default=False,
        ) is True
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "kt_q5_helper_off", default=True,
        ) is False


async def test_tenant_flag_helper_returns_default_on_missing(two_tenants):
    """When no FeatureFlag row exists for (tenant, key), the helper returns
    the ``default`` parameter. Default of the parameter itself is False
    (fail-closed: a tenant hasn't opted in unless they explicitly say so)."""
    _, extra_tenant_id = two_tenants
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        # No row → uses default
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "kt_q5_never_seeded",
        ) is False  # default's default

        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "kt_q5_never_seeded", default=True,
        ) is True  # explicit default wins when missing


async def test_tenant_flag_helper_cross_tenant_lookup_returns_default(two_tenants):
    """A lookup of tenant A's flag from a context that knows only tenant B's id
    returns the default — the row exists for A but isn't visible under the B
    query. Confirms the helper's per-tenant scoping is by ``WHERE tenant_id``
    (defense-in-depth; the platform also has RLS on the table for full
    isolation under request sessions)."""
    demo_tenant_id, extra_tenant_id = two_tenants
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        # Seed an ENABLED flag on the demo tenant.
        s.add(FeatureFlag(
            tenant_id=demo_tenant_id,
            key="kt_q5_demo_only",
            label="Q5 Demo Only",
            enabled=True,
        ))
        await s.commit()

        # Same key, queried under the EXTRA tenant's id → returns default (no
        # row visible for that (tenant, key) pair).
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "kt_q5_demo_only",
        ) is False

        # And for completeness — the demo tenant DOES see it.
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, demo_tenant_id, "kt_q5_demo_only",
        ) is True

        # Cleanup the test-only key on the demo tenant.
        await s.execute(delete(FeatureFlag).where(
            FeatureFlag.tenant_id == demo_tenant_id,
            FeatureFlag.key == "kt_q5_demo_only",
        ))
        await s.commit()


# ────────────────────────────────────────────────────────────────────────────
# KT-M1-5 — per-tenant feature-flag isolation killer test
# (proves Gev's Q5 lock-in: tenant A controls dunning_automation independently
# of tenant B)
# ────────────────────────────────────────────────────────────────────────────


async def test_m1_per_tenant_feature_flag_isolation(client, admin, two_tenants, cleanup_demo_q5_flag):
    """KT-M1-5. Tenant A enables ``dunning_automation`` via the CRUD endpoint;
    Tenant B leaves it OFF. The scheduler's per-tenant gate resolver returns
    the right answer for each tenant — A skips nothing, B skips the gated job.

    Proves:
      - Per-tenant flag mutations don't leak across tenants
      - The scheduler-side reader (the boundary at which automation skips a
        tenant) consults the right tenant's row
      - The fallback semantics work: a tenant without an explicit row gets
        the default-False answer
    """
    demo_tenant_id, extra_tenant_id = two_tenants

    # Tenant A (demo) flips dunning_automation ON via the API (audit-logged).
    # Find the seeded row first.
    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    rows = r.json()
    seed_row = next((row for row in rows if row["key"] == "dunning_automation"), None)
    assert seed_row is not None, (
        "dunning_automation seed row missing on demo tenant; "
        "seed_business_flags_if_empty() should have created it"
    )
    assert seed_row["enabled"] is False  # default OFF

    r = await client.patch(
        f"{FLAG_URL}/{seed_row['id']}", headers=admin, json={"enabled": True},
    )
    assert r.status_code == 200, r.text
    assert r.json()["enabled"] is True

    # Tenant B (extra) is left as-is — the seed runs once at boot; the
    # post-boot extra tenant has NO flag row, so the helper returns its
    # default (False). This proves the platform doesn't force tenants to
    # share a setting just because one was created later.

    # The scheduler's gate resolver: ask for each tenant.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        gates_a = await _resolve_tenant_gates(s, demo_tenant_id)
        gates_b = await _resolve_tenant_gates(s, extra_tenant_id)

    # Sanity — the map covers the dunning job.
    assert _TENANT_FLAG_GATED_JOBS.get("billing.run_dunning") == "dunning_automation"

    # Tenant A opted in → gate True → scheduler will RUN the job for A.
    assert gates_a["billing.run_dunning"] is True
    # Tenant B did NOT opt in → gate False → scheduler will SKIP the job for B.
    assert gates_b["billing.run_dunning"] is False

    # And the direct helper reflects the same per-tenant answers — defense in
    # depth that the gate map is reading from the right source of truth.
    async with OwnerSessionLocal() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, demo_tenant_id, "dunning_automation",
        ) is True
        assert await tenant_flag.is_flag_enabled_for_tenant(
            s, extra_tenant_id, "dunning_automation",
        ) is False
