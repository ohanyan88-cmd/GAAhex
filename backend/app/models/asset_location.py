"""NOC Phase C — AssetLocationHistory: multi-location audit trail for asset Records.

Each row records a single move of an asset from one location to another.
The asset itself is a polymorphic Record(entity_key='asset').

location_type values: 'warehouse' | 'truck' | 'install_site' | 'hub' | 'unknown'
location_id is an opaque reference to the location's record (nullable — some locations
may not have a formal record yet).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, Index, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class AssetLocationHistory(Base):
    """One location-move event for one asset Record.

    Index on (asset_record_id, moved_at) supports chronological trail queries.
    """
    __tablename__ = "asset_location_history"
    __table_args__ = (
        Index("ix_asset_location_history_asset_time", "asset_record_id", "moved_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    asset_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False
    )
    from_location_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    from_location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    to_location_type: Mapped[str] = mapped_column(String(30), nullable=False)
    to_location_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    moved_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True
    )
    moved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    work_order_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
