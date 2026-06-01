"""Product / Plan catalog (billing depth).

A Product is a sellable plan (e.g. "Fiber 100/100"). A Subscription may reference a Product and
copy its `default_amount`/`cycle` at creation — still editable per subscription afterwards. Money
is integer luma (AMD minor units), consistent with the billing core. Tenant-scoped; needs an RLS
policy like the other tenant tables (report).

Phase A.1 adds the BSS/OSS MRC/NRC pair (`recurring_price`, `one_time_price`) + `proration_mode`
as Decimal columns. `default_amount` is **kept** as a fallback for products that haven't been
migrated to the Decimal price columns yet (and for legacy subscriptions/invoices that still copy
the integer-luma amount). New code should write recurring_price/one_time_price; readers should
prefer those and fall back to default_amount only when both are NULL.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, func, Text, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Product(Base):
    __tablename__ = "product"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_product_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)            # machine ref, unique per tenant
    name: Mapped[str] = mapped_column(String(160), nullable=False)          # display name
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Legacy fallback amount (integer luma per cycle). Pre-A.1 code wrote this; new code should write
    # recurring_price/one_time_price below and only fall back here when both Decimal columns are NULL.
    default_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)   # luma per cycle
    cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")    # monthly|yearly
    # Phase A.1 — MRC (Monthly Recurring Charge) + NRC (Non-Recurring Charge) as Decimal money.
    # NULL = not set on this product (use default_amount fallback or charge zero NRC).
    recurring_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    one_time_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Phase A.1 — proration mode controls how a partial cycle is billed when a subscription starts
    # or stops mid-cycle: 'daily' = pro-rate by days, 'secondly' = pro-rate by seconds (high-precision
    # for hourly/metered use cases), 'none' = always full-cycle. Default 'daily'.
    proration_mode: Mapped[str] = mapped_column(String(20), nullable=False, server_default="daily")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
