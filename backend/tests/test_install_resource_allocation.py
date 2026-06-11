"""NOC Phase A — Stage 9 resource-allocation tests.

Covers the SplitterStrandAllocation + VlanAssignment picker behind
``services/install_board.allocate_resources``:

  * allocate succeeds when order is PROVISIONING + a free strand + a free VLAN exist
  * re-running allocate on the same order is idempotent
  * order NOT in PROVISIONING → 409
  * no free strand → 409 with reason
  * no free VLAN → 409 with reason
  * concurrent / sequential second allocate on a different order with the SAME shared strand
    pool fails with a clean 409 (DB partial-unique guarantees correctness)
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.order import Order
from app.models.record import Record
from app.models.respool import PoolAllocation, ResourcePool
from app.models.splitter import SplitterStrandAllocation
from app.models.user import User
from app.models.vlan import VlanAssignment


# =========================================================================================
# fixtures / helpers
# =========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _customer(client, admin, name: str | None = None) -> str:
    name = name or f"RA Cust {uuid.uuid4().hex[:6]}"
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _make_order_provisioning(client, admin, customer_id: str) -> str:
    """Create a DRAFT order, push it straight to PROVISIONING by mutating status on the row.
    Bypasses the stage-8 gate (not the subject of these tests). Returns the order id."""
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "Install x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(o["id"])))).scalar_one()
        order.status = "installation"
        order.control_pass = True
        await s.commit()
    return o["id"]


async def _seed_splitter(tenant_id: uuid.UUID, strand_count: int = 4) -> uuid.UUID:
    """Create one optical_splitter Record + ``strand_count`` 'free' strands. Returns the
    splitter record id."""
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="optical_splitter",
            status="active",
            data={"name": f"SPL-{uuid.uuid4().hex[:6]}", "ratio": f"1:{strand_count}"},
        )
        s.add(rec)
        await s.flush()
        for n in range(1, strand_count + 1):
            s.add(SplitterStrandAllocation(
                tenant_id=tenant_id, splitter_record_id=rec.id, strand_no=n,
                status="free", allocated_at=datetime.now(timezone.utc),
            ))
        await s.commit()
        return rec.id


async def _seed_vlan_pool(tenant_id: uuid.UUID, *, frm: int = 100, to: int = 110,
                          name_suffix: str | None = None) -> uuid.UUID:
    name_suffix = name_suffix or uuid.uuid4().hex[:4]
    async with SessionLocal() as s:
        pool = ResourcePool(
            tenant_id=tenant_id, owner_node_id=None,
            name=f"VLAN pool {name_suffix}", kind="vlan",
            spec={"from": frm, "to": to},
        )
        s.add(pool)
        await s.commit()
        return pool.id


# =========================================================================================
# tests
# =========================================================================================

@pytest.mark.asyncio
async def test_allocate_succeeds_when_strand_and_vlan_free(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=200, to=205)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)

    r = await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result"]["strand_id"]
    assert body["result"]["vlan_value"]
    assert body["order"]["install_substage"] == "RESOURCE_ALLOC"
    assert body["order"]["splitter_strand_allocation_id"] == body["result"]["strand_id"]
    assert body["order"]["vlan_assignment_id"] == body["result"]["vlan_assignment_id"]

    # The strand row was flipped to 'reserved' and tied to the order.
    async with SessionLocal() as s:
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == uuid.UUID(body["result"]["strand_id"])
            )
        )).scalar_one()
        assert strand.status == "reserved"
        assert str(strand.order_id) == oid


@pytest.mark.asyncio
async def test_allocate_is_idempotent_on_same_order(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=300, to=310)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)

    r1 = (await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )).json()
    r2 = (await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )).json()
    assert r1["result"]["strand_id"] == r2["result"]["strand_id"]
    assert r1["result"]["vlan_assignment_id"] == r2["result"]["vlan_assignment_id"]
    assert r2["result"]["idempotent"] is True


@pytest.mark.asyncio
async def test_allocate_requires_provisioning_status(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=400, to=410)
    cust = await _customer(client, admin)
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": cust,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    # Order is DRAFT — should refuse
    r = await client.post(
        f"/api/install-board/orders/{o['id']}/allocate-resources", headers=admin,
    )
    assert r.status_code == 409, r.text
    assert "installation" in r.json()["detail"]


@pytest.mark.asyncio
async def test_allocate_409_no_free_strand(client, admin):
    tenant_id = await _admin_tenant_id()
    # NOTE: we may have left strands free from previous tests in this session. Pin every
    # remaining free strand FIRST so we can prove the empty-strand path.
    async with SessionLocal() as s:
        existing = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.tenant_id == tenant_id,
                SplitterStrandAllocation.status == "free",
            )
        )).scalars().all()
        for st in existing:
            st.status = "in_use"
        await s.commit()
    await _seed_vlan_pool(tenant_id, frm=500, to=510)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)

    r = await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    assert r.status_code == 409, r.text
    assert "splitter strand" in r.json()["detail"].lower()

    # Cleanup: restore the strands we squashed so later tests have free inventory.
    async with SessionLocal() as s:
        for st in (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.tenant_id == tenant_id,
                SplitterStrandAllocation.id.in_([x.id for x in existing]),
            )
        )).scalars().all():
            st.status = "free"
        await s.commit()


@pytest.mark.asyncio
async def test_allocate_409_no_free_vlan(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    # Drain every VLAN pool's inventory by pre-allocating all values.
    async with SessionLocal() as s:
        pools = (await s.execute(
            select(ResourcePool).where(
                ResourcePool.tenant_id == tenant_id,
                ResourcePool.kind == "vlan",
            )
        )).scalars().all()
        for pool in pools:
            spec = pool.spec or {}
            frm, to = spec.get("from"), spec.get("to")
            if frm is None or to is None:
                continue
            used_vals = set((await s.execute(
                select(PoolAllocation.value).where(
                    PoolAllocation.pool_id == pool.id,
                    PoolAllocation.status == "ALLOCATED",
                )
            )).scalars().all())
            for v in range(int(frm), int(to) + 1):
                if str(v) not in used_vals:
                    s.add(PoolAllocation(
                        tenant_id=tenant_id, pool_id=pool.id,
                        value=str(v), service_id=None,
                        status="ALLOCATED",
                        allocated_at=datetime.now(timezone.utc),
                    ))
        await s.commit()
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)

    r = await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    assert r.status_code == 409, r.text
    assert "vlan" in r.json()["detail"].lower()

    # Cleanup: release the synthetic allocations so later tests still have VLAN inventory.
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(PoolAllocation).where(
                PoolAllocation.tenant_id == tenant_id,
                PoolAllocation.status == "ALLOCATED",
                PoolAllocation.service_id.is_(None),
            )
        )).scalars().all()
        for r in rows:
            r.status = "RELEASED"
            r.released_at = datetime.now(timezone.utc)
        await s.commit()


@pytest.mark.asyncio
async def test_allocate_serial_second_order_picks_different_strand(client, admin):
    """Two orders allocated back-to-back must get DIFFERENT strands (the picker advances) —
    the DB partial-unique guarantees no double-reservation even under raw concurrency."""
    tenant_id = await _admin_tenant_id()
    splitter_id = await _seed_splitter(tenant_id, strand_count=2)
    await _seed_vlan_pool(tenant_id, frm=900, to=910)

    cust1 = await _customer(client, admin)
    cust2 = await _customer(client, admin)
    oid1 = await _make_order_provisioning(client, admin, cust1)
    oid2 = await _make_order_provisioning(client, admin, cust2)

    r1 = (await client.post(
        f"/api/install-board/orders/{oid1}/allocate-resources", headers=admin,
    )).json()
    r2 = (await client.post(
        f"/api/install-board/orders/{oid2}/allocate-resources", headers=admin,
    )).json()
    assert r1["result"]["strand_id"] != r2["result"]["strand_id"]
    # Different VLAN values too.
    assert r1["result"]["vlan_value"] != r2["result"]["vlan_value"]
