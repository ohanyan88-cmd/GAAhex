"""Comment Standard (file 04) — first-class Comment + CommentMention tables.

Revision ID: 82b37b6342b2
Revises: b470247667d5
Create Date: 2026-06-02 10:43:07.993843

Adds two additive tables:

  - `comment` — parent-pinned (`parent_object_type` + `parent_object_id`, Approval
    precedent — no FK), self-FK reply pointer, soft-delete columns, `hold` boolean for
    legal/investigation/audit/compliance review.
  - `comment_mention` — `@mention` targets per Comment; `comment_id` FK CASCADE so
    mentions die with their parent. Mention principal is `PrincipalType` UPPER_SNAKE
    (EMPLOYEE|ROLE|DEPARTMENT|TEAM, file 04 / D15).

RLS `tenant_isolation` policies on both tables (NULLIF-guarded pattern matching the
existing precedent in `18062d97ef59_orders_tables.py`).

Hold-trigger note (file 04 / Comment Standard):
  This migration does NOT add the DB-level hold trigger. Router v1 enforces `hold`
  refusal on edit/delete. A BEFORE UPDATE / BEFORE DELETE trigger (the same compliance
  class as `b70ef3b98e27` financial immutability) is a HARD precondition before the
  first real legal hold is placed AND before any production deploy. Tracked.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '82b37b6342b2'
down_revision: Union[str, Sequence[str], None] = 'b470247667d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create comment + comment_mention with RLS."""
    op.create_table(
        'comment',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('parent_object_type', sa.String(length=40), nullable=False),
        sa.Column('parent_object_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('parent_comment_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('comment_type', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), server_default='ACTIVE', nullable=False),
        sa.Column('resolution', sa.String(length=20), nullable=True),
        sa.Column('author_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('edited_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deleted_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('hold', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['parent_comment_id'], ['comment.id']),
        sa.ForeignKeyConstraint(['author_id'], ['app_user.id']),
        sa.ForeignKeyConstraint(['edited_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['deleted_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_comment_tenant_id', 'comment', ['tenant_id'], unique=False)
    op.create_index('ix_comment_parent', 'comment', ['tenant_id', 'parent_object_type', 'parent_object_id'], unique=False)
    op.create_index('ix_comment_author', 'comment', ['tenant_id', 'author_id'], unique=False)

    op.create_table(
        'comment_mention',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('comment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('mentioned_entity_type', sa.String(length=20), nullable=False),
        sa.Column('mentioned_entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['comment_id'], ['comment.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_comment_mention_tenant_id', 'comment_mention', ['tenant_id'], unique=False)
    op.create_index('ix_comment_mention_principal', 'comment_mention', ['tenant_id', 'mentioned_entity_type', 'mentioned_entity_id'], unique=False)
    op.create_index('ix_comment_mention_comment', 'comment_mention', ['comment_id'], unique=False)

    # RLS tenant_isolation — NULLIF-guarded pattern (matches 18062d97ef59_orders_tables.py).
    for table in ('comment', 'comment_mention'):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    """Drop the two tables (policies fall with them)."""
    for table in ('comment_mention', 'comment'):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
    op.drop_index('ix_comment_mention_comment', table_name='comment_mention')
    op.drop_index('ix_comment_mention_principal', table_name='comment_mention')
    op.drop_index('ix_comment_mention_tenant_id', table_name='comment_mention')
    op.drop_table('comment_mention')
    op.drop_index('ix_comment_author', table_name='comment')
    op.drop_index('ix_comment_parent', table_name='comment')
    op.drop_index('ix_comment_tenant_id', table_name='comment')
    op.drop_table('comment')
