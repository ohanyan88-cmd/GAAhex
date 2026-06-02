from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ReportSchedule(Base):
    """A scheduled delivery of a saved ReportDef (A24) — a report turned into a recurring job.

    Each row says: render `report_id` on a `cadence` (daily/weekly/monthly), deliver it on `channel`
    to `recipients`, again and again. The "run due reports" batch job (POST /api/report-schedules/
    run-due) picks up every ACTIVE schedule whose `next_run_at <= as_of`, renders the report (reusing
    report_builder's run), dispatches it via the channel adapter layer, advances `next_run_at` by the
    cadence, stamps `last_run_at`, and records a JobRun — exactly stitching the jobs + adapters layers
    (batch 23) onto the report engine.

    Tenant-scoped; carries the standard NULLIF-guarded `tenant_isolation` RLS policy like its siblings
    (report_def, job_run). `owner_node_id` is an optional org-scope tag for the schedule (who owns it),
    mirroring job_run; visibility/CRUD are tenant-scoped at the app layer.
    """
    __tablename__ = "report_schedule"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("report_def.id", ondelete="CASCADE"), nullable=False, index=True)
    cadence: Mapped[str] = mapped_column(String(20), nullable=False)            # daily | weekly | monthly
    channel: Mapped[str] = mapped_column(String(40), nullable=False)           # email | sms | console | webhook | ...
    recipients: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)  # list of channel addresses (emails, phones, urls)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)  # when it next becomes due
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)         # when run-due last fired it
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE | PAUSED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
