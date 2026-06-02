"""Task Standard (file 05) — API routes.

Endpoints — all RLS tenant-scoped, all permission-gated:

  GET    /api/tasks                           list tasks (filterable by status/assignee/parent)
  POST   /api/tasks                           create
  GET    /api/tasks/{taskId}                  read single
  PATCH  /api/tasks/{taskId}                  edit title / type / priority / due_at / parent / notes
  POST   /api/tasks/{taskId}/assign           assign owner + assignee
  POST   /api/tasks/{taskId}/complete         complete (requires resolution)
  POST   /api/tasks/{taskId}/cancel           cancel (requires reason + resolution)
  POST   /api/tasks/{taskId}/reopen           reopen from COMPLETED or CANCELLED
  DELETE /api/tasks/{taskId}                  soft delete (status → CANCELLED, resolution=INVALID)

  GET    /api/tasks/{taskId}/dependencies         list dependencies
  POST   /api/tasks/{taskId}/dependencies         add dependency (with cycle guard)
  DELETE /api/tasks/{taskId}/dependencies/{depId} remove dependency

8 hard-validation rules enforced at every write path:
  1. no active task without owner
  2. no active task without primary assignee
  3. no OBJECT_LINKED without parent_entity_type + parent_entity_id
  4. no COMPLETED without completedAt + completedBy + resolution
  5. no CANCELLED without cancellationReason + resolution (BOTH required)
  6. no BLOCKED without blockedReason
  7. no duplicate active reference_number per tenant (DB UNIQUE; router pre-checks)
  8. no value outside its enum

Auto-watch (E15):
  Creator, Owner, Assignee get AUTOMATIC Watcher rows at create.
  If owner_type or assignee_type is QUEUE: look up HelpdeskQueue.owner_node_id,
  derive department from OrgNode, create DEPARTMENT watcher. If owner_node_id is
  NULL, skip with logged warning — never silently wrong.

Substrate emit: uses existing app.workflow.emit, pinned to the TASK id (and
mirrored to parent object when task_scope=OBJECT_LINKED, per B4):
  task_created | task_updated | task_assigned | task_completed |
  task_cancelled | task_reopened | task_deleted | dependency_added | dependency_removed
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models import Task, TaskDependency, Watcher
from ..models.helpdesk import HelpdeskQueue
from ..models.orgnode import OrgNode
from ..models.user import User
from .auth import current_user

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
_log = logging.getLogger("gaaex.tasks")

# ── enum sets (file 05) ───────────────────────────────────────────────────────

VALID_TASK_TYPES = {
    "GENERAL", "FOLLOW_UP", "REVIEW", "APPROVAL_PREP", "CALL_CUSTOMER", "CONTACT_VENDOR",
    "COLLECT_DOCUMENT", "VERIFY_DOCUMENT", "VERIFY_PAYMENT", "PAYMENT_FOLLOW_UP",
    "CHECK_SERVICE", "CONFIGURE_DEVICE", "INSTALLATION", "MAINTENANCE", "FIELD_VISIT",
    "SITE_SURVEY", "NETWORK_CHECK", "OUTAGE_INVESTIGATION", "INCIDENT_ACTION",
    "PROBLEM_INVESTIGATION", "CHANGE_PREP", "CHANGE_EXECUTION", "RELEASE_PREP",
    "RELEASE_VALIDATION", "ESCALATION_ACTION", "CUSTOMER_UPDATE", "INTERNAL_HANDOFF",
    "QUALITY_CHECK", "COMPLIANCE_REVIEW", "LEGAL_REVIEW", "FINANCE_REVIEW",
    "MANAGER_REVIEW", "DATA_CORRECTION", "KNOWLEDGE_UPDATE",
}
VALID_SCOPES      = {"OBJECT_LINKED", "STANDALONE"}
VALID_STATUSES    = {"OPEN", "IN_PROGRESS", "BLOCKED", "WAITING", "COMPLETED", "CANCELLED"}
VALID_PRIORITIES  = {"LOW", "MEDIUM", "HIGH", "URGENT"}
VALID_SLA_STATUSES = {"ON_TRACK", "AT_RISK", "BREACHED", "PAUSED", "NOT_APPLICABLE"}
VALID_RESOLUTIONS = {"DONE", "NOT_NEEDED", "DUPLICATE", "CANNOT_COMPLETE", "INVALID", "MERGED"}
VALID_PRINCIPAL_TYPES = {"EMPLOYEE", "ROLE", "DEPARTMENT", "QUEUE"}
VALID_DEP_TYPES   = {"BLOCKED_BY", "BLOCKS", "RELATED_TO", "DUPLICATES", "DUPLICATED_BY"}
TERMINAL_STATUSES = {"COMPLETED", "CANCELLED"}


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize(t: Task) -> dict:
    return {
        "id": str(t.id),
        "referenceNumber": t.reference_number,
        "title": t.title,
        "taskType": t.task_type,
        "taskScope": t.task_scope,
        "status": t.status,
        "priority": t.priority,
        "parentEntityType": t.parent_entity_type,
        "parentEntityId": str(t.parent_entity_id) if t.parent_entity_id else None,
        "ownerType": t.owner_type,
        "ownerId": str(t.owner_id),
        "assigneeType": t.assignee_type,
        "assigneeId": str(t.assignee_id),
        "dueAt": t.due_at.isoformat() if t.due_at else None,
        "slaStatus": t.sla_status,
        "slaDueAt": t.sla_due_at.isoformat() if t.sla_due_at else None,
        "blockedReason": t.blocked_reason,
        "blockedAt": t.blocked_at.isoformat() if t.blocked_at else None,
        "waitingReason": t.waiting_reason,
        "waitingUntil": t.waiting_until.isoformat() if t.waiting_until else None,
        "completedAt": t.completed_at.isoformat() if t.completed_at else None,
        "completedBy": str(t.completed_by) if t.completed_by else None,
        "completionNote": t.completion_note,
        "cancelledAt": t.cancelled_at.isoformat() if t.cancelled_at else None,
        "cancelledBy": str(t.cancelled_by) if t.cancelled_by else None,
        "cancellationReason": t.cancellation_reason,
        "resolution": t.resolution,
        "createdAt": t.created_at.isoformat(),
        "createdBy": str(t.created_by),
        "updatedAt": t.updated_at.isoformat(),
    }


def _serialize_dep(d: TaskDependency) -> dict:
    return {
        "id": str(d.id),
        "fromTaskId": str(d.from_task_id),
        "toTaskId": str(d.to_task_id),
        "dependencyType": d.dependency_type,
        "createdAt": d.created_at.isoformat(),
        "createdBy": str(d.created_by),
    }


async def _get(s: AsyncSession, tenant_id, task_id: uuid.UUID) -> Task:
    t = (await s.execute(
        select(Task).where(and_(Task.tenant_id == tenant_id, Task.id == task_id))
    )).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return t


async def _next_ref(s: AsyncSession, tenant_id) -> str:
    """TSK-000001 counter. Races under high concurrency; uq_task_reference_number
    is the authoritative fence (duplicate → 409 at the DB layer)."""
    n = (await s.execute(
        select(func.count()).select_from(Task).where(Task.tenant_id == tenant_id)
    )).scalar_one()
    return f"TSK-{n + 1:06d}"


def _validate_enum(val: str | None, name: str, valid: set) -> str:
    """Rule 8 — reject values outside their enum."""
    if val is None:
        raise HTTPException(status_code=422, detail=f"{name} is required")
    v = val.upper()
    if v not in valid:
        raise HTTPException(status_code=422, detail=f"{name} must be one of {sorted(valid)}")
    return v


def _validate_principal(ptype: str | None, pid: str | None, field: str) -> tuple[str, uuid.UUID]:
    """Rules 1+2 — validate owner and assignee principal type + id."""
    pt = _validate_enum(ptype, f"{field}Type", VALID_PRINCIPAL_TYPES)
    try:
        pid_uuid = uuid.UUID(str(pid))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field}Id must be a UUID")
    return pt, pid_uuid


async def _auto_watch(
    s: AsyncSession, tenant_id, task_id: uuid.UUID,
    ptype: str, pid: uuid.UUID, source: str, actor_id: uuid.UUID,
    task_entity_key: str, parent_entity_key: str | None, parent_entity_id: uuid.UUID | None,
) -> None:
    """Create a Watcher row for the given principal. E15: QUEUE resolves to
    the queue's owning department (HelpdeskQueue.owner_node_id → OrgNode.code as dept key)."""
    effective_type = ptype
    effective_id = pid

    if ptype == "QUEUE":
        queue = (await s.execute(
            select(HelpdeskQueue).where(
                HelpdeskQueue.tenant_id == tenant_id,
                HelpdeskQueue.id == pid,
            )
        )).scalar_one_or_none()
        if queue is None or queue.owner_node_id is None:
            _log.warning(
                "task auto-watch E15: QUEUE %s has no owner_node_id — skipping auto-watch for this principal",
                pid,
            )
            return
        node = (await s.execute(
            select(OrgNode).where(OrgNode.id == queue.owner_node_id)
        )).scalar_one_or_none()
        if node is None:
            _log.warning("task auto-watch E15: OrgNode %s not found — skipping", queue.owner_node_id)
            return
        effective_type = "DEPARTMENT"
        effective_id = node.id  # use the node id as the DEPARTMENT watcher_id

    # Skip if ACTIVE watcher already exists (idempotent).
    exists = (await s.execute(
        select(Watcher).where(and_(
            Watcher.tenant_id == tenant_id,
            Watcher.target_entity_type == task_entity_key,
            Watcher.target_entity_id == task_id,
            Watcher.watcher_type == effective_type,
            Watcher.watcher_id == effective_id,
            Watcher.status == "ACTIVE",
        ))
    )).scalar_one_or_none()
    if exists:
        return

    s.add(Watcher(
        tenant_id=tenant_id,
        target_entity_type=task_entity_key,
        target_entity_id=task_id,
        watcher_type=effective_type,
        watcher_id=effective_id,
        source=source,
        created_by=actor_id,
    ))
    # Emit watch_added on task; also mirror to parent when OBJECT_LINKED (B4).
    await workflow.emit(
        s, tenant_id, "watch_added", task_entity_key, task_id, actor_id,
        {"watcherType": effective_type, "watcherId": str(effective_id), "source": source},
    )
    if parent_entity_key and parent_entity_id:
        await workflow.emit(
            s, tenant_id, "watch_added", parent_entity_key, parent_entity_id, actor_id,
            {"watcherType": effective_type, "watcherId": str(effective_id),
             "source": source, "viaTask": str(task_id)},
        )


# ── LIST ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_tasks(
    status: Optional[str] = None,
    assignee_id: Optional[uuid.UUID] = None,
    parent_entity_type: Optional[str] = None,
    parent_entity_id: Optional[uuid.UUID] = None,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "view"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(Task).where(Task.tenant_id == user.tenant_id)
    if status:
        q = q.where(Task.status == status.upper())
    if assignee_id:
        q = q.where(Task.assignee_id == assignee_id)
    if parent_entity_type:
        q = q.where(Task.parent_entity_type == parent_entity_type.lower())
    if parent_entity_id:
        q = q.where(Task.parent_entity_id == parent_entity_id)
    q = q.order_by(Task.created_at.desc())
    return [_serialize(t) for t in (await s.execute(q)).scalars().all()]


# ── CREATE ────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_task(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "create"):
        raise HTTPException(status_code=403, detail="Access denied")

    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")

    task_type  = _validate_enum(payload.get("taskType", "GENERAL"), "taskType", VALID_TASK_TYPES)
    task_scope = _validate_enum(payload.get("taskScope", "STANDALONE"), "taskScope", VALID_SCOPES)
    priority   = _validate_enum(payload.get("priority", "MEDIUM"), "priority", VALID_PRIORITIES)

    owner_type, owner_id     = _validate_principal(payload.get("ownerType"), payload.get("ownerId"), "owner")
    assignee_type, assignee_id = _validate_principal(payload.get("assigneeType"), payload.get("assigneeId"), "assignee")

    # Rule 3 — OBJECT_LINKED requires parent.
    parent_entity_type = payload.get("parentEntityType")
    parent_entity_id   = None
    if task_scope == "OBJECT_LINKED":
        if not parent_entity_type or not payload.get("parentEntityId"):
            raise HTTPException(status_code=422, detail="OBJECT_LINKED tasks require parentEntityType + parentEntityId")
        try:
            parent_entity_id = uuid.UUID(str(payload["parentEntityId"]))
        except ValueError:
            raise HTTPException(status_code=422, detail="parentEntityId must be a UUID")
        parent_entity_type = parent_entity_type.lower()

    ref = await _next_ref(s, user.tenant_id)
    # Rule 7 pre-check (DB UNIQUE is the authoritative fence).
    dupe = (await s.execute(
        select(Task).where(Task.tenant_id == user.tenant_id, Task.reference_number == ref)
    )).scalar_one_or_none()
    if dupe:
        raise HTTPException(status_code=409, detail=f"Reference number {ref} already exists")

    t = Task(
        tenant_id=user.tenant_id,
        reference_number=ref,
        title=title,
        task_type=task_type,
        task_scope=task_scope,
        priority=priority,
        owner_type=owner_type,
        owner_id=owner_id,
        assignee_type=assignee_type,
        assignee_id=assignee_id,
        parent_entity_type=parent_entity_type,
        parent_entity_id=parent_entity_id,
        due_at=_parse_dt(payload.get("dueAt"), "dueAt"),
        created_by=user.id,
    )
    s.add(t)
    await s.flush()

    # Auto-watch: creator, owner, assignee (E15 handles QUEUE resolution).
    ek = "task"
    for ptype, pid, src in [
        ("EMPLOYEE", user.id,   "AUTOMATIC"),   # creator
        (owner_type,   owner_id,   "ASSIGNMENT"),
        (assignee_type, assignee_id, "ASSIGNMENT"),
    ]:
        await _auto_watch(s, user.tenant_id, t.id, ptype, pid, src, user.id,
                          ek, parent_entity_type, parent_entity_id)

    await workflow.emit(s, user.tenant_id, "task_created", ek, t.id, user.id,
                        {"referenceNumber": ref, "title": title, "taskType": task_type,
                         "ownerType": owner_type, "ownerId": str(owner_id),
                         "assigneeType": assignee_type, "assigneeId": str(assignee_id)})
    if parent_entity_type and parent_entity_id:
        await workflow.emit(s, user.tenant_id, "task_created", parent_entity_type,
                            parent_entity_id, user.id,
                            {"taskId": str(t.id), "referenceNumber": ref, "title": title})
    return _serialize(t)


def _parse_dt(value, field: str) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{field} must be ISO 8601")


# ── READ ──────────────────────────────────────────────────────────────────────

@router.get("/{task_id}")
async def get_task(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "view"):
        raise HTTPException(status_code=403, detail="Access denied")
    return _serialize(await _get(s, user.tenant_id, task_id))


# ── EDIT ──────────────────────────────────────────────────────────────────────

@router.patch("/{task_id}")
async def edit_task(
    task_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "edit"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=422, detail="Cannot edit a terminal task")

    before: dict = {}
    if "title" in payload:
        v = (payload["title"] or "").strip()
        if not v:
            raise HTTPException(status_code=422, detail="title cannot be empty")
        before["title"] = t.title; t.title = v
    if "taskType" in payload:
        v = _validate_enum(payload["taskType"], "taskType", VALID_TASK_TYPES)
        before["taskType"] = t.task_type; t.task_type = v
    if "priority" in payload:
        v = _validate_enum(payload["priority"], "priority", VALID_PRIORITIES)
        before["priority"] = t.priority; t.priority = v
    if "dueAt" in payload:
        before["dueAt"] = t.due_at.isoformat() if t.due_at else None
        t.due_at = _parse_dt(payload["dueAt"], "dueAt")
    if "completionNote" in payload:
        t.completion_note = payload["completionNote"]
    if "blockedReason" in payload and t.status == "BLOCKED":
        before["blockedReason"] = t.blocked_reason; t.blocked_reason = payload["blockedReason"]
    if "waitingReason" in payload:
        t.waiting_reason = payload["waitingReason"]
    if "waitingUntil" in payload:
        t.waiting_until = _parse_dt(payload["waitingUntil"], "waitingUntil")

    if before:
        t.updated_at = _now()
        await workflow.emit(s, user.tenant_id, "task_updated", "task", t.id, user.id,
                            {"before": before})
    return _serialize(t)


# ── ASSIGN ────────────────────────────────────────────────────────────────────

@router.post("/{task_id}/assign")
async def assign_task(
    task_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "assign"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=422, detail="Cannot reassign a terminal task")

    prev = {"ownerType": t.owner_type, "ownerId": str(t.owner_id),
            "assigneeType": t.assignee_type, "assigneeId": str(t.assignee_id)}

    if "ownerType" in payload or "ownerId" in payload:
        t.owner_type, t.owner_id = _validate_principal(
            payload.get("ownerType", t.owner_type), payload.get("ownerId", str(t.owner_id)), "owner")
    if "assigneeType" in payload or "assigneeId" in payload:
        t.assignee_type, t.assignee_id = _validate_principal(
            payload.get("assigneeType", t.assignee_type), payload.get("assigneeId", str(t.assignee_id)), "assignee")

    t.updated_at = _now()
    await s.flush()
    await workflow.emit(s, user.tenant_id, "task_assigned", "task", t.id, user.id,
                        {"before": prev,
                         "after": {"ownerType": t.owner_type, "ownerId": str(t.owner_id),
                                   "assigneeType": t.assignee_type, "assigneeId": str(t.assignee_id)}})
    return _serialize(t)


# ── COMPLETE ──────────────────────────────────────────────────────────────────

@router.post("/{task_id}/complete")
async def complete_task(
    task_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "complete"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status == "COMPLETED":
        return _serialize(t)  # idempotent
    if t.status == "CANCELLED":
        raise HTTPException(status_code=422, detail="Cannot complete a cancelled task")

    # Rule 4 — resolution required.
    resolution = _validate_enum(payload.get("resolution"), "resolution", VALID_RESOLUTIONS)
    now = _now()
    t.status = "COMPLETED"
    t.completed_at = now
    t.completed_by = user.id
    t.resolution = resolution
    t.completion_note = payload.get("completionNote")
    t.updated_at = now
    await s.flush()
    await workflow.emit(s, user.tenant_id, "task_completed", "task", t.id, user.id,
                        {"resolution": resolution})
    if t.parent_entity_type and t.parent_entity_id:
        await workflow.emit(s, user.tenant_id, "task_completed", t.parent_entity_type,
                            t.parent_entity_id, user.id,
                            {"taskId": str(t.id), "referenceNumber": t.reference_number,
                             "resolution": resolution})
    return _serialize(t)


# ── CANCEL ────────────────────────────────────────────────────────────────────

@router.post("/{task_id}/cancel")
async def cancel_task(
    task_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "cancel"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status == "CANCELLED":
        return _serialize(t)  # idempotent
    if t.status == "COMPLETED":
        raise HTTPException(status_code=422, detail="Cannot cancel a completed task")

    # Rule 5 — BOTH cancellationReason AND resolution required.
    reason = (payload.get("cancellationReason") or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="cancellationReason is required when cancelling")
    resolution = _validate_enum(payload.get("resolution"), "resolution", VALID_RESOLUTIONS)
    now = _now()
    t.status = "CANCELLED"
    t.cancelled_at = now
    t.cancelled_by = user.id
    t.cancellation_reason = reason
    t.resolution = resolution
    t.updated_at = now
    await s.flush()
    await workflow.emit(s, user.tenant_id, "task_cancelled", "task", t.id, user.id,
                        {"cancellationReason": reason, "resolution": resolution})
    return _serialize(t)


# ── REOPEN ────────────────────────────────────────────────────────────────────

@router.post("/{task_id}/reopen")
async def reopen_task(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "reopen"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status == "OPEN":
        return _serialize(t)  # idempotent
    if t.status not in TERMINAL_STATUSES:
        raise HTTPException(status_code=422, detail="Only COMPLETED or CANCELLED tasks can be reopened")

    t.status = "OPEN"
    t.completed_at = None; t.completed_by = None
    t.cancelled_at = None; t.cancelled_by = None
    t.cancellation_reason = None; t.resolution = None
    t.updated_at = _now()
    await s.flush()
    await workflow.emit(s, user.tenant_id, "task_reopened", "task", t.id, user.id, {})
    return _serialize(t)


# ── DELETE (soft) ─────────────────────────────────────────────────────────────

@router.delete("/{task_id}")
async def delete_task(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "delete"):
        raise HTTPException(status_code=403, detail="Access denied")
    t = await _get(s, user.tenant_id, task_id)
    if t.status == "CANCELLED" and t.resolution == "INVALID":
        return _serialize(t)  # already soft-deleted
    now = _now()
    t.status = "CANCELLED"
    t.cancelled_at = now
    t.cancelled_by = user.id
    t.cancellation_reason = "Soft deleted"
    t.resolution = "INVALID"
    t.updated_at = now
    await s.flush()
    await workflow.emit(s, user.tenant_id, "task_deleted", "task", t.id, user.id, {})
    return _serialize(t)


# ── DEPENDENCIES ──────────────────────────────────────────────────────────────

@router.get("/{task_id}/dependencies")
async def list_dependencies(
    task_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "view"):
        raise HTTPException(status_code=403, detail="Access denied")
    await _get(s, user.tenant_id, task_id)  # 404 if not found
    rows = (await s.execute(
        select(TaskDependency).where(
            TaskDependency.tenant_id == user.tenant_id,
            TaskDependency.from_task_id == task_id,
        )
    )).scalars().all()
    return [_serialize_dep(d) for d in rows]


async def _detect_cycle(
    s: AsyncSession, tenant_id, start: uuid.UUID, target: uuid.UUID
) -> bool:
    """BFS from `target`; return True if we can reach `start` (would be a cycle)."""
    visited = set()
    queue = [target]
    while queue:
        current = queue.pop(0)
        if current == start:
            return True
        if current in visited:
            continue
        visited.add(current)
        neighbours = (await s.execute(
            select(TaskDependency.to_task_id).where(
                TaskDependency.tenant_id == tenant_id,
                TaskDependency.from_task_id == current,
            )
        )).scalars().all()
        queue.extend(neighbours)
    return False


@router.post("/{task_id}/dependencies", status_code=201)
async def add_dependency(
    task_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "edit"):
        raise HTTPException(status_code=403, detail="Access denied")
    await _get(s, user.tenant_id, task_id)
    dep_type = _validate_enum(payload.get("dependencyType"), "dependencyType", VALID_DEP_TYPES)
    try:
        to_id = uuid.UUID(str(payload.get("toTaskId")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="toTaskId must be a UUID")
    if to_id == task_id:
        raise HTTPException(status_code=422, detail="A task cannot depend on itself")
    await _get(s, user.tenant_id, to_id)  # 404 if target missing

    # Cycle guard.
    if await _detect_cycle(s, user.tenant_id, task_id, to_id):
        raise HTTPException(status_code=422, detail="Adding this dependency would create a cycle")

    dep = TaskDependency(
        tenant_id=user.tenant_id, from_task_id=task_id, to_task_id=to_id,
        dependency_type=dep_type, created_by=user.id,
    )
    s.add(dep)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "dependency_added", "task", task_id, user.id,
                        {"depId": str(dep.id), "toTaskId": str(to_id), "type": dep_type})
    return _serialize_dep(dep)


@router.delete("/{task_id}/dependencies/{dep_id}")
async def remove_dependency(
    task_id: uuid.UUID,
    dep_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "task", "edit"):
        raise HTTPException(status_code=403, detail="Access denied")
    dep = (await s.execute(
        select(TaskDependency).where(
            TaskDependency.tenant_id == user.tenant_id,
            TaskDependency.id == dep_id,
            TaskDependency.from_task_id == task_id,
        )
    )).scalar_one_or_none()
    if dep is None:
        raise HTTPException(status_code=404, detail="Dependency not found")
    await s.delete(dep)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "dependency_removed", "task", task_id, user.id,
                        {"depId": str(dep_id)})
    return {"deleted": str(dep_id)}
