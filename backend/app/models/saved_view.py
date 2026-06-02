from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SavedViewDef(Base):
    """A saved list configuration for an entity — search/filter/sort/columns the user reuses.

    `owner_user_id` NULL ⇒ a shared/tenant-wide view; otherwise it belongs to that user. `config`
    is the same shape the list endpoint reads: {q?, filter?, sort?, columns?}."""
    __tablename__ = "saved_view_def"
    __table_args__ = (
        Index("ix_saved_view_def_tenant_entity", "tenant_id", "entity_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    entity_key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    config: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)   # {q?, filter?, sort?, columns?}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
