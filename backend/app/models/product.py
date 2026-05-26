"""Product / Plan catalog (billing depth).

A Product is a sellable plan (e.g. "Fiber 100/100"). A Subscription may reference a Product and
copy its `default_amount`/`cycle` at creation — still editable per subscription afterwards. Money
is integer luma (AMD minor units), consistent with the billing core. Tenant-scoped; needs an RLS
policy like the other tenant tables (report)."""
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Boolean, ForeignKey, DateTime, func, Text, UniqueConstraint
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
    default_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)   # luma per cycle
    cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")    # monthly|yearly
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
