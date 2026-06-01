"""Billing core (Phase-2 opener): Subscriptions · Invoices · Payments.

MONEY: all amounts are integers in **luma** — AMD minor units (1 ֏ = 100 luma). Integer minor
units avoid floating-point drift; BigInteger covers large group-level totals. Clients divide by
100 for display. These are first-class BSS tables (not config-driven Records), but they follow the
same tenant_id + owner_node_id scoping and emit audit Events like everything else.

SPEC §0.3 FINANCIAL IMMUTABILITY (kernel invariant, alembic revision b70ef3b98e27):
  The `invoice` and `payment` tables carry DB-level BEFORE DELETE triggers (`prevent_delete_invoice`,
  `prevent_delete_payment`) that raise an exception on any DELETE attempt. Invoices and Payments
  are NEVER deleted — only state changes (cancel, credit, refund, reconcile, void) are allowed.
  UPDATE remains open for status transitions. The triggers fire for ANY role, including the
  superuser/owner, so the immutability holds at the database layer below the application.
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
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # additive (17a) — null = pre-Account row; resolve via customer_id
    product_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("product.id"), nullable=True, index=True)  # catalog plan it was created from
    plan_name: Mapped[str] = mapped_column(String(160), nullable=False)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)        # luma per cycle
    cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")  # monthly|yearly
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|SUSPENDED|CANCELLED
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    next_invoice_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_invoiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # E20: idempotency marker for the billing-cycle run — last as_of this sub was billed for
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Invoice(Base):
    """A bill for a period. `total` is derived from its lines (kept in sync on write)."""
    __tablename__ = "invoice"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # additive (17a) — null = pre-Account row; resolve via customer_id
    number: Mapped[str] = mapped_column(String(40), nullable=False)                    # per-tenant human ref, e.g. INV-00007
    period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="DRAFT")   # DRAFT|ISSUED|PAID|OVERDUE|VOID
    total: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)           # luma, = sum(line_total)
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Phase A.3 — Invoice immutability timestamps (SPEC §0.3). When an invoice transitions
    # DRAFT → ISSUED its `posted_at` is set to now() and `locked_by` to the actor user.id.
    # While `posted_at IS NULL` the invoice is mutable (DRAFT lifecycle). Once `posted_at IS
    # NOT NULL` the row is locked: only `status` and `paid_at` may change (state-mutation
    # doctrine; SPEC §0.3 allows UPDATE for state transitions). The app-layer enforcement
    # lives in `services/invoice_lock.ensure_invoice_mutable` and is wired into every
    # mutating path on /api/invoices in routers/billing.py.
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)


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
    # SPEC §6 Wave 1 (additive, nullable): typed link from invoice line back to the BSS chain.
    # Backfill + NOT NULL deferred — Wave 2/4.
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription.id", ondelete="RESTRICT"), nullable=True, index=True)
    service_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("service.id", ondelete="RESTRICT"), nullable=True, index=True)
    usage_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("usage_record.id", ondelete="RESTRICT"), nullable=True, index=True)


class Payment(Base):
    """A payment recorded against an invoice (luma)."""
    __tablename__ = "payment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    # Phase B.1: nullable to permit DEPOSIT payments — Stage 8 collects a deposit BEFORE any
    # invoice exists for the order. Regular invoice payments still set this. Code paths that
    # join Payment → Invoice already filter by Payment.invoice_id IS NOT NULL / .in_(...) so
    # null-invoice deposit rows are excluded from those queries naturally.
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)          # luma
    method: Mapped[str] = mapped_column(String(20), nullable=False)                     # cash|card|transfer
    paid_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # SPEC §4.5 refund tracking. Refunds are state changes (SPEC §0.3 immutability allows UPDATE,
    # only DELETE is forbidden). refunded_amount sums all refunds against this payment in luma;
    # refunded_at is the most-recent refund timestamp.
    refunded_amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0, server_default="0")
    refunded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # SPEC §6 Wave 1 (additive, nullable): direct customer + account links (today reached only via
    # invoice → customer/account). Backfill via invoice deferred to Wave 2.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id", ondelete="RESTRICT"), nullable=True, index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id", ondelete="RESTRICT"), nullable=True, index=True)
