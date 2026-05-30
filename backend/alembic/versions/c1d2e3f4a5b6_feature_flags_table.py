"""feature_flags table

Revision ID: c1d2e3f4a5b6
Revises: b8c5e9d2f140
Create Date: 2026-05-31 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "c1d2e3f4a5b6"
down_revision: Union[str, Sequence[str], None] = "b8c5e9d2f140"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feature_flag",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("key", sa.String(120), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("role_scope", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_feature_flag_tenant_id", "feature_flag", ["tenant_id"])
    op.create_unique_constraint("uq_feature_flag_tenant_key", "feature_flag", ["tenant_id", "key"])


def downgrade() -> None:
    op.drop_constraint("uq_feature_flag_tenant_key", "feature_flag", type_="unique")
    op.drop_index("ix_feature_flag_tenant_id", "feature_flag")
    op.drop_table("feature_flag")
