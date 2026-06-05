"""Portal authentication — customer-facing login and identity.

TENANT RESOLUTION (single-tenant mode):
  Every portal login binds to THE_TENANT_ID (see config.the_tenant_id_async()). There is no
  per-request tenant hint; the deployment is single-tenant. CustomerUser email uniqueness is
  enforced per (tenant_id, email), which under single-tenant means email is effectively unique.

TOKEN BOUNDARY:
  Portal JWTs include `"kind": "customer"`. The staff `current_user` dependency (routers/auth.py)
  rejects any token with this claim. Symmetrically, `current_customer` here rejects any token
  that lacks `kind == "customer"`.

S4 Stage 2 (2026-06-04) — HttpOnly cookie safe default. Three modes, controlled by
`settings.portal_auth_mode` ("header" | "cookie" | "both"):
  * header — DEV-DEFAULT — legacy bearer-only flow. PRODUCTION-FORBIDDEN.
  * cookie — HttpOnly cookie only. Bearer header is REJECTED (prevents fallback escape).
             CSRF double-submit (X-CSRF-Token header) required on mutating verbs.
  * both   — cookie + bearer both issued; prefers cookie on read. Migration window only.
             CSRF token still required on mutating verbs (we can't know which the caller
             used at the dep layer, so we assume cookie).

CSRF SCHEME (cookie / both modes):
  We use the double-submit cookie pattern with the JWT itself as the token (SHA-256 hash, hex,
  64 chars). The cookie is HttpOnly; the SPA can't read it. On login we ALSO return the token
  hash in the JSON body so the SPA can stash it in memory and echo it back on every mutating
  request via the `X-CSRF-Token` header. The middleware/dep compares the header against the
  SHA-256 of the cookie value — a CSRF attacker from a different origin can't read either
  side, so they can't construct a matching pair.
"""
import hashlib
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings, the_tenant_id_async
from ..db import get_session, get_owner_session, set_tenant_guc, OwnerSessionLocal
from ..models.customer_user import CustomerUser
from ..models.record import Record
from ..security import verify_password, create_access_token, decode_token

router = APIRouter(prefix="/portal", tags=["portal"])
_oauth2 = OAuth2PasswordBearer(tokenUrl="/portal/auth/login", auto_error=False)

PORTAL_COOKIE_NAME = "gaahex_portal_session"
PORTAL_CSRF_HEADER = "X-CSRF-Token"
_CSRF_REQUIRED_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _csrf_token_for(jwt_value: str) -> str:
    """Derive the double-submit CSRF token from the JWT. SHA-256 hex — 64 chars, deterministic,
    one-way (a stolen CSRF token cannot be reversed to the JWT)."""
    return hashlib.sha256(jwt_value.encode("utf-8")).hexdigest()


def _portal_auth_mode() -> str:
    """Lowercased portal_auth_mode, with safe fallback to 'header'."""
    return (settings.portal_auth_mode or "header").lower()


def _set_portal_cookie(response: Response, token: str) -> None:
    """Set the HttpOnly portal session cookie. Path-scoped to /portal so it never leaks to
    staff /api routes that live on the same origin.

    `secure=True` is conditional on the production environment because http://localhost dev
    + tests run plaintext — a Secure-only cookie wouldn't ride those requests and every
    test would 401. In production ENVIRONMENT=production flips the flag on; the production
    contract refuses to boot without portal_auth_mode in {cookie, both} (config.py).
    """
    response.set_cookie(
        key=PORTAL_COOKIE_NAME,
        value=token,
        max_age=settings.access_token_minutes * 60,
        httponly=True,
        secure=(settings.environment == "production"),
        samesite="lax",
        path="/portal",
    )


class PortalLoginIn(BaseModel):
    email: str
    password: str


class PortalTokenOut(BaseModel):
    # In "cookie"-only mode the access_token field is the empty string and the SPA must rely
    # on the cookie. In "header" / "both" mode the SPA receives the JWT for Authorization
    # header use. csrf_token is set in "cookie" / "both" mode so the SPA can echo it back.
    access_token: str
    token_type: str = "bearer"
    customer: dict
    csrf_token: str | None = None


# ---- endpoints ----

@router.post("/auth/login", response_model=PortalTokenOut)
async def portal_login(
    body: PortalLoginIn,
    response: Response,
    s: AsyncSession = Depends(get_owner_session),
):
    tenant_id = await the_tenant_id_async()

    cu = (await s.execute(
        select(CustomerUser).where(
            CustomerUser.tenant_id == tenant_id,
            CustomerUser.email == body.email,
        )
    )).scalar_one_or_none()

    if not cu or not verify_password(body.password, cu.password_hash):
        raise HTTPException(401, "Invalid credentials")
    if not cu.is_active:
        raise HTTPException(403, "Account is inactive")

    cu.last_login_at = datetime.now(timezone.utc)
    await s.commit()

    token = create_access_token(str(cu.id), {
        "kind": "customer",
        "customer_id": str(cu.customer_id),
        "tenant_id": str(cu.tenant_id),
    })

    mode = _portal_auth_mode()
    csrf_token: str | None = None

    # In cookie / both mode set the HttpOnly cookie + derive a CSRF token the SPA echoes back.
    if mode in {"cookie", "both"}:
        _set_portal_cookie(response, token)
        csrf_token = _csrf_token_for(token)

    # In pure cookie mode we suppress the access_token in the JSON body — the SPA must rely
    # exclusively on the cookie (which is HttpOnly, unreachable from JS). Header / both modes
    # keep the legacy shape so existing fixtures/SPAs are unaffected.
    body_token = "" if mode == "cookie" else token

    return PortalTokenOut(
        access_token=body_token,
        customer={
            "id": str(cu.id),
            "email": cu.email,
            "name": cu.name,
            "customer_id": str(cu.customer_id),
            "tenant_id": str(cu.tenant_id),
        },
        csrf_token=csrf_token,
    )


async def current_customer(
    request: Request,
    token: str | None = Depends(_oauth2),
    s: AsyncSession = Depends(get_session),
) -> CustomerUser:
    """Authenticate a portal request. Rejects staff tokens (missing kind='customer' → 401).
    Sets the tenant RLS GUC so all subsequent queries in this request are tenant-scoped.

    S4 Stage 2 — token-source selection by portal_auth_mode:
        cookie — read cookie ONLY; bearer header rejected even when present.
        both   — read cookie if set, else fall back to bearer header.
        header — read bearer header ONLY (legacy default; cookie ignored if somehow set).
    Mutating verbs in cookie / both mode also require a matching X-CSRF-Token header
    (double-submit pattern; see module docstring).
    """
    mode = _portal_auth_mode()

    cookie_token = request.cookies.get(PORTAL_COOKIE_NAME)

    if mode == "cookie":
        # Header-bearer is REJECTED in cookie mode — otherwise an SPA could fall back to header
        # auth and silently undo the CSRF protection.
        if token:
            raise HTTPException(401, "Authorization header not accepted in cookie mode")
        effective_token = cookie_token
    elif mode == "both":
        effective_token = cookie_token or token
    else:  # "header"
        effective_token = token

    if not effective_token:
        raise HTTPException(401, "Not authenticated")

    try:
        payload = decode_token(effective_token)
    except Exception:
        raise HTTPException(401, "Invalid token")

    if payload.get("kind") != "customer":
        raise HTTPException(401, "Not a portal token")

    try:
        cu_id = uuid.UUID(payload["sub"])
        tenant_id = uuid.UUID(payload["tenant_id"])
    except (KeyError, ValueError):
        raise HTTPException(401, "Malformed token")

    # ── CSRF double-submit check (cookie / both mode + mutating verb) ──
    # In cookie/both mode every mutating verb (POST/PUT/PATCH/DELETE) MUST carry
    # X-CSRF-Token = sha256(cookie_value). A CSRF attacker on a different origin can't read
    # either the cookie OR set a custom header from a forged form post — the pair check
    # fails closed. Skipped on GET/HEAD/OPTIONS (safe verbs) and on /auth/login (no session
    # yet to bind a token to) and /auth/logout (the very act that invalidates the session).
    if mode in {"cookie", "both"} and request.method in _CSRF_REQUIRED_METHODS:
        # Use cookie_token as the basis (not effective_token) — in "both" mode a request that
        # presented only a bearer header (no cookie) should still be CSRF-checked against
        # whatever token it presented; the attack we're blocking is cross-origin form post
        # which can't set a custom header in either case.
        csrf_basis = cookie_token or effective_token
        expected_csrf = _csrf_token_for(csrf_basis)
        supplied_csrf = request.headers.get(PORTAL_CSRF_HEADER) or ""
        if not supplied_csrf or supplied_csrf != expected_csrf:
            raise HTTPException(403, "CSRF token missing or invalid")

    # Use the owner session for the CustomerUser lookup (pre-RLS-GUC, same pattern as staff auth).
    async with OwnerSessionLocal() as o:
        # Pre-auth owner session: CustomerUser-by-id is the cluster-unique lookup.
        await o.connection(execution_options={"audit_tenant_filter": False})
        cu = (await o.execute(
            select(CustomerUser).where(CustomerUser.id == cu_id)
        )).scalar_one_or_none()

    if not cu or not cu.is_active:
        raise HTTPException(401, "Customer not found or inactive")

    # S4 — defense-in-depth: assert the customer's stored tenant matches the token claim.
    if cu.tenant_id != tenant_id:
        raise HTTPException(401, "Token/identity mismatch")

    # T1 remediation 2026-06-04: token-not-before check. A portal token issued BEFORE the
    # customer_user's token_not_before timestamp is rejected — this is how /portal/auth/logout
    # invalidates ALL outstanding portal access tokens for a user in a single column write,
    # without per-token bookkeeping (portal tokens are stateless JWTs, no refresh family).
    if cu.token_not_before is not None:
        iat_raw = payload.get("iat")
        if iat_raw is None:
            # Legacy / malformed token with no iat → can't prove it was issued after the cutoff.
            raise HTTPException(401, "Token issued before revocation cutoff")
        # PyJWT decodes `iat` as either a numeric epoch second or a datetime; coerce both shapes.
        if isinstance(iat_raw, datetime):
            iat_epoch = iat_raw.timestamp()
        else:
            try:
                iat_epoch = float(iat_raw)
            except (TypeError, ValueError):
                raise HTTPException(401, "Malformed token")
        if iat_epoch < cu.token_not_before.timestamp():
            raise HTTPException(401, "Token issued before revocation cutoff")

    await set_tenant_guc(s, tenant_id)
    return cu


@router.post("/auth/logout")
async def portal_logout(
    response: Response,
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Portal logout — revokes EVERY existing portal token for this customer_user.

    T1 remediation 2026-06-04: portal tokens are stateless JWTs (no server-side refresh family),
    so we can't revoke them individually. Instead we stamp `customer_user.token_not_before` to
    now(); the `current_customer` dep then rejects any portal token whose `iat` is before that
    cutoff. Effect: every outstanding portal session for this user is killed in a single column
    write. Idempotent (calling logout twice just moves the cutoff forward by milliseconds).

    S4 Stage 2: ALSO clears the HttpOnly cookie on the response so the browser drops its copy
    immediately — defense in depth on top of the token_not_before bump.

    The customer reload here re-binds to the request session `s` (the tenant GUC is now set by
    the auth dep), mirroring routers/me.py:_own_row — the `cu` from Depends was loaded on the
    detached owner session and can't be UPDATEd through `s` directly without a reload.
    """
    row = (await s.execute(
        select(CustomerUser).where(CustomerUser.id == cu.id)  # noqa: tenant-filter — RLS-scoped self-row reload, tenant GUC set by current_customer
    )).scalar_one_or_none()

    # Clear the cookie regardless — browser must drop its copy even if the DB row vanished.
    if _portal_auth_mode() in {"cookie", "both"}:
        response.delete_cookie(PORTAL_COOKIE_NAME, path="/portal")

    if not row:
        # Should never happen for an authed caller; treat as already-logged-out (idempotent).
        return {"ok": True}
    # Floor to integer-second resolution. JWT 'iat' (NumericDate, RFC 7519 §4.1.6)
    # is encoded as integer seconds — within the same second, an iat issued by a
    # legitimate relogin is indistinguishable from an iat that pre-dated the bump.
    # By storing tnbf as the floor of the bump second, the comparison
    # `iat < tnbf` in current_customer correctly rejects every token issued in
    # an EARLIER second while accepting a relogin in the SAME or LATER second.
    # Trade-off: a stale token issued earlier in the bump second is also accepted
    # — that's the standard sub-second logout window every JWT-based revocation
    # design accepts, in exchange for not blocking legitimate relogin for 1 sec.
    row.token_not_before = datetime.now(timezone.utc).replace(microsecond=0)
    await s.commit()
    return {"ok": True}


@router.get("/auth/me")
async def portal_me(
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    record = (await s.execute(
        select(Record).where(Record.id == cu.customer_id)
    )).scalar_one_or_none()
    customer_name = None
    if record and record.data:
        customer_name = record.data.get("name")
    return {
        "id": str(cu.id),
        "email": cu.email,
        "name": cu.name,
        "customer_id": str(cu.customer_id),
        "customer_name": customer_name,
        "tenant_id": str(cu.tenant_id),
    }
