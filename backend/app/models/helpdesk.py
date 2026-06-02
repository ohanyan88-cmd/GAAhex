"""Helpdesk module (Batch 31): HelpdeskQueue + HelpdeskTicket.

First-class BSS tables (not config-driven Records) — same tenant_id + owner_node_id scoping
and workflow.emit audit pattern as billing. Tickets track SLA via sla_due_at / sla_breached;
the SLA sweep (routers/helpdesk.py:run_sla_breach_sweep) runs as a scheduled job.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, Boolean, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class HelpdeskQueue(Base):
    """A logical inbox/queue that tickets are routed into (e.g. 'Tier-1', 'Network NOC')."""
    __tablename__ = "helpdesk_queue"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_sla_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HelpdeskTicket(Base):
    """A support ticket, optionally queued, assigned to an agent, and SLA-tracked."""
    __tablename__ = "helpdesk_ticket"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    queue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("helpdesk_queue.id"), nullable=True, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="NORMAL")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")
    assigned_agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sla_breached: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): typed links from ticket → service / invoice / payment /
    # asset record. asset_record_id is polymorphic (filtered to entity_key='asset' at app layer
    # until Wave 5 lands the denormalized-entity_key CHECK).
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id", ondelete="RESTRICT"), nullable=True, index=True)
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id", ondelete="RESTRICT"), nullable=True, index=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("payment.id", ondelete="RESTRICT"), nullable=True, index=True)
    asset_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="RESTRICT"), nullable=True, index=True)
