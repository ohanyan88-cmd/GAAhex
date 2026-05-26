"""Billing core (Phase-2 opener): Subscriptions · Invoices · Payments.

MONEY: all amounts are integers in **luma** — AMD minor units (1 ֏ = 100 luma). Integer minor
units avoid floating-point drift; BigInteger covers large group-level totals. Clients divide by
100 for display. These are first-class BSS tables (not config-driven Records), but they follow the
same tenant_id + owner_node_id scoping and emit audit Events like everything else.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, Integer, ForeignKey, DateTime, func, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Subscription(Base):
    """A customer's recurring plan. `customer_id` points at the CRM customer Record."""
    __tablename__ = "subscription"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product.id"), nullable=True, index=True)  # catalog plan it was created from
    plan_name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)        # luma per cycle
    cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")  # monthly|yearly
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|SUSPENDED|CANCELLED
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    next_invoice_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invoice(Base):
    """A bill for a period. `total` is derived from its lines (kept in sync on write)."""
    __tablename__ = "invoice"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    number: Mapped[str] = mapped_column(String(40), nullable=False)                    # per-tenant human ref, e.g. INV-00007
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")   # DRAFT|ISSUED|PAID|OVERDUE|VOID
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)           # luma, = sum(line_total)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InvoiceLine(Base):
    """One line on an invoice. `line_total` = quantity * unit_amount (luma)."""
    __tablename__ = "invoice_line"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="charge", server_default="charge")  # charge|discount|tax
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)     # luma
    line_total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)      # luma


class Payment(Base):
    """A payment recorded against an invoice (luma)."""
    __tablename__ = "payment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=False, index=True)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)          # luma
    method: Mapped[str] = mapped_column(String(20), nullable=False)                     # cash|card|transfer
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
