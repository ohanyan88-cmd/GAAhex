"""Phase B.1 — Payment methods API (vaulted cards).

Thin HTTP shell over ``services/payment_gateway_adapter.py``. Writes (POST / PATCH / DELETE) are
admin-gated (``config.manage`` — super_admin holds ``*``). Reads + list are admin-gated too for
v1 because the data is per-customer PII-adjacent. Mounted under ``/api/payment-methods``.

The raw card_number + cvc are received here, passed STRAIGHT through to the gateway adapter,
and then dropped — they are never persisted, logged, or echoed back. Only the safe display
bits (last4 / brand / exp_month / exp_year) + the opaque gateway_token land in the DB.

Endpoints:
  * ``POST   /api/payment-methods``           — vault a card
  * ``GET    /api/payment-methods``           — list (filters: customer_id, status, page)
  * ``GET    /api/payment-methods/{id}``      — fetch one
  * ``PATCH  /api/payment-methods/{id}``      — toggle is_default / soft-delete via status='removed'
  * ``DELETE /api/payment-methods/{id}``      — soft delete: status='removed', is_default=False
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import can, load_grants
from ..db import get_session
from ..models import User, Record
from ..models.party import Account
from ..models.payment_method import PaymentMethod
from ..services.payment_gateway_adapter import get_payment_gateway
from .auth import current_user
from ..utils.http_errors import deny as _deny  # BL-10

router = APIRouter(prefix="/api/payment-methods", tags=["payment-methods"])

_PAGE_SIZE = 100


# ==========================================================================================
# Helpers
# ==========================================================================================




def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _norm_page(page: int) -> int:
    return page if page >= 1 else 1


async def _require_admin(s: AsyncSession, user: User) -> None:
    """Writes + reads are admin-gated for v1.

    Accept ``payment_method.edit`` (purpose-built; not seeded yet, but reserved for fine-grained
    role grants later) OR ``config.manage`` (the practical super_admin gate today).
    """
    grants = await load_grants(s, user)
    if can(grants, "payment_method", "edit") or can(grants, "config", "manage"):
        return
    _deny("payment_method.edit")


async def _get_pm(s: AsyncSession, user: User, pm_id: uuid.UUID) -> PaymentMethod:
    pm = (await s.execute(
        select(PaymentMethod).where(
            PaymentMethod.id == pm_id, PaymentMethod.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if pm is None:
        raise HTTPException(404, "Payment method not found")
    return pm


async def _customer_or_422(s: AsyncSession, tenant_id, customer_id: uuid.UUID) -> None:
    """M1-A Wave 2 (IDOR fix). Verify a body-supplied customer_id refers to a CRM customer
    Record in the caller's tenant. PCI-adjacent: a card vaulted against another tenant's
    customer would be a cross-tenant data link."""
    rec = (await s.execute(
        select(Record).where(
            Record.id == customer_id,
            Record.tenant_id == tenant_id,
            Record.entity_key == "customer",
        )
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(422, "customer_id does not reference a known customer")


async def _account_or_422(s: AsyncSession, tenant_id, account_id: uuid.UUID) -> None:
    """M1-A Wave 2 (IDOR fix). Verify a body-supplied account_id refers to a billing
    Account in the caller's tenant. PCI-adjacent (see _customer_or_422)."""
    acc = (await s.execute(
        select(Account).where(Account.id == account_id, Account.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not acc:
        raise HTTPException(422, "account_id does not reference a known account")


def _serialize(pm: PaymentMethod) -> dict:
    """Public shape. Notably ABSENT: card_number, cvc, cardholder_name — those are never
    persisted in the first place."""
    return {
        "id": str(pm.id),
        "tenant_id": str(pm.tenant_id),
        "customer_id": str(pm.customer_id),
        "account_id": str(pm.account_id) if pm.account_id else None,
        "gateway": pm.gateway,
        "gateway_token": pm.gateway_token,
        "last4": pm.last4,
        "brand": pm.brand,
        "exp_month": pm.exp_month,
        "exp_year": pm.exp_year,
        "is_default": bool(pm.is_default),
        "status": pm.status,
        "created_at": _iso(pm.created_at),
        "last_used_at": _iso(pm.last_used_at),
    }


def _require_str(payload: dict, key: str) -> str:
    v = payload.get(key)
    if v is None or not str(v).strip():
        raise HTTPException(422, f"'{key}' is required")
    return str(v).strip()


def _require_int(payload: dict, key: str, *, lo: int | None = None, hi: int | None = None) -> int:
    v = payload.get(key)
    if v is None:
        raise HTTPException(422, f"'{key}' is required")
    try:
        iv = int(v)
    except (TypeError, ValueError):
        raise HTTPException(422, f"'{key}' must be an integer")
    if lo is not None and iv < lo:
        raise HTTPException(422, f"'{key}' must be >= {lo}")
    if hi is not None and iv > hi:
        raise HTTPException(422, f"'{key}' must be <= {hi}")
    return iv


async def _clear_other_defaults(
    s: AsyncSession, *, tenant_id: uuid.UUID, customer_id: uuid.UUID, exclude_id: uuid.UUID | None,
) -> None:
    """Flip every OTHER row's is_default to False for this (tenant, customer). The
    single-default invariant lives at the router boundary — callers who set is_default=True
    on a new row first call this on the customer to clear the field."""
    q = update(PaymentMethod).where(
        PaymentMethod.tenant_id == tenant_id,
        PaymentMethod.customer_id == customer_id,
        PaymentMethod.is_default.is_(True),
    )
    if exclude_id is not None:
        q = q.where(PaymentMethod.id != exclude_id)
    await s.execute(q.values(is_default=False))


# ==========================================================================================
# Endpoints
# ==========================================================================================


@router.post("", status_code=201)
async def vault_payment_method(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Vault a new card via the gateway adapter and persist a PaymentMethod row.

    Body:
      ``customer_id`` (uuid, required)
      ``account_id``  (uuid, optional)
      ``card_number`` (str, required — MEMORY-ONLY; never persisted)
      ``exp_month``   (int 1-12, required)
      ``exp_year``    (int >= 2000, required)
      ``cvc``         (str, required — MEMORY-ONLY; never persisted)
      ``cardholder_name`` (str, optional — MEMORY-ONLY; v1 doesn't persist this)
      ``is_default``  (bool, optional; default False)
    """
    await _require_admin(s, user)

    customer_id_raw = payload.get("customer_id")
    if not customer_id_raw:
        raise HTTPException(422, "'customer_id' is required")
    try:
        customer_id = uuid.UUID(str(customer_id_raw))
    except ValueError:
        raise HTTPException(422, "'customer_id' is not a valid UUID")

    account_id_raw = payload.get("account_id")
    account_id: uuid.UUID | None = None
    if account_id_raw is not None:
        try:
            account_id = uuid.UUID(str(account_id_raw))
        except ValueError:
            raise HTTPException(422, "'account_id' is not a valid UUID")

    # M1-A Wave 2 (IDOR fix): both customer_id and account_id were UUID-format-checked only.
    # Verify they live in the caller's tenant BEFORE we vault a card against them.
    await _customer_or_422(s, user.tenant_id, customer_id)
    if account_id is not None:
        await _account_or_422(s, user.tenant_id, account_id)

    card_number = _require_str(payload, "card_number")
    cvc = _require_str(payload, "cvc")
    exp_month = _require_int(payload, "exp_month", lo=1, hi=12)
    exp_year = _require_int(payload, "exp_year", lo=2000, hi=2999)
    cardholder_name = payload.get("cardholder_name")
    is_default = bool(payload.get("is_default") or False)

    # Vault via gateway adapter. Raw card_number + cvc go in; only the safe response comes out.
    gw = get_payment_gateway()
    vault_result = await gw.vault_card(
        card_number=card_number,
        exp_month=exp_month,
        exp_year=exp_year,
        cvc=cvc,
        cardholder_name=cardholder_name if isinstance(cardholder_name, str) else None,
    )

    # If is_default, clear other defaults for this customer FIRST so the invariant holds.
    if is_default:
        await _clear_other_defaults(
            s, tenant_id=user.tenant_id, customer_id=customer_id, exclude_id=None,
        )

    pm = PaymentMethod(
        tenant_id=user.tenant_id,
        customer_id=customer_id,
        account_id=account_id,
        gateway="logging",  # v1 — get_payment_gateway() always returns LoggingGateway
        gateway_token=vault_result["gateway_token"],
        last4=vault_result["last4"],
        brand=vault_result["brand"],
        exp_month=vault_result["exp_month"],
        exp_year=vault_result["exp_year"],
        is_default=is_default,
        status="active",
    )
    s.add(pm)
    await s.commit()
    await s.refresh(pm)

    # Drop the raw card_number + cvc references explicitly. They have already been dropped by
    # Python scope rules, but the explicit del is a visible "we don't keep this" marker.
    del card_number, cvc

    return _serialize(pm)


@router.get("")
async def list_payment_methods(
    customer_id: uuid.UUID | None = None,
    status: str | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated list. Filters: ``customer_id``, ``status``. Newest-first by created_at."""
    await _require_admin(s, user)
    page = _norm_page(page)

    q = select(PaymentMethod).where(PaymentMethod.tenant_id == user.tenant_id)
    if customer_id is not None:
        q = q.where(PaymentMethod.customer_id == customer_id)
    if status:
        q = q.where(PaymentMethod.status == status)
    q = q.order_by(PaymentMethod.created_at.desc())

    # DF-3 — count + page via canonical helpers.
    from ..pagination import count_select, Page  # noqa: PLC0415 — co-located with use
    total = (await s.execute(count_select(q))).scalar_one()
    rows = (await s.execute(Page(_PAGE_SIZE, (page - 1) * _PAGE_SIZE).apply(q))).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_serialize(pm) for pm in rows],
    }


@router.get("/{pm_id}")
async def get_payment_method(
    pm_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    pm = await _get_pm(s, user, pm_id)
    return _serialize(pm)


@router.patch("/{pm_id}")
async def update_payment_method(
    pm_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Patch ``is_default`` and/or ``status`` (only 'removed' allowed via PATCH).

    ``gateway_token`` and ``last4`` are immutable — attempting to PATCH them is a 422.
    """
    await _require_admin(s, user)
    pm = await _get_pm(s, user, pm_id)

    # Reject immutable-field mutations explicitly so callers get a clear error rather than a
    # silent no-op.
    for forbidden in ("gateway_token", "last4", "brand", "tenant_id", "customer_id"):
        if forbidden in payload:
            raise HTTPException(422, f"'{forbidden}' is immutable")

    if "is_default" in payload:
        target = bool(payload["is_default"])
        if target and not pm.is_default:
            # Flipping ON — clear other defaults for this customer first.
            await _clear_other_defaults(
                s, tenant_id=user.tenant_id, customer_id=pm.customer_id, exclude_id=pm.id,
            )
        pm.is_default = target

    if "status" in payload:
        new_status = str(payload["status"]).strip().lower()
        if new_status not in ("active", "removed", "expired"):
            raise HTTPException(422, f"'status' must be 'active', 'removed' or 'expired'")
        if new_status == "removed":
            # Soft-delete invariant: removed rows cannot be default.
            pm.is_default = False
        pm.status = new_status

    await s.commit()
    await s.refresh(pm)
    return _serialize(pm)


@router.delete("/{pm_id}")
async def delete_payment_method(
    pm_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Soft delete — flips ``status='removed'`` + ``is_default=False``. The row is preserved
    for audit (a customer who removed a card might later dispute a historic charge)."""
    await _require_admin(s, user)
    pm = await _get_pm(s, user, pm_id)
    pm.status = "removed"
    pm.is_default = False
    await s.commit()
    await s.refresh(pm)
    return _serialize(pm)
