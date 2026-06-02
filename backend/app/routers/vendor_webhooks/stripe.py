"""M1-C Phase 0 — Stripe webhook receiver.

Endpoint
========
``POST /api/webhooks/stripe``

Validates the ``Stripe-Signature`` header via the active PaymentGateway's
``verify_webhook`` method (HMAC-SHA256 against ``STRIPE_WEBHOOK_SECRET``),
logs the parsed event, acks 200.

Phase M1-C.1 will dispatch event types to domain handlers:

* ``payment_intent.succeeded`` → mark Invoice paid
* ``charge.refunded``          → write Refund row + reverse allocations
* ``payment_method.attached``  → register PaymentMethod row
* ``payment_intent.payment_failed`` → emit billing event for dunning re-evaluation
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.payments import (
    PaymentGatewayCommandError,
    PaymentWebhookSignatureError,
    get_payment_gateway,
)

_log = logging.getLogger("portal.webhooks.stripe")

router = APIRouter(tags=["webhooks"])


@router.post("/api/webhooks/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(..., alias="Stripe-Signature"),
) -> dict:
    """Verify Stripe webhook signature, parse event, ack.

    Returns ``{received: True, event_id, event_type}`` on success.
    """
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
    _log.info(
        "Stripe webhook received: id=%s type=%s (phase=M1-C.0; handlers in M1-C.1)",
        event_id, event_type,
    )
    # TODO M1-C.1: dispatch event_type → domain handler.
    return {"received": True, "event_id": event_id, "event_type": event_type}
