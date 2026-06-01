"""Phase B.3 — Revenue Assurance: uninvoiced-subscription scan.

Covers ``services.revenue_assurance.scan_uninvoiced_subscriptions``:
  * ACTIVE subscription WITH an invoice covering this cycle → NO finding
  * ACTIVE subscription whose only invoice covers an OLDER cycle → finding
  * INACTIVE (SUSPENDED/CANCELLED) subscription → NO finding
  * Mixed batch: only the uncovered ACTIVE subs land findings
  * Boundary case: invoice period_start exactly == cycle_start (inclusive)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Invoice, InvoiceLine, Subscription
from app.models.ra_finding import RaFinding
from app.models.ra_scan_run import RaScanRun
from app.models.user import User
from app.services import revenue_assurance as ra_service


async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _seed_scan_run(tenant_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as s:
        run = RaScanRun(tenant_id=tenant_id, status="running")
        s.add(run)
        await s.commit()
        return run.id


async def _add_subscription(
    tenant_id: uuid.UUID,
    *,
    status: str = "ACTIVE",
    customer_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Subscription with no customer_id (FK is nullable). The cycle-coverage scan keys off the
    subscription_id on invoice_line, not the customer link."""
    async with SessionLocal() as s:
        sub = Subscription(
            tenant_id=tenant_id,
            customer_id=customer_id,
            plan_name=f"RAUI-plan-{_hex()}",
            amount=1000,
            cycle="monthly",
            status=status,
        )
        s.add(sub)
        await s.commit()
        return sub.id


async def _add_invoice_with_line(
    tenant_id: uuid.UUID,
    *,
    subscription_id: uuid.UUID,
    period_start: datetime,
    period_end: datetime,
) -> uuid.UUID:
    async with SessionLocal() as s:
        inv = Invoice(
            tenant_id=tenant_id,
            number=f"RAUI-{_hex()}",
            period_start=period_start,
            period_end=period_end,
            status="ISSUED",
            total=1000,
        )
        s.add(inv)
        await s.flush()
        line = InvoiceLine(
            tenant_id=tenant_id,
            invoice_id=inv.id,
            kind="charge",
            description="plan",
            quantity=1,
            unit_amount=1000,
            line_total=1000,
            subscription_id=subscription_id,
        )
        s.add(line)
        await s.commit()
        return inv.id


def _this_cycle() -> tuple[datetime, datetime]:
    now = datetime.now(timezone.utc)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


# ===================== covered subscription → NO finding =====================

async def test_subscription_invoiced_this_cycle_no_finding():
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cs, ce = _this_cycle()
    sub_id = await _add_subscription(tid)
    # Invoice covering the cycle inclusively: period_start <= cs, period_end >= ce.
    await _add_invoice_with_line(
        tid, subscription_id=sub_id,
        period_start=cs - timedelta(days=1),
        period_end=ce + timedelta(days=1),
    )

    async with SessionLocal() as s:
        new = await ra_service.scan_uninvoiced_subscriptions(
            s, tenant_id=tid, scan_run_id=scan_id, cycle_start=cs, cycle_end=ce,
        )
        await s.commit()
    assert not any(f.entity_id == sub_id for f in new), "covered sub must not raise a finding"


# ===================== older-cycle invoice does NOT cover this cycle → finding =====================

async def test_subscription_with_older_invoice_only_raises_finding():
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cs, ce = _this_cycle()
    sub_id = await _add_subscription(tid)
    # Invoice covering LAST cycle only.
    last_start = (cs - timedelta(days=40))
    last_end = (cs - timedelta(days=10))
    await _add_invoice_with_line(
        tid, subscription_id=sub_id, period_start=last_start, period_end=last_end,
    )

    async with SessionLocal() as s:
        new = await ra_service.scan_uninvoiced_subscriptions(
            s, tenant_id=tid, scan_run_id=scan_id, cycle_start=cs, cycle_end=ce,
        )
        await s.commit()
    assert any(f.entity_id == sub_id for f in new), \
        "subscription not covering THIS cycle must produce a finding"


# ===================== inactive subscription → NO finding =====================

async def test_inactive_subscription_no_finding():
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cs, ce = _this_cycle()
    sub_id = await _add_subscription(tid, status="CANCELLED")

    async with SessionLocal() as s:
        new = await ra_service.scan_uninvoiced_subscriptions(
            s, tenant_id=tid, scan_run_id=scan_id, cycle_start=cs, cycle_end=ce,
        )
        await s.commit()
    assert not any(f.entity_id == sub_id for f in new), \
        "non-ACTIVE subscriptions are not scanned for invoicing leakage"


# ===================== mixed batch: only uncovered actives get findings =====================

async def test_only_uncovered_subscriptions_get_findings():
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cs, ce = _this_cycle()

    covered = await _add_subscription(tid)
    await _add_invoice_with_line(
        tid, subscription_id=covered,
        period_start=cs - timedelta(days=1), period_end=ce + timedelta(days=1),
    )
    uncovered_1 = await _add_subscription(tid)
    uncovered_2 = await _add_subscription(tid)
    inactive = await _add_subscription(tid, status="SUSPENDED")

    async with SessionLocal() as s:
        new = await ra_service.scan_uninvoiced_subscriptions(
            s, tenant_id=tid, scan_run_id=scan_id, cycle_start=cs, cycle_end=ce,
        )
        await s.commit()

    new_ids = {f.entity_id for f in new}
    assert uncovered_1 in new_ids
    assert uncovered_2 in new_ids
    assert covered not in new_ids
    assert inactive not in new_ids


# ===================== boundary: period_start == cycle_start, period_end == cycle_end =====================

async def test_cycle_boundaries_inclusive():
    """An invoice whose period_start == cycle_start AND period_end == cycle_end MUST be treated
    as covering. (The SQL uses ``<=`` / ``>=``.)"""
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cs, ce = _this_cycle()
    sub_id = await _add_subscription(tid)
    await _add_invoice_with_line(
        tid, subscription_id=sub_id, period_start=cs, period_end=ce,
    )

    async with SessionLocal() as s:
        new = await ra_service.scan_uninvoiced_subscriptions(
            s, tenant_id=tid, scan_run_id=scan_id, cycle_start=cs, cycle_end=ce,
        )
        await s.commit()
    assert not any(f.entity_id == sub_id for f in new), \
        "exact-boundary invoice (period_start==cycle_start, period_end==cycle_end) must cover the cycle"
