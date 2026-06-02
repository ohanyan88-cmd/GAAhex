"""Default email channel adapter (doc 24 / E23).

Behaviour is entirely driven by env / settings — never hardcoded:

  No SMTP config   →  LogEmailAdapter (log-only; returns status="LOG"; never sends real mail)
  SMTP configured  →  SmtpEmailAdapter (real delivery via stdlib smtplib + asyncio.to_thread)

`configure()` at the bottom of this module reads `app.config.settings` and registers the
appropriate adapter in `adapters.registry`.  It is called at import time of this module so
importing `app.adapters` (via __init__.py) is enough to activate the right adapter without
any change to main.py.

Dormant-safe guarantee
-----------------------
- If SMTP settings are absent or incomplete, the log adapter is used — it never raises,
  never connects to anything, never sends real mail.
- If SMTP settings are present but the connection fails, SmtpEmailAdapter.send() returns
  status="FAILED" with the error detail (via ChannelAdapter.safe_send — never raises).
- No secrets appear in source code; everything comes from gitignored backend/.env.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Any

from .base import ChannelAdapter, registry

logger = logging.getLogger("gaahex.adapters.email")


# ---------------------------------------------------------------------------
# Log-only adapter (dev / no-config default)
# ---------------------------------------------------------------------------

class LogEmailAdapter(ChannelAdapter):
    """Email adapter that logs the message and returns immediately.

    Used when no SMTP config is present.  Safe for dev, CI, and staging —
    no external connections, no credentials required, no real mail sent.
    """

    channel = "email"

    async def send(
        self,
        to: str | None,
        subject: str | None,
        body: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not to:
            # Match the legacy dispatch contract: no recipient is a FAILED delivery, not a log.
            return {
                "status": "FAILED",
                "channel": "email",
                "to": to,
                "detail": "no email address for recipient",
            }
        logger.info(
            "[email:log] to=%r subject=%r body_len=%d meta=%r",
            to, subject, len(body or ""), meta or {},
        )
        return {
            "status": "LOG",
            "channel": "email",
            "to": to,
            "detail": "logged (no SMTP config); no real mail sent",
        }


# ---------------------------------------------------------------------------
# Real SMTP adapter (opt-in; activated only when env-configured)
# ---------------------------------------------------------------------------

class SmtpEmailAdapter(ChannelAdapter):
    """Email adapter that delivers via SMTP (stdlib smtplib, run off the event loop).

    Activated only when EMAIL_PROVIDER=smtp and SMTP_HOST is set in the environment.
    All connection parameters come from `app.config.settings`; no defaults are
    hardcoded here — if a required setting is absent the send raises (→ FAILED).
    """

    channel = "email"

    def __init__(self, *, host: str, port: int, user: str | None, password: str | None,
                 from_addr: str | None, starttls: bool) -> None:
        self._host = host
        self._port = port
        self._user = user
        self._password = password
        self._from = from_addr or user or ""
        self._starttls = starttls

    def _send_sync(self, to: str, subject: str, body: str) -> None:
        """Blocking SMTP send — called via asyncio.to_thread so the event loop is not blocked."""
        msg = EmailMessage()
        msg["From"] = self._from
        msg["To"] = to
        msg["Subject"] = subject or ""
        msg.set_content(body)
        with smtplib.SMTP(self._host, self._port, timeout=15) as server:
            if self._starttls:
                server.starttls()
            if self._user:
                server.login(self._user, self._password or "")
            server.send_message(msg)

    async def send(
        self,
        to: str | None,
        subject: str | None,
        body: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not to:
            return {
                "status": "FAILED",
                "channel": "email",
                "to": to,
                "detail": "no email address for recipient",
            }
        logger.info("[email:smtp] to=%r subject=%r", to, subject)
        await asyncio.to_thread(self._send_sync, to, subject or "", body or "")
        return {
            "status": "SENT",
            "channel": "email",
            "to": to,
            "detail": f"delivered via SMTP {self._host}:{self._port}",
        }


# ---------------------------------------------------------------------------
# Auto-configure at import time (dormant-safe)
# ---------------------------------------------------------------------------

def configure() -> None:
    """Register the appropriate email adapter in adapters.registry.

    Called at module import (bottom of this file) and idempotent — safe to
    call multiple times.  Reads `app.config.settings`; no hardcoded values.
    """
    # Import here to avoid a circular dependency at module load
    from ..config import settings  # noqa: PLC0415

    if settings.email_provider == "smtp" and settings.smtp_host:
        adapter: ChannelAdapter = SmtpEmailAdapter(
            host=settings.smtp_host,
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_password,
            from_addr=settings.smtp_from,
            starttls=settings.smtp_starttls,
        )
        logger.info(
            "adapters: email → SmtpEmailAdapter (%s:%s)", settings.smtp_host, settings.smtp_port
        )
    else:
        adapter = LogEmailAdapter()
        logger.info("adapters: email → LogEmailAdapter (no SMTP config; log-only)")

    registry.set(adapter)


configure()
