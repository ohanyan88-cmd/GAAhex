"""Attachment Standard (file 04) — first-class attachment + attachment_reference tables.

Revision ID: 89e8bc8d365b
Revises: 85e76746332e
Create Date: 2026-06-02 14:22:52.941081

Two additive tables. Existing avatar_url / logo_url base64 fields on User/Tenant
are NOT modified — they remain convenience fields for small images.

`attachment`:
  - Polymorphic owner (owner_entity_type + owner_entity_id, Approval precedent).
  - storageKey = system-generated UUID path in the StorageBackend (never the filename).
  - SHA-256 checksum stored at upload time.
  - 16-value category, 6-value status.
  - Soft delete (deleted_at / deleted_by).
  - Scan metadata columns (v1: scan_result='SKIPPED'; future: real scan result).
  - 2 indexes: (tenant_id, owner_entity_type, owner_entity_id) + (tenant_id, status).

`attachment_reference`:
  - Non-owner reference links from other objects to an Attachment.
  - attachment_id FK (no CASCADE — removing a reference never deletes the file).
  - 2 indexes: (attachment_id) + (tenant_id, ref_entity_type, ref_entity_id).

RLS tenant_isolation on both tables (NULLIF-guarded).

Upload flow note: v1 moves UPLOADING → AVAILABLE directly (scan_result='SKIPPED').
Full spec flow (UPLOADING → SCANNING → AVAILABLE | QUARANTINED) activates when a
ScanBackend is wired. No schema change needed — columns already present.

No per-attachment hold column — central Legal Hold registry (Data Retention Standard).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '89e8bc8d365b'
down_revision: Union[str, Sequence[str], None] = '85e76746332e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── attachment ────────────────────────────────────────────────────────────
    op.create_table(
        'attachment',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('owner_entity_type',   sa.String(length=40),   nullable=False),
        sa.Column('owner_entity_id',     postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('file_name',           sa.String(length=255),  nullable=False),
        sa.Column('original_file_name',  sa.String(length=255),  nullable=False),
        sa.Column('file_extension',      sa.String(length=20),   nullable=False),
        sa.Column('mime_type',           sa.String(length=120),  nullable=False),
        sa.Column('file_size',           sa.BigInteger(),        nullable=False),
        sa.Column('checksum',            sa.String(length=64),   nullable=False),
        sa.Column('storage_key',         sa.String(length=500),  nullable=False),
        sa.Column('category',            sa.String(length=30),   server_default='DOCUMENT',  nullable=False),
        sa.Column('status',              sa.String(length=20),   server_default='UPLOADING', nullable=False),
        sa.Column('scan_result',         sa.String(length=20),   nullable=True),
        sa.Column('scan_provider',       sa.String(length=80),   nullable=True),
        sa.Column('scan_completed_at',   sa.DateTime(timezone=True), nullable=True),
        sa.Column('description',         sa.Text(),              nullable=True),
        sa.Column('preview_available',   sa.Boolean(),           server_default=sa.text('false'), nullable=False),
        sa.Column('download_count',      sa.BigInteger(),        server_default='0', nullable=False),
        sa.Column('last_downloaded_at',  sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_at',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by',          postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],   ['tenant.id']),
        sa.ForeignKeyConstraint(['deleted_by'],  ['app_user.id']),
        sa.ForeignKeyConstraint(['created_by'],  ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_attachment_tenant_id', 'attachment', ['tenant_id'], unique=False)
    op.create_index('ix_attachment_owner',  'attachment', ['tenant_id', 'owner_entity_type', 'owner_entity_id'], unique=False)
    op.create_index('ix_attachment_status', 'attachment', ['tenant_id', 'status'], unique=False)

    # ── attachment_reference ──────────────────────────────────────────────────
    op.create_table(
        'attachment_reference',
        sa.Column('id',              postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',       postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('attachment_id',   postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('ref_entity_type', sa.String(length=40), nullable=False),
        sa.Column('ref_entity_id',   postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at',      sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',      postgresql.UUID(as_uuid=True), nullable=False),
        # No CASCADE on attachment_id — removing a reference never deletes the file.
        sa.ForeignKeyConstraint(['tenant_id'],    ['tenant.id']),
        sa.ForeignKeyConstraint(['attachment_id'],['attachment.id']),
        sa.ForeignKeyConstraint(['created_by'],   ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_attachment_ref_tenant_id',  'attachment_reference', ['tenant_id'], unique=False)
    op.create_index('ix_attachment_ref_attachment', 'attachment_reference', ['attachment_id'], unique=False)
    op.create_index('ix_attachment_ref_entity',     'attachment_reference', ['tenant_id', 'ref_entity_type', 'ref_entity_id'], unique=False)

    # ── RLS ───────────────────────────────────────────────────────────────────
    for table in ('attachment', 'attachment_reference'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    for table in ('attachment_reference', 'attachment'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_attachment_ref_entity',     table_name='attachment_reference')
    op.drop_index('ix_attachment_ref_attachment', table_name='attachment_reference')
    op.drop_index('ix_attachment_ref_tenant_id',  table_name='attachment_reference')
    op.drop_table('attachment_reference')
    op.drop_index('ix_attachment_status',    table_name='attachment')
    op.drop_index('ix_attachment_owner',     table_name='attachment')
    op.drop_index('ix_attachment_tenant_id', table_name='attachment')
    op.drop_table('attachment')
