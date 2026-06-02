"""M1-C Phase 0 — SMS + Email gateway factories.

Each factory:

* reads ``settings`` at call time (so tests can mutate)
* looks up a zero-arg builder in its registry
* falls back to the mock implementation on ``ImportError`` or
  ``*GatewayConfigError`` with a logged warning

Two completely separate registries — SMS and email failures shouldn't bleed
into each other.
"""
from __future__ import annotations

import logging
from typing import Callable

from .email import EmailGateway
from .exceptions import EmailGatewayConfigError, SmsGatewayConfigError
from .mock_email import MockEmailGateway
from .mock_sms import MockSmsGateway
from .sendgrid_email import SendGridEmailGateway
from .sms import SmsGateway
from .twilio_sms import TwilioSmsGateway

_log = logging.getLogger("portal.comms.factory")


# ─── SMS ───────────────────────────────────────────────────────────────────


_SMS_REGISTRY: dict[str, Callable[[], SmsGateway]] = {}


def register_sms_gateway(name: str, builder: Callable[[], SmsGateway]) -> None:
    if not name or not isinstance(name, str):
        raise ValueError("name must be a non-empty string")
    _SMS_REGISTRY[name.lower()] = builder


def registered_sms_providers() -> list[str]:
    return sorted(_SMS_REGISTRY.keys())


def _build_mock_sms() -> SmsGateway:
    from app.config import settings
    return MockSmsGateway(default_sender=getattr(settings, "twilio_from_number", None))


def _build_twilio_sms() -> SmsGateway:
    from app.config import settings
    return TwilioSmsGateway(
        account_sid=getattr(settings, "twilio_account_sid", None),
        auth_token=getattr(settings, "twilio_auth_token", None),
        from_number=getattr(settings, "twilio_from_number", None),
        messaging_service_sid=getattr(settings, "twilio_messaging_service_sid", None),
        status_callback_url=getattr(settings, "twilio_status_callback_url", None),
        webhook_auth_token=getattr(settings, "twilio_webhook_auth_token", None),
    )


register_sms_gateway("mock", _build_mock_sms)
register_sms_gateway("dev", _build_mock_sms)  # alias used by existing code
register_sms_gateway("twilio", _build_twilio_sms)


def get_sms_gateway() -> SmsGateway:
    """Build an SmsGateway based on ``settings.sms_gateway_provider``.

    Always returns a working gateway; falls back to the mock on any config /
    import error. Never raises.
    """
    from app.config import settings

    name = (getattr(settings, "sms_gateway_provider", None) or "mock").lower()
    builder = _SMS_REGISTRY.get(name)
    if builder is None:
        _log.warning("sms_gateway: unknown provider %r — falling back to mock", name)
        return _build_mock_sms()
    try:
        return builder()
    except (SmsGatewayConfigError, ImportError) as e:
        _log.warning(
            "sms_gateway: %s config error: %s — falling back to mock", name, e,
        )
        return _build_mock_sms()


# ─── Email ─────────────────────────────────────────────────────────────────


_EMAIL_REGISTRY: dict[str, Callable[[], EmailGateway]] = {}


def register_email_gateway(name: str, builder: Callable[[], EmailGateway]) -> None:
    if not name or not isinstance(name, str):
        raise ValueError("name must be a non-empty string")
    _EMAIL_REGISTRY[name.lower()] = builder


def registered_email_providers() -> list[str]:
    return sorted(_EMAIL_REGISTRY.keys())


def _build_mock_email() -> EmailGateway:
    from app.config import settings
    return MockEmailGateway(
        default_sender=getattr(settings, "sendgrid_from_email", None),
        default_sender_name=getattr(settings, "sendgrid_from_name", None),
    )


def _build_sendgrid_email() -> EmailGateway:
    from app.config import settings
    return SendGridEmailGateway(
        api_key=getattr(settings, "sendgrid_api_key", None),
        from_email=getattr(settings, "sendgrid_from_email", None),
        from_name=getattr(settings, "sendgrid_from_name", None),
        webhook_public_key=getattr(settings, "sendgrid_webhook_public_key", None),
    )


register_email_gateway("mock", _build_mock_email)
register_email_gateway("dev", _build_mock_email)  # alias used by existing code
register_email_gateway("sendgrid", _build_sendgrid_email)


def get_email_gateway() -> EmailGateway:
    """Build an EmailGateway based on ``settings.email_gateway_provider``.

    Always returns a working gateway; falls back to the mock on any config /
    import error.
    """
    from app.config import settings

    name = (getattr(settings, "email_gateway_provider", None) or "mock").lower()
    builder = _EMAIL_REGISTRY.get(name)
    if builder is None:
        _log.warning("email_gateway: unknown provider %r — falling back to mock", name)
        return _build_mock_email()
    try:
        return builder()
    except (EmailGatewayConfigError, ImportError) as e:
        _log.warning(
            "email_gateway: %s config error: %s — falling back to mock", name, e,
        )
        return _build_mock_email()
