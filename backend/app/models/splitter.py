"""NOC Phase A — Optical-splitter strand allocations (Order pipeline stage 9).

A SplitterStrandAllocation is one strand on a physical optical splitter that's either free,
reserved (held for an in-flight install order), in-use (lit on an activated service), or
released (history-keeping after teardown). Strands are 1..N per splitter where N depends on
the splitter ratio (1:8, 1:16, 1:32, 1:64) — encoded in the parent ``Record(entity_key=
'optical_splitter').data``; this strand table is the FIRST-class allocation ledger so we get
DB-level uniqueness on (splitter, strand_no) and a partial-unique enforcing single in-use
allocation per strand.

Mirrors the respool / billing style (UUID, tenant_id, timestamps); tenant-scoped. The
splitter itself is a polymorphic Record row (``entity_key='optical_splitter'``) — that keeps
splitters configurable like every other inventory asset, while strand-level state lives here
because the integrity constraints require a first-class table.
"""
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Integer, ForeignKey, DateTime, func, Index, UniqueConstraint, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SplitterStrandAllocation(Base):
    """One strand on one optical splitter; the lifecycle row tying that strand to (optionally) a
    service / in-flight order. UNIQUE per (splitter, strand_no) — released rows are kept for
    history (status='released') and a partial-unique on status='in_use' guarantees no double-lit
    strand on the same splitter."""
    __tablename__ = "splitter_strand_allocation"
    __table_args__ = (
        UniqueConstraint("splitter_record_id", "strand_no", name="uq_splitter_strand_no"),
        # at most one 'in_use' row per (splitter, strand_no) — released history doesn't compete
        Index(
            "uq_splitter_strand_in_use",
            "splitter_record_id", "strand_no",
            unique=True,
            postgresql_where=text("status = 'in_use'"),
        ),
        Index("ix_splitter_strand_status", "splitter_record_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True,
    )
    splitter_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=False, index=True,
    )
    strand_no: Mapped[int] = mapped_column(Integer, nullable=False)        # 1..N
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True, index=True,
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order.id"), nullable=True, index=True,
    )
    # 'free' | 'reserved' | 'in_use' | 'released'
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    allocated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
