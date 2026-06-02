"""M1-C Phase 0 — EmailGateway Protocol + MockEmailGateway + SendGridEmailGateway + factory."""
from __future__ import annotations

import json

import pytest

from app.services.comms import (
    Attachment,
    EmailGateway,
    EmailGatewayCommandError,
    EmailGatewayConfigError,
    EmailSendResult,
    MockEmailGateway,
    SendGridEmailGateway,
    get_email_gateway,
    registered_email_providers,
)

try:
    import sendgrid  # type: ignore  # noqa: F401
    _SENDGRID_INSTALLED = True
except ImportError:
    _SENDGRID_INSTALLED = False


def test_mock_email_satisfies_protocol():
    gw = MockEmailGateway()
    assert isinstance(gw, EmailGateway)
    assert gw.provider == "mock"


@pytest.mark.asyncio
async def test_mock_email_send_html_text_returns_id_and_records():
    gw = MockEmailGateway(default_sender="billing@x.com", default_sender_name="X Billing")
    res = await gw.send(
        to="me@example.com",
        subject="Hi",
        html="<b>hi</b>",
        text="hi",
        categories=["invoice", "monthly"],
    )
    assert isinstance(res, EmailSendResult)
    assert res.message_id.startswith("email_mock_")
    assert res.status == "queued"
    assert res.to == "me@example.com"
    rec = gw.sent_messages[0]
    assert rec["subject"] == "Hi"
    assert rec["html"] == "<b>hi</b>"
    assert rec["categories"] == ["invoice", "monthly"]
    assert rec["sender"] == "billing@x.com"


@pytest.mark.asyncio
async def test_mock_email_send_template_path():
    gw = MockEmailGateway()
    res = await gw.send(
        to="me@example.com",
        subject="",
        template_id="d-abc",
        template_data={"name": "Gev"},
    )
    assert res.message_id.startswith("email_mock_")
    assert gw.sent_messages[0]["template_id"] == "d-abc"


@pytest.mark.asyncio
async def test_mock_email_send_requires_html_text_or_template():
    gw = MockEmailGateway()
    with pytest.raises(EmailGatewayCommandError, match="html, text, or template_id"):
        await gw.send(to="me@example.com", subject="Hi")


@pytest.mark.asyncio
async def test_mock_email_send_requires_to():
    gw = MockEmailGateway()
    with pytest.raises(EmailGatewayCommandError):
        await gw.send(to="", subject="Hi", text="x")


@pytest.mark.asyncio
async def test_mock_email_attachments_recorded():
    gw = MockEmailGateway()
    a = Attachment(
        filename="invoice.pdf",
        content_b64="QUFB",  # 'AAA'
        mime_type="application/pdf",
    )
    res = await gw.send(to="me@example.com", subject="Inv", text="x", attachments=[a])
    rec = gw.sent_messages[-1]
    assert rec["attachments"][0]["filename"] == "invoice.pdf"
    assert rec["attachments"][0]["mime_type"] == "application/pdf"
    assert res.status == "queued"


def test_mock_email_verify_webhook_parses_event_array():
    gw = MockEmailGateway()
    events = [{"event": "delivered", "sg_message_id": "m1"},
              {"event": "open", "sg_message_id": "m2"}]
    parsed = gw.verify_webhook(
        payload=json.dumps(events).encode(),
        signature="ignored",
        timestamp="0",
    )
    assert parsed["mock"] is True
    assert isinstance(parsed["events"], list)
    assert len(parsed["events"]) == 2
    assert parsed["events"][0]["event"] == "delivered"


def test_mock_email_verify_webhook_empty_payload():
    gw = MockEmailGateway()
    parsed = gw.verify_webhook(payload=b"", signature=None)
    assert parsed["mock"] is True
    assert parsed["events"] == []


# ─── SendGridEmailGateway ─────────────────────────────────────────────────


@pytest.mark.skipif(_SENDGRID_INSTALLED, reason="sendgrid SDK installed; ImportError path not exercised")
def test_sendgrid_construction_raises_importerror_when_sdk_missing():
    with pytest.raises(ImportError, match="sendgrid is required"):
        SendGridEmailGateway(
            api_key="SG.abc",
            from_email="me@x.com",
        )


@pytest.mark.skipif(not _SENDGRID_INSTALLED, reason="sendgrid SDK not installed")
def test_sendgrid_construction_with_valid_config_succeeds():
    gw = SendGridEmailGateway(api_key="SG.abc", from_email="me@x.com")
    assert gw.provider == "sendgrid"


@pytest.mark.skipif(not _SENDGRID_INSTALLED, reason="sendgrid SDK not installed")
def test_sendgrid_bad_api_key_prefix_raises_config_error():
    with pytest.raises(EmailGatewayConfigError, match="SENDGRID_API_KEY"):
        SendGridEmailGateway(api_key="bad", from_email="me@x.com")


@pytest.mark.skipif(not _SENDGRID_INSTALLED, reason="sendgrid SDK not installed")
def test_sendgrid_bad_from_email_raises_config_error():
    with pytest.raises(EmailGatewayConfigError, match="SENDGRID_FROM_EMAIL"):
        SendGridEmailGateway(api_key="SG.abc", from_email="no-at-sign")


# ─── Factory ──────────────────────────────────────────────────────────────


def test_registered_email_providers_includes_mock_and_sendgrid():
    providers = registered_email_providers()
    assert "mock" in providers
    assert "sendgrid" in providers


def test_email_factory_returns_mock_by_default(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.email_gateway_provider", "mock", raising=False,
    )
    gw = get_email_gateway()
    assert isinstance(gw, MockEmailGateway)


def test_email_factory_falls_back_to_mock_on_unknown_provider(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.email_gateway_provider", "no-such", raising=False,
    )
    gw = get_email_gateway()
    assert isinstance(gw, MockEmailGateway)


def test_email_factory_falls_back_to_mock_when_sendgrid_keys_missing(monkeypatch):
    monkeypatch.setattr(
        "app.config.settings.email_gateway_provider", "sendgrid", raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.sendgrid_api_key", None, raising=False,
    )
    monkeypatch.setattr(
        "app.config.settings.sendgrid_from_email", None, raising=False,
    )
    gw = get_email_gateway()
    assert isinstance(gw, MockEmailGateway)
