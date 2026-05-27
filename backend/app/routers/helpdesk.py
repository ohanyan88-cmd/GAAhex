"""Helpdesk API (Batch 31): Queues + Tickets + SLA sweep.

Tenant + org scoped exactly like the billing/interactions routers.  Every mutation emits an audit
Event through workflow.emit; status transitions guard against illegal moves with 409.  The SLA
breach sweep is a standalone async function (no FastAPI Depends) that the scheduler can call
directly — it logs a JobRun exactly like billing.run_dunning.

NOTE on namespacing: fixed paths under /api/helpdesk, so this router MUST be registered BEFORE
records.router in main.py.  See the coordinator paste-lines at the bottom of the Lane A report.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.helpdesk import HelpdeskQueue, HelpdeskTicket
from ..models.job import JobRun
from ..access import load_grants, can
from .. import workflow, notify_hooks
from .auth import current_user
from .records import _node_paths, _paginate

router = APIRouter(prefix="/api/helpdesk", tags=["helpdesk"])

# Valid status set
_STATUSES = {"OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _deny(perm: str):
    raise HTTPException(403, f"Not allowed: {perm}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _queue(q: HelpdeskQueue) -> dict:
    return {
        "id": str(q.id),
        "tenant_id": str(q.tenant_id),
        "owner_node_id": str(q.owner_node_id) if q.owner_node_id else None,
        "name": q.name,
        "description": q.description,
        "default_sla_minutes": q.default_sla_minutes,
        "created_at": _iso(q.created_at),
    }


def _ticket(t: HelpdeskTicket) -> dict:
    return {
        "id": str(t.id),
        "tenant_id": str(t.tenant_id),
        "owner_node_id": str(t.owner_node_id) if t.owner_node_id else None,
        "customer_id": str(t.customer_id) if t.customer_id else None,
        "queue_id": str(t.queue_id) if t.queue_id else None,
        "subject": t.subject,
        "body": t.body,
        "priority": t.priority,
        "status": t.status,
        "assigned_agent_id": str(t.assigned_agent_id) if t.assigned_agent_id else None,
        "sla_due_at": _iso(t.sla_due_at),
        "sla_breached": t.sla_breached,
        "resolved_at": _iso(t.resolved_at),
        "created_at": _iso(t.created_at),
    }


def _record_job_run(s: AsyncSession, user: User, job_key: str, status: str, summary: dict,
                    started_at: datetime, owner_node_id=None) -> None:
    """Add a JobRun row to the session (same pattern as billing._record_job_run). Caller commits."""
    s.add(JobRun(
        tenant_id=user.tenant_id, owner_node_id=owner_node_id, job_key=job_key, status=status,
        summary=summary, actor_user_id=user.id, started_at=started_at, finished_at=_now(),
    ))


async def _get_queue(s: AsyncSession, user: User, queue_id) -> HelpdeskQueue:
    q = (await s.execute(
        select(HelpdeskQueue).where(HelpdeskQueue.id == queue_id, HelpdeskQueue.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not q:
        raise HTTPException(404, "Queue not found")
    return q


async def _get_ticket(s: AsyncSession, user: User, ticket_id) -> HelpdeskTicket:
    t = (await s.execute(
        select(HelpdeskTicket).where(HelpdeskTicket.id == ticket_id, HelpdeskTicket.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Ticket not found")
    return t


# ---------------------------------------------------------------------------
# Queues
# ---------------------------------------------------------------------------

@router.get("/queues")
async def list_queues(
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_queue", "view"):
        _deny("helpdesk_queue.view")
    paths = await _node_paths(s, user.tenant_id)
    rows = (await s.execute(
        select(HelpdeskQueue).where(HelpdeskQueue.tenant_id == user.tenant_id).order_by(HelpdeskQueue.created_at)
    )).scalars().all()
    visible = [
        q for q in rows
        if can(grants, "helpdesk_queue", "view", paths.get(str(q.owner_node_id)) if q.owner_node_id else None)
    ]
    return [_queue(q) for q in _paginate(visible, limit, offset)]


@router.post("/queues", status_code=201)
async def create_queue(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_queue", "manage"):
        _deny("helpdesk_queue.manage")

    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")

    sla = payload.get("default_sla_minutes")
    if sla is not None:
        try:
            sla = int(sla)
            if sla <= 0:
                raise ValueError
        except (TypeError, ValueError):
            raise HTTPException(422, "default_sla_minutes must be a positive integer")

    q = HelpdeskQueue(
        tenant_id=user.tenant_id,
        owner_node_id=user.primary_node_id,
        name=name,
        description=payload.get("description"),
        default_sla_minutes=sla,
    )
    s.add(q)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "helpdesk_queue", q.id, user.id,
                        {"name": name})
    await s.commit()
    await s.refresh(q)
    return _queue(q)


@router.patch("/queues/{queue_id}")
async def update_queue(
    queue_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_queue", "manage"):
        _deny("helpdesk_queue.manage")
    q = await _get_queue(s, user, queue_id)

    changed: dict = {}
    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        q.name = v
        changed["name"] = v
    if "description" in payload:
        q.description = payload["description"]
        changed["description"] = q.description
    if "default_sla_minutes" in payload:
        sla = payload["default_sla_minutes"]
        if sla is not None:
            try:
                sla = int(sla)
                if sla <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                raise HTTPException(422, "default_sla_minutes must be a positive integer or null")
        q.default_sla_minutes = sla
        changed["default_sla_minutes"] = sla

    await workflow.emit(s, user.tenant_id, "update", "helpdesk_queue", q.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(q)
    return _queue(q)


@router.delete("/queues/{queue_id}", status_code=204)
async def delete_queue(
    queue_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_queue", "manage"):
        _deny("helpdesk_queue.manage")
    q = await _get_queue(s, user, queue_id)
    await workflow.emit(s, user.tenant_id, "delete", "helpdesk_queue", q.id, user.id, {"name": q.name})
    await s.delete(q)
    await s.commit()


# ---------------------------------------------------------------------------
# Tickets
# ---------------------------------------------------------------------------

@router.get("/tickets")
async def list_tickets(
    status: str | None = None,
    queue: uuid.UUID | None = None,
    assignee: uuid.UUID | None = None,
    mine: bool = False,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_ticket", "view"):
        _deny("helpdesk_ticket.view")
    paths = await _node_paths(s, user.tenant_id)

    q = select(HelpdeskTicket).where(HelpdeskTicket.tenant_id == user.tenant_id)
    if status:
        q = q.where(HelpdeskTicket.status == status)
    if queue is not None:
        q = q.where(HelpdeskTicket.queue_id == queue)
    if assignee is not None:
        q = q.where(HelpdeskTicket.assigned_agent_id == assignee)
    if mine:
        q = q.where(HelpdeskTicket.assigned_agent_id == user.id)
    q = q.order_by(HelpdeskTicket.created_at.desc())

    rows = (await s.execute(q)).scalars().all()
    visible = [
        t for t in rows
        if can(grants, "helpdesk_ticket", "view", paths.get(str(t.owner_node_id)) if t.owner_node_id else None)
    ]
    return [_ticket(t) for t in _paginate(visible, limit, offset)]


@router.post("/tickets", status_code=201)
async def create_ticket(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "helpdesk_ticket", "create"):
        _deny("helpdesk_ticket.create")

    subject = (payload.get("subject") or "").strip()
    if not subject:
        raise HTTPException(422, "subject is required")

    priority = (payload.get("priority") or "NORMAL").upper()
    _PRIORITIES = {"LOW", "NORMAL", "HIGH", "URGENT"}
    if priority not in _PRIORITIES:
        raise HTTPException(422, f"priority must be one of {sorted(_PRIORITIES)}")

    queue_id = payload.get("queue_id")
    sla_due_at = None
    if queue_id:
        queue_obj = (await s.execute(
            select(HelpdeskQueue).where(HelpdeskQueue.id == queue_id, HelpdeskQueue.tenant_id == user.tenant_id)
        )).scalar_one_or_none()
        if not queue_obj:
            raise HTTPException(422, "queue_id does not reference a known queue")
        if queue_obj.default_sla_minutes is not None:
            sla_due_at = _now() + timedelta(minutes=queue_obj.default_sla_minutes)

    t = HelpdeskTicket(
        tenant_id=user.tenant_id,
        owner_node_id=user.primary_node_id,
        customer_id=payload.get("customer_id"),
        queue_id=queue_id,
        subject=subject,
        body=payload.get("body"),
        priority=priority,
        status="OPEN",
        sla_due_at=sla_due_at,
    )
    s.add(t)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "create", "helpdesk_ticket", t.id, user.id,
                        {"subject": subject, "priority": priority,
                         "queue_id": str(queue_id) if queue_id else None,
                         "sla_due_at": _iso(sla_due_at)})
    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.get("/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "view",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.view")
    return _ticket(t)


@router.patch("/tickets/{ticket_id}")
async def update_ticket(
    ticket_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "edit",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.edit")

    changed: dict = {}
    if "subject" in payload:
        v = (payload["subject"] or "").strip()
        if not v:
            raise HTTPException(422, "subject cannot be empty")
        t.subject = v
        changed["subject"] = v
    if "body" in payload:
        t.body = payload["body"]
        changed["body"] = True
    if "priority" in payload:
        _PRIORITIES = {"LOW", "NORMAL", "HIGH", "URGENT"}
        p = (payload["priority"] or "NORMAL").upper()
        if p not in _PRIORITIES:
            raise HTTPException(422, f"priority must be one of {sorted(_PRIORITIES)}")
        t.priority = p
        changed["priority"] = p
    if "queue_id" in payload:
        qid = payload["queue_id"]
        if qid is not None:
            queue_obj = (await s.execute(
                select(HelpdeskQueue).where(HelpdeskQueue.id == qid, HelpdeskQueue.tenant_id == user.tenant_id)
            )).scalar_one_or_none()
            if not queue_obj:
                raise HTTPException(422, "queue_id does not reference a known queue")
        t.queue_id = qid
        changed["queue_id"] = str(qid) if qid else None

    await workflow.emit(s, user.tenant_id, "update", "helpdesk_ticket", t.id, user.id, {"changed": changed})
    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.post("/tickets/{ticket_id}/assign")
async def assign_ticket(
    ticket_id: uuid.UUID,
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "edit",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.edit")

    agent_id = payload.get("agent_id")
    if not agent_id:
        raise HTTPException(422, "agent_id is required")

    old_agent = t.assigned_agent_id
    t.assigned_agent_id = agent_id
    if t.status == "OPEN":
        t.status = "IN_PROGRESS"

    await workflow.emit(s, user.tenant_id, "assign", "helpdesk_ticket", t.id, user.id,
                        {"agent_id": str(agent_id), "status": t.status})
    await s.flush()

    # best-effort notification to the assignee
    try:
        await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="helpdesk_assign",
                                entity_key="helpdesk_ticket", record=t, actor_user_id=user.id,
                                extra={"ticket_id": str(t.id), "agent_id": str(agent_id)})
    except Exception:
        pass  # fail-soft: notification failure must not break the assignment

    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.post("/tickets/{ticket_id}/resolve")
async def resolve_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "edit",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.edit")
    if t.status == "CLOSED":
        raise HTTPException(409, f"Cannot resolve a CLOSED ticket")
    if t.status == "RESOLVED":
        raise HTTPException(409, f"Ticket is already RESOLVED")

    old_status = t.status
    t.status = "RESOLVED"
    t.resolved_at = _now()
    await workflow.emit(s, user.tenant_id, "transition", "helpdesk_ticket", t.id, user.id,
                        {"from": old_status, "to": "RESOLVED"})
    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.post("/tickets/{ticket_id}/reopen")
async def reopen_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "edit",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.edit")
    if t.status not in {"RESOLVED", "CLOSED", "PENDING"}:
        raise HTTPException(409, f"Cannot reopen a ticket with status {t.status}")

    old_status = t.status
    t.status = "OPEN"
    t.resolved_at = None
    await workflow.emit(s, user.tenant_id, "transition", "helpdesk_ticket", t.id, user.id,
                        {"from": old_status, "to": "OPEN"})
    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.post("/tickets/{ticket_id}/close")
async def close_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "edit",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.edit")
    if t.status == "CLOSED":
        raise HTTPException(409, "Ticket is already CLOSED")

    old_status = t.status
    t.status = "CLOSED"
    await workflow.emit(s, user.tenant_id, "transition", "helpdesk_ticket", t.id, user.id,
                        {"from": old_status, "to": "CLOSED"})
    await s.commit()
    await s.refresh(t)
    return _ticket(t)


@router.delete("/tickets/{ticket_id}", status_code=204)
async def delete_ticket(
    ticket_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    t = await _get_ticket(s, user, ticket_id)
    grants = await load_grants(s, user)
    paths = await _node_paths(s, user.tenant_id)
    if not can(grants, "helpdesk_ticket", "delete",
               paths.get(str(t.owner_node_id)) if t.owner_node_id else None):
        _deny("helpdesk_ticket.delete")
    await workflow.emit(s, user.tenant_id, "delete", "helpdesk_ticket", t.id, user.id,
                        {"subject": t.subject, "status": t.status})
    await s.delete(t)
    await s.commit()


# ---------------------------------------------------------------------------
# SLA breach sweep (scheduler-callable — no FastAPI Depends)
# ---------------------------------------------------------------------------

async def run_sla_breach_sweep(user: User, s: AsyncSession) -> dict:
    """Find tickets where status in (OPEN, IN_PROGRESS), sla_due_at < now, sla_breached == False
    and mark them breached.  Emits a workflow event + best-effort notification to the assignee.
    Logs a JobRun (same pattern as billing.run_dunning).  Returns {breached: N}.

    Signature: accept user= and s= kwargs so the scheduler _JOBS lambda can call it as
    run_sla_breach_sweep(user=actor, s=s) — no FastAPI Depends injected here.
    """
    started = _now()
    try:
        now = _now()
        candidates = (await s.execute(
            select(HelpdeskTicket).where(
                HelpdeskTicket.tenant_id == user.tenant_id,
                HelpdeskTicket.status.in_(["OPEN", "IN_PROGRESS"]),
                HelpdeskTicket.sla_due_at.isnot(None),
                HelpdeskTicket.sla_due_at < now,
                HelpdeskTicket.sla_breached.is_(False),
            )
        )).scalars().all()

        newly_breached = []
        for t in candidates:
            t.sla_breached = True
            await workflow.emit(s, user.tenant_id, "sla_breach", "helpdesk_ticket", t.id, user.id,
                                {"subject": t.subject, "sla_due_at": _iso(t.sla_due_at),
                                 "status": t.status})
            newly_breached.append(t)

        summary = {"breached": len(newly_breached)}
        _record_job_run(s, user, "helpdesk.sla_breach", "SUCCESS", summary, started)
        await s.commit()
    except Exception as e:
        await s.rollback()
        _record_job_run(s, user, "helpdesk.sla_breach", "ERROR", {"message": str(e)}, started)
        await s.commit()
        raise

    # best-effort: notify each breached ticket's assignee (fail-soft)
    try:
        for t in newly_breached:
            if t.assigned_agent_id is not None:
                await notify_hooks.fire(s, tenant_id=user.tenant_id, event_type="sla_breach",
                                        entity_key="helpdesk_ticket", record=t, actor_user_id=user.id,
                                        extra={"ticket_id": str(t.id), "sla_due_at": _iso(t.sla_due_at)})
        if newly_breached:
            await s.commit()
    except Exception:
        await s.rollback()  # notifications already committed above; just drop the notify attempt

    return summary
