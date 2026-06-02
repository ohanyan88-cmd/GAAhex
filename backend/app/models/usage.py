"""Usage metering + rating (billing depth, doc 18).

A UsageRecord is one metered consumption event (GB, minutes, messages, …). It carries its own rate,
so `amount = round(quantity * unit_rate)` in **luma** (AMD minor units, like the rest of billing).
Rating rolls a subscription's UNRATED usage into invoice lines (see routers/usage.py:rate_usage),
flipping `rated=True` and linking the invoice. Tenant + org scoped; needs RLS (tenant isolation).
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Boolean, Numeric, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class UsageRecord(Base):
    __tablename__ = "usage_record"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription.id"), nullable=True, index=True)
    # SPEC §6 Wave 1: tightened from "loose ref" to a typed FK with index. Backfill/orphan-check
    # is Wave 2; column stays nullable until Wave 4 NOT NULL gate.
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id", ondelete="RESTRICT"), nullable=True, index=True)
    metric: Mapped[str] = mapped_column(String(20), nullable=False)         # gb|minutes|messages|other
    quantity: Mapped[float] = mapped_column(Numeric(18, 4), nullable=False, default=0)  # units consumed (may be fractional)
    unit_rate: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)        # luma per unit
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)           # luma = round(quantity * unit_rate)
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)          # True once rolled into an invoice
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
