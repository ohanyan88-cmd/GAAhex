"""Phase A.1 — TariffPlan: priced rate-card used by usage/consumption billing.

Distinct from `Product` (a sellable plan with MRC/NRC). A TariffPlan describes the rates a
customer is billed against for measured usage — base monthly recurring + an included-units
allowance + per-unit overage + optional volume tiers.

`tiers_json` is a JSONB list of `{"from": int, "to": int|None, "rate": str(Decimal)}` brackets.
`overage_rate` is the flat per-unit rate above the allowance (used when no tiered curve is set);
`tiers_json` takes precedence when both are present (rating engine decision deferred — out of scope
for A.1).

Money lives as Decimal (Numeric) here because tariff math is per-unit and per-bracket; the integer
luma convention applies only to Subscription/Invoice/Payment totals, not to per-unit rate cards.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, func, Numeric, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TariffPlan(Base):
    """A first-class tariff plan / rate-card row (tenant-scoped, `key`-uniqued).

    `active` is the soft-delete flag — DELETE flips it to False, never removes the row.
    """
    __tablename__ = "tariff_plan"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_tariff_plan_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_recurring_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    included_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    overage_rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    tiers_json: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    cycle: Mapped[str] = mapped_column(String(20), nullable=False, server_default="monthly")
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
