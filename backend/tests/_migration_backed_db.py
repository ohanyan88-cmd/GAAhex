"""Shared helper for P2 DB-invariant tests: build a FRESH migration-backed scratch DB.

The main suite builds its schema with `create_all`, so migration-only DDL — RLS policies, append-only/
hold triggers, partial UNIQUE indexes added via op.execute — is ABSENT from every test run. Tests that
must exercise that DDL build their own scratch DB here via real `alembic upgrade head`, then talk to it
with raw asyncpg. Not a test module (underscore prefix → never collected).
"""
import os
import sys
import uuid
import subprocess
import urllib.parse as up
from pathlib import Path

import asyncpg

_BACKEND = Path(__file__).resolve().parent.parent

# CI provides DATABASE_URL in the env; local dev keeps it in backend/.env.
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


def scratch_name(suffix: str) -> str:
    return f"gaahex_{suffix}_{_WORKER}"


def raw_url(db: str) -> str:
    return f"postgresql://{_O}:{_PW}@{_H}:{_PT}/{db}"


def _sa(db: str) -> str:
    return f"postgresql+asyncpg://{_O}:{_PW}@{_H}:{_PT}/{db}"


async def build(scratch: str) -> str:
    """Drop+create `scratch` and run real `alembic upgrade head` against it. Returns its raw asyncpg URL."""
    c = await asyncpg.connect(raw_url("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {scratch} WITH (FORCE)")
    await c.execute(f"CREATE DATABASE {scratch} OWNER {_O}")
    await c.close()
    e = dict(os.environ); e["OWNER_DATABASE_URL"] = _sa(scratch); e["DATABASE_URL"] = _sa(scratch)
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"],
                       cwd=str(_BACKEND), env=e, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("alembic upgrade head failed:\n" + r.stdout[-1200:] + r.stderr[-1200:])
    return raw_url(scratch)


async def drop(scratch: str) -> None:
    c = await asyncpg.connect(raw_url("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {scratch} WITH (FORCE)")
    await c.close()


async def seed_tenant_user(url: str):
    """Seed one tenant + one app_user (the common FK chain). Returns (tenant_id, user_id)."""
    c = await asyncpg.connect(url)
    tid, uid = uuid.uuid4(), uuid.uuid4()
    await c.execute("INSERT INTO tenant(id, name, status) VALUES($1,$2,'ACTIVE')", tid, "P2 Tenant")
    await c.execute(
        "INSERT INTO app_user(id, tenant_id, email, name, password_hash, status) "
        "VALUES($1,$2,$3,$4,'x','ACTIVE')",
        uid, tid, f"p2-{uuid.uuid4().hex[:8]}@mb.test", "P2 User")
    await c.close()
    return tid, uid
