import os
import asyncio

# Point the app at an isolated test database BEFORE importing any app module. Set BOTH the app and
# the owner URL to gaaex_test (overriding any .env that may flip these for RLS) so tests never touch
# the dev DB — the suite runs as the gaaex owner on gaaex_test (no RLS policies via create_all).
os.environ["DATABASE_URL"] = "postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_test"
os.environ["OWNER_DATABASE_URL"] = "postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_test"

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
    # (re)create a clean test database
    admin = await asyncpg.connect("postgresql://gaaex:gaaex@localhost:5433/gaaex")
    await admin.execute("DROP DATABASE IF EXISTS gaaex_test WITH (FORCE)")
    await admin.execute("CREATE DATABASE gaaex_test")
    await admin.close()

    from sqlalchemy import text
    from app.db import engine
    from app.models import Base
    from app.seed import seed_if_empty, seed_meta_if_empty, seed_access_if_empty

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

    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    await seed_if_empty()
    await seed_meta_if_empty()
    await seed_access_if_empty()
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
