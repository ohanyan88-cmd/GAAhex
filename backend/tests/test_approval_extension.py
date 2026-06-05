"""Approval Ownership Standard (file 02) — extension coverage.

Tests the new file-02 endpoints on the SPEC §4.5 `Approval` table:
    POST /api/approvals/{id}/delegate         -> decision=DELEGATE, status stays PENDING
    POST /api/approvals/{id}/request-changes  -> decision=REQUEST_CHANGES, note stored
    POST /api/approvals/{id}/cancel-request   -> decision=CANCEL_REQUEST, status=CANCELLED
    POST /api/approvals/{id}/sign             -> signature_method+value+signed_at stamped

Plus: permission-denied path, cross-tenant 404, validation, and forward-only state
guard (non-PENDING rows refuse delegate/request-changes/cancel).

Fixture pattern mirrors tests/test_attachments.py:
  - Module-scope user setup with a distinct cleanup that nukes Approval rows referencing
    test users BEFORE deleting Assignment / RefreshToken / User to avoid FK violations.
  - Email suffix `-appx` keeps these users distinct from other test suites.
"""
import uuid

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.kernel.approvals import create_approval_request
from app.models import Assignment, Event, OrgNode, RoleDef, Tenant
from app.models.approval import Approval
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


_PROFILES = {
    "appx_full":   ["approval.approve"],
    "appx_no_perm": [],
}
_USERS = {
    "alice": ("alice-appx@demo.isp", "appx_full"),
    "nada":  ("nada-appx@demo.isp",  "appx_no_perm"),
}
_OTHER_EMAIL = "alice-other-appx@demo.isp"


async def _ensure(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(tenant_id=tenant_id, email=email, name=email.split("@")[0],
                 password_hash=hash_password("appx-123"), status="active")
        s.add(u); await s.flush()
    if not (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none():
        s.add(Assignment(tenant_id=tenant_id, user_id=u.id, role_id=role_id,
                         node_id=node_id, region_scope="any"))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_appx_users():
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
            await _ensure(s, tenant_id=tenant.id, node_id=root.id, email=email,
                          role_id=role_ids[rk])

        # Other tenant for cross-tenant 404 case.
        other = (await s.execute(
            select(Tenant).where(Tenant.name == "Appx-RLS-Other")
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Appx-RLS-Other", status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(tenant_id=other.id, type="Group", name="Root",
                          code="root_ax", path=Ltree("root_ax")))
            await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(RoleDef.tenant_id == other.id, RoleDef.key == "appx_full")
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(tenant_id=other.id, key="appx_full", label="full",
                                 permissions=_PROFILES["appx_full"], scope="tenant")
            s.add(other_role); await s.flush()
        await _ensure(s, tenant_id=other.id, node_id=other_root.id,
                      email=_OTHER_EMAIL, role_id=other_role.id)
        await s.commit()
        other_tenant_id = other.id

    yield

    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()] + [_OTHER_EMAIL]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # Approval rows reference these users via requested_by / decided_by /
            # delegated_to_user_id — null/delete them first.
            from sqlalchemy import or_
            await s.execute(
                Approval.__table__.delete().where(or_(
                    Approval.requested_by.in_(uids),
                    Approval.decided_by.in_(uids),
                    Approval.delegated_to_user_id.in_(uids),
                ))
            )
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        # Cross-tenant teardown — purge every tenant_id-scoped row before the
        # final tenant DELETE (otherwise event/audit/record/etc FKs block it).
        from tests.conftest import delete_tenant_cleanly
        await delete_tenant_cleanly(s, other_tenant_id)
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "appx-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def alice(client): return await _login(client, _USERS["alice"][0])
@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])
@pytest_asyncio.fixture
async def alice_other(client): return await _login(client, _OTHER_EMAIL)


# ─── helpers ─────────────────────────────────────────────────────────────────

async def _user_id(email: str) -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        return (await s.execute(select(User).where(User.email == email))).scalar_one().id


async def _user_tenant_id(email: str) -> tuple[uuid.UUID, uuid.UUID]:
    async with OwnerSessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == email))).scalar_one()
        return u.id, u.tenant_id


async def _seed_approval(*, requester_email: str = None, tenant_email: str = None,
                         action_type: str = "high_discount",
                         status: str = "PENDING") -> str:
    """Insert a fresh Approval row through the kernel helper. Returns the id (str)."""
    requester_email = requester_email or _USERS["alice"][0]
    tenant_email = tenant_email or requester_email
    async with OwnerSessionLocal() as s:
        requester = (await s.execute(
            select(User).where(User.email == requester_email)
        )).scalar_one()
        tenant_user = (await s.execute(
            select(User).where(User.email == tenant_email)
        )).scalar_one()
        # create_approval_request dedupes on (tenant, action, target, requested_by)
        # — make every test row unique by giving each a fresh target_record_id.
        row = await create_approval_request(
            s,
            tenant_id=tenant_user.tenant_id,
            action_type=action_type,
            requested_by_user_id=requester.id,
            target_entity_key="invoice",
            target_record_id=uuid.uuid4(),
            payload={"reason": "test"},
        )
        if status != "PENDING":
            row.status = status
        await s.commit()
        return str(row.id)


async def _approval_event_names(approval_id: str) -> list[str]:
    """Return file-02 event_name values emitted against this Approval (chronological)."""
    async with OwnerSessionLocal() as s:
        rows = (await s.execute(
            select(Event.event_name).where(
                Event.entity_key == "approval",
                Event.record_id == uuid.UUID(approval_id),
                Event.event_name.isnot(None),
            ).order_by(Event.created_at)
        )).all()
        return [r[0] for r in rows]


# ─── delegate ────────────────────────────────────────────────────────────────

async def test_delegate_sets_decision_and_pins_delegate(client, alice):
    aid = await _seed_approval()
    delegate_id = str(await _user_id(_USERS["nada"][0]))
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice,
                          json={"delegatedToUserId": delegate_id, "note": "you take this one"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "DELEGATE"
    assert body["delegated_to_user_id"] == delegate_id
    assert body["decided_by"] is not None
    assert body["decided_at"] is not None
    assert body["status"] == "PENDING"  # status unchanged
    assert "Approval.Delegated" in await _approval_event_names(aid)


async def test_delegate_missing_target_is_422(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice, json={})
    assert r.status_code == 422


async def test_delegate_invalid_uuid_is_422(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice,
                          json={"delegatedToUserId": "not-a-uuid"})
    assert r.status_code == 422


async def test_delegate_to_foreign_user_is_422(client, alice, alice_other):
    """Delegating to a user in a different tenant is refused with 422."""
    aid = await _seed_approval()
    foreign = str(await _user_id(_OTHER_EMAIL))
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice,
                          json={"delegatedToUserId": foreign})
    assert r.status_code == 422


# ─── request-changes ─────────────────────────────────────────────────────────

async def test_request_changes_stores_note(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/request-changes", headers=alice,
                          json={"changeRequestNote": "Need more detail on amount"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "REQUEST_CHANGES"
    assert body["change_request_note"] == "Need more detail on amount"
    assert body["status"] == "PENDING"
    assert body["decided_by"] is not None
    assert "Approval.ChangesRequested" in await _approval_event_names(aid)


async def test_request_changes_empty_note_is_422(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/request-changes", headers=alice,
                          json={"changeRequestNote": "   "})
    assert r.status_code == 422


# ─── cancel-request ──────────────────────────────────────────────────────────

async def test_cancel_request_moves_to_cancelled(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice,
                          json={"reason": "duplicate request"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "CANCEL_REQUEST"
    assert body["status"] == "CANCELLED"
    assert body["decision_reason"] == "duplicate request"
    assert body["decided_by"] is not None
    assert "Approval.Cancelled" in await _approval_event_names(aid)


async def test_cancel_request_without_body_ok(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice)
    assert r.status_code == 200
    assert r.json()["status"] == "CANCELLED"


async def test_cancel_then_anything_is_409(client, alice):
    """Forward-only: once CANCELLED, neither delegate / request-changes / cancel-request
    will land again."""
    aid = await _seed_approval()
    cancel = await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice)
    assert cancel.status_code == 200
    delegate_id = str(await _user_id(_USERS["nada"][0]))
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice,
                          json={"delegatedToUserId": delegate_id})
    assert r.status_code == 409
    r2 = await client.post(f"/api/approvals/{aid}/request-changes", headers=alice,
                           json={"changeRequestNote": "late"})
    assert r2.status_code == 409
    r3 = await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice)
    assert r3.status_code == 409


# ─── sign ────────────────────────────────────────────────────────────────────

async def test_sign_stamps_method_value_and_timestamp(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/sign", headers=alice,
                          json={"signatureMethod": "TOTP", "signatureValue": "987654"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["signature_method"] == "TOTP"
    assert body["signature_value"] == "987654"
    assert body["signed_at"] is not None
    assert "Approval.Signed" in await _approval_event_names(aid)


async def test_sign_missing_method_is_422(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/sign", headers=alice,
                          json={"signatureValue": "abc"})
    assert r.status_code == 422


async def test_sign_missing_value_is_422(client, alice):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/sign", headers=alice,
                          json={"signatureMethod": "TOTP"})
    assert r.status_code == 422


async def test_sign_on_cancelled_is_409(client, alice):
    aid = await _seed_approval()
    await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice)
    r = await client.post(f"/api/approvals/{aid}/sign", headers=alice,
                          json={"signatureMethod": "TOTP", "signatureValue": "x"})
    assert r.status_code == 409


# ─── permission denial ──────────────────────────────────────────────────────

async def test_delegate_denied_without_perm(client, alice, nada):
    """A user without `approval.approve` permission is refused at the kernel gate (403)."""
    aid = await _seed_approval()
    delegate_id = str(await _user_id(_USERS["alice"][0]))
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=nada,
                          json={"delegatedToUserId": delegate_id})
    assert r.status_code == 403


async def test_request_changes_denied_without_perm(client, alice, nada):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/request-changes", headers=nada,
                          json={"changeRequestNote": "nope"})
    assert r.status_code == 403


async def test_cancel_denied_without_perm(client, alice, nada):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/cancel-request", headers=nada)
    assert r.status_code == 403


async def test_sign_denied_without_perm(client, alice, nada):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/sign", headers=nada,
                          json={"signatureMethod": "TOTP", "signatureValue": "x"})
    assert r.status_code == 403


# ─── cross-tenant isolation ─────────────────────────────────────────────────

async def test_delegate_cross_tenant_404(client, alice, alice_other):
    """An Approval row in tenant A is invisible from tenant B (404, not 403 — RLS)."""
    aid = await _seed_approval()
    # alice_other belongs to a different tenant; the row must not be reachable.
    target = str(await _user_id(_OTHER_EMAIL))
    r = await client.post(f"/api/approvals/{aid}/delegate", headers=alice_other,
                          json={"delegatedToUserId": target})
    assert r.status_code == 404


async def test_sign_cross_tenant_404(client, alice, alice_other):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/sign", headers=alice_other,
                          json={"signatureMethod": "TOTP", "signatureValue": "x"})
    assert r.status_code == 404


async def test_request_changes_cross_tenant_404(client, alice, alice_other):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/request-changes", headers=alice_other,
                          json={"changeRequestNote": "x"})
    assert r.status_code == 404


async def test_cancel_cross_tenant_404(client, alice, alice_other):
    aid = await _seed_approval()
    r = await client.post(f"/api/approvals/{aid}/cancel-request", headers=alice_other)
    assert r.status_code == 404
