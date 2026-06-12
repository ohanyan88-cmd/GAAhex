"""C1a-2 SECURITY DEFINER credential-lookup functions — installed via create_all (after_create DDL).

Migration `c1a2authdefiner` installs these (plus a GRANT to the gaahex_app role) on migration-backed
databases. But the app DEPENDS on them at runtime (current_user / current_customer / portal_login),
and the test suite — plus any create_all bootstrap — builds the schema WITHOUT running migrations, so
they must ALSO be created here as `after_create` DDL on Base.metadata. Otherwise every authenticated
request fails in those DBs (the exact create_all-vs-migration gap the migration-invariant gate exists
to catch).

No GRANT here: create_all runs as the owner role, which can execute its own functions. The GRANT to the
NOBYPASSRLS app role lives only in the migration, for production.

The function bodies are identical to the migration's (static, parameterized, SECURITY DEFINER, pinned
search_path). Keep the two in sync — the migration is the historical snapshot; this is the live install
path for create_all.
"""
from sqlalchemy import DDL, event

from .base import Base

_FN_STAFF_BY_ID = """
CREATE OR REPLACE FUNCTION gx_auth_staff_user_by_id(p_id uuid)
RETURNS TABLE(id uuid, tenant_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $func$
    SELECT u.id, u.tenant_id FROM app_user u WHERE u.id = p_id;
$func$;
"""

_FN_CUSTOMER_BY_ID = """
CREATE OR REPLACE FUNCTION gx_auth_customer_by_id(p_id uuid)
RETURNS TABLE(id uuid, tenant_id uuid, is_active boolean, token_not_before timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $func$
    SELECT c.id, c.tenant_id, c.is_active, c.token_not_before FROM customer_user c WHERE c.id = p_id;
$func$;
"""

_FN_STAFF_BY_EMAIL = """
CREATE OR REPLACE FUNCTION gx_auth_staff_by_email(p_email text)
RETURNS TABLE(id uuid, tenant_id uuid, password_hash text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $func$
    SELECT u.id, u.tenant_id, u.password_hash, u.status FROM app_user u WHERE u.email = p_email;
$func$;
"""

_FN_CUSTOMER_BY_EMAIL = """
CREATE OR REPLACE FUNCTION gx_auth_customer_by_email(p_tenant uuid, p_email text)
RETURNS TABLE(id uuid, tenant_id uuid, customer_id uuid, is_active boolean,
              password_hash text, email text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $func$
    SELECT c.id, c.tenant_id, c.customer_id, c.is_active, c.password_hash, c.email, c.name
    FROM customer_user c WHERE c.tenant_id = p_tenant AND c.email = p_email;
$func$;
"""

# One listener per function (single statements — robust for the asyncpg DBAPI), fired after create_all.
for _sql in (_FN_STAFF_BY_ID, _FN_STAFF_BY_EMAIL, _FN_CUSTOMER_BY_ID, _FN_CUSTOMER_BY_EMAIL):
    event.listen(Base.metadata, "after_create", DDL(_sql))
