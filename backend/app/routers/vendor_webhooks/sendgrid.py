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

M1-C.3 dispatch notes
---------------------
Correlation between an inbound SendGrid event and a stored MassBroadcast /
OutboundMessage row requires a ``provider_message_id`` column on those tables
(not yet added — tracked for the next migration).  SendGrid supplies
``sg_message_id`` (and its legacy alias ``smtp-id``) on each event; until the
column exists the handler logs each actionable event at INFO level so that:

* No event is silently dropped — every delivered/bounce/open/click appears in
  the application log.
* The 200 ACK is returned promptly (SendGrid retries on non-2xx).
* No DB write is attempted against columns that don't exist, preventing runtime
  errors.

When the migration adds ``outbound_message.provider_message_id`` the body of
``_dispatch_sendgrid_event`` below can be replaced with a ``SELECT … WHERE
provider_message_id = sg_message_id`` + status update in a single transaction.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.comms import EmailWebhookSignatureError, get_email_gateway

_log = logging.getLogger("portal.webhooks.sendgrid")

router = APIRouter(tags=["webhooks"])

# Events that map to a delivery-status change on MassBroadcast / OutboundMessage.
_DELIVERY_EVENTS = frozenset({"delivered", "bounce", "open", "click"})
# Events that are suppression / compliance signals (log only, no row update needed now).
_SUPPRESSION_EVENTS = frozenset({"spamreport", "unsubscribe", "group_unsubscribe",
                                  "group_resubscribe", "unsubscribe_all"})
# Events that indicate a pre-send drop (log only).
_DROP_EVENTS = frozenset({"dropped", "deferred"})


def _dispatch_sendgrid_event(event: dict[str, Any]) -> None:
    """M1-C.3 — Dispatch one SendGrid event to its domain handler.

    Logs the event at the appropriate level. Full DB correlation (updating
    OutboundMessage.status / MassBroadcast counters) is deferred until the
    ``provider_message_id`` column is added by migration.
    """
    event_type = event.get("event", "")
    # SendGrid provides sg_message_id; smtp-id is its legacy alias.
    msg_id = event.get("sg_message_id") or event.get("smtp-id") or event.get("smtp_id")
    email = event.get("email", "")
    timestamp = event.get("timestamp")

    if event_type == "delivered":
        _log.info(
            "SendGrid delivered: msg_id=%s email=%.2s*** ts=%s "
            "(DB update pending provider_message_id column)",
            msg_id, email, timestamp,
        )
    elif event_type == "bounce":
        bounce_type = event.get("type", "")
        reason = event.get("reason", "")
        _log.warning(
            "SendGrid bounce: msg_id=%s email=%.2s*** type=%s reason=%.80s "
            "(DB update pending provider_message_id column)",
            msg_id, email, bounce_type, reason,
        )
    elif event_type == "open":
        _log.info(
            "SendGrid open: msg_id=%s email=%.2s*** ts=%s "
            "(DB update pending provider_message_id column)",
            msg_id, email, timestamp,
        )
    elif event_type == "click":
        url = event.get("url", "")
        _log.info(
            "SendGrid click: msg_id=%s email=%.2s*** url=%.60s "
            "(DB update pending provider_message_id column)",
            msg_id, email, url,
        )
    elif event_type in _SUPPRESSION_EVENTS:
        _log.info("SendGrid suppression: event=%s email=%.2s***", event_type, email)
    elif event_type in _DROP_EVENTS:
        reason = event.get("reason", "")
        _log.info("SendGrid drop: event=%s email=%.2s*** reason=%.80s",
                  event_type, email, reason)
    else:
        # Unknown / future event type — log and continue (never 500).
        _log.debug("SendGrid unhandled event type: %s msg_id=%s", event_type, msg_id)


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
    """Verify SendGrid webhook signature, parse events, dispatch, ack."""
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

    if isinstance(events, list):
        for ev in events:
            if isinstance(ev, dict):
                _dispatch_sendgrid_event(ev)

    _log.info("SendGrid webhook processed: %d event(s)", count)
    return {"received": True, "event_count": count}
