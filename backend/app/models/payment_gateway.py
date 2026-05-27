"""PaymentOrder model — online payment gateway (Batch 33).

Tracks the lifecycle of an online payment attempt against an Invoice.
One PaymentOrder per attempt; multiple attempts on the same invoice are allowed.
When a payment is confirmed (status=PAID), `settle_order` creates the billing Payment row and
may flip the invoice to PAID — exactly as billing.add_payment does for manual payments.

MONEY: amount is BigInteger in luma (AMD minor units, 1 ֏ = 100 luma) — same as billing models.
PROVIDERS: "dev" (always works, deterministic), "idram", "telcell", "arca" (Lane E scaffolds).
STATUS: PENDING -> PAID|FAILED|EXPIRED|CANCELLED
"""
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, ForeignKey, DateTime, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PaymentOrder(Base):
    """An online payment attempt tied to one Invoice. Created on initiation; settled on confirmation."""
    __tablename__ = "payment_order"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Tenant + org scope (same pattern as all billing models)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True
    )

    # Relations
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("invoice.id"), nullable=False, index=True
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=True
    )
    # The billing Payment created on settle (null until PAID)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payment.id"), nullable=True
    )

    # Payment info
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="dev")
    # luma — AMD minor units; same as billing.Invoice.total
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="AMD")

    # Status: PENDING|PAID|FAILED|EXPIRED|CANCELLED
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING")

    # Provider linkage
    provider_ref: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # URLs
    redirect_url: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Raw provider callback payload (for audit / re-processing)
    raw_callback: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Timestamps
    initiated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
