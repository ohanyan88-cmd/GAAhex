"""Task Standard (file 05) — first-class accountable work entity.

Additive only — WorkItem (field-dispatch tracker, Batch 32) is PRESERVED unchanged.
Task and WorkItem are separate models for separate concepts:
  - WorkItem = field-dispatch unit (Install Board, NOC, field ops)
  - Task = accountable work item with owner, assignee, SLA, dependencies, audit chain

Reference numbers: TSK-000001 per-tenant. Uses SELECT COUNT(*)+1 pattern
(same as INV-/ORD-); the UNIQUE index on (tenant_id, reference_number) makes
concurrent collisions fail-safe — a create fails rather than duplicates.
SELECT-COUNT race is a tracked platform gap to be closed by a per-tenant
sequence counter when the reference-number generator is standardised platform-wide.

Owner / assignee principal type: EMPLOYEE | ROLE | DEPARTMENT | QUEUE (D12 Task subset;
note: QUEUE is allowed here for owner/assignee, unlike Watcher where QUEUE is excluded).

Auto-watch E15 (QUEUE resolution):
  When owner_type or assignee_type is QUEUE, E15 (file 05) says auto-watch resolves
  to the queue's owning department (the DEPARTMENT watcher is created, not the queue
  itself, because QUEUE is not a valid watcher type per D12). The current HelpdeskQueue
  model has `owner_node_id` (OrgNode FK) but NO `owning_department` string field. This
  is a GAP — the router auto-watch path surfaces this at create time:
    - if owner_type=QUEUE: look up HelpdeskQueue.owner_node_id → derive department from
      OrgNode.type/code, create a DEPARTMENT watcher for that node.
    - If the queue has no owner_node_id, the auto-watch for that principal is SKIPPED
      and a warning is logged — never silently wrong, never silently missing.

Hard validation rules (8, all enforced at the router write path):
  1. no active task without owner (owner_id must resolve)
  2. no active task without primary assignee (assignee_id must resolve)
  3. no OBJECT_LINKED task without parent (parent_entity_type + parent_entity_id)
  4. no COMPLETED without completedAt + completedBy + resolution
  5. no CANCELLED without cancellationReason + resolution (BOTH required)
  6. no BLOCKED without blockedReason
  7. no duplicate active reference_number per tenant (DB UNIQUE enforces; router pre-checks)
  8. no value outside its enum (all enum columns validated at write)

No per-task hold column — per the locked Data Retention design decision (Watcher
session): hold is a target-object invariant, centralised in the upcoming Legal Hold
registry; do not add per-entity hold columns.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Index, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Task(Base):
    """First-class accountable work item (file 05 — Task Standard).

    B4: task events project onto both the Task timeline AND the parent object timeline
    (when task_scope=OBJECT_LINKED) as views of the single Event System store.
    """
    __tablename__ = "task"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_task_reference_number"),
        Index("ix_task_status",   "tenant_id", "status"),
        Index("ix_task_assignee", "tenant_id", "assignee_type", "assignee_id"),
        Index("ix_task_parent",   "tenant_id", "parent_entity_type", "parent_entity_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    reference_number: Mapped[str] = mapped_column(String(20), nullable=False)  # TSK-000001

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    # 34-value enum (file 05): GENERAL | FOLLOW_UP | REVIEW | APPROVAL_PREP | CALL_CUSTOMER |
    # CONTACT_VENDOR | COLLECT_DOCUMENT | VERIFY_DOCUMENT | VERIFY_PAYMENT | PAYMENT_FOLLOW_UP |
    # CHECK_SERVICE | CONFIGURE_DEVICE | INSTALLATION | MAINTENANCE | FIELD_VISIT | SITE_SURVEY |
    # NETWORK_CHECK | OUTAGE_INVESTIGATION | INCIDENT_ACTION | PROBLEM_INVESTIGATION | CHANGE_PREP |
    # CHANGE_EXECUTION | RELEASE_PREP | RELEASE_VALIDATION | ESCALATION_ACTION | CUSTOMER_UPDATE |
    # INTERNAL_HANDOFF | QUALITY_CHECK | COMPLIANCE_REVIEW | LEGAL_REVIEW | FINANCE_REVIEW |
    # MANAGER_REVIEW | DATA_CORRECTION | KNOWLEDGE_UPDATE
    task_type: Mapped[str] = mapped_column(String(40), nullable=False, default="GENERAL")
    task_scope: Mapped[str] = mapped_column(String(20), nullable=False, default="STANDALONE")  # OBJECT_LINKED|STANDALONE
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")            # OPEN|IN_PROGRESS|BLOCKED|WAITING|COMPLETED|CANCELLED
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="MEDIUM")        # LOW|MEDIUM|HIGH|URGENT

    # Polymorphic parent — required when task_scope=OBJECT_LINKED (hard-validation rule 3).
    parent_entity_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parent_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Owner + assignee — PrincipalType subset for Task (D12): EMPLOYEE|ROLE|DEPARTMENT|QUEUE.
    # QUEUE is valid here (unlike Watcher where QUEUE is excluded). E15: QUEUE owner/assignee
    # auto-watch resolves to the queue's owning department — see module docstring for the gap note.
    owner_type: Mapped[str] = mapped_column(String(20), nullable=False)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    assignee_type: Mapped[str] = mapped_column(String(20), nullable=False)
    assignee_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)       # FK when SLA module ships
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_status: Mapped[str] = mapped_column(String(20), nullable=False, default="NOT_APPLICABLE")  # ON_TRACK|AT_RISK|BREACHED|PAUSED|NOT_APPLICABLE

    # BLOCKED state — hard-validation rule 6: blockedReason required when status=BLOCKED.
    blocked_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    blocked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)

    # WAITING state
    waiting_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    waiting_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # COMPLETED terminal — hard-validation rule 4: completedAt + completedBy + resolution required.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    completion_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # CANCELLED terminal — hard-validation rule 5: cancellationReason + resolution both required.
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Resolution — required on COMPLETED and CANCELLED.
    # Values: DONE | NOT_NEEDED | DUPLICATE | CANNOT_COMPLETE | INVALID | MERGED
    resolution: Mapped[str | None] = mapped_column(String(30), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    # updated_at is set explicitly at the router write path (onupdate= is not safe with asyncpg)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`.
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TaskDependency(Base):
    """Directed dependency between two tasks (file 05 — dependency_type enum).

    Dependency types: BLOCKED_BY | BLOCKS | RELATED_TO | DUPLICATES | DUPLICATED_BY.
    CASCADE on both FKs so dependencies are cleaned up when either task is deleted.
    Cycle detection is enforced router-side at add time (no DB-level constraint for
    cycles in a directed graph).

    The UNIQUE constraint prevents duplicate (from, to, type) pairs; a reverse relation
    (A BLOCKS B  ↔  B BLOCKED_BY A) is semantically equivalent but stored separately
    when created — the router may optionally create the mirror, but it's not required.
    """
    __tablename__ = "task_dependency"
    __table_args__ = (
        UniqueConstraint("tenant_id", "from_task_id", "to_task_id", "dependency_type",
                         name="uq_task_dependency"),
        Index("ix_task_dependency_to", "tenant_id", "to_task_id"),  # "what blocks this task?"
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    from_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("task.id", ondelete="CASCADE"), nullable=False, index=True)
    to_task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("task.id", ondelete="CASCADE"), nullable=False)
    dependency_type: Mapped[str] = mapped_column(String(20), nullable=False)  # BLOCKED_BY|BLOCKS|RELATED_TO|DUPLICATES|DUPLICATED_BY
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
