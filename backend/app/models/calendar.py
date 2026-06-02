"""Calendar and CalendarEvent models (Batch 30)."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from sqlalchemy import String, Boolean, Text, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base

class UserCalendar(Base):
    """A named calendar owned by a user or shared with an org node."""
    __tablename__ = "user_calendar"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="#3A6FB5")  # hex
    is_shared: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class CalendarEvent(Base):
    """A single event on a calendar."""
    __tablename__ = "calendar_event"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user_calendar.id"), nullable=True, index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)  # override calendar color
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): soft-link a calendar event to the customer record or
    # helpdesk ticket it concerns, surfacing it on Customer/Ticket timelines.
    customer_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="SET NULL"), nullable=True, index=True)
    helpdesk_ticket_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("helpdesk_ticket.id", ondelete="SET NULL"), nullable=True, index=True)
