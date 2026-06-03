"""NOC Phase B — Network Operations Center dashboard + telemetry/OTDR/GPS API.

Thin HTTP shell over ``services/noc_dashboard.py`` + ``services/diagnostic_adapter.py``.
Auth pattern mirrors install_board / dunning:

  * READS (dashboard, lists, tree)               → any authed user (observability)
  * WRITES (chassis/card/port/onu CRUD, sampling) → admin: ``config.manage``
  * Technician pings                              → any authed user (tech reports own location)

Mounted under ``/api/noc/*`` — fixed paths, so register BEFORE the generic records router.

Endpoints:

  Dashboard / observability
    GET    /api/noc/dashboard                                — health rollup + live techs
    GET    /api/noc/olts                                     — list olt Records
    GET    /api/noc/olts/{olt_record_id}/tree                — full chassis→card→port tree
    POST   /api/noc/olts/{olt_record_id}/refresh             — live-pull topology + reconcile DB
    GET    /api/noc/onus?serial=&customer_id=&service_id=&page=
    GET    /api/noc/technicians?since_minutes=30

  OLT tree CRUD (admin)
    POST   /api/noc/olts/{olt_record_id}/chassis
    POST   /api/noc/chassis/{chassis_id}/cards
    POST   /api/noc/cards/{card_id}/ports
    POST   /api/noc/ports/{port_id}/onus
    PATCH  /api/noc/onus/{id}

  Telemetry / OTDR (admin)
    POST   /api/noc/ports/{port_id}/optical-reading
    POST   /api/noc/onus/{onu_id}/optical-reading
    POST   /api/noc/otdr                                     body: {target_type, target_id}
    GET    /api/noc/otdr?target_id=&page=
    GET    /api/noc/otdr/{id}

  Technician GPS
    POST   /api/noc/technician-pings                         body: {lat, lng, ...}
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import can, load_grants
from ..db import get_session
from ..models import User
from ..models.olt_tree import OltChassis, OltCard, OltPort, Onu
from ..models.record import Record
from ..models.technician_location import TechnicianLocationPing
from ..models.telemetry import OpticalPowerSample, OtdrTest
from ..services import noc_dashboard as svc
from ..services import noc_live_refresh as live_refresh_svc
from ..services.olt import (
    OltCommandError,
    OltConnectionError,
    OltCredentialsError,
    OltError,
    OltNotSupportedError,
    OltTimeoutError,
)
from .auth import current_user

router = APIRouter(prefix="/api/noc", tags=["noc"])

_PAGE_SIZE = 100


# ==========================================================================================
# helpers
# ==========================================================================================

def _deny(perm: str) -> None:
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _norm_page(page: int) -> int:
    return page if page >= 1 else 1


async def _require_admin(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")


def _parse_decimal(value: Any, field: str) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise HTTPException(400, f"{field} must be a decimal number")


def _parse_decimal_opt(value, field: str) -> Decimal | None:
    if value is None or value == "":
        return None
    return _parse_decimal(value, field)


# ---- serializers --------------------------------------------------------------------------

def _serialize_chassis(c: OltChassis) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id),
        "olt_record_id": str(c.olt_record_id),
        "slot_no": c.slot_no,
        "model": c.model,
        "status": c.status,
        "installed_at": _iso(c.installed_at),
        "created_at": _iso(c.created_at),
    }


def _serialize_card(c: OltCard) -> dict:
    return {
        "id": str(c.id),
        "tenant_id": str(c.tenant_id),
        "chassis_id": str(c.chassis_id),
        "slot_no": c.slot_no,
        "type": c.type,
        "port_count": c.port_count,
        "status": c.status,
        "fw_version": c.fw_version,
        "created_at": _iso(c.created_at),
    }


def _serialize_port(p: OltPort) -> dict:
    return {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "card_id": str(p.card_id),
        "port_no": p.port_no,
        "type": p.type,
        "status": p.status,
        "last_polled_at": _iso(p.last_polled_at),
        "created_at": _iso(p.created_at),
    }


def _serialize_onu(o: Onu) -> dict:
    return {
        "id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "port_id": str(o.port_id),
        "serial": o.serial,
        "model": o.model,
        "customer_id": str(o.customer_id) if o.customer_id else None,
        "service_id": str(o.service_id) if o.service_id else None,
        "distance_m": o.distance_m,
        "status": o.status,
        "last_seen_at": _iso(o.last_seen_at),
        "created_at": _iso(o.created_at),
    }


def _serialize_optical(sample: OpticalPowerSample) -> dict:
    return {
        "id": str(sample.id),
        "tenant_id": str(sample.tenant_id),
        "source_type": sample.source_type,
        "source_id": str(sample.source_id),
        "rx_dbm": str(sample.rx_dbm),
        "tx_dbm": str(sample.tx_dbm) if sample.tx_dbm is not None else None,
        "sampled_at": _iso(sample.sampled_at),
    }


def _serialize_otdr(o: OtdrTest) -> dict:
    return {
        "id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "target_type": o.target_type,
        "target_id": str(o.target_id),
        "status": o.status,
        "requested_at": _iso(o.requested_at),
        "completed_at": _iso(o.completed_at),
        "requested_by": str(o.requested_by) if o.requested_by else None,
        "result_json": dict(o.result_json) if o.result_json else None,
        "error_message": o.error_message,
    }


def _serialize_ping(p: TechnicianLocationPing) -> dict:
    return {
        "id": str(p.id),
        "tenant_id": str(p.tenant_id),
        "technician_user_id": str(p.technician_user_id),
        "lat": str(p.lat),
        "lng": str(p.lng),
        "accuracy_m": p.accuracy_m,
        "heading_deg": p.heading_deg,
        "speed_mps": str(p.speed_mps) if p.speed_mps is not None else None,
        "recorded_at": _iso(p.recorded_at),
    }


# ==========================================================================================
# Dashboard / observability
# ==========================================================================================

@router.get("/dashboard")
async def noc_dashboard_endpoint(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """NOC observability home — OLT health rollup + live technicians."""
    rollup = await svc.olt_health_rollup(s, tenant_id=user.tenant_id)
    techs = await svc.technicians_live(s, tenant_id=user.tenant_id)
    return {"olt_health": rollup, "technicians": techs}


@router.get("/olts")
async def list_olts(
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """List Record(entity_key='olt') for the tenant."""
    page = _norm_page(page)
    q = select(Record).where(
        Record.tenant_id == user.tenant_id,
        Record.entity_key == "olt",
    ).order_by(Record.created_at.desc())
    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [
            {
                "id": str(r.id),
                "entity_key": r.entity_key,
                "status": r.status,
                "data": dict(r.data or {}),
                "created_at": _iso(r.created_at),
            }
            for r in rows
        ],
    }


@router.get("/olts/{olt_record_id}/tree")
async def get_olt_tree(
    olt_record_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Return the OLT + every chassis/card/port underneath + per-port ONU counts."""
    rec = (await s.execute(
        select(Record).where(
            Record.id == olt_record_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "olt",
        )
    )).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "OLT not found")
    chassis_rows = (await s.execute(
        select(OltChassis).where(
            OltChassis.tenant_id == user.tenant_id,
            OltChassis.olt_record_id == olt_record_id,
        ).order_by(OltChassis.slot_no)
    )).scalars().all()
    chassis_ids = [c.id for c in chassis_rows]
    card_rows = []
    if chassis_ids:
        card_rows = (await s.execute(
            select(OltCard).where(
                OltCard.tenant_id == user.tenant_id,
                OltCard.chassis_id.in_(chassis_ids),
            ).order_by(OltCard.slot_no)
        )).scalars().all()
    card_ids = [c.id for c in card_rows]
    port_rows = []
    if card_ids:
        port_rows = (await s.execute(
            select(OltPort).where(
                OltPort.tenant_id == user.tenant_id,
                OltPort.card_id.in_(card_ids),
            ).order_by(OltPort.port_no)
        )).scalars().all()
    port_ids = [p.id for p in port_rows]
    onu_counts: dict[uuid.UUID, int] = {pid: 0 for pid in port_ids}
    if port_ids:
        onu_rows = (await s.execute(
            select(Onu.port_id, func.count()).where(
                Onu.tenant_id == user.tenant_id,
                Onu.port_id.in_(port_ids),
                Onu.status != "removed",
            ).group_by(Onu.port_id)
        )).all()
        for pid, cnt in onu_rows:
            onu_counts[pid] = int(cnt)

    cards_by_chassis: dict[uuid.UUID, list[dict]] = {cid: [] for cid in chassis_ids}
    ports_by_card: dict[uuid.UUID, list[dict]] = {cid: [] for cid in card_ids}
    for p in port_rows:
        pd = _serialize_port(p)
        pd["onu_count"] = onu_counts.get(p.id, 0)
        ports_by_card.setdefault(p.card_id, []).append(pd)
    for c in card_rows:
        cd = _serialize_card(c)
        cd["ports"] = ports_by_card.get(c.id, [])
        cards_by_chassis.setdefault(c.chassis_id, []).append(cd)
    chassis_out = []
    for c in chassis_rows:
        cd = _serialize_chassis(c)
        cd["cards"] = cards_by_chassis.get(c.id, [])
        chassis_out.append(cd)

    return {
        "olt": {
            "id": str(rec.id),
            "entity_key": rec.entity_key,
            "status": rec.status,
            "data": dict(rec.data or {}),
        },
        "chassis": chassis_out,
        "totals": {
            "chassis": len(chassis_rows),
            "cards": len(card_rows),
            "ports": len(port_rows),
            "onus_active": sum(onu_counts.values()),
        },
    }


@router.get("/olts/{olt_record_id}/analytics")
async def olt_analytics(
    olt_record_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Aggregated ONU-distribution analytics for the dashboard charts.

    Returns three breakdowns derived from the live ONU rows for this OLT:

    * ``by_port``: ``[{port_no, count}]`` — how many ONUs sit on each PON port
      (drives the per-PON pie / share-of-total view).
    * ``by_vendor``: ``[{prefix, count}]`` — ONU serial prefix (first 4 chars,
      usually the OUI / vendor marker e.g. ``GPON``, ``BDCM``, ``EPON``) sorted
      most-to-least. Drives the vendor-breakdown chart.
    * ``totals``: ``{onus, ports_populated, top_vendor_share}`` —
      a couple of summary numbers we surface above the charts.
    """
    rec = (await s.execute(
        select(Record).where(
            Record.id == olt_record_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "olt",
        )
    )).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "OLT not found")

    # Resolve all port rows under this OLT.
    chassis_ids = (await s.execute(
        select(OltChassis.id).where(
            OltChassis.tenant_id == user.tenant_id,
            OltChassis.olt_record_id == olt_record_id,
        )
    )).scalars().all()
    if not chassis_ids:
        return {"by_port": [], "by_vendor": [], "totals": {"onus": 0, "ports_populated": 0, "top_vendor_share": 0}}
    card_ids = (await s.execute(
        select(OltCard.id).where(
            OltCard.tenant_id == user.tenant_id,
            OltCard.chassis_id.in_(chassis_ids),
        )
    )).scalars().all()
    port_rows = (await s.execute(
        select(OltPort.id, OltPort.port_no).where(
            OltPort.tenant_id == user.tenant_id,
            OltPort.card_id.in_(card_ids),
        ).order_by(OltPort.port_no)
    )).all() if card_ids else []
    port_no_by_id = {pid: pn for pid, pn in port_rows}

    port_ids = list(port_no_by_id.keys())
    counts_by_port_id: dict[uuid.UUID, int] = {}
    vendor_buckets: dict[str, int] = {}
    if port_ids:
        by_port_rows = (await s.execute(
            select(Onu.port_id, func.count()).where(
                Onu.tenant_id == user.tenant_id,
                Onu.port_id.in_(port_ids),
                Onu.status != "removed",
            ).group_by(Onu.port_id)
        )).all()
        counts_by_port_id = {pid: int(c) for pid, c in by_port_rows}

        # Serial-prefix bucketing (GPON*, BDCM*, EPON*, …). Cheap aggregation,
        # no extra columns needed on the onu table.
        serial_rows = (await s.execute(
            select(Onu.serial).where(
                Onu.tenant_id == user.tenant_id,
                Onu.port_id.in_(port_ids),
                Onu.status != "removed",
            )
        )).scalars().all()
        for sn in serial_rows:
            prefix = ((sn or "")[:4].upper()) or "UNKN"
            vendor_buckets[prefix] = vendor_buckets.get(prefix, 0) + 1

    by_port = [
        {"port_no": pn, "count": counts_by_port_id.get(pid, 0)}
        for pid, pn in port_rows
    ]
    by_vendor = sorted(
        [{"prefix": k, "count": v} for k, v in vendor_buckets.items()],
        key=lambda d: d["count"], reverse=True,
    )

    total_onus = sum(counts_by_port_id.values())
    ports_populated = sum(1 for pid, _ in port_rows if counts_by_port_id.get(pid, 0) > 0)
    top_vendor_share = (by_vendor[0]["count"] / total_onus * 100.0) if (by_vendor and total_onus > 0) else 0

    # Pull-through the running-config snapshot the live-refresh service stashes
    # on the OLT Record (VLANs, DBA profiles, line-profile counts). Empty when
    # no refresh has run yet.
    snapshot = (rec.data or {}).get("snapshot") or {}

    return {
        "by_port": by_port,
        "by_vendor": by_vendor,
        "totals": {
            "onus": total_onus,
            "ports_populated": ports_populated,
            "top_vendor_share": round(top_vendor_share, 1),
        },
        "vlans": snapshot.get("vlans") or [],
        "dba_profiles": snapshot.get("dba_profiles") or [],
        "line_profile_counts": snapshot.get("line_profile_counts") or [],
        "line_profile_defs": snapshot.get("line_profile_defs") or [],
        "onu_details": snapshot.get("onu_details") or [],
    }


@router.post("/olts/{olt_record_id}/refresh", status_code=200)
async def refresh_olt(
    olt_record_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Pull live topology from the OLT, reconcile chassis/card/port/ONU rows, return counts.

    Admin-only (config.manage). Today only vendor ``vsol_v1600`` supports this —
    other vendors raise a 501. The reconcile is idempotent and preserves
    customer/service bindings on existing ONU rows.
    """
    await _require_admin(s, user)
    rec = (await s.execute(
        select(Record).where(
            Record.id == olt_record_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "olt",
        )
    )).scalar_one_or_none()
    if rec is None:
        raise HTTPException(404, "OLT not found")
    try:
        summary = await live_refresh_svc.refresh_olt_topology(s, rec)
    except OltNotSupportedError as e:
        await s.rollback()
        raise HTTPException(501, f"live refresh not supported: {e}")
    except OltCredentialsError as e:
        await s.rollback()
        raise HTTPException(401, f"OLT credentials rejected: {e}")
    except (OltConnectionError, OltTimeoutError) as e:
        await s.rollback()
        raise HTTPException(502, f"OLT unreachable: {e}")
    except OltCommandError as e:
        await s.rollback()
        raise HTTPException(502, f"OLT rejected command: {e}")
    except OltError as e:
        await s.rollback()
        raise HTTPException(500, f"OLT driver error: {e}")
    await s.commit()
    return summary


@router.get("/onus")
async def list_onus(
    serial: str | None = None,
    customer_id: uuid.UUID | None = None,
    service_id: uuid.UUID | None = None,
    port_id: uuid.UUID | None = None,
    page: int = 1,
    page_size: int | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    page = _norm_page(page)
    q = select(Onu).where(Onu.tenant_id == user.tenant_id, Onu.status != "removed")
    if serial:
        q = q.where(Onu.serial == serial)
    if customer_id:
        q = q.where(Onu.customer_id == customer_id)
    if service_id:
        q = q.where(Onu.service_id == service_id)
    if port_id:
        q = q.where(Onu.port_id == port_id)
    q = q.order_by(Onu.created_at.desc())
    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    effective_page_size = max(1, min(page_size or _PAGE_SIZE, 500))
    q = q.offset((page - 1) * effective_page_size).limit(effective_page_size)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": effective_page_size,
        "total": int(total or 0),
        "items": [_serialize_onu(r) for r in rows],
    }


@router.get("/technicians")
async def list_technicians(
    since_minutes: int = 30,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    techs = await svc.technicians_live(
        s, tenant_id=user.tenant_id, since_minutes=since_minutes,
    )
    return {"since_minutes": since_minutes, "technicians": techs}


# ==========================================================================================
# OLT tree CRUD
# ==========================================================================================

_ALLOWED_CHASSIS_STATUS = {"active", "standby", "failed", "removed"}
_ALLOWED_CARD_TYPE = {"GPON", "10GE", "XGS-PON", "CONTROL", "POWER"}
_ALLOWED_CARD_STATUS = {"active", "standby", "failed", "removed"}
_ALLOWED_PORT_TYPE = {"GPON", "10GE", "XGS-PON"}
_ALLOWED_PORT_STATUS = {"up", "down", "admin_down", "fault"}
_ALLOWED_ONU_STATUS = {"active", "los", "dying_gasp", "offline", "removed"}


@router.post("/olts/{olt_record_id}/chassis")
async def create_chassis(
    olt_record_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    olt = (await s.execute(
        select(Record).where(
            Record.id == olt_record_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "olt",
        )
    )).scalar_one_or_none()
    if olt is None:
        raise HTTPException(404, "OLT not found")
    slot_no = payload.get("slot_no")
    if slot_no is None:
        raise HTTPException(400, "slot_no is required")
    try:
        slot_no = int(slot_no)
    except (TypeError, ValueError):
        raise HTTPException(400, "slot_no must be an integer")
    status = payload.get("status", "active")
    if status not in _ALLOWED_CHASSIS_STATUS:
        raise HTTPException(400, f"invalid status; allowed: {sorted(_ALLOWED_CHASSIS_STATUS)}")
    chassis = OltChassis(
        tenant_id=user.tenant_id,
        olt_record_id=olt_record_id,
        slot_no=slot_no,
        model=payload.get("model"),
        status=status,
    )
    s.add(chassis)
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, f"chassis slot_no={slot_no} already exists on this OLT")
    await s.refresh(chassis)
    return _serialize_chassis(chassis)


@router.post("/chassis/{chassis_id}/cards")
async def create_card(
    chassis_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    chassis = (await s.execute(
        select(OltChassis).where(
            OltChassis.id == chassis_id,
            OltChassis.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if chassis is None:
        raise HTTPException(404, "Chassis not found")
    slot_no = payload.get("slot_no")
    if slot_no is None:
        raise HTTPException(400, "slot_no is required")
    card_type = payload.get("type")
    if card_type not in _ALLOWED_CARD_TYPE:
        raise HTTPException(400, f"invalid type; allowed: {sorted(_ALLOWED_CARD_TYPE)}")
    port_count = payload.get("port_count", 0)
    status = payload.get("status", "active")
    if status not in _ALLOWED_CARD_STATUS:
        raise HTTPException(400, f"invalid status; allowed: {sorted(_ALLOWED_CARD_STATUS)}")
    try:
        slot_no = int(slot_no)
        port_count = int(port_count)
    except (TypeError, ValueError):
        raise HTTPException(400, "slot_no and port_count must be integers")
    card = OltCard(
        tenant_id=user.tenant_id,
        chassis_id=chassis_id,
        slot_no=slot_no,
        type=card_type,
        port_count=port_count,
        status=status,
        fw_version=payload.get("fw_version"),
    )
    s.add(card)
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, f"card slot_no={slot_no} already exists on this chassis")
    await s.refresh(card)
    return _serialize_card(card)


@router.post("/cards/{card_id}/ports")
async def create_port(
    card_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    card = (await s.execute(
        select(OltCard).where(
            OltCard.id == card_id,
            OltCard.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if card is None:
        raise HTTPException(404, "Card not found")
    port_no = payload.get("port_no")
    port_type = payload.get("type")
    status = payload.get("status", "up")
    if port_no is None:
        raise HTTPException(400, "port_no is required")
    if port_type not in _ALLOWED_PORT_TYPE:
        raise HTTPException(400, f"invalid type; allowed: {sorted(_ALLOWED_PORT_TYPE)}")
    if status not in _ALLOWED_PORT_STATUS:
        raise HTTPException(400, f"invalid status; allowed: {sorted(_ALLOWED_PORT_STATUS)}")
    try:
        port_no = int(port_no)
    except (TypeError, ValueError):
        raise HTTPException(400, "port_no must be an integer")
    port = OltPort(
        tenant_id=user.tenant_id,
        card_id=card_id,
        port_no=port_no,
        type=port_type,
        status=status,
    )
    s.add(port)
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, f"port port_no={port_no} already exists on this card")
    await s.refresh(port)
    return _serialize_port(port)


@router.post("/ports/{port_id}/onus")
async def create_onu(
    port_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    port = (await s.execute(
        select(OltPort).where(
            OltPort.id == port_id,
            OltPort.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if port is None:
        raise HTTPException(404, "Port not found")
    serial = payload.get("serial")
    if not serial or not isinstance(serial, str):
        raise HTTPException(400, "serial is required")
    status = payload.get("status", "active")
    if status not in _ALLOWED_ONU_STATUS:
        raise HTTPException(400, f"invalid status; allowed: {sorted(_ALLOWED_ONU_STATUS)}")
    distance_m = payload.get("distance_m")
    if distance_m is not None:
        try:
            distance_m = int(distance_m)
        except (TypeError, ValueError):
            raise HTTPException(400, "distance_m must be an integer")
    onu = Onu(
        tenant_id=user.tenant_id,
        port_id=port_id,
        serial=serial,
        model=payload.get("model"),
        distance_m=distance_m,
        status=status,
    )
    s.add(onu)
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, f"ONU serial={serial} already exists (live)")
    await s.refresh(onu)
    return _serialize_onu(onu)


@router.patch("/onus/{onu_id}")
async def patch_onu(
    onu_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    onu = (await s.execute(
        select(Onu).where(
            Onu.id == onu_id,
            Onu.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if onu is None:
        raise HTTPException(404, "ONU not found")
    if "status" in payload:
        st = payload["status"]
        if st not in _ALLOWED_ONU_STATUS:
            raise HTTPException(400, f"invalid status; allowed: {sorted(_ALLOWED_ONU_STATUS)}")
        onu.status = st
    if "customer_id" in payload:
        cid = payload["customer_id"]
        onu.customer_id = uuid.UUID(cid) if cid else None
    if "service_id" in payload:
        sid = payload["service_id"]
        onu.service_id = uuid.UUID(sid) if sid else None
    if "distance_m" in payload:
        d = payload["distance_m"]
        onu.distance_m = int(d) if d is not None else None
    if "model" in payload:
        onu.model = payload["model"]
    try:
        await s.commit()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, "ONU update conflicts with unique constraint")
    await s.refresh(onu)
    return _serialize_onu(onu)


# ==========================================================================================
# Telemetry / OTDR
# ==========================================================================================

@router.post("/ports/{port_id}/optical-reading")
async def port_optical_reading(
    port_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    sample = await svc.take_optical_reading(
        s, source_type="olt_port", source_id=port_id, tenant_id=user.tenant_id,
    )
    await s.commit()
    await s.refresh(sample)
    return _serialize_optical(sample)


@router.post("/onus/{onu_id}/optical-reading")
async def onu_optical_reading(
    onu_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    sample = await svc.take_optical_reading(
        s, source_type="onu", source_id=onu_id, tenant_id=user.tenant_id,
    )
    await s.commit()
    await s.refresh(sample)
    return _serialize_optical(sample)


@router.post("/otdr")
async def post_otdr(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_admin(s, user)
    target_type = payload.get("target_type")
    target_id = payload.get("target_id")
    if not target_type or not target_id:
        raise HTTPException(400, "target_type and target_id are required")
    try:
        tid = uuid.UUID(str(target_id))
    except (TypeError, ValueError):
        raise HTTPException(400, "target_id must be a UUID")
    row = await svc.schedule_otdr(
        s, target_type=target_type, target_id=tid,
        tenant_id=user.tenant_id, actor_id=user.id,
    )
    await s.commit()
    await s.refresh(row)
    return _serialize_otdr(row)


@router.get("/otdr")
async def list_otdr(
    target_id: uuid.UUID | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    page = _norm_page(page)
    q = select(OtdrTest).where(OtdrTest.tenant_id == user.tenant_id)
    if target_id:
        q = q.where(OtdrTest.target_id == target_id)
    q = q.order_by(OtdrTest.requested_at.desc())
    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_serialize_otdr(r) for r in rows],
    }


@router.get("/otdr/{otdr_id}")
async def get_otdr(
    otdr_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    row = (await s.execute(
        select(OtdrTest).where(
            OtdrTest.id == otdr_id,
            OtdrTest.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "OTDR test not found")
    return _serialize_otdr(row)


# ==========================================================================================
# Technician GPS pings
# ==========================================================================================

@router.post("/technician-pings")
async def post_technician_ping(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Tech reports own location. ``technician_user_id`` is derived from the auth context —
    callers never supply it. Any authed user may ping (no admin gate — every tech is on the
    map regardless of role)."""
    if "lat" not in payload or "lng" not in payload:
        raise HTTPException(400, "lat and lng are required")
    lat = _parse_decimal(payload["lat"], "lat")
    lng = _parse_decimal(payload["lng"], "lng")
    accuracy = payload.get("accuracy_m")
    heading = payload.get("heading_deg")
    speed = _parse_decimal_opt(payload.get("speed_mps"), "speed_mps")
    if accuracy is not None:
        try:
            accuracy = int(accuracy)
        except (TypeError, ValueError):
            raise HTTPException(400, "accuracy_m must be an integer")
    if heading is not None:
        try:
            heading = int(heading)
        except (TypeError, ValueError):
            raise HTTPException(400, "heading_deg must be an integer")
    ping = await svc.record_technician_ping(
        s, technician_user_id=user.id,
        lat=lat, lng=lng, tenant_id=user.tenant_id,
        accuracy_m=accuracy, heading_deg=heading, speed_mps=speed,
    )
    await s.commit()
    await s.refresh(ping)
    return _serialize_ping(ping)


