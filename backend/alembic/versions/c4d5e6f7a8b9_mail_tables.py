"""Mail module — mail_account + mail_folder (+ tenant_isolation RLS)

Phase A of MAILBOX-MODULE-PLAN.md. Creates the per-tenant mailbox connection table and the IMAP
folder table, each tenant-scoped with the canonical `tenant_isolation` RLS policy applied in this
same migration (the b1c768523e3e_outbound_webhooks pattern). Credential columns are TEXT (the
EncryptedString storage type — Fernet-encrypted at rest by the ORM layer).

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MAIL_TABLES = ("mail_account", "mail_folder")


def upgrade() -> None:
    op.create_table(
        "mail_account",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("owner_node_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("org_node.id"), nullable=True),
        sa.Column("reference_number", sa.String(20), nullable=True),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("email_address", sa.String(320), nullable=False),
        sa.Column("imap_host", sa.String(255), nullable=False),
        sa.Column("imap_port", sa.Integer, nullable=False, server_default="993"),
        sa.Column("imap_security", sa.String(10), nullable=False, server_default="SSL"),
        sa.Column("smtp_host", sa.String(255), nullable=False),
        sa.Column("smtp_port", sa.Integer, nullable=False, server_default="465"),
        sa.Column("smtp_security", sa.String(10), nullable=False, server_default="SSL"),
        sa.Column("auth_type", sa.String(20), nullable=False, server_default="PASSWORD"),
        sa.Column("auth_username", sa.String(320), nullable=True),
        sa.Column("secret_password", sa.Text, nullable=True),
        sa.Column("oauth_client_id", sa.String(255), nullable=True),
        sa.Column("secret_oauth_client_secret", sa.Text, nullable=True),
        sa.Column("secret_oauth_refresh_token", sa.Text, nullable=True),
        sa.Column("oauth_access_token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("oauth_provider", sa.String(40), nullable=True),
        sa.Column("is_system_sender", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("sync_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("deletion_state", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", "owner_user_id", "email_address", name="uq_mail_account_addr"),
    )
    op.create_index("ix_mail_account_tenant_id", "mail_account", ["tenant_id"])
    op.create_index("ix_mail_account_owner", "mail_account", ["tenant_id", "owner_user_id"])
    op.create_index("ix_mail_account_sync", "mail_account", ["tenant_id", "status", "sync_enabled"])
    op.create_index(
        "uq_mail_account_default", "mail_account", ["tenant_id", "owner_user_id"],
        unique=True, postgresql_where=sa.text("is_default = true AND deletion_state = 'ACTIVE'"),
    )

    op.create_table(
        "mail_folder",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("mail_account.id", ondelete="CASCADE"), nullable=False),
        sa.Column("imap_path", sa.String(512), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), nullable=True),
        sa.Column("uidvalidity", sa.Integer, nullable=True),
        sa.Column("last_uid", sa.Integer, nullable=True),
        sa.Column("unread_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "account_id", "imap_path", name="uq_mail_folder_path"),
    )
    op.create_index("ix_mail_folder_tenant_id", "mail_folder", ["tenant_id"])
    op.create_index("ix_mail_folder_account", "mail_folder", ["tenant_id", "account_id"])

    # Canonical tenant_isolation RLS (identical to every post-RLS migration; keyed on the
    # gaahex.tenant_id GUC set per request). NULL GUC ⇒ default-deny.
    for table in _MAIL_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
            """
        )


def downgrade() -> None:
    for table in _MAIL_TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_table("mail_folder")
    op.drop_table("mail_account")
