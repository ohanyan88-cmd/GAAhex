"""M-21 — Vendor webhook router tests: SendGrid + Twilio.

Covers:
  * Valid payload → 200 + expected response shape
  * Missing / invalid HMAC signature → 400 (real-gateway path, via monkeypatch)
  * Unknown / unsupported event type → handled gracefully (200, not 500)
  * Empty payload → 200 (mock gateway accepts anything)
  * Form-encoded payload (Twilio) → 200
  * Each provider (SendGrid, Twilio) tested independently

Strategy
========
The endpoints call ``get_email_gateway()`` / ``get_sms_gateway()`` at request time.
In the test environment (``EMAIL_GATEWAY_PROVIDER`` unset, ``SMS_GATEWAY_PROVIDER``
unset) both factories return their mock implementations, which accept any signature.

For the signature-rejection path we monkeypatch the gateway's ``verify_webhook``
method to raise the appropriate ``*WebhookSignatureError`` — this lets us test the
HTTP error translation without spinning up the real SendGrid/Twilio SDKs.
"""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from app.services.comms import (
    EmailWebhookSignatureError,
    SmsWebhookSignatureError,
)


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


async def _post_sendgrid(client, payload: bytes, *, sig: str = "t=1,v1=mock") -> object:
    return await client.post(
        "/api/webhooks/sendgrid",
        content=payload,
        headers={
            "Content-Type": "application/json",
            "X-Twilio-Email-Event-Webhook-Signature": sig,
            "X-Twilio-Email-Event-Webhook-Timestamp": "1700000000",
        },
    )


async def _post_twilio(
    client,
    payload: bytes,
    *,
    sig: str = "mock-sig",
    content_type: str = "application/x-www-form-urlencoded",
) -> object:
    return await client.post(
        "/api/webhooks/twilio",
        content=payload,
        headers={
            "Content-Type": content_type,
            "X-Twilio-Signature": sig,
        },
    )


# ──────────────────────────────────────────────────────────────────────────────
# SendGrid
# ──────────────────────────────────────────────────────────────────────────────


async def test_sendgrid_valid_payload_returns_200(client):
    """A well-formed SendGrid event array → 200 + received=True."""
    events = [
        {"event": "delivered", "email": "u@example.com", "timestamp": 1700000000},
        {"event": "open", "email": "u@example.com", "timestamp": 1700000001},
    ]
    r = await _post_sendgrid(client, json.dumps(events).encode())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    assert body["event_count"] == 2


async def test_sendgrid_empty_payload_returns_200(client):
    """Empty body is accepted gracefully — mock gateway returns an empty events list."""
    r = await _post_sendgrid(client, b"")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    assert body["event_count"] == 0


async def test_sendgrid_unknown_event_type_returns_200(client):
    """An event type we don't yet handle (e.g. 'group_unsubscribe') → 200, not 500."""
    events = [{"event": "group_unsubscribe", "email": "x@example.com"}]
    r = await _post_sendgrid(client, json.dumps(events).encode())
    assert r.status_code == 200, r.text
    assert r.json()["received"] is True


async def test_sendgrid_single_event_object_returns_200(client):
    """Single dict payload (non-array) is handled without error."""
    r = await _post_sendgrid(client, json.dumps({"event": "bounce"}).encode())
    assert r.status_code == 200, r.text


async def test_sendgrid_invalid_signature_returns_400(client):
    """When the real gateway raises EmailWebhookSignatureError the endpoint returns 400."""
    events = [{"event": "delivered", "email": "u@example.com"}]
    payload = json.dumps(events).encode()

    with patch("app.routers.vendor_webhooks.sendgrid.get_email_gateway") as mock_factory:
        mock_gw = mock_factory.return_value
        mock_gw.verify_webhook.side_effect = EmailWebhookSignatureError(
            "signature mismatch"
        )
        r = await _post_sendgrid(client, payload, sig="t=0,v1=badhash")

    assert r.status_code == 400, r.text
    assert "Invalid signature" in r.json()["detail"]


async def test_sendgrid_missing_signature_header_still_200_in_mock_mode(client):
    """In mock mode a missing signature header is accepted (dev-friendly)."""
    events = [{"event": "click", "url": "https://example.com"}]
    r = await client.post(
        "/api/webhooks/sendgrid",
        content=json.dumps(events).encode(),
        headers={"Content-Type": "application/json"},
        # deliberately omit the X-Twilio-Email-Event-Webhook-Signature header
    )
    # Mock gateway doesn't check the signature; should 200.
    assert r.status_code == 200, r.text


# ──────────────────────────────────────────────────────────────────────────────
# Twilio
# ──────────────────────────────────────────────────────────────────────────────


async def test_twilio_valid_form_payload_returns_200(client):
    """A well-formed Twilio status callback (form-encoded) → 200 + received=True."""
    body = b"MessageSid=SM123&MessageStatus=delivered&To=%2B37411223344&From=%2B1234567890"
    r = await _post_twilio(client, body)
    assert r.status_code == 200, r.text
    resp = r.json()
    assert resp["received"] is True
    assert resp["message_sid"] == "SM123"
    assert resp["message_status"] == "delivered"


async def test_twilio_queued_status_returns_200(client):
    """'queued' status is a normal callback — should ack 200."""
    body = b"MessageSid=SM_q1&MessageStatus=queued"
    r = await _post_twilio(client, body)
    assert r.status_code == 200, r.text
    assert r.json()["message_status"] == "queued"


async def test_twilio_failed_status_returns_200(client):
    """'failed' status is a normal callback — endpoint must not raise, just ack."""
    body = b"MessageSid=SM_fail&MessageStatus=failed&ErrorCode=30007"
    r = await _post_twilio(client, body)
    assert r.status_code == 200, r.text
    assert r.json()["received"] is True


async def test_twilio_empty_payload_returns_200(client):
    """Empty body (e.g. a keep-alive ping) is handled gracefully."""
    r = await _post_twilio(client, b"")
    assert r.status_code == 200, r.text
    assert r.json()["received"] is True


async def test_twilio_json_payload_returns_200(client):
    """Some Twilio integrations POST JSON — gateway mock handles both formats."""
    payload = json.dumps({"MessageSid": "SM_j1", "MessageStatus": "sent"}).encode()
    r = await _post_twilio(
        client, payload, content_type="application/json"
    )
    assert r.status_code == 200, r.text
    assert r.json()["received"] is True


async def test_twilio_invalid_signature_returns_400(client):
    """When the real gateway raises SmsWebhookSignatureError the endpoint returns 400."""
    body = b"MessageSid=SM_bad&MessageStatus=delivered"

    with patch("app.routers.vendor_webhooks.twilio.get_sms_gateway") as mock_factory:
        mock_gw = mock_factory.return_value
        mock_gw.verify_webhook.side_effect = SmsWebhookSignatureError(
            "X-Twilio-Signature mismatch"
        )
        r = await _post_twilio(client, body, sig="bad-sig")

    assert r.status_code == 400, r.text
    assert "Invalid signature" in r.json()["detail"]


async def test_twilio_unknown_message_status_returns_200(client):
    """A MessageStatus value we don't recognise (future Twilio addition) → 200, not 500."""
    body = b"MessageSid=SM_unk&MessageStatus=future_status_xyz"
    r = await _post_twilio(client, body)
    assert r.status_code == 200, r.text
    assert r.json()["received"] is True


async def test_twilio_missing_signature_header_still_200_in_mock_mode(client):
    """In mock mode a missing X-Twilio-Signature header is accepted."""
    body = b"MessageSid=SM_nosig&MessageStatus=sent"
    r = await client.post(
        "/api/webhooks/twilio",
        content=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        # deliberately omit X-Twilio-Signature
    )
    assert r.status_code == 200, r.text
