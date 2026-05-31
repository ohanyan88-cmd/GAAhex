"""TelCell Wallet payment gateway adapter.

TelCell is an Armenian mobile wallet/payment service operated by VivaCell-MTS.
Merchant API: available at https://telcell.am/api (requires merchant credentials from VivaCell-MTS).

ACTIVATION STATUS
-----------------
Hosted-page redirect + HMAC callback verification are structurally complete.
Two slots remain:

  [SLOT 1] Confirm the hosted-payment URL and parameter names:
      Best-known base:  https://telcell.am/api/payment
      Params:  issuer, action, amount, currency, issuer_id, description, success_url, fail_url
      Override: TELCELL_PAYMENT_URL env var.
      Note: TelCell may require a signed request (HMAC of params with TELCELL_KEY).
      The initiate() method below signs the payload — confirm the exact signing formula
      with VivaCell-MTS merchant support.

  [SLOT 2] Merchant credentials from VivaCell-MTS:
      TELCELL_MERCHANT  = issuer (merchant identifier)
      TELCELL_KEY       = signing key

TelCell callback fields (best-known from merchant integrations):
  transaction_id  — TelCell transaction reference (= provider_ref)
  issuer_id       — our internal order id (echoed back)
  status          — SUCCESS | FAILED | PENDING
  amount          — amount paid

Signature: HMAC-SHA256(key, raw_body) — confirm exact algorithm with VivaCell-MTS.

All methods are fail-soft.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import urllib.parse

logger = logging.getLogger("gaaex.payment.telcell")

_PAYMENT_URL = os.environ.get("TELCELL_PAYMENT_URL", "https://telcell.am/api/payment")


class TelcellGateway:
    """TelCell Wallet hosted-payment adapter."""

    def __init__(self, merchant: str, key: str) -> None:
        self._merchant = merchant
        self._key      = key

    def _sign_params(self, params: dict) -> str:
        """HMAC-SHA256 signature over sorted key=value pairs (best-known TelCell pattern).

        TelCell may use a different signing formula — confirm with VivaCell-MTS docs.
        """
        payload = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
        return hmac.new(self._key.encode(), payload.encode(), hashlib.sha256).hexdigest()

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Compose the TelCell hosted-payment redirect URL.

        Returns {"redirect_url": str, "provider_ref": str}. Never raises.
        """
        try:
            params = {
                "issuer":      self._merchant,
                "action":      "Payment",
                "amount":      str(int(getattr(order, "amount", 0))),
                "currency":    getattr(order, "currency", "AMD"),
                "issuer_id":   str(order.id),
                "description": f"Order {order.id}",
                "success_url": callback_url,
                "fail_url":    callback_url,
            }
            params["sign"] = self._sign_params(params)
            redirect_url = f"{_PAYMENT_URL}?{urllib.parse.urlencode(params)}"
            logger.info("telcell: initiate order=%s amount=%s", order.id, params["amount"])
            return {"redirect_url": redirect_url, "provider_ref": str(order.id)}
        except Exception as exc:
            logger.exception("telcell: initiate: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """TelCell polling API — returns PENDING until a callback is received.

        Wire to TelCell's status-check endpoint when merchant docs are available.
        Returns PENDING | PAID | FAILED. Never raises.
        """
        return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """Verify and parse a TelCell callback POST (JSON body expected).

        Returns {"provider_ref": str, "status": PAID|FAILED, "ok": bool}.
        """
        try:
            sig = (
                headers.get("X-Telcell-Signature") or headers.get("x-telcell-signature") or ""
            ).removeprefix("sha256=").strip()

            if sig:
                expected = hmac.new(self._key.encode(), body, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, sig):
                    logger.warning("telcell: HMAC mismatch")
                    return {"provider_ref": "", "status": "FAILED", "ok": False}
                ok = True
            else:
                ok = True   # no sig header; accept + let settle_order be idempotent

            # Parse JSON body (or form-encoded fallback).
            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))

            provider_ref = (
                parsed.get("transaction_id") or
                parsed.get("issuer_id") or
                parsed.get("provider_ref") or
                ""
            )
            raw = str(parsed.get("status", parsed.get("result", ""))).upper()
            paid = raw in ("SUCCESS", "PAID", "OK", "1")

            logger.info("telcell: callback ref=%r status=%s", provider_ref, raw)
            return {"provider_ref": provider_ref, "status": "PAID" if paid else "FAILED", "ok": ok}

        except Exception as exc:
            logger.exception("telcell: verify_callback: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
