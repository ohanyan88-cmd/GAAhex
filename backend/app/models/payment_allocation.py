"""Phase A.3 — PaymentAllocation: per-(payment, invoice) settlement row.

A single Payment may settle multiple Invoices (and the same Invoice may be settled by several
Payments). This table is the explicit M:N join with an amount and timestamp on each row, so
"how much of payment X went to invoice Y" is queryable in O(1) and the SUM aggregations that
drive `outstanding_for_invoice` and the auto-PAID transition are cheap.

Money is in **luma** (integer minor units, 1 ֏ = 100 luma) — the SAME unit-of-account as
Invoice.total and Payment.amount (models/billing.py). It is stored in a `Numeric(14, 2)`
column (matching `Account.current_balance` precision in A.2) but the values ARE luma: an
allocation of 100 ֏ is `10000`, stored as `10000.00`. NOT major units — the over-allocation
guard, `invoice_balance_components`, and every test compare it luma-to-luma against
Payment.amount. (FIN-1, 2026-06-14: the DB trigger used to wrongly divide payment.amount by
100 here, assuming major units — fixed in migration `fin1allocluma`.)

Immutability: like Invoice / Payment, allocations are state changes — there is no DELETE path
in the application. Voiding an allocation would be a future state column; for A.3 we treat
each row as the canonical record of what was settled.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Numeric, DateTime, ForeignKey, CheckConstraint, Index, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PaymentAllocation(Base):
    """One row = "of Payment X, this much was applied to Invoice Y at time T by actor A".

    `amount` is positive Decimal luma; SUM(amount) over a payment must always be
    ≤ payment.amount (over-allocation is rejected in `services/payment_allocation.allocate_payment`).
    """
    __tablename__ = "payment_allocation"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_payment_allocation_amount_positive"),
        Index("ix_payment_allocation_payment_id", "payment_id"),
        Index("ix_payment_allocation_invoice_id", "invoice_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment.id"), nullable=False,
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    applied_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
