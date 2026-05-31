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
from ..models import User, OrgNode, EntityDef, Record, Event
from ..models.billing import Subscription, Invoice, Payment
from ..models.product import Product
from ..models.workitem import WorkItem
from ..models.helpdesk import HelpdeskTicket
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


# ==========================================================================================
# 5. Period-over-period comparisons — week vs week, month vs month, quarter, year
# ==========================================================================================

def _wstart(dt):
    """Start of the ISO week containing `dt` (Monday 00:00 UTC)."""
    return (dt - timedelta(days=dt.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def _qstart(dt):
    q = ((dt.month - 1) // 3) * 3 + 1
    return dt.replace(month=q, day=1, hour=0, minute=0, second=0, microsecond=0)


def _prev_qstart(dt):
    qs = _qstart(dt)
    prev = qs - timedelta(days=1)
    return _qstart(prev)


def _ystart(dt):
    return dt.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _prev_ystart(dt):
    return _ystart(dt).replace(year=dt.year - 1)


@router.get("/comparisons")
async def comparisons(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Period-over-period comparisons for ALL key metrics.

    Returns this/last buckets for: week, month, quarter, year.
    Metrics: revenue (paid), invoiced, payments_count, new_customers, new_leads,
             churned_subs, active_subs, tickets_opened, workitems_completed.
    """
    grants = await _gate(s, user)
    reach = await _org_reach(s, user, grants)
    t = user.tenant_id
    now = _now()

    # --- window starts ---
    this_week    = _wstart(now)
    last_week    = this_week - timedelta(days=7)
    this_month   = _month_start(now)
    last_month   = _prev_month_start(this_month)
    this_quarter = _qstart(now)
    last_quarter = _prev_qstart(now)
    this_year    = _ystart(now)
    last_year    = _prev_ystart(now)

    async def _sum_payments(since, until):
        q = select(func.coalesce(func.sum(Payment.amount), 0)).select_from(Payment).where(
            Payment.tenant_id == t, Payment.paid_at >= since, Payment.paid_at < until)
        if reach is not None:
            q = q.join(Invoice, Invoice.id == Payment.invoice_id).where(
                or_(Invoice.owner_node_id.in_(reach), Invoice.owner_node_id.is_(None)))
        return int((await s.execute(q)).scalar_one())

    async def _count_payments(since, until):
        q = select(func.count()).select_from(Payment).where(
            Payment.tenant_id == t, Payment.paid_at >= since, Payment.paid_at < until)
        if reach is not None:
            q = q.join(Invoice, Invoice.id == Payment.invoice_id).where(
                or_(Invoice.owner_node_id.in_(reach), Invoice.owner_node_id.is_(None)))
        return int((await s.execute(q)).scalar_one())

    async def _sum_invoiced(since, until):
        return int((await s.execute(
            select(func.coalesce(func.sum(Invoice.total), 0))
            .where(Invoice.tenant_id == t, Invoice.created_at >= since, Invoice.created_at < until,
                   *_node_cond(Invoice, reach))
        )).scalar_one())

    async def _count_new(entity_key, since, until):
        return int((await s.execute(
            select(func.count()).select_from(Record).where(
                Record.tenant_id == t, Record.entity_key == entity_key,
                Record.created_at >= since, Record.created_at < until,
                *_node_cond(Record, reach))
        )).scalar_one())

    async def _count_churn(since, until):
        return int((await s.execute(
            select(func.count()).select_from(Event).where(
                Event.tenant_id == t, Event.entity_key == "subscription",
                Event.type == "transition",
                Event.data["to"].astext == "CANCELLED",
                Event.created_at >= since, Event.created_at < until)
        )).scalar_one())

    async def _count_tickets(since, until):
        return int((await s.execute(
            select(func.count()).select_from(HelpdeskTicket).where(
                HelpdeskTicket.tenant_id == t,
                HelpdeskTicket.created_at >= since, HelpdeskTicket.created_at < until)
        )).scalar_one())

    async def _count_workitems(since, until, status=None):
        q = select(func.count()).select_from(WorkItem).where(
            WorkItem.tenant_id == t,
            WorkItem.created_at >= since, WorkItem.created_at < until)
        if status:
            q = q.where(WorkItem.status == status)
        return int((await s.execute(q)).scalar_one())

    # Build bucket pairs (this, last) for each window
    windows = [
        ("week",    this_week, now,             last_week, this_week),
        ("month",   this_month, now,            last_month, this_month),
        ("quarter", this_quarter, now,          last_quarter, this_quarter),
        ("year",    this_year, now,             last_year, this_year),
    ]

    out = {}
    for label, t_s, t_e, l_s, l_e in windows:
        out[label] = {
            "revenue":       {"this": await _sum_payments(t_s, t_e),   "last": await _sum_payments(l_s, l_e)},
            "invoiced":      {"this": await _sum_invoiced(t_s, t_e),   "last": await _sum_invoiced(l_s, l_e)},
            "payments":      {"this": await _count_payments(t_s, t_e), "last": await _count_payments(l_s, l_e)},
            "new_customers": {"this": await _count_new("customer", t_s, t_e), "last": await _count_new("customer", l_s, l_e)},
            "new_leads":     {"this": await _count_new("lead", t_s, t_e),     "last": await _count_new("lead", l_s, l_e)},
            "churned":       {"this": await _count_churn(t_s, t_e),    "last": await _count_churn(l_s, l_e)},
            "tickets":       {"this": await _count_tickets(t_s, t_e),  "last": await _count_tickets(l_s, l_e)},
            "workitems":     {"this": await _count_workitems(t_s, t_e),"last": await _count_workitems(l_s, l_e)},
            "workitems_done":{"this": await _count_workitems(t_s, t_e, "DONE"), "last": await _count_workitems(l_s, l_e, "DONE")},
        }

    return out


# ==========================================================================================
# 6. Weekly revenue trend — last N weeks of payment activity
# ==========================================================================================

@router.get("/weekly-trend")
async def weekly_trend(weeks: int = 12, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Last `weeks` weeks of paid revenue + churn events + new customers, ISO-week buckets."""
    await _gate(s, user)
    t = user.tenant_id
    weeks = max(1, min(int(weeks), 52))
    now = _now()
    start = _wstart(now) - timedelta(weeks=weeks - 1)

    pw = func.to_char(func.date_trunc("week", Payment.paid_at), "IYYY-IW")
    payments = {row[0]: int(row[1]) for row in (await s.execute(
        select(pw.label("w"), func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.tenant_id == t, Payment.paid_at >= start).group_by(pw)
    )).all()}

    cw = func.to_char(func.date_trunc("week", Record.created_at), "IYYY-IW")
    customers = {row[0]: int(row[1]) for row in (await s.execute(
        select(cw.label("w"), func.count())
        .where(Record.tenant_id == t, Record.entity_key == "customer", Record.created_at >= start)
        .group_by(cw)
    )).all()}

    ew = func.to_char(func.date_trunc("week", Event.created_at), "IYYY-IW")
    churns = {row[0]: int(row[1]) for row in (await s.execute(
        select(ew.label("w"), func.count())
        .where(Event.tenant_id == t, Event.entity_key == "subscription",
               Event.type == "transition", Event.data["to"].astext == "CANCELLED",
               Event.created_at >= start).group_by(ew)
    )).all()}

    # Build week labels
    out = []
    for i in range(weeks):
        wk_start = _wstart(now) - timedelta(weeks=weeks - 1 - i)
        label = wk_start.strftime("%G-%V")
        out.append({
            "week":       label,
            "date":       wk_start.strftime("%Y-%m-%d"),
            "revenue":    payments.get(label, 0),
            "customers":  customers.get(label, 0),
            "churns":     churns.get(label, 0),
        })
    return out


# ==========================================================================================
# 7. Daily payment heatmap — last 90 days of payment volume
# ==========================================================================================

@router.get("/daily-heatmap")
async def daily_heatmap(days: int = 90, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Daily payment count + amount, last `days` days. Drives a calendar-style heatmap."""
    await _gate(s, user)
    t = user.tenant_id
    days = max(1, min(int(days), 365))
    now = _now()
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    pd = func.to_char(func.date_trunc("day", Payment.paid_at), "YYYY-MM-DD")
    rows = (await s.execute(
        select(pd.label("d"), func.count(), func.coalesce(func.sum(Payment.amount), 0))
        .where(Payment.tenant_id == t, Payment.paid_at >= start)
        .group_by(pd)
    )).all()
    by_day = {row[0]: (int(row[1]), int(row[2])) for row in rows}

    out = []
    for i in range(days):
        d = start + timedelta(days=i)
        key = d.strftime("%Y-%m-%d")
        cnt, amt = by_day.get(key, (0, 0))
        out.append({"date": key, "count": cnt, "amount": amt})
    return out


# ==========================================================================================
# 8. Status breakdown — workitems, tickets, invoices grouped by status (current snapshot)
# ==========================================================================================

@router.get("/status-breakdown")
async def status_breakdown(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """One snapshot of status counts across workitems, helpdesk tickets, invoices, subscriptions."""
    await _gate(s, user)
    t = user.tenant_id

    workitems = {row[0]: int(row[1]) for row in (await s.execute(
        select(WorkItem.status, func.count())
        .where(WorkItem.tenant_id == t).group_by(WorkItem.status)
    )).all()}

    tickets = {row[0]: int(row[1]) for row in (await s.execute(
        select(HelpdeskTicket.status, func.count())
        .where(HelpdeskTicket.tenant_id == t).group_by(HelpdeskTicket.status)
    )).all()}

    invoices = {row[0]: int(row[1]) for row in (await s.execute(
        select(Invoice.status, func.count())
        .where(Invoice.tenant_id == t).group_by(Invoice.status)
    )).all()}

    subs = {row[0]: int(row[1]) for row in (await s.execute(
        select(Subscription.status, func.count())
        .where(Subscription.tenant_id == t).group_by(Subscription.status)
    )).all()}

    return {
        "workitems":     workitems,
        "tickets":       tickets,
        "invoices":      invoices,
        "subscriptions": subs,
    }


# ==========================================================================================
# 9. Task aging — workitems bucketed by age (only open / non-DONE)
# ==========================================================================================

@router.get("/task-aging")
async def task_aging(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Open workitems (status != DONE/CANCELLED) bucketed by created_at age."""
    await _gate(s, user)
    t = user.tenant_id
    now = _now()
    d7  = now - timedelta(days=7)
    d15 = now - timedelta(days=15)
    d30 = now - timedelta(days=30)

    def bucket(cond):
        return func.coalesce(func.sum(case((cond, 1), else_=0)), 0)

    open_cond = WorkItem.status.notin_(["DONE", "CANCELLED"])

    row = (await s.execute(
        select(
            bucket(and_(open_cond, WorkItem.created_at >= d7)).label("d0_7"),
            bucket(and_(open_cond, WorkItem.created_at < d7,  WorkItem.created_at >= d15)).label("d8_15"),
            bucket(and_(open_cond, WorkItem.created_at < d15, WorkItem.created_at >= d30)).label("d16_30"),
            bucket(and_(open_cond, WorkItem.created_at < d30)).label("d30_plus"),
        ).where(WorkItem.tenant_id == t)
    )).one()
    return {
        "d0_7":     int(row[0]),
        "d8_15":    int(row[1]),
        "d16_30":   int(row[2]),
        "d30_plus": int(row[3]),
    }


# ==========================================================================================
# 10. Ticket aging — same as task aging but for helpdesk tickets
# ==========================================================================================

@router.get("/ticket-aging")
async def ticket_aging(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Open helpdesk tickets (status NOT in resolved set) bucketed by created_at age."""
    await _gate(s, user)
    t = user.tenant_id
    now = _now()
    d7  = now - timedelta(days=7)
    d15 = now - timedelta(days=15)
    d30 = now - timedelta(days=30)

    def bucket(cond):
        return func.coalesce(func.sum(case((cond, 1), else_=0)), 0)

    open_cond = HelpdeskTicket.status.notin_(["RESOLVED", "CLOSED", "CANCELLED"])

    row = (await s.execute(
        select(
            bucket(and_(open_cond, HelpdeskTicket.created_at >= d7)).label("d0_7"),
            bucket(and_(open_cond, HelpdeskTicket.created_at < d7,  HelpdeskTicket.created_at >= d15)).label("d8_15"),
            bucket(and_(open_cond, HelpdeskTicket.created_at < d15, HelpdeskTicket.created_at >= d30)).label("d16_30"),
            bucket(and_(open_cond, HelpdeskTicket.created_at < d30)).label("d30_plus"),
        ).where(HelpdeskTicket.tenant_id == t)
    )).one()
    return {
        "d0_7":     int(row[0]),
        "d8_15":    int(row[1]),
        "d16_30":   int(row[2]),
        "d30_plus": int(row[3]),
    }


# ==========================================================================================
# 11. Risk heatmap — risks grouped by likelihood × impact (3x3 grid)
# ==========================================================================================

@router.get("/risk-heatmap")
async def risk_heatmap(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Open risk records grouped by (likelihood, impact). Returns 3x3 grid counts."""
    await _gate(s, user)
    t = user.tenant_id

    # Pull risk records' data field. Group in Python because the JSONB groupby
    # would need two extracted columns which is cleaner as a post-pass over a small set.
    rows = (await s.execute(
        select(Record).where(
            Record.tenant_id == t, Record.entity_key == "risk",
            or_(Record.status.is_(None), Record.status.notin_(["CLOSED", "ACCEPTED"])),
        )
    )).scalars().all()

    grid = {f"{li}_{im}": 0 for li in ["low","medium","high"] for im in ["low","medium","high"]}
    for r in rows:
        d = r.data or {}
        li = str(d.get("likelihood", "")).lower()
        im = str(d.get("impact", "")).lower()
        # Normalize "med" or "high" or "low"; default unknown -> medium/medium
        if li not in {"low","medium","high"}: li = "medium"
        if im not in {"low","medium","high"}: im = "medium"
        grid[f"{li}_{im}"] += 1

    return grid


# ==========================================================================================
# 12. Leads by source — distribution of leads by data.source field
# ==========================================================================================

@router.get("/leads-by-source")
async def leads_by_source(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Group lead records by their data->>'source' field. Raw SQL to dodge an asyncpg
    parameter-binding quirk where the same JSON key is bound twice via the SQLAlchemy expression
    layer."""
    await _gate(s, user)
    from sqlalchemy import text
    rows = (await s.execute(
        text("""
            SELECT COALESCE(data->>'source','unknown') AS src, COUNT(*) AS cnt
            FROM record
            WHERE tenant_id = :tid AND entity_key = 'lead'
            GROUP BY COALESCE(data->>'source','unknown')
        """),
        {"tid": str(user.tenant_id)}
    )).all()
    return {row[0]: int(row[1]) for row in rows}


# ==========================================================================================
# 13. Salesperson ranking — customers (and revenue if joinable) per assigned_to user
# ==========================================================================================

@router.get("/sales-by-user")
async def sales_by_user(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Group customer records by data.assigned_to field. Returns name → customer count.

    Real-data only: if no customer carries `assigned_to`, the response is {} and the
    frontend hides the widget per real-data doctrine.
    """
    await _gate(s, user)
    from sqlalchemy import text
    rows = (await s.execute(
        text("""
            SELECT data->>'assigned_to' AS agent, COUNT(*) AS cnt
            FROM record
            WHERE tenant_id = :tid
              AND entity_key = 'customer'
              AND data->>'assigned_to' IS NOT NULL
              AND data->>'assigned_to' <> ''
            GROUP BY data->>'assigned_to'
        """),
        {"tid": str(user.tenant_id)}
    )).all()
    return {row[0]: int(row[1]) for row in rows}


# ==========================================================================================
# 14. RAG health — Red/Amber/Green project-style health from workitems + tickets
# ==========================================================================================

@router.get("/rag-health")
async def rag_health(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Aggregate execution health into Red / Amber / Green buckets, derived from real data:
      - RED: BLOCKED workitems + tickets > 7 days old + OVERDUE invoices
      - AMBER: TODO workitems with due_at in the next 3 days + IN_PROGRESS tickets > 3 days old
      - GREEN: everything else that's open
    """
    await _gate(s, user)
    t = user.tenant_id
    now = _now()
    d3  = now - timedelta(days=3)
    d7  = now - timedelta(days=7)

    # RED
    red_wi = (await s.execute(
        select(func.count()).select_from(WorkItem).where(
            WorkItem.tenant_id == t, WorkItem.status == "BLOCKED")
    )).scalar_one()
    red_tk = (await s.execute(
        select(func.count()).select_from(HelpdeskTicket).where(
            HelpdeskTicket.tenant_id == t,
            HelpdeskTicket.status.notin_(["RESOLVED","CLOSED","CANCELLED"]),
            HelpdeskTicket.created_at < d7)
    )).scalar_one()
    red_inv = (await s.execute(
        select(func.count()).select_from(Invoice).where(
            Invoice.tenant_id == t,
            or_(Invoice.status == "OVERDUE",
                and_(Invoice.status == "ISSUED", Invoice.due_at < now)))
    )).scalar_one()

    # AMBER
    amber_wi = (await s.execute(
        select(func.count()).select_from(WorkItem).where(
            WorkItem.tenant_id == t,
            WorkItem.status == "TODO",
            WorkItem.due_at != None,
            WorkItem.due_at < (now + timedelta(days=3)),  # noqa: E711
        )
    )).scalar_one()
    amber_tk = (await s.execute(
        select(func.count()).select_from(HelpdeskTicket).where(
            HelpdeskTicket.tenant_id == t,
            HelpdeskTicket.status == "IN_PROGRESS",
            HelpdeskTicket.created_at < d3)
    )).scalar_one()

    # GREEN — open items not in red/amber
    green_wi = (await s.execute(
        select(func.count()).select_from(WorkItem).where(
            WorkItem.tenant_id == t,
            WorkItem.status.in_(["TODO", "IN_PROGRESS"]))
    )).scalar_one()
    green_tk = (await s.execute(
        select(func.count()).select_from(HelpdeskTicket).where(
            HelpdeskTicket.tenant_id == t,
            HelpdeskTicket.status.notin_(["RESOLVED","CLOSED","CANCELLED"]))
    )).scalar_one()

    red   = int(red_wi) + int(red_tk) + int(red_inv)
    amber = int(amber_wi) + int(amber_tk)
    # Green is total open MINUS what's already in red/amber (avoid double count)
    green = max(0, (int(green_wi) + int(green_tk)) - amber - (int(red_wi) + int(red_tk)))

    return {"red": red, "amber": amber, "green": green}
