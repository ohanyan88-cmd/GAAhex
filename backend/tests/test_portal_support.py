"""B36 — Portal Support — security invariant tests.

Security assertions:
  - Create ticket → forced customer_id, appears in own list.
  - Cannot see another customer's ticket (404).
  - Reply on own ticket works.
  - Customer CANNOT call staff helpdesk actions (portal token → 401/403).
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.customer_user import CustomerUser
from app.models.tenant import Tenant
from app.security import hash_password


@pytest_asyncio.fixture(scope="module")
async def support_setup(client: AsyncClient, admin):
    """Two customers A and B with portal logins."""
    ra = await client.post("/api/customers", headers=admin, json={"name": "Support Portal A"})
    assert ra.status_code in (200, 201), ra.text
    cid_a = ra.json()["id"]

    rb = await client.post("/api/customers", headers=admin, json={"name": "Support Portal B"})
    assert rb.status_code in (200, 201), rb.text
    cid_b = rb.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id
        for email, pw, cid in [
            ("support_a@test.isp", "SuppA123", cid_a),
            ("support_b@test.isp", "SuppB123", cid_b),
        ]:
            existing = (await s.execute(
                select(CustomerUser).where(CustomerUser.tenant_id == tid, CustomerUser.email == email)
            )).scalar_one_or_none()
            if not existing:
                s.add(CustomerUser(tenant_id=tid, customer_id=cid, email=email,
                                   password_hash=hash_password(pw), is_active=True))
        await s.commit()

    tok_a = (await client.post("/portal/auth/login", json={"email": "support_a@test.isp", "password": "SuppA123"})).json()["access_token"]
    tok_b = (await client.post("/portal/auth/login", json={"email": "support_b@test.isp", "password": "SuppB123"})).json()["access_token"]

    return {"cid_a": cid_a, "cid_b": cid_b, "tok_a": tok_a, "tok_b": tok_b}


@pytest.mark.asyncio
async def test_create_ticket_forced_customer_id(client: AsyncClient, support_setup):
    """Creating a ticket forces customer_id to the logged-in customer."""
    d = support_setup
    r = await client.post("/portal/me/tickets",
                          json={"subject": "My internet is slow", "body": "Very slow today."},
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 201, r.text
    ticket = r.json()
    assert ticket["subject"] == "My internet is slow"
    assert ticket["status"] == "OPEN"

    # Appears in A's ticket list
    list_r = await client.get("/portal/me/tickets", headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert list_r.status_code == 200
    ids = [t["id"] for t in list_r.json()]
    assert ticket["id"] in ids


@pytest.mark.asyncio
async def test_cross_customer_ticket_denied(client: AsyncClient, support_setup):
    """Customer A cannot see customer B's ticket."""
    d = support_setup
    # B creates a ticket
    r_b = await client.post("/portal/me/tickets",
                             json={"subject": "B's private issue"},
                             headers={"Authorization": f"Bearer {d['tok_b']}"})
    assert r_b.status_code == 201
    ticket_b_id = r_b.json()["id"]

    # A tries to access B's ticket → 404
    r = await client.get(f"/portal/me/tickets/{ticket_b_id}",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_reply_own_ticket(client: AsyncClient, support_setup):
    """Customer can reply to their own ticket."""
    d = support_setup
    r = await client.post("/portal/me/tickets",
                          json={"subject": "Need upgrade"},
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code == 201
    tid = r.json()["id"]

    r2 = await client.post(f"/portal/me/tickets/{tid}/reply",
                           json={"body": "Still waiting for a response."},
                           headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r2.status_code == 201, r2.text
    assert r2.json()["direction"] == "inbound"

    # Reply appears in detail
    detail = await client.get(f"/portal/me/tickets/{tid}",
                               headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert detail.status_code == 200
    assert len(detail.json()["replies"]) >= 1


@pytest.mark.asyncio
async def test_portal_token_rejected_on_staff_helpdesk(client: AsyncClient, support_setup):
    """Portal token must not access staff helpdesk endpoints."""
    d = support_setup
    r = await client.get("/api/helpdesk/queues",
                         headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_portal_token_rejected_on_staff_resolve(client: AsyncClient, support_setup):
    """Portal token cannot resolve a ticket via the staff resolve endpoint."""
    d = support_setup
    # Try an arbitrary ticket UUID on the staff resolve endpoint
    import uuid
    fake_id = str(uuid.uuid4())
    r = await client.post(f"/api/helpdesk/tickets/{fake_id}/resolve",
                          headers={"Authorization": f"Bearer {d['tok_a']}"})
    assert r.status_code in (401, 403, 404)
