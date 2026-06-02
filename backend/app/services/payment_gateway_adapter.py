"""Phase B.1 — Payment gateway adapter (vault + charge + void).

A thin Protocol over the payment-vault surface so the application can swap providers (Stripe,
Adyen, Arca local processor, ...) without touching the routers. v1 ships ONE implementation:
``LoggingGateway``, a deterministic synthetic vault used for local dev + tests + the demo
build. It does NOT call any real gateway; the "token" is a ``tok_log_<uuid>`` string and the
``last4`` / ``brand`` come from inspecting the card_number's leading digits via a simple
Luhn-prefix rule (no checksum is performed — synthetic-only).

The router NEVER persists PAN or CVV. Raw card data is accepted as Python parameters here,
used to compute the vault response, and then dropped — only the returned dict's safe display
bits + the opaque token reach the DB. Treat this module as the choke point where card data
lives MEMORY-ONLY.

Public surface:
    PaymentGateway       — typing.Protocol declaring vault_card / charge / void
    LoggingGateway       — v1 implementation
    VaultResult          — TypedDict returned by vault_card
    infer_brand_from_iin — public helper (also used by tests for the brand-table sanity check)
    get_payment_gateway  — factory; v1 always returns LoggingGateway()
"""
from __future__ import annotations

from typing import Protocol, TypedDict

from app.utils.ids import uuid7


class VaultResult(TypedDict):
    """The safe subset the application persists after a card is vaulted.

    The gateway's opaque ``gateway_token`` is the canonical reference; ``last4`` + ``brand`` are
    cached display bits so the UI can render "Visa **** 4242" without a vault round-trip.
    """
    gateway_token: str   # opaque token returned by the gateway (e.g. 'tok_log_<uuid>')
    last4: str           # last 4 chars of card_number, for display
    brand: str           # normalized lowercase: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other'
    exp_month: int       # 1-12
    exp_year: int        # 4-digit (2026, 2027, ...)


def infer_brand_from_iin(card_number: str) -> str:
    """Map a card number's leading digits (IIN/BIN range) → brand label.

    Deterministic and pure — same input always produces the same output. Used ONLY for the
    synthetic ``LoggingGateway`` so the demo data looks plausible without leaking or processing
    real card data. A real gateway returns its own brand label from the live vault response;
    we don't compute brand from PAN in production paths.

    Ranges (industry-standard IIN allocations):
      * visa       — starts with 4
      * mastercard — starts with 51-55 or 2221-2720 (new MC range)
      * amex       — starts with 34 or 37
      * discover   — starts with 6011 or 65
      * other      — anything else (including JCB, Diners, UnionPay — out of v1 scope)
    """
    if not card_number:
        return "other"
    s = str(card_number).strip()
    if not s:
        return "other"

    # visa — single-digit prefix
    if s[0] == "4":
        return "visa"

    # amex — 2-digit prefix
    if len(s) >= 2 and s[:2] in ("34", "37"):
        return "amex"

    # mastercard — 51-55 OR 2221-2720
    if len(s) >= 2:
        head2 = s[:2]
        if head2 in ("51", "52", "53", "54", "55"):
            return "mastercard"
    if len(s) >= 4:
        try:
            head4 = int(s[:4])
            if 2221 <= head4 <= 2720:
                return "mastercard"
        except ValueError:
            pass

    # discover — 6011 OR 65
    if len(s) >= 4 and s[:4] == "6011":
        return "discover"
    if len(s) >= 2 and s[:2] == "65":
        return "discover"

    return "other"


class PaymentGateway(Protocol):
    """The vault + charge + void surface every gateway implementation honors.

    All methods are async and return plain dicts (or VaultResult) so the routers don't need to
    know which provider is bound. A new provider drops in by implementing this Protocol and
    teaching ``get_payment_gateway`` to return it under the appropriate config flag.
    """

    async def vault_card(
        self,
        *,
        card_number: str,
        exp_month: int,
        exp_year: int,
        cvc: str,
        cardholder_name: str | None = None,
    ) -> VaultResult: ...

    async def charge(
        self,
        *,
        gateway_token: str,
        amount_cents: int,
        currency: str = "AMD",
        description: str | None = None,
    ) -> dict: ...

    async def void(
        self,
        *,
        gateway_token: str,
        charge_id: str,
    ) -> dict: ...


class LoggingGateway:
    """v1 — deterministic synthetic vaulting. NEVER calls a real payment gateway.

    Behavior:
      * ``vault_card``  — returns {gateway_token=f"tok_log_{uuid7().hex}", last4=card_number[-4:],
                          brand=infer_brand_from_iin(card_number), exp_month, exp_year}
      * ``charge``      — returns {charge_id=f"ch_log_{uuid7().hex}", status='succeeded',
                          amount_cents, currency}
      * ``void``        — returns {void_id=f"vd_log_{uuid7().hex}", status='voided', charge_id}

    The raw card_number + cvc parameters are USED to compute the response (last4 / brand) but
    are NEVER persisted, logged, or returned. The caller (router) is the security boundary —
    this adapter trusts it to drop the raw inputs after the call returns.
    """

    async def vault_card(
        self,
        *,
        card_number: str,
        exp_month: int,
        exp_year: int,
        cvc: str,  # noqa: ARG002 — consumed for signature compat; not persisted
        cardholder_name: str | None = None,  # noqa: ARG002 — not persisted in v1
    ) -> VaultResult:
        s = str(card_number or "").strip()
        last4 = s[-4:] if len(s) >= 4 else s.rjust(4, "0")
        brand = infer_brand_from_iin(s)
        return VaultResult(
            gateway_token=f"tok_log_{uuid7().hex}",
            last4=last4,
            brand=brand,
            exp_month=int(exp_month),
            exp_year=int(exp_year),
        )

    async def charge(
        self,
        *,
        gateway_token: str,  # noqa: ARG002 — recorded by caller, not needed for synthetic response
        amount_cents: int,
        currency: str = "AMD",
        description: str | None = None,  # noqa: ARG002 — not needed for synthetic response
    ) -> dict:
        return {
            "charge_id": f"ch_log_{uuid7().hex}",
            "status": "succeeded",
            "amount_cents": int(amount_cents),
            "currency": currency,
        }

    async def void(
        self,
        *,
        gateway_token: str,  # noqa: ARG002 — recorded by caller
        charge_id: str,
    ) -> dict:
        return {
            "void_id": f"vd_log_{uuid7().hex}",
            "status": "voided",
            "charge_id": charge_id,
        }


# ----------------------------------------------------------------------------------------
# Factory
# ----------------------------------------------------------------------------------------

def get_payment_gateway() -> PaymentGateway:
    """Return the currently-bound payment gateway.

    v1: always LoggingGateway(). Real providers (Stripe, Adyen, ...) slot in here later behind
    a settings flag — the routers + tests need no change because they only know the Protocol.
    """
    return LoggingGateway()
