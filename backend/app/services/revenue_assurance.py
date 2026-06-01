"""Phase B.3 — Revenue Assurance scan service.

Two leakage scans + an orchestrator that records a scan run. Pure helpers; the caller commits.

Scans:
  * scan_unbilled_services        — ACTIVE Service rows whose customer has no ACTIVE Subscription
  * scan_uninvoiced_subscriptions — ACTIVE Subscription rows that no invoice this cycle references

Dedup is enforced by the ``uq_ra_finding_open_per_entity`` partial-unique index. We attempt the
INSERT and on ``IntegrityError`` we roll the savepoint back and skip — that row already has an
open finding of this type, so the scan ran is a no-op for it.

run_full_scan opens an RaScanRun, calls both scans, and lands the row as success or failed.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, and_, not_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.billing import Invoice, InvoiceLine, Subscription
from ..models.ra_finding import RaFinding
from ..models.ra_scan_run import RaScanRun
from ..models.service import Service


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _month_bounds(now: datetime) -> tuple[datetime, datetime]:
    """Return the (start, end) of the calendar month containing ``now`` (end-exclusive)."""
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


# ==========================================================================================
# Scan 1 — unbilled active services
# ==========================================================================================

async def scan_unbilled_services(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    scan_run_id: uuid.UUID,
    as_of: Optional[datetime] = None,
) -> list[RaFinding]:
    """Find ACTIVE ``Service`` rows that have no ACTIVE ``Subscription`` covering them.

    Two coverage paths satisfy a service:
      * the service is directly linked to an active subscription via ``service.subscription_id``
      * or the service shares ``customer_id`` with an active subscription (legacy data path)

    A service with no match raises one RaFinding(finding_type='unbilled_service'). Existing open
    findings on the same entity bounce off the partial-unique index — we catch and skip.
    Returns the list of NEWLY-created findings.
    """
    as_of = as_of or _utcnow()
    new_findings: list[RaFinding] = []

    # Pull all ACTIVE services for the tenant.
    services = (await session.execute(
        select(Service).where(
            Service.tenant_id == tenant_id,
            Service.status == "ACTIVE",
        )
    )).scalars().all()

    if not services:
        return new_findings

    # Pull the set of active subscription ids and the set of customer_ids that have at least one
    # active subscription. Cheaper than per-service round-trips.
    active_sub_ids = set((await session.execute(
        select(Subscription.id).where(
            Subscription.tenant_id == tenant_id,
            Subscription.status == "ACTIVE",
        )
    )).scalars().all())

    active_sub_customers = set((await session.execute(
        select(Subscription.customer_id).where(
            Subscription.tenant_id == tenant_id,
            Subscription.status == "ACTIVE",
            Subscription.customer_id.is_not(None),
        )
    )).scalars().all())

    for svc in services:
        # Covered if directly linked to an active subscription, OR the customer has any active sub.
        covered = (
            (svc.subscription_id is not None and svc.subscription_id in active_sub_ids)
            or (svc.customer_id is not None and svc.customer_id in active_sub_customers)
        )
        if covered:
            continue

        gap_days = None
        if svc.activated_at is not None:
            gap_days = max(0, (as_of - svc.activated_at).days)

        finding = RaFinding(
            tenant_id=tenant_id,
            finding_type="unbilled_service",
            severity="high",
            entity_type="service",
            entity_id=svc.id,
            summary="Active service has no active subscription — revenue leakage",
            detail_json={
                "customer_id": str(svc.customer_id) if svc.customer_id else None,
                "activated_at": svc.activated_at.isoformat() if svc.activated_at else None,
                "gap_days": gap_days,
                "service_name": svc.name,
                "service_type": svc.type,
            },
            detected_at=as_of,
            status="open",
            scan_run_id=scan_run_id,
        )
        # Try to insert. The partial-unique index rejects duplicates of an open finding for the
        # same (tenant, type, entity) — catch IntegrityError per-row and skip.
        savepoint = await session.begin_nested()
        try:
            session.add(finding)
            await session.flush()
            await savepoint.commit()
            new_findings.append(finding)
        except IntegrityError:
            await savepoint.rollback()
            # already-open finding for this entity — skip silently.
            continue

    return new_findings


# ==========================================================================================
# Scan 2 — uninvoiced active subscriptions
# ==========================================================================================

async def scan_uninvoiced_subscriptions(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    scan_run_id: uuid.UUID,
    cycle_start: datetime,
    cycle_end: datetime,
) -> list[RaFinding]:
    """Find ACTIVE ``Subscription`` rows that no invoice for ``[cycle_start, cycle_end]`` references.

    A subscription is considered covered when there exists at least one InvoiceLine whose
    invoice's ``period_start <= cycle_start`` AND ``period_end >= cycle_end`` AND
    ``invoice_line.subscription_id`` equals the subscription's id.

    Newly-detected uncovered subscriptions get one RaFinding(finding_type='uninvoiced_subscription').
    Existing open findings bounce off the partial-unique index and are skipped.
    Returns the list of NEWLY-created findings.
    """
    as_of = _utcnow()
    new_findings: list[RaFinding] = []

    # All active subscriptions for the tenant.
    subs = (await session.execute(
        select(Subscription).where(
            Subscription.tenant_id == tenant_id,
            Subscription.status == "ACTIVE",
        )
    )).scalars().all()

    if not subs:
        return new_findings

    # subscription_ids that ARE referenced by an invoice covering this cycle.
    covered_sub_ids = set((await session.execute(
        select(InvoiceLine.subscription_id)
        .join(Invoice, Invoice.id == InvoiceLine.invoice_id)
        .where(
            Invoice.tenant_id == tenant_id,
            Invoice.period_start.is_not(None),
            Invoice.period_end.is_not(None),
            Invoice.period_start <= cycle_start,
            Invoice.period_end >= cycle_end,
            InvoiceLine.subscription_id.is_not(None),
        )
    )).scalars().all())

    for sub in subs:
        if sub.id in covered_sub_ids:
            continue
        finding = RaFinding(
            tenant_id=tenant_id,
            finding_type="uninvoiced_subscription",
            severity="high",
            entity_type="subscription",
            entity_id=sub.id,
            summary="Active subscription not invoiced this cycle — revenue leakage",
            detail_json={
                "customer_id": str(sub.customer_id) if sub.customer_id else None,
                "cycle_start": cycle_start.isoformat(),
                "cycle_end": cycle_end.isoformat(),
                "plan_name": sub.plan_name,
                "amount": int(sub.amount or 0),
            },
            detected_at=as_of,
            status="open",
            scan_run_id=scan_run_id,
        )
        savepoint = await session.begin_nested()
        try:
            session.add(finding)
            await session.flush()
            await savepoint.commit()
            new_findings.append(finding)
        except IntegrityError:
            await savepoint.rollback()
            continue

    return new_findings


# ==========================================================================================
# Orchestrator — open a scan run, fire both scans, finalize the run row
# ==========================================================================================

async def run_full_scan(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: Optional[uuid.UUID] = None,
    cycle_start: Optional[datetime] = None,
    cycle_end: Optional[datetime] = None,
) -> RaScanRun:
    """Open an ``RaScanRun``, run both scans inside a try/except, finalize the row.

    On success: status='success', findings_count = sum of both scans' new findings.
    On failure: status='failed', error_message=str(exc), and the exception RE-RAISES so the
    caller (the HTTP layer) can return 500.

    ``cycle_start`` / ``cycle_end`` default to the current calendar month when not supplied.
    """
    now = _utcnow()
    if cycle_start is None or cycle_end is None:
        m_start, m_end = _month_bounds(now)
        cycle_start = cycle_start or m_start
        cycle_end = cycle_end or m_end

    run = RaScanRun(
        tenant_id=tenant_id,
        started_at=now,
        status="running",
        findings_count=0,
        triggered_by=actor_id,
    )
    session.add(run)
    await session.flush()  # need run.id before scans tag findings with it

    try:
        unbilled = await scan_unbilled_services(
            session, tenant_id=tenant_id, scan_run_id=run.id, as_of=now,
        )
        uninv = await scan_uninvoiced_subscriptions(
            session, tenant_id=tenant_id, scan_run_id=run.id,
            cycle_start=cycle_start, cycle_end=cycle_end,
        )
        run.findings_count = len(unbilled) + len(uninv)
        run.completed_at = _utcnow()
        run.status = "success"
        await session.flush()
    except Exception as e:
        run.status = "failed"
        run.completed_at = _utcnow()
        run.error_message = str(e)[:2000]
        await session.flush()
        raise

    return run
