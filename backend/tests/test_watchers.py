"""Watcher / Subscriber Standard (file 05) — full gate coverage.

Tests cover: route happy-paths, every permission gate (no-perm, own vs others,
manage_others), status state-machine (ACTIVE→PAUSED→ACTIVE→REMOVED, terminal),
partial unique — duplicate ACTIVE rejected with 409, REMOVED then re-add creates
a new row, mention-source sets expires_at, preference patch emits correct event
type, audit event substrate, multi-tenant RLS isolation.
"""
import uuid
from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Watcher, Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password
from sqlalchemy_utils import Ltree


_PROFILES = {
    "watcher_standard": ["watch.view", "watch.add", "watch.remove", "watch.pause", "watch.resume"],
    "watcher_manager":  ["watch.view", "watch.add", "watch.remove", "watch.pause", "watch.resume", "watch.manage_others"],
    "watcher_no_perm":  [],
}
_USERS = {
    "alice": ("alice-wt@demo.isp", "watcher_standard"),
    "bob":   ("bob-wt@demo.isp",   "watcher_standard"),
    "mgr":   ("mgr-wt@demo.isp",   "watcher_manager"),
    "nada":  ("nada-wt@demo.isp",  "watcher_no_perm"),
}


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("wt-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.tenant_id == tenant_id, Assignment.user_id == u.id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_watcher_users():
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
        user_ids = {}
        for lbl, (email, rk) in _USERS.items():
            user_ids[lbl] = await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email, role_id=role_ids[rk])
        # Second tenant for RLS test.
        other = (await s.execute(select(Tenant).where(Tenant.name == "Watcher-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Watcher-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="root2", path=Ltree("root2"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "watcher_standard"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="watcher_standard", label="std", permissions=_PROFILES["watcher_standard"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id, email="alice-other-wt@demo.isp", role_id=other_role.id)
        await s.commit()
        demo_tenant_id = tenant.id
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-wt@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # Drop ALL watcher rows in both tenants we touched — the other tenant's
            # watcher rows reference our test users (created_by FK), and any watcher
            # created by the demo-tenant test users also needs to go. Scoping by
            # tenant_id covers both sides cleanly without chasing individual FK columns.
            await s.execute(Watcher.__table__.delete().where(
                Watcher.tenant_id.in_([demo_tenant_id, other_tenant_id])
            ))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tenant_id))
        # Cross-tenant teardown helper — purges every tenant_id-scoped row

        # before the final tenant DELETE (otherwise event/audit/record FKs block it).

        from tests.conftest import delete_tenant_cleanly

        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "wt-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])

@pytest_asyncio.fixture
async def bob(client): return await _login(client, _USERS["bob"][0])

@pytest_asyncio.fixture
async def mgr(client): return await _login(client, _USERS["mgr"][0])

@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])

@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, "alice-other-wt@demo.isp")


def _target(): return ("customer", str(uuid.uuid4()))


async def _add(client, hdr, *, ek=None, pid=None, wtype="EMPLOYEE", wid=None, source="MANUAL", scope="OBJECT_ONLY", frequency="IMMEDIATE"):
    ek = ek or "customer"; pid = pid or str(uuid.uuid4())
    body = {"watcherType": wtype, "source": source, "scope": scope, "notificationFrequency": frequency}
    if wid: body["watcherId"] = str(wid)
    r = await client.post(f"/api/{ek}/{pid}/watchers", headers=hdr, json=body)
    return r, ek, pid


# ── happy paths ───────────────────────────────────────────────────────────────

async def test_add_returns_201_and_shape(client, alice):
    r, ek, pid = await _add(client, alice)
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["status"] == "ACTIVE"
    assert b["watcherType"] == "EMPLOYEE"
    assert b["source"] == "MANUAL"
    assert b["scope"] == "OBJECT_ONLY"
    assert b["notificationFrequency"] == "IMMEDIATE"


async def test_list_returns_added_watchers(client, alice):
    ek, pid = _target()
    await _add(client, alice, ek=ek, pid=pid)
    lst = await client.get(f"/api/{ek}/{pid}/watchers", headers=alice)
    assert lst.status_code == 200
    assert len(lst.json()) == 1


async def test_remove_soft_deletes_and_emits(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    d = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice)
    assert d.status_code == 200 and d.json()["status"] == "REMOVED"
    assert d.json()["removedAt"] is not None
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_REMOVED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_pause_then_resume_round_trip(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    p = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    assert p.status_code == 200 and p.json()["status"] == "PAUSED"
    assert p.json()["pausedAt"] is not None
    rs = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/resume", headers=alice)
    assert rs.status_code == 200 and rs.json()["status"] == "ACTIVE"
    assert rs.json()["pausedAt"] is None


async def test_preferences_patch_updates_fields_and_emits_scope_event(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    p = await client.patch(f"/api/{ek}/{pid}/watchers/{wid}/preferences", headers=alice,
                           json={"scope": "OBJECT_AND_CHILDREN", "priority": "HIGH"})
    assert p.status_code == 200
    assert p.json()["scope"] == "OBJECT_AND_CHILDREN"
    assert p.json()["priority"] == "HIGH"
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_SCOPE_CHANGED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_preferences_patch_frequency_only_emits_preference_changed(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    p = await client.patch(f"/api/{ek}/{pid}/watchers/{wid}/preferences", headers=alice,
                           json={"notificationFrequency": "DAILY_DIGEST"})
    assert p.status_code == 200 and p.json()["notificationFrequency"] == "DAILY_DIGEST"
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_PREFERENCE_CHANGED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_mention_source_sets_expires_at(client, alice):
    r, ek, pid = await _add(client, alice, source="MENTION")
    assert r.status_code == 201
    assert r.json()["expiresAt"] is not None


# ── permission gate denials ───────────────────────────────────────────────────

async def test_add_denied_without_watch_add(client, nada):
    r, _, _ = await _add(client, nada)
    assert r.status_code == 403


async def test_list_denied_without_watch_view(client, nada):
    ek, pid = _target()
    r = await client.get(f"/api/{ek}/{pid}/watchers", headers=nada)
    assert r.status_code == 403


async def test_add_another_user_denied_without_manage_others(client, alice, bob):
    """alice tries to add bob as a DEPARTMENT watcher (non-self) → needs manage_others."""
    r, _, _ = await _add(client, alice, wtype="DEPARTMENT", wid=uuid.uuid4())
    assert r.status_code == 403


async def test_manager_can_add_non_self_watcher(client, mgr):
    r, _, _ = await _add(client, mgr, wtype="ROLE", wid=uuid.uuid4())
    assert r.status_code == 201


async def test_remove_other_user_denied_without_manage_others(client, alice, bob):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    d = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=bob)
    assert d.status_code == 403


async def test_manager_can_remove_other_user(client, alice, mgr):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    d = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=mgr)
    assert d.status_code == 200 and d.json()["status"] == "REMOVED"
    # byManager flag lives in the event payload, not the response body
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_REMOVED"))).scalars().all()
        found = [e for e in evs if e.data.get("watchId") == wid]
        assert found and found[-1].data["byManager"] is True


async def test_pause_other_user_denied_without_manage_others(client, alice, bob):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    p = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=bob)
    assert p.status_code == 403


async def test_resume_other_user_denied_without_manage_others(client, alice, bob):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    rs = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/resume", headers=bob)
    assert rs.status_code == 403


# ── status state machine ──────────────────────────────────────────────────────

async def test_remove_is_terminal_cannot_pause(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice)
    p = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    assert p.status_code == 422


async def test_remove_is_terminal_cannot_resume(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice)
    rs = await client.post(f"/api/{ek}/{pid}/watchers/{wid}/resume", headers=alice)
    assert rs.status_code == 422


async def test_remove_is_idempotent(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    d1 = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice)
    d2 = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice)
    assert d1.status_code == 200 and d2.status_code == 200


async def test_removed_then_re_add_creates_new_row(client, alice):
    """After removal, re-adding creates a NEW Watcher row — not a revive."""
    r, ek, pid = await _add(client, alice)
    wid1 = r.json()["id"]
    await client.delete(f"/api/{ek}/{pid}/watchers/{wid1}", headers=alice)
    r2, _, _ = await _add(client, alice, ek=ek, pid=pid)
    assert r2.status_code == 201
    wid2 = r2.json()["id"]
    assert wid2 != wid1  # brand-new row, not a revive
    async with OwnerSessionLocal() as s:
        rows = (await s.execute(
            select(Watcher).where(Watcher.target_entity_id == uuid.UUID(pid))
        )).scalars().all()
        assert len(rows) == 2
        statuses = {w.status for w in rows}
        assert statuses == {"REMOVED", "ACTIVE"}


# ── partial unique — duplicate ACTIVE rejected ────────────────────────────────

async def test_duplicate_active_rejected_409(client, alice):
    """Two adds for the same (target, EMPLOYEE, alice.id) → second is 409."""
    ek, pid = _target()
    r1, _, _ = await _add(client, alice, ek=ek, pid=pid)
    assert r1.status_code == 201
    r2, _, _ = await _add(client, alice, ek=ek, pid=pid)
    assert r2.status_code == 409


async def test_paused_watcher_allows_new_active_for_same_principal(client, alice):
    """A PAUSED watcher is not ACTIVE, so the partial unique doesn't block a new add."""
    ek, pid = _target()
    r1, _, _ = await _add(client, alice, ek=ek, pid=pid)
    wid = r1.json()["id"]
    await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    # Now no ACTIVE watcher exists for this (target, principal) — should be allowed.
    r2, _, _ = await _add(client, alice, ek=ek, pid=pid)
    assert r2.status_code == 201


# ── audit event substrate ─────────────────────────────────────────────────────

async def test_add_emits_watch_added_event(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_ADDED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_pause_emits_watch_paused_event(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_PAUSED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_resume_emits_watch_resumed_event(client, alice):
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    await client.post(f"/api/{ek}/{pid}/watchers/{wid}/pause", headers=alice)
    await client.post(f"/api/{ek}/{pid}/watchers/{wid}/resume", headers=alice)
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "WATCH_RESUMED"))).scalars().all()
        assert any(e.data.get("watchId") == wid for e in evs)


async def test_no_event_on_noop_preferences_patch(client, alice):
    """Patching with the same values shouldn't emit noise."""
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    before_count = 0
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type.in_(["WATCH_SCOPE_CHANGED", "WATCH_PREFERENCE_CHANGED"])))).scalars().all()
        before_count = sum(1 for e in evs if e.data.get("watchId") == wid)
    await client.patch(f"/api/{ek}/{pid}/watchers/{wid}/preferences", headers=alice,
                       json={"scope": "OBJECT_ONLY"})  # same as default
    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type.in_(["WATCH_SCOPE_CHANGED", "WATCH_PREFERENCE_CHANGED"])))).scalars().all()
        after_count = sum(1 for e in evs if e.data.get("watchId") == wid)
    assert before_count == after_count


# ── multi-tenant RLS isolation ────────────────────────────────────────────────

async def test_cross_tenant_list_returns_empty(client, alice, alice_other):
    """Alice adds a watcher; alice_other (different tenant) lists same target → empty."""
    ek, pid = _target()
    await _add(client, alice, ek=ek, pid=pid)
    lst = await client.get(f"/api/{ek}/{pid}/watchers", headers=alice_other)
    assert lst.status_code == 200 and lst.json() == []


async def test_cross_tenant_delete_returns_404(client, alice, alice_other):
    """Alice adds; alice_other tries to delete by watcher id → 404 (RLS-isolated)."""
    r, ek, pid = await _add(client, alice)
    wid = r.json()["id"]
    d = await client.delete(f"/api/{ek}/{pid}/watchers/{wid}", headers=alice_other)
    assert d.status_code == 404
