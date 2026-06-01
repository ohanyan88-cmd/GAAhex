"""Phase B.3 — Revenue Assurance scan run log.

One row per scan invocation. ``status`` walks ``running -> success | failed``. ``findings_count``
is the count of NEW findings the run produced (existing open findings on the same entity that the
partial-unique index rejected don't count). Triggered from ``POST /api/revenue-assurance/scan`` —
``triggered_by`` is the actor user.id, or NULL when fired by a scheduled job (future work).
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Text, Integer, DateTime, ForeignKey, CheckConstraint, func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RaScanRun(Base):
    """One revenue-assurance scan invocation. status: running -> success | failed."""
    __tablename__ = "ra_scan_run"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running','success','failed')",
            name="ck_ra_scan_run_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="running", server_default="running",
    )
    findings_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0",
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True,
    )
