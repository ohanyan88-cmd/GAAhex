"""NOC Phase C — IPAM assignment tests.

Covers:
  * assign_ip creates row; current_assignment_for finds it
  * Duplicate active assignment → 409
  * release_ip sets released_at; same IP can be re-assigned after release
  * assignments_for_service returns all (active + historical)
  * Lease-expired row still returned by assignments_for_service
  * Invalid IP format → 400
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.respool import ResourcePool, PoolAllocation
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_user() -> User:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u


async def _admin_tenant_id() -> uuid.UUID:
    u = await _admin_user()
    return u.tenant_id


async def _seed_pool_allocation(tenant_id: uuid.UUID, value: str = "10.20.30.0/24") -> uuid.UUID:
    """Create a ResourcePool + PoolAllocation and return the allocation id."""
    async with SessionLocal() as s:
        pool = ResourcePool(
            tenant_id=tenant_id,
            name=f"Pool-{uuid.uuid4().hex[:6]}",
            kind="ipv4",
            spec={"cidr": value},
        )
        s.add(pool)
        await s.flush()
        alloc = PoolAllocation(
            tenant_id=tenant_id,
            pool_id=pool.id,
            value=value,
            status="ALLOCATED",
        )
        s.add(alloc)
        await s.commit()
        return alloc.id


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_assign_ip_creates_row_and_current_assignment_finds_it(client, admin):
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)
    ip = f"10.20.{uuid.uuid4().int % 200 + 1}.1"

    r = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["address"] == ip
    assert body["family"] == 4
    assert body["status"] == "active"
    assert body["released_at"] is None

    # Also check via GET /ipam/assignments?address=<ip>&status=active
    get_r = await client.get(f"/api/ipam/assignments?address={ip}&status=active", headers=admin)
    assert get_r.status_code == 200, get_r.text
    items = get_r.json()
    assert len(items) >= 1
    assert any(item["address"] == ip for item in items)


@pytest.mark.asyncio
async def test_duplicate_active_assignment_returns_409(client, admin):
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)
    ip = f"10.30.{uuid.uuid4().int % 200 + 1}.2"

    r1 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4},
    )
    assert r1.status_code == 200, r1.text

    r2 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4},
    )
    assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_release_ip_and_reassign(client, admin):
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)
    ip = f"10.40.{uuid.uuid4().int % 200 + 1}.3"

    # Assign
    r1 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4},
    )
    assert r1.status_code == 200, r1.text
    assignment_id = r1.json()["id"]

    # Release
    rel_r = await client.post(
        "/api/ipam/release", headers=admin,
        json={"assignment_id": assignment_id},
    )
    assert rel_r.status_code == 200, rel_r.text
    assert rel_r.json()["released_at"] is not None
    assert rel_r.json()["status"] == "released"

    # Re-assign same IP — should succeed now
    r2 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "active"


@pytest.mark.asyncio
async def test_assignments_for_service_returns_active_and_historical(client, admin):
    """Assigns, releases, assigns again — service query returns all rows."""
    from app.db import SessionLocal
    from app.models.service import Service

    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)
    ip_a = f"10.50.{uuid.uuid4().int % 200 + 1}.4"
    ip_b = f"10.50.{uuid.uuid4().int % 200 + 1}.5"

    # Create a service to link to
    async with SessionLocal() as s:
        svc = Service(
            tenant_id=tenant_id, name="TestSvc-IPAM", status="active",
            subscription_id=None,
        )
        s.add(svc)
        await s.commit()
        service_id = svc.id

    # Assign ip_a to service
    r1 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip_a, "family": 4,
              "service_id": str(service_id)},
    )
    assert r1.status_code == 200, r1.text
    id_a = r1.json()["id"]

    # Release ip_a
    await client.post("/api/ipam/release", headers=admin, json={"assignment_id": id_a})

    # Assign ip_b to same service
    r2 = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip_b, "family": 4,
              "service_id": str(service_id)},
    )
    assert r2.status_code == 200, r2.text

    # Query by service_id — expect both
    get_r = await client.get(f"/api/ipam/assignments?service_id={service_id}", headers=admin)
    assert get_r.status_code == 200, get_r.text
    items = get_r.json()
    addresses = {item["address"] for item in items}
    assert ip_a in addresses
    assert ip_b in addresses


@pytest.mark.asyncio
async def test_lease_expired_row_still_returned(client, admin):
    """An assignment with lease_expires_at in the past is still returned by /assignments."""
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)
    ip = f"10.60.{uuid.uuid4().int % 200 + 1}.6"
    past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

    r = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": ip, "family": 4,
              "lease_expires_at": past},
    )
    assert r.status_code == 200, r.text
    assignment_id = r.json()["id"]

    get_r = await client.get(f"/api/ipam/assignments/{assignment_id}", headers=admin)
    assert get_r.status_code == 200, get_r.text
    body = get_r.json()
    assert body["lease_expires_at"] is not None
    assert body["status"] == "active"   # still active (released_at IS NULL)


@pytest.mark.asyncio
async def test_invalid_ip_format_returns_400(client, admin):
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)

    r = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": "not-an-ip", "family": 4},
    )
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_wrong_ip_family_returns_400(client, admin):
    tenant_id = await _admin_tenant_id()
    alloc_id = await _seed_pool_allocation(tenant_id)

    # Pass an IPv6 address but declare family=4
    r = await client.post(
        "/api/ipam/assign", headers=admin,
        json={"pool_allocation_id": str(alloc_id), "address": "2001:db8::1", "family": 4},
    )
    assert r.status_code == 400, r.text
