import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.notification import NotificationDef, Notification
from ..models.notification_pref import NotificationPref
from ..models.outbound import OutboundMessage
from ..access import load_grants, can
from .. import gxl, channels
from .auth import current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])

# Outbound delivery log lives under /api (not /notifications) — see GET /api/outbound below.
# Register BEFORE records.router in main.py so "/api/outbound" isn't captured as an entity slug.
outbound_router = APIRouter(prefix="/api", tags=["outbound"])


# ---- template rendering (fail-soft — never raises into the caller) ----

class _SafeDict(dict):
    """Leaves unknown placeholders intact instead of raising KeyError."""
    def __missing__(self, key):
        return "{" + key + "}"


def _render(template: str, context: dict) -> str:
    try:
        return template.format_map(_SafeDict(context))
    except Exception:
        # any malformed template / bad access → return it verbatim rather than break the emit
        return template


# ---- service function (importable; the kernel emits notifications through this) ----

async def emit_notification(
    s: AsyncSession,
    *,
    tenant_id,
    def_key: str,
    user_id,
    entity_key: str | None = None,
    record_id=None,
    context: dict | None = None,
) -> Notification | None:
    """Create one inbox notification from its NotificationDef. Config-, condition-, and
    preference-gated.

    No-op (returns None) when the def is missing, disabled, its GXL condition is falsy, or the
    recipient has opted out (a disabled NotificationPref for the def's category or its def_key on
    that channel). Preference checking is default-on and fail-soft — a pref lookup error delivers.
    Does NOT commit — the caller's unit of work owns the transaction — but flushes so the id
    is available.
    """
    ctx = context or {}
    ndef = (await s.execute(
        select(NotificationDef).where(
            NotificationDef.tenant_id == tenant_id, NotificationDef.key == def_key
        )
    )).scalar_one_or_none()
    if not ndef or not ndef.enabled:
        return None
    if ndef.gxl_condition and not gxl.evaluate(ndef.gxl_condition, ctx):
        return None
    if await _pref_opted_out(s, tenant_id, user_id, ndef):
        return None

    note = Notification(
        tenant_id=tenant_id,
        def_key=ndef.key,
        user_id=user_id,
        category=ndef.category,
        priority=ndef.priority,
        title=_render(ndef.title_template, ctx),
        body=_render(ndef.body_template, ctx),
        entity_key=entity_key,
        record_id=record_id,
    )
    s.add(note)
    await s.flush()

    # If the def targets a non-inapp channel, ALSO fan out externally (the inbox row above is kept
    # either way). Fully fail-soft — a delivery problem must never break the emit.
    if ndef.channel and ndef.channel != "inapp":
        await _dispatch_external(s, tenant_id, user_id, ndef, note)

    return note


async def _resolve_address(s: AsyncSession, tenant_id, user_id, channel: str) -> str | None:
    """The recipient's address for a channel. email ⇒ User.email; sms ⇒ User.phone if it exists
    (it does NOT yet — degrades to None, which the sms adapter records as FAILED). Other channels
    have no per-user address here."""
    recipient = (await s.execute(
        select(User).where(User.id == user_id, User.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if recipient is None:
        return None
    if channel == "email":
        return recipient.email
    if channel == "sms":
        return getattr(recipient, "phone", None)
    return None


async def _dispatch_external(s: AsyncSession, tenant_id, user_id, ndef: NotificationDef, note: Notification) -> None:
    try:
        to_addr = await _resolve_address(s, tenant_id, user_id, ndef.channel)
        await channels.dispatch(
            s, tenant_id=tenant_id, channel=ndef.channel, to=to_addr,
            subject=note.title, body=note.body, def_key=ndef.key, user_id=user_id,
        )
    except Exception:
        return  # never propagate into the emit


async def _pref_opted_out(s: AsyncSession, tenant_id, user_id, ndef: NotificationDef) -> bool:
    """True if the recipient has a *disabled* preference matching this def's category or def_key on
    its channel. Default-on (no row ⇒ deliver) and fail-soft (lookup error ⇒ deliver)."""
    try:
        pref = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == tenant_id,
                NotificationPref.user_id == user_id,
                NotificationPref.channel == ndef.channel,
                NotificationPref.enabled.is_(False),
                NotificationPref.category.in_([ndef.category, ndef.key]),
            )
        )).scalars().first()
        return pref is not None
    except Exception:
        return False


# ---- serialization ----

def _serialize(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "def_key": n.def_key,
        "category": n.category,
        "priority": n.priority,
        "title": n.title,
        "body": n.body,
        "entity_key": n.entity_key,
        "record_id": str(n.record_id) if n.record_id else None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def _serialize_pref(p: NotificationPref) -> dict:
    return {
        "id": str(p.id),
        "category": p.category,
        "channel": p.channel,
        "enabled": p.enabled,
    }


def _serialize_outbound(m: OutboundMessage) -> dict:
    return {
        "id": str(m.id),
        "channel": m.channel,
        "to_addr": m.to_addr,
        "subject": m.subject,
        "body": m.body,
        "status": m.status,
        "def_key": m.def_key,
        "user_id": str(m.user_id) if m.user_id else None,
        "error": m.error,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ---- preference payloads ----

class PrefIn(BaseModel):
    category: str                      # a category name OR a def_key
    channel: str = "inapp"
    enabled: bool


class PrefsIn(BaseModel):
    preferences: list[PrefIn] = Field(default_factory=list)


# ---- endpoints (each strictly scoped to the current user's own rows) ----

@router.get("")
async def inbox(
    unread: bool = False,
    category: str | None = None,
    priority: str | None = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """The current user's inbox, newest first. Optional filters: `?unread=true`,
    `?category=`, `?priority=` (all backward-compatible — no params ⇒ prior behavior)."""
    q = select(Notification).where(
        Notification.tenant_id == user.tenant_id, Notification.user_id == user.id
    )
    if unread:
        q = q.where(Notification.read_at.is_(None))
    if category:
        q = q.where(Notification.category == category)
    if priority:
        q = q.where(Notification.priority == priority)
    q = q.order_by(Notification.created_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(n) for n in rows]


@router.get("/preferences")
async def get_preferences(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The caller's own notification preferences (opt-outs). Absence ⇒ delivered (default-on)."""
    rows = (await s.execute(
        select(NotificationPref).where(
            NotificationPref.tenant_id == user.tenant_id, NotificationPref.user_id == user.id
        ).order_by(NotificationPref.category)
    )).scalars().all()
    return [_serialize_pref(p) for p in rows]


@router.put("/preferences")
async def set_preferences(body: PrefsIn, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Upsert the caller's own preferences (one row per category/def_key + channel). Returns the
    full current preference set."""
    for p in body.preferences:
        existing = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == user.tenant_id,
                NotificationPref.user_id == user.id,
                NotificationPref.category == p.category,
                NotificationPref.channel == p.channel,
            )
        )).scalar_one_or_none()
        if existing:
            existing.enabled = p.enabled
        else:
            s.add(NotificationPref(
                tenant_id=user.tenant_id, user_id=user.id,
                category=p.category, channel=p.channel, enabled=p.enabled,
            ))
    await s.commit()
    rows = (await s.execute(
        select(NotificationPref).where(
            NotificationPref.tenant_id == user.tenant_id, NotificationPref.user_id == user.id
        ).order_by(NotificationPref.category)
    )).scalars().all()
    return [_serialize_pref(p) for p in rows]


@router.get("/unread-count")
async def unread_count(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    rows = (await s.execute(
        select(Notification.id).where(
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
    )).all()
    return {"count": len(rows)}


@router.post("/{note_id}/read")
async def mark_read(note_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    note = (await s.execute(
        select(Notification).where(
            Notification.id == note_id,
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not note:
        raise HTTPException(404, "Notification not found")
    if note.read_at is None:
        note.read_at = datetime.now(timezone.utc)
    await s.commit()
    await s.refresh(note)
    return _serialize(note)


@router.post("/read-all")
async def mark_all_read(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Mark all the current user's unread notifications read; returns how many were updated."""
    result = await s.execute(
        update(Notification)
        .where(
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
            Notification.read_at.is_(None),
        )
        .values(read_at=datetime.now(timezone.utc))
    )
    await s.commit()
    return {"updated": result.rowcount}


# ---- outbound delivery log (admin) — on the /api router ----

@outbound_router.get("/outbound")
async def outbound_log(channel: str | None = None, status: str | None = None,
                       user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The tenant's external-delivery log, newest first. Gated on config.manage. Optional filters
    `?channel=` and `?status=`."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed: config.manage")
    q = select(OutboundMessage).where(OutboundMessage.tenant_id == user.tenant_id)
    if channel:
        q = q.where(OutboundMessage.channel == channel)
    if status:
        q = q.where(OutboundMessage.status == status)
    rows = (await s.execute(q.order_by(OutboundMessage.created_at.desc()))).scalars().all()
    return [_serialize_outbound(m) for m in rows]
