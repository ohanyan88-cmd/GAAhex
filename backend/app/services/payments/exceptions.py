"""M1-C Phase 0 — Payment gateway exception hierarchy.

Mirrors the OLT pattern: shallow, catchable as ``PaymentGatewayError``.

Concrete classes (``StripeGateway``, ``MockPaymentGateway``) raise these so
callers can decide retry / surface / escalate without reading vendor docs.

M1-C.1 additions (Stripe SDK wiring):
  * ``PaymentGatewayCardError``       — card declined / invalid / expired (Stripe ``CardError``)
  * ``PaymentGatewayRateLimitError``  — vendor rate limit hit
  * ``PaymentGatewayValidationError`` — bad input the vendor rejected (Stripe ``InvalidRequestError``)
  * ``PaymentGatewayAuthError``       — vendor auth failed (alias of ``PaymentGatewayConfigError``
    surfaced under a vendor-runtime name for catch-clauses that want to be explicit)

All M1-C.1 additions remain subclasses of :class:`PaymentGatewayError` so existing broad
catches in the routers continue to work without changes.
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


# ──────────────────────────────────────────────────────────────────────────
# M1-C.1 — vendor-runtime exception subclasses
# ──────────────────────────────────────────────────────────────────────────
#
# Stripe's ``StripeError`` hierarchy distinguishes a handful of cases we care
# about at the router boundary (card declines surface 402 to the customer; rate
# limits get backoff; validation errors are 422; everything else is 503). We mirror
# that breakdown into our vendor-agnostic exception tree so routers don't import
# the ``stripe`` SDK directly. Mock + Stripe both raise these; the routers map
# them to HTTP status codes without caring which vendor produced the error.


class PaymentGatewayCardError(PaymentGatewayCommandError):
    """Card-side rejection (declined / insufficient funds / expired / fraud / bad CVC).

    Subclass of ``PaymentGatewayCommandError`` so any existing broad catch keeps working.
    Carries an optional ``code`` (Stripe's machine-readable decline code, e.g.
    ``card_declined``, ``insufficient_funds``, ``expired_card``) for router-side
    branching (different UX per code).
    """

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


class PaymentGatewayRateLimitError(PaymentGatewayError):
    """Vendor returned a rate-limit (Stripe ``RateLimitError`` — HTTP 429).

    Routers should surface 503 + retry-after; the runner is expected to back off
    and retry. Not a ``CommandError`` because the command isn't logically wrong —
    we just hit a throughput ceiling.
    """


class PaymentGatewayValidationError(PaymentGatewayError):
    """Vendor rejected the request as malformed/invalid (Stripe ``InvalidRequestError``).

    Distinct from ``CardError`` (the card was fine — the request itself was bad)
    and ``ConfigError`` (the credentials were the problem). Routers should surface 422.
    """
