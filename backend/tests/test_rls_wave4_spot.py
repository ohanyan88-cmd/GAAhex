"""M1-A Wave 4 RLS spot tests — coverage for the FK-heavy / non-tenant-FK tables that the
parametric harness in `test_rls_parametric.py` cannot exercise from a synthesized seed row.

Wave 4 (alembic `f8a1b2c3d4e5_m1a_wave4_rls_backfill`) enabled the standard `tenant_isolation`
policy on 31 tenant-scoped tables. Most of them are covered by `test_rls_parametric.py`'s
auto-discovery (`Base.metadata` + placeholder synth). The harness deliberately bails on tables
whose seed row needs a parent chain it doesn't synthesize:

  - Tables present in `KNOWN_FK_HEAVY` are skipped explicitly.
  - Tables NOT in `KNOWN_FK_HEAVY` whose NOT-NULL columns include a non-tenant FK
    (`_build_seed_row` returns `None`) skip with a "placeholder gap" message.

This file closes both gaps for the 10 highest-risk Wave 4 tables that hold multi-tenant data
(orders, payment, invoice, subscription, service, product, account, party, task, attachment in
the brief). Of those, party / subscription / service / product / order / payment / invoice are
already proven by the parametric harness (no NOT-NULL non-tenant FK), so this file adds spot
tests for the remaining high-risk Wave 4 tables that the harness cannot reach:

  - account               — FK→party (holder_party_id) [KNOWN_FK_HEAVY]
  - invoice_line          — FK→invoice [KNOWN_FK_HEAVY]
  - order_item            — FK→order [KNOWN_FK_HEAVY]
  - service_resource      — FK→service [KNOWN_FK_HEAVY]
  - interaction           — FK→app_user (agent_user_id) [KNOWN_FK_HEAVY]
  - pool_allocation       — FK→resource_pool [KNOWN_FK_HEAVY]
  - webhook_delivery      — FK→webhook_def [KNOWN_FK_HEAVY]
  - task                  — FK→app_user (created_by) [parametric placeholder gap]
  - attachment            — FK→app_user (created_by) [parametric placeholder gap]
  - comment               — FK→app_user (author_id) [parametric placeholder gap]

Pattern (identical across all ten — only the parent-row chain differs):

  1. Owner-role connection seeds two tenants + any required non-tenant parent rows
     (party / invoice / order / service / resource_pool / webhook_def / app_user). Owner
     bypasses RLS, so parent rows seed cleanly regardless of any policy on those tables.
  2. `_enable_rls_and_grant(c, <table>)` flips RLS on with the standard tenant_isolation
     predicate — same shape as Waves 1/3/4 production migrations.
  3. Two rows are inserted into the table under test (one per tenant) via the owner conn.
  4. Through the `gaahex_app` engine the test sets GUC=A and asserts only A's row is
     visible; sets GUC=B and asserts only B's row; unsets the GUC and asserts default-deny
     yields zero (NULLIF-guarded predicate).
  5. Teardown drops the policy, disables RLS, deletes the seeded rows and parent rows so
     the shared test DB is left in its expected owner-bypass state.

Helpers `_enable_rls_and_grant`, `_disable_rls`, `_select_tenant_ids_under_guc`, plus the
`APP_ROLE_URL` builder, are imported from `test_rls.py` — same predicate shape as the Wave 3
spot tests so a regression in the shared helper surfaces here too.
"""
import os
import uuid
from urllib.parse import urlparse, urlunparse

import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db import engine  # gaahex (owner) — seeds + RLS toggles + cleanup
from tests.test_rls import (  # reuse helpers — same predicate shape as the Wave 3 spot tests
    _disable_rls,
    _enable_rls_and_grant,
    _select_tenant_ids_under_guc,
)


GUC = "gaahex.tenant_id"


def _app_role_url() -> str:
    """Same shape as test_rls._app_role_url — derive the gaahex_app URL from DATABASE_URL."""
    p = urlparse(os.environ["DATABASE_URL"])
    return urlunparse(p._replace(netloc=f"gaahex_app:gaahex_app@{p.hostname}:{p.port}"))


APP_ROLE_URL = _app_role_url()


async def _ensure_app_role_and_grants(c) -> None:
    """Idempotent: create the gaahex_app role + the baseline grants every spot test needs.
    All Wave 4 spot fixtures call this before doing table-specific grants."""
    await c.execute(text("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaahex_app') THEN
                CREATE ROLE gaahex_app LOGIN PASSWORD 'gaahex_app' NOSUPERUSER NOBYPASSRLS;
            END IF;
        END $$;
    """))
    await c.execute(text("GRANT USAGE ON SCHEMA public TO gaahex_app;"))
    await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaahex_app;"))


async def _seed_two_tenants(c, tenant_a: uuid.UUID, tenant_b: uuid.UUID, tag: str) -> None:
    """Insert two test tenants. `tag` keeps the name distinct from sibling fixtures."""
    for t in (tenant_a, tenant_b):
        await c.execute(
            text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
            {"i": t, "n": f"RLS-W4-{tag} {t.hex[:6]}"},
        )


# ──────────────────────────────────────────────────────────────────────────────
# 1) account — FK→party (holder_party_id NOT NULL). KNOWN_FK_HEAVY → parametric
#    skip; we seed a Party per tenant, then one Account per tenant against that
#    Party. RLS predicate uses tenant_id only, so the FK shape is incidental.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_account(_setup_db):
    """RLS-enabled `account` with one row per tenant, each holder_party_id pointing at a
    tenant-matching `party` row seeded under the owner connection (RLS-bypass)."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    party_a, party_b = uuid.uuid4(), uuid.uuid4()
    acct_a, acct_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "ACCT")
        for pid, tid in ((party_a, tenant_a), (party_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO party (id, tenant_id, type, name, status) "
                "VALUES (:i, :t, 'individual', :n, 'active')"),
                {"i": pid, "t": tid, "n": f"P-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "account")
        for aid, pid, tid in ((acct_a, party_a, tenant_a), (acct_b, party_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO account (id, tenant_id, holder_party_id, type, currency, "
                "billing_cycle, status) "
                "VALUES (:i, :t, :p, 'residential', 'AMD', 'monthly', 'active')"),
                {"i": aid, "t": tid, "p": pid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "account")
            await c.execute(text("DELETE FROM account WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM party WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_account_isolates_by_tenant(rls_account):
    """`account` RLS spot: GUC=A sees only A's account; GUC=B only B's; no GUC = zero rows."""
    app_engine, tenant_a, tenant_b = rls_account
    a_rows = await _select_tenant_ids_under_guc(app_engine, "account", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "account", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "account", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 2) invoice_line — FK→invoice (invoice_id NOT NULL). KNOWN_FK_HEAVY → parametric
#    skip; we seed an Invoice per tenant first. invoice has DELETE-prevention
#    triggers in production (alembic b70ef3b98e27), but conftest uses
#    Base.metadata.create_all and does NOT install those triggers — so per-test
#    DELETE on invoice works under the test DB.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_invoice_line(_setup_db):
    """RLS-enabled `invoice_line` with one row per tenant, each invoice_id pointing at a
    tenant-matching `invoice` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    inv_a, inv_b = uuid.uuid4(), uuid.uuid4()
    line_a, line_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "ILN")
        for iid, tid in ((inv_a, tenant_a), (inv_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO invoice (id, tenant_id, number, status, total) "
                "VALUES (:i, :t, :n, 'DRAFT', 0)"),
                {"i": iid, "t": tid, "n": f"INV-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "invoice_line")
        for lid, iid, tid in ((line_a, inv_a, tenant_a), (line_b, inv_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO invoice_line (id, tenant_id, invoice_id, kind, description, "
                "quantity, unit_amount, line_total) "
                "VALUES (:i, :t, :iv, 'charge', 'svc', 1, 0, 0)"),
                {"i": lid, "t": tid, "iv": iid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "invoice_line")
            await c.execute(text("DELETE FROM invoice_line WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM invoice WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_invoice_line_isolates_by_tenant(rls_invoice_line):
    """`invoice_line` RLS spot: GUC switch flips visibility per tenant; no GUC = zero rows."""
    app_engine, tenant_a, tenant_b = rls_invoice_line
    a_rows = await _select_tenant_ids_under_guc(app_engine, "invoice_line", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "invoice_line", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "invoice_line", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 3) order_item — FK→"order" (order_id NOT NULL). KNOWN_FK_HEAVY → parametric
#    skip; we seed an Order per tenant first. NOTE: `order` is a SQL reserved
#    word — every reference is double-quoted.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_order_item(_setup_db):
    """RLS-enabled `order_item` with one row per tenant, each order_id pointing at a
    tenant-matching `"order"` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    ord_a, ord_b = uuid.uuid4(), uuid.uuid4()
    item_a, item_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "OIT")
        # `order` is reserved — double-quote it in raw SQL.
        for oid, tid in ((ord_a, tenant_a), (ord_b, tenant_b)):
            await c.execute(text(
                'INSERT INTO "order" (id, tenant_id, number, status, total) '
                "VALUES (:i, :t, :n, 'DRAFT', 0)"),
                {"i": oid, "t": tid, "n": f"ORD-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "order_item")
        for iid, oid, tid in ((item_a, ord_a, tenant_a), (item_b, ord_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO order_item (id, tenant_id, order_id, description, "
                "quantity, unit_amount, line_total) "
                "VALUES (:i, :t, :o, 'item', 1, 0, 0)"),
                {"i": iid, "t": tid, "o": oid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "order_item")
            await c.execute(text("DELETE FROM order_item WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text('DELETE FROM "order" WHERE tenant_id IN (:a, :b)'),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_order_item_isolates_by_tenant(rls_order_item):
    """`order_item` RLS spot: parent table name "order" is reserved + double-quoted; child
    table needs no quoting. GUC switch flips visibility per tenant."""
    app_engine, tenant_a, tenant_b = rls_order_item
    a_rows = await _select_tenant_ids_under_guc(app_engine, "order_item", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "order_item", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "order_item", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 4) service_resource — FK→service (service_id NOT NULL). KNOWN_FK_HEAVY →
#    parametric skip; we seed a Service per tenant first.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_service_resource(_setup_db):
    """RLS-enabled `service_resource` with one row per tenant, each service_id pointing at a
    tenant-matching `service` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    svc_a, svc_b = uuid.uuid4(), uuid.uuid4()
    res_a, res_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "SVR")
        for sid, tid in ((svc_a, tenant_a), (svc_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO service (id, tenant_id, type, name, status) "
                "VALUES (:i, :t, 'internet', :n, 'PENDING')"),
                {"i": sid, "t": tid, "n": f"Svc-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "service_resource")
        for rid, sid, tid in ((res_a, svc_a, tenant_a), (res_b, svc_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO service_resource (id, tenant_id, service_id, kind, value, status) "
                "VALUES (:i, :t, :s, 'ip', :v, 'ALLOCATED')"),
                {"i": rid, "t": tid, "s": sid, "v": f"10.0.0.{tid.int % 200 + 1}"})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "service_resource")
            await c.execute(text("DELETE FROM service_resource WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM service WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_service_resource_isolates_by_tenant(rls_service_resource):
    """`service_resource` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_service_resource
    a_rows = await _select_tenant_ids_under_guc(app_engine, "service_resource", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "service_resource", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "service_resource", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 5) interaction — FK→app_user (agent_user_id NOT NULL). KNOWN_FK_HEAVY →
#    parametric skip; we seed an app_user per tenant first. Email is UNIQUE
#    cluster-wide, so the per-fixture short-hex suffix guarantees no clash with
#    seeded users or sibling fixtures.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_interaction(_setup_db):
    """RLS-enabled `interaction` with one row per tenant, each agent_user_id pointing at a
    tenant-matching `app_user` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    intr_a, intr_b = uuid.uuid4(), uuid.uuid4()
    short = uuid.uuid4().hex[:8]   # collision fence on app_user.email (UNIQUE cluster-wide)
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "INT")
        for uid, tid, tag in ((user_a, tenant_a, "a"), (user_b, tenant_b, "b")):
            await c.execute(text(
                "INSERT INTO app_user (id, tenant_id, email, name, password_hash, status) "
                "VALUES (:i, :t, :e, :n, 'x', 'ACTIVE')"),
                {"i": uid, "t": tid, "e": f"rls-int-{tag}-{short}@example.test",
                 "n": f"RLS-INT {tag}"})
        await _enable_rls_and_grant(c, "interaction")
        for iid, uid, tid in ((intr_a, user_a, tenant_a), (intr_b, user_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO interaction (id, tenant_id, channel, direction, body, agent_user_id) "
                "VALUES (:i, :t, 'EMAIL', 'INBOUND', 'hello', :u)"),
                {"i": iid, "t": tid, "u": uid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "interaction")
            await c.execute(text("DELETE FROM interaction WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM app_user WHERE id IN (:a, :b)"),
                            {"a": user_a, "b": user_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_interaction_isolates_by_tenant(rls_interaction):
    """`interaction` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_interaction
    a_rows = await _select_tenant_ids_under_guc(app_engine, "interaction", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "interaction", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "interaction", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 6) pool_allocation — FK→resource_pool (pool_id NOT NULL). KNOWN_FK_HEAVY →
#    parametric skip; we seed a ResourcePool per tenant first. The partial
#    UNIQUE index on (pool_id, value) WHERE status='ALLOCATED' only matters
#    within a single pool — distinct pools per tenant means no clash even with
#    identical `value`.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_pool_allocation(_setup_db):
    """RLS-enabled `pool_allocation` with one row per tenant, each pool_id pointing at a
    tenant-matching `resource_pool` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    pool_a, pool_b = uuid.uuid4(), uuid.uuid4()
    alloc_a, alloc_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "POOL")
        for pid, tid in ((pool_a, tenant_a), (pool_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO resource_pool (id, tenant_id, name, kind, spec) "
                "VALUES (:i, :t, :n, 'ipv4', '{\"cidr\":\"10.0.0.0/24\"}'::jsonb)"),
                {"i": pid, "t": tid, "n": f"Pool-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "pool_allocation")
        for aid, pid, tid in ((alloc_a, pool_a, tenant_a), (alloc_b, pool_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO pool_allocation (id, tenant_id, pool_id, value, status) "
                "VALUES (:i, :t, :p, '10.0.0.1', 'ALLOCATED')"),
                {"i": aid, "t": tid, "p": pid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "pool_allocation")
            await c.execute(text("DELETE FROM pool_allocation WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM resource_pool WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_pool_allocation_isolates_by_tenant(rls_pool_allocation):
    """`pool_allocation` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_pool_allocation
    a_rows = await _select_tenant_ids_under_guc(app_engine, "pool_allocation", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "pool_allocation", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "pool_allocation", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 7) webhook_delivery — FK→webhook_def (webhook_id NOT NULL). KNOWN_FK_HEAVY →
#    parametric skip; we seed a WebhookDef per tenant first. `secret` uses the
#    EncryptedString type at the ORM layer; raw SQL inserts a NULL since the
#    column is nullable and the test does not exercise the delivery path.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_webhook_delivery(_setup_db):
    """RLS-enabled `webhook_delivery` with one row per tenant, each webhook_id pointing at a
    tenant-matching `webhook_def` row seeded under the owner connection."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    whk_a, whk_b = uuid.uuid4(), uuid.uuid4()
    dlv_a, dlv_b = uuid.uuid4(), uuid.uuid4()
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "WHD")
        for wid, tid in ((whk_a, tenant_a), (whk_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO webhook_def (id, tenant_id, name, url, events, active) "
                "VALUES (:i, :t, :n, 'https://example.test/hook', '[]'::jsonb, true)"),
                {"i": wid, "t": tid, "n": f"Hook-{tid.hex[:6]}"})
        await _enable_rls_and_grant(c, "webhook_delivery")
        for did, wid, tid in ((dlv_a, whk_a, tenant_a), (dlv_b, whk_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO webhook_delivery (id, tenant_id, webhook_id, event_type, "
                "payload, status, attempts) "
                "VALUES (:i, :t, :w, 'invoice.paid', '{}'::jsonb, 'QUEUED', 0)"),
                {"i": did, "t": tid, "w": wid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "webhook_delivery")
            await c.execute(text("DELETE FROM webhook_delivery WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM webhook_def WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_webhook_delivery_isolates_by_tenant(rls_webhook_delivery):
    """`webhook_delivery` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_webhook_delivery
    a_rows = await _select_tenant_ids_under_guc(app_engine, "webhook_delivery", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "webhook_delivery", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "webhook_delivery", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 8) task — NOT in KNOWN_FK_HEAVY but the placeholder synth silently skips it
#    because `created_by` is NOT NULL with FK→app_user. We seed an app_user per
#    tenant. owner_id / assignee_id are NOT NULL UUIDs WITHOUT a FK declaration
#    on the model (typed as polymorphic principal refs); any UUID is valid at
#    the DB layer.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_task(_setup_db):
    """RLS-enabled `task` with one row per tenant. owner_id/assignee_id are not FK-constrained
    so we reuse the seeded app_user id for both; created_by is FK→app_user."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    task_a, task_b = uuid.uuid4(), uuid.uuid4()
    short = uuid.uuid4().hex[:8]
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "TSK")
        for uid, tid, tag in ((user_a, tenant_a, "a"), (user_b, tenant_b, "b")):
            await c.execute(text(
                "INSERT INTO app_user (id, tenant_id, email, name, password_hash, status) "
                "VALUES (:i, :t, :e, :n, 'x', 'ACTIVE')"),
                {"i": uid, "t": tid, "e": f"rls-tsk-{tag}-{short}@example.test",
                 "n": f"RLS-TSK {tag}"})
        await _enable_rls_and_grant(c, "task")
        for tid_row, uid, tid in ((task_a, user_a, tenant_a), (task_b, user_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO task (id, tenant_id, reference_number, title, "
                "task_type, task_scope, status, priority, "
                "owner_type, owner_id, assignee_type, assignee_id, "
                "sla_status, created_by, updated_at) "
                "VALUES (:i, :t, :r, 'rls', 'GENERAL', 'STANDALONE', 'OPEN', 'MEDIUM', "
                "'EMPLOYEE', :u, 'EMPLOYEE', :u, 'NOT_APPLICABLE', :u, now())"),
                {"i": tid_row, "t": tid, "u": uid, "r": f"TSK-{tid.hex[:6]}"})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "task")
            await c.execute(text("DELETE FROM task WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM app_user WHERE id IN (:a, :b)"),
                            {"a": user_a, "b": user_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_task_isolates_by_tenant(rls_task):
    """`task` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_task
    a_rows = await _select_tenant_ids_under_guc(app_engine, "task", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "task", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "task", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 9) attachment — NOT in KNOWN_FK_HEAVY but placeholder synth silently skips it
#    because `created_by` is NOT NULL with FK→app_user. owner_entity_type +
#    owner_entity_id are polymorphic (no FK), so any string + UUID is valid.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_attachment(_setup_db):
    """RLS-enabled `attachment` with one row per tenant; created_by is FK→app_user, so we
    seed a user per tenant first. The polymorphic owner_entity_* pair gets dummy values."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    att_a, att_b = uuid.uuid4(), uuid.uuid4()
    short = uuid.uuid4().hex[:8]
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "ATT")
        for uid, tid, tag in ((user_a, tenant_a, "a"), (user_b, tenant_b, "b")):
            await c.execute(text(
                "INSERT INTO app_user (id, tenant_id, email, name, password_hash, status) "
                "VALUES (:i, :t, :e, :n, 'x', 'ACTIVE')"),
                {"i": uid, "t": tid, "e": f"rls-att-{tag}-{short}@example.test",
                 "n": f"RLS-ATT {tag}"})
        await _enable_rls_and_grant(c, "attachment")
        for aid, uid, tid in ((att_a, user_a, tenant_a), (att_b, user_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO attachment (id, tenant_id, owner_entity_type, owner_entity_id, "
                "file_name, original_file_name, file_extension, mime_type, file_size, "
                "checksum, storage_key, category, status, created_by) "
                "VALUES (:i, :t, 'record', :oe, 'f.bin', 'orig.bin', '.bin', "
                "'application/octet-stream', 0, 'x', :sk, 'DOCUMENT', 'UPLOADING', :u)"),
                {"i": aid, "t": tid, "oe": uuid.uuid4(), "sk": f"k/{tid.hex[:8]}", "u": uid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "attachment")
            await c.execute(text("DELETE FROM attachment WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM app_user WHERE id IN (:a, :b)"),
                            {"a": user_a, "b": user_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_attachment_isolates_by_tenant(rls_attachment):
    """`attachment` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_attachment
    a_rows = await _select_tenant_ids_under_guc(app_engine, "attachment", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "attachment", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "attachment", None)
    assert none_rows == []


# ──────────────────────────────────────────────────────────────────────────────
# 10) comment — NOT in KNOWN_FK_HEAVY but placeholder synth silently skips it
#     because `author_id` is NOT NULL with FK→app_user. parent_object_type +
#     parent_object_id are polymorphic (no FK), so any string + UUID is valid.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture()
async def rls_comment(_setup_db):
    """RLS-enabled `comment` with one row per tenant; author_id is FK→app_user, so we
    seed a user per tenant first."""
    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    cmt_a, cmt_b = uuid.uuid4(), uuid.uuid4()
    short = uuid.uuid4().hex[:8]
    async with engine.begin() as c:
        await _ensure_app_role_and_grants(c)
        await _seed_two_tenants(c, tenant_a, tenant_b, "CMT")
        for uid, tid, tag in ((user_a, tenant_a, "a"), (user_b, tenant_b, "b")):
            await c.execute(text(
                "INSERT INTO app_user (id, tenant_id, email, name, password_hash, status) "
                "VALUES (:i, :t, :e, :n, 'x', 'ACTIVE')"),
                {"i": uid, "t": tid, "e": f"rls-cmt-{tag}-{short}@example.test",
                 "n": f"RLS-CMT {tag}"})
        await _enable_rls_and_grant(c, "comment")
        for cid, uid, tid in ((cmt_a, user_a, tenant_a), (cmt_b, user_b, tenant_b)):
            await c.execute(text(
                "INSERT INTO comment (id, tenant_id, parent_object_type, parent_object_id, "
                "comment_type, status, author_id, content) "
                "VALUES (:i, :t, 'record', :po, 'INTERNAL', 'ACTIVE', :u, 'rls')"),
                {"i": cid, "t": tid, "po": uuid.uuid4(), "u": uid})

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await _disable_rls(c, "comment")
            await c.execute(text("DELETE FROM comment WHERE tenant_id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})
            await c.execute(text("DELETE FROM app_user WHERE id IN (:a, :b)"),
                            {"a": user_a, "b": user_b})
            await c.execute(text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                            {"a": tenant_a, "b": tenant_b})


async def test_rls_comment_isolates_by_tenant(rls_comment):
    """`comment` RLS spot: GUC switch flips visibility per tenant; default-deny on unset."""
    app_engine, tenant_a, tenant_b = rls_comment
    a_rows = await _select_tenant_ids_under_guc(app_engine, "comment", tenant_a)
    assert str(tenant_a) in a_rows and str(tenant_b) not in a_rows
    b_rows = await _select_tenant_ids_under_guc(app_engine, "comment", tenant_b)
    assert str(tenant_b) in b_rows and str(tenant_a) not in b_rows
    none_rows = await _select_tenant_ids_under_guc(app_engine, "comment", None)
    assert none_rows == []
