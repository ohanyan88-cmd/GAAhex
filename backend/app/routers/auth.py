import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session, get_owner_session, set_tenant_guc, OwnerSessionLocal, SessionLocal
from ..models import User
from ..models.refresh_token import RefreshToken
from ..models.apikey import ApiKey
from ..security import verify_password, create_access_token, decode_token
from ..access import load_grants, can
from .. import workflow

router = APIRouter(prefix="/auth", tags=["auth"])
# auto_error=False so a missing Bearer doesn't 401 before we get a chance to try the X-API-Key path.
oauth2 = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

logger = logging.getLogger("gaahex.auth")


async def _audit_login_failed(tenant_id, user_id, email, ip, reason: str) -> None:
    """C1a-3a (D2) — durable, tenant-scoped USER_LOGIN_FAILED audit for a KNOWN user, on a FRESH app
    session (gaahex_app) independent of the request flow that's about to raise 401. The tenant GUC is set
    on THIS session so the RLS WITH CHECK permits the Event write (tenant_id == GUC). Best-effort — an
    audit failure must never surface as a 500. (Unknown-user attempts have no tenant -> no Event possible;
    they are recorded via the logger.warning sink at the call site.)"""
    try:
        async with SessionLocal() as a:
            await set_tenant_guc(a, tenant_id)
            await workflow.emit(
                a, tenant_id=tenant_id, type_="USER_LOGIN_FAILED", entity_key="user",
                record_id=user_id, actor_user_id=None,
                data={"email": email, "ip": ip, "reason": reason}, category="SECURITY", actor_type="USER",
            )
            await a.commit()
    except Exception:
        pass


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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def _issue_refresh_token(
    s: AsyncSession,
    user: User,
    *,
    session_id: uuid.UUID | None = None,
) -> tuple[str, RefreshToken]:
    """Mint a new opaque refresh token. Returns (raw_token, persisted_row).

    T2 remediation 2026-06-04: every refresh token carries a `session_id` grouping it into a
    family. /auth/login starts a fresh family (session_id = the new row's own id — set after
    flush). /auth/refresh rotation MUST pass the parent's session_id so the family is preserved
    across rotations, enabling whole-family revoke on replay detection.
    """
    raw = secrets.token_urlsafe(48)
    row = RefreshToken(
        tenant_id=user.tenant_id,
        user_id=user.id,
        token_hash=_hash_token(raw),
        # Provisional: set to a fresh UUID; if this is a /login (session_id is None), we'll
        # overwrite it with `row.id` after flush so each new session starts a family-of-one
        # keyed off the row's own primary key (matches the migration's legacy backfill).
        session_id=session_id if session_id is not None else uuid.uuid4(),
        expires_at=_utcnow() + timedelta(days=settings.refresh_token_days),
    )
    s.add(row)
    await s.flush()
    if session_id is None:
        # First token of a new family — align session_id with the row's own id so the family
        # has a stable, recognizable identifier (matches the legacy backfill in alembic e1a4b2c3d5f7).
        row.session_id = row.id
        await s.flush()
    return raw, row


async def revoke_all_refresh_tokens_for_user(s: AsyncSession, user_id: uuid.UUID) -> int:
    """Revoke every non-revoked refresh token for this user. Returns count revoked.

    S6 remediation 2026-06-04: invoked from /api/me/password (post password change) and from
    /api/users/{id} DELETE (soft-deactivation) so a password reset / lockout truly kills every
    still-live session for that principal — not just the access token's short window."""
    result = await s.execute(
        update(RefreshToken)  # tenant-filter-ok: — RLS-bound `s` enforces tenant via RefreshToken.tenant_id; user_id provenance is tenant-scoped (callers: /api/me/password, /api/users/{id} DELETE).
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_utcnow())
    )
    return result.rowcount or 0


async def revoke_session_family(s: AsyncSession, session_id: uuid.UUID) -> int:
    """Revoke every non-revoked refresh token in a session family. Returns count revoked.

    T2 remediation 2026-06-04: called on refresh-token replay detection. Presenting a token that
    has already been rotated (revoked_at IS NOT NULL) is taken as evidence of compromise — every
    still-live descendant in the family is killed in a single UPDATE so the attacker's freshly
    rotated token (if any) is invalidated alongside the legitimate user's tokens. The user must
    re-authenticate. The trade-off (forced re-login on false positives) is the right default for
    a security event."""
    result = await s.execute(
        update(RefreshToken)  # tenant-filter-ok: — RLS-bound `s` enforces tenant; session_id provenance is tenant-scoped (T2 replay-detection call site).
        .where(RefreshToken.session_id == session_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=_utcnow())
    )
    return result.rowcount or 0


# ---- endpoints ----

@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request, s: AsyncSession = Depends(get_session)):
    client_ip = request.client.host if request.client else None
    # C1a-3a: narrow SECURITY DEFINER credential lookup instead of a broad owner-session read. The
    # request session is gaahex_app with no tenant GUC yet (pre-auth); gx_auth_staff_by_email runs
    # elevated (pinned search_path, static SQL) and returns ONLY (id, tenant_id, password_hash, status).
    # email is UNIQUE -> at most one row; the len != 1 check is a structural belt.
    rows = (await s.execute(
        text("SELECT id, tenant_id, password_hash, status FROM gx_auth_staff_by_email(:e)"),
        {"e": body.email},
    )).mappings().all()
    cred = rows[0] if len(rows) == 1 else None

    if cred is None or not verify_password(body.password, cred["password_hash"]):
        # Telemetry sink (D1): a structured WARNING for EVERY failed login. The unknown-user case has no
        # tenant, so it CANNOT be a per-tenant Event (Event.tenant_id is NOT NULL) — the log line is the
        # only record and must exist. Fuller brute-force observability (rate-limit, per-IP metrics,
        # alerting) is the security-observability track.
        logger.warning("login failed", extra={
            "email": body.email, "ip": client_ip,
            "reason": "unknown_user" if cred is None else "bad_password"})
        if cred is not None:  # KNOWN user, bad password: durable tenant-scoped audit (D2, fresh app session)
            await _audit_login_failed(cred["tenant_id"], cred["id"], body.email, client_ip, "bad_password")
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # S2: a deactivated user cannot log in even with a valid password. Block on status == 'INACTIVE'
    # (fold legacy lowercase 'inactive' to upper) rather than allowlisting 'ACTIVE'.
    if (cred["status"] or "").upper() == "INACTIVE":
        logger.warning("login failed", extra={"email": body.email, "ip": client_ip, "reason": "inactive"})
        await _audit_login_failed(cred["tenant_id"], cred["id"], body.email, client_ip, "inactive")
        raise HTTPException(status_code=401, detail="User account is inactive")

    # Bind RLS to the user's tenant, THEN re-read the full User UNDER RLS (its own row) for the success
    # path (token claims, refresh-token mint, must-change flag, audit). Empty re-read -> fail closed.
    await set_tenant_guc(s, cred["tenant_id"])
    user = (await s.execute(select(User).where(User.id == cred["id"]))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Multi-tenant: bake the user's tenant_id into the JWT. current_user re-validates this claim on every
    # request and binds the RLS GUC to the user's tenant — never to a fixed singleton.
    token = create_access_token(str(user.id), {"email": user.email, "tenant": str(user.tenant_id)})
    refresh, _row = await _issue_refresh_token(s, user)
    # Forced first-login change for a seeded admin still on its seed/env password (password_changed_at
    # is NULL until /api/me/password stamps it). Covers the demo admin AND the C5 production bootstrap
    # super-admin (settings.bootstrap_admin_email) so the env-provided password is rotated immediately.
    must_change = user.password_changed_at is None and user.email in {
        "admin@demo.isp", settings.bootstrap_admin_email.strip().lower(),
    }
    await workflow.emit(
        s, tenant_id=user.tenant_id, type_="USER_LOGIN_SUCCESS",
        entity_key="user", record_id=user.id, actor_user_id=user.id,
        data={"ip": client_ip}, category="SECURITY",
    )
    await s.commit()
    return TokenOut(access_token=token, refresh_token=refresh, must_change_password=must_change)


@router.post("/refresh", response_model=TokenOut)
async def refresh(body: RefreshIn, s: AsyncSession = Depends(get_owner_session)):
    """Exchange a valid refresh token for a new access token. Rotates the refresh token:
    the presented one is revoked and a fresh one issued (replay protection). Any invalid,
    expired, or revoked token → 401.

    T2 remediation 2026-06-04: if the presented token is ALREADY revoked (replay), kill the
    whole session family — treat the replay as evidence of compromise. The new (rotated) token
    inherits the parent's session_id so the family is preserved across rotations.
    S2 remediation 2026-06-04: a deactivated user's refresh tokens stop working immediately."""
    # Pre-auth lookups via owner session — token hash + user-by-id are cluster-unique by design.
    rt = (await s.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_token(body.refresh_token))
        .execution_options(audit_tenant_filter=False)
    )).scalar_one_or_none()
    now = _utcnow()
    if not rt:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # T2 — replay detection BEFORE the generic 401: a presented-but-revoked token is a security
    # event, not a stale credential. Revoke the entire session family and emit an audit event.
    if rt.revoked_at is not None:
        try:
            await revoke_session_family(s, rt.session_id)
            await workflow.emit(
                s, tenant_id=rt.tenant_id, type_="USER_TOKEN_REPLAY_DETECTED",
                entity_key="user", record_id=rt.user_id, actor_user_id=rt.user_id,
                data={"session_id": str(rt.session_id)},
                category="SECURITY",
            )
            await s.commit()
        except Exception:
            pass                                                       # audit failures never become 500s
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if rt.expires_at <= now:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    user = (await s.execute(
        select(User).where(User.id == rt.user_id)
        .execution_options(audit_tenant_filter=False)
    )).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    # S2 — deactivated user cannot exchange a refresh token either. Same case-tolerance posture
    # as login above (see comment there): block on UPPER_SNAKE 'INACTIVE' from either case.
    if (user.status or "").upper() == "INACTIVE":
        raise HTTPException(status_code=401, detail="User account is inactive")

    rt.revoked_at = now                                  # rotate: kill the used token
    # T2 — preserve the session family on rotation. The new token belongs to the SAME session
    # as the one we just revoked, so a future replay of any descendant still revokes the whole tree.
    new_refresh, _new_row = await _issue_refresh_token(s, user, session_id=rt.session_id)
    # Re-stamp the tenant claim from the user's CURRENT stored tenant_id. If somehow the user has
    # been moved between tenants since the refresh token was issued, the new access token reflects
    # the new tenant — the refresh-token row also keys on user.id so it stays valid.
    token = create_access_token(str(user.id), {"email": user.email, "tenant": str(user.tenant_id)})
    # A1 remediation 2026-06-04: audit the refresh.
    await workflow.emit(
        s, tenant_id=user.tenant_id, type_="USER_TOKEN_REFRESHED",
        entity_key="user", record_id=user.id, actor_user_id=user.id,
        data={"session_id": str(rt.session_id)},
        category="SECURITY",
    )
    await s.commit()
    return TokenOut(access_token=token, refresh_token=new_refresh)


@router.post("/logout")
async def logout(body: RefreshIn, s: AsyncSession = Depends(get_owner_session)):
    """Revoke a refresh token. Idempotent: an unknown or already-revoked token still returns ok."""
    # Pre-auth lookup via owner session — refresh-token hash is cluster-unique.
    rt = (await s.execute(
        select(RefreshToken).where(RefreshToken.token_hash == _hash_token(body.refresh_token))  # tenant-filter-ok: — owner session, token hash is cluster-unique
        .execution_options(audit_tenant_filter=False)
    )).scalar_one_or_none()
    if rt and rt.revoked_at is None:
        rt.revoked_at = _utcnow()
        # A1 remediation 2026-06-04: audit the logout. We have a real user id from the token row.
        try:
            await workflow.emit(
                s, tenant_id=rt.tenant_id, type_="USER_LOGOUT",
                entity_key="user", record_id=rt.user_id, actor_user_id=rt.user_id,
                data={"session_id": str(rt.session_id)},
                category="SECURITY",
            )
        except Exception:
            pass
        await s.commit()
    return {"ok": True}


async def _user_from_api_key(raw_key: str) -> tuple[User, list[str] | None] | tuple[None, None]:
    """Resolve an X-API-Key to (the User it acts as, the key's scopes). Looks up the hash via
    the OWNER session (the request is pre-tenant), rejects missing/revoked/expired keys, and
    stamps last_used_at. Default-deny.

    T4 remediation 2026-06-04: a non-NULL `expires_at` that has passed ⇒ key is treated as
    not-found (returns (None, None) — current_user maps that to 401, matching the revoked path).
    T5 remediation 2026-06-04: returns the key's `scopes` (None or list[str]) so current_user
    can pin them to the principal for downstream scope enforcement via require_scope()."""
    async with OwnerSessionLocal() as o:
        # Pre-auth owner session: API-key hash and user-by-id are cluster-unique lookups.
        await o.connection(execution_options={"audit_tenant_filter": False})
        ak = (await o.execute(
            select(ApiKey).where(ApiKey.key_hash == _hash_token(raw_key))  # tenant-filter-ok: — owner session, key hash is cluster-unique
        )).scalar_one_or_none()
        if not ak or ak.revoked_at is not None:
            return None, None
        # T4 — reject expired keys. NULL expires_at = no expiry (backward compatible).
        if ak.expires_at is not None and ak.expires_at < _utcnow():
            return None, None
        ak.last_used_at = _utcnow()
        scopes = list(ak.scopes) if ak.scopes else None
        user = (await o.execute(select(User).where(User.id == ak.acts_as_user_id))).scalar_one_or_none()  # tenant-filter-ok: — owner session, user-by-id is cluster-unique
        await o.commit()
    return user, scopes


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
        user, scopes = await _user_from_api_key(x_api_key)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid API key")
        # T5 remediation 2026-06-04: pin the API key's scopes on the principal so endpoints
        # protected by `Depends(require_scope("…"))` can read them. Plain JWT auth (no API key)
        # leaves the attribute unset; require_scope treats that as "no scope restriction" (the
        # human principal's full RBAC grants apply unchanged). The attribute is a normal Python
        # attribute on the SQLAlchemy User instance — it never reaches the DB.
        user._api_key_scopes = scopes                              # type: ignore[attr-defined]
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
    # C1a-2: narrow SECURITY DEFINER identity lookup instead of a broad OwnerSessionLocal read of
    # app_user. The request session `s` is RLS-subject and has no tenant GUC yet (chicken-and-egg);
    # gx_auth_staff_user_by_id runs elevated (pinned search_path, static SQL) and returns ONLY (id,
    # tenant_id). The full User is re-read below under RLS once the GUC is bound.
    ident = (await s.execute(
        text("SELECT id, tenant_id FROM gx_auth_staff_user_by_id(:id)"), {"id": uid}
    )).mappings().all()
    if len(ident) != 1:
        raise HTTPException(status_code=401, detail="User not found")
    user_tenant = ident[0]["tenant_id"]

    # STRICT TENANT VALIDATION (Wave 1 — multi-tenant hardening):
    #   1. The JWT MUST carry a `tenant` claim. Legacy tokens minted before this change lacked it;
    #      they are now rejected and the client must re-login (tokens are short-lived anyway).
    #   2. The claim MUST match the user's stored tenant_id. A mismatch means the token was either
    #      forged (signature was somehow valid) or a user was moved between tenants since issuance.
    #      Either way we refuse to bind RLS — re-login required.
    jwt_tenant = payload.get("tenant")
    if jwt_tenant is None:
        raise HTTPException(status_code=401, detail="Token missing tenant claim")
    if str(user_tenant) != str(jwt_tenant):
        raise HTTPException(status_code=401, detail="Token tenant mismatch")

    # Bind RLS GUC to the user's authenticated tenant, THEN re-read the full User UNDER RLS (its own
    # row). An empty re-read means the minimal lookup's tenant disagrees with the row → fail closed.
    await set_tenant_guc(s, user_tenant)
    user = (await s.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ---- API key scope enforcement (T5 remediation 2026-06-04) ----

def require_scope(*scopes: str):
    """FastAPI dependency factory: enforce that the authenticated principal's API key carries
    at least one of the named scopes. Behavior matrix:

      - JWT (human) auth → `_api_key_scopes` unset on the user → PASS through (RBAC grants
        from access.load_grants govern; scopes are an API-key-only restriction layer).
      - API key with `scopes` NULL or empty list → PASS through (no restriction; the key acts
        with the full grants of its `acts_as_user_id`).
      - API key with a non-empty `scopes` list → at least one of the required scopes must be
        present (set intersection). Missing → 403.

    Apply alongside the existing RBAC check (load_grants + can(...)) — this dep is additive,
    not a replacement. RBAC still governs what the principal CAN do; scopes shrink that surface
    further when the caller authenticated via a key with a scope list.

    Example:
        @router.get("/invoices", dependencies=[Depends(require_scope("billing.read"))])
    """
    required = set(scopes)

    async def _dep(user: User = Depends(current_user)) -> User:
        granted = getattr(user, "_api_key_scopes", None)
        if granted is None:
            return user                                    # human / unrestricted-key principal
        if not granted:
            return user                                    # key with empty list = no restriction
        if not required.intersection(granted):
            raise HTTPException(
                status_code=403,
                detail=f"API key missing required scope (one of: {', '.join(sorted(required))})",
            )
        return user

    return _dep


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
        "avatar_pos": user.avatar_pos,
        "can_configure": can(grants, "config", "manage"),
    }
