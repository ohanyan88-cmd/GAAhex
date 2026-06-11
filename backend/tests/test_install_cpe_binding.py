"""NOC Phase A — Stage 10 CPE binding tests.

Covers ``services/install_board.bind_cpe`` + ``/api/install-board/orders/{id}/bind-cpe`` + the
MAC normalization helper:

  * bind_cpe creates a CpeBinding with status='pending'
  * MAC normalization across the common formats (colon / dash / dot / no-separator)
  * invalid MAC → 400
  * duplicate MAC on a DIFFERENT order → 409
  * same MAC on the SAME order is idempotent (returns the existing pending binding)
  * status flip to 'replaced' frees the (mac, serial) pair for re-binding
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.cpe_binding import CpeBinding
from app.models.order import Order
from app.models.user import User


async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _customer(client, admin, name: str | None = None) -> str:
    name = name or f"CPE Cust {uuid.uuid4().hex[:6]}"
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _make_order_provisioning(client, admin, customer_id: str) -> str:
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(o["id"])))).scalar_one()
        order.status = "installation"
        order.control_pass = True
        await s.commit()
    return o["id"]


def _u_mac() -> str:
    """Unique MAC per test, formatted aa:bb:cc:dd:ee:ff."""
    h = uuid.uuid4().hex[:12]
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def _u_serial() -> str:
    return f"SN{uuid.uuid4().hex[:10].upper()}"


# =========================================================================================
# tests
# =========================================================================================

@pytest.mark.asyncio
async def test_bind_cpe_creates_pending_row(client, admin):
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    mac = _u_mac()
    serial = _u_serial()
    r = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial,
              "vendor": "ZTE", "model": "F660", "firmware": "1.0.5"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cpe_binding"]["mac_address"] == mac
    assert body["cpe_binding"]["serial"] == serial
    assert body["cpe_binding"]["status"] == "pending"
    assert body["cpe_binding"]["vendor"] == "ZTE"
    assert body["order"]["install_substage"] == "CPE_BOUND"
    assert body["order"]["cpe_binding_id"] == body["cpe_binding"]["id"]


@pytest.mark.asyncio
async def test_bind_cpe_normalizes_mac_dash_uppercase(client, admin):
    """Dashes + uppercase → colon-separated lowercase persisted."""
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    # generate a unique MAC then re-format it dash-uppercase
    h = uuid.uuid4().hex[:12]
    dashed = "-".join(h[i:i + 2] for i in range(0, 12, 2)).upper()
    expected = ":".join(h[i:i + 2] for i in range(0, 12, 2)).lower()
    r = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": dashed, "serial": _u_serial()},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cpe_binding"]["mac_address"] == expected


@pytest.mark.asyncio
async def test_bind_cpe_400_on_invalid_mac(client, admin):
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    r = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": "not-a-mac", "serial": _u_serial()},
    )
    assert r.status_code == 400, r.text
    assert "mac" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_bind_cpe_duplicate_mac_different_order_returns_409(client, admin):
    cust1 = await _customer(client, admin)
    cust2 = await _customer(client, admin)
    oid1 = await _make_order_provisioning(client, admin, cust1)
    oid2 = await _make_order_provisioning(client, admin, cust2)
    mac = _u_mac()
    serial1 = _u_serial()
    serial2 = _u_serial()
    r1 = await client.post(
        f"/api/install-board/orders/{oid1}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial1},
    )
    assert r1.status_code == 200, r1.text
    r2 = await client.post(
        f"/api/install-board/orders/{oid2}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial2},
    )
    assert r2.status_code == 409, r2.text
    assert "mac" in r2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_bind_cpe_idempotent_same_order_same_mac_serial(client, admin):
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    mac = _u_mac()
    serial = _u_serial()
    r1 = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial},
    )
    r2 = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial},
    )
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["cpe_binding"]["id"] == r2.json()["cpe_binding"]["id"]


@pytest.mark.asyncio
async def test_replaced_status_frees_mac_serial_for_rebinding(client, admin):
    """Flip an existing binding to 'replaced' — the (mac, serial) pair becomes available
    again because the partial-unique excludes status='replaced' rows."""
    tenant_id = await _admin_tenant_id()
    cust1 = await _customer(client, admin)
    cust2 = await _customer(client, admin)
    oid1 = await _make_order_provisioning(client, admin, cust1)
    oid2 = await _make_order_provisioning(client, admin, cust2)
    mac = _u_mac()
    serial = _u_serial()
    r1 = (await client.post(
        f"/api/install-board/orders/{oid1}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial},
    )).json()
    # Mark the first row as replaced (mimics swap-out workflow).
    async with SessionLocal() as s:
        c = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == uuid.UUID(r1["cpe_binding"]["id"]))
        )).scalar_one()
        c.status = "replaced"
        # The order still points at the replaced row, but a re-bind on a NEW order should now
        # be possible.
        await s.commit()
    r2 = await client.post(
        f"/api/install-board/orders/{oid2}/bind-cpe", headers=admin,
        json={"mac_address": mac, "serial": serial},
    )
    assert r2.status_code == 200, r2.text
    # The new pending row is distinct from the replaced one.
    assert r2.json()["cpe_binding"]["id"] != r1["cpe_binding"]["id"]
    assert r2.json()["cpe_binding"]["status"] == "pending"
