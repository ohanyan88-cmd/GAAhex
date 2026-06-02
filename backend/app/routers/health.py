"""Infra health / readiness probes and operational status summary.

Three endpoints — all fast, all safe:

  GET /api/health        — unauthenticated liveness; NO DB; never errors; returns 200 always.
  GET /api/health/ready  — unauthenticated readiness; one SELECT 1 ping; 200 ok / 503 down.
  GET /api/status        — authenticated operational summary: db, version, uptime, headline counts.

NOTE for coordinator: register health.router in main.py BEFORE records.router (fixed paths must not
be shadowed by the generic /api/{slug} catch-all).  Also: ops.py currently owns /api/status — remove
or rename that route in ops.py before registering health.router to avoid a silent FastAPI duplicate
(FastAPI keeps the first match; whichever router is registered first wins).
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionLocal, get_session
from ..models import Record, Tenant, User
from .auth import current_user

router = APIRouter(prefix="/api", tags=["health"])

# Module-level start time used for cheap uptime calculation.
_START_TIME: float = time.monotonic()
_START_WALL: str = datetime.now(timezone.utc).isoformat()


def _app_version() -> str:
    """Read the canonical version from the FastAPI app object (set in main.py)."""
    try:
        from ..main import app  # noqa: PLC0415  (lazy import avoids circular at module load)
        return app.version
    except Exception:
        return "0.0.1-m0"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uptime_seconds() -> float:
    return round(time.monotonic() - _START_TIME, 1)


# ---------------------------------------------------------------------------
# GET /api/health — unauthenticated liveness
# ---------------------------------------------------------------------------

@router.get(
    "/health",
    summary="Liveness probe — unauthenticated, no DB",
    response_model=None,
)
async def liveness() -> dict[str, Any]:
    """Returns 200 immediately. No auth, no DB. Safe to call from any probe."""
    return {
        "status": "ok",
        "version": _app_version(),
        "time": _now_iso(),
    }


# ---------------------------------------------------------------------------
# GET /api/health/ready — unauthenticated readiness (one DB ping)
# ---------------------------------------------------------------------------

@router.get(
    "/health/ready",
    summary="Readiness probe — unauthenticated, SELECT 1 DB ping",
    response_model=None,
)
async def readiness(response: Response) -> dict[str, Any]:
    """Pings the DB with SELECT 1.
    Returns 200 + {db: true} when healthy; 503 + {db: false, error} when unreachable.
    Never raises — all exceptions are caught and surfaced as a 503 payload.
    """
    db_ok: bool = False
    error_msg: str | None = None
    try:
        async with SessionLocal() as s:
            await s.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:  # noqa: BLE001
        error_msg = str(exc)

    payload: dict[str, Any] = {
        "db": db_ok,
        "version": _app_version(),
        "time": _now_iso(),
    }
    if not db_ok:
        payload["error"] = error_msg
        response.status_code = 503
    return payload


# ---------------------------------------------------------------------------
# GET /api/status — authenticated operational summary
# ---------------------------------------------------------------------------

@router.get(
    "/health/status",
    summary="Operational status summary — authenticated",
    response_model=None,
)
async def status(
    _user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Small operational dashboard for authenticated operators.

    Returns db liveness, version, uptime, and three headline counts (tenants, users, records).
    All counts are simple aggregates — no heavy joins.
    """
    db_ok: bool = True
    db_error: str | None = None
    try:
        await s.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        db_ok = False
        db_error = str(exc)

    counts: dict[str, int] = {"tenants": 0, "users": 0, "records": 0}
    if db_ok:
        try:
            counts["tenants"] = (await s.execute(select(func.count()).select_from(Tenant))).scalar_one()
            counts["users"] = (await s.execute(select(func.count()).select_from(User))).scalar_one()
            counts["records"] = (await s.execute(select(func.count()).select_from(Record))).scalar_one()
        except Exception:  # noqa: BLE001
            pass  # counts stay 0; db_ok already reflects true liveness

    payload: dict[str, Any] = {
        "service": "gaahex",
        "ok": db_ok,
        "db": db_ok,
        "version": _app_version(),
        "uptime_seconds": _uptime_seconds(),
        "started_at": _START_WALL,
        "time": _now_iso(),
        "counts": counts,
    }
    if db_error:
        payload["db_error"] = db_error
    return payload
