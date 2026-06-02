"""M1-C Phase 0 — Vendor-agnostic payment gateway layer.

Public API
----------

Usage::

    from app.services.payments import get_payment_gateway, PaymentGatewayError

    gw = get_payment_gateway()
    try:
        vault = await gw.vault_card(card_token=..., customer_ref=...)
        charge = await gw.charge(payment_method_token=vault.token,
                                 amount_cents=12000, currency="AMD")
    except PaymentGatewayError as e:
        ...  # caller persists ServiceActionLog + surfaces to user

M1-C.1 will wire StripeGateway's async methods. Today the framework boots, the
mock is fully working, and Stripe's webhook signature verification is live.
"""
from .exceptions import (
    PaymentGatewayCardError,
    PaymentGatewayCommandError,
    PaymentGatewayConfigError,
    PaymentGatewayConnectionError,
    PaymentGatewayError,
    PaymentGatewayRateLimitError,
    PaymentGatewayTimeoutError,
    PaymentGatewayValidationError,
    PaymentWebhookPayloadError,
    PaymentWebhookSignatureError,
)
from .factory import (
    get_payment_gateway,
    register_payment_gateway,
    registered_providers,
)
from .gateway import (
    ChargeResult,
    PaymentGateway,
    PaymentIntentResult,
    RefundResult,
    VaultResult,
    VoidResult,
)
from .mock_gateway import MockPaymentGateway
from .stripe_gateway import StripeGateway

__all__ = [
    # Protocol + result dataclasses
    "PaymentGateway",
    "VaultResult",
    "ChargeResult",
    "RefundResult",
    "VoidResult",
    "PaymentIntentResult",
    # Factory
    "get_payment_gateway",
    "register_payment_gateway",
    "registered_providers",
    # Implementations
    "MockPaymentGateway",
    "StripeGateway",
    # Exceptions
    "PaymentGatewayError",
    "PaymentGatewayConfigError",
    "PaymentGatewayConnectionError",
    "PaymentGatewayCommandError",
    "PaymentGatewayTimeoutError",
    "PaymentWebhookSignatureError",
    "PaymentWebhookPayloadError",
    "PaymentGatewayCardError",
    "PaymentGatewayRateLimitError",
    "PaymentGatewayValidationError",
]
