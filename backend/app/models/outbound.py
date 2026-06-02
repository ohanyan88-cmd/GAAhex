"""Outbound delivery log (notification channel adapters, doc 24).

Every external-channel send (email/sms/webhook/console…) records one OutboundMessage — the
observable, queryable record of what GAAhex tried to send and whether it worked. In-app
notifications are NOT logged here: the inbox `Notification` row is itself the delivery."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Text, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class OutboundMessage(Base):
    __tablename__ = "outbound_message"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(40), nullable=False)                   # inapp|email|sms|webhook|console
    to_addr: Mapped[str | None] = mapped_column(String(255), nullable=True)            # email / phone / — (channel-specific)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="SENT")    # SENT|FAILED|QUEUED
    def_key: Mapped[str | None] = mapped_column(String(120), nullable=True)            # the NotificationDef it came from
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)  # recipient
    error: Mapped[str | None] = mapped_column(Text, nullable=True)                     # failure detail (status=FAILED)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
