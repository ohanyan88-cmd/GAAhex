import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, func, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NotificationDef(Base):
    """Configuration of a notification type (e.g. `lead.assigned`). Lives above the Kernel Line:
    the kernel emits notifications from these definitions; what fires and how it reads is config."""
    __tablename__ = "notification_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_notification_def_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)              # e.g. "lead.assigned"
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    channel: Mapped[str] = mapped_column(String(40), nullable=False, default="inapp")
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="system", server_default="system")  # system|billing|network|customer|internal
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")      # critical|warning|info
    title_template: Mapped[str] = mapped_column(String(255), nullable=False)   # "{placeholder}" templates
    body_template: Mapped[str] = mapped_column(String(1000), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    gxl_condition: Mapped[str | None] = mapped_column(String(500), nullable=True)  # optional GXL guard
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """An instance in a user's inbox — what a recipient actually sees. Rendered from a
    NotificationDef at emit time, then immutable except for `read_at`."""
    __tablename__ = "notification"
    __table_args__ = (
        Index("ix_notification_user_read", "user_id", "read_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    def_key: Mapped[str] = mapped_column(String(120), nullable=False)          # the NotificationDef.key it came from
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)  # recipient
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="system", server_default="system")  # copied from the def at emit
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="info", server_default="info")      # copied from the def at emit
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(String(1000), nullable=False)
    entity_key: Mapped[str | None] = mapped_column(String(80), nullable=True)  # what it's about
    record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # ---- A26 inbox state + digest hand-off (additive; SHARED CONTRACT) ----
    # Set true at emit when the recipient's resolved mode is `digest`: the inbox row is still created
    # now, external delivery is deferred — lane E sends the digest and CLEARS this flag.
    digest_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
