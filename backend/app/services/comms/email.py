"""M1-C Phase 0 — Vendor-agnostic EmailGateway Protocol + return types.

Concrete implementations: :class:`MockEmailGateway`, :class:`SendGridEmailGateway`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Attachment:
    """One attachment on an outbound email.

    ``content_b64`` is base64-encoded bytes — handy for PDF invoices and other
    binary content. ``content_id`` is for inline images (Content-ID header).
    """

    filename: str
    content_b64: str
    mime_type: str
    content_id: str | None = None


@dataclass(frozen=True)
class EmailSendResult:
    """Outcome of an outbound email send."""

    message_id: str
    status: str             # 'queued' | 'accepted' | 'rejected' | ...
    to: str
    raw: dict = field(default_factory=dict)


@runtime_checkable
class EmailGateway(Protocol):
    """Vendor-agnostic email gateway."""

    provider: str  # 'mock' | 'sendgrid' | ...

    async def send(
        self,
        *,
        to: str,
        subject: str,
        html: str | None = None,
        text: str | None = None,
        sender: str | None = None,
        sender_name: str | None = None,
        attachments: list[Attachment] | None = None,
        template_id: str | None = None,
        template_data: dict | None = None,
        idempotency_key: str | None = None,
        categories: list[str] | None = None,
    ) -> EmailSendResult:
        """Send a single email.

        Either supply ``(html, text)`` for an ad-hoc message OR
        ``(template_id, template_data)`` for a SendGrid Dynamic Template render.
        Passing both is undefined behaviour — implementations may pick one or
        raise a :class:`~.exceptions.EmailGatewayCommandError`.

        ``categories`` becomes Twilio SendGrid's "categories" metadata which is
        the cheap way to filter analytics later (e.g. ``['invoice', 'monthly']``).
        """
        ...

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str | None,
        timestamp: str | None = None,
    ) -> dict:
        """Verify a SendGrid Event Webhook signature.

        SendGrid signs the body+timestamp with an Ed25519 keypair; the public
        key is configured via ``SENDGRID_WEBHOOK_PUBLIC_KEY``. Returns the
        parsed JSON event array (or the raw dict if the body isn't a list).

        Raises :class:`~.exceptions.EmailWebhookSignatureError` on failure.
        """
        ...
