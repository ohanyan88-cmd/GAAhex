"""IPAM / resource pools (network depth, doc 19) — managed inventory you allocate from.

A ResourcePool is a block (a CIDR, a VLAN range, a phone-number range…) you hand values out of;
each PoolAllocation is one handed-out value, optionally bound to a Service. Released allocations
keep their row for history (status RELEASED), freeing the value for re-allocation. Additive depth
over the thin Service domain — still inventory, not a live network controller.

Mirrors service/record style (UUID, tenant_id, owner_node_id, timestamps); tenant + org scoped."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, ForeignKey, DateTime, func, Index, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ResourcePool(Base):
    """A block of allocatable identifiers. `spec` is freeform JSONB — e.g. {"cidr":"10.0.0.0/24"}
    for ipv4/ipv6, or {"from":"100","to":"200"} for vlan/phone."""
    __tablename__ = "resource_pool"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)                       # ipv4|ipv6|vlan|phone|other
    spec: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)             # {cidr:...} | {from:...,to:...}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6.1 Wave 1 splitter bridge (additive, nullable): the physical Asset record this pool
    # was carved from (e.g. a physical splitter whose strands are the allocated values). Polymorphic
    # (filtered to entity_key='asset' at app layer until Wave 5).
    physical_asset_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="SET NULL"), nullable=True, index=True)


class PoolAllocation(Base):
    """One value handed out from a pool. Unique per (pool, value) WHILE ALLOCATED — a released value
    can be re-allocated (a new row), and the old RELEASED row is kept for history."""
    __tablename__ = "pool_allocation"
    __table_args__ = (
        # at most one ALLOCATED row per (pool, value); RELEASED rows are unconstrained (history)
        Index("uq_pool_alloc_active", "pool_id", "value", unique=True,
              postgresql_where=text("status = 'ALLOCATED'")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    pool_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resource_pool.id"), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(120), nullable=False)                     # the allocated identifier
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ALLOCATED")  # ALLOCATED|RELEASED
    allocated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
