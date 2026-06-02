"""NOC Phase A — CPE (Customer-Premises Equipment) binding (Order pipeline stage 10).

A CpeBinding is the first-class record of "which ONT/router is sitting on the customer's wall
for which service". v1 uses the SimulatedAdapter (no real OLT provisioning call), so the binding
captures MAC + serial + vendor/model/firmware + the last provisioning payload that WOULD have
gone to the EMS — making the v2 swap to a real adapter a one-line wire-up.

Uniqueness:
  * UNIQUE (tenant_id, mac_address) WHERE status != 'replaced'
  * UNIQUE (tenant_id, serial)      WHERE status != 'replaced'

The 'replaced' state lets the operator swap a faulty CPE: the old row keeps audit value while the
(mac, serial) pair frees up for the replacement row. MAC format is validated at the application
layer (normalized to lowercase colon-separated octets).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import (
    String, ForeignKey, DateTime, func, Index, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class CpeBinding(Base):
    """A bound CPE on a service or in-flight order. status lifecycle: pending → provisioned →
    (replaced). 'failed' is reserved for adapter errors (v2+); v1's SimulatedAdapter never errors.
    """
    __tablename__ = "cpe_binding"
    __table_args__ = (
        # mac uniqueness scoped per tenant, excluding 'replaced' history rows
        Index(
            "uq_cpe_binding_tenant_mac_live",
            "tenant_id", "mac_address",
            unique=True,
            postgresql_where=text("status <> 'replaced'"),
        ),
        # same for serial
        Index(
            "uq_cpe_binding_tenant_serial_live",
            "tenant_id", "serial",
            unique=True,
            postgresql_where=text("status <> 'replaced'"),
        ),
        Index("ix_cpe_binding_service", "service_id"),
        Index("ix_cpe_binding_order", "order_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True,
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order.id"), nullable=True,
    )
    mac_address: Mapped[str] = mapped_column(String(40), nullable=False)
    serial: Mapped[str] = mapped_column(String(80), nullable=False)
    vendor: Mapped[str | None] = mapped_column(String(80), nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    firmware: Mapped[str | None] = mapped_column(String(80), nullable=True)
    provisioned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_payload_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # 'pending' | 'provisioned' | 'failed' | 'replaced'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
