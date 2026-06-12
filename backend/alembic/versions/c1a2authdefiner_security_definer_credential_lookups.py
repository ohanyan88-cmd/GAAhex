"""C1a-2 — narrow SECURITY DEFINER credential-lookup functions for the request-gating auth path.

Revision ID: c1a2authdefiner
Revises: i5wf1perentity
Create Date: 2026-06-12

Replaces the broad pre-auth OwnerSessionLocal reads in current_user (JWT) / current_customer /
portal_login with narrow SECURITY DEFINER functions. The functions run elevated (as the owner role,
RLS-bypassing — that's the point: the request session is gaahex_app and has no tenant GUC yet, so a
direct read would default-deny) but are LOCKED DOWN:

  * SECURITY DEFINER + `SET search_path = pg_catalog, public` pinned on each function — without the
    pin, a search_path attack (shadowing a table/function) against an elevated function is privilege
    escalation, not just a data read.
  * Bodies are STATIC, parameterized SQL (LANGUAGE sql) — no EXECUTE, no string-built/dynamic queries.
    Inputs are bound parameters, never concatenated.
  * Each returns ONLY the MINIMAL identity columns the caller needs to verify the credential and derive
    the tenant. The full ORM object is re-read by the app UNDER RLS after the tenant GUC is set.
  * gx_auth_customer_by_email is SETOF (email is not yet uniquely constrained per tenant); the APP
    enforces exactly-one (len != 1 -> 401, never an arbitrary pick). The DB-level UNIQUE(tenant_id,email)
    that makes >1 impossible is tracked separately.

EXECUTE is granted to gaahex_app so the app role can invoke them; they are the only elevated surface
left in those three paths. (login/refresh/logout + portal_login's last_login write remain owner-session
handlers — tracked for C1a-3, alongside the boot-contract rolsuper backstop.)
"""
from alembic import op


revision = "c1a2authdefiner"
down_revision = "i5wf1perentity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # staff user identity by id (JWT path): minimal (id, tenant_id) — password not needed (JWT verified).
    op.execute("""
        CREATE OR REPLACE FUNCTION gx_auth_staff_user_by_id(p_id uuid)
        RETURNS TABLE(id uuid, tenant_id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
            SELECT u.id, u.tenant_id FROM app_user u WHERE u.id = p_id;
        $$;
    """)
    # customer identity by id (portal request gating): id, tenant, active flag, token cutoff.
    op.execute("""
        CREATE OR REPLACE FUNCTION gx_auth_customer_by_id(p_id uuid)
        RETURNS TABLE(id uuid, tenant_id uuid, is_active boolean, token_not_before timestamptz)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
            SELECT c.id, c.tenant_id, c.is_active, c.token_not_before
            FROM customer_user c WHERE c.id = p_id;
        $$;
    """)
    # customer credential by (tenant, email) (portal login): SETOF — app enforces exactly-one. Returns
    # exactly the columns portal_login uses (credential + its own token/response fields; password_hash is
    # used for verification then discarded, never returned to the client). No SELECT *.
    op.execute("""
        CREATE OR REPLACE FUNCTION gx_auth_customer_by_email(p_tenant uuid, p_email text)
        RETURNS TABLE(id uuid, tenant_id uuid, customer_id uuid, is_active boolean,
                      password_hash text, email text, name text)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
            SELECT c.id, c.tenant_id, c.customer_id, c.is_active, c.password_hash, c.email, c.name
            FROM customer_user c WHERE c.tenant_id = p_tenant AND c.email = p_email;
        $$;
    """)
    # The app role (gaahex_app) must be able to invoke them; they bypass RLS for exactly these lookups.
    for fn in ("gx_auth_staff_user_by_id(uuid)",
               "gx_auth_customer_by_id(uuid)",
               "gx_auth_customer_by_email(uuid, text)"):
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO gaahex_app;")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS gx_auth_customer_by_email(uuid, text);")
    op.execute("DROP FUNCTION IF EXISTS gx_auth_customer_by_id(uuid);")
    op.execute("DROP FUNCTION IF EXISTS gx_auth_staff_user_by_id(uuid);")
