"""UUIDv7 cutover marker - app-side generation.

Per Standard 8 (ID), every new primary id is UUIDv7. This is purely a Python-side
change (default_factory=uuid7); legacy uuid4 ids remain valid forever in the same
`uuid` column type. No DDL change.

Revision ID: 41c549f6cf47
Revises: a7c9e5b3f1d8
Create Date: 2026-06-02 09:36:22.735691
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '41c549f6cf47'
down_revision: Union[str, Sequence[str], None] = 'a7c9e5b3f1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No-op DDL marker. The UUIDv7 cutover is purely Python-side
    # (default_factory=uuid7 on every model PK + UUID FK default). Postgres
    # `uuid` columns accept v7 the same as v4 — no column types, server defaults,
    # or constraints change here. Legacy uuid4 rows remain valid.
    pass


def downgrade() -> None:
    # No-op — there is no DDL to undo. Reverting the cutover (if ever needed)
    # is a code-only rollback (revert the default_factory=uuid7 swap).
    pass
