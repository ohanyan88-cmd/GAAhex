"""webhook_delivery.webhook_id → ON DELETE CASCADE (BUG-WHK1)

DELETE /api/webhooks/{id} returned 500 once a webhook had any WebhookDelivery rows:
the FK webhook_delivery.webhook_id had no ON DELETE action, so Postgres refused the
parent delete. This migration recreates that FK with ON DELETE CASCADE, so deleting a
WebhookDef removes its delivery log at the DB layer. The ORM model carries the same
`ondelete="CASCADE"` (so create_all-built test DBs already have it); this migration
applies it to migration-built dev/prod databases.

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-10

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Recreate the webhook_delivery → webhook_def FK with ON DELETE CASCADE.

    The existing constraint name is discovered dynamically (Postgres' default is
    `webhook_delivery_webhook_id_fkey`, but discovery survives any prior naming) before
    it's dropped and recreated.
    """
    op.execute(
        """
        DO $$
        DECLARE conname text;
        BEGIN
            SELECT con.conname INTO conname
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
            WHERE rel.relname = 'webhook_delivery'
              AND con.contype = 'f'
              AND att.attname = 'webhook_id'
            LIMIT 1;
            IF conname IS NOT NULL THEN
                EXECUTE format('ALTER TABLE webhook_delivery DROP CONSTRAINT %I', conname);
            END IF;
        END $$;
        """
    )
    op.create_foreign_key(
        'webhook_delivery_webhook_id_fkey',
        'webhook_delivery', 'webhook_def',
        ['webhook_id'], ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    """Restore the FK without a cascade action (the pre-BUG-WHK1 shape)."""
    op.drop_constraint('webhook_delivery_webhook_id_fkey', 'webhook_delivery', type_='foreignkey')
    op.create_foreign_key(
        'webhook_delivery_webhook_id_fkey',
        'webhook_delivery', 'webhook_def',
        ['webhook_id'], ['id'],
    )
