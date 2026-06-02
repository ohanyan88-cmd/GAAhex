"""M1-C.1 — Stripe webhook event idempotency + audit table.

Creates ``stripe_webhook_event`` so the Stripe webhook router can dedupe Stripe's
at-least-once delivery (the same ``evt_...`` arrives more than once if our handler
takes too long to ack) and keep an audit trail of every event we've seen.

Schema:
  * ``id``                uuid PK
  * ``tenant_id``         uuid FK → tenant.id, NULLABLE
                          (events fired from the Stripe dashboard may lack our metadata)
  * ``stripe_event_id``   varchar(255) UNIQUE — Stripe's ``evt_...``; dedupe key
  * ``event_type``        varchar(120)  — e.g. ``payment_intent.succeeded``
  * ``processed_at``      timestamptz DEFAULT now()
  * ``payload_json``      jsonb         — full event snapshot for replay/diagnostics
  * ``result``            varchar(20)   — 'handled' | 'ignored' | 'errored'
  * ``error_message``     text NULL

RLS: NOT applied. The webhook router runs with the owner role and writes events that may
span tenants (some without tenant scope at all). Operator-side reads happen via direct DB
inspection / a future internal admin page, not the tenant-facing app surface.

Revision ID: a7c9e5b3f1d8
Revises: e7f4a2b9c8d1
Create Date: 2026-06-02
"""
import sqlalchemy as sa
from alembic import op


revision = 'a7c9e5b3f1d8'
down_revision = 'e7f4a2b9c8d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'stripe_webhook_event',
        sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id'), nullable=True),
        sa.Column('stripe_event_id', sa.String(255), nullable=False),
        sa.Column('event_type', sa.String(120), nullable=False),
        sa.Column('processed_at', sa.DateTime(timezone=True),
                  nullable=False, server_default=sa.func.now()),
        sa.Column('payload_json', sa.dialects.postgresql.JSONB,
                  nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('result', sa.String(20), nullable=False, server_default='handled'),
        sa.Column('error_message', sa.Text, nullable=True),
        sa.UniqueConstraint('stripe_event_id', name='uq_stripe_webhook_event_id'),
    )
    op.create_index('ix_stripe_webhook_event_type', 'stripe_webhook_event', ['event_type'])
    op.create_index('ix_stripe_webhook_event_tenant', 'stripe_webhook_event', ['tenant_id'])


def downgrade() -> None:
    op.drop_index('ix_stripe_webhook_event_tenant', table_name='stripe_webhook_event')
    op.drop_index('ix_stripe_webhook_event_type', table_name='stripe_webhook_event')
    op.drop_table('stripe_webhook_event')
