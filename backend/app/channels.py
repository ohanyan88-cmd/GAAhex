"""Notification channel adapters (doc 24) — make notifications reach OUT.

An adapter is `async (to, subject, body) -> None` that "sends" a message and RAISES on failure.
Dev adapters just log (no external credentials); a real SMTP/Twilio/webhook adapter slots in later
behind the same interface via `register(name, adapter)`. `dispatch(...)` routes by channel name,
records an OutboundMessage (the delivery log), and is fully fail-soft — it never raises into the
caller (a delivery problem must not break the notification emit / record mutation that triggered it).
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models.outbound import OutboundMessage

logger = logging.getLogger("gaaex.channels")

# Adapter contract: send (or raise). `to` is the channel-specific address (email/phone/url) or None.
Adapter = Callable[[str | None, str | None, str], Awaitable[None]]

_REGISTRY: dict[str, Adapter] = {}


def register(name: str, adapter: Adapter) -> None:
    """Register (or replace) the adapter for a channel name."""
    _REGISTRY[name] = adapter


def registered() -> dict[str, Adapter]:
    return dict(_REGISTRY)


# ---- dev adapters (log only; no external calls) ----

async def _inapp_adapter(to, subject, body):
    return  # no-op: the inbox Notification row is the delivery


async def _console_adapter(to, subject, body):
    logger.info("[console] to=%s subject=%s body=%s", to, subject, body)


async def _email_adapter(to, subject, body):
    if not to:
        raise ValueError("no email address for recipient")
    logger.info("[email] to=%s subject=%s body=%s", to, subject, body)


async def _sms_adapter(to, subject, body):
    if not to:
        raise ValueError("no phone number for recipient")
    logger.info("[sms] to=%s body=%s", to, body)


async def _webhook_adapter(to, subject, body):
    if not to:
        raise ValueError("no webhook url configured")
    logger.info("[webhook] to=%s body=%s", to, body)


register("inapp", _inapp_adapter)
register("console", _console_adapter)
register("email", _email_adapter)
register("sms", _sms_adapter)
register("webhook", _webhook_adapter)


# ---- dispatch ----

async def dispatch(s: AsyncSession, *, tenant_id, channel: str, to: str | None,
                   subject: str | None, body: str, def_key: str | None = None,
                   user_id=None) -> OutboundMessage | None:
    """Route a message to its channel adapter and log the attempt as an OutboundMessage.

    `inapp` is a no-op with no log row (the inbox Notification is the delivery). For every other
    channel: run the adapter, record SENT on success or FAILED (with the error) on raise, and never
    propagate. Returns the OutboundMessage (or None for inapp / if logging itself fails)."""
    if channel == "inapp":
        return None

    adapter = _REGISTRY.get(channel)
    status, error = "SENT", None
    try:
        if adapter is None:
            status, error = "FAILED", f"no adapter registered for channel '{channel}'"
        else:
            await adapter(to, subject, body)
    except Exception as e:                      # adapter failure → FAILED, but keep going
        status, error = "FAILED", str(e)[:500]

    try:
        msg = OutboundMessage(tenant_id=tenant_id, channel=channel, to_addr=to, subject=subject,
                              body=body, status=status, def_key=def_key, user_id=user_id, error=error)
        s.add(msg)
        await s.flush()
        return msg
    except Exception:
        logger.exception("failed to record OutboundMessage (channel=%s)", channel)
        return None


# ============================================================================================
# Real provider adapters (opt-in). They are registered ONLY when env-configured (see
# configure_adapters below); otherwise the dev adapters above stay live, so a fresh clone / the
# test suite behave exactly as before. Each raises on failure → dispatch records FAILED, never raises.
#
# Configure via gitignored backend/.env (never hardcode secrets):
#   EMAIL_PROVIDER=smtp  SMTP_HOST=...  SMTP_PORT=587  SMTP_USER=...  SMTP_PASSWORD=...
#                        SMTP_FROM=...  SMTP_STARTTLS=true
#   SMS_PROVIDER=twilio  TWILIO_ACCOUNT_SID=...  TWILIO_AUTH_TOKEN=...  TWILIO_FROM=+374...
# ============================================================================================

def _smtp_send_sync(to: str, subject: str, body: str) -> None:
    """Blocking SMTP send (stdlib smtplib); run off the event loop via asyncio.to_thread."""
    msg = EmailMessage()
    msg["From"] = settings.smtp_from or settings.smtp_user or ""
    msg["To"] = to
    msg["Subject"] = subject or ""
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        if settings.smtp_starttls:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password or "")
        server.send_message(msg)


async def _smtp_adapter(to, subject, body):
    """Real email via SMTP. Raises on any failure so dispatch logs FAILED."""
    if not to:
        raise ValueError("no email address for recipient")
    await asyncio.to_thread(_smtp_send_sync, to, subject, body)


async def _twilio_adapter(to, subject, body):
    """Real SMS via Twilio's REST API (httpx + basic auth SID/token). Raises on non-2xx."""
    if not to:
        raise ValueError("no phone number for recipient")
    import httpx  # already a dependency; lazy so the import is only paid when Twilio is live

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    data = {"From": settings.twilio_from, "To": to, "Body": body}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, data=data,
                                 auth=(settings.twilio_account_sid, settings.twilio_auth_token))
    if resp.status_code >= 300:
        raise RuntimeError(f"twilio send failed: HTTP {resp.status_code} {resp.text[:200]}")


def configure_adapters() -> None:
    """Swap in real adapters when (and only when) env-configured; otherwise leave the dev adapters
    registered above untouched. Idempotent — safe to call more than once."""
    if settings.email_provider == "smtp" and settings.smtp_host:
        register("email", _smtp_adapter)
        logger.info("channels: email adapter = SMTP (%s:%s)", settings.smtp_host, settings.smtp_port)
    else:
        logger.info("channels: email adapter = dev (console log)")

    if settings.sms_provider == "twilio" and settings.twilio_account_sid and settings.twilio_auth_token:
        register("sms", _twilio_adapter)
        logger.info("channels: sms adapter = Twilio")
    else:
        logger.info("channels: sms adapter = dev (console log)")


# Activate at import time, guarded by settings (non-invasive — no main.py change needed).
configure_adapters()
