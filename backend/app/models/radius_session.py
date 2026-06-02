"""NOC Phase C — RadiusSession: RADIUS accounting session records.

Ingests Acct-Start / Acct-Stop records from a RADIUS server (or a NAS-facing
collector). Active sessions have acct_stop IS NULL and status='active'.

UNIQUE (tenant_id, session_id) — a RADIUS Acct-Session-Id is unique per NAS but
we scope it to tenant to keep multi-tenant isolation.

Partial index on status='active' makes "who is currently online" queries fast.
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, BigInteger, ForeignKey, DateTime, func, Index, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class RadiusSession(Base):
    """One RADIUS accounting session.

    status: 'active' | 'stopped'
    octets_in / octets_out: bytes ingress/egress (BigInteger to handle long sessions).
    """
    __tablename__ = "radius_session"
    __table_args__ = (
        UniqueConstraint("tenant_id", "session_id", name="uq_radius_session_tenant_session"),
        Index(
            "ix_radius_session_active",
            "status",
            postgresql_where=text("status = 'active'"),
        ),
        Index("ix_radius_session_username_start", "username", "acct_start"),
        Index("ix_radius_session_service_id", "service_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    service_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service.id"), nullable=True
    )
    username: Mapped[str] = mapped_column(String(200), nullable=False)
    session_id: Mapped[str] = mapped_column(String(200), nullable=False)
    nas_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    nas_port: Mapped[str | None] = mapped_column(String(100), nullable=True)
    framed_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    acct_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    acct_stop: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    octets_in: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    octets_out: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
