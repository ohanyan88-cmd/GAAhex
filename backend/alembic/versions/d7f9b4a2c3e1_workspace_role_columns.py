"""Workspace module foundation — role-resolution columns on app_user + control-gate columns on "order".

Adds the four columns the "My Work" workspace + the Stage 8 Control Gate UX need:

  app_user.primary_role_key         String(40) NULL — admin-set primary workspace role
  app_user.workspace_role_override  String(40) NULL — user's manual override of the resolved role
  "order".credit_check_status       String(20) NULL — last-known credit-check verdict (pending|ok|fail|...)
  "order".control_gate_block_reason Text       NULL — human-readable reason Stage 8 is held closed

`"order"` is a SQL reserved word — Alembic emits the table name verbatim, Postgres requires the
double-quotes when DDL is hand-written, but `op.add_column('order', ...)` works because Alembic
quotes the identifier automatically (mirrors `98d4d53f889c_order_control_pass_columns.py`).

Revision ID: d7f9b4a2c3e1
Revises: c5e7f3a9b1d8
Create Date: 2026-06-01
"""
import sqlalchemy as sa
from alembic import op


revision = 'd7f9b4a2c3e1'
down_revision = 'c5e7f3a9b1d8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # app_user workspace-role columns — both nullable: existing rows fall through to derived/fallback
    # resolution in /api/me/workspace-role until an admin sets primary_role_key or the user picks an
    # override in Workspace settings.
    op.add_column('app_user', sa.Column('primary_role_key', sa.String(length=40), nullable=True))
    op.add_column('app_user', sa.Column('workspace_role_override', sa.String(length=40), nullable=True))

    # "order" Stage 8 surface columns — read by the workspace's order-aware widgets to show why an
    # order is blocked at the Control Gate (credit check failure vs. fraud vs. tariff mismatch, etc.).
    op.add_column('order', sa.Column('credit_check_status', sa.String(length=20), nullable=True))
    op.add_column('order', sa.Column('control_gate_block_reason', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('order', 'control_gate_block_reason')
    op.drop_column('order', 'credit_check_status')
    op.drop_column('app_user', 'workspace_role_override')
    op.drop_column('app_user', 'primary_role_key')
