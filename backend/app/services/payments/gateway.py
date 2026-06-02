"""M1-C Phase 0 — Vendor-agnostic PaymentGateway Protocol + return-type dataclasses.

Design intent mirrors the OLT driver (``app.services.olt.driver``):

* **Protocol, not ABC.** Concrete vendors (Stripe, …) get duck-typed — no inheritance
  coupling. ``@runtime_checkable`` so callers can ``isinstance(gw, PaymentGateway)``.
* **Universal surface.** Six methods that any modern card processor supports:
  ``vault_card`` / ``charge`` / ``refund`` / ``void`` plus the sync ``verify_webhook``.
* **Dataclasses, not TypedDict.** Add fields later without breaking pattern matches.
* **Frozen + ``raw`` escape hatch.** Result objects are immutable; vendor-specific
  extras ride along in ``raw`` (opaque ``dict``).
* **PCI scope.** Card numbers NEVER hit the server — the frontend uses Stripe Elements
  (or equivalent) to tokenize the PAN client-side; we only ever see opaque
  ``card_token`` strings.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


# ──────────────────────────────────────────────────────────────────────────
# Return types — frozen dataclasses
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class VaultResult:
    """Outcome of ``vault_card`` — opaque payment-method token + display metadata.

    ``token`` is the vendor-issued reusable ID (``pm_…`` on Stripe). The other
    fields are safe to render in UI (last4, brand badge, expiry).
    """

    token: str
    last4: str | None
    brand: str | None       # 'visa' | 'mastercard' | 'amex' | ...
    exp_month: int | None
    exp_year: int | None
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class ChargeResult:
    """Outcome of ``charge``."""

    charge_id: str
    status: str             # 'succeeded' | 'pending' | 'requires_action' | ...
    amount_cents: int
    currency: str           # ISO 4217 (e.g. 'AMD', 'USD')
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RefundResult:
    """Outcome of ``refund``."""

    refund_id: str
    status: str             # 'succeeded' | 'pending' | 'failed'
    amount_cents: int       # actual refunded amount (may equal or be less than requested)
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class VoidResult:
    """Outcome of ``void`` — cancel an uncaptured authorization."""

    charge_id: str
    status: str             # 'canceled' | 'failed'
    raw: dict = field(default_factory=dict)


# ──────────────────────────────────────────────────────────────────────────
# Protocol
# ──────────────────────────────────────────────────────────────────────────


@runtime_checkable
class PaymentGateway(Protocol):
    """Vendor-agnostic payment gateway.

    Async I/O methods (``vault_card`` / ``charge`` / ``refund`` / ``void``)
    talk to the vendor's REST API. ``verify_webhook`` is sync because it lives
    in the HTTP request path and only does HMAC verification (no network call).

    On failure, raise one of:

    * :class:`~.exceptions.PaymentGatewayConnectionError` — network failure
    * :class:`~.exceptions.PaymentGatewayCommandError` — vendor rejected the op
    * :class:`~.exceptions.PaymentGatewayTimeoutError` — operation hung
    * :class:`~.exceptions.PaymentWebhookSignatureError` — bad webhook signature
    """

    provider: str  # 'mock' | 'logging' | 'stripe' | ...

    async def vault_card(
        self,
        *,
        card_token: str,
        customer_ref: str,
        customer_email: str | None = None,
        idempotency_key: str | None = None,
    ) -> VaultResult:
        """Persist a card for future charges.

        ``card_token`` is the short-lived token from Stripe Elements (frontend) —
        the server NEVER sees the PAN. For mock/logging gateways, ``card_token``
        is a synthetic placeholder. Returns a reusable payment-method ID.
        """
        ...

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
        """Charge a vaulted payment method. Returns the vendor charge id + status."""
        ...

    async def refund(
        self,
        *,
        charge_id: str,
        amount_cents: int | None = None,  # None = full refund
        reason: str | None = None,
        idempotency_key: str | None = None,
    ) -> RefundResult:
        """Refund a prior charge in full or in part."""
        ...

    async def void(self, *, charge_id: str) -> VoidResult:
        """Cancel an uncaptured authorization (the funds were never moved)."""
        ...

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str,
        timestamp: int | None = None,
    ) -> dict:
        """Verify webhook signature (sync — happens in HTTP path).

        Returns the parsed event dict. Raises
        :class:`~.exceptions.PaymentWebhookSignatureError` on failure.
        """
        ...
