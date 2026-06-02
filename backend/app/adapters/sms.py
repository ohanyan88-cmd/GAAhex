"""SMS channel adapter (doc 24 / E23).

Behaviour is entirely driven by env / settings — never hardcoded:

  No Twilio config   →  LogSmsAdapter (log-only; returns status="LOG"; never dials out)
  Twilio configured  →  TwilioSmsAdapter (real delivery via Twilio REST API + httpx)

`configure()` at the bottom registers the appropriate adapter in `adapters.registry`.
It is called at import time so importing `app.adapters` (via __init__.py) activates the
right adapter automatically.

Seam for future providers
--------------------------
To add a second SMS provider (local SMS gateway, Kavenegar, MessageBird, …):
1.  Sub-class `ChannelAdapter` with `channel = "sms"`.
2.  Add a new provider name to `settings.sms_provider`.
3.  Add an `elif` branch in `configure()` below.
No other file needs to change.

Dormant-safe guarantee
-----------------------
- Without Twilio credentials, `LogSmsAdapter` is used — no external connections, never raises.
- With Twilio credentials, `TwilioSmsAdapter.send()` returns FAILED (not raises) on HTTP error.
- No secrets in source code; all credentials come from gitignored backend/.env.
"""
from __future__ import annotations

import logging
from typing import Any

from .base import ChannelAdapter, registry

logger = logging.getLogger("gaahex.adapters.sms")


# ---------------------------------------------------------------------------
# Log-only adapter (dev / no-config default)
# ---------------------------------------------------------------------------

class LogSmsAdapter(ChannelAdapter):
    """SMS adapter that logs the message and returns immediately.

    Default when no SMS provider is configured.  Safe for dev, CI, staging.
    """

    channel = "sms"

    async def send(
        self,
        to: str | None,
        subject: str | None,
        body: str,
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not to:
            # Match the legacy dispatch contract: a message with no recipient is a FAILED
            # delivery, not a silent log. Preserves test_channels behaviour (non-breaking).
            return {
                "status": "FAILED",
                "channel": "sms",
                "to": to,
                "detail": "no phone number for recipient",
            }
        logger.info(
            "[sms:log] to=%r body_len=%d meta=%r",
            to, len(body or ""), meta or {},
        )
        return {
            "status": "LOG",
            "channel": "sms",
            "to": to,
            "detail": "logged (no SMS provider config); no real SMS sent",
        }


# ---------------------------------------------------------------------------
# Twilio adapter (opt-in; activated only when env-configured)
# ---------------------------------------------------------------------------

class TwilioSmsAdapter(ChannelAdapter):
    """SMS adapter that delivers via the Twilio Messages REST API.

    Uses `httpx` (already a project dependency) with HTTP Basic auth
    (account SID + auth token).  Does NOT depend on the Twilio SDK.

    Activated only when SMS_PROVIDER=twilio and TWILIO_ACCOUNT_SID +
    TWILIO_AUTH_TOKEN are set in the environment.
    """

    channel = "sms"

    def __init__(self, *, account_sid: str, auth_token: str, from_number: str) -> None:
        self._sid = account_sid
        self._token = auth_token
        self._from = from_number

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
                "channel": "sms",
                "to": to,
                "detail": "no phone number for recipient",
            }

        import httpx  # lazy: only paid when Twilio is actually live

        url = (
            f"https://api.twilio.com/2010-04-01/Accounts"
            f"/{self._sid}/Messages.json"
        )
        data = {"From": self._from, "To": to, "Body": body or ""}
        logger.info("[sms:twilio] to=%r from=%r", to, self._from)

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, data=data, auth=(self._sid, self._token))

        if resp.status_code >= 300:
            detail = f"twilio HTTP {resp.status_code}: {resp.text[:200]}"
            return {"status": "FAILED", "channel": "sms", "to": to, "detail": detail}

        return {
            "status": "SENT",
            "channel": "sms",
            "to": to,
            "detail": f"delivered via Twilio (from={self._from})",
        }


# ---------------------------------------------------------------------------
# Auto-configure at import time (dormant-safe)
# ---------------------------------------------------------------------------

def configure() -> None:
    """Register the appropriate SMS adapter in adapters.registry.

    Called at module import (bottom of this file) and idempotent — safe to
    call multiple times.  Reads `app.config.settings`; no hardcoded values.
    """
    from ..config import settings  # noqa: PLC0415

    if (
        settings.sms_provider == "twilio"
        and settings.twilio_account_sid
        and settings.twilio_auth_token
    ):
        adapter: ChannelAdapter = TwilioSmsAdapter(
            account_sid=settings.twilio_account_sid,
            auth_token=settings.twilio_auth_token,
            from_number=settings.twilio_from or "",
        )
        logger.info("adapters: sms → TwilioSmsAdapter")
    else:
        adapter = LogSmsAdapter()
        logger.info("adapters: sms → LogSmsAdapter (no Twilio config; log-only)")

    registry.set(adapter)


configure()
