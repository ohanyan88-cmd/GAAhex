"""NOC Phase C — FiberRoute + OutagePath.

FiberRoute stores the physical fiber path as WKT text (not a PostGIS geometry column at
the ORM level — we store TEXT and let raw SQL queries cast when spatial queries are needed).
OutagePath links an existing outage Record to a FiberRoute with an optional cut-point WKT.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, func, Index, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class FiberRoute(Base):
    """A physical fiber path between two Points-of-Presence.

    geo_path: WKT text e.g. 'LINESTRING(44.5 40.2, 44.6 40.3, ...)'. Stored as TEXT;
    spatial queries can CAST to geometry(LineString) inside raw SQL when PostGIS is available.
    status: 'active' | 'planned' | 'cut' | 'retired'
    """
    __tablename__ = "fiber_route"
    __table_args__ = (
        Index("ix_fiber_route_tenant_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    geo_path: Mapped[str | None] = mapped_column(Text, nullable=True)          # WKT LINESTRING
    capacity_gbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    origin_pop: Mapped[str | None] = mapped_column(String(200), nullable=True)
    destination_pop: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False,
        server_default=func.now(), onupdate=func.now()
    )


class OutagePath(Base):
    """Links an existing outage Record to a FiberRoute; optionally records where the cut is.

    cut_location_wkt: WKT POINT e.g. 'POINT(44.5 40.2)' — stored as TEXT.
    """
    __tablename__ = "outage_path"
    __table_args__ = (
        Index("ix_outage_path_outage_record_id", "outage_record_id"),
        Index("ix_outage_path_fiber_route_id", "fiber_route_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    outage_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False
    )
    fiber_route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fiber_route.id"), nullable=False
    )
    cut_location_wkt: Mapped[str | None] = mapped_column(Text, nullable=True)   # WKT POINT
    cut_distance_from_origin_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
