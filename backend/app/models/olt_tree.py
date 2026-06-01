"""NOC Phase B — first-class OLT structural tree (chassis → card → port → ONU).

The OLT itself remains a polymorphic ``Record(entity_key='olt')`` so it stays
config-driven like every other inventory asset. Sub-structures live in dedicated
tables because their integrity needs (UNIQUE slot numbers, partial uniques on live
ONU serials, status indexes) are not expressible on the generic Record JSONB blob.

Lifecycle is soft: ``status='removed'`` is a tombstone — dependent rows are NOT
physically deleted (so audit trails + downstream FK references survive).

Mirrors the splitter/cpe_binding style: UUID PK, tenant-scoped, timestamp-naive on
the small status enums, partial-unique on live ONU serials.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Integer, ForeignKey, DateTime, func, Index, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class OltChassis(Base):
    """One chassis under one OLT Record. UNIQUE (olt_record_id, slot_no)."""
    __tablename__ = "olt_chassis"
    __table_args__ = (
        UniqueConstraint("olt_record_id", "slot_no", name="uq_olt_chassis_slot"),
        Index("ix_olt_chassis_tenant_id", "tenant_id"),
        Index("ix_olt_chassis_olt_record_id", "olt_record_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    olt_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False,
    )
    slot_no: Mapped[int] = mapped_column(Integer, nullable=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # 'active' | 'standby' | 'failed' | 'removed'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    installed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class OltCard(Base):
    """One card in one chassis. UNIQUE (chassis_id, slot_no)."""
    __tablename__ = "olt_card"
    __table_args__ = (
        UniqueConstraint("chassis_id", "slot_no", name="uq_olt_card_slot"),
        Index("ix_olt_card_tenant_id", "tenant_id"),
        Index("ix_olt_card_chassis_id", "chassis_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    chassis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("olt_chassis.id"), nullable=False,
    )
    slot_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'GPON' | '10GE' | 'XGS-PON' | 'CONTROL' | 'POWER'
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    port_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # 'active' | 'standby' | 'failed' | 'removed'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    fw_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class OltPort(Base):
    """One physical port on one card. UNIQUE (card_id, port_no). Composite index
    on (status, last_polled_at) for staleness queries from the dashboard rollup."""
    __tablename__ = "olt_port"
    __table_args__ = (
        UniqueConstraint("card_id", "port_no", name="uq_olt_port_no"),
        Index("ix_olt_port_tenant_id", "tenant_id"),
        Index("ix_olt_port_card_id", "card_id"),
        Index("ix_olt_port_status_polled", "status", "last_polled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    card_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("olt_card.id"), nullable=False,
    )
    port_no: Mapped[int] = mapped_column(Integer, nullable=False)
    # 'GPON' | '10GE' | 'XGS-PON'
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    # 'up' | 'down' | 'admin_down' | 'fault'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="up")
    last_polled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )


class Onu(Base):
    """One Optical Network Unit served from a particular OLT port. Customer/service
    binding is nullable — an ONU can be racked-but-unprovisioned (no customer yet).

    Uniqueness: (tenant_id, serial) WHERE status != 'removed'. The 'removed' state
    frees the serial for re-binding without losing audit history.
    """
    __tablename__ = "onu"
    __table_args__ = (
        Index(
            "uq_onu_tenant_serial_live",
            "tenant_id", "serial",
            unique=True,
            postgresql_where=text("status <> 'removed'"),
        ),
        Index("ix_onu_tenant_id", "tenant_id"),
        Index("ix_onu_port_id", "port_id"),
        Index("ix_onu_customer_id", "customer_id"),
        Index("ix_onu_service_id", "service_id"),
        Index("ix_onu_status_last_seen", "status", "last_seen_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False,
    )
    port_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("olt_port.id"), nullable=False,
    )
    serial: Mapped[str] = mapped_column(String(80), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=True,
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True,
    )
    distance_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 'active' | 'los' | 'dying_gasp' | 'offline' | 'removed'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
