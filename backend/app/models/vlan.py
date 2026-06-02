"""NOC Phase A — VLAN assignment linkage (Order pipeline stage 9).

A VlanAssignment ties one ``PoolAllocation`` row (the existing IPAM/respool kind='vlan' value)
to a service + the optional in-flight order, and tags it with a service-purpose discriminator
(data | voip | iptv | mgmt). The existing PoolAllocation owns the actual VLAN value + the
allocation-status; this row sits ON TOP of it for service-level lookups and the small bit of
metadata (purpose) that doesn't belong on the generic IPAM row.

One-to-one with ``PoolAllocation`` (UNIQUE pool_allocation_id) — never two VlanAssignment rows
pointing at the same allocation.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import (
    String, ForeignKey, DateTime, func, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class VlanAssignment(Base):
    """One VLAN handed out to one service for a specific purpose. ``pool_allocation_id`` is the
    PoolAllocation row in the existing ``resource_pool`` (kind='vlan') that holds the actual VLAN
    value (e.g. "100"). released_at is set when the VLAN is returned to the pool (the underlying
    PoolAllocation flips to RELEASED as part of that same release)."""
    __tablename__ = "vlan_assignment"
    __table_args__ = (
        UniqueConstraint("pool_allocation_id", name="uq_vlan_assign_pool_allocation"),
        Index("ix_vlan_assign_service_purpose", "service_id", "purpose"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    pool_allocation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pool_allocation.id"), nullable=False, index=True,
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True, index=True,
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order.id"), nullable=True, index=True,
    )
    # 'data' | 'voip' | 'iptv' | 'mgmt'
    purpose: Mapped[str] = mapped_column(String(20), nullable=False, default="data")
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
