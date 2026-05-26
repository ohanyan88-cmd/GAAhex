"""Notification channel adapters (doc 24) — make notifications reach OUT.

An adapter is `async (to, subject, body) -> None` that "sends" a message and RAISES on failure.
Dev adapters just log (no external credentials); a real SMTP/Twilio/webhook adapter slots in later
behind the same interface via `register(name, adapter)`. `dispatch(...)` routes by channel name,
records an OutboundMessage (the delivery log), and is fully fail-soft — it never raises into the
caller (a delivery problem must not break the notification emit / record mutation that triggered it).
"""
import logging
from typing import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

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
