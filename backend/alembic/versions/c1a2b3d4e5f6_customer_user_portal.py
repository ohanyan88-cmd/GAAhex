"""customer_user table (Batch 34): customer portal logins

Revision ID: c1a2b3d4e5f6
Revises: b4f2c9d3e1a7
Create Date: 2026-05-27 23:00:00.000000

Additive + reversible. One new table for customer portal authentication.
Tenant-scoped with the NULLIF-guarded tenant_isolation RLS policy identical to all
post-enable-RLS tables. gaahex_app grants inherit via ALTER DEFAULT PRIVILEGES set in
the enable-RLS migration.

NOT run against the live DB by the worker — coordinator applies: alembic upgrade head.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1a2b3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'b4f2c9d3e1a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'customer_user',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('customer_id', sa.UUID(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.ForeignKeyConstraint(['customer_id'], ['record.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_customer_user_tenant_id'), 'customer_user', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_customer_user_customer_id'), 'customer_user', ['customer_id'], unique=False)
    op.create_index('uq_customer_user_tenant_email', 'customer_user', ['tenant_id', 'email'], unique=True)

    op.execute("ALTER TABLE customer_user ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON customer_user
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON customer_user;")
    op.drop_index('uq_customer_user_tenant_email', table_name='customer_user')
    op.drop_index(op.f('ix_customer_user_customer_id'), table_name='customer_user')
    op.drop_index(op.f('ix_customer_user_tenant_id'), table_name='customer_user')
    op.drop_table('customer_user')
