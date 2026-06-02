"""Phase B.2 — Dunning engine: config-driven policies + case state machine + action log.

Three first-class physical tables, mirroring the billing/A.3 style (UUID PK, tenant_id, timestamps,
JSONB for free-form payloads, audit-friendly status fields):

* ``dunning_policy`` — config: ordered list of ``steps_json`` (day_offset + action + params).
  Action ∈ {'NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE'} (B1 enum standard — UPPER_SNAKE,
  normalised by migration ``7b1e0d3b41fd_dunning_action_verbs_upper_snake``).
  Exactly one is_default per tenant.
* ``dunning_case`` — runtime state machine per (account, triggering_invoice). Tracks
  ``current_step_index`` (-1 = not started) + ``next_action_at`` (when the sweep picks it up).
  Statuses: 'ACTIVE' | 'CURED' | 'ESCALATED' | 'CLOSED'  (B1 enum standard — UPPER_SNAKE).
* ``service_action_log`` — every adapter side-effect (NOTICE/THROTTLE/WALLED_GARDEN/TERMINATE/
  RESTORE — UPPER_SNAKE per B1) logs ONE row. v1 adapter is ``LoggingAdapter`` — no real
  RADIUS/BNG calls; it flips Service.status and writes the log row.

Doctrine:
  - Policy sequence is config (steps_json), never hardcoded. The runner reads steps_json on each
    advance — a Studio edit to a policy reshapes future advances on every active case.
  - Cure is the inverse path: paying off the account flips active cases to 'cured' and calls
    adapter.restore on any service the case suspended/throttled.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Text, Integer, Boolean, DateTime, ForeignKey, Index,
    UniqueConstraint, CheckConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DunningPolicy(Base):
    """Config-driven dunning sequence. ``steps_json`` is the canonical ordered step list."""
    __tablename__ = "dunning_policy"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_dunning_policy_tenant_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false",
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    # ordered ascending by day_offset; each step: {day_offset:int, action:str, params:dict}
    # action ∈ {'NOTICE','THROTTLE','WALLED_GARDEN','TERMINATE'} — UPPER_SNAKE per B1, normalised
    # by migration ``7b1e0d3b41fd_dunning_action_verbs_upper_snake`` (legacy lowercase rows folded
    # via jsonb_agg + jsonb_set in-place).
    steps_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    # nullable means "applies to all tariffs"
    applies_to_tariff_plan_ids: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now(),
    )


class DunningCase(Base):
    """Per-account runtime state machine. One open case per account+triggering_invoice."""
    __tablename__ = "dunning_case"
    __table_args__ = (
        Index("ix_dunning_case_sweep", "status", "next_action_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("account.id"), nullable=False, index=True,
    )
    triggering_invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=False, index=True,
    )
    policy_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dunning_policy.id"), nullable=False, index=True,
    )
    # -1 = not started; 0..N = step entered
    current_step_index: Mapped[int] = mapped_column(
        Integer, nullable=False, default=-1, server_default="-1",
    )
    step_entered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # when the scheduler should pick this up next
    next_action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ACTIVE", server_default="ACTIVE",
    )  # 'ACTIVE' | 'CURED' | 'ESCALATED' | 'CLOSED'  (B1 enum standard — UPPER_SNAKE)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    cured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)


class ServiceActionLog(Base):
    """One row per adapter side-effect. Doubles as audit trail + restore-targeting source."""
    __tablename__ = "service_action_log"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    # Nullable — some dunning targets aren't service-bound (notice email only).
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True, index=True,
    )
    dunning_case_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("dunning_case.id"), nullable=True, index=True,
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    # 'NOTICE' | 'THROTTLE' | 'WALLED_GARDEN' | 'TERMINATE' | 'RESTORE'  (B1 UPPER_SNAKE)
    adapter: Mapped[str] = mapped_column(String(40), nullable=False)
    # 'logging' (v1), later 'huawei_olt', 'freeradius', etc.
    request_payload: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}",
    )
    response_payload: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}",
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="queued", server_default="queued",
    )  # 'queued' | 'success' | 'failed'
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
