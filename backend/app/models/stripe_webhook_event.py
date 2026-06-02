"""M1-C.1 — StripeWebhookEvent (webhook idempotency + audit table).

Why a dedicated table
=====================
Stripe retries webhook deliveries until our endpoint returns 2xx. A naive handler that
mutates Portal records each time risks double-applying a charge if the second delivery
arrives before the first response. The idempotency contract:

1. Every inbound Stripe webhook is recorded here EXACTLY ONCE keyed by ``stripe_event_id``.
2. The router checks for a prior row before dispatching the event handler. A duplicate is
   acked with ``duplicate=True`` and never re-applied.
3. The row also serves as an audit log — every event we've seen, what we did with it,
   what (if anything) failed. ``payload_json`` snapshots the full Stripe event so we can
   replay diagnostics without round-tripping Stripe's dashboard.

Tenant scoping is OPTIONAL
==========================
Not every Stripe event carries our ``tenant_id`` in ``metadata`` — e.g. a manual refund
fired from the Stripe dashboard against an older PaymentIntent won't have it. ``tenant_id``
is therefore nullable. RLS is NOT applied (the row stores cross-tenant audit data and the
webhook handler runs with the owner role); we control access via the router which only
exposes this table internally.

Result vocabulary
=================
  ``handled``  — dispatched to a domain handler that ran cleanly
  ``ignored``  — recognized event type but intentionally a no-op (e.g. unknown sub-type)
  ``errored``  — handler raised; ``error_message`` carries the traceback head

Result is INTENT — even an ``errored`` row counts as "seen" for the next delivery so we
don't fight ourselves into retry loops. Operators triage ``errored`` rows offline.
"""
import uuid
from datetime import datetime

from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, Index, Text, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StripeWebhookEvent(Base):
    """One row per inbound Stripe webhook (unique on ``stripe_event_id``)."""

    __tablename__ = "stripe_webhook_event"
    __table_args__ = (
        UniqueConstraint("stripe_event_id", name="uq_stripe_webhook_event_id"),
        Index("ix_stripe_webhook_event_type", "event_type"),
        Index("ix_stripe_webhook_event_tenant", "tenant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4,
    )
    # Nullable — events fired from the Stripe dashboard may not carry our metadata.tenant_id.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=True,
    )
    # Stripe's ``evt_...`` id — UNIQUE so duplicate deliveries are de-duped at the DB layer.
    stripe_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    # ``payment_intent.succeeded`` / ``charge.refunded`` / ``payment_method.attached`` / ...
    event_type: Mapped[str] = mapped_column(String(120), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(),
    )
    # Full Stripe event snapshot — useful for replay diagnostics + audit.
    payload_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # 'handled' | 'ignored' | 'errored' — see module docstring for semantics.
    result: Mapped[str] = mapped_column(String(20), nullable=False, default="handled")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
