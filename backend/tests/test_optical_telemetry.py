"""NOC Phase B — optical telemetry tests.

Covers:
  * POST optical-reading writes an OpticalPowerSample row with adapter values
  * Adapter is deterministic (same source → same values)
  * Threshold rule -28/-26 → critical/warning/normal
  * olt_health_rollup counts ports_signaling_below_threshold + ports_signal_unknown
  * Source can be either olt_port or onu
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.olt_tree import OltChassis, OltCard, OltPort, Onu
from app.models.record import Record
from app.models.telemetry import OpticalPowerSample
from app.models.user import User
from app.services.diagnostic_adapter import (
    SimulatedDiagnosticAdapter, classify_rx,
)
from app.services.noc_dashboard import olt_health_rollup


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _seed_olt_with_port(tenant_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """Seed an olt Record + one chassis + one card + one port. Returns (olt_id, port_id, card_id)."""
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="olt", status="ACTIVE",
            data={"name": f"OLT-T-{uuid.uuid4().hex[:6]}"},
        )
        s.add(rec)
        await s.flush()
        chassis = OltChassis(
            tenant_id=tenant_id, olt_record_id=rec.id, slot_no=0, status="active",
        )
        s.add(chassis)
        await s.flush()
        card = OltCard(
            tenant_id=tenant_id, chassis_id=chassis.id, slot_no=0,
            type="GPON", port_count=4, status="active",
        )
        s.add(card)
        await s.flush()
        port = OltPort(
            tenant_id=tenant_id, card_id=card.id, port_no=0, type="GPON", status="up",
        )
        s.add(port)
        await s.commit()
        return rec.id, port.id, card.id


async def _seed_port_with_old_sample(
    tenant_id: uuid.UUID, port_id: uuid.UUID, rx: Decimal, *, minutes_ago: int = 0,
) -> None:
    async with SessionLocal() as s:
        s.add(OpticalPowerSample(
            tenant_id=tenant_id,
            source_type="olt_port", source_id=port_id,
            rx_dbm=rx, tx_dbm=Decimal("1.50"),
            sampled_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        ))
        await s.commit()


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_post_port_optical_reading_creates_sample(client, admin):
    tenant_id = await _admin_tenant_id()
    _, port_id, _ = await _seed_olt_with_port(tenant_id)
    r = await client.post(
        f"/api/noc/ports/{port_id}/optical-reading", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_type"] == "olt_port"
    assert body["source_id"] == str(port_id)
    assert body["rx_dbm"] is not None
    # Within plausible range
    rx = Decimal(body["rx_dbm"])
    assert Decimal("-30") <= rx <= Decimal("-15")


@pytest.mark.asyncio
async def test_optical_reading_is_deterministic(client, admin):
    """Same source → same values across calls (hash-based simulator)."""
    tenant_id = await _admin_tenant_id()
    _, port_id, _ = await _seed_olt_with_port(tenant_id)
    r1 = await client.post(
        f"/api/noc/ports/{port_id}/optical-reading", headers=admin,
    )
    r2 = await client.post(
        f"/api/noc/ports/{port_id}/optical-reading", headers=admin,
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["rx_dbm"] == r2.json()["rx_dbm"]
    assert r1.json()["tx_dbm"] == r2.json()["tx_dbm"]


@pytest.mark.asyncio
async def test_threshold_mapping_critical_warning_normal():
    """classify_rx is the single source of truth — verify each band."""
    assert classify_rx(Decimal("-29.5")) == "critical"
    assert classify_rx(Decimal("-28.01")) == "critical"
    assert classify_rx(Decimal("-28.0")) == "warning"
    assert classify_rx(Decimal("-27.0")) == "warning"
    assert classify_rx(Decimal("-26.0")) == "normal"
    assert classify_rx(Decimal("-22.0")) == "normal"
    assert classify_rx(Decimal("0.0")) == "normal"


@pytest.mark.asyncio
async def test_rollup_counts_ports_below_threshold(client, admin):
    """A port whose latest sample is rx<-28 increments ``ports_signaling_below_threshold``."""
    tenant_id = await _admin_tenant_id()
    _, port_id, _ = await _seed_olt_with_port(tenant_id)
    # Direct row insert at rx = -29 (critical), sampled now.
    await _seed_port_with_old_sample(
        tenant_id, port_id, Decimal("-29.00"), minutes_ago=0,
    )
    async with SessionLocal() as s:
        rollup = await olt_health_rollup(s, tenant_id=tenant_id)
    assert rollup["ports_signaling_below_threshold"] >= 1


@pytest.mark.asyncio
async def test_rollup_counts_ports_signal_unknown(client, admin):
    """A port with NO sample (or an old one >5min ago) counts as ``ports_signal_unknown``."""
    tenant_id = await _admin_tenant_id()
    _, port_id, _ = await _seed_olt_with_port(tenant_id)
    # Sample taken 10 min ago — should be considered unknown.
    await _seed_port_with_old_sample(
        tenant_id, port_id, Decimal("-22.00"), minutes_ago=10,
    )
    async with SessionLocal() as s:
        rollup = await olt_health_rollup(s, tenant_id=tenant_id)
    assert rollup["ports_signal_unknown"] >= 1


@pytest.mark.asyncio
async def test_onu_optical_reading_also_works(client, admin):
    """Source can be either olt_port or onu."""
    tenant_id = await _admin_tenant_id()
    _, port_id, _ = await _seed_olt_with_port(tenant_id)
    # Create an ONU under this port
    serial = f"OPT{uuid.uuid4().hex[:10].upper()}"
    async with SessionLocal() as s:
        onu = Onu(
            tenant_id=tenant_id, port_id=port_id, serial=serial,
            status="active",
        )
        s.add(onu)
        await s.commit()
        onu_id = onu.id

    r = await client.post(
        f"/api/noc/onus/{onu_id}/optical-reading", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_type"] == "onu"
    assert body["source_id"] == str(onu_id)


@pytest.mark.asyncio
async def test_simulator_status_matches_classify_rx():
    """The reading.status field must always agree with classify_rx(rx_dbm)."""
    adapter = SimulatedDiagnosticAdapter()
    for _ in range(20):
        # Stable but varied ids
        sid = uuid.uuid4()
        reading = await adapter.read_optical_power(
            source_type="olt_port", source_id=sid,
        )
        assert reading["status"] == classify_rx(reading["rx_dbm"])
