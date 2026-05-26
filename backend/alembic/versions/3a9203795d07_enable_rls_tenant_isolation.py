"""enable RLS tenant isolation

Revision ID: 3a9203795d07
Revises: 4f162718a0be
Create Date: 2026-05-26 11:00:11.272456

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3a9203795d07'
down_revision: Union[str, Sequence[str], None] = '4f162718a0be'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (table, tenant key column). RLS keys on this column matching the gaaex.tenant_id GUC.
# `tenant` keys on its own `id`; every other tenant-scoped table on `tenant_id`.
_TABLES = [
    ("tenant", "id"),
    ("org_node", "tenant_id"), ("app_user", "tenant_id"),
    ("entity_def", "tenant_id"), ("field_def", "tenant_id"), ("status_def", "tenant_id"),
    ("relation_def", "tenant_id"), ("workflow_def", "tenant_id"),
    ("record", "tenant_id"), ("event", "tenant_id"),
    ("permission_def", "tenant_id"), ("role_def", "tenant_id"), ("assignment", "tenant_id"),
    ("notification_def", "tenant_id"), ("notification", "tenant_id"),
    ("pending_approval", "tenant_id"), ("saved_view_def", "tenant_id"),
    ("dashboard_def", "tenant_id"), ("widget_def", "tenant_id"),
    ("thread", "tenant_id"), ("message", "tenant_id"), ("refresh_token", "tenant_id"),
]

# NOTE: deliberately NO `FORCE ROW LEVEL SECURITY`. The table owner / superuser (the `gaaex` role
# the app + migrations + seeding currently use) BYPASSES RLS, so enabling policies is a no-op for the
# running app today — nothing breaks. Enforcement turns on when the app connects as the dedicated
# NOSUPERUSER `gaaex_app` role (created below); the isolation proof test exercises that role.


def upgrade() -> None:
    # A dedicated app role that does NOT bypass RLS (the enforcement role; the app flips to it later).
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gaaex_app') THEN
                CREATE ROLE gaaex_app LOGIN PASSWORD 'gaaex_app' NOSUPERUSER NOBYPASSRLS;
            END IF;
        END $$;
    """)
    op.execute("GRANT USAGE ON SCHEMA public TO gaaex_app;")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gaaex_app;")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gaaex_app;")
    op.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public "
               "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gaaex_app;")

    for table, key in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        # current_setting(..., true) → missing GUC yields NULL → predicate NULL → row excluded
        # (default-DENY, never leak). USING governs read/update/delete; WITH CHECK blocks writing a
        # row under another tenant.
        # NULLIF(..., '') so BOTH an unset GUC (NULL) and a reset-to-empty GUC ('') become NULL →
        # predicate NULL → row excluded (default-deny). A bare `''::uuid` would raise instead.
        op.execute(f"""
            CREATE POLICY tenant_isolation ON {table}
              USING ({key} = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
              WITH CHECK ({key} = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
        """)


def downgrade() -> None:
    # Drop the policies + disable RLS. We deliberately DO NOT drop the `gaaex_app` role here: it is a
    # cluster-wide object that may hold grants in other databases, so a per-database migration can't
    # drop it cleanly. The role is harmless without policies; remove it manually if ever needed.
    for table, _key in _TABLES:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table};")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;")
