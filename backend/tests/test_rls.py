"""Proof that Postgres Row-Level Security isolates tenants (M13).

The app + the rest of the suite run as the `gaaex` role, which OWNS the tables and therefore
*bypasses* RLS — so testing isolation through the app engine would prove nothing. This test enables
RLS on `record` in the test DB and asserts the four isolation properties through a SECOND engine
bound to the dedicated NOSUPERUSER `gaaex_app` role (the role the app flips to for enforcement).

Plan + rationale: GAAex-Vision/2-kernel/16a-rls-implementation.md §3.
"""
import os
import uuid
from urllib.parse import urlparse, urlunparse

import pytest_asyncio
from sqlalchemy import text

from app.db import engine        # gaaex (owner) engine on gaaex_test — used here only for setup
from sqlalchemy.ext.asyncio import create_async_engine


def _app_role_url() -> str:
    """Derive the gaaex_app-role URL from the configured DATABASE_URL so we land on the same
    Postgres instance (5433 locally, CI's service port in CI) but as the NOSUPERUSER app role
    that RLS isolation must actually be tested against."""
    p = urlparse(os.environ["DATABASE_URL"])
    return urlunparse(p._replace(netloc=f"gaaex_app:gaaex_app@{p.hostname}:{p.port}"))


APP_ROLE_URL = _app_role_url()
GUC = "gaaex.tenant_id"


@pytest_asyncio.fixture(scope="module")
async def rls(_setup_db):
    """As the owner: ensure the gaaex_app role + grants, enable RLS on `record`, seed tenants A and B
    with one record each. Yields (app_engine, tenant_a, tenant_b, rec_a_id, rec_b_id). Cleans up RLS
    on teardown so the owner-role app tests are unaffected."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    rec_a, rec_b = uuid.uuid4(), uuid.uuid4()

    async with engine.begin() as c:
        # the role is cluster-wide (the migration may have made it on the dev DB); ensure + grant here
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaaex_app') THEN
                    CREATE ROLE gaaex_app LOGIN PASSWORD 'gaaex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaaex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON record TO gaaex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaaex_app;"))
        # two tenants (FK target) + one record each
        for t in (tenant_a, tenant_b):
            await c.execute(text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                            {"i": t, "n": f"RLS {t.hex[:6]}"})
        for rid, tid in ((rec_a, tenant_a), (rec_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO record (id, tenant_id, entity_key, status, data) "
                "VALUES (:i, :t, 'lead', 'NEW', '{}'::jsonb)"), {"i": rid, "t": tid})
        # enable RLS on record (owner still bypasses; the gaaex_app engine below is subject to it)
        await c.execute(text("ALTER TABLE record ENABLE ROW LEVEL SECURITY;"))
        await c.execute(text("DROP POLICY IF EXISTS tenant_isolation ON record;"))
        await c.execute(text(
            "CREATE POLICY tenant_isolation ON record "
            "USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid) "
            "WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);"))

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
            await conn.execute(text("SELECT set_config('gaaex.tenant_id', NULL, false)"))  # NULL ⇒ default-deny
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
