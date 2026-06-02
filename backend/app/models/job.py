from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Background Job Standard (file 12, std 68) — BackgroundJobStatus enum (file 14).
# Legacy ``status`` keeps the historical 2-value vocabulary (SUCCESS | ERROR) for
# back-compat; new code reads/writes ``job_status`` from this 7-value list.
JOB_STATUS_PENDING = "PENDING"
JOB_STATUS_RUNNING = "RUNNING"
JOB_STATUS_SUCCEEDED = "SUCCEEDED"
JOB_STATUS_FAILED = "FAILED"
JOB_STATUS_RETRYING = "RETRYING"
JOB_STATUS_CANCELLED = "CANCELLED"
JOB_STATUS_DEAD_LETTERED = "DEAD_LETTERED"

VALID_JOB_STATUSES = frozenset({
    JOB_STATUS_PENDING,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCEEDED,
    JOB_STATUS_FAILED,
    JOB_STATUS_RETRYING,
    JOB_STATUS_CANCELLED,
    JOB_STATUS_DEAD_LETTERED,
})

# Terminal states: a job in any of these is "done" and cannot transition.
# Used by the cancel endpoint to reject no-op cancellations.
TERMINAL_JOB_STATUSES = frozenset({
    JOB_STATUS_SUCCEEDED,
    JOB_STATUS_FAILED,
    JOB_STATUS_CANCELLED,
    JOB_STATUS_DEAD_LETTERED,
})

VALID_JOB_PRIORITIES = frozenset({"LOW", "NORMAL", "HIGH", "CRITICAL"})


class JobRun(Base):
    """A record of one execution of a batch job (dunning, billing-cycle, …) — J96 job log.

    Lightweight, tenant-scoped, append-only in spirit: each run inserts one row with its outcome
    (`status` SUCCESS/ERROR) and a free-form `summary` (the same dict the endpoint returns, or an
    error message). Backs the read-only job dashboard at GET /api/jobs.

    Background Job Standard (file 12, std 68) extension — all new fields are nullable for
    backward compatibility. Legacy ``status`` is preserved so historical rows and existing
    insertion sites keep working; new code populates ``job_status`` (file 14
    ``BackgroundJobStatus`` enum) alongside it.
    """
    __tablename__ = "job_run"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    job_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)   # e.g. "billing.run_cycle"
    status: Mapped[str] = mapped_column(String(20), nullable=False)                # legacy: SUCCESS | ERROR
    summary: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)     # {generated, skipped, errors} | {message}
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Background Job Standard (file 12, std 68) extension ──────────────────
    # New 7-value BackgroundJobStatus (file 14). Nullable + DEFAULT 'PENDING' so
    # the column stays back-compat for existing inserts that only set ``status``.
    job_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, server_default="PENDING",
    )

    # JOB-NNNNNN human-friendly id (file 00 prefix; per-tenant UNIQUE).
    # Backfill is a separate concern — historical rows stay NULL.
    reference_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Free-string job category — "BILLING_CYCLE", "DUNNING", "REPORT_GENERATION", …
    job_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Queue routing (future multi-queue worker support).
    queue_name: Mapped[str | None] = mapped_column(
        String(80), nullable=True, server_default="default",
    )

    # LOW | NORMAL | HIGH | CRITICAL
    priority: Mapped[str | None] = mapped_column(
        String(20), nullable=True, server_default="NORMAL",
    )

    # Retry bookkeeping.
    retry_count: Mapped[int | None] = mapped_column(
        Integer, nullable=True, server_default="0",
    )
    max_retries: Mapped[int | None] = mapped_column(
        Integer, nullable=True, server_default="3",
    )

    # Idempotency: enforced by partial UNIQUE index (tenant_id, idempotency_key)
    # WHERE idempotency_key IS NOT NULL — see migration.
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Distributed-trace correlation.
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Pointer to a large payload (attachment id, external blob ref, …).
    payload_reference: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Structured error capture.
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
