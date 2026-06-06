"""Phase A.3 — CreditNote API (physical table).

A first-class router for the new ``credit_note`` table (DRAFT/ISSUED/APPLIED/VOID lifecycle).
Mounted at ``/api/billing/credit-notes`` so it COEXISTS with the legacy approval-gated
``/api/credit-notes`` endpoint in routers/billing.py (which still creates config-driven
Record rows under entity_key='credit_note' for the SPEC §4.5 flow). Tests for the legacy
path keep passing untouched.

Endpoints:
  * ``POST /api/billing/credit-notes`` — create DRAFT (assigns per-tenant CN-XXXXX number).
  * ``POST /api/billing/credit-notes/{id}/issue`` — DRAFT → ISSUED (sets issued_at).
  * ``POST /api/billing/credit-notes/{id}/apply`` — ISSUED → APPLIED + link to invoice +
    trigger recompute_account_balance on linked account (A.2 integration).
  * ``GET  /api/billing/credit-notes`` — paginated list with optional status/customer filters.

Auth/tenant patterns mirror routers/billing.py (load_grants/can + assert_can default-deny).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.credit_note import CreditNote
from ..models.billing import Invoice
from ..models.party import Account
from ..access import load_grants, can
from .. import workflow
from ..kernel import assert_can, AccessDenied
from ..services.account_balance import recompute_account_balance
from ..utils.refnum import next_reference_number
from .auth import current_user
from ..utils.http_errors import deny as _deny  # BL-10

router = APIRouter(prefix="/api/billing", tags=["credit-notes"])


_STATUSES = {"DRAFT", "ISSUED", "APPLIED", "VOID"}




def _iso(dt: datetime | None):
    return dt.isoformat() if dt else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _credit_note(c: CreditNote) -> dict:
    return {
        "id": str(c.id),
        "number": c.number,
        "customer_id": str(c.customer_id),
        "account_id": str(c.account_id) if c.account_id else None,
        "original_invoice_id": str(c.original_invoice_id) if c.original_invoice_id else None,
        "amount": str(c.amount),
        "reason": c.reason,
        "status": c.status,
        "issued_at": _iso(c.issued_at),
        "applied_at": _iso(c.applied_at),
        "applied_to_invoice_id": str(c.applied_to_invoice_id) if c.applied_to_invoice_id else None,
        "created_at": _iso(c.created_at),
    }


async def _next_credit_note_number(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    """Per-tenant monotonic CN-XXXXX number.

    F5 (financial-integrity Critical) — replaced the legacy SELECT COUNT(*)+1 pattern with
    next_reference_number (utils/refnum.py), which is backed by a per-(tenant, prefix) Postgres
    SEQUENCE. SEQUENCE allocation is MVCC-exempt: concurrent transactions get distinct values
    without any app-side lock, so two parallel credit-note creates can never collide on the
    same CN-XXXXX number. The width=5 matches the legacy "CN-{n+1:05d}" zero-padding so issued
    receipts keep their numbering shape.
    """
    return await next_reference_number(s, tenant_id=tenant_id, prefix="CN", width=5)


def _parse_decimal(value, field: str) -> Decimal:
    """VA-2 — required-Decimal variant. The optional one is in `_billing_shared`."""
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(422, f"'{field}' must be a decimal number")


async def _get_credit_note(s: AsyncSession, user: User, cn_id: uuid.UUID) -> CreditNote:
    cn = (await s.execute(
        select(CreditNote).where(CreditNote.id == cn_id, CreditNote.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if cn is None:
        raise HTTPException(404, "CreditNote not found")
    return cn


# ==========================================================================================
# Create / list
# ==========================================================================================

@router.get("/credit-notes")
async def list_credit_notes(
    status: str | None = None,
    customer_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int = 100,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Paginated CreditNote list. Filters: ``status``, ``customer_id``."""
    grants = await load_grants(s, user)
    if not can(grants, "credit_note", "view"):
        _deny("credit_note.view")

    if status is not None and status not in _STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 500:
        page_size = 100

    q = select(CreditNote).where(CreditNote.tenant_id == user.tenant_id)
    if status:
        q = q.where(CreditNote.status == status)
    if customer_id:
        q = q.where(CreditNote.customer_id == customer_id)
    q = q.order_by(CreditNote.created_at.desc())

    # DF-3 — count + page via canonical helpers (was inline subquery + offset()/limit()).
    from ..pagination import count_select, Page  # noqa: PLC0415 — co-located with use
    total = (await s.execute(count_select(q))).scalar_one()
    rows = (await s.execute(Page(page_size, (page - 1) * page_size).apply(q))).scalars().all()
    return {
        "page": page,
        "page_size": page_size,
        "total": int(total or 0),
        "items": [_credit_note(c) for c in rows],
    }


@router.post("/credit-notes", status_code=201)
async def create_credit_note(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a DRAFT credit note. Number auto-assigned (CN-XXXXX, per tenant).

    Body:
      {
        "customer_id": <uuid>,         # required
        "account_id":  <uuid|null>,    # optional
        "amount":      <decimal>,      # required, > 0
        "reason":      <str|null>,     # optional
        "original_invoice_id": <uuid|null>,  # optional
      }
    """
    grants = await load_grants(s, user)
    if not can(grants, "credit_note", "create"):
        _deny("credit_note.create")
    try:
        await assert_can(s, user, action="create", entity_key="credit_note",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    customer_id = payload.get("customer_id")
    if not customer_id:
        raise HTTPException(422, "customer_id is required")
    try:
        cust_uuid = uuid.UUID(str(customer_id))
    except (TypeError, ValueError):
        raise HTTPException(422, "customer_id must be a UUID")
    # Tenant-scoped customer-record check.
    cust = (await s.execute(
        select(Record).where(
            Record.id == cust_uuid,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "customer",
        )
    )).scalar_one_or_none()
    if cust is None:
        raise HTTPException(422, "customer_id does not reference a known customer")

    amount = _parse_decimal(payload.get("amount"), "amount")
    if amount <= 0:
        raise HTTPException(422, "amount must be > 0")

    original_invoice_id = payload.get("original_invoice_id")
    if original_invoice_id is not None:
        try:
            oid = uuid.UUID(str(original_invoice_id))
        except (TypeError, ValueError):
            raise HTTPException(422, "original_invoice_id must be a UUID")
        inv = (await s.execute(
            select(Invoice).where(Invoice.id == oid, Invoice.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if inv is None:
            raise HTTPException(422, "original_invoice_id does not reference a known invoice")
    else:
        oid = None

    account_id = payload.get("account_id")
    if account_id is not None:
        try:
            aid = uuid.UUID(str(account_id))
        except (TypeError, ValueError):
            raise HTTPException(422, "account_id must be a UUID")
        # M1-A Wave 2 (IDOR fix): account_id was UUID-format-checked only — verify the
        # Account row lives in the caller's tenant before linking a credit note to it.
        acc = (await s.execute(
            select(Account).where(Account.id == aid, Account.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if acc is None:
            raise HTTPException(422, "account_id does not reference a known account")
    else:
        aid = None

    number = await _next_credit_note_number(s, user.tenant_id)
    cn = CreditNote(
        tenant_id=user.tenant_id,
        customer_id=cust_uuid,
        account_id=aid,
        number=number,
        original_invoice_id=oid,
        amount=amount,
        reason=str(payload.get("reason") or "").strip()[:500] or None,
        status="DRAFT",
    )
    s.add(cn)
    await s.flush()

    await workflow.emit(s, user.tenant_id, "CREATE", "credit_note", cn.id, user.id, {
        "number": number, "amount": str(amount), "status": "DRAFT",
    })
    await s.commit()
    await s.refresh(cn)
    return _credit_note(cn)


# ==========================================================================================
# Lifecycle transitions
# ==========================================================================================

@router.post("/credit-notes/{cn_id}/issue")
async def issue_credit_note_v2(
    cn_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """DRAFT → ISSUED. Sets issued_at to now."""
    cn = await _get_credit_note(s, user, cn_id)
    grants = await load_grants(s, user)
    if not can(grants, "credit_note", "edit"):
        _deny("credit_note.edit")
    try:
        await assert_can(s, user, action="edit", entity_key="credit_note",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    if cn.status != "DRAFT":
        raise HTTPException(409, f"Cannot issue a CreditNote in status {cn.status}")

    cn.status = "ISSUED"
    cn.issued_at = _now()
    await workflow.emit(s, user.tenant_id, "TRANSITION", "credit_note", cn.id, user.id, {
        "from": "DRAFT", "to": "ISSUED",
    })
    await s.commit()
    await s.refresh(cn)
    return _credit_note(cn)


@router.post("/credit-notes/{cn_id}/apply")
async def apply_credit_note_v2(
    cn_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """ISSUED → APPLIED. Links to an invoice; triggers recompute_account_balance if account is set.

    Body: ``{"invoice_id": <uuid>}``
    """
    cn = await _get_credit_note(s, user, cn_id)
    grants = await load_grants(s, user)
    if not can(grants, "credit_note", "edit"):
        _deny("credit_note.edit")
    try:
        await assert_can(s, user, action="edit", entity_key="credit_note",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    if cn.status == "VOID":
        raise HTTPException(409, "Cannot apply a VOID CreditNote")
    if cn.status != "ISSUED":
        raise HTTPException(409, f"Cannot apply a CreditNote in status {cn.status}")

    inv_id_raw = payload.get("invoice_id")
    if not inv_id_raw:
        raise HTTPException(422, "invoice_id is required")
    try:
        inv_id = uuid.UUID(str(inv_id_raw))
    except (TypeError, ValueError):
        raise HTTPException(422, "invoice_id must be a UUID")
    inv = (await s.execute(
        select(Invoice).where(Invoice.id == inv_id, Invoice.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if inv is None:
        raise HTTPException(422, "invoice_id does not reference a known invoice")

    cn.status = "APPLIED"
    cn.applied_at = _now()
    cn.applied_to_invoice_id = inv_id

    await workflow.emit(s, user.tenant_id, "TRANSITION", "credit_note", cn.id, user.id, {
        "from": "ISSUED", "to": "APPLIED",
        "invoice_id": str(inv_id), "amount": str(cn.amount),
    })

    # A.2 integration: recompute the linked account balance. Prefer the credit note's
    # account_id, fall back to the targeted invoice's account_id.
    acc_id = cn.account_id or inv.account_id
    if acc_id is not None:
        await recompute_account_balance(s, acc_id)

    await s.commit()
    await s.refresh(cn)
    return _credit_note(cn)
