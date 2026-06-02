"""Home / dashboard metrics — aggregated time series.

Read-only, no new tables, server-side aggregation only (never Python loops over rows).

Why a separate router (not analytics.py): the dashboard Home tile needs
`invoice.view` (the same gate the InvoicesView uses), not the broader
`analytics.view`. analytics.py exposes the executive KPI bundle to finance-only
roles; metrics.py exposes per-widget series to any role that can already see
invoices.

Range -> window:
- 30d : last 30 days (single bucket per month present in window)
- qtd : quarter-to-date (months in the current quarter so far)
- ytd : year-to-date (months in the current year so far)

Money is raw luma (AMD minor units); the frontend divides by 100 for display.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Event
from ..models.billing import Invoice
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

_ALLOWED_RANGES = {"7d", "30d", "qtd", "ytd"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _window_start(range_key: str, now: datetime) -> datetime:
    """The earliest timestamp included in the window for `range_key`. Always UTC, naive-safe."""
    if range_key == "7d":
        return now - timedelta(days=7)
    if range_key == "30d":
        return now - timedelta(days=30)
    if range_key == "qtd":
        # First day of the current calendar quarter.
        q_month = ((now.month - 1) // 3) * 3 + 1
        return now.replace(month=q_month, day=1, hour=0, minute=0, second=0, microsecond=0)
    # ytd
    return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


def _month_labels(start: datetime, now: datetime) -> list[str]:
    """Inclusive list of YYYY-MM labels from `start`'s month up to `now`'s month, oldest -> newest."""
    labels: list[str] = []
    y, m = start.year, start.month
    while (y, m) <= (now.year, now.month):
        labels.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return labels


@router.get("/revenue")
async def revenue_metrics(
    range: str = "30d",
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Revenue (sum PAID invoices) + churn (count cancelled subscriptions) per month."""
    if range not in _ALLOWED_RANGES:
        raise HTTPException(422, f"range must be one of {sorted(_ALLOWED_RANGES)}")

    grants = await load_grants(s, user)
    # Same gate the InvoicesView uses, since this is invoice-derived.
    if not can(grants, "invoice", "view"):
        raise HTTPException(403, "Not allowed: invoice.view")

    now = _now()
    start = _window_start(range, now)
    labels = _month_labels(start, now)
    t = user.tenant_id

    # Revenue: sum(Invoice.total) where status=PAID, grouped by issued_at month.
    # issued_at is nullable; PAID invoices should always have it set, but be defensive.
    inv_month = func.to_char(func.date_trunc("month", Invoice.issued_at), "YYYY-MM")
    inv_q = (
        select(inv_month.label("m"), func.coalesce(func.sum(Invoice.total), 0))
        .where(
            Invoice.tenant_id == t,
            Invoice.status == "PAID",
            Invoice.issued_at.is_not(None),
            Invoice.issued_at >= start,
        )
        .group_by(inv_month)
    )
    revenue_by_month: dict[str, int] = {
        row[0]: int(row[1]) for row in (await s.execute(inv_q)).all()
    }

    # Churn: count of Event rows where a subscription transitioned -> CANCELLED.
    # Subscription has no cancelled_at column; the audit log is the source of truth.
    ev_month = func.to_char(func.date_trunc("month", Event.created_at), "YYYY-MM")
    ev_q = (
        select(ev_month.label("m"), func.count())
        .where(
            Event.tenant_id == t,
            Event.entity_key == "subscription",
            Event.type == "transition",
            # JSONB ->> 'to' = 'CANCELLED'
            Event.data["to"].astext == "CANCELLED",
            Event.created_at >= start,
        )
        .group_by(ev_month)
    )
    churn_by_month: dict[str, int] = {
        row[0]: int(row[1]) for row in (await s.execute(ev_q)).all()
    }

    buckets = [
        {
            "month": lab,
            "revenue": revenue_by_month.get(lab, 0),
            "churn": churn_by_month.get(lab, 0),
        }
        for lab in labels
    ]
    return {"range": range, "buckets": buckets}
