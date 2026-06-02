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
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Header, HTTPException, Request

from app.services.comms import SmsWebhookSignatureError, get_sms_gateway

_log = logging.getLogger("portal.webhooks.twilio")

router = APIRouter(tags=["webhooks"])


@router.post("/api/webhooks/twilio")
async def twilio_webhook(
    request: Request,
    x_twilio_signature: str | None = Header(None, alias="X-Twilio-Signature"),
) -> dict:
    """Verify Twilio status callback, parse form fields, ack."""
    payload = await request.body()
    gw = get_sms_gateway()
    try:
        parsed = gw.verify_webhook(payload=payload, signature=x_twilio_signature)
    except SmsWebhookSignatureError as e:
        _log.warning("Twilio webhook signature mismatch: %s", e)
        raise HTTPException(status_code=400, detail=f"Invalid signature: {e}")

    sid = (parsed or {}).get("MessageSid")
    status = (parsed or {}).get("MessageStatus")
    _log.info(
        "Twilio webhook received: MessageSid=%s MessageStatus=%s "
        "(phase=M1-C.0; handlers in M1-C.2)",
        sid, status,
    )
    # TODO M1-C.2: dispatch (sid, status) → MassBroadcast row + outbound_message update.
    return {"received": True, "message_sid": sid, "message_status": status}
