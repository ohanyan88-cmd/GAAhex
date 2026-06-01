"""Phase B.1 — PaymentMethod: vaulted card tokens (Stage 8 prerequisite).

A first-class physical table holding **gateway-vaulted** payment instruments. The application
NEVER stores PAN or CVV — only the opaque ``gateway_token`` returned by the gateway adapter,
plus the safe display bits (last4 / brand / expiry) needed to render "Visa **** 4242" in the UI.

v1 wires the ``LoggingGateway`` (see ``services/payment_gateway_adapter.py``) which produces
deterministic synthetic tokens; Stripe / Adyen slot in later behind the same Protocol.

Invariants:
  * Exactly one ``is_default=True`` row per customer (enforced at the router boundary on
    write; not a DB constraint because partial unique indexes are gated by tenant + customer
    + status and Postgres can't express a per-customer single-default predicate cleanly
    enough to enforce here without false positives on soft-deleted rows).
  * UNIQUE (tenant_id, gateway_token) — same token never reused across tenants.
  * Index on (customer_id, status) for the common "show me this customer's active cards" read.

Lifecycle: ``active`` → (``expired`` | ``removed``). ``removed`` is the soft-delete state; the row
is preserved for audit (a customer who removed a card might dispute a historic charge).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Boolean, Integer, ForeignKey, DateTime, Index, UniqueConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class PaymentMethod(Base):
    """A vaulted payment instrument (card) the customer can be charged against.

    The row stores the gateway's opaque token + safe display bits only. PAN / CVV / track data
    are MEMORY-ONLY at the router layer and never reach the DB."""
    __tablename__ = "payment_method"
    __table_args__ = (
        UniqueConstraint("tenant_id", "gateway_token", name="uq_payment_method_tenant_token"),
        Index("ix_payment_method_customer_status", "customer_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False, index=True,
    )
    account_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True,
    )
    # 'logging' (v1), later 'stripe', 'adyen', etc.
    gateway: Mapped[str] = mapped_column(String(40), nullable=False)
    gateway_token: Mapped[str] = mapped_column(String(255), nullable=False)
    last4: Mapped[str] = mapped_column(String(4), nullable=False)
    # 'visa' | 'mastercard' | 'amex' | 'discover' | 'other'
    brand: Mapped[str] = mapped_column(String(20), nullable=False)
    exp_month: Mapped[int] = mapped_column(Integer, nullable=False)
    exp_year: Mapped[int] = mapped_column(Integer, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # 'active' | 'expired' | 'removed'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
