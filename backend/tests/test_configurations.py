"""Configuration Standard (file 08) — coverage.

Tests cover: create-201 shape with CFG- reference, list all, list filtered
by scope, get single, patch updates value + bumps version + writes history,
patch updates status (status_changed event), history ordered newest first,
resolve picks most-specific scope (USER > DEPARTMENT > TENANT), invalid scope
enum 422, invalid status enum 422, create/patch denied without configuration.manage,
cross-tenant 404, RLS isolation in list, status change emits event,
duplicate (tenant_id, configuration_key, scope) → 409 via DB UNIQUE.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.configuration import Configuration, ConfigurationHistory
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "config_manager": ["configuration.manage"],
    "config_no_perm": [],
}
_USERS = {
    "alice": ("alice-cfg@demo.isp", "config_manager"),
    "nada":  ("nada-cfg@demo.isp",  "config_no_perm"),
}

_OTHER_TENANT_NAME = "Cfg-RLS-Other"


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _wire_configurations_router():
    """Ensure the configurations router is mounted before the test module runs.

    The Portal main.py wiring (`from .routers import ..., configurations` +
    `app.include_router(configurations.router)`) is a hand-edit that the
    orchestrator applies on integration. This fixture is the test-only fallback
    so the suite is runnable in isolation against the same FastAPI app instance.
    Idempotent: safe to re-import / re-include (FastAPI deduplicates by route).
    """
    from app.main import app
    from app.routers import configurations as _cfg_router
    # Avoid double-mount if main.py has already been edited to include us.
    if not any(getattr(r, "tags", None) == ["configurations"] for r in app.routes):
        app.include_router(_cfg_router.router)
    yield


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("cfg-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(
        select(Assignment).where(
            Assignment.user_id == u.id, Assignment.tenant_id == tenant_id
        )
    )).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id,
                         node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_cfg_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id)
                           .order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root",
                           code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()
        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk,
                              permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id
        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id,
                          email=email, role_id=role_ids[rk])
        # Other tenant — for RLS / cross-tenant tests.
        other = (await s.execute(
            select(Tenant).where(Tenant.name == _OTHER_TENANT_NAME)
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name=_OTHER_TENANT_NAME, status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root",
                          code="rootc", path=Ltree("rootc")))
            await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(
                RoleDef.tenant_id == other.id, RoleDef.key == "config_manager"
            )
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(
                tenant_id=other.id, key="config_manager", label="manager",
                permissions=_PROFILES["config_manager"], scope="tenant",
            )
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                      email="alice-other-cfg@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-cfg@demo.isp"]
        users = (await s.execute(
            select(User).where(User.email.in_(all_emails))
        )).scalars().all()
        uids = [u.id for u in users]
        if uids:
            cfg_ids = (await s.execute(
                select(Configuration.id).where(Configuration.created_by.in_(uids))
            )).scalars().all()
            if cfg_ids:
                await s.execute(
                    ConfigurationHistory.__table__.delete().where(
                        ConfigurationHistory.configuration_id.in_(cfg_ids)
                    )
                )
                await s.execute(
                    Configuration.__table__.delete().where(
                        Configuration.id.in_(cfg_ids)
                    )
                )
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(
            RoleDef.key.in_(list(_PROFILES.keys()))
        ))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        # Cross-tenant teardown helper — purges every tenant_id-scoped row

        # before the final tenant DELETE (otherwise event/audit/record FKs block it).

        from tests.conftest import delete_tenant_cleanly

        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "cfg-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-cfg@demo.isp")


def _ukey(prefix="feature"):
    """Unique configuration key per call (avoids cross-test collisions on UNIQUE)."""
    return f"{prefix}.{uuid.uuid4().hex[:10]}"


async def _create(client, hdr, *, key=None, scope="TENANT", value=None,
                  status="ACTIVE", description=None):
    body = {
        "configurationKey": key or _ukey(),
        "scope": scope,
        "configurationValue": value if value is not None else {"enabled": True},
        "status": status,
    }
    if description is not None:
        body["description"] = description
    return await client.post("/api/configurations", headers=hdr, json=body)


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_create_returns_201_with_cfg_reference(client, alice):
    r = await _create(client, alice)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["referenceNumber"].startswith("CFG-")
    assert len(b["referenceNumber"]) == 10  # CFG-000001
    assert b["status"] == "ACTIVE"
    assert b["scope"] == "TENANT"
    assert b["version"] == 1
    assert b["configurationValue"] == {"enabled": True}
    assert b["createdBy"] is not None


async def test_list_returns_created(client, alice):
    key = _ukey("list")
    await _create(client, alice, key=key)
    r = await client.get("/api/configurations", headers=alice)
    assert r.status_code == 200
    assert any(c["configurationKey"] == key for c in r.json())


async def test_list_filter_by_scope(client, alice):
    key = _ukey("scopefilter")
    await _create(client, alice, key=key, scope="GLOBAL")
    r = await client.get("/api/configurations?scope=GLOBAL", headers=alice)
    assert r.status_code == 200
    assert all(c["scope"] == "GLOBAL" for c in r.json())
    assert any(c["configurationKey"] == key for c in r.json())


async def test_list_filter_by_key(client, alice):
    key = _ukey("keyfilter")
    await _create(client, alice, key=key, scope="USER")
    r = await client.get(f"/api/configurations?key={key}", headers=alice)
    assert r.status_code == 200
    assert len(r.json()) == 1 and r.json()[0]["configurationKey"] == key


async def test_get_single(client, alice):
    c = (await _create(client, alice)).json()
    g = await client.get(f"/api/configurations/{c['id']}", headers=alice)
    assert g.status_code == 200 and g.json()["id"] == c["id"]


async def test_patch_updates_value_bumps_version_writes_history(client, alice):
    c = (await _create(client, alice, value={"v": 1})).json()
    p = await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                            json={"configurationValue": {"v": 2},
                                  "changeReason": "bump"})
    assert p.status_code == 200, p.text
    b = p.json()
    assert b["version"] == 2
    assert b["configurationValue"] == {"v": 2}
    assert b["updatedBy"] is not None

    h = await client.get(f"/api/configurations/{c['id']}/history", headers=alice)
    assert h.status_code == 200
    versions = [row["version"] for row in h.json()]
    assert 1 in versions and 2 in versions


async def test_history_orders_newest_first(client, alice):
    c = (await _create(client, alice, value={"v": 1})).json()
    await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                       json={"configurationValue": {"v": 2}})
    await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                       json={"configurationValue": {"v": 3}})
    h = await client.get(f"/api/configurations/{c['id']}/history", headers=alice)
    versions = [row["version"] for row in h.json()]
    # Must be strictly descending.
    assert versions == sorted(versions, reverse=True)
    assert versions[0] == 3


async def test_resolve_picks_most_specific_scope(client, alice):
    """USER beats DEPARTMENT beats TENANT for the same key."""
    key = _ukey("resolve")
    await _create(client, alice, key=key, scope="TENANT",     value={"level": "tenant"})
    await _create(client, alice, key=key, scope="DEPARTMENT", value={"level": "dept"})
    await _create(client, alice, key=key, scope="USER",       value={"level": "user"})

    # All scopes allowed → USER wins.
    r = await client.post("/api/configurations/resolve", headers=alice,
                          json={"key": key, "scope_hints": {}})
    assert r.status_code == 200 and r.json()["configurationValue"]["level"] == "user"

    # USER excluded → DEPARTMENT wins.
    r = await client.post("/api/configurations/resolve", headers=alice,
                          json={"key": key, "scope_hints": {"USER": False}})
    assert r.status_code == 200 and r.json()["configurationValue"]["level"] == "dept"

    # USER + DEPARTMENT excluded → TENANT wins.
    r = await client.post("/api/configurations/resolve", headers=alice,
                          json={"key": key,
                                "scope_hints": {"USER": False, "DEPARTMENT": False}})
    assert r.status_code == 200 and r.json()["configurationValue"]["level"] == "tenant"


async def test_resolve_404_when_no_match(client, alice):
    r = await client.post("/api/configurations/resolve", headers=alice,
                          json={"key": f"missing.{uuid.uuid4().hex}",
                                "scope_hints": {}})
    assert r.status_code == 404


async def test_resolve_skips_inactive(client, alice):
    """INACTIVE / DEPRECATED rows must NOT be returned by resolve."""
    key = _ukey("inactive")
    c = (await _create(client, alice, key=key, scope="USER")).json()
    # Flip to INACTIVE.
    await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                       json={"status": "INACTIVE"})
    r = await client.post("/api/configurations/resolve", headers=alice,
                          json={"key": key, "scope_hints": {}})
    assert r.status_code == 404


# ── enum / validation ─────────────────────────────────────────────────────────

async def test_invalid_scope_enum_422(client, alice):
    r = await client.post("/api/configurations", headers=alice,
                          json={"configurationKey": _ukey(), "scope": "NOPE",
                                "configurationValue": {}})
    assert r.status_code == 422


async def test_invalid_status_enum_422(client, alice):
    r = await client.post("/api/configurations", headers=alice,
                          json={"configurationKey": _ukey(), "scope": "TENANT",
                                "configurationValue": {}, "status": "BOGUS"})
    assert r.status_code == 422


async def test_patch_invalid_status_422(client, alice):
    c = (await _create(client, alice)).json()
    p = await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                           json={"status": "BOGUS"})
    assert p.status_code == 422


async def test_duplicate_key_scope_409(client, alice):
    key = _ukey("dup")
    r1 = await _create(client, alice, key=key, scope="TENANT")
    assert r1.status_code == 201
    r2 = await _create(client, alice, key=key, scope="TENANT")
    assert r2.status_code == 409


# ── permission gates ──────────────────────────────────────────────────────────

async def test_create_denied_without_perm(client, nada):
    r = await _create(client, nada)
    assert r.status_code == 403


async def test_list_denied_without_perm(client, nada):
    r = await client.get("/api/configurations", headers=nada)
    assert r.status_code == 403


async def test_patch_denied_without_perm(client, alice, nada):
    c = (await _create(client, alice)).json()
    p = await client.patch(f"/api/configurations/{c['id']}", headers=nada,
                           json={"configurationValue": {"x": 1}})
    assert p.status_code == 403


async def test_resolve_denied_without_perm(client, nada):
    r = await client.post("/api/configurations/resolve", headers=nada,
                          json={"key": "x", "scope_hints": {}})
    assert r.status_code == 403


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    c = (await _create(client, alice)).json()
    g = await client.get(f"/api/configurations/{c['id']}", headers=alice_other)
    assert g.status_code == 404


async def test_cross_tenant_list_isolation(client, alice, alice_other):
    key = _ukey("rls")
    await _create(client, alice, key=key, scope="TENANT")
    r = await client.get(f"/api/configurations?key={key}", headers=alice_other)
    assert r.status_code == 200 and r.json() == []


# ── event emit ────────────────────────────────────────────────────────────────

async def test_create_emits_event(client, alice):
    c = (await _create(client, alice)).json()
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "CONFIGURATION_CREATED")
        )).scalars().all()
        assert any(e.data.get("configurationId") == c["id"] for e in evs)


async def test_status_change_emits_event(client, alice):
    c = (await _create(client, alice, status="PENDING_REVIEW")).json()
    await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                       json={"status": "ACTIVE"})
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "CONFIGURATION_STATUS_CHANGED")
        )).scalars().all()
        match = [e for e in evs if e.data.get("configurationId") == c["id"]]
        assert match and match[-1].data["fromStatus"] == "PENDING_REVIEW"
        assert match[-1].data["toStatus"] == "ACTIVE"


async def test_value_update_emits_event(client, alice):
    c = (await _create(client, alice)).json()
    await client.patch(f"/api/configurations/{c['id']}", headers=alice,
                       json={"configurationValue": {"new": True}})
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(Event.type == "CONFIGURATION_UPDATED")
        )).scalars().all()
        assert any(e.data.get("configurationId") == c["id"] for e in evs)
