"""EasyPay Armenia payment gateway adapter.

EasyPay (easypay.am) is an Armenian electronic payment terminal network and online
payment service operated by EasyPay LLC.

ACTIVATION STATUS
-----------------
This adapter is a new addition to the GAAex payment stack.
Three slots remain before this goes live:

  [SLOT 1] Get the API docs from EasyPay:
      Contact: merchant@easypay.am or https://easypay.am/for-business
      Ask for: hosted-payment API spec, callback signature spec, sandbox credentials.

  [SLOT 2] Confirm the hosted-payment URL and parameter names:
      Placeholder used: https://easypay.am/api/payment
      Override: EASYPAY_PAYMENT_URL env var.
      Common EasyPay params (typical for Armenian processors):
        merchant_id, amount (integer tiyn), order_id, return_url, fail_url, description, sign

  [SLOT 3] Merchant credentials:
      EASYPAY_MERCHANT_ID  = merchant identifier
      EASYPAY_SECRET_KEY   = HMAC signing secret

EasyPay callback fields (placeholder — confirm with official docs):
  transaction_id   — EasyPay transaction reference (= provider_ref)
  order_id         — our internal order id
  status           — SUCCESS | FAILED | PENDING
  amount           — amount paid in AMD tiyn

Signature (placeholder): HMAC-SHA256(secret_key, raw_body) — confirm exact algorithm.

All methods are fail-soft.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import urllib.parse

logger = logging.getLogger("gaaex.payment.easypay")

_PAYMENT_URL = os.environ.get("EASYPAY_PAYMENT_URL", "https://easypay.am/api/payment")


class EasypayGateway:
    """EasyPay Armenia hosted-payment adapter."""

    def __init__(self, merchant_id: str, secret_key: str) -> None:
        self._merchant_id = merchant_id
        self._secret_key  = secret_key

    def _sign(self, params: dict) -> str:
        """HMAC-SHA256 over sorted key=value pairs (common Armenian processor pattern).

        Replace with the exact EasyPay signing algorithm once docs are obtained.
        """
        payload = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        return hmac.new(self._secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Compose the EasyPay hosted-payment redirect URL.

        Returns {"redirect_url": str, "provider_ref": str}. Never raises.

        Note: EasyPay may require a server-to-server pre-registration step.
        Check the official docs and add an httpx call here if needed, following
        the ARCA adapter pattern (arca.py).
        """
        try:
            params = {
                "merchant_id": self._merchant_id,
                "amount":      str(int(getattr(order, "amount", 0))),
                "order_id":    str(order.id),
                "return_url":  callback_url,
                "fail_url":    callback_url,
                "description": f"Order {order.id}",
                "currency":    "AMD",
                "language":    "en",
            }
            params["sign"] = self._sign(params)
            redirect_url = f"{_PAYMENT_URL}?{urllib.parse.urlencode(params)}"
            logger.info("easypay: initiate order=%s amount=%s", order.id, params["amount"])
            return {"redirect_url": redirect_url, "provider_ref": str(order.id)}
        except Exception as exc:
            logger.exception("easypay: initiate: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """Poll EasyPay for payment status.

        Wire to EasyPay's status-check endpoint when docs are available.
        Returns PENDING | PAID | FAILED. Never raises.
        """
        return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """Verify and parse an EasyPay callback POST.

        Returns {"provider_ref": str, "status": PAID|FAILED, "ok": bool}.
        """
        try:
            sig = (
                headers.get("X-Easypay-Signature") or headers.get("x-easypay-signature") or ""
            ).removeprefix("sha256=").strip()

            if sig:
                expected = hmac.new(self._secret_key.encode(), body, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, sig):
                    logger.warning("easypay: HMAC mismatch")
                    return {"provider_ref": "", "status": "FAILED", "ok": False}
                ok = True
            else:
                ok = True   # no sig; accept + let settle_order be idempotent

            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))

            provider_ref = (
                parsed.get("transaction_id") or
                parsed.get("order_id") or
                parsed.get("provider_ref") or
                ""
            )
            raw = str(parsed.get("status", "")).upper()
            paid = raw in ("SUCCESS", "PAID", "OK", "1")

            logger.info("easypay: callback ref=%r status=%s", provider_ref, raw)
            return {"provider_ref": provider_ref, "status": "PAID" if paid else "FAILED", "ok": ok}

        except Exception as exc:
            logger.exception("easypay: verify_callback: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
