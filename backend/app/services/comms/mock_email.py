"""M1-C Phase 0 — MockEmailGateway.

In-memory email gateway for tests + dev. Stores every send under
``sent_messages`` so tests can introspect.
"""
from __future__ import annotations

import json
from typing import Any

from app.utils.ids import uuid7

from .email import Attachment, EmailSendResult
from .exceptions import EmailGatewayCommandError


def _short_uuid() -> str:
    return uuid7().hex[:8]


class MockEmailGateway:
    """In-memory email gateway.

    Behaviour summary
    -----------------
    * ``send`` returns ``status='queued'`` and stores the message under
      ``sent_messages``. Raises :class:`EmailGatewayCommandError` if neither
      ``html``/``text`` nor ``template_id`` is supplied, or if ``to`` is missing.
    * ``verify_webhook`` returns the parsed JSON body (a list of events per
      SendGrid's format, normalized into a dict ``{"mock": True, "events": [...]}``).
    """

    provider: str = "mock"

    def __init__(
        self,
        *,
        default_sender: str | None = None,
        default_sender_name: str | None = None,
    ) -> None:
        self._default_sender = default_sender
        self._default_sender_name = default_sender_name
        self.sent_messages: list[dict[str, Any]] = []

    def reset(self) -> None:
        self.sent_messages.clear()

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
        if not to:
            raise EmailGatewayCommandError("Mock: missing 'to'")
        # Either (html/text) OR template_id — caller must supply one.
        if not (html or text or template_id):
            raise EmailGatewayCommandError(
                "Mock: must supply one of html, text, or template_id"
            )
        message_id = f"email_mock_{_short_uuid()}"
        record = {
            "message_id": message_id,
            "to": to, "subject": subject,
            "html": html, "text": text,
            "sender": sender or self._default_sender,
            "sender_name": sender_name or self._default_sender_name,
            "attachments": [
                {"filename": a.filename, "mime_type": a.mime_type,
                 "content_id": a.content_id, "size_b64_chars": len(a.content_b64)}
                for a in (attachments or [])
            ],
            "template_id": template_id,
            "template_data": template_data,
            "idempotency_key": idempotency_key,
            "categories": list(categories) if categories else [],
        }
        self.sent_messages.append(record)
        return EmailSendResult(
            message_id=message_id,
            status="queued",
            to=to,
            raw={"mock": True},
        )

    def verify_webhook(
        self,
        *,
        payload: bytes,
        signature: str | None,
        timestamp: str | None = None,
    ) -> dict:
        """Mock signature check: always passes. Parses SendGrid's JSON event array."""
        if not payload:
            return {"mock": True, "events": []}
        try:
            data = json.loads(payload)
        except (json.JSONDecodeError, ValueError, UnicodeDecodeError):
            return {"mock": True, "raw": payload.hex()}
        if isinstance(data, list):
            return {"mock": True, "events": data}
        if isinstance(data, dict):
            return {"mock": True, **data}
        return {"mock": True, "events": [data]}
