"""tenant logo url

Adds Tenant.logo_url — Text column that stores either a base64 data URL
(data:image/<mime>;base64,...) or an http(s) URL. Surfaces in
GET/PUT /api/tenant/settings and is consumed by the new OrgIdentity
component in the topbar (P3).

Revision ID: f9ef47c3db77
Revises: a3d7e9f1b2c4
Create Date: 2026-05-30 17:02:32.474213
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f9ef47c3db77"
down_revision: Union[str, Sequence[str], None] = "a3d7e9f1b2c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenant", sa.Column("logo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenant", "logo_url")
