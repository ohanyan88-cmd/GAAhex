"""ARCA (ArCa) payment gateway adapter (E33).

STATUS: DORMANT SCAFFOLD — no real merchant credentials / API spec wired.
Activated only when ``settings.payment_provider == "arca"`` AND
``settings.arca_merchant`` + ``settings.arca_password`` are set.

Design notes
------------
- ARCA (Armenian Card) is the Armenian domestic card scheme operated by ACBA Bank.
  Integration typically uses a JSON REST API with HMAC or basic-auth; the exact
  spec is TODO — this scaffold shows the structural intent only.
- ``initiate``: composes a hosted-payment redirect URL.  ARCA may require a
  server-to-server order-registration call first (httpx); that call is TODO.
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

logger = logging.getLogger("gaaex.payment.arca")


class ArcaGateway:
    """ARCA (ArCa) hosted-payment adapter.

    Instantiated by ``app.payment_gateway.configure_payment_gateway()`` when
    ``settings.payment_provider == "arca"`` and the ARCA keys are set.
    """

    def __init__(self, merchant: str, password: str) -> None:
        self._merchant = merchant
        self._password = password

    # ------------------------------------------------------------------
    # PaymentGateway ABC methods
    # ------------------------------------------------------------------

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Register the order with ARCA and return the hosted-payment redirect URL.

        Returns ``{"redirect_url": str, "provider_ref": str}``.
        Never raises.

        ARCA typically requires a server-to-server order-registration call
        before issuing the redirect URL.  That HTTP call is a TODO.
        """
        try:
            # TODO: real ARCA API — wire when merchant credentials provided.
            # ARCA integration typically requires:
            #   1. POST to ARCA order-registration endpoint (server-to-server)
            #      with merchantLogin, merchantPassword, orderNumber, amount, etc.
            #   2. Extract orderId + formUrl from the response.
            #   3. Redirect the customer to formUrl.
            # Example (structural only — confirm with actual ARCA API docs):
            #   import httpx
            #   async with httpx.AsyncClient(timeout=15) as client:
            #       resp = await client.post(
            #           "https://ipay.arca.am/payment/rest/register.do",  # TODO: verify URL
            #           data={
            #               "merchantLogin": self._merchant,
            #               "merchantPassword": self._password,
            #               "orderNumber": str(order.id),
            #               "amount": str(order.amount),
            #               "currency": "051",   # ISO 4217 numeric for AMD
            #               "returnUrl": callback_url,
            #               "language": "en",
            #           }
            #       )
            #   data = resp.json()
            #   provider_ref = data["orderId"]
            #   redirect_url = data["formUrl"]

            # Until the real API is wired, compose a structural placeholder URL.
            params = urllib.parse.urlencode({
                "merchant": self._merchant,
                "orderNumber": str(order.id),
                "amount": str(order.amount),   # luma (AMD minor units)
                "returnUrl": callback_url,
                "language": "en",
            })
            # TODO: replace with the real ARCA hosted-page base URL
            redirect_url = f"https://ipay.arca.am/payment/start.do?{params}"
            provider_ref = str(order.id)
            logger.info("arca: initiate order=%s amount=%s", order.id, order.amount)
            return {"redirect_url": redirect_url, "provider_ref": provider_ref}
        except Exception as exc:
            logger.exception("arca: initiate failed: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """Query ARCA for the current payment status.

        Returns "PENDING" | "PAID" | "FAILED".  Never raises.

        TODO: real ARCA status-query API — implement when spec is available.
        Typical ARCA call: POST to
            https://ipay.arca.am/payment/rest/getOrderStatus.do
        with merchantLogin + merchantPassword + orderId (the provider_ref).
        """
        try:
            # TODO: real ARCA API — call the status-check endpoint here.
            return "PENDING"
        except Exception as exc:
            logger.exception("arca: check_status failed: %s", exc)
            return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """HMAC-SHA256 verify an incoming ARCA callback.

        Returns ``{"provider_ref": str, "status": "PAID"|"FAILED", "ok": bool}``.
        ``ok=False`` means the signature did not match.  Never raises.

        Note: ARCA may use a different authentication mechanism (e.g. TLS client
        cert, IP allowlist, or a response-query pattern rather than a signed
        POST).  Adapt the verify logic once the real spec is confirmed; the HMAC
        path here is the safe structural default.
        """
        try:
            # ---- HMAC verification (security-critical; fully implemented) ----
            # TODO: confirm the actual ARCA callback authentication mechanism.
            # If ARCA uses IP-allowlist + response-query instead of a signed
            # POST body, this block should be replaced accordingly.
            sig_header = (
                headers.get("X-Arca-Signature")
                or headers.get("x-arca-signature")
                or ""
            )
            provided_sig = sig_header.removeprefix("sha256=").strip()

            expected_sig = hmac.new(
                self._password.encode(), body, hashlib.sha256
            ).hexdigest()

            ok = hmac.compare_digest(expected_sig, provided_sig) if provided_sig else False

            if not ok:
                logger.warning("arca: callback HMAC mismatch — rejecting")
                return {"provider_ref": "", "status": "FAILED", "ok": False}

            # ---- Parse provider_ref + status from the callback body ----
            # TODO: confirm the real ARCA callback field names.
            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                try:
                    parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))
                except Exception:
                    parsed = {}

            # TODO: confirm the real field names from ARCA's callback spec
            provider_ref = (
                parsed.get("orderId")
                or parsed.get("order_id")
                or parsed.get("provider_ref")
                or ""
            )
            raw_status = (
                parsed.get("orderStatus")
                or parsed.get("status")
                or ""
            )
            # ARCA orderStatus: 2 = "Deposited" (fully paid); other values = not paid
            # TODO: verify these status codes against the real ARCA spec
            status = "PAID" if str(raw_status) in ("2", "PAID", "SUCCESS") else "FAILED"

            logger.info("arca: verified callback ref=%r status=%s", provider_ref, status)
            return {"provider_ref": provider_ref, "status": status, "ok": True}

        except Exception as exc:
            logger.exception("arca: verify_callback failed: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
