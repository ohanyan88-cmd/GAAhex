"""M1-C Phase 0 — StripeGateway (real-vendor skeleton).

Lazy-imports the ``stripe`` SDK so a Portal install without the package still
boots fine — the factory catches the ``ImportError`` and falls back to the mock.

Status of methods
=================

* ``__init__`` — fully implemented. Verifies key prefixes (``sk_`` / ``whsec_``),
  raises :class:`PaymentGatewayConfigError` on missing/malformed config.
* ``verify_webhook`` — fully implemented. Stripe ships a well-documented sync
  signature check via ``stripe.Webhook.construct_event``; no network call.
* ``vault_card`` / ``charge`` / ``refund`` / ``void`` — :class:`NotImplementedError`.
  These will be wired in M1-C.1 when test keys are dropped in. Skeleton stays here
  so the Protocol is satisfied structurally and the factory can build the object.
"""
from __future__ import annotations

from .exceptions import (
    PaymentGatewayCommandError,
    PaymentGatewayConfigError,
    PaymentWebhookSignatureError,
)
from .gateway import ChargeResult, RefundResult, VaultResult, VoidResult


class StripeGateway:
    """Stripe-backed payment gateway.

    Construction requires three pieces of config:

    * ``secret_key``    — ``sk_test_…`` or ``sk_live_…`` (used to sign API calls)
    * ``webhook_secret`` — ``whsec_…`` (used to verify inbound webhooks)
    * ``api_version`` — pinned Stripe API version (default ``2024-06-20``)
    """

    provider: str = "stripe"

    def __init__(
        self,
        *,
        secret_key: str | None,
        webhook_secret: str | None,
        api_version: str = "2024-06-20",
    ) -> None:
        # Lazy import — surface a clear, actionable error if the SDK is missing.
        try:
            import stripe  # noqa: F401  pragma: no cover (covered indirectly)
        except ImportError as e:  # pragma: no cover (covered by test_stripe_import)
            raise ImportError(
                "stripe is required for StripeGateway — pip install stripe"
            ) from e

        if not secret_key or not secret_key.startswith("sk_"):
            raise PaymentGatewayConfigError(
                "STRIPE_SECRET_KEY missing or malformed (must start with 'sk_')"
            )
        if not webhook_secret or not webhook_secret.startswith("whsec_"):
            raise PaymentGatewayConfigError(
                "STRIPE_WEBHOOK_SECRET missing or malformed (must start with 'whsec_')"
            )

        self._secret_key = secret_key
        self._webhook_secret = webhook_secret
        self._api_version = api_version

    # ------------------------------------------------------------------ vault

    async def vault_card(
        self,
        *,
        card_token: str,
        customer_ref: str,
        customer_email: str | None = None,
        idempotency_key: str | None = None,
    ) -> VaultResult:
        raise NotImplementedError(
            "StripeGateway.vault_card — wire stripe.PaymentMethod.attach in M1-C.1 "
            "when test keys are available."
        )

    # ----------------------------------------------------------------- charge

    async def charge(
        self,
        *,
        payment_method_token: str,
        amount_cents: int,
        currency: str = "AMD",
        description: str | None = None,
        idempotency_key: str | None = None,
        customer_ref: str | None = None,
        metadata: dict | None = None,
    ) -> ChargeResult:
        raise NotImplementedError(
            "StripeGateway.charge — wire stripe.PaymentIntent.create in M1-C.1 "
            "when test keys are available."
        )

    # ----------------------------------------------------------------- refund

    async def refund(
        self,
        *,
        charge_id: str,
        amount_cents: int | None = None,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> RefundResult:
        raise NotImplementedError(
            "StripeGateway.refund — wire stripe.Refund.create in M1-C.1 "
            "when test keys are available."
        )

    # ------------------------------------------------------------------- void

    async def void(self, *, charge_id: str) -> VoidResult:
        raise NotImplementedError(
            "StripeGateway.void — wire stripe.PaymentIntent.cancel in M1-C.1 "
            "when test keys are available."
        )

    # ------------------------------------------------------------ verify_webhook

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str,
        timestamp: int | None = None,
    ) -> dict:
        """Verify a Stripe webhook signature via ``stripe.Webhook.construct_event``.

        Stripe's signature header (``Stripe-Signature``) carries one or more ``t=…,v1=…``
        triples; the SDK validates the HMAC-SHA256 against ``webhook_secret`` and the
        rendered ``timestamp.payload`` string. Returns the parsed ``stripe.Event``
        object as a dict.

        Raises :class:`PaymentWebhookSignatureError` on signature mismatch and
        :class:`PaymentGatewayCommandError` on any other SDK error.
        """
        import stripe

        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=signature,
                secret=self._webhook_secret,
            )
        except stripe.error.SignatureVerificationError as e:  # type: ignore[attr-defined]
            raise PaymentWebhookSignatureError(str(e)) from e
        except ValueError as e:
            # Malformed JSON body from Stripe (shouldn't happen, but be defensive).
            raise PaymentGatewayCommandError(f"Stripe webhook payload invalid: {e}") from e

        # ``construct_event`` returns a ``stripe.Event`` (which is dict-like).
        # Normalize to a plain dict so downstream callers don't care about the SDK type.
        if hasattr(event, "to_dict_recursive"):
            return event.to_dict_recursive()
        if hasattr(event, "to_dict"):
            return event.to_dict()
        try:
            return dict(event)
        except (TypeError, ValueError):
            return {"id": getattr(event, "id", None), "type": getattr(event, "type", None)}
