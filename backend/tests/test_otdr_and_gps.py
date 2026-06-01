"""NOC Phase B — OTDR + technician GPS pings.

Covers:
  * POST /otdr creates a row that runs immediately (status='done') with result_json
  * Deterministic on same target (hash-based simulator)
  * GET /otdr lists rows for a target
  * Distance + events shape sanity check
  * POST /technician-pings derives technician_user_id from auth
  * Out-of-range lat/lng → 400
  * GET /technicians?since_minutes=30 returns only techs that pinged in the window
  * ping_count is correct in the live list
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select, delete

from app.db import SessionLocal
from app.models.olt_tree import OltChassis, OltCard, OltPort
from app.models.record import Record
from app.models.technician_location import TechnicianLocationPing
from app.models.telemetry import OtdrTest
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin() -> User:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u


async def _admin_tenant_id() -> uuid.UUID:
    u = await _admin()
    return u.tenant_id


async def _admin_user_id() -> uuid.UUID:
    u = await _admin()
    return u.id


async def _seed_port(tenant_id: uuid.UUID) -> uuid.UUID:
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="olt", status="ACTIVE",
            data={"name": f"OLT-OTDR-{uuid.uuid4().hex[:6]}"},
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
        return port.id


# ==========================================================================================
# OTDR tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_post_otdr_creates_and_runs_synchronously(client, admin):
    tenant_id = await _admin_tenant_id()
    port_id = await _seed_port(tenant_id)
    r = await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "done"
    assert body["completed_at"] is not None
    assert body["result_json"] is not None
    assert "trace_distance_m" in body["result_json"]
    assert "events" in body["result_json"]


@pytest.mark.asyncio
async def test_otdr_is_deterministic_on_same_target(client, admin):
    tenant_id = await _admin_tenant_id()
    port_id = await _seed_port(tenant_id)
    r1 = (await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )).json()
    r2 = (await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )).json()
    # Two separate rows, but the result trace is identical.
    assert r1["id"] != r2["id"]
    assert r1["result_json"]["trace_distance_m"] == r2["result_json"]["trace_distance_m"]
    assert r1["result_json"]["loss_db"] == r2["result_json"]["loss_db"]
    assert r1["result_json"]["status"] == r2["result_json"]["status"]


@pytest.mark.asyncio
async def test_list_otdr_for_target(client, admin):
    tenant_id = await _admin_tenant_id()
    port_id = await _seed_port(tenant_id)
    await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )
    await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )
    r = await client.get(
        f"/api/noc/otdr?target_id={port_id}", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 2
    for item in body["items"]:
        assert item["target_id"] == str(port_id)


@pytest.mark.asyncio
async def test_otdr_events_shape_is_valid(client, admin):
    tenant_id = await _admin_tenant_id()
    port_id = await _seed_port(tenant_id)
    r = (await client.post(
        "/api/noc/otdr", headers=admin,
        json={"target_type": "olt_port", "target_id": str(port_id)},
    )).json()
    result = r["result_json"]
    assert isinstance(result["events"], list)
    assert len(result["events"]) >= 3
    assert len(result["events"]) <= 5
    # Distance must be in [200, 8000]
    assert 200 <= result["trace_distance_m"] <= 8000
    for ev in result["events"]:
        assert "distance_m" in ev
        assert "type" in ev
        assert "loss_db" in ev
        assert ev["type"] in {"connector", "splice", "reflection", "fault"}


# ==========================================================================================
# Technician GPS tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_post_technician_ping_derives_user_from_auth(client, admin):
    """Caller never supplies technician_user_id — it's pulled from current_user."""
    admin_uid = await _admin_user_id()
    r = await client.post(
        "/api/noc/technician-pings", headers=admin,
        json={"lat": "40.177200", "lng": "44.503490"},   # Yerevan
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["technician_user_id"] == str(admin_uid)
    assert body["lat"] == "40.177200"
    assert body["lng"] == "44.503490"


@pytest.mark.asyncio
async def test_ping_invalid_lat_lng_returns_400(client, admin):
    r = await client.post(
        "/api/noc/technician-pings", headers=admin,
        json={"lat": "95.0", "lng": "0.0"},
    )
    assert r.status_code == 400
    r2 = await client.post(
        "/api/noc/technician-pings", headers=admin,
        json={"lat": "0.0", "lng": "200.0"},
    )
    assert r2.status_code == 400


@pytest.mark.asyncio
async def test_technicians_live_excludes_stale_pings(client, admin):
    """Pings older than ``since_minutes`` are excluded from the live list."""
    tenant_id = await _admin_tenant_id()
    admin_uid = await _admin_user_id()
    # Wipe any pings to avoid cross-test pollution.
    async with SessionLocal() as s:
        await s.execute(delete(TechnicianLocationPing).where(
            TechnicianLocationPing.tenant_id == tenant_id,
        ))
        await s.commit()
    # Insert one fresh + one stale ping for the admin.
    async with SessionLocal() as s:
        s.add(TechnicianLocationPing(
            tenant_id=tenant_id, technician_user_id=admin_uid,
            lat=Decimal("40.0"), lng=Decimal("44.0"),
            recorded_at=datetime.now(timezone.utc) - timedelta(minutes=5),
        ))
        s.add(TechnicianLocationPing(
            tenant_id=tenant_id, technician_user_id=admin_uid,
            lat=Decimal("40.1"), lng=Decimal("44.1"),
            recorded_at=datetime.now(timezone.utc) - timedelta(minutes=120),  # stale
        ))
        await s.commit()
    r = await client.get(
        "/api/noc/technicians?since_minutes=30", headers=admin,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    techs = body["technicians"]
    assert len(techs) == 1
    assert techs[0]["technician_user_id"] == str(admin_uid)
    assert techs[0]["ping_count"] == 1


@pytest.mark.asyncio
async def test_ping_count_reflects_window(client, admin):
    """ping_count must equal the number of pings within the window per technician."""
    tenant_id = await _admin_tenant_id()
    admin_uid = await _admin_user_id()
    async with SessionLocal() as s:
        await s.execute(delete(TechnicianLocationPing).where(
            TechnicianLocationPing.tenant_id == tenant_id,
        ))
        await s.commit()
    # 3 fresh pings.
    for i in range(3):
        r = await client.post(
            "/api/noc/technician-pings", headers=admin,
            json={"lat": "40.0", "lng": "44.0"},
        )
        assert r.status_code == 200, r.text
    r = await client.get(
        "/api/noc/technicians?since_minutes=30", headers=admin,
    )
    body = r.json()
    techs = body["technicians"]
    assert len(techs) == 1
    assert techs[0]["ping_count"] == 3
    # Latest coords are the latest ping's.
    assert techs[0]["last_lat"] == "40.000000"
    assert techs[0]["last_lng"] == "44.000000"


@pytest.mark.asyncio
async def test_dashboard_endpoint_returns_rollup_and_techs(client, admin):
    """Smoke: the consolidated /dashboard endpoint serves both halves."""
    r = await client.get("/api/noc/dashboard", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "olt_health" in body
    assert "technicians" in body
    assert "total_olts" in body["olt_health"]
    assert "ports_signaling_below_threshold" in body["olt_health"]
    assert "ports_signal_unknown" in body["olt_health"]
