"""Tenant profile / settings — the editable company identity an onboarding wizard collects and the
app header shows (name, currency, locale, logo mark, onboarding state).

Tenant-scoped: a user reads/updates only their OWN tenant. Writes are gated on `tenant.settings`
(super_admin's `*` covers it). Every update emits an audit Event through the usual chokepoint.

NOTE: fixed paths under /api ("/api/tenant"), so register BEFORE records.router ("/api/{slug}").
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Tenant, User
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/tenant", tags=["tenant-settings"])

LOCALES = {"en", "hy"}


async def _tenant(s: AsyncSession, user: User) -> Tenant:
    t = (await s.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Tenant not found")
    return t


def _serialize(t: Tenant) -> dict:
    return {
        "name": t.name,
        "currency": t.currency or "AMD",
        "locale": t.locale or "en",
        "logo_text": t.logo_text,
        "logo_url": t.logo_url,
        "onboarded": t.onboarded_at is not None,
        "onboarded_at": t.onboarded_at.isoformat() if t.onboarded_at else None,
    }


def _validate_logo_url(v: str | None) -> str | None:
    """Accept either a data:image/...;base64,... URL or a clean http(s) URL. Anything else → 422."""
    if v is None or v == "":
        return None
    v = v.strip()
    if v.startswith("data:image/"):
        # Same shape as app_user.avatar_url (see me.py:71).
        if ";base64," not in v:
            raise HTTPException(422, "logo_url data URL must be base64-encoded (data:image/...;base64,...)")
        return v
    if v.startswith("http://") or v.startswith("https://"):
        return v
    raise HTTPException(422, "logo_url must be a data:image/...;base64,... URL or an http(s) URL")


async def _require_settings(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "tenant", "settings"):
        raise HTTPException(403, "Not allowed: tenant.settings")


@router.get("/settings")
async def get_settings(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The caller's tenant profile. Readable by any authenticated tenant user."""
    return _serialize(await _tenant(s, user))


@router.put("/settings")
async def update_settings(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update name / currency / locale / logo_text. Gated on tenant.settings; emits an audit Event."""
    await _require_settings(s, user)
    t = await _tenant(s, user)

    allowed = {"name", "currency", "locale", "logo_text", "logo_url"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot set {sorted(unknown)}; allowed: {sorted(allowed)}")

    changed: dict = {}
    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        t.name = v; changed["name"] = v
    if "currency" in payload:
        v = (payload["currency"] or "").strip().upper()
        if not (3 <= len(v) <= 8) or not v.isalpha():
            raise HTTPException(422, "currency must be a short alphabetic code (e.g. AMD)")
        t.currency = v; changed["currency"] = v
    if "locale" in payload:
        v = (payload["locale"] or "").strip().lower()
        if v not in LOCALES:
            raise HTTPException(422, f"locale must be one of {sorted(LOCALES)}")
        t.locale = v; changed["locale"] = v
    if "logo_text" in payload:
        t.logo_text = (payload["logo_text"] or None)
        changed["logo_text"] = t.logo_text
    if "logo_url" in payload:
        t.logo_url = _validate_logo_url(payload["logo_url"])
        # Don't log the full base64 in the audit Event — record only that the logo changed.
        changed["logo_url"] = "<set>" if t.logo_url else None

    await workflow.emit(s, user.tenant_id, "update", "tenant", t.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(t)
    return _serialize(t)
