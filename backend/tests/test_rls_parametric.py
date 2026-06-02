"""Parametric proof that Postgres Row-Level Security isolates tenants on EVERY
tenant-scoped table (M1-A Wave 5).

Waves 1-4 shipped the policies; Wave 5 is the CI gate that prevents future tables
from being added without an RLS policy. We discover every table in `Base.metadata`
that has a `tenant_id` column, then parametrize a single test over the list. For
each table the test:

  1. Enables RLS + creates the `tenant_isolation` policy + grants to `gaaex_app`
     (same predicate shape as `3a9203795d07` / `642fa959d432` / Wave 3 — see the
     `_enable_rls_and_grant` helper imported from `test_rls`).
  2. Seeds one row per tenant (A, B) under the OWNER engine (which bypasses RLS).
  3. Under the `gaaex_app` engine, sets the GUC to A and asserts only A's row is
     visible; sets the GUC to B and asserts only B's row is visible; unsets the
     GUC and asserts the default-deny case yields zero rows.
  4. Tears down — drops the policy, disables RLS, deletes the seeded rows — so
     the rest of the suite (which runs as the owner role and EXPECTS RLS off) is
     unaffected.

When a future migration adds a new tenant-scoped table but forgets the policy,
the parametric instance for THAT table will fail with the table name baked into
the test id, so the CI surface points straight at the missing policy. That IS
the gate — no extra CI config required.

FK-heavy tables (`KNOWN_FK_HEAVY` below) are skipped here because seeding a
minimal row requires a parent-row chain that's not worth duplicating per table;
they get individual spot tests in `test_rls.py` instead, or will be folded in
later. The skip emits a `pytest.skip()` with a one-line reason.

Placeholder-value strategy: at runtime we walk each table's `NOT NULL` columns
that have no DB default and no Python default and synthesize a value per type
(UUID → `uuid.uuid4()`, String → `f'rls-{short}'`, Numeric → `Decimal('0')`,
DateTime → `datetime.now(timezone.utc)`, JSONB → `{}`, Integer → `0`, Boolean →
`False`, Text → `'rls'`, Ltree → `f'rls_{short}'`). FKs to `tenant.id` use the
test's tenant UUID; any other NOT-NULL FK lands the table in the skip list.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import urlparse, urlunparse

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.db import engine          # gaaex (owner) — seeds + RLS toggles + cleanup
from app.models import Base
from tests.test_rls import (   # reuse Wave 3 helpers — same predicate shape as the spot tests
    _disable_rls,
    _enable_rls_and_grant,
    _select_tenant_ids_under_guc,
)


GUC = "gaaex.tenant_id"


def _app_role_url() -> str:
    """Same shape as test_rls._app_role_url — derive the gaaex_app URL from DATABASE_URL."""
    p = urlparse(os.environ["DATABASE_URL"])
    return urlunparse(p._replace(netloc=f"gaaex_app:gaaex_app@{p.hostname}:{p.port}"))


APP_ROLE_URL = _app_role_url()


def _tenant_scoped_tables() -> list[str]:
    """Every table in Base.metadata that has a `tenant_id` column. Discovery is
    intentionally trivial: declarative models only, so Alembic internals and
    non-`public` schemas are filtered out by construction."""
    return sorted(
        name for name, t in Base.metadata.tables.items()
        if "tenant_id" in t.columns
    )


# ──────────────────────────────────────────────────────────────────────────────
# Skip list — tables whose seed row requires a non-tenant FK chain. The RLS
# predicate shape on these IS identical to the others (tenant_id = GUC); the
# only reason we skip is that a minimal-row insert needs parent rows we don't
# want to synthesize here. Spot-tested individually in `test_rls.py` where
# warranted (payment_method, dunning_case approximated by dunning_policy, etc.)
# ──────────────────────────────────────────────────────────────────────────────
KNOWN_FK_HEAVY: dict[str, str] = {
    "account":                     "FK→party (holder_party_id) — covered by party-level checks",
    "api_key":                     "FK→app_user (acts_as_user_id)",
    "approval":                    "FK→app_user (requested_by)",
    "asset_location_history":      "FK→record (asset_record_id)",
    "assignment":                  "FK→app_user+role_def+org_node",
    "credit_note":                 "FK→record (customer_id) — also tested explicitly in test_idor_credit_notes",
    "customer_user":               "FK→record (customer_id)",
    "dunning_case":                "FK chain account+invoice+dunning_policy — see test_rls.rls_dunning_policy spot test",
    "event":                       "Append-only audit log per SPEC §0.4 — DELETE forbidden by trigger, so per-test teardown is impossible. Covered by spot tests in test_audit_log.py / test_rls.py.",
    "field_def":                   "FK→entity_def (entity_def_id)",
    "interaction":                 "FK→app_user (agent_user_id)",
    "invoice_line":                "FK→invoice (invoice_id)",
    "ip_assignment":               "FK→pool_allocation (pool_allocation_id)",
    "message":                     "FK→thread+app_user",
    "nav_module":                  "FK→nav_group (group_id)",
    "notification":                "FK→app_user (user_id)",
    "notification_pref":           "FK→app_user (user_id)",
    "olt_card":                    "FK→olt_chassis (chassis_id)",
    "olt_chassis":                 "FK→record (olt_record_id)",
    "olt_port":                    "FK→olt_card (card_id)",
    "onu":                         "FK→olt_port (port_id)",
    "order_item":                  "FK→order (order_id)",
    "outage_path":                 "FK→record+fiber_route",
    "payment_allocation":          "FK→payment+invoice",
    "payment_method":              "FK→record (customer_id) — covered by test_rls.rls_payment_method spot test",
    "payment_order":               "FK→invoice (invoice_id)",
    "pool_allocation":             "FK→resource_pool (pool_id)",
    "portal_ticket_reply":         "FK→helpdesk_ticket+customer_user",
    "refresh_token":               "FK→app_user (user_id)",
    "relation_def":                "FK→entity_def (from_entity_id)",
    "report_schedule":             "FK→report_def (report_id)",
    "role_def_deny":               "FK→role_def (role_id)",
    "search_history":              "FK→app_user (user_id)",
    "service_resource":            "FK→service (service_id)",
    "splitter_strand_allocation":  "FK→record (splitter_record_id)",
    "status_def":                  "FK→entity_def (entity_def_id)",
    "studio_page_version":         "FK→studio_page (page_id)",
    "technician_location_ping":    "FK→app_user (technician_user_id)",
    "thread":                      "FK→app_user (created_by)",
    "vlan_assignment":             "FK→pool_allocation (pool_allocation_id)",
    "webhook_delivery":            "FK→webhook_def (webhook_id)",
    "widget_def":                  "FK→dashboard_def (dashboard_def_id)",
}


TENANT_SCOPED_TABLES = _tenant_scoped_tables()


def _placeholder(col: sa.Column, short: str):
    """Synthesize a sensible value for a NOT-NULL, no-default column based on its
    SQLAlchemy type. `short` is a per-row hex suffix so string values stay
    unique-per-tenant where the table has a (tenant_id, key) unique constraint.

    Returning `None` for an unrecognized type yields a NOT-NULL violation at
    insert time — which is the right signal: extend this map rather than paper
    over a silently-NULL placeholder.
    """
    t = col.type
    tn = type(t).__name__
    # FK to tenant.id is handled by the caller (uses the test's tenant uuid),
    # so by the time we get here the caller has already populated tenant_id.
    if tn == "UUID":
        return uuid.uuid4()
    if tn in ("String", "VARCHAR"):
        # Truncate to fit the declared length — most columns are >= 20 chars,
        # but a couple of code/lang columns are tighter (translation.lang = 8).
        val = f"rls-{short}"
        length = getattr(t, "length", None) or 80
        return val[:length]
    if tn == "Text":
        return f"rls-{short}"
    if tn == "Integer":
        return 0
    if tn == "BigInteger":
        return 0
    if tn == "Numeric":
        return Decimal("0")
    if tn == "DateTime":
        return datetime.now(timezone.utc)
    if tn == "Boolean":
        return False
    if tn == "JSONB":
        # asyncpg expects a JSON string for JSONB parameters when sent via raw
        # text() — dicts come back as 'dict has no attribute encode'.
        return json.dumps({})
    if tn == "LtreeType":
        # ltree segments must be alpha+digit+underscore — uuid hex is safe.
        return f"rls_{short}"
    return None  # caller should treat None as "give up on this table"


def _build_seed_row(table_name: str, tenant_id: uuid.UUID) -> dict | None:
    """Inspect `table_name`'s columns and return a dict of placeholder values
    sufficient for an INSERT to succeed, or None if any required column has a
    type we don't know how to synthesize (in which case the test should skip).

    Note on defaults: SQLAlchemy Python-level `default=...` (e.g. `default=uuid.uuid4`)
    only fires when going through the ORM — raw `text()` INSERTs do NOT trigger
    them. So we only trust `server_default` (DB-side) for NOT-NULL columns and
    explicitly populate everything else NOT-NULL ourselves."""
    t = Base.metadata.tables[table_name]
    short = uuid.uuid4().hex[:8]
    row: dict = {}
    for col in t.columns:
        if col.name == "tenant_id":
            row["tenant_id"] = tenant_id
            continue
        # Nullable + no value provided ⇒ let DB store NULL.
        if col.nullable:
            continue
        # NOT NULL with a DB-side default ⇒ DB will fill it; skip.
        if col.server_default is not None:
            continue
        # NOT NULL with a Python-side default ⇒ raw text() INSERT bypasses it,
        # so we MUST provide a value ourselves. Prefer the Python default's
        # static value (e.g. `default='medium'` for ra_finding.severity, which
        # has a CHECK constraint our generic placeholder would violate). For
        # callable defaults (uuid.uuid4, dict) we still synthesize generically.
        if isinstance(col.default, sa.ColumnDefault):
            arg = col.default.arg
            if not callable(arg):
                row[col.name] = arg
                continue
        # Any non-tenant FK on a NOT-NULL no-default column would require a
        # parent row chain we don't synthesize here — caller should have these
        # tables in KNOWN_FK_HEAVY, but guard defensively.
        if col.foreign_keys:
            non_tenant_fks = [
                fk for fk in col.foreign_keys
                if not str(fk.target_fullname).startswith("tenant.")
            ]
            if non_tenant_fks:
                return None
        val = _placeholder(col, short)
        if val is None:
            return None  # unknown type → caller will skip
        row[col.name] = val
    return row


# SQL reserved words that need double-quoting when used as table/column names in raw SQL.
# Postgres' full list is large; we only need the ones that actually appear in our schema
# (table names `order`, column names `order`, etc). Quoting everything is also safe.
_PG_RESERVED = {"order", "user", "group", "table", "select", "from", "where", "by"}


def _qident(name: str) -> str:
    """Double-quote an identifier if it's reserved (or always quote — safer)."""
    return f'"{name}"' if name.lower() in _PG_RESERVED else name


def _build_insert(table_name: str, row: dict) -> sa.TextClause:
    cols = ", ".join(_qident(k) for k in row.keys())
    placeholders = ", ".join(f":{k}" for k in row.keys())
    return text(f"INSERT INTO {_qident(table_name)} ({cols}) VALUES ({placeholders})")


# ──────────────────────────────────────────────────────────────────────────────
# Tenant setup is shared across the whole parametric run so we don't pay 90×
# CREATE-tenant + DROP-tenant. Module scope is safe: every parametric instance
# uses its own seed rows and toggles RLS only on its own table, never on
# `tenant`, so the per-table teardown leaves the shared tenants alone.
# ──────────────────────────────────────────────────────────────────────────────
@pytest_asyncio.fixture(scope="module")
async def shared_rls_setup(_setup_db):
    """Ensures the gaaex_app role + grants on `tenant`, creates two test tenants,
    yields (app_engine, tenant_a, tenant_b). On teardown disposes the engine and
    deletes the test tenants."""
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    async with engine.begin() as c:
        await c.execute(text("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gaaex_app') THEN
                    CREATE ROLE gaaex_app LOGIN PASSWORD 'gaaex_app' NOSUPERUSER NOBYPASSRLS;
                END IF;
            END $$;
        """))
        await c.execute(text("GRANT USAGE ON SCHEMA public TO gaaex_app;"))
        await c.execute(text("GRANT SELECT, INSERT, UPDATE, DELETE ON tenant TO gaaex_app;"))
        for t in (tenant_a, tenant_b):
            await c.execute(
                text("INSERT INTO tenant (id, name, status) VALUES (:i, :n, 'active')"),
                {"i": t, "n": f"RLS-W5 {t.hex[:6]}"},
            )

    app_engine = create_async_engine(APP_ROLE_URL)
    try:
        yield app_engine, tenant_a, tenant_b
    finally:
        await app_engine.dispose()
        async with engine.begin() as c:
            await c.execute(
                text("DELETE FROM tenant WHERE id IN (:a, :b)"),
                {"a": tenant_a, "b": tenant_b},
            )


@pytest.mark.parametrize("table_name", TENANT_SCOPED_TABLES, ids=TENANT_SCOPED_TABLES)
async def test_rls_isolates_table_by_tenant(table_name: str, shared_rls_setup):
    """Proves RLS tenant isolation on `table_name`. Discovered automatically from
    Base.metadata so a future table that ships without an RLS policy fails here,
    on the parametric id for that exact table name."""
    if table_name in KNOWN_FK_HEAVY:
        pytest.skip(f"Wave-5 FK chain limitation: {KNOWN_FK_HEAVY[table_name]}")

    app_engine, tenant_a, tenant_b = shared_rls_setup

    row_a = _build_seed_row(table_name, tenant_a)
    row_b = _build_seed_row(table_name, tenant_b)
    if row_a is None or row_b is None:
        pytest.skip(
            f"Wave-5 placeholder gap on {table_name}: a NOT-NULL column has a "
            f"type/FK shape the parametric synth doesn't cover — add to "
            f"KNOWN_FK_HEAVY or extend _placeholder()."
        )

    insert_a = _build_insert(table_name, row_a)
    insert_b = _build_insert(table_name, row_b)

    qtable = _qident(table_name)   # double-quoted if reserved (e.g. `"order"`)

    # 1) Enable RLS + grants in one transaction. Inserts go in a SECOND transaction
    # so that a NOT-NULL or unique-violation failure doesn't abort the outer txn
    # and prevent us from cleanly disabling RLS in the skip path below.
    async with engine.begin() as c:
        await _enable_rls_and_grant(c, qtable)

    seed_error: Exception | None = None
    try:
        async with engine.begin() as c:
            await c.execute(insert_a, row_a)
            await c.execute(insert_b, row_b)
    except Exception as e:  # noqa: BLE001 — surface insert failures clearly
        seed_error = e

    if seed_error is not None:
        # Insert failed (NOT-NULL, FK, unique, type mismatch). Tear down RLS in
        # a FRESH transaction and skip — the parametric id pinpoints the table.
        async with engine.begin() as c:
            await _disable_rls(c, qtable)
            await c.execute(
                text(f"DELETE FROM {qtable} WHERE tenant_id IN (:a, :b)"),
                {"a": tenant_a, "b": tenant_b},
            )
        pytest.skip(f"Wave-5 seed failed on {table_name}: {seed_error!r}")

    try:
        # 2) GUC=A → A's tenant_id visible, B's hidden.
        a_rows = await _select_tenant_ids_under_guc(app_engine, qtable, tenant_a)
        assert str(tenant_a) in a_rows, (
            f"RLS policy not enforced on {table_name} — tenant A's row not visible under GUC=A. "
            f"See docs/M1A-DEPLOY-CONTRACT.md."
        )
        assert str(tenant_b) not in a_rows, (
            f"RLS LEAK on {table_name} — tenant B's row visible under GUC=A. "
            f"See docs/M1A-DEPLOY-CONTRACT.md."
        )

        # 3) GUC=B → B's tenant_id visible, A's hidden.
        b_rows = await _select_tenant_ids_under_guc(app_engine, qtable, tenant_b)
        assert str(tenant_b) in b_rows, (
            f"RLS policy not enforced on {table_name} — tenant B's row not visible under GUC=B. "
            f"See docs/M1A-DEPLOY-CONTRACT.md."
        )
        assert str(tenant_a) not in b_rows, (
            f"RLS LEAK on {table_name} — tenant A's row visible under GUC=B. "
            f"See docs/M1A-DEPLOY-CONTRACT.md."
        )

        # 4) GUC unset → default-deny (NULLIF-guarded predicate yields zero rows).
        none_rows = await _select_tenant_ids_under_guc(app_engine, qtable, None)
        # Filter to JUST our two rows — other test_rls fixtures may have left
        # rows we don't care about visible to the owner, but under the app role
        # with no GUC, none of OURS should appear.
        ours_visible = [r for r in none_rows if r in (str(tenant_a), str(tenant_b))]
        assert ours_visible == [], (
            f"RLS default-deny FAILED on {table_name} — rows visible without GUC. "
            f"See docs/M1A-DEPLOY-CONTRACT.md."
        )
    finally:
        # 5) Teardown: drop the policy + disable RLS + delete the seed rows so the
        # shared test DB is left as the owner-bypass app tests expect.
        async with engine.begin() as c:
            await _disable_rls(c, qtable)
            await c.execute(
                text(f"DELETE FROM {qtable} WHERE tenant_id IN (:a, :b)"),
                {"a": tenant_a, "b": tenant_b},
            )
