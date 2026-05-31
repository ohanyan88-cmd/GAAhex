"""ARCA (ArCa) payment gateway adapter.

ARCA is the Armenian domestic card scheme operated by ACBA Bank / ArCa Processing.
The integration uses a JSON REST API at https://ipay.arca.am/payment/rest/

ACTIVATION STATUS
-----------------
Server-to-server order registration and status-check are structurally complete.
Three slots remain before this goes live:

  [SLOT 1] Confirm the exact register endpoint URL:
      Default used: https://ipay.arca.am/payment/rest/register.do
      Override:     ARCA_REGISTER_URL env var (set for sandbox, staging, etc.)

  [SLOT 2] Confirm the callback auth mechanism:
      ARCA may use IP-allowlist + GET-status (response-query pattern) instead of
      a signed POST. verify_callback handles both: HMAC when a signature header is
      present; graceful fallback (ok=True, caller does check_status) when absent.

  [SLOT 3] Merchant credentials from ARCA / ACBA Bank onboarding:
      ARCA_MERCHANT  = merchantLogin
      ARCA_PASSWORD  = merchantPassword

Real ARCA orderStatus codes:
  0=registered(not paid)  1=pre-auth hold  2=deposited(PAID)
  3=cancelled             4=refunded       6=declined(FAILED)

httpx is an optional dependency — install it in production alongside this adapter.
All methods are fail-soft (catch+log, safe default).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import urllib.parse

logger = logging.getLogger("gaaex.payment.arca")

_REGISTER_URL = os.environ.get("ARCA_REGISTER_URL",  "https://ipay.arca.am/payment/rest/register.do")
_STATUS_URL   = os.environ.get("ARCA_STATUS_URL",    "https://ipay.arca.am/payment/rest/getOrderStatus.do")
_CURRENCY_AMD = "051"   # ISO 4217 numeric for AMD


class ArcaGateway:
    """ARCA (ArCa) hosted-payment adapter."""

    def __init__(self, merchant: str, password: str) -> None:
        self._merchant = merchant
        self._password = password

    async def initiate(self, order, *, callback_url: str) -> dict:
        """Register order with ARCA, return hosted-page redirect URL.

        Flow:
          1. POST to _REGISTER_URL (server-to-server) → {orderId, formUrl}.
          2. Return formUrl so the user pays on ARCA's hosted page.

        Returns {"redirect_url": str, "provider_ref": str}. Never raises.
        """
        try:
            import httpx  # noqa: PLC0415

            payload = {
                "userName":    self._merchant,
                "password":    self._password,
                "orderNumber": str(order.id),
                "amount":      str(int(getattr(order, "amount", 0))),
                "currency":    _CURRENCY_AMD,
                "returnUrl":   callback_url,
                "failUrl":     callback_url,
                "language":    "en",
                "description": f"Order {order.id}",
            }
            async with httpx.AsyncClient(timeout=15) as c:
                resp = await c.post(_REGISTER_URL, data=payload)
                resp.raise_for_status()
                data = resp.json()

            if str(data.get("errorCode", "0")) != "0":
                logger.error("arca: register error %s — %s", data.get("errorCode"), data.get("errorMessage"))
                return {"redirect_url": "", "provider_ref": str(order.id)}

            logger.info("arca: initiated order=%s ref=%s", order.id, data["orderId"])
            return {"redirect_url": data["formUrl"], "provider_ref": data["orderId"]}

        except ImportError:
            logger.error("arca: httpx not installed")
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}
        except Exception as exc:
            logger.exception("arca: initiate: %s", exc)
            return {"redirect_url": "", "provider_ref": str(getattr(order, "id", ""))}

    async def check_status(self, order) -> str:
        """Poll ARCA for payment status. Returns PENDING | PAID | FAILED. Never raises."""
        try:
            import httpx  # noqa: PLC0415

            payload = {
                "userName": self._merchant,
                "password": self._password,
                "orderId":  getattr(order, "provider_ref", None) or str(order.id),
                "language": "en",
            }
            async with httpx.AsyncClient(timeout=10) as c:
                resp = await c.post(_STATUS_URL, data=payload)
                resp.raise_for_status()
                data = resp.json()

            s = str(data.get("orderStatus", "0"))
            if s == "2":     return "PAID"
            if s in ("3", "6"): return "FAILED"
            return "PENDING"

        except Exception as exc:
            logger.exception("arca: check_status: %s", exc)
            return "PENDING"

    def verify_callback(self, body: bytes, headers: dict) -> dict:
        """Verify and parse an ARCA callback POST.

        ARCA may use a response-query pattern (no signed body) — if so, the
        router should call check_status on the orderId from the query-string.
        This method handles both: HMAC when a sig header is present; ok=True
        fallback (let caller do check_status) when no sig header.

        Returns {"provider_ref": str, "status": PAID|FAILED, "ok": bool}.
        """
        try:
            sig = (
                headers.get("X-Arca-Signature") or headers.get("x-arca-signature") or ""
            ).removeprefix("sha256=").strip()

            if sig:
                expected = hmac.new(self._password.encode(), body, hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, sig):
                    logger.warning("arca: HMAC mismatch")
                    return {"provider_ref": "", "status": "FAILED", "ok": False}
                ok = True
            else:
                ok = True   # response-query pattern — no sig; caller verifies via check_status

            try:
                parsed = json.loads(body.decode("utf-8", errors="replace"))
            except Exception:
                parsed = dict(urllib.parse.parse_qsl(body.decode("utf-8", errors="replace")))

            provider_ref = (
                parsed.get("orderId") or parsed.get("order_id") or parsed.get("provider_ref") or ""
            )
            raw = str(parsed.get("orderStatus", parsed.get("status", "")))
            status = "PAID" if raw in ("2", "PAID", "SUCCESS") else "FAILED"

            logger.info("arca: callback ref=%r status=%s", provider_ref, status)
            return {"provider_ref": provider_ref, "status": status, "ok": ok}

        except Exception as exc:
            logger.exception("arca: verify_callback: %s", exc)
            return {"provider_ref": "", "status": "FAILED", "ok": False}
