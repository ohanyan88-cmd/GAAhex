"""M1-C Phase 0 — Webhook router HTTP-shape tests.

Each route is registered on the global FastAPI app at module-import time, so
we just hit them via the shared ``client`` fixture (from conftest).

In mock mode (the default for tests), signature verification is permissive —
the mock gateways accept any signature and return ``{mock: True, ...}``. So
the success path here is structural: 200 + the expected response shape.
"""
from __future__ import annotations

import json

import pytest


# ──────────────────────────────────────────────────────────────────────────
# Stripe webhook (POST /api/webhooks/stripe)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stripe_webhook_missing_signature_returns_422(client):
    """The route requires the Stripe-Signature header; FastAPI returns 422 when missing."""
    r = await client.post("/api/webhooks/stripe", content=b"{}")
    assert r.status_code in (400, 422), r.text


@pytest.mark.asyncio
async def test_stripe_webhook_mock_mode_accepts_any_signature(client):
    """In mock mode the MockPaymentGateway accepts any signature and parses the JSON event."""
    payload = json.dumps({"id": "evt_1", "type": "payment_intent.succeeded"}).encode()
    r = await client.post(
        "/api/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": "t=0,v1=mock", "Content-Type": "application/json"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    assert body["event_id"] == "evt_1"
    assert body["event_type"] == "payment_intent.succeeded"


@pytest.mark.asyncio
async def test_stripe_webhook_real_mode_rejects_bad_signature(client, monkeypatch):
    """When the active gateway is StripeGateway, a bad signature must yield 400.

    Skips if the stripe SDK isn't installed (we can't construct StripeGateway).
    """
    pytest.importorskip("stripe")
    from app.services.payments import StripeGateway

    # Inject a real StripeGateway with a valid-looking config and have the
    # endpoint pick it up via the factory.
    monkeypatch.setattr(
        "app.config.settings.payment_gateway_provider", "stripe", raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.stripe_secret_key", "sk_test_xxx", raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.stripe_webhook_secret", "whsec_xxx", raising=False,
    )

    # Sanity: the factory should now build StripeGateway, not Mock.
    from app.services.payments import get_payment_gateway
    gw = get_payment_gateway()
    if not isinstance(gw, StripeGateway):  # config error → fell back to mock; skip
        pytest.skip("StripeGateway not active in this env")

    payload = json.dumps({"id": "evt_1", "type": "x"}).encode()
    r = await client.post(
        "/api/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": "t=0,v1=garbage", "Content-Type": "application/json"},
    )
    assert r.status_code == 400, r.text


# ──────────────────────────────────────────────────────────────────────────
# SendGrid webhook (POST /api/webhooks/sendgrid)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sendgrid_webhook_mock_mode_accepts_event_array(client):
    events = [{"event": "delivered", "sg_message_id": "m1"}]
    r = await client.post(
        "/api/webhooks/sendgrid",
        content=json.dumps(events).encode(),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    assert body["event_count"] == 1


@pytest.mark.asyncio
async def test_sendgrid_webhook_mock_mode_handles_empty_body(client):
    r = await client.post("/api/webhooks/sendgrid", content=b"")
    assert r.status_code == 200, r.text
    assert r.json()["event_count"] == 0


# ──────────────────────────────────────────────────────────────────────────
# Twilio webhook (POST /api/webhooks/twilio)
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_twilio_webhook_mock_mode_parses_form_encoded(client):
    body = "MessageSid=SM123&MessageStatus=delivered&To=%2B37411223344"
    r = await client.post(
        "/api/webhooks/twilio",
        content=body.encode(),
        headers={
            "X-Twilio-Signature": "mock-sig",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["received"] is True
    assert payload["message_sid"] == "SM123"
    assert payload["message_status"] == "delivered"


@pytest.mark.asyncio
async def test_twilio_webhook_mock_mode_missing_signature_still_accepts(client):
    """Mock mode is permissive — production Twilio gateway would reject a missing sig."""
    body = "MessageSid=SM999&MessageStatus=failed"
    r = await client.post(
        "/api/webhooks/twilio",
        content=body.encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["message_sid"] == "SM999"
