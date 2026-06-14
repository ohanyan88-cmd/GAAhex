"""C5 — production credential gate: no guessable super-admin (or any known-credential account) is
seeded on a fresh PRODUCTION boot; the real super-admin comes from env creds instead.

The forensic sweep found THREE prod-reachable known-credential accounts seeded unconditionally on a
fresh boot — admin@demo.isp/admin123 (super_admin, perms=["*"]), agent@demo.isp/agent123, and
portal@demo.isp/portal123. A naive "gate seed_if_empty only" fix would miss the latter two (different
functions; the portal one is a separate call site). These tests drive the four seed.py credential
seeders against a FRESH scratch DB and prove:

  * environment=production → all three demo accounts are ABSENT, while the tenant + role catalog
    (infrastructure, NOT credentials) are still seeded, AND the env-provided bootstrap super-admin
    (settings.bootstrap_admin_email) IS created with the super_admin role.
  * environment=development → the three demo accounts ARE seeded (the test/dev fixtures depend on
    them) and NO bootstrap admin is created.
  * a weak BOOTSTRAP_ADMIN_PASSWORD in production → boot is REFUSED (RuntimeError), so a weak
    god-account password can't re-open the hole.
  * an unset BOOTSTRAP_ADMIN_PASSWORD in production → no admin is seeded, but boot proceeds (the
    infrastructure still seeds) and a loud warning is logged.

The seeders use the module-global ``app.seed.SessionLocal``; we monkeypatch it to the scratch
sessionmaker (one patch covers all four functions, since they all live in app.seed). All async tests
rely on asyncio_mode=auto (pytest.ini).
"""
import os
import sys

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import asyncpg

sys.path.insert(0, os.path.dirname(__file__))  # so the sibling _migration_backed_db helper imports at collection time

import app.config as appconfig
import app.models  # register the core ORM tables on Base.metadata
import app.models.party  # noqa: F401 — register Party's table
import app.models.customer_user  # noqa: F401 — register CustomerUser's table
from app import seed as seed_mod
from app.config import settings
from app.models import Assignment, OrgNode, Record, RoleDef, Tenant, User
from app.models.base import Base
from app.models.customer_user import CustomerUser

import _migration_backed_db as mb  # scratch-DB url helpers (sys.path includes tests/)

_STRONG_PW = "S7rong-Bootstrap-Pw!"


async def _fresh_scratch():
    """Drop+create a scratch DB and build the schema via create_all. Returns (name, engine)."""
    name = mb.scratch_name("c5gate")
    c = await asyncpg.connect(mb.raw_url("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
    await c.execute(f"CREATE DATABASE {name}")
    await c.close()
    eng = create_async_engine(mb._sa(name))
    async with eng.begin() as conn:
        # org_node.path is LTREE — the extension must exist before create_all builds the table.
        # (The real schema installs these via migrations; here we only need the table DDL to succeed.)
        for _ext in ("ltree", "pg_trgm", "pgcrypto", "citext"):
            await conn.execute(text(f"CREATE EXTENSION IF NOT EXISTS {_ext}"))
        await conn.run_sync(Base.metadata.create_all)
    return name, eng


async def _drop(name, eng):
    await eng.dispose()
    c = await asyncpg.connect(mb.raw_url("postgres"))
    await c.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
    await c.close()


async def _snapshot(sm):
    """Read back which accounts exist after seeding, plus infra presence."""
    boot_email = settings.bootstrap_admin_email.strip().lower()
    async with sm() as s:
        await s.connection(execution_options={"audit_tenant_filter": False})
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one_or_none()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one_or_none()
        portal = (await s.execute(select(CustomerUser).where(CustomerUser.email == "portal@demo.isp"))).scalar_one_or_none()
        boot = (await s.execute(select(User).where(User.email == boot_email))).scalar_one_or_none()
        tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
        roles = (await s.execute(select(RoleDef))).scalars().all()
        boot_is_super_admin = False
        if boot is not None:
            sa = next((r for r in roles if r.key == "super_admin"), None)
            if sa is not None:
                asg = (await s.execute(select(Assignment).where(
                    Assignment.user_id == boot.id, Assignment.role_id == sa.id))).scalar_one_or_none()
                boot_is_super_admin = asg is not None
    return {
        "admin": admin is not None,
        "agent": agent is not None,
        "portal": portal is not None,
        "bootstrap": boot is not None,
        "bootstrap_is_super_admin": boot_is_super_admin,
        "tenant": tenant is not None,
        "roles": len(roles),
    }


async def _run_boot_seeds(monkeypatch, *, environment, bootstrap_pw):
    """Run the four credential seeders on a fresh scratch DB under the given environment.

    Seeds a customer Record between access + portal so the portal seeder's record-precondition is met
    — that way the ONLY thing that can withhold the portal user in prod is the gate, not a missing
    record. Saves/restores the THE_TENANT_ID cache so the scratch tenant id doesn't leak into the
    rest of the suite.
    """
    name, eng = await _fresh_scratch()
    sm = async_sessionmaker(eng, expire_on_commit=False, class_=AsyncSession)
    saved_cache = appconfig._THE_TENANT_ID
    monkeypatch.setattr(seed_mod, "SessionLocal", sm)
    monkeypatch.setattr(settings, "environment", environment)
    monkeypatch.setattr(settings, "bootstrap_admin_password", bootstrap_pw)
    try:
        await seed_mod.seed_if_empty()
        await seed_mod.seed_access_if_empty()
        async with sm() as s:
            tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
            s.add(Record(tenant_id=tenant.id, entity_key="customer", data={}))
            await s.commit()
        await seed_mod.seed_portal_if_empty()
        await seed_mod.seed_bootstrap_admin_if_missing()
        return await _snapshot(sm)
    finally:
        appconfig._THE_TENANT_ID = saved_cache
        await _drop(name, eng)


async def test_production_withholds_demo_credentials_and_seeds_bootstrap(monkeypatch):
    r = await _run_boot_seeds(monkeypatch, environment="production", bootstrap_pw=_STRONG_PW)
    # The exploit (log in as admin@demo.isp/admin123) is impossible — the row never exists.
    assert r["admin"] is False, "admin@demo.isp/admin123 must NOT seed in production"
    assert r["agent"] is False, "agent@demo.isp/agent123 must NOT seed in production"
    assert r["portal"] is False, "portal@demo.isp/portal123 must NOT seed in production (gate, record present)"
    # The real super-admin IS provisioned from env creds, with the super_admin role.
    assert r["bootstrap"] is True, "the env-provided bootstrap super-admin must be seeded in production"
    assert r["bootstrap_is_super_admin"] is True, "bootstrap admin must hold the super_admin role"
    # Infrastructure (tenant + role catalog) is config, not credentials — it still seeds.
    assert r["tenant"] is True, "tenant row must still seed in production (RLS/login depend on it)"
    assert r["roles"] > 0, "role catalog must still seed in production"


async def test_development_still_seeds_demo_credentials(monkeypatch):
    r = await _run_boot_seeds(monkeypatch, environment="development", bootstrap_pw=_STRONG_PW)
    assert r["admin"] is True, "dev/test must still seed admin@demo.isp (suite fixtures depend on it)"
    assert r["agent"] is True, "dev/test must still seed agent@demo.isp"
    assert r["portal"] is True, "dev/test must still seed portal@demo.isp"
    assert r["bootstrap"] is False, "the production bootstrap admin must NOT be created outside production"


async def test_unset_bootstrap_password_skips_without_boot_failure(monkeypatch):
    # Prod with NO bootstrap password: demo creds still gated out, no bootstrap admin, but boot proceeds.
    r = await _run_boot_seeds(monkeypatch, environment="production", bootstrap_pw="")
    assert r["admin"] is False and r["agent"] is False and r["portal"] is False
    assert r["bootstrap"] is False, "no bootstrap admin when the password is unset"
    assert r["tenant"] is True and r["roles"] > 0, "infrastructure still seeds even without a bootstrap admin"


async def test_weak_bootstrap_password_refuses_boot(monkeypatch):
    # A weak god-account password must abort boot (the weak-check runs before any DB access).
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "bootstrap_admin_password", "admin123")
    with pytest.raises(RuntimeError, match="too weak"):
        await seed_mod.seed_bootstrap_admin_if_missing()
