"""Event log — the canonical audit log table for GAAhex.

SPEC §0.4 AUDIT APPEND-ONLY (kernel invariant, alembic revision b70ef3b98e27):
  The `event` table carries DB-level BEFORE UPDATE and BEFORE DELETE triggers
  (`prevent_update_event`, `prevent_delete_event`) that raise an exception on ANY edit or delete
  attempt. The audit log cannot be modified by ANY role, including Admin. Only INSERTs are legal.
  The triggers enforce this at the database layer below the application so the invariant holds
  even against raw SQL access by a privileged operator (short of dropping the trigger itself,
  which would be a DDL-level action).

Event System extension (D1 — alembic revision following SLA):
  Nine new nullable columns retrofitting the Event System Standard (file 06, standard 19):
  event_name, category, schema_version, actor_type, actor_id, department, visibility,
  correlation_id, causation_id, reference_number, idempotency_key.

  ALL new columns are nullable — legacy rows have NULL in new fields ("old events remain
  readable forever", file 06). Existing call sites pass no kwargs; new sites can enrich.

  Backfill mapping (legacy type → event_name) is deferred to a background job — too many rows
  for a blocking migration. Mapping table:
    "create"         → "<ObjectType>.Created"
    "update"         → "<ObjectType>.Updated"
    "transition"     → "<ObjectType>.StatusChanged"
    "delete"         → "<ObjectType>.Deleted"
    "comment_added"  → "Comment.Added"
    "watch_added"    → "Watch.Added"
    "task_created"   → "Task.Created"
    ... (full map in the backfill job)

  D1 decision (Gev 2026-06-02): Audit and Timeline are governed projections over this single
  append-only store. Audit = the compliance-relevant slice (category in SECURITY/COMPLIANCE/
  FINANCIAL); Timeline = the user-facing chronological view. No separate audit_log table.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, SmallInteger, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# EventCategory (SST: docs/standards file 14 — E14/E21). The 16-value UPPER_SNAKE superset, now a
# CODE-ENFORCED set (not a free-text comment): workflow.emit() rejects any Event whose category is not
# in this set (or None). Audit = the compliance slice (SECURITY/COMPLIANCE/FINANCIAL); Timeline = the
# chronological view — both project over this single append-only store (D1).
EVENT_CATEGORIES: frozenset[str] = frozenset({
    "LIFECYCLE", "STATUS", "ASSIGNMENT", "OWNERSHIP", "APPROVAL", "FINANCIAL", "COMMENT", "ATTACHMENT",
    "COMMUNICATION", "TASK", "ESCALATION", "NOTIFICATION", "AUTOMATION", "INTEGRATION", "SECURITY", "SYSTEM",
})


class Event(Base):
    """A domain event emitted by the kernel. Append-only (DB triggers). Foundation for
    Audit (compliance projection) and Activity Timeline (user-facing projection) — D1."""
    __tablename__ = "event"
    __table_args__ = (
        # Idempotency fence: integration- and automation-generated events dedup here.
        Index("uq_event_idempotency_key", "tenant_id", "idempotency_key",
              unique=True, postgresql_where="idempotency_key IS NOT NULL"),
    )

    # ── original columns (unchanged) ──────────────────────────────────────────
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(80), nullable=False)          # lowercase substrate (legacy: "transition", "comment_added", …)
    entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)   # objectType (entity_def.key)
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)  # objectId
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)  # legacy user FK
    data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)     # payload
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())  # occurredAt

    # ── Event System extension — D1 (file 06, standard 19) ───────────────────
    # All nullable — legacy rows carry NULL; new emits set these where known.

    # eventName: "<Object>.<Action>" PascalCase (file 06).
    # E13: distinct from `type` (the legacy lowercase substrate string).
    # Old rows: NULL until the backfill job runs.
    event_name: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)

    # EventCategory (file 14 / E14/E21) — one of EVENT_CATEGORIES (16 UPPER_SNAKE values, above) or
    # NULL. Enforced in code at the single write path (workflow.emit), not just documented here.
    category: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Schema version — default 1; bump when payload shape changes.
    schema_version: Mapped[int | None] = mapped_column(SmallInteger, nullable=True, default=1, server_default="1")

    # ActorType (B3 / D5 — performer axis):
    # USER|SYSTEM|AUTOMATION|INTEGRATION|API|CUSTOMER
    # Default USER for backward compat with existing call sites that only pass actor_user_id.
    actor_type: Mapped[str | None] = mapped_column(String(20), nullable=True, default="USER", server_default="'USER'")

    # actor_id: canonical actor reference (UUID). For USER = actor_user_id value;
    # for SYSTEM/AUTOMATION/INTEGRATION there's no app_user FK — stored as plain UUID.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Department — the owning department at event time (B5 single accountable).
    department: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Visibility: PUBLIC|INTERNAL|RESTRICTED|SYSTEM (file 06).
    # Default INTERNAL — matches the platform's existing access posture.
    visibility: Mapped[str | None] = mapped_column(String(20), nullable=True, default="INTERNAL", server_default="'INTERNAL'")

    # Trace keys (M1 — internal trace keys, exempt from Reference Number Standard).
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Reference number EVT-000001 (B2 / S5). Populated by a background job for legacy rows;
    # new events get it at write time via _next_evt_ref() in workflow.emit.
    reference_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Idempotency key for integration/automation-generated events (file 06).
    # Partial UNIQUE on (tenant_id, idempotency_key) WHERE NOT NULL (see __table_args__).
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
