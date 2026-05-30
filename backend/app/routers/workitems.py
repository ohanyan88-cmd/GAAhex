"""WorkItems API (Batch 32): field-dispatch work assignment tracker.

Tenant + org scoped exactly like the helpdesk/calendar routers.  Every mutation emits an audit
Event through workflow.emit; status transitions guard against illegal moves with 409.

NOTE on namespacing: fixed paths under /api/workitems, so this router MUST be registered BEFORE
records.router in main.py.  See the coordinator paste-lines at the bottom of the Lane A report.
"""
import uuid
from datetime import date, datetime, time, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.workitem import WorkItem
from ..access import load_grants, can
from .. import workflow, notify_hooks
from .auth import current_user
from .records import _node_paths, _paginate

router = APIRouter(prefix="/api/workitems", tags=["workitems"])

# Valid status and priority sets
_STATUSES = {"TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"}
_PRIORITIES = {"LOW", "NORMAL", "HIGH", "URGENT"}
_KINDS = {"task", "install", "repair", "survey"}

# Statuses from which reopen is permitted
_REOPEN_FROM = {"DONE", "CANCELLED", "BLOCKED"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _parse_dt(value, field: str):
    """Parse an ISO datetime string (None/empty → None, bad format → 422)."""
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"'{field}' must be a valid ISO datetime")


def _workitem(w: WorkItem) -> dict:
    return {
        "id": str(w.id),
        "tenant_id": str(w.tenant_id),
        "owner_node_id": str(w.owner_node_id) if w.owner_node_id else None,
        "title": w.title,
        "description": w.description,
        "kind": w.kind,
        "status": w.status,
        "priority": w.priority,
        "assigned_user_id": str(w.assigned_user_id) if w.assigned_user_id else None,
        "customer_id": str(w.customer_id) if w.customer_id else None,
        "due_at": _iso(w.due_at),
        "scheduled_at": _iso(w.scheduled_at),
        "location": w.location,
        "completed_at": _iso(w.completed_at),
        "created_at": _iso(w.created_at),
    }


async def _get_workitem(s: AsyncSession, user: User, workitem_id) -> WorkItem:
    w = (await s.execute(
        select(WorkItem).where(WorkItem.id == workitem_id, WorkItem.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "WorkItem not found")
    return w


# ---------------------------------------------------------------------------
# List
# ---------------------------------------------------------------------------

@router.get("")
async def list_workitems(
    status: str | None = None,
    assignee: uuid.UUID | None = None,
    mine: bool = False,
    kind: str | None = None,
    scheduled_from: str | None = None,
    scheduled_to: str | None = None,
    since: Optional[date] = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "workitem", "view"):
        _deny("workitem.view")
    paths = await _node_paths(s, user.tenant_id)

    q = select(WorkItem).where(WorkItem.tenant_id == user.tenant_id)
    if status:
        q = q.where(WorkItem.status == status)
    if assignee is not None:
        q = q.where(WorkItem.assigned_user_id == assignee)
    if mine:
        q = q.where(WorkItem.assigned_user_id == user.id)
    if kind:
        q = q.where(WorkItem.kind == kind)

    # Dispatch board date-range filters on scheduled_at
    sf = _parse_dt(scheduled_from, "scheduled_from")
    if sf is not None:
        q = q.where(WorkItem.scheduled_at >= sf)
    st = _parse_dt(scheduled_to, "scheduled_to")
    if st is not None:
        q = q.where(WorkItem.scheduled_at <= st)

    if since is not None:
        since_dt = datetime.combine(since, time.min, tzinfo=timezone.utc)
        q = q.where(WorkItem.created_at >= since_dt)

    q = q.order_by(WorkItem.created_at.desc())
    rows = (await s.execute(q)).scalars().all()
    visible = [
        w for w in rows
        if can(grants, "workitem", "view", paths.get(str(w.owner_node_id)) if w.owner_node_id else None)
    ]
    return [_workitem(w) for w in _paginate(visible, limit, offset)]


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_workitem(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "workitem", "create"):
        _deny("workitem.create")

    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(422, "title is required")

    kind = (payload.get("kind") or "task").lower()
    if kind not in _KINDS:
        raise HTTPException(422, f"kind must be one of {sorted(_KINDS)}")

    priority = (payload.get("priority") or "NORMAL").upper()
    if priority not in _PRIORITIES:
        raise HTTPException(422, f"priority must be one of {sorted(_PRIORITIES)}")

    w = WorkItem(
        tenant_id=user.tenant_id,
        owner_node_id=user.primary_node_id,
        title=title,
        description=payload.get("description"),
        kind=kind,
        status="TODO",
        priority=priority,
        assigned_user_id=payload.get("assigned_user_id"),
        customer_id=payload.get("customer_id"),
        due_at=_parse_dt(payload.get("due_at"), "due_at"),
        scheduled_at=_parse_dt(payload.get("scheduled_at"), "scheduled_at"),
        location=payload.get("location"),
    )
    s.add(w)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "workitem", w.id, user.id,
                        {"title": title, "kind": kind, "priority": priority})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


# ---------------------------------------------------------------------------
# Get / Patch
# ---------------------------------------------------------------------------

@router.get("/{workitem_id}")
async def get_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "view",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.view")
    return _workitem(w)


@router.patch("/{workitem_id}")
async def update_workitem(
    workitem_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")

    changed: dict = {}
    if "title" in payload:
        v = (payload["title"] or "").strip()
        if not v:
            raise HTTPException(422, "title cannot be empty")
        w.title = v
        changed["title"] = v
    if "description" in payload:
        w.description = payload["description"]
        changed["description"] = True
    if "kind" in payload:
        v = (payload["kind"] or "task").lower()
        if v not in _KINDS:
            raise HTTPException(422, f"kind must be one of {sorted(_KINDS)}")
        w.kind = v
        changed["kind"] = v
    if "priority" in payload:
        v = (payload["priority"] or "NORMAL").upper()
        if v not in _PRIORITIES:
            raise HTTPException(422, f"priority must be one of {sorted(_PRIORITIES)}")
        w.priority = v
        changed["priority"] = v
    if "customer_id" in payload:
        w.customer_id = payload["customer_id"]
        changed["customer_id"] = str(w.customer_id) if w.customer_id else None
    if "due_at" in payload:
        w.due_at = _parse_dt(payload["due_at"], "due_at")
        changed["due_at"] = _iso(w.due_at)
    if "scheduled_at" in payload:
        w.scheduled_at = _parse_dt(payload["scheduled_at"], "scheduled_at")
        changed["scheduled_at"] = _iso(w.scheduled_at)
    if "location" in payload:
        w.location = payload["location"]
        changed["location"] = w.location

    await workflow.emit(s, user.tenant_id, "update", "workitem", w.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


# ---------------------------------------------------------------------------
# Assign
# ---------------------------------------------------------------------------

@router.post("/{workitem_id}/assign")
async def assign_workitem(
    workitem_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")

    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(422, "user_id is required")

    w.assigned_user_id = user_id
    await workflow.emit(s, user.tenant_id, "assign", "workitem", w.id, user.id,
                        {"assigned_user_id": str(user_id)})
    await s.flush()

    # best-effort notification to the assignee
    try:
        await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="workitem_assign",
                                entity_key="workitem", record=w, actor_user_id=user.id,
                                extra={"workitem_id": str(w.id), "user_id": str(user_id)})
    except Exception:
        pass  # fail-soft: notification failure must not break the assignment

    await s.commit()
    await s.refresh(w)
    return _workitem(w)


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------

@router.post("/{workitem_id}/start")
async def start_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")
    if w.status == "IN_PROGRESS":
        raise HTTPException(409, "WorkItem is already IN_PROGRESS")
    if w.status in {"DONE", "CANCELLED"}:
        raise HTTPException(409, f"Cannot start a {w.status} WorkItem")

    old_status = w.status
    w.status = "IN_PROGRESS"
    await workflow.emit(s, user.tenant_id, "transition", "workitem", w.id, user.id,
                        {"from": old_status, "to": "IN_PROGRESS"})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


@router.post("/{workitem_id}/complete")
async def complete_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")
    if w.status == "DONE":
        raise HTTPException(409, "WorkItem is already DONE")
    if w.status == "CANCELLED":
        raise HTTPException(409, "Cannot complete a CANCELLED WorkItem")

    old_status = w.status
    w.status = "DONE"
    w.completed_at = _now()
    await workflow.emit(s, user.tenant_id, "transition", "workitem", w.id, user.id,
                        {"from": old_status, "to": "DONE", "completed_at": _iso(w.completed_at)})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


@router.post("/{workitem_id}/block")
async def block_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")
    if w.status == "BLOCKED":
        raise HTTPException(409, "WorkItem is already BLOCKED")
    if w.status in {"DONE", "CANCELLED"}:
        raise HTTPException(409, f"Cannot block a {w.status} WorkItem")

    old_status = w.status
    w.status = "BLOCKED"
    await workflow.emit(s, user.tenant_id, "transition", "workitem", w.id, user.id,
                        {"from": old_status, "to": "BLOCKED"})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


@router.post("/{workitem_id}/cancel")
async def cancel_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")
    if w.status == "CANCELLED":
        raise HTTPException(409, "WorkItem is already CANCELLED")
    if w.status == "DONE":
        raise HTTPException(409, "Cannot cancel a DONE WorkItem")

    old_status = w.status
    w.status = "CANCELLED"
    await workflow.emit(s, user.tenant_id, "transition", "workitem", w.id, user.id,
                        {"from": old_status, "to": "CANCELLED"})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


@router.post("/{workitem_id}/reopen")
async def reopen_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "edit",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.edit")
    if w.status not in _REOPEN_FROM:
        raise HTTPException(409, f"Cannot reopen a WorkItem with status {w.status} (only from: {sorted(_REOPEN_FROM)})")

    old_status = w.status
    w.status = "TODO"
    w.completed_at = None
    await workflow.emit(s, user.tenant_id, "transition", "workitem", w.id, user.id,
                        {"from": old_status, "to": "TODO"})
    await s.commit()
    await s.refresh(w)
    return _workitem(w)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

@router.delete("/{workitem_id}", status_code=204)
async def delete_workitem(
    workitem_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    w = await _get_workitem(s, user, workitem_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "workitem", "delete",
               paths.get(str(w.owner_node_id)) if w.owner_node_id else None):
        _deny("workitem.delete")
    await workflow.emit(s, user.tenant_id, "delete", "workitem", w.id, user.id,
                        {"title": w.title, "status": w.status})
    await s.delete(w)
    await s.commit()
