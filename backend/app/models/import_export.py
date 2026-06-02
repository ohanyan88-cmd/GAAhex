"""Import / Export Standard (file 08) — first-class job tracking entities.

ImportJob and ExportJob are FIRST-CLASS job records — not generic JobRun rows.
They provide trackable, auditable, permission-gated metadata for bulk data
movement on the platform.

================================================================================
v1 SCOPE: METADATA ONLY
================================================================================

v1 ships ONLY the trackable job records — the row, its status, its reference
number, its FK to the produced/consumed file (Attachment), and its lifecycle
transitions. The actual import/export EXECUTION engine is a future addition:

  - A future background worker will pick up status=PENDING / VALIDATING /
    IMPORTING (for ImportJob) and status=REQUESTED / RUNNING (for ExportJob)
    rows from these tables, do the real work, then write back terminal status
    plus row counts plus (for exports) the resulting file_attachment_id.

  - In v1 the validate / start / cancel endpoints simply move the row through
    its status machine and emit the right substrate events. A "stub" validator
    immediately transitions DRAFT -> READY_TO_IMPORT so the lifecycle can be
    end-to-end exercised; replacing it with a real CSV/XLSX validator is the
    first step of the v2 execution engine.

This split keeps the surface area small AND lets the orchestrator integrate
the job tables, permissions, UI list pages, and audit trail RIGHT NOW —
ahead of the actual file-processing engine landing later.

================================================================================
DESIGN NOTES
================================================================================

- Reference numbers: IMP-000001 / EXP-000001 per-tenant via SELECT COUNT(*)+1.
  Race-safe via the UNIQUE (tenant_id, reference_number) index — duplicates
  fail at the DB layer rather than corrupting the namespace.

- file_attachment_id is a REAL FK to attachment.id with ON DELETE SET NULL.
  Spec rule from file 08: "the import/export file is itself an Attachment" —
  this honors that AND survives a soft-delete of the Attachment without
  breaking the job audit trail (the row still exists, the file column simply
  goes NULL with the Attachment row's deleted_at marking the deletion).

  - For ImportJob: nullable because early states (DRAFT, sometimes VALIDATING)
    may exist before the upload completes.
  - For ExportJob: nullable until COMPLETED — the export hasn't produced
    a file yet while it's still REQUESTED / RUNNING.

- output_format is a free string for v1 (csv, xlsx, pdf, json). The
  standard's exact enum list is deferred to the execution engine batch.

- expires_at on ExportJob enables a retention sweep: a future scheduler job
  iterates ExportJob rows past expires_at, sets status=EXPIRED, and detaches
  the file (and clears the storage_key on the Attachment). Captured here as
  the indexable column it must be; no sweep yet.

- error_summary on ImportJob is a JSONB blob for structured validation errors
  (e.g. {row_errors: [{row: 3, field: "email", error: "invalid"}],
  schema_errors: [...]}). Shape is intentionally loose for v1 so the
  execution engine can fill it in without a schema migration.

- filter_spec on ExportJob is a JSONB blob for the export's selection
  criteria (e.g. {entity: "customer", filter: {status: "ACTIVE"}, fields:
  [...], region_scope: "..."}).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# ── ImportJob status enum (file 08) ────────────────────────────────────────────
# DRAFT                — row created, waiting for file upload + validate kickoff.
# VALIDATING           — engine is parsing/checking the file.
# VALIDATION_FAILED    — terminal-failure-before-import; surfaces error_summary.
# READY_TO_IMPORT      — validation passed; user can press Start.
# IMPORTING            — engine is writing rows; row counters update live.
# COMPLETED            — all rows imported clean.
# COMPLETED_WITH_ERRORS — some rows imported, some failed; partial success.
# FAILED               — terminal hard failure during import.
# CANCELLED            — user cancelled before/during work.
IMPORT_STATUSES = frozenset({
    "DRAFT", "VALIDATING", "VALIDATION_FAILED", "READY_TO_IMPORT",
    "IMPORTING", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED",
})
IMPORT_TERMINAL = frozenset({
    "VALIDATION_FAILED", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "CANCELLED",
})

# ── ExportJob status enum (file 08) ────────────────────────────────────────────
# REQUESTED — row created, queued for the export engine.
# RUNNING   — engine is generating the output file.
# COMPLETED — file produced; file_attachment_id populated.
# FAILED    — terminal hard failure.
# CANCELLED — user cancelled before/during work.
# EXPIRED   — past expires_at; file detached by retention sweep.
EXPORT_STATUSES = frozenset({
    "REQUESTED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED", "EXPIRED",
})
EXPORT_TERMINAL = frozenset({"COMPLETED", "FAILED", "CANCELLED", "EXPIRED"})


class ImportJob(Base):
    """First-class import job record (file 08 — Import / Export Standard).

    v1 = metadata only. A future background worker picks up VALIDATING /
    IMPORTING rows and performs the actual file processing; the router moves
    the status machine and emits substrate events.

    Reference numbers: IMP-000001 per-tenant. The UNIQUE (tenant_id,
    reference_number) index is the authoritative collision fence.
    """
    __tablename__ = "import_job"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_import_job_reference_number"),
        Index("ix_import_job_status",      "tenant_id", "status"),
        Index("ix_import_job_entity_key",  "tenant_id", "entity_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # IMP-000001

    # Job typology — free strings for v1 (the exact enum lands with the engine batch).
    job_type:   Mapped[str] = mapped_column(String(40), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(60), nullable=False)

    # The file being imported is a real Attachment (file 04). Nullable for the
    # very-early DRAFT state where the row exists but the file isn't uploaded yet.
    # ON DELETE SET NULL — a soft-deleted Attachment shouldn't kill the job audit row.
    file_attachment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attachment.id", ondelete="SET NULL"), nullable=True
    )

    # 9-value status enum (see IMPORT_STATUSES above).
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="DRAFT")

    # Row counters — populated by the execution engine; 0 in v1.
    total_rows:   Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    valid_rows:   Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    invalid_rows: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")

    # Structured validation/error blob (shape intentionally loose for v1).
    error_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    started_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False
    )


class ExportJob(Base):
    """First-class export job record (file 08 — Import / Export Standard).

    v1 = metadata only. A future background worker picks up REQUESTED /
    RUNNING rows, produces the output file, stores it as an Attachment,
    populates file_attachment_id, and flips status to COMPLETED. v1's router
    creates the row in REQUESTED state and moves the status machine on
    explicit user actions (cancel) plus emits substrate events.

    Reference numbers: EXP-000001 per-tenant.

    expires_at + the (tenant_id, expires_at) index let a retention sweep
    iterate expired rows efficiently — future addition.
    """
    __tablename__ = "export_job"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_export_job_reference_number"),
        Index("ix_export_job_status",     "tenant_id", "status"),
        Index("ix_export_job_entity_key", "tenant_id", "entity_key"),
        Index("ix_export_job_expires_at", "tenant_id", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # EXP-000001

    job_type:   Mapped[str] = mapped_column(String(40), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(60), nullable=False)

    # Selection criteria for the export — JSONB. Shape loose for v1.
    filter_spec: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Free string for v1: csv | xlsx | pdf | json (exact enum deferred to engine batch).
    output_format: Mapped[str] = mapped_column(String(20), nullable=False, default="csv")

    # 6-value status enum (see EXPORT_STATUSES above).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="REQUESTED")

    total_rows: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")

    # Real FK — populated when the export completes. Nullable until COMPLETED.
    # ON DELETE SET NULL so a soft-deleted Attachment doesn't break the job row.
    file_attachment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attachment.id", ondelete="SET NULL"), nullable=True
    )

    expires_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False
    )
