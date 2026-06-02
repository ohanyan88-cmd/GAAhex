"""M1-C Phase 0 — Vendor-agnostic comms (SMS + email) gateway layer.

Public API
----------

Usage::

    from app.services.comms import get_sms_gateway, get_email_gateway

    sms = get_sms_gateway()
    await sms.send(to="+37411223344", body="Hi!")

    email = get_email_gateway()
    await email.send(to="me@example.com", subject="...", text="...")
"""
from .email import Attachment, EmailGateway, EmailSendResult
from .exceptions import (
    EmailGatewayCommandError,
    EmailGatewayConfigError,
    EmailGatewayConnectionError,
    EmailGatewayError,
    EmailGatewayTimeoutError,
    EmailWebhookSignatureError,
    SmsGatewayCommandError,
    SmsGatewayConfigError,
    SmsGatewayConnectionError,
    SmsGatewayError,
    SmsGatewayTimeoutError,
    SmsWebhookSignatureError,
)
from .factory import (
    get_email_gateway,
    get_sms_gateway,
    register_email_gateway,
    register_sms_gateway,
    registered_email_providers,
    registered_sms_providers,
)
from .mock_email import MockEmailGateway
from .mock_sms import MockSmsGateway
from .sendgrid_email import SendGridEmailGateway
from .sms import SmsGateway, SmsSendResult
from .twilio_sms import TwilioSmsGateway

__all__ = [
    # Protocol + result dataclasses (SMS)
    "SmsGateway", "SmsSendResult",
    # Protocol + result dataclasses (email)
    "EmailGateway", "EmailSendResult", "Attachment",
    # Factories
    "get_sms_gateway", "get_email_gateway",
    "register_sms_gateway", "register_email_gateway",
    "registered_sms_providers", "registered_email_providers",
    # Implementations
    "MockSmsGateway", "TwilioSmsGateway",
    "MockEmailGateway", "SendGridEmailGateway",
    # Exceptions (SMS)
    "SmsGatewayError", "SmsGatewayConfigError",
    "SmsGatewayConnectionError", "SmsGatewayCommandError",
    "SmsGatewayTimeoutError", "SmsWebhookSignatureError",
    # Exceptions (email)
    "EmailGatewayError", "EmailGatewayConfigError",
    "EmailGatewayConnectionError", "EmailGatewayCommandError",
    "EmailGatewayTimeoutError", "EmailWebhookSignatureError",
]
