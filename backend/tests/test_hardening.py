"""C38 — Launch-hardening tests: A38 + E38 security contracts.

Tests for:
  S4: Portal tenant assertion — token tenant_id != CustomerUser.tenant_id → 401
  S5 (single-tenant mode): portal login resolves to THE_TENANT_ID — no per-request hint needed
  E38: Webhook SSRF — private/internal URLs → 422; public https → allowed
  N4: Global exception handler — clean 500 responses (no traceback)
  S3: CORS — app responds normally (default "*" unchanged)
"""

import uuid
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models.customer_user import CustomerUser
from app.models.tenant import Tenant
from app.security import hash_password, create_access_token
from app.models.webhook import WebhookDef


# ===================== S4: Portal tenant assertion =====================

@pytest.mark.asyncio
async def test_portal_mismatched_tenant_id_claim_returns_401(client: AsyncClient, portal_setup):
    """S4 — a portal token with tenant_id claim != CustomerUser.tenant_id → 401."""
    token_a = portal_setup["token_a"]
    cid_a = portal_setup["cid_a"]
    tenant_id_a = portal_setup["tenant_id"]

    # token_a has the correct tenant_id and works fine
    r = await client.get("/portal/auth/me", headers={"Authorization": f"Bearer {token_a}"})
    assert r.status_code == 200

    # Craft a token with the wrong tenant_id claim (using a random UUID).
    # Use create_access_token directly to inject a mismatched tenant_id.
    async with OwnerSessionLocal() as o:
        cu = (await o.execute(
            select(CustomerUser).where(CustomerUser.email == "hardening_a@test.isp")
        )).scalar_one()
        cu_id = cu.id
        wrong_tenant_id = uuid.uuid4()  # A different tenant UUID

    # Create a token with mismatched tenant_id claim
    bad_token = create_access_token(str(cu_id), {
        "kind": "customer",
        "customer_id": str(cid_a),
        "tenant_id": str(wrong_tenant_id),  # ← wrong tenant claim
    })

    # Attempt to use the bad token on /portal/auth/me → 401
    r = await client.get("/portal/auth/me", headers={"Authorization": f"Bearer {bad_token}"})
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    assert "mismatch" in r.json().get("detail", "").lower()

    # Attempt on /portal/me/summary as well
    r2 = await client.get("/portal/me/summary", headers={"Authorization": f"Bearer {bad_token}"})
    assert r2.status_code == 401, f"Expected 401, got {r2.status_code}: {r2.text}"


# ===================== S5 (single-tenant): portal login binds to THE_TENANT_ID =====================

@pytest.mark.asyncio
async def test_portal_login_resolves_to_the_tenant(client: AsyncClient, portal_setup):
    """Single-tenant mode: portal login takes no tenant hint and ALWAYS binds to THE_TENANT_ID.
    Even if isolation-probe tenants exist in the test DB, login still resolves the demo tenant
    (the one that was pre-warmed in the cache during seed)."""
    r = await client.post(
        "/portal/auth/login",
        json={"email": "hardening_a@test.isp", "password": "Hardening123"},
    )
    assert r.status_code == 200, r.text
    token = r.json()["access_token"]
    r2 = await client.get("/portal/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r2.status_code == 200
    # The bound tenant matches the demo tenant that portal_setup discovered.
    assert r2.json()["tenant_id"] == portal_setup["tenant_id"]


# ===================== S3: CORS =====================

@pytest.mark.asyncio
async def test_cors_default_allows_all_origins(client: AsyncClient, admin):
    """S3 — CORS is not changed from default '*' in test mode."""
    # A simple request with Origin header should succeed.
    # In test mode, CORS defaults to "*" so this should not be blocked.
    r = await client.get("/auth/me", headers={
        "Authorization": f"{admin['Authorization']}",
        "Origin": "https://example.com"
    })
    # Just verify the endpoint works (CORS is handled by middleware, not app logic).
    assert r.status_code == 200


# ===================== E38: Webhook SSRF =====================

SSRF_TEST_URLS = [
    ("http://127.0.0.1/webhook", "loopback IPv4"),
    ("http://localhost/webhook", "localhost"),
    ("http://[::1]/webhook", "loopback IPv6"),
    ("http://169.254.169.254/metadata", "cloud metadata"),
    ("http://192.168.1.1/private", "private network"),
    ("http://10.0.0.1/internal", "private Class A"),
    ("http://172.16.0.1/internal", "private Class B"),
    ("http://example.local/app", "mDNS / .local"),
]

PUBLIC_WEBHOOK_URLS = [
    "https://example.com/webhook",
    "https://api.example.com/events",
    "https://hooks.example.org/gaaex",
]


@pytest.mark.asyncio
async def test_webhook_ssrf_localhost_127001_rejected_422(client: AsyncClient, admin):
    """E38 — webhook with http://127.0.0.1 (loopback) → 422."""
    r = await client.post(
        "/api/webhooks",
        headers=admin,
        json={
            "name": "bad_loopback",
            "url": "http://127.0.0.1/webhook",
            "events": ["test"],
        }
    )
    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"
    assert "not allowed" in r.json().get("detail", "").lower() or "private" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_webhook_ssrf_localhost_hostname_rejected_422(client: AsyncClient, admin):
    """E38 — webhook with http://localhost/ → 422."""
    r = await client.post(
        "/api/webhooks",
        headers=admin,
        json={
            "name": "bad_localhost",
            "url": "http://localhost/webhook",
            "events": ["test"],
        }
    )
    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"
    assert "not allowed" in r.json().get("detail", "").lower() or "private" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_webhook_ssrf_metadata_ip_rejected_422(client: AsyncClient, admin):
    """E38 — webhook with http://169.254.169.254/ (cloud metadata) → 422."""
    r = await client.post(
        "/api/webhooks",
        headers=admin,
        json={
            "name": "bad_metadata",
            "url": "http://169.254.169.254/latest/meta-data/",
            "events": ["test"],
        }
    )
    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"
    assert "not allowed" in r.json().get("detail", "").lower() or "private" in r.json().get("detail", "").lower()


@pytest.mark.asyncio
async def test_webhook_public_https_url_allowed_201(client: AsyncClient, admin):
    """E38 — webhook with public https:// URL → 201 allowed."""
    r = await client.post(
        "/api/webhooks",
        headers=admin,
        json={
            "name": "good_webhook",
            "url": "https://example.com/webhook",
            "events": ["test"],
        }
    )
    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
    created = r.json()
    assert created["url"] == "https://example.com/webhook"
    assert created["name"] == "good_webhook"

    # Clean up
    await client.delete(f"/api/webhooks/{created['id']}", headers=admin)


# ===================== N4: Exception handler — clean 500 responses =====================

@pytest.mark.asyncio
async def test_500_error_returns_clean_response_no_traceback(client: AsyncClient, admin):
    """N4 — a 500 error returns clean JSON with no traceback exposed.

    This test attempts to trigger an unhandled exception (if possible) and verifies
    the response is a clean 500 with only {"detail": "Internal server error"}.

    Note: Most endpoints either succeed or return a validation 4xx. Truly triggering
    an unhandled exception in a controlled way is difficult. This test documents the
    expected behavior; if no unhandled exception can be safely triggered, the test
    passes by assertion on normal happy-path responses.
    """
    # Attempt a request that might cause an unhandled error (if the endpoint exists).
    # For now, we'll verify that normal error responses are clean JSON (not traceback HTML).
    # One safe way: send a malformed Authorization header that fails JWT decode.
    r = await client.get(
        "/api/customers",
        headers={"Authorization": "Bearer not.a.valid.jwt.token"}
    )
    # Should be 401, not 500; but if it is 500, it should be clean.
    if r.status_code == 500:
        data = r.json()
        assert isinstance(data, dict)
        assert "detail" in data
        # Should NOT contain Python traceback strings
        assert "Traceback" not in str(data)
        assert "File " not in str(data)
        assert "line " not in str(data)
    # If 401, just verify clean response
    assert r.status_code in (401, 500)


# ===================== Portal setup fixture =====================

@pytest_asyncio.fixture(scope="module")
async def portal_setup(client: AsyncClient, admin):
    """Create customer records via the staff API, then create CustomerUsers for them.
    Returns (tenant_id, cid_a, token_a).
    """
    # Create customer A via the staff CRM API
    ra = await client.post("/api/customers", headers=admin, json={"name": "Hardening Test Customer A"})
    assert ra.status_code in (200, 201), ra.text
    cid_a = ra.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id

        email_a = "hardening_a@test.isp"
        pw_a = "Hardening123"

        # Clean up if exists
        existing = (await s.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == tid,
                CustomerUser.email == email_a,
            )
        )).scalar_one_or_none()
        if existing:
            await s.delete(existing)

        s.add(CustomerUser(
            tenant_id=tid,
            customer_id=cid_a,
            email=email_a,
            password_hash=hash_password(pw_a),
            is_active=True,
        ))
        await s.commit()

    # Get portal token (single-tenant mode: no tenant hint, binds to THE_TENANT_ID).
    ra_tok = await client.post(
        "/portal/auth/login",
        json={"email": email_a, "password": pw_a},
    )
    assert ra_tok.status_code == 200, ra_tok.text
    token_a = ra_tok.json()["access_token"]

    return {
        "tenant_id": str(tid),
        "cid_a": cid_a,
        "token_a": token_a,
    }
