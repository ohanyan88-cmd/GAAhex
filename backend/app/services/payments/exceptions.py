"""M1-C Phase 0 — Payment gateway exception hierarchy.

Mirrors the OLT pattern: shallow, catchable as ``PaymentGatewayError``.

Concrete classes (``StripeGateway``, ``MockPaymentGateway``) raise these so
callers can decide retry / surface / escalate without reading vendor docs.
"""
from __future__ import annotations


class PaymentGatewayError(Exception):
    """Base exception for all payment gateway errors."""


class PaymentGatewayConfigError(PaymentGatewayError):
    """Vendor credentials missing, malformed, or rejected during init.

    Raised by ``StripeGateway.__init__`` when ``STRIPE_SECRET_KEY`` is missing
    or doesn't start with ``sk_``, etc. The factory catches this and falls
    back to the mock implementation with a logged warning.
    """


class PaymentGatewayConnectionError(PaymentGatewayError):
    """Could not reach the vendor API (TCP refused, DNS, network timeout)."""


class PaymentGatewayCommandError(PaymentGatewayError):
    """Vendor responded but the operation failed (declined card, insufficient funds,
    duplicate idempotency key with mismatched body, etc.)."""


class PaymentGatewayTimeoutError(PaymentGatewayError):
    """Operation took too long."""


class PaymentWebhookSignatureError(PaymentGatewayError):
    """Webhook signature verification failed.

    Raised by ``StripeGateway.verify_webhook`` when Stripe's HMAC-SHA256 check
    rejects the payload. The webhook router catches this and returns HTTP 400.
    """


class PaymentWebhookPayloadError(PaymentGatewayError):
    """Webhook signature is valid but the payload is malformed JSON or missing
    required fields (e.g. ``id`` / ``type``)."""
