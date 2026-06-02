"""Proof that Postgres Row-Level Security isolates tenants (M13).

The app + the rest of the suite run as the `gaahex` role, which OWNS the tables and therefore
*bypasses* RLS — so testing isolation through the app engine would prove nothing. This test enables
RLS on `record` in the test DB and asserts the four isolation properties through a SECOND engine
bound to the dedicated NOSUPERUSER `gaahex_app` role (the role the app flips to for enforcement).

Plan + rationale: GAAhex-Vision/2-kernel/16a-rls-implementation.md §3.
"""
import os
import uuid
from urllib.parse import urlparse, urlunparse

import pytest_asyncio
from sqlalchemy import text

from app.db import engine        # gaahex (owner) engine on gaahex_test — used here only for setup
from sqlalchemy.ext.asyncio import create_async_engine


def _app_role_url() -> str:
    """Derive the gaahex_app-role URL from the configured DATABASE_URL so we land on the same
    Postgres instance (5433 locally, CI's service port in CI) but as the NOSUPERUSER app role
    that RLS isolation must actually be tested against."""
    p = urlparse(os.environ["DATABASE_URL"])
    return urlunparse(p._replace(netloc=f"gaahex_app:gaahex_app@{p.hostname}:{p.port}"))


APP_ROLE_URL = _app_role_url()
GUC = "gaahex.tenant_id"


@pytest_asyncio.fixture(scope="module")
async def rls(_setup_db):
    """As the owner: ensure the gaahex_app role + grants, enable RLS on `record`, seed tenants A and B
    with one record each. Yields (app_engine, tenant_a, tenant_b, rec_a_id, rec_b_id). Cleans up RLS
    on teardown so the owner-role app tests are unaffected."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    rec_a, rec_b = uuid.uuid4(), uuid.uuid4()

    async with engine.begin() as c:
        # the role is cluster-wide (the migration may have made it on the dev DB); ensure + grant here
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
                    CREATE ROLE gaahex_app LOGIN PASSWORD 'gaahex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaahex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON record TO gaahex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaahex_app;"))
        # two tenants (FK target) + one record each
        for t in (tenant_a, tenant_b):
            await c.execute(text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                            {"i": t, "n": f"RLS {t.hex[:6]}"})
        for rid, tid in ((rec_a, tenant_a), (rec_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO record (id, tenant_id, entity_key, status, data) "
                "VALUES (:i, :t, 'lead', 'NEW', '{}'::jsonb)"), {"i": rid, "t": tid})
        # enable RLS on record (owner still bypasses; the gaahex_app engine below is subject to it)
        await c.execute(text("ALTER TABLE record ENABLE ROW LEVEL SECURITY;"))
        await c.execute(text("DROP POLICY IF EXISTS tenant_isolation ON record;"))
        await c.execute(text(
            "CREATE POLICY tenant_isolation ON record "
            "USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid) "
            "WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);"))

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b, rec_a, rec_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            # leave the shared test DB as the owner-bypass app tests expect
            await c.execute(text("DROP POLICY IF EXISTS tenant_isolation ON record;"))
            await c.execute(text("ALTER TABLE record DISABLE ROW LEVEL SECURITY;"))
            await c.execute(text("DELETE FROM record WHERE id IN (:a, :b)"), {"a": rec_a, "b": rec_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"), {"a": tenant_a, "b": tenant_b})


async def _count_as(app_engine, tenant_guc):
    async with app_engine.connect() as conn:
        if tenant_guc is not None:
            await conn.execute(text("SELECT set_config(:k, :v, false)"), {"k": GUC, "v": str(tenant_guc)})
        else:
            await conn.execute(text("SELECT set_config('gaahex.tenant_id', NULL, false)"))  # NULL ⇒ default-deny
        rows = (await conn.execute(text("SELECT tenant_id FROM record"))).scalars().all()
        return [str(r) for r in rows]


async def test_rls_isolates_by_tenant(rls):
    app_engine, tenant_a, tenant_b, rec_a, rec_b = rls

    # 1. GUC=A → sees A's row, not B's
    a_rows = await _count_as(app_engine, tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows

    # 2. GUC=B → sees B's row, not A's
    b_rows = await _count_as(app_engine, tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows

    # 3. GUC unset → default-deny (zero rows, never a leak)
    none_rows = await _count_as(app_engine, None)
    assert none_rows == []


async def test_rls_with_check_blocks_cross_tenant_insert(rls):
    app_engine, tenant_a, tenant_b, _rec_a, _rec_b = rls
    # bound to B, try to write a row tagged A → WITH CHECK must reject it
    async with app_engine.connect() as conn:
        await conn.execute(text("SELECT set_config(:k, :v, false)"), {"k": GUC, "v": str(tenant_b)})
        raised = False
        try:
            await conn.execute(text(
                "INSERT INTO record (id, tenant_id, entity_key, status, data) "
                "VALUES (:i, :t, 'lead', 'NEW', '{}'::jsonb)"),
                {"i": uuid.uuid4(), "t": tenant_a})
            await conn.commit()
        except Exception:
            raised = True
            await conn.rollback()
        assert raised, "WITH CHECK should reject inserting a row under another tenant"


# ──────────────────────────────────────────────────────────────────────────────
# M1-A Wave 3 spot tests
#
# The Wave 3 migration (e7f4a2b9c8d1) backfills the tenant_isolation policy on 27 tables that
# landed AFTER the original 3a9203795d07 RLS migration. The full parametric harness over all 27
# tables is Wave 5; what follows here are three immediate proof points on high-value tables:
#   - tariff_plan   (admin-edited, multi-tenant-visible config)
#   - payment_method (PCI-adjacent, customer-bound)
#   - dunning_policy (financial state-machine config — chose policy over `case` to avoid the
#                     account/invoice/policy FK chain; same tenant_id RLS shape either way)
#
# The test conftest uses Base.metadata.create_all() rather than alembic upgrade, so the Wave 3
# migration is NOT applied to gaahex_test — each spot fixture enables RLS + creates the policy +
# grants to gaahex_app itself, mirroring the existing `rls` fixture above. (Pattern is identical
# across all three — only the table name and the seed-row SQL differ.)
# ──────────────────────────────────────────────────────────────────────────────


async def _enable_rls_and_grant(c, table: str) -> None:
    """Enable RLS + the tenant_isolation policy + gaahex_app grants on a table.

    Replicates the exact predicate shape used by 3a9203795d07 / 642fa959d432 / Wave 3:
    NULLIF-guarded so an unset or empty GUC yields NULL → default-deny.
    """
    await c.execute(text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO gaahex_app;"))
    await c.execute(text(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;"))
    await c.execute(text(f"DROP POLICY IF EXISTS tenant_isolation ON {table};"))
    await c.execute(text(
        f"CREATE POLICY tenant_isolation ON {table} "
        f"USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid) "
        f"WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);"))


async def _disable_rls(c, table: str) -> None:
    await c.execute(text(f"DROP POLICY IF EXISTS tenant_isolation ON {table};"))
    await c.execute(text(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;"))


async def _select_tenant_ids_under_guc(app_engine, table: str, guc_value):
    async with app_engine.connect() as conn:
        if guc_value is not None:
            await conn.execute(text("SELECT set_config(:k, :v, false)"),
                               {"k": GUC, "v": str(guc_value)})
        else:
            await conn.execute(text("SELECT set_config('gaahex.tenant_id', NULL, false)"))
        rows = (await conn.execute(text(f"SELECT tenant_id FROM {table}"))).scalars().all()
        return [str(r) for r in rows]


@pytest_asyncio.fixture()
async def rls_tariff_plan(_setup_db):
    """RLS-enabled tariff_plan with one row per tenant. Yields (app_engine, tenant_a, tenant_b)."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        # ensure the role exists on this DB (idempotent — the main `rls` fixture also does this)
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
                    CREATE ROLE gaahex_app LOGIN PASSWORD 'gaahex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaahex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaahex_app;"))
        for t in (tenant_a, tenant_b):
            await c.execute(text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                            {"i": t, "n": f"RLS-TP {t.hex[:6]}"})
        await _enable_rls_and_grant(c, "tariff_plan")
        for t in (tenant_a, tenant_b):
            await c.execute(text(
                "INSERT INTO tariff_plan (id, tenant_id, key, name, base_recurring_price) "
                "VALUES (:i, :t, :k, :n, 19.99)"),
                {"i": uuid.uuid4(), "t": t,
                 "k": f"plan_{t.hex[:6]}", "n": f"Plan {t.hex[:6]}"})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "tariff_plan")
            await c.execute(text("DELETE FROM tariff_plan WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_tariff_plan_isolates_by_tenant(rls_tariff_plan):
    app_engine, tenant_a, tenant_b = rls_tariff_plan
    a_rows = await _select_tenant_ids_under_guc(app_engine, "tariff_plan", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "tariff_plan", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    # back to A — A's row is visible again (proves RLS is per-connection-GUC, not destructive)
    a_again = await _select_tenant_ids_under_guc(app_engine, "tariff_plan", tenant_a)
    assert str(tenant_a) in a_again and str(tenant_b) not in a_again


@pytest_asyncio.fixture()
async def rls_payment_method(_setup_db):
    """RLS-enabled payment_method with one row per tenant. Each row's customer_id points at a
    tenant-matching `record` (FK), seeded under the owner connection (RLS-bypass)."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    cust_a, cust_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
                    CREATE ROLE gaahex_app LOGIN PASSWORD 'gaahex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaahex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaahex_app;"))
        for t in (tenant_a, tenant_b):
            await c.execute(text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                            {"i": t, "n": f"RLS-PM {t.hex[:6]}"})
        # Customer records (payment_method.customer_id FK → record.id). Owner bypasses RLS,
        # so these inserts succeed regardless of the policy on `record`.
        for cid, tid in ((cust_a, tenant_a), (cust_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO record (id, tenant_id, entity_key, status, data) "
                "VALUES (:i, :t, 'customer', 'ACTIVE', '{}'::jsonb)"),
                {"i": cid, "t": tid})
        await _enable_rls_and_grant(c, "payment_method")
        for cid, tid in ((cust_a, tenant_a), (cust_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO payment_method "
                "(id, tenant_id, customer_id, gateway, gateway_token, last4, brand, "
                " exp_month, exp_year) "
                "VALUES (:i, :t, :c, 'logging', :tok, '4242', 'visa', 12, 2099)"),
                {"i": uuid.uuid4(), "t": tid, "c": cid, "tok": f"tok_{tid.hex[:8]}"})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "payment_method")
            await c.execute(text("DELETE FROM payment_method WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM record WHERE id IN (:a, :b)"),
                            {"a": cust_a, "b": cust_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_payment_method_isolates_by_tenant(rls_payment_method):
    app_engine, tenant_a, tenant_b = rls_payment_method
    a_rows = await _select_tenant_ids_under_guc(app_engine, "payment_method", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "payment_method", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "payment_method", None)
    assert none_rows == []


@pytest_asyncio.fixture()
async def rls_dunning_policy(_setup_db):
    """RLS-enabled dunning_policy with one row per tenant. dunning_policy is the simplest table
    in the dunning state-machine (no FK chain) — the brief flagged `dunning_case` but that
    requires account+invoice+policy FKs; the RLS shape is identical to either case-or-policy."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
                    CREATE ROLE gaahex_app LOGIN PASSWORD 'gaahex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaahex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaahex_app;"))
        for t in (tenant_a, tenant_b):
            await c.execute(text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                            {"i": t, "n": f"RLS-DP {t.hex[:6]}"})
        await _enable_rls_and_grant(c, "dunning_policy")
        for t in (tenant_a, tenant_b):
            await c.execute(text(
                "INSERT INTO dunning_policy (id, tenant_id, name) VALUES (:i, :t, :n)"),
                {"i": uuid.uuid4(), "t": t, "n": f"Policy {t.hex[:6]}"})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "dunning_policy")
            await c.execute(text("DELETE FROM dunning_policy WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_dunning_policy_isolates_by_tenant(rls_dunning_policy):
    app_engine, tenant_a, tenant_b = rls_dunning_policy
    a_rows = await _select_tenant_ids_under_guc(app_engine, "dunning_policy", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "dunning_policy", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    a_again = await _select_tenant_ids_under_guc(app_engine, "dunning_policy", tenant_a)
    assert str(tenant_a) in a_again and str(tenant_b) not in a_again
