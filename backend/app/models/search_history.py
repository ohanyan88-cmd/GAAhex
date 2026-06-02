from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Boolean, ForeignKey, DateTime, func, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SearchHistory(Base):
    """Per-user recent search history with optional pin promotion.

    Stores the raw query string plus optional entity scope. Newest-first order uses `queried_at`.
    A user can pin any recent entry (pinned=True) so it survives the cap-based eviction that
    trims unpinned rows to RECENT_CAP. Tenant-scoped + user-scoped; carries tenant_isolation RLS.
    """
    __tablename__ = "search_history"
    __table_args__ = (
        Index("ix_search_history_user_queried", "user_id", "queried_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    query: Mapped[str] = mapped_column(String(500), nullable=False)
    entity: Mapped[str | None] = mapped_column(String(80), nullable=True)   # optional entity scope
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    queried_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
