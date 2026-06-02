"""Approval Ownership Standard (file 02) — extend `approval` with 6 nullable columns.

Revision ID: c4f7a2b9e618
Revises: 02b1e0fef42e
Create Date: 2026-06-02 17:00:00.000000

Adds the file-02 columns to the existing `approval` table:

  decision               varchar(30)        ApprovalDecision (APPROVE|REJECT|REQUEST_CHANGES|DELEGATE|CANCEL_REQUEST)
  delegated_to_user_id   uuid FK app_user   set when decision=DELEGATE
  change_request_note    text               set when decision=REQUEST_CHANGES
  signature_method       varchar(40)        TOTP|DIGITAL_CERT|INLINE_PASSWORD|… (NULL=unsigned)
  signature_value        text               opaque signature blob (NULL=unsigned)
  signed_at              timestamptz        signature timestamp

All columns nullable for back-compat: rows created before this migration keep their
existing semantics; the 5-value ApprovalDecision applies forward from this revision.
The new terminal status `CANCELLED` widens the existing varchar(20) `status` column —
no DDL change needed since the column already accepts arbitrary 20-char values.

RLS / indexes: no changes (the existing tenant_isolation policy + tenant indexes carry
over unchanged for additive columns).

Additive + reversible. No data migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f7a2b9e618'
down_revision: Union[str, Sequence[str], None] = '02b1e0fef42e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('approval', sa.Column('decision', sa.String(length=30), nullable=True))
    op.add_column('approval', sa.Column('delegated_to_user_id', sa.UUID(), nullable=True))
    op.add_column('approval', sa.Column('change_request_note', sa.Text(), nullable=True))
    op.add_column('approval', sa.Column('signature_method', sa.String(length=40), nullable=True))
    op.add_column('approval', sa.Column('signature_value', sa.Text(), nullable=True))
    op.add_column('approval', sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        'fk_approval_delegated_to_user_id',
        'approval', 'app_user',
        ['delegated_to_user_id'], ['id'],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_approval_delegated_to_user_id', 'approval', type_='foreignkey')
    op.drop_column('approval', 'signed_at')
    op.drop_column('approval', 'signature_value')
    op.drop_column('approval', 'signature_method')
    op.drop_column('approval', 'change_request_note')
    op.drop_column('approval', 'delegated_to_user_id')
    op.drop_column('approval', 'decision')
