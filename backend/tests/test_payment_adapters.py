"""Unit tests for payment gateway adapters (ARCA, iDram, TelCell, EasyPay).

All tests use mock HTTP responses — no real merchant credentials needed.
Tests cover:
  - initiate() → redirect_url composition and provider_ref extraction
  - verify_callback() → HMAC/checksum verification + status parsing
  - check_status() → returns safe PENDING for providers without polling
  - DevGateway remains the default (no real provider activated)
"""
from __future__ import annotations

import hashlib
import hmac
import json
import urllib.parse
import uuid

import pytest


# ── helpers ───────────────────────────────────────────────────────────────────

class _FakeOrder:
    def __init__(self, amount: int = 10_000):
        self.id          = uuid.uuid4()
        self.amount      = amount
        self.invoice_id  = uuid.uuid4()
        self.currency    = "AMD"
        self.provider    = "test"
        self.provider_ref = None


def _hmac_sig(key: str, body: bytes) -> str:
    return hmac.new(key.encode(), body, hashlib.sha256).hexdigest()


# ── iDram ─────────────────────────────────────────────────────────────────────

class TestIdramGateway:
    MID  = "12345678"
    KEY  = "idram-secret-key"

    def _gw(self):
        from app.adapters.payment.idram import IdramGateway
        return IdramGateway(self.MID, self.KEY)

    @pytest.mark.asyncio
    async def test_initiate_returns_redirect_with_merchant_id(self):
        gw  = self._gw()
        ord = _FakeOrder(5_000)
        res = await gw.initiate(ord, callback_url="https://isp.example.com/callback")
        assert res["redirect_url"].startswith("https://banking.idram.am")
        assert self.MID in res["redirect_url"]
        assert str(ord.id) in res["redirect_url"]
        assert res["provider_ref"] == str(ord.id)

    @pytest.mark.asyncio
    async def test_initiate_fail_soft(self):
        from app.adapters.payment.idram import IdramGateway
        # Corrupt merchant triggers exception path via bad URL encode — verify fail-soft.
        gw  = IdramGateway("", "")
        res = await gw.initiate(_FakeOrder(), callback_url="https://isp.example.com/cb")
        assert isinstance(res, dict)
        assert "redirect_url" in res

    def test_verify_callback_md5_valid(self):
        gw = self._gw()
        payer  = "idram_user_account_42"
        status = "SUCCESS"
        amount = "5000"
        bill   = str(uuid.uuid4())
        checksum = hashlib.md5(
            f"{self.MID}:{self.KEY}:{amount}:{bill}:{payer}:{status}".encode()
        ).hexdigest().upper()
        body = urllib.parse.urlencode({
            "EDP_MERCHANT_ID":  self.MID,
            "EDP_AMOUNT":       amount,
            "EDP_BILL_NO":      bill,
            "EDP_PAYER_ACCOUNT": payer,
            "EDP_TRANS_STATUS": status,
            "CHECKSUM":         checksum,
        }).encode()
        res = gw.verify_callback(body, {})
        assert res["ok"] is True
        assert res["status"] == "PAID"
        assert res["provider_ref"] == payer

    def test_verify_callback_md5_invalid(self):
        gw   = self._gw()
        body = urllib.parse.urlencode({
            "EDP_PAYER_ACCOUNT": "user42",
            "EDP_TRANS_STATUS":  "SUCCESS",
            "EDP_AMOUNT":        "5000",
            "EDP_BILL_NO":       "abc",
            "CHECKSUM":          "WRONG",
        }).encode()
        res  = gw.verify_callback(body, {})
        assert res["ok"] is False
        assert res["status"] == "FAILED"

    def test_verify_callback_unsigned_rejected(self):
        # C1 (was test_verify_callback_failed_status, which asserted the INSECURE ok=True on the
        # no-checksum/no-sig fallback) — neither a valid MD5 checksum nor an HMAC signature → reject,
        # even a forged SUCCESS.
        gw   = self._gw()
        body = urllib.parse.urlencode({
            "EDP_PAYER_ACCOUNT": "user99",
            "EDP_TRANS_STATUS":  "SUCCESS",   # forged success must still be rejected
            "EDP_AMOUNT":        "5000",
            "EDP_BILL_NO":       "xyz",
            "CHECKSUM":          "",    # empty = no checksum, no signature
        }).encode()
        res = gw.verify_callback(body, {})
        assert res["ok"] is False
        assert res["status"] == "FAILED"

    @pytest.mark.asyncio
    async def test_check_status_returns_pending(self):
        gw  = self._gw()
        res = await gw.check_status(_FakeOrder())
        assert res == "PENDING"


# ── TelCell ───────────────────────────────────────────────────────────────────

class TestTelcellGateway:
    MERCHANT = "my_isp"
    KEY      = "telcell-signing-key"

    def _gw(self):
        from app.adapters.payment.telcell import TelcellGateway
        return TelcellGateway(self.MERCHANT, self.KEY)

    @pytest.mark.asyncio
    async def test_initiate_includes_sign(self):
        gw  = self._gw()
        res = await gw.initiate(_FakeOrder(8_000), callback_url="https://isp.example.com/cb")
        assert "sign=" in res["redirect_url"]
        assert self.MERCHANT in res["redirect_url"]

    def test_verify_callback_valid_hmac(self):
        gw   = self._gw()
        body = json.dumps({"transaction_id": "tc_tx_99", "status": "SUCCESS", "amount": "8000"}).encode()
        sig  = _hmac_sig(self.KEY, body)
        res  = gw.verify_callback(body, {"X-Telcell-Signature": sig})
        assert res["ok"] is True
        assert res["status"] == "PAID"
        assert res["provider_ref"] == "tc_tx_99"

    def test_verify_callback_invalid_hmac(self):
        gw   = self._gw()
        body = json.dumps({"transaction_id": "tc_tx_99", "status": "SUCCESS"}).encode()
        res  = gw.verify_callback(body, {"X-Telcell-Signature": "badsig"})
        assert res["ok"] is False

    def test_verify_callback_unsigned_rejected(self):
        # C1 (was test_verify_callback_no_sig_accepted, which asserted the INSECURE ok=True) — the route
        # settles directly on this result with no check_status, so a forged "SUCCESS" with NO signature
        # must be rejected: ok=False.
        gw   = self._gw()
        body = json.dumps({"issuer_id": "order_1", "status": "SUCCESS"}).encode()
        res  = gw.verify_callback(body, {})
        assert res["ok"] is False

    @pytest.mark.asyncio
    async def test_check_status_returns_pending(self):
        assert await self._gw().check_status(_FakeOrder()) == "PENDING"


# ── ARCA ──────────────────────────────────────────────────────────────────────

class TestArcaGateway:
    MERCHANT = "test_merchant"
    PASSWORD = "test_password"

    def _gw(self):
        from app.adapters.payment.arca import ArcaGateway
        return ArcaGateway(self.MERCHANT, self.PASSWORD)

    def test_verify_callback_hmac_valid(self):
        gw   = self._gw()
        body = json.dumps({"orderId": "arca_ref_42", "orderStatus": "2"}).encode()
        sig  = _hmac_sig(self.PASSWORD, body)
        res  = gw.verify_callback(body, {"X-Arca-Signature": sig})
        assert res["ok"] is True
        assert res["status"] == "PAID"
        assert res["provider_ref"] == "arca_ref_42"

    def test_verify_callback_hmac_invalid(self):
        gw   = self._gw()
        body = json.dumps({"orderId": "arca_ref_42", "orderStatus": "2"}).encode()
        res  = gw.verify_callback(body, {"X-Arca-Signature": "badsig"})
        assert res["ok"] is False
        assert res["status"] == "FAILED"

    def test_verify_callback_unsigned_rejected(self):
        # C1 (was test_verify_callback_no_sig_accepted, ok=True) — the callback route settles directly
        # without calling check_status, so an unsigned ARCA callback is rejected here; legitimate ARCA
        # settlement flows through reconcile/check_status. A forged PAID (orderStatus=2) with no
        # signature must be rejected: ok=False.
        gw   = self._gw()
        body = json.dumps({"orderId": "arca_ref_42", "orderStatus": "2"}).encode()
        res  = gw.verify_callback(body, {})
        assert res["ok"] is False

    def test_verify_callback_orderStatus_paid(self):
        gw   = self._gw()
        body = json.dumps({"orderId": "ref99", "orderStatus": "2"}).encode()
        sig  = _hmac_sig(self.PASSWORD, body)
        res  = gw.verify_callback(body, {"X-Arca-Signature": sig})
        assert res["status"] == "PAID"

    def test_verify_callback_orderStatus_declined(self):
        gw   = self._gw()
        body = json.dumps({"orderId": "ref99", "orderStatus": "6"}).encode()
        res  = gw.verify_callback(body, {})
        assert res["status"] == "FAILED"

    @pytest.mark.asyncio
    async def test_initiate_without_httpx_returns_empty(self, monkeypatch):
        import builtins, sys  # noqa: E401
        real_import = builtins.__import__
        def mock_import(name, *args, **kw):
            if name == "httpx":
                raise ImportError("mocked")
            return real_import(name, *args, **kw)
        monkeypatch.setattr(builtins, "__import__", mock_import)
        gw  = self._gw()
        res = await gw.initiate(_FakeOrder(), callback_url="https://isp.example.com/cb")
        assert res["redirect_url"] == ""

    @pytest.mark.asyncio
    async def test_check_status_without_httpx_returns_pending(self, monkeypatch):
        import builtins
        real_import = builtins.__import__
        def mock_import(name, *args, **kw):
            if name == "httpx":
                raise ImportError("mocked")
            return real_import(name, *args, **kw)
        monkeypatch.setattr(builtins, "__import__", mock_import)
        gw  = self._gw()
        res = await gw.check_status(_FakeOrder())
        assert res == "PENDING"


# ── EasyPay ───────────────────────────────────────────────────────────────────

class TestEasypayGateway:
    MID = "ep_merchant_1"
    KEY = "easypay-secret"

    def _gw(self):
        from app.adapters.payment.easypay import EasypayGateway
        return EasypayGateway(self.MID, self.KEY)

    @pytest.mark.asyncio
    async def test_initiate_includes_merchant_and_sign(self):
        gw  = self._gw()
        res = await gw.initiate(_FakeOrder(3_000), callback_url="https://isp.example.com/cb")
        assert self.MID in res["redirect_url"]
        assert "sign=" in res["redirect_url"]

    def test_verify_callback_valid_hmac(self):
        gw   = self._gw()
        body = json.dumps({"transaction_id": "ep_tx_77", "status": "SUCCESS"}).encode()
        sig  = _hmac_sig(self.KEY, body)
        res  = gw.verify_callback(body, {"X-Easypay-Signature": sig})
        assert res["ok"] is True
        assert res["status"] == "PAID"
        assert res["provider_ref"] == "ep_tx_77"

    def test_verify_callback_invalid_hmac(self):
        gw   = self._gw()
        body = json.dumps({"transaction_id": "ep_tx_77", "status": "SUCCESS"}).encode()
        res  = gw.verify_callback(body, {"X-Easypay-Signature": "wrongsig"})
        assert res["ok"] is False

    def test_verify_callback_unsigned_rejected(self):
        # C1 (was test_verify_callback_no_sig, ok=True) — unsigned callback rejected (fail-closed);
        # a forged status must not be accepted.
        gw   = self._gw()
        body = json.dumps({"order_id": "order_abc", "status": "SUCCESS"}).encode()
        res  = gw.verify_callback(body, {})
        assert res["ok"] is False

    @pytest.mark.asyncio
    async def test_check_status_returns_pending(self):
        assert await self._gw().check_status(_FakeOrder()) == "PENDING"


# ── DevGateway still default ──────────────────────────────────────────────────

class TestDevGatewayDefault:
    def test_dev_gateway_is_default(self):
        from app.payment_gateway import get_gateway
        gw = get_gateway()
        assert gw.__class__.__name__ == "DevGateway"
