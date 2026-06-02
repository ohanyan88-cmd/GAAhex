"""job_run table (J96 batch-job run log)

Revision ID: f3a1c9d27b04
Revises: c7d2f5e9a1b3
Create Date: 2026-05-27 09:00:00.000000

Additive + reversible: one new table for the batch-job run log (dunning, billing-cycle, …). No
changes to existing tables, no data backfill — safe to apply live. Tenant-scoped, so it carries the
same NULLIF-guarded `tenant_isolation` RLS policy as the other post-enable-RLS tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f3a1c9d27b04'
down_revision: Union[str, Sequence[str], None] = 'c7d2f5e9a1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('job_run',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('owner_node_id', sa.UUID(), nullable=True),
    sa.Column('job_key', sa.String(length=80), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('summary', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('actor_user_id', sa.UUID(), nullable=True),
    sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_job_run_tenant_id'), 'job_run', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_job_run_job_key'), 'job_run', ['job_key'], unique=False)

    # RLS: created after the enable-RLS migration, so apply the same NULLIF-guarded tenant_isolation
    # policy as the billing tables (gaahex_app grants come from the ALTER DEFAULT PRIVILEGES set earlier).
    op.execute("ALTER TABLE job_run ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON job_run
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON job_run;")
    op.drop_index(op.f('ix_job_run_job_key'), table_name='job_run')
    op.drop_index(op.f('ix_job_run_tenant_id'), table_name='job_run')
    op.drop_table('job_run')
