"""C2 — payment kill-switch: inbound payment callbacks/webhooks fail-closed (503) when disabled.

Payments are not live; FEATURE_PAYMENTS_ENABLED defaults OFF in prod, so every inbound payment callback
is rejected BEFORE any signature verification or settle — closing the unsigned-callback forgery surface
platform-wide. Tests run with it ON (conftest); these flip it OFF to prove the block, and confirm the
guard is open when ON.
"""
from app.config import settings


async def test_generic_payment_callback_blocked_when_disabled(client, monkeypatch):
    # /api/payment/callback/{provider} (idram/easypay/telcell/arca) — the forgeable path
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    r = await client.post("/api/payment/callback/idram", content=b"EDP_TRANS_STATUS=SUCCESS")
    assert r.status_code == 503, r.text


async def test_stripe_webhook_blocked_when_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "feature_payments_enabled", False)
    r = await client.post("/api/webhooks/stripe", content=b"{}", headers={"Stripe-Signature": "t=1,v1=x"})
    assert r.status_code == 503, r.text


async def test_killswitch_open_when_enabled(client):
    # Default in tests is ENABLED (conftest). The guard must NOT 503 — the request proceeds past it (to
    # verify/lookup, which 404s on an unknown order). Proves the kill-switch is open when the flag is on
    # (and that the 503 above is the switch, not an unrelated failure).
    r = await client.post("/api/payment/callback/idram", content=b"EDP_TRANS_STATUS=SUCCESS")
    assert r.status_code != 503, r.text
