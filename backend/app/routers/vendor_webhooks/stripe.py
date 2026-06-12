"""M1-C Phase 1 — Stripe webhook receiver with event dispatch + idempotency.

Endpoint
========
``POST /api/webhooks/stripe``

1. Verifies the ``Stripe-Signature`` header via the active PaymentGateway's
   ``verify_webhook`` (HMAC-SHA256 against ``STRIPE_WEBHOOK_SECRET``).
2. Checks the ``stripe_webhook_event`` table for a prior row with the same
   ``stripe_event_id`` — if found, returns ``duplicate=True`` without re-applying.
3. Dispatches the event to a domain handler in ``app.services.payments.stripe_events``.
4. Records a ``StripeWebhookEvent`` audit row with the result. On handler exception we
   STILL record (as ``result='errored'``) and ack 200 so Stripe stops retrying — the
   row stays for offline triage.

Session strategy
================
Uses the owner role session (``get_owner_session``). Webhooks aren't authenticated as a
specific tenant user — the GUC is bound per-event by the handler after reading
``metadata.tenant_id`` from the event payload. The owner role bypasses RLS, so the
binding is decorative today but future-proofs the path.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_owner_session
from app.models.stripe_webhook_event import StripeWebhookEvent
from app.services.payments import (
    PaymentGatewayCommandError,
    PaymentWebhookSignatureError,
    get_payment_gateway,
)
from app.services.payments.stripe_events import handle_stripe_event

_log = logging.getLogger("portal.webhooks.stripe")

router = APIRouter(tags=["webhooks"])


def _coerce_uuid_or_none(v):
    """Return a UUID for ``v`` if parseable, else ``None``. Used to pull tenant_id out of metadata."""
    import uuid
    if v is None or v == "":
        return None
    try:
        return uuid.UUID(str(v))
    except (TypeError, ValueError):
        return None


@router.post("/api/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="Stripe-Signature"),
    session: AsyncSession = Depends(get_owner_session),
) -> dict:
    """Verify, dedupe, dispatch, audit. Always returns 200 (signature failures excepted)."""
    # C2 kill-switch — payment webhooks are DISABLED until go-live (FEATURE_PAYMENTS_ENABLED default OFF).
    from ...config import settings  # noqa: PLC0415
    if not settings.feature_payments_enabled:
        raise HTTPException(status_code=503, detail="Payment processing is disabled")
    payload = await request.body()
    gw = get_payment_gateway()
    try:
        event = gw.verify_webhook(payload=payload, signature=stripe_signature)
    except PaymentWebhookSignatureError as e:
        _log.warning("Stripe webhook signature mismatch: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")
    except PaymentGatewayCommandError as e:
        _log.warning("Stripe webhook payload error: %s", e)
        raise HTTPException(status_code=400, detail=str(e))

    event_id = (event or {}).get("id")
    event_type = (event or {}).get("type")
    if not event_id or not event_type:
        # Mock-mode events from MockPaymentGateway when the payload is empty/garbage end up
        # without these — treat as a no-op-success rather than failing the request.
        _log.info("Stripe webhook missing id/type; nothing to dispatch")
        return {"received": True, "event_id": event_id, "event_type": event_type, "result": "ignored"}

    # ---- Idempotency check ----
    # Stripe retries until we 2xx. If we've already recorded this event_id, ack with
    # ``duplicate=True`` so the handler doesn't fire twice.
    prior = (await session.execute(
        select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
    )).scalar_one_or_none()
    if prior is not None:
        return {
            "received": True,
            "event_id": event_id,
            "event_type": event_type,
            "duplicate": True,
            "result": prior.result,
        }

    # ---- Pull tenant_id from event metadata (may be None for dashboard-fired events) ----
    obj = (((event or {}).get("data") or {}).get("object")) or {}
    meta = (obj or {}).get("metadata") or {}
    tenant_id = _coerce_uuid_or_none(meta.get("tenant_id"))

    # ---- Dispatch + record ----
    result: str = "ignored"
    error_msg: str | None = None
    try:
        result = await handle_stripe_event(session, event)
    except Exception as e:
        result = "errored"
        # Keep the message short — full traceback goes to logs, not the audit row.
        error_msg = f"{type(e).__name__}: {e}"[:2000]
        _log.exception("Stripe webhook handler failed for event %s (%s)", event_id, event_type)

    # Record the audit row (always — handled / ignored / errored). The same transaction
    # carries any DB mutations the handler made; commit after.
    audit = StripeWebhookEvent(
        tenant_id=tenant_id,
        stripe_event_id=event_id,
        event_type=event_type,
        payload_json=event if isinstance(event, dict) else {},
        result=result,
        error_message=error_msg,
    )
    session.add(audit)
    try:
        await session.commit()
    except Exception:
        # If the commit itself fails (e.g. handler created a violation), rollback + record
        # the audit alone in a fresh transaction so we don't lose the trail.
        await session.rollback()
        audit2 = StripeWebhookEvent(
            tenant_id=tenant_id,
            stripe_event_id=event_id,
            event_type=event_type,
            payload_json=event if isinstance(event, dict) else {},
            result="errored",
            error_message=(error_msg or "commit failed"),
        )
        session.add(audit2)
        await session.commit()
        result = "errored"

    return {
        "received": True,
        "event_id": event_id,
        "event_type": event_type,
        "result": result,
    }
