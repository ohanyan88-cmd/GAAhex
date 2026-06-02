"""NOC Phase B — technician GPS location pings.

One row per ping. The technician is identified by ``technician_user_id`` (a regular
``user.id`` — no separate technician entity in M0; role/permissions define who can
ping). Coordinates are Numeric(9,6) — six decimal places ≈ 11cm of precision,
enough for field-tech tracking. heading/speed are optional so a low-resolution
client (e.g. browser geolocation) can ping without sensor data.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Integer, Numeric, ForeignKey, DateTime, func, Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TechnicianLocationPing(Base):
    """One GPS ping from a technician. lat in -90..90, lng in -180..180 (validated
    at the application layer)."""
    __tablename__ = "technician_location_ping"
    __table_args__ = (
        Index("ix_tech_ping_tenant_id", "tenant_id"),
        Index("ix_tech_ping_tech_recorded",
              "technician_user_id", "recorded_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    technician_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False,
    )
    lat: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    lng: Mapped[Decimal] = mapped_column(Numeric(9, 6), nullable=False)
    accuracy_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heading_deg: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_mps: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
