"""Messaging channels — tenant_channel_account (+ tenant_isolation RLS)

Per-tenant SMS/Telegram/WhatsApp config (the Mail-module pattern applied to messaging). Credentials
are TEXT (EncryptedString storage — Fernet-encrypted by the ORM). RLS in this same migration.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-06-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e6f7a8b9c0d1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_channel_account",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("app_user.id"), nullable=True),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(40), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("sender_id", sa.String(255), nullable=True),
        sa.Column("secret_token", sa.Text, nullable=True),
        sa.Column("secret_extra", sa.Text, nullable=True),
        sa.Column("config", postgresql.JSONB, nullable=True),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDING"),
        sa.Column("last_error", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("app_user.id"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("deletion_state", sa.String(20), nullable=False, server_default="ACTIVE"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tenant_channel_account_tenant_id", "tenant_channel_account", ["tenant_id"])
    op.create_index("ix_channel_account_lookup", "tenant_channel_account", ["tenant_id", "channel", "is_active"])
    op.create_index(
        "uq_channel_account_default", "tenant_channel_account", ["tenant_id", "channel"],
        unique=True, postgresql_where=sa.text("is_default = true AND deletion_state = 'ACTIVE'"),
    )
    op.execute("ALTER TABLE tenant_channel_account ENABLE ROW LEVEL SECURITY;")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON tenant_channel_account
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON tenant_channel_account;")
    op.drop_table("tenant_channel_account")
