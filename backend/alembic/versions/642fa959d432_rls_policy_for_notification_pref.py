"""rls policy for notification_pref

Revision ID: 642fa959d432
Revises: 61f6b7aa6a55
Create Date: 2026-05-26 12:10:16.463583

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '642fa959d432'
down_revision: Union[str, Sequence[str], None] = '61f6b7aa6a55'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# notification_pref was created AFTER the enable-RLS migration (3a9203795d07), so it missed the
# tenant_isolation policy. Same NULLIF-guarded pattern as the rest. (Grants already reach it via the
# ALTER DEFAULT PRIVILEGES set up in that migration.)

def upgrade() -> None:
    op.execute("ALTER TABLE notification_pref ENABLE ROW LEVEL SECURITY;")
    op.execute("""
        CREATE POLICY tenant_isolation ON notification_pref
          USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON notification_pref;")
    op.execute("ALTER TABLE notification_pref DISABLE ROW LEVEL SECURITY;")
