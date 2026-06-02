"""Escalation Standard (file 02 / file 14) — first-class Escalation entity.

An Escalation tracks when work is escalated due to SLA breach, status stuck,
priority increase, or other triggers. It is a *move/reassignment* of the source
assignment, NOT a duplicate (D11 — escalation is a move/reassignment, not a
second membership). The source assignment is reassigned to the target; no second
parallel ownership is created.

Polymorphic source + target (no FK, matches the Approval / Attachment / SLA /
Watcher precedent):
  - source_entity_type + source_entity_id      the object being escalated
                                                (ticket, task, helpdesk_ticket, sla, etc.)
  - target_type + target_id                    the destination
                                                (user, department, queue, role, etc.)

triggered_by + resolved_by are real users (FK app_user.id).

Status lifecycle:
  PENDING (default on create)
    -> ACTIVE      (activate endpoint — escalation now in effect)
    -> CANCELLED   (cancel endpoint  — escalation never took effect)
  ACTIVE
    -> RESOLVED    (resolve endpoint — escalation has been worked through,
                     requires a resolution_note + sets resolved_at + resolved_by)
    -> CANCELLED   (cancel endpoint  — escalation withdrawn after taking effect)

RESOLVED + CANCELLED are terminal. Idempotent: activate-of-active and
resolve-of-resolved both return 200 without side effects.

Enums (file 14):
  EscalationTrigger : SLA_BREACH | STATUS_STUCK_TOO_LONG | MANUAL_ESCALATION |
                     PRIORITY_INCREASE | CUSTOMER_COMPLAINT | REVENUE_IMPACT |
                     VIP_CUSTOMER | CONFIGURABLE_RULES
  EscalationTarget  : NEXT_MANAGER | DEPARTMENT_MANAGER | SPECIFIC_USER |
                     ESCALATION_QUEUE
  EscalationLevel   : LEVEL_1 | LEVEL_2 | LEVEL_3 | LEVEL_4
  EscalationStatus  : PENDING | ACTIVE | RESOLVED | CANCELLED

Permission: escalation.manage (single cross-cutting key, file 15).

Substrate emit pinned to the SOURCE entity (so the source object's timeline
projects escalation events per B4):
  escalation_created | escalation_activated | escalation_resolved |
  escalation_cancelled
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


# Enum value sets (file 14 — Enum Registry).
ESCALATION_TRIGGERS = frozenset({
    "SLA_BREACH", "STATUS_STUCK_TOO_LONG", "MANUAL_ESCALATION",
    "PRIORITY_INCREASE", "CUSTOMER_COMPLAINT", "REVENUE_IMPACT",
    "VIP_CUSTOMER", "CONFIGURABLE_RULES",
})
ESCALATION_TARGETS = frozenset({
    "NEXT_MANAGER", "DEPARTMENT_MANAGER", "SPECIFIC_USER", "ESCALATION_QUEUE",
})
ESCALATION_LEVELS = frozenset({
    "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4",
})
ESCALATION_STATUSES = frozenset({
    "PENDING", "ACTIVE", "RESOLVED", "CANCELLED",
})


class Escalation(Base):
    """A first-class Escalation record (file 02 / file 14 — Escalation Standard).

    Escalation is a MOVE, not a duplicate (D11): the source assignment is
    reassigned to the target; no second parallel membership is created.

    source_entity_type + source_entity_id are polymorphic (no FK, matches
    Approval precedent — see app/models/approval.py:58, 66). The source object
    can be a ticket, task, helpdesk_ticket, sla, work_item, etc.

    target_id is also polymorphic (no FK) so the same column covers all
    EscalationTarget kinds — a user UUID, an org-node UUID, an escalation-queue
    UUID, etc. The interpretation is driven by target_type.

    Status lifecycle (router-enforced):
        PENDING -> ACTIVE (activate)
        PENDING -> CANCELLED (cancel)
        ACTIVE  -> RESOLVED (resolve, sets resolved_at + resolved_by + resolution_note)
        ACTIVE  -> CANCELLED (cancel)
    RESOLVED and CANCELLED are terminal. activate-of-ACTIVE and resolve-of-RESOLVED
    are idempotent (no-op return).
    """
    __tablename__ = "escalation"
    __table_args__ = (
        # "All escalations on this ticket/task/sla"
        Index("ix_escalation_source", "tenant_id", "source_entity_type", "source_entity_id"),
        # Status sweep (e.g. find all ACTIVE escalations for the dashboard).
        Index("ix_escalation_status", "tenant_id", "status"),
        # Trigger filter (analytics: SLA_BREACH rate, manual-escalation count).
        Index("ix_escalation_trigger", "tenant_id", "trigger"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)

    # Polymorphic source (Approval / Attachment / SLA precedent — no FK, indexed).
    source_entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Trigger (8-value enum, file 14 EscalationTrigger).
    trigger: Mapped[str] = mapped_column(String(40), nullable=False)

    # Target (polymorphic — type + id; no FK because target_id covers user,
    # department, queue, etc. depending on target_type).
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)

    # Level (4-value enum, file 14 EscalationLevel).
    level: Mapped[str] = mapped_column(String(20), nullable=False)

    # Status (4-value enum, file 14 EscalationStatus).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", server_default="'PENDING'")

    # Optional human-readable reason supplied on create.
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Trigger lifecycle.
    triggered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    triggered_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)

    # Resolution lifecycle — set on RESOLVED transition.
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
