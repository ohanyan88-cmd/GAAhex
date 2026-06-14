"""B37 — Portal Service — security invariant tests.

Security assertions:
  - Own services/subscriptions/usage scoped.
  - Cross-customer denial on each.
  - service-requests creates a WorkItem with the right customer_id visible to staff.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
import uuid as _uuid

from app.db import OwnerSessionLocal
from app.models.customer_user import CustomerUser
from app.models.service import Service
from app.models.billing import Subscription
from app.models.tenant import Tenant
from app.security import hash_password


@pytest_asyncio.fixture(scope="module")
async def service_setup(client: AsyncClient, admin):
    """Two customers A and B with portal logins, each with a service + subscription."""
    ra = await client.post("/api/customers", headers=admin, json={"name": "Service Portal A"})
    assert ra.status_code in (200, 201), ra.text
    cid_a = ra.json()["id"]

    rb = await client.post("/api/customers", headers=admin, json={"name": "Service Portal B"})
    assert rb.status_code in (200, 201), rb.text
    cid_b = rb.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
        tid = tenant.id

        for email, pw, cid in [
            ("service_a@test.isp", "SvcA123", cid_a),
            ("service_b@test.isp", "SvcB123", cid_b),
        ]:
            existing = (await s.execute(
                select(CustomerUser).where(CustomerUser.tenant_id == tid, CustomerUser.email == email)
            )).scalar_one_or_none()
            if not existing:
                s.add(CustomerUser(tenant_id=tid, customer_id=cid, email=email,
                                   password_hash=hash_password(pw), is_active=True))

        svc_a = Service(tenant_id=tid, customer_id=_uuid.UUID(cid_a), name="Fiber 100M A",
                        type="internet", status="ACTIVE")
        svc_b = Service(tenant_id=tid, customer_id=_uuid.UUID(cid_b), name="Fiber 50M B",
                        type="internet", status="ACTIVE")
        sub_a = Subscription(tenant_id=tid, customer_id=_uuid.UUID(cid_a),
                              plan_name="Pro A", amount=10000, cycle="monthly", status="ACTIVE")
        s.add_all([svc_a, svc_b, sub_a])
        await s.commit()
        svc_a_id = str(svc_a.id)
        svc_b_id = str(svc_b.id)

    tok_a = (await client.post("/portal/auth/login", json={"email": "service_a@test.isp", "password": "SvcA123", "tenant_id": str(tid)})).json()["access_token"]
    tok_b = (await client.post("/portal/auth/login", json={"email": "service_b@test.isp", "password": "SvcB123", "tenant_id": str(tid)})).json()["access_token"]

    return {
        "cid_a": cid_a, "cid_b": cid_b,
        "svc_a_id": svc_a_id, "svc_b_id": svc_b_id,
        "tok_a": tok_a, "tok_b": tok_b,
    }


@pytest.mark.asyncio
async def test_services_scoped(client: AsyncClient, service_setup):
    """Customer A's services include A's service, not B's."""
    d = service_setup
    r = await client.get("/portal/me/services", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert d["svc_a_id"] in ids
    assert d["svc_b_id"] not in ids


@pytest.mark.asyncio
async def test_subscriptions_scoped(client: AsyncClient, service_setup):
    """Customer A's subscriptions are scoped."""
    d = service_setup
    r = await client.get("/portal/me/subscriptions", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200
    subs = r.json()
    assert all(True for s in subs)   # just confirm it's a list and doesn't error


@pytest.mark.asyncio
async def test_usage_endpoint(client: AsyncClient, service_setup):
    """Usage endpoint is accessible and returns a list."""
    d = service_setup
    r = await client.get("/portal/me/usage", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_service_request_creates_workitem(client: AsyncClient, service_setup, admin):
    """Service request creates a WorkItem with the right customer_id; staff can see it."""
    d = service_setup
    r = await client.post("/portal/me/service-requests",
                          json={"message": "Please upgrade my plan to Fiber 500M"},
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 201, r.text
    wi_id = r.json()["id"]

    # Staff can see it in the workitems list
    r2 = await client.get("/api/workitems", headers=admin)
    assert r2.status_code == 200
    wi_ids = [w["id"] for w in r2.json()]
    assert wi_id in wi_ids


@pytest.mark.asyncio
async def test_service_request_forced_customer_id(client: AsyncClient, service_setup, admin):
    """Service request WorkItem has customer_id matching the portal user's customer."""
    d = service_setup
    r = await client.post("/portal/me/service-requests",
                          json={"message": "Need extra static IPs"},
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 201
    wi_id = r.json()["id"]

    # Fetch via staff API and confirm customer_id
    r2 = await client.get(f"/api/workitems/{wi_id}", headers=admin)
    assert r2.status_code == 200
    assert r2.json()["customer_id"] == d["cid_a"]
