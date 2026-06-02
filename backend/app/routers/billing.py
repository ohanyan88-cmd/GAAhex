"""Billing API: Subscriptions · Invoices · Payments (Phase-2 opener).

Tenant + org scoped exactly like the generic record router (org-scope filter + entity-style
permission gate `subscription.*` / `invoice.*` / `payment.*`), and every mutation emits an audit
Event through `workflow.emit` (the same chokepoint records use). Money is integer luma — see
models/billing.py.

NOTE on namespacing: these are FIXED paths under /api ("/api/subscriptions", "/api/invoices").
The generic record router serves "/api/{slug}", so this router MUST be registered BEFORE
records.router in main.py. See the wiring report.
"""
import calendar
import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.billing import Subscription, Invoice, InvoiceLine, Payment
from ..models.job import JobRun
from ..models.product import Product
from ..models.product_version import ProductVersion
from ..access import load_grants, can
from .. import workflow, notify_hooks
from ..kernel import (
    assert_can, AccessDenied,
    assert_writer_owns_record_firstclass, OwnerViolation,
    assert_approval_or_raise, ApprovalRequired,
    create_approval_request, find_approved_approval, mark_approval_executed,
)
from ..services.product_versions import current_version_for, mint_new_version
from ..services.account_balance import recompute_account_balance
from ..services.invoice_lock import ensure_invoice_mutable
from ..services.payment_allocation import (
    allocate_payment_atomic,
    outstanding_for_invoice,
)
from ..models.payment_allocation import PaymentAllocation
from ..models.payment_method import PaymentMethod
from ..services.payments import (
    PaymentGatewayCardError,
    PaymentGatewayConfigError,
    PaymentGatewayConnectionError,
    PaymentGatewayError,
    PaymentGatewayRateLimitError,
    PaymentGatewayValidationError,
    get_payment_gateway,
)
from ..utils.refnum import next_reference_number
from .auth import current_user
from .records import _node_path, _node_paths, _paginate     # reuse the exact records scope primitives + paging
from .notifications import emit_notification

router = APIRouter(prefix="/api", tags=["billing"])

_CYCLES = {"monthly", "yearly"}
_METHODS = {"cash", "card", "transfer"}
_LINE_KINDS = {"charge", "discount", "tax"}
_PRORATION_MODES = {"daily", "secondly", "none"}
DEFAULT_DUE_DAYS = 14


def _parse_decimal_opt(value, field: str) -> Decimal | None:
    """Optional Decimal parser for Phase A.1 product pricing — None passes through; bad input → 422."""
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(422, f"'{field}' must be a decimal number")


def _signed_line_total(kind: str, line_total: int) -> int:
    """Discounts subtract; charges and tax add. (line_total itself is stored as a positive luma.)"""
    return -line_total if kind == "discount" else line_total


def _invoice_total(lines) -> int:
    """total = Σ(charge) − Σ(discount) + Σ(tax), clamped at 0 (never negative).
    `lines` is an iterable of (kind, line_total)."""
    return max(0, sum(_signed_line_total(k, lt) for k, lt in lines))


# ---- shared helpers ----

def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


async def _owner_gate(s: AsyncSession, *, table_name: str, writer_module: str) -> None:
    """SPEC §0.1 first-class table owner check (helper).

    billing.py writes three first-class tables (invoice, payment, subscription) plus the
    product catalog; each mutation declares its own writer_module per call so the SPEC §2.2
    matrix is enforced per-table even though they share one router file. OwnerViolation → 409.
    """
    try:
        await assert_writer_owns_record_firstclass(
            s, table_name=table_name, writer_module=writer_module,
        )
    except OwnerViolation as e:
        raise HTTPException(409, detail=str(e))


def _money(value, field: str) -> int:
    """Coerce an incoming amount to a non-negative integer (luma)."""
    try:
        iv = int(value)
    except (TypeError, ValueError):
        raise HTTPException(422, f"'{field}' must be an integer amount in luma")
    if iv < 0:
        raise HTTPException(422, f"'{field}' must be >= 0")
    return iv


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _record_job_run(s: AsyncSession, user: User, job_key: str, status: str, summary: dict,
                    started_at: datetime, owner_node_id=None) -> None:
    """Add a JobRun row (J96 job log) to the session. Caller commits. Used by the batch jobs
    (run-dunning, run-cycle) to record when they ran and what they did."""
    s.add(JobRun(
        tenant_id=user.tenant_id, owner_node_id=owner_node_id, job_key=job_key, status=status,
        summary=summary, actor_user_id=user.id, started_at=started_at, finished_at=_now(),
    ))


def _add_cycle(dt: datetime, cycle: str) -> datetime:
    """Advance a date by one billing cycle, clamping the day to the target month's length."""
    if cycle == "yearly":
        year, month = dt.year + 1, dt.month
    else:  # monthly
        year = dt.year + (dt.month // 12)
        month = dt.month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


async def _customer_or_422(s: AsyncSession, tenant_id, customer_id):
    """Validate that customer_id refers to an existing CRM customer Record in this tenant."""
    if customer_id is None:
        return
    rec = (await s.execute(
        select(Record).where(Record.id == customer_id, Record.tenant_id == tenant_id, Record.entity_key == "customer")
    )).scalar_one_or_none()
    if not rec:
        raise HTTPException(422, "customer_id does not reference a known customer")


# ---- serializers ----

def _iso(dt: datetime | None):
    return dt.isoformat() if dt else None


def _sub(x: Subscription) -> dict:
    return {
        "id": str(x.id),
        "customer_id": str(x.customer_id) if x.customer_id else None,
        "product_id": str(x.product_id) if x.product_id else None,
        "owner_node_id": str(x.owner_node_id) if x.owner_node_id else None,
        "plan_name": x.plan_name,
        "amount": x.amount,
        "cycle": x.cycle,
        "status": x.status,
        "started_at": _iso(x.started_at),
        "next_invoice_at": _iso(x.next_invoice_at),
        "created_at": _iso(x.created_at),
    }


def _line(l: InvoiceLine) -> dict:
    return {"id": str(l.id), "kind": l.kind, "description": l.description, "quantity": l.quantity,
            "unit_amount": l.unit_amount, "line_total": l.line_total}


def _product(p: Product) -> dict:
    return {"id": str(p.id), "key": p.key, "name": p.name, "description": p.description,
            "default_amount": p.default_amount, "cycle": p.cycle, "active": p.active,
            # Phase A.1 — Decimal MRC/NRC + proration mode. Serialize Decimals as strings to
            # preserve precision across the JSON boundary; clients can re-parse with Decimal().
            "recurring_price": str(p.recurring_price) if p.recurring_price is not None else None,
            "one_time_price": str(p.one_time_price) if p.one_time_price is not None else None,
            "proration_mode": p.proration_mode,
            "created_at": _iso(p.created_at)}


def _invoice(inv: Invoice, lines: list[InvoiceLine] | None = None,
             paid_total: int | None = None) -> dict:
    out = {
        "id": str(inv.id),
        "number": inv.number,
        "customer_id": str(inv.customer_id) if inv.customer_id else None,
        "owner_node_id": str(inv.owner_node_id) if inv.owner_node_id else None,
        "status": inv.status,
        "period_start": _iso(inv.period_start),
        "period_end": _iso(inv.period_end),
        "total": inv.total,
        "issued_at": _iso(inv.issued_at),
        "due_at": _iso(inv.due_at),
        "created_at": _iso(inv.created_at),
        # Phase A.3 — immutability marker. NULL = mutable; NOT NULL = locked.
        "posted_at": _iso(inv.posted_at),
        "locked_by": str(inv.locked_by) if inv.locked_by else None,
    }
    if lines is not None:
        out["lines"] = [_line(l) for l in lines]
    if paid_total is not None:
        out["paid_total"] = paid_total
        out["balance"] = max(0, inv.total - paid_total)
    return out


def _payment(p: Payment) -> dict:
    return {"id": str(p.id), "invoice_id": str(p.invoice_id), "amount": p.amount,
            "method": p.method, "paid_at": _iso(p.paid_at), "note": p.note,
            "refunded_amount": int(p.refunded_amount or 0),
            "refunded_at": _iso(p.refunded_at) if p.refunded_at else None,
            "created_at": _iso(p.created_at)}


# ---- loaders (tenant + scope enforced) ----

async def _get_sub(s, user: User, sub_id) -> Subscription:
    sub = (await s.execute(
        select(Subscription).where(Subscription.id == sub_id, Subscription.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(404, "Subscription not found")
    return sub


async def _get_invoice(s, user: User, inv_id) -> Invoice:
    inv = (await s.execute(
        select(Invoice).where(Invoice.id == inv_id, Invoice.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    return inv


async def _invoice_lines(s, invoice_id) -> list[InvoiceLine]:
    return list((await s.execute(
        select(InvoiceLine).where(InvoiceLine.invoice_id == invoice_id)
    )).scalars().all())


async def _next_invoice_number(s, tenant_id) -> str:
    """Per-tenant invoice number (INV-NNNNN). Backed by the atomic per-tenant per-prefix
    Postgres SEQUENCE in ``app.utils.refnum.next_reference_number`` — replaces the legacy
    SELECT COUNT(*)+1 (race-prone) with ``nextval()`` (MVCC-exempt, no collisions)."""
    return await next_reference_number(s, tenant_id=tenant_id, prefix="INV", width=5)


# ==========================================================================================
# Subscriptions
# ==========================================================================================

@router.get("/subscriptions")
async def list_subscriptions(customer: uuid.UUID | None = None, status: str | None = None,
                             since: Optional[date] = None,
                             limit: int = 200, offset: int = 0,
                             user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "view"):
        _deny("subscription.view")
    paths = await _node_paths(s, user.tenant_id)
    q = select(Subscription).where(Subscription.tenant_id == user.tenant_id)
    if customer:
        q = q.where(Subscription.customer_id == customer)
    if status:
        q = q.where(Subscription.status == status)
    if since is not None:
        since_dt = datetime.combine(since, time.min, tzinfo=timezone.utc)
        q = q.where(Subscription.created_at >= since_dt)
    rows = (await s.execute(q.order_by(Subscription.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "subscription", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_sub(r) for r in _paginate(visible, limit, offset)]


@router.post("/subscriptions", status_code=201)
async def create_subscription(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "subscription", "create", owner_path):
        _deny("subscription.create")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="subscription",
                         region_id=payload.get("region_id"), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # optional catalog plan: copies name/amount/cycle defaults, all still overridable per subscription
    product_id = payload.get("product_id")
    prod = None
    if product_id:
        prod = (await s.execute(
            select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not prod:
            raise HTTPException(422, "product_id does not reference a known product")

    plan_name = (payload.get("plan_name") or (prod.name if prod else "") or "").strip()
    if not plan_name:
        raise HTTPException(422, "plan_name is required")
    cycle = payload.get("cycle") or (prod.cycle if prod else "monthly")
    if cycle not in _CYCLES:
        raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
    amount_in = payload.get("amount")
    if amount_in is None and prod is not None:
        amount = prod.default_amount
    else:
        amount = _money(amount_in if amount_in is not None else 0, "amount")
    customer_id = payload.get("customer_id")
    await _customer_or_422(s, user.tenant_id, customer_id)

    started = _now()
    sub = Subscription(
        tenant_id=user.tenant_id, owner_node_id=user.primary_node_id, customer_id=customer_id,
        product_id=product_id, plan_name=plan_name, amount=amount, cycle=cycle, status="ACTIVE",
        started_at=started, next_invoice_at=_add_cycle(started, cycle),
    )
    s.add(sub)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "subscription", sub.id, user.id,
                        {"plan_name": plan_name, "amount": amount, "cycle": cycle,
                         "product_id": str(product_id) if product_id else None})
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


@router.get("/subscriptions/{sub_id}")
async def get_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "view", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.view")
    return _sub(sub)


@router.patch("/subscriptions/{sub_id}")
async def update_subscription(sub_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit plan presentation/pricing. Status moves go through cancel/suspend/resume, not here.

    SPEC §4.5 mandatory-approval gate: a subscription PATCH that mutates the tariff
    (plan_name / amount / cycle) is a `contract_change` per SPEC §4.5 and requires an
    APPROVED Approval row covering this subscription. The next_invoice_at-only edit
    (a billing schedule tweak — does not change what the customer is paying) is exempt.
    First call parks a PENDING approval and returns 202; the follow-up after the
    `/decide` flips it APPROVED performs the mutation and consumes the approval.
    """
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="subscription",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # SPEC §4.5 — `contract_change`. Trigger when the tariff changes (plan_name, amount or
    # cycle). Pure next_invoice_at tweaks are not a contract change, so they pass through.
    tariff_change = any(k in payload for k in ("plan_name", "amount", "cycle"))
    approved_approval = None
    if tariff_change:
        try:
            await assert_approval_or_raise(
                s, tenant_id=user.tenant_id,
                action_type="contract_change",
                target_entity_key="subscription",
                target_record_id=sub.id,
            )
        except ApprovalRequired:
            approval = await create_approval_request(
                s, tenant_id=user.tenant_id,
                action_type="contract_change",
                requested_by_user_id=user.id,
                target_entity_key="subscription",
                target_record_id=sub.id,
                payload={k: payload[k] for k in ("plan_name", "amount", "cycle") if k in payload},
            )
            await s.commit()
            raise HTTPException(202, detail={
                "status": "approval_required",
                "approval_id": str(approval.id),
                "action_type": "contract_change",
            })
        approved_approval = await find_approved_approval(
            s, tenant_id=user.tenant_id,
            action_type="contract_change",
            target_entity_key="subscription",
            target_record_id=sub.id,
        )

    changed: dict = {}
    if "plan_name" in payload:
        v = (payload["plan_name"] or "").strip()
        if not v:
            raise HTTPException(422, "plan_name cannot be empty")
        sub.plan_name = v
        changed["plan_name"] = v
    if "amount" in payload:
        sub.amount = _money(payload["amount"], "amount")
        changed["amount"] = sub.amount
    if "cycle" in payload:
        if payload["cycle"] not in _CYCLES:
            raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
        sub.cycle = payload["cycle"]
        changed["cycle"] = sub.cycle
    if "next_invoice_at" in payload:
        sub.next_invoice_at = _parse_dt(payload["next_invoice_at"], "next_invoice_at")
        changed["next_invoice_at"] = _iso(sub.next_invoice_at)

    await workflow.emit(s, user.tenant_id, "update", "subscription", sub.id, user.id, {"changed": changed})
    if approved_approval is not None:
        await mark_approval_executed(s, approval_id=approved_approval.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


async def _sub_status_change(s, user, sub_id, new_status: str, allowed_from: set):
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")
    # SPEC §0.1 single-owner (first-class) — only Billing Accounts may write subscription.
    await _owner_gate(s, table_name="subscription", writer_module="Billing Accounts")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation; covers cancel/suspend/resume.
    try:
        await assert_can(s, user, action="edit", entity_key="subscription",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if sub.status not in allowed_from:
        raise HTTPException(409, f"Cannot move subscription from {sub.status} to {new_status}")
    frm = sub.status
    sub.status = new_status
    await workflow.emit(s, user.tenant_id, "transition", "subscription", sub.id, user.id,
                        {"from": frm, "to": new_status})
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


@router.post("/subscriptions/{sub_id}/cancel")
async def cancel_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "CANCELLED", {"ACTIVE", "SUSPENDED"})


@router.post("/subscriptions/{sub_id}/suspend")
async def suspend_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "SUSPENDED", {"ACTIVE"})


@router.post("/subscriptions/{sub_id}/resume")
async def resume_subscription(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    return await _sub_status_change(s, user, sub_id, "ACTIVE", {"SUSPENDED"})


@router.post("/subscriptions/{sub_id}/generate-invoice", status_code=201)
async def generate_invoice(sub_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a DRAFT invoice for the subscription's current period and advance its next_invoice_at.
    Requires invoice.create (this mints an invoice)."""
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "create", await _node_path(s, sub.owner_node_id)):
        _deny("invoice.create")
    # SPEC §0.1 single-owner (first-class) — only Invoices may write invoice. The subscription's
    # next_invoice_at is bumped below as the canonical Billing-Run side-effect on the
    # Billing-Accounts-owned subscription (SPEC §2.2 "Invoice — Created From: Billing Run").
    await _owner_gate(s, table_name="invoice", writer_module="Invoices")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="invoice",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    if sub.status == "CANCELLED":
        raise HTTPException(409, "Cannot generate an invoice for a CANCELLED subscription")

    period_start = sub.next_invoice_at or sub.started_at or _now()
    period_end = _add_cycle(period_start, sub.cycle)
    number = await _next_invoice_number(s, user.tenant_id)
    inv = Invoice(
        tenant_id=user.tenant_id, owner_node_id=sub.owner_node_id, customer_id=sub.customer_id,
        number=number, period_start=period_start, period_end=period_end, status="DRAFT", total=sub.amount,
    )
    s.add(inv)
    await s.flush()
    line = InvoiceLine(tenant_id=user.tenant_id, invoice_id=inv.id, description=sub.plan_name,
                       quantity=1, unit_amount=sub.amount, line_total=sub.amount)
    s.add(line)
    sub.next_invoice_at = period_end                      # advance the schedule
    await workflow.emit(s, user.tenant_id, "create", "invoice", inv.id, user.id,
                        {"number": number, "total": sub.amount, "from_subscription": str(sub.id)})
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))


# ==========================================================================================
# Invoices
# ==========================================================================================

@router.get("/invoices")
async def list_invoices(customer: uuid.UUID | None = None, status: str | None = None,
                        since: Optional[date] = None,
                        limit: int = 200, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
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
    await workflow.emit(s, user.tenant_id, "create", "invoice", inv.id, user.id,
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
    await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
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

def _allocation(a: PaymentAllocation) -> dict:
    return {
        "id": str(a.id),
        "payment_id": str(a.payment_id),
        "invoice_id": str(a.invoice_id),
        "amount": str(a.amount),
        "applied_at": _iso(a.applied_at),
        "applied_by": str(a.applied_by) if a.applied_by else None,
    }


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
        select(PaymentAllocation)
        .where(PaymentAllocation.invoice_id == inv.id)
        .order_by(PaymentAllocation.applied_at)
    )).scalars().all()
    return [_allocation(r) for r in rows]


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
            raise HTTPException(202, detail={
                "status": "approval_required",
                "approval_id": str(approval.id),
                "action_type": "payment_adjust",
            })
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

    paid_sum = (await s.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(Payment.invoice_id == inv.id)
    )).scalar_one()
    if paid_sum >= inv.total:
        inv.status = "PAID"

    await workflow.emit(s, user.tenant_id, "payment", "invoice", inv.id, user.id,
                        {"payment_id": str(pay.id), "amount": amount, "method": method,
                         "paid_sum": int(paid_sum), "invoice_status": inv.status,
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
        raise HTTPException(202, detail={
            "status": "approval_required",
            "approval_id": str(approval.id),
            "action_type": "refund",
        })

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


# ==========================================================================================
# Credit Notes (SPEC §4.5 path 'credit_note'; SPEC §2.2 owner = "Invoices")
# ==========================================================================================
# Credit notes are config-driven Records (entity_key='credit_note'), not a physical billing
# table — fields {number, customer, invoice_id, amount} live in `record.data` JSONB. The
# generic record CRUD at /api/credit-notes serves reads; this dedicated POST overrides the
# write path so the §4.5 approval gate + invoice linkage + cumulative-amount validation run
# before the row lands. Financial immutability (DELETE blocked) is enforced by the
# `prevent_delete_credit_note_record` trigger in migration f1a3b8d27e64.


def _credit_note(r: Record) -> dict:
    d = dict(r.data or {})
    return {
        "id": str(r.id),
        "entity_key": r.entity_key,
        "status": r.status,
        "number": d.get("number"),
        "invoice_id": d.get("invoice_id"),
        "customer_id": d.get("customer_id"),
        "amount": int(d.get("amount") or 0),
        "reason": d.get("reason"),
        "created_at": _iso(r.created_at),
    }


async def _credited_total(s: AsyncSession, invoice_id: uuid.UUID, tenant_id: uuid.UUID) -> int:
    """Sum of all non-VOID credit_note amounts already issued against `invoice_id` (luma)."""
    rows = (await s.execute(
        select(Record).where(
            Record.tenant_id == tenant_id,
            Record.entity_key == "credit_note",
        )
    )).scalars().all()
    total = 0
    inv_str = str(invoice_id)
    for r in rows:
        d = r.data or {}
        if d.get("invoice_id") == inv_str and (r.status or "ISSUED") != "VOID":
            total += int(d.get("amount") or 0)
    return total


async def _next_credit_note_number(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    n = (await s.execute(
        select(func.count()).select_from(Record).where(
            Record.tenant_id == tenant_id,
            Record.entity_key == "credit_note",
        )
    )).scalar_one()
    return f"CN-{n + 1:05d}"


@router.post("/credit-notes", status_code=200)
async def issue_credit_note(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """SPEC §4.5 path 'credit_note' — issue a credit note against an existing invoice.

    Body: {"invoice_id": uuid, "amount": int_luma, "reason": str (optional), "number": str (optional)}

    Gates:
      1. assert_can('create', 'credit_note') — Step 7 default-deny matrix.
      2. SPEC §2.2 owner gate: writer_module='Invoices' (credit notes are owned by Invoices).
      3. SPEC §4.5 approval gate: first call → 202 with PENDING approval; after APPROVED a
         second call inserts the Record and marks the approval EXECUTED.

    Validation (SPEC §0.3 financial immutability — credits accumulate, never replace):
      - amount > 0 and ≤ (invoice.total - already_credited_non_void)
      - the credit_note row, once issued, is DB-trigger-immune to DELETE
        (prevent_delete_credit_note_record, f1a3b8d27e64)
    """
    try:
        inv_id = uuid.UUID(str(payload.get("invoice_id") or ""))
    except (TypeError, ValueError):
        raise HTTPException(422, "invoice_id must be a UUID")
    inv = await _get_invoice(s, user, inv_id)

    # Step 7 layer-1 default-deny.
    try:
        await assert_can(s, user, action="create", entity_key="credit_note",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    # First-class owner gate (SPEC §0.1 / §2.2).
    await _owner_gate(s, table_name="credit_note", writer_module="Invoices")

    # Validate credit amount.
    try:
        credit_amount = int(payload.get("amount", 0))
    except (TypeError, ValueError):
        raise HTTPException(422, "amount must be an integer (luma)")
    if credit_amount <= 0:
        raise HTTPException(422, "amount must be > 0")

    already_credited = await _credited_total(s, inv.id, user.tenant_id)
    max_creditable = int(inv.total) - already_credited
    if credit_amount > max_creditable:
        raise HTTPException(
            422,
            f"credit {credit_amount} exceeds remaining creditable {max_creditable} on invoice {inv.number}",
        )

    reason = str(payload.get("reason") or "").strip()[:500]

    # SPEC §4.5 approval gate.
    try:
        await assert_approval_or_raise(
            s, tenant_id=user.tenant_id,
            action_type="credit_note",
            target_entity_key="invoice",
            target_record_id=inv.id,
        )
    except ApprovalRequired:
        approval = await create_approval_request(
            s, tenant_id=user.tenant_id,
            action_type="credit_note",
            requested_by_user_id=user.id,
            target_entity_key="invoice",
            target_record_id=inv.id,
            payload={
                "invoice_id": str(inv.id),
                "invoice_number": inv.number,
                "amount": credit_amount,
                "currency_minor": "luma",
                "reason": reason,
                "already_credited": already_credited,
                "invoice_total": int(inv.total),
            },
        )
        await s.commit()
        raise HTTPException(202, detail={
            "status": "approval_required",
            "approval_id": str(approval.id),
            "action_type": "credit_note",
        })

    # Approval exists — find + consume it.
    approved = await find_approved_approval(
        s, tenant_id=user.tenant_id,
        action_type="credit_note",
        target_entity_key="invoice",
        target_record_id=inv.id,
    )

    # Insert the credit_note Record (entity_key='credit_note', status='ISSUED').
    number = str(payload.get("number") or "").strip() or await _next_credit_note_number(s, user.tenant_id)
    cn = Record(
        tenant_id=user.tenant_id,
        entity_key="credit_note",
        owner_node_id=inv.owner_node_id,
        status="ISSUED",
        data={
            "number": number,
            "invoice_id": str(inv.id),
            "invoice_number": inv.number,
            "customer_id": str(inv.customer_id) if inv.customer_id else None,
            "amount": credit_amount,
            "reason": reason,
        },
    )
    s.add(cn)
    await s.flush()

    await workflow.emit(s, user.tenant_id, "create", "credit_note", cn.id, user.id, {
        "invoice_id": str(inv.id),
        "invoice_number": inv.number,
        "amount": credit_amount,
        "already_credited": already_credited,
        "new_total_credited": already_credited + credit_amount,
        "reason": reason,
    })

    if approved is not None:
        await mark_approval_executed(s, approval_id=approved.id, actor_user_id=user.id)
    await s.commit()
    await s.refresh(cn)
    return _credit_note(cn)


@router.get("/invoices/{inv_id}/payments")
async def list_invoice_payments(inv_id: uuid.UUID, user: User = Depends(current_user),
                                s: AsyncSession = Depends(get_session)):
    """List all payments recorded against one invoice."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "payment", "view", await _node_path(s, inv.owner_node_id)):
        _deny("payment.view")
    payments = (await s.execute(
        select(Payment).where(Payment.invoice_id == inv.id).order_by(Payment.paid_at)
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
    await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
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
# Product / Plan catalog
#   Reads (list/get) are open to any authenticated tenant user — the catalog isn't sensitive and
#   agents need it to pick a plan. Writes (create/update/retire) require config.manage.
# ==========================================================================================

async def _get_product(s, user: User, product_id) -> Product:
    prod = (await s.execute(
        select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not prod:
        raise HTTPException(404, "Product not found")
    return prod


@router.get("/products")
async def list_products(active: bool | None = None, limit: int = 200, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    q = select(Product).where(Product.tenant_id == user.tenant_id)
    if active is not None:
        q = q.where(Product.active.is_(active))
    rows = (await s.execute(q.order_by(Product.name))).scalars().all()
    return [_product(p) for p in _paginate(rows, limit, offset)]


@router.post("/products", status_code=201)
async def create_product(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (catalog/config).
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    key = (payload.get("key") or "").strip()
    name = (payload.get("name") or "").strip()
    if not key or not name:
        raise HTTPException(422, "key and name are required")
    cycle = payload.get("cycle", "monthly")
    if cycle not in _CYCLES:
        raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
    clash = (await s.execute(
        select(Product).where(Product.tenant_id == user.tenant_id, Product.key == key)
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"A product with key '{key}' already exists")

    # Phase A.1 — optional Decimal pricing + proration mode. Parsed defensively (None passes through).
    rp = _parse_decimal_opt(payload.get("recurring_price"), "recurring_price")
    ot = _parse_decimal_opt(payload.get("one_time_price"), "one_time_price")
    pm = payload.get("proration_mode", "daily")
    if pm not in _PRORATION_MODES:
        raise HTTPException(422, f"proration_mode must be one of {sorted(_PRORATION_MODES)}")

    prod = Product(
        tenant_id=user.tenant_id, key=key, name=name, description=payload.get("description"),
        default_amount=_money(payload.get("default_amount", 0), "default_amount"), cycle=cycle,
        recurring_price=rp, one_time_price=ot, proration_mode=pm,
        active=bool(payload.get("active", True)),
    )
    s.add(prod)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "product", prod.id, user.id, {"key": key, "name": name})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


@router.patch("/products/{product_id}")
async def update_product(product_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    prod = await _get_product(s, user, product_id)

    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        prod.name = v
    if "description" in payload:
        prod.description = payload["description"]
    if "default_amount" in payload:
        prod.default_amount = _money(payload["default_amount"], "default_amount")
    if "cycle" in payload:
        if payload["cycle"] not in _CYCLES:
            raise HTTPException(422, f"cycle must be one of {sorted(_CYCLES)}")
        prod.cycle = payload["cycle"]
    # Phase A.1 — Decimal pricing + proration mode are PATCH-mutable.
    if "recurring_price" in payload:
        prod.recurring_price = _parse_decimal_opt(payload["recurring_price"], "recurring_price")
    if "one_time_price" in payload:
        prod.one_time_price = _parse_decimal_opt(payload["one_time_price"], "one_time_price")
    if "proration_mode" in payload:
        if payload["proration_mode"] not in _PRORATION_MODES:
            raise HTTPException(422, f"proration_mode must be one of {sorted(_PRORATION_MODES)}")
        prod.proration_mode = payload["proration_mode"]
    if "active" in payload:
        prod.active = bool(payload["active"])

    await workflow.emit(s, user.tenant_id, "update", "product", prod.id, user.id, {"key": prod.key})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


@router.post("/products/{product_id}/retire")
async def retire_product(product_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Soft-retire a product (active=False). Existing subscriptions referencing it are untouched."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    # SPEC §0.1 single-owner (first-class) — only Product Catalog may write product.
    await _owner_gate(s, table_name="product", writer_module="Product Catalog")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="manage", entity_key="product",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    prod = await _get_product(s, user, product_id)
    prod.active = False
    await workflow.emit(s, user.tenant_id, "transition", "product", prod.id, user.id,
                        {"to": "retired", "active": False})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


# ==========================================================================================
# Phase A.1 — Product versioning. Mint a new version when pricing/spec changes; list history.
# Reads open to any tenant user; writes require `config.manage` (admin).
# ==========================================================================================

def _serialize_version(v: ProductVersion) -> dict:
    return {
        "id": str(v.id),
        "product_id": str(v.product_id),
        "version_no": v.version_no,
        "effective_from": _iso(v.effective_from),
        "effective_to": _iso(v.effective_to),
        "recurring_price": str(v.recurring_price) if v.recurring_price is not None else None,
        "one_time_price": str(v.one_time_price) if v.one_time_price is not None else None,
        "cycle": v.cycle,
        "spec_json": dict(v.spec_json or {}),
        "superseded_by_id": str(v.superseded_by_id) if v.superseded_by_id else None,
        "created_at": _iso(v.created_at),
    }


@router.get("/products/{product_id}/versions")
async def list_product_versions(
    product_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List every minted version of a product, ordered by ``version_no`` ascending."""
    await _get_product(s, user, product_id)  # 404 + tenant check
    rows = (await s.execute(
        select(ProductVersion)
        .where(ProductVersion.product_id == product_id)
        .order_by(ProductVersion.version_no)
    )).scalars().all()
    return [_serialize_version(v) for v in rows]


@router.post("/products/{product_id}/versions", status_code=201)
async def create_product_version(
    product_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Mint a new ProductVersion. Closes the prior open version's ``effective_to`` and chains it."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")
    prod = await _get_product(s, user, product_id)

    attrs: dict = {
        # If caller didn't supply, snapshot the product's CURRENT values — that's the typical
        # "mint a version after editing the product" flow.
        "recurring_price": payload.get("recurring_price", prod.recurring_price),
        "one_time_price": payload.get("one_time_price", prod.one_time_price),
        "cycle": payload.get("cycle", prod.cycle),
        "spec_json": payload.get("spec_json") or {
            "key": prod.key,
            "name": prod.name,
            "description": prod.description,
            "default_amount": prod.default_amount,
            "cycle": prod.cycle,
            "recurring_price": str(prod.recurring_price) if prod.recurring_price is not None else None,
            "one_time_price": str(prod.one_time_price) if prod.one_time_price is not None else None,
            "proration_mode": prod.proration_mode,
            "active": bool(prod.active),
        },
    }
    v = await mint_new_version(s, product_id, attrs, actor=user.id)
    await s.commit()
    await s.refresh(v)
    return _serialize_version(v)


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
                await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
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


# ---- date parsing (after the routes that use it; module-level fn is fine) ----

def _parse_dt(value, field: str, optional: bool = False):
    if value in (None, ""):
        if optional:
            return None
        raise HTTPException(422, f"'{field}' is required")
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"'{field}' must be an ISO datetime")
    return dt
