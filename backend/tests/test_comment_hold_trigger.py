"""Comment hold — DB-level trigger enforcement tests (file 04).

P2 (T0-PREREQ): these were 5 empty-bodied @pytest.mark.skip stubs ("verified manually") because the
main suite builds its schema with `create_all`, which never runs the migration that installs the
triggers (3a86ae0ed044) — so the tests would have passed for the wrong reason (no trigger present).

They are now real: a module-scoped fixture builds a FRESH migration-backed scratch DB via real
`alembic upgrade head` (so the production trigger DDL actually exists), seeds the tenant→app_user FK
chain, and each test exercises the live BEFORE UPDATE / BEFORE DELETE hold triggers via raw asyncpg.
The trigger raises `comment is on legal hold … refused by DB trigger` with ERRCODE='restrict_violation'
(SQLSTATE 23001) on a forbidden mutation, and permits ONLY a pure hold-release.

Pairs with backend/scripts/check_migration_invariants.py (P1), which proves the migration *installs*
the trigger; this proves the trigger, once installed, *blocks* the operation.
"""
import os
import sys
import uuid
import asyncio
import subprocess
import urllib.parse as up
from pathlib import Path

import asyncpg
import pytest

_BACKEND = Path(__file__).resolve().parent.parent

# DB creds: CI provides DATABASE_URL in the env; local dev keeps it in backend/.env.
_env = {}
_envfile = _BACKEND / ".env"
if _envfile.exists():
    for _ln in _envfile.read_text(encoding="utf-8").splitlines():
        if "=" in _ln and not _ln.strip().startswith("#"):
            _k, _, _v = _ln.partition("="); _env[_k.strip()] = _v.strip()
_DBURL = os.environ.get("DATABASE_URL") or _env.get("DATABASE_URL")
_pr = up.urlparse(_DBURL)
_O, _PW, _H, _PT = _pr.username, _pr.password, _pr.hostname, _pr.port
_WORKER = os.environ.get("PYTEST_XDIST_WORKER", "main")
_SCRATCH = f"gaahex_trig_{_WORKER}"


def _raw(db):
    return f"postgresql://{_O}:{_PW}@{_H}:{_PT}/{db}"


def _sa(db):
    return f"postgresql+asyncpg://{_O}:{_PW}@{_H}:{_PT}/{db}"


async def _build_and_seed():
    c = await asyncpg.connect(_raw("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {_SCRATCH} WITH (FORCE)")
    await c.execute(f"CREATE DATABASE {_SCRATCH} OWNER {_O}")
    await c.close()
    e = dict(os.environ); e["OWNER_DATABASE_URL"] = _sa(_SCRATCH); e["DATABASE_URL"] = _sa(_SCRATCH)
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                       cwd=str(_BACKEND), env=e, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("alembic upgrade head failed in trigger fixture:\n" + r.stdout[-1200:] + r.stderr[-1200:])
    c = await asyncpg.connect(_raw(_SCRATCH))
    tenant_id, author_id = uuid.uuid4(), uuid.uuid4()
    await c.execute("INSERT INTO tenant(id, name, status) VALUES($1,$2,'ACTIVE')", tenant_id, "P2 Trigger Tenant")
    await c.execute(
        "INSERT INTO app_user(id, tenant_id, email, name, password_hash, status) "
        "VALUES($1,$2,$3,$4,'x','ACTIVE')",
        author_id, tenant_id, f"p2-{_WORKER}@trigger.test", "P2 Author")
    await c.close()
    return {"url": _raw(_SCRATCH), "tenant_id": tenant_id, "author_id": author_id}


async def _drop():
    c = await asyncpg.connect(_raw("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {_SCRATCH} WITH (FORCE)")
    await c.close()


@pytest.fixture(scope="module")
def trigger_db():
    """Migration-backed scratch DB (real triggers present) + a seeded tenant/author. Sync fixture that
    drives the async setup/teardown via asyncio.run so it is independent of the test event-loop scope."""
    info = asyncio.run(_build_and_seed())
    yield info
    asyncio.run(_drop())


async def _insert_comment(conn, db, *, hold: bool) -> uuid.UUID:
    cid = uuid.uuid4()
    await conn.execute(
        "INSERT INTO comment(id, tenant_id, parent_object_type, parent_object_id, comment_type, "
        "status, author_id, content, hold) VALUES($1,$2,'customer',$3,'INTERNAL','ACTIVE',$4,$5,$6)",
        cid, db["tenant_id"], uuid.uuid4(), db["author_id"], "original body", hold)
    return cid


# ──────────────────────────────────────────────────────────────────────────────
# Test 1 — UPDATE a non-held comment → succeeds (control: trigger is silent)
# ──────────────────────────────────────────────────────────────────────────────
async def test_update_non_held_comment_succeeds(trigger_db):
    conn = await asyncpg.connect(trigger_db["url"])
    try:
        cid = await _insert_comment(conn, trigger_db, hold=False)
        await conn.execute("UPDATE comment SET content='edited' WHERE id=$1", cid)  # must not raise
        assert await conn.fetchval("SELECT content FROM comment WHERE id=$1", cid) == "edited"
    finally:
        await conn.close()


# ──────────────────────────────────────────────────────────────────────────────
# Test 2 — UPDATE a held comment's content → DB raises restrict_violation
# ──────────────────────────────────────────────────────────────────────────────
async def test_update_held_comment_content_raises(trigger_db):
    conn = await asyncpg.connect(trigger_db["url"])
    try:
        cid = await _insert_comment(conn, trigger_db, hold=True)
        with pytest.raises(asyncpg.PostgresError) as ei:
            await conn.execute("UPDATE comment SET content='tampered' WHERE id=$1", cid)
        assert ei.value.sqlstate == "23001", ei.value.sqlstate
        assert "legal hold" in str(ei.value)
        # the row is unchanged
        assert await conn.fetchval("SELECT content FROM comment WHERE id=$1", cid) == "original body"
    finally:
        await conn.close()


# ──────────────────────────────────────────────────────────────────────────────
# Test 3 — UPDATE a held comment to release hold (only) → succeeds (permitted path)
# ──────────────────────────────────────────────────────────────────────────────
async def test_update_held_comment_release_hold_succeeds(trigger_db):
    conn = await asyncpg.connect(trigger_db["url"])
    try:
        cid = await _insert_comment(conn, trigger_db, hold=True)
        await conn.execute("UPDATE comment SET hold=FALSE WHERE id=$1", cid)  # pure release — allowed
        assert await conn.fetchval("SELECT hold FROM comment WHERE id=$1", cid) is False
    finally:
        await conn.close()


# ──────────────────────────────────────────────────────────────────────────────
# Test 4 — DELETE a non-held comment → succeeds (control)
# ──────────────────────────────────────────────────────────────────────────────
async def test_delete_non_held_comment_succeeds(trigger_db):
    conn = await asyncpg.connect(trigger_db["url"])
    try:
        cid = await _insert_comment(conn, trigger_db, hold=False)
        await conn.execute("DELETE FROM comment WHERE id=$1", cid)  # must not raise
        assert await conn.fetchval("SELECT count(*) FROM comment WHERE id=$1", cid) == 0
    finally:
        await conn.close()


# ──────────────────────────────────────────────────────────────────────────────
# Test 5 — DELETE a held comment → DB raises restrict_violation
# ──────────────────────────────────────────────────────────────────────────────
async def test_delete_held_comment_raises(trigger_db):
    conn = await asyncpg.connect(trigger_db["url"])
    try:
        cid = await _insert_comment(conn, trigger_db, hold=True)
        with pytest.raises(asyncpg.PostgresError) as ei:
            await conn.execute("DELETE FROM comment WHERE id=$1", cid)
        assert ei.value.sqlstate == "23001", ei.value.sqlstate
        assert "legal hold" in str(ei.value)
        assert await conn.fetchval("SELECT count(*) FROM comment WHERE id=$1", cid) == 1  # still there
    finally:
        await conn.close()
