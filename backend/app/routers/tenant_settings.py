"""Tenant profile / settings — the editable company identity an onboarding wizard collects and the
app header shows (name, currency, locale, logo mark, onboarding state).

Tenant-scoped: a user reads/updates only their OWN tenant. Writes are gated on `tenant.settings`
(super_admin's `*` covers it). Every update emits an audit Event through the usual chokepoint.

NOTE: fixed paths under /api ("/api/tenant"), so register BEFORE records.router ("/api/{slug}").
"""
import base64

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import Tenant, User
from ..access import load_grants, can
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/tenant", tags=["tenant-settings"])

LOCALES = {"en", "hy"}

# Logo upload limits — mirrors me.py so both upload paths enforce the same policy.
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_LOGO_BYTES = 2 * 1024 * 1024  # 2 MB

# ----- Theme (Studio AppearancePane → design tokens) ---------------------------------------------
# Keep these allow-lists in lock-step with frontend/src/studio/StudioRichPanes.tsx
# (ACCENTS / RADII / density buttons / theme buttons around AppearancePane). When the
# kit grows a new option, add it BOTH places — the SettingsView bug we just fixed was a
# backend allow-list that lagged what the frontend could send.
THEME_ACCENTS = {"Azure", "Cobalt", "Gold", "Emerald", "Violet", "Teal"}
THEME_RADII = {"Sharp", "Soft", "Rounded", "Pill"}
THEME_DENSITIES = {"Compact", "Comfortable", "Spacious"}
THEME_MODES = {"Dark", "Light", "Auto"}
THEME_FIELDS = {"accent", "radius", "density", "mode"}


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
    """Accept either a data:image/...;base64,... URL or a clean http(s) URL. Anything else → 422.

    For data URLs, independently validates:
      1. MIME type is in ALLOWED_LOGO_TYPES (not just any image/* — blocks SVG XSS vectors).
      2. Base64 payload is syntactically valid.
      3. Decoded size is ≤ MAX_LOGO_BYTES (prevents unbounded blobs in the tenant row).
    """
    if v is None or v == "":
        return None
    v = v.strip()
    if v.startswith("data:image/"):
        if ";base64," not in v:
            raise HTTPException(422, "logo_url data URL must be base64-encoded (data:image/...;base64,...)")
        mime_part, b64_part = v.split(";base64,", 1)
        mime = mime_part[len("data:"):]  # strip leading "data:"
        if mime not in ALLOWED_LOGO_TYPES:
            raise HTTPException(
                422,
                f"Logo MIME type '{mime}' not allowed; must be one of: {', '.join(sorted(ALLOWED_LOGO_TYPES))}",
            )
        try:
            raw = base64.b64decode(b64_part, validate=True)
        except Exception:
            raise HTTPException(422, "logo_url contains invalid base64 data")
        if len(raw) > MAX_LOGO_BYTES:
            raise HTTPException(422, f"Logo too large (max {MAX_LOGO_BYTES // (1024 * 1024)}MB)")
        return v
    if v.startswith("http://") or v.startswith("https://"):
        return v
    raise HTTPException(422, "logo_url must be a data:image/...;base64,... URL or an http(s) URL")


async def _require_settings(s: AsyncSession, user: User) -> None:
    grants = await load_grants(s, user)
    if not can(grants, "tenant", "settings"):
        raise HTTPException(403, "Not allowed: tenant.settings")
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate complements legacy role check.
    try:
        await assert_can(s, user, action="config_manage", entity_key="tenant",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


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

    await workflow.emit(s, user.tenant_id, "UPDATE", "tenant", t.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(t)
    return _serialize(t)


# ---- theme (Studio AppearancePane) -----------------------------------------------------------
def _serialize_theme(t: Tenant) -> dict:
    """Returns the saved theme dict; missing keys are returned as null so the frontend
    can apply its own defaults (we never invent a default server-side)."""
    saved = t.theme or {}
    return {f: saved.get(f) for f in THEME_FIELDS}


@router.get("/settings/theme")
async def get_theme(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The tenant's design tokens (accent / radius / density / mode). Readable by any
    authenticated tenant user — every rendered screen reads this to apply branding.

    Missing fields come back as null (NOT defaults). The frontend AppearancePane decides
    what to render when a token is unset.
    """
    return _serialize_theme(await _tenant(s, user))


@router.put("/settings/theme")
async def update_theme(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Update one or more design tokens. Gated on tenant.settings; emits an audit Event.

    Accepts a partial dict (only keys present are updated). Each enum-y field is validated
    against an explicit allow-list — invalid value ⇒ 422 with the allowed set echoed back.
    Passing `null` for a field clears it (frontend will fall back to its default).
    """
    await _require_settings(s, user)
    t = await _tenant(s, user)

    if not isinstance(payload, dict):
        raise HTTPException(422, "body must be a JSON object")

    unknown = set(payload) - THEME_FIELDS
    if unknown:
        raise HTTPException(422, f"Cannot set {sorted(unknown)}; allowed: {sorted(THEME_FIELDS)}")

    # Start from the saved theme so a partial PUT preserves untouched fields.
    next_theme: dict = dict(t.theme or {})
    changed: dict = {}

    def _check(field: str, allowed: set[str]) -> None:
        if field not in payload:
            return
        v = payload[field]
        if v is None or v == "":
            next_theme.pop(field, None)
            changed[field] = None
            return
        if not isinstance(v, str):
            raise HTTPException(422, f"{field} must be a string, one of {sorted(allowed)}")
        if v not in allowed:
            raise HTTPException(422, f"{field} must be one of {sorted(allowed)}")
        next_theme[field] = v
        changed[field] = v

    _check("accent", THEME_ACCENTS)
    _check("radius", THEME_RADII)
    _check("density", THEME_DENSITIES)
    _check("mode", THEME_MODES)

    # Persist the full dict (or None when every field was cleared) so JSONB stays compact.
    t.theme = next_theme or None

    await workflow.emit(s, user.tenant_id, "UPDATE", "tenant", t.id, user.id, {"theme": changed})
    await s.commit()
    await s.refresh(t)
    return _serialize_theme(t)
