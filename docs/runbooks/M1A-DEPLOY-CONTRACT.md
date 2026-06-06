# M1-A Deploy Contract — Production Multi-Tenancy Hardening (Wave 4)

This document describes the **production deploy contract** that the GAAhex backend
enforces at boot time so that Postgres Row-Level Security (RLS) actually engages.
Without this contract, every RLS policy in Wave 3 becomes decorative and tenant
isolation is silently lost.

---

## Why the role split is mandatory

GAAhex relies on Postgres RLS to keep tenants isolated at the database layer.
Postgres has a hard rule: **the table OWNER bypasses RLS, always.** No `FORCE
ROW LEVEL SECURITY` setting changes that for the role that owns the table.

This means an app connection that runs as the table owner is effectively
unfiltered. RLS will return every row in the table regardless of the
`gaahex.tenant_id` GUC that the request handler binds. Multi-tenancy collapses
into the application-layer filters alone — exactly the regression we are
trying to prevent.

The fix is to run the app under a SECOND Postgres role that does NOT own the
tables. RLS then engages for every query the app issues, and the table-owner
role is reserved for migrations and the small handful of pre-auth /
no-tenant code paths (seed, login lookup, `/org-tree`) that legitimately need
the bypass.

---

## The two roles

| Role | Purpose | Privileges |
| --- | --- | --- |
| `gaahex` | Owns the schema. Used by Alembic migrations and by the pre-auth / no-tenant code paths via `OWNER_DATABASE_URL`. | Owns every table. Bypasses RLS by Postgres design. |
| `gaahex_app` | Used by the application for normal request handling via `DATABASE_URL`. | `NOSUPERUSER`, `NOBYPASSRLS`. Granted `SELECT / INSERT / UPDATE / DELETE` on the tenant-scoped tables. RLS applies. |

---

## Variables to set in production

```bash
ENVIRONMENT=production
DATABASE_URL=postgresql+asyncpg://gaahex_app:<app-password>@db-host:5432/gaahex
OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:<owner-password>@db-host:5432/gaahex
```

In dev / test / CI we deliberately leave `ENVIRONMENT` unset (default
`"development"`) and reuse a single role — typically `gaahex` — for both URLs.
That is convenient and matches the existing test pattern: `tests/test_rls.py`
spins up its own `gaahex_app` engine when it needs to validate RLS in
isolation.

---

## Postgres setup

The owner role is created by your normal database bootstrap. To add the app
role, connect as a superuser and run:

```sql
-- Create the app role; NOSUPERUSER + NOBYPASSRLS is the whole point.
CREATE ROLE gaahex_app LOGIN PASSWORD '<app-password>' NOSUPERUSER NOBYPASSRLS;

-- Allow the app role to actually use the schema the owner created.
GRANT USAGE ON SCHEMA public TO gaahex_app;

-- DML rights on every existing table — the migration runner has equivalent
-- ALTER DEFAULT PRIVILEGES so future tables inherit the same grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gaahex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gaahex_app;

-- Allow the app role to set the per-request RLS GUC.
GRANT SET ON PARAMETER gaahex.tenant_id TO gaahex_app;
```

The Wave 3 RLS migration already runs the equivalent of this block; the manual
form above is provided so on-call engineers can verify the grants directly.

---

## The startup check

`backend/app/config.py` exposes `_assert_production_deploy_contract()`. It is
called from the FastAPI lifespan handler in `backend/app/main.py` before any
seeding runs.

Behavior:

- `settings.environment != "production"` → **no-op**. Dev, test, staging, CI
  all return immediately.
- `settings.environment == "production"` → the function compares
  `DATABASE_URL` and `OWNER_DATABASE_URL` (the latter falls back to the former
  if unset) and **refuses to boot** if they are equal OR if their Postgres
  usernames are the same.

### Error messages

```
M1-A production deploy contract violation: DATABASE_URL and OWNER_DATABASE_URL
are equal. In production these MUST be different Postgres roles (gaahex_app for
the app, gaahex for the owner) so that Row-Level Security policies engage. See
docs/M1A-DEPLOY-CONTRACT.md.
```

You shipped to prod with a single URL. RLS would not have engaged. Fix:
set `OWNER_DATABASE_URL` explicitly to the `gaahex` URL and keep `DATABASE_URL`
on `gaahex_app`.

```
M1-A production deploy contract violation: DATABASE_URL and OWNER_DATABASE_URL
use the same role ('gaahex'). The app role must be different from the owner
role. See docs/M1A-DEPLOY-CONTRACT.md.
```

The two URLs differ (perhaps in database name or host) but they connect as the
same Postgres role. RLS would still not engage because that role is the table
owner. Fix: point `DATABASE_URL` at the `gaahex_app` role.

---

## Why dev / test stays single-role

Running two Postgres roles locally is real friction for every contributor.
The test suite already validates RLS where it matters (`tests/test_rls.py`
creates a dedicated `gaahex_app` engine in-process), so the broader suite can
run as the owner role without losing coverage.

Production deploys do not get this convenience: the guard is loud and
non-negotiable. `ENVIRONMENT=production` is the single switch that flips
it on.
