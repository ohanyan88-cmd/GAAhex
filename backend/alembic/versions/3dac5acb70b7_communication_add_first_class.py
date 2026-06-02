"""Customer Communication Standard (file 12) — first-class communication table.

Revision ID: 3dac5acb70b7
Revises: c15fe3b567af
Create Date: 2026-06-02 15:52:13.411978

Replaces the legacy `interaction` table as the canonical communication entity
(legacy table kept on the schema for back-compat; API is the new one).

`communication`:
  - Polymorphic related-entity pointer (related_entity_type + related_entity_id,
    no FK — Approval precedent at approval.target_entity_key /
    approval.target_record_id, ``app/models/approval.py:58, 66``).
  - Polymorphic participant counterpart (participant_type + participant_id, no
    FK — five possible target tables: EMPLOYEE / ROLE / DEPARTMENT / TEAM /
    CUSTOMER).
  - Human-visible `reference_number` (COM-000001 …) issued per-tenant via
    SELECT COUNT+1; UNIQUE (tenant_id, reference_number) is the fence.
  - 8-value channel, 4-value direction, 5-value participant_type, 8-value status
    (all UPPER_SNAKE_CASE — file 14).
  - 4 indexes — (tenant_id, related_entity_type, related_entity_id),
                 (tenant_id, participant_type, participant_id),
                 (tenant_id, status),
                 UNIQUE (tenant_id, reference_number).
  - Trace fields: correlation_id, event_id (file 06 / M1).

RLS tenant_isolation on the new table (NULLIF-guarded, mirrors the pattern
established in 18062d97ef59_orders_tables.py lines 55-75).

No data backfill — legacy `interaction` rows are not migrated. The
migrate_interactions() boot routine already copies interaction → record for the
generic record router; this module is the per-message store the customer
communication standard requires going forward.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '3dac5acb70b7'
down_revision: Union[str, Sequence[str], None] = 'c15fe3b567af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'communication',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reference_number',    sa.String(length=20),          nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('channel',             sa.String(length=20),          nullable=False),
        sa.Column('direction',           sa.String(length=20),          nullable=False),
        sa.Column('related_entity_type', sa.String(length=40),          nullable=True),
        sa.Column('related_entity_id',   postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('participant_type',    sa.String(length=20),          nullable=True),
        sa.Column('participant_id',      postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('subject',             sa.String(length=255),         nullable=True),
        sa.Column('message_body',        sa.Text(),                     nullable=True),
        sa.Column('content_reference',   sa.String(length=500),         nullable=True),
        sa.Column('status',              sa.String(length=20),          server_default='DRAFT', nullable=False),
        sa.Column('created_at',          sa.DateTime(timezone=True),    server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by',          postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('sent_at',             sa.DateTime(timezone=True),    nullable=True),
        sa.Column('received_at',         sa.DateTime(timezone=True),    nullable=True),
        sa.Column('correlation_id',      postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_id',            postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'],   ['tenant.id']),
        sa.ForeignKeyConstraint(['created_by'],  ['app_user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('tenant_id', 'reference_number', name='uq_communication_tenant_refnum'),
    )
    op.create_index('ix_communication_tenant_id',    'communication', ['tenant_id'], unique=False)
    op.create_index('ix_communication_related',      'communication', ['tenant_id', 'related_entity_type', 'related_entity_id'], unique=False)
    op.create_index('ix_communication_participant',  'communication', ['tenant_id', 'participant_type', 'participant_id'], unique=False)
    op.create_index('ix_communication_status',       'communication', ['tenant_id', 'status'], unique=False)

    # RLS tenant_isolation (NULLIF-guarded — pattern from 18062d97ef59_orders_tables.py).
    op.execute("ALTER TABLE communication ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON communication
          USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON communication;")
    op.drop_index('ix_communication_status',      table_name='communication')
    op.drop_index('ix_communication_participant', table_name='communication')
    op.drop_index('ix_communication_related',     table_name='communication')
    op.drop_index('ix_communication_tenant_id',   table_name='communication')
    op.drop_table('communication')
