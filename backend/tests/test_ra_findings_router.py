"""Phase B.3 — Revenue Assurance router tests.

Targets ``/api/revenue-assurance/*``. Covers scan-launch, paginated listing + filters, ack/resolve
lifecycle, false-positive admin gate, scan-with-findings GET, and the admin gate on POST /scan.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Subscription
from app.models.ra_finding import RaFinding
from app.models.service import Service
from app.models.user import User


async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        return u.tenant_id


def _hex() -> str:
    return uuid.uuid4().hex[:8]


async def _new_customer_id(client, admin) -> uuid.UUID:
    """Create a real CRM customer Record so FK on Service.customer_id / Subscription.customer_id
    is satisfied."""
    r = await client.post("/api/customers", headers=admin,
                          json={"name": f"RArouterCust-{_hex()}"})
    assert r.status_code in (200, 201), r.text
    return uuid.UUID(r.json()["id"])


async def _seed_uncovered_service(tenant_id: uuid.UUID, cust_id: uuid.UUID) -> uuid.UUID:
    """Drop in an ACTIVE service with no covering subscription. The next scan will produce
    one unbilled_service finding for it."""
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tenant_id,
            customer_id=cust_id,
            type="internet",
            name=f"RArouter-{_hex()}",
            status="ACTIVE",
            activated_at=datetime.now(timezone.utc) - timedelta(days=7),
        )
        s.add(svc)
        await s.commit()
        return svc.id


async def _seed_uncovered_subscription(tenant_id: uuid.UUID) -> uuid.UUID:
    """ACTIVE subscription (customer_id left NULL — FK is nullable) with no covering invoice."""
    async with SessionLocal() as s:
        sub = Subscription(
            tenant_id=tenant_id,
            customer_id=None,
            plan_name=f"RArouter-plan-{_hex()}",
            amount=1500,
            cycle="monthly",
            status="ACTIVE",
        )
        s.add(sub)
        await s.commit()
        return sub.id


# ===================== POST /scan starts a run + writes findings =====================

async def test_scan_starts_run_and_writes_findings(client, admin):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)

    r = await client.post("/api/revenue-assurance/scan", headers=admin, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "success"
    assert body["findings_count"] >= 1
    assert body["completed_at"] is not None
    assert body["triggered_by"]  # admin actor recorded


# ===================== GET /findings returns the run's findings =====================

async def test_list_findings_returns_open_findings(client, admin):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})

    r = await client.get("/api/revenue-assurance/findings?status=open", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    assert all(f["status"] == "open" for f in body["items"])
    assert any(f["finding_type"] == "unbilled_service" for f in body["items"])


# ===================== filter by status, finding_type, severity =====================

async def test_list_findings_filters(client, admin):
    tid = await _admin_tenant_id()
    await _seed_uncovered_subscription(tid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})

    # by finding_type
    r = await client.get(
        "/api/revenue-assurance/findings?finding_type=uninvoiced_subscription",
        headers=admin,
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert items, "expected at least one uninvoiced_subscription finding"
    assert all(f["finding_type"] == "uninvoiced_subscription" for f in items)

    # by severity (both scans produce 'high')
    r = await client.get("/api/revenue-assurance/findings?severity=high", headers=admin)
    assert r.status_code == 200
    assert all(f["severity"] == "high" for f in r.json()["items"])

    # by status=open (default of new findings)
    r = await client.get("/api/revenue-assurance/findings?status=open", headers=admin)
    assert r.status_code == 200
    assert all(f["status"] == "open" for f in r.json()["items"])


# ===================== POST /ack flips status + stamps ack_at/ack_by =====================

async def test_ack_flips_to_investigating(client, admin):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})

    r = await client.get("/api/revenue-assurance/findings?status=open", headers=admin)
    fid = r.json()["items"][0]["id"]

    r = await client.post(f"/api/revenue-assurance/findings/{fid}/ack", headers=admin, json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "investigating"
    assert body["ack_at"] is not None
    assert body["ack_by"] is not None


# ===================== POST /resolve flips status + stores resolution =====================

async def test_resolve_flips_to_resolved(client, admin):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})

    r = await client.get("/api/revenue-assurance/findings?status=open", headers=admin)
    fid = r.json()["items"][0]["id"]

    r = await client.post(
        f"/api/revenue-assurance/findings/{fid}/resolve",
        headers=admin,
        json={"resolution": "linked sub manually"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "resolved"
    assert body["resolved_at"] is not None
    assert body["resolved_by"] is not None
    assert body["resolution"] == "linked sub manually"


# ===================== POST /mark-false-positive: non-admin denied =====================

async def test_false_positive_admin_only(client, admin, agent):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})
    r = await client.get("/api/revenue-assurance/findings?status=open", headers=admin)
    fid = r.json()["items"][0]["id"]

    # Agent → 403
    r = await client.post(
        f"/api/revenue-assurance/findings/{fid}/mark-false-positive",
        headers=agent, json={"resolution": "demo data"},
    )
    assert r.status_code == 403

    # Admin → 200
    r = await client.post(
        f"/api/revenue-assurance/findings/{fid}/mark-false-positive",
        headers=admin, json={"resolution": "demo data"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "false_positive"


# ===================== GET /scans/{id} returns scan + its findings =====================

async def test_get_scan_returns_findings(client, admin):
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    scan_body = (await client.post(
        "/api/revenue-assurance/scan", headers=admin, json={}
    )).json()
    sid = scan_body["id"]

    r = await client.get(f"/api/revenue-assurance/scans/{sid}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scan"]["id"] == sid
    assert isinstance(body["findings"], list)
    # The findings for this scan must reference this scan_run_id.
    assert all(f["scan_run_id"] == sid for f in body["findings"])


# ===================== POST /scan: non-admin denied =====================

async def test_scan_admin_only(client, agent):
    r = await client.post("/api/revenue-assurance/scan", headers=agent, json={})
    assert r.status_code == 403


# ===================== GET /scans is a paginated list, newest first =====================

async def test_list_scans_pagination_shape(client, admin):
    # Trigger at least one scan so the list isn't empty.
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})
    r = await client.get("/api/revenue-assurance/scans", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "total" in body and "page" in body
    assert body["page"] == 1
    assert body["total"] >= 1


# ===================== GET /findings/{id} returns the single finding row =====================

async def test_get_single_finding(client, admin):
    """``GET /api/revenue-assurance/findings/{id}`` returns the row's full detail_json."""
    tid = await _admin_tenant_id()
    cid = await _new_customer_id(client, admin)
    await _seed_uncovered_service(tid, cid)
    await client.post("/api/revenue-assurance/scan", headers=admin, json={})

    # Pick a fresh finding from the list, then GET it by id.
    listing = (await client.get(
        "/api/revenue-assurance/findings?status=open", headers=admin,
    )).json()
    assert listing["items"], "scan should have produced at least one open finding"
    fid = listing["items"][0]["id"]

    r = await client.get(f"/api/revenue-assurance/findings/{fid}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == fid
    # detail_json is always a dict — even when empty.
    assert isinstance(body["detail_json"], dict)
    # An unknown id 404s.
    bogus = (await client.get(
        f"/api/revenue-assurance/findings/{uuid.uuid4()}", headers=admin,
    ))
    assert bogus.status_code == 404
