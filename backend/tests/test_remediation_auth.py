"""Remediation 2026-06-04 — Token/Session/Audit Critical findings.

Covers the closing tests for findings:
  A1 — auth router emits Events on every login/logout/refresh path
  S2/T3 — deactivated users cannot login OR refresh
  S6 — password change revokes every refresh token for the principal
  T2 — refresh-token replay revokes the whole session family
  T1 — portal logout stamps token_not_before, killing all outstanding portal tokens
  T4 — expired API key is rejected at auth
  T5 — require_scope blocks an API key whose scopes don't include the required one

All tests mint their own fresh logins / users where mutation would otherwise pollute
the shared session-scoped admin fixture. We touch the DB directly via SessionLocal /
OwnerSessionLocal for setup (status flips, expiry stamping) where no public API exists.
"""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal, OwnerSessionLocal
from app.models import User
from app.models.apikey import ApiKey
from app.models.customer_user import CustomerUser
from app.models.refresh_token import RefreshToken
from app.models.event import Event
from app.security import hash_password


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _bearer(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


async def _login(client, email="admin@demo.isp", password="admin123") -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


async def _make_user(email: str | None = None, password: str = "Strongpw1", status: str = "ACTIVE") -> tuple[uuid.UUID, str, str]:
    """Create a fresh app_user on the demo tenant, return (id, email, password).

    Lives on the OWNER session so RLS is bypassed for setup. Test-isolated email
    (uuid suffix) so concurrent / repeated runs don't collide on the unique-index
    on `email`."""
    email = email or f"remediation-{uuid.uuid4().hex[:8]}@gaahex.test"
    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        admin = (await o.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        u = User(
            tenant_id=admin.tenant_id,
            primary_node_id=admin.primary_node_id,
            email=email,
            name="Remediation Test User",
            password_hash=hash_password(password),
            status=status,
        )
        o.add(u)
        await o.commit()
        return u.id, email, password


async def _set_user_status(user_id: uuid.UUID, status: str) -> None:
    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        row = (await o.execute(select(User).where(User.id == user_id))).scalar_one()
        row.status = status
        await o.commit()


async def _events_for(user_id: uuid.UUID, type_: str) -> list[Event]:
    """All Event rows of `type_` whose record_id matches the given user. Used by the audit-emit
    tests — type_ is normalised to upper-case in workflow.emit, so we compare upper-case."""
    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        rows = (await o.execute(
            select(Event).where(Event.record_id == user_id, Event.type == type_.upper())
            .order_by(Event.created_at.desc())
        )).scalars().all()
        return list(rows)


# ===========================================================================
# A1 — auth events
# ===========================================================================


async def test_login_success_emits_audit_event(client):
    """A1: a successful /auth/login appends a USER_LOGIN_SUCCESS Event for the user."""
    uid, email, pw = await _make_user()
    r = await client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    events = await _events_for(uid, "USER_LOGIN_SUCCESS")
    assert len(events) >= 1
    e = events[0]
    assert e.entity_key == "user"
    assert e.actor_user_id == uid
    assert e.category == "SECURITY"


async def test_login_failed_emits_audit_event(client):
    """A1: a wrong-password /auth/login on a real email appends USER_LOGIN_FAILED with the IP +
    email in data. Unknown emails are deliberately NOT audited (Event.tenant_id is NOT NULL —
    see auth.py docstring); only the known-email-wrong-password path produces an event row."""
    uid, email, _pw = await _make_user()
    r = await client.post("/auth/login", json={"email": email, "password": "definitely-wrong"})
    assert r.status_code == 401
    events = await _events_for(uid, "USER_LOGIN_FAILED")
    assert len(events) >= 1
    e = events[0]
    assert e.data.get("email") == email
    assert e.actor_user_id is None        # failure → no auth context


async def test_logout_emits_audit_event(client):
    """A1: /auth/logout on a valid refresh token appends USER_LOGOUT with the session_id."""
    uid, email, pw = await _make_user()
    body = await _login(client, email=email, password=pw)
    r = await client.post("/auth/logout", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 200, r.text
    events = await _events_for(uid, "USER_LOGOUT")
    assert len(events) >= 1
    assert events[0].data.get("session_id")    # non-empty session_id present in event payload


# ===========================================================================
# S2 / T3 — deactivated user gates
# ===========================================================================


async def test_deactivated_user_cannot_login(client):
    """S2: /auth/login rejects (401) a user whose status != 'ACTIVE'."""
    uid, email, pw = await _make_user(status="INACTIVE")
    r = await client.post("/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 401
    assert "inactive" in r.json()["detail"].lower()


async def test_deactivated_user_refresh_rejected(client):
    """T3: a user who logs in successfully, is then deactivated, and tries to /auth/refresh
    must be rejected (401) even though the refresh token row is still 'live'."""
    uid, email, pw = await _make_user()
    body = await _login(client, email=email, password=pw)
    refresh_tok = body["refresh_token"]

    await _set_user_status(uid, "INACTIVE")

    r = await client.post("/auth/refresh", json={"refresh_token": refresh_tok})
    assert r.status_code == 401


# ===========================================================================
# S6 — password change revokes refresh tokens
# ===========================================================================


async def test_password_change_revokes_all_refresh_tokens(client):
    """S6: /api/me/password must revoke every still-live refresh token for this user. Verify
    by attempting to /auth/refresh AFTER the password change — that call must 401."""
    uid, email, pw = await _make_user()
    body = await _login(client, email=email, password=pw)

    new_pw = "Newpassword1"
    r = await client.post(
        "/api/me/password",
        headers=_bearer(body["access_token"]),
        json={"current_password": pw, "new_password": new_pw},
    )
    assert r.status_code == 200, r.text
    # Helper returned the count of refresh tokens it revoked; at least the one we minted at login.
    assert r.json().get("refresh_tokens_revoked", 0) >= 1

    # The pre-change refresh token must no longer work.
    r2 = await client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r2.status_code == 401


# ===========================================================================
# T2 — refresh-token replay revokes the session family
# ===========================================================================


async def test_refresh_replay_revokes_session_family(client):
    """T2: issue → rotate → present the OLD (already-revoked) refresh → server detects replay,
    revokes every member of the session family. The rotated (current) refresh token must ALSO
    stop working once replay has been detected."""
    uid, email, pw = await _make_user()
    body = await _login(client, email=email, password=pw)
    old_refresh = body["refresh_token"]

    # Rotate once — successful refresh, get the new refresh token.
    rotated = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert rotated.status_code == 200
    new_refresh = rotated.json()["refresh_token"]

    # Present the OLD (now-revoked) refresh — replay. Server returns 401.
    replay = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401

    # T2 PROOF: the rotated (current, descendant) refresh token must now ALSO be dead — the entire
    # session family was revoked in response to the replay.
    after = await client.post("/auth/refresh", json={"refresh_token": new_refresh})
    assert after.status_code == 401

    # Audit: USER_TOKEN_REPLAY_DETECTED row was written.
    events = await _events_for(uid, "USER_TOKEN_REPLAY_DETECTED")
    assert len(events) >= 1
    assert events[0].data.get("session_id")


# ===========================================================================
# T1 — portal logout via token_not_before
# ===========================================================================


async def test_portal_logout_revokes_via_tnbf(client):
    """T1: portal /auth/login → call /portal/auth/logout → the same access token now 401s.
    Effect path: logout stamps customer_user.token_not_before; current_customer rejects any
    token whose `iat` is BEFORE that timestamp.

    Setup is direct-DB because there's no portal user-create API; the existing portal_login
    flow needs a CustomerUser + a Record (customer_id) to exist."""
    # Create a customer Record + CustomerUser directly on the demo tenant. We need a record_id
    # the CustomerUser can FK to. Use the demo admin's tenant.
    from app.models.record import Record

    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        admin = (await o.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        tenant_id = admin.tenant_id

        # Build a minimal Record to act as the customer.
        rec = Record(
            tenant_id=tenant_id,
            entity_key="customer",
            data={"name": f"Portal Test Customer {uuid.uuid4().hex[:6]}"},
            status="ACTIVE",
        )
        o.add(rec)
        await o.flush()

        cu_email = f"portal-{uuid.uuid4().hex[:8]}@gaahex.test"
        cu_pw = "Portalpw1"
        cu = CustomerUser(
            tenant_id=tenant_id,
            customer_id=rec.id,
            email=cu_email,
            password_hash=hash_password(cu_pw),
            name="Portal Test",
            is_active=True,
        )
        o.add(cu)
        await o.commit()
        cu_id = cu.id

    # Log in via portal — get an access token.
    r = await client.post("/portal/auth/login", json={"email": cu_email, "password": cu_pw})
    assert r.status_code == 200, r.text
    access = r.json()["access_token"]

    # Token works initially.
    me = await client.get("/portal/auth/me", headers=_bearer(access))
    assert me.status_code == 200

    # Wait until the next integer second before bumping. JWT 'iat' (NumericDate,
    # RFC 7519 §4.1.6) is encoded as integer seconds, and current_customer
    # compares iat to token_not_before at second resolution. This test verifies
    # CROSS-SECOND revocation (the precision guarantee of the mechanism);
    # sub-second logout windows are an accepted limitation documented on
    # portal_auth.portal_logout (the standard JWT-NumericDate trade-off).
    await asyncio.sleep(1.1)

    # Logout — stamps customer_user.token_not_before (floored to second).
    out = await client.post("/portal/auth/logout", headers=_bearer(access))
    assert out.status_code == 200, out.text

    # The token whose iat is now BEFORE token_not_before must be rejected.
    me2 = await client.get("/portal/auth/me", headers=_bearer(access))
    assert me2.status_code == 401

    # Sanity: token_not_before is in fact populated.
    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        row = (await o.execute(select(CustomerUser).where(CustomerUser.id == cu_id))).scalar_one()
        assert row.token_not_before is not None


# ===========================================================================
# T4 — API key expiry
# ===========================================================================


async def test_api_key_expired_rejected(client, admin):
    """T4: an API key with expires_at in the past is rejected at auth (401)."""
    # Create a normal key, then stamp expires_at to a past timestamp directly in the DB.
    created = (await client.post("/api/api-keys", headers=admin, json={"name": "expired-key"})).json()
    kid = created["id"]
    raw = created["key"]

    async with OwnerSessionLocal() as o:
        await o.connection(execution_options={"audit_tenant_filter": False})
        ak = (await o.execute(select(ApiKey).where(ApiKey.id == uuid.UUID(kid)))).scalar_one()
        ak.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        await o.commit()

    r = await client.get("/auth/me", headers={"X-API-Key": raw})
    assert r.status_code == 401

    # And confirm a future expiry still works (positive control).
    created2 = (await client.post(
        "/api/api-keys",
        headers=admin,
        json={
            "name": "future-key",
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        },
    )).json()
    assert created2["expires_at"] is not None
    r2 = await client.get("/auth/me", headers={"X-API-Key": created2["key"]})
    assert r2.status_code == 200


# ===========================================================================
# T5 — require_scope enforcement
# ===========================================================================


async def test_api_key_scope_enforced(client, admin):
    """T5: an API key with scopes=['billing.write'] cannot reach an endpoint guarded by
    `require_scope('billing.read')` — 403. The same endpoint is reachable by:
      (a) a key with scopes=['billing.read'] (intersection succeeds)
      (b) a key with scopes=None / [] (unrestricted) — covers all human and legacy callers.
    Endpoint under test: GET /api/invoices (decorated with require_scope('billing.read')).
    """
    # (1) restricted key WITHOUT billing.read → 403 at require_scope, before invoice.view RBAC.
    wrong = (await client.post(
        "/api/api-keys", headers=admin,
        json={"name": "scoped-wrong", "scopes": ["billing.write"]},
    )).json()
    r_wrong = await client.get("/api/invoices", headers={"X-API-Key": wrong["key"]})
    assert r_wrong.status_code == 403, r_wrong.text

    # (2) restricted key WITH billing.read → passes require_scope (RBAC still applies on top).
    right = (await client.post(
        "/api/api-keys", headers=admin,
        json={"name": "scoped-right", "scopes": ["billing.read"]},
    )).json()
    r_right = await client.get("/api/invoices", headers={"X-API-Key": right["key"]})
    # Admin grants on the demo tenant include invoice.view, so a 200 is the expected result.
    assert r_right.status_code == 200, r_right.text

    # (3) unrestricted key (no scopes given) → passes require_scope as before, RBAC governs.
    open_key = (await client.post(
        "/api/api-keys", headers=admin, json={"name": "no-scopes"},
    )).json()
    assert open_key["scopes"] is None
    r_open = await client.get("/api/invoices", headers={"X-API-Key": open_key["key"]})
    assert r_open.status_code == 200, r_open.text
