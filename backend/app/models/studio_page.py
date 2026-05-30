import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Integer, Index, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StudioPage(Base):
    """A logical page definition managed by Studio. One row per page per tenant."""
    __tablename__ = "studio_page"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(120), nullable=False)   # URL-safe slug
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class StudioPageVersion(Base):
    """An immutable snapshot of a StudioPage's full configuration at a point in time.

    version_no is monotonically incremented per (tenant_id, page_id).
    At most one version per page may have status='published' (enforced by partial unique index).
    diff is computed on publish vs. the previously published version (null for first publish).
    """
    __tablename__ = "studio_page_version"
    __table_args__ = (
        Index(
            "uq_studio_page_version_no",
            "tenant_id", "page_id", "version_no",
            unique=True,
        ),
        Index(
            "uq_studio_page_published",
            "tenant_id", "page_id",
            unique=True,
            postgresql_where="status = 'published'",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    page_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("studio_page.id"), nullable=False, index=True)
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")  # 'draft' | 'published'
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    diff: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
