import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session, set_tenant_guc
from ..models import User
from ..models.refresh_token import RefreshToken
from ..security import verify_password, create_access_token, decode_token
from ..access import load_grants, can

router = APIRouter(prefix="/auth", tags=["auth"])
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login")


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None        # additive — existing access_token/token_type unchanged


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
async def login(body: LoginIn, s: AsyncSession = Depends(get_session)):
    user = (await s.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token(str(user.id), {"tenant": str(user.tenant_id), "email": user.email})
    refresh = await _issue_refresh_token(s, user)
    await s.commit()
    return TokenOut(access_token=token, refresh_token=refresh)


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, s: AsyncSession = Depends(get_session)):
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
    token = create_access_token(str(user.id), {"tenant": str(user.tenant_id), "email": user.email})
    await s.commit()
    return TokenOut(access_token=token, refresh_token=new_refresh)


@router.post("/logout")
async def logout(body: RefreshIn, s: AsyncSession = Depends(get_session)):
    """Revoke a refresh token. Idempotent: an unknown or already-revoked token still returns ok."""
    rt = (await s.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_token(body.refresh_token))
    )).scalar_one_or_none()
    if rt and rt.revoked_at is None:
        rt.revoked_at = datetime.now(timezone.utc)
        await s.commit()
    return {"ok": True}


async def current_user(token: str = Depends(oauth2), s: AsyncSession = Depends(get_session)) -> User:
    # jwt.decode verifies the signature AND the `exp` claim; an expired or forged token raises,
    # and we map every failure to 401 (never 500). Default-deny.
    try:
        payload = decode_token(token)
        uid = uuid.UUID(payload["sub"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = (await s.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # Bind this request's connection to the user's tenant for RLS (survives mid-request commits;
    # cleared on session teardown). Harmless under the owner role, which bypasses RLS.
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
        "can_configure": can(grants, "config", "manage"),
    }
