"""Job dashboard (J96): read-only log of batch-job runs (dunning, billing-cycle, …).

Batch jobs used to run blind. The two endpoints `POST /api/invoices/run-dunning` and
`POST /api/billing/run-cycle` now insert a `JobRun` row per execution (SUCCESS + summary, or
ERROR + message). This router exposes them at `GET /api/jobs` — newest first, optional `?job_key=`
filter, capped — so operators can see when a job last ran and what it did.

NOTE on namespacing: `/api/jobs` is a FIXED path under /api. The generic record router serves
`/api/{slug}`, so this router MUST be registered BEFORE records.router in main.py. See the wiring
report.

AUTH choice (headless): gated on authentication + tenant scope only (no extra permission). The rows
are an operational audit surface, not sensitive customer data, and the query is tenant-scoped (plus
RLS at the DB). If a tighter gate is wanted later, add a `can(grants, "config", "view")`-style check.

Background Job Standard (file 12, std 68) extension:
  * List filters: ``?job_status=``, ``?job_type=``, ``?queue_name=``, ``?priority=``,
    ``?from=`` and ``?to=`` (ISO datetime range on ``started_at``).
  * Per-job detail: ``GET /api/jobs/{job_id}`` returns the full row (including all new fields).
  * Cancel: ``POST /api/jobs/{job_id}/cancel`` flips ``job_status`` to ``CANCELLED`` (only from
    non-terminal states) and emits a ``job_cancelled`` event.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..db import get_session
from ..models import User
from ..models.job import JobRun, TERMINAL_JOB_STATUSES, VALID_JOB_STATUSES, VALID_JOB_PRIORITIES
from .auth import current_user
from .records import _paginate

router = APIRouter(prefix="/api", tags=["jobs"])


def _iso(dt):
    return dt.isoformat() if dt else None


def _job_run(j: JobRun) -> dict:
    """Serialize a JobRun including all Background Job Standard fields."""
    return {
        "id": str(j.id),
        # snake_case legacy keys preserved (existing test_batch23/test_batch24 + external consumers rely on them).
        "tenant_id": str(j.tenant_id),
        "tenantId": str(j.tenant_id),
        "owner_node_id": str(j.owner_node_id) if j.owner_node_id else None,
        "ownerNodeId": str(j.owner_node_id) if j.owner_node_id else None,
        "job_key": j.job_key,
        "jobKey": j.job_key,
        # Legacy 2-value field, kept for back-compat with existing consumers.
        "status": j.status,
        "summary": j.summary,
        "actor_user_id": str(j.actor_user_id) if j.actor_user_id else None,
        "actorUserId": str(j.actor_user_id) if j.actor_user_id else None,
        "started_at": _iso(j.started_at),
        "finished_at": _iso(j.finished_at),
        # Background Job Standard (file 12, std 68) — new fields.
        "jobStatus": j.job_status,
        "referenceNumber": j.reference_number,
        "jobType": j.job_type,
        "queueName": j.queue_name,
        "priority": j.priority,
        "retryCount": j.retry_count,
        "maxRetries": j.max_retries,
        "idempotencyKey": j.idempotency_key,
        "correlationId": str(j.correlation_id) if j.correlation_id else None,
        "causationId": str(j.causation_id) if j.causation_id else None,
        "payloadReference": j.payload_reference,
        "errorCode": j.error_code,
        "errorMessage": j.error_message,
    }


def _parse_iso(value: str | None, *, field: str) -> datetime | None:
    """Parse an ISO-8601 datetime query param, or 422 on malformed input.

    Accepts trailing 'Z' (substituted to '+00:00' so ``datetime.fromisoformat`` is happy).
    """
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be an ISO-8601 datetime (got {value!r})",
        )


@router.get("/jobs")
async def list_jobs(
    job_key: str | None = None,
    job_status: str | None = None,
    job_type: str | None = None,
    queue_name: str | None = None,
    priority: str | None = None,
    # 'from' is a Python reserved word — accept the alias via Query.
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int = 200,
    offset: int = 0,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Recent JobRuns for this tenant, newest first.

    Filters (all optional): ``?job_key=``, ``?job_status=``, ``?job_type=``, ``?queue_name=``,
    ``?priority=``, ``?from=`` / ``?to=`` (ISO datetimes on ``started_at``). Capped paging.
    """
    if job_status is not None and job_status not in VALID_JOB_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"job_status must be one of {sorted(VALID_JOB_STATUSES)}",
        )
    if priority is not None and priority not in VALID_JOB_PRIORITIES:
        raise HTTPException(
            status_code=422,
            detail=f"priority must be one of {sorted(VALID_JOB_PRIORITIES)}",
        )

    from_dt = _parse_iso(from_, field="from")
    to_dt = _parse_iso(to, field="to")

    q = select(JobRun).where(JobRun.tenant_id == user.tenant_id)
    if job_key:
        q = q.where(JobRun.job_key == job_key)
    if job_status:
        q = q.where(JobRun.job_status == job_status)
    if job_type:
        q = q.where(JobRun.job_type == job_type)
    if queue_name:
        q = q.where(JobRun.queue_name == queue_name)
    if priority:
        q = q.where(JobRun.priority == priority)
    if from_dt is not None:
        q = q.where(JobRun.started_at >= from_dt)
    if to_dt is not None:
        q = q.where(JobRun.started_at <= to_dt)
    q = q.order_by(JobRun.started_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_job_run(j) for j in _paginate(list(rows), limit, offset)]


async def _get_job(s: AsyncSession, tenant_id: uuid.UUID, job_id: uuid.UUID) -> JobRun:
    """Tenant-scoped fetch — 404 if the row doesn't exist for this tenant."""
    q = select(JobRun).where(JobRun.tenant_id == tenant_id, JobRun.id == job_id)
    row = (await s.execute(q)).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Return a single JobRun (all Background Job Standard fields included)."""
    j = await _get_job(s, user.tenant_id, job_id)
    return _job_run(j)


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Flip a JobRun's ``job_status`` to ``CANCELLED`` and emit ``job_cancelled``.

    Rejects with 422 if the job is already in a terminal state (SUCCEEDED, FAILED,
    CANCELLED, DEAD_LETTERED) — cancellation is only meaningful from PENDING /
    RUNNING / RETRYING.
    """
    j = await _get_job(s, user.tenant_id, job_id)

    current = j.job_status or "PENDING"
    if current in TERMINAL_JOB_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot cancel a job in terminal state {current}",
        )

    j.job_status = "CANCELLED"
    await s.flush()

    await workflow.emit(
        s, user.tenant_id, "job_cancelled",
        "job_run", j.id, user.id,
        {
            "jobId": str(j.id),
            "jobKey": j.job_key,
            "referenceNumber": j.reference_number,
            "fromStatus": current,
            "toStatus": "CANCELLED",
        },
        event_name="Job.Cancelled", category="SYSTEM",
    )

    return _job_run(j)
