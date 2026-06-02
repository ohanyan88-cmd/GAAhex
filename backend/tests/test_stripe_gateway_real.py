"""M1-C.1 — StripeGateway real-SDK tests.

Hermetic: every Stripe SDK call is mocked via ``unittest.mock.patch`` so the test suite
NEVER hits Stripe's actual API. We exercise:

  * vault_card success path (new customer + existing customer paths)
  * charge success / 3DS step-up (``requires_action``) / soft decline / hard decline
  * refund full + partial; against ``pi_`` and ``ch_`` ids
  * void on a cancellable PaymentIntent + the "use refund instead" rejection
  * create_payment_intent_for_collection success path
  * each Stripe error class maps to the right vendor-agnostic exception

The fixture monkey-patches ``stripe.PaymentMethod`` / ``PaymentIntent`` / ``Refund`` /
``Customer`` / ``SetupIntent`` so any code path that touches the SDK gets the mock.
``stripe.error`` and ``stripe.Webhook`` are left intact (verify_webhook tests already
exist in ``test_payment_gateway_protocol`` and don't go through these mocks).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

import stripe as _stripe  # ensure SDK is importable; module attribute access patched below

from app.services.payments import (
    ChargeResult,
    PaymentGatewayCardError,
    PaymentGatewayCommandError,
    PaymentGatewayConfigError,
    PaymentGatewayConnectionError,
    PaymentGatewayError,
    PaymentGatewayRateLimitError,
    PaymentGatewayValidationError,
    PaymentIntentResult,
    RefundResult,
    StripeGateway,
    VaultResult,
    VoidResult,
)


# ──────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────


@pytest.fixture
def gw():
    """A StripeGateway with valid test credentials."""
    return StripeGateway(secret_key="sk_test_unit", webhook_secret="whsec_unit")


@pytest.fixture
def mock_stripe():
    """Patch every Stripe SDK resource we touch so no real HTTP fires."""
    with patch("stripe.PaymentMethod") as pm, \
         patch("stripe.PaymentIntent") as pi, \
         patch("stripe.Refund") as rf, \
         patch("stripe.Customer") as cust, \
         patch("stripe.SetupIntent") as si:
        yield {
            "PaymentMethod": pm,
            "PaymentIntent": pi,
            "Refund": rf,
            "Customer": cust,
            "SetupIntent": si,
        }


def _stripe_card_obj(last4="4242", brand="visa", exp_month=12, exp_year=2030):
    """Build a MagicMock that quacks like a Stripe Card object (attribute access)."""
    card = MagicMock()
    card.last4 = last4
    card.brand = brand
    card.exp_month = exp_month
    card.exp_year = exp_year
    return card


def _stripe_pm_obj(pm_id="pm_test_abc", **card_kwargs):
    pm = MagicMock()
    pm.id = pm_id
    pm.card = _stripe_card_obj(**card_kwargs)
    return pm


# ──────────────────────────────────────────────────────────────────────────
# vault_card
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_vault_card_creates_customer_and_attaches_pm(gw, mock_stripe):
    """When metadata.customer_ref search finds nothing, we create a Customer + attach the pm."""
    # Customer.search → empty
    search_result = MagicMock()
    search_result.data = []
    mock_stripe["Customer"].search.return_value = search_result
    # Customer.create → fresh customer
    cust = MagicMock()
    cust.id = "cus_test_new"
    mock_stripe["Customer"].create.return_value = cust
    # PaymentMethod.attach → vaulted pm
    mock_stripe["PaymentMethod"].attach.return_value = _stripe_pm_obj()

    res = await gw.vault_card(
        card_token="pm_from_elements",
        customer_ref="11111111-1111-1111-1111-111111111111",
        customer_email="x@y.com",
        idempotency_key="req-1",
    )
    assert isinstance(res, VaultResult)
    assert res.token == "pm_test_abc"
    assert res.last4 == "4242"
    assert res.brand == "visa"
    assert res.exp_month == 12
    assert res.exp_year == 2030
    assert res.raw["stripe_customer_id"] == "cus_test_new"

    # Customer.create called with the right metadata + email + idempotency suffix.
    mock_stripe["Customer"].create.assert_called_once()
    create_kwargs = mock_stripe["Customer"].create.call_args.kwargs
    assert create_kwargs["email"] == "x@y.com"
    assert create_kwargs["metadata"] == {"customer_ref": "11111111-1111-1111-1111-111111111111"}
    assert create_kwargs["idempotency_key"] == "req-1:create_customer"

    # PaymentMethod.attach called with the new customer id + salted idempotency key.
    mock_stripe["PaymentMethod"].attach.assert_called_once()
    attach_args = mock_stripe["PaymentMethod"].attach.call_args
    assert attach_args.args[0] == "pm_from_elements"
    assert attach_args.kwargs["customer"] == "cus_test_new"
    assert attach_args.kwargs["idempotency_key"] == "req-1:attach_pm"


@pytest.mark.asyncio
async def test_vault_card_reuses_existing_customer(gw, mock_stripe):
    """When Customer.search finds an existing one, we DON'T create — we re-use."""
    existing = MagicMock()
    existing.id = "cus_existing"
    search_result = MagicMock()
    search_result.data = [existing]
    mock_stripe["Customer"].search.return_value = search_result
    mock_stripe["PaymentMethod"].attach.return_value = _stripe_pm_obj(pm_id="pm_attached")

    res = await gw.vault_card(card_token="pm_x", customer_ref="cust-1")
    assert res.token == "pm_attached"
    # Customer.create must NOT have been called.
    mock_stripe["Customer"].create.assert_not_called()
    mock_stripe["PaymentMethod"].attach.assert_called_once()
    assert mock_stripe["PaymentMethod"].attach.call_args.kwargs["customer"] == "cus_existing"


@pytest.mark.asyncio
async def test_vault_card_card_error_maps_to_card_error(gw, mock_stripe):
    """A Stripe CardError on attach surfaces as PaymentGatewayCardError with the code."""
    search_result = MagicMock(data=[])
    mock_stripe["Customer"].search.return_value = search_result
    mock_stripe["Customer"].create.return_value = MagicMock(id="cus_x")

    err = _stripe.error.CardError(
        message="Your card was declined.", param="number", code="card_declined",
    )
    mock_stripe["PaymentMethod"].attach.side_effect = err

    with pytest.raises(PaymentGatewayCardError) as ei:
        await gw.vault_card(card_token="pm_bad", customer_ref="cust-1")
    assert ei.value.code == "card_declined"


@pytest.mark.asyncio
async def test_vault_card_rate_limit_maps(gw, mock_stripe):
    mock_stripe["Customer"].search.side_effect = _stripe.error.RateLimitError(
        "Too many requests"
    )
    with pytest.raises(PaymentGatewayRateLimitError):
        await gw.vault_card(card_token="pm_x", customer_ref="cust-1")


@pytest.mark.asyncio
async def test_vault_card_invalid_request_maps(gw, mock_stripe):
    mock_stripe["Customer"].search.side_effect = _stripe.error.InvalidRequestError(
        "no such customer", param="customer",
    )
    with pytest.raises(PaymentGatewayValidationError):
        await gw.vault_card(card_token="pm_x", customer_ref="cust-1")


@pytest.mark.asyncio
async def test_vault_card_auth_error_maps_to_config(gw, mock_stripe):
    mock_stripe["Customer"].search.side_effect = _stripe.error.AuthenticationError(
        "Invalid API Key"
    )
    with pytest.raises(PaymentGatewayConfigError):
        await gw.vault_card(card_token="pm_x", customer_ref="cust-1")


@pytest.mark.asyncio
async def test_vault_card_connection_error_maps(gw, mock_stripe):
    mock_stripe["Customer"].search.side_effect = _stripe.error.APIConnectionError(
        "network down"
    )
    with pytest.raises(PaymentGatewayConnectionError):
        await gw.vault_card(card_token="pm_x", customer_ref="cust-1")


# ──────────────────────────────────────────────────────────────────────────
# charge
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_charge_success(gw, mock_stripe):
    """A successful PaymentIntent yields a ChargeResult with status='succeeded'."""
    intent = MagicMock()
    intent.id = "pi_test_ok"
    intent.status = "succeeded"
    intent.amount = 15000
    intent.currency = "amd"
    intent.next_action = None
    intent.client_secret = "pi_test_ok_secret_xyz"
    mock_stripe["PaymentIntent"].create.return_value = intent

    res = await gw.charge(
        payment_method_token="pm_test",
        amount_cents=15000,
        currency="AMD",
        description="Invoice INV-00001",
        idempotency_key="req-9",
        metadata={"tenant_id": "t1", "invoice_id": "i1"},
    )
    assert isinstance(res, ChargeResult)
    assert res.charge_id == "pi_test_ok"
    assert res.status == "succeeded"
    assert res.amount_cents == 15000
    assert res.currency == "AMD"
    create_kwargs = mock_stripe["PaymentIntent"].create.call_args.kwargs
    assert create_kwargs["amount"] == 15000
    assert create_kwargs["currency"] == "amd"
    assert create_kwargs["payment_method"] == "pm_test"
    assert create_kwargs["confirm"] is True
    assert create_kwargs["off_session"] is True
    assert create_kwargs["idempotency_key"] == "req-9"
    assert create_kwargs["metadata"]["invoice_id"] == "i1"


@pytest.mark.asyncio
async def test_charge_3ds_requires_action(gw, mock_stripe):
    intent = MagicMock()
    intent.id = "pi_3ds"
    intent.status = "requires_action"
    intent.amount = 5000
    intent.currency = "amd"
    intent.next_action = {"type": "use_stripe_sdk"}
    intent.client_secret = "pi_3ds_secret"
    mock_stripe["PaymentIntent"].create.return_value = intent

    res = await gw.charge(payment_method_token="pm_3ds", amount_cents=5000)
    assert res.status == "requires_action"
    assert res.raw["next_action"] == {"type": "use_stripe_sdk"}
    assert res.raw["client_secret"] == "pi_3ds_secret"


@pytest.mark.asyncio
async def test_charge_soft_decline_raises_card_error(gw, mock_stripe):
    """A PaymentIntent that comes back ``requires_payment_method`` is a soft decline → CardError."""
    intent = MagicMock()
    intent.id = "pi_soft"
    intent.status = "requires_payment_method"
    intent.amount = 5000
    intent.currency = "amd"
    mock_stripe["PaymentIntent"].create.return_value = intent

    with pytest.raises(PaymentGatewayCardError) as ei:
        await gw.charge(payment_method_token="pm_x", amount_cents=5000)
    assert ei.value.code == "card_declined"


@pytest.mark.asyncio
async def test_charge_hard_decline_via_card_error(gw, mock_stripe):
    """If the SDK raises CardError directly, surface it."""
    mock_stripe["PaymentIntent"].create.side_effect = _stripe.error.CardError(
        message="Insufficient funds", param=None, code="insufficient_funds",
    )
    with pytest.raises(PaymentGatewayCardError) as ei:
        await gw.charge(payment_method_token="pm_x", amount_cents=5000)
    assert ei.value.code == "insufficient_funds"


# ──────────────────────────────────────────────────────────────────────────
# refund
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_refund_full_against_payment_intent_id(gw, mock_stripe):
    rf = MagicMock()
    rf.id = "re_test_full"
    rf.status = "succeeded"
    rf.amount = 15000
    mock_stripe["Refund"].create.return_value = rf

    res = await gw.refund(charge_id="pi_test_ok")
    assert isinstance(res, RefundResult)
    assert res.refund_id == "re_test_full"
    assert res.status == "succeeded"
    assert res.amount_cents == 15000

    create_kwargs = mock_stripe["Refund"].create.call_args.kwargs
    assert create_kwargs["payment_intent"] == "pi_test_ok"
    assert "charge" not in create_kwargs


@pytest.mark.asyncio
async def test_refund_partial_with_reason_against_charge_id(gw, mock_stripe):
    rf = MagicMock()
    rf.id = "re_partial"
    rf.status = "succeeded"
    rf.amount = 3000
    mock_stripe["Refund"].create.return_value = rf

    res = await gw.refund(
        charge_id="ch_legacy_123",
        amount_cents=3000,
        reason="requested_by_customer",
    )
    assert res.amount_cents == 3000
    create_kwargs = mock_stripe["Refund"].create.call_args.kwargs
    assert create_kwargs["charge"] == "ch_legacy_123"
    assert create_kwargs["amount"] == 3000
    assert create_kwargs["reason"] == "requested_by_customer"


@pytest.mark.asyncio
async def test_refund_bad_charge_id_prefix_rejected(gw, mock_stripe):
    with pytest.raises(PaymentGatewayValidationError):
        await gw.refund(charge_id="nope_xyz")
    mock_stripe["Refund"].create.assert_not_called()


@pytest.mark.asyncio
async def test_refund_non_positive_amount_rejected(gw, mock_stripe):
    with pytest.raises(PaymentGatewayValidationError):
        await gw.refund(charge_id="pi_x", amount_cents=0)


@pytest.mark.asyncio
async def test_refund_drops_unknown_reason(gw, mock_stripe):
    """``reason`` only supports Stripe's vocabulary — anything else is dropped silently."""
    rf = MagicMock(id="re_x", status="succeeded", amount=100)
    mock_stripe["Refund"].create.return_value = rf
    await gw.refund(charge_id="pi_x", amount_cents=100, reason="cleanup")
    create_kwargs = mock_stripe["Refund"].create.call_args.kwargs
    assert "reason" not in create_kwargs


# ──────────────────────────────────────────────────────────────────────────
# void
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_void_cancels_payment_intent(gw, mock_stripe):
    intent = MagicMock()
    intent.id = "pi_uncaptured"
    intent.status = "canceled"
    mock_stripe["PaymentIntent"].cancel.return_value = intent

    res = await gw.void(charge_id="pi_uncaptured")
    assert isinstance(res, VoidResult)
    assert res.status == "canceled"
    assert res.charge_id == "pi_uncaptured"
    mock_stripe["PaymentIntent"].cancel.assert_called_once_with("pi_uncaptured")


@pytest.mark.asyncio
async def test_void_rejects_settled_charge_id(gw, mock_stripe):
    """``ch_`` ids can't be canceled — only refunded."""
    with pytest.raises(PaymentGatewayValidationError, match="use refund instead"):
        await gw.void(charge_id="ch_settled_123")
    mock_stripe["PaymentIntent"].cancel.assert_not_called()


@pytest.mark.asyncio
async def test_void_already_succeeded_intent_maps_to_validation(gw, mock_stripe):
    """Stripe's "cannot cancel a succeeded intent" surfaces as our 'use refund instead'."""
    mock_stripe["PaymentIntent"].cancel.side_effect = _stripe.error.InvalidRequestError(
        "You cannot cancel this PaymentIntent because it has already succeeded.",
        param=None,
    )
    with pytest.raises(PaymentGatewayValidationError, match="use refund instead"):
        await gw.void(charge_id="pi_already_done")


@pytest.mark.asyncio
async def test_void_bad_prefix_rejected(gw, mock_stripe):
    with pytest.raises(PaymentGatewayValidationError):
        await gw.void(charge_id="not_a_real_id")


# ──────────────────────────────────────────────────────────────────────────
# create_payment_intent_for_collection
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_payment_intent_for_collection(gw, mock_stripe):
    intent = MagicMock()
    intent.id = "pi_collect"
    intent.client_secret = "pi_collect_secret_x"
    intent.status = "requires_payment_method"
    intent.amount = 9000
    intent.currency = "amd"
    mock_stripe["PaymentIntent"].create.return_value = intent

    res = await gw.create_payment_intent_for_collection(
        amount_cents=9000, currency="AMD", description="INV-2",
        metadata={"tenant_id": "t1"},
    )
    assert isinstance(res, PaymentIntentResult)
    assert res.intent_id == "pi_collect"
    assert res.client_secret == "pi_collect_secret_x"
    assert res.amount_cents == 9000
    assert res.currency == "AMD"
    # NOTE: confirm + off_session are NOT set for the collect-new-card flow.
    create_kwargs = mock_stripe["PaymentIntent"].create.call_args.kwargs
    assert "confirm" not in create_kwargs
    assert "off_session" not in create_kwargs
    assert create_kwargs["automatic_payment_methods"] == {"enabled": True}


@pytest.mark.asyncio
async def test_create_payment_intent_propagates_stripe_error(gw, mock_stripe):
    mock_stripe["PaymentIntent"].create.side_effect = _stripe.error.InvalidRequestError(
        "amount must be at least 50", param="amount",
    )
    with pytest.raises(PaymentGatewayValidationError):
        await gw.create_payment_intent_for_collection(amount_cents=1)


# ──────────────────────────────────────────────────────────────────────────
# Construction guards
# ──────────────────────────────────────────────────────────────────────────


def test_stripe_gateway_requires_sk_prefix():
    with pytest.raises(PaymentGatewayConfigError):
        StripeGateway(secret_key="bad", webhook_secret="whsec_x")


def test_stripe_gateway_requires_whsec_prefix():
    with pytest.raises(PaymentGatewayConfigError):
        StripeGateway(secret_key="sk_test_x", webhook_secret="bad")
