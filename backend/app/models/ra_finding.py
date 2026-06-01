"""Phase B.3 — Revenue Assurance finding queue.

A first-class physical table tracking leakage findings produced by the RA scan service. Each row
is one discovered anomaly (an active service with no subscription, an active subscription not
invoiced this cycle, etc.). The lifecycle is ``open -> investigating -> resolved | false_positive``.

Dedup is enforced at the DB layer via a PARTIAL UNIQUE INDEX:
``UNIQUE (tenant_id, finding_type, entity_id) WHERE status IN ('open','investigating')``.
Re-running a scan therefore can't produce a second open finding for the same entity — the second
INSERT raises IntegrityError, the service catches it per-row and skips. Once a finding moves to
``resolved`` or ``false_positive`` it leaves the partial index, so a future scan that re-detects
the same condition can legitimately open a fresh finding.

A worklist index on ``(tenant_id, status, detected_at)`` keeps the dashboard query cheap.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Text, DateTime, ForeignKey, Index, CheckConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RaFinding(Base):
    """One revenue-assurance anomaly. Lifecycle: open -> investigating -> resolved | false_positive."""
    __tablename__ = "ra_finding"
    __table_args__ = (
        # Partial unique: only one OPEN/INVESTIGATING finding per (tenant, type, entity).
        # Resolved + false_positive rows fall out of the index so a future re-detection can reopen.
        Index(
            "uq_ra_finding_open_per_entity",
            "tenant_id", "finding_type", "entity_id",
            unique=True,
            postgresql_where=text("status IN ('open','investigating')"),
        ),
        Index("ix_ra_finding_worklist", "tenant_id", "status", "detected_at"),
        CheckConstraint(
            "status IN ('open','investigating','resolved','false_positive')",
            name="ck_ra_finding_status",
        ),
        CheckConstraint(
            "severity IN ('low','medium','high','critical')",
            name="ck_ra_finding_severity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    finding_type: Mapped[str] = mapped_column(String(60), nullable=False)
    # 'unbilled_service' | 'uninvoiced_subscription' | 'orphan_invoice'
    severity: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    # 'service' | 'subscription' | 'invoice'
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    detail_json: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}",
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="open", server_default="open",
    )
    ack_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ack_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True,
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True,
    )
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Identifies which scan run produced this finding. Plain UUID (not FK) so deleting a scan-run
    # row in a future cleanup pass leaves findings intact for the audit trail.
    scan_run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
