"""SLA Standard (file 12) — first-class SLA tracker.

Additive only. Pre-existing per-row SLA fields on helpdesk_ticket and task
(sla_due_at, sla_status, sla_id) are NOT modified here — they continue to work
independently. The sla_id FK on task.py gets a real constraint in the migration
that follows this one (commented as "FK when SLA module ships").

Design decisions:
  - Business calendar (calendarId, business hours, holidays, weekends, timezone)
    is stored as calendar_id (nullable UUID) + timezone string. No calendar
    enforcement in v1 — 24×7 wall-clock time is the default. Calendar module
    ships separately; calendarId FK is wired then.
  - Breach detection is lazy: every GET / list auto-transitions ON_TRACK/AT_RISK
    SLAs to BREACHED when due_at < now(). The scheduled background sweep
    (SLA check job) is the Background Job Standard's concern.
  - total_paused_seconds accumulates wall-clock pause duration for effective-
    remaining-time calculations.
  - No hold column — central Legal Hold registry lands with Data Retention.
  - SlaEvent rows are append-only (immutable audit of status transitions);
    no CASCADE — SLA events survive SLA record deletions.

Reference numbers: SLA-000001 per-tenant (same SELECT COUNT+1 pattern as Task;
unique index is the concurrency fence).

Permission: sla.manage (single cross-cutting key, file 15).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Integer, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SlaRecord(Base):
    """A first-class SLA tracker pinned to one object (file 12 — SLA Standard).

    objectType + objectId are polymorphic (no FK), matching the Approval /
    Comment / Watcher precedent. status lifecycle:

      ON_TRACK  → AT_RISK (router sets when AT_RISK threshold crossed or explicit)
      ON_TRACK  → PAUSED  (pause endpoint; requires pause_reason)
      AT_RISK   → PAUSED
      ON_TRACK  → BREACHED (lazy auto on read; or explicit breach endpoint)
      AT_RISK   → BREACHED
      PAUSED    → ON_TRACK | AT_RISK (resume; recalculates due_at from total_paused_seconds)
      any active → COMPLETED (on object completion)
      any → CANCELLED

    BREACHED is terminal for the commitment but NOT for the record — the SLA
    stays visible, reports against it, and receives COMPLETED / CANCELLED later.

    ownerDepartment is exactly ONE accountable department (B5 — spec lock).
    """
    __tablename__ = "sla_record"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_sla_reference_number"),
        Index("ix_sla_object", "tenant_id", "object_type", "object_id"),
        Index("ix_sla_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # SLA-000001

    # Nullable v1 — FK to sla_policy table when the SLA Policy module ships.
    sla_policy_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Polymorphic parent (Approval / Comment precedent — no FK, indexed).
    # objectType stores entity_def.key lowercase; retrofits to canonical ObjectType when
    # the Event System extension lands.
    object_type: Mapped[str] = mapped_column(String(40), nullable=False)
    object_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Status (file 14 SlaStatus — 7 values).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ON_TRACK")
    # NOT_APPLICABLE | ON_TRACK | AT_RISK | PAUSED | BREACHED | COMPLETED | CANCELLED

    # Core timeline.
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    breached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Accumulated wall-clock pause time (seconds).
    # Used to recalculate effective remaining time after resume.
    total_paused_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # Pause reason — required when status=PAUSED (file 14 SlaPauseReason).
    # WAITING_CUSTOMER | WAITING_EXTERNAL_PARTY | WAITING_APPROVAL |
    # WAITING_PARTS | SCHEDULED_APPOINTMENT | DEPENDENCY_BLOCKED
    pause_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Accountable department — exactly one (B5 lock).
    owner_department: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Primary assignee (PrincipalType subset — same pattern as Task).
    primary_assignee_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    primary_assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    priority: Mapped[str | None] = mapped_column(String(20), nullable=True)  # LOW|MEDIUM|HIGH|URGENT (from parent)

    # Business calendar stub — v1 is 24x7 wall-clock. calendar_id FK wired when Calendar ships.
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    timezone: Mapped[str] = mapped_column(String(60), nullable=False, default="UTC", server_default="'UTC'")

    # Internal trace key (M1 note — exempt from Reference Number Standard).
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`
    # (which already carries CANCELLED via cancelled_at — that's a lifecycle cancel, not a delete).
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SlaEvent(Base):
    """Append-only audit trail for SLA status transitions (pause/resume/breach/complete/cancel).

    Rows are immutable; no CASCADE on sla_id — events survive SLA record lifecycle.
    eventType: PAUSED | RESUMED | BREACHED | COMPLETED | CANCELLED | AT_RISK | CREATED
    """
    __tablename__ = "sla_event"
    __table_args__ = (
        Index("ix_sla_event_sla_id", "sla_id"),
        Index("ix_sla_event_tenant", "tenant_id", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    sla_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sla_record.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)  # CREATED|PAUSED|RESUMED|AT_RISK|BREACHED|COMPLETED|CANCELLED
    pause_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)  # set on PAUSED events
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
