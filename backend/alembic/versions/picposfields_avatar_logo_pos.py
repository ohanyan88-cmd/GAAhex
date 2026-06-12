"""Picture focal-point columns: app_user.avatar_pos + tenant.logo_pos (object-position "x% y%").

Backs the avatar/logo position picker: dragging a picture sets its CSS object-position, persisted
here so it survives reloads. Additive, reversible, nullable — no RLS/policy changes (both tables
already carry tenant_isolation; a nullable string adds no constraints and no fail-open surface).

Revision ID: picposfields
Revises: c1a3a_staffmail
Create Date: 2026-06-12
"""
from alembic import op
import sqlalchemy as sa


revision = "picposfields"
down_revision = "c1a3a_staffmail"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("app_user", sa.Column("avatar_pos", sa.String(length=20), nullable=True))
    op.add_column("tenant", sa.Column("logo_pos", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "logo_pos")
    op.drop_column("app_user", "avatar_pos")
