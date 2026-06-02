"""Webhook Standard (file 12, standard 70) — extension to WebhookDef + WebhookDelivery.

Revision ID: c4f7a9d31e58
Revises: c4f7a2b9e618
Create Date: 2026-06-02 16:10:00.000000

Additive-only column adds + indexes + backfill. NO destructive changes — the legacy
`active` boolean (WebhookDef) and `status` varchar (WebhookDelivery) are PRESERVED for
back-compat. Old code reads the legacy columns; new code reads the standard ones.

Changes
-------
WebhookDef:
  + subscription_status varchar(20) NULL  server_default='ACTIVE'
      Webhook Standard SubscriptionStatus enum:
        ACTIVE, INACTIVE, SUSPENDED, FAILED, DEPRECATED
  + reference_number   varchar(20) NULL  (WHK-000001 — file 00 prefix)
  + UNIQUE (tenant_id, reference_number)  = uq_webhook_def_reference_number
  + Backfill: active=True → 'ACTIVE',  active=False → 'INACTIVE'

WebhookDelivery:
  + delivery_status  varchar(20)  NULL  server_default='PENDING'
      Webhook Standard DeliveryStatus enum:
        PENDING, SENT, DELIVERED, FAILED, RETRYING, DEAD_LETTERED
  + event_name       varchar(120) NULL
  + correlation_id   uuid         NULL
  + causation_id     uuid         NULL
  + idempotency_key  varchar(200) NULL
  + attempt_number   integer      NOT NULL  server_default='1'
  + Partial UNIQUE INDEX uq_webhook_delivery_idempotency
      ON (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
  + Backfill: status='QUEUED' → delivery_status='PENDING'
              status='SENT'   → delivery_status='SENT'
              status='FAILED' → delivery_status='FAILED'

Parent
------
02b1e0fef42e (Wave A relationship_add_first_class — current head). Apply with the explicit
revision hash (NOT `head`) because parallel agents may be branching off the same parent.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'c4f7a9d31e58'
down_revision: Union[str, Sequence[str], None] = 'c4f7a2b9e618'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── WebhookDef ────────────────────────────────────────────────────────────
    op.add_column(
        'webhook_def',
        sa.Column('subscription_status', sa.String(length=20),
                  server_default=sa.text("'ACTIVE'"), nullable=True),
    )
    op.add_column(
        'webhook_def',
        sa.Column('reference_number', sa.String(length=20), nullable=True),
    )
    op.create_unique_constraint(
        'uq_webhook_def_reference_number',
        'webhook_def',
        ['tenant_id', 'reference_number'],
    )

    # Backfill — legacy `active` boolean maps onto the 5-value enum.
    op.execute("""
        UPDATE webhook_def
           SET subscription_status = CASE WHEN active = TRUE THEN 'ACTIVE' ELSE 'INACTIVE' END
         WHERE subscription_status IS NULL;
    """)

    # ── WebhookDelivery ───────────────────────────────────────────────────────
    op.add_column(
        'webhook_delivery',
        sa.Column('delivery_status', sa.String(length=20),
                  server_default=sa.text("'PENDING'"), nullable=True),
    )
    op.add_column(
        'webhook_delivery',
        sa.Column('event_name', sa.String(length=120), nullable=True),
    )
    op.add_column(
        'webhook_delivery',
        sa.Column('correlation_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'webhook_delivery',
        sa.Column('causation_id', postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        'webhook_delivery',
        sa.Column('idempotency_key', sa.String(length=200), nullable=True),
    )
    op.add_column(
        'webhook_delivery',
        sa.Column('attempt_number', sa.Integer(),
                  server_default=sa.text("1"), nullable=False),
    )

    # Partial UNIQUE INDEX — Webhook Standard idempotency guarantee.
    op.create_index(
        'uq_webhook_delivery_idempotency',
        'webhook_delivery',
        ['tenant_id', 'idempotency_key'],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )

    # Backfill — legacy `status` varchar maps onto the 6-value enum.
    op.execute("""
        UPDATE webhook_delivery
           SET delivery_status = CASE
                  WHEN status = 'QUEUED' THEN 'PENDING'
                  WHEN status = 'SENT'   THEN 'SENT'
                  WHEN status = 'FAILED' THEN 'FAILED'
                  ELSE 'PENDING'
              END
         WHERE delivery_status IS NULL;
    """)


def downgrade() -> None:
    # ── WebhookDelivery ───────────────────────────────────────────────────────
    op.drop_index('uq_webhook_delivery_idempotency', table_name='webhook_delivery')
    op.drop_column('webhook_delivery', 'attempt_number')
    op.drop_column('webhook_delivery', 'idempotency_key')
    op.drop_column('webhook_delivery', 'causation_id')
    op.drop_column('webhook_delivery', 'correlation_id')
    op.drop_column('webhook_delivery', 'event_name')
    op.drop_column('webhook_delivery', 'delivery_status')

    # ── WebhookDef ────────────────────────────────────────────────────────────
    op.drop_constraint('uq_webhook_def_reference_number', 'webhook_def', type_='unique')
    op.drop_column('webhook_def', 'reference_number')
    op.drop_column('webhook_def', 'subscription_status')
