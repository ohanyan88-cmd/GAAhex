"""NOC Phase C — NOC Inventory API.

Covers:
  Fiber routes + outage paths  (PostGIS-backed geometry as TEXT/WKT)
  IPAM assignments             (per-address lease detail on top of pool_allocation)
  Asset movements              (AssetLocationHistory + Record.data patch)
  RADIUS sessions              (Acct-Start/Stop ingest + query)
  Mass broadcasts              (draft → send lifecycle with SimulatedBroadcastSender)

Auth pattern: reads = any authed user; writes = admin (config.manage).
Registered in main.py BEFORE records.router (fixed paths).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User, Record
from ..models.fiber_route import FiberRoute, OutagePath
from ..models.ipam import IpAssignment
from ..models.asset_location import AssetLocationHistory
from ..models.radius_session import RadiusSession
from ..models.broadcast import MassBroadcast
from ..access import can, load_grants
from ..services import ipam as ipam_svc
from ..services.feature_gate import is_enabled
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api", tags=["noc-inventory"])

_PAGE_SIZE = 100
_LOCATION_TYPES = {"warehouse", "truck", "install_site", "hub", "unknown"}
_CHANNELS = {"sms", "email", "voice", "push"}
_FIBER_STATUSES = {"active", "planned", "cut", "retired"}


# ===========================================================================
# helpers
# ===========================================================================

def _deny(perm: str) -> None:
    raise HTTPException(403, f"Not allowed: {perm}")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _norm_page(page: int) -> int:
    return max(1, page)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _require_admin(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        _deny("config.manage")


# ===========================================================================
# serializers
# ===========================================================================

def _fiber_route(r: FiberRoute) -> dict:
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "name": r.name,
        "geo_path": r.geo_path,
        "capacity_gbps": r.capacity_gbps,
        "origin_pop": r.origin_pop,
        "destination_pop": r.destination_pop,
        "status": r.status,
        "created_at": _iso(r.created_at),
        "updated_at": _iso(r.updated_at),
    }


def _outage_path(o: OutagePath) -> dict:
    return {
        "id": str(o.id),
        "tenant_id": str(o.tenant_id),
        "outage_record_id": str(o.outage_record_id),
        "fiber_route_id": str(o.fiber_route_id),
        "cut_location_wkt": o.cut_location_wkt,
        "cut_distance_from_origin_m": o.cut_distance_from_origin_m,
        "notes": o.notes,
        "created_at": _iso(o.created_at),
    }


def _ip_assignment(a: IpAssignment) -> dict:
    return {
        "id": str(a.id),
        "tenant_id": str(a.tenant_id),
        "pool_allocation_id": str(a.pool_allocation_id),
        "address": a.address,
        "family": a.family,
        "service_id": str(a.service_id) if a.service_id else None,
        "asset_record_id": str(a.asset_record_id) if a.asset_record_id else None,
        "mac": a.mac,
        "assigned_at": _iso(a.assigned_at),
        "released_at": _iso(a.released_at),
        "lease_expires_at": _iso(a.lease_expires_at),
        "status": "released" if a.released_at else "active",
    }


def _asset_location(h: AssetLocationHistory) -> dict:
    return {
        "id": str(h.id),
        "tenant_id": str(h.tenant_id),
        "asset_record_id": str(h.asset_record_id),
        "from_location_type": h.from_location_type,
        "from_location_id": str(h.from_location_id) if h.from_location_id else None,
        "to_location_type": h.to_location_type,
        "to_location_id": str(h.to_location_id) if h.to_location_id else None,
        "moved_by_user_id": str(h.moved_by_user_id) if h.moved_by_user_id else None,
        "moved_at": _iso(h.moved_at),
        "reason": h.reason,
        "work_order_id": str(h.work_order_id) if h.work_order_id else None,
    }


def _radius_session(r: RadiusSession) -> dict:
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "service_id": str(r.service_id) if r.service_id else None,
        "username": r.username,
        "session_id": r.session_id,
        "nas_ip": r.nas_ip,
        "nas_port": r.nas_port,
        "framed_ip": r.framed_ip,
        "acct_start": _iso(r.acct_start),
        "acct_stop": _iso(r.acct_stop),
        "octets_in": r.octets_in,
        "octets_out": r.octets_out,
        "status": r.status,
    }


def _broadcast(b: MassBroadcast) -> dict:
    return {
        "id": str(b.id),
        "tenant_id": str(b.tenant_id),
        "incident_record_id": str(b.incident_record_id) if b.incident_record_id else None,
        "channel": b.channel,
        "template_id": b.template_id,
        "audience_filter_json": b.audience_filter_json,
        "recipients_count": b.recipients_count,
        "sent_count": b.sent_count,
        "failed_count": b.failed_count,
        "status": b.status,
        "started_at": _iso(b.started_at),
        "completed_at": _iso(b.completed_at),
        "created_by": str(b.created_by) if b.created_by else None,
        "created_at": _iso(b.created_at),
    }


# ===========================================================================
# Fiber routes
# ===========================================================================

@router.get("/fiber-routes")
async def list_fiber_routes(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    q = select(FiberRoute).where(FiberRoute.tenant_id == user.tenant_id)
    if status:
        q = q.where(FiberRoute.status == status)
    q = q.order_by(FiberRoute.created_at.desc()).offset((_norm_page(page) - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return [_fiber_route(r) for r in rows]


@router.post("/fiber-routes")
async def create_fiber_route(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    status = body.get("status", "active")
    if status not in _FIBER_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(_FIBER_STATUSES)}")
    r = FiberRoute(
        tenant_id=user.tenant_id,
        name=name,
        geo_path=body.get("geo_path"),
        capacity_gbps=body.get("capacity_gbps"),
        origin_pop=body.get("origin_pop"),
        destination_pop=body.get("destination_pop"),
        status=status,
    )
    s.add(r)
    await s.commit()
    await s.refresh(r)
    return _fiber_route(r)


@router.get("/fiber-routes/{route_id}")
async def get_fiber_route(
    route_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    r = (await s.execute(
        select(FiberRoute).where(FiberRoute.id == route_id, FiberRoute.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Fiber route not found")
    return _fiber_route(r)


@router.patch("/fiber-routes/{route_id}")
async def patch_fiber_route(
    route_id: uuid.UUID,
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    r = (await s.execute(
        select(FiberRoute).where(FiberRoute.id == route_id, FiberRoute.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Fiber route not found")
    for field in ("name", "geo_path", "capacity_gbps", "origin_pop", "destination_pop"):
        if field in body:
            setattr(r, field, body[field])
    if "status" in body:
        if body["status"] not in _FIBER_STATUSES:
            raise HTTPException(400, f"status must be one of {sorted(_FIBER_STATUSES)}")
        r.status = body["status"]
    await s.commit()
    await s.refresh(r)
    return _fiber_route(r)


@router.delete("/fiber-routes/{route_id}")
async def delete_fiber_route(
    route_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Soft delete: sets status='retired'. Idempotent."""
    await _require_admin(s, user)
    r = (await s.execute(
        select(FiberRoute).where(FiberRoute.id == route_id, FiberRoute.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Fiber route not found")
    r.status = "retired"
    await s.commit()
    await s.refresh(r)
    return _fiber_route(r)


@router.get("/fiber-routes/{route_id}/outage-paths")
async def list_fiber_route_outage_paths(
    route_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    # Verify route exists for this tenant
    r = (await s.execute(
        select(FiberRoute).where(FiberRoute.id == route_id, FiberRoute.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "Fiber route not found")
    rows = (await s.execute(
        select(OutagePath).where(
            OutagePath.fiber_route_id == route_id,
            OutagePath.tenant_id == user.tenant_id,
        ).order_by(OutagePath.created_at.desc())
    )).scalars().all()
    return [_outage_path(o) for o in rows]


# ===========================================================================
# Outage paths
# ===========================================================================

@router.post("/outage-paths")
async def create_outage_path(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    outage_record_id = _require_uuid(body, "outage_record_id")
    fiber_route_id = _require_uuid(body, "fiber_route_id")

    # Verify fiber_route belongs to tenant
    route = (await s.execute(
        select(FiberRoute).where(FiberRoute.id == fiber_route_id, FiberRoute.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not route:
        raise HTTPException(404, "Fiber route not found")

    o = OutagePath(
        tenant_id=user.tenant_id,
        outage_record_id=outage_record_id,
        fiber_route_id=fiber_route_id,
        cut_location_wkt=body.get("cut_location_wkt"),
        cut_distance_from_origin_m=body.get("cut_distance_from_origin_m"),
        notes=body.get("notes"),
    )
    s.add(o)
    await s.commit()
    await s.refresh(o)
    return _outage_path(o)


@router.get("/outage-paths")
async def list_outage_paths(
    outage_record_id: str | None = Query(None),
    fiber_route_id: str | None = Query(None),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    q = select(OutagePath).where(OutagePath.tenant_id == user.tenant_id)
    if outage_record_id:
        q = q.where(OutagePath.outage_record_id == uuid.UUID(outage_record_id))
    if fiber_route_id:
        q = q.where(OutagePath.fiber_route_id == uuid.UUID(fiber_route_id))
    q = q.order_by(OutagePath.created_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_outage_path(o) for o in rows]


# ===========================================================================
# IPAM
# ===========================================================================

@router.post("/ipam/assign")
async def ipam_assign(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    pool_allocation_id = _require_uuid(body, "pool_allocation_id")
    address = body.get("address", "").strip()
    if not address:
        raise HTTPException(400, "address is required")
    family = body.get("family")
    if family not in (4, 6):
        raise HTTPException(400, "family must be 4 or 6")

    service_id = _opt_uuid(body, "service_id")
    mac = body.get("mac")
    lease_str = body.get("lease_expires_at")
    lease_expires_at = _parse_dt_opt(lease_str, "lease_expires_at")

    row = await ipam_svc.assign_ip(
        s,
        pool_allocation_id=pool_allocation_id,
        address=address,
        family=family,
        tenant_id=user.tenant_id,
        service_id=service_id,
        mac=mac,
        lease_expires_at=lease_expires_at,
    )
    await s.commit()
    await s.refresh(row)
    return _ip_assignment(row)


@router.post("/ipam/release")
async def ipam_release(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    assignment_id = _require_uuid(body, "assignment_id")
    row = await ipam_svc.release_ip(s, assignment_id, tenant_id=user.tenant_id)
    await s.commit()
    await s.refresh(row)
    return _ip_assignment(row)


@router.get("/ipam/assignments")
async def list_ipam_assignments(
    address: str | None = Query(None),
    service_id: str | None = Query(None),
    status: str | None = Query(None),    # 'active' | 'all' (default all)
    page: int = Query(1, ge=1),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    q = select(IpAssignment).where(IpAssignment.tenant_id == user.tenant_id)
    if address:
        q = q.where(IpAssignment.address == address)
    if service_id:
        q = q.where(IpAssignment.service_id == uuid.UUID(service_id))
    if status == "active":
        q = q.where(IpAssignment.released_at.is_(None))
    q = q.order_by(IpAssignment.assigned_at.desc()).offset((_norm_page(page) - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return [_ip_assignment(a) for a in rows]


@router.get("/ipam/assignments/{assignment_id}")
async def get_ipam_assignment(
    assignment_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    row = (await s.execute(
        select(IpAssignment).where(
            IpAssignment.id == assignment_id, IpAssignment.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "IP assignment not found")
    return _ip_assignment(row)


# ===========================================================================
# Asset movements
# ===========================================================================

@router.post("/assets/{asset_id}/move")
async def move_asset(
    asset_id: uuid.UUID,
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    to_location_type = body.get("to_location_type", "").strip()
    if not to_location_type:
        raise HTTPException(400, "to_location_type is required")
    if to_location_type not in _LOCATION_TYPES:
        raise HTTPException(400, f"to_location_type must be one of {sorted(_LOCATION_TYPES)}")

    # Load the asset Record
    asset = (await s.execute(
        select(Record).where(
            Record.id == asset_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "asset",
        )
    )).scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset record not found")

    # Stage 2 warehouse remediation: this endpoint is an asset-row patch, not a real
    # stock movement. When the warehouse subsystem is disabled (the default in M0/M1)
    # emit an INVENTORY_TRACKING_LIMITED audit Event so SuperAdmin's audit log surfaces
    # the gap explicitly. When the real warehouse module ships and the feature flag is
    # flipped on, is_enabled("warehouse") returns True and this audit ceases firing —
    # the cessation itself is the signal that full tracking is now in effect.
    if not is_enabled("warehouse"):
        try:
            await workflow.emit(
                s,
                tenant_id=user.tenant_id,
                type_="INVENTORY_TRACKING_LIMITED",
                entity_key="asset",
                record_id=asset_id,
                actor_user_id=user.id,
                data={
                    "feature_warehouse_enabled": False,
                    "note": "Asset moved via single-row patch; full warehouse tracking unavailable",
                    "to_location_type": to_location_type,
                },
                event_name="Asset.InventoryTrackingLimited",
                category="SYSTEM",
            )
        except Exception:
            pass  # audit best-effort — must never mask the real move

    # Capture current location for the from_ fields
    data = dict(asset.data or {})
    from_location_type = data.get("location_type")
    from_location_id_raw = data.get("location_id")
    from_location_id = uuid.UUID(from_location_id_raw) if from_location_id_raw else None

    to_location_id_raw = body.get("to_location_id")
    to_location_id = uuid.UUID(to_location_id_raw) if to_location_id_raw else None

    # Write AssetLocationHistory row
    hist = AssetLocationHistory(
        tenant_id=user.tenant_id,
        asset_record_id=asset_id,
        from_location_type=from_location_type,
        from_location_id=from_location_id,
        to_location_type=to_location_type,
        to_location_id=to_location_id,
        moved_by_user_id=user.id,
        moved_at=_now(),
        reason=body.get("reason"),
        work_order_id=uuid.UUID(body["work_order_id"]) if body.get("work_order_id") else None,
    )
    s.add(hist)

    # Update Record.data atomically
    data["location_type"] = to_location_type
    data["location_id"] = str(to_location_id) if to_location_id else None
    asset.data = data

    await s.commit()
    await s.refresh(hist)
    return _asset_location(hist)


@router.get("/assets/{asset_id}/location-history")
async def get_asset_location_history(
    asset_id: uuid.UUID,
    page: int = Query(1, ge=1),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    # Verify the asset belongs to this tenant
    asset = (await s.execute(
        select(Record).where(
            Record.id == asset_id,
            Record.tenant_id == user.tenant_id,
            Record.entity_key == "asset",
        )
    )).scalar_one_or_none()
    if not asset:
        raise HTTPException(404, "Asset record not found")

    rows = (await s.execute(
        select(AssetLocationHistory).where(
            AssetLocationHistory.asset_record_id == asset_id,
            AssetLocationHistory.tenant_id == user.tenant_id,
        ).order_by(AssetLocationHistory.moved_at.desc())
        .offset((_norm_page(page) - 1) * _PAGE_SIZE)
        .limit(_PAGE_SIZE)
    )).scalars().all()
    return [_asset_location(h) for h in rows]


# ===========================================================================
# RADIUS sessions
# ===========================================================================

@router.get("/radius/sessions")
async def list_radius_sessions(
    status: str | None = Query(None),
    username: str | None = Query(None),
    service_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    q = select(RadiusSession).where(RadiusSession.tenant_id == user.tenant_id)
    if status == "active":
        q = q.where(RadiusSession.status == "active")
    elif status == "stopped":
        q = q.where(RadiusSession.status == "stopped")
    if username:
        q = q.where(RadiusSession.username == username)
    if service_id:
        q = q.where(RadiusSession.service_id == uuid.UUID(service_id))
    q = q.order_by(RadiusSession.acct_start.desc()).offset((_norm_page(page) - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return [_radius_session(r) for r in rows]


@router.get("/radius/sessions/{session_id}")
async def get_radius_session(
    session_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    row = (await s.execute(
        select(RadiusSession).where(
            RadiusSession.id == session_id, RadiusSession.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "RADIUS session not found")
    return _radius_session(row)


@router.post("/radius/sessions")
async def create_radius_session(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Ingest a new RADIUS Acct-Start record. Any authenticated user may call this."""
    username = body.get("username", "").strip()
    if not username:
        raise HTTPException(400, "username is required")
    session_id_val = body.get("session_id", "").strip()
    if not session_id_val:
        raise HTTPException(400, "session_id is required")
    acct_start_str = body.get("acct_start")
    if not acct_start_str:
        raise HTTPException(400, "acct_start is required")
    acct_start = _parse_dt(acct_start_str, "acct_start")

    service_id = _opt_uuid(body, "service_id")

    row = RadiusSession(
        tenant_id=user.tenant_id,
        service_id=service_id,
        username=username,
        session_id=session_id_val,
        nas_ip=body.get("nas_ip"),
        nas_port=body.get("nas_port"),
        framed_ip=body.get("framed_ip"),
        acct_start=acct_start,
        octets_in=body.get("octets_in"),
        octets_out=body.get("octets_out"),
        status="active",
    )
    s.add(row)
    try:
        await s.flush()
    except IntegrityError:
        await s.rollback()
        raise HTTPException(409, f"Session ID {session_id_val!r} already exists for this tenant")
    await s.commit()
    await s.refresh(row)
    return _radius_session(row)


@router.patch("/radius/sessions/{session_id}/stop")
async def stop_radius_session(
    session_id: uuid.UUID,
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Mark a RADIUS session stopped (Acct-Stop)."""
    row = (await s.execute(
        select(RadiusSession).where(
            RadiusSession.id == session_id, RadiusSession.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "RADIUS session not found")
    acct_stop_str = body.get("acct_stop")
    if not acct_stop_str:
        raise HTTPException(400, "acct_stop is required")
    row.acct_stop = _parse_dt(acct_stop_str, "acct_stop")
    row.status = "stopped"
    if body.get("octets_in") is not None:
        row.octets_in = body["octets_in"]
    if body.get("octets_out") is not None:
        row.octets_out = body["octets_out"]
    await s.commit()
    await s.refresh(row)
    return _radius_session(row)


# ===========================================================================
# Mass broadcasts
# ===========================================================================

@router.get("/broadcasts")
async def list_broadcasts(
    incident_id: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    q = select(MassBroadcast).where(MassBroadcast.tenant_id == user.tenant_id)
    if incident_id:
        q = q.where(MassBroadcast.incident_record_id == uuid.UUID(incident_id))
    if status:
        q = q.where(MassBroadcast.status == status)
    q = q.order_by(MassBroadcast.created_at.desc()).offset((_norm_page(page) - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return [_broadcast(b) for b in rows]


@router.post("/broadcasts")
async def create_broadcast(
    body: dict,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    await _require_admin(s, user)
    channel = body.get("channel", "").strip()
    if channel not in _CHANNELS:
        raise HTTPException(400, f"channel must be one of {sorted(_CHANNELS)}")
    incident_record_id = _opt_uuid(body, "incident_record_id")
    b = MassBroadcast(
        tenant_id=user.tenant_id,
        incident_record_id=incident_record_id,
        channel=channel,
        template_id=body.get("template_id"),
        audience_filter_json=body.get("audience_filter_json"),
        status="draft",
        created_by=user.id,
    )
    s.add(b)
    await s.commit()
    await s.refresh(b)
    return _broadcast(b)


@router.post("/broadcasts/{broadcast_id}/send")
async def send_broadcast(
    broadcast_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    """Queue + immediately simulate send. SimulatedBroadcastSender marks complete."""
    await _require_admin(s, user)
    b = (await s.execute(
        select(MassBroadcast).where(
            MassBroadcast.id == broadcast_id, MassBroadcast.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Broadcast not found")
    if b.status not in ("draft", "queued"):
        raise HTTPException(400, f"Broadcast cannot be sent from status={b.status!r}")

    # SimulatedBroadcastSender: mark queued → sending → complete immediately
    b.status = "sending"
    b.started_at = _now()
    # Determine recipients_count from audience_filter_json (v1: use provided value or default 0)
    if b.recipients_count is None:
        b.recipients_count = 0
    b.sent_count = b.recipients_count
    b.failed_count = 0
    b.status = "complete"
    b.completed_at = _now()

    await s.commit()
    await s.refresh(b)
    return _broadcast(b)


@router.get("/broadcasts/{broadcast_id}")
async def get_broadcast(
    broadcast_id: uuid.UUID,
    s: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    b = (await s.execute(
        select(MassBroadcast).where(
            MassBroadcast.id == broadcast_id, MassBroadcast.tenant_id == user.tenant_id
        )
    )).scalar_one_or_none()
    if not b:
        raise HTTPException(404, "Broadcast not found")
    return _broadcast(b)


# ===========================================================================
# util
# ===========================================================================

def _require_uuid(body: dict, field: str) -> uuid.UUID:
    val = body.get(field)
    if not val:
        raise HTTPException(400, f"{field} is required")
    try:
        return uuid.UUID(str(val))
    except (ValueError, AttributeError):
        raise HTTPException(400, f"{field} must be a valid UUID")


def _opt_uuid(body: dict, field: str) -> Optional[uuid.UUID]:
    val = body.get(field)
    if not val:
        return None
    try:
        return uuid.UUID(str(val))
    except (ValueError, AttributeError):
        raise HTTPException(400, f"{field} must be a valid UUID")


def _parse_dt(value: Any, field: str) -> datetime:
    """Parse an ISO datetime; coerce tz-naive inputs to UTC (H8 / D7) and accept trailing 'Z'."""
    if isinstance(value, datetime):
        return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise HTTPException(400, f"{field} must be an ISO 8601 datetime string")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_dt_opt(value: Any, field: str) -> Optional[datetime]:
    if value is None or value == "":
        return None
    return _parse_dt(value, field)
