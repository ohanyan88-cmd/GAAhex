"""Notification channel adapters (doc 24) — make notifications reach OUT.

An adapter is `async (to, subject, body) -> None` that "sends" a message and RAISES on failure.
Dev adapters just log (no external credentials); a real SMTP/Twilio/webhook adapter slots in later
behind the same interface via `register(name, adapter)`. `dispatch(...)` routes by channel name,
records an OutboundMessage (the delivery log), and is fully fail-soft — it never raises into the
caller (a delivery problem must not break the notification emit / record mutation that triggered it).

E23: `dispatch` now consults `app.adapters.registry` (the OOP ChannelAdapter layer) FIRST.
If the new registry has an adapter for the channel, it is used and its result drives the
OutboundMessage status.  For channels NOT in the new registry (inapp, webhook, console), the
legacy functional adapters in `_REGISTRY` below continue to handle the call unchanged.
This makes the transition fully non-breaking.
"""
import asyncio
import logging
import smtplib
from email.message import EmailMessage
from typing import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models.outbound import OutboundMessage

logger = logging.getLogger("gaahex.channels")

# Adapter contract: send (or raise). `to` is the channel-specific address (email/phone/url) or None.
Adapter = Callable[[str | None, str | None, str], Awaitable[None]]

_REGISTRY: dict[str, Adapter] = {}


# ---- PII redaction helpers (C1, D22) ---------------------------------------------------
# Channel adapter logs MUST NOT carry full recipient addresses or message body content. The
# delivery log row (OutboundMessage) keeps the full data behind RBAC; the INFO log line is the
# operator-visible breadcrumb and is sized to "did it leave the box?" not "what was in it?".
# These helpers are applied to every logger.info(...) call in this module — never to the raw
# `to`/`body` arguments that travel to the actual adapter.

def _redact_addr(addr: str | None) -> str:
    """Return an email-shaped redaction: keep first 2 chars of the local-part + the domain."""
    if not addr or "@" not in addr:
        return "***"
    local, domain = addr.split("@", 1)
    return f"{local[:2]}***@{domain}" if len(local) > 2 else f"***@{domain}"


def _redact_phone(phone: str | None) -> str:
    """Return phone redaction: last-4 only, masked when the source is too short."""
    if not phone:
        return "***"
    return f"***{phone[-4:]}" if len(phone) >= 4 else "***"


def _redact_url(url: str | None) -> str:
    """Webhook URL redaction: scheme+host only, drop path/query (which may carry tokens)."""
    if not url:
        return "***"
    try:
        from urllib.parse import urlparse  # noqa: PLC0415
        p = urlparse(url)
        if p.scheme and p.netloc:
            return f"{p.scheme}://{p.netloc}/***"
    except Exception:
        pass
    return "***"


def register(name: str, adapter: Adapter) -> None:
    """Register (or replace) the adapter for a channel name."""
    _REGISTRY[name] = adapter


def registered() -> dict[str, Adapter]:
    return dict(_REGISTRY)


# ---- dev adapters (log only; no external calls) ----

async def _inapp_adapter(to, subject, body):
    return  # no-op: the inbox Notification row is the delivery


async def _console_adapter(to, subject, body):
    logger.info("[console] to=%s subject=%s body_len=%d",
                _redact_addr(to), subject, len(body or ""))


async def _email_adapter(to, subject, body):
    if not to:
        raise ValueError("no email address for recipient")
    logger.info("[email] to=%s subject=%s body_len=%d",
                _redact_addr(to), subject, len(body or ""))


async def _sms_adapter(to, subject, body):
    if not to:
        raise ValueError("no phone number for recipient")
    logger.info("[sms] to=%s body_len=%d", _redact_phone(to), len(body or ""))


async def _webhook_adapter(to, subject, body):
    if not to:
        raise ValueError("no webhook url configured")
    logger.info("[webhook] to=%s body_len=%d", _redact_url(to), len(body or ""))


register("inapp", _inapp_adapter)
register("console", _console_adapter)
register("email", _email_adapter)
register("sms", _sms_adapter)
register("webhook", _webhook_adapter)


# ---- A26 preference consultation (default-send, fail-soft) ----

async def _pref_suppresses_external(s: AsyncSession, tenant_id, user_id, channel: str,
                                    def_key: str | None) -> bool:
    """True only when an EXPLICIT A26 delivery preference says this external `channel` must NOT be
    delivered to `user_id` for this `def_key`. Default-send: no pref row ⇒ False (deliver). Fail-soft:
    any error ⇒ False (deliver). Resolution mirrors routers.notifications.resolve_pref.

    Suppress when the winning pref is: muted, mode == off, or the channel is not in its `channels`.
    realtime/digest with the channel allowed ⇒ do NOT suppress here (digest deferral is handled at
    emit by `digest_pending`; this guard's job is only to honor off/mute/channel-exclusion).
    """
    try:
        from .routers.notifications import _resolve_pref  # lazy: avoid import cycle at module load
        from .models.notification import NotificationDef

        category = None
        if def_key:
            ndef = (await s.execute(
                select(NotificationDef).where(
                    NotificationDef.tenant_id == tenant_id, NotificationDef.key == def_key
                )
            )).scalar_one_or_none()
            category = ndef.category if ndef else None

        pref = await _resolve_pref(s, tenant_id, user_id, category or "", def_key or "")
        if pref is None:
            return False                       # no A26 pref ⇒ today's behaviour (send)
        if pref["muted"] or pref["mode"] == "off":
            return True
        if channel not in pref["channels"]:
            return True
        return False
    except Exception:
        return False                           # never block delivery on a pref-lookup error


# ---- Mail module: per-tenant system-sender routing ----

async def _tenant_system_sender(s: AsyncSession, tenant_id):
    """The tenant's `is_system_sender` MailAccount, or None. Fail-soft (any error ⇒ None ⇒ the
    legacy/global email path runs unchanged). This is what makes invoice/dunning mail leave from
    each ISP's OWN server/domain once they configure a mailbox."""
    try:
        from .models import MailAccount  # lazy: avoid import cycle at module load
        return (await s.execute(
            select(MailAccount).where(
                MailAccount.tenant_id == tenant_id,
                MailAccount.is_system_sender.is_(True),
                MailAccount.deletion_state == "ACTIVE",
            )
        )).scalars().first()
    except Exception:
        return None


# ---- dispatch ----

async def dispatch(s: AsyncSession, *, tenant_id, channel: str, to: str | None,
                   subject: str | None, body: str, def_key: str | None = None,
                   user_id=None) -> OutboundMessage | None:
    """Route a message to its channel adapter and log the attempt as an OutboundMessage.

    `inapp` is a no-op with no log row (the inbox Notification is the delivery). For every other
    channel: run the adapter, record SENT on success or FAILED (with the error) on raise, and never
    propagate. Returns the OutboundMessage (or None for inapp / if logging itself fails).

    E23 routing — checked in priority order:
    1.  adapters.registry (OOP ChannelAdapter layer — email + sms)  → uses result["status"]
    2.  _REGISTRY (legacy functional adapters — inapp/console/webhook) → raises on failure
    3.  Neither present → FAILED with "no adapter" error
    The fallback to legacy adapters keeps all existing channels (inapp/webhook/console) working
    without any change; the non-breaking guarantee is preserved.
    """
    if channel == "inapp":
        return None

    # -- A26: consult the recipient's delivery preference before any EXTERNAL dispatch --
    # Defense-in-depth: emit_notification is the primary gate, but dispatch may be reached from other
    # callers, so we re-check here. Fully fail-soft and DEFAULT-SEND: only an explicit A26 pref that
    # `off`s / `mute`s / excludes this channel suppresses delivery; no pref row (the common case, and
    # every existing channels test) ⇒ send exactly as before. The in-app inbox row is unaffected
    # (it's never created here). Never raises into the caller.
    if user_id is not None and await _pref_suppresses_external(s, tenant_id, user_id, channel, def_key):
        logger.info("[a26] external dispatch suppressed by pref (channel=%s def_key=%s user=%s)",
                    channel, def_key, user_id)
        return None

    # -- Mail module: route tenant email through the tenant's OWN SMTP server when configured --
    # Additive + fail-soft: a tenant with an `is_system_sender` MailAccount sends ALL email channel
    # traffic (invoices, dunning, …) from its own domain via SmtpEmailGateway. Tenants without a mail
    # account fall through to the existing OOP/legacy adapter path UNCHANGED (every current test).
    if channel == "email" and to:
        _acc = await _tenant_system_sender(s, tenant_id)
        if _acc is not None:
            status, error = "SENT", None
            try:
                from .services.comms.smtp_email import gateway_for_account  # noqa: PLC0415
                await gateway_for_account(_acc).send(to=to, subject=subject or "", text=body)
            except Exception as exc:                 # fail-soft — dispatch never raises
                status, error = "FAILED", str(exc)[:500]
            try:
                msg = OutboundMessage(tenant_id=tenant_id, channel=channel, to_addr=to, subject=subject,
                                      body=body, status=status, def_key=def_key, user_id=user_id, error=error)
                s.add(msg)
                await s.flush()
                return msg
            except Exception:
                logger.exception("failed to record OutboundMessage (channel=email, mail account)")
                return None

    # -- E23: try the OOP adapter registry first --
    # Import lazily to avoid a circular import at module load (adapters imports config, not channels).
    try:
        from .adapters import registry as _adapter_registry  # noqa: PLC0415
        oop_adapter = _adapter_registry.get(channel)
    except Exception:
        oop_adapter = None

    status, error = "SENT", None

    if oop_adapter is not None:
        # Delegate to the OOP adapter (safe_send never raises).
        meta = {"def_key": def_key, "user_id": str(user_id) if user_id else None}
        try:
            result = await oop_adapter.safe_send(to, subject, body or "", meta)
            raw_status = result.get("status", "FAILED")
            # Map "LOG" (logged-only, no real send) to "SENT" for the outbound log status column
            # so the record is queryable as a successful delivery-to-log event.
            status = "SENT" if raw_status == "LOG" else raw_status
            if raw_status == "FAILED":
                error = result.get("detail", "")[:500]
            elif raw_status == "LOG":
                error = result.get("detail", "")[:500]  # store the "logged" note in the error col
        except Exception as exc:
            status, error = "FAILED", str(exc)[:500]
    else:
        # -- Fallback: legacy functional adapter registry (inapp already handled above) --
        legacy_adapter = _REGISTRY.get(channel)
        try:
            if legacy_adapter is None:
                status, error = "FAILED", f"no adapter registered for channel '{channel}'"
            else:
                await legacy_adapter(to, subject, body)
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
    from .utils.http_client import get_async_client  # AC-5 — canonical factory

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    data = {"From": settings.twilio_from, "To": to, "Body": body}
    async with get_async_client(timeout=15) as client:
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
