"""Governance audit log — read-only admin view over the immutable Event log.

Distinct from `/api/activity`:
  - `/api/activity` is per-record / per-user-visible: anyone with `view` on a record sees its
    timeline; the global feed is org-scope filtered exactly like the records engine.
  - `/api/audit-log` is admin-scoped governance evidence: gated on the `audit.view` permission
    (SuperAdmin-tier), it returns ALL events across the tenant — every entity, every actor —
    so a SuperAdmin can investigate "who did what when". Tenant-isolated, but NOT org-scope
    filtered (that would defeat the purpose of an audit trail).

Powers the Studio Governance / VersionHistory panes. Read-only; Event write side is untouched.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Event, User
from ..access import load_grants, can
from ..pagination import X_TOTAL_COUNT
from .auth import current_user

router = APIRouter(prefix="/api/audit-log", tags=["audit-log"])

DEFAULT_LIMIT = 50
MAX_LIMIT = 500


def _parse_ts(raw: str | None, field: str) -> datetime | None:
    """Parse an ISO-8601 timestamp; raise 422 with a clear message on a malformed value."""
    if raw is None or raw == "":
        return None
    try:
        # `fromisoformat` handles both naive and offset-aware strings (incl. "...+00:00").
        # Accept a trailing "Z" too — it's the common shorthand for UTC.
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Invalid ISO-8601 timestamp for {field!r}: {raw!r}")


def _split_csv(raw: str | None) -> list[str]:
    """`'a,b , c'` → `['a', 'b', 'c']`. Empty / None → `[]`."""
    if not raw:
        return []
    return [v.strip() for v in raw.split(",") if v.strip()]


def _item(ev: Event, names: dict[str, str | None]) -> dict[str, Any]:
    aid = str(ev.actor_user_id) if ev.actor_user_id else None
    return {
        "id": str(ev.id),
        "type": ev.type,
        "entity_key": ev.entity_key,
        "record_id": str(ev.record_id) if ev.record_id else None,
        "actor_user_id": aid,
        "actor_name": names.get(aid) if aid else None,
        "data": ev.data,
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
    }


@router.get("")
async def list_audit_log(
    response: Response,
    entity: str | None = None,
    actor: str | None = None,
    event_type: str | None = None,
    since: str | None = None,
    until: str | None = None,
    limit: int = DEFAULT_LIMIT,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """List audit events for the caller's tenant, sorted newest-first.

    Query params (all optional):
      - entity:     filter Event.entity_key (exact match, single value)
      - actor:      filter Event.actor_user_id (exact UUID match)
      - event_type: filter Event.type — single value or comma-separated list
      - since:      ISO-8601 lower bound (inclusive) on Event.created_at
      - until:      ISO-8601 upper bound (exclusive) on Event.created_at
      - limit:      page size (default 50, hard cap 500)
      - offset:     rows to skip (default 0)

    Returns `{items: [...], total: <int>}` and also sets `X-Total-Count` for
    pagination compatibility with the records list views. Each item carries
    `actor_name` (left-joined from `User`, so a deleted actor still returns a
    row with `actor_name: null` — never errors).

    Gated on `audit.view` (SuperAdmin-tier).
    """
    # ---- permission gate ----
    grants = await load_grants(s, user)
    if not can(grants, "audit", "view"):
        raise HTTPException(403, "Not allowed: audit.view")

    # ---- bound paging ----
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    offset = max(0, int(offset or 0))

    # ---- build filter ----
    since_dt = _parse_ts(since, "since")
    until_dt = _parse_ts(until, "until")
    types = _split_csv(event_type)

    base = select(Event).where(Event.tenant_id == user.tenant_id)
    if entity:
        base = base.where(Event.entity_key == entity)
    if actor:
        # invalid UUID just returns zero rows rather than 500 (asyncpg would otherwise raise) —
        # we let SQLAlchemy coerce; on cast failure short-circuit to empty.
        try:
            import uuid as _uuid
            actor_uuid = _uuid.UUID(actor)
        except (ValueError, AttributeError):
            response.headers[X_TOTAL_COUNT] = "0"
            return {"items": [], "total": 0}
        base = base.where(Event.actor_user_id == actor_uuid)
    if types:
        base = base.where(Event.type.in_(types))
    if since_dt is not None:
        base = base.where(Event.created_at >= since_dt)
    if until_dt is not None:
        base = base.where(Event.created_at < until_dt)

    # ---- total (pre-pagination) ----
    total = (await s.execute(
        select(func.count()).select_from(base.order_by(None).subquery())
    )).scalar_one()

    # ---- page ----
    rows = (await s.execute(
        base.order_by(Event.created_at.desc()).offset(offset).limit(limit)
    )).scalars().all()

    # ---- left-join actor names (never error if the user is deleted) ----
    actor_ids = {ev.actor_user_id for ev in rows if ev.actor_user_id}
    names: dict[str, str | None] = {}
    if actor_ids:
        name_rows = (await s.execute(
            select(User.id, User.name).where(
                User.tenant_id == user.tenant_id, User.id.in_(actor_ids)
            )
        )).all()
        names = {str(uid): n for uid, n in name_rows}

    response.headers[X_TOTAL_COUNT] = str(total)
    return {"items": [_item(ev, names) for ev in rows], "total": total}
