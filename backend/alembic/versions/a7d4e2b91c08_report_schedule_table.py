"""report_schedule table (A24 scheduled reports)

Revision ID: a7d4e2b91c08
Revises: f3a1c9d27b04
Create Date: 2026-05-27 12:00:00.000000

Additive + reversible: one new table for scheduled reports (a saved report turned into a recurring,
adapter-delivered job). No changes to existing tables, no data backfill — safe to apply live.
Tenant-scoped, so it carries the same NULLIF-guarded `tenant_isolation` RLS policy as the other
post-enable-RLS tables (report_def, job_run).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a7d4e2b91c08'
down_revision: Union[str, Sequence[str], None] = 'f3a1c9d27b04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('report_schedule',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('tenant_id', sa.UUID(), nullable=False),
    sa.Column('owner_node_id', sa.UUID(), nullable=True),
    sa.Column('report_id', sa.UUID(), nullable=False),
    sa.Column('cadence', sa.String(length=20), nullable=False),
    sa.Column('channel', sa.String(length=40), nullable=False),
    sa.Column('recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('next_run_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_run_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
    sa.ForeignKeyConstraint(['report_id'], ['report_def.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_report_schedule_tenant_id'), 'report_schedule', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_report_schedule_report_id'), 'report_schedule', ['report_id'], unique=False)
    # run-due scans ACTIVE schedules by next_run_at — index it for cheap "due now" lookups.
    op.create_index(op.f('ix_report_schedule_next_run_at'), 'report_schedule', ['next_run_at'], unique=False)

    # RLS: created after the enable-RLS migration, so apply the same NULLIF-guarded tenant_isolation
    # policy as the billing / job_run tables (gaaex_app grants come from the ALTER DEFAULT PRIVILEGES
    # set earlier).
    op.execute("ALTER TABLE report_schedule ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON report_schedule
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON report_schedule;")
    op.drop_index(op.f('ix_report_schedule_next_run_at'), table_name='report_schedule')
    op.drop_index(op.f('ix_report_schedule_report_id'), table_name='report_schedule')
    op.drop_index(op.f('ix_report_schedule_tenant_id'), table_name='report_schedule')
    op.drop_table('report_schedule')
