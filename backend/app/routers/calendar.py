"""Calendar API (Batch 30).

Per-tenant calendars and calendar events. Tenant-scoped, RLS-enforced.
Every write emits an audit Event through workflow.emit.

NOTE: fixed paths under /api/calendar — register BEFORE the generic /api/{slug} records
router so they aren't swallowed as entity slugs.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..kernel import assert_can, AccessDenied
from ..models import User
from ..models.calendar import UserCalendar, CalendarEvent
from .. import workflow
from .auth import current_user

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


# ---- serializers ----

def _iso(dt):
    return dt.isoformat() if dt else None


def _cal(c: UserCalendar) -> dict:
    return {"id": str(c.id), "name": c.name, "color": c.color, "is_shared": c.is_shared,
            "created_by_id": str(c.created_by_id) if c.created_by_id else None,
            "created_at": _iso(c.created_at)}


def _event(e: CalendarEvent) -> dict:
    return {"id": str(e.id), "title": e.title,
            "start_at": _iso(e.start_at), "end_at": _iso(e.end_at),
            "all_day": e.all_day, "description": e.description,
            "location": e.location, "color": e.color,
            "calendar_id": str(e.calendar_id) if e.calendar_id else None,
            "created_by_id": str(e.created_by_id) if e.created_by_id else None,
            "created_at": _iso(e.created_at)}


# ---- helpers ----

def _parse_dt(value, field: str):
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"'{field}' must be an ISO datetime")


async def _get_event(s: AsyncSession, tenant_id, event_id) -> CalendarEvent:
    e = (await s.execute(
        select(CalendarEvent).where(
            CalendarEvent.id == event_id,
            CalendarEvent.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Calendar event not found")
    return e


# ---- calendar endpoints ----

@router.get("/calendars")
async def list_calendars(
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return all calendars for this tenant (RLS enforces isolation)."""
    rows = (await s.execute(
        select(UserCalendar).where(UserCalendar.tenant_id == user.tenant_id)
    )).scalars().all()
    return [_cal(c) for c in rows]


@router.post("/calendars", status_code=201)
async def create_calendar(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a new calendar."""
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="calendar",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    color = (payload.get("color") or "").strip() or "#3A6FB5"
    is_shared = bool(payload.get("is_shared", False))

    c = UserCalendar(
        tenant_id=user.tenant_id,
        owner_node_id=user.primary_node_id,
        created_by_id=user.id,
        name=name,
        color=color,
        is_shared=is_shared,
    )
    s.add(c)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "calendar", c.id, user.id,
                        {"name": name, "is_shared": is_shared})
    await s.commit()
    await s.refresh(c)
    return _cal(c)


# ---- event endpoints ----

@router.get("/events")
async def list_events(
    calendar: uuid.UUID | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List calendar events, optionally filtered by calendar, start, and end dates."""
    q = select(CalendarEvent).where(CalendarEvent.tenant_id == user.tenant_id)
    if calendar is not None:
        q = q.where(CalendarEvent.calendar_id == calendar)
    if start:
        start_dt = _parse_dt(start, "start")
        if start_dt:
            q = q.where(CalendarEvent.start_at >= start_dt)
    if end:
        end_dt = _parse_dt(end, "end")
        if end_dt:
            q = q.where(CalendarEvent.start_at <= end_dt)
    q = q.order_by(CalendarEvent.start_at.asc()).limit(limit)
    rows = (await s.execute(q)).scalars().all()
    return [_event(e) for e in rows]


@router.post("/events", status_code=201)
async def create_event(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create a calendar event."""
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="create", entity_key="calendar_event",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))

    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(422, "title is required")

    start_at = _parse_dt(payload.get("start_at"), "start_at")
    if not start_at:
        raise HTTPException(422, "start_at is required and must be an ISO datetime")

    end_at = _parse_dt(payload.get("end_at"), "end_at")
    if end_at is not None and end_at < start_at:
        raise HTTPException(422, "end_at must be >= start_at")

    calendar_id = payload.get("calendar_id")

    e = CalendarEvent(
        tenant_id=user.tenant_id,
        owner_node_id=user.primary_node_id,
        created_by_id=user.id,
        calendar_id=calendar_id,
        title=title,
        start_at=start_at,
        end_at=end_at,
        all_day=bool(payload.get("all_day", False)),
        description=payload.get("description") or None,
        location=payload.get("location") or None,
        color=payload.get("color") or None,
    )
    s.add(e)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "calendar_event", e.id, user.id,
                        {"title": title, "start_at": _iso(start_at),
                         "calendar_id": str(calendar_id) if calendar_id else None})
    await s.commit()
    await s.refresh(e)
    return _event(e)


@router.get("/events/{event_id}")
async def get_event(
    event_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Get a single calendar event."""
    e = await _get_event(s, user.tenant_id, event_id)
    return _event(e)


@router.patch("/events/{event_id}")
async def update_event(
    event_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Partial update a calendar event."""
    e = await _get_event(s, user.tenant_id, event_id)
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="edit", entity_key="calendar_event",
                         region_id=None, owner_user_id=e.created_by_id)
    except AccessDenied as ex:
        raise HTTPException(403, detail=str(ex))
    changed: dict = {}

    if "title" in payload:
        v = (payload["title"] or "").strip()
        if not v:
            raise HTTPException(422, "title cannot be empty")
        e.title = v
        changed["title"] = v

    if "start_at" in payload:
        v = _parse_dt(payload["start_at"], "start_at")
        if not v:
            raise HTTPException(422, "start_at must be a valid ISO datetime")
        e.start_at = v
        changed["start_at"] = _iso(v)

    if "end_at" in payload:
        v = _parse_dt(payload["end_at"], "end_at")
        # validate end_at >= start_at using updated start
        if v is not None and v < e.start_at:
            raise HTTPException(422, "end_at must be >= start_at")
        e.end_at = v
        changed["end_at"] = _iso(v)

    if "all_day" in payload:
        e.all_day = bool(payload["all_day"])
        changed["all_day"] = e.all_day

    if "description" in payload:
        e.description = payload["description"] or None
        changed["description"] = e.description

    if "location" in payload:
        e.location = payload["location"] or None
        changed["location"] = e.location

    if "color" in payload:
        e.color = payload["color"] or None
        changed["color"] = e.color

    if "calendar_id" in payload:
        e.calendar_id = payload["calendar_id"]
        changed["calendar_id"] = str(e.calendar_id) if e.calendar_id else None

    await workflow.emit(s, user.tenant_id, "update", "calendar_event", e.id, user.id,
                        {"changed": changed})
    await s.commit()
    await s.refresh(e)
    return _event(e)


@router.delete("/events/{event_id}")
async def delete_event(
    event_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Delete a calendar event."""
    e = await _get_event(s, user.tenant_id, event_id)
    # SPEC §0.2 default-deny (Step 7.2) — kernel gate before mutation.
    try:
        await assert_can(s, user, action="delete", entity_key="calendar_event",
                         region_id=None, owner_user_id=e.created_by_id)
    except AccessDenied as ex:
        raise HTTPException(403, detail=str(ex))
    await workflow.emit(s, user.tenant_id, "delete", "calendar_event", e.id, user.id,
                        {"title": e.title, "calendar_id": str(e.calendar_id) if e.calendar_id else None})
    await s.delete(e)
    await s.commit()
    return {"ok": True}
