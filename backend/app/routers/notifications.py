import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.notification import NotificationDef, Notification
from .. import gxl
from .auth import current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


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
    """Create one inbox notification from its NotificationDef. Config-gated and condition-gated.

    No-op (returns None) when the def is missing, disabled, or its GXL condition is falsy.
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

    note = Notification(
        tenant_id=tenant_id,
        def_key=ndef.key,
        user_id=user_id,
        title=_render(ndef.title_template, ctx),
        body=_render(ndef.body_template, ctx),
        entity_key=entity_key,
        record_id=record_id,
    )
    s.add(note)
    await s.flush()
    return note


# ---- serialization ----

def _serialize(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "def_key": n.def_key,
        "title": n.title,
        "body": n.body,
        "entity_key": n.entity_key,
        "record_id": str(n.record_id) if n.record_id else None,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


# ---- endpoints (each strictly scoped to the current user's own rows) ----

@router.get("")
async def inbox(unread: bool = False, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """The current user's inbox, newest first. `?unread=true` returns only unread."""
    q = select(Notification).where(
        Notification.tenant_id == user.tenant_id, Notification.user_id == user.id
    )
    if unread:
        q = q.where(Notification.read_at.is_(None))
    q = q.order_by(Notification.created_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_serialize(n) for n in rows]


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
