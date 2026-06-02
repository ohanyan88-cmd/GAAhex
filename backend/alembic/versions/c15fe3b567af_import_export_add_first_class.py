"""Import / Export Standard (file 08) — first-class import_job + export_job tables.

Revision ID: c15fe3b567af
Revises: 6be9b1b55482
Create Date: 2026-06-02 15:51:55.315504

v1 ships METADATA-ONLY job tracking. The actual import/export EXECUTION engine
(background worker that picks up PENDING/RUNNING rows and processes files) is
a future addition — no schema change needed for it; columns are already in place.

`import_job`:
  - UUIDv7 PK, tenant-scoped, IMP-NNNNNN reference number unique per tenant.
  - 9-value status enum (file 08): DRAFT, VALIDATING, VALIDATION_FAILED,
    READY_TO_IMPORT, IMPORTING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED,
    CANCELLED.
  - file_attachment_id real FK to attachment.id with ON DELETE SET NULL
    (Attachment soft-delete shouldn't break the job audit row).
  - error_summary JSONB blob for structured validator output.
  - Indexes: UNIQUE(tenant_id, reference_number), (tenant_id, status),
    (tenant_id, entity_key).

`export_job`:
  - Same shape + filter_spec JSONB + output_format + expires_at.
  - 6-value status enum: REQUESTED, RUNNING, COMPLETED, FAILED, CANCELLED, EXPIRED.
  - Indexes: same + (tenant_id, expires_at) for the retention sweep.

RLS tenant_isolation on BOTH tables (NULLIF-guarded, matching the orders
migration pattern). Both tables explicitly require a tenant context for
read or write.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c15fe3b567af'
down_revision: Union[str, Sequence[str], None] = '6be9b1b55482'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ── import_job ────────────────────────────────────────────────────────────
    op.create_table(
        'import_job',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',    sa.String(length=20),  nullable=False),
        sa.Column('job_type',            sa.String(length=40),  nullable=False),
        sa.Column('entity_key',          sa.String(length=60),  nullable=False),
        sa.Column('file_attachment_id',  postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('status',              sa.String(length=30),  server_default='DRAFT', nullable=False),
        sa.Column('total_rows',          sa.BigInteger(),       server_default='0',     nullable=False),
        sa.Column('valid_rows',          sa.BigInteger(),       server_default='0',     nullable=False),
        sa.Column('invalid_rows',        sa.BigInteger(),       server_default='0',     nullable=False),
        sa.Column('error_summary',       postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('started_at',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at',        sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],          ['tenant.id']),
        sa.ForeignKeyConstraint(['file_attachment_id'], ['attachment.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'],         ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_import_job_reference_number'),
    )
    op.create_index('ix_import_job_tenant_id',   'import_job', ['tenant_id'],               unique=False)
    op.create_index('ix_import_job_status',      'import_job', ['tenant_id', 'status'],     unique=False)
    op.create_index('ix_import_job_entity_key',  'import_job', ['tenant_id', 'entity_key'], unique=False)

    # ── export_job ────────────────────────────────────────────────────────────
    op.create_table(
        'export_job',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',    sa.String(length=20),  nullable=False),
        sa.Column('job_type',            sa.String(length=40),  nullable=False),
        sa.Column('entity_key',          sa.String(length=60),  nullable=False),
        sa.Column('filter_spec',         postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('output_format',       sa.String(length=20),  server_default='csv',       nullable=False),
        sa.Column('status',              sa.String(length=20),  server_default='REQUESTED', nullable=False),
        sa.Column('total_rows',          sa.BigInteger(),       server_default='0',         nullable=False),
        sa.Column('file_attachment_id',  postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('expires_at',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('started_at',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at',        sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'],          ['tenant.id']),
        sa.ForeignKeyConstraint(['file_attachment_id'], ['attachment.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'],         ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_export_job_reference_number'),
    )
    op.create_index('ix_export_job_tenant_id',   'export_job', ['tenant_id'],               unique=False)
    op.create_index('ix_export_job_status',      'export_job', ['tenant_id', 'status'],     unique=False)
    op.create_index('ix_export_job_entity_key',  'export_job', ['tenant_id', 'entity_key'], unique=False)
    op.create_index('ix_export_job_expires_at',  'export_job', ['tenant_id', 'expires_at'], unique=False)

    # ── RLS (NULLIF-guarded, matching orders migration pattern) ───────────────
    for table in ('import_job', 'export_job'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    """Downgrade schema."""
    for table in ('export_job', 'import_job'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_export_job_expires_at', table_name='export_job')
    op.drop_index('ix_export_job_entity_key', table_name='export_job')
    op.drop_index('ix_export_job_status',     table_name='export_job')
    op.drop_index('ix_export_job_tenant_id',  table_name='export_job')
    op.drop_table('export_job')
    op.drop_index('ix_import_job_entity_key', table_name='import_job')
    op.drop_index('ix_import_job_status',     table_name='import_job')
    op.drop_index('ix_import_job_tenant_id',  table_name='import_job')
    op.drop_table('import_job')
