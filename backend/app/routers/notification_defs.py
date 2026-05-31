"""Notification-template CRUD for the Studio (Module 3 — Notifications).

Surfaces `NotificationDef` (templates / rules) as a config-management API: list / detail /
create / update / delete, plus `preview` (render the template with a sample context) and
`test-send` (emit one notification to the current admin so the channel adapter is exercised
end-to-end). Powers all five Studio leaves under the Notifications group — email / SMS /
push / in-app templates AND the rules view — via a single backend.

Mount under `/meta/notification-defs` (same convention as `meta.py`'s
config-mutating routes). Every write is gated server-side by `_require_config_manage`
(`config.manage` permission) and audited via `workflow.emit`.

Channel and category are validated against the NotificationDef shape (see
`app/models/notification.py`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.notification import NotificationDef
from ..access import load_grants, can
from .. import workflow
from .auth import current_user
from .notifications import _render, emit_notification


router = APIRouter(prefix="/meta/notification-defs", tags=["notification-defs"])

# Channel + category + priority allow-lists mirror the model's defaults/comments. Keep the
# server the single source of truth — the frontend is configuration, not the gate.
ALLOWED_CHANNELS = {"inapp", "email", "sms", "push", "webhook", "console"}
ALLOWED_CATEGORIES = {"system", "billing", "network", "customer", "internal"}
ALLOWED_PRIORITIES = {"critical", "warning", "info"}


async def _require_config_manage(s: AsyncSession, user: User) -> None:
    """Default-deny gate — same check used by meta.py / roles.py."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")


def _serialize(n: NotificationDef) -> dict:
    return {
        "key": n.key,
        "label": n.label,
        "channel": n.channel,
        "category": n.category,
        "priority": n.priority,
        "title_template": n.title_template,
        "body_template": n.body_template,
        "enabled": n.enabled,
        "gxl_condition": n.gxl_condition,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


async def _get_def(s: AsyncSession, tenant_id, key: str) -> NotificationDef:
    n = (await s.execute(
        select(NotificationDef).where(
            NotificationDef.tenant_id == tenant_id, NotificationDef.key == key
        )
    )).scalar_one_or_none()
    if not n:
        raise HTTPException(404, f"NotificationDef '{key}' not found")
    return n


# ---- list / detail (read; gated only by the standard auth dependency) -------------------

@router.get("")
async def list_defs(
    channel: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List notification defs for the tenant. Optional `?channel=` filter (email/sms/push/inapp/...).
    Read-only — auth required but no `config.manage`."""
    q = select(NotificationDef).where(NotificationDef.tenant_id == user.tenant_id)
    if channel:
        q = q.where(NotificationDef.channel == channel)
    rows = (await s.execute(q.order_by(NotificationDef.key))).scalars().all()
    return [_serialize(n) for n in rows]


@router.get("/{key}")
async def get_def(key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """One notification def by key."""
    return _serialize(await _get_def(s, user.tenant_id, key))


# ---- create / update / delete (writes; all gated + audited) -----------------------------

@router.post("", status_code=201)
async def create_def(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Create a notification def. `key` is unique per-tenant — a clash returns 409, not 5xx.
    Required: key, label, title_template, body_template. Optional: channel (default 'inapp'),
    category (default 'system'), priority (default 'info'), gxl_condition, enabled (default true)."""
    await _require_config_manage(s, user)

    key = (payload.get("key") or "").strip()
    label = (payload.get("label") or "").strip()
    title_t = (payload.get("title_template") or "").strip()
    body_t = (payload.get("body_template") or "").strip()
    if not key or not label or not title_t or not body_t:
        raise HTTPException(422, "key, label, title_template and body_template are required")

    channel = (payload.get("channel") or "inapp").strip()
    if channel not in ALLOWED_CHANNELS:
        raise HTTPException(422, f"channel must be one of {sorted(ALLOWED_CHANNELS)}")
    category = (payload.get("category") or "system").strip()
    if category not in ALLOWED_CATEGORIES:
        raise HTTPException(422, f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
    priority = (payload.get("priority") or "info").strip()
    if priority not in ALLOWED_PRIORITIES:
        raise HTTPException(422, f"priority must be one of {sorted(ALLOWED_PRIORITIES)}")
    enabled = bool(payload.get("enabled", True))
    cond = payload.get("gxl_condition")
    if cond is not None:
        cond = str(cond).strip() or None

    # Idempotent — explicit clash returns 409 before the INSERT, never a 5xx from the
    # unique constraint.
    clash = (await s.execute(
        select(NotificationDef).where(
            NotificationDef.tenant_id == user.tenant_id, NotificationDef.key == key
        )
    )).scalar_one_or_none()
    if clash:
        raise HTTPException(409, f"NotificationDef '{key}' already exists")

    n = NotificationDef(
        tenant_id=user.tenant_id, key=key, label=label, channel=channel,
        category=category, priority=priority,
        title_template=title_t, body_template=body_t,
        enabled=enabled, gxl_condition=cond,
    )
    s.add(n)
    try:
        await s.flush()
    except IntegrityError:
        # Defense in depth — race condition on the unique constraint also gives 409.
        await s.rollback()
        raise HTTPException(409, f"NotificationDef '{key}' already exists")

    await workflow.emit(
        s, user.tenant_id, "create", "notification_def", n.id, user.id,
        {"key": key, "label": label, "channel": channel, "category": category,
         "priority": priority, "enabled": enabled, "has_condition": bool(cond)},
    )
    await s.commit()
    return _serialize(n)


@router.patch("/{key}")
async def update_def(key: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit a notification def's safe attributes. `key` itself is immutable — references to it
    (events, the kernel emit) would orphan if renamed. Allowed: label, channel, category,
    priority, title_template, body_template, enabled, gxl_condition."""
    await _require_config_manage(s, user)
    n = await _get_def(s, user.tenant_id, key)

    allowed = {"label", "channel", "category", "priority", "title_template",
               "body_template", "enabled", "gxl_condition"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; editable: {sorted(allowed)}")

    changed: list[str] = []
    if "label" in payload:
        v = (payload["label"] or "").strip()
        if not v:
            raise HTTPException(422, "label cannot be empty")
        n.label = v; changed.append("label")
    if "channel" in payload:
        v = (payload["channel"] or "").strip()
        if v not in ALLOWED_CHANNELS:
            raise HTTPException(422, f"channel must be one of {sorted(ALLOWED_CHANNELS)}")
        n.channel = v; changed.append("channel")
    if "category" in payload:
        v = (payload["category"] or "").strip()
        if v not in ALLOWED_CATEGORIES:
            raise HTTPException(422, f"category must be one of {sorted(ALLOWED_CATEGORIES)}")
        n.category = v; changed.append("category")
    if "priority" in payload:
        v = (payload["priority"] or "").strip()
        if v not in ALLOWED_PRIORITIES:
            raise HTTPException(422, f"priority must be one of {sorted(ALLOWED_PRIORITIES)}")
        n.priority = v; changed.append("priority")
    if "title_template" in payload:
        v = (payload["title_template"] or "").strip()
        if not v:
            raise HTTPException(422, "title_template cannot be empty")
        n.title_template = v; changed.append("title_template")
    if "body_template" in payload:
        v = (payload["body_template"] or "").strip()
        if not v:
            raise HTTPException(422, "body_template cannot be empty")
        n.body_template = v; changed.append("body_template")
    if "enabled" in payload:
        n.enabled = bool(payload["enabled"]); changed.append("enabled")
    if "gxl_condition" in payload:
        raw = payload["gxl_condition"]
        n.gxl_condition = (str(raw).strip() or None) if raw is not None else None
        changed.append("gxl_condition")

    if changed:
        await workflow.emit(
            s, user.tenant_id, "update", "notification_def", n.id, user.id,
            {"key": n.key, "changed": changed},
        )
    await s.commit()
    return _serialize(n)


@router.delete("/{key}", status_code=204)
async def delete_def(key: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Hard-delete a notification def. Past inbox rows that were rendered FROM this def are
    preserved (Notification rows are immutable post-emit and don't FK to NotificationDef.id).
    Future emits of this def_key become a no-op until the def is recreated."""
    await _require_config_manage(s, user)
    n = await _get_def(s, user.tenant_id, key)
    nid = n.id
    nkey = n.key
    await s.delete(n)
    await workflow.emit(
        s, user.tenant_id, "delete", "notification_def", nid, user.id,
        {"key": nkey},
    )
    await s.commit()


# ---- preview ----------------------------------------------------------------------------

@router.post("/{key}/preview")
async def preview_def(key: str, payload: dict | None = None,
                      user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Render the def's title + body with a sample context. Read-only (no audit, no DB write).
    Uses the same `_render` + `_SafeDict` machinery as `emit_notification` so the preview matches
    what an emit would produce. Body shape: `{ "context": { ... } }`."""
    n = await _get_def(s, user.tenant_id, key)
    payload = payload or {}
    ctx = payload.get("context") or {}
    if not isinstance(ctx, dict):
        raise HTTPException(422, "context must be an object (key→value placeholders)")
    return {
        "key": n.key,
        "channel": n.channel,
        "title": _render(n.title_template, ctx),
        "body": _render(n.body_template, ctx),
        "context": ctx,
    }


# ---- test-send -------------------------------------------------------------------------

@router.post("/{key}/test-send", status_code=200)
async def test_send_def(key: str, payload: dict | None = None,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Emit one notification to the calling admin so the channel adapter is exercised end-to-end.

    Honest behavior:
      - If the def is disabled / its GXL condition is falsy / the caller opted out, returns
        `{ "delivered": false, "reason": "..." }` — never silently swallows.
      - If a real channel adapter (e.g. SMTP/Twilio) isn't configured, the dev adapter still
        runs (a no-op log), so the inapp row IS created — we surface that honestly too.
      - Audits a `test-send notification_def` event regardless.
    """
    await _require_config_manage(s, user)
    n = await _get_def(s, user.tenant_id, key)

    payload = payload or {}
    ctx = payload.get("context") or {}
    if not isinstance(ctx, dict):
        raise HTTPException(422, "context must be an object (key→value placeholders)")

    delivered = False
    reason: str | None = None
    note = None
    try:
        note = await emit_notification(
            s, tenant_id=user.tenant_id, def_key=n.key, user_id=user.id,
            context=ctx,
        )
        if note is None:
            # emit_notification returns None when: def disabled, gxl_condition false, or user
            # opted out. Surface a real reason — never lie about delivery.
            if not n.enabled:
                reason = "notification def is disabled"
            elif n.gxl_condition:
                reason = "gxl_condition evaluated false for the supplied context"
            else:
                reason = "recipient has opted out (preference)"
        else:
            delivered = True
    except Exception as exc:
        # Should be unreachable — emit_notification is fail-soft — but log honestly if so.
        reason = f"emit raised: {exc.__class__.__name__}"

    await workflow.emit(
        s, user.tenant_id, "test-send", "notification_def", n.id, user.id,
        {"key": n.key, "channel": n.channel, "delivered": delivered, "reason": reason},
    )
    await s.commit()

    return {
        "key": n.key,
        "channel": n.channel,
        "delivered": delivered,
        "reason": reason,
        "notification_id": str(note.id) if note else None,
    }
