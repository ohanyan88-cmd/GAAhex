"""NOC Phase C — MassBroadcast: outage notification mass-send management.

A MassBroadcast is a batch notification sent to an audience (filtered by geography,
tariff plan, etc.) over one channel (sms | email | voice | push).

For v1 the send is simulated: the SimulatedBroadcastSender marks the broadcast
'complete' immediately with sent_count = recipients_count and failed_count = 0.

audience_filter_json: freeform JSONB, e.g.:
  {"affected_area_wkt": "POLYGON(...)", "tariff_plan_ids": ["uuid1", "uuid2"]}

status lifecycle: draft → queued → sending → complete | failed
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, ForeignKey, DateTime, func, Index, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class MassBroadcast(Base):
    """One mass-broadcast event.

    incident_record_id is nullable: a broadcast may be standalone (maintenance window
    notifications, promotional outage alerts) or linked to an incident Record.
    """
    __tablename__ = "mass_broadcast"
    __table_args__ = (
        Index("ix_mass_broadcast_incident_record_id", "incident_record_id"),
        Index("ix_mass_broadcast_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True
    )
    incident_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("record.id"), nullable=True
    )
    channel: Mapped[str] = mapped_column(String(20), nullable=False)           # sms|email|voice|push
    template_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    audience_filter_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    recipients_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sent_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    failed_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
