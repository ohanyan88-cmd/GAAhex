"""tenant theme (Studio AppearancePane design tokens)

Adds Tenant.theme — a JSONB column that stores the tenant-level design tokens the Studio
AppearancePane writes through (accent / radius / density / mode, plus any future tokens the
kit grows). JSONB so the shape can evolve without per-token migrations; allow-lists live
in routers/tenant_settings.py. Surfaces in GET/PUT /api/tenant/settings/theme.

Revision ID: b8c5e9d2f140
Revises: f9ef47c3db77
Create Date: 2026-05-30 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b8c5e9d2f140"
down_revision: Union[str, Sequence[str], None] = "f9ef47c3db77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenant", sa.Column("theme", postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "theme")
