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
"""
import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.job import JobRun
from .auth import current_user
from .records import _paginate

router = APIRouter(prefix="/api", tags=["jobs"])


def _iso(dt):
    return dt.isoformat() if dt else None


def _job_run(j: JobRun) -> dict:
    return {
        "id": str(j.id),
        "job_key": j.job_key,
        "status": j.status,
        "summary": j.summary,
        "started_at": _iso(j.started_at),
        "finished_at": _iso(j.finished_at),
    }


@router.get("/jobs")
async def list_jobs(job_key: str | None = None, limit: int = 200, offset: int = 0,
                    user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Recent JobRuns for this tenant, newest first. Optional `?job_key=` filter; capped paging."""
    q = select(JobRun).where(JobRun.tenant_id == user.tenant_id)
    if job_key:
        q = q.where(JobRun.job_key == job_key)
    q = q.order_by(JobRun.started_at.desc())
    rows = (await s.execute(q)).scalars().all()
    return [_job_run(j) for j in _paginate(list(rows), limit, offset)]
