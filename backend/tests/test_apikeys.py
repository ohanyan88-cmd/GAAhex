"""Coverage for API keys (machine principals) + the in-process rate limiter (apikeys.py + auth.py).

A key authenticates (X-API-Key header) AS its `acts_as_user_id`, so all access control is unchanged.
The RAW key (prefix.secret) is shown ONCE at creation; lists show only prefix/meta. Management needs
config.manage. The rate limiter is OFF by default — the rate-limit test toggles `settings` live and
restores it in `finally`. Unique key names per test (shared session DB accumulates).
"""

import uuid

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import User, Tenant
from app.models.apikey import ApiKey


async def _user_id(email):
    async with SessionLocal() as s:
        return str((await s.execute(select(User).where(User.email == email))).scalar_one().id)


def _key(headers_key):
    return {"X-API-Key": headers_key}


# ===================== create / list (raw key shown once) =====================

async def test_create_shows_raw_key_once_list_hides_it(client, admin):
    created = (await client.post("/api/api-keys", headers=admin, json={"name": "ci-bot"})).json()
    assert "key" in created and "." in created["key"]               # raw prefix.secret, shown ONCE
    assert created["key"].startswith(created["prefix"] + ".")
    assert created["name"] == "ci-bot"

    listed = next(k for k in (await client.get("/api/api-keys", headers=admin)).json() if k["id"] == created["id"])
    assert "key" not in listed                                      # never re-shown
    assert listed["prefix"] == created["prefix"]


# ===================== authenticates as the acts-as user =====================

async def test_key_authenticates_as_principal(client, admin):
    # a key acting as admin → full admin access
    admin_key = (await client.post("/api/api-keys", headers=admin, json={"name": "admin-key"})).json()["key"]
    me = await client.get("/auth/me", headers=_key(admin_key))
    assert me.status_code == 200 and me.json()["email"] == "admin@demo.isp"

    # a key acting as the agent → the AGENT's access (can view leads, cannot view tickets)
    agent_id = await _user_id("agent@demo.isp")
    agent_key = (await client.post("/api/api-keys", headers=admin,
                                   json={"name": "agent-key", "acts_as_user_id": agent_id})).json()["key"]
    assert (await client.get("/auth/me", headers=_key(agent_key))).json()["email"] == "agent@demo.isp"
    assert (await client.get("/api/leads", headers=_key(agent_key))).status_code == 200
    assert (await client.get("/api/tickets", headers=_key(agent_key))).status_code == 403   # agent's scope


# ===================== revoke + bad keys =====================

async def test_revoke_then_unauthorized_and_idempotent(client, admin):
    created = (await client.post("/api/api-keys", headers=admin, json={"name": "to-revoke"})).json()
    raw, kid = created["key"], created["id"]
    assert (await client.get("/auth/me", headers=_key(raw))).status_code == 200

    assert (await client.post(f"/api/api-keys/{kid}/revoke", headers=admin)).status_code == 200
    assert (await client.get("/auth/me", headers=_key(raw))).status_code == 401     # revoked → no longer authenticates
    # idempotent revoke, and unknown id → 404
    assert (await client.post(f"/api/api-keys/{kid}/revoke", headers=admin)).status_code == 200
    assert (await client.post(f"/api/api-keys/{uuid.uuid4()}/revoke", headers=admin)).status_code == 404


async def test_bad_key_unauthorized(client):
    assert (await client.get("/auth/me", headers=_key("bogus.notarealkey"))).status_code == 401


# ===================== permission + tenant isolation =====================

async def test_non_admin_cannot_manage_keys(client, agent):
    assert (await client.post("/api/api-keys", headers=agent, json={"name": "x"})).status_code == 403
    assert (await client.get("/api/api-keys", headers=agent)).status_code == 403


async def test_acts_as_must_be_in_tenant_and_list_isolated(client, admin):
    # acts_as a non-existent user → 422
    assert (await client.post("/api/api-keys", headers=admin,
                              json={"name": "x", "acts_as_user_id": str(uuid.uuid4())})).status_code == 422

    # a key in another tenant is never listed here
    async with SessionLocal() as s:
        t2 = Tenant(name=f"Other ISP {uuid.uuid4().hex[:6]}")
        s.add(t2)
        await s.flush()
        u2 = User(tenant_id=t2.id, email=f"u2-{uuid.uuid4().hex[:8]}@x.io", name="U2", password_hash="x")
        s.add(u2)
        await s.flush()
        ak = ApiKey(tenant_id=t2.id, name="foreign", prefix="ffff0000",
                    key_hash="deadbeef" + uuid.uuid4().hex, acts_as_user_id=u2.id)
        s.add(ak)
        await s.commit()
        foreign_id = str(ak.id)
    assert foreign_id not in {k["id"] for k in (await client.get("/api/api-keys", headers=admin)).json()}


# ===================== rate limiting (toggled live, restored after) =====================

async def test_rate_limit_429(client, admin):
    assert settings.rate_limit_enabled is False         # default is OFF
    raw = (await client.post("/api/api-keys", headers=admin, json={"name": "rl-key"})).json()["key"]

    original_per_min = settings.rate_limit_per_min
    settings.rate_limit_enabled = True
    settings.rate_limit_per_min = 2                     # tiny window: 3rd request trips it
    try:
        # this key is a unique principal ("k:" + prefix…), so its bucket is isolated
        codes = [(await client.get("/auth/me", headers=_key(raw))).status_code for _ in range(3)]
        assert codes[0] == 200 and codes[1] == 200      # under the limit
        assert codes[2] == 429                           # over → 429
    finally:
        settings.rate_limit_enabled = False
        settings.rate_limit_per_min = original_per_min
    # restored OFF, so a further call is fine
    assert (await client.get("/auth/me", headers=_key(raw))).status_code == 200
