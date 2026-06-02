"""Usage metering + rating API (doc 18) — additive depth over billing.

Record metered usage (per ISP: GB, minutes, messages, overage), then *rate* it: roll a
subscription's unrated usage into InvoiceLines on a DRAFT invoice, recomputing the total with
billing's own logic. Money is integer luma. Tenant + org scoped; `usage.*` permission gate.

NOTE: fixed paths under /api ("/api/usage"), so register BEFORE records.router ("/api/{slug}").
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.usage import UsageRecord
from ..models.billing import Subscription, Invoice, InvoiceLine
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .. import workflow
from .auth import current_user
from .records import _node_path, _node_paths, _paginate
# reuse billing's exact helpers so usage→billing stays consistent (numbering, totals, serialization)
from .billing import _invoice_total, _invoice_lines, _next_invoice_number, _invoice, _get_sub, _get_invoice, _money, _parse_dt

router = APIRouter(prefix="/api/usage", tags=["usage"])

METRICS = {"gb", "minutes", "messages", "other"}


def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt):
    return dt.isoformat() if dt else None


def _quantity(v) -> float:
    try:
        q = float(v)
    except (TypeError, ValueError):
        raise HTTPException(422, "quantity must be a number")
    if q < 0:
        raise HTTPException(422, "quantity must be >= 0")
    return q


def _opt_uuid(v, field: str):
    if v in (None, ""):
        return None
    try:
        return uuid.UUID(str(v))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(422, f"'{field}' must be a uuid")


def _serialize(u: UsageRecord) -> dict:
    return {
        "id": str(u.id),
        "subscription_id": str(u.subscription_id) if u.subscription_id else None,
        "service_id": str(u.service_id) if u.service_id else None,
        "owner_node_id": str(u.owner_node_id) if u.owner_node_id else None,
        "metric": u.metric,
        "quantity": float(u.quantity) if u.quantity is not None else 0,
        "unit_rate": u.unit_rate,
        "amount": u.amount,
        "period_start": _iso(u.period_start),
        "period_end": _iso(u.period_end),
        "rated": u.rated,
        "invoice_id": str(u.invoice_id) if u.invoice_id else None,
        "created_at": _iso(u.created_at),
    }


# ---- endpoints (before /api/{slug}) ----

@router.post("", status_code=201)
async def record_usage(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Record a metered usage event; amount = round(quantity * unit_rate) in luma."""
    metric = payload.get("metric")
    if metric not in METRICS:
        raise HTTPException(422, f"metric must be one of {sorted(METRICS)}")
    quantity = _quantity(payload.get("quantity"))
    unit_rate = _money(payload.get("unit_rate", 0), "unit_rate")
    service_id = _opt_uuid(payload.get("service_id"), "service_id")

    sub = None
    sub_id = payload.get("subscription_id")
    if sub_id:
        sub = (await s.execute(
            select(Subscription).where(Subscription.id == sub_id, Subscription.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not sub:
            raise HTTPException(422, "subscription_id does not reference a known subscription")

    owner_node = sub.owner_node_id if sub else user.primary_node_id
    grants = await load_grants(s, user)
    if not can(grants, "usage", "create", await _node_path(s, owner_node)):
        _deny("usage.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="usage",
                         region_id=getattr(sub, "region_id", None) if sub else None,
                         owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    amount = int(round(quantity * unit_rate))
    u = UsageRecord(
        tenant_id=user.tenant_id, owner_node_id=owner_node,
        subscription_id=sub_id, service_id=service_id,
        metric=metric, quantity=quantity, unit_rate=unit_rate, amount=amount,
        period_start=_parse_dt(payload.get("period_start"), "period_start", optional=True),
        period_end=_parse_dt(payload.get("period_end"), "period_end", optional=True),
        rated=False,
    )
    s.add(u)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CREATE", "usage", u.id, user.id,
                        {"metric": metric, "quantity": quantity, "amount": amount,
                         "subscription_id": str(sub_id) if sub_id else None})
    await s.commit()
    await s.refresh(u)
    return _serialize(u)


@router.get("")
async def list_usage(
    subscription: uuid.UUID | None = None,
    service: uuid.UUID | None = None,
    rated: bool | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List usage records (newest first), tenant + org scoped."""
    grants = await load_grants(s, user)
    if not can(grants, "usage", "view"):
        _deny("usage.view")
    q = select(UsageRecord).where(UsageRecord.tenant_id == user.tenant_id)
    if subscription is not None:
        q = q.where(UsageRecord.subscription_id == subscription)
    if service is not None:
        q = q.where(UsageRecord.service_id == service)
    if rated is not None:
        q = q.where(UsageRecord.rated.is_(rated))
    rows = (await s.execute(q.order_by(UsageRecord.created_at.desc()))).scalars().all()

    paths = await _node_paths(s, user.tenant_id)
    visible = [
        u for u in rows
        if can(grants, "usage", "view", paths.get(str(u.owner_node_id)) if u.owner_node_id else None)
    ]
    return [_serialize(u) for u in _paginate(visible, limit, offset)]


@router.post("/rate", status_code=201)
async def rate_usage(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Rate a subscription's UNRATED usage into invoice lines on a DRAFT invoice (created if
    `invoice_id` is not given), recompute the invoice total with billing's own logic, and mark the
    usage rated + linked. Atomic; emits an audit Event. The usage→billing bridge."""
    sub_id = payload.get("subscription_id")
    if not sub_id:
        raise HTTPException(422, "subscription_id is required")
    sub = await _get_sub(s, user, sub_id)               # 404 if unknown
    grants = await load_grants(s, user)
    owner_path = await _node_path(s, sub.owner_node_id)
    if not can(grants, "usage", "edit", owner_path):    # rating mutates usage rows
        _deny("usage.edit")
    if not can(grants, "invoice", "create", owner_path):  # …and writes billing
        _deny("invoice.create")
    # SPEC §0.2 default-deny (Step 7) — kernel gate before mutation (rate touches usage + invoice).
    try:
        await assert_can(s, user, action="edit", entity_key="usage",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
        await assert_can(s, user, action="create", entity_key="invoice",
                         region_id=getattr(sub, "region_id", None), owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    usages = (await s.execute(
        select(UsageRecord).where(
            UsageRecord.tenant_id == user.tenant_id,
            UsageRecord.subscription_id == sub_id,
            UsageRecord.rated.is_(False),
        ).order_by(UsageRecord.created_at)
    )).scalars().all()
    if not usages:
        raise HTTPException(409, "No unrated usage for this subscription")

    # target invoice: an existing DRAFT, or a fresh DRAFT for the subscription's customer
    inv_id = payload.get("invoice_id")
    if inv_id:
        inv = await _get_invoice(s, user, inv_id)       # 404 if unknown
        if inv.status != "DRAFT":
            raise HTTPException(409, f"Can only rate usage into a DRAFT invoice (status is {inv.status})")
    else:
        number = await _next_invoice_number(s, user.tenant_id)
        inv = Invoice(
            tenant_id=user.tenant_id, owner_node_id=sub.owner_node_id, customer_id=sub.customer_id,
            number=number, status="DRAFT", total=0,
        )
        s.add(inv)
        await s.flush()

    # one charge line per usage record (rates can differ per row); link + flag each usage
    for u in usages:
        s.add(InvoiceLine(
            tenant_id=user.tenant_id, invoice_id=inv.id, kind="charge",
            description=f"Usage {u.metric}: {float(u.quantity)} @ {u.unit_rate} luma/unit",
            quantity=1, unit_amount=u.amount, line_total=u.amount,
        ))
        u.rated = True
        u.invoice_id = inv.id
    await s.flush()

    # recompute the invoice total with billing's exact rule (Σcharge − Σdiscount + Σtax, clamped ≥ 0)
    lines = await _invoice_lines(s, inv.id)
    inv.total = _invoice_total([(l.kind, l.line_total) for l in lines])

    await workflow.emit(s, user.tenant_id, "rate", "invoice", inv.id, user.id,
                        {"subscription_id": str(sub_id), "usage_rated": len(usages), "total": inv.total})
    await s.commit()
    await s.refresh(inv)
    return {"invoice": _invoice(inv, lines), "usage_rated": len(usages)}
