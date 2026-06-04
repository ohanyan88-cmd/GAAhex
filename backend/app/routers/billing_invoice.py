"""Billing — Invoice endpoints (split from the original ``routers/billing.py``).

Owns the /api/invoices/* family plus /api/invoices/run-dunning. Payments-against-invoices
and credit notes live in sibling modules (billing_payment, billing_credit_note); they share
loaders via ``_billing_shared``.
"""
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.billing import Invoice, InvoiceLine, Payment
from ..models.payment_allocation import PaymentAllocation
from ..models.payment_method import PaymentMethod
from ..access import load_grants, can
from .. import workflow, notify_hooks
from ..kernel import (
    assert_can, AccessDenied,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from ..services.account_balance import recompute_account_balance
from ..services.invoice_lock import ensure_invoice_mutable
from ..services.payment_allocation import outstanding_for_invoice
from ..services.payments import (
    PaymentGatewayCardError,
    PaymentGatewayConfigError,
    PaymentGatewayConnectionError,
    PaymentGatewayError,
    PaymentGatewayRateLimitError,
    PaymentGatewayValidationError,
    get_payment_gateway,
)
from .auth import current_user, require_scope
from .records import _node_path, _node_paths, _paginate
from .notifications import emit_notification
from ._billing_shared import (
    _LINE_KINDS, DEFAULT_DUE_DAYS,
    _deny, _owner_gate, _money, _now, _record_job_run,
    _iso, _invoice, _allocation, _invoice_total,
    _get_invoice, _invoice_lines, _next_invoice_number,
    _parse_dt,
)

router = APIRouter(prefix="/api", tags=["billing"])


# ==========================================================================================
# Invoices
# ==========================================================================================

@router.get("/invoices", dependencies=[Depends(require_scope("billing.read"))])
async def list_invoices(customer: uuid.UUID | None = None, status: str | None = None,
                        since: Optional[date] = None,
                        limit: int = 200, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    # T5 remediation 2026-06-04 — PROOF-OF-CONCEPT scope enforcement.
    # `require_scope("billing.read")` short-circuits to 403 when the caller authenticated via an
    # API key whose `scopes` list is non-empty AND does not include "billing.read". JWT (human)
    # callers and unrestricted keys (scopes=NULL/[]) pass through; the existing `invoice.view`
    # RBAC check below still applies on top. Other billing endpoints intentionally NOT touched in
    # this pass — see RISKS section of the remediation output for the rollout plan.
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view"):
        _deny("invoice.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Invoice).where(Invoice.tenant_id == user.tenant_id)
    if customer:
        q = q.where(Invoice.customer_id == customer)
    if status:
        q = q.where(Invoice.status == status)
    if since is not None:
        since_dt = datetime.combine(since, time.min, tzinfo=timezone.utc)
        q = q.where(Invoice.created_at >= since_dt)
    rows = (await s.execute(q.order_by(Invoice.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "invoice", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_invoice(r) for r in _paginate(visible, limit, offset)]


@router.post("/invoices", status_code=201)
async def create_invoice(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a manual DRAFT invoice with lines; total is computed from the lines.

    SPEC §4.5 mandatory-approval gate: when the supplied discount lines sum to more than
    20% of the charge subtotal (the hardcoded `high_discount` threshold), the create requires
    an APPROVED Approval row for `high_discount` against the soon-to-be customer. We can't
    target the not-yet-created invoice — the row is keyed on the customer instead. First call
    parks a PENDING approval and returns 202; once decided APPROVED, the second call performs
    the create and consumes the approval (EXECUTED).
    """
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "invoice", "create", owner_path):
        _deny("invoice.create")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice.
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="invoice",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    customer_id = payload.get("customer_id")
    from ._billing_shared import _customer_or_422
    await _customer_or_422(s, user.tenant_id, customer_id)
    lines_in = payload.get("lines") or []
    if not isinstance(lines_in, list) or not lines_in:
        raise HTTPException(422, "at least one line is required")

    # ---- pre-validate + compute line totals so we can detect the discount-% trigger BEFORE
    # any mutation. The full line-creation pass below repeats the per-field validation; the
    # work here is just enough to compute charge_sum + discount_sum.
    charge_sum = 0
    discount_sum = 0
    for li in lines_in:
        kind = li.get("kind", "charge")
        if kind not in _LINE_KINDS:
            continue  # let the main pass surface 422
        try:
            qty_pre = int(li.get("quantity", 1))
        except (TypeError, ValueError):
            continue
        try:
            unit_pre = int(li.get("unit_amount", 0))
        except (TypeError, ValueError):
            continue
        if qty_pre <= 0 or unit_pre < 0:
            continue
        line_pre = qty_pre * unit_pre
        if kind == "charge":
            charge_sum += line_pre
        elif kind == "discount":
            discount_sum += line_pre

    # SPEC §4.5 — `high_discount`. Hardcoded threshold per spec: discount > 20% of charges.
    is_high_discount = charge_sum > 0 and (discount_sum * 100) > (20 * charge_sum)
    # When charges are 0 but discount > 0 (a pathological case the total-clamps-at-zero
    # test covers), treat it as high-discount too — the discount is effectively > 20% of any
    # positive charge subtotal it could be applied against.
    if charge_sum == 0 and discount_sum > 0:
        is_high_discount = True

    approved_approval = None
    if is_high_discount:
        # Target the customer (no invoice yet) so the approval can be applied to ANY high-
        # discount invoice for this customer — the natural target since the customer is the
        # business unit a discount is granted to. A unique target_record_id is required for
        # the gate to be specific; falling back to the customer_id is the closest match.
        target_id = customer_id if customer_id else None
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="high_discount",
                target_entity_key="customer",
                target_record_id=target_id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="high_discount",
                requested_by_user_id=user.id,
                target_entity_key="customer",
                target_record_id=target_id,
                payload={"charge_sum": charge_sum, "discount_sum": discount_sum,
                         "discount_pct": (discount_sum * 100 // charge_sum) if charge_sum else None,
                         "customer_id": str(customer_id) if customer_id else None},
            )
            await s.commit()
            raise HTTPException(202, detail={
                "status": "approval_required",
                "approval_id": str(approval.id),
                "action_type": "high_discount",
            })
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="high_discount",
            target_entity_key="customer",
            target_record_id=target_id,
        )

    number = await _next_invoice_number(s, user.tenant_id)
    inv = Invoice(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, customer_id=customer_id,
        number=number, status="DRAFT", total=0,
        period_start=_parse_dt(payload.get("period_start"), "period_start", optional=True),
        period_end=_parse_dt(payload.get("period_end"), "period_end", optional=True),
    )
    s.add(inv)
    await s.flush()

    computed = []
    for li in lines_in:
        kind = li.get("kind", "charge")
        if kind not in _LINE_KINDS:
            raise HTTPException(422, f"line kind must be one of {sorted(_LINE_KINDS)}")
        desc = (li.get("description") or "").strip()
        if not desc:
            raise HTTPException(422, "each line needs a description")
        qty = int(li.get("quantity", 1))
        if qty <= 0:
            raise HTTPException(422, "line quantity must be >= 1")
        unit = _money(li.get("unit_amount", 0), "unit_amount")
        line_total = qty * unit
        computed.append((kind, line_total))
        s.add(InvoiceLine(tenant_id=user.tenant_id, invoice_id=inv.id, kind=kind, description=desc,
                          quantity=qty, unit_amount=unit, line_total=line_total))
    inv.total = _invoice_total(computed)             # Σ(charge) − Σ(discount) + Σ(tax), clamped ≥ 0
    await workflow.emit(s, user.tenant_id, "CREATE", "invoice", inv.id, user.id,
                        {"number": number, "total": inv.total})
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))


@router.get("/invoices/{inv_id}")
async def get_invoice(inv_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.view")
    paid_total = (await s.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.invoice_id == inv.id)
    )).scalar_one()
    return _invoice(inv, await _invoice_lines(s, inv.id), paid_total=int(paid_total))


@router.post("/invoices/{inv_id}/issue")
async def issue_invoice(inv_id: uuid.UUID, payload: dict | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """DRAFT → ISSUED. Sets issued_at now and due_at (from payload or +14 days)."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "edit", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.edit")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice.
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="invoice",
                         region_id=getattr(inv, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if inv.status != "DRAFT":
        raise HTTPException(409, f"Only a DRAFT invoice can be issued (status is {inv.status})")

    now = _now()
    due = _parse_dt((payload or {}).get("due_at"), "due_at", optional=True) or (now + timedelta(days=DEFAULT_DUE_DAYS))
    # Phase A.3 — DRAFT → ISSUED is the post moment. Invoice is locked from now on (only
    # status / paid_at may change after; see services/invoice_lock.py). posted_at is set
    # ONCE — subsequent status transitions (PAID, OVERDUE, VOID) must not clobber it.
    ensure_invoice_mutable(inv, "status")
    ensure_invoice_mutable(inv, "issued_at")
    ensure_invoice_mutable(inv, "due_at")
    inv.status = "ISSUED"
    inv.issued_at = now
    inv.due_at = due
    if inv.posted_at is None:
        inv.posted_at = now
        inv.locked_by = user.id
    await workflow.emit(s, user.tenant_id, "TRANSITION", "invoice", inv.id, user.id,
                        {"from": "DRAFT", "to": "ISSUED", "due_at": _iso(due)})
    # Phase A.2 — recompute the associated account's balance now that this invoice is billed.
    # Skip silently when account_id is null (additive Stage-1 — many rows still link via customer_id only).
    if inv.account_id is not None:
        await recompute_account_balance(s, inv.account_id)
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))


# ==========================================================================================
# Phase A.3 — Outstanding balance + Allocation reads
# ==========================================================================================


@router.get("/invoices/{inv_id}/outstanding")
async def get_invoice_outstanding(
    inv_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Live outstanding snapshot for one invoice (Decimals as strings, 2 dp).

    Formula:
        outstanding = MAX(0,  invoice.total
                            - SUM(payment_allocation.amount where invoice_id)
                            - SUM(credit_note.amount where applied_to_invoice_id, status='APPLIED'))
    """
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.view")

    paid = (await s.execute(
        select(func.coalesce(func.sum(PaymentAllocation.amount), 0))
        .where(PaymentAllocation.invoice_id == inv.id)
    )).scalar_one()
    from ..models.credit_note import CreditNote as _CreditNote  # local to avoid circularity at module load
    credited = (await s.execute(
        select(func.coalesce(func.sum(_CreditNote.amount), 0))
        .where(
            _CreditNote.applied_to_invoice_id == inv.id,
            _CreditNote.status == "APPLIED",
        )
    )).scalar_one()
    total_d = Decimal(str(inv.total or 0))
    paid_d = Decimal(str(paid or 0))
    credited_d = Decimal(str(credited or 0))
    outstanding = total_d - paid_d - credited_d
    if outstanding < 0:
        outstanding = Decimal("0")

    def _fmt(d: Decimal) -> str:
        return f"{d.quantize(Decimal('0.01'))}"

    return {
        "id": str(inv.id),
        "total": _fmt(total_d),
        "paid": _fmt(paid_d),
        "credited": _fmt(credited_d),
        "outstanding": _fmt(outstanding),
    }


# ==========================================================================================
# M1-C.1 — Pay an invoice with Stripe
# ==========================================================================================


@router.post("/invoices/{inv_id}/pay-with-stripe")
async def pay_invoice_with_stripe(
    inv_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Initiate a Stripe payment for an Invoice.

    Two modes, selected by whether ``payment_method_id`` is supplied:

    * **charge** (``payment_method_id`` present) — vaulted-card off-session charge.
      Returns ``{mode='charge', status, charge_id, requires_action, next_action}``.
      On 3DS, the frontend uses ``next_action`` to surface the step-up to the user.
    * **collect** (``payment_method_id`` absent) — frontend collects a new card.
      Returns ``{mode='collect', client_secret, publishable_key}`` so Stripe Elements
      can confirm the PaymentIntent with the freshly-collected card.

    The actual "invoice → PAID" state change happens via the webhook
    (``payment_intent.succeeded``), NOT this endpoint. This endpoint only kicks the
    Stripe-side flow off; the truth source for "money landed" is Stripe → webhook.

    Validation:
      * Invoice must exist + belong to caller's tenant (404 otherwise via ``_get_invoice``)
      * Invoice status must not be PAID or VOID (409)
      * Outstanding balance must be > 0 (409)
      * If ``payment_method_id`` supplied: must be a row in caller's tenant AND its
        customer_id must match the invoice's customer_id (422)
      * Card declined → 402 (``PaymentGatewayCardError``)
      * Stripe rate-limited / unreachable → 503
      * Stripe rejected the request → 422
    """
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "payment", "create", await _node_path(s, inv.owner_node_id)):
        _deny("payment.create")

    if inv.status in ("PAID", "VOID"):
        raise HTTPException(409, f"Invoice is already {inv.status}")

    outstanding = await outstanding_for_invoice(s, inv.id)
    if outstanding <= 0:
        raise HTTPException(409, "Invoice has no outstanding balance")

    body = payload or {}
    pm_id_raw = body.get("payment_method_id")

    # Validate the optional payment_method_id BEFORE talking to Stripe — cheaper to fail
    # at our boundary than to round-trip to the gateway with a known-bad reference.
    pm_token: str | None = None
    if pm_id_raw:
        try:
            pm_uuid = uuid.UUID(str(pm_id_raw))
        except (TypeError, ValueError):
            raise HTTPException(422, "payment_method_id must be a UUID")
        pm = (await s.execute(
            select(PaymentMethod).where(
                PaymentMethod.id == pm_uuid,
                PaymentMethod.tenant_id == user.tenant_id,
            )
        )).scalar_one_or_none()
        if pm is None:
            raise HTTPException(422, "payment_method_id not found in this tenant")
        if inv.customer_id is not None and pm.customer_id != inv.customer_id:
            raise HTTPException(422, "Payment method does not belong to this invoice's customer")
        pm_token = pm.gateway_token

    # Amount in the smallest currency unit. AMD is the project default (Invoice.total is
    # already luma — AMD minor units — see models/billing.py). For Stripe's API, AMD/luma
    # already IS the smallest unit so no conversion is needed.
    amount_cents = int(outstanding)
    if amount_cents <= 0:
        raise HTTPException(409, "Invoice has no outstanding balance")

    metadata = {
        "tenant_id": str(user.tenant_id),
        "invoice_id": str(inv.id),
        "customer_ref": str(inv.customer_id) if inv.customer_id else "",
        "invoice_number": inv.number or "",
    }

    gw = get_payment_gateway()
    try:
        if pm_token:
            # Vaulted-card off-session charge. Stripe fires payment_intent.succeeded →
            # webhook → Payment row + invoice PAID.
            result = await gw.charge(
                payment_method_token=pm_token,
                amount_cents=amount_cents,
                currency="AMD",
                description=f"Invoice {inv.number}" if inv.number else None,
                customer_ref=str(inv.customer_id) if inv.customer_id else None,
                metadata=metadata,
            )
            return {
                "mode": "charge",
                "status": result.status,
                "charge_id": result.charge_id,
                "requires_action": result.status == "requires_action",
                "next_action": (result.raw or {}).get("next_action"),
            }
        # Frontend will collect a new card — return a client_secret + publishable_key.
        intent = await gw.create_payment_intent_for_collection(
            amount_cents=amount_cents,
            currency="AMD",
            customer_ref=str(inv.customer_id) if inv.customer_id else None,
            description=f"Invoice {inv.number}" if inv.number else None,
            metadata=metadata,
        )
        # Surface the publishable key so the frontend can construct the Stripe Elements
        # client without a separate /api/config round-trip. Falls back to empty string
        # (frontend will surface "payment unavailable") when not configured.
        from ..config import settings as _settings
        pk = getattr(_settings, "stripe_publishable_key", None) or ""
        return {
            "mode": "collect",
            "client_secret": intent.client_secret,
            "intent_id": intent.intent_id,
            "publishable_key": pk,
            "amount_cents": amount_cents,
            "currency": "AMD",
        }
    except PaymentGatewayCardError as e:
        # 402 Payment Required — the customer's card was declined.
        raise HTTPException(402, detail={"error": "card_declined", "code": e.code, "message": str(e)})
    except PaymentGatewayConfigError:
        # Gateway not configured (e.g. STRIPE_SECRET_KEY missing) — operator problem.
        raise HTTPException(503, "Payment gateway not configured")
    except PaymentGatewayRateLimitError:
        raise HTTPException(503, "Payment gateway rate limit hit; retry shortly")
    except PaymentGatewayConnectionError:
        raise HTTPException(503, "Payment gateway unreachable")
    except PaymentGatewayValidationError as e:
        raise HTTPException(422, f"Payment gateway rejected the request: {e}")
    except PaymentGatewayError as e:
        # Catch-all for anything we didn't bucket explicitly.
        raise HTTPException(503, f"Payment gateway error: {e}")


@router.get("/invoices/{inv_id}/allocations")
async def list_invoice_allocations(
    inv_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List every PaymentAllocation row that has been applied against this invoice."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "view", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.view")
    rows = (await s.execute(
        select(PaymentAllocation)  # noqa: tenant-filter cross-tenant — invoice tenant validated by _get_invoice on line above
        .where(PaymentAllocation.invoice_id == inv.id)
        .order_by(PaymentAllocation.applied_at)
    )).scalars().all()
    return [_allocation(r) for r in rows]


@router.post("/invoices/{inv_id}/void")
async def void_invoice(inv_id: uuid.UUID, user: User = Depends(current_user),
                       s: AsyncSession = Depends(get_session)):
    """Transition an ISSUED or OVERDUE invoice to VOID. DRAFT and PAID are rejected with 409.

    SPEC §4.5 mandatory-approval gate: voiding (cancelling) an invoice reverses billed revenue
    and so requires an APPROVED `invoice_cancel` Approval row for this invoice. First call parks
    a PENDING approval and returns 202; once decided APPROVED, the second call performs the
    void and consumes the approval (EXECUTED).
    """
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "edit", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.edit")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice.
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="invoice",
                         region_id=getattr(inv, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if inv.status not in {"ISSUED", "OVERDUE"}:
        raise HTTPException(409, f"Cannot void an invoice with status {inv.status}")

    # SPEC §4.5 — refuse the void unless an APPROVED invoice_cancel approval covers it.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="invoice_cancel",
            target_entity_key="invoice",
            target_record_id=inv.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="invoice_cancel",
            requested_by_user_id=user.id,
            target_entity_key="invoice",
            target_record_id=inv.id,
            payload={"invoice_number": inv.number, "total": inv.total, "from_status": inv.status},
        )
        await s.commit()
        raise HTTPException(202, detail={
            "status": "approval_required",
            "approval_id": str(approval.id),
            "action_type": "invoice_cancel",
        })

    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="invoice_cancel",
        target_entity_key="invoice",
        target_record_id=inv.id,
    )
    old_status = inv.status
    inv.status = "VOID"
    await workflow.emit(s, user.tenant_id, "TRANSITION", "invoice", inv.id, user.id,
                        {"from": old_status, "to": "VOID"})
    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    # Phase A.2 — recompute the account balance: a voided invoice no longer counts as billed.
    if inv.account_id is not None:
        await recompute_account_balance(s, inv.account_id)
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))


# ==========================================================================================
# Overdue / dunning
# ==========================================================================================

@router.post("/invoices/run-dunning")
async def run_dunning(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Mark ISSUED invoices past their due_at as OVERDUE; notify + audit per newly-overdue invoice.
    Idempotent (already-OVERDUE invoices aren't reconsidered). Returns {checked, marked_overdue}.
    Gated on invoice.edit (it mutates invoice status)."""
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "edit"):
        _deny("invoice.edit")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice (dunning is the
    # ISSUED → OVERDUE transition; an Invoices-internal sweep).
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (tenant-wide sweep).
    try:
        await assert_can(s, user, action="edit", entity_key="invoice",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # Phase B.2 — open a DunningCase for every account whose invoice flipped to OVERDUE.
    # open_case is idempotent (returns the existing active case for the account), so re-runs
    # never double-open. Import here to avoid an at-startup circular import with the dunning
    # router which itself imports from .billing for the legacy run-dunning shape tests.
    from ..services import dunning as dunning_service

    started = _now()
    try:
        now = _now()
        issued = (await s.execute(
            select(Invoice).where(Invoice.tenant_id == user.tenant_id, Invoice.status == "ISSUED")
        )).scalars().all()
        newly = []
        cases_opened = 0
        for inv in issued:
            if inv.due_at is not None and inv.due_at < now:
                inv.status = "OVERDUE"
                await workflow.emit(s, user.tenant_id, "TRANSITION", "invoice", inv.id, user.id,
                                    {"from": "ISSUED", "to": "OVERDUE"})
                newly.append(inv)
                # Phase B.2 hook — open a dunning case when the invoice is tied to an account.
                # Idempotent: same account → returns existing active case (no duplicate).
                if inv.account_id is not None:
                    await dunning_service.open_case(
                        s,
                        account_id=inv.account_id,
                        triggering_invoice_id=inv.id,
                        tenant_id=user.tenant_id,
                    )
                    cases_opened += 1
        summary = {"checked": len(issued), "marked_overdue": len(newly), "dunning_cases_opened": cases_opened}
        _record_job_run(s, user, "billing.run_dunning", "SUCCESS", summary, started)
        await s.commit()                              # persist status changes + the JobRun first
    except Exception as e:
        await s.rollback()
        _record_job_run(s, user, "billing.run_dunning", "ERROR", {"message": str(e)}, started)
        await s.commit()
        raise

    # Best-effort dunning notifications — a notification failure must not undo the marking above.
    # `emit_notification` is config-gated: no-op unless an `invoice.overdue` def exists & is enabled.
    try:
        for inv in newly:
            recipients = await notify_hooks.resolve_recipients(s, tenant_id=user.tenant_id, record=inv)
            for uid in recipients:
                await emit_notification(
                    s, tenant_id=user.tenant_id, def_key="invoice.overdue", user_id=uid,
                    entity_key="invoice", record_id=inv.id,
                    context={"number": inv.number, "total": inv.total, "due_at": _iso(inv.due_at)},
                )
        await s.commit()
    except Exception:
        await s.rollback()                            # marking already committed; just drop the notifies

    return summary
