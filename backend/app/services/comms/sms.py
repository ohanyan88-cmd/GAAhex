"""M1-C Phase 0 — Vendor-agnostic SmsGateway Protocol + return types.

Mirrors the OLT pattern: dataclasses + ``@runtime_checkable`` Protocol so concrete
vendors duck-type into place without a base class.

Concrete implementations: :class:`MockSmsGateway`, :class:`TwilioSmsGateway`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class SmsSendResult:
    """Outcome of an outbound SMS send."""

    message_id: str
    status: str             # 'queued' | 'sent' | 'delivered' | 'failed' | ...
    to: str                 # E.164 format
    body_chars: int         # character count of the body
    segments_count: int     # number of SMS segments billed (1 segment ≈ 160 GSM chars)
    raw: dict = field(default_factory=dict)


@runtime_checkable
class SmsGateway(Protocol):
    """Vendor-agnostic SMS gateway."""

    provider: str  # 'mock' | 'twilio' | ...

    async def send(
        self,
        *,
        to: str,
        body: str,
        sender: str | None = None,
        idempotency_key: str | None = None,
        status_callback_url: str | None = None,
    ) -> SmsSendResult:
        """Send a single SMS.

        Parameters
        ----------
        to : str
            Recipient in E.164 format (``+374...``).
        body : str
            Plain-text message body. Unicode allowed; the provider will count
            segments accordingly.
        sender : str | None
            Override the default FROM number / messaging-service SID. ``None``
            uses the gateway's configured default.
        idempotency_key : str | None
            Optional client-side deduplication token. Providers that support it
            (Twilio) will reject a same-body retry within the dedup window.
        status_callback_url : str | None
            Per-message override for the status callback URL. ``None`` uses the
            gateway's configured default (``twilio_status_callback_url``).
        """
        ...

    def verify_webhook(self, *, payload: bytes, signature: str | None) -> dict:
        """Verify a Twilio status callback.

        Twilio's status callback is form-encoded; the ``X-Twilio-Signature`` header
        is a Base64 HMAC-SHA1 of the URL + sorted form fields, keyed by the
        Twilio auth token. Returns the parsed form-data as a dict.

        Raises :class:`~.exceptions.SmsWebhookSignatureError` on failure.
        """
        ...
