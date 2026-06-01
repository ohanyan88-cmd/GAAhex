"""Orders / provisioning (Phase-2 vertical, doc 28).

An Order captures what a customer is buying; on COMPLETED it provisions — each item that references
a catalog Product spins up an ACTIVE Subscription (the order→provision→billing bridge). Money is
integer luma (AMD), consistent with billing. Tenant + org scoped; emits audit Events.

NOTE: the table is named "order" (a SQL reserved word) — SQLAlchemy quotes it automatically. The
coordinator's migration + any RLS policy must quote it too ("order")."""
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Boolean, Integer, ForeignKey, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Order(Base):
    """A sales/provisioning order. `total` is derived from its items (kept in sync on write).

    SPEC §3 Stage 8 Control Gate fields (`control_pass*`) are written by Revenue Control after
    KYC + Credit/Risk + Fraud + Tariff/Product checks. `app.kernel.assert_can_advance_to_scheduling`
    reads `control_pass` and refuses the order→scheduling transition unless it's TRUE.
    """
    __tablename__ = "order"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # additive (17a) — null = pre-Account row; resolve via customer_id
    number: Mapped[str] = mapped_column(String(40), nullable=False)                    # per-tenant ref, e.g. ORD-00007
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")   # DRAFT|SUBMITTED|PROVISIONING|COMPLETED|CANCELLED
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)           # luma, = sum(item line_total)
    # SPEC §3 Stage 8 Control Gate verdict (Step 4). NULL = pending validation, TRUE = Revenue
    # Control passed (KYC+Credit+Fraud+Tariff match), FALSE = explicitly failed. The kernel function
    # `assert_can_advance_to_scheduling` refuses the order→scheduling transition unless TRUE.
    control_pass: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    control_pass_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    control_pass_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): pipeline_item_record_id is polymorphic (→ a record row
    # with entity_key='deal'/'opportunity') — filtered at app layer until Wave 5. subscription_id
    # is the reverse of the existing subscription→order link.
    pipeline_item_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="RESTRICT"), nullable=True, index=True)
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription.id", ondelete="RESTRICT"), nullable=True, index=True)
    # Workspace / Stage 8 Control-Gate surface columns (additive). `credit_check_status` is a short
    # verdict tag (e.g. 'pending'|'ok'|'fail') for the credit sub-step; `control_gate_block_reason`
    # is the human-readable explanation shown in the user's workspace when an order is held at the
    # gate. Both nullable — orders that already passed control before this column existed stay NULL.
    credit_check_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    control_gate_block_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


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
