"""M1-C Phase 0 — MockSmsGateway.

In-memory SMS gateway for tests + dev. Stores every send under
``sent_messages`` so tests can ``assert mock.sent_messages == [...]``.
"""
from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import parse_qs

from app.utils.ids import uuid7

from .exceptions import SmsGatewayCommandError
from .sms import SmsSendResult


def _short_uuid() -> str:
    return uuid7().hex[:8]


def _segments(body: str) -> int:
    """Cheap segment count: 160 GSM chars per segment, 70 chars for Unicode-heavy bodies."""
    # If any char is outside basic ASCII, assume Unicode encoding (70 chars/segment).
    is_unicode = any(ord(c) > 127 for c in body)
    per = 70 if is_unicode else 160
    if not body:
        return 1
    return max(1, (len(body) + per - 1) // per)


class MockSmsGateway:
    """In-memory SMS gateway.

    Behaviour summary
    -----------------
    * ``send`` returns ``status='queued'`` and stores the message under
      ``sent_messages`` (a list of dicts with all kwargs + the synthetic
      ``message_id``).
    * Sending to ``+0000000000`` raises :class:`SmsGatewayCommandError` so tests
      can exercise the failure path.
    * ``verify_webhook`` accepts any payload (JSON or form-encoded) and returns
      the parsed dict with ``mock=True``.
    """

    provider: str = "mock"

    def __init__(self, *, default_sender: str | None = None) -> None:
        self._default_sender = default_sender
        self.sent_messages: list[dict[str, Any]] = []

    def reset(self) -> None:
        self.sent_messages.clear()

    async def send(
        self,
        *,
        to: str,
        body: str,
        sender: str | None = None,
        idempotency_key: str | None = None,
        status_callback_url: str | None = None,
    ) -> SmsSendResult:
        if to == "+0000000000":
            raise SmsGatewayCommandError(f"Mock: refused to send to sentinel {to!r}")
        message_id = f"sms_mock_{_short_uuid()}"
        from_addr = sender or self._default_sender
        record = {
            "message_id": message_id,
            "to": to, "body": body,
            "sender": from_addr,
            "idempotency_key": idempotency_key,
            "status_callback_url": status_callback_url,
        }
        self.sent_messages.append(record)
        return SmsSendResult(
            message_id=message_id,
            status="queued",
            to=to,
            body_chars=len(body),
            segments_count=_segments(body),
            raw={"mock": True, "from": from_addr},
        )

    def verify_webhook(self, *, payload: bytes, signature: str | None) -> dict:
        """Mock signature check: always passes. Parses JSON or form-encoded payload."""
        if not payload:
            return {"mock": True}
        # Try JSON first.
        try:
            text = payload.decode("utf-8")
        except UnicodeDecodeError:
            return {"mock": True, "raw": payload.hex()}
        try:
            data = json.loads(text)
            if isinstance(data, dict):
                return {"mock": True, **data}
        except (json.JSONDecodeError, ValueError):
            pass
        # Fall back to form-encoded.
        parsed = parse_qs(text)
        flat = {k: v[0] if len(v) == 1 else v for k, v in parsed.items()}
        if flat:
            return {"mock": True, **flat}
        return {"mock": True, "raw": text}
