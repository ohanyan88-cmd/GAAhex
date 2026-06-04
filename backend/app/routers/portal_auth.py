"""Portal authentication — customer-facing login and identity.

TENANT RESOLUTION (single-tenant mode):
  Every portal login binds to THE_TENANT_ID (see config.the_tenant_id_async()). There is no
  per-request tenant hint; the deployment is single-tenant. CustomerUser email uniqueness is
  enforced per (tenant_id, email), which under single-tenant means email is effectively unique.

TOKEN BOUNDARY:
  Portal JWTs include `"kind": "customer"`. The staff `current_user` dependency (routers/auth.py)
  rejects any token with this claim. Symmetrically, `current_customer` here rejects any token
  that lacks `kind == "customer"`.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import the_tenant_id_async
from ..db import get_session, get_owner_session, set_tenant_guc, OwnerSessionLocal
from ..models.customer_user import CustomerUser
from ..models.record import Record
from ..security import verify_password, create_access_token, decode_token

router = APIRouter(prefix="/portal", tags=["portal"])
_oauth2 = OAuth2PasswordBearer(tokenUrl="/portal/auth/login", auto_error=False)


class PortalLoginIn(BaseModel):
    email: str
    password: str


class PortalTokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    customer: dict


# ---- endpoints ----

@router.post("/auth/login", response_model=PortalTokenOut)
async def portal_login(body: PortalLoginIn, s: AsyncSession = Depends(get_owner_session)):
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
    return PortalTokenOut(
        access_token=token,
        customer={
            "id": str(cu.id),
            "email": cu.email,
            "name": cu.name,
            "customer_id": str(cu.customer_id),
            "tenant_id": str(cu.tenant_id),
        },
    )


async def current_customer(
    token: str | None = Depends(_oauth2),
    s: AsyncSession = Depends(get_session),
) -> CustomerUser:
    """Authenticate a portal request. Rejects staff tokens (missing kind='customer' → 401).
    Sets the tenant RLS GUC so all subsequent queries in this request are tenant-scoped."""
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(401, "Invalid token")

    if payload.get("kind") != "customer":
        raise HTTPException(401, "Not a portal token")

    try:
        cu_id = uuid.UUID(payload["sub"])
        tenant_id = uuid.UUID(payload["tenant_id"])
    except (KeyError, ValueError):
        raise HTTPException(401, "Malformed token")

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
    cu: CustomerUser = Depends(current_customer),
    s: AsyncSession = Depends(get_session),
):
    """Portal logout — revokes EVERY existing portal token for this customer_user.

    T1 remediation 2026-06-04: portal tokens are stateless JWTs (no server-side refresh family),
    so we can't revoke them individually. Instead we stamp `customer_user.token_not_before` to
    now(); the `current_customer` dep then rejects any portal token whose `iat` is before that
    cutoff. Effect: every outstanding portal session for this user is killed in a single column
    write. Idempotent (calling logout twice just moves the cutoff forward by milliseconds).

    The customer reload here re-binds to the request session `s` (the tenant GUC is now set by
    the auth dep), mirroring routers/me.py:_own_row — the `cu` from Depends was loaded on the
    detached owner session and can't be UPDATEd through `s` directly without a reload.
    """
    row = (await s.execute(
        select(CustomerUser).where(CustomerUser.id == cu.id)
    )).scalar_one_or_none()  # noqa: tenant-filter — RLS-scoped self-row reload, tenant GUC set by current_customer
    if not row:
        # Should never happen for an authed caller; treat as already-logged-out (idempotent).
        return {"ok": True}
    row.token_not_before = datetime.now(timezone.utc)
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
