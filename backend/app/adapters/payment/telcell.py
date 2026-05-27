"""Telcell payment gateway adapter (E33).

STATUS: DORMANT SCAFFOLD — no real merchant credentials / API spec wired.
Activated only when ``settings.payment_provider == "telcell"`` AND
``settings.telcell_merchant`` + ``settings.telcell_key`` are set.

Design notes
------------
- ``initiate``: composes a hosted-payment redirect URL.  Telcell Wallet likely
  signs the initiation request; the exact signing algorithm and URL are TODO.
- ``verify_callback``: real HMAC-SHA256 verification.  Header + field names are
  TODO — the verify logic itself is fully implemented.
- ``check_status``: stub returning "PENDING" until the polling API is wired.
- All methods are fail-soft.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import urllib.parse

logger = logging.getLogger("gaaex.payment.telcell")


class TelcellGateway:
    """Telcell Wallet hosted-payment adapter.

    Instantiated by ``app.payment_gateway.configure_payment_gateway()`` when
    ``settings.payment_provider == "telcell"`` and the Telcell keys are set.
    """

    def __init__(self, merchant: str, key: str) -> None:
        self._merchant = merchant
        self._key = key

    # ------------------------------------------------------------------
    # PaymentGateway ABC methods
    # ------------------------------------------------------------------

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Compose the Telcell hosted-payment redirect URL.

        Returns ``{"redirect_url": str, "provider_ref": str}``.
        Never raises.
        """
        try:
            # TODO: real Telcell API — wire when merchant credentials provided.
            # Telcell may require a signed initiation request (HMAC or RSA).
            # Replace the placeholder URL and params with the real spec.
            params = urllib.parse.urlencode({
                "issuer": self._merchant,
                "action": "Payment",
                "amount": str(order.amount),    # luma (AMD minor units)
                "currency": getattr(order, "currency", "AMD"),
                "issuer_id": str(order.id),     # our internal order id (returned on callback)
                "description": f"Invoice payment {order.invoice_id}",
                "success_url": callback_url,
                "fail_url": callback_url,
            })
            # TODO: replace with the real Telcell hosted-page base URL
            redirect_url = f"https://telcell.am/api/payment?{params}"
            provider_ref = str(order.id)
            logger.info("telcell: initiate order=%s amount=%s", order.id, order.amount)
            return {"redirect_url": redirect_url, "provider_ref": provider_ref}
        except Exception as exc:
            logger.exception("telcell: initiate failed: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """Query Telcell for the current payment status.

        Returns "PENDING" | "PAID" | "FAILED".  Never raises.

        TODO: real Telcell status-query API — implement when spec is available.
        """
        try:
            # TODO: real Telcell API — call the status-check endpoint here.
            return "PENDING"
        except Exception as exc:
            logger.exception("telcell: check_status failed: %s", exc)
            return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """HMAC-SHA256 verify an incoming Telcell callback.

        Returns ``{"provider_ref": str, "status": "PAID"|"FAILED", "ok": bool}``.
        ``ok=False`` means the signature did not match.  Never raises.
        """
        try:
            # ---- HMAC verification (security-critical; fully implemented) ----
            # TODO: confirm the actual Telcell signature header name.
            sig_header = (
                headers.get("X-Telcell-Signature")
                or headers.get("x-telcell-signature")
                or ""
            )
            provided_sig = sig_header.removeprefix("sha256=").strip()

            expected_sig = hmac.new(
                self._key.encode(), body, hashlib.sha256
            ).hexdigest()

            ok = hmac.compare_digest(expected_sig, provided_sig) if provided_sig else False

            if not ok:
                logger.warning("telcell: callback HMAC mismatch — rejecting")
                return {"provider_ref": "", "status": "FAILED", "ok": False}

            # ---- Parse provider_ref + status from the callback body ----
            # TODO: confirm the real Telcell callback field names.
            # Telcell likely sends JSON.
            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                try:
                    parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))
                except Exception:
                    parsed = {}

            # TODO: confirm the real field names from Telcell's callback spec
            provider_ref = (
                parsed.get("transaction_id")
                or parsed.get("issuer_id")
                or parsed.get("provider_ref")
                or ""
            )
            raw_status = parsed.get("status") or parsed.get("result") or ""
            status = "PAID" if str(raw_status).upper() in ("SUCCESS", "PAID", "OK", "1") else "FAILED"

            logger.info("telcell: verified callback ref=%r status=%s", provider_ref, status)
            return {"provider_ref": provider_ref, "status": status, "ok": True}

        except Exception as exc:
            logger.exception("telcell: verify_callback failed: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
