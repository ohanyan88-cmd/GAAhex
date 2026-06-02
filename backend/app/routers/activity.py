"""Activity feed / timeline (D29 + D37).

A read-only view over the existing immutable `Event` log — no new tables. Two modes on
`GET /api/activity`:

- **Record timeline** (`entity` + `record`): one record's events, chronological, as rich timeline
  items. 403 if the caller can't view the record.
- **Global recent feed** (no `record`): the newest events across entities the caller can view,
  org-scope filtered exactly like the records engine (grants + node paths; per-event
  `can(grants, entity_key, "view", record_path)` via the event's record's owner node).

Tenant-scoped throughout; never leaks past access control.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Event, Record, User
from ..access import load_grants, can
from .auth import current_user
from .records import _entity, _node_path, _node_paths   # reuse the engine's scope helpers for parity

router = APIRouter(prefix="/api/activity", tags=["activity"])

DEFAULT_LIMIT = 30
MAX_SCAN = 500          # bound the pre-scope scan for the global feed


def _summary(ev: Event) -> str:
    """A human one-liner for an event (the actor name is carried separately; UI renders
    '{actor_name} {summary}')."""
    d = ev.data or {}
    t = ev.type
    ek = ev.entity_key or "record"
    if t == "CREATE":
        return f"created this {ek}"
    if t == "UPDATE":
        changed = d.get("changed")
        if isinstance(changed, dict) and changed:
            return f"updated {', '.join(changed.keys())}"
        return "updated this record"
    if t == "TRANSITION":
        frm, to = d.get("from"), d.get("to")
        return f"moved {frm} → {to}" if to else "changed status"
    if t == "DELETE":
        return f"deleted this {ek}"
    if t == "COMMENT":
        return "commented"
    if t == "APPROVAL_REQUESTED":
        return f"requested approval to move to {d.get('to')}" if d.get("to") else "requested approval"
    if t == "APPROVAL_APPROVED":
        return f"approved moving to {d.get('to')}" if d.get("to") else "approved the change"
    if t == "APPROVAL_REJECTED":
        return f"rejected moving to {d.get('to')}" if d.get("to") else "rejected the change"
    if t == "ACTION_FAILED":
        return f"automated action '{d.get('action')}' failed"
    return t.replace("_", " ")


async def _actor_names(s: AsyncSession, tenant_id, events) -> dict[str, str]:
    ids = {ev.actor_user_id for ev in events if ev.actor_user_id}
    if not ids:
        return {}
    rows = (await s.execute(
        select(User.id, User.name).where(User.tenant_id == tenant_id, User.id.in_(ids))
    )).all()
    return {str(i): n for i, n in rows}


def _item(ev: Event, names: dict[str, str]) -> dict:
    aid = str(ev.actor_user_id) if ev.actor_user_id else None
    return {
        "id": str(ev.id),
        "type": ev.type,
        "entity_key": ev.entity_key,
        "record_id": str(ev.record_id) if ev.record_id else None,
        "actor_user_id": aid,
        "actor_name": names.get(aid) if aid else None,
        "at": ev.created_at.isoformat() if ev.created_at else None,
        "summary": _summary(ev),
        "data": ev.data,
    }


@router.get("")
async def activity(
    entity: str | None = None,
    record: str | None = None,
    limit: int = DEFAULT_LIMIT,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    if limit <= 0:
        limit = DEFAULT_LIMIT
    grants = await load_grants(s, user)

    # ---- Record timeline -------------------------------------------------------------------
    if record:
        if not entity:
            raise HTTPException(422, "entity is required when record is given")
        ent = await _entity(s, user.tenant_id, entity)
        rec = (await s.execute(
            select(Record).where(
                Record.id == record, Record.tenant_id == user.tenant_id, Record.entity_key == ent.key
            )
        )).scalar_one_or_none()
        if not rec:
            raise HTTPException(404, "Record not found")
        if not can(grants, ent.key, "view", await _node_path(s, rec.owner_node_id)):
            raise HTTPException(403, f"Not allowed: {ent.key}.view")

        events = (await s.execute(
            select(Event).where(Event.tenant_id == user.tenant_id, Event.record_id == rec.id)
            .order_by(Event.created_at)            # chronological (oldest → newest), like /history
        )).scalars().all()
        names = await _actor_names(s, user.tenant_id, events)
        return [_item(ev, names) for ev in events]

    # ---- Global recent feed ----------------------------------------------------------------
    # Fetch recent events first, then filter by scope (note: a denormalized owner_node_id on Event
    # would let this be an exact, indexed query — see report).
    scan = min(max(limit * 5, limit), MAX_SCAN)
    recent = (await s.execute(
        select(Event).where(Event.tenant_id == user.tenant_id)
        .order_by(Event.created_at.desc()).limit(scan)
    )).scalars().all()

    paths = await _node_paths(s, user.tenant_id)
    rec_ids = {ev.record_id for ev in recent if ev.record_id}
    owners: dict[str, object] = {}
    if rec_ids:
        rows = (await s.execute(
            select(Record.id, Record.owner_node_id).where(
                Record.tenant_id == user.tenant_id, Record.id.in_(rec_ids)
            )
        )).all()
        owners = {str(i): onode for i, onode in rows}

    feed = []
    for ev in recent:
        if len(feed) >= limit:
            break
        if not ev.entity_key or not ev.record_id:
            continue
        rid = str(ev.record_id)
        if rid not in owners:
            # record no longer exists (e.g. a delete) → its owner node can't be verified → skip,
            # rather than risk leaking out-of-scope activity (fail closed).
            continue
        record_path = paths.get(str(owners[rid])) if owners[rid] else None
        if not can(grants, ev.entity_key, "view", record_path):
            continue
        feed.append(ev)

    names = await _actor_names(s, user.tenant_id, feed)
    return [_item(ev, names) for ev in feed]
