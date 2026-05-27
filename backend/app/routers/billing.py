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
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.billing import Subscription, Invoice, InvoiceLine, Payment
from ..models.job import JobRun
from ..models.product import Product
from ..access import load_grants, can
from .. import workflow, notify_hooks
from .auth import current_user
from .records import _node_path, _node_paths, _paginate     # reuse the exact records scope primitives + paging
from .notifications import emit_notification

router = APIRouter(prefix="/api", tags=["billing"])

_CYCLES = {"monthly", "yearly"}
_METHODS = {"cash", "card", "transfer"}
_LINE_KINDS = {"charge", "discount", "tax"}
DEFAULT_DUE_DAYS = 14


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
    }
    if lines is not None:
        out["lines"] = [_line(l) for l in lines]
    if paid_total is not None:
        out["paid_total"] = paid_total
        out["balance"] = max(0, inv.total - paid_total)
    return out


def _payment(p: Payment) -> dict:
    return {"id": str(p.id), "invoice_id": str(p.invoice_id), "amount": p.amount,
            "method": p.method, "paid_at": _iso(p.paid_at), "note": p.note, "created_at": _iso(p.created_at)}


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
    n = (await s.execute(
        select(func.count()).select_from(Invoice).where(Invoice.tenant_id == tenant_id)
    )).scalar_one()
    return f"INV-{n + 1:05d}"


# ==========================================================================================
# Subscriptions
# ==========================================================================================

@router.get("/subscriptions")
async def list_subscriptions(customer: uuid.UUID | None = None, status: str | None = None,
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
    """Edit plan presentation/pricing. Status moves go through cancel/suspend/resume, not here."""
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")

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
    await s.commit()
    await s.refresh(sub)
    return _sub(sub)


async def _sub_status_change(s, user, sub_id, new_status: str, allowed_from: set):
    sub = await _get_sub(s, user, sub_id)
    grants = await load_grants(s, user)
    if not can(grants, "subscription", "edit", await _node_path(s, sub.owner_node_id)):
        _deny("subscription.edit")
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
    rows = (await s.execute(q.order_by(Invoice.created_at))).scalars().all()
    visible = [r for r in rows
               if can(grants, "invoice", "view", paths.get(str(r.owner_node_id)) if r.owner_node_id else None)]
    return [_invoice(r) for r in _paginate(visible, limit, offset)]


@router.post("/invoices", status_code=201)
async def create_invoice(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a manual DRAFT invoice with lines; total is computed from the lines."""
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, user.primary_node_id)
    if not can(grants, "invoice", "create", owner_path):
        _deny("invoice.create")

    customer_id = payload.get("customer_id")
    await _customer_or_422(s, user.tenant_id, customer_id)
    lines_in = payload.get("lines") or []
    if not isinstance(lines_in, list) or not lines_in:
        raise HTTPException(422, "at least one line is required")

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
    if inv.status != "DRAFT":
        raise HTTPException(409, f"Only a DRAFT invoice can be issued (status is {inv.status})")

    now = _now()
    due = _parse_dt((payload or {}).get("due_at"), "due_at", optional=True) or (now + timedelta(days=DEFAULT_DUE_DAYS))
    inv.status = "ISSUED"
    inv.issued_at = now
    inv.due_at = due
    await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
                        {"from": "DRAFT", "to": "ISSUED", "due_at": _iso(due)})
    await s.commit()
    await s.refresh(inv)
    return _invoice(inv, await _invoice_lines(s, inv.id))


# ==========================================================================================
# Payments
# ==========================================================================================

@router.post("/invoices/{inv_id}/payments", status_code=201)
async def add_payment(inv_id: uuid.UUID, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Record a payment against an invoice. When total paid ≥ invoice total, flip it to PAID.
    Refuses payment on DRAFT/PAID/VOID invoices (409)."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "payment", "create", await _node_path(s, inv.owner_node_id)):
        _deny("payment.create")

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
                         "paid_sum": int(paid_sum), "invoice_status": inv.status})
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
    """Transition an ISSUED or OVERDUE invoice to VOID. DRAFT and PAID are rejected with 409."""
    inv = await _get_invoice(s, user, inv_id)
    grants = await load_grants(s, user)
    if not can(grants, "invoice", "edit", await _node_path(s, inv.owner_node_id)):
        _deny("invoice.edit")
    if inv.status not in {"ISSUED", "OVERDUE"}:
        raise HTTPException(409, f"Cannot void an invoice with status {inv.status}")
    old_status = inv.status
    inv.status = "VOID"
    await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
                        {"from": old_status, "to": "VOID"})
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

    prod = Product(
        tenant_id=user.tenant_id, key=key, name=name, description=payload.get("description"),
        default_amount=_money(payload.get("default_amount", 0), "default_amount"), cycle=cycle,
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
    prod = await _get_product(s, user, product_id)
    prod.active = False
    await workflow.emit(s, user.tenant_id, "transition", "product", prod.id, user.id,
                        {"to": "retired", "active": False})
    await s.commit()
    await s.refresh(prod)
    return _product(prod)


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

    started = _now()
    try:
        now = _now()
        issued = (await s.execute(
            select(Invoice).where(Invoice.tenant_id == user.tenant_id, Invoice.status == "ISSUED")
        )).scalars().all()
        newly = []
        for inv in issued:
            if inv.due_at is not None and inv.due_at < now:
                inv.status = "OVERDUE"
                await workflow.emit(s, user.tenant_id, "transition", "invoice", inv.id, user.id,
                                    {"from": "ISSUED", "to": "OVERDUE"})
                newly.append(inv)
        summary = {"checked": len(issued), "marked_overdue": len(newly)}
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
