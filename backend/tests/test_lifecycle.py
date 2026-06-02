"""Deletion / Archive / Restore Standard (file 12 — D14) — lifecycle router gate
+ state-machine coverage.

Tests cover: GET state, archive transition + idempotency + event emit, restore
from both ARCHIVED and SOFT_DELETED, soft-delete transition, purge as
super-admin only, forbidden transitions from PURGED, permission denials at view
and edit verbs, unknown entity_type → 404, cross-tenant lookup → 404.

Pattern follows tests/test_watchers.py: build the role + user matrix once at
module scope via OwnerSessionLocal, seed Task rows directly (router-level Task
gates are not the surface under test here), and exercise the lifecycle router
end-to-end against the demo tenant + a second tenant for RLS isolation.
"""
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import Task, Tenant, OrgNode, RoleDef, Assignment, Event
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# ── role + user profiles ──────────────────────────────────────────────────────
# `*` = wildcard super-admin grant (covers every Object.Action — including the
# configuration.manage gate required for purge). Empty list = caller can't do
# anything; used to assert the 403 default-deny surface on view + edit verbs.
_PROFILES = {
    "lc_admin":   ["*"],
    "lc_no_perm": [],
}
_USERS = {
    "alice": ("alice-lc@demo.isp", "lc_admin"),
    "nada":  ("nada-lc@demo.isp",  "lc_no_perm"),
}


async def _ensure_user(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(select(User).where(User.tenant_id == tenant_id, User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("lc-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id))).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id, node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


# Shared context the seed fixture stashes on the module so per-test helpers can
# build Task rows in the demo tenant + the second tenant.
_CTX: dict = {}


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_lifecycle_users():
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
            user_ids[lbl] = await _ensure_user(s, tenant_id=tenant.id, node_id=root.id,
                                               email=email, role_id=role_ids[rk])

        # Second tenant for the cross-tenant 404 assertion.
        other = (await s.execute(select(Tenant).where(Tenant.name == "Lifecycle-RLS-Other"))).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Lifecycle-RLS-Other", status="active"); s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root", code="lcroot2", path=Ltree("lcroot2"))); await s.flush()
        other_root = (await s.execute(select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1))).scalar_one()
        other_role = (await s.execute(select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "lc_admin"))).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="lc_admin", label="admin",
                                 permissions=_PROFILES["lc_admin"], scope="tenant")
            s.add(other_role); await s.flush()
        other_user_id = await _ensure_user(s, tenant_id=other.id, node_id=other_root.id,
                                           email="alice-other-lc@demo.isp", role_id=other_role.id)

        await s.commit()

        _CTX["demo_tenant_id"] = tenant.id
        _CTX["other_tenant_id"] = other.id
        _CTX["alice_id"] = user_ids["alice"]
        _CTX["nada_id"] = user_ids["nada"]
        _CTX["other_alice_id"] = other_user_id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + ["alice-other-lc@demo.isp"]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # Cascade test-created rows: tasks first (FK to user), then assignments,
            # refresh tokens, users, role defs. Bounded by the test emails so we
            # don't touch any other test's data.
            await s.execute(Task.__table__.delete().where(Task.created_by.in_(uids)))
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        other_tid = _CTX.get("other_tenant_id")
        if other_tid is not None:
            await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tid))
            await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tid))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "lc-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])


@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])


# ── helpers ───────────────────────────────────────────────────────────────────
#
# Seed a Task row directly via OwnerSessionLocal. The task router's hard-validation
# rules (owner, assignee, parent etc.) are not relevant to lifecycle behaviour —
# the lifecycle router only ever reads `id`, `tenant_id`, `deletion_state`, and
# the three audit timestamps. We populate the minimum required NOT-NULL columns.

async def _new_task(*, tenant_id, created_by, deletion_state="ACTIVE") -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        # Per-tenant TSK-N reference number — unique on (tenant_id, reference_number).
        n = (await s.execute(select(Task).where(Task.tenant_id == tenant_id))).scalars().all()
        ref = f"TSK-{len(n) + 1:06d}"
        t = Task(
            tenant_id=tenant_id,
            reference_number=ref,
            title="lifecycle test task",
            task_type="GENERAL",
            task_scope="STANDALONE",
            status="OPEN",
            priority="MEDIUM",
            owner_type="EMPLOYEE",
            owner_id=created_by,
            assignee_type="EMPLOYEE",
            assignee_id=created_by,
            created_by=created_by,
            deletion_state=deletion_state,
        )
        s.add(t)
        await s.flush()
        tid = t.id
        await s.commit()
    return tid


async def _state(client, hdr, task_id):
    return await client.get(f"/api/lifecycle/task/{task_id}/state", headers=hdr)


# ── 1. GET state on a fresh task → ACTIVE ─────────────────────────────────────

async def test_get_state_returns_active_for_fresh_task(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r = await _state(client, alice, tid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entityType"] == "task"
    assert body["entityId"] == str(tid)
    assert body["deletionState"] == "ACTIVE"
    assert body["archivedAt"] is None
    assert body["deletedAt"] is None
    assert body["restoredAt"] is None


# ── 2. POST archive on ACTIVE → ARCHIVED + event emit ─────────────────────────

async def test_archive_active_transitions_to_archived(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r = await client.post(f"/api/lifecycle/task/{tid}/archive", headers=alice, json={"note": "year-end cleanup"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deletionState"] == "ARCHIVED"
    assert body["archivedAt"] is not None

    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "object_archived"))).scalars().all()
        match = [e for e in evs if e.record_id == tid]
        assert match, "expected an object_archived event pinned to the task"
        ev = match[-1]
        assert ev.event_name == "Object.Archived"
        assert ev.category == "LIFECYCLE"
        assert ev.data.get("from") == "ACTIVE"
        assert ev.data.get("to") == "ARCHIVED"


# ── 3. POST archive on ARCHIVED → idempotent ──────────────────────────────────

async def test_archive_archived_is_idempotent(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    await client.post(f"/api/lifecycle/task/{tid}/archive", headers=alice)
    # Count object_archived events before the second call.
    async with OwnerSessionLocal() as s:
        before = (await s.execute(select(Event).where(Event.type == "object_archived"))).scalars().all()
        before_n = sum(1 for e in before if e.record_id == tid)
    r2 = await client.post(f"/api/lifecycle/task/{tid}/archive", headers=alice)
    assert r2.status_code == 200
    assert r2.json()["deletionState"] == "ARCHIVED"
    async with OwnerSessionLocal() as s:
        after = (await s.execute(select(Event).where(Event.type == "object_archived"))).scalars().all()
        after_n = sum(1 for e in after if e.record_id == tid)
    # Idempotent: second archive must NOT re-emit an event.
    assert before_n == after_n


# ── 4. POST restore on ARCHIVED → ACTIVE ──────────────────────────────────────

async def test_restore_archived_transitions_to_active(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    await client.post(f"/api/lifecycle/task/{tid}/archive", headers=alice)
    r = await client.post(f"/api/lifecycle/task/{tid}/restore", headers=alice, json={"note": "needed back"})
    assert r.status_code == 200
    body = r.json()
    assert body["deletionState"] == "ACTIVE"
    assert body["restoredAt"] is not None


# ── 5. DELETE on ACTIVE → SOFT_DELETED ────────────────────────────────────────

async def test_soft_delete_active_transitions_to_soft_deleted(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r = await client.request(
        "DELETE", f"/api/lifecycle/task/{tid}", headers=alice, json={"note": "user requested"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deletionState"] == "SOFT_DELETED"
    assert body["deletedAt"] is not None

    async with OwnerSessionLocal() as s:
        evs = (await s.execute(select(Event).where(Event.type == "object_soft_deleted"))).scalars().all()
        assert any(e.record_id == tid for e in evs)


# ── 6. POST restore on SOFT_DELETED → ACTIVE ──────────────────────────────────

async def test_restore_soft_deleted_transitions_to_active(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    await client.request("DELETE", f"/api/lifecycle/task/{tid}", headers=alice)
    r = await client.post(f"/api/lifecycle/task/{tid}/restore", headers=alice)
    assert r.status_code == 200
    assert r.json()["deletionState"] == "ACTIVE"
    assert r.json()["restoredAt"] is not None


# ── 7. POST purge on SOFT_DELETED → PURGED ────────────────────────────────────

async def test_purge_soft_deleted_transitions_to_purged(client, alice):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    await client.request("DELETE", f"/api/lifecycle/task/{tid}", headers=alice)
    r = await client.post(f"/api/lifecycle/task/{tid}/purge", headers=alice)
    assert r.status_code == 200, r.text
    assert r.json()["deletionState"] == "PURGED"

    # V1 contract: the row must STILL exist (no hard-delete from the router).
    async with OwnerSessionLocal() as s:
        row = (await s.execute(select(Task).where(Task.id == tid))).scalar_one_or_none()
        assert row is not None
        assert row.deletion_state == "PURGED"

    # And purge from ACTIVE must be refused — must soft-delete first.
    tid2 = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r2 = await client.post(f"/api/lifecycle/task/{tid2}/purge", headers=alice)
    assert r2.status_code == 422


# ── 8. POST archive on PURGED → 422 (forbidden) ───────────────────────────────

async def test_archive_purged_is_forbidden(client, alice):
    tid = await _new_task(
        tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"],
        deletion_state="PURGED",
    )
    r = await client.post(f"/api/lifecycle/task/{tid}/archive", headers=alice)
    assert r.status_code == 422

    # Restore + soft-delete from PURGED are forbidden too (same terminal rule).
    rr = await client.post(f"/api/lifecycle/task/{tid}/restore", headers=alice)
    assert rr.status_code == 422
    rd = await client.request("DELETE", f"/api/lifecycle/task/{tid}", headers=alice)
    assert rd.status_code == 422


# ── 9. GET state denied without permission → 403 ──────────────────────────────

async def test_get_state_denied_without_view_permission(client, nada):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r = await _state(client, nada, tid)
    assert r.status_code == 403


# ── 10. POST archive denied without permission → 403 ─────────────────────────

async def test_archive_denied_without_edit_permission(client, nada):
    tid = await _new_task(tenant_id=_CTX["demo_tenant_id"], created_by=_CTX["alice_id"])
    r = await client.post(f"/api/lifecycle/task/{tid}/archive", headers=nada)
    assert r.status_code == 403


# ── 11. Unknown entity_type → 404 ─────────────────────────────────────────────

async def test_unknown_entity_type_returns_404(client, alice):
    r = await client.get(f"/api/lifecycle/not_a_real_thing/{uuid.uuid4()}/state", headers=alice)
    assert r.status_code == 404
    assert "not supported" in r.json()["detail"].lower()


# ── 12. Cross-tenant entity_id → 404 ──────────────────────────────────────────

async def test_cross_tenant_lookup_returns_404(client, alice):
    """A task seeded in the OTHER tenant must not be visible to demo-tenant alice.

    RLS already filters by tenant, and the router's explicit tenant_id predicate
    plus the 404 response is the documented denial surface (never leak the
    existence of cross-tenant rows)."""
    foreign_tid = await _new_task(
        tenant_id=_CTX["other_tenant_id"], created_by=_CTX["other_alice_id"],
    )
    r = await _state(client, alice, foreign_tid)
    assert r.status_code == 404
