"""Party / Account (doc 17a, Stage 1 — additive, DORMANT).

The careful additive step toward the 4-layer Party → Account → Subscription → Service model: new
first-class tables that land BESIDE the flat CRM `customer` Record, never instead of it. The four
BSS tables gain an OPTIONAL nullable `account_id`; their existing `customer_id` FKs are untouched.
Resolution falls back to `customer_id` (see app/resolvers.py). Nothing migrates until a later batch.

House style: tenant_id + nullable owner_node_id like every BSS table; money is luma (AMD)."""
from app.utils.ids import uuid7
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, ForeignKey, DateTime, Numeric, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class Party(Base):
    """WHO — a person or organization. May back-link to the existing CRM customer Record."""
    __tablename__ = "party"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="individual")  # individual|organization|carrier
    name: Mapped[str] = mapped_column(String(200), nullable=False)                        # legal_name (org) / person name
    parent_party_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("party.id"), nullable=True, index=True)  # B2B HQ→branch
    customer_record_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("record.id"), nullable=True, index=True)  # back-link to CRM customer
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Account(Base):
    """THE MONEY — the billing/contract relationship held by a Party. A Party may have several."""
    __tablename__ = "account"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    holder_party_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("party.id"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="residential")  # residential|business|wholesale
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="AMD")
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly")
    credit_terms: Mapped[str | None] = mapped_column(String(80), nullable=True)
    parent_account_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("account.id"), nullable=True, index=True)  # HQ→per-site
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # ---- Phase A.2: balance + hierarchy ----
    # current_balance is SIGNED: NEGATIVE = customer owes us, POSITIVE = credit on the account.
    # credit_limit is the max NEGATIVE balance allowed before an order-block kicks in.
    # available_credit = max(0, credit_limit + current_balance) — cached for fast Stage-8 lookups.
    # hierarchy_path is a materialized path (dot-joined UUIDs) maintained manually for portability.
    current_balance: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, server_default="0", default=Decimal("0"))
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, server_default="0", default=Decimal("0"))
    available_credit: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False, server_default="0", default=Decimal("0"))
    balance_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    hierarchy_path: Mapped[str | None] = mapped_column(String, nullable=True)
