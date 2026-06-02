from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Record(Base):
    """A config-driven entity instance. Hybrid storage: core system columns + a JSONB `data`
    bag for the config-defined fields. One table holds every entity type (entity_key)."""
    __tablename__ = "record"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    entity_key: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # Deletion / Archive / Restore Standard (file 12 — D14). `deletion_state` is a separate
    # field from lifecycle `status`; both may hold value ACTIVE. 5-value enum:
    # ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE, NOT NULL.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
