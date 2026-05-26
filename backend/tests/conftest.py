import os
import asyncio

# Point the app at an isolated test database BEFORE importing any app module.
os.environ["DATABASE_URL"] = "postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_test"

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

    async with engine.begin() as c:
        await c.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
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
