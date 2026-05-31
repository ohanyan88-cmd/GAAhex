"""spec 4.4 widen webhook_def.secret for encryption at rest

SPEC §4.4 ACTIVATE — Fernet-encrypted ciphertext is ~100+ ASCII characters even for a
short signing key, which would not fit inside the original ``String(255)`` definition.
This migration widens the column to TEXT so the new ``EncryptedString`` SQLAlchemy
TypeDecorator on ``WebhookDef.secret`` can persist ciphertext without truncation.

This migration is **additive and reversible** — it only changes the column type. It does
NOT touch the row data; the existing rows (if any) remain in their current form (plaintext
secrets). An operator-run Python sweep
(``backend/scripts/encrypt_webhook_secrets.py``) backfills the existing rows to
ciphertext post-deploy, because Fernet runs in Python and the encryption key never lives
in Postgres.

Revision ID: 6389266f4c19
Revises: b9d1c2e3a4f5
Create Date: 2026-05-31 19:09:04.660821

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6389266f4c19'
down_revision: Union[str, Sequence[str], None] = 'b9d1c2e3a4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Widen ``webhook_def.secret`` from ``String(255)`` to ``Text`` so Fernet
    ciphertext fits. No data change — backfill is a separate Python script."""
    op.alter_column(
        "webhook_def",
        "secret",
        existing_type=sa.String(length=255),
        type_=sa.Text(),
        existing_nullable=True,
    )


def downgrade() -> None:
    """Narrow back to ``String(255)``. WARNING: any ciphertext rows will be truncated;
    encrypted secrets must be re-keyed to plaintext (or dropped) before downgrading."""
    op.alter_column(
        "webhook_def",
        "secret",
        existing_type=sa.Text(),
        type_=sa.String(length=255),
        existing_nullable=True,
    )
