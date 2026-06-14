"""P1 — real OLT-driver wiring on Stage-11 activate_service.

The Stage-2 remediation added a fail-closed gate but still never called the OLT driver — the
service flipped to ACTIVE while the optical port was never provisioned. P1 closes that: when OLT
provisioning is enabled AND the splitter is mapped to a real OLT (config on optical_splitter.data),
activate_service now actually drives the vendor driver (set_vlan + provision_onu) and rolls the DB
back on a driver failure.

This pack pins:
  * mapped splitter + real driver         → provision_onu called with the resolved target;
                                            order ACTIVATED; SERVICE_ACTIVATED_OLT audit; CPE payload.
  * real driver raises                    → DB rolled back (order NOT activated, strand not in_use,
                                            CPE back to pending) + SERVICE_ACTIVATION_FAILED audit + 502.
  * enabled but splitter NOT mapped       → dev-mode fallback (DB-only success, no driver call).

The driver is a FakeOltDriver registered under vendor 'fakeolt' so we never touch real hardware.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.db import SessionLocal
from app.models.cpe_binding import CpeBinding
from app.models.event import Event
from app.models.order import Order
from app.models.record import Record
from app.models.respool import PoolAllocation, ResourcePool
from app.models.splitter import SplitterStrandAllocation
from app.models.user import User
from app.models.vlan import VlanAssignment
from app.services import install_board as ib_service
from app.services.olt.driver import OnuProvisionResult, VlanSetResult
from app.services.olt.exceptions import OltCommandError
from app.services.olt.factory import register_driver


# =========================================================================================
# Fake OLT driver — vendor != 'mock' so the service treats it as a real driver. Records its
# calls at class level (get_driver_for_olt builds a fresh instance inside activate_service, so
# the test can't hold the instance — class-level recording is how we inspect it).
# =========================================================================================

class FakeOltDriver:
    vendor: str = "fakeolt"
    calls: list = []
    fail_on: str | None = None

    @classmethod
    def reset(cls) -> None:
        cls.calls = []
        cls.fail_on = None

    def __init__(self, *, host, port=0, credentials=None, olt_record_id=None) -> None:
        self._host = host

    async def set_vlan(self, *, slot, port, vlan_id, purpose):
        FakeOltDriver.calls.append(("set_vlan", slot, port, vlan_id, purpose))
        if FakeOltDriver.fail_on == "set_vlan":
            raise OltCommandError("fake set_vlan failure")
        return VlanSetResult(
            slot=slot, port=port, vlan_id=vlan_id, purpose=purpose,
            applied_at=datetime.now(timezone.utc), raw={},
        )

    async def provision_onu(self, *, serial, slot, port, line_profile, vlan_id, customer_ref=None):
        FakeOltDriver.calls.append(
            ("provision_onu", serial, slot, port, line_profile, vlan_id, customer_ref)
        )
        if FakeOltDriver.fail_on == "provision_onu":
            raise OltCommandError("fake provision failure")
        return OnuProvisionResult(
            serial=serial, slot=slot, port=port, vlan_id=vlan_id, line_profile=line_profile,
            onu_id="fake-onu-1", provisioned_at=datetime.now(timezone.utc), raw={},
        )

    async def close(self):
        FakeOltDriver.calls.append(("close",))


register_driver("fakeolt", FakeOltDriver)


# =========================================================================================
# helpers — mirror the conventions in test_install_activate.py / test_remediation_stage2_olt.py
# =========================================================================================

async def _admin_user() -> User:
    async with SessionLocal() as s:
        return (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()


async def _customer(client, admin, name: str | None = None) -> str:
    name = name or f"OLT Cust {uuid.uuid4().hex[:6]}"
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _make_order_provisioning(client, admin, customer_id: str) -> str:
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(o["id"])))).scalar_one()
        order.status = "INSTALLATION"
        order.control_pass = True
        await s.commit()
    return o["id"]


async def _seed_olt(tenant_id: uuid.UUID, *, vendor: str = "fakeolt") -> uuid.UUID:
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="olt", status="active",
            data={"name": f"OLT-{uuid.uuid4().hex[:6]}", "vendor": vendor, "host": "10.0.0.9", "port": 22},
        )
        s.add(rec)
        await s.commit()
        return rec.id


async def _seed_splitter(
    tenant_id: uuid.UUID, *, olt_id: uuid.UUID | None, slot: int = 0, port: int = 1, strands: int = 2,
) -> uuid.UUID:
    """Optical splitter Record + free strands. When ``olt_id`` is given, the splitter carries the
    config uplink (olt_record_id/olt_slot/olt_port) that resolve_provisioning_target reads."""
    data: dict = {"name": f"SPL-{uuid.uuid4().hex[:6]}", "ratio": f"1:{strands}"}
    if olt_id is not None:
        data.update({"olt_record_id": str(olt_id), "olt_slot": slot, "olt_port": port})
    async with SessionLocal() as s:
        rec = Record(tenant_id=tenant_id, entity_key="optical_splitter", status="active", data=data)
        s.add(rec)
        await s.flush()
        for n in range(1, strands + 1):
            s.add(SplitterStrandAllocation(
                tenant_id=tenant_id, splitter_record_id=rec.id, strand_no=n,
                status="free", allocated_at=datetime.now(timezone.utc),
            ))
        await s.commit()
        return rec.id


def _u_mac() -> str:
    h = uuid.uuid4().hex[:12]
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def _u_serial() -> str:
    return f"SN{uuid.uuid4().hex[:10].upper()}"


async def _stitch_resources(
    tenant_id: uuid.UUID, order_id: uuid.UUID, splitter_id: uuid.UUID, *, vlan_value: int,
) -> None:
    """Reserve a free strand on the given splitter + assign a VLAN to the order, deterministically
    (no allocate_resources, so the order is guaranteed to use OUR mapped splitter)."""
    now = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        strand = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.splitter_record_id == splitter_id,
                SplitterStrandAllocation.status == "free",
            ).order_by(SplitterStrandAllocation.strand_no)
        )).scalars().first()
        strand.status = "reserved"
        strand.order_id = order_id
        pool = ResourcePool(
            tenant_id=tenant_id, owner_node_id=None,
            name=f"OLT VLAN pool {uuid.uuid4().hex[:4]}", kind="vlan",
            spec={"from": vlan_value, "to": vlan_value},
        )
        s.add(pool)
        await s.flush()
        pa = PoolAllocation(
            tenant_id=tenant_id, pool_id=pool.id, value=str(vlan_value),
            service_id=None, status="ALLOCATED", allocated_at=now,
        )
        s.add(pa)
        await s.flush()
        va = VlanAssignment(
            tenant_id=tenant_id, pool_allocation_id=pa.id, service_id=None,
            order_id=order_id, purpose="data", assigned_at=now,
        )
        s.add(va)
        await s.flush()
        order = (await s.execute(select(Order).where(Order.id == order_id))).scalar_one()
        order.splitter_strand_allocation_id = strand.id
        order.vlan_assignment_id = va.id
        order.install_substage = "RESOURCE_ALLOC"
        order.install_substage_at = now
        await s.commit()


async def _bind_cpe(order_id: uuid.UUID, tenant_id: uuid.UUID, actor_id: uuid.UUID, mac: str, serial: str) -> None:
    async with SessionLocal() as s:
        await ib_service.bind_cpe(
            s, order_id=order_id, mac_address=mac, serial=serial,
            tenant_id=tenant_id, actor_id=actor_id,
        )
        await s.commit()


def _gate_state(monkeypatch, *, enabled: bool, required: bool) -> None:
    gate = ib_service.feature_gate

    def _is_enabled(key: str) -> bool:
        if key in ("olt", "olt_provisioning"):
            return enabled
        return False

    monkeypatch.setattr(gate, "is_enabled", _is_enabled, raising=False)
    monkeypatch.setattr(gate, "feature_olt_provisioning_required", required, raising=False)


async def _prepare(client, admin, *, mapped: bool, vlan_value: int, slot: int = 0, port: int = 1):
    """Build a fully-bound PROVISIONING order. Returns (order_id, tenant_id, actor_id, serial)."""
    au = await _admin_user()
    tid = au.tenant_id
    olt_id = await _seed_olt(tid) if mapped else None
    spl_id = await _seed_splitter(tid, olt_id=olt_id, slot=slot, port=port, strands=2)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    mac, serial = _u_mac(), _u_serial()
    await _stitch_resources(tid, uuid.UUID(oid), spl_id, vlan_value=vlan_value)
    await _bind_cpe(uuid.UUID(oid), tid, au.id, mac, serial)
    return oid, tid, au.id, serial


# =========================================================================================
# tests
# =========================================================================================

@pytest.mark.asyncio
async def test_real_driver_provisions_onu_on_activate(client, admin, monkeypatch):
    FakeOltDriver.reset()
    oid, tid, actor_id, serial = await _prepare(client, admin, mapped=True, vlan_value=1234, slot=0, port=1)
    _gate_state(monkeypatch, enabled=True, required=True)

    async with SessionLocal() as s:
        result = await ib_service.activate_service(
            s, order_id=uuid.UUID(oid), tenant_id=tid, actor_id=actor_id,
        )
        await s.commit()
    assert result["idempotent"] is False

    # The driver received provision_onu with the config-resolved target.
    prov = [c for c in FakeOltDriver.calls if c[0] == "provision_onu"]
    assert len(prov) == 1, FakeOltDriver.calls
    _, p_serial, p_slot, p_port, _p_profile, p_vlan, _ref = prov[0]
    assert (p_serial, p_slot, p_port, p_vlan) == (serial, 0, 1, 1234)
    # set_vlan ran first.
    assert any(c[0] == "set_vlan" for c in FakeOltDriver.calls)

    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(oid)))).scalar_one()
        assert order.install_substage == "ACTIVATED"
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        assert cpe.status == "provisioned"
        assert cpe.last_payload_json.get("olt_provisioned") is True
        assert cpe.last_payload_json.get("onu_serial") == serial
        evts = (await s.execute(select(Event).where(
            Event.type == "SERVICE_ACTIVATED_OLT", Event.record_id == order.id,
        ))).scalars().all()
        assert len(evts) == 1
        assert evts[0].data.get("vendor") == "fakeolt"


@pytest.mark.asyncio
async def test_real_driver_failure_rolls_back(client, admin, monkeypatch):
    FakeOltDriver.reset()
    FakeOltDriver.fail_on = "provision_onu"
    oid, tid, actor_id, _serial = await _prepare(client, admin, mapped=True, vlan_value=1500, slot=0, port=2)
    _gate_state(monkeypatch, enabled=True, required=True)

    async with SessionLocal() as s:
        with pytest.raises(HTTPException) as ei:
            await ib_service.activate_service(
                s, order_id=uuid.UUID(oid), tenant_id=tid, actor_id=actor_id,
            )
        await s.commit()
    assert ei.value.status_code == 502

    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(oid)))).scalar_one()
        assert order.install_substage != "ACTIVATED"
        strand = (await s.execute(select(SplitterStrandAllocation).where(
            SplitterStrandAllocation.id == order.splitter_strand_allocation_id,
        ))).scalar_one()
        assert strand.status != "in_use"
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        assert cpe.status == "pending"
        failed = (await s.execute(select(Event).where(
            Event.type == "SERVICE_ACTIVATION_FAILED", Event.record_id == order.id,
        ))).scalars().all()
        assert len(failed) >= 1


@pytest.mark.asyncio
async def test_enabled_but_unmapped_splitter_falls_back_to_devmode(client, admin, monkeypatch):
    FakeOltDriver.reset()
    oid, tid, actor_id, _serial = await _prepare(client, admin, mapped=False, vlan_value=1600)
    _gate_state(monkeypatch, enabled=True, required=True)

    async with SessionLocal() as s:
        result = await ib_service.activate_service(
            s, order_id=uuid.UUID(oid), tenant_id=tid, actor_id=actor_id,
        )
        await s.commit()
    assert result["idempotent"] is False

    # No real driver call happened — the splitter isn't mapped to an OLT.
    assert [c for c in FakeOltDriver.calls if c[0] == "provision_onu"] == []

    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(oid)))).scalar_one()
        assert order.install_substage == "ACTIVATED"  # dev-mode DB-only success
        dev = (await s.execute(select(Event).where(
            Event.type == "OLT_DRIVER_INVOKED", Event.record_id == order.id,
        ))).scalars().all()
        assert len(dev) == 1
