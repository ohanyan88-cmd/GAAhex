"""Mail module Phase B — mail_message + mail_attachment (+ tenant_isolation RLS)

Inbound IMAP sync targets. Bodies inline (TEXT/TOAST); attachment bytes live in the StorageBackend
(row carries only metadata + storage_key). Idempotent re-sync via the partial-unique
(tenant_id, account_id, folder_id, uidvalidity, uid) WHERE uid IS NOT NULL.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-06-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("mail_message", "mail_attachment")


def upgrade() -> None:
    op.create_table(
        "mail_message",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("mail_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("folder_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("mail_folder.id", ondelete="CASCADE"), nullable=False),
        sa.Column("uid", sa.Integer, nullable=True),
        sa.Column("uidvalidity", sa.Integer, nullable=True),
        sa.Column("message_id", sa.String(998), nullable=True),
        sa.Column("in_reply_to", sa.String(998), nullable=True),
        sa.Column("references_header", sa.Text, nullable=True),
        sa.Column("thread_id", sa.String(998), nullable=True),
        sa.Column("direction", sa.String(10), nullable=False, server_default="INBOUND"),
        sa.Column("from_addr", sa.String(320), nullable=True),
        sa.Column("to_addrs", sa.Text, nullable=True),
        sa.Column("cc_addrs", sa.Text, nullable=True),
        sa.Column("bcc_addrs", sa.Text, nullable=True),
        sa.Column("subject", sa.Text, nullable=True),
        sa.Column("body_text", sa.Text, nullable=True),
        sa.Column("body_html", sa.Text, nullable=True),
        sa.Column("snippet", sa.String(280), nullable=True),
        sa.Column("date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("flagged", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("answered", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("draft", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("has_attachments", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("outbound_message_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("outbound_message.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_mail_message_tenant_id", "mail_message", ["tenant_id"])
    op.create_index("ix_mail_message_account", "mail_message", ["account_id"])
    op.create_index("ix_mail_message_folder", "mail_message", ["folder_id"])
    op.create_index("ix_mail_message_list", "mail_message", ["tenant_id", "folder_id", "date"])
    op.create_index("ix_mail_message_thread", "mail_message", ["tenant_id", "thread_id"])
    op.create_index("ix_mail_message_msgid", "mail_message", ["tenant_id", "message_id"])
    op.create_index(
        "uq_mail_message_uid", "mail_message",
        ["tenant_id", "account_id", "folder_id", "uidvalidity", "uid"],
        unique=True, postgresql_where=sa.text("uid IS NOT NULL"),
    )

    op.create_table(
        "mail_attachment",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("mail_message.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False, server_default="application/octet-stream"),
        sa.Column("size_bytes", sa.Integer, nullable=False, server_default="0"),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("content_id", sa.String(255), nullable=True),
        sa.Column("is_inline", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_mail_attachment_tenant_id", "mail_attachment", ["tenant_id"])
    op.create_index("ix_mail_attachment_message", "mail_attachment", ["tenant_id", "message_id"])

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
            """
        )


def downgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_table("mail_attachment")
    op.drop_table("mail_message")
