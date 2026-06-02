"""Event System extension — D1 (file 06, standard 19).

Revision ID: 85e76746332e
Revises: 46a9dd4fd0fe
Create Date: 2026-06-02 14:03:32.840685

Additive migration — 11 nullable columns added to the existing `event` table.
Existing rows get NULL in all new fields; the spec says "old events remain
readable forever". DB-level append-only triggers (b70ef3b98e27) are untouched.

New columns:
  event_name       varchar(120)  — "<Object>.<Action>" PascalCase (E13); NULL for legacy rows
  category         varchar(30)   — EventCategory enum UPPER_SNAKE (E14/E21)
  schema_version   smallint      — default 1; bump on payload-shape changes
  actor_type       varchar(20)   — ActorType enum (B3/D5); server_default USER
  actor_id         uuid          — canonical actor UUID (not FK; SYSTEM/AUTOMATION have no user)
  department       varchar(80)   — accountable department at event time (B5)
  visibility       varchar(20)   — PUBLIC|INTERNAL|RESTRICTED|SYSTEM; server_default INTERNAL
  correlation_id   uuid          — trace key (M1)
  causation_id     uuid          — trace key (M1)
  reference_number varchar(20)   — EVT-000001 (B2/S5); populated by backfill job for legacy
  idempotency_key  varchar(200)  — integration/automation dedup fence

Index:
  idx_event_event_name      (tenant_id, event_name) — projection queries by event name
  uq_event_idempotency_key  partial UNIQUE (tenant_id, idempotency_key) WHERE NOT NULL

Backfill of event_name / reference_number for legacy rows is intentionally deferred to a
background job — too many rows for a blocking DDL migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '85e76746332e'
down_revision: Union[str, Sequence[str], None] = '46a9dd4fd0fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable columns — existing rows get NULL, triggers untouched.
    op.add_column('event', sa.Column('event_name',      sa.String(120), nullable=True))
    op.add_column('event', sa.Column('category',        sa.String(30),  nullable=True))
    op.add_column('event', sa.Column('schema_version',  sa.SmallInteger(), server_default='1', nullable=True))
    op.add_column('event', sa.Column('actor_type',      sa.String(20),  server_default=sa.text("'USER'"), nullable=True))
    op.add_column('event', sa.Column('actor_id',        postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('event', sa.Column('department',      sa.String(80),  nullable=True))
    op.add_column('event', sa.Column('visibility',      sa.String(20),  server_default=sa.text("'INTERNAL'"), nullable=True))
    op.add_column('event', sa.Column('correlation_id',  postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('event', sa.Column('causation_id',    postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('event', sa.Column('reference_number',sa.String(20),  nullable=True))
    op.add_column('event', sa.Column('idempotency_key', sa.String(200), nullable=True))

    # Index for projection queries: "all Comment.Added events for this tenant"
    op.create_index('idx_event_event_name', 'event', ['tenant_id', 'event_name'], unique=False)

    # Partial unique fence for integration/automation idempotency keys.
    op.create_index(
        'uq_event_idempotency_key', 'event',
        ['tenant_id', 'idempotency_key'],
        unique=True,
        postgresql_where=sa.text('idempotency_key IS NOT NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_event_idempotency_key', table_name='event')
    op.drop_index('idx_event_event_name',      table_name='event')
    op.drop_column('event', 'idempotency_key')
    op.drop_column('event', 'reference_number')
    op.drop_column('event', 'causation_id')
    op.drop_column('event', 'correlation_id')
    op.drop_column('event', 'visibility')
    op.drop_column('event', 'department')
    op.drop_column('event', 'actor_id')
    op.drop_column('event', 'actor_type')
    op.drop_column('event', 'schema_version')
    op.drop_column('event', 'category')
    op.drop_column('event', 'event_name')
