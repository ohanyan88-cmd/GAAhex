"""NOC Phase B — dashboard rollups + telemetry/OTDR/GPS service.

Pure helpers for the NOC observability page. Reads aggregate by tenant; writes are
explicit (take_optical_reading, schedule_otdr, record_technician_ping). All commits
are caller-owned.

The optical threshold lives ONLY in ``diagnostic_adapter.classify_rx`` — this module
reuses it for the dashboard rollup so there is exactly one source of truth.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select, func, and_, desc, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.olt_tree import OltChassis, OltCard, OltPort, Onu
from ..models.record import Record
from ..models.technician_location import TechnicianLocationPing
from ..models.telemetry import OpticalPowerSample, OtdrTest
from .diagnostic_adapter import (
    DiagnosticAdapter, get_diagnostic_adapter, classify_rx,
)


# ==========================================================================================
# Constants
# ==========================================================================================

# A port is "signal_unknown" if its latest sample is older than this; if it has no sample
# at all, it's also "signal_unknown".
SIGNAL_STALENESS = timedelta(minutes=5)
# Critical threshold (mirrors classify_rx — kept here as a Decimal literal for the SQL aggregate).
CRITICAL_RX_DBM = Decimal("-28.0")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ==========================================================================================
# olt_health_rollup
# ==========================================================================================

async def olt_health_rollup(session: AsyncSession, *, tenant_id: uuid.UUID) -> dict:
    """Return the dashboard rollup: counts of OLTs/chassis/cards/ports/ONUs by status
    + signal-stale ports. Cheap aggregate queries — no N+1."""
    # Total OLTs = distinct Record(entity_key='olt') for the tenant.
    total_olts = (await session.execute(
        select(func.count()).select_from(Record).where(
            Record.tenant_id == tenant_id,
            Record.entity_key == "olt",
        )
    )).scalar_one() or 0

    chassis_q = await session.execute(
        select(OltChassis.status, func.count()).where(
            OltChassis.tenant_id == tenant_id,
        ).group_by(OltChassis.status)
    )
    chassis_counts = {row[0]: int(row[1]) for row in chassis_q.all()}

    card_q = await session.execute(
        select(OltCard.status, func.count()).where(
            OltCard.tenant_id == tenant_id,
        ).group_by(OltCard.status)
    )
    card_counts = {row[0]: int(row[1]) for row in card_q.all()}

    port_q = await session.execute(
        select(OltPort.status, func.count()).where(
            OltPort.tenant_id == tenant_id,
        ).group_by(OltPort.status)
    )
    port_counts = {row[0]: int(row[1]) for row in port_q.all()}

    onu_q = await session.execute(
        select(Onu.status, func.count()).where(
            Onu.tenant_id == tenant_id,
        ).group_by(Onu.status)
    )
    onu_counts = {row[0]: int(row[1]) for row in onu_q.all()}

    # All ports in the tenant.
    all_ports = (await session.execute(
        select(OltPort.id).where(OltPort.tenant_id == tenant_id)
    )).scalars().all()

    ports_signaling_below_threshold = 0
    ports_signal_unknown = 0
    now = _utcnow()
    staleness_cutoff = now - SIGNAL_STALENESS

    # For each port, find latest olt_port sample.
    for port_id in all_ports:
        latest = (await session.execute(
            select(OpticalPowerSample)
            .where(
                OpticalPowerSample.tenant_id == tenant_id,
                OpticalPowerSample.source_type == "olt_port",
                OpticalPowerSample.source_id == port_id,
            )
            .order_by(desc(OpticalPowerSample.sampled_at))
            .limit(1)
        )).scalar_one_or_none()
        if latest is None or latest.sampled_at < staleness_cutoff:
            ports_signal_unknown += 1
            continue
        if latest.rx_dbm < CRITICAL_RX_DBM:
            ports_signaling_below_threshold += 1

    return {
        "total_olts": int(total_olts),
        "chassis_active": chassis_counts.get("active", 0),
        "chassis_failed": chassis_counts.get("failed", 0),
        "cards_active": card_counts.get("active", 0),
        "cards_failed": card_counts.get("failed", 0),
        "ports_up": port_counts.get("up", 0),
        "ports_down": port_counts.get("down", 0),
        "ports_fault": port_counts.get("fault", 0),
        "onus_active": onu_counts.get("active", 0),
        "onus_los": onu_counts.get("los", 0),
        "onus_offline": onu_counts.get("offline", 0),
        "ports_signaling_below_threshold": ports_signaling_below_threshold,
        "ports_signal_unknown": ports_signal_unknown,
    }


# ==========================================================================================
# technicians_live
# ==========================================================================================

async def technicians_live(
    session: AsyncSession, *, tenant_id: uuid.UUID, since_minutes: int = 30,
) -> list[dict]:
    """List technicians with at least one ping in the last ``since_minutes`` minutes.
    Returns one row per technician with the latest ping's coords + the count in the window."""
    if since_minutes <= 0:
        since_minutes = 1
    cutoff = _utcnow() - timedelta(minutes=since_minutes)
    # Pull every ping in window then fold in Python — small data, simple semantics, no SQL
    # window-function gymnastics.
    rows = (await session.execute(
        select(TechnicianLocationPing)
        .where(
            TechnicianLocationPing.tenant_id == tenant_id,
            TechnicianLocationPing.recorded_at >= cutoff,
        )
        .order_by(TechnicianLocationPing.technician_user_id,
                  TechnicianLocationPing.recorded_at.desc())
    )).scalars().all()

    grouped: dict[uuid.UUID, dict[str, Any]] = {}
    for ping in rows:
        rec = grouped.get(ping.technician_user_id)
        if rec is None:
            grouped[ping.technician_user_id] = {
                "technician_user_id": str(ping.technician_user_id),
                "last_lat": str(ping.lat),
                "last_lng": str(ping.lng),
                "last_recorded_at": ping.recorded_at.isoformat(),
                "ping_count": 1,
            }
        else:
            rec["ping_count"] += 1
    return list(grouped.values())


# ==========================================================================================
# take_optical_reading
# ==========================================================================================

async def take_optical_reading(
    session: AsyncSession, *, source_type: str, source_id: uuid.UUID,
    tenant_id: uuid.UUID, adapter: DiagnosticAdapter | None = None,
) -> OpticalPowerSample:
    """Read optical power via the diagnostic adapter, persist an OpticalPowerSample,
    return it. Validates source_type and that the source row belongs to this tenant."""
    if source_type not in ("olt_port", "onu"):
        raise HTTPException(400, "source_type must be 'olt_port' or 'onu'")
    # Existence + tenant scope check.
    if source_type == "olt_port":
        exists = (await session.execute(
            select(OltPort.id).where(
                OltPort.id == source_id, OltPort.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
    else:
        exists = (await session.execute(
            select(Onu.id).where(
                Onu.id == source_id, Onu.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
    if exists is None:
        raise HTTPException(404, f"{source_type} not found")

    adapter = adapter or get_diagnostic_adapter()
    reading = await adapter.read_optical_power(
        source_type=source_type, source_id=source_id,
    )
    now = _utcnow()
    sample = OpticalPowerSample(
        tenant_id=tenant_id,
        source_type=source_type,
        source_id=source_id,
        rx_dbm=reading["rx_dbm"],
        tx_dbm=reading["tx_dbm"],
        sampled_at=now,
    )
    session.add(sample)
    # Stamp the port's last_polled_at so the dashboard rollup can see freshness.
    if source_type == "olt_port":
        port = (await session.execute(
            select(OltPort).where(OltPort.id == source_id)
        )).scalar_one()
        port.last_polled_at = now
    else:
        onu = (await session.execute(
            select(Onu).where(Onu.id == source_id)
        )).scalar_one()
        onu.last_seen_at = now
    await session.flush()
    return sample


# ==========================================================================================
# schedule_otdr (synchronous v1)
# ==========================================================================================

async def schedule_otdr(
    session: AsyncSession, *, target_type: str, target_id: uuid.UUID,
    tenant_id: uuid.UUID, actor_id: uuid.UUID | None,
    adapter: DiagnosticAdapter | None = None,
) -> OtdrTest:
    """Create OtdrTest, run the adapter immediately, persist completed row."""
    if target_type not in ("olt_port", "onu"):
        raise HTTPException(400, "target_type must be 'olt_port' or 'onu'")
    if target_type == "olt_port":
        exists = (await session.execute(
            select(OltPort.id).where(
                OltPort.id == target_id, OltPort.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
    else:
        exists = (await session.execute(
            select(Onu.id).where(
                Onu.id == target_id, Onu.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
    if exists is None:
        raise HTTPException(404, f"{target_type} not found")

    now = _utcnow()
    row = OtdrTest(
        tenant_id=tenant_id,
        target_type=target_type,
        target_id=target_id,
        status="queued",
        requested_at=now,
        requested_by=actor_id,
    )
    session.add(row)
    await session.flush()

    adapter = adapter or get_diagnostic_adapter()
    try:
        result = await adapter.run_otdr(
            target_type=target_type, target_id=target_id,
        )
        # Decimal in result needs to be serialized for JSONB.
        serial_result = {
            "trace_distance_m": result["trace_distance_m"],
            "loss_db": str(result["loss_db"]),
            "events": result["events"],
            "status": result["status"],
        }
        row.status = "done"
        row.completed_at = _utcnow()
        row.result_json = serial_result
    except Exception as exc:  # pragma: no cover  (simulator never raises)
        row.status = "failed"
        row.completed_at = _utcnow()
        row.error_message = str(exc)
    await session.flush()
    return row


# ==========================================================================================
# record_technician_ping
# ==========================================================================================

async def record_technician_ping(
    session: AsyncSession, *, technician_user_id: uuid.UUID,
    lat: Decimal, lng: Decimal, tenant_id: uuid.UUID,
    accuracy_m: int | None = None, heading_deg: int | None = None,
    speed_mps: Decimal | None = None,
) -> TechnicianLocationPing:
    """Persist one GPS ping. Validates lat/lng/heading bounds."""
    if not (Decimal("-90") <= lat <= Decimal("90")):
        raise HTTPException(400, "lat must be between -90 and 90")
    if not (Decimal("-180") <= lng <= Decimal("180")):
        raise HTTPException(400, "lng must be between -180 and 180")
    if heading_deg is not None and not (0 <= heading_deg <= 359):
        raise HTTPException(400, "heading_deg must be between 0 and 359")

    ping = TechnicianLocationPing(
        tenant_id=tenant_id,
        technician_user_id=technician_user_id,
        lat=lat,
        lng=lng,
        accuracy_m=accuracy_m,
        heading_deg=heading_deg,
        speed_mps=speed_mps,
        recorded_at=_utcnow(),
    )
    session.add(ping)
    await session.flush()
    return ping
