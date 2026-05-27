"""calendar tables (Batch 30): user_calendar + calendar_event

Revision ID: a4f8e2d1c9b7f3e0
Revises: b3f2e1c8d905
Create Date: 2026-05-27 19:00:00.000000

Additive + reversible: two new tables for per-tenant calendars and calendar events.
Tenant-scoped; carries the same NULLIF-guarded tenant_isolation RLS policy as all
post-enable-RLS tables. gaaex_app grants inherit via the ALTER DEFAULT PRIVILEGES set
in the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a4f8e2d1c9b7f3e0'
down_revision: Union[str, Sequence[str], None] = 'b3f2e1c8d905'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # user_calendar table
    op.create_table(
        'user_calendar',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('name', sa.String(length=160), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False, server_default='#3A6FB5'),
        sa.Column('is_shared', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['app_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_calendar_tenant_id'), 'user_calendar', ['tenant_id'], unique=False)

    # RLS on user_calendar
    op.execute("ALTER TABLE user_calendar ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON user_calendar
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)

    # calendar_event table
    op.create_table(
        'calendar_event',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('owner_node_id', sa.UUID(), nullable=True),
        sa.Column('calendar_id', sa.UUID(), nullable=True),
        sa.Column('created_by_id', sa.UUID(), nullable=True),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('start_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('all_day', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('location', sa.String(length=255), nullable=True),
        sa.Column('color', sa.String(length=20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], ),
        sa.ForeignKeyConstraint(['owner_node_id'], ['org_node.id'], ),
        sa.ForeignKeyConstraint(['calendar_id'], ['user_calendar.id'], ),
        sa.ForeignKeyConstraint(['created_by_id'], ['app_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_calendar_event_tenant_id'), 'calendar_event', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_calendar_event_calendar_id'), 'calendar_event', ['calendar_id'], unique=False)
    op.create_index('ix_calendar_event_start_at', 'calendar_event', ['start_at'], unique=False)

    # RLS on calendar_event
    op.execute("ALTER TABLE calendar_event ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON calendar_event
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # calendar_event
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON calendar_event;")
    op.drop_index('ix_calendar_event_start_at', table_name='calendar_event')
    op.drop_index(op.f('ix_calendar_event_calendar_id'), table_name='calendar_event')
    op.drop_index(op.f('ix_calendar_event_tenant_id'), table_name='calendar_event')
    op.drop_table('calendar_event')

    # user_calendar
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON user_calendar;")
    op.drop_index(op.f('ix_user_calendar_tenant_id'), table_name='user_calendar')
    op.drop_table('user_calendar')
