"""Portal ticket replies — customer-side messages on HelpdeskTickets.

Kept separate from staff Interaction (which requires a non-null agent_user_id) because portal
replies originate from customers, not staff agents. Linked to helpdesk_ticket by UUID reference.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PortalTicketReply(Base):
    __tablename__ = "portal_ticket_reply"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("helpdesk_ticket.id"), nullable=False, index=True
    )
    customer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("customer_user.id"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    direction: Mapped[str] = mapped_column(String(20), nullable=False, default="inbound")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
