"""NOC Phase B — optical-power telemetry + OTDR test records.

Polymorphic ``source_type`` / ``target_type`` discriminates whether a row points at
an ``olt_port.id`` or an ``onu.id`` — no DB-level FK because we want either kind to
participate without a polymorphic-table-per-type schema. Application-layer validation
keeps source_id pointing at a valid row of the declared type.

v1 telemetry is produced by ``SimulatedDiagnosticAdapter`` (deterministic synthetic
values). The model itself is adapter-agnostic — a v2 real-EMS adapter writes into the
same shape.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    String, Numeric, ForeignKey, DateTime, func, Index, Text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class OpticalPowerSample(Base):
    """A single Rx/Tx optical-power reading taken at ``sampled_at`` against either
    an OLT port or an ONU. Decimal(6,2) covers -30.00..+5.00 dBm comfortably."""
    __tablename__ = "optical_power_sample"
    __table_args__ = (
        Index("ix_optical_sample_tenant_id", "tenant_id"),
        Index("ix_optical_sample_source_time",
              "source_type", "source_id", "sampled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    # 'olt_port' | 'onu'
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    rx_dbm: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    tx_dbm: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    sampled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class OtdrTest(Base):
    """One OTDR (Optical Time-Domain Reflectometer) run against an OLT port or ONU.
    v1 is synchronous: the request flips queued → done in one call with the simulator's
    deterministic trace result in ``result_json``."""
    __tablename__ = "otdr_test"
    __table_args__ = (
        Index("ix_otdr_tenant_id", "tenant_id"),
        Index("ix_otdr_target", "target_type", "target_id"),
        Index("ix_otdr_status_requested", "status", "requested_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    # 'olt_port' | 'onu'
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # 'queued' | 'running' | 'done' | 'failed'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    requested_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True,
    )
    # {trace_distance_m: int, loss_db: float, events: [...], status: 'pass'|'fail'}
    result_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
