"""Phase B.3 — Revenue Assurance API.

Thin HTTP shell over ``services/revenue_assurance.py``. Writes (run-scan, mark-false-positive)
are admin-gated; reads + ack/resolve open to any authed tenant user with ``analytics.view``
(mirrors the analytics overview gate). Mounted under ``/api/revenue-assurance``.

Endpoints:
  * ``POST /api/revenue-assurance/scan`` — start a scan run; body ``{cycle_start?, cycle_end?}``
  * ``GET  /api/revenue-assurance/findings``   — paginated, filters: status, finding_type, severity
  * ``GET  /api/revenue-assurance/findings/{id}``
  * ``POST /api/revenue-assurance/findings/{id}/ack``
  * ``POST /api/revenue-assurance/findings/{id}/resolve`` — body ``{resolution}``
  * ``POST /api/revenue-assurance/findings/{id}/mark-false-positive`` — admin
  * ``GET  /api/revenue-assurance/scans``
  * ``GET  /api/revenue-assurance/scans/{id}`` — scan + its findings
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..access import can, load_grants
from ..db import get_session
from ..models import User
from ..models.ra_finding import RaFinding
from ..models.ra_scan_run import RaScanRun
from ..services import revenue_assurance as ra_service
from .auth import current_user

router = APIRouter(prefix="/api/revenue-assurance", tags=["revenue-assurance"])

_PAGE_SIZE = 100


# ==========================================================================================
# Helpers
# ==========================================================================================




def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _norm_page(page: int) -> int:
    return page if page >= 1 else 1


async def _require_admin(s: AsyncSession, user: User) -> None:
    """Writes are admin-gated. Accept either ``revenue_assurance.edit`` (purpose-built) or
    ``config.manage`` (super_admin holds ``*``, so this fallback is the practical gate)."""
    grants = await load_grants(s, user)
    if can(grants, "revenue_assurance", "edit") or can(grants, "config", "manage"):
        return
    _deny("revenue_assurance.edit")


async def _require_view(s: AsyncSession, user: User) -> None:
    """Reads + worklist actions (ack, resolve) follow the analytics gate: any user the org has
    given ``analytics.view`` may triage. Falls back to ``config.manage`` for super_admin."""
    grants = await load_grants(s, user)
    if can(grants, "analytics", "view") or can(grants, "config", "manage"):
        return
    _deny("analytics.view")


async def _get_finding(s: AsyncSession, user: User, finding_id: uuid.UUID) -> RaFinding:
    f = (await s.execute(
        select(RaFinding).where(
            RaFinding.id == finding_id, RaFinding.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if f is None:
        raise HTTPException(404, "Finding not found")
    return f


async def _get_scan(s: AsyncSession, user: User, scan_id: uuid.UUID) -> RaScanRun:
    r = (await s.execute(
        select(RaScanRun).where(
            RaScanRun.id == scan_id, RaScanRun.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if r is None:
        raise HTTPException(404, "Scan run not found")
    return r


from ..utils.dt import parse_iso_dt as _parse_iso_dt_canon  # BL-5 — single source
from ..utils.http_errors import deny as _deny  # BL-10


def _parse_iso(value, field: str) -> datetime | None:
    """BL-5 — thin wrapper over ``app.utils.dt.parse_iso_dt`` (optional=True)."""
    return _parse_iso_dt_canon(value, field, optional=True)


# ==========================================================================================
# Serializers
# ==========================================================================================


def _finding(f: RaFinding) -> dict:
    return {
        "id": str(f.id),
        "tenant_id": str(f.tenant_id),
        "finding_type": f.finding_type,
        "severity": f.severity,
        "entity_type": f.entity_type,
        "entity_id": str(f.entity_id),
        "summary": f.summary,
        "detail_json": dict(f.detail_json or {}),
        "detected_at": _iso(f.detected_at),
        "status": f.status,
        "ack_at": _iso(f.ack_at),
        "ack_by": str(f.ack_by) if f.ack_by else None,
        "resolved_at": _iso(f.resolved_at),
        "resolved_by": str(f.resolved_by) if f.resolved_by else None,
        "resolution": f.resolution,
        "scan_run_id": str(f.scan_run_id) if f.scan_run_id else None,
    }


def _scan(r: RaScanRun) -> dict:
    return {
        "id": str(r.id),
        "tenant_id": str(r.tenant_id),
        "started_at": _iso(r.started_at),
        "completed_at": _iso(r.completed_at),
        "status": r.status,
        "findings_count": int(r.findings_count or 0),
        "error_message": r.error_message,
        "triggered_by": str(r.triggered_by) if r.triggered_by else None,
    }


# ==========================================================================================
# Scan endpoint
# ==========================================================================================


@router.post("/scan")
async def start_scan(
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Kick off a Revenue Assurance scan. Admin-gated.

    Body (optional): ``{"cycle_start": iso, "cycle_end": iso}``. When unset, the current calendar
    month is used. Returns the ``RaScanRun`` snapshot once both scans have completed.
    """
    await _require_admin(s, user)
    payload = payload or {}
    cycle_start = _parse_iso(payload.get("cycle_start"), "cycle_start")
    cycle_end = _parse_iso(payload.get("cycle_end"), "cycle_end")

    try:
        run = await ra_service.run_full_scan(
            s,
            tenant_id=user.tenant_id,
            actor_id=user.id,
            cycle_start=cycle_start,
            cycle_end=cycle_end,
        )
        await s.commit()
    except Exception as e:
        await s.commit()  # the failed run row is itself state we want preserved
        raise HTTPException(500, f"Scan failed: {e}")

    return _scan(run)


# ==========================================================================================
# Findings
# ==========================================================================================


@router.get("/findings")
async def list_findings(
    status: str | None = None,
    finding_type: str | None = None,
    severity: str | None = None,
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated list of findings. Filters: status, finding_type, severity.

    Sorted newest-first by ``detected_at``.
    """
    await _require_view(s, user)
    page = _norm_page(page)
    q = select(RaFinding).where(RaFinding.tenant_id == user.tenant_id)
    if status:
        q = q.where(RaFinding.status == status)
    if finding_type:
        q = q.where(RaFinding.finding_type == finding_type)
    if severity:
        q = q.where(RaFinding.severity == severity)
    q = q.order_by(RaFinding.detected_at.desc())

    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_finding(f) for f in rows],
    }


@router.get("/findings/{finding_id}")
async def get_finding(
    finding_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    await _require_view(s, user)
    f = await _get_finding(s, user, finding_id)
    return _finding(f)


@router.post("/findings/{finding_id}/ack")
async def ack_finding(
    finding_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Acknowledge a finding — flips status='investigating' and stamps ack_at/ack_by."""
    await _require_view(s, user)
    f = await _get_finding(s, user, finding_id)
    if f.status in ("resolved", "false_positive"):
        raise HTTPException(409, f"Finding is already {f.status}")
    f.status = "investigating"
    f.ack_at = _now()
    f.ack_by = user.id
    await s.commit()
    await s.refresh(f)
    return _finding(f)


@router.post("/findings/{finding_id}/resolve")
async def resolve_finding(
    finding_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Resolve a finding — status='resolved', stamps resolved_at/resolved_by, stores resolution."""
    await _require_view(s, user)
    f = await _get_finding(s, user, finding_id)
    if f.status in ("resolved", "false_positive"):
        raise HTTPException(409, f"Finding is already {f.status}")
    resolution = ""
    if payload is not None:
        resolution = str(payload.get("resolution") or "").strip()
    f.status = "resolved"
    f.resolved_at = _now()
    f.resolved_by = user.id
    f.resolution = resolution or None
    await s.commit()
    await s.refresh(f)
    return _finding(f)


@router.post("/findings/{finding_id}/mark-false-positive")
async def mark_false_positive(
    finding_id: uuid.UUID,
    payload: dict | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Mark a finding as a false positive. Admin-gated."""
    await _require_admin(s, user)
    f = await _get_finding(s, user, finding_id)
    if f.status in ("resolved", "false_positive"):
        raise HTTPException(409, f"Finding is already {f.status}")
    resolution = ""
    if payload is not None:
        resolution = str(payload.get("resolution") or "").strip()
    f.status = "false_positive"
    f.resolved_at = _now()
    f.resolved_by = user.id
    f.resolution = resolution or None
    await s.commit()
    await s.refresh(f)
    return _finding(f)


# ==========================================================================================
# Scan runs
# ==========================================================================================


@router.get("/scans")
async def list_scans(
    page: int = 1,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """Paginated list of scan runs, newest first."""
    await _require_view(s, user)
    page = _norm_page(page)
    q = select(RaScanRun).where(RaScanRun.tenant_id == user.tenant_id) \
        .order_by(RaScanRun.started_at.desc())
    total = (await s.execute(
        select(func.count()).select_from(q.subquery())
    )).scalar_one()
    q = q.offset((page - 1) * _PAGE_SIZE).limit(_PAGE_SIZE)
    rows = (await s.execute(q)).scalars().all()
    return {
        "page": page,
        "page_size": _PAGE_SIZE,
        "total": int(total or 0),
        "items": [_scan(r) for r in rows],
    }


@router.get("/scans/{scan_id}")
async def get_scan_with_findings(
    scan_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict:
    """One scan run + the findings it produced."""
    await _require_view(s, user)
    run = await _get_scan(s, user, scan_id)
    findings = (await s.execute(
        select(RaFinding).where(
            RaFinding.tenant_id == user.tenant_id,
            RaFinding.scan_run_id == run.id,
        ).order_by(RaFinding.detected_at.desc())
    )).scalars().all()
    return {
        "scan": _scan(run),
        "findings": [_finding(f) for f in findings],
    }
