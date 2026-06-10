"""Mail module router — /api/mail/* (MAILBOX-MODULE-PLAN.md, Phase A).

First-class module router (like webhooks/billing) — NOT a slug-branch in records.py. Tenant
isolation is enforced by RLS (every query runs under the request's gaahex.tenant_id GUC); per-user
mailbox ownership is an additional service-layer filter. Account management is gated by config.manage
(super_admin); the granular mail.* permission keys are registered in file 15 for a later split.

Phase A surface: accounts CRUD, /test (SMTP connectivity), and message send via the account's own
SMTP server. Inbound folders/messages + IMAP sync land in Phase B.
"""
import base64
import uuid
from email.utils import getaddresses, parseaddr

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import MailAccount, MailFolder, MailMessage, MailAttachment, OutboundMessage, User
from ..access import load_grants, can
from .. import workflow
from .auth import current_user
from ..services.comms.smtp_email import gateway_for_account
from ..services.comms.email import Attachment as EmailAttachment
from ..services.comms.exceptions import EmailGatewayConfigError, EmailGatewayCommandError
from ..services.mail_sync import set_message_flag, sync_account
from ..services.storage.factory import get_storage_backend
from ..services.storage.backend import StorageError


def _addrs(raw: str | None) -> list[dict]:
    """Parse a header string ('A <a@x>, b@y') into [{name, email}] (frontend MailAddress[])."""
    if not raw:
        return []
    out = []
    for name, email in getaddresses([raw]):
        if email:
            out.append({"name": name or None, "email": email})
    return out


def _to_header(addrs) -> str:
    """[{name,email}] | 'a@x' → an RFC To-header string for SMTP."""
    if isinstance(addrs, str):
        return addrs
    parts = []
    for a in addrs or []:
        if isinstance(a, str):
            parts.append(a)
        elif a.get("email"):
            parts.append(f'{a["name"]} <{a["email"]}>' if a.get("name") else a["email"])
    return ", ".join(parts)

router = APIRouter(prefix="/api/mail", tags=["mail"])

_SECURITY = {"SSL", "STARTTLS", "NONE"}
_AUTH = {"PASSWORD", "OAUTH2"}


def _serialize(a: MailAccount) -> dict:
    """Account view — NEVER returns secrets; password presence is a boolean only."""
    return {
        "id": str(a.id),
        "owner_user_id": str(a.owner_user_id) if a.owner_user_id else None,
        "display_name": a.display_name,
        "email_address": a.email_address,
        "imap_host": a.imap_host, "imap_port": a.imap_port, "imap_security": a.imap_security,
        "smtp_host": a.smtp_host, "smtp_port": a.smtp_port, "smtp_security": a.smtp_security,
        "auth_type": a.auth_type, "auth_username": a.auth_username,
        "is_system_sender": a.is_system_sender, "is_default": a.is_default,
        "sync_enabled": a.sync_enabled, "status": a.status, "last_error": a.last_error,
        "last_sync_at": a.last_sync_at.isoformat() if a.last_sync_at else None,
        "has_password": bool(a.secret_password),
    }


def _visible(q, user: User, grants):
    """Restrict to accounts the caller may see: own + shared (owner NULL); config.manage sees all in tenant."""
    if not can(grants, "config", "manage"):
        q = q.where((MailAccount.owner_user_id == user.id) | (MailAccount.owner_user_id.is_(None)))
    return q


async def _get_visible(s, user, grants, account_id: uuid.UUID) -> MailAccount:
    q = _visible(
        select(MailAccount).where(
            MailAccount.id == account_id,
            MailAccount.tenant_id == user.tenant_id,
            MailAccount.deletion_state == "ACTIVE",
        ),
        user, grants,
    )
    acc = (await s.execute(q)).scalar_one_or_none()
    if not acc:
        raise HTTPException(404, "Mail account not found")   # RLS + ownership → 404, never leak existence
    return acc


# ─── accounts ────────────────────────────────────────────────────────────────

@router.get("/accounts")
async def list_accounts(user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    q = _visible(
        select(MailAccount).where(
            MailAccount.tenant_id == user.tenant_id, MailAccount.deletion_state == "ACTIVE",
        ).order_by(MailAccount.created_at),
        user, grants,
    )
    return [_serialize(a) for a in (await s.execute(q)).scalars().all()]


@router.get("/accounts/{account_id}")
async def get_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    return _serialize(await _get_visible(s, user, grants, account_id))


@router.post("/accounts", status_code=201)
async def create_account(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage mail accounts")

    required = ("display_name", "email_address", "imap_host", "smtp_host")
    for f in required:
        if not (payload.get(f) or "").strip():
            raise HTTPException(422, f"'{f}' is required")
    if (payload.get("imap_security") or "SSL").upper() not in _SECURITY:
        raise HTTPException(422, "imap_security must be SSL|STARTTLS|NONE")
    if (payload.get("smtp_security") or "SSL").upper() not in _SECURITY:
        raise HTTPException(422, "smtp_security must be SSL|STARTTLS|NONE")
    if (payload.get("auth_type") or "PASSWORD").upper() not in _AUTH:
        raise HTTPException(422, "auth_type must be PASSWORD|OAUTH2")

    is_system = bool(payload.get("is_system_sender"))
    # owner: a shared/system account has owner_user_id NULL; a personal one defaults to the caller.
    owner_user_id = None if (is_system or payload.get("shared")) else user.id

    acc = MailAccount(
        tenant_id=user.tenant_id,
        owner_user_id=owner_user_id,
        owner_node_id=getattr(user, "primary_node_id", None),
        display_name=payload["display_name"].strip(),
        email_address=payload["email_address"].strip(),
        imap_host=payload["imap_host"].strip(),
        imap_port=int(payload.get("imap_port") or 993),
        imap_security=(payload.get("imap_security") or "SSL").upper(),
        smtp_host=payload["smtp_host"].strip(),
        smtp_port=int(payload.get("smtp_port") or 465),
        smtp_security=(payload.get("smtp_security") or "SSL").upper(),
        auth_type=(payload.get("auth_type") or "PASSWORD").upper(),
        auth_username=(payload.get("auth_username") or None),
        # frontend sends `secret_password`; `password` accepted for back-compat. EncryptedString encrypts on write.
        secret_password=(payload.get("secret_password") or payload.get("password") or None),
        is_system_sender=is_system,
        is_default=bool(payload.get("is_default")),
        sync_enabled=bool(payload.get("sync_enabled", True)),
        created_by=user.id,
    )
    s.add(acc)
    await s.flush()
    await workflow.emit(s, user.tenant_id, "MAIL_ACCOUNT_CREATED", "mail_account", acc.id, user.id,
                        {"email_address": acc.email_address, "is_system_sender": is_system})
    await s.commit()
    acc = (await s.execute(select(MailAccount).where(MailAccount.id == acc.id))).scalar_one()
    return _serialize(acc)


@router.patch("/accounts/{account_id}")
async def update_account(account_id: uuid.UUID, payload: dict,
                         user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Edit an account. `secret_password` is write-only — sent ONLY when the operator typed a new
    value; omitting it keeps the stored credential. `is_default` flips the per-user default."""
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage mail accounts")
    acc = await _get_visible(s, user, grants, account_id)

    str_fields = ("display_name", "email_address", "imap_host", "smtp_host", "auth_username")
    for f in str_fields:
        if f in payload and payload[f] is not None:
            setattr(acc, f, str(payload[f]).strip())
    for f in ("imap_port", "smtp_port"):
        if payload.get(f) is not None:
            setattr(acc, f, int(payload[f]))
    for f in ("imap_security", "smtp_security"):
        if payload.get(f):
            if str(payload[f]).upper() not in _SECURITY:
                raise HTTPException(422, f"{f} must be SSL|STARTTLS|NONE")
            setattr(acc, f, str(payload[f]).upper())
    if payload.get("auth_type"):
        if str(payload["auth_type"]).upper() not in _AUTH:
            raise HTTPException(422, "auth_type must be PASSWORD|OAUTH2")
        acc.auth_type = str(payload["auth_type"]).upper()
    for f in ("is_system_sender", "is_default", "sync_enabled"):
        if f in payload:
            setattr(acc, f, bool(payload[f]))
    # write-only secret: only overwrite when a non-empty value was supplied
    if payload.get("secret_password"):
        acc.secret_password = payload["secret_password"]

    await workflow.emit(s, user.tenant_id, "MAIL_ACCOUNT_UPDATED", "mail_account", acc.id, user.id,
                        {"email_address": acc.email_address})
    await s.commit()
    acc = (await s.execute(select(MailAccount).where(MailAccount.id == acc.id))).scalar_one()
    return _serialize(acc)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Not allowed to manage mail accounts")
    acc = await _get_visible(s, user, grants, account_id)
    acc.deletion_state = "SOFT_DELETED"
    await workflow.emit(s, user.tenant_id, "MAIL_ACCOUNT_DELETED", "mail_account", acc.id, user.id, {})
    await s.commit()
    return None


@router.post("/accounts/{account_id}/test")
async def test_account(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Probe SMTP + IMAP reachability. Returns {imap_ok, smtp_ok, detail} and updates account status."""
    grants = await load_grants(s, user)
    acc = await _get_visible(s, user, grants, account_id)
    detail_parts = []

    # SMTP probe
    smtp_ok = False
    try:
        import aiosmtplib
        smtp = aiosmtplib.SMTP(hostname=acc.smtp_host, port=acc.smtp_port,
                               use_tls=(acc.smtp_security == "SSL"), start_tls=(acc.smtp_security == "STARTTLS"))
        await smtp.connect()
        if acc.auth_username or acc.secret_password:
            await smtp.login(acc.auth_username or acc.email_address, acc.secret_password or "")
        await smtp.quit()
        smtp_ok = True
    except Exception as e:
        detail_parts.append(f"SMTP: {str(e)[:200]}")

    # IMAP probe
    imap_ok = False
    try:
        import aioimaplib
        client = aioimaplib.IMAP4_SSL(host=acc.imap_host, port=acc.imap_port)
        await client.wait_hello_from_server()
        await client.login(acc.auth_username or acc.email_address, acc.secret_password or "")
        await client.logout()
        imap_ok = True
    except Exception as e:
        detail_parts.append(f"IMAP: {str(e)[:200]}")

    detail = "; ".join(detail_parts) or None
    acc.status = "CONNECTED" if (smtp_ok and imap_ok) else ("AUTH_ERROR" if (smtp_ok or imap_ok) else "CONN_ERROR")
    acc.last_error = detail
    await s.commit()
    return {"imap_ok": imap_ok, "smtp_ok": smtp_ok, "detail": detail}


# ─── folders / messages / attachments (inbound — Phase B) ─────────────────────

def _msg_view(m: MailMessage, *, full: bool = False) -> dict:
    fname, faddr = parseaddr(m.from_addr or "")
    iso = m.date.isoformat() if m.date else None
    base = {
        "id": str(m.id), "account_id": str(m.account_id), "folder_id": str(m.folder_id),
        "thread_id": m.thread_id, "message_id": m.message_id,
        "from_addr": (faddr or m.from_addr), "from_name": (fname or None),
        "to_addrs": _addrs(m.to_addrs),
        "subject": m.subject, "snippet": m.snippet, "direction": m.direction,
        "flag_seen": m.seen, "flag_flagged": m.flagged, "flag_answered": m.answered,
        "has_attachments": m.has_attachments, "size_bytes": m.size_bytes,
        "sent_at": iso if m.direction == "OUTBOUND" else None,
        "received_at": iso if m.direction == "INBOUND" else None,
        "send_status": None,
    }
    if full:
        base.update({
            "cc_addrs": _addrs(m.cc_addrs), "bcc_addrs": _addrs(m.bcc_addrs), "reply_to_addrs": [],
            "in_reply_to": m.in_reply_to, "references_raw": m.references_header,
            "body_text": m.body_text, "body_html": m.body_html, "send_error": None,
        })
    return base


def _att_view(a: MailAttachment) -> dict:
    return {
        "id": str(a.id), "message_id": str(a.message_id), "filename": a.filename,
        "content_type": a.content_type, "size_bytes": a.size_bytes,
        "is_inline": a.is_inline, "content_id": a.content_id, "download_state": "STORED",
    }


async def _get_message(s, user, grants, message_id: uuid.UUID) -> MailMessage:
    m = (await s.execute(
        select(MailMessage).where(MailMessage.id == message_id, MailMessage.tenant_id == user.tenant_id)
    )).scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Message not found")
    await _get_visible(s, user, grants, m.account_id)   # ownership gate on the owning account → 404 if not
    return m


@router.get("/accounts/{account_id}/folders")
async def list_folders(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    await _get_visible(s, user, grants, account_id)
    folders = (await s.execute(
        select(MailFolder).where(MailFolder.tenant_id == user.tenant_id, MailFolder.account_id == account_id)
        .order_by(MailFolder.display_name)
    )).scalars().all()
    return [{"id": str(f.id), "account_id": str(f.account_id), "imap_path": f.imap_path,
             "display_name": f.display_name, "role": f.role,
             "unseen_count": f.unread_count, "total_count": f.total_count,
             "last_sync_at": f.last_synced_at.isoformat() if f.last_synced_at else None} for f in folders]


@router.get("/messages")
async def list_messages(account_id: uuid.UUID, folder_id: uuid.UUID | None = None,
                        unseen: bool = False, limit: int = 50, offset: int = 0,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """List a folder's (or the whole account's) messages — newest first. account_id is required and
    gated by ownership; folder_id narrows to one folder."""
    grants = await load_grants(s, user)
    await _get_visible(s, user, grants, account_id)
    q = select(MailMessage).where(
        MailMessage.tenant_id == user.tenant_id, MailMessage.account_id == account_id,
    )
    if folder_id is not None:
        q = q.where(MailMessage.folder_id == folder_id)
    if unseen:
        q = q.where(MailMessage.seen.is_(False))
    q = q.order_by(MailMessage.date.desc().nullslast()).limit(min(max(limit, 1), 200)).offset(max(offset, 0))
    rows = (await s.execute(q)).scalars().all()
    return [_msg_view(m) for m in rows]


@router.get("/messages/{message_id}")
async def get_message(message_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    m = await _get_message(s, user, grants, message_id)
    atts = (await s.execute(
        select(MailAttachment).where(MailAttachment.tenant_id == user.tenant_id, MailAttachment.message_id == m.id)
    )).scalars().all()
    # opening a message marks it seen (frontend contract: getMessage marks seen server-side)
    if not m.seen:
        m.seen = True
        await s.commit()
    out = _msg_view(m, full=True)
    out["attachments"] = [_att_view(a) for a in atts]
    return out


@router.delete("/messages/{message_id}", status_code=204)
async def delete_message(message_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Delete a message (its attachment rows cascade; stored bytes are best-effort removed)."""
    grants = await load_grants(s, user)
    m = await _get_message(s, user, grants, message_id)
    atts = (await s.execute(
        select(MailAttachment).where(MailAttachment.tenant_id == user.tenant_id, MailAttachment.message_id == m.id)
    )).scalars().all()
    backend = get_storage_backend()
    for a in atts:
        try:
            await backend.delete(storage_key=a.storage_key)
        except Exception:
            pass   # best-effort; orphaned blob is benign
    await s.delete(m)
    await workflow.emit(s, user.tenant_id, "MAIL_MESSAGE_DELETED", "mail_message", message_id, user.id, {})
    await s.commit()
    return None


@router.patch("/messages/{message_id}")
async def patch_message(message_id: uuid.UUID, payload: dict,
                        user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Set flags (seen/flagged/answered). The local change is the source for the next IMAP push."""
    grants = await load_grants(s, user)
    m = await _get_message(s, user, grants, message_id)
    for flag in ("seen", "flagged", "answered"):
        if flag in payload:
            await set_message_flag(s, m, flag=flag, value=bool(payload[flag]))
    await s.commit()
    return _msg_view(m, full=True)


@router.get("/messages/{message_id}/attachments/{attachment_id}")
async def download_attachment(message_id: uuid.UUID, attachment_id: uuid.UUID,
                             user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    grants = await load_grants(s, user)
    await _get_message(s, user, grants, message_id)   # ownership gate via the owning message/account
    att = (await s.execute(
        select(MailAttachment).where(
            MailAttachment.id == attachment_id, MailAttachment.tenant_id == user.tenant_id,
            MailAttachment.message_id == message_id,
        )
    )).scalar_one_or_none()
    if not att:
        raise HTTPException(404, "Attachment not found")
    try:
        data = await get_storage_backend().retrieve(storage_key=att.storage_key)
    except StorageError:
        raise HTTPException(404, "Attachment bytes not found")
    await workflow.emit(s, user.tenant_id, "MAIL_ATTACHMENT_DOWNLOADED", "mail_attachment", att.id, user.id,
                        {"filename": att.filename})
    await s.commit()
    return Response(content=data, media_type=att.content_type or "application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{att.filename}"'})


@router.post("/attachments")
async def upload_attachment(file: UploadFile = File(...),
                            user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Pre-upload a compose attachment. Stores the bytes in the StorageBackend (tenant-scoped key) and
    returns an opaque attachment_id (= storage_key) the send payload references — so a multi-MB file
    never bloats the JSON send body."""
    data = await file.read()
    att_id = uuid.uuid4()
    stored = await get_storage_backend().store(
        tenant_id=str(user.tenant_id), attachment_id=str(att_id),
        file_bytes=data, original_filename=file.filename or "attachment",
        mime_type=file.content_type or "application/octet-stream",
    )
    return {"attachment_id": stored.storage_key, "filename": file.filename or "attachment",
            "size_bytes": stored.size_bytes, "content_type": file.content_type or "application/octet-stream"}


@router.post("/accounts/{account_id}/sync")
async def trigger_sync(account_id: uuid.UUID, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Manually pull new mail for an account (the scheduler runs this automatically when enabled)."""
    grants = await load_grants(s, user)
    acc = await _get_visible(s, user, grants, account_id)
    ingested = await sync_account(s, acc)
    await s.commit()
    return {"queued": True, "detail": f"ingested {ingested}", "ingested": ingested,
            "status": acc.status, "last_error": acc.last_error}


# ─── send ────────────────────────────────────────────────────────────────────

@router.post("/messages/send")
async def send_message(payload: dict, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    """Send a message through the chosen account's OWN SMTP server. Records an OutboundMessage and
    emits a MAIL_SENT audit event. (Append-to-Sent over IMAP lands in Phase B.)"""
    grants = await load_grants(s, user)
    # `to` accepts MailAddress[] (frontend) OR a plain string (back-compat). Normalize to a header.
    to = _to_header(payload.get("to"))
    subject = payload.get("subject") or ""
    if not to.strip():
        raise HTTPException(422, "'to' is required")

    # Resolve the sending account: explicit account_id, else the tenant's system sender.
    account_id = payload.get("account_id")
    if account_id:
        acc = await _get_visible(s, user, grants, uuid.UUID(str(account_id)))
    else:
        acc = (await s.execute(
            select(MailAccount).where(
                MailAccount.tenant_id == user.tenant_id,
                MailAccount.is_system_sender.is_(True),
                MailAccount.deletion_state == "ACTIVE",
            )
        )).scalars().first()
        if not acc:
            raise HTTPException(422, "no account_id given and no system-sender account configured")

    # Pre-uploaded attachments: attachment_ids are opaque storage keys from POST /attachments.
    email_atts = []
    for key in (payload.get("attachment_ids") or []):
        # tenant fence: upload keys are `{tenant_id}/...` (StorageBackend convention) — reject any
        # key not under this tenant's prefix so a forged id can't read another tenant's blob.
        if not str(key).startswith(f"{user.tenant_id}/"):
            raise HTTPException(403, "attachment does not belong to this tenant")
        try:
            raw = await get_storage_backend().retrieve(storage_key=str(key))
        except StorageError:
            raise HTTPException(404, f"attachment {key} not found")
        email_atts.append(EmailAttachment(
            filename=str(key).rsplit("/", 1)[-1], content_b64=base64.b64encode(raw).decode(),
            mime_type="application/octet-stream",
        ))

    try:
        gw = gateway_for_account(acc)
        result = await gw.send(to=to, subject=subject, text=payload.get("text"), html=payload.get("html"),
                               attachments=email_atts or None)
        status, error, message_id = "SENT", None, result.message_id
    except (EmailGatewayConfigError, EmailGatewayCommandError) as e:
        status, error, message_id = "FAILED", str(e), ""

    s.add(OutboundMessage(
        tenant_id=user.tenant_id, channel="email", to_addr=to, subject=subject,
        body=(payload.get("text") or payload.get("html") or ""), status=status,
        user_id=user.id, error=error,
    ))
    await workflow.emit(s, user.tenant_id, "MAIL_SENT", "mail_account", acc.id, user.id,
                        {"to": to, "subject": subject, "status": status, "smtp_host": acc.smtp_host})
    await s.commit()
    if status == "FAILED":
        raise HTTPException(502, f"send failed: {error}")
    # MailSendResult: {message_id, status, detail}; smtp_host kept for KT-MAIL-3.
    return {"message_id": message_id, "status": status, "detail": None,
            "to": to, "smtp_host": acc.smtp_host}
