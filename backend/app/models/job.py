import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class JobRun(Base):
    """A record of one execution of a batch job (dunning, billing-cycle, …) — J96 job log.

    Lightweight, tenant-scoped, append-only in spirit: each run inserts one row with its outcome
    (`status` SUCCESS/ERROR) and a free-form `summary` (the same dict the endpoint returns, or an
    error message). Backs the read-only job dashboard at GET /api/jobs."""
    __tablename__ = "job_run"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    job_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)   # e.g. "billing.run_cycle"
    status: Mapped[str] = mapped_column(String(20), nullable=False)                # SUCCESS | ERROR
    summary: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)     # {generated, skipped, errors} | {message}
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
