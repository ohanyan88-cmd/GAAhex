# Production Deployment Hardening Guide

**Batch:** 38 (launch hardening)  
**Date:** 2026-05-27  
**Status:** shipped & integrated

This guide covers the security and operational hardening required before running GAAhex in production or any multi-tenant environment. **Use this as a pre-launch checklist** before going live with real data.

---

## Overview: the five hardening levers

GAAhex Phase 1 enforces tenant isolation and auth security at five points. Each has a configuration lever and a startup guard. Check all five before launch.

| # | Lever | Setting | Default | Prod value | Guard |
|---|-------|---------|---------|-----------|-------|
| **S1** | JWT secret strength | `REQUIRE_STRONG_SECRETS` | `false` | `true` | Boot fails if `JWT_SECRET < 32 bytes` or is the dev default |
| **S3** | CORS allowed origins | `CORS_ORIGINS` | `*` | `https://app.example.com` | Locked by FastAPI CORS middleware before routes run |
| **S4/S5** | Multi-tenant portal guard | `tenant_id` resolution | — | Explicit in login body | Portal login rejects implicit-fallback when `> 1 active tenant` |
| **RLS** | Database role & policies | `DATABASE_URL` + `OWNER_DATABASE_URL` | both `gaahex` (superuser) | app=`gaahex_app`, owner=`gaahex` | Startup logs warning if app role is a superuser |
| **E38** | Webhook SSRF guard | `WEBHOOK_ALLOW_PRIVATE` | `false` | `false` (internet-facing) | `_is_safe_webhook_url()` blocks private/loopback/metadata before POST |
| **Rate limit** | Abuse perimeter | `RATE_LIMIT_ENABLED` | `false` | `true` | In-process counter; single-worker only (Redis-backed deferred) |

---

## Checklist: go/no-go for launch

### ✅ S1: Strong JWT Secret (REQUIRED)

**What:** Boot fails if the JWT secret is weak or default.

**How to set:**
1. Generate a 32+ byte random value (e.g., `openssl rand -hex 32`):
   ```
   JWT_SECRET=7f9d2c4a1e8b3f5d9c6a2e7b4f1d8a3c5e9b2d6f8a1c4e7b9d2f5a8c1e4b
   ```
2. Set in `.env`:
   ```
   REQUIRE_STRONG_SECRETS=true
   ```
3. Boot the app. If `JWT_SECRET` is the default (`dev-only-change-me`) or less than 32 bytes, startup fails with:
   ```
   RuntimeError: Weak JWT secret; set a 32+ byte JWT_SECRET
   ```
   This is intentional — boot failure is safer than silent weakness.

**Verify:**
- App starts cleanly without a `RuntimeError`.
- Check logs for: `"JWT secret fail-fast" … "ok"` (or silent if no logging configured).

---

### ✅ RLS Enforcement: Database Role Binding (REQUIRED)

**What:** The app connects as a restricted role (`gaahex_app`, NOSUPERUSER) instead of the superuser. RLS policies on every tenant-scoped table block cross-tenant reads by default.

**Current state:**
- Migration `3a9203795d07_enable_rls_tenant_isolation.py` **already exists and is active** in the repo.
- It creates:
  - `gaahex_app` role (NOSUPERUSER, NOBYPASSRLS) — the app's connection identity.
  - `gaahex` role (superuser) — used only for auth/seed, never in request paths.
  - `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` on all tenant-scoped tables (auth guards by tenant GUC).
  - `set_tenant_guc()` in `db.py` wires the per-request GUC binding.

**How to set:**
1. Run migrations (if not already done):
   ```bash
   cd backend && alembic upgrade head
   ```
2. Set in `.env`:
   ```
   DATABASE_URL=postgresql+asyncpg://gaahex_app:gaahex_app@<host>:5432/gaahex
   OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:gaahex@<host>:5432/gaahex
   ```
   - `DATABASE_URL` = app role (restricted, tenant-scoped queries).
   - `OWNER_DATABASE_URL` = superuser (login + refresh + seed only).

3. Confirm the app doesn't fall back to superuser:
   ```
   REQUIRE_STRONG_SECRETS=true   # turns on the role check
   ```

**Startup guard:**
- When `REQUIRE_STRONG_SECRETS=true`, the app checks if the active role is a superuser via `current_setting('is_superuser')`.
- If `is_superuser='on'`, startup logs a **WARNING**:
  ```
  SECURITY: the application database role is a superuser and can bypass RLS. Use a restricted app role in production.
  ```
  This is a warning, not a hard fail — it allows migrations and tests to continue, but you should **see this warning and fix it before production**.

**Verify:**
- RLS test passes: `pytest backend/tests/test_rls.py -v`
  - Creates two tenant contexts, confirms cross-tenant rows are invisible (0 rows returned).
- App starts with `DATABASE_URL=gaahex_app` — no superuser warning.

---

### ✅ S3: CORS Origins (REQUIRED)

**What:** Cross-Origin Resource Sharing is locked to the real frontend origin(s).

**Default behavior:**
- `CORS_ORIGINS=*` allows any origin (dev/tests only).

**How to set:**
1. Identify your frontend origin(s):
   ```
   https://app.example.com
   https://portal.example.com
   ```
2. Set in `.env` (comma-separated):
   ```
   CORS_ORIGINS=https://app.example.com,https://portal.example.com
   ```
   Do NOT use a wildcard (`*`) in production — it exposes CSRF/token leaks.

3. FastAPI CORS middleware (in `main.py`) reads `settings.cors_origins` and splits on `,`:
   ```python
   allow_origins=[o.strip() for o in settings.cors_origins.split(",")]
   ```

**Verify:**
- Frontend loads without CORS errors.
- Preflight OPTIONS requests return `Access-Control-Allow-Origin: https://app.example.com` (your origin, not `*`).
- Requests from a different origin are blocked by the browser.

---

### ✅ S4/S5: Multi-Tenant Portal Guard (REQUIRED for multi-tenant)

**What:** When there's more than one active tenant, the portal login (customer-facing) **requires** an explicit `tenant_id` hint. This prevents a silent wrong-tenant login.

**When it matters:**
- Single-tenant deployments: transparent — the system auto-falls-back to the only tenant.
- Multi-tenant deployments: **mandatory** — the frontend (or a discovery layer) must pass `tenant_id` in the login request body.

**How to set:**
1. Frontend portal login submits:
   ```json
   {
     "email": "customer@example.com",
     "password": "...",
     "tenant_id": "550e8400-e29b-41d4-a716-446655440000"
   }
   ```
   - `tenant_id` can come from a subdomain resolver, a discovery endpoint, or manual selection.

2. If `tenant_id` is omitted and multiple active tenants exist, the API returns **400**:
   ```json
   {
     "detail": "tenant_id required"
   }
   ```

**Startup guard:**
- None — this is a runtime check in `_resolve_tenant_id()` (portal_auth.py).

**Verify:**
- **Single-tenant test:** Omit `tenant_id` from portal login → succeeds (falls back to the one tenant).
- **Multi-tenant test:** Create 2+ active tenants, omit `tenant_id` → 400 error, login fails.
- **Multi-tenant with hint:** Pass `tenant_id` → succeeds.

---

### ✅ E38: Webhook SSRF Guard (REQUIRED for internet-facing)

**What:** Webhooks POST to tenant-supplied URLs, but the system **blocks private/loopback/metadata targets** by default to prevent Server-Side Request Forgery (SSRF).

**Blocked by default:**
- Schemes other than `http://` or `https://`
- Hostname `localhost` (case-insensitive)
- Hostnames ending in `.local` (mDNS/LAN).
- The literal IP `169.254.169.254` (AWS metadata endpoint).
- Any IP that is private, loopback, link-local, reserved, multicast, or unspecified (per Python `ipaddress` stdlib).
- DNS resolution failures (treated as unsafe — fail-closed).

**How to set:**
1. For **internet-facing deployments** (the default and **recommended**):
   ```
   WEBHOOK_ALLOW_PRIVATE=false
   ```
   This is the secure default. Webhook URLs must be public, internet-routable addresses.

2. For **trusted networks only** (VPC, corporate LAN, or test environments):
   ```
   WEBHOOK_ALLOW_PRIVATE=true
   ```
   This opt-in disables the SSRF guard, allowing internal/private targets. **Use only in a closed network.**

**How webhooks are guarded:**
- `_validate_url()` in `webhooks.py` checks at webhook-creation time.
- `_is_safe_webhook_url()` re-checks at dispatch time (defends against DB mutations).
- If a URL fails, the webhook creation/update returns **422**:
  ```json
  {
    "detail": "Webhook URL not allowed: private/internal address"
  }
  ```

**Verify:**
- Try to create a webhook pointing to `http://localhost:8000` → 422 error (blocked).
- Try to create a webhook pointing to `http://169.254.169.254/...` → 422 error (blocked).
- Try to create a webhook pointing to `https://example.com` → succeeds (public, allowed).
- If you enable `WEBHOOK_ALLOW_PRIVATE=true`, the localhost/private checks are skipped.

---

### ✅ Rate Limiting (REQUIRED for production)

**What:** Protects against brute-force, DoS, and abuse by throttling requests per principal (user/API key) or IP.

**Current state:**
- Implemented in-process counter in `apikeys.RateLimitMiddleware`.
- `RATE_LIMIT_ENABLED=false` by default (so dev/test are unaffected).
- `RATE_LIMIT_PER_MIN=6000` requests per principal-or-IP per 60-second window.

**Limitation:**
- **In-process counter — single-worker only**. If you run multiple workers (Gunicorn/systemd), each process has its own counter, so the rate limit is NOT enforced globally.
- **Multi-worker rate limiting requires Redis-backed counters** (deferred to a later batch). For now, single-worker deployments can use in-process; for multi-worker, you must disable `RATE_LIMIT_ENABLED` and implement a Redis solution separately.

**How to set:**
1. For a **single-worker deployment** (FastAPI directly or single Uvicorn process):
   ```
   RATE_LIMIT_ENABLED=true
   RATE_LIMIT_PER_MIN=6000
   ```
   The middleware throttles requests; excess ones return **429 Too Many Requests** with `Retry-After` header.

2. For a **multi-worker deployment** (Gunicorn, systemd socket activation, or Kubernetes replicas):
   - If you set `RATE_LIMIT_ENABLED=true`, rate limits are **not global** — each worker has its own counter.
   - **Leave `RATE_LIMIT_ENABLED=false`** and implement a Redis-backed rate limiter separately (via nginx, API Gateway, or a reverse-proxy middleware).

**Verify:**
- Single-worker: hammer the API; after ~6000 requests/min, you get 429.
- Multi-worker: enable the flag and confirm with load-test that rate limits are **not global** (only per-worker) — this confirms you need Redis or a reverse proxy.

---

## Known deferred items (not blockers, but note them)

These are hardening gaps flagged in `GAAhex-Vision/6-platform-delivery/39-security-review.md` that remain open and should be tracked:

1. **Redis-backed rate limiting** (P0 perimeter improvement, not a blocker)
   - Current in-process implementation only works for single-worker.
   - For multi-worker production, implement Redis-backed counters.

2. **Webhook secret encryption at rest** (P1)
   - Webhook secrets are stored plaintext on `WebhookDef.secret`.
   - Should encrypt at rest and show-once on creation.

3. **Audit immutability** (P2)
   - `Event` rows can be mutated/deleted by anyone with DB write access.
   - For compliance, make `event` append-only (revoke UPDATE/DELETE from `gaahex_app` role, or a trigger).

4. **API keys / machine principals** (P1 for integrations)
   - Not built; required for inbound API integrations.

---

## Step-by-step pre-launch validation

Run this checklist before go-live:

- [ ] **S1 — Strong JWT secret**
  - [ ] Generate a 32+ byte random `JWT_SECRET`.
  - [ ] Set `REQUIRE_STRONG_SECRETS=true`.
  - [ ] Boot the app — startup succeeds without the "Weak JWT secret" error.

- [ ] **RLS enforcement**
  - [ ] Migrations run cleanly (`alembic upgrade head`).
  - [ ] Set `DATABASE_URL=gaahex_app`, `OWNER_DATABASE_URL=gaahex` (or equivalent prod roles).
  - [ ] Boot with `REQUIRE_STRONG_SECRETS=true` — no superuser warning in logs.
  - [ ] Run `pytest backend/tests/test_rls.py -v` — all tests pass.
  - [ ] Manually verify: query as tenant-A, confirm tenant-B rows are invisible.

- [ ] **CORS origins**
  - [ ] Set `CORS_ORIGINS=https://app.example.com` (your real origin).
  - [ ] Boot the app.
  - [ ] Frontend loads without CORS errors.
  - [ ] Preflight OPTIONS request returns your origin, not `*`.

- [ ] **Multi-tenant portal guard (if multi-tenant)**
  - [ ] Create 2+ active tenants.
  - [ ] Omit `tenant_id` from portal login → returns 400 "tenant_id required".
  - [ ] Pass `tenant_id` → succeeds.

- [ ] **Webhook SSRF guard**
  - [ ] Try to create a webhook pointing to `http://localhost:8000` → returns 422.
  - [ ] Try to create a webhook pointing to `https://example.com` → succeeds.
  - [ ] If you need internal webhooks, carefully enable `WEBHOOK_ALLOW_PRIVATE=true` **only in a trusted network**.

- [ ] **Rate limiting**
  - [ ] Set `RATE_LIMIT_ENABLED=true` (single-worker) or arrange a Redis/proxy solution (multi-worker).
  - [ ] Load-test to confirm 429 returns on excess requests.

- [ ] **TLS & backups (operational)**
  - [ ] All connections use TLS (HTTPS, database over TLS if remote, Redis over TLS if needed).
  - [ ] Automated backups configured and tested.
  - [ ] Disaster-recovery procedure documented and rehearsed.

---

## Error messages and troubleshooting

### "Weak JWT secret; set a 32+ byte JWT_SECRET"
**Cause:** `REQUIRE_STRONG_SECRETS=true` and `JWT_SECRET` is the default or < 32 bytes.  
**Fix:** Set a strong secret and re-boot:
```bash
JWT_SECRET=$(openssl rand -hex 32)
REQUIRE_STRONG_SECRETS=true
```

### "SECURITY: the application database role is a superuser and can bypass RLS"
**Cause:** `REQUIRE_STRONG_SECRETS=true` and `DATABASE_URL` connects as `gaahex` (superuser) instead of `gaahex_app`.  
**Fix:** Update `.env`:
```
DATABASE_URL=postgresql+asyncpg://gaahex_app:gaahex_app@<host>/gaahex
```

### "tenant_id required" (portal login)
**Cause:** Multi-tenant deployment and portal login request didn't include `tenant_id`.  
**Fix:** Frontend must pass `tenant_id` in login request body, discovered via subdomain/discovery endpoint/manual selection.

### "Webhook URL not allowed: private/internal address"
**Cause:** Webhook URL is private/loopback/reserved and `WEBHOOK_ALLOW_PRIVATE=false`.  
**Fix:** Either use a public URL, or set `WEBHOOK_ALLOW_PRIVATE=true` if in a trusted network.

### "429 Too Many Requests"
**Cause:** Rate limit exceeded.  
**Fix:** Respect the `Retry-After` header and back off. If using multi-worker, check that you've deployed a Redis-backed limiter (in-process is single-worker only).

---

## Connects to

- `GAAhex-Vision/2-kernel/16-hardening.md` — JWT fail-fast spec.
- `GAAhex-Vision/2-kernel/16a-rls-implementation.md` — RLS migration + role binding.
- `GAAhex-Vision/6-platform-delivery/39-security-review.md` — full security audit + P0/P1/P2 backlog.
- `GAAhex-Vision/6-platform-delivery/36-launch-checklist.md` — phase-1 blockers + go/no-go criteria.
- `backend/app/config.py` — all settings and defaults.
- `backend/app/main.py` — startup guards (S1, RLS role check).
- `backend/app/routers/portal_auth.py` — S4/S5 multi-tenant guard.
- `backend/app/routers/webhooks.py` — E38 SSRF validation.
