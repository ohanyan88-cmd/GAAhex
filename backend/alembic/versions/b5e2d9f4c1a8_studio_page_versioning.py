"""studio_page_versioning

Revision ID: b5e2d9f4c1a8
Revises: a3d7e9f1b2c4
Create Date: 2026-05-31 00:00:00.000000

Adds studio_page and studio_page_version tables for the Studio publish pipeline.
- studio_page: one row per logical page per tenant (key/slug + label).
- studio_page_version: immutable snapshots; at most one 'published' version per page
  (partial unique index); version_no unique per (tenant, page).
Both tables get the standard tenant_isolation RLS policy.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'b5e2d9f4c1a8'
down_revision: Union[str, Sequence[str], None] = 'a3d7e9f1b2c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- studio_page ----
    op.create_table(
        'studio_page',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('key', sa.String(length=120), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_studio_page_tenant_id'), 'studio_page', ['tenant_id'], unique=False)

    op.execute("ALTER TABLE studio_page ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON studio_page
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)

    # ---- studio_page_version ----
    op.create_table(
        'studio_page_version',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('page_id', sa.UUID(), nullable=False),
        sa.Column('version_no', sa.Integer(), nullable=False),
        sa.Column('author_user_id', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('diff', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['page_id'], ['studio_page.id']),
        sa.ForeignKeyConstraint(['author_user_id'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_studio_page_version_tenant_id'), 'studio_page_version', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_studio_page_version_page_id'), 'studio_page_version', ['page_id'], unique=False)

    # Unique version_no per (tenant, page)
    op.create_index(
        'uq_studio_page_version_no',
        'studio_page_version',
        ['tenant_id', 'page_id', 'version_no'],
        unique=True,
    )

    # At most one published version per page (partial unique index)
    op.execute("""
        CREATE UNIQUE INDEX uq_studio_page_published
          ON studio_page_version (tenant_id, page_id)
          WHERE status = 'published';
    """)

    op.execute("ALTER TABLE studio_page_version ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON studio_page_version
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON studio_page_version;")
    op.execute("DROP INDEX IF EXISTS uq_studio_page_published;")
    op.drop_index('uq_studio_page_version_no', table_name='studio_page_version')
    op.drop_index(op.f('ix_studio_page_version_page_id'), table_name='studio_page_version')
    op.drop_index(op.f('ix_studio_page_version_tenant_id'), table_name='studio_page_version')
    op.drop_table('studio_page_version')

    op.execute("DROP POLICY IF EXISTS tenant_isolation ON studio_page;")
    op.drop_index(op.f('ix_studio_page_tenant_id'), table_name='studio_page')
    op.drop_table('studio_page')
