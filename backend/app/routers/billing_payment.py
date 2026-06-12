"""Billing — Payment endpoints (split from the original ``routers/billing.py``).

Owns the /api/payments family + the /api/invoices/{id}/payments family (record/list a payment
against an invoice). Allocations are co-located here because they're the Payment side of the
allocation relation (the Invoice side — read-only list — lives in billing_invoice).
"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.billing import Invoice, Payment
from ..access import load_grants, can
from .. import workflow
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from ..services.account_balance import recompute_account_balance
from ..services.payment_allocation import allocate_payment_atomic, outstanding_for_invoice
from ..utils.http_errors import approval_required  # PC-2
from .auth import current_user
from .records import _node_path, _node_paths, _paginate
from ._billing_shared import (
    _METHODS,
    _deny, _owner_gate, _money, _now,
    _payment, _allocation,
    _get_invoice,
)

router = APIRouter(prefix="/api", tags=["billing"])


@router.post("/payments/{payment_id}/allocate", status_code=200)
async def allocate_payment_endpoint(
    payment_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Atomically apply a Payment across one or more Invoices.

    Body: ``{"allocations": [{"invoice_id": <uuid>, "amount": <decimal>}, ...]}``

    ALL allocations succeed or NONE persist. The service-layer SAVEPOINT in
    services/payment_allocation.allocate_payment_atomic enforces atomicity. Each accepted
    allocation triggers the auto-PAID flip + recompute_account_balance hook.
    """
    pay = (await s.execute(
        select(Payment).where(Payment.id == payment_id, Payment.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if pay is None:
        raise HTTPException(404, "Payment not found")

    grants = await load_grants(s, user)
    if not can(grants, "payment", "edit"):
        _deny("payment.edit")
    # SPEC §0.1 single-owner — only Payments may mutate payment-side rows.
    await _owner_gate(s, table_name="payment", writer_module="Payments")
    # SPEC §0.2 default-deny.
    try:
        await assert_can(s, user, action="edit", entity_key="payment",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    allocations = payload.get("allocations")
    if not isinstance(allocations, list) or not allocations:
        raise HTTPException(422, "allocations must be a non-empty list")

    rows = await allocate_payment_atomic(
        s, payment_id=payment_id, allocations=allocations,
        tenant_id=user.tenant_id, actor_id=user.id,
    )
    await workflow.emit(s, user.tenant_id, "allocate", "payment", payment_id, user.id, {
        "count": len(rows),
        "total_allocated": str(sum((Decimal(str(r.amount)) for r in rows), Decimal("0"))),
    })
    await s.commit()
    return {"allocations": [_allocation(r) for r in rows]}


# ==========================================================================================
# Payments
# ==========================================================================================

@router.post("/invoices/{inv_id}/payments", status_code=201)
async def add_payment(inv_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Record a payment against an invoice. When total paid ≥ invoice total, flip it to PAID.
    Refuses payment on DRAFT/PAID/VOID invoices (409).

    SPEC §4.5 mandatory-approval gate: a payment line flagged `adjust=true` in the payload is a
    `payment_adjust` per SPEC §4.5 — a manual adjustment that bypasses normal collection (e.g.
    write-off, manual reconciliation, off-system payment correction). Such adjustments require
    an APPROVED Approval row covering this invoice. Standard collected payments (cash/card/
    transfer with no `adjust` flag) pass through as before.
    """
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "payment", "create", await _node_path(s, inv.owner_node_id)):
        _deny("payment.create")
    # SPEC §0.1 single-owner (first-class) — only Payments may write payment. The invoice PAID
    # flip below is the Payments → Invoices side-effect (SPEC §2.2 Payment viewable in Invoice).
    await _owner_gate(s, table_name="payment", writer_module="Payments")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="payment",
                         region_id=getattr(inv, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    if inv.status == "VOID":
        raise HTTPException(409, "Cannot pay a VOID invoice")
    if inv.status == "PAID":
        raise HTTPException(409, "Invoice is already PAID")
    if inv.status == "DRAFT":
        raise HTTPException(409, "Issue the invoice before recording a payment")

    amount = _money(payload.get("amount", 0), "amount")
    if amount <= 0:
        raise HTTPException(422, "payment amount must be > 0")
    method = payload.get("method")
    if method not in _METHODS:
        raise HTTPException(422, f"method must be one of {sorted(_METHODS)}")

    # SPEC §4.5 — `payment_adjust`. Only manual-adjustment payments (`adjust=true` in payload)
    # are gated. The standard collection path is exempt — adjustments are the high-stakes
    # operation, not collection of a posted bill.
    is_adjust = bool(payload.get("adjust"))
    approved_approval = None
    if is_adjust:
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="payment_adjust",
                target_entity_key="invoice",
                target_record_id=inv.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="payment_adjust",
                requested_by_user_id=user.id,
                target_entity_key="invoice",
                target_record_id=inv.id,
                payload={"amount": amount, "method": method, "note": payload.get("note")},
            )
            await s.commit()
            raise approval_required(approval.id, "payment_adjust")
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="payment_adjust",
            target_entity_key="invoice",
            target_record_id=inv.id,
        )

    pay = Payment(tenant_id=user.tenant_id, invoice_id=inv.id, amount=amount, method=method,
                  paid_at=_now(), note=payload.get("note"))
    s.add(pay)
    await s.flush()

    # BL-3 — single canonical PAID flip via outstanding_for_invoice.
    # The canonical helper (services/payment_allocation.invoice_balance_components) deducts
    # both refunded amounts (F3 protection) AND applied credit notes. The two prior code
    # paths used different formulas — allocation service deducted both, legacy add_payment
    # only deducted refunds. Now both routes through one source of truth.
    outstanding = await outstanding_for_invoice(s, inv.id)
    if outstanding <= 0:
        inv.status = "PAID"

    # Net retained-paid figure still useful in the audit payload for forensic traceability.
    net_paid = int(Decimal(str(inv.total or 0)) - outstanding)
    await workflow.emit(s, user.tenant_id, "payment", "invoice", inv.id, user.id,
                        {"payment_id": str(pay.id), "amount": amount, "method": method,
                         "paid_sum": net_paid, "invoice_status": inv.status,
                         "adjust": is_adjust})
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
    # Phase A.2 — recompute the account balance after a payment lands. Prefer payment.account_id
    # (Wave 1 additive link) and fall back to invoice.account_id. Skip silently when both null.
    acc_id = pay.account_id or inv.account_id
    if acc_id is not None:
        await recompute_account_balance(s, acc_id)
    await s.commit()
    await s.refresh(pay)
    return _payment(pay)


@router.post("/payments/{payment_id}/refund", status_code=200)
async def refund_payment(
    payment_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §4.5 path 'refund' — issue a refund against an existing payment.

    Body: {"amount": int_luma, "reason": str (optional)}

    Gates:
      1. assert_can('edit', 'payment') — Step 7 default-deny matrix.
      2. SPEC §4.5 mandatory approval gate: first call returns 202 with a PENDING approval row;
         after a SuperAdmin decides APPROVED via /api/mandatory-approvals/{id}/decide, a second
         call performs the refund and marks the approval EXECUTED.

    Refund mechanics (SPEC §0.3 financial immutability — UPDATE allowed, DELETE forbidden):
      - amount must be > 0 and ≤ (payment.amount - already_refunded)
      - payment.refunded_amount accumulates; payment.refunded_at set to now()
      - audit emitted with old/new refunded_amount + reason
      - the payment row itself stays; the refund is a delta
    """
    pay = (await s.execute(
        select(Payment).where(Payment.id == payment_id, Payment.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if pay is None:
        raise HTTPException(404, "Payment not found")

    # Step 7 layer-1 default-deny.
    try:
        await assert_can(s, user, action="edit", entity_key="payment",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # First-class owner gate (SPEC §0.1).
    await _owner_gate(s, table_name="payment", writer_module="Payments")

    # Validate refund amount.
    try:
        refund_amount = int(payload.get("amount", 0))
    except (TypeError, ValueError):
        raise HTTPException(422, "amount must be an integer (luma)")
    if refund_amount <= 0:
        raise HTTPException(422, "amount must be > 0")
    already_refunded = int(pay.refunded_amount or 0)
    max_refundable = int(pay.amount) - already_refunded
    if refund_amount > max_refundable:
        raise HTTPException(422, f"refund {refund_amount} exceeds remaining refundable {max_refundable}")

    # SPEC §4.5 approval gate.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="refund",
            target_entity_key="payment",
            target_record_id=pay.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="refund",
            requested_by_user_id=user.id,
            target_entity_key="payment",
            target_record_id=pay.id,
            payload={
                "payment_id": str(pay.id),
                "amount": refund_amount,
                "currency_minor": "luma",
                "reason": str(payload.get("reason") or "").strip()[:500],
                "already_refunded": already_refunded,
                "payment_total": int(pay.amount),
            },
        )
        await s.commit()
        raise approval_required(approval.id, "refund")

    # Approval exists — find + consume it.
    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="refund",
        target_entity_key="payment",
        target_record_id=pay.id,
    )

    # Apply refund as a state-change UPDATE on the payment row.
    old_refunded = already_refunded
    pay.refunded_amount = old_refunded + refund_amount
    pay.refunded_at = datetime.now(timezone.utc)

    await workflow.emit(s, user.tenant_id, "refund", "payment", pay.id, user.id, {
        "old_refunded_amount": old_refunded,
        "new_refunded_amount": pay.refunded_amount,
        "delta": refund_amount,
        "reason": str(payload.get("reason") or "").strip()[:500],
    })

    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    # Phase A.2 — recompute the account balance after a refund (a payment delta).
    # Prefer payment.account_id, fall back to the parent invoice's account_id.
    acc_id = pay.account_id
    if acc_id is None:
        inv_row = (await s.execute(
            select(Invoice.account_id).where(Invoice.id == pay.invoice_id)
        )).scalar_one_or_none()
        acc_id = inv_row
    if acc_id is not None:
        await recompute_account_balance(s, acc_id)
    await s.commit()
    await s.refresh(pay)
    return _payment(pay)


@router.get("/invoices/{inv_id}/payments")
async def list_invoice_payments(inv_id: uuid.UUID, user: User = Depends(current_user),
                                s: AsyncSession = Depends(get_session)):
    """List all payments recorded against one invoice."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "payment", "view", await _node_path(s, inv.owner_node_id)):
        _deny("payment.view")
    payments = (await s.execute(
        select(Payment).where(Payment.invoice_id == inv.id).order_by(Payment.paid_at)  # tenant-filter-ok: cross-tenant — invoice tenant validated by _get_invoice
    )).scalars().all()
    return [_payment(p) for p in payments]


@router.get("/payments")
async def list_payments(customer: uuid.UUID | None = None, limit: int = 200, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Tenant-wide payment list, optionally filtered by customer."""
    grants = await load_grants(s, user)
    if not can(grants, "payment", "view"):
        _deny("payment.view")
    paths = await _node_paths(s, user.tenant_id)

    q = (select(Payment, Invoice)
         .join(Invoice, Payment.invoice_id == Invoice.id)
         .where(Payment.tenant_id == user.tenant_id))
    if customer:
        q = q.where(Invoice.customer_id == customer)
    q = q.order_by(Payment.paid_at.desc())

    rows = (await s.execute(q)).all()
    result = []
    for pay, inv in rows:
        inv_path = paths.get(str(inv.owner_node_id)) if inv.owner_node_id else None
        if can(grants, "payment", "view", inv_path):
            result.append(pay)
    return [_payment(p) for p in _paginate(result, limit, offset)]
