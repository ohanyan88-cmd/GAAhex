from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime, func, Text, UniqueConstraint, Index, text
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

    Webhook Standard (file 70) extension
    ------------------------------------
    `subscription_status` carries the 5-value SubscriptionStatus enum
    (ACTIVE, INACTIVE, SUSPENDED, FAILED, DEPRECATED). The legacy `active` boolean is kept
    for backward compatibility; old code reads `active`, new code reads `subscription_status`.
    Migration backfills:  active=True → 'ACTIVE',  active=False → 'INACTIVE'.

    `reference_number` is the per-tenant business id (WHK-000001) — UNIQUE
    (tenant_id, reference_number) is the collision fence, matching the REL/ESC/TSK pattern.
    """
    __tablename__ = "webhook_def"
    __table_args__ = (
        UniqueConstraint("tenant_id", "reference_number", name="uq_webhook_def_reference_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False)
    events: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)   # subscribed event types ("*" = all)
    secret: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)  # HMAC signing key — SPEC §4.4 encrypted at rest
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Webhook Standard (file 70) — SubscriptionStatus enum. Nullable for back-compat with
    # legacy rows; new writes default to 'ACTIVE' via the server_default.
    subscription_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, server_default="ACTIVE"
    )
    # Per-tenant business id (WHK-000001). Nullable so the additive migration doesn't break
    # legacy rows; backfill is handled at write-time / by a separate sweep.
    reference_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebhookDelivery(Base):
    """The observable delivery log — one row per attempted POST. Phase-1 records + a single attempt;
    a real queue/worker with retries comes later. Needs RLS (tenant isolation).

    Webhook Standard (file 70) extension
    ------------------------------------
    `delivery_status` carries the 6-value DeliveryStatus enum
    (PENDING, SENT, DELIVERED, FAILED, RETRYING, DEAD_LETTERED).  The legacy `status` varchar
    (QUEUED|SENT|FAILED) is kept for backward compatibility; old code reads `status`, new code
    reads `delivery_status`. Migration backfills:
        QUEUED  → PENDING
        SENT    → SENT
        FAILED  → FAILED

    Correlation/causation/idempotency columns implement the standard's distributed-tracing +
    de-dup guarantees:
      - `correlation_id` — the request/event chain id (same value across every delivery in a chain)
      - `causation_id`   — the direct cause (the prior delivery / event id)
      - `idempotency_key` — a client-supplied dedupe key; partial UNIQUE INDEX on
        (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL stops dupes.
      - `event_name`     — canonical event name (e.g. "invoice.paid"); mirrors event_type but
        carries the Webhook Standard's UPPER.dot.case form.
      - `attempt_number` — current attempt count for retry visibility (legacy `attempts` kept).
    """
    __tablename__ = "webhook_delivery"
    __table_args__ = (
        # Partial UNIQUE INDEX — file 70 idempotency. Only enforced when idempotency_key is set.
        Index(
            "uq_webhook_delivery_idempotency",
            "tenant_id", "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    webhook_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("webhook_def.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="QUEUED")  # QUEUED|SENT|FAILED — legacy
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # Webhook Standard (file 70) — DeliveryStatus enum. Nullable for back-compat with
    # legacy rows; new writes default to 'PENDING' via the server_default.
    delivery_status: Mapped[str | None] = mapped_column(
        String(20), nullable=True, server_default="PENDING"
    )
    event_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    causation_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
