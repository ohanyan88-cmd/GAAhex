"""M1-C Phase 0 — Comms gateway exception hierarchies.

Two parallel trees so callers can ``except SmsGatewayError`` or
``except EmailGatewayError`` independently — failures in one channel shouldn't
mask failures in the other.
"""
from __future__ import annotations


# ─── SMS ───────────────────────────────────────────────────────────────────


class SmsGatewayError(Exception):
    """Base exception for all SMS gateway errors."""


class SmsGatewayConfigError(SmsGatewayError):
    """Twilio credentials missing / malformed at construction time."""


class SmsGatewayConnectionError(SmsGatewayError):
    """Could not reach the SMS provider."""


class SmsGatewayCommandError(SmsGatewayError):
    """Provider rejected the send (bad ``to``, blacklisted number, throttled, …)."""


class SmsGatewayTimeoutError(SmsGatewayError):
    """Send operation timed out."""


class SmsWebhookSignatureError(SmsGatewayError):
    """Twilio status-callback signature verification failed."""


# ─── Email ─────────────────────────────────────────────────────────────────


class EmailGatewayError(Exception):
    """Base exception for all email gateway errors."""


class EmailGatewayConfigError(EmailGatewayError):
    """SendGrid credentials missing / malformed at construction time."""


class EmailGatewayConnectionError(EmailGatewayError):
    """Could not reach the email provider."""


class EmailGatewayCommandError(EmailGatewayError):
    """Provider rejected the send (bad address, suppressed, template missing, …)."""


class EmailGatewayTimeoutError(EmailGatewayError):
    """Send operation timed out."""


class EmailWebhookSignatureError(EmailGatewayError):
    """SendGrid event-webhook signature (ECDSA Ed25519) verification failed."""
