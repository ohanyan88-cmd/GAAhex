"""Relationship / Entity Link Standard (file 12) — first-class relationship table.

Revision ID: 02b1e0fef42e
Revises: fa16384aa026
Create Date: 2026-06-02 15:54:16.439413

One additive table: `relationship`. Replaces hardcoded FKs as the "logical link"
metadata layer — does NOT remove or change any existing FK (Subscription.customer_id,
Order.account_id, etc. all remain).

Polymorphic on BOTH sides (no FK on source/target — Approval/Comment/Attachment
precedent). Per-tenant REL-000001 reference number; UNIQUE
(tenant_id, reference_number) is the collision fence.

Partial UNIQUE INDEX `uq_relationship_active_pair`:
  (tenant_id, source_entity_type, source_entity_id,
   target_entity_type, target_entity_id, relationship_type)
  WHERE status = 'ACTIVE'

  Stops duplicate ACTIVE links of the same shape; ARCHIVED rows of the same shape
  may coexist with a fresh ACTIVE row (re-creating a link after archiving the old
  one is legal).

RLS tenant_isolation NULLIF-guarded, matching the existing 18062d97ef59 pattern.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '02b1e0fef42e'
down_revision: Union[str, Sequence[str], None] = 'fa16384aa026'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'relationship',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',    sa.String(length=20),  nullable=False),
        sa.Column('source_entity_type',  sa.String(length=40),  nullable=False),
        sa.Column('source_entity_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('target_entity_type',  sa.String(length=40),  nullable=False),
        sa.Column('target_entity_id',    postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('relationship_type',   sa.String(length=30),  nullable=False),
        sa.Column('direction',           sa.String(length=20),  server_default='DIRECTED', nullable=False),
        sa.Column('status',              sa.String(length=20),  server_default='ACTIVE',   nullable=False),
        sa.Column('description',         sa.Text(), nullable=True),
        sa.Column('valid_from',          sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_until',         sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('updated_at',          sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by',          postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'],  ['tenant.id']),
        sa.ForeignKeyConstraint(['created_by'], ['app_user.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_relationship_reference_number'),
    )
    op.create_index('ix_relationship_tenant_id', 'relationship', ['tenant_id'], unique=False)
    op.create_index('ix_relationship_source',    'relationship', ['tenant_id', 'source_entity_type', 'source_entity_id'], unique=False)
    op.create_index('ix_relationship_target',    'relationship', ['tenant_id', 'target_entity_type', 'target_entity_id'], unique=False)
    op.create_index('ix_relationship_status',    'relationship', ['tenant_id', 'status'], unique=False)

    # Partial UNIQUE INDEX — no duplicate ACTIVE link of the same shape.
    op.create_index(
        'uq_relationship_active_pair',
        'relationship',
        ['tenant_id', 'source_entity_type', 'source_entity_id',
         'target_entity_type', 'target_entity_id', 'relationship_type'],
        unique=True,
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )

    # RLS tenant_isolation (NULLIF-guarded).
    op.execute("ALTER TABLE relationship ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON relationship
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON relationship;")
    op.drop_index('uq_relationship_active_pair', table_name='relationship')
    op.drop_index('ix_relationship_status',      table_name='relationship')
    op.drop_index('ix_relationship_target',      table_name='relationship')
    op.drop_index('ix_relationship_source',      table_name='relationship')
    op.drop_index('ix_relationship_tenant_id',   table_name='relationship')
    op.drop_table('relationship')
