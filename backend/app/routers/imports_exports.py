"""Import / Export Standard (file 08) — API routes.

10 endpoints — all RLS tenant-scoped, all permission-gated. v1 = metadata-only
job tracking; the actual file-processing execution engine is a future addition
that will pick up PENDING / RUNNING rows from these tables.

  POST   /api/imports                       create (status=DRAFT)         — import.run
  GET    /api/imports                       list (?status=&entity_key=)   — import.run
  GET    /api/imports/{id}                  read                          — import.run
  POST   /api/imports/{id}/validate         DRAFT -> READY_TO_IMPORT      — import.run
  POST   /api/imports/{id}/start            READY_TO_IMPORT -> IMPORTING  — import.run
  POST   /api/imports/{id}/cancel           non-terminal -> CANCELLED     — import.run

  POST   /api/exports                       create (status=REQUESTED)     — export.run
  GET    /api/exports                       list (?status=&entity_key=)   — export.run
  GET    /api/exports/{id}                  read                          — export.run
  POST   /api/exports/{id}/cancel           non-terminal -> CANCELLED     — export.run

Permission gates: `import.run` covers ALL /imports endpoints (create + read +
lifecycle). `export.run` covers ALL /exports endpoints. Lower-granularity
splits (e.g. import.create vs import.cancel) are a future refinement — v1
ships the standard's two top-level permission keys.

Substrate emit via workflow.emit, pinned to the IMPORT/EXPORT row itself so
each job's timeline projects via the Event System views:
  - import_created           (event_name=ImportJob.Created,        category=INTEGRATION)
  - import_status_changed    (event_name=ImportJob.StatusChanged,  category=INTEGRATION)
  - export_created           (event_name=ExportJob.Created,        category=INTEGRATION)
  - export_status_changed    (event_name=ExportJob.StatusChanged,  category=INTEGRATION)

Reference numbers IMP-000001 / EXP-000001 generated via SELECT COUNT(*)+1
per-tenant. The UNIQUE (tenant_id, reference_number) index in the migration
is the authoritative collision fence under concurrency.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workflow
from ..access import can, load_grants
from ..db import get_session
from ..models.import_export import (
    EXPORT_STATUSES,
    EXPORT_TERMINAL,
    ExportJob,
    IMPORT_STATUSES,
    IMPORT_TERMINAL,
    ImportJob,
)
from ..models.user import User
from .auth import current_user

router = APIRouter(prefix="/api", tags=["imports_exports"])


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_import(j: ImportJob) -> dict:
    return {
        "id": str(j.id),
        "referenceNumber": j.reference_number,
        "jobType": j.job_type,
        "entityKey": j.entity_key,
        "fileAttachmentId": str(j.file_attachment_id) if j.file_attachment_id else None,
        "status": j.status,
        "totalRows": j.total_rows,
        "validRows": j.valid_rows,
        "invalidRows": j.invalid_rows,
        "errorSummary": j.error_summary,
        "startedAt": j.started_at.isoformat() if j.started_at else None,
        "completedAt": j.completed_at.isoformat() if j.completed_at else None,
        "createdAt": j.created_at.isoformat(),
        "createdBy": str(j.created_by),
    }


def _serialize_export(j: ExportJob) -> dict:
    return {
        "id": str(j.id),
        "referenceNumber": j.reference_number,
        "jobType": j.job_type,
        "entityKey": j.entity_key,
        "filterSpec": j.filter_spec,
        "outputFormat": j.output_format,
        "status": j.status,
        "totalRows": j.total_rows,
        "fileAttachmentId": str(j.file_attachment_id) if j.file_attachment_id else None,
        "expiresAt": j.expires_at.isoformat() if j.expires_at else None,
        "startedAt": j.started_at.isoformat() if j.started_at else None,
        "completedAt": j.completed_at.isoformat() if j.completed_at else None,
        "createdAt": j.created_at.isoformat(),
        "createdBy": str(j.created_by),
    }


async def _next_import_ref(s: AsyncSession, tenant_id) -> str:
    """IMP-000001 counter. SELECT COUNT(*)+1 — UNIQUE index is the authoritative
    fence under concurrency (a duplicate raises rather than corrupts)."""
    n = (await s.execute(
        select(func.count()).select_from(ImportJob).where(ImportJob.tenant_id == tenant_id)
    )).scalar_one()
    return f"IMP-{n + 1:06d}"


async def _next_export_ref(s: AsyncSession, tenant_id) -> str:
    """EXP-000001 counter — same rationale as IMP-."""
    n = (await s.execute(
        select(func.count()).select_from(ExportJob).where(ExportJob.tenant_id == tenant_id)
    )).scalar_one()
    return f"EXP-{n + 1:06d}"


async def _get_import(s: AsyncSession, tenant_id, job_id: uuid.UUID) -> ImportJob:
    j = (await s.execute(
        select(ImportJob).where(and_(ImportJob.tenant_id == tenant_id, ImportJob.id == job_id))
    )).scalar_one_or_none()
    if j is None:
        raise HTTPException(status_code=404, detail="Import job not found")
    return j


async def _get_export(s: AsyncSession, tenant_id, job_id: uuid.UUID) -> ExportJob:
    j = (await s.execute(
        select(ExportJob).where(and_(ExportJob.tenant_id == tenant_id, ExportJob.id == job_id))
    )).scalar_one_or_none()
    if j is None:
        raise HTTPException(status_code=404, detail="Export job not found")
    return j


def _require_str(payload: dict, key: str) -> str:
    v = payload.get(key)
    if not v or not isinstance(v, str) or not v.strip():
        raise HTTPException(status_code=422, detail=f"{key} is required")
    return v.strip()


async def _emit_import(
    s: AsyncSession, tenant_id, user_id, j: ImportJob, type_: str, event_name: str,
    extra: Optional[dict] = None,
):
    """Pin substrate emit to the IMPORT row itself (entity_key='import_job',
    record_id=j.id) so its timeline projects from Event System views."""
    data: dict[str, Any] = {
        "importJobId": str(j.id),
        "referenceNumber": j.reference_number,
        "status": j.status,
        "entityKey": j.entity_key,
        "jobType": j.job_type,
    }
    if extra:
        data.update(extra)
    await workflow.emit(
        s, tenant_id, type_, "import_job", j.id, user_id, data,
        event_name=event_name, category="INTEGRATION",
    )


async def _emit_export(
    s: AsyncSession, tenant_id, user_id, j: ExportJob, type_: str, event_name: str,
    extra: Optional[dict] = None,
):
    """Pin substrate emit to the EXPORT row itself."""
    data: dict[str, Any] = {
        "exportJobId": str(j.id),
        "referenceNumber": j.reference_number,
        "status": j.status,
        "entityKey": j.entity_key,
        "jobType": j.job_type,
        "outputFormat": j.output_format,
    }
    if extra:
        data.update(extra)
    await workflow.emit(
        s, tenant_id, type_, "export_job", j.id, user_id, data,
        event_name=event_name, category="INTEGRATION",
    )


# ══════════════════════════════════════════════════════════════════════════════
# IMPORT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/imports", status_code=201)
async def create_import(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create an ImportJob (status=DRAFT). Caller may optionally provide a
    fileAttachmentId immediately; usually it's attached before the validate
    transition kicks in."""
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")

    job_type   = _require_str(payload, "jobType")
    entity_key = _require_str(payload, "entityKey")

    file_attachment_id: Optional[uuid.UUID] = None
    if payload.get("fileAttachmentId"):
        try:
            file_attachment_id = uuid.UUID(str(payload["fileAttachmentId"]))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="fileAttachmentId must be a UUID")

    ref = await _next_import_ref(s, user.tenant_id)
    j = ImportJob(
        tenant_id=user.tenant_id,
        reference_number=ref,
        job_type=job_type,
        entity_key=entity_key,
        file_attachment_id=file_attachment_id,
        status="DRAFT",
        created_by=user.id,
    )
    s.add(j)
    await s.flush()

    await _emit_import(s, user.tenant_id, user.id, j, "import_created", "ImportJob.Created")
    return _serialize_import(j)


@router.get("/imports")
async def list_imports(
    status: Optional[str] = Query(default=None),
    entity_key: Optional[str] = Query(default=None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(ImportJob).where(ImportJob.tenant_id == user.tenant_id)
    if status:
        st = status.upper()
        if st not in IMPORT_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(IMPORT_STATUSES)}")
        q = q.where(ImportJob.status == st)
    if entity_key:
        q = q.where(ImportJob.entity_key == entity_key)
    q = q.order_by(ImportJob.created_at.desc())

    rows = (await s.execute(q)).scalars().all()
    return [_serialize_import(j) for j in rows]


@router.get("/imports/{job_id}")
async def get_import(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_import(s, user.tenant_id, job_id)
    return _serialize_import(j)


@router.post("/imports/{job_id}/validate")
async def validate_import(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """DRAFT -> VALIDATING -> READY_TO_IMPORT (or VALIDATION_FAILED).

    v1 stub: real CSV/XLSX validation lands with the execution engine; this
    transition immediately marks the row READY_TO_IMPORT so the lifecycle is
    exercisable end-to-end. We emit BOTH the intermediate VALIDATING change
    and the terminal validation result, so the audit chain is complete.
    """
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_import(s, user.tenant_id, job_id)
    if j.status != "DRAFT":
        raise HTTPException(
            status_code=422,
            detail=f"Cannot validate from status={j.status}; must be DRAFT",
        )

    prior = j.status
    j.status = "VALIDATING"
    j.started_at = _now()
    await s.flush()
    await _emit_import(
        s, user.tenant_id, user.id, j,
        "import_status_changed", "ImportJob.StatusChanged",
        {"prior": prior, "next": j.status},
    )

    # v1 stub: validation always passes.
    prior = j.status
    j.status = "READY_TO_IMPORT"
    await s.flush()
    await _emit_import(
        s, user.tenant_id, user.id, j,
        "import_status_changed", "ImportJob.StatusChanged",
        {"prior": prior, "next": j.status},
    )
    return _serialize_import(j)


@router.post("/imports/{job_id}/start")
async def start_import(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """READY_TO_IMPORT -> IMPORTING. The background job (future addition)
    will then process the file and move the row to COMPLETED /
    COMPLETED_WITH_ERRORS / FAILED."""
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_import(s, user.tenant_id, job_id)
    if j.status != "READY_TO_IMPORT":
        raise HTTPException(
            status_code=422,
            detail=f"Cannot start from status={j.status}; must be READY_TO_IMPORT",
        )

    prior = j.status
    j.status = "IMPORTING"
    if j.started_at is None:
        j.started_at = _now()
    await s.flush()
    await _emit_import(
        s, user.tenant_id, user.id, j,
        "import_status_changed", "ImportJob.StatusChanged",
        {"prior": prior, "next": j.status},
    )
    return _serialize_import(j)


@router.post("/imports/{job_id}/cancel")
async def cancel_import(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Cancel an import from any non-terminal state."""
    grants = await load_grants(s, user)
    if not can(grants, "import", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_import(s, user.tenant_id, job_id)
    if j.status in IMPORT_TERMINAL:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot cancel terminal status={j.status}",
        )

    prior = j.status
    j.status = "CANCELLED"
    j.completed_at = _now()
    await s.flush()
    await _emit_import(
        s, user.tenant_id, user.id, j,
        "import_status_changed", "ImportJob.StatusChanged",
        {"prior": prior, "next": j.status},
    )
    return _serialize_import(j)


# ══════════════════════════════════════════════════════════════════════════════
# EXPORT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/exports", status_code=201)
async def create_export(
    payload: dict,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Create an ExportJob (status=REQUESTED). The background worker
    (future addition) will pick it up, produce the file, create an
    Attachment, populate file_attachment_id, and flip status to COMPLETED."""
    grants = await load_grants(s, user)
    if not can(grants, "export", "run"):
        raise HTTPException(status_code=403, detail="Access denied")

    job_type   = _require_str(payload, "jobType")
    entity_key = _require_str(payload, "entityKey")
    output_format = (payload.get("outputFormat") or "csv").lower().strip()

    filter_spec = payload.get("filterSpec")
    if filter_spec is not None and not isinstance(filter_spec, dict):
        raise HTTPException(status_code=422, detail="filterSpec must be an object")

    expires_at: Optional[datetime] = None
    if payload.get("expiresAt"):
        try:
            expires_at = datetime.fromisoformat(str(payload["expiresAt"]).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="expiresAt must be an ISO 8601 timestamp")

    ref = await _next_export_ref(s, user.tenant_id)
    j = ExportJob(
        tenant_id=user.tenant_id,
        reference_number=ref,
        job_type=job_type,
        entity_key=entity_key,
        filter_spec=filter_spec,
        output_format=output_format,
        status="REQUESTED",
        expires_at=expires_at,
        created_by=user.id,
    )
    s.add(j)
    await s.flush()

    await _emit_export(s, user.tenant_id, user.id, j, "export_created", "ExportJob.Created")
    return _serialize_export(j)


@router.get("/exports")
async def list_exports(
    status: Optional[str] = Query(default=None),
    entity_key: Optional[str] = Query(default=None),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "export", "run"):
        raise HTTPException(status_code=403, detail="Access denied")

    q = select(ExportJob).where(ExportJob.tenant_id == user.tenant_id)
    if status:
        st = status.upper()
        if st not in EXPORT_STATUSES:
            raise HTTPException(status_code=422, detail=f"status must be one of {sorted(EXPORT_STATUSES)}")
        q = q.where(ExportJob.status == st)
    if entity_key:
        q = q.where(ExportJob.entity_key == entity_key)
    q = q.order_by(ExportJob.created_at.desc())

    rows = (await s.execute(q)).scalars().all()
    return [_serialize_export(j) for j in rows]


@router.get("/exports/{job_id}")
async def get_export(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    grants = await load_grants(s, user)
    if not can(grants, "export", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_export(s, user.tenant_id, job_id)
    return _serialize_export(j)


@router.post("/exports/{job_id}/cancel")
async def cancel_export(
    job_id: uuid.UUID,
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """Cancel an export from any non-terminal state."""
    grants = await load_grants(s, user)
    if not can(grants, "export", "run"):
        raise HTTPException(status_code=403, detail="Access denied")
    j = await _get_export(s, user.tenant_id, job_id)
    if j.status in EXPORT_TERMINAL:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot cancel terminal status={j.status}",
        )

    prior = j.status
    j.status = "CANCELLED"
    j.completed_at = _now()
    await s.flush()
    await _emit_export(
        s, user.tenant_id, user.id, j,
        "export_status_changed", "ExportJob.StatusChanged",
        {"prior": prior, "next": j.status},
    )
    return _serialize_export(j)
