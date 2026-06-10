"""Messaging gateways — per-tenant SMS / Telegram / WhatsApp send (the comms-gateway pattern).

Built from a `TenantChannelAccount` row (decrypted creds), NOT global env — so each tenant ISP
sends from its OWN bot/sender. Telegram is live (public Bot API). Viva-SMS + WhatsApp are
registered stubs (creds/API pending from the pilot) that raise `MessagingNotConfigured` until
wired — the per-tenant framework is ready, they slot in when HouseNet shares access.
"""
from __future__ import annotations

import logging

_log = logging.getLogger("gaahex.messaging")


class MessagingError(Exception):
    """Send failed (transport/HTTP/credential)."""


class MessagingNotConfigured(MessagingError):
    """The channel's gateway is a stub pending real provider credentials/API (Viva-SMS, WhatsApp)."""


class TelegramGateway:
    """Telegram Bot API. `secret_token` = bot token; `to` = chat id (numeric) or @channel username."""
    provider = "telegram_bot"

    def __init__(self, *, token: str | None, default_chat: str | None = None) -> None:
        if not token:
            raise MessagingNotConfigured("Telegram bot token not configured on the channel account")
        self._token = token
        self._default_chat = default_chat

    async def send(self, *, to: str | None, text: str, subject: str | None = None) -> dict:
        from ..utils.http_client import get_async_client  # AC-5 canonical factory
        chat_id = to or self._default_chat
        if not chat_id:
            raise MessagingError("Telegram send: no chat_id (recipient) and no default configured")
        body = (f"*{subject}*\n{text}" if subject else text)
        url = f"https://api.telegram.org/bot{self._token}/sendMessage"
        async with get_async_client(timeout=15) as client:
            resp = await client.post(url, json={"chat_id": chat_id, "text": body})
        if resp.status_code >= 300:
            raise MessagingError(f"Telegram send failed: HTTP {resp.status_code} {resp.text[:200]}")
        data = resp.json()
        return {"provider": "telegram_bot", "to": str(chat_id),
                "message_id": str((data.get("result") or {}).get("message_id") or ""), "raw": data}


class VivaSmsGateway:
    """SMS via Viva Armenia (Viva-MTS). STUB — wired when HouseNet shares the Viva SMS API spec +
    credentials. The per-tenant seam (account → gateway → dispatch) is already in place."""
    provider = "viva_armenia"

    def __init__(self, *, token: str | None, sender_id: str | None, extra: str | None = None) -> None:
        self._token, self._sender, self._extra = token, sender_id, extra

    async def send(self, *, to: str | None, text: str, subject: str | None = None) -> dict:
        raise MessagingNotConfigured(
            "Viva Armenia SMS gateway is a stub — pending Viva's API spec + credentials from the pilot. "
            "Implement the HTTP send here against the per-tenant account creds when shared."
        )


class WhatsAppGateway:
    """WhatsApp Business Cloud API. STUB — wired when HouseNet shares the Meta WABA phone-number-id +
    access token. Per-tenant seam already in place."""
    provider = "whatsapp_cloud"

    def __init__(self, *, token: str | None, phone_number_id: str | None) -> None:
        self._token, self._pnid = token, phone_number_id

    async def send(self, *, to: str | None, text: str, subject: str | None = None) -> dict:
        raise MessagingNotConfigured(
            "WhatsApp Business gateway is a stub — pending Meta WABA phone-number-id + token from the "
            "pilot. Implement the graph.facebook.com messages send here when shared."
        )


def gateway_for_channel_account(account):
    """Build the right gateway from a `TenantChannelAccount` row (creds already decrypted by the ORM)."""
    cfg = account.config or {}
    if account.channel == "TELEGRAM":
        return TelegramGateway(token=account.secret_token, default_chat=account.sender_id)
    if account.channel == "SMS":
        return VivaSmsGateway(token=account.secret_token, sender_id=account.sender_id, extra=account.secret_extra)
    if account.channel == "WHATSAPP":
        return WhatsAppGateway(token=account.secret_token, phone_number_id=cfg.get("phone_number_id"))
    raise MessagingError(f"unknown channel {account.channel!r}")
