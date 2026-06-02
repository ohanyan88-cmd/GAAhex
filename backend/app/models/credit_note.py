"""Phase A.3 — CreditNote: standalone credit/refund document.

A first-class physical table that complements (and DOES NOT replace) the legacy config-driven
credit_note Record path at /api/credit-notes — that endpoint keeps serving the SPEC §4.5
approval-gated Record flow. This new table backs the A.3 financial-ledger contract: explicit
DRAFT/ISSUED/APPLIED/VOID lifecycle, per-tenant CN-XXXXX numbering, and an `applied_to_invoice_id`
link that feeds the `outstanding_for_invoice` math in services/payment_allocation.py.

Money is Decimal Numeric(14, 2) — same precision as Account.current_balance and
PaymentAllocation.amount. The integer luma convention stays on Invoice/Payment columns; the
A.3 ledger speaks Decimal end-to-end.

Status doctrine (mirrors invoice/payment immutability — UPDATE allowed, DELETE forbidden):
  DRAFT    → ISSUED    via /issue (sets issued_at, freezes amount/reason)
  ISSUED   → APPLIED   via /apply (sets applied_at + applied_to_invoice_id; triggers
                                    recompute_account_balance on the linked account)
  ISSUED   → VOID      via /void  (cancellation before consumption; not implemented in A.3)
  any      → no DELETE (state changes only)
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Numeric, DateTime, ForeignKey, CheckConstraint, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class CreditNote(Base):
    """A credit-note document. Per-tenant unique `number` (e.g. CN-00001)."""
    __tablename__ = "credit_note"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_credit_note_tenant_number"),
        CheckConstraint("amount > 0", name="ck_credit_note_amount_positive"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False, index=True,
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True,
    )
    number: Mapped[str] = mapped_column(String(40), nullable=False)
    original_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=True, index=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="DRAFT", server_default="DRAFT",
    )  # DRAFT | ISSUED | APPLIED | VOID
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    applied_to_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=True, index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    # Deletion / Archive / Restore Standard (file 12 — D14). Separate from lifecycle `status`.
    # 5-value enum: ACTIVE | ARCHIVED | SOFT_DELETED | PENDING_PURGE | PURGED. Default ACTIVE.
    deletion_state: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ACTIVE", server_default="'ACTIVE'",
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
