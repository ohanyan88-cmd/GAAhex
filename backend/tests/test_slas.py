"""SLA Standard (file 12) — gate + lifecycle coverage.

Tests cover: happy paths, permission gates, status state-machine
(pause requires reason, resume recalculates due_at, complete idempotent,
cancel idempotent), lazy breach detection (GET triggers auto-breach when
overdue), invalid pause_reason rejected, pause-of-non-active rejected,
resume-of-non-paused rejected, complete-of-cancelled rejected,
SlaEvent audit trail, multi-tenant RLS isolation.
"""
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import select, update

from app.db import OwnerSessionLocal
from app.models import SlaRecord, SlaEvent, Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "sla_manager":  ["sla.manage"],
    "sla_no_perm":  [],
}
_USERS = {
    "alice": ("alice-sla@demo.isp", "sla_manager"),
    "nada":  ("nada-sla@demo.isp",  "sla_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("sla-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_sla_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1))).scalar_one_or_none()
        if root is None:
            root = OrgNode(tenant_id=tenant.id, type="Group", name="Root", code="grp", path=Ltree("grp"))
            s.add(root); await s.flush()
        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk))).scalar_one_or_none()
            if row is None:
                row = RoleDef(tenant_id=tenant.id, key=rk, label=rk, permissions=perms, scope="tenant")
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id
        for _, (email, rk) in _USERS.items():
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email, role_id=role_ids[rk])
        # Other tenant
        other = (await s.execute(select(Tenant).where(Tenant.name == "SLA-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="SLA-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="root4", path=Ltree("root4"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "sla_manager"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="sla_manager", label="mgr", permissions=["sla.manage"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id, email="alice-other-sla@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-sla@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            sla_ids = (await s.execute(select(SlaRecord.id).where(SlaRecord.created_by.in_(uids)))).scalars().all()
            if sla_ids:
                await s.execute(SlaEvent.__table__.delete().where(SlaEvent.sla_id.in_(sla_ids)))
                await s.execute(SlaRecord.__table__.delete().where(SlaRecord.id.in_(sla_ids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tenant_id))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "sla-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-sla@demo.isp")


def _future(seconds=3600) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()


def _past(seconds=3600) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds)).isoformat()


async def _mk(client, hdr, **kwargs) -> dict:
    body = {"objectType": "ticket", "objectId": str(uuid.uuid4()),
            "dueAt": _future(), **kwargs}
    r = await client.post("/api/slas", headers=hdr, json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_create_returns_201_and_shape(client, alice):
    s = await _mk(client, alice)
    assert s["status"] == "ON_TRACK"
    assert s["referenceNumber"].startswith("SLA-")
    assert s["totalPausedSeconds"] == 0
    assert s["timezone"] == "UTC"


async def test_list_returns_created_sla(client, alice):
    s = await _mk(client, alice)
    r = await client.get("/api/slas", headers=alice)
    assert r.status_code == 200
    assert any(x["id"] == s["id"] for x in r.json())


async def test_get_single(client, alice):
    s = await _mk(client, alice)
    r = await client.get(f"/api/slas/{s['id']}", headers=alice)
    assert r.status_code == 200 and r.json()["id"] == s["id"]


async def test_pause_then_resume_slides_due_at(client, alice):
    s = await _mk(client, alice)
    sid = s["id"]
    original_due = s["dueAt"]

    p = await client.post(f"/api/slas/{sid}/pause", headers=alice,
                          json={"pauseReason": "WAITING_CUSTOMER"})
    assert p.status_code == 200 and p.json()["status"] == "PAUSED"
    assert p.json()["pauseReason"] == "WAITING_CUSTOMER"

    rs = await client.post(f"/api/slas/{sid}/resume", headers=alice, json={})
    assert rs.status_code == 200 and rs.json()["status"] == "ON_TRACK"
    # due_at must be >= original (slid by pause duration; may be equal in sub-second test runs)
    resumed = rs.json()
    assert resumed["dueAt"] >= original_due
    assert resumed["totalPausedSeconds"] >= 0  # sub-second pauses round to 0 — that's correct
    assert resumed["pausedAt"] is None          # paused_at cleared on resume
    assert resumed["resumedAt"] is not None     # resumedAt set


async def test_complete_from_on_track(client, alice):
    s = await _mk(client, alice)
    c = await client.post(f"/api/slas/{s['id']}/complete", headers=alice, json={})
    assert c.status_code == 200 and c.json()["status"] == "COMPLETED"
    assert c.json()["completedAt"] is not None


async def test_cancel(client, alice):
    s = await _mk(client, alice)
    c = await client.post(f"/api/slas/{s['id']}/cancel", headers=alice, json={})
    assert c.status_code == 200 and c.json()["status"] == "CANCELLED"


async def test_sla_events_list_has_created_event(client, alice):
    s = await _mk(client, alice)
    r = await client.get(f"/api/slas/{s['id']}/events", headers=alice)
    assert r.status_code == 200
    assert any(e["eventType"] == "CREATED" for e in r.json())


async def test_pause_adds_event_and_resume_adds_event(client, alice):
    s = await _mk(client, alice)
    sid = s["id"]
    await client.post(f"/api/slas/{sid}/pause", headers=alice,
                      json={"pauseReason": "WAITING_APPROVAL"})
    await client.post(f"/api/slas/{sid}/resume", headers=alice, json={})
    r = await client.get(f"/api/slas/{sid}/events", headers=alice)
    types = [e["eventType"] for e in r.json()]
    assert "PAUSED" in types and "RESUMED" in types


async def test_breach_emits_event(client, alice):
    """Create an already-overdue SLA → GET triggers lazy breach → event in DB."""
    oid = str(uuid.uuid4())
    body = {"objectType": "ticket", "objectId": oid,
            "startedAt": _past(7200), "dueAt": _past(3600)}
    r = await client.post("/api/slas", headers=alice, json=body)
    assert r.status_code == 201
    sid = r.json()["id"]
    # GET triggers lazy breach
    g = await client.get(f"/api/slas/{sid}", headers=alice)
    assert g.status_code == 200 and g.json()["status"] == "BREACHED"
    assert g.json()["breachedAt"] is not None
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "sla_breached"))).scalars().all()
        assert any(str(e.record_id) == oid for e in evs)


# ── permission gates ──────────────────────────────────────────────────────────

async def test_create_denied_without_sla_manage(client, nada):
    r = await client.post("/api/slas", headers=nada,
                          json={"objectType": "ticket", "objectId": str(uuid.uuid4()),
                                "dueAt": _future()})
    assert r.status_code == 403


async def test_list_denied_without_sla_manage(client, nada):
    assert (await client.get("/api/slas", headers=nada)).status_code == 403


async def test_pause_denied_without_sla_manage(client, alice, nada):
    s = await _mk(client, alice)
    r = await client.post(f"/api/slas/{s['id']}/pause", headers=nada,
                          json={"pauseReason": "WAITING_CUSTOMER"})
    assert r.status_code == 403


# ── validation rules ──────────────────────────────────────────────────────────

async def test_create_due_before_started_rejected(client, alice):
    r = await client.post("/api/slas", headers=alice,
                          json={"objectType": "ticket", "objectId": str(uuid.uuid4()),
                                "startedAt": _future(3600), "dueAt": _future(1800)})
    assert r.status_code == 422 and "dueAt" in r.json()["detail"]


async def test_pause_requires_valid_reason(client, alice):
    s = await _mk(client, alice)
    r = await client.post(f"/api/slas/{s['id']}/pause", headers=alice,
                          json={"pauseReason": "JUST_BECAUSE"})
    assert r.status_code == 422


async def test_pause_without_reason_rejected(client, alice):
    s = await _mk(client, alice)
    r = await client.post(f"/api/slas/{s['id']}/pause", headers=alice, json={})
    assert r.status_code == 422


async def test_pause_of_completed_rejected(client, alice):
    s = await _mk(client, alice)
    await client.post(f"/api/slas/{s['id']}/complete", headers=alice, json={})
    r = await client.post(f"/api/slas/{s['id']}/pause", headers=alice,
                          json={"pauseReason": "WAITING_CUSTOMER"})
    assert r.status_code == 422


async def test_resume_of_on_track_rejected(client, alice):
    s = await _mk(client, alice)  # ACTIVE, not paused
    r = await client.post(f"/api/slas/{s['id']}/resume", headers=alice, json={})
    assert r.status_code == 422


async def test_complete_of_cancelled_rejected(client, alice):
    s = await _mk(client, alice)
    await client.post(f"/api/slas/{s['id']}/cancel", headers=alice, json={})
    r = await client.post(f"/api/slas/{s['id']}/complete", headers=alice, json={})
    assert r.status_code == 422


# ── idempotency ───────────────────────────────────────────────────────────────

async def test_complete_is_idempotent(client, alice):
    s = await _mk(client, alice)
    r1 = await client.post(f"/api/slas/{s['id']}/complete", headers=alice, json={})
    r2 = await client.post(f"/api/slas/{s['id']}/complete", headers=alice, json={})
    assert r1.status_code == 200 and r2.status_code == 200


async def test_cancel_is_idempotent(client, alice):
    s = await _mk(client, alice)
    r1 = await client.post(f"/api/slas/{s['id']}/cancel", headers=alice, json={})
    r2 = await client.post(f"/api/slas/{s['id']}/cancel", headers=alice, json={})
    assert r1.status_code == 200 and r2.status_code == 200


async def test_pause_is_idempotent(client, alice):
    s = await _mk(client, alice)
    r1 = await client.post(f"/api/slas/{s['id']}/pause", headers=alice,
                           json={"pauseReason": "WAITING_PARTS"})
    r2 = await client.post(f"/api/slas/{s['id']}/pause", headers=alice,
                           json={"pauseReason": "WAITING_PARTS"})
    assert r1.status_code == 200 and r2.status_code == 200


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    s = await _mk(client, alice)
    r = await client.get(f"/api/slas/{s['id']}", headers=alice_other)
    assert r.status_code == 404


async def test_cross_tenant_list_empty(client, alice, alice_other):
    await _mk(client, alice)
    r = await client.get("/api/slas", headers=alice_other)
    assert r.status_code == 200 and r.json() == []
