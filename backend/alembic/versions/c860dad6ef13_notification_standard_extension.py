"""Notification Standard extension — file 05 / D16 (Option A dual-category).

Revision ID: c860dad6ef13
Revises: 89e8bc8d365b
Create Date: 2026-06-02 14:52:44.979324

Additive migration — all new columns nullable; every existing row, test,
and call site continues to work unchanged.

Changes to `notification` table (8 new nullable columns + 2 new indexes):
  event_id        uuid      — D16 triggering event (no FK; events are permanent)
  source          varchar   — NotificationSource: TASK|COMMENT|ATTACHMENT|...
  severity        varchar   — INFO|WARNING|ERROR|CRITICAL (impact axis)
  recipient_type  varchar   — EMPLOYEE|ROLE|DEPARTMENT|TEAM|CUSTOMER; server_default EMPLOYEE
  std_category    varchar   — Option A: canonical NotificationCategory UPPER_SNAKE
  status          varchar   — 7-value state machine; server_default DELIVERED
  acknowledged_at timestamptz
  dismissed_at    timestamptz
  expires_at      timestamptz

New table `notification_delivery` — per-attempt delivery log:
  channel (IN_APP|EMAIL|SMS|PUSH), status (SENT|DELIVERED|FAILED|REJECTED|BOUNCED|EXPIRED),
  attempted_at, result_detail. No CASCADE — delivery records outlive inbox pruning.
  RLS tenant_isolation.

Option A rationale: `category` (legacy: "system"|"billing"|"network"|"customer"|"internal")
is unchanged. `std_category` (nullable) carries the canonical NotificationCategory value.
New emits write both; old code only writes `category`. Future cleanup merges them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'c860dad6ef13'
down_revision: Union[str, Sequence[str], None] = '89e8bc8d365b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── extend notification table ─────────────────────────────────────────────
    op.add_column('notification', sa.Column('event_id',       postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('notification', sa.Column('source',         sa.String(30),  nullable=True))
    op.add_column('notification', sa.Column('severity',       sa.String(20),  nullable=True))
    op.add_column('notification', sa.Column('recipient_type', sa.String(20),  server_default=sa.text("'EMPLOYEE'"), nullable=True))
    op.add_column('notification', sa.Column('std_category',   sa.String(30),  nullable=True))
    op.add_column('notification', sa.Column('status',         sa.String(20),  server_default=sa.text("'DELIVERED'"), nullable=True))
    op.add_column('notification', sa.Column('acknowledged_at',sa.DateTime(timezone=True), nullable=True))
    op.add_column('notification', sa.Column('dismissed_at',   sa.DateTime(timezone=True), nullable=True))
    op.add_column('notification', sa.Column('expires_at',     sa.DateTime(timezone=True), nullable=True))

    op.create_index('ix_notification_status',   'notification', ['tenant_id', 'status'],   unique=False)
    op.create_index('ix_notification_event_id', 'notification', ['event_id'],               unique=False)

    # ── notification_delivery ─────────────────────────────────────────────────
    op.create_table(
        'notification_delivery',
        sa.Column('id',              postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',       postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('notification_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('channel',         sa.String(20), nullable=False),
        sa.Column('status',          sa.String(20), nullable=False),
        sa.Column('attempted_at',    sa.DateTime(timezone=True), nullable=False),
        sa.Column('result_detail',   sa.Text(), nullable=True),
        # No CASCADE — delivery records outlive inbox pruning.
        sa.ForeignKeyConstraint(['tenant_id'],       ['tenant.id']),
        sa.ForeignKeyConstraint(['notification_id'], ['notification.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_notif_delivery_tenant_id',    'notification_delivery', ['tenant_id'],       unique=False)
    op.create_index('ix_notif_delivery_notification', 'notification_delivery', ['notification_id'], unique=False)
    op.create_index('ix_notif_delivery_tenant',       'notification_delivery', ['tenant_id', 'attempted_at'], unique=False)

    # RLS on delivery table.
    op.execute("ALTER TABLE notification_delivery ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON notification_delivery
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON notification_delivery;")
    op.drop_index('ix_notif_delivery_tenant',       table_name='notification_delivery')
    op.drop_index('ix_notif_delivery_notification', table_name='notification_delivery')
    op.drop_index('ix_notif_delivery_tenant_id',    table_name='notification_delivery')
    op.drop_table('notification_delivery')

    op.drop_index('ix_notification_event_id', table_name='notification')
    op.drop_index('ix_notification_status',   table_name='notification')
    op.drop_column('notification', 'expires_at')
    op.drop_column('notification', 'dismissed_at')
    op.drop_column('notification', 'acknowledged_at')
    op.drop_column('notification', 'status')
    op.drop_column('notification', 'std_category')
    op.drop_column('notification', 'recipient_type')
    op.drop_column('notification', 'severity')
    op.drop_column('notification', 'source')
    op.drop_column('notification', 'event_id')
