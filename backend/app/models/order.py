"""Orders / provisioning (Phase-2 vertical, doc 28).

An Order captures what a customer is buying; on COMPLETED it provisions — each item that references
a catalog Product spins up an ACTIVE Subscription (the order→provision→billing bridge). Money is
integer luma (AMD), consistent with billing. Tenant + org scoped; emits audit Events.

NOTE: the table is named "order" (a SQL reserved word) — SQLAlchemy quotes it automatically. The
coordinator's migration + any RLS policy must quote it too ("order")."""
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Integer, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Order(Base):
    """A sales/provisioning order. `total` is derived from its items (kept in sync on write)."""
    __tablename__ = "order"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # additive (17a) — null = pre-Account row; resolve via customer_id
    number: Mapped[str] = mapped_column(String(40), nullable=False)                    # per-tenant ref, e.g. ORD-00007
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")   # DRAFT|SUBMITTED|PROVISIONING|COMPLETED|CANCELLED
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)           # luma, = sum(item line_total)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OrderItem(Base):
    """A line on an order. `line_total` = quantity * unit_amount (luma)."""
    __tablename__ = "order_item"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("order.id"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product.id"), nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)     # luma
    line_total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)      # luma
