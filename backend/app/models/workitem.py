"""WorkItem module (Batch 32): field-dispatch work assignment tracker.

A WorkItem is a discrete unit of work (task, install, repair, survey) assigned to a user,
optionally tied to a customer record.  scheduled_at + location support field-dispatch boards.
Tenant + org scoped exactly like helpdesk; same RLS policy pattern.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class WorkItem(Base):
    """A unit of work assigned to a user and tracked to completion."""
    __tablename__ = "workitem"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="task")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="TODO")
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="NORMAL")
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True, index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): typed back-links so a work item can name the ticket /
    # service / asset / project / invoice it's tied to. asset_record_id and project_record_id are
    # polymorphic (filtered at app layer until Wave 5 lands the denormalized-entity_key CHECK).
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("helpdesk_ticket.id", ondelete="RESTRICT"), nullable=True, index=True)
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id", ondelete="RESTRICT"), nullable=True, index=True)
    asset_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="RESTRICT"), nullable=True, index=True)
    project_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="RESTRICT"), nullable=True, index=True)
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id", ondelete="RESTRICT"), nullable=True, index=True)
