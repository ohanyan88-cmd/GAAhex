import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PageConfig(Base):
    """A tenant-scoped, superadmin-editable descriptor for a BESPOKE page (not an entity).

    The "configure in place" mechanism: a rich, hand-built view (e.g. Services) keeps all of its
    bespoke data + tools, and layers a small presentation descriptor on top — a title override and
    per-column controls. One row per (tenant, page_key); `config` is an open JSON blob so each page
    can grow its own descriptor without a schema change.

    config shape (MVP, Services):
      {
        "title": str | null,                        # heading override; null = page default
        "columns": [                                 # per-column controls, in display order
          {"key": "name", "label": "Service", "visible": true},
          ...
        ]
      }
    """
    __tablename__ = "page_config"
    __table_args__ = (UniqueConstraint("tenant_id", "page_key", name="uq_page_config_tenant_page"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    page_key: Mapped[str] = mapped_column(String(80), nullable=False)   # e.g. "services"
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)         # presentation descriptor
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
