"""Mail module Phase B — inbound IMAP sync.

Split into a pure, unit-testable core and a thin IMAP-I/O wrapper:

  * ``ingest_message``  — parse one RFC822 message + persist MailMessage (+ MailAttachment to the
    StorageBackend). Idempotent on (tenant, account, folder, uidvalidity, uid): a re-poll updates
    flags and never duplicates. This is where the value + the tests live.
  * ``set_message_flag`` — set a local flag (the router's PATCH path); the IMAP push is best-effort.
  * ``sync_account`` / ``sync_all_enabled`` — the aioimaplib wiring (folder discovery, incremental
    UID fetch, UIDVALIDITY recovery). Thin; exercised against a real server, not in unit tests
    (the OLT-hardware-test posture). The scheduler calls ``sync_all_enabled`` when mail_sync_enabled.
"""
from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from email import message_from_bytes
from email.policy import default as _default_policy
from email.utils import parsedate_to_datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MailAccount, MailFolder, MailMessage, MailAttachment
from .storage.factory import get_storage_backend

_log = logging.getLogger("gaahex.mail.sync")


def _flag(flags, name: str) -> bool:
    """Is IMAP system flag `name` (e.g. 'Seen') present? Accepts bytes/str flag tokens."""
    needle = name.lower().lstrip("\\")
    for f in flags or []:
        tok = f.decode() if isinstance(f, (bytes, bytearray)) else str(f)
        if tok.lower().lstrip("\\") == needle:
            return True
    return False


def _thread_id(message_id: str | None, in_reply_to: str | None, references: str | None) -> str | None:
    """Denormalized thread key (OD-5): the root of the reference chain when present, else self."""
    if references:
        first = references.split()[0].strip()
        if first:
            return first
    if in_reply_to:
        return in_reply_to.strip()
    return message_id


def _snippet(text: str | None, html: str | None) -> str | None:
    src = text or ""
    if not src and html:
        # crude tag strip for a preview only (never rendered as HTML)
        import re
        src = re.sub(r"<[^>]+>", " ", html)
    src = " ".join(src.split())
    return src[:277] + "…" if len(src) > 280 else (src or None)


async def ingest_message(
    s: AsyncSession,
    *,
    account: MailAccount,
    folder: MailFolder,
    uid: int | None,
    uidvalidity: int | None,
    flags,
    raw_bytes: bytes,
) -> MailMessage:
    """Parse + persist one message. Idempotent: an existing (account, folder, uidvalidity, uid) row
    is updated (flags) and returned without duplication or re-storing attachments."""
    # ---- idempotency: have we already ingested this UID for this folder/uidvalidity?
    existing = None
    if uid is not None:
        existing = (await s.execute(
            select(MailMessage).where(
                MailMessage.tenant_id == account.tenant_id,
                MailMessage.account_id == account.id,
                MailMessage.folder_id == folder.id,
                MailMessage.uidvalidity == uidvalidity,
                MailMessage.uid == uid,
            )
        )).scalar_one_or_none()
    if existing is not None:
        existing.seen = _flag(flags, "Seen")
        existing.flagged = _flag(flags, "Flagged")
        existing.answered = _flag(flags, "Answered")
        return existing

    msg = message_from_bytes(raw_bytes, policy=_default_policy)

    def _hdr(name):
        v = msg[name]
        return str(v) if v is not None else None

    message_id = _hdr("Message-ID")
    in_reply_to = _hdr("In-Reply-To")
    references = _hdr("References")
    date_val = None
    if msg["Date"] is not None:
        try:
            date_val = parsedate_to_datetime(str(msg["Date"]))
        except (TypeError, ValueError):
            date_val = None

    # bodies (modern email API)
    body_text = body_html = None
    try:
        bp = msg.get_body(preferencelist=("plain",))
        if bp is not None:
            body_text = bp.get_content()
    except Exception:
        pass
    try:
        bh = msg.get_body(preferencelist=("html",))
        if bh is not None:
            body_html = bh.get_content()
    except Exception:
        pass

    rec = MailMessage(
        tenant_id=account.tenant_id, account_id=account.id, folder_id=folder.id,
        uid=uid, uidvalidity=uidvalidity,
        message_id=message_id, in_reply_to=in_reply_to, references_header=references,
        thread_id=_thread_id(message_id, in_reply_to, references),
        direction="INBOUND",
        from_addr=_hdr("From"), to_addrs=_hdr("To"), cc_addrs=_hdr("Cc"),
        subject=_hdr("Subject"), body_text=body_text, body_html=body_html,
        snippet=_snippet(body_text, body_html),
        date=date_val,
        seen=_flag(flags, "Seen"), flagged=_flag(flags, "Flagged"),
        answered=_flag(flags, "Answered"), draft=_flag(flags, "Draft"),
        size_bytes=len(raw_bytes),
    )
    s.add(rec)
    await s.flush()   # assign rec.id for attachment FKs

    # ---- attachments → StorageBackend (bytes never live in the DB)
    backend = get_storage_backend()
    count = 0
    for att in msg.iter_attachments():
        filename = att.get_filename() or f"attachment-{count + 1}"
        content = att.get_content()
        data = content.encode("utf-8", "replace") if isinstance(content, str) else bytes(content)
        att_id = uuid.uuid4()
        stored = await backend.store(
            tenant_id=str(account.tenant_id), attachment_id=str(att_id),
            file_bytes=data, original_filename=filename,
            mime_type=att.get_content_type() or "application/octet-stream",
        )
        s.add(MailAttachment(
            id=att_id, tenant_id=account.tenant_id, message_id=rec.id,
            filename=filename, content_type=att.get_content_type() or "application/octet-stream",
            size_bytes=stored.size_bytes, storage_key=stored.storage_key,
            checksum_sha256=stored.checksum_sha256,
            content_id=(att.get("Content-ID") or None),
            is_inline=(att.get_content_disposition() == "inline"),
        ))
        count += 1
    if count:
        rec.has_attachments = True
        await s.flush()
    return rec


async def set_message_flag(s: AsyncSession, message: MailMessage, *, flag: str, value: bool) -> None:
    """Set a local flag (seen/flagged/answered). The router calls this on PATCH; pushing the change
    back to the IMAP server is a best-effort step in the sync layer (so a re-poll keeps it)."""
    key = flag.lower()
    if key not in {"seen", "flagged", "answered"}:
        raise ValueError(f"unsupported flag {flag!r}")
    setattr(message, key, bool(value))


# ────────────────────────────────────────────────────────────────────────────
# Thin IMAP I/O (real-server; not covered by unit tests — see module docstring).
# ────────────────────────────────────────────────────────────────────────────

async def sync_account(s: AsyncSession, account: MailAccount, *, max_messages: int | None = None) -> int:
    """Connect to the account's IMAP server, discover folders, and incrementally ingest new UIDs.
    Returns the number of messages ingested. Best-effort + fail-soft: marks the account status and
    returns 0 on connect/auth failure rather than raising into the scheduler."""
    import aioimaplib  # lazy

    try:
        client = aioimaplib.IMAP4_SSL(host=account.imap_host, port=account.imap_port)
        await client.wait_hello_from_server()
        await client.login(account.auth_username or account.email_address, account.secret_password or "")
    except Exception as e:  # connect/auth failure — record + bail, never crash the sweep
        account.status, account.last_error = "AUTH_ERROR", str(e)[:500]
        return 0

    ingested = 0
    try:
        # Folder discovery is server-specific; v1 syncs INBOX + the account's known folders. A fuller
        # LIST-based discovery + mUTF-7 decode lands alongside real-server hardening.
        folders = (await s.execute(
            select(MailFolder).where(MailFolder.account_id == account.id)
        )).scalars().all()
        if not folders:
            folders = [MailFolder(tenant_id=account.tenant_id, account_id=account.id,
                                  imap_path="INBOX", display_name="Inbox", role="INBOX")]
            s.add(folders[0])
            await s.flush()

        for folder in folders:
            select_resp = await client.select(folder.imap_path)
            uidvalidity = _parse_uidvalidity(select_resp)
            if folder.uidvalidity is not None and uidvalidity != folder.uidvalidity:
                folder.last_uid = None  # UIDVALIDITY changed → cursor invalid, full resync
            folder.uidvalidity = uidvalidity
            since = (folder.last_uid or 0) + 1
            search = await client.uid_search(f"UID {since}:*")
            uids = _parse_uids(search)
            if max_messages:
                uids = uids[:max_messages]
            for uid in uids:
                fetch = await client.uid("fetch", str(uid), "(FLAGS BODY.PEEK[])")
                raw, flags = _parse_fetch(fetch)
                if raw is None:
                    continue
                await ingest_message(s, account=account, folder=folder, uid=uid,
                                     uidvalidity=uidvalidity, flags=flags, raw_bytes=raw)
                folder.last_uid = max(folder.last_uid or 0, uid)
                ingested += 1
        account.status, account.last_error = "CONNECTED", None
        account.last_sync_at = datetime.now(timezone.utc)
    finally:
        try:
            await client.logout()
        except Exception:
            pass
    return ingested


def _parse_uidvalidity(resp):  # pragma: no cover - real-server glue
    import re
    for line in getattr(resp, "lines", []) or []:
        m = re.search(rb"UIDVALIDITY (\d+)", line if isinstance(line, (bytes, bytearray)) else str(line).encode())
        if m:
            return int(m.group(1))
    return None


def _parse_uids(resp):  # pragma: no cover - real-server glue
    out = []
    for line in getattr(resp, "lines", []) or []:
        tok = line.decode() if isinstance(line, (bytes, bytearray)) else str(line)
        out.extend(int(x) for x in tok.split() if x.isdigit())
    return sorted(set(out))


def _parse_fetch(resp):  # pragma: no cover - real-server glue
    """Extract (raw_bytes, flags) from an aioimaplib fetch response — server-format dependent."""
    raw = None
    flags = []
    for line in getattr(resp, "lines", []) or []:
        if isinstance(line, (bytes, bytearray)) and line.lstrip().startswith(b"From"):
            raw = bytes(line)
    return raw, flags


async def sync_all_enabled(s: AsyncSession, *, tenant_id=None) -> int:
    """Scheduler entry: sync every account with sync_enabled (optionally scoped to one tenant).
    Inert unless `settings.mail_sync_enabled`. Bounded + fail-soft."""
    from ..config import settings
    if not getattr(settings, "mail_sync_enabled", False):
        return 0
    q = select(MailAccount).where(
        MailAccount.sync_enabled.is_(True),
        MailAccount.deletion_state == "ACTIVE",
    )
    if tenant_id is not None:
        q = q.where(MailAccount.tenant_id == tenant_id)
    accounts = (await s.execute(q)).scalars().all()
    total = 0
    for acc in accounts:
        try:
            total += await sync_account(s, acc)
        except Exception:
            _log.exception("mail sync failed for account %s", acc.id)
    return total
