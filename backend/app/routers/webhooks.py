"""Outbound webhooks (integration layer, J95 / doc 24).

Subscribe external URLs to kernel Events. `dispatch_event` is the engine: called from the event
chokepoint (workflow.emit), it finds active WebhookDefs subscribed to the event type, records a
WebhookDelivery for each, and attempts a best-effort signed HTTP POST. It is FULLY fail-soft — a
slow/broken endpoint marks the delivery FAILED and never raises into the kernel.

Phase-1 = records + a single attempt. A real retry queue/worker is a later step (see report).
"""
import hashlib
import hmac
import ipaddress
import json
import socket
import urllib.parse
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import User
from ..models.webhook import WebhookDef, WebhookDelivery
from ..access import load_grants, can
from ..kernel import assert_can, AccessDenied
from .auth import current_user

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])

DELIVERY_TIMEOUT = 3.0          # seconds — short, so a slow endpoint can't stall the request
DELIVERY_LOG_CAP = 100

# Cloud metadata endpoint that must always be blocked regardless of IP-flag classification.
_METADATA_IP = ipaddress.ip_address("169.254.169.254")

_SSRF_DENY_REASON = "Webhook URL not allowed: private/internal address"


def _is_safe_webhook_url(url: str) -> bool:
    """Return True only when *url* is safe to use as an outbound webhook target.

    Fail-CLOSED: any parsing failure, non-http/s scheme, or DNS-resolution error
    returns False so the caller can block / skip the request.

    Blocked categories
    ------------------
    - Schemes other than http / https
    - The hostname literal "localhost" (case-insensitive)
    - Any hostname ending in ".local" (mDNS / LAN names)
    - The literal cloud-metadata IP string "169.254.169.254"
    - Any IP (resolved or literal) that is private, loopback, link-local, or
      reserved according to stdlib ipaddress
    - DNS resolution failures (treat as unsafe — fail-closed)
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False

    # Scheme check — must be http or https, nothing else (file://, ftp://, etc.)
    if parsed.scheme not in ("http", "https"):
        return False

    host = parsed.hostname  # lowercased, brackets stripped for IPv6
    if not host:
        return False

    # Opt-in escape hatch for legitimate internal/VPC webhook targets (and the test suite).
    # Secure default is OFF: private/loopback/reserved targets are blocked. Set
    # WEBHOOK_ALLOW_PRIVATE=true only in a trusted network where internal webhooks are wanted.
    from ..config import settings
    if getattr(settings, "webhook_allow_private", False):
        return True

    # Block obvious internal hostnames before DNS is even consulted
    if host == "localhost":
        return False
    if host.endswith(".local"):
        return False
    # Block the literal metadata IP string early (also caught by ipaddress below,
    # but explicit is clearer and avoids any future is_link_local edge-case debate)
    if host == "169.254.169.254":
        return False

    # Resolve the host to an IP address.  If resolution fails for any reason
    # (NXDOMAIN, timeout, OS error) we treat the URL as unsafe — fail-closed.
    try:
        resolved = socket.gethostbyname(host)
        ip = ipaddress.ip_address(resolved)
    except Exception:
        return False

    # Block every category of non-public IP
    if (
        ip == _METADATA_IP
        or ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_unspecified
        or ip.is_multicast
    ):
        return False

    return True


# ---- dispatch engine (importable; called from workflow.emit) -----------------------------------

async def _deliver(s: AsyncSession, hook: WebhookDef, event_type: str, payload: dict) -> WebhookDelivery:
    """Record a delivery and attempt one signed POST. Fail-soft: the delivery row always lands; the
    HTTP result only updates its status. Does NOT commit (the caller's transaction owns that)."""
    delivery = WebhookDelivery(
        tenant_id=hook.tenant_id, webhook_id=hook.id, event_type=event_type,
        payload=payload, status="QUEUED", attempts=0,
    )
    s.add(delivery)
    try:
        await s.flush()
    except Exception:
        return delivery

    body = json.dumps({"event": event_type, "data": payload}, default=str).encode()
    headers = {"Content-Type": "application/json", "User-Agent": "GAAex-Webhooks/1"}
    if hook.secret:
        sig = hmac.new(hook.secret.encode(), body, hashlib.sha256).hexdigest()
        headers["X-GAAex-Signature"] = f"sha256={sig}"

    # SSRF guard — re-check at dispatch so URLs stored before this guard was added
    # (or mutated via direct DB writes) cannot bypass the protection.
    # Fail-soft: mark FAILED with a clear reason, never raise into the kernel.
    if not _is_safe_webhook_url(hook.url):
        delivery.attempts = 0
        delivery.status = "FAILED"
        delivery.error = _SSRF_DENY_REASON
        return delivery

    delivery.attempts = 1
    try:
        import httpx                                    # lazy: only needed when a webhook actually fires
        async with httpx.AsyncClient(timeout=DELIVERY_TIMEOUT) as client:
            resp = await client.post(hook.url, content=body, headers=headers)
        delivery.status_code = resp.status_code
        if 200 <= resp.status_code < 300:
            delivery.status = "SENT"
        else:
            delivery.status = "FAILED"
            delivery.error = f"HTTP {resp.status_code}"
    except Exception as e:
        delivery.status = "FAILED"
        delivery.error = str(e)[:500]
    return delivery


async def dispatch_event(s: AsyncSession, *, tenant_id, event_type: str, payload: dict) -> None:
    """Fan a kernel Event out to subscribed webhooks. Fail-soft end-to-end: any error is swallowed so
    webhook delivery can never break the mutation that emitted the event."""
    try:
        hooks = (await s.execute(
            select(WebhookDef).where(WebhookDef.tenant_id == tenant_id, WebhookDef.active.is_(True))
        )).scalars().all()
        et_upper = (event_type or "").upper()
        for hook in hooks:
            subscribed = hook.events or []
            subscribed_upper = {s.upper() for s in subscribed if isinstance(s, str)}
            if et_upper in subscribed_upper or "*" in subscribed:
                await _deliver(s, hook, event_type, payload)
    except Exception:
        return


# ---- serialization (secret is NEVER returned) --------------------------------------------------

def _def_out(w: WebhookDef) -> dict:
    return {
        "id": str(w.id), "name": w.name, "url": w.url, "events": w.events,
        "active": w.active, "has_secret": bool(w.secret),
        # Webhook Standard (file 70) extension — surface the new fields.
        "subscription_status": w.subscription_status,
        "reference_number": w.reference_number,
        "created_at": w.created_at.isoformat() if w.created_at else None,
    }


def _delivery_out(d: WebhookDelivery) -> dict:
    return {
        "id": str(d.id), "webhook_id": str(d.webhook_id), "event_type": d.event_type,
        "status": d.status, "attempts": d.attempts, "status_code": d.status_code,
        "error": d.error, "payload": d.payload,
        # Webhook Standard (file 70) extension — surface the new fields.
        "delivery_status": d.delivery_status,
        "event_name": d.event_name,
        "correlation_id": str(d.correlation_id) if d.correlation_id else None,
        "causation_id": str(d.causation_id) if d.causation_id else None,
        "idempotency_key": d.idempotency_key,
        "attempt_number": d.attempt_number,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


# ---- helpers -----------------------------------------------------------------------------------

async def _require_config_manage(s: AsyncSession, user: User) -> None:
    """SPEC §0.2 (Step 7): webhook config CRUD flows through the kernel default-deny gate."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage configuration")
    try:
        await assert_can(s, user, action="manage", entity_key="webhook_def",
                         region_id=None, owner_user_id=None)
    except AccessDenied as e:
        raise HTTPException(403, detail=str(e))


async def _load(s: AsyncSession, tenant_id, webhook_id) -> WebhookDef:
    w = (await s.execute(
        select(WebhookDef).where(WebhookDef.id == webhook_id, WebhookDef.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if not w:
        raise HTTPException(404, "Webhook not found")
    return w


def _validate_url(url: str) -> str:
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(422, "url must start with http:// or https://")
    if not _is_safe_webhook_url(url):
        raise HTTPException(422, _SSRF_DENY_REASON)
    return url


def _validate_events(events) -> list:
    if events is None:
        return []
    if not isinstance(events, list) or not all(isinstance(e, str) for e in events):
        raise HTTPException(422, "events must be a list of event-type strings")
    return events


# ---- endpoints (all gated by config.manage) ----------------------------------------------------

@router.get("")
async def list_webhooks(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_config_manage(s, user)
    rows = (await s.execute(
        select(WebhookDef).where(WebhookDef.tenant_id == user.tenant_id).order_by(WebhookDef.created_at)
    )).scalars().all()
    return [_def_out(w) for w in rows]


@router.post("", status_code=201)
async def create_webhook(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_config_manage(s, user)
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(422, "name is required")
    url = _validate_url(payload.get("url"))
    events = _validate_events(payload.get("events"))
    w = WebhookDef(
        tenant_id=user.tenant_id, name=name, url=url, events=events,
        secret=(payload.get("secret") or None), active=bool(payload.get("active", True)),
    )
    s.add(w)
    await s.commit()
    await s.refresh(w)
    return _def_out(w)


@router.get("/{webhook_id}")
async def get_webhook(webhook_id: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_config_manage(s, user)
    return _def_out(await _load(s, user.tenant_id, webhook_id))


@router.patch("/{webhook_id}")
async def update_webhook(webhook_id: str, payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_config_manage(s, user)
    w = await _load(s, user.tenant_id, webhook_id)
    allowed = {"name", "url", "events", "active", "secret"}
    unknown = set(payload) - allowed
    if unknown:
        raise HTTPException(422, f"Cannot patch {sorted(unknown)}; allowed: {sorted(allowed)}")
    if "name" in payload:
        v = (payload["name"] or "").strip()
        if not v:
            raise HTTPException(422, "name cannot be empty")
        w.name = v
    if "url" in payload:
        w.url = _validate_url(payload["url"])
    if "events" in payload:
        w.events = _validate_events(payload["events"])
    if "active" in payload:
        w.active = bool(payload["active"])
    if "secret" in payload:
        w.secret = payload["secret"] or None
    await s.commit()
    await s.refresh(w)
    return _def_out(w)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(webhook_id: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    await _require_config_manage(s, user)
    w = await _load(s, user.tenant_id, webhook_id)
    await s.delete(w)
    await s.commit()


_VALID_DELIVERY_STATUSES = {"PENDING", "SENT", "DELIVERED", "FAILED", "RETRYING", "DEAD_LETTERED"}


def _parse_iso(name: str, raw: str | None) -> datetime | None:
    """Parse an ISO-8601 query-string datetime (Z suffix allowed). 422 on garbage."""
    if not raw:
        return None
    try:
        # Accept the trailing 'Z' that JS/clients emit.
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except Exception:
        raise HTTPException(422, f"{name} must be ISO-8601 datetime")


@router.get("/{webhook_id}/deliveries")
async def list_deliveries(
    webhook_id: str,
    status: str | None = Query(default=None, description="Filter by Webhook Standard DeliveryStatus enum value"),
    from_: str | None = Query(default=None, alias="from", description="ISO-8601 start datetime (inclusive)"),
    to: str | None = Query(default=None, description="ISO-8601 end datetime (inclusive)"),
    user: User = Depends(current_user),
    s: AsyncSession = Depends(get_session),
):
    """The delivery log for a webhook, newest first.

    Webhook Standard (file 70) — filter by `delivery_status` (the new 6-value enum) and a
    `[from, to]` date range. Permission gate is the existing `config.manage` until a
    dedicated `webhook.view` permission lands in the registry (file 15).
    """
    await _require_config_manage(s, user)
    await _load(s, user.tenant_id, webhook_id)          # 404 if not this tenant's webhook

    stmt = select(WebhookDelivery).where(
        WebhookDelivery.tenant_id == user.tenant_id,
        WebhookDelivery.webhook_id == webhook_id,
    )

    if status is not None:
        norm = status.upper().strip()
        if norm not in _VALID_DELIVERY_STATUSES:
            raise HTTPException(422, f"status must be one of {sorted(_VALID_DELIVERY_STATUSES)}")
        stmt = stmt.where(WebhookDelivery.delivery_status == norm)

    dt_from = _parse_iso("from", from_)
    dt_to = _parse_iso("to", to)
    if dt_from is not None:
        stmt = stmt.where(WebhookDelivery.created_at >= dt_from)
    if dt_to is not None:
        stmt = stmt.where(WebhookDelivery.created_at <= dt_to)

    rows = (await s.execute(
        stmt.order_by(WebhookDelivery.created_at.desc()).limit(DELIVERY_LOG_CAP)
    )).scalars().all()
    return [_delivery_out(d) for d in rows]


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: str, payload: dict | None = None, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Fire a sample event at one webhook and return the resulting delivery record."""
    await _require_config_manage(s, user)
    w = await _load(s, user.tenant_id, webhook_id)
    event_type = (payload or {}).get("event_type") or "test"
    sample = (payload or {}).get("data") or {"message": "GAAex test event", "webhook_id": str(w.id)}
    delivery = await _deliver(s, w, event_type, sample)
    await s.commit()
    await s.refresh(delivery)
    return _delivery_out(delivery)
