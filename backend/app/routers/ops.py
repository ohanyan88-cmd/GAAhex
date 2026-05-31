"""System status + maintenance mode (launch-critical J91/J92).

`/api/status` is the richer, app-facing health payload a status page or banner can render — distinct
from the lightweight infra probes `/health` and `/health/db` in main.py, which stay untouched.

Maintenance mode is a process-local in-memory flag (seeded from the MAINTENANCE env var) toggled by
super-admins. Phase-1 is the SIGNAL + TOGGLE only: the flag is surfaced in the status payload so the
frontend can show a banner — it does NOT block requests yet (that's a later hardening step).
"""
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..access import load_grants, can
from .auth import current_user

router = APIRouter(prefix="/api", tags=["ops"])

APP_VERSION = "0.0.1-m0"        # fallback; the live value is read from the app at request time


def _env_bool(v) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "on") if v is not None else False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# In-memory maintenance state (process-local). Seeded once from env at import.
_MAINTENANCE = {
    "active": _env_bool(os.getenv("MAINTENANCE")),
    "message": os.getenv("MAINTENANCE_MESSAGE") or None,
    "since": _now() if _env_bool(os.getenv("MAINTENANCE")) else None,
}


def _app_version() -> str:
    try:
        from ..main import app           # lazy: main is fully imported by the time a request runs
        return app.version
    except Exception:
        return APP_VERSION


@router.get("/status")
async def status(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Health/status for a status page or banner: service + DB liveness, version, server time, and
    the current maintenance state."""
    db_ok = True
    try:
        await s.execute(text("select 1"))
    except Exception:
        db_ok = False
    return {
        "service": "gaaex",
        "ok": db_ok,
        "db": "ok" if db_ok else "down",
        "version": _app_version(),
        "time": _now(),
        "maintenance": dict(_MAINTENANCE),
    }


@router.post("/ops/maintenance")
async def set_maintenance(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Toggle maintenance mode — super-admin only (config.manage). Updates the in-memory flag the
    status payload exposes; does NOT block traffic yet."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="ops_maintenance",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))
    active = bool(payload.get("active"))
    _MAINTENANCE["active"] = active
    _MAINTENANCE["message"] = (payload.get("message") or None) if active else None
    _MAINTENANCE["since"] = _now() if active else None
    return {"maintenance": dict(_MAINTENANCE)}
