"""Idram payment gateway adapter (E33).

STATUS: DORMANT SCAFFOLD — no real merchant credentials / API spec wired.
Activated only when ``settings.payment_provider == "idram"`` AND
``settings.idram_merchant_id`` + ``settings.idram_secret_key`` are set.

Design notes
------------
- ``initiate``: composes a hosted-payment redirect URL from the merchant ID,
  order ID, amount, and callback URL.  The exact Idram hosted-page URL
  structure is marked TODO — fill it in when you have the real API spec and
  sandbox credentials.
- ``verify_callback``: real HMAC-SHA256 verification against the incoming
  signature header.  This is the security-critical path; it is fully
  implemented — only the body + status parsing field names are TODO.
- ``check_status``: returns "PENDING" (stub); wire when the polling API is known.
- All methods are fail-soft: they catch and log every exception and return a
  safe default rather than propagating.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import urllib.parse

logger = logging.getLogger("gaaex.payment.idram")


class IdramGateway:
    """Idram hosted-payment adapter.

    Instantiated by ``app.payment_gateway.configure_payment_gateway()`` when
    ``settings.payment_provider == "idram"`` and the Idram keys are set.
    """

    def __init__(self, merchant_id: str, secret_key: str) -> None:
        self._merchant_id = merchant_id
        self._secret_key = secret_key

    # ------------------------------------------------------------------
    # PaymentGateway ABC methods
    # ------------------------------------------------------------------

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Compose the Idram hosted-payment redirect URL.

        Returns ``{"redirect_url": str, "provider_ref": str}``.
        Never raises — returns an error-marked dict on failure.
        """
        try:
            # TODO: real Idram API — wire when merchant credentials provided.
            # Replace the placeholder base URL and parameter names with the
            # actual Idram hosted-page spec once you have sandbox docs.
            # The current implementation shows the STRUCTURAL intent only.
            params = urllib.parse.urlencode({
                "EDP_MERCHANT_ID": self._merchant_id,
                "EDP_AMOUNT": str(order.amount),           # luma (AMD minor units)
                "EDP_BILL_NO": str(order.id),              # our internal order id
                "EDP_CALLBACK": callback_url,
                "EDP_LANGUAGE": "EN",
            })
            # TODO: replace with the real Idram hosted-payment base URL
            redirect_url = f"https://banking.idram.am/Payment/GetPayment?{params}"
            provider_ref = str(order.id)                   # will be overwritten by the real ref on callback
            logger.info("idram: initiate order=%s amount=%s", order.id, order.amount)
            return {"redirect_url": redirect_url, "provider_ref": provider_ref}
        except Exception as exc:
            logger.exception("idram: initiate failed: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """Query Idram for the current payment status.

        Returns "PENDING" | "PAID" | "FAILED".  Never raises.

        TODO: real Idram status-query API — implement when spec is available.
        """
        try:
            # TODO: real Idram API — call the status-check endpoint here.
            # Until then, return PENDING so the reconcile job doesn't falsely settle orders.
            return "PENDING"
        except Exception as exc:
            logger.exception("idram: check_status failed: %s", exc)
            return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """HMAC-SHA256 verify an incoming Idram callback.

        Idram is expected to include a signature header so we can authenticate
        the POST without a round-trip.  The header name and body-parsing field
        names are TODO — fill in when you have the real Idram callback spec.

        Returns ``{"provider_ref": str, "status": "PAID"|"FAILED", "ok": bool}``.
        ``ok=False`` means the signature did not match (reject the callback).
        Never raises.
        """
        try:
            # ---- HMAC verification (security-critical; fully implemented) ----
            # TODO: confirm the actual Idram signature header name and encoding.
            # Common patterns: "X-Idram-Signature: sha256=<hex>", or a plain hex header.
            sig_header = (
                headers.get("X-Idram-Signature")
                or headers.get("x-idram-signature")
                or ""
            )
            # Strip an optional "sha256=" prefix (common provider convention)
            provided_sig = sig_header.removeprefix("sha256=").strip()

            expected_sig = hmac.new(
                self._secret_key.encode(), body, hashlib.sha256
            ).hexdigest()

            ok = hmac.compare_digest(expected_sig, provided_sig) if provided_sig else False

            if not ok:
                logger.warning("idram: callback HMAC mismatch — rejecting")
                return {"provider_ref": "", "status": "FAILED", "ok": False}

            # ---- Parse provider_ref + status from the callback body ----
            # TODO: replace with the real Idram callback field names once the
            # spec is available.  Idram likely sends form-encoded or JSON POST.
            try:
                parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))
            except Exception:
                parsed = {}

            # TODO: confirm the real field names from Idram's callback spec
            provider_ref = parsed.get("EDP_PAYER_ACCOUNT") or parsed.get("provider_ref") or ""
            raw_status = parsed.get("EDP_TRANS_STATUS") or parsed.get("status") or ""
            status = "PAID" if raw_status.upper() in ("SUCCESS", "PAID", "1") else "FAILED"

            logger.info("idram: verified callback ref=%r status=%s", provider_ref, status)
            return {"provider_ref": provider_ref, "status": status, "ok": True}

        except Exception as exc:
            logger.exception("idram: verify_callback failed: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
