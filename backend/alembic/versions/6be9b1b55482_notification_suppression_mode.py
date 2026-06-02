"""Notification suppression mode + dedup window on NotificationDef.

Revision ID: 6be9b1b55482
Revises: c860dad6ef13
Create Date: 2026-06-02 15:26:47.798517

Adds two nullable columns to `notification_def`:
  suppression_mode varchar(20)  NONE|DEDUPLICATE|AGGREGATE|THROTTLE|MUTE
                               server_default NONE
  dedup_window_seconds integer  NULL = use global default (300s)

All existing rows get suppression_mode='NONE' (unchanged behaviour).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6be9b1b55482'
down_revision: Union[str, Sequence[str], None] = 'c860dad6ef13'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('notification_def',
        sa.Column('suppression_mode', sa.String(20),
                  server_default=sa.text("'NONE'"), nullable=True))
    op.add_column('notification_def',
        sa.Column('dedup_window_seconds', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('notification_def', 'dedup_window_seconds')
    op.drop_column('notification_def', 'suppression_mode')
