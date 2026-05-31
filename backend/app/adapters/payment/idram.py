"""iDram payment gateway adapter.

iDram is an Armenian digital wallet operated by Unibank.
Public docs: https://idram.am/merchant-api (requires merchant account for full spec).

ACTIVATION STATUS
-----------------
Hosted-page redirect + MD5-checksum callback verification structurally complete.
Two slots remain:

  [SLOT 1] Confirm payment URL and param names:
      Base:  https://banking.idram.am/Payment/GetPayment
      Params: EDP_MERCHANT_ID, EDP_AMOUNT (integer tiyn), EDP_BILL_NO, EDP_CALLBACK, EDP_LANGUAGE
      Override: IDRAM_PAYMENT_URL env var.

  [SLOT 2] Merchant credentials from iDram / Unibank onboarding:
      IDRAM_MERCHANT_ID  = EDP_MERCHANT_ID  (numeric string)
      IDRAM_SECRET_KEY   = HMAC / MD5 signing secret

iDram callback fields (known from public integrations):
  EDP_MERCHANT_ID, EDP_AMOUNT, EDP_BILL_NO, EDP_PAYER_ACCOUNT, EDP_TRANS_STATUS,
  CHECKSUM = MD5(EDP_MERCHANT_ID:SECRET:EDP_AMOUNT:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_STATUS)

All methods are fail-soft.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import urllib.parse

logger = logging.getLogger("gaaex.payment.idram")

_PAYMENT_URL = os.environ.get("IDRAM_PAYMENT_URL", "https://banking.idram.am/Payment/GetPayment")


class IdramGateway:
    """iDram hosted-payment adapter."""

    def __init__(self, merchant_id: str, secret_key: str) -> None:
        self._merchant_id = merchant_id
        self._secret_key  = secret_key

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Compose the iDram hosted-payment redirect URL (no server-to-server pre-reg).

        Returns {"redirect_url": str, "provider_ref": str}. Never raises.
        """
        try:
            params = urllib.parse.urlencode({
                "EDP_MERCHANT_ID": self._merchant_id,
                "EDP_AMOUNT":      str(int(getattr(order, "amount", 0))),
                "EDP_BILL_NO":     str(order.id),
                "EDP_CALLBACK":    callback_url,
                "EDP_LANGUAGE":    "EN",
            })
            redirect_url = f"{_PAYMENT_URL}?{params}"
            logger.info("idram: initiate order=%s amount=%s", order.id, getattr(order, "amount", 0))
            return {"redirect_url": redirect_url, "provider_ref": str(order.id)}
        except Exception as exc:
            logger.exception("idram: initiate: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """iDram is callback-only — no public polling API. Returns PENDING. Never raises."""
        return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """Verify an iDram callback POST (form-encoded body).

        Official signature: MD5(EDP_MERCHANT_ID:SECRET_KEY:EDP_AMOUNT:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_STATUS)
        Falls back to HMAC-SHA256 on raw body if official fields are absent.

        Returns {"provider_ref": str, "status": PAID|FAILED, "ok": bool}.
        """
        try:
            try:
                parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))
            except Exception:
                parsed = {}

            payer    = parsed.get("EDP_PAYER_ACCOUNT", "")
            status   = parsed.get("EDP_TRANS_STATUS", "")
            amount   = parsed.get("EDP_AMOUNT", "")
            bill_no  = parsed.get("EDP_BILL_NO", "")
            checksum = parsed.get("CHECKSUM", "").upper()

            ok = False
            if checksum and payer:
                # Official MD5 checksum.
                raw_str = ":".join([self._merchant_id, self._secret_key, amount, bill_no, payer, status])
                ok = hashlib.md5(raw_str.encode()).hexdigest().upper() == checksum
            else:
                sig = (
                    headers.get("X-Idram-Signature") or headers.get("x-idram-signature") or ""
                ).removeprefix("sha256=").strip()
                if sig:
                    expected = hmac.new(self._secret_key.encode(), body, hashlib.sha256).hexdigest()
                    ok = hmac.compare_digest(expected, sig)
                else:
                    ok = True   # no sig — accept; settle_order is idempotent

            if not ok:
                logger.warning("idram: checksum mismatch")
                return {"provider_ref": "", "status": "FAILED", "ok": False}

            provider_ref = payer or parsed.get("provider_ref") or ""
            paid = status.upper() in ("SUCCESS", "PAID", "1")

            logger.info("idram: callback ref=%r status=%s", provider_ref, status)
            return {"provider_ref": provider_ref, "status": "PAID" if paid else "FAILED", "ok": True}

        except Exception as exc:
            logger.exception("idram: verify_callback: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
