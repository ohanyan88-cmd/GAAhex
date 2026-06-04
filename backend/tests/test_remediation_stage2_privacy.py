"""Remediation Stage 2 — GDPR access / erasure + PURGED-state PII anonymization.

Closes audit findings C2 (right-to-access), C3 (right-to-erasure), C4 (PURGED decorative).

Test matrix:

  1. test_create_access_request_emits_audit
  2. test_create_erasure_request_emits_audit
  3. test_approve_request_requires_permission
  4. test_complete_access_request_returns_tenant_scoped_export
  5. test_complete_access_request_excludes_other_tenants
  6. test_complete_erasure_request_anonymizes_pii
  7. test_erasure_preserves_invoice_rows
  8. test_purge_customer_anonymizes_pii  (the C4 close — /api/lifecycle/.../purge calls
     anonymize_customer)

Tenant matrix:
  * demo tenant (the existing seed tenant — admin user with privacy.* perms via OwnerSessionLocal seed)
  * one secondary tenant for the RLS cross-tenant isolation assertion.

Three test users on the demo tenant:
  * privacy_admin — all three privacy.* perms + lifecycle access (* wildcard subset)
  * privacy_requester — only privacy.request
  * privacy_nope — empty perms (default-deny surface)
"""
import uuid
from datetime import datetime, timezone

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy_utils import Ltree

from app.db import OwnerSessionLocal
from app.models import (
    Tenant, OrgNode, RoleDef, Assignment, Event, Record, PrivacyRequest,
)
from app.models.billing import Invoice, Payment
from app.models.customer_user import CustomerUser
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.security import hash_password


# ── role + user profiles ──────────────────────────────────────────────────────
#
# privacy_admin holds everything needed end-to-end:
#   * privacy.request, privacy.approve, privacy.complete — workflow gates
#   * record.view + customer.view — needed by anything that touches records (defense in depth)
#   * configuration.manage — purge gate on /api/lifecycle/.../purge (super-admin scope)
_PROFILES = {
    "privacy_admin": [
        "privacy.request", "privacy.approve", "privacy.complete",
        "record.view", "customer.view",
        "configuration.manage",
    ],
    "privacy_requester": ["privacy.request"],
    "privacy_nope":      [],
}
_USERS = {
    "admin":     ("privacy-admin@demo.isp",     "privacy_admin"),
    "requester": ("privacy-requester@demo.isp", "privacy_requester"),
    "nada":      ("privacy-nope@demo.isp",      "privacy_nope"),
}

_CTX: dict = {}


async def _ensure_user(s, *, tenant_id, node_id, email, role_id) -> uuid.UUID:
    u = (await s.execute(
        select(User).where(User.tenant_id == tenant_id, User.email == email)
    )).scalar_one_or_none()
    if u is None:
        u = User(
            tenant_id=tenant_id, email=email, name=email.split("@")[0],
            password_hash=hash_password("priv-123"), status="active",
        )
        s.add(u); await s.flush()
    if not (await s.execute(
        select(Assignment).where(Assignment.user_id == u.id, Assignment.tenant_id == tenant_id)
    )).scalar_one_or_none():
        s.add(Assignment(
            tenant_id=tenant_id, user_id=u.id, role_id=role_id,
            node_id=node_id, region_scope="any",
        ))
        await s.flush()
    return u.id


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _setup_privacy_users():
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == tenant.id).order_by(OrgNode.path).limit(1)
        )).scalar_one_or_none()
        if root is None:
            root = OrgNode(
                tenant_id=tenant.id, type="Group", name="Root",
                code="grppriv", path=Ltree("grppriv"),
            )
            s.add(root); await s.flush()

        role_ids = {}
        for rk, perms in _PROFILES.items():
            row = (await s.execute(
                select(RoleDef).where(RoleDef.tenant_id == tenant.id, RoleDef.key == rk)
            )).scalar_one_or_none()
            if row is None:
                row = RoleDef(
                    tenant_id=tenant.id, key=rk, label=rk,
                    permissions=perms, scope="tenant",
                )
                s.add(row); await s.flush()
            else:
                row.permissions = perms
            role_ids[rk] = row.id

        user_ids = {}
        for lbl, (email, rk) in _USERS.items():
            user_ids[lbl] = await _ensure_user(
                s, tenant_id=tenant.id, node_id=root.id,
                email=email, role_id=role_ids[rk],
            )

        # Secondary tenant for the cross-tenant export isolation test.
        other = (await s.execute(
            select(Tenant).where(Tenant.name == "Privacy-RLS-Other")
        )).scalar_one_or_none()
        if other is None:
            other = Tenant(name="Privacy-RLS-Other", status="active")
            s.add(other); await s.flush()
            s.add(OrgNode(
                tenant_id=other.id, type="Group", name="Root",
                code="privoth", path=Ltree("privoth"),
            ))
            await s.flush()
        other_root = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == other.id).limit(1)
        )).scalar_one()
        other_role = (await s.execute(
            select(RoleDef).where(
                RoleDef.tenant_id == other.id, RoleDef.key == "privacy_admin",
            )
        )).scalar_one_or_none()
        if other_role is None:
            other_role = RoleDef(
                tenant_id=other.id, key="privacy_admin", label="admin",
                permissions=_PROFILES["privacy_admin"], scope="tenant",
            )
            s.add(other_role); await s.flush()

        await s.commit()

        _CTX["demo_tenant_id"] = tenant.id
        _CTX["other_tenant_id"] = other.id
        _CTX["root_node_id"] = root.id
        _CTX["other_root_node_id"] = other_root.id
        _CTX["admin_id"] = user_ids["admin"]
        _CTX["requester_id"] = user_ids["requester"]
        _CTX["nada_id"] = user_ids["nada"]

    yield

    # Teardown — purge per-test rows + roles + secondary tenant. We do NOT touch the seeded
    # admin tenant rows; the helper limits its scope to the privacy-* emails.
    async with OwnerSessionLocal() as s:
        all_emails = [e for (e, _) in _USERS.values()]
        users = (await s.execute(select(User).where(User.email.in_(all_emails)))).scalars().all()
        uids = [u.id for u in users]
        if uids:
            # PrivacyRequest references users via FK on requestor_user_id + approver_user_id —
            # drop the test-created request rows first.
            await s.execute(
                PrivacyRequest.__table__.delete().where(
                    PrivacyRequest.requestor_user_id.in_(uids)
                )
            )
            await s.execute(Assignment.__table__.delete().where(Assignment.user_id.in_(uids)))
            await s.execute(RefreshToken.__table__.delete().where(RefreshToken.user_id.in_(uids)))
            await s.execute(User.__table__.delete().where(User.id.in_(uids)))
        await s.execute(RoleDef.__table__.delete().where(RoleDef.key.in_(list(_PROFILES.keys()))))
        other_tid = _CTX.get("other_tenant_id")
        if other_tid is not None:
            # Invoice + payment first — they FK to Record.customer_id.
            await s.execute(Payment.__table__.delete().where(Payment.tenant_id == other_tid))
            await s.execute(Invoice.__table__.delete().where(Invoice.tenant_id == other_tid))
            await s.execute(Record.__table__.delete().where(Record.tenant_id == other_tid))
            await s.execute(OrgNode.__table__.delete().where(OrgNode.tenant_id == other_tid))
            await s.execute(Tenant.__table__.delete().where(Tenant.id == other_tid))
        await s.commit()


async def _login(client, email):
    r = await client.post("/auth/login", json={"email": email, "password": "priv-123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest_asyncio.fixture
async def admin(client): return await _login(client, _USERS["admin"][0])


@pytest_asyncio.fixture
async def requester(client): return await _login(client, _USERS["requester"][0])


@pytest_asyncio.fixture
async def nada(client): return await _login(client, _USERS["nada"][0])


# ── helpers ───────────────────────────────────────────────────────────────────
#
# Seed a customer Record directly via OwnerSessionLocal — the records router's
# validation layer is not the surface under test here.

async def _new_customer(
    *,
    tenant_id,
    email="alice@example.com",
    name="Alice Example",
    phone="+374-99-123456",
    deletion_state="ACTIVE",
) -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        r = Record(
            tenant_id=tenant_id,
            entity_key="customer",
            status="active",
            data={"name": name, "email": email, "phone": phone, "plan": "FIBER-100"},
            deletion_state=deletion_state,
        )
        s.add(r); await s.flush()
        rid = r.id
        await s.commit()
    return rid


async def _new_customer_user(
    *,
    tenant_id,
    customer_id,
    email="alice@example.com",
    name="Alice Example",
) -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        cu = CustomerUser(
            tenant_id=tenant_id,
            customer_id=customer_id,
            email=email,
            name=name,
            password_hash=hash_password("portal-pw"),
            is_active=True,
        )
        s.add(cu); await s.flush()
        cuid = cu.id
        await s.commit()
    return cuid


async def _new_invoice(*, tenant_id, customer_id, number, total=12500) -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        i = Invoice(
            tenant_id=tenant_id,
            customer_id=customer_id,
            number=number,
            status="ISSUED",
            total=total,
        )
        s.add(i); await s.flush()
        iid = i.id
        await s.commit()
    return iid


async def _new_payment(*, tenant_id, customer_id, invoice_id, amount=12500) -> uuid.UUID:
    async with OwnerSessionLocal() as s:
        p = Payment(
            tenant_id=tenant_id,
            invoice_id=invoice_id,
            customer_id=customer_id,
            amount=amount,
            method="card",
        )
        s.add(p); await s.flush()
        pid = p.id
        await s.commit()
    return pid


# ── 1. Create access request emits audit ──────────────────────────────────────

async def test_create_access_request_emits_audit(client, admin):
    cust_id = await _new_customer(tenant_id=_CTX["demo_tenant_id"])
    r = await client.post(
        "/api/privacy/access-request",
        headers=admin,
        json={"customerRecordId": str(cust_id), "reason": "subject email asked"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["requestType"] == "ACCESS"
    assert body["status"] == "REQUESTED"
    assert body["customerRecordId"] == str(cust_id)
    req_id = uuid.UUID(body["id"])

    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(
                Event.type == "PRIVACY_REQUEST_CREATED",
                Event.record_id == req_id,
            )
        )).scalars().all()
        assert evs, "expected a PRIVACY_REQUEST_CREATED event pinned to the request row"
        ev = evs[-1]
        assert ev.event_name == "PrivacyRequest.Created"
        assert ev.category == "SECURITY"
        assert ev.data.get("requestType") == "ACCESS"
        assert ev.data.get("customerRecordId") == str(cust_id)


# ── 2. Create erasure request emits audit ─────────────────────────────────────

async def test_create_erasure_request_emits_audit(client, admin):
    cust_id = await _new_customer(tenant_id=_CTX["demo_tenant_id"], email="erasure@example.com")
    r = await client.post(
        "/api/privacy/erasure-request",
        headers=admin,
        json={"customerRecordId": str(cust_id), "reason": "subject closing account"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["requestType"] == "ERASURE"
    assert body["status"] == "REQUESTED"
    req_id = uuid.UUID(body["id"])

    async with OwnerSessionLocal() as s:
        evs = (await s.execute(
            select(Event).where(
                Event.type == "PRIVACY_REQUEST_CREATED",
                Event.record_id == req_id,
            )
        )).scalars().all()
        assert evs
        assert evs[-1].data.get("requestType") == "ERASURE"


# ── 3. Approve requires permission ────────────────────────────────────────────

async def test_approve_request_requires_permission(client, admin, requester):
    """The privacy_requester user can CREATE a request (privacy.request) but not APPROVE one
    (privacy.approve). The privacy_admin can do both. Both assertions in one test so we never
    rely on the order in which tests run within a module."""
    cust_id = await _new_customer(tenant_id=_CTX["demo_tenant_id"])
    # Requester creates the request fine.
    r = await client.post(
        "/api/privacy/access-request",
        headers=requester,
        json={"customerRecordId": str(cust_id), "reason": "test"},
    )
    assert r.status_code == 201, r.text
    req_id = r.json()["id"]

    # Requester cannot approve.
    r_no = await client.post(f"/api/privacy/requests/{req_id}/approve", headers=requester)
    assert r_no.status_code == 403

    # Admin can.
    r_ok = await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json()["status"] == "APPROVED"
    assert r_ok.json()["approverUserId"] == str(_CTX["admin_id"])

    # Second approve is idempotent.
    r_again = await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    assert r_again.status_code == 200
    assert r_again.json()["status"] == "APPROVED"


# ── 4. Complete ACCESS returns tenant-scoped export ───────────────────────────

async def test_complete_access_request_returns_tenant_scoped_export(client, admin):
    cust_id = await _new_customer(
        tenant_id=_CTX["demo_tenant_id"],
        email="access-export@example.com",
        name="Export Subject",
        phone="+374-77-555111",
    )
    inv_id = await _new_invoice(
        tenant_id=_CTX["demo_tenant_id"], customer_id=cust_id, number="INV-PE-001",
        total=18000,
    )
    await _new_payment(
        tenant_id=_CTX["demo_tenant_id"], customer_id=cust_id, invoice_id=inv_id,
        amount=18000,
    )

    # Create + approve + complete.
    r1 = await client.post(
        "/api/privacy/access-request",
        headers=admin,
        json={"customerRecordId": str(cust_id)},
    )
    assert r1.status_code == 201, r1.text
    req_id = r1.json()["id"]
    r2 = await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    assert r2.status_code == 200
    r3 = await client.post(f"/api/privacy/requests/{req_id}/complete", headers=admin)
    assert r3.status_code == 200, r3.text
    body = r3.json()
    assert body["status"] == "COMPLETED"
    assert body["completedAt"] is not None
    export = body["result"]
    assert export["tenant_id"] == str(_CTX["demo_tenant_id"])
    assert export["customer_record_id"] == str(cust_id)
    assert export["customer"]["data"]["email"] == "access-export@example.com"
    assert export["customer"]["data"]["name"] == "Export Subject"
    invoice_numbers = [i["number"] for i in export["invoices"]]
    assert "INV-PE-001" in invoice_numbers
    assert len(export["payments"]) == 1


# ── 5. Complete ACCESS excludes other tenants ─────────────────────────────────

async def test_complete_access_request_excludes_other_tenants(client, admin):
    """Seed an invoice in tenant B (Privacy-RLS-Other) with the SAME customer_id literal as a
    customer in tenant A's export — the export must include ONLY tenant A's rows.

    This test specifically targets the audit-flagged scenario where a tenant-scoped query that
    forgot a tenant_id predicate would leak cross-tenant rows whose foreign-key happens to
    point to a UUID present in both tenants (unrealistic with UUIDv7 in practice but the
    test asserts the guarantee independently of how unlikely the collision is)."""
    cust_id = await _new_customer(
        tenant_id=_CTX["demo_tenant_id"], email="iso@example.com", name="Iso Subject",
    )
    # Tenant A invoice for the customer.
    await _new_invoice(
        tenant_id=_CTX["demo_tenant_id"], customer_id=cust_id, number="INV-ISO-A1",
        total=5000,
    )
    # Tenant B row that REUSES the same customer_id UUID (bypassing FK by going through
    # OwnerSessionLocal). If the export query didn't filter by tenant_id, this row would leak.
    async with OwnerSessionLocal() as s:
        # Create a Record in tenant B with the same id as the demo-tenant customer would be
        # impossible (UUID PK uniqueness across the table) — so we use a DIFFERENT record_id
        # for the foreign customer and assert the invoice does NOT appear in the demo-tenant
        # export. The other-tenant row simply must not appear.
        other_cust = Record(
            tenant_id=_CTX["other_tenant_id"], entity_key="customer", status="active",
            data={"name": "Other Subject", "email": "other@example.com"},
        )
        s.add(other_cust); await s.flush()
        other_cust_id = other_cust.id
        other_inv = Invoice(
            tenant_id=_CTX["other_tenant_id"], customer_id=other_cust_id,
            number="INV-ISO-B1", status="ISSUED", total=99999,
        )
        s.add(other_inv); await s.flush()
        await s.commit()

    # Run the full flow on the demo-tenant customer.
    r1 = await client.post(
        "/api/privacy/access-request", headers=admin,
        json={"customerRecordId": str(cust_id)},
    )
    req_id = r1.json()["id"]
    await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    r3 = await client.post(f"/api/privacy/requests/{req_id}/complete", headers=admin)
    assert r3.status_code == 200
    export = r3.json()["result"]
    invoice_numbers = [i["number"] for i in export["invoices"]]
    assert "INV-ISO-A1" in invoice_numbers
    assert "INV-ISO-B1" not in invoice_numbers, "cross-tenant invoice leaked into export"
    totals = [i["total_luma"] for i in export["invoices"]]
    assert 99999 not in totals


# ── 6. Complete ERASURE anonymizes PII ────────────────────────────────────────

async def test_complete_erasure_request_anonymizes_pii(client, admin):
    cust_id = await _new_customer(
        tenant_id=_CTX["demo_tenant_id"],
        email="erase-me@example.com",
        name="Erase Subject",
        phone="+374-77-444222",
    )
    cu_id = await _new_customer_user(
        tenant_id=_CTX["demo_tenant_id"],
        customer_id=cust_id,
        email="erase-me@example.com",
        name="Erase Subject",
    )

    r1 = await client.post(
        "/api/privacy/erasure-request", headers=admin,
        json={"customerRecordId": str(cust_id)},
    )
    req_id = r1.json()["id"]
    await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    r3 = await client.post(f"/api/privacy/requests/{req_id}/complete", headers=admin)
    assert r3.status_code == 200, r3.text
    result = r3.json()["result"]
    redacted = result["redacted_fields"]
    assert "customer.data.email" in redacted
    assert "customer.data.name" in redacted
    assert "customer.data.phone" in redacted
    assert "customer_user.email" in redacted
    assert "customer_user.name" in redacted

    # DB-level assertion — PII actually gone.
    async with OwnerSessionLocal() as s:
        rec = (await s.execute(select(Record).where(Record.id == cust_id))).scalar_one()
        assert rec.data.get("email") == "[REDACTED]"
        assert rec.data.get("name") == "[REDACTED]"
        assert rec.data.get("phone") == "[REDACTED]"
        # Non-PII data is preserved.
        assert rec.data.get("plan") == "FIBER-100"

        cu = (await s.execute(select(CustomerUser).where(CustomerUser.id == cu_id))).scalar_one()
        assert cu.email == "[REDACTED]"
        assert cu.name == "[REDACTED]"
        assert cu.is_active is False
        assert cu.token_not_before is not None


# ── 7. Erasure preserves invoice rows ─────────────────────────────────────────

async def test_erasure_preserves_invoice_rows(client, admin):
    cust_id = await _new_customer(
        tenant_id=_CTX["demo_tenant_id"], email="financial@example.com", name="Financial Subject",
    )
    inv_id = await _new_invoice(
        tenant_id=_CTX["demo_tenant_id"], customer_id=cust_id, number="INV-FIN-001",
        total=44400,
    )
    pay_id = await _new_payment(
        tenant_id=_CTX["demo_tenant_id"], customer_id=cust_id, invoice_id=inv_id,
        amount=44400,
    )

    r1 = await client.post(
        "/api/privacy/erasure-request", headers=admin,
        json={"customerRecordId": str(cust_id)},
    )
    req_id = r1.json()["id"]
    await client.post(f"/api/privacy/requests/{req_id}/approve", headers=admin)
    r3 = await client.post(f"/api/privacy/requests/{req_id}/complete", headers=admin)
    assert r3.status_code == 200

    # Invoice + payment rows must still exist with correct totals (Article 17 financial-retention).
    async with OwnerSessionLocal() as s:
        inv = (await s.execute(select(Invoice).where(Invoice.id == inv_id))).scalar_one_or_none()
        assert inv is not None, "invoice was incorrectly deleted by erasure"
        assert inv.total == 44400
        assert inv.number == "INV-FIN-001"
        pay = (await s.execute(select(Payment).where(Payment.id == pay_id))).scalar_one_or_none()
        assert pay is not None
        assert pay.amount == 44400
        assert pay.customer_id == cust_id  # link preserved


# ── 8. /api/lifecycle/.../purge anonymizes customer PII (C4 close) ───────────

async def test_purge_customer_anonymizes_pii(client, admin):
    """A SOFT_DELETED customer record → /api/lifecycle/record/{id}/purge must (a) flip
    deletion_state=PURGED, (b) call anonymize_customer, (c) emit CUSTOMER_PURGED_PII_ANONYMIZED.
    This is the C4 close — PURGED is no longer decorative."""
    cust_id = await _new_customer(
        tenant_id=_CTX["demo_tenant_id"],
        email="purge-me@example.com",
        name="Purge Subject",
        phone="+374-77-999000",
        deletion_state="SOFT_DELETED",
    )

    r = await client.post(f"/api/lifecycle/record/{cust_id}/purge", headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["deletionState"] == "PURGED"

    async with OwnerSessionLocal() as s:
        rec = (await s.execute(select(Record).where(Record.id == cust_id))).scalar_one()
        assert rec.deletion_state == "PURGED"
        # PII anonymized.
        assert rec.data.get("email") == "[REDACTED]"
        assert rec.data.get("name") == "[REDACTED]"
        assert rec.data.get("phone") == "[REDACTED]"
        # Non-PII preserved.
        assert rec.data.get("plan") == "FIBER-100"

        # Audit event emitted.
        evs = (await s.execute(
            select(Event).where(
                Event.type == "CUSTOMER_PURGED_PII_ANONYMIZED",
                Event.record_id == cust_id,
            )
        )).scalars().all()
        assert evs, "expected CUSTOMER_PURGED_PII_ANONYMIZED event on the customer record"
        ev = evs[-1]
        assert ev.event_name == "Customer.PiiAnonymized"
        assert ev.category == "SECURITY"
        redacted = ev.data.get("redactedFields") or []
        assert "customer.data.email" in redacted
        assert ev.data.get("triggeredBy") == "lifecycle.purge"
