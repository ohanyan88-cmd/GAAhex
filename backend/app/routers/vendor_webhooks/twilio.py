"""M1-C Phase 0 — Twilio Status Callback receiver.

Endpoint
========
``POST /api/webhooks/twilio``

Receives Twilio's per-message status callback (form-encoded POST). Fields of
interest: ``MessageSid``, ``MessageStatus`` (queued/sent/delivered/failed/undelivered),
``To``, ``From``, ``ErrorCode``.

Signature verification uses ``twilio.request_validator.RequestValidator`` and
the ``X-Twilio-Signature`` header. When the SDK isn't installed (dev / mock),
the mock gateway just parses the form payload and accepts it.

Phase M1-C.2 wires MessageSid → MassBroadcast row + ``outbound_message`` row
updates.

M1-C.2 dispatch notes
---------------------
Correlation between an inbound Twilio SID and a stored MassBroadcast /
OutboundMessage row requires a ``provider_message_id`` column on those tables
(not yet added — tracked for the next migration).  Until that column exists the
handler logs the delivery event at INFO level so that:

* Nothing is silently swallowed — every callback appears in the application log.
* The 200 ACK is still sent promptly (Twilio retries on non-2xx).
* No DB write is attempted against columns that don't exist, preventing runtime
  errors.

When the migration adds ``outbound_message.provider_message_id`` the body of
``_dispatch_twilio_status`` below can be replaced with a ``SELECT … WHERE
provider_message_id = sid`` + status update in a single transaction.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.comms import SmsWebhookSignatureError, get_sms_gateway

_log = logging.getLogger("portal.webhooks.twilio")

router = APIRouter(tags=["webhooks"])

# Statuses that indicate a terminal delivery outcome.
_TERMINAL_STATUSES = frozenset({"delivered", "failed", "undelivered"})
# Statuses that are intermediate / informational.
_TRANSIT_STATUSES = frozenset({"queued", "sending", "sent", "receiving", "received"})


def _dispatch_twilio_status(sid: str | None, status: str | None) -> None:
    """M1-C.2 — Dispatch a Twilio delivery status update.

    Logs the event at the appropriate level. Full DB correlation (updating
    OutboundMessage.status / MassBroadcast counters) is deferred until the
    ``provider_message_id`` column is added by migration.
    """
    if not sid:
        _log.debug("Twilio callback received with no MessageSid — skipping dispatch")
        return

    if status in _TERMINAL_STATUSES:
        if status == "delivered":
            _log.info(
                "Twilio delivery confirmed: sid=%s status=%s "
                "(DB update pending provider_message_id column)",
                sid, status,
            )
        else:
            _log.warning(
                "Twilio delivery failure: sid=%s status=%s "
                "(DB update pending provider_message_id column)",
                sid, status,
            )
    elif status in _TRANSIT_STATUSES:
        _log.debug("Twilio transit status: sid=%s status=%s", sid, status)
    else:
        # Unknown / future status values — log and continue.
        _log.info(
            "Twilio unknown status: sid=%s status=%s "
            "(no handler; DB update pending provider_message_id column)",
            sid, status,
        )


@router.post("/api/webhooks/twilio")
async def twilio_webhook(
    request: Request,
    x_twilio_signature: str | None = Header(None, alias="X-Twilio-Signature"),
) -> dict:
    """Verify Twilio status callback, parse form fields, dispatch, ack."""
    payload = await request.body()
    gw = get_sms_gateway()
    try:
        parsed = gw.verify_webhook(payload=payload, signature=x_twilio_signature)
    except SmsWebhookSignatureError as e:
        _log.warning("Twilio webhook signature mismatch: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    sid = (parsed or {}).get("MessageSid")
    status = (parsed or {}).get("MessageStatus")

    _dispatch_twilio_status(sid, status)

    return {"received": True, "message_sid": sid, "message_status": status}
