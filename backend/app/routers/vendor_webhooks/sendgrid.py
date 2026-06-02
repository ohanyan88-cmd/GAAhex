"""M1-C Phase 0 — SendGrid Event Webhook receiver.

Endpoint
========
``POST /api/webhooks/sendgrid``

Receives SendGrid's Event Webhook payload — a JSON array of events
(``delivered``, ``bounce``, ``open``, ``click``, ``spamreport``, ``unsubscribe``,
``dropped``). The Ed25519 signature is verified against the configured
``SENDGRID_WEBHOOK_PUBLIC_KEY``. If the public key isn't configured
(dev / mock mode), signature verification is skipped and the payload is logged
without verification.

Phase M1-C.3 will wire each event to the corresponding MassBroadcast row +
``outbound_message`` row update.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.comms import EmailWebhookSignatureError, get_email_gateway

_log = logging.getLogger("portal.webhooks.sendgrid")

router = APIRouter(tags=["webhooks"])


@router.post("/api/webhooks/sendgrid")
async def sendgrid_webhook(
    request: Request,
    signature: str | None = Header(
        None, alias="X-Twilio-Email-Event-Webhook-Signature",
    ),
    timestamp: str | None = Header(
        None, alias="X-Twilio-Email-Event-Webhook-Timestamp",
    ),
) -> dict:
    """Verify SendGrid webhook signature, parse events, ack."""
    payload = await request.body()
    gw = get_email_gateway()
    try:
        parsed = gw.verify_webhook(
            payload=payload, signature=signature, timestamp=timestamp,
        )
    except EmailWebhookSignatureError as e:
        _log.warning("SendGrid webhook signature mismatch: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    events = parsed.get("events") if isinstance(parsed, dict) else None
    count = len(events) if isinstance(events, list) else 0
    _log.info(
        "SendGrid webhook received: %d event(s) (phase=M1-C.0; handlers in M1-C.3)",
        count,
    )
    # TODO M1-C.3: per-event dispatch (delivered/bounced/opened/clicked → MassBroadcast row).
    return {"received": True, "event_count": count}
