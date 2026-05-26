"""Executive analytics / insights (fixed cross-domain KPIs over live BSS data).

COMPLEMENTS the config-driven dashboards/report-builder — this is the opinionated, fixed KPI set
computed with real SQL aggregation (func.sum/count/group_by), never Python loops over rows. Money
stays raw luma (AMD minor units); the frontend divides by 100. Read-only — no models, no migration.

Scope: gated by `analytics.view`; results are limited to the caller's org reach (the union of org
subtrees their analytics-bearing role assignments cover; a tenant-scoped grant ⇒ the whole tenant).
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, OrgNode, EntityDef, Record
from ..models.billing import Subscription, Invoice, Payment
from ..models.product import Product
from ..access import load_grants, can, _has_perm, _scope_ok
from .auth import current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ---- scope helpers ----

async def _org_reach(s: AsyncSession, user: User, grants):
    """The set of org-node ids the caller can see analytics for. None ⇒ tenant-wide (no node
    filter). Derived from the grants that actually carry analytics.view, using the same scope rule
    as access._scope_ok."""
    relevant = [g for g in grants if _has_perm(g.permissions, "analytics", "view")]
    if any(g.scope == "tenant" for g in relevant):
        return None
    nodes = (await s.execute(select(OrgNode.id, OrgNode.path).where(OrgNode.tenant_id == user.tenant_id))).all()
    return {nid for nid, path in nodes if any(_scope_ok(g.scope, g.node_path, str(path)) for g in relevant)}


def _node_cond(model, reach):
    """SQL condition list restricting `model` rows to the caller's reach (empty ⇒ no restriction).
    Null-owner rows are always included (tenant-level data isn't owned by a node)."""
    if reach is None:
        return []
    return [or_(model.owner_node_id.in_(reach), model.owner_node_id.is_(None))]


async def _gate(s: AsyncSession, user: User):
    grants = await load_grants(s, user)
    if not can(grants, "analytics", "view"):
        raise HTTPException(403, "Not allowed: analytics.view")
    return grants


def _now():
    return datetime.now(timezone.utc)


def _month_start(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _prev_month_start(mstart: datetime) -> datetime:
    return mstart.replace(year=mstart.year - 1, month=12) if mstart.month == 1 \
        else mstart.replace(month=mstart.month - 1)


def _overdue_cond(now):
    """Overdue = explicitly OVERDUE, or ISSUED and past due_at (dunning may not have run yet)."""
    return or_(Invoice.status == "OVERDUE", and_(Invoice.status == "ISSUED", Invoice.due_at < now))


# ==========================================================================================
# 1. Overview — headline KPIs in one call
# ==========================================================================================

@router.get("/overview")
async def overview(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await _gate(s, user)
    reach = await _org_reach(s, user, grants)
    t = user.tenant_id
    now = _now()
    mstart = _month_start(now)
    pmstart = _prev_month_start(mstart)
    d30, d60 = now - timedelta(days=30), now - timedelta(days=60)

    # MRR + active subscription count
    mrr, active = (await s.execute(
        select(func.coalesce(func.sum(Subscription.amount), 0), func.count())
        .where(Subscription.tenant_id == t, Subscription.status == "ACTIVE", *_node_cond(Subscription, reach))
    )).one()

    # AR outstanding (ISSUED + OVERDUE invoice totals)
    ar_outstanding = (await s.execute(
        select(func.coalesce(func.sum(Invoice.total), 0))
        .where(Invoice.tenant_id == t, Invoice.status.in_(["ISSUED", "OVERDUE"]), *_node_cond(Invoice, reach))
    )).scalar_one()

    # Overdue total + count
    overdue_total, overdue_count = (await s.execute(
        select(func.coalesce(func.sum(Invoice.total), 0), func.count())
        .where(Invoice.tenant_id == t, _overdue_cond(now), *_node_cond(Invoice, reach))
    )).one()

    # Collected this month / prev month (Payment scoped via its Invoice's owner node)
    def _collected(since, until=None):
        q = select(func.coalesce(func.sum(Payment.amount), 0)).select_from(Payment).where(
            Payment.tenant_id == t, Payment.paid_at >= since)
        if until is not None:
            q = q.where(Payment.paid_at < until)
        if reach is not None:
            q = q.join(Invoice, Invoice.id == Payment.invoice_id).where(
                or_(Invoice.owner_node_id.in_(reach), Invoice.owner_node_id.is_(None)))
        return q

    collected_this_month = (await s.execute(_collected(mstart))).scalar_one()
    collected_prev_month = (await s.execute(_collected(pmstart, mstart))).scalar_one()

    # New leads/customers in last 30d (+ prior 30d), using whichever entity exists
    lead_exists = (await s.execute(
        select(EntityDef.id).where(EntityDef.tenant_id == t, EntityDef.key == "lead")
    )).first()
    lead_key = "lead" if lead_exists else "customer"

    def _new_records(since, until=None):
        q = select(func.count()).select_from(Record).where(
            Record.tenant_id == t, Record.entity_key == lead_key, Record.created_at >= since,
            *_node_cond(Record, reach))
        if until is not None:
            q = q.where(Record.created_at < until)
        return q

    new_leads_30d = (await s.execute(_new_records(d30))).scalar_one()
    new_leads_prev_30d = (await s.execute(_new_records(d60, d30))).scalar_one()

    return {
        "mrr": int(mrr),
        "active_subscriptions": int(active),
        "ar_outstanding": int(ar_outstanding),
        "overdue_total": int(overdue_total),
        "overdue_count": int(overdue_count),
        "collected_this_month": int(collected_this_month),
        "collected_prev_month": int(collected_prev_month),
        "new_leads_30d": int(new_leads_30d),
        "new_leads_prev_30d": int(new_leads_prev_30d),
        "lead_entity": lead_key,
    }


# ==========================================================================================
# 2. Revenue trend — collected vs invoiced, last N months, zero-filled
# ==========================================================================================

@router.get("/revenue-trend")
async def revenue_trend(months: int = 6, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await _gate(s, user)
    reach = await _org_reach(s, user, grants)
    t = user.tenant_id
    months = max(1, min(int(months), 24))
    now = _now()

    # month labels, oldest → newest
    labels, y, m = [], now.year, now.month
    for _ in range(months):
        labels.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    labels.reverse()
    earliest = datetime(int(labels[0][:4]), int(labels[0][5:]), 1, tzinfo=timezone.utc)

    pm = func.to_char(func.date_trunc("month", Payment.paid_at), "YYYY-MM")
    pq = select(pm.label("m"), func.coalesce(func.sum(Payment.amount), 0)).select_from(Payment).where(
        Payment.tenant_id == t, Payment.paid_at >= earliest)
    if reach is not None:
        pq = pq.join(Invoice, Invoice.id == Payment.invoice_id).where(
            or_(Invoice.owner_node_id.in_(reach), Invoice.owner_node_id.is_(None)))
    collected = {row[0]: int(row[1]) for row in (await s.execute(pq.group_by(pm))).all()}

    im = func.to_char(func.date_trunc("month", Invoice.created_at), "YYYY-MM")
    iq = select(im.label("m"), func.coalesce(func.sum(Invoice.total), 0)).where(
        Invoice.tenant_id == t, Invoice.created_at >= earliest, *_node_cond(Invoice, reach)).group_by(im)
    invoiced = {row[0]: int(row[1]) for row in (await s.execute(iq)).all()}

    return [{"month": lab, "collected": collected.get(lab, 0), "invoiced": invoiced.get(lab, 0)} for lab in labels]


# ==========================================================================================
# 3. Subscription mix — ACTIVE subscriptions grouped by product
# ==========================================================================================

@router.get("/subscription-mix")
async def subscription_mix(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await _gate(s, user)
    reach = await _org_reach(s, user, grants)
    t = user.tenant_id
    rows = (await s.execute(
        select(Subscription.product_id, Product.name, func.count(),
               func.coalesce(func.sum(Subscription.amount), 0))
        .select_from(Subscription)
        .outerjoin(Product, Product.id == Subscription.product_id)
        .where(Subscription.tenant_id == t, Subscription.status == "ACTIVE", *_node_cond(Subscription, reach))
        .group_by(Subscription.product_id, Product.name)
    )).all()
    return [
        {"product_id": str(pid) if pid else None, "product_name": name or "Unassigned",
         "count": int(cnt), "mrr": int(total)}
        for pid, name, cnt, total in rows
    ]


# ==========================================================================================
# 4. AR aging — overdue buckets by due_at vs now (ISSUED/OVERDUE invoices)
# ==========================================================================================

@router.get("/ar-aging")
async def ar_aging(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await _gate(s, user)
    reach = await _org_reach(s, user, grants)
    t = user.tenant_id
    now = _now()
    d30, d60, d90 = now - timedelta(days=30), now - timedelta(days=60), now - timedelta(days=90)

    def bucket(cond):
        return func.coalesce(func.sum(case((cond, Invoice.total), else_=0)), 0)

    current = bucket(or_(Invoice.due_at.is_(None), Invoice.due_at >= now))
    d1_30 = bucket(and_(Invoice.due_at < now, Invoice.due_at >= d30))
    d31_60 = bucket(and_(Invoice.due_at < d30, Invoice.due_at >= d60))
    d61_90 = bucket(and_(Invoice.due_at < d60, Invoice.due_at >= d90))
    d90_plus = bucket(Invoice.due_at < d90)

    row = (await s.execute(
        select(current, d1_30, d31_60, d61_90, d90_plus)
        .where(Invoice.tenant_id == t, Invoice.status.in_(["ISSUED", "OVERDUE"]), *_node_cond(Invoice, reach))
    )).one()
    return {"current": int(row[0]), "d1_30": int(row[1]), "d31_60": int(row[2]),
            "d61_90": int(row[3]), "d90_plus": int(row[4])}
