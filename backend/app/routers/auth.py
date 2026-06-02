import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session, get_owner_session, set_tenant_guc, OwnerSessionLocal
from ..models import User
from ..models.refresh_token import RefreshToken
from ..models.apikey import ApiKey
from ..security import verify_password, create_access_token, decode_token
from ..access import load_grants, can

router = APIRouter(prefix="/auth", tags=["auth"])
# auto_error=False so a missing Bearer doesn't 401 before we get a chance to try the X-API-Key path.
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None        # additive — existing access_token/token_type unchanged
    # Set on /auth/login when the seeded default admin (admin@demo.isp) still has
    # password_changed_at IS NULL. The frontend uses this flag to route to a forced change-password
    # screen; the access token is still issued so the client can call /api/me/password with it.
    # Default False everywhere else (refresh, non-seeded users) — keeps the response shape stable.
    must_change_password: bool = False


class RefreshIn(BaseModel):
    refresh_token: str


# ---- password policy (reusable; apply wherever a password is set) ----

_PW_LETTER = re.compile(r"[A-Za-z]")
_PW_DIGIT = re.compile(r"\d")


def validate_password_strength(password: str) -> None:
    """Raise 422 if a password is too weak. Call this anywhere a password is set/changed
    (e.g. a future user-create endpoint, change-password, or Studio user management)."""
    if not isinstance(password, str) or len(password) < settings.password_min_length:
        raise HTTPException(422, f"Password must be at least {settings.password_min_length} characters")
    if not _PW_LETTER.search(password) or not _PW_DIGIT.search(password):
        raise HTTPException(422, "Password must contain at least one letter and one digit")


# ---- refresh-token helpers (opaque token; only its SHA-256 hash is stored) ----

def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _issue_refresh_token(s: AsyncSession, user: User) -> str:
    """Mint a new opaque refresh token, persist its hash, return the raw token to the caller."""
    raw = secrets.token_urlsafe(48)
    s.add(RefreshToken(
        tenant_id=user.tenant_id,
        user_id=user.id,
        token_hash=_hash_token(raw),
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_days),
    ))
    await s.flush()
    return raw


# ---- endpoints ----

@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, s: AsyncSession = Depends(get_owner_session)):
    # owner session: the email→user lookup is pre-auth (no tenant yet), so it must bypass RLS.
    user = (await s.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    # Multi-tenant: bake the user's tenant_id into the JWT. `current_user` re-validates this claim
    # against the user's stored tenant_id on every request (defense against stolen-token tenant
    # injection) and binds the RLS GUC to the user's tenant — never to a fixed singleton.
    token = create_access_token(str(user.id), {"email": user.email, "tenant": str(user.tenant_id)})
    refresh = await _issue_refresh_token(s, user)
    # Forced first-login change for the seeded default admin only: if its password_changed_at is
    # still NULL it's still on the seed `admin123` password. The access token IS issued so the
    # client can call /api/me/password with it; the flag just routes the UI to the change screen.
    must_change = user.email == "admin@demo.isp" and user.password_changed_at is None
    await s.commit()
    return TokenOut(access_token=token, refresh_token=refresh, must_change_password=must_change)


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, s: AsyncSession = Depends(get_owner_session)):
    """Exchange a valid refresh token for a new access token. Rotates the refresh token:
    the presented one is revoked and a fresh one issued (replay protection). Any invalid,
    expired, or revoked token → 401."""
    rt = (await s.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_token(body.refresh_token))
    )).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if not rt or rt.revoked_at is not None or rt.expires_at <= now:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = (await s.execute(select(User).where(User.id == rt.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    rt.revoked_at = now                                  # rotate: kill the used token
    new_refresh = await _issue_refresh_token(s, user)
    # Re-stamp the tenant claim from the user's CURRENT stored tenant_id. If somehow the user has
    # been moved between tenants since the refresh token was issued, the new access token reflects
    # the new tenant — the refresh-token row also keys on user.id so it stays valid.
    token = create_access_token(str(user.id), {"email": user.email, "tenant": str(user.tenant_id)})
    await s.commit()
    return TokenOut(access_token=token, refresh_token=new_refresh)


@router.post("/logout")
async def logout(body: RefreshIn, s: AsyncSession = Depends(get_owner_session)):
    """Revoke a refresh token. Idempotent: an unknown or already-revoked token still returns ok."""
    rt = (await s.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_token(body.refresh_token))
    )).scalar_one_or_none()
    if rt and rt.revoked_at is None:
        rt.revoked_at = datetime.now(timezone.utc)
        await s.commit()
    return {"ok": True}


async def _user_from_api_key(raw_key: str) -> User | None:
    """Resolve an X-API-Key to the User it acts as. Looks up the hash via the OWNER session (the
    request is pre-tenant), rejects missing/revoked keys, and stamps last_used_at. Default-deny."""
    async with OwnerSessionLocal() as o:
        ak = (await o.execute(
            select(ApiKey).where(ApiKey.key_hash == _hash_token(raw_key))
        )).scalar_one_or_none()
        if not ak or ak.revoked_at is not None:
            return None
        ak.last_used_at = datetime.now(timezone.utc)
        user = (await o.execute(select(User).where(User.id == ak.acts_as_user_id))).scalar_one_or_none()
        await o.commit()
    return user


async def current_user(
    token: str | None = Depends(oauth2),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    s: AsyncSession = Depends(get_session),
) -> User:
    """Authenticate via EITHER an X-API-Key header (machine principal) OR a Bearer JWT (human).
    Either way we resolve the User via the OWNER session (the request session has no tenant GUC yet)
    and bind the request to the USER'S stored tenant for RLS. Default-deny on any bad credential.

    Multi-tenant (Wave 1): for JWT auth we also enforce that the token's `tenant` claim matches the
    user's stored tenant_id — defense against a stolen/forged token that swaps the tenant claim to
    cross into another tenant. API keys are tied to a specific user row at provisioning so the
    tenant is taken directly from the user (no separate claim to validate)."""
    if x_api_key:
        user = await _user_from_api_key(x_api_key)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid API key")
        # Bind to the user's authenticated tenant — never to a fixed singleton.
        await set_tenant_guc(s, user.tenant_id)
        return user

    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # jwt.decode verifies the signature AND the `exp` claim; an expired or forged token raises,
    # and we map every failure to 401 (never 500).
    try:
        payload = decode_token(token)
        uid = uuid.UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    # Portal tokens carry kind='customer' — they must never authenticate a staff endpoint.
    if payload.get("kind") == "customer":
        raise HTTPException(status_code=401, detail="Portal token not accepted on staff endpoints")
    # Look the user up via the OWNER session: the app session `s` is RLS-subject and has no tenant
    # GUC set yet (chicken-and-egg), so a gaahex_app read of app_user here would default-deny.
    async with OwnerSessionLocal() as o:
        user = (await o.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    # STRICT TENANT VALIDATION (Wave 1 — multi-tenant hardening):
    #   1. The JWT MUST carry a `tenant` claim. Legacy tokens minted before this change lacked it;
    #      they are now rejected and the client must re-login (tokens are short-lived anyway).
    #   2. The claim MUST match the user's stored tenant_id. A mismatch means the token was either
    #      forged (signature was somehow valid) or a user was moved between tenants since issuance.
    #      Either way we refuse to bind RLS — re-login required.
    jwt_tenant = payload.get("tenant")
    if jwt_tenant is None:
        raise HTTPException(status_code=401, detail="Token missing tenant claim")
    if str(user.tenant_id) != str(jwt_tenant):
        raise HTTPException(status_code=401, detail="Token tenant mismatch")

    # Bind RLS GUC to the user's authenticated tenant — the old single-tenant trapdoor is gone.
    await set_tenant_guc(s, user.tenant_id)
    return user


@router.get("/me")
async def me(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "tenant_id": str(user.tenant_id),
        "primary_node_id": str(user.primary_node_id) if user.primary_node_id else None,
        "avatar_url": user.avatar_url,
        "can_configure": can(grants, "config", "manage"),
    }
