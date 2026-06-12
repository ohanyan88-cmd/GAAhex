"""C1a-3a — gx_auth_staff_by_email SECURITY DEFINER function for the staff login credential read.

Revision ID: c1a3a_staffmail
Revises: c1a2authdefiner
Create Date: 2026-06-12

Lets /auth/login read the staff user by email WITHOUT a broad RLS-bypassing OwnerSessionLocal: the
request session is gaahex_app (no tenant GUC yet pre-auth), so a direct read would default-deny. This
elevated function (pinned search_path, static parameterized SQL, minimal columns) returns only the
credential-verification fields; the full User is re-read UNDER RLS once the GUC is bound. email is
UNIQUE (ix_app_user_email) so at most one row — the app keeps a len!=1 belt regardless.

Also installed via after_create DDL (models/auth_functions.py) so create_all (tests/bootstrap) has it.
"""
from alembic import op


revision = "c1a3a_staffmail"
down_revision = "c1a2authdefiner"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION gx_auth_staff_by_email(p_email text)
        RETURNS TABLE(id uuid, tenant_id uuid, password_hash text, status text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
            SELECT u.id, u.tenant_id, u.password_hash, u.status FROM app_user u WHERE u.email = p_email;
        $$;
    """)
    op.execute("GRANT EXECUTE ON FUNCTION gx_auth_staff_by_email(text) TO gaahex_app;")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS gx_auth_staff_by_email(text);")
