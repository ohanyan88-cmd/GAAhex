import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Boolean, Integer, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AutomationRule(Base):
    """A tenant-scoped automation rule that fires actions in response to record events.

    event_type ∈ create|update|transition|delete
    condition   : an optional GXL expression evaluated against the record context
    action      : {type: notify|set_field|webhook|emit_event, config: {...}}
    """
    __tablename__ = "automation_rule"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)   # create|update|transition|delete
    entity_key: Mapped[str] = mapped_column(String(80), nullable=False)
    condition: Mapped[str | None] = mapped_column(String(1000), nullable=True)  # GXL expression; None = always
    action: Mapped[dict] = mapped_column(JSONB, nullable=False)              # {type, config}
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
