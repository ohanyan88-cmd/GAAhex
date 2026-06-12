"""Shared helpers, constants, serializers, and loaders for the Billing routers.

Extracted from the original god-router ``routers/billing.py`` so the subscription,
invoice, payment, credit-note, and product modules can share the exact primitives
without circular imports. This module owns nothing route-facing — every public-API
symbol that historically lived in ``routers.billing`` is re-exported by the slim
``routers/billing.py`` barrel so external importers (scheduler, seed scripts,
``routers.orders``, ``routers.usage`` …) keep working unchanged.

Underscore-prefixed filename marks it as a private sibling of the public router
modules — do not register an APIRouter from here.
"""
import calendar
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import User, Record
from ..models.billing import Subscription, Invoice, InvoiceLine, Payment
from ..models.job import JobRun
from ..models.product import Product
from ..models.product_version import ProductVersion
from ..models.payment_allocation import PaymentAllocation
from ..kernel import (
    assert_writer_owns_record_firstclass, OwnerViolation,
)
from ..utils.dt import parse_iso_dt as _parse_iso_dt_canon  # BL-5
from ..utils.refnum import next_reference_number

# VA-3 — canonical PAYMENT_METHODS lives in `app.utils.billing_constants`.
# `_METHODS` stays as the legacy alias so existing call sites (billing.py,
# billing_payment.py) keep working unchanged.
from ..utils.billing_constants import PAYMENT_METHODS as _METHODS  # noqa: E402

_CYCLES = {"monthly", "yearly"}
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
# BL-10 — `_deny` is the canonical alias. The real implementation lives in
# `app.utils.http_errors.deny` (it RAISES; do not call without expecting flow
# to interrupt). Downstream importers (`from ._billing_shared import _deny`)
# keep working unchanged.
from ..utils.http_errors import deny as _deny  # noqa: E402, F401


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


def validate_anchor_day(day: int | None) -> None:
    """H9 Stage 2 — accept None (means "derive from started_at.day") or an int in [1..31].
    Anything else → HTTPException(422). Negative, zero, > 31 all rejected. Bool sneaks past
    `isinstance(int)` so we reject it explicitly (caller almost certainly meant a number).
    """
    if day is None:
        return
    if isinstance(day, bool):
        raise HTTPException(422, "billing_anchor_day must be an integer 1..31, not a boolean")
    if not isinstance(day, int):
        raise HTTPException(422, "billing_anchor_day must be an integer 1..31")
    if day < 1 or day > 31:
        raise HTTPException(422, f"billing_anchor_day must be in 1..31; got {day}")


def _add_cycle(dt: datetime, cycle: str, anchor_day: int | None = None) -> datetime:
    """Advance a date by one billing cycle, clamping the day to the target month's length.

    H9 Stage 2 — when `anchor_day` is set, the target day is `anchor_day` (clamped to the
    target month's last day for 29..31 in short months). When `anchor_day` is None we keep
    the legacy behavior of carrying `dt.day` forward (also clamped). This means a subscription
    that started on the 15th continues billing on the 15th regardless of which month — but a
    subscription explicitly anchored to the 31st gets the last day of every short month and
    snaps back to the 31st in long ones.

    Examples:
        anchor_day=29, started 2026-01-15  → 2026-02-28 → 2026-03-29 → 2026-04-29 …
        anchor_day=31, started 2026-01-15  → 2026-01-31 → 2026-02-28 → 2026-03-31 …
        anchor_day=None, dt=2026-01-15     → 2026-02-15 → 2026-03-15 … (legacy)

    `anchor_day` is validated by the caller (via `validate_anchor_day`); we still clamp
    defensively because `Subscription.billing_anchor_day` can be NULL or any int from the DB.
    """
    if cycle == "yearly":
        year, month = dt.year + 1, dt.month
    else:  # monthly
        year = dt.year + (dt.month // 12)
        month = dt.month % 12 + 1
    last_day_of_target = calendar.monthrange(year, month)[1]
    if anchor_day is not None and 1 <= anchor_day <= 31:
        # Anchor-driven: aim for anchor_day, clamp to the target month's last day.
        day = min(anchor_day, last_day_of_target)
    else:
        # Legacy: carry dt.day forward, clamped.
        day = min(dt.day, last_day_of_target)
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
        # H9 Stage 2 — explicit anchor day on the wire; NULL = legacy derive-from-started_at.
        "billing_anchor_day": x.billing_anchor_day,
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


def _allocation(a: PaymentAllocation) -> dict:
    return {
        "id": str(a.id),
        "payment_id": str(a.payment_id),
        "invoice_id": str(a.invoice_id),
        "amount": str(a.amount),
        "applied_at": _iso(a.applied_at),
        "applied_by": str(a.applied_by) if a.applied_by else None,
    }


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
        select(InvoiceLine).where(InvoiceLine.invoice_id == invoice_id)  # tenant-filter-ok: cross-tenant — helper; caller validates invoice tenant via _get_invoice
    )).scalars().all())


async def _next_invoice_number(s, tenant_id) -> str:
    """Per-tenant invoice number (INV-NNNNN). Backed by the atomic per-tenant per-prefix
    Postgres SEQUENCE in ``app.utils.refnum.next_reference_number`` — replaces the legacy
    SELECT COUNT(*)+1 (race-prone) with ``nextval()`` (MVCC-exempt, no collisions)."""
    return await next_reference_number(s, tenant_id=tenant_id, prefix="INV", width=5)


async def _get_product(s, user: User, product_id) -> Product:
    prod = (await s.execute(
        select(Product).where(Product.id == product_id, Product.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not prod:
        raise HTTPException(404, "Product not found")
    return prod


# ---- date parsing ----
# BL-5 — single canonical parser lives in ``app.utils.dt``. The shared alias here
# keeps the billing sub-routers importing ``_parse_dt`` from `_billing_shared`
# unchanged. Do NOT redefine ``_parse_dt`` anywhere else — import from `utils.dt`
# (or, for billing modules, from this shared module which re-exports it).
_parse_dt = _parse_iso_dt_canon
