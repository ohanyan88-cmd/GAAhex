"""B34 — Customer Portal Foundation — security invariant tests.

Invariants tested:
  1. Portal login works; /portal/auth/me returns the right customer.
  2. Cross-customer denial: customer A cannot see customer B's summary.
  3. Token boundary both ways:
     a. Portal token on a staff endpoint → 401.
     b. Staff token on a portal endpoint → 401.
  4. Staff provisioning: POST /api/customers/{id}/portal-users creates a working login.
  5. Inactive CustomerUser cannot log in.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.db import OwnerSessionLocal
from app.models.customer_user import CustomerUser
from app.models.tenant import Tenant
from app.security import hash_password
from sqlalchemy import select


# ── module-scoped setup: create two customers + portal users ─────────────────

@pytest_asyncio.fixture(scope="module")
async def portal_setup(client: AsyncClient, admin):
    """Create two customer Records via the staff API, then create CustomerUsers for them.
    Returns (tenant_id, cid_a, cid_b, token_a, token_b).
    """
    # Create customer A and B via the staff CRM API
    ra = await client.post("/api/customers", headers=admin, json={"name": "Portal Customer A"})
    assert ra.status_code in (200, 201), ra.text
    cid_a = ra.json()["id"]

    rb = await client.post("/api/customers", headers=admin, json={"name": "Portal Customer B"})
    assert rb.status_code in (200, 201), rb.text
    cid_b = rb.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id

        for email, pw, cid in [
            ("portal_a@test.isp", "PortalA123", cid_a),
            ("portal_b@test.isp", "PortalB123", cid_b),
        ]:
            existing = (await s.execute(
                select(CustomerUser).where(
                    CustomerUser.tenant_id == tid,
                    CustomerUser.email == email,
                )
            )).scalar_one_or_none()
            if not existing:
                s.add(CustomerUser(
                    tenant_id=tid,
                    customer_id=cid,
                    email=email,
                    password_hash=hash_password(pw),
                    is_active=True,
                ))
        await s.commit()

    # Get portal tokens
    ra_tok = await client.post("/portal/auth/login", json={"email": "portal_a@test.isp", "password": "PortalA123"})
    assert ra_tok.status_code == 200, ra_tok.text
    token_a = ra_tok.json()["access_token"]

    rb_tok = await client.post("/portal/auth/login", json={"email": "portal_b@test.isp", "password": "PortalB123"})
    assert rb_tok.status_code == 200, rb_tok.text
    token_b = rb_tok.json()["access_token"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()

    return {"tenant_id": str(tid), "cid_a": cid_a, "cid_b": cid_b, "token_a": token_a, "token_b": token_b}


# ── invariant 1: login + /portal/auth/me ─────────────────────────────────────

@pytest.mark.asyncio
async def test_portal_login_ok(client: AsyncClient, portal_setup):
    r = await client.post("/portal/auth/login", json={"email": "portal_a@test.isp", "password": "PortalA123"})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["customer"]["email"] == "portal_a@test.isp"


@pytest.mark.asyncio
async def test_portal_login_wrong_password(client: AsyncClient, portal_setup):
    r = await client.post("/portal/auth/login", json={"email": "portal_a@test.isp", "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_portal_me_returns_right_customer(client: AsyncClient, portal_setup):
    token_a = portal_setup["token_a"]
    cid_a = portal_setup["cid_a"]
    r = await client.get("/portal/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "portal_a@test.isp"
    assert data["customer_id"] == cid_a


@pytest.mark.asyncio
async def test_portal_summary_ok(client: AsyncClient, portal_setup):
    r = await client.get("/portal/me/summary", headers={"Authorization": f"Bearer {portal_setup['token_a']}"})
    assert r.status_code == 200
    data = r.json()
    assert "customer" in data
    assert "open_invoices_count" in data
    assert "balance_due_luma" in data
    assert "open_tickets_count" in data
    assert "active_services_count" in data
    assert data["customer"]["id"] == portal_setup["cid_a"]


# ── invariant 2: cross-customer denial ───────────────────────────────────────

@pytest.mark.asyncio
async def test_cross_customer_summary_scoped(client: AsyncClient, portal_setup):
    """Each portal user's /me/summary returns only their own customer_id."""
    token_a, token_b = portal_setup["token_a"], portal_setup["token_b"]
    cid_a, cid_b = portal_setup["cid_a"], portal_setup["cid_b"]

    r_a = await client.get("/portal/me/summary", headers={"Authorization": f"Bearer {token_a}"})
    assert r_a.status_code == 200
    assert r_a.json()["customer"]["id"] == cid_a

    r_b = await client.get("/portal/me/summary", headers={"Authorization": f"Bearer {token_b}"})
    assert r_b.status_code == 200
    assert r_b.json()["customer"]["id"] == cid_b

    # A cannot see B's customer_id in their summary
    assert r_a.json()["customer"]["id"] != r_b.json()["customer"]["id"]


# ── invariant 3a: portal token rejected on staff endpoints ───────────────────

@pytest.mark.asyncio
async def test_portal_token_rejected_on_staff_records(client: AsyncClient, portal_setup):
    """Portal token must NOT authenticate staff /api/* endpoints."""
    token_a = portal_setup["token_a"]
    r = await client.get("/api/customers", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"


@pytest.mark.asyncio
async def test_portal_token_rejected_on_staff_auth_me(client: AsyncClient, portal_setup):
    """Staff /auth/me must reject a portal token."""
    token_a = portal_setup["token_a"]
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 401


# ── invariant 3b: staff token rejected on portal endpoints ───────────────────

@pytest.mark.asyncio
async def test_staff_token_rejected_on_portal_summary(client: AsyncClient, admin):
    """Staff token must NOT work on /portal/me/summary."""
    r = await client.get("/portal/me/summary", headers=admin)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_staff_token_rejected_on_portal_me(client: AsyncClient, admin):
    """Staff token must NOT work on /portal/auth/me."""
    r = await client.get("/portal/auth/me", headers=admin)
    assert r.status_code == 401


# ── invariant 4: staff provisioning ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_staff_provision_portal_user(client: AsyncClient, admin, portal_setup):
    """Staff can create a portal user for a customer; the new login must work."""
    cid_a = portal_setup["cid_a"]
    email = "provisioned_b34@test.isp"

    # Clean up any previous run
    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        existing = (await s.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == tenant.id,
                CustomerUser.email == email,
            )
        )).scalar_one_or_none()
        if existing:
            await s.delete(existing)
            await s.commit()

    r = await client.post(
        f"/api/customers/{cid_a}/portal-users",
        json={"email": email, "password": "Prov1234", "name": "Provisioned User"},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    assert r.json()["email"] == email

    # New login must work
    r2 = await client.post("/portal/auth/login", json={"email": email, "password": "Prov1234"})
    assert r2.status_code == 200


# ── invariant 5: inactive user cannot log in ─────────────────────────────────

@pytest.mark.asyncio
async def test_inactive_user_cannot_login(client: AsyncClient, portal_setup):
    tenant_id = portal_setup["tenant_id"]
    cid_a = portal_setup["cid_a"]
    email = "inactive_b34@test.isp"

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        cu = (await s.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == tenant.id,
                CustomerUser.email == email,
            )
        )).scalar_one_or_none()
        if not cu:
            cu = CustomerUser(
                tenant_id=tenant.id,
                customer_id=cid_a,
                email=email,
                password_hash=hash_password("Inact1234"),
                is_active=False,
            )
            s.add(cu)
            await s.commit()
        else:
            cu.is_active = False
            await s.commit()

    r = await client.post("/portal/auth/login", json={"email": email, "password": "Inact1234"})
    assert r.status_code == 403
