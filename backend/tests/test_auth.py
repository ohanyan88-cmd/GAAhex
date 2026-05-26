"""Coverage for auth hardening: access tokens, refresh (rotation/replay), logout, expiry, policy.

Refresh-token tests mint their OWN logins (the shared admin/agent fixtures keep only the Bearer
header). Revoking/rotating those refresh tokens never affects the stateless access-token fixtures,
so there's no cross-file impact.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

from app.config import settings
from app.routers.auth import validate_password_strength


async def _login(client, email="admin@demo.isp", password="admin123") -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


# ---- access token happy path ----

async def test_login_returns_usable_access_token(client):
    body = await _login(client)
    assert body["token_type"] == "bearer"
    assert body["access_token"] and body["refresh_token"]
    me = await client.get("/auth/me", headers=_bearer(body["access_token"]))
    assert me.status_code == 200 and me.json()["email"] == "admin@demo.isp"


async def test_login_bad_password_401(client):
    r = await client.post("/auth/login", json={"email": "admin@demo.isp", "password": "wrong"})
    assert r.status_code == 401


# ---- bad tokens map to 401, never 500 ----

async def test_garbage_token_401(client):
    assert (await client.get("/auth/me", headers=_bearer("not-a-real-jwt"))).status_code == 401
    assert (await client.get("/auth/me", headers=_bearer("aaa.bbb.ccc"))).status_code == 401


async def test_tampered_signature_401(client):
    # forged: a well-formed JWT signed with the WRONG secret → signature check fails
    forged = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "the-wrong-secret", algorithm=settings.jwt_alg,
    )
    assert (await client.get("/auth/me", headers=_bearer(forged))).status_code == 401


async def test_expired_token_401(client):
    # correctly signed but already expired → jwt.decode raises on exp → 401
    expired = jwt.encode(
        {"sub": str(uuid.uuid4()), "exp": datetime.now(timezone.utc) - timedelta(minutes=1)},
        settings.jwt_secret, algorithm=settings.jwt_alg,
    )
    assert (await client.get("/auth/me", headers=_bearer(expired))).status_code == 401


# ---- refresh ----

async def test_refresh_issues_usable_access_token(client):
    body = await _login(client)
    r = await client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 200, r.text
    new = r.json()
    assert new["access_token"] and new["refresh_token"]
    assert new["refresh_token"] != body["refresh_token"]            # rotated
    # the new access token works
    me = await client.get("/auth/me", headers=_bearer(new["access_token"]))
    assert me.status_code == 200 and me.json()["email"] == "admin@demo.isp"


async def test_refresh_rotation_revokes_old_token(client):
    body = await _login(client)
    first = await client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert first.status_code == 200
    # replaying the original (now-rotated) refresh token is rejected
    replay = await client.post("/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert replay.status_code == 401


async def test_refresh_garbage_token_401(client):
    assert (await client.post("/auth/refresh", json={"refresh_token": "nope"})).status_code == 401


# ---- logout / invalidation ----

async def test_logout_revokes_refresh_and_is_idempotent(client):
    body = await _login(client)
    rt = body["refresh_token"]
    # logout succeeds
    assert (await client.post("/auth/logout", json={"refresh_token": rt})).status_code == 200
    # after logout the refresh token no longer works
    assert (await client.post("/auth/refresh", json={"refresh_token": rt})).status_code == 401
    # idempotent: logging out an already-revoked token still returns ok
    again = await client.post("/auth/logout", json={"refresh_token": rt})
    assert again.status_code == 200 and again.json()["ok"] is True
    # and an unknown token is a harmless no-op
    assert (await client.post("/auth/logout", json={"refresh_token": "unknown-token"})).status_code == 200


# ---- password policy (validator is not endpoint-exposed yet → unit-tested via import) ----

def test_password_policy_rejects_weak():
    for weak in ["short1", "", "1234567", "abcdefgh", "12345678"]:
        # too short, or missing a letter, or missing a digit
        with pytest.raises(HTTPException) as ei:
            validate_password_strength(weak)
        assert ei.value.status_code == 422


def test_password_policy_accepts_strong():
    # >= min length, has a letter and a digit → no exception
    validate_password_strength("abcd1234")
    validate_password_strength("Str0ngEnough")
