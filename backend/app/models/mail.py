"""Mail module — per-tenant email client persistence (MAILBOX-MODULE-PLAN.md).

First-class module tables (NOT a 6th kernel engine, NOT a slug-branch in records.py). Every table
is tenant-scoped with the canonical `tenant_isolation` RLS policy applied in the same migration.
Credentials are Fernet-encrypted at rest via `EncryptedString` (the `webhook_def.secret` precedent).

Phase A ships `MailAccount` (+ `MailFolder` so the Sent folder + per-folder sync cursor exist for
the send path). `MailMessage` / `MailAttachment` land in Phase B (inbound IMAP).

Enums (UPPER_SNAKE_CASE, B1 — register in docs/standards/14-enum-registry.md):
  MailAccountStatus     : PENDING | CONNECTED | AUTH_ERROR | CONN_ERROR | DISABLED
  MailAuthType          : PASSWORD | OAUTH2
  MailTransportSecurity : SSL | STARTTLS | NONE
  MailFolderRole        : INBOX | SENT | DRAFTS | TRASH | SPAM | ARCHIVE | CUSTOM
"""
from app.utils.ids import uuid7
import uuid
from datetime import datetime

from sqlalchemy import (
    String, Integer, Boolean, ForeignKey, DateTime, func, Text, UniqueConstraint, Index, text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base
from ..security import EncryptedString


class MailAccount(Base):
    """One mailbox connection within a tenant: IMAP + SMTP config, encrypted credentials, OAuth2
    token material, and connection status. `owner_user_id` NULL = a tenant-shared mailbox; the
    `is_system_sender` shared account carries invoice/dunning mail for the tenant.

    Sending dials THIS row's `smtp_host` — never a global `settings.smtp_host` — so each ISP's mail
    leaves from its own server/domain (SPF/DKIM aligned by construction). The IMAP UIDVALIDITY/last-UID
    cursor lives per-folder on `MailFolder`, so the account carries only `last_sync_at` / `status`.
    """
    __tablename__ = "mail_account"
    __table_args__ = (
        UniqueConstraint("tenant_id", "owner_user_id", "email_address", name="uq_mail_account_addr"),
        Index("ix_mail_account_owner", "tenant_id", "owner_user_id"),
        Index("ix_mail_account_sync", "tenant_id", "status", "sync_enabled"),
        # One default mailbox per user (only among live rows).
        Index(
            "uq_mail_account_default", "tenant_id", "owner_user_id",
            unique=True,
            postgresql_where=text("is_default = true AND deletion_state = 'ACTIVE'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=True)
    owner_node_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("org_node.id"), nullable=True)
    reference_number: Mapped[str | None] = mapped_column(String(20), nullable=True)   # MBX-000001 (per-tenant)

    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email_address: Mapped[str] = mapped_column(String(320), nullable=False)

    imap_host: Mapped[str] = mapped_column(String(255), nullable=False)
    imap_port: Mapped[int] = mapped_column(Integer, nullable=False, default=993, server_default="993")
    imap_security: Mapped[str] = mapped_column(String(10), nullable=False, default="SSL", server_default="SSL")
    smtp_host: Mapped[str] = mapped_column(String(255), nullable=False)
    smtp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=465, server_default="465")
    smtp_security: Mapped[str] = mapped_column(String(10), nullable=False, default="SSL", server_default="SSL")

    auth_type: Mapped[str] = mapped_column(String(20), nullable=False, default="PASSWORD", server_default="PASSWORD")
    auth_username: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Fernet-encrypted at rest (storage = Text). The DB never sees plaintext credentials.
    secret_password: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    oauth_client_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    secret_oauth_client_secret: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    secret_oauth_refresh_token: Mapped[str | None] = mapped_column(EncryptedString(), nullable=True)
    oauth_access_token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    oauth_provider: Mapped[str | None] = mapped_column(String(40), nullable=True)   # GOOGLE|MICROSOFT|GENERIC

    is_system_sender: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sync_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", server_default="PENDING")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("app_user.id"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    # D14 deletion state — soft-retire a mailbox without losing audit lineage.
    deletion_state: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MailFolder(Base):
    """An IMAP folder under an account + its per-folder sync cursor (UIDVALIDITY / last-UID).

    Phase A creates this so the Sent folder exists for append-on-send; Phase B's worker populates
    folders by discovery and drives `MailMessage` sync off `uidvalidity` + `last_uid`.
    """
    __tablename__ = "mail_folder"
    __table_args__ = (
        UniqueConstraint("tenant_id", "account_id", "imap_path", name="uq_mail_folder_path"),
        Index("ix_mail_folder_account", "tenant_id", "account_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    # Deleting a mailbox drops its folders (the webhook_delivery CASCADE precedent).
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mail_account.id", ondelete="CASCADE"), nullable=False, index=True,
    )
    imap_path: Mapped[str] = mapped_column(String(512), nullable=False)     # raw IMAP name e.g. "INBOX.Sent"
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str | None] = mapped_column(String(20), nullable=True)     # INBOX|SENT|DRAFTS|TRASH|SPAM|ARCHIVE|CUSTOM

    # Per-folder IMAP sync cursor (Phase B).
    uidvalidity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_uid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unread_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MailMessage(Base):
    """One email — inbound (synced from IMAP) or outbound (sent + appended to Sent). Bodies inline
    (TOAST), attachments offloaded to the StorageBackend via `MailAttachment`. Threading is the
    denormalized `thread_id` (OD-5). Idempotent re-sync via the partial-unique
    (tenant, account, folder, uidvalidity, uid)."""
    __tablename__ = "mail_message"
    __table_args__ = (
        Index(
            "uq_mail_message_uid", "tenant_id", "account_id", "folder_id", "uidvalidity", "uid",
            unique=True, postgresql_where=text("uid IS NOT NULL"),
        ),
        Index("ix_mail_message_list", "tenant_id", "folder_id", "date"),
        Index("ix_mail_message_thread", "tenant_id", "thread_id"),
        Index("ix_mail_message_msgid", "tenant_id", "message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mail_account.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mail_folder.id", ondelete="CASCADE"), nullable=False, index=True)

    uid: Mapped[int | None] = mapped_column(Integer, nullable=True)            # IMAP UID within (folder, uidvalidity)
    uidvalidity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(998), nullable=True)  # RFC Message-ID
    in_reply_to: Mapped[str | None] = mapped_column(String(998), nullable=True)
    references_header: Mapped[str | None] = mapped_column(Text, nullable=True)  # raw References header (threading)
    thread_id: Mapped[str | None] = mapped_column(String(998), nullable=True)   # denormalized thread key (OD-5)

    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="INBOUND", server_default="INBOUND")
    from_addr: Mapped[str | None] = mapped_column(String(320), nullable=True)
    to_addrs: Mapped[str | None] = mapped_column(Text, nullable=True)           # comma-joined
    cc_addrs: Mapped[str | None] = mapped_column(Text, nullable=True)
    bcc_addrs: Mapped[str | None] = mapped_column(Text, nullable=True)
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    snippet: Mapped[str | None] = mapped_column(String(280), nullable=True)
    date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)  # message Date header

    seen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    flagged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    answered: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    has_attachments: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Link to the OutboundMessage delivery-log row for sent mail (direction=OUTBOUND).
    outbound_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("outbound_message.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MailAttachment(Base):
    """An attachment on a MailMessage. Bytes live in the StorageBackend (key = `storage_key`); the
    row is metadata only. Inline images carry a `content_id` (cid:) resolved against same-message rows."""
    __tablename__ = "mail_attachment"
    __table_args__ = (
        Index("ix_mail_attachment_message", "tenant_id", "message_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tenant.id"), nullable=False, index=True)
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mail_message.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False, default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    content_id: Mapped[str | None] = mapped_column(String(255), nullable=True)    # cid for inline parts
    is_inline: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
