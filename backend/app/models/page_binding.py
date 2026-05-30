import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PageBinding(Base):
    """Tenant-scoped component-to-entity field binding for Studio pages.

    Records which component on a page is bound to which entity (and optionally which field).
    page_id is nullable — bindings may be created before the page itself is committed.
    One binding per (tenant, component_key, entity_slug, field_key); no unique constraint
    enforced here (the router deduplicates on POST if needed).
    """
    __tablename__ = "page_binding"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    page_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    component_key: Mapped[str] = mapped_column(String(255), nullable=False)
    entity_slug: Mapped[str] = mapped_column(String(255), nullable=False)
    field_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
