"""Mail module — SmtpEmailGateway: per-tenant outbound send via the tenant's OWN SMTP server.

Implements the existing `EmailGateway` Protocol (services/comms/email.py) so it slots into the same
seam as Mock/SendGrid. Built per-account from a `MailAccount` row — it dials THAT account's
`smtp_host`, never a global `settings.smtp_host`, so each ISP's mail leaves from its own server.

`aiosmtplib` is lazy-imported (the SendGrid-gateway precedent) so the module imports cleanly even
where the dep is absent; the factory falls back to mock on ImportError.
"""
from __future__ import annotations

from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from .email import Attachment, EmailSendResult
from .exceptions import EmailGatewayCommandError, EmailGatewayConfigError


class SmtpEmailGateway:
    """SMTP-backed email gateway bound to one tenant mailbox's connection parameters."""

    provider: str = "smtp"

    def __init__(
        self,
        *,
        host: str | None,
        port: int = 465,
        security: str = "SSL",          # SSL | STARTTLS | NONE
        username: str | None = None,
        password: str | None = None,
        from_email: str | None = None,
        from_name: str | None = None,
    ) -> None:
        if not host:
            raise EmailGatewayConfigError("mail account SMTP host is not configured")
        if not from_email or "@" not in from_email:
            raise EmailGatewayConfigError("mail account email_address missing or malformed")
        self._host = host
        self._port = int(port or 465)
        self._security = (security or "SSL").upper()
        self._username = username
        self._password = password
        self._from_email = from_email
        self._from_name = from_name

    async def send(
        self,
        *,
        to: str,
        subject: str,
        html: str | None = None,
        text: str | None = None,
        sender: str | None = None,
        sender_name: str | None = None,
        attachments: list[Attachment] | None = None,
        template_id: str | None = None,
        template_data: dict | None = None,
        idempotency_key: str | None = None,
        categories: list[str] | None = None,
    ) -> EmailSendResult:
        if template_id is not None:
            raise EmailGatewayCommandError("SMTP gateway does not support template_id sends")

        import base64
        import aiosmtplib  # lazy — factory falls back to mock on ImportError

        from_addr = sender or self._from_email
        msg = EmailMessage()
        msg["From"] = formataddr((sender_name or self._from_name or "", from_addr))
        msg["To"] = to
        msg["Subject"] = subject or ""
        message_id = make_msgid()
        msg["Message-ID"] = message_id

        # Body: text + optional HTML alternative (or HTML-only).
        if text is not None:
            msg.set_content(text)
            if html:
                msg.add_alternative(html, subtype="html")
        elif html:
            msg.set_content(html, subtype="html")
        else:
            msg.set_content("")

        for att in attachments or []:
            try:
                raw = base64.b64decode(att.content_b64)
            except Exception as e:  # malformed attachment must not crash the send pipeline silently
                raise EmailGatewayCommandError(f"attachment {att.filename!r} is not valid base64: {e}") from e
            maintype, _, subtype = (att.mime_type or "application/octet-stream").partition("/")
            msg.add_attachment(
                raw, maintype=maintype, subtype=subtype or "octet-stream", filename=att.filename,
                cid=att.content_id,
            )

        use_tls = self._security == "SSL"          # implicit TLS (port 465)
        start_tls = self._security == "STARTTLS"   # STARTTLS upgrade (port 587)
        try:
            await aiosmtplib.send(
                msg,
                hostname=self._host,
                port=self._port,
                username=self._username or None,
                password=self._password or None,
                use_tls=use_tls,
                start_tls=start_tls,
            )
        except Exception as e:
            raise EmailGatewayCommandError(f"SMTP send to {self._host} failed: {e}") from e

        return EmailSendResult(message_id=message_id, status="accepted", to=to,
                               raw={"host": self._host, "port": self._port})

    def verify_webhook(self, *, payload: bytes, signature: str | None, timestamp: str | None = None) -> dict:
        raise NotImplementedError("SMTP has no event webhook; inbound status comes from the IMAP worker (Phase D bounce classifier)")


def gateway_for_account(account) -> SmtpEmailGateway:
    """Build an SmtpEmailGateway from a `MailAccount` row.

    `secret_password` is an EncryptedString column, so reading it via the ORM already decrypted it.
    A None password (retired/garbled Fernet key) surfaces as an EmailGatewayConfigError downstream,
    never a 500.
    """
    return SmtpEmailGateway(
        host=account.smtp_host,
        port=account.smtp_port,
        security=account.smtp_security,
        username=account.auth_username or account.email_address,
        password=account.secret_password,
        from_email=account.email_address,
        from_name=account.display_name,
    )
