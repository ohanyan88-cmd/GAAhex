"""Phase A.3 — PaymentAllocation service.

Three pure helpers the routers compose:

* ``allocate_payment(session, ...)`` — create ONE allocation row tying part (or all) of a
  Payment to an Invoice. Validates atomically: positive amount, same tenant, invoice not
  VOID, no over-allocation across all prior allocations for that payment. Then writes the
  row, flips the invoice to PAID when outstanding hits zero, and calls
  ``recompute_account_balance`` on the payment's account if linked.

* ``outstanding_for_invoice(session, invoice_id)`` — Decimal-precise live outstanding for
  one invoice. Formula:
        invoice.total
      − SUM(payment_allocation.amount WHERE invoice_id = X)
      − SUM(credit_note.amount        WHERE applied_to_invoice_id = X AND status = 'APPLIED')
  Clamped at 0 (never negative — over-payment becomes credit on the account, not negative
  outstanding on the invoice).

* ``allocate_payment_atomic(session, ...)`` — batch wrapper. Accepts a list of
  ``{invoice_id, amount}`` dicts. ALL succeed or NONE persist (single SAVEPOINT around the
  loop; on first validation failure the savepoint is rolled back and the original
  HTTPException is re-raised).

Caller owns ``await session.commit()`` — matches services/account_balance.py house style.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.billing import Invoice, Payment
from ..models.payment_allocation import PaymentAllocation
from ..models.credit_note import CreditNote
from .account_balance import recompute_account_balance


_ZERO = Decimal("0")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


async def outstanding_for_invoice(session: AsyncSession, invoice_id: uuid.UUID) -> Decimal:
    """Return the live outstanding balance on one invoice as a Decimal (clamped ≥ 0)."""
    inv_total = (await session.execute(
        select(Invoice.total).where(Invoice.id == invoice_id)
    )).scalar_one_or_none()
    if inv_total is None:
        return _ZERO

    paid = (await session.execute(
        select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
        .where(PaymentAllocation.invoice_id == invoice_id)
    )).scalar_one()

    credited = (await session.execute(
        select(func.coalesce(func.sum(CreditNote.amount), 0))
        .where(
            CreditNote.applied_to_invoice_id == invoice_id,
            CreditNote.status == "APPLIED",
        )
    )).scalar_one()

    outstanding = Decimal(str(inv_total or 0)) - Decimal(str(paid or 0)) - Decimal(str(credited or 0))
    if outstanding < _ZERO:
        return _ZERO
    return outstanding


async def allocate_payment(
    session: AsyncSession,
    *,
    payment_id: uuid.UUID,
    invoice_id: uuid.UUID,
    amount: Decimal,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> PaymentAllocation:
    """Create ONE PaymentAllocation row. Returns the persisted (flushed, not committed) row.

    Validation (raises HTTPException on failure — caller is a router):
      * amount > 0
      * payment + invoice exist + same tenant
      * invoice.status != 'VOID'
      * SUM(existing allocations for payment) + amount <= payment.amount

    Side-effects on success:
      * inserts the allocation row
      * if outstanding_for_invoice(invoice_id) <= 0 → flip invoice.status to 'PAID'
        (status is in MUTABLE_AFTER_POST_FIELDS so the post-lock allows it).
      * if payment.account_id IS NOT NULL → recompute_account_balance(payment.account_id).
        Account-balance hook integrates A.2 with A.3.
    """
    # ---- Decimal-coerce + reject non-positive. The amount may arrive as int/float/str. ----
    try:
        amount_d = Decimal(str(amount))
    except Exception:
        raise HTTPException(422, "allocation amount must be a decimal number")
    if amount_d <= _ZERO:
        raise HTTPException(422, "allocation amount must be > 0")

    # ---- Tenant-scoped fetch on both sides. ----
    pay = (await session.execute(
        select(Payment).where(Payment.id == payment_id, Payment.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if pay is None:
        raise HTTPException(404, "Payment not found")

    inv = (await session.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if inv is None:
        raise HTTPException(404, "Invoice not found")

    if inv.status == "VOID":
        raise HTTPException(409, "Cannot allocate to a VOID invoice")

    # ---- Over-allocation check: SUM existing + this one ≤ payment.amount. ----
    already_allocated = (await session.execute(
        select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
        .where(PaymentAllocation.payment_id == payment_id)
    )).scalar_one()
    already_d = Decimal(str(already_allocated or 0))
    payment_total_d = Decimal(str(pay.amount or 0))
    if already_d + amount_d > payment_total_d:
        raise HTTPException(
            409,
            f"allocation {amount_d} would over-allocate payment "
            f"(already {already_d}, payment total {payment_total_d})",
        )

    # ---- Insert allocation row. ----
    alloc = PaymentAllocation(
        tenant_id=tenant_id,
        payment_id=payment_id,
        invoice_id=invoice_id,
        amount=amount_d,
        applied_at=_utcnow(),
        applied_by=actor_id,
    )
    session.add(alloc)
    await session.flush()

    # ---- Auto-PAID flip when outstanding hits zero. `status` is in MUTABLE_AFTER_POST_FIELDS
    # so the invoice_lock gate allows this transition even after posted_at is set. ----
    outstanding = await outstanding_for_invoice(session, invoice_id)
    if outstanding <= _ZERO and inv.status != "PAID":
        inv.status = "PAID"
        await session.flush()

    # ---- A.2 integration: recompute account balance when the payment is linked to an account. ----
    resolved_account_id: uuid.UUID | None = None
    if pay.account_id is not None:
        await recompute_account_balance(session, pay.account_id)
        resolved_account_id = pay.account_id
    elif inv.account_id is not None:
        # Fall back to the invoice's account_id (mirrors the existing payment-recompute hook).
        await recompute_account_balance(session, inv.account_id)
        resolved_account_id = inv.account_id

    # ---- B.2 integration: after balance lands, cure any active dunning cases if the account
    # is now whole (current_balance >= 0). check_and_cure_for_payment is idempotent + null-safe.
    if resolved_account_id is not None:
        # Local import — avoid a cycle at module load (services.dunning pulls account_balance).
        from .dunning import check_and_cure_for_payment as _check_and_cure
        await _check_and_cure(session, account_id=resolved_account_id)

    return alloc


async def allocate_payment_atomic(
    session: AsyncSession,
    *,
    payment_id: uuid.UUID,
    allocations: list[dict],
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID | None,
) -> list[PaymentAllocation]:
    """Multi-invoice batch. ALL succeed or ALL roll back.

    ``allocations`` is a list of ``{"invoice_id": str|UUID, "amount": str|int|Decimal}``.

    Uses a SAVEPOINT around the loop. On first HTTPException, the savepoint is rolled back
    (undoing any partial inserts), and the exception is re-raised so the router returns the
    right status code unchanged.
    """
    if not allocations:
        raise HTTPException(422, "allocations list must not be empty")

    sp = await session.begin_nested()
    try:
        rows: list[PaymentAllocation] = []
        for item in allocations:
            try:
                inv_id = uuid.UUID(str(item.get("invoice_id") or ""))
            except (TypeError, ValueError):
                raise HTTPException(422, "each allocation needs a UUID invoice_id")
            amt = item.get("amount")
            if amt is None:
                raise HTTPException(422, "each allocation needs an amount")
            row = await allocate_payment(
                session,
                payment_id=payment_id,
                invoice_id=inv_id,
                amount=amt,
                tenant_id=tenant_id,
                actor_id=actor_id,
            )
            rows.append(row)
        await sp.commit()
        return rows
    except Exception:
        # Roll back the savepoint so no allocations land if any one failed.
        if sp.is_active:
            await sp.rollback()
        raise
