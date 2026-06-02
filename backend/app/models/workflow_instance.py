"""SPEC §5 Universal Workflow Contract — runtime instance.

A `WorkflowInstance` is one running execution of a `WorkflowDef` (W1-W5 from SPEC §5.4).
The `_def` row is the immutable template (trigger, conditions, actions, owner, SLA, …);
the `_instance` row is the mutable state machine that records what actually happened.

State machine (forward-only — mirrors the §4.5 Approval shape):
    running  (default)
      -> completed   (all actions ran, status='completed')
      -> failed      (an action raised; failure_reason populated; failure_action consulted)
      -> escalated   (SLA breached or failure_action='escalate'; sla_breached_at populated)

Append-only audit (SPEC §0.4):
    Every transition emits an `Event` via `workflow.emit` so the audit log carries
    the full instance lifecycle. The `context` JSON column accumulates per-action
    results so later actions can chain (e.g. `create_pipeline_item` returns the
    record_id, which `advance_stage` consumes).

Tenant-scoping: standard NULLIF-guarded RLS policy applied by the Step 4 migration
(`7a4b1e9c2f08`), matching every other post-RLS-flip operational table.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class WorkflowInstance(Base):
    """Runtime instance of a workflow_def. Append-only state machine.

    Status transitions:
        running -> completed
        running -> failed (failure_reason populated)
        running -> escalated (sla_breached_at populated OR failure_action='escalate')

    `current_action_index` points at the NEXT action to execute (0 when the workflow
    has just been triggered, len(actions) when complete). `context` accumulates
    structured data each action emits so later actions can chain on prior results.
    """
    __tablename__ = "workflow_instance"
    __table_args__ = (
        Index("ix_workflow_instance_tenant_status", "tenant_id", "status"),
        Index("ix_workflow_instance_key", "tenant_id", "workflow_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    # FK by-key to workflow_def (not by id) so the instance survives a def re-seed and stays
    # readable when the def row is later swapped. Matches how `kpi_def.bound_stage_key` works.
    workflow_key: Mapped[str] = mapped_column(String(120), nullable=False)
    # What record (if any) triggered this workflow — a lead created, a ticket opened, etc.
    triggered_by_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # running | completed | failed | escalated
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    # Index into actions_spec — points at the NEXT action to run.
    current_action_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Accumulating state — each action appends its result keyed by index.
    context: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    # Populated when the SLA budget runs out (set on-demand today; async monitor lands later).
    sla_breached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
