import os
import asyncio

# C3/C4 — the app now defaults ENVIRONMENT to "production" (fail-closed). The test suite MUST declare
# itself as a non-production environment BEFORE any app module imports settings, or every test would
# boot production-strict (weak-JWT/field-key refusal, demo seeds gated off). setdefault respects an
# explicit override (e.g. a test that wants ENVIRONMENT=production).
os.environ.setdefault("ENVIRONMENT", "test")

# Point the app at an isolated test database BEFORE importing any app module. Respect any URL the
# environment already supplied (CI sets DATABASE_URL to its own postgres service on :5432); only
# fall back to the local-dev default (:5433) when nothing was set. The session fixture explicitly
# DROPs + CREATEs gaahex_test against this URL, so the dev DB (gaahex) is never touched as long as
# the configured URL points at a test database — which CI's workflow guarantees.
# Per-worker DB isolation for pytest-xdist (`-n auto`): each parallel worker gets its OWN database
# (gaahex_test_gw0, gaahex_test_gw1, …) so the workers never clash on a shared DB. A serial run (no
# xdist) uses plain gaahex_test. The worker suffix is FORCED when PYTEST_XDIST_WORKER is set (workers
# inherit the controller's env, so setdefault alone wouldn't re-isolate them); the _setup_db fixture
# DROP/CREATEs whatever DB the URL points at, so each worker provisions its own.
_DEFAULT_DB_URL = "postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_test"


def _with_worker_db(url: str, worker: str) -> str:
    from urllib.parse import urlparse, urlunparse
    pr = urlparse(url)
    return urlunparse(pr._replace(path="/" + pr.path.lstrip("/") + "_" + worker))


_xdist_worker = os.environ.get("PYTEST_XDIST_WORKER")  # 'gw0'.. on workers; unset serially / controller
if _xdist_worker:
    _base = os.environ.get("DATABASE_URL", _DEFAULT_DB_URL)
    _owner_base = os.environ.get("OWNER_DATABASE_URL", _base)
    os.environ["DATABASE_URL"] = _with_worker_db(_base, _xdist_worker)
    os.environ["OWNER_DATABASE_URL"] = _with_worker_db(_owner_base, _xdist_worker)
    # Redis + local storage are the OTHER cross-worker shared resources — isolate them too, or cache /
    # idempotency / attachment state bleeds across parallel workers (per-worker DBs alone aren't enough).
    import tempfile as _tmp
    from urllib.parse import urlparse as _up, urlunparse as _uu
    _ri = int(_xdist_worker.replace("gw", "") or "0") % 16          # Redis logical DBs are 0-15
    os.environ["REDIS_URL"] = _uu(_up(os.environ.get("REDIS_URL", "redis://localhost:6380/0"))._replace(path=f"/{_ri}"))
    os.environ["STORAGE_LOCAL_PATH"] = os.path.join(_tmp.gettempdir(), f"portal-test-uploads-{_xdist_worker}")
else:
    os.environ.setdefault("DATABASE_URL", _DEFAULT_DB_URL)
    os.environ.setdefault("OWNER_DATABASE_URL", _DEFAULT_DB_URL)
# M1-C.1: force the mock payment gateway in tests regardless of any stray .env file.
# Tests that exercise StripeGateway construct it explicitly (bypassing the factory) and
# patch the stripe SDK with unittest.mock — they never touch the real Stripe API.
os.environ.setdefault("PAYMENT_GATEWAY_PROVIDER", "mock")
# C2 kill-switch defaults OFF in prod (payment callbacks/webhooks blocked until go-live). Tests exercise
# the enabled path, so turn it ON here; a dedicated test flips it OFF to prove the 503 block.
os.environ.setdefault("FEATURE_PAYMENTS_ENABLED", "true")
# Attachment storage — point at a writable tmp dir so CI runners (no /app/uploads) don't fail.
# LocalDiskBackend defaults to /app/uploads (the Docker container WORKDIR) which CI lacks.
import tempfile as _tempfile
os.environ.setdefault("STORAGE_LOCAL_PATH", os.path.join(_tempfile.gettempdir(), "portal-test-uploads"))

# ─── M-23: DB isolation strategy — decision record ───────────────────────────
#
# WHY session-scoped (not transaction-rollback-per-test)
# ======================================================
#
# The standard "wrap each test in a SAVEPOINT → ROLLBACK" technique is
# impractical here. Four distinct reasons, each sufficient on its own:
#
# 1. SESSIONS ARE APP-OWNED, NOT TEST-OWNED.
#    FastAPI resolves DB sessions through its own dependency injection (Depends).
#    The test client (AsyncClient) calls the full ASGI stack; the sessions the
#    app opens are internal and commit/rollback at the end of each *request*,
#    completely outside the test function. There is no hook to wrap those
#    commits in a savepoint that a test fixture controls.
#
# 2. MULTI-REQUEST TESTS RELY ON COMMITTED STATE.
#    Many tests assert cross-request state — the Stripe idempotency tests, for
#    example, POST an event, then POST the same event again and verify the DB
#    row exists after the first POST. If the first POST's commit were rolled
#    back before the second POST, those tests would break. Savepoint-per-test
#    would require rewriting a significant portion of the suite.
#
# 3. DUAL-ENGINE RLS TESTS SPAN TWO SEPARATE CONNECTIONS.
#    test_rls.py + test_rls_parametric.py open a second SQLAlchemy engine
#    (gaahex_app, the NOSUPERUSER role) alongside the main engine to verify
#    cross-tenant isolation. Savepoint coordination across two independent
#    asyncpg connections is not supported — the second engine can't see the
#    first engine's open transaction, let alone participate in its savepoint.
#
# 4. asyncpg SAVEPOINT SUPPORT IS LIMITED FOR OUTER SCOPE CONTROL.
#    asyncpg supports SAVEPOINTs within a transaction, but the outer
#    transaction itself must be visible to both the test fixture AND every
#    connection the app opens. asyncpg does not support "attach to existing
#    transaction" — each new connection pool checkout starts in autocommit
#    mode unless explicitly told otherwise. Disabling the pool would create a
#    single-connection bottleneck that breaks session-scoped parallelism.
#
# TRADEOFF & MITIGATIONS
# ======================
# Because tests share a single DB across the session, order-dependent state
# leaks between tests are possible. These are mitigated by:
#   a. Unique data per test: tests generate names/IDs with uuid4() so they
#      don't collide with each other's rows.
#   b. The session DB is dropped and fully recreated at session start (_setup_db
#      below), so no state leaks across pytest invocations.
#   c. Tests that create secondary tenants use delete_tenant_cleanly() (see
#      below) to clean up rows that would shadow later tests.
#
# FUTURE PATH
# ===========
# Proper per-test isolation becomes achievable if conftest is rearchitected to:
#   (a) manage the app's DB sessions through a test-supplied session factory
#       (i.e. move away from Depends(get_session) to something the test can
#       intercept), AND
#   (b) adopt alembic-managed schema creation so tables are owned by `gaahex`
#       and the app connects as `gaahex_app` even during create_all.
# That rearchitecture is tracked as a future milestone and is gated on the
# alembic migration path being fully established.
# ─────────────────────────────────────────────────────────────────────────────

import asyncpg
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _setup_db():
    # (re)create a clean test database. Use OWNER_DATABASE_URL (the gaahex owner role) for the
    # admin connection — in the backend-rls CI job DATABASE_URL is gaahex_app (NOSUPERUSER) which
    # cannot DROP a database it doesn't own. OWNER_DATABASE_URL is always gaahex (owner/superuser).
    # Falls back to DATABASE_URL when OWNER_DATABASE_URL is unset (local dev, regular backend job).
    from urllib.parse import urlparse, urlunparse
    owner_url_raw = (os.environ.get("OWNER_DATABASE_URL") or os.environ["DATABASE_URL"])
    p = urlparse(owner_url_raw.replace("postgresql+asyncpg://", "postgresql://"))
    admin_url = urlunparse(p._replace(path="/postgres"))
    admin = await asyncpg.connect(admin_url)
    # The target DB name comes from the URL path — worker-suffixed under xdist (gaahex_test_gw0…),
    # plain gaahex_test serially. Each worker DROP/CREATEs its own DB, so parallel runs never collide.
    _target_db = p.path.lstrip("/") or "gaahex_test"
    await admin.execute(f'DROP DATABASE IF EXISTS "{_target_db}" WITH (FORCE)')
    await admin.execute(f'CREATE DATABASE "{_target_db}"')
    await admin.close()

    from sqlalchemy import text
    from app.db import engine, owner_engine
    from app.models import Base
    # SM-5 — apply_test_seeds is the canonical minimum set, shared with main.py:lifespan.
    from app.seed import apply_test_seeds

    # Extensions and DDL MUST run as the owner (gaahex) so:
    # (a) CREATE EXTENSION succeeds — gaahex_app is NOSUPERUSER and cannot create extensions.
    # (b) gaahex becomes TABLE OWNER → RLS policies fire against gaahex_app in the backend-rls job.
    #     (table owners bypass RLS unless FORCE ROW LEVEL SECURITY is set; running create_all as
    #     gaahex_app would make gaahex_app the owner and silently bypass RLS in that CI job.)
    # In the regular backend job owner_engine == engine (both gaahex), so no behavioral change.
    async with owner_engine.connect() as c:
        try:
            await c.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
            await c.commit()
        except Exception as e:
            # Race: another connection in this process just created it. Confirm
            # the extension is in fact present, then continue. Re-raise on other errors.
            if "ltree" not in str(e).lower() or "extension" not in str(e).lower():
                raise
            await c.rollback()
        result = await c.execute(text("SELECT 1 FROM pg_extension WHERE extname = 'ltree'"))
        if result.first() is None:
            raise RuntimeError("ltree extension missing after CREATE — DB setup failed")

    # NOC Phase C: PostGIS extension — needed for fiber_route/outage_path partial indexes
    # that may CAST to geometry in raw SQL. Install before create_all so the extension is
    # available for any migration that references PostGIS types / functions.
    async with owner_engine.connect() as c:
        try:
            await c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            await c.commit()
        except Exception as e:
            # Swallow race / already-exists; re-raise anything else.
            if "postgis" not in str(e).lower() and "extension" not in str(e).lower():
                raise
            await c.rollback()

    async with owner_engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
        # Mirror production migration 3a9203795d07: the app role (gaahex_app) is granted DML on
        # every table + sequences. conftest builds the schema via create_all (NOT migrations) and
        # drops+recreates the DB at session start, so the migration's grant never lands here and
        # any gaahex_app query hits "permission denied". The older RLS-subset tests papered over
        # this by self-granting per-table; an ordinary app flow under gaahex_app (e.g. POST
        # /meta/entities writing to `assignment`) has no such hook. Grant globally so the test DB
        # matches production privileges. Guarded on role existence — the regular backend job runs
        # entirely as `gaahex` and never provisions gaahex_app.
        role_exists = (await c.execute(text(
            "SELECT 1 FROM pg_roles WHERE rolname = 'gaahex_app'"
        ))).scalar() is not None
        if role_exists:
            await c.execute(text(
                "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gaahex_app"
            ))
            await c.execute(text(
                "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gaahex_app"
            ))
    await apply_test_seeds()
    yield
    await engine.dispose()
    await owner_engine.dispose()


@pytest_asyncio.fixture(scope="session")
async def client():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _auth(client, email, password):
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture(scope="session")
async def admin(client):
    return await _auth(client, "admin@demo.isp", "admin123")


@pytest_asyncio.fixture(scope="session")
async def agent(client):
    return await _auth(client, "agent@demo.isp", "agent123")


# ───────────────────────────────────────────────────────────────────────────
# TL-6 / TL-7 — Shared test helpers.
#
# Pre-Phase-3, `_customer` was redefined in 27 test files and `_ensure` in 18.
# Two near-identical bodies with minor signature drift. New tests should use
# these canonical helpers; existing tests migrate when they're touched.
# ───────────────────────────────────────────────────────────────────────────

async def make_customer(client, admin, name: str | None = None) -> str:
    """TL-7 — canonical customer factory. Returns the new customer's UUID.

    `name` is optional; absent → autogenerated `Cust <hex6>`. Replaces 27+
    local `_customer` helpers.
    """
    import uuid as _uuid
    payload = {"name": name or f"Cust {_uuid.uuid4().hex[:6]}"}
    r = await client.post("/api/customers", headers=admin, json=payload)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def delete_tenant_cleanly(s, tenant_id):
    """Cross-tenant test teardown helper.

    13 cross-tenant tests across the suite create a 2nd tenant and then can't
    DELETE it at teardown because Event/Record/WorkItem/Audit rows still
    reference it via tenant_id FKs that aren't `ON DELETE CASCADE`. Each
    test fixture used to delete users/roles/org-nodes then try `DELETE FROM
    tenant`, hitting `event_tenant_id_fkey` violations 13 times in the
    suite run.

    This helper finds every tenant_id-bearing table in the live schema and
    deletes rows for the given tenant. The schema introspection
    (information_schema.columns) keeps this helper forward-compatible: new
    tenant-scoped tables shipped by migrations get cleaned automatically
    without code changes here.

    Append-only tables (event, audit_log per SPEC §0.4) are SKIPPED — DELETE
    against them is rejected by the kernel constraint
    (`RestrictViolationError: event (audit log) is append-only … no DELETE
    allowed by any role including Admin`). Because event.tenant_id has a NOT
    NULL FK to tenant.id, the final `DELETE FROM tenant` would then violate
    that FK; we skip the tenant row deletion too. Leaving the 2nd tenant
    around between tests is harmless — each fixture creates its own unique
    tenant uuid and the test DB is dropped+recreated at session start.
    """
    from sqlalchemy import text
    # Discover every table that has a tenant_id column in the live schema —
    # we don't have to hand-list models, and we can't import them all without
    # creating circular-import pain. information_schema is authoritative.
    tenant_tables = (await s.execute(text(
        """
        SELECT table_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'tenant_id'
           AND table_name NOT IN ('tenant', 'event', 'audit_log')
        """
    ))).scalars().all()
    for tbl in tenant_tables:
        # Quote the identifier so reserved-word table names (e.g. "user") work.
        await s.execute(text(f'DELETE FROM "{tbl}" WHERE tenant_id = :tid'), {"tid": tenant_id})
    # NOTE: we deliberately do NOT delete from tenant itself. The append-only
    # event/audit_log rows still reference this tenant_id, and the FK isn't
    # ON DELETE CASCADE (by SPEC §0.4 — audit lineage can't be tombstoned).
    # The orphan tenant row is benign across the rest of the suite.


async def ensure_user(s, *, tenant_id, node_id, email: str, role_id, password: str = "test-123"):
    """TL-6 — canonical user-with-assignment factory.

    Idempotent: returns the existing user id if `(tenant_id, email)` already
    exists; otherwise creates the User row + an Assignment row binding it to
    the given role at the given org node. Returns the user UUID.

    Replaces 18+ local `_ensure` / `_ensure_user` helpers that all carried the
    same body with minor password-string variations.
    """
    from sqlalchemy import select
    from app.models import User, Assignment
    from app.security import hash_password

    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(
            tenant_id=tenant_id, email=email, name=email.split("@")[0],
            password_hash=hash_password(password), status="active",
        )
        s.add(u)
        await s.flush()
    has_assign = (await s.execute(
        select(Assignment).where(
            Assignment.user_id == u.id,
            Assignment.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not has_assign:
        s.add(Assignment(
            tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id,
            granted_at=None,
        ))
        await s.flush()
    return u.id
