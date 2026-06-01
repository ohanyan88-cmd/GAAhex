"""NOC Phase A — Stage 11 service-activation tests.

Covers ``services/install_board.activate_service`` + ``/api/install-board/orders/{id}/activate``
+ the ``/api/install-board`` listing endpoint:

  * activate succeeds only when strand + VLAN + CPE are all bound on the order
  * activate without strand → 409 with reason
  * activate without VLAN → 409 with reason
  * activate without CPE binding → 409 with reason
  * after activation: strand status='in_use', CpeBinding.status='provisioned',
    Order.install_substage='ACTIVATED', CpeBinding.last_payload_json populated
  * list_install_board returns the activated order under the ACTIVATED substage filter
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.cpe_binding import CpeBinding
from app.models.order import Order
from app.models.record import Record
from app.models.respool import ResourcePool
from app.models.splitter import SplitterStrandAllocation
from app.models.user import User


async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _customer(client, admin, name: str | None = None) -> str:
    name = name or f"Act Cust {uuid.uuid4().hex[:6]}"
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _make_order_provisioning(client, admin, customer_id: str) -> str:
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(o["id"])))).scalar_one()
        order.status = "PROVISIONING"
        order.control_pass = True
        await s.commit()
    return o["id"]


async def _seed_splitter(tenant_id: uuid.UUID, strand_count: int = 4) -> uuid.UUID:
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


async def _seed_vlan_pool(tenant_id: uuid.UUID, *, frm: int, to: int) -> uuid.UUID:
    async with SessionLocal() as s:
        pool = ResourcePool(
            tenant_id=tenant_id, owner_node_id=None,
            name=f"Act VLAN pool {uuid.uuid4().hex[:4]}", kind="vlan",
            spec={"from": frm, "to": to},
        )
        s.add(pool)
        await s.commit()
        return pool.id


def _u_mac() -> str:
    h = uuid.uuid4().hex[:12]
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def _u_serial() -> str:
    return f"SN{uuid.uuid4().hex[:10].upper()}"


async def _prepare_order_for_activate(client, admin, *, vlan_from: int, vlan_to: int) -> tuple[str, str, str]:
    """Set up a PROVISIONING order with strand + VLAN + CPE all bound. Returns (order_id, mac, serial)."""
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=vlan_from, to=vlan_to)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    # Step 9
    r = await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    assert r.status_code == 200, r.text
    # Step 10
    mac = _u_mac()
    serial = _u_serial()
    r = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial, "vendor": "ZTE"},
    )
    assert r.status_code == 200, r.text
    return oid, mac, serial


# =========================================================================================
# tests
# =========================================================================================

@pytest.mark.asyncio
async def test_activate_succeeds_when_all_resources_bound(client, admin):
    oid, mac, serial = await _prepare_order_for_activate(client, admin, vlan_from=1000, vlan_to=1010)
    r = await client.post(
        f"/api/install-board/orders/{oid}/activate", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order"]["install_substage"] == "ACTIVATED"
    assert body["result"]["activated_at"]
    assert body["result"]["vlan_value"]


@pytest.mark.asyncio
async def test_activate_409_without_strand(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_vlan_pool(tenant_id, frm=1100, to=1110)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    # Bind CPE only (no strand, no VLAN)
    await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": _u_mac(), "serial": _u_serial()},
    )
    r = await client.post(
        f"/api/install-board/orders/{oid}/activate", headers=admin,
    )
    assert r.status_code == 409
    detail = r.json()["detail"].lower()
    assert "splitter" in detail or "strand" in detail


@pytest.mark.asyncio
async def test_activate_409_without_vlan(client, admin):
    """Hand-stitch a strand reservation onto the order WITHOUT going through allocate (which
    would also pick a VLAN). Then bind a CPE, then try to activate."""
    tenant_id = await _admin_tenant_id()
    splitter_id = await _seed_splitter(tenant_id, strand_count=2)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    async with SessionLocal() as s:
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.splitter_record_id == splitter_id,
                SplitterStrandAllocation.status == "free",
            )
        )).scalars().first()
        strand.status = "reserved"
        strand.order_id = uuid.UUID(oid)
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(oid)))).scalar_one()
        order.splitter_strand_allocation_id = strand.id
        order.install_substage = "RESOURCE_ALLOC"
        order.install_substage_at = datetime.now(timezone.utc)
        await s.commit()
    await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": _u_mac(), "serial": _u_serial()},
    )
    r = await client.post(
        f"/api/install-board/orders/{oid}/activate", headers=admin,
    )
    assert r.status_code == 409
    assert "vlan" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_activate_409_without_cpe_binding(client, admin):
    tenant_id = await _admin_tenant_id()
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=1200, to=1210)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    # No CPE bind step!
    r = await client.post(
        f"/api/install-board/orders/{oid}/activate", headers=admin,
    )
    assert r.status_code == 409
    assert "cpe" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_activate_flips_strand_in_use_and_cpe_provisioned(client, admin):
    oid, mac, serial = await _prepare_order_for_activate(client, admin, vlan_from=1300, vlan_to=1310)
    r = await client.post(
        f"/api/install-board/orders/{oid}/activate", headers=admin,
    )
    assert r.status_code == 200, r.text
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(oid)))).scalar_one()
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == order.splitter_strand_allocation_id
            )
        )).scalar_one()
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        assert strand.status == "in_use"
        assert cpe.status == "provisioned"
        assert cpe.provisioned_at is not None
        assert cpe.last_payload_json is not None
        assert cpe.last_payload_json.get("vlan")
        assert cpe.last_payload_json.get("mac") == mac
        assert order.install_substage == "ACTIVATED"


@pytest.mark.asyncio
async def test_activate_is_idempotent(client, admin):
    """Re-activating an already-activated order is a no-op summary (idempotent=True)."""
    oid, _mac, _serial = await _prepare_order_for_activate(client, admin, vlan_from=1500, vlan_to=1510)
    r1 = await client.post(f"/api/install-board/orders/{oid}/activate", headers=admin)
    assert r1.status_code == 200, r1.text
    r2 = await client.post(f"/api/install-board/orders/{oid}/activate", headers=admin)
    assert r2.status_code == 200, r2.text
    assert r2.json()["result"]["idempotent"] is True


@pytest.mark.asyncio
async def test_install_summary_after_activate(client, admin):
    """install-summary returns the full snapshot (order + strand + vlan + cpe) post-activation."""
    oid, mac, serial = await _prepare_order_for_activate(client, admin, vlan_from=1600, vlan_to=1610)
    await client.post(f"/api/install-board/orders/{oid}/activate", headers=admin)
    r = await client.get(f"/api/install-board/orders/{oid}/install-summary", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["order"]["install_substage"] == "ACTIVATED"
    assert body["splitter_strand"]["status"] == "in_use"
    assert body["vlan"]["vlan_value"]
    assert body["cpe"]["status"] == "provisioned"
    assert body["cpe"]["mac_address"] == mac


@pytest.mark.asyncio
async def test_splitter_strands_endpoint_returns_counts(client, admin):
    """GET /api/splitters/{id}/strands returns the strand rows + a counts dict."""
    tenant_id = await _admin_tenant_id()
    splitter_id = await _seed_splitter(tenant_id, strand_count=4)
    r = await client.get(f"/api/splitters/{splitter_id}/strands", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 4
    assert body["counts"].get("free") == 4
    assert len(body["strands"]) == 4
    # Strand numbers are 1..N ascending
    nos = [st["strand_no"] for st in body["strands"]]
    assert nos == sorted(nos)


@pytest.mark.asyncio
async def test_cpe_bindings_listing_filters_by_order(client, admin):
    """GET /api/cpe-bindings?order_id=... filters to the requested order."""
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    mac = _u_mac()
    serial = _u_serial()
    await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial},
    )
    r = await client.get(f"/api/cpe-bindings?order_id={oid}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 1
    macs = [it["mac_address"] for it in body["items"]]
    assert mac in macs
    # And a /api/cpe-bindings/{id} fetch hits the same row
    one = body["items"][0]
    r2 = await client.get(f"/api/cpe-bindings/{one['id']}", headers=admin)
    assert r2.status_code == 200
    assert r2.json()["id"] == one["id"]


@pytest.mark.asyncio
async def test_install_board_list_filters_by_substage(client, admin):
    """An order that finished the full pipeline shows up under the ACTIVATED substage filter
    on the /api/install-board list."""
    oid, _mac, _serial = await _prepare_order_for_activate(client, admin, vlan_from=1400, vlan_to=1410)
    await client.post(f"/api/install-board/orders/{oid}/activate", headers=admin)

    r = await client.get(
        "/api/install-board?substage=ACTIVATED", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [it["id"] for it in body["items"]]
    assert oid in ids
    # And NOT under the RESOURCE_ALLOC filter.
    r2 = await client.get(
        "/api/install-board?substage=RESOURCE_ALLOC", headers=admin,
    )
    ids2 = [it["id"] for it in r2.json()["items"]]
    assert oid not in ids2
