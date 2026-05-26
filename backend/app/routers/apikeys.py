"""API keys (machine principals, J93) + in-process rate limiting (J94).

API keys are managed by config-admins. The RAW key (`prefix.secret`) is shown exactly once at
creation; only its SHA-256 hash is stored. Authentication via the key happens in `auth.current_user`
(X-API-Key header). The rate limiter is a lightweight ASGI middleware (see RateLimitMiddleware).

NOTE on namespacing: fixed path "/api/api-keys" → register the router BEFORE records.router.
"""
import hashlib
import secrets
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..models import User
from ..models.apikey import ApiKey
from ..access import load_grants, can
from .auth import current_user, _hash_token

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])


async def _require_admin(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed: config.manage")


def _serialize(k: ApiKey, raw_key: str | None = None) -> dict:
    out = {
        "id": str(k.id),
        "name": k.name,
        "prefix": k.prefix,
        "acts_as_user_id": str(k.acts_as_user_id),
        "created_by": str(k.created_by) if k.created_by else None,
        "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
        "revoked_at": k.revoked_at.isoformat() if k.revoked_at else None,
        "created_at": k.created_at.isoformat() if k.created_at else None,
    }
    if raw_key is not None:
        out["key"] = raw_key                       # shown ONCE, on create only
    return out


@router.post("", status_code=201)
async def create_api_key(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create an API key. Returns the RAW key (`prefix.secret`) ONCE — it is never retrievable
    again. `acts_as_user_id` defaults to the creator; if given, it must be a user in this tenant."""
    await _require_admin(s, user)
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")

    acts_as = payload.get("acts_as_user_id") or str(user.id)
    principal = (await s.execute(
        select(User).where(User.id == acts_as, User.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not principal:
        raise HTTPException(422, "acts_as_user_id is not a user in this tenant")

    prefix = secrets.token_hex(4)                  # 8 hex chars, shown in lists
    secret = secrets.token_urlsafe(32)
    raw_key = f"{prefix}.{secret}"                  # the value the client sends as X-API-Key

    ak = ApiKey(
        tenant_id=user.tenant_id, name=name, prefix=prefix, key_hash=_hash_token(raw_key),
        acts_as_user_id=principal.id, created_by=user.id,
    )
    s.add(ak)
    await s.commit()
    await s.refresh(ak)
    return _serialize(ak, raw_key=raw_key)


@router.get("")
async def list_api_keys(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """List the tenant's API keys (prefix + metadata only — the key itself is never returned)."""
    await _require_admin(s, user)
    rows = (await s.execute(
        select(ApiKey).where(ApiKey.tenant_id == user.tenant_id).order_by(ApiKey.created_at.desc())
    )).scalars().all()
    return [_serialize(k) for k in rows]


@router.post("/{key_id}/revoke")
async def revoke_api_key(key_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Revoke a key (sets revoked_at). Idempotent — revoking an already-revoked key still returns ok."""
    await _require_admin(s, user)
    ak = (await s.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not ak:
        raise HTTPException(404, "API key not found")
    if ak.revoked_at is None:
        ak.revoked_at = datetime.now(timezone.utc)
        await s.commit()
    return _serialize(ak)


# ==========================================================================================
# Rate limiting (J94) — lightweight in-process, per principal-or-IP, fixed 1-minute window.
# Pure ASGI middleware so it can short-circuit with 429 before route/dependency resolution.
# OFF unless settings.rate_limit_enabled (keeps the test suite unaffected). In-process only —
# for multi-worker / horizontal scale, swap the counter store for Redis behind the same shape.
# ==========================================================================================

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Starlette HTTP middleware (plays well with the ASGI transport the test client uses). OFF unless
    settings.rate_limit_enabled, so tests/dev are unaffected. Fixed 1-minute window, per principal/IP."""
    def __init__(self, app):
        super().__init__(app)
        self._counts: dict[tuple[str, int], int] = {}   # (principal, minute_bucket) -> count

    @staticmethod
    def _principal(request) -> str:
        api_key = request.headers.get("x-api-key")
        if api_key:
            return "k:" + api_key[:16]
        auth = request.headers.get("authorization")
        if auth:
            return "b:" + hashlib.sha256(auth.encode()).hexdigest()[:16]
        return "ip:" + (request.client.host if request.client else "unknown")

    async def dispatch(self, request, call_next):
        if not settings.rate_limit_enabled:
            return await call_next(request)
        minute = int(time.time() // 60)
        for k in [k for k in self._counts if k[1] != minute]:   # bounded memory: keep only this minute
            del self._counts[k]
        key = (self._principal(request), minute)
        self._counts[key] = self._counts.get(key, 0) + 1
        if self._counts[key] > settings.rate_limit_per_min:
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        return await call_next(request)
