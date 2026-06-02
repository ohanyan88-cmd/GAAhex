import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.notification import NotificationDef, Notification
from ..models.notification_pref import NotificationPref
from ..models.outbound import OutboundMessage
from ..access import load_grants, can
from .. import gxl, channels
from ..adapters.base import registry as adapter_registry
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
    # Notification Standard extension kwargs (file 05 / D16).
    # All optional — every existing call site works unchanged.
    event_id=None,                          # D16: triggering event id
    source: str | None = None,             # NotificationSource UPPER_SNAKE
    severity: str | None = None,           # INFO|WARNING|ERROR|CRITICAL
    recipient_type: str = "EMPLOYEE",      # RecipientType (default EMPLOYEE = user_id path)
    std_category: str | None = None,       # Option A: canonical NotificationCategory
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

    # A26: resolve the recipient's delivery preference (mode/channels/muted) for this notification's
    # category / def_key. The in-app inbox row is created UNCONDITIONALLY below — prefs only gate the
    # EXTERNAL fan-out and the digest hand-off. `_resolve_pref` returns None when the user has NO
    # A26 pref row (the common case) → preserve TODAY's behaviour exactly (dispatch the def's own
    # channel). Fail-soft: a resolution error returns None → today's behaviour.
    pref = await _resolve_pref(s, tenant_id, user_id, ndef.category, ndef.key)
    external_channel = ndef.channel if (ndef.channel and ndef.channel != "inapp") else None

    # Decide external delivery vs digest-defer vs inbox-only. Defaults (pref is None) keep legacy:
    #   send_external = there is an external channel  (exactly as before A26)
    #   digest_pending = False
    if pref is None:
        send_external = external_channel is not None
        digest_pending = False
    else:
        mode = pref["mode"]
        allowed = external_channel is not None and external_channel in pref["channels"] and not pref["muted"]
        # realtime → send now to an allowed channel; digest → defer + flag; off → inbox only.
        send_external = allowed and mode == "realtime"
        digest_pending = bool(external_channel is not None and mode == "digest" and not pref["muted"])

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
        digest_pending=digest_pending,   # lane E sends the digest and clears this flag
        # Notification Standard extension fields (file 05 / D16).
        event_id=event_id,
        source=source,
        severity=severity,
        recipient_type=recipient_type,
        std_category=std_category,
        status="PENDING" if digest_pending else "DELIVERED",
    )
    s.add(note)
    await s.flush()

    # The inbox row above is ALWAYS kept (non-breaking invariant). Only EXTERNAL dispatch is gated.
    # Fully fail-soft — a delivery problem must never break the emit.
    if send_external:
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


# A26 delivery-preference rows are keyed only on (tenant, user, category) — they use this sentinel in
# the legacy `channel` column so they coexist with legacy per-channel opt-out rows under the existing
# unique constraint (tenant, user, category, channel) without colliding.
PREF_CHANNEL_SENTINEL = "*"
CATEGORY_DEFAULT = "*"
PREF_MODES = {"off", "realtime", "digest"}


async def _resolve_pref(s: AsyncSession, tenant_id, user_id, category: str, def_key: str) -> dict | None:
    """Resolve the recipient's A26 delivery preference for a notification.

    Looks only at A26 rows (channel == sentinel). Precedence — most specific first:
      1. a row whose category == this def's def_key
      2. a row whose category == this def's category
      3. the user's default row (category == "*")
    Returns `{"mode", "channels", "muted"}` for the winning row, or **None** when the user has no A26
    row at all → caller preserves today's behaviour (legacy external dispatch on the def's channel).
    Fail-soft: any error returns None (today's behaviour).
    """
    try:
        rows = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == tenant_id,
                NotificationPref.user_id == user_id,
                NotificationPref.channel == PREF_CHANNEL_SENTINEL,
                NotificationPref.category.in_([def_key, category, CATEGORY_DEFAULT]),
            )
        )).scalars().all()
        if not rows:
            return None
        by_cat = {r.category: r for r in rows}
        winner = by_cat.get(def_key) or by_cat.get(category) or by_cat.get(CATEGORY_DEFAULT)
        if winner is None:
            return None
        mode = winner.mode if winner.mode in PREF_MODES else "realtime"
        channels_list = winner.channels if isinstance(winner.channels, list) else ["inapp"]
        return {"mode": mode, "channels": channels_list, "muted": bool(winner.muted)}
    except Exception:
        return None


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
        "archived": n.archived,
        "snoozed_until": n.snoozed_until.isoformat() if n.snoozed_until else None,
        "digest_pending": n.digest_pending,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


def _serialize_pref(p: NotificationPref) -> dict:
    """Legacy opt-out shape (kept stable for the existing /notifications/preferences API)."""
    return {
        "id": str(p.id),
        "category": p.category,
        "channel": p.channel,
        "enabled": p.enabled,
    }


def _serialize_delivery_pref(p: NotificationPref) -> dict:
    """A26 delivery-preference shape (SHARED CONTRACT — lanes E + B read this)."""
    return {
        "id": str(p.id),
        "category": p.category,
        "mode": p.mode,
        "channels": list(p.channels) if isinstance(p.channels, list) else ["inapp"],
        "muted": p.muted,
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


# ---- A26 delivery-preference payloads (SHARED CONTRACT) ----

class DeliveryPrefIn(BaseModel):
    category: str = "*"                       # a category name OR a def_key OR "*" (user default)
    mode: str = "realtime"                    # off | realtime | digest
    channels: list[str] = Field(default_factory=lambda: ["inapp"])
    muted: bool = False


class DeliveryPrefsIn(BaseModel):
    preferences: list[DeliveryPrefIn] = Field(default_factory=list)


# ---- endpoints (each strictly scoped to the current user's own rows) ----

@router.get("")
async def inbox(
    unread: bool = False,
    category: str | None = None,
    priority: str | None = None,
    archived: bool = False,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """The current user's inbox, newest first. Optional filters: `?unread=true`,
    `?category=`, `?priority=`, `?archived=true` (all backward-compatible — no params ⇒ prior
    behavior). By default archived notifications are hidden; pass `?archived=true` to list only
    archived ones."""
    q = select(Notification).where(
        Notification.tenant_id == user.tenant_id, Notification.user_id == user.id
    )
    if unread:
        q = q.where(Notification.read_at.is_(None))
    if category:
        q = q.where(Notification.category == category)
    if priority:
        q = q.where(Notification.priority == priority)
    # default view hides archived rows; ?archived=true flips to the archive view (the row is always
    # kept — archive is inbox state only, never a delete).
    q = q.where(Notification.archived.is_(archived))
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


# ---- A26 inbox state actions (snooze / archive) — scoped to the caller's own rows ----

class SnoozeIn(BaseModel):
    # Either an explicit timestamp, or a relative number of minutes. snoozed_until=None ⇒ unsnooze.
    snoozed_until: datetime | None = None
    minutes: int | None = None


@router.post("/{note_id}/snooze")
async def snooze(note_id: uuid.UUID, body: SnoozeIn | None = None,
                 user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Snooze (or unsnooze) one of the caller's notifications. Inbox-state only — never touches
    delivery. `{"minutes": N}` snoozes N minutes from now; `{"snoozed_until": <iso>}` sets an explicit
    time; an empty body / `{"snoozed_until": null}` clears the snooze."""
    body = body or SnoozeIn()
    note = (await s.execute(
        select(Notification).where(
            Notification.id == note_id,
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not note:
        raise HTTPException(404, "Notification not found")
    if body.minutes is not None:
        from datetime import timedelta
        note.snoozed_until = datetime.now(timezone.utc) + timedelta(minutes=body.minutes)
    else:
        note.snoozed_until = body.snoozed_until
    await s.commit()
    await s.refresh(note)
    return _serialize(note)


@router.post("/{note_id}/archive")
async def archive(note_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Archive one of the caller's notifications (hides it from the default inbox view; the row is
    kept). Idempotent. Inbox-state only — never touches delivery."""
    note = (await s.execute(
        select(Notification).where(
            Notification.id == note_id,
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not note:
        raise HTTPException(404, "Notification not found")
    note.archived = True
    await s.commit()
    await s.refresh(note)
    return _serialize(note)


@router.post("/{note_id}/unarchive")
async def unarchive(note_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Restore an archived notification to the default inbox view. Idempotent."""
    note = (await s.execute(
        select(Notification).where(
            Notification.id == note_id,
            Notification.tenant_id == user.tenant_id,
            Notification.user_id == user.id,
        )
    )).scalar_one_or_none()
    if not note:
        raise HTTPException(404, "Notification not found")
    note.archived = False
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


# ---- manual compose + send ----

_SUPPORTED_CHANNELS = {"email", "sms"}


class ComposeIn(BaseModel):
    channel: str
    to: str
    subject: str | None = None
    body: str
    record_id: str | None = None
    entity_key: str | None = None

    def model_post_init(self, __context) -> None:  # noqa: ANN001
        if self.channel not in _SUPPORTED_CHANNELS:
            raise ValueError(f"channel must be one of {sorted(_SUPPORTED_CHANNELS)}")
        if not self.to or not self.to.strip():
            raise ValueError("to must not be blank")
        if not self.body or not self.body.strip():
            raise ValueError("body must not be blank")


@outbound_router.post("/outbound/compose", status_code=201)
async def compose_and_send(
    payload: ComposeIn,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Manually compose and send a message via a registered channel adapter.

    Validates the channel, looks up the adapter, calls `safe_send` (never raises),
    records the result as an OutboundMessage, and returns the serialized row with 201.
    Returns 503 when no adapter is registered for the requested channel.
    """
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before external delivery.
    # outbound_message writes are admin-grade (manual compose+send to external channels).
    try:
        await assert_can(s, user, action="create", entity_key="outbound_message",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    adapter = adapter_registry.get(payload.channel)
    if adapter is None:
        raise HTTPException(503, "channel not available")

    result = await adapter.safe_send(
        to=payload.to,
        subject=payload.subject,
        body=payload.body,
        meta={"source": "manual", "user_id": str(user.id)},
    )

    error_detail: str | None = None
    if result["status"] == "FAILED":
        error_detail = result.get("detail")

    msg = OutboundMessage(
        tenant_id=user.tenant_id,
        channel=payload.channel,
        to_addr=payload.to,
        subject=payload.subject,
        body=payload.body,
        status=result["status"],
        error=error_detail,
    )
    s.add(msg)
    await s.commit()
    await s.refresh(msg)
    return _serialize_outbound(msg)


# ---- A26 delivery preferences (SHARED CONTRACT) — /api/notification-prefs ----
# Keyed on (tenant, user, category); the legacy `channel` column holds the sentinel "*" so these
# rows coexist with legacy per-channel opt-out rows. mode/channels/muted gate EXTERNAL delivery only.

async def _delivery_prefs_for(s: AsyncSession, tenant_id, user_id) -> list[NotificationPref]:
    return (await s.execute(
        select(NotificationPref).where(
            NotificationPref.tenant_id == tenant_id,
            NotificationPref.user_id == user_id,
            NotificationPref.channel == PREF_CHANNEL_SENTINEL,
        ).order_by(NotificationPref.category)
    )).scalars().all()


@outbound_router.get("/notification-prefs")
async def get_delivery_prefs(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The caller's own A26 delivery preferences. Absence of a row ⇒ the implicit default
    (realtime + inapp, not muted) — i.e. today's behaviour."""
    rows = await _delivery_prefs_for(s, user.tenant_id, user.id)
    return [_serialize_delivery_pref(p) for p in rows]


@outbound_router.put("/notification-prefs")
async def set_delivery_prefs(body: DeliveryPrefsIn, user: User = Depends(current_user),
                             s: AsyncSession = Depends(get_session)):
    """Upsert the caller's own A26 delivery preferences (one row per category/def_key/"*"). Validates
    `mode`; normalizes `channels` to a list. Returns the full current set."""
    for p in body.preferences:
        if p.mode not in PREF_MODES:
            raise HTTPException(422, f"invalid mode '{p.mode}' (expected one of {sorted(PREF_MODES)})")
        chans = [c for c in (p.channels or []) if isinstance(c, str)] or ["inapp"]
        existing = (await s.execute(
            select(NotificationPref).where(
                NotificationPref.tenant_id == user.tenant_id,
                NotificationPref.user_id == user.id,
                NotificationPref.category == p.category,
                NotificationPref.channel == PREF_CHANNEL_SENTINEL,
            )
        )).scalar_one_or_none()
        if existing:
            existing.mode = p.mode
            existing.channels = chans
            existing.muted = p.muted
            existing.enabled = True            # A26 rows never trip the legacy suppression path
        else:
            s.add(NotificationPref(
                tenant_id=user.tenant_id, user_id=user.id,
                category=p.category, channel=PREF_CHANNEL_SENTINEL, enabled=True,
                mode=p.mode, channels=chans, muted=p.muted,
            ))
    await s.commit()
    rows = await _delivery_prefs_for(s, user.tenant_id, user.id)
    return [_serialize_delivery_pref(p) for p in rows]
