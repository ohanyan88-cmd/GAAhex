"""DB indexes (record/workitem.status, event.created_at) + password_changed_at column on app_user.

Audit P1 — two small tweaks bundled into one migration:

1. Indexes for hot read paths:
   - ix_record_status        — most list/aggregate queries filter Record by status
   - ix_workitem_status      — same for the WorkItem queue/aging KPIs
   - ix_event_created_at     — audit/event timeline reads sort/filter by created_at
   All created with IF NOT EXISTS so reruns on partially-migrated dev DBs are safe.

2. app_user.password_changed_at (timestamptz, nullable) — drives the "first-login forced password
   change" flow for the seeded default admin (email admin@demo.isp / admin123). NULL = never
   changed since seed; /api/me/password stamps it on success; /auth/login returns
   must_change_password=true when the seeded admin still has NULL.

Revision ID: c5e7f3a9b1d8
Revises: b3d5f7a9c1e2
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'c5e7f3a9b1d8'
down_revision = 'b3d5f7a9c1e2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Indexes — raw SQL with IF NOT EXISTS so an interrupted/partial run on a dev DB is recoverable.
    op.execute("CREATE INDEX IF NOT EXISTS ix_record_status ON record(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_workitem_status ON workitem(status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_event_created_at ON event(created_at)")

    # Forced-change column — nullable so existing rows (including the seeded admin) stay NULL until
    # they next set/change their password, which is the signal the login handler keys off.
    op.add_column('app_user', sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column('app_user', 'password_changed_at')
    op.execute("DROP INDEX IF EXISTS ix_event_created_at")
    op.execute("DROP INDEX IF EXISTS ix_workitem_status")
    op.execute("DROP INDEX IF EXISTS ix_record_status")
