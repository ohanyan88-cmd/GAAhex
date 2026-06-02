"""idempotency_request table — Idempotency-Key middleware store (API Standard 66).

Revision ID: c8d3a4f91b6e
Revises: e4f9c2a8b716
Create Date: 2026-06-02 18:00:00.000000

One additive table: ``idempotency_request``. Stores a 24h-retained fingerprint
of every successful POST/PATCH/DELETE that carried an ``Idempotency-Key``
header, plus the cached response status + JSON body for replay on retry.

UniqueConstraint ``(tenant_id, idempotency_key, method, path)`` is the
collision fence — same key + same shape collapses to one row. The middleware
treats ``expires_at < now`` as absent so stale rows fall out of the cache
naturally; a periodic sweeper can DROP them via ``ix_idem_expires``.

RLS tenant_isolation NULLIF-guarded, matching the existing 18062d97ef59 /
02b1e0fef42e pattern. Down-revision = 02b1e0fef42e (relationship table) per
the brief.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c8d3a4f91b6e'
down_revision: Union[str, Sequence[str], None] = 'e4f9c2a8b716'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'idempotency_request',
        sa.Column('id',                  postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id',           postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('idempotency_key',     sa.String(length=200), nullable=False),
        sa.Column('method',              sa.String(length=10),  nullable=False),
        sa.Column('path',                sa.String(length=500), nullable=False),
        sa.Column('request_fingerprint', sa.String(length=64),  nullable=False),
        sa.Column('response_status',     sa.Integer(),          nullable=False),
        sa.Column('response_body',       postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_at',          sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('expires_at',          sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'tenant_id', 'idempotency_key', 'method', 'path',
            name='uq_idempotency_request',
        ),
    )
    op.create_index(
        op.f('ix_idempotency_request_tenant_id'),
        'idempotency_request', ['tenant_id'], unique=False,
    )
    op.create_index(
        'ix_idem_expires', 'idempotency_request', ['expires_at'], unique=False,
    )

    # RLS tenant_isolation (NULLIF-guarded — matches 18062d97ef59 pattern).
    op.execute("ALTER TABLE idempotency_request ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON idempotency_request
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON idempotency_request;")
    op.drop_index('ix_idem_expires', table_name='idempotency_request')
    op.drop_index(op.f('ix_idempotency_request_tenant_id'), table_name='idempotency_request')
    op.drop_table('idempotency_request')
