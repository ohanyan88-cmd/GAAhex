import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class NotificationPref(Base):
    """A user's per-channel opt-out. `category` holds either a notification category
    (system|billing|network|customer|internal) or a specific def_key (e.g. `lead.qualified`) —
    a disabled row for either suppresses delivery to this user on that channel. Default-on:
    absence of a row means deliver."""
    __tablename__ = "notification_pref"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "category", "channel", name="uq_notification_pref"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(120), nullable=False)          # a category name OR a def_key
    channel: Mapped[str] = mapped_column(String(40), nullable=False, default="inapp")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
