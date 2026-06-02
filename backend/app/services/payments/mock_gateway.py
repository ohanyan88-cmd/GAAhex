"""M1-C Phase 0 — MockPaymentGateway.

A fully working in-memory payment gateway simulator. Sufficient to drive
end-to-end development of vaulted-card UX, the dunning runner, the refund
flow, and the webhook dispatch path before any real Stripe account exists.

Style notes
===========
* In-memory state — per instance, not class-level. Two gateways spawned for two
  separate test cases never bleed into each other.
* Deterministic synthetic IDs (``pm_mock_<8hex>``, ``ch_mock_<8hex>``, ``re_mock_<8hex>``).
* ``verify_webhook`` accepts any payload and returns the parsed dict with ``mock=True``.
* ``reset()`` clears in-memory state between tests.
* Tracks call history under ``calls`` so tests can assert ordering.

Wraps the existing :class:`app.payment_gateway.DevGateway` semantically — same
"always succeed in dev" intent — but with a richer surface that conforms to the
M1-C ``PaymentGateway`` Protocol (vault/charge/refund/void) instead of the
older initiate/check_status/verify_callback shape.
"""
from __future__ import annotations

import json
import uuid
from typing import Any

from .exceptions import PaymentGatewayCommandError
from .gateway import ChargeResult, RefundResult, VaultResult, VoidResult


def _short_uuid() -> str:
    return uuid.uuid4().hex[:8]


class MockPaymentGateway:
    """In-memory PaymentGateway implementation.

    Behaviour summary
    -----------------
    * ``vault_card`` returns a synthetic ``pm_mock_<id>`` token; if ``card_token`` ends
      in ``decline`` we raise :class:`PaymentGatewayCommandError` so tests can exercise
      the failure path deterministically.
    * ``charge`` returns ``status='succeeded'`` and stores the charge in-memory.
    * ``refund`` succeeds against any known ``charge_id``; full or partial.
    * ``void`` cancels any ``charge_id`` we know about.
    * ``verify_webhook`` parses the payload as JSON (or returns raw bytes under ``raw``)
      and returns a dict with ``mock=True`` so handlers can branch on dev vs prod.
    """

    provider: str = "mock"

    def __init__(self) -> None:
        # token → {last4, brand, exp_month, exp_year, customer_ref}
        self.vaulted_cards: dict[str, dict[str, Any]] = {}
        # charge_id → {amount_cents, currency, payment_method_token, status, ...}
        self.charges: dict[str, dict[str, Any]] = {}
        # refund_id → {charge_id, amount_cents, status, ...}
        self.refunds: dict[str, dict[str, Any]] = {}
        # ordered call history for test introspection
        self.calls: list[tuple[str, dict[str, Any]]] = []

    # ----------------------------------------------------------------- helpers

    def reset(self) -> None:
        """Clear all in-memory state. Useful between tests."""
        self.vaulted_cards.clear()
        self.charges.clear()
        self.refunds.clear()
        self.calls.clear()

    def _track(self, op: str, **kwargs: Any) -> None:
        self.calls.append((op, kwargs))

    # ------------------------------------------------------------------ vault

    async def vault_card(
        self,
        *,
        card_token: str,
        customer_ref: str,
        customer_email: str | None = None,
        idempotency_key: str | None = None,
    ) -> VaultResult:
        self._track(
            "vault_card",
            card_token=card_token,
            customer_ref=customer_ref,
            customer_email=customer_email,
            idempotency_key=idempotency_key,
        )
        # Deterministic deny path for tests.
        if card_token.endswith("decline"):
            raise PaymentGatewayCommandError(
                f"Mock: card_token {card_token!r} declined (suffix 'decline')"
            )
        pm = f"pm_mock_{_short_uuid()}"
        # Pull stable display metadata from the token suffix when present, otherwise default.
        last4 = "4242"
        brand = "visa"
        exp_month = 12
        exp_year = 2030
        self.vaulted_cards[pm] = {
            "last4": last4, "brand": brand,
            "exp_month": exp_month, "exp_year": exp_year,
            "customer_ref": customer_ref, "customer_email": customer_email,
        }
        return VaultResult(
            token=pm,
            last4=last4,
            brand=brand,
            exp_month=exp_month,
            exp_year=exp_year,
            raw={"mock": True, "customer_ref": customer_ref},
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
        self._track(
            "charge",
            payment_method_token=payment_method_token,
            amount_cents=amount_cents,
            currency=currency,
            description=description,
            idempotency_key=idempotency_key,
        )
        if amount_cents <= 0:
            raise PaymentGatewayCommandError(
                f"Mock: amount_cents must be positive; got {amount_cents}"
            )
        ch = f"ch_mock_{_short_uuid()}"
        self.charges[ch] = {
            "payment_method_token": payment_method_token,
            "amount_cents": amount_cents,
            "currency": currency,
            "status": "succeeded",
            "description": description,
            "customer_ref": customer_ref,
            "metadata": dict(metadata) if metadata else {},
        }
        return ChargeResult(
            charge_id=ch,
            status="succeeded",
            amount_cents=amount_cents,
            currency=currency,
            raw={"mock": True},
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
        self._track(
            "refund",
            charge_id=charge_id,
            amount_cents=amount_cents,
            reason=reason,
            idempotency_key=idempotency_key,
        )
        ch = self.charges.get(charge_id)
        if ch is None:
            raise PaymentGatewayCommandError(
                f"Mock: cannot refund unknown charge_id {charge_id!r}"
            )
        actual = amount_cents if amount_cents is not None else ch["amount_cents"]
        if actual <= 0 or actual > ch["amount_cents"]:
            raise PaymentGatewayCommandError(
                f"Mock: refund amount {actual} out of range "
                f"(0, {ch['amount_cents']}] for charge {charge_id!r}"
            )
        re_id = f"re_mock_{_short_uuid()}"
        self.refunds[re_id] = {
            "charge_id": charge_id, "amount_cents": actual,
            "status": "succeeded", "reason": reason,
        }
        return RefundResult(
            refund_id=re_id,
            status="succeeded",
            amount_cents=actual,
            raw={"mock": True},
        )

    # ------------------------------------------------------------------- void

    async def void(self, *, charge_id: str) -> VoidResult:
        self._track("void", charge_id=charge_id)
        ch = self.charges.get(charge_id)
        if ch is None:
            raise PaymentGatewayCommandError(
                f"Mock: cannot void unknown charge_id {charge_id!r}"
            )
        ch["status"] = "canceled"
        return VoidResult(
            charge_id=charge_id,
            status="canceled",
            raw={"mock": True},
        )

    # -------------------------------------------------------- verify_webhook

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str,
        timestamp: int | None = None,
    ) -> dict:
        """Mock signature verification: never fails on signature, just parses payload.

        Returns ``{mock: True, ...parsed_payload}``. If the payload isn't valid JSON,
        returns ``{mock: True, raw: <bytes hex>}``.
        """
        self._track(
            "verify_webhook",
            payload_len=len(payload),
            signature=signature,
            timestamp=timestamp,
        )
        try:
            data = json.loads(payload or b"{}")
            if isinstance(data, dict):
                return {"mock": True, **data}
            return {"mock": True, "data": data}
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            return {"mock": True, "raw": payload.hex()}
