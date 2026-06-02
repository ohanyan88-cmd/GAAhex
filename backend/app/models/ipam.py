"""NOC Phase C — IpAssignment: per-address IP lease detail.

Sits ON TOP of an existing PoolAllocation row (pool_allocation.id FK) and
captures the individual IP address, client MAC, lease times, and the service
or asset it serves.

A partial-unique index on (tenant_id, address) WHERE released_at IS NULL
prevents two simultaneously-active assignments for the same IP in a tenant.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, func, Index, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class IpAssignment(Base):
    """One assigned IP address, linked to a PoolAllocation row.

    family: 4 or 6.
    Released rows (released_at IS NOT NULL) are kept for history — a released
    address may be re-assigned (new row).
    """
    __tablename__ = "ip_assignment"
    __table_args__ = (
        # Only one ACTIVE (released_at IS NULL) assignment per (tenant, address)
        Index(
            "uq_ip_assignment_active",
            "tenant_id", "address",
            unique=True,
            postgresql_where=text("released_at IS NULL"),
        ),
        Index("ix_ip_assignment_service_id", "service_id"),
        Index("ix_ip_assignment_address_tenant", "address", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    pool_allocation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pool_allocation.id"), nullable=False, index=True
    )
    address: Mapped[str] = mapped_column(String(45), nullable=False)           # IPv4 or IPv6 text
    family: Mapped[int] = mapped_column(Integer, nullable=False)               # 4 or 6
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True
    )
    asset_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=True
    )
    mac: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
