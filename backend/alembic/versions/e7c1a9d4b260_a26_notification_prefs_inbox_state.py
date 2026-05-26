"""A26 notification delivery prefs + inbox state

Revision ID: e7c1a9d4b260
Revises: a7d4e2b91c08
Create Date: 2026-05-27 14:30:00.000000

Additive + reversible. Extends the existing notification_pref + notification tables only — no new
tables, no constraint changes, no destructive ops. Every new column has a server_default so existing
rows backfill to TODAY's behaviour (the non-breaking invariant):

  notification_pref  (per-user delivery preference, A26):
    + mode      VARCHAR(20)  NOT NULL DEFAULT 'realtime'   -- off|realtime|digest
    + channels  JSONB        NOT NULL DEFAULT '["inapp"]'  -- external channels delivery may use
    + muted     BOOLEAN      NOT NULL DEFAULT false        -- suppress external delivery for category

  notification  (inbox state + digest hand-off, A26):
    + digest_pending  BOOLEAN  NOT NULL DEFAULT false      -- set at emit when mode=digest; lane E clears
    + archived        BOOLEAN  NOT NULL DEFAULT false      -- hidden from default inbox view (kept)
    + snoozed_until   TIMESTAMPTZ NULL                     -- snooze until this time (NULL = not snoozed)

RLS: both tables already have the NULLIF-guarded `tenant_isolation` policy (notification from the
enable-RLS migration; notification_pref from 642fa959d432). Adding columns inherits that policy — no
new policy needed. Grants already reach both via the ALTER DEFAULT PRIVILEGES set up at enable-RLS.

Safe to apply live — but per task A26, NOT run against the live DB by this worker.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e7c1a9d4b260'
down_revision: Union[str, Sequence[str], None] = 'a7d4e2b91c08'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ---- notification_pref: A26 delivery preference (mode/channels/muted) ----
    op.add_column('notification_pref',
                  sa.Column('mode', sa.String(length=20), server_default='realtime', nullable=False))
    op.add_column('notification_pref',
                  sa.Column('channels', postgresql.JSONB(astext_type=sa.Text()),
                            server_default=sa.text('\'["inapp"]\''), nullable=False))
    op.add_column('notification_pref',
                  sa.Column('muted', sa.Boolean(), server_default=sa.text('false'), nullable=False))

    # ---- notification: A26 inbox state + digest hand-off ----
    op.add_column('notification',
                  sa.Column('digest_pending', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('notification',
                  sa.Column('archived', sa.Boolean(), server_default=sa.text('false'), nullable=False))
    op.add_column('notification',
                  sa.Column('snoozed_until', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('notification', 'snoozed_until')
    op.drop_column('notification', 'archived')
    op.drop_column('notification', 'digest_pending')
    op.drop_column('notification_pref', 'muted')
    op.drop_column('notification_pref', 'channels')
    op.drop_column('notification_pref', 'mode')
