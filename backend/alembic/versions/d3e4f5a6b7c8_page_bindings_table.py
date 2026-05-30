"""page_bindings table

Revision ID: d3e4f5a6b7c8
Revises: aa178a3a15f3
Create Date: 2026-05-31 01:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "d3e4f5a6b7c8"
down_revision: Union[str, Sequence[str], None] = "aa178a3a15f3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "page_binding",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenant.id"), nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("component_key", sa.String(255), nullable=False),
        sa.Column("entity_slug", sa.String(255), nullable=False),
        sa.Column("field_key", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_page_binding_tenant_id", "page_binding", ["tenant_id"])
    op.create_index("ix_page_binding_page_id", "page_binding", ["page_id"])


def downgrade() -> None:
    op.drop_index("ix_page_binding_page_id", "page_binding")
    op.drop_index("ix_page_binding_tenant_id", "page_binding")
    op.drop_table("page_binding")
