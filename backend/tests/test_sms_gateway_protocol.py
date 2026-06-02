"""M1-C Phase 0 — SmsGateway Protocol + MockSmsGateway + TwilioSmsGateway + factory."""
from __future__ import annotations

import pytest

from app.services.comms import (
    MockSmsGateway,
    SmsGateway,
    SmsGatewayCommandError,
    SmsGatewayConfigError,
    SmsSendResult,
    TwilioSmsGateway,
    get_sms_gateway,
    registered_sms_providers,
)

try:
    import twilio  # type: ignore  # noqa: F401
    _TWILIO_INSTALLED = True
except ImportError:
    _TWILIO_INSTALLED = False


def test_mock_sms_satisfies_protocol():
    gw = MockSmsGateway()
    assert isinstance(gw, SmsGateway)
    assert gw.provider == "mock"


@pytest.mark.asyncio
async def test_mock_sms_send_returns_synthetic_id_and_records():
    gw = MockSmsGateway(default_sender="+14155551234")
    res = await gw.send(to="+37411223344", body="Hello world")
    assert isinstance(res, SmsSendResult)
    assert res.message_id.startswith("sms_mock_")
    assert res.status == "queued"
    assert res.to == "+37411223344"
    assert res.body_chars == len("Hello world")
    assert res.segments_count == 1
    assert len(gw.sent_messages) == 1
    rec = gw.sent_messages[0]
    assert rec["body"] == "Hello world"
    assert rec["sender"] == "+14155551234"


@pytest.mark.asyncio
async def test_mock_sms_send_unicode_body_uses_70char_segments():
    gw = MockSmsGateway()
    # 80 Armenian chars → 2 segments at 70/segment
    res = await gw.send(to="+37411", body="ա" * 80)
    assert res.segments_count == 2


@pytest.mark.asyncio
async def test_mock_sms_send_sentinel_decline():
    gw = MockSmsGateway()
    with pytest.raises(SmsGatewayCommandError):
        await gw.send(to="+0000000000", body="boom")


def test_mock_sms_verify_webhook_parses_form_encoded():
    gw = MockSmsGateway()
    payload = b"MessageSid=SM123&MessageStatus=delivered&To=%2B37411"
    parsed = gw.verify_webhook(payload=payload, signature="any")
    assert parsed["mock"] is True
    assert parsed["MessageSid"] == "SM123"
    assert parsed["MessageStatus"] == "delivered"


def test_mock_sms_verify_webhook_parses_json():
    gw = MockSmsGateway()
    parsed = gw.verify_webhook(payload=b'{"k": "v"}', signature="any")
    assert parsed["mock"] is True
    assert parsed["k"] == "v"


def test_mock_sms_reset_clears_state():
    gw = MockSmsGateway()
    gw.sent_messages.append({"x": 1})
    gw.reset()
    assert gw.sent_messages == []


# ─── TwilioSmsGateway ─────────────────────────────────────────────────────


@pytest.mark.skipif(_TWILIO_INSTALLED, reason="twilio SDK installed; ImportError path not exercised")
def test_twilio_construction_raises_importerror_when_sdk_missing():
    with pytest.raises(ImportError, match="twilio is required"):
        TwilioSmsGateway(
            account_sid="ACabc",
            auth_token="tok",
            from_number="+14155551234",
        )


@pytest.mark.skipif(not _TWILIO_INSTALLED, reason="twilio SDK not installed")
def test_twilio_construction_with_valid_config_succeeds():
    gw = TwilioSmsGateway(
        account_sid="ACabc",
        auth_token="tok",
        from_number="+14155551234",
    )
    assert gw.provider == "twilio"


@pytest.mark.skipif(not _TWILIO_INSTALLED, reason="twilio SDK not installed")
def test_twilio_bad_account_sid_raises_config_error():
    with pytest.raises(SmsGatewayConfigError, match="TWILIO_ACCOUNT_SID"):
        TwilioSmsGateway(
            account_sid="bad", auth_token="tok", from_number="+1",
        )


@pytest.mark.skipif(not _TWILIO_INSTALLED, reason="twilio SDK not installed")
def test_twilio_missing_token_raises_config_error():
    with pytest.raises(SmsGatewayConfigError, match="TWILIO_AUTH_TOKEN"):
        TwilioSmsGateway(account_sid="ACabc", auth_token=None, from_number="+1")


@pytest.mark.skipif(not _TWILIO_INSTALLED, reason="twilio SDK not installed")
def test_twilio_no_sender_at_all_raises_config_error():
    with pytest.raises(SmsGatewayConfigError, match="FROM_NUMBER or"):
        TwilioSmsGateway(account_sid="ACabc", auth_token="tok",
                         from_number=None, messaging_service_sid=None)


# ─── Factory ──────────────────────────────────────────────────────────────


def test_registered_sms_providers_includes_mock_and_twilio():
    providers = registered_sms_providers()
    assert "mock" in providers
    assert "twilio" in providers


def test_sms_factory_returns_mock_by_default(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.sms_gateway_provider", "mock", raising=False,
    )
    gw = get_sms_gateway()
    assert isinstance(gw, MockSmsGateway)


def test_sms_factory_falls_back_to_mock_on_unknown_provider(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.sms_gateway_provider", "no-such-vendor", raising=False,
    )
    gw = get_sms_gateway()
    assert isinstance(gw, MockSmsGateway)


def test_sms_factory_falls_back_to_mock_when_twilio_keys_missing(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.sms_gateway_provider", "twilio", raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.twilio_account_sid", None, raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.twilio_auth_token", None, raising=False,
    )
    gw = get_sms_gateway()
    assert isinstance(gw, MockSmsGateway)
