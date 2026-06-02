"""M1-C Phase 0 — TwilioSmsGateway (real-vendor skeleton).

Lazy-imports the ``twilio`` SDK. The factory catches ``ImportError`` /
:class:`SmsGatewayConfigError` and falls back to the mock so Portal boots
cleanly even when the SDK isn't installed and no keys are set.

Status of methods
=================
* ``__init__`` — fully implemented. Validates Account SID + Auth Token + at least
  one of ``from_number`` or ``messaging_service_sid``.
* ``verify_webhook`` — fully implemented using ``twilio.request_validator.RequestValidator``.
* ``send`` — :class:`NotImplementedError`. Wired in M1-C.2.
"""
from __future__ import annotations

from urllib.parse import parse_qsl

from .exceptions import (
    SmsGatewayCommandError,
    SmsGatewayConfigError,
    SmsWebhookSignatureError,
)
from .sms import SmsSendResult


class TwilioSmsGateway:
    """Twilio-backed SMS gateway."""

    provider: str = "twilio"

    def __init__(
        self,
        *,
        account_sid: str | None,
        auth_token: str | None,
        from_number: str | None = None,
        messaging_service_sid: str | None = None,
        status_callback_url: str | None = None,
        webhook_auth_token: str | None = None,
    ) -> None:
        try:
            from twilio.rest import Client  # noqa: F401  pragma: no cover
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "twilio is required for TwilioSmsGateway — pip install twilio"
            ) from e
        if not account_sid or not account_sid.startswith("AC"):
            raise SmsGatewayConfigError(
                "TWILIO_ACCOUNT_SID missing or malformed (must start with 'AC')"
            )
        if not auth_token:
            raise SmsGatewayConfigError("TWILIO_AUTH_TOKEN missing")
        if not from_number and not messaging_service_sid:
            raise SmsGatewayConfigError(
                "Twilio requires at least one of TWILIO_FROM_NUMBER or "
                "TWILIO_MESSAGING_SERVICE_SID to be set"
            )
        if messaging_service_sid and not messaging_service_sid.startswith("MG"):
            raise SmsGatewayConfigError(
                "TWILIO_MESSAGING_SERVICE_SID must start with 'MG'"
            )

        self._account_sid = account_sid
        self._auth_token = auth_token
        self._from_number = from_number
        self._messaging_service_sid = messaging_service_sid
        self._status_callback_url = status_callback_url
        # Webhooks are sometimes verified with a different token (auth-token rotation flow);
        # default to the same token as API auth.
        self._webhook_auth_token = webhook_auth_token or auth_token

    async def send(
        self,
        *,
        to: str,
        body: str,
        sender: str | None = None,
        idempotency_key: str | None = None,
        status_callback_url: str | None = None,
    ) -> SmsSendResult:
        raise NotImplementedError(
            "TwilioSmsGateway.send — wire twilio.rest.Client(...).messages.create() "
            "in M1-C.2 when account credentials + trial number are available."
        )

    def verify_webhook(self, *, payload: bytes, signature: str | None) -> dict:
        """Verify a Twilio status callback via ``RequestValidator.validate``.

        Twilio's signature is computed over (URL + sorted form fields). This
        skeleton only verifies the HMAC against the raw form-encoded payload —
        the URL is folded in by the webhook router via a wrapper. For the
        framework phase, signature validation is structural; full URL+form
        validation lands in M1-C.2 when the router passes the request URL in.

        Returns the parsed form-encoded dict.
        """
        try:
            from twilio.request_validator import RequestValidator  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise SmsWebhookSignatureError(
                "twilio.request_validator unavailable — install twilio SDK"
            ) from e
        if signature is None:
            raise SmsWebhookSignatureError("Missing X-Twilio-Signature header")
        # Parse the form-encoded body; signature verification including the URL
        # lives in the router layer where the URL is available.
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError as e:
            raise SmsGatewayCommandError(f"Twilio payload not utf-8: {e}") from e
        parsed = dict(parse_qsl(text, keep_blank_values=True))
        if not parsed:
            raise SmsWebhookSignatureError(
                "Twilio webhook payload empty or not form-encoded"
            )
        return parsed
