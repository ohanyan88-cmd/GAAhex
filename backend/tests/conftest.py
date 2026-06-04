import os
import asyncio

# Point the app at an isolated test database BEFORE importing any app module. Respect any URL the
# environment already supplied (CI sets DATABASE_URL to its own postgres service on :5432); only
# fall back to the local-dev default (:5433) when nothing was set. The session fixture explicitly
# DROPs + CREATEs gaahex_test against this URL, so the dev DB (gaahex) is never touched as long as
# the configured URL points at a test database — which CI's workflow guarantees.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_test")
os.environ.setdefault("OWNER_DATABASE_URL", "postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_test")
# M1-C.1: force the mock payment gateway in tests regardless of any stray .env file.
# Tests that exercise StripeGateway construct it explicitly (bypassing the factory) and
# patch the stripe SDK with unittest.mock — they never touch the real Stripe API.
os.environ.setdefault("PAYMENT_GATEWAY_PROVIDER", "mock")
# Attachment storage — point at a writable tmp dir so CI runners (no /app/uploads) don't fail.
# LocalDiskBackend defaults to /app/uploads (the Docker container WORKDIR) which CI lacks.
import tempfile as _tempfile
os.environ.setdefault("STORAGE_LOCAL_PATH", os.path.join(_tempfile.gettempdir(), "portal-test-uploads"))

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
    # (re)create a clean test database. Derive the admin URL (database='postgres') from the
    # configured DATABASE_URL so this works against whatever host/port the environment uses —
    # localhost:5433 locally, CI's postgres-service port in CI. Strip the SQLAlchemy driver
    # prefix because asyncpg.connect takes a plain libpq-style URL.
    from urllib.parse import urlparse, urlunparse
    p = urlparse(os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://"))
    admin_url = urlunparse(p._replace(path="/postgres"))
    admin = await asyncpg.connect(admin_url)
    await admin.execute("DROP DATABASE IF EXISTS gaahex_test WITH (FORCE)")
    await admin.execute("CREATE DATABASE gaahex_test")
    await admin.close()

    from sqlalchemy import text
    from app.db import engine
    from app.models import Base
    # SM-5 — apply_test_seeds is the canonical minimum set, shared with main.py:lifespan.
    from app.seed import apply_test_seeds

    # CREATE EXTENSION IF NOT EXISTS is NOT atomic in Postgres: two concurrent
    # transactions can both see "doesn't exist", both try to create, one hits the
    # unique-violation on pg_extension_name_index. Run on a dedicated connection
    # OUTSIDE the bulk transaction, with retry-swallowing for the race. Idempotent.
    async with engine.connect() as c:
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
    async with engine.connect() as c:
        try:
            await c.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
            await c.commit()
        except Exception as e:
            # Swallow race / already-exists; re-raise anything else.
            if "postgis" not in str(e).lower() and "extension" not in str(e).lower():
                raise
            await c.rollback()

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    await apply_test_seeds()
    yield
    await engine.dispose()


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
