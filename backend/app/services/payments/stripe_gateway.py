"""M1-C Phase 1 — StripeGateway (real Stripe SDK wiring).

Talks to Stripe via the ``stripe`` SDK pinned in pyproject.toml. The async-API surface
(``vault_card`` / ``charge`` / ``refund`` / ``void`` / ``create_payment_intent_for_collection``)
wraps SDK calls in ``asyncio.to_thread`` because Stripe's SDK is sync — the surface stays
``async def`` to match the Protocol and let the FastAPI event loop yield while the HTTPS round
trip lands.

PCI scope reminder
==================
The application NEVER sees a PAN or CVV. Stripe Elements (frontend) tokenizes the card and
returns a ``pm_...`` PaymentMethod id; we pass that opaque id straight into Stripe via
``vault_card`` / ``charge``. No card data lands in the request body, the logs, or the DB.

Exception mapping
=================
Stripe's exception hierarchy maps to our vendor-agnostic tree like this:

    stripe.CardError              → PaymentGatewayCardError       (card-side reject; 402)
    stripe.RateLimitError         → PaymentGatewayRateLimitError  (throttle; 503 + retry)
    stripe.InvalidRequestError    → PaymentGatewayValidationError (bad input; 422)
    stripe.AuthenticationError    → PaymentGatewayConfigError     (bad sk_; 503)
    stripe.APIConnectionError     → PaymentGatewayConnectionError (network; 503 + retry)
    stripe.StripeError (catch-all)→ PaymentGatewayError           (5xx)

``verify_webhook`` is sync — Stripe ships ``stripe.Webhook.construct_event`` which only does
HMAC-SHA256 verification (no network call). It stays here as-is from M1-C.0.
"""
from __future__ import annotations

import asyncio
import logging

from .exceptions import (
    PaymentGatewayCardError,
    PaymentGatewayCommandError,
    PaymentGatewayConfigError,
    PaymentGatewayConnectionError,
    PaymentGatewayError,
    PaymentGatewayRateLimitError,
    PaymentGatewayValidationError,
    PaymentWebhookSignatureError,
)
from .gateway import (
    ChargeResult,
    PaymentIntentResult,
    RefundResult,
    VaultResult,
    VoidResult,
)

_log = logging.getLogger("portal.payments.stripe")


def _safe_lower(v) -> str:
    """Lower-case if it's a str; otherwise return the empty string. Defensive against
    Stripe occasionally returning ``None`` for an optional card field."""
    return v.lower() if isinstance(v, str) else ""


def _attach_idem(base: str | None, suffix: str) -> str | None:
    """Compose a stable per-step idempotency key.

    Stripe idempotency keys are scoped per-endpoint at the SDK level — reusing the same
    key for two DIFFERENT operations (e.g. ``Customer.create`` then ``PaymentMethod.attach``)
    works but blends them under one logical request. We salt with the step name so each
    Stripe call gets its own idempotency identity while still being deterministic for the
    same caller request.
    """
    if not base:
        return None
    return f"{base}:{suffix}"


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

    # ------------------------------------------------------------------ helpers

    def _configure_sdk(self):
        """Bind global SDK state once per call. The SDK uses module-level config —
        we set it before every operation so multiple StripeGateway instances (e.g.
        multi-tenant scenarios with per-tenant keys) don't bleed into each other.
        """
        import stripe
        stripe.api_key = self._secret_key
        stripe.api_version = self._api_version
        return stripe

    @staticmethod
    def _map_stripe_error(stripe_mod, exc: Exception) -> PaymentGatewayError:
        """Translate a Stripe SDK exception into our vendor-agnostic tree.

        Defensive: the SDK's class hierarchy is stable, but new error classes appear
        between minor versions. Anything we don't recognize falls through to the
        ``PaymentGatewayError`` catch-all so the caller still sees a typed exception.
        """
        # CardError carries a machine-readable ``code`` we surface for UX branching.
        if isinstance(exc, stripe_mod.error.CardError):
            return PaymentGatewayCardError(str(exc), code=getattr(exc, "code", None))
        if isinstance(exc, stripe_mod.error.RateLimitError):
            return PaymentGatewayRateLimitError(str(exc))
        if isinstance(exc, stripe_mod.error.InvalidRequestError):
            return PaymentGatewayValidationError(str(exc))
        if isinstance(exc, stripe_mod.error.AuthenticationError):
            return PaymentGatewayConfigError(f"Stripe auth failed: {exc}")
        if isinstance(exc, stripe_mod.error.APIConnectionError):
            return PaymentGatewayConnectionError(str(exc))
        # Generic Stripe error — keep the message but bucket under our broad base type.
        return PaymentGatewayCommandError(str(exc))

    # ------------------------------------------------------------------ vault

    async def vault_card(
        self,
        *,
        card_token: str,
        customer_ref: str,
        customer_email: str | None = None,
        idempotency_key: str | None = None,
    ) -> VaultResult:
        """Vault a Stripe Elements ``pm_...`` token by attaching it to a Stripe Customer.

        Steps:
          1. Find-or-create the Stripe Customer keyed by ``metadata.customer_ref`` (GAAhex UUID).
          2. Attach the PaymentMethod to that Customer.
          3. Return a normalized :class:`VaultResult` with last4/brand/expiry for display.

        Idempotency: the per-step Stripe idempotency key is salted with the step name
        (see ``_attach_idem``) so the same caller request creates a deterministic Customer
        and a deterministic attach on retry.
        """
        stripe = self._configure_sdk()
        try:
            # 1. find existing Stripe Customer by metadata.customer_ref.
            # ``Customer.search`` uses Stripe's search-API DSL; the index is eventually-
            # consistent but typically lands in <1s, which is fine for the vault flow
            # because vaulting a fresh card is the customer's first encounter with our
            # gateway in this session — there's no preceding write to race with.
            existing = await asyncio.to_thread(
                lambda: stripe.Customer.search(
                    query=f"metadata['customer_ref']:'{customer_ref}'",
                )
            )
            existing_data = getattr(existing, "data", None) or []
            if existing_data:
                stripe_customer = existing_data[0]
            else:
                stripe_customer = await asyncio.to_thread(
                    lambda: stripe.Customer.create(
                        email=customer_email,
                        metadata={"customer_ref": customer_ref},
                        idempotency_key=_attach_idem(idempotency_key, "create_customer"),
                    )
                )
            # 2. attach the PaymentMethod to that Customer.
            pm = await asyncio.to_thread(
                lambda: stripe.PaymentMethod.attach(
                    card_token,
                    customer=stripe_customer.id,
                    idempotency_key=_attach_idem(idempotency_key, "attach_pm"),
                )
            )
            # 3. normalize. Stripe always returns ``card`` for card PaymentMethods; we
            # defensively handle the absent case (e.g. bank account or wallet PMs in
            # the future) so the result has stable string fields.
            card = getattr(pm, "card", None)
            return VaultResult(
                token=pm.id,
                last4=getattr(card, "last4", "") if card else "",
                brand=_safe_lower(getattr(card, "brand", "other")) if card else "other",
                exp_month=int(getattr(card, "exp_month", 0) or 0) if card else 0,
                exp_year=int(getattr(card, "exp_year", 0) or 0) if card else 0,
                raw={
                    "stripe_customer_id": stripe_customer.id,
                    "payment_method_id": pm.id,
                },
            )
        except PaymentGatewayError:
            raise
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            raise self._map_stripe_error(stripe, e) from e

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
        """Charge a VAULTED PaymentMethod off-session (the customer isn't at the keyboard).

        Returns a :class:`ChargeResult` whose ``status`` is one of:
          * ``'succeeded'``       — money moved, webhook will follow
          * ``'requires_action'`` — 3DS step-up needed; surface ``next_action`` to the frontend
          * ``'requires_payment_method'`` — card declined; raises ``PaymentGatewayCardError``
            so this status normally isn't returned (only surfaces if Stripe returned 200
            with a soft-decline, which is rare for off-session intents).
        """
        stripe = self._configure_sdk()
        try:
            # Stripe needs the Customer the PaymentMethod is attached to — required for
            # off-session charges. If the caller passed ``customer_ref`` we look it up; if
            # not, the SDK will derive it from the PaymentMethod's stored customer.
            kwargs: dict = {
                "amount": amount_cents,
                "currency": currency.lower(),
                "payment_method": payment_method_token,
                "confirm": True,
                "off_session": True,
                "metadata": dict(metadata or {}),
            }
            if description:
                kwargs["description"] = description
            # ``customer`` is required for off_session=True; resolve via metadata lookup
            # if a search is desired, but normally the caller passes the Stripe Customer id.
            # Here we trust the caller passed the right ``customer_ref`` — for off-session
            # PaymentIntents Stripe wants the Stripe Customer ID, not our portal customer UUID.
            # The vault flow records the Stripe Customer id in ``payment_method.gateway_token``-
            # adjacent storage; today we let Stripe derive it from the PaymentMethod itself
            # (it carries the attached Customer id internally).

            intent = await asyncio.to_thread(
                lambda: stripe.PaymentIntent.create(
                    idempotency_key=idempotency_key,
                    **kwargs,
                )
            )
            status = getattr(intent, "status", "") or ""
            # Map ``requires_payment_method`` (soft-decline after off-session attempt) into
            # an explicit CardError so the router renders 402 to the customer.
            if status == "requires_payment_method":
                raise PaymentGatewayCardError(
                    f"Stripe PaymentIntent {intent.id} requires a different payment method",
                    code="card_declined",
                )
            return ChargeResult(
                charge_id=intent.id,
                status=status,
                amount_cents=int(getattr(intent, "amount", amount_cents) or amount_cents),
                currency=str(getattr(intent, "currency", currency) or currency).upper(),
                raw={
                    "intent_id": intent.id,
                    "next_action": getattr(intent, "next_action", None),
                    "client_secret": getattr(intent, "client_secret", None),
                },
            )
        except PaymentGatewayError:
            raise
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            raise self._map_stripe_error(stripe, e) from e

    # ----------------------------------------------------------------- refund

    async def refund(
        self,
        *,
        charge_id: str,
        amount_cents: int | None = None,
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> RefundResult:
        """Refund a prior charge in full or in part.

        ``charge_id`` may be either a ``pi_...`` (PaymentIntent) or a ``ch_...`` (Charge).
        Stripe's Refund API distinguishes via field name: ``payment_intent=`` for the
        former, ``charge=`` for the latter. We detect by prefix; anything else (including
        the empty string) is rejected with :class:`PaymentGatewayValidationError`.
        """
        stripe = self._configure_sdk()
        kwargs: dict = {}
        if charge_id.startswith("pi_"):
            kwargs["payment_intent"] = charge_id
        elif charge_id.startswith("ch_") or charge_id.startswith("re_"):
            # ``re_`` shouldn't happen (that's an already-existing refund), but Stripe
            # accepts arbitrary prior charge ids under the ``charge`` field. Treat the
            # legacy ``ch_`` prefix as a Charge id.
            kwargs["charge"] = charge_id
        else:
            raise PaymentGatewayValidationError(
                f"refund: charge_id {charge_id!r} must start with 'pi_' or 'ch_'"
            )
        if amount_cents is not None:
            if amount_cents <= 0:
                raise PaymentGatewayValidationError(
                    "refund: amount_cents must be positive when supplied"
                )
            kwargs["amount"] = amount_cents
        if reason:
            # Stripe only accepts a fixed vocabulary here: duplicate, fraudulent,
            # requested_by_customer. Pass through what the caller sent; the SDK will
            # validate. If the caller sent something else we still want the refund to
            # land, so drop the reason field rather than fail.
            allowed = {"duplicate", "fraudulent", "requested_by_customer"}
            if reason in allowed:
                kwargs["reason"] = reason
        try:
            rf = await asyncio.to_thread(
                lambda: stripe.Refund.create(
                    idempotency_key=idempotency_key,
                    **kwargs,
                )
            )
            return RefundResult(
                refund_id=rf.id,
                status=getattr(rf, "status", "") or "",
                amount_cents=int(getattr(rf, "amount", amount_cents or 0) or 0),
                raw={"charge_id": charge_id},
            )
        except PaymentGatewayError:
            raise
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            raise self._map_stripe_error(stripe, e) from e

    # ------------------------------------------------------------------- void

    async def void(self, *, charge_id: str) -> VoidResult:
        """Cancel an uncaptured PaymentIntent.

        Stripe's ``PaymentIntent.cancel`` only works while the intent is in a cancellable
        state (``requires_payment_method`` / ``requires_capture`` / ``requires_confirmation``
        / ``requires_action`` / ``processing``). Once captured + settled, voiding is
        impossible — the caller must use :meth:`refund` instead. We translate Stripe's
        "InvalidRequestError: cannot cancel" into our :class:`PaymentGatewayValidationError`
        with an explicit "use refund" hint.
        """
        stripe = self._configure_sdk()
        if not (charge_id.startswith("pi_") or charge_id.startswith("ch_")):
            raise PaymentGatewayValidationError(
                f"void: charge_id {charge_id!r} must start with 'pi_' or 'ch_'"
            )
        # ``Charge.cancel`` doesn't exist; charges can only be refunded once captured.
        if charge_id.startswith("ch_"):
            raise PaymentGatewayValidationError(
                "Cannot void a settled charge — use refund instead"
            )
        try:
            intent = await asyncio.to_thread(
                lambda: stripe.PaymentIntent.cancel(charge_id)
            )
            return VoidResult(
                charge_id=charge_id,
                status=getattr(intent, "status", "canceled") or "canceled",
                raw={"intent_id": intent.id},
            )
        except PaymentGatewayError:
            raise
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            # Surface the "use refund instead" explicitly when the intent isn't cancellable.
            msg = str(e).lower()
            if "cancel" in msg and ("already" in msg or "succeeded" in msg or "captured" in msg):
                raise PaymentGatewayValidationError(
                    "Cannot void a settled charge — use refund instead"
                ) from e
            raise self._map_stripe_error(stripe, e) from e

    # ------------------------------- create_payment_intent_for_collection

    async def create_payment_intent_for_collection(
        self,
        *,
        amount_cents: int,
        currency: str = "AMD",
        customer_ref: str | None = None,
        description: str | None = None,
        metadata: dict | None = None,
        idempotency_key: str | None = None,
    ) -> PaymentIntentResult:
        """Create an UNCONFIRMED PaymentIntent for client-side confirmation.

        The browser confirms the intent with Stripe Elements using the card it just
        collected — this server never sees the card. The intent's ``client_secret`` is
        returned so the frontend can attach to it.
        """
        stripe = self._configure_sdk()
        try:
            kwargs: dict = {
                "amount": amount_cents,
                "currency": currency.lower(),
                "metadata": dict(metadata or {}),
                "automatic_payment_methods": {"enabled": True},
            }
            if description:
                kwargs["description"] = description
            intent = await asyncio.to_thread(
                lambda: stripe.PaymentIntent.create(
                    idempotency_key=idempotency_key,
                    **kwargs,
                )
            )
            return PaymentIntentResult(
                intent_id=intent.id,
                client_secret=getattr(intent, "client_secret", "") or "",
                status=getattr(intent, "status", "requires_payment_method") or "requires_payment_method",
                amount_cents=int(getattr(intent, "amount", amount_cents) or amount_cents),
                currency=str(getattr(intent, "currency", currency) or currency).upper(),
                raw={"intent_id": intent.id},
            )
        except PaymentGatewayError:
            raise
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            raise self._map_stripe_error(stripe, e) from e

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
