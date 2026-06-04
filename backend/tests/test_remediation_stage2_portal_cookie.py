"""Stage 2 remediation — S4 Portal HttpOnly cookie safe default.

The audit flagged: portal JWTs are returned in a JSON body, where any XSS in the SPA could
read them from JS-accessible storage. Stage 2 close:

  * New `portal_auth_mode` env var with values {"header", "cookie", "both"}.
    Dev default: "header" (backward compat for every existing test/fixture/SPA).
    Production contract: refuses to boot when ENVIRONMENT=production + mode=header.

  * In cookie / both mode: `/portal/auth/login` sets an HttpOnly cookie
    (`gaahex_portal_session`) and returns a derived CSRF token in the JSON body.

  * In cookie / both mode: mutating verbs (POST/PUT/PATCH/DELETE) under /portal MUST carry
    an `X-CSRF-Token` header whose value matches the SHA-256 of the cookie value
    (double-submit cookie pattern).

  * `/portal/auth/logout` clears the cookie + bumps `customer_user.token_not_before`
    (the Stage 1 column write that revokes every outstanding JWT).

  * Production contract refuses boot in header-only mode.
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select

from app.config import settings
from app.db import OwnerSessionLocal
from app.models.customer_user import CustomerUser
from app.models.tenant import Tenant
from app.security import hash_password
from app.routers.portal_auth import PORTAL_COOKIE_NAME, _csrf_token_for


# ── module-scoped portal customer for the cookie tests ─────────────────────────

@pytest_asyncio.fixture(scope="module")
async def cookie_user(client: AsyncClient, admin):
    """One customer + CustomerUser dedicated to the Stage-2 cookie tests.

    Distinct email from test_portal.py so the two suites can run in any order without the
    CustomerUser unique-on-(tenant_id, email) constraint colliding.
    """
    r = await client.post("/api/customers", headers=admin, json={"name": "Stage2 Cookie Cust"})
    assert r.status_code in (200, 201), r.text
    cid = r.json()["id"]

    async with OwnerSessionLocal() as s:
        tenant = (await s.execute(select(Tenant))).scalars().first()
        tid = tenant.id
        existing = (await s.execute(
            select(CustomerUser).where(
                CustomerUser.tenant_id == tid,
                CustomerUser.email == "stage2_cookie@test.isp",
            )
        )).scalar_one_or_none()
        if not existing:
            s.add(CustomerUser(
                tenant_id=tid, customer_id=cid,
                email="stage2_cookie@test.isp",
                password_hash=hash_password("Stage2Cookie!"),
                is_active=True,
            ))
            await s.commit()

    return {"email": "stage2_cookie@test.isp", "password": "Stage2Cookie!",
            "tenant_id": str(tid), "customer_id": cid}


def _restore_mode(original_mode: str):
    """Restore `settings.portal_auth_mode` to its pre-test value. Called from every test
    that flips the mode, so cross-test pollution is impossible."""
    settings.portal_auth_mode = original_mode


# ════════════════════════════════════════════════════════════════════════════
# 1. Cookie mode: login sets HttpOnly cookie, body still carries customer + CSRF token.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_portal_login_sets_httponly_cookie_in_cookie_mode(client: AsyncClient, cookie_user):
    """In cookie mode the response must set `gaahex_portal_session` HttpOnly and the
    JSON body must carry a `csrf_token` the SPA can echo back on mutating verbs."""
    original_mode = settings.portal_auth_mode
    settings.portal_auth_mode = "cookie"
    try:
        r = await client.post(
            "/portal/auth/login",
            json={"email": cookie_user["email"], "password": cookie_user["password"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()

        # Cookie present + HttpOnly flag visible in the Set-Cookie header.
        cookie_value = r.cookies.get(PORTAL_COOKIE_NAME)
        assert cookie_value, f"Expected {PORTAL_COOKIE_NAME} cookie; got cookies: {dict(r.cookies)}"
        set_cookie_headers = [
            v for k, v in r.headers.items() if k.lower() == "set-cookie"
        ]
        joined = "\n".join(set_cookie_headers)
        assert "HttpOnly" in joined, f"Expected HttpOnly flag in Set-Cookie; got: {joined!r}"
        assert "Path=/portal" in joined, f"Expected Path=/portal in Set-Cookie; got: {joined!r}"

        # JSON body: csrf_token present, access_token suppressed in pure cookie mode.
        assert body["csrf_token"] == _csrf_token_for(cookie_value)
        assert body["access_token"] == ""
    finally:
        _restore_mode(original_mode)


# ════════════════════════════════════════════════════════════════════════════
# 2. Header mode (default): JSON body carries the JWT, no cookie set.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_portal_login_returns_token_in_header_mode_only(client: AsyncClient, cookie_user):
    """The legacy header mode (dev default) keeps the existing shape: access_token in the
    JSON body, NO cookie set, NO csrf_token. Tests + SPAs that depend on this shape stay
    unaffected when portal_auth_mode defaults to 'header'."""
    original_mode = settings.portal_auth_mode
    settings.portal_auth_mode = "header"
    try:
        r = await client.post(
            "/portal/auth/login",
            json={"email": cookie_user["email"], "password": cookie_user["password"]},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["access_token"], "Expected JWT in access_token field in header mode"
        assert body.get("csrf_token") is None
        # No portal session cookie should be set in header mode.
        assert r.cookies.get(PORTAL_COOKIE_NAME) is None
    finally:
        _restore_mode(original_mode)


# ════════════════════════════════════════════════════════════════════════════
# 3. Logout clears the cookie via Set-Cookie max-age=0 (browser-side drop).
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_portal_logout_clears_cookie(client: AsyncClient, cookie_user):
    """`/portal/auth/logout` in cookie mode must emit a Set-Cookie deletion (max-age=0 / expires
    in the past) so the browser drops its copy immediately. The Stage-1 token_not_before bump
    still runs in parallel for defense in depth."""
    original_mode = settings.portal_auth_mode
    settings.portal_auth_mode = "cookie"
    try:
        # Login first to get the cookie + CSRF token.
        login = await client.post(
            "/portal/auth/login",
            json={"email": cookie_user["email"], "password": cookie_user["password"]},
        )
        assert login.status_code == 200, login.text
        csrf_token = login.json()["csrf_token"]
        cookie_value = login.cookies.get(PORTAL_COOKIE_NAME)
        assert cookie_value

        # Logout — POST is a mutating verb so CSRF token is required.
        logout = await client.post(
            "/portal/auth/logout",
            headers={"X-CSRF-Token": csrf_token},
            cookies={PORTAL_COOKIE_NAME: cookie_value},
        )
        assert logout.status_code == 200, logout.text

        # The logout response must include a Set-Cookie deletion for the portal session.
        set_cookie_headers = [
            v for k, v in logout.headers.items() if k.lower() == "set-cookie"
        ]
        joined = "\n".join(set_cookie_headers)
        assert PORTAL_COOKIE_NAME in joined, (
            f"Expected delete-cookie Set-Cookie for {PORTAL_COOKIE_NAME}; got: {joined!r}"
        )
        # FastAPI emits Max-Age=0 (or expires=Thu, 01 Jan 1970) on delete_cookie. Accept either.
        assert ("Max-Age=0" in joined) or ("expires=Thu, 01 Jan 1970" in joined.lower().replace(
            "expires=thu, 01 jan 1970", "expires=Thu, 01 Jan 1970"
        )) or ("01 jan 1970" in joined.lower()), (
            f"Expected cookie-deletion directive in Set-Cookie; got: {joined!r}"
        )
    finally:
        _restore_mode(original_mode)


# ════════════════════════════════════════════════════════════════════════════
# 4. CSRF token required on mutating verbs in cookie mode.
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_portal_csrf_required_in_cookie_mode(client: AsyncClient, cookie_user):
    """In cookie mode a mutating verb without the X-CSRF-Token header is rejected with 403.
    Sending the correct token in the header succeeds (when paired with the cookie)."""
    original_mode = settings.portal_auth_mode
    settings.portal_auth_mode = "cookie"
    try:
        login = await client.post(
            "/portal/auth/login",
            json={"email": cookie_user["email"], "password": cookie_user["password"]},
        )
        assert login.status_code == 200, login.text
        csrf_token = login.json()["csrf_token"]
        cookie_value = login.cookies.get(PORTAL_COOKIE_NAME)

        # 4a. Mutating verb WITHOUT CSRF → 403.
        no_csrf = await client.post(
            "/portal/auth/logout",
            cookies={PORTAL_COOKIE_NAME: cookie_value},
        )
        assert no_csrf.status_code == 403, no_csrf.text
        assert "csrf" in no_csrf.text.lower()

        # 4b. Mutating verb WITH a wrong CSRF token → 403.
        wrong_csrf = await client.post(
            "/portal/auth/logout",
            headers={"X-CSRF-Token": "wrong-token"},
            cookies={PORTAL_COOKIE_NAME: cookie_value},
        )
        assert wrong_csrf.status_code == 403, wrong_csrf.text

        # 4c. Mutating verb WITH the correct CSRF token → 200.
        # Re-login because the previous logout (had it succeeded) would have invalidated
        # the cookie. With 403 it didn't, but defensively get a fresh session anyway.
        relogin = await client.post(
            "/portal/auth/login",
            json={"email": cookie_user["email"], "password": cookie_user["password"]},
        )
        assert relogin.status_code == 200
        csrf_token2 = relogin.json()["csrf_token"]
        cookie_value2 = relogin.cookies.get(PORTAL_COOKIE_NAME)
        ok = await client.post(
            "/portal/auth/logout",
            headers={"X-CSRF-Token": csrf_token2},
            cookies={PORTAL_COOKIE_NAME: cookie_value2},
        )
        assert ok.status_code == 200, ok.text
    finally:
        _restore_mode(original_mode)


# ════════════════════════════════════════════════════════════════════════════
# 5. Production contract refuses to boot when portal_auth_mode == "header".
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_prod_contract_refuses_header_only_portal_auth_in_production():
    """`_assert_production_deploy_contract` must raise RuntimeError when ENVIRONMENT=production
    AND PORTAL_AUTH_MODE=header. Dev / test / staging always pass (they short-circuit at the
    `environment != production` guard at the top of the function)."""
    from app.config import _assert_production_deploy_contract

    # Tests rarely touch ENVIRONMENT; we mutate `settings` directly + restore on cleanup.
    original_env = settings.environment
    original_mode = settings.portal_auth_mode
    original_cors = settings.cors_origins
    original_db = settings.database_url
    original_owner = settings.owner_database_url
    original_payment = settings.payment_gateway_provider
    original_email = settings.email_gateway_provider
    original_sms = settings.sms_gateway_provider
    original_radius = settings.radius_backend_provider

    try:
        # Drive every other production gate to "satisfied" so the only outstanding violation is
        # the portal_auth_mode = header check we're asserting. Otherwise an earlier raise (e.g.
        # CORS wildcard) would shadow the one we care about.
        settings.environment = "production"
        settings.database_url = "postgresql+asyncpg://prod_app:x@h:5432/db"
        settings.owner_database_url = "postgresql+asyncpg://prod_owner:x@h:5432/db"
        settings.cors_origins = "https://app.example.com"
        settings.payment_gateway_provider = "stripe"
        settings.email_gateway_provider = "sendgrid"
        settings.sms_gateway_provider = "twilio"
        settings.radius_backend_provider = "freeradius"
        settings.portal_auth_mode = "header"

        # The radius / OLT / import / warehouse feature gates default to False so they won't
        # fire. Calling assert raises the portal-mode violation.
        with pytest.raises(RuntimeError, match=r"PORTAL_AUTH_MODE=header forbidden"):
            _assert_production_deploy_contract()

        # Confirm 'cookie' mode passes.
        settings.portal_auth_mode = "cookie"
        # We don't actually want to assert success against real RADIUS / freeradius config —
        # the OLT / RADIUS gates require the import to construct. Drop FEATURE_RADIUS_REQUIRED
        # (defaults to False so already off) and confirm the contract no longer raises on the
        # PORTAL_AUTH_MODE axis specifically.
        try:
            _assert_production_deploy_contract()
        except RuntimeError as e:
            # If anything else still fails it must NOT be the portal_auth_mode check.
            assert "PORTAL_AUTH_MODE" not in str(e), (
                f"Cookie mode should pass the portal-auth check; got: {e}"
            )

        # Also confirm 'both' is acceptable.
        settings.portal_auth_mode = "both"
        try:
            _assert_production_deploy_contract()
        except RuntimeError as e:
            assert "PORTAL_AUTH_MODE" not in str(e), (
                f"'both' mode should pass the portal-auth check; got: {e}"
            )
    finally:
        settings.environment = original_env
        settings.portal_auth_mode = original_mode
        settings.cors_origins = original_cors
        settings.database_url = original_db
        settings.owner_database_url = original_owner
        settings.payment_gateway_provider = original_payment
        settings.email_gateway_provider = original_email
        settings.sms_gateway_provider = original_sms
        settings.radius_backend_provider = original_radius
