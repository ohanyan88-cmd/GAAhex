# B34 — Customer Portal Foundation — SELF-CONTAINED BUILD BRIEF

**For a separate Claude account/session.** This is a complete, standalone spec — build the whole of
B34 from it without needing to ask the author. The GAAex repo is at the folder you were given; work
there. When done, the repo owner hands the folder back to the coordinator for review + integration
into `main`.

## What you are building

The **foundation** of GAAex's customer self-service portal: a SEPARATE customer-facing app + the
customer authentication + the security boundary that guarantees **a logged-in customer can see ONLY
their own data**. You are NOT building bill-pay / tickets / service screens yet — those are B35/36/37
and will be built on top of this. B34 = secure auth + portal shell + a dashboard summary.

**This is security-critical. The #1 invariant, tested explicitly: a customer can never see another
customer's data, and a portal token can never reach staff endpoints (and vice-versa).**

## Architecture decisions (LOCKED — do not deviate)

- **Separate frontend app** at `frontend-portal/` (new Vite + React + TS). Customers must never load
  staff UI/code. Reuse the brand tokens from `frontend/src/styles.css` / `BRAND.md` (copy the CSS
  token block; dark-first Cobalt+Gold; **zero emoji, inline SVG icons only**).
- **Separate customer principal**: a new `CustomerUser` model, distinct from the staff `User`/RBAC.
- Backend lives in the SAME FastAPI app under a new **`/portal/*`** path namespace (NOT `/api/*`,
  NOT `/auth/*` — those are staff-only).

## Study these existing files first (copy their patterns)

- `backend/app/routers/auth.py` — staff login/JWT/`current_user` dependency. Mirror it for the portal,
  but with a DISTINCT token claim so the two token types are not interchangeable.
- `backend/app/models/user.py` — User model (bcrypt `password_hash`); `backend/app/security.py` (or
  wherever `hash_password`/`verify_password` live — find them).
- `backend/app/db.py` — `get_session`, `OwnerSessionLocal`, `set_tenant_guc` (RLS GUC per request).
- `backend/app/models/billing.py` (Invoice/Payment), `helpdesk.py` (HelpdeskTicket), `service.py`
  (Service) — the data a customer will eventually see (scoped by `customer_id` → a `record` row).
- A recent migration e.g. `backend/app/alembic/versions/b4f2c9d3e1a7_payment_order_tables.py` — the
  RLS policy SQL pattern. **Current alembic head = `b4f2c9d3e1a7`** — chain `down_revision` from it.
- `backend/app/seed.py` — how demo data is seeded (you'll seed a demo portal login).
- The customer entity is a `record` row with `entity_key="customer"` — `customer_id` columns across
  billing/helpdesk/service are FKs to `record.id`.

## Backend

### 1. Model `backend/app/models/customer_user.py` — `CustomerUser`
`from .base import Base`. Columns: id (UUID pk) · tenant_id (FK tenant NOT NULL index) ·
customer_id (FK record.id NOT NULL index — the customer this login represents) · email (String,
NOT NULL) · password_hash (String NOT NULL) · name (String nullable) · is_active (Boolean default
True) · created_at (server_default now) · last_login_at (DateTime tz nullable).
Add to `models/__init__.py` import + `__all__`.

### 2. Migration (down_revision = `'b4f2c9d3e1a7'`)
create_table customer_user + index tenant_id, customer_id, and a UNIQUE index on (tenant_id, email).
RLS block (copy exactly from the payment_order/workitem migration):
`ALTER TABLE customer_user ENABLE ROW LEVEL SECURITY;` + `CREATE POLICY tenant_isolation ON
customer_user USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid) WITH
CHECK (...)`. No FORCE. downgrade reverses.

### 3. Portal auth `backend/app/routers/portal_auth.py` — `APIRouter(prefix="/portal", tags=["portal"])`
- `POST /portal/auth/login` {email, password} → look up CustomerUser by (tenant — see note) + email,
  verify password (reuse the staff bcrypt verify), set last_login_at; issue a JWT whose payload has a
  DISTINCT marker: `{"sub": str(customer_user_id), "kind": "customer", "customer_id": ..., "tenant_id": ...}`.
  (Staff tokens have no `kind:"customer"` — that's the boundary.) Return `{access_token, customer: {...}}`.
  - **Tenant resolution note:** the portal is multi-tenant. For v1, resolve tenant the simplest safe
    way: a single demo tenant lookup is fine for the demo, but structure login to accept a tenant hint
    (subdomain/header/explicit tenant in the seeded demo) — DO NOT hardcode a tenant UUID. Document
    your choice clearly at the top of the file for the coordinator.
- `current_customer` dependency: decode the JWT; **reject if `kind != "customer"`** (a staff token →
  401); load the active CustomerUser; `await set_tenant_guc(s, cu.tenant_id)` so RLS applies. Return cu.
- `GET /portal/auth/me` → the customer profile (CustomerUser + linked customer record name).
- **Boundary the other direction:** confirm the staff `current_user` dependency REJECTS a portal
  token (a token with `kind:"customer"`). If staff `current_user` would accept it, add a guard so it
  does not. Test both directions.

### 4. Staff endpoint to provision a portal login (so customers get accounts)
In a staff router (e.g. add to `backend/app/routers/customer360.py` or a small new staff route under
`/api`): `POST /api/customers/{customer_id}/portal-users` {email, password?, name?} gated by
`current_user` + an appropriate permission (reuse `customer.edit` or add `portal_user.manage`) →
creates a CustomerUser for that customer. (Self-signup is deferred.)

### 5. Portal dashboard `backend/app/routers/portal.py` — `prefix="/portal"`
`GET /portal/me/summary` (dep `current_customer`) → the customer's OWN snapshot, every query filtered
by `customer_id == current_customer.customer_id`: `{customer:{name,...}, open_invoices_count,
open_tickets_count, active_services_count, balance_due_luma}`. Reuse the billing/helpdesk/service
models. This proves the scoped-read foundation; B35/36/37 add the detail screens.

### 6. Seed a demo portal login (so it's runnable)
In `seed.py` (a new `seed_portal_if_empty()` called in lifespan, or fold into existing seed): create
ONE CustomerUser for an existing demo customer record — e.g. `portal@demo.isp` / `portal123`. Make it
idempotent (only if none exist). Document the demo creds for the coordinator.

### 7. Register routers
Register `portal_auth.router` and `portal.router` in `main.py`. They're under `/portal` so they do
NOT collide with the `/api/{slug}` records router, but register them with the other routers anyway.

## Frontend — new app `frontend-portal/`

- Scaffold a minimal Vite React-TS app (own `package.json`, `vite.config.ts`, `index.html`, `src/`).
  Dev port 5175 (staff app uses 5173/5174). Point its API base at the same backend (env or constant).
- Copy the brand token CSS block from `frontend/src/styles.css` (the `:root{--bg...}` tokens) so it
  looks on-brand. Zero emoji; inline SVG.
- **LoginView** → POST /portal/auth/login → store the portal token (localStorage key distinct from
  staff, e.g. `gaaex-portal-token`) → portal shell.
- **Portal shell**: header (tenant/customer name, logout) + a sidebar/nav with **Dashboard** (Bills /
  Tickets / Service are placeholders/"coming soon" — B35-37 fill them).
- **DashboardView** → GET /portal/me/summary → show the customer's snapshot (balance due, open
  invoices/tickets, active services) as simple stat cards.
- Graceful 401 → bounce to login. No staff concepts anywhere in this app.

## Security invariants — MUST hold and MUST be tested (`backend/tests/test_portal.py`)

1. Portal login works; `/portal/auth/me` returns the right customer.
2. **Cross-customer denial**: create a 2nd customer + portal user; customer A's token on
   `/portal/me/summary` returns ONLY A's data; A can never see B's (scoped by customer_id).
3. **Token boundary both ways**: a portal token on a staff endpoint (e.g. `GET /api/customers`) →
   401/403; a staff token on `/portal/me/summary` → 401/403.
4. Provisioning: the staff `POST /api/customers/{id}/portal-users` creates a working login.
5. Inactive CustomerUser (is_active=False) cannot log in.

## Deliverables — report back to the coordinator

- Every file created/edited (backend + the new `frontend-portal/` app).
- The migration revision id (must chain from `b4f2c9d3e1a7`).
- Demo portal creds + how tenant is resolved at login.
- `frontend-portal` build/run command + that `npm run build` / `tsc` passes.
- Backend: run `AI_PROVIDER=none AI_API_KEY= .venv/Scripts/python.exe -m pytest -q` from `backend/`
  and report it stays green (your new tests + no regressions). Note: tests build schema via
  `create_all`, so importing the new model in `models/__init__.py` is enough for tests; the migration
  is validated separately by the coordinator.
- A short SECURITY note confirming invariants 1–5 above are tested and pass.

## Hard rules (lifted from the GAAex BATCH-PLAYBOOK)

- Keep changes ADDITIVE — do not break existing staff auth, routes, or tests.
- Money is integer **luma** (AMD minor units; 1 ֏ = 100 luma) — never float.
- No emoji in product UI; inline SVG only. Commits: NO "Co-Authored-By" trailer.
- Do NOT touch the kernel engines or existing module routers beyond registering the portal routers +
  the one provisioning endpoint + the model import + the seed hook.
- When unsure about a cross-cutting choice, pick the SAFEST option for customer data isolation and
  document the decision at the top of the relevant file for the coordinator.
