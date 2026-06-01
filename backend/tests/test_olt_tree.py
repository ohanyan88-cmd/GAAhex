"""NOC Phase B — OLT structural tree tests.

Covers the chassis → card → port → ONU CRUD + tree assembly + the soft-delete
('removed' status) semantics that frees the ONU serial for re-binding.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.olt_tree import OltChassis, OltCard, OltPort, Onu
from app.models.record import Record
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _seed_olt_record(tenant_id: uuid.UUID, name: str | None = None) -> uuid.UUID:
    """Materialize a Record(entity_key='olt') and return its id."""
    name = name or f"OLT-{uuid.uuid4().hex[:6]}"
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="olt", status="ACTIVE",
            data={"name": name, "ip": "10.0.0.1", "vendor": "Huawei"},
        )
        s.add(rec)
        await s.commit()
        return rec.id


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_create_chassis_on_olt(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    r = await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "model": "MA5800-X17", "status": "active"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["olt_record_id"] == str(olt_id)
    assert body["slot_no"] == 0
    assert body["model"] == "MA5800-X17"
    assert body["status"] == "active"


@pytest.mark.asyncio
async def test_duplicate_chassis_slot_returns_409(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    r1 = await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )
    assert r1.status_code == 200, r1.text
    r2 = await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )
    assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_build_full_tree_chassis_card_port_onu(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    # 1 chassis
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    # 1 card
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 1, "type": "GPON", "port_count": 16, "status": "active"},
    )).json()
    # 1 port
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    # 1 ONU
    serial = f"ONU{uuid.uuid4().hex[:10].upper()}"
    o = (await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "model": "HG8245H", "distance_m": 800, "status": "active"},
    )).json()
    assert o["serial"] == serial
    assert o["port_id"] == p["id"]
    assert o["distance_m"] == 800


@pytest.mark.asyncio
async def test_get_tree_returns_nested_structure(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id, name="OLT-TREE")
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    serial = f"ONU{uuid.uuid4().hex[:10].upper()}"
    await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )

    r = await client.get(f"/api/noc/olts/{olt_id}/tree", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["olt"]["id"] == str(olt_id)
    assert len(body["chassis"]) == 1
    assert len(body["chassis"][0]["cards"]) == 1
    assert len(body["chassis"][0]["cards"][0]["ports"]) == 1
    port_node = body["chassis"][0]["cards"][0]["ports"][0]
    assert port_node["onu_count"] == 1
    assert body["totals"]["chassis"] == 1
    assert body["totals"]["cards"] == 1
    assert body["totals"]["ports"] == 1
    assert body["totals"]["onus_active"] >= 1


@pytest.mark.asyncio
async def test_duplicate_onu_serial_returns_409(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    serial = f"DUP{uuid.uuid4().hex[:10].upper()}"
    r1 = await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )
    assert r1.status_code == 200
    r2 = await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )
    assert r2.status_code == 409, r2.text


@pytest.mark.asyncio
async def test_removed_onu_frees_serial_for_rebinding(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    serial = f"REUSE{uuid.uuid4().hex[:8].upper()}"
    o1 = (await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )).json()
    # Mark removed
    pr = await client.patch(
        f"/api/noc/onus/{o1['id']}", headers=admin,
        json={"status": "removed"},
    )
    assert pr.status_code == 200, pr.text
    # Now re-bind same serial
    o2 = await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )
    assert o2.status_code == 200, o2.text
    assert o2.json()["serial"] == serial
    assert o2.json()["id"] != o1["id"]


@pytest.mark.asyncio
async def test_patch_onu_status_customer_service(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    serial = f"PAT{uuid.uuid4().hex[:10].upper()}"
    o = (await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )).json()
    # Create a customer Record
    cust = (await client.post("/api/customers", headers=admin, json={
        "name": f"NOC Cust {uuid.uuid4().hex[:6]}",
    })).json()
    pr = await client.patch(
        f"/api/noc/onus/{o['id']}", headers=admin,
        json={"status": "los", "customer_id": cust["id"]},
    )
    assert pr.status_code == 200, pr.text
    body = pr.json()
    assert body["status"] == "los"
    assert body["customer_id"] == cust["id"]


@pytest.mark.asyncio
async def test_chassis_removed_does_not_cascade_delete_cards(client, admin):
    """Soft semantic: 'removed' is a status tombstone, not a physical delete. Dependent rows
    survive — preserving audit + downstream FK references."""
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    # Flip the chassis to 'removed' directly on the row.
    async with SessionLocal() as s:
        ch = (await s.execute(
            select(OltChassis).where(OltChassis.id == uuid.UUID(c["id"]))
        )).scalar_one()
        ch.status = "removed"
        await s.commit()
        # The card row is still there.
        cd = (await s.execute(
            select(OltCard).where(OltCard.id == uuid.UUID(card["id"]))
        )).scalar_one_or_none()
        assert cd is not None
        assert cd.chassis_id == ch.id


@pytest.mark.asyncio
async def test_list_onus_filter_by_customer(client, admin):
    tenant_id = await _admin_tenant_id()
    olt_id = await _seed_olt_record(tenant_id)
    c = (await client.post(
        f"/api/noc/olts/{olt_id}/chassis", headers=admin,
        json={"slot_no": 0, "status": "active"},
    )).json()
    card = (await client.post(
        f"/api/noc/chassis/{c['id']}/cards", headers=admin,
        json={"slot_no": 0, "type": "GPON", "port_count": 4, "status": "active"},
    )).json()
    p = (await client.post(
        f"/api/noc/cards/{card['id']}/ports", headers=admin,
        json={"port_no": 0, "type": "GPON", "status": "up"},
    )).json()
    serial = f"LIST{uuid.uuid4().hex[:10].upper()}"
    o = (await client.post(
        f"/api/noc/ports/{p['id']}/onus", headers=admin,
        json={"serial": serial, "status": "active"},
    )).json()
    # Bind to a customer
    cust = (await client.post("/api/customers", headers=admin, json={
        "name": f"NOC List Cust {uuid.uuid4().hex[:6]}",
    })).json()
    await client.patch(
        f"/api/noc/onus/{o['id']}", headers=admin,
        json={"customer_id": cust["id"]},
    )
    r = await client.get(
        f"/api/noc/onus?customer_id={cust['id']}", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    serials = [item["serial"] for item in body["items"]]
    assert serial in serials
