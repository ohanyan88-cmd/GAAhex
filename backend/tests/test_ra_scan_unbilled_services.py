"""Phase B.3 — Revenue Assurance: unbilled-service scan.

Covers ``services.revenue_assurance.scan_unbilled_services``:
  * ACTIVE service with NO covering subscription  → finding created
  * ACTIVE service WITH an active subscription    → NO finding
  * TERMINATED service                            → NO finding (only ACTIVE matters)
  * Re-running the scan                           → partial-unique index keeps it at 1 finding
  * gap_days is the integer days between activated_at and the as_of clock
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Subscription
from app.models.ra_finding import RaFinding
from app.models.ra_scan_run import RaScanRun
from app.models.service import Service
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


async def _new_customer_id(client, admin) -> uuid.UUID:
    """Create a real CRM customer Record so Service.customer_id FK can attach to it."""
    r = await client.post("/api/customers", headers=admin,
                          json={"name": f"RAUSCust-{_hex()}"})
    assert r.status_code in (200, 201), r.text
    return uuid.UUID(r.json()["id"])


async def _add_service(
    tenant_id: uuid.UUID,
    *,
    status: str = "ACTIVE",
    customer_id: uuid.UUID | None = None,
    subscription_id: uuid.UUID | None = None,
    activated_at: datetime | None = None,
    name_suffix: str = "",
) -> uuid.UUID:
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tenant_id,
            customer_id=customer_id,
            subscription_id=subscription_id,
            type="internet",
            name=f"RAUS-{_hex()}{name_suffix}",
            status=status,
            activated_at=activated_at,
        )
        s.add(svc)
        await s.commit()
        return svc.id


async def _add_subscription(
    tenant_id: uuid.UUID,
    *,
    status: str = "ACTIVE",
    customer_id: uuid.UUID | None = None,
) -> uuid.UUID:
    async with SessionLocal() as s:
        sub = Subscription(
            tenant_id=tenant_id,
            customer_id=customer_id,
            plan_name=f"RAUS-plan-{_hex()}",
            amount=1000,
            cycle="monthly",
            status=status,
        )
        s.add(sub)
        await s.commit()
        return sub.id


# ===================== ACTIVE service WITHOUT a subscription → finding =====================

async def test_active_service_without_subscription_creates_finding(client, admin):
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cust_id = await _new_customer_id(client, admin)
    svc_id = await _add_service(tid, customer_id=cust_id, activated_at=datetime.now(timezone.utc))

    async with SessionLocal() as s:
        new = await ra_service.scan_unbilled_services(s, tenant_id=tid, scan_run_id=scan_id)
        await s.commit()

    assert any(f.entity_id == svc_id for f in new), "expected a finding for the uncovered service"
    # Persisted row must be in 'open' status of the right type.
    async with SessionLocal() as s:
        row = (await s.execute(
            select(RaFinding).where(
                RaFinding.entity_id == svc_id,
                RaFinding.finding_type == "unbilled_service",
            )
        )).scalar_one()
    assert row.status == "open"
    assert row.severity == "high"
    assert row.entity_type == "service"
    assert row.scan_run_id == scan_id


# ===================== ACTIVE service WITH active subscription → NO finding =====================

async def test_active_service_with_active_subscription_no_finding(client, admin):
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cust_id = await _new_customer_id(client, admin)
    sub_id = await _add_subscription(tid, customer_id=cust_id)
    svc_id = await _add_service(tid, customer_id=cust_id, subscription_id=sub_id)

    async with SessionLocal() as s:
        new = await ra_service.scan_unbilled_services(s, tenant_id=tid, scan_run_id=scan_id)
        await s.commit()

    assert not any(f.entity_id == svc_id for f in new), \
        "service IS covered (direct subscription_id) — no finding expected"


# ===================== TERMINATED service → NO finding =====================

async def test_terminated_service_no_finding(client, admin):
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cust_id = await _new_customer_id(client, admin)
    svc_id = await _add_service(tid, status="TERMINATED", customer_id=cust_id)

    async with SessionLocal() as s:
        new = await ra_service.scan_unbilled_services(s, tenant_id=tid, scan_run_id=scan_id)
        await s.commit()

    assert not any(f.entity_id == svc_id for f in new), "terminated services are out of scope"


# ===================== Re-running scan keeps exactly 1 open finding =====================

async def test_rerun_no_duplicate_finding(client, admin):
    tid = await _admin_tenant_id()
    scan_id_1 = await _seed_scan_run(tid)
    cust_id = await _new_customer_id(client, admin)
    svc_id = await _add_service(tid, customer_id=cust_id)

    async with SessionLocal() as s:
        await ra_service.scan_unbilled_services(s, tenant_id=tid, scan_run_id=scan_id_1)
        await s.commit()

    # A second run with a fresh scan_run_id should produce ZERO new findings for this entity
    # because the partial-unique index rejects a second open row.
    scan_id_2 = await _seed_scan_run(tid)
    async with SessionLocal() as s:
        new = await ra_service.scan_unbilled_services(s, tenant_id=tid, scan_run_id=scan_id_2)
        await s.commit()
    assert not any(f.entity_id == svc_id for f in new), "duplicate finding must be skipped"

    # And the DB still has exactly one open finding for that entity.
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(RaFinding).where(
                RaFinding.entity_id == svc_id,
                RaFinding.finding_type == "unbilled_service",
                RaFinding.status == "open",
            )
        )).scalars().all()
    assert len(rows) == 1


# ===================== gap_days reflects time since activated_at =====================

async def test_gap_days_computed_from_activated_at(client, admin):
    tid = await _admin_tenant_id()
    scan_id = await _seed_scan_run(tid)
    cust_id = await _new_customer_id(client, admin)
    activated = datetime.now(timezone.utc) - timedelta(days=42)
    svc_id = await _add_service(tid, customer_id=cust_id, activated_at=activated,
                                name_suffix="-gap")

    as_of = activated + timedelta(days=42)
    async with SessionLocal() as s:
        new = await ra_service.scan_unbilled_services(
            s, tenant_id=tid, scan_run_id=scan_id, as_of=as_of,
        )
        await s.commit()

    finding = next((f for f in new if f.entity_id == svc_id), None)
    assert finding is not None
    assert finding.detail_json.get("gap_days") == 42
