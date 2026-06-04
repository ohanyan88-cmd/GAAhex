"""privacy_request — GDPR Article 15 / Article 17 request tracking.

Audit findings C2 (right-to-access) + C3 (right-to-erasure) flagged that the platform has
ZERO infrastructure for the two GDPR data-subject rights an ISP customer can exercise. This
migration creates the workflow row that records each request, its approver, and the export
storage key (ACCESS) or redaction summary (ERASURE — summary lives on the COMPLETED Event).

Standard tenant-scoped table per the d1a7b2c4e6f8 (product_version RLS close) template:
  * CREATE TABLE with tenant_id + FK + index.
  * RLS enabled with the canonical tenant_isolation NULLIF-guarded policy.
  * Reversible downgrade.

C4 (PURGED state decorative) is closed by the app-side wiring in `routers/lifecycle.purge` →
`services/privacy.anonymize_customer`. The DB-layer change here is just the request-tracking
table; the actual PII redaction is a state mutation on the existing customer Record (which
is what the GDPR Article 17 financial-retention exception calls for — preserve the audit
trail and financial documents, redact the personal identifiers).

Revision ID: a2c4d6e8b1f3
Revises: f8c5b1e9a3d2
Create Date: 2026-06-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a2c4d6e8b1f3'
down_revision: Union[str, Sequence[str], None] = 'f8c5b1e9a3d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create privacy_request, FK + index, enable RLS, install tenant_isolation policy."""
    op.create_table(
        'privacy_request',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('requestor_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('request_type', sa.String(length=20), nullable=False),
        # No FK on customer_record_id — see model docstring. A PURGED+anonymized customer
        # Record stays in place (Article 17 financial-retention preserves the audit trail);
        # a strict FK would block legitimate follow-up requests against that same row.
        sa.Column('customer_record_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default=sa.text("'REQUESTED'")),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('approver_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('export_storage_key', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name='fk_privacy_request_tenant_id'),
        sa.ForeignKeyConstraint(['requestor_user_id'], ['app_user.id'], name='fk_privacy_request_requestor_user_id'),
        sa.ForeignKeyConstraint(['approver_user_id'], ['app_user.id'], name='fk_privacy_request_approver_user_id'),
    )
    # RLS predicate index + per-customer lookup index.
    op.create_index('ix_privacy_request_tenant_id', 'privacy_request', ['tenant_id'])
    op.create_index('ix_privacy_request_customer_record_id', 'privacy_request', ['customer_record_id'])

    # Canonical tenant_isolation policy — same NULLIF-guarded pattern as every other tenant-scoped
    # table (3a9203795d07, e7f4a2b9c8d1, f8a1b2c3d4e5, d1a7b2c4e6f8). No FORCE: matches repo
    # convention — the owner role bypasses by design; gaahex_app NOSUPERUSER enforces.
    op.execute("ALTER TABLE privacy_request ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON privacy_request;")
    op.execute("""
        CREATE POLICY tenant_isolation ON privacy_request
          USING      (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    """Drop the policy + RLS flag, then the indexes + table."""
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON privacy_request;")
    op.execute("ALTER TABLE privacy_request DISABLE ROW LEVEL SECURITY;")
    op.drop_index('ix_privacy_request_customer_record_id', table_name='privacy_request')
    op.drop_index('ix_privacy_request_tenant_id', table_name='privacy_request')
    op.drop_table('privacy_request')
