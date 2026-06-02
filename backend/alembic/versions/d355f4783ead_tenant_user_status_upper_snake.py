"""tenant_user_status_upper_snake

Revision ID: d355f4783ead
Revises: 7b1e0d3b41fd
Create Date: 2026-06-02

B1 enum-standard follow-up: normalise ``tenant.status`` and ``app_user.status``
column values to UPPER_SNAKE_CASE.

Known lowercase values in production (from code audit):
  tenant.status  : 'active'  (sole value — no 'inactive'/'suspended' writers found in tenant router)
  app_user.status: 'active', 'inactive'

There are NO existing CHECK constraints on these columns (verified against the
initial-schema migration ``1278af39f621``), so no constraint swap is needed.

Upgrade strategy — single UPDATE per table, idempotent:
  * Filter on the exact lowercase set; rows already UPPER_SNAKE are untouched.

Downgrade strategy — reverses the same set to lowercase.

Idempotent: re-running upgrade / downgrade filters on the target value set only.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd355f4783ead'
down_revision: Union[str, Sequence[str], None] = '7b1e0d3b41fd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Uppercase tenant.status and app_user.status values."""
    # ------------------------------------------------------------------
    # 1. tenant.status  ('active' → 'ACTIVE')
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE tenant SET status = UPPER(status) "
        "WHERE status IN ('active', 'inactive', 'suspended', 'pending', 'locked')"
    ))

    # ------------------------------------------------------------------
    # 2. app_user.status  ('active' → 'ACTIVE', 'inactive' → 'INACTIVE')
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE app_user SET status = UPPER(status) "
        "WHERE status IN ('active', 'inactive', 'suspended', 'pending', 'locked')"
    ))


def downgrade() -> None:
    """Lowercase tenant.status and app_user.status values back to the pre-B1 form."""
    # ------------------------------------------------------------------
    # 2. app_user.status  ('ACTIVE' → 'active', 'INACTIVE' → 'inactive')
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE app_user SET status = LOWER(status) "
        "WHERE status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING', 'LOCKED')"
    ))

    # ------------------------------------------------------------------
    # 1. tenant.status  ('ACTIVE' → 'active')
    # ------------------------------------------------------------------
    op.execute(sa.text(
        "UPDATE tenant SET status = LOWER(status) "
        "WHERE status IN ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING', 'LOCKED')"
    ))
