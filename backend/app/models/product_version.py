"""Phase A.1 — ProductVersion: immutable snapshots of a Product's priced spec at a point in time.

When the catalog edits a Product (price change, cycle change, attribute tweak), we MINT a new
ProductVersion row that snapshots the Product's pricing fields + a full spec_json blob, closes
the prior version's effective_to to "now", and stamps the new version with effective_from=now.

This lets Subscriptions and Invoices query "what did this product look like at <date>" by walking
to the version whose [effective_from, effective_to) window contains the date — the grandfathering
guarantee. The current Product row is the LIVE/editable view; the versions are the audit trail.

Money: Decimal here (Phase A.1 introduces Decimal MRC/NRC alongside the legacy integer-luma
`default_amount` on Product — see product.py docstring).
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import String, Integer, ForeignKey, DateTime, func, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ProductVersion(Base):
    """One immutable version of a Product's priced spec.

    `version_no` is a monotonically-increasing integer per product (1, 2, 3, ...).
    `effective_from` / `effective_to` carve out the time window in which this version was current
    (`effective_to` is NULL for the live version). `superseded_by_id` is a back-pointer to the
    version that replaced this one — present once a newer version is minted.
    `spec_json` is a full dict snapshot of the product at mint time so we never have to rebuild
    state from the audit log.
    """
    __tablename__ = "product_version"
    __table_args__ = (
        UniqueConstraint("product_id", "version_no", name="uq_product_version_no"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    version_no: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recurring_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    one_time_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    cycle: Mapped[str | None] = mapped_column(String(20), nullable=True)
    spec_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    superseded_by_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("product_version.id", ondelete="SET NULL"), nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
