import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime, func, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from ..security import EncryptedString


class WebhookDef(Base):
    """An outbound webhook subscription: POST a signed payload to `url` whenever a kernel Event of a
    subscribed type fires. `events` is a JSONB list of event types (e.g. ["transition","invoice.paid"];
    "*" subscribes to all). `secret` signs deliveries (HMAC-SHA256). Needs RLS (tenant isolation).

    `secret` is encrypted at rest under SPEC §4.4 — the column type is `EncryptedString`,
    so reads decrypt transparently and writes encrypt before persistence. The DB itself never
    sees the plaintext signing key. Run `backend/scripts/encrypt_webhook_secrets.py` once after
    the migration that widens the column to TEXT to backfill any legacy plaintext secrets.
    """
    __tablename__ = "webhook_def"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    events: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)   # subscribed event types ("*" = all)
    secret: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)  # HMAC signing key — SPEC §4.4 encrypted at rest
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebhookDelivery(Base):
    """The observable delivery log — one row per attempted POST. Phase-1 records + a single attempt;
    a real queue/worker with retries comes later. Needs RLS (tenant isolation)."""
    __tablename__ = "webhook_delivery"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    webhook_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("webhook_def.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="QUEUED")  # QUEUED|SENT|FAILED
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
