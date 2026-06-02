"""Queue Ownership Standard (file 02 B5; enums in file 14) — coverage tests.

Validates the extension to `helpdesk_queue`:
  - 4 new fields: assignment_strategy, visibility, owning_department, is_active
  - 6 new endpoints (or extensions to existing ones): create/list/get/patch + activate/deactivate
  - Enum validation (422 on out-of-range strategy / visibility)
  - Permission gates (helpdesk_queue.view / helpdesk_queue.manage)
  - Cross-tenant isolation (404)
  - workflow.emit substrate audit for create + update

Fixture pattern mirrors tests/test_attachments.py. Demo emails are unique to this
module so they don't collide with other suites: alice-q@demo.isp, nada-q@demo.isp.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "queue_full":    ["helpdesk_queue.view", "helpdesk_queue.manage"],
    "queue_view":    ["helpdesk_queue.view"],
    "queue_no_perm": [],
}
_USERS = {
    "alice": ("alice-q@demo.isp", "queue_full"),
    "viewer": ("viewer-q@demo.isp", "queue_view"),
    "nada":  ("nada-q@demo.isp",  "queue_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("q-123"), status="active")
        s.add(u); await s.flush()
    has_assignment = (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not has_assignment:
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id,
                         node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_queue_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
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

        # Other tenant — for cross-tenant 404.
        other = (await s.execute(
            select(Tenant).where(Tenant.name == "Queue-RLS-Other")
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Queue-RLS-Other", status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root",
                          code="qroot", path=Ltree("qroot"))); await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "queue_full")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="queue_full", label="full",
                                 permissions=_PROFILES["queue_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                      email="alice-other-q@demo.isp", role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-q@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tenant_id))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "q-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def viewer(client): return await _login(client, _USERS["viewer"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-q@demo.isp")


async def _create_queue(client, hdr, **overrides):
    body = {"name": overrides.pop("name", f"Q-{uuid.uuid4().hex[:8]}")}
    body.update(overrides)
    return await client.post("/api/helpdesk/queues", headers=hdr, json=body)


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_create_returns_201_with_defaults(client, alice):
    r = await _create_queue(client, alice)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["assignment_strategy"] == "MANUAL"
    assert b["visibility"] == "DEPARTMENT"
    assert b["is_active"] is True
    assert b["owning_department"] is None


async def test_create_accepts_ownership_fields(client, alice):
    r = await _create_queue(client, alice,
                            assignment_strategy="ROUND_ROBIN",
                            visibility="MANAGEMENT",
                            owning_department="Customer Service")
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["assignment_strategy"] == "ROUND_ROBIN"
    assert b["visibility"] == "MANAGEMENT"
    assert b["owning_department"] == "Customer Service"


async def test_list_returns_created_queue(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    lst = await client.get("/api/helpdesk/queues", headers=alice)
    assert lst.status_code == 200
    assert any(q["id"] == qid for q in lst.json())


async def test_get_single_queue(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    g = await client.get(f"/api/helpdesk/queues/{qid}", headers=alice)
    assert g.status_code == 200 and g.json()["id"] == qid


async def test_patch_strategy_to_round_robin(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"assignment_strategy": "ROUND_ROBIN"})
    assert p.status_code == 200 and p.json()["assignment_strategy"] == "ROUND_ROBIN"


async def test_patch_visibility_to_management(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"visibility": "MANAGEMENT"})
    assert p.status_code == 200 and p.json()["visibility"] == "MANAGEMENT"


async def test_patch_owning_department(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"owning_department": "NOC"})
    assert p.status_code == 200 and p.json()["owning_department"] == "NOC"


# ── activate / deactivate idempotency ─────────────────────────────────────────

async def test_deactivate_then_reactivate(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    d = await client.post(f"/api/helpdesk/queues/{qid}/deactivate", headers=alice)
    assert d.status_code == 200 and d.json()["is_active"] is False
    a = await client.post(f"/api/helpdesk/queues/{qid}/activate", headers=alice)
    assert a.status_code == 200 and a.json()["is_active"] is True


async def test_deactivate_idempotent(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    d1 = await client.post(f"/api/helpdesk/queues/{qid}/deactivate", headers=alice)
    d2 = await client.post(f"/api/helpdesk/queues/{qid}/deactivate", headers=alice)
    assert d1.status_code == 200 and d2.status_code == 200
    assert d1.json()["is_active"] is False and d2.json()["is_active"] is False


async def test_activate_idempotent(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    # Already active — re-activating must succeed with is_active=True.
    a1 = await client.post(f"/api/helpdesk/queues/{qid}/activate", headers=alice)
    a2 = await client.post(f"/api/helpdesk/queues/{qid}/activate", headers=alice)
    assert a1.status_code == 200 and a2.status_code == 200
    assert a1.json()["is_active"] is True and a2.json()["is_active"] is True


# ── enum validation ───────────────────────────────────────────────────────────

async def test_invalid_strategy_rejected(client, alice):
    r = await _create_queue(client, alice, assignment_strategy="BOGUS_STRAT")
    assert r.status_code == 422


async def test_invalid_visibility_rejected(client, alice):
    r = await _create_queue(client, alice, visibility="BOGUS_VIS")
    assert r.status_code == 422


async def test_patch_invalid_strategy_rejected(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"assignment_strategy": "NOPE"})
    assert p.status_code == 422


async def test_patch_invalid_visibility_rejected(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"visibility": "NOPE"})
    assert p.status_code == 422


# ── permission gates ──────────────────────────────────────────────────────────

async def test_create_denied_without_manage(client, viewer):
    """viewer has helpdesk_queue.view but not .manage → 403 on create."""
    r = await _create_queue(client, viewer)
    assert r.status_code == 403


async def test_create_denied_without_any_perm(client, nada):
    r = await _create_queue(client, nada)
    assert r.status_code == 403


async def test_list_denied_without_view(client, nada):
    r = await client.get("/api/helpdesk/queues", headers=nada)
    assert r.status_code == 403


async def test_activate_denied_without_manage(client, alice, viewer):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    a = await client.post(f"/api/helpdesk/queues/{qid}/activate", headers=viewer)
    assert a.status_code == 403


async def test_deactivate_denied_without_manage(client, alice, viewer):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    d = await client.post(f"/api/helpdesk/queues/{qid}/deactivate", headers=viewer)
    assert d.status_code == 403


# ── multi-tenant RLS ──────────────────────────────────────────────────────────

async def test_cross_tenant_get_404(client, alice, alice_other):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    g = await client.get(f"/api/helpdesk/queues/{qid}", headers=alice_other)
    assert g.status_code == 404


async def test_cross_tenant_patch_404(client, alice, alice_other):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice_other,
                           json={"name": "hacked"})
    assert p.status_code == 404


# ── substrate event emit ──────────────────────────────────────────────────────

async def test_create_emits_queue_created_event(client, alice):
    r = await _create_queue(client, alice)
    assert r.status_code == 201
    qid = r.json()["id"]
    async with OwnerSessionLocal() as s:
        ev = (await s.execute(
            select(Event).where(
                Event.type == "queue_created",
                Event.entity_key == "helpdesk_queue",
                Event.record_id == uuid.UUID(qid),
            )
        )).scalar_one_or_none()
        assert ev is not None
        assert ev.event_name == "Queue.Created"
        assert ev.category == "LIFECYCLE"


async def test_update_emits_queue_updated_event(client, alice):
    r = await _create_queue(client, alice)
    qid = r.json()["id"]
    p = await client.patch(f"/api/helpdesk/queues/{qid}", headers=alice,
                           json={"owning_department": "Tier-1"})
    assert p.status_code == 200
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(
                Event.type == "queue_updated",
                Event.entity_key == "helpdesk_queue",
                Event.record_id == uuid.UUID(qid),
            )
        )).scalars().all()
        assert evs and any(e.event_name == "Queue.Updated" for e in evs)
