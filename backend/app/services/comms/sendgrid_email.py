"""M1-C Phase 0 — SendGridEmailGateway (real-vendor skeleton).

Lazy-imports the ``sendgrid`` SDK; the factory falls back to the mock on
ImportError / config errors.

Status of methods
=================
* ``__init__`` — fully implemented. Verifies API-key prefix + sender email.
* ``verify_webhook`` — implemented via Ed25519 verification. Returns the
  parsed event array.
* ``send`` — :class:`NotImplementedError`. Wired in M1-C.3.
"""
from __future__ import annotations

import json

from .email import EmailSendResult
from .exceptions import (
    EmailGatewayCommandError,
    EmailGatewayConfigError,
    EmailWebhookSignatureError,
)


class SendGridEmailGateway:
    """SendGrid-backed email gateway."""

    provider: str = "sendgrid"

    def __init__(
        self,
        *,
        api_key: str | None,
        from_email: str | None,
        from_name: str | None = None,
        webhook_public_key: str | None = None,
    ) -> None:
        try:
            import sendgrid  # noqa: F401  pragma: no cover
            from sendgrid.helpers.mail import Mail  # noqa: F401  pragma: no cover
        except ImportError as e:  # pragma: no cover
            raise ImportError(
                "sendgrid is required for SendGridEmailGateway — pip install sendgrid"
            ) from e
        if not api_key or not api_key.startswith("SG."):
            raise EmailGatewayConfigError(
                "SENDGRID_API_KEY missing or malformed (must start with 'SG.')"
            )
        if not from_email or "@" not in from_email:
            raise EmailGatewayConfigError(
                "SENDGRID_FROM_EMAIL missing or malformed (must contain '@')"
            )
        self._api_key = api_key
        self._from_email = from_email
        self._from_name = from_name
        self._webhook_public_key = webhook_public_key

    async def send(self, *, to, subject, html=None, text=None, sender=None,
                   sender_name=None, attachments=None, template_id=None,
                   template_data=None, idempotency_key=None,
                   categories=None) -> EmailSendResult:
        raise NotImplementedError(
            "SendGridEmailGateway.send — wire sendgrid.SendGridAPIClient(...).send(Mail(...)) "
            "in M1-C.3 when account credentials are available."
        )

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str | None,
        timestamp: str | None = None,
    ) -> dict:
        """Verify a SendGrid event-webhook payload via Ed25519.

        SendGrid signs ``timestamp + payload_bytes`` with an Ed25519 keypair; the
        public key is configured at ``SENDGRID_WEBHOOK_PUBLIC_KEY``. The headers
        are ``X-Twilio-Email-Event-Webhook-Signature`` (base64 signature) and
        ``X-Twilio-Email-Event-Webhook-Timestamp``.

        Returns ``{events: [...]}``. Raises
        :class:`EmailWebhookSignatureError` on signature mismatch or missing
        config.
        """
        if not self._webhook_public_key:
            raise EmailWebhookSignatureError(
                "SENDGRID_WEBHOOK_PUBLIC_KEY not configured — cannot verify signature"
            )
        if not signature:
            raise EmailWebhookSignatureError(
                "Missing X-Twilio-Email-Event-Webhook-Signature header"
            )
        if not timestamp:
            raise EmailWebhookSignatureError(
                "Missing X-Twilio-Email-Event-Webhook-Timestamp header"
            )
        try:
            # SendGrid ships ``EventWebhook`` helper; using it keeps us aligned
            # with their reference verification path.
            from sendgrid import EventWebhook  # type: ignore
        except ImportError as e:  # pragma: no cover
            raise EmailWebhookSignatureError(
                "sendgrid.EventWebhook unavailable — install sendgrid SDK"
            ) from e

        verifier = EventWebhook()
        try:
            ec_public_key = verifier.convert_public_key_to_ecdsa(self._webhook_public_key)
            ok = verifier.verify_signature(
                payload.decode("utf-8"), signature, timestamp, ec_public_key,
            )
        except Exception as e:  # pragma: no cover
            raise EmailWebhookSignatureError(
                f"SendGrid signature verification raised: {e}"
            ) from e
        if not ok:
            raise EmailWebhookSignatureError("SendGrid signature mismatch")

        # Parse the JSON event array.
        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as e:
            raise EmailGatewayCommandError(
                f"SendGrid webhook payload not valid JSON: {e}"
            ) from e
        if isinstance(data, list):
            return {"events": data}
        if isinstance(data, dict):
            return data
        return {"events": [data]}
