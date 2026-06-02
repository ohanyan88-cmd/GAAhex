"""M1-C Phase 0 — PaymentGateway Protocol + MockPaymentGateway + StripeGateway + factory.

Mirrors the M1-B OLT contract tests. Covers:

* MockPaymentGateway satisfies the @runtime_checkable PaymentGateway Protocol.
* All async methods round-trip with the expected result shapes.
* Mock declines on a known sentinel ('decline' suffix); raises on invalid amounts.
* Factory dispatches by settings.payment_gateway_provider with mock fallback.
* StripeGateway requires sk_/whsec_ prefixed keys.
* Stripe webhook verification skipped when SDK not installed (ImportError fallback).
"""
from __future__ import annotations

import importlib
import json

import pytest

from app.services.payments import (
    ChargeResult,
    MockPaymentGateway,
    PaymentGateway,
    PaymentGatewayCommandError,
    PaymentGatewayConfigError,
    RefundResult,
    StripeGateway,
    VaultResult,
    VoidResult,
    get_payment_gateway,
    registered_providers,
)
from app.services.payments import factory as pay_factory

try:  # detect whether the real stripe SDK is installed
    import stripe  # type: ignore  # noqa: F401
    _STRIPE_INSTALLED = True
except ImportError:
    _STRIPE_INSTALLED = False


# ──────────────────────────────────────────────────────────────────────────
# Protocol conformance
# ──────────────────────────────────────────────────────────────────────────


def test_mock_satisfies_protocol():
    gw = MockPaymentGateway()
    assert isinstance(gw, PaymentGateway)
    assert gw.provider == "mock"


def test_mock_has_full_method_surface():
    gw = MockPaymentGateway()
    for name in ("vault_card", "charge", "refund", "void",
                 "create_payment_intent_for_collection",
                 "verify_webhook", "reset"):
        assert callable(getattr(gw, name)), f"MockPaymentGateway missing {name!r}"


# ──────────────────────────────────────────────────────────────────────────
# Mock — vault / charge / refund / void
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_mock_vault_returns_synthetic_pm():
    gw = MockPaymentGateway()
    res = await gw.vault_card(
        card_token="tok_visa_4242", customer_ref="cust-1",
        customer_email="me@example.com",
    )
    assert isinstance(res, VaultResult)
    assert res.token.startswith("pm_mock_")
    assert res.last4 == "4242"
    assert res.brand == "visa"
    assert res.exp_year == 2030
    assert res.token in gw.vaulted_cards


@pytest.mark.asyncio
async def test_mock_vault_decline_sentinel_raises():
    gw = MockPaymentGateway()
    with pytest.raises(PaymentGatewayCommandError):
        await gw.vault_card(card_token="tok_decline", customer_ref="cust-1")


@pytest.mark.asyncio
async def test_mock_charge_returns_synthetic_id_and_records_state():
    gw = MockPaymentGateway()
    res = await gw.charge(
        payment_method_token="pm_mock_abc",
        amount_cents=15000,
        currency="AMD",
        description="invoice 42",
    )
    assert isinstance(res, ChargeResult)
    assert res.charge_id.startswith("ch_mock_")
    assert res.status == "succeeded"
    assert res.amount_cents == 15000
    assert res.currency == "AMD"
    assert res.charge_id in gw.charges


@pytest.mark.asyncio
async def test_mock_charge_zero_amount_raises():
    gw = MockPaymentGateway()
    with pytest.raises(PaymentGatewayCommandError):
        await gw.charge(payment_method_token="pm_mock_abc", amount_cents=0)


@pytest.mark.asyncio
async def test_mock_refund_full_and_partial():
    gw = MockPaymentGateway()
    ch = await gw.charge(payment_method_token="pm_mock_abc", amount_cents=20000)
    # full
    full = await gw.refund(charge_id=ch.charge_id)
    assert isinstance(full, RefundResult)
    assert full.amount_cents == 20000
    assert full.status == "succeeded"
    # partial against a NEW charge (the prior was already refunded; mock doesn't track balance)
    ch2 = await gw.charge(payment_method_token="pm_mock_abc", amount_cents=10000)
    partial = await gw.refund(charge_id=ch2.charge_id, amount_cents=3000)
    assert partial.amount_cents == 3000


@pytest.mark.asyncio
async def test_mock_refund_unknown_charge_raises():
    gw = MockPaymentGateway()
    with pytest.raises(PaymentGatewayCommandError):
        await gw.refund(charge_id="ch_does_not_exist")


@pytest.mark.asyncio
async def test_mock_void_cancels_charge():
    gw = MockPaymentGateway()
    ch = await gw.charge(payment_method_token="pm_mock_abc", amount_cents=15000)
    v = await gw.void(charge_id=ch.charge_id)
    assert isinstance(v, VoidResult)
    assert v.status == "canceled"
    assert gw.charges[ch.charge_id]["status"] == "canceled"


@pytest.mark.asyncio
async def test_mock_void_unknown_raises():
    gw = MockPaymentGateway()
    with pytest.raises(PaymentGatewayCommandError):
        await gw.void(charge_id="ch_nope")


@pytest.mark.asyncio
async def test_mock_create_payment_intent_for_collection_returns_client_secret():
    """M1-C.1 — the collect-new-card path returns an intent_id + client_secret pair."""
    gw = MockPaymentGateway()
    res = await gw.create_payment_intent_for_collection(amount_cents=15000, currency="AMD")
    assert res.intent_id.startswith("pi_mock_")
    assert res.client_secret.startswith(res.intent_id)
    assert res.status == "requires_payment_method"
    assert res.amount_cents == 15000
    assert res.currency == "AMD"


@pytest.mark.asyncio
async def test_mock_create_payment_intent_rejects_non_positive_amount():
    gw = MockPaymentGateway()
    with pytest.raises(PaymentGatewayCommandError):
        await gw.create_payment_intent_for_collection(amount_cents=0)


def test_mock_verify_webhook_marks_mock_and_parses_json():
    gw = MockPaymentGateway()
    payload = json.dumps({"id": "evt_1", "type": "payment_intent.succeeded"}).encode()
    parsed = gw.verify_webhook(payload=payload, signature="anything")
    assert parsed["mock"] is True
    assert parsed["id"] == "evt_1"
    assert parsed["type"] == "payment_intent.succeeded"


def test_mock_verify_webhook_handles_non_json():
    gw = MockPaymentGateway()
    parsed = gw.verify_webhook(payload=b"\xff\xfe", signature="x")
    assert parsed["mock"] is True
    assert "raw" in parsed


def test_mock_reset_clears_state():
    gw = MockPaymentGateway()
    gw.vaulted_cards["pm_a"] = {"foo": 1}
    gw.charges["ch_a"] = {"bar": 2}
    gw.refunds["re_a"] = {"baz": 3}
    gw.calls.append(("noop", {}))
    gw.reset()
    assert not gw.vaulted_cards
    assert not gw.charges
    assert not gw.refunds
    assert not gw.calls


# ──────────────────────────────────────────────────────────────────────────
# StripeGateway construction + webhook signature verification
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(_STRIPE_INSTALLED, reason="stripe SDK installed; ImportError path not exercised")
def test_stripe_construction_raises_importerror_when_sdk_missing():
    """When stripe isn't installed, construction surfaces a clear ImportError."""
    with pytest.raises(ImportError, match="stripe is required"):
        StripeGateway(
            secret_key="sk_test_abc",
            webhook_secret="whsec_xyz",
        )


@pytest.mark.skipif(not _STRIPE_INSTALLED, reason="stripe SDK not installed")
def test_stripe_construction_with_valid_config_succeeds():
    gw = StripeGateway(
        secret_key="sk_test_abc",
        webhook_secret="whsec_xyz",
    )
    assert gw.provider == "stripe"


@pytest.mark.skipif(not _STRIPE_INSTALLED, reason="stripe SDK not installed")
def test_stripe_bad_secret_key_prefix_raises_config_error():
    with pytest.raises(PaymentGatewayConfigError, match="STRIPE_SECRET_KEY"):
        StripeGateway(secret_key="bad_prefix", webhook_secret="whsec_xyz")


@pytest.mark.skipif(not _STRIPE_INSTALLED, reason="stripe SDK not installed")
def test_stripe_bad_webhook_secret_raises_config_error():
    with pytest.raises(PaymentGatewayConfigError, match="STRIPE_WEBHOOK_SECRET"):
        StripeGateway(secret_key="sk_test_abc", webhook_secret="bad")


@pytest.mark.skipif(not _STRIPE_INSTALLED, reason="stripe SDK not installed")
def test_stripe_async_methods_satisfy_protocol_shape():
    """M1-C.1: the async surface now talks to the real Stripe SDK (no more NotImplementedError).

    We don't hit the network here — the dedicated ``test_stripe_gateway_real`` file mocks
    the SDK and exercises each method's success/failure path. This is just a structural
    Protocol check: the gateway exposes every async method with an awaitable signature.
    """
    gw = StripeGateway(secret_key="sk_test_abc", webhook_secret="whsec_xyz")
    assert isinstance(gw, PaymentGateway)
    for name in ("vault_card", "charge", "refund", "void", "create_payment_intent_for_collection"):
        assert callable(getattr(gw, name)), f"StripeGateway missing {name!r}"


# ──────────────────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────────────────


def test_registered_providers_includes_mock_and_stripe():
    providers = registered_providers()
    assert "mock" in providers
    assert "stripe" in providers


def test_factory_returns_mock_when_provider_is_mock(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.payment_gateway_provider", "mock", raising=False,
    )
    gw = get_payment_gateway()
    assert isinstance(gw, MockPaymentGateway)


def test_factory_returns_mock_when_provider_is_logging_alias(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.payment_gateway_provider", "logging", raising=False,
    )
    gw = get_payment_gateway()
    assert isinstance(gw, MockPaymentGateway)


def test_factory_falls_back_to_mock_when_provider_unknown(monkeypatch, caplog):
    monkeypatch.setattr(
        "app.config.settings.payment_gateway_provider", "no-such-vendor", raising=False,
    )
    with caplog.at_level("WARNING", logger="portal.payments.factory"):
        gw = get_payment_gateway()
    assert isinstance(gw, MockPaymentGateway)


def test_factory_falls_back_to_mock_when_stripe_keys_missing(monkeypatch):
    """When provider='stripe' but secret_key isn't set, factory falls back gracefully."""
    monkeypatch.setattr(
        "app.config.settings.payment_gateway_provider", "stripe", raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.stripe_secret_key", None, raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.stripe_webhook_secret", None, raising=False,
    )
    gw = get_payment_gateway()
    # Either the mock (SDK missing → ImportError → mock, or config invalid → mock)
    # always lands on mock.
    assert isinstance(gw, MockPaymentGateway)


def test_factory_module_reload_does_not_double_register():
    """register_payment_gateway must be idempotent across module reloads."""
    importlib.reload(pay_factory)
    # Re-import (after reload) and call — must still work.
    from app.services.payments.factory import get_payment_gateway as gpg2
    gw = gpg2()
    assert gw.provider == "mock"
