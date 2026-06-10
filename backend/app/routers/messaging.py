"""Messaging channels router — /api/messaging/* (per-tenant SMS/Telegram/WhatsApp config + send).

First-class module router (like mail/webhooks). Per-tenant channel accounts (Fernet-encrypted creds,
RLS); account management gated by config.manage. Send routes through `channels.dispatch`, which picks
the tenant's own channel account. Telegram is live; Viva-SMS + WhatsApp are stubs pending pilot creds.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import TenantChannelAccount, User
from ..access import load_grants, can
from .. import workflow, channels
from .auth import current_user
from ..services.messaging import gateway_for_channel_account, MessagingError, MessagingNotConfigured

router = APIRouter(prefix="/api/messaging", tags=["messaging"])

_CHANNELS = {"SMS", "TELEGRAM", "WHATSAPP"}
_PROVIDERS = {"SMS": "viva_armenia", "TELEGRAM": "telegram_bot", "WHATSAPP": "whatsapp_cloud"}


def _ser(a: TenantChannelAccount) -> dict:
    """Channel-account view — NEVER returns secrets (only presence booleans)."""
    return {
        "id": str(a.id), "channel": a.channel, "provider": a.provider,
        "display_name": a.display_name, "sender_id": a.sender_id,
        "is_default": a.is_default, "is_active": a.is_active,
        "status": a.status, "last_error": a.last_error, "config": a.config or {},
        "has_token": bool(a.secret_token), "has_extra": bool(a.secret_extra),
    }


async def _require_admin(s, user) -> None:
    if not can(await load_grants(s, user), "config", "manage"):
        raise HTTPException(403, "Not allowed to manage messaging channels")


async def _get(s, user, account_id: uuid.UUID) -> TenantChannelAccount:
    a = (await s.execute(
        select(TenantChannelAccount).where(
            TenantChannelAccount.id == account_id,
            TenantChannelAccount.tenant_id == user.tenant_id,
            TenantChannelAccount.deletion_state == "ACTIVE",
        )
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(404, "Channel account not found")
    return a


@router.get("/accounts")
async def list_accounts(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    rows = (await s.execute(
        select(TenantChannelAccount).where(
            TenantChannelAccount.tenant_id == user.tenant_id,
            TenantChannelAccount.deletion_state == "ACTIVE",
        ).order_by(TenantChannelAccount.channel, TenantChannelAccount.created_at)
    )).scalars().all()
    return [_ser(a) for a in rows]


@router.post("/accounts", status_code=201)
async def create_account(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_admin(s, user)
    channel = (payload.get("channel") or "").upper()
    if channel not in _CHANNELS:
        raise HTTPException(422, "channel must be SMS|TELEGRAM|WHATSAPP")
    if not (payload.get("display_name") or "").strip():
        raise HTTPException(422, "'display_name' is required")
    acc = TenantChannelAccount(
        tenant_id=user.tenant_id, owner_user_id=None,
        channel=channel, provider=(payload.get("provider") or _PROVIDERS[channel]),
        display_name=payload["display_name"].strip(), sender_id=(payload.get("sender_id") or None),
        secret_token=(payload.get("secret_token") or None),
        secret_extra=(payload.get("secret_extra") or None),
        config=(payload.get("config") or None),
        is_default=bool(payload.get("is_default", True)),
        is_active=bool(payload.get("is_active", True)),
        created_by=user.id,
    )
    s.add(acc)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "CHANNEL_ACCOUNT_CREATED", "tenant_channel_account", acc.id, user.id,
                        {"channel": channel, "provider": acc.provider})
    await s.commit()
    acc = (await s.execute(select(TenantChannelAccount).where(TenantChannelAccount.id == acc.id))).scalar_one()
    return _ser(acc)


@router.patch("/accounts/{account_id}")
async def update_account(account_id: uuid.UUID, payload: dict,
                         user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_admin(s, user)
    acc = await _get(s, user, account_id)
    if "display_name" in payload and payload["display_name"]:
        acc.display_name = str(payload["display_name"]).strip()
    if "sender_id" in payload:
        acc.sender_id = payload["sender_id"] or None
    if "config" in payload:
        acc.config = payload["config"] or None
    for f in ("is_default", "is_active"):
        if f in payload:
            setattr(acc, f, bool(payload[f]))
    # write-only secrets — only overwrite when a non-empty value supplied
    if payload.get("secret_token"):
        acc.secret_token = payload["secret_token"]
    if payload.get("secret_extra"):
        acc.secret_extra = payload["secret_extra"]
    await workflow.emit(s, user.tenant_id, "CHANNEL_ACCOUNT_UPDATED", "tenant_channel_account", acc.id, user.id,
                        {"channel": acc.channel})
    await s.commit()
    acc = (await s.execute(select(TenantChannelAccount).where(TenantChannelAccount.id == acc.id))).scalar_one()
    return _ser(acc)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_admin(s, user)
    acc = await _get(s, user, account_id)
    acc.deletion_state = "SOFT_DELETED"
    await workflow.emit(s, user.tenant_id, "CHANNEL_ACCOUNT_DELETED", "tenant_channel_account", acc.id, user.id, {})
    await s.commit()
    return None


@router.post("/accounts/{account_id}/test")
async def test_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Validate a channel account's credentials. Telegram → Bot API getMe; SMS/WhatsApp stubs report
    not-yet-configured. Updates status."""
    acc = await _get(s, user, account_id)
    ok, detail = False, None
    try:
        if acc.channel == "TELEGRAM":
            if not acc.secret_token:
                raise MessagingNotConfigured("no bot token set")
            from ..utils.http_client import get_async_client
            async with get_async_client(timeout=15) as client:
                r = await client.get(f"https://api.telegram.org/bot{acc.secret_token}/getMe")
            ok = r.status_code < 300 and (r.json().get("ok") is True)
            detail = None if ok else f"Telegram getMe: HTTP {r.status_code}"
        else:
            raise MessagingNotConfigured(f"{acc.channel} gateway is a stub pending provider credentials")
    except MessagingNotConfigured as e:
        ok, detail = False, str(e)
    except Exception as e:
        ok, detail = False, str(e)[:300]
    acc.status = "CONNECTED" if ok else ("CONN_ERROR" if acc.channel == "TELEGRAM" else "PENDING")
    acc.last_error = detail
    await s.commit()
    return {"ok": ok, "status": acc.status, "detail": detail}


@router.post("/send")
async def send(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Send a message on a channel (SMS/TELEGRAM/WHATSAPP) via the tenant's own configured account.
    Routes through channels.dispatch (records OutboundMessage + per-tenant gateway). 502 on send failure."""
    channel = (payload.get("channel") or "").lower()
    to = (payload.get("to") or "").strip()
    body = payload.get("text") or payload.get("body") or ""
    if channel not in ("sms", "telegram", "whatsapp"):
        raise HTTPException(422, "channel must be sms|telegram|whatsapp")
    if not to:
        raise HTTPException(422, "'to' is required")
    if await _tenant_has(s, user.tenant_id, channel) is False:
        raise HTTPException(422, f"no {channel} channel account configured for this tenant")
    msg = await channels.dispatch(s, tenant_id=user.tenant_id, channel=channel, to=to,
                                  subject=payload.get("subject"), body=body, user_id=user.id)
    await s.commit()
    if msg is not None and msg.status == "FAILED":
        raise HTTPException(502, f"{channel} send failed: {msg.error}")
    return {"status": (msg.status if msg else "SENT"), "channel": channel, "to": to}


async def _tenant_has(s, tenant_id, channel: str) -> bool:
    return (await s.execute(
        select(TenantChannelAccount.id).where(
            TenantChannelAccount.tenant_id == tenant_id,
            TenantChannelAccount.channel == channel.upper(),
            TenantChannelAccount.is_active.is_(True),
            TenantChannelAccount.deletion_state == "ACTIVE",
        ).limit(1)
    )).first() is not None
