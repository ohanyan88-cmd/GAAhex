# 13 — Security Architecture

**Status:** FOUNDATION tier — universal core across all platform activity.  
**Locked:** Yes — consult `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` before changes.  
**Owned by:** Security Core (Platform Engineering).

> **One-line thesis:** GAAhex's security posture is **fail-closed by default**. Every authentication event, every authorization decision, every secret, every token, every credential, and every threat control is enforced at the platform boundary, at the database boundary, and in the kernel itself — never in application code or frontend logic alone.

---

## Table of contents

1. [Architecture principles](#1-architecture-principles)
2. [Production deploy contract](#2-production-deploy-contract)
3. [Role-based access control (RBAC) & tenant isolation](#3-role-based-access-control-rbac--tenant-isolation)
4. [Encryption posture](#4-encryption-posture)
5. [Secret management](#5-secret-management)
6. [Token lifecycle & JWT security](#6-token-lifecycle--jwt-security)
7. [Rate limiting](#7-rate-limiting)
8. [Idempotency](#8-idempotency)
9. [Input validation](#9-input-validation)
10. [OWASP Top 10 posture](#10-owasp-top-10-posture)
11. [Threat model & incident lifecycle](#11-threat-model--incident-lifecycle)
12. [Audit & security events](#12-audit--security-events)
13. [Fail-closed feature gating](#13-fail-closed-feature-gating)
14. [Boot-time invariant checks](#14-boot-time-invariant-checks)
15. [Security ≠ Compliance ≠ Audit (PRM separation)](#15-security--compliance--audit-prm-separation)
16. [Cross-architecture dependencies](#16-cross-architecture-dependencies)
17. [Implementation roadmap](#17-implementation-roadmap)

---

## 1. Architecture principles

### P1 — Fail-closed, not fail-open

The platform defaults to **deny**. An unknown flag defaults to OFF. An unknown permission defaults to DENIED. An unknown feature defaults to DISABLED. A feature marked ON but whose backend hasn't booted defaults to an error message (not silent degradation).

See `app/services/feature_gate.py` + `app/config.py:_assert_production_deploy_contract()`.

### P2 — Server-side enforcement only

Security decisions are made by the backend, not the frontend. The frontend is the **presentation layer** for security — it reflects the backend's enforcement decisions but never makes them. A feature disabled on the frontend but enabled in the backend is a security bug.

### P3 — Defense in depth

Security controls live at multiple layers:
- **Database layer:** RLS policies, append-only triggers, foreign-key constraints.
- **API layer:** permission gates, input validation, rate limits, idempotency checks.
- **Kernel layer:** constant-time comparisons, HMAC verification, secret storage.
- **Deploy contract layer:** boot-time invariants that refuse startup on misconfiguration.

No single layer is sufficient; each layer presumes the others are present.

### P4 — Audit is the truth

Every meaningful security action (authentication, permission grant/revoke, secret access, configuration change, feature flag flip) is recorded immutably in the audit log before the action completes. The audit row is the **proof** that the action happened; silent mutations are forbidden.

### P5 — Tenant isolation is non-negotiable

Every tenant is isolated at the database layer (RLS), not just the application layer. A single-role Postgres connection in production is a **deploy contract violation** — the app refuses to boot.

### P6 — Standards govern security

Every security-related data model, enum, permission key, and lifecycle behavior must align with `docs/standards/` (70 LOCKED standards). Security-specific standards: file 17 (Security & Permission), file 20 (Data Validation), file 21 (Search & Filter).

---

## 2. Production deploy contract

The production deploy contract is the **canonical authority** for whether RLS actually engages. It lives in `app/config.py:_assert_production_deploy_contract()` and runs in the FastAPI lifespan startup, before any request handler executes.

### Principle: role split is mandatory

Postgres RLS has a hard rule: **the table owner bypasses RLS**. This means a connection running as the table owner sees every row in every table, regardless of the RLS policy.

GAAhex prevents this by running the application under a **second, unprivileged role** (`gaahex_app`). RLS then applies to every query the app issues. The owner role (`gaahex`) is reserved for:
- Schema ownership (migrations via Alembic)
- Pre-auth code paths (login email lookup, `/org-tree` boot read)
- Seed code (initial data population)

### Contract checks (in execution order)

| # | Check | Condition | Consequence if violated |
|---|-------|-----------|------------------------|
| **1** | `DATABASE_URL ≠ OWNER_DATABASE_URL` | Postgres connection strings must differ | Boot error: `M1-A production deploy contract violation: DATABASE_URL and OWNER_DATABASE_URL are equal` |
| **2** | Role split (username check) | `DATABASE_URL` username ≠ `OWNER_DATABASE_URL` username | Boot error: `M1-A production deploy contract violation: ... use the same role` |
| **3** | No wildcard CORS | `CORS_ORIGINS` must not contain `*` | Boot error: wildcard CORS in production is a theft vector |
| **4** | No mock providers | Payment, email, SMS, RADIUS backends must be real | Boot error: mock providers in production fail startup |
| **5** | Portal auth mode | `PORTAL_AUTH_MODE ∈ {cookie, both}` | Boot error: invalid auth mode for external users |
| **6** | Feature flags imply backends | `feature_*_required=True` ⟹ backend constructs cleanly | Boot error: flag ON but real backend missing |

If `ENVIRONMENT != "production"`, all checks are no-ops. Development, testing, staging, and CI default to a single role for convenience.

### Roles and grants

```sql
-- Owner role (owns the schema; used by migrations)
CREATE ROLE gaahex LOGIN PASSWORD '<owner-password>' SUPERUSER BYPASSRLS;

-- App role (used by the running application; RLS applies)
CREATE ROLE gaahex_app LOGIN PASSWORD '<app-password>' NOSUPERUSER NOBYPASSRLS;

-- Grants to app role
GRANT USAGE ON SCHEMA public TO gaahex_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gaahex_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gaahex_app;
GRANT SET ON PARAMETER gaahex.tenant_id TO gaahex_app;  -- RLS GUC control
```

Once the role split is in place, RLS policies on tenant-scoped tables *actually work* — every query the app issues is filtered by the `tenant_isolation` policy.

---

## 3. Role-based access control (RBAC) & tenant isolation

### RLS as foundation, not a feature

Row-Level Security is the **architectural foundation** of tenant isolation. It is not a feature that can be toggled off, and it is not a feature that is "nice to have." Every tenant-scoped table carries a `tenant_isolation` RLS policy bound to the `gaahex.tenant_id` session GUC.

### The RBAC model (file 17 — Security & Permission Standard)

The authorization system is a **four-layer decision stack**, evaluated in order:

1. **Identity layer:** Is the actor authenticated? (JWT valid, session active, API key present and not revoked?)
2. **Tenant layer:** Which tenant is the actor? (decoded from JWT `tenant` claim, validated against `User.tenant_id` server-side.)
3. **Role layer:** What permissions does the actor have? (role grants evaluated as a set of `permission_key` strings; wildcards allowed in grants: `*`, `object.*`, `object.action`.)
4. **Record layer:** Can the actor reach this specific record? (org-node scope, department filter, region scope, field visibility, record status, workflow state.)

### Permission keys are immutable and canonical

Every permission is keyed as `{object}.{action}`, lowercase, dot-separated. Examples:
- `customer.view`, `customer.create`, `customer.edit`, `customer.delete`
- `service.activate`, `service.deactivate`, `service.transition`
- `configuration.manage`, `permission.grant`, `permission.revoke`
- `comment.view_internal`, `audit.export`

**Permission keys are immutable once released to a tenant.** Renaming `customer.view` to `customer.read` is a breaking change for every existing role grant. Renaming is forbidden unless paired with a backfill migration that maintains all grants.

The canonical registry is `docs/standards/15-permission-registry.md`.

### Default-deny is the rule

No grant means no access. `can(entity_key, verb, record_path)` returns true **iff**:
1. Some grant carries the permission (as `*`, `entity_key.*`, or the literal `entity_key.verb`), **AND**
2. The grant's scope covers the `record_path` (tenant, node, subtree, or region scope).

Otherwise, the decision is **default-deny** and the HTTP response is `403 AccessDenied`. The error message is **generic** — it never echoes which layer (role, department, region, ownership, field) refused, so a hostile caller can't map the matrix.

### Tenant isolation policy (RLS)

Every tenant-scoped table (`customer`, `service`, `contract`, `task`, etc.) has:

```sql
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id'), ''));
```

The per-request flow:
1. Auth handler decodes JWT, reads `tenant` claim.
2. Auth handler validates claim against the user's `User.tenant_id` server-side.
3. Auth handler sets the session GUC: `SET LOCAL gaahex.tenant_id = <tenant_id>`.
4. **Every subsequent query on a tenant-scoped table is filtered by the policy.**

The `NULLIF` guard handles the edge case of pre-auth code paths (login lookup, `/org-tree` startup read) that run as the owner role and have no tenant context — they explicitly set `gaahex.tenant_id` to `NULL` or don't set it at all, and the policy allows the bypass.

### Role denials override grants

A role may declare **explicit denials** (`role_def_deny`) that override positive permissions:

```sql
-- Role grants permission
INSERT INTO role_def (role_key, permissions)
VALUES ('analyst', ARRAY['customer.*', 'service.view']);

-- But the denial says: not for financial workflows
INSERT INTO role_def_deny (role_key, denied_entity_key, denied_action)
VALUES ('analyst', 'financial', '*');
```

Denial always wins over grant. A matching denial raises `AccessDenied` even if the role's positive permissions would allow the action.

### Field-level visibility

A field may declare `view_roles` and `edit_roles` restrictions in its config:

```json
{
  "view_roles": ["super_admin", "finance_lead"],
  "edit_roles": ["finance_lead"]
}
```

A field that a caller's roles may not view is **never** returned from the API, **never** included in search result snippets or highlights, **never** exported, **never** visible in reports, **never** exposed to AI views. This enforcement is identical across UI, API, exports, reports, and search — the security boundary is at the data layer, not the presentation layer.

Admins holding `configuration.manage` bypass field-level visibility.

---

## 4. Encryption posture

### Encryption at rest (database level)

Sensitive data in the database is encrypted at rest:

- **Secrets** (signing keys, webhook HMAC keys, OAuth tokens): stored via `EncryptedString` model — encrypted transparently on write, decrypted transparently on read. The database **never holds plaintext**. Encryption key is external to the database.
- **Credentials** in Integration/Developer Platform tables: encrypted at rest via the same pattern.
- **Personally identifiable information (PII)** in Party tables: encrypted at the model level where subject to regulatory requirements (future; placeholder for GDPR, CCPA, etc.).

### Encryption in transit (TLS)

- **Database connections:** `postgresql://` is never acceptable in production. All connections use TLS: `postgresql+asyncpg://...` with certificate pinning where available.
- **API connections:** All external APIs are reached over HTTPS with certificate validation. No `verify=False` in production code.
- **Internal RPC:** Service-to-service calls within the platform default to HTTPS; plain HTTP is accepted only on loopback (`127.0.0.1:8099` in dev).
- **WebSocket (future):** If introduced, must use WSS (encrypted WebSocket), never WS.

### Encryption for blob storage

Attachments, documents, and exports stored in object storage are encrypted at rest by the storage provider (S3-compatible, GCS, Azure Blob). Signed URLs enforce expiration and single-use constraints.

---

## 5. Secret management

### Never in plaintext environment variables

The deploy contract forbids storing signing keys or credentials as plaintext in environment variables. At boot time, the application loads environment variables and immediately encrypts them for at-rest storage.

### Secrets are referenced by `secretRef`, not inline

Any configuration that needs a secret (webhook signing key, OAuth client secret, database password) stores a **reference** (`secretRef`) to a `Secret` table row, not the plaintext value.

```json
{
  "webhookDef": {
    "url": "https://external.api/webhook",
    "secretRef": "secret-uuid-xxx"
  }
}
```

The `Secret` table is gated by a tight RLS policy: only the service that owns the secret can read it. Reading a secret is an audit event.

### Secret rotation policy

Secrets are rotated on a schedule:
- **Short-lived** (OAuth tokens, API client secrets): 90 days.
- **Medium-lived** (signing keys, webhook HMAC keys): 1 year.
- **Long-lived** (database passwords): 1 year or on employee offboarding.

Rotation is **add-new-without-breaking-old**: a signing key is added, the next N requests are validated against both old and new, then the old key is retired. No service outage.

Rotation events are audit-logged with the actor, timestamp, and old/new secret fingerprints (not the plaintext).

### Access is always audited

Every read of a secret (to sign a request, to decrypt stored data, to verify an incoming webhook) is recorded in the audit log:

```
event_type: SECRET_ACCESSED
actor: <service_account_id>
secret_fingerprint: <hash of secret value>
purpose: webhook_signing | oauth_refresh | payment_gateway | ...
timestamp: <utc>
```

A secret read with no corresponding event is a **security incident**.

---

## 6. Token lifecycle & JWT security

### JWT structure and claims

GAAhex JWTs carry:

```json
{
  "sub": "user-uuid",
  "tenant": "tenant-uuid",
  "role": "super_admin",
  "iat": 1718200000,
  "exp": 1718203600,
  "jti": "jwt-id-uuid"
}
```

Claims:
- **`sub` (subject):** The user's UUID. Immutable for the lifetime of the token.
- **`tenant`:** The user's tenant. **Validated server-side** against `User.tenant_id` — the user cannot claim a different tenant.
- **`role`:** The user's primary role key. Used for display; actual permissions are resolved server-side from the `assignment` table.
- **`iat` (issued at):** Seconds since epoch. Used to prevent token replay.
- **`exp` (expiration):** Seconds since epoch. Tokens older than this are rejected.
- **`jti` (JWT ID):** A unique identifier for this token instance. Used for revocation.

### Token TTL and refresh rotation

- **Access token TTL:** 1 hour. Frequent rotation reduces the window a stolen token can be used.
- **Refresh token TTL:** 7 days. Longer lived so users don't have to re-authenticate daily.
- **Refresh rotation:** On every refresh, the old refresh token is **invalidated**. Only the new token is valid. This prevents a leaked refresh token from being used multiple times.

### Token validation

On every request:

1. **Extract the JWT** from the `Authorization: Bearer <jwt>` header.
2. **Verify the signature** (constant-time comparison) against the platform's signing key.
3. **Decode the payload** (do NOT trust claims before verification).
4. **Check expiration:** `exp > current_time`.
5. **Check revocation:** is `jti` in the revocation list? (checked against a fast-access cache; cache is invalidated on logout/revoke).
6. **Validate tenant:** does the JWT claim match `User.tenant_id` in the database?
7. **Resolve permissions:** load the user's role assignments and evaluate them against the requested action.

Failure at any step results in `401 Unauthorized` (not `403 Forbidden`; the distinction matters).

### Service account tokens

Service accounts (integrations, background jobs, API clients) use **API keys** instead of JWTs:

```
Authorization: Bearer gaahex_prod_key_12345abcdef...
```

API keys are:
- **Scoped** to one service account and carry a list of permissions.
- **Rate-limited** per key (see § 7).
- **Logged** on every use (audit event: `API_KEY_USED`).
- **Rotatable** with the same add-new-keep-old pattern as secrets.
- **Revocable** immediately (list is checked against a fast cache).

### Revocation list

Revoked tokens and keys are added to a **revocation list** cached in Redis (or in-process for dev). The list is checked on every request **before** the handler is invoked. Revocation is **immediate** — no eventual consistency.

If Redis is unavailable, the platform **fails closed**: requests are rejected with `503 Service Unavailable` rather than allowing potentially-revoked tokens.

---

## 7. Rate limiting

### Sliding-window algorithm

Rate limits are enforced using a **sliding-window counter**. The window is 60 seconds; the limit is keyed by tenant + API key (or IP for unauthenticated endpoints).

```python
# Pseudo-code
def is_rate_limited(tenant_id, api_key, limit_per_minute):
    counter_key = f"ratelimit:{tenant_id}:{api_key}"
    current = redis.get(counter_key) or 0
    if current >= limit_per_minute:
        return True
    redis.incr(counter_key)
    redis.expire(counter_key, 60)
    return False
```

### Limits by endpoint class

| Endpoint | Limit | Scope | Consequence |
|----------|-------|-------|-------------|
| Login / auth | 10 per minute | IP address | `429 Too Many Requests` |
| Password reset | 3 per hour | Email + IP | `429 Too Many Requests` |
| API write (create/update/delete) | 1,000 per minute | Tenant + API key | `429 Too Many Requests` |
| API read (list/get) | 10,000 per minute | Tenant + API key | `429 Too Many Requests` |
| Search | 1,000 per minute | Tenant + API key | `429 Too Many Requests` |
| Export | 10 per hour | Tenant + user | `429 Too Many Requests` |

Limits are **per-tenant** so one tenant's abuse doesn't affect others. A rogue API key can be rate-limited independently.

### Response format

When a request is rate-limited:

```json
HTTP/1.1 429 Too Many Requests

{
  "error": "rate_limited",
  "message": "API rate limit exceeded. Retry after 60 seconds.",
  "retry_after": 60,
  "limit": 1000,
  "remaining": 0,
  "reset_at": 1718200060
}
```

The `Retry-After` header is also set (per RFC 7231).

### Burst protection

To prevent abuse of the sliding window (e.g., 999 requests in second 1, then pause, then 999 in second 2), the platform also enforces a **per-second hard cap** of 50% of the per-minute limit. This prevents bursting to the limit in a single second.

---

## 8. Idempotency

### Idempotency keys for write endpoints

Every POST/PUT/PATCH that mutates a record must carry an **Idempotency-Key** header:

```
POST /api/customers HTTP/1.1
Idempotency-Key: <uuid or client-generated string>
Content-Type: application/json

{ "name": "Acme Corp", "email": "contact@acme.com" }
```

If the same Idempotency-Key is submitted twice within a **24-hour window**:
1. The first request is processed normally and returns the created/updated record.
2. The second request **skips processing** and returns the **same response** from the first request (cached).
3. The operation is **never executed twice**, preventing double-charges, duplicate records, etc.

### Implementation

```python
# In the router handler
idempotency_key = request.headers.get("Idempotency-Key")
if idempotency_key:
    cached = await cache.get(f"idem:{idempotency_key}")
    if cached:
        return cached  # Replay the cached response

# Process the request normally
result = await service.create_customer(...)

# Cache the response for 24 hours
if idempotency_key:
    await cache.set(f"idem:{idempotency_key}", result, ex=86400)

return result
```

### Audit trail

Idempotent replays are **not re-audited**. The original event row in the audit log is the proof. A replay does not generate a second `CUSTOMER_CREATED` event.

---

## 9. Input validation

### Validation is mandatory at every boundary

Input validation happens at **four points**, and all four must pass:

1. **API layer:** Request body is parsed and validated against a Pydantic schema before the handler is invoked.
2. **Service layer:** Business logic validates constraints (e.g., "end date must be after start date").
3. **Database layer:** Check constraints and foreign keys enforce invariants the application code didn't catch.
4. **Integration layer:** Data from external systems (imports, webhooks) is validated before being stored.

Failure at the API layer returns `422 Unprocessable Entity` with detailed field errors. Failure at the service layer returns `400 Bad Request` (or a domain-specific error). Failure at the database layer returns `500 Internal Server Error` (a bug in the application).

### Canonical validation path (Standard 20)

The validation rules for each field are defined once, in the `FieldDef` configuration. The same rules are applied:
- By the frontend (for UX feedback)
- By the backend API (before storing)
- By imports/exports (before bulk write)
- By automation (before executing actions)
- By integrations (before accepting external data)

No two validation paths are allowed; duplication is a source of bugs.

### Type coercion and canonicalization

Input values are **coerced to their canonical form** before validation:

- **Dates:** parsed to ISO 8601 (`YYYY-MM-DD`); timezone-aware values are rejected unless the field is explicitly timezone-aware.
- **Currency:** parsed to two decimal places; non-numeric characters are stripped.
- **Enums:** normalized to `UPPER_SNAKE_CASE`; any other casing is rejected.
- **Strings:** trimmed of leading/trailing whitespace; null bytes are rejected.
- **Phone numbers:** normalized to E.164 format; invalid formats are rejected.
- **Email:** lowercase; RFC 5321 format validation.

Invalid input is never silently corrected. If the input doesn't parse, the error is returned immediately.

---

## 10. OWASP Top 10 posture

### A1 — Injection

**Vector:** SQL injection, command injection, expression injection.

**GAAhex controls:**
- **SQLAlchemy ORM:** All database queries use parameterized ORM statements, never raw SQL string concatenation.
- **Input validation:** Every user-supplied string is validated against a whitelist schema before use.
- **No shell execution:** The platform never invokes shell commands with user input.
- **No expression evaluation:** Dynamic expressions (e.g., filter conditions) are parsed into a safe AST; custom expressions are rejected.

**Proof:** Static analysis via ruff (`check-sql` rule). Injection attempts are also rate-limited (see § 7) — repeated invalid queries trigger a 429.

### A2 — Broken authentication

**Vector:** Weak password policy, credential leakage, session hijacking, credential brute-force.

**GAAhex controls:**
- **PBKDF2 password hashing:** Passwords are hashed with PBKDF2-SHA256 (100,000 iterations), not stored plaintext.
- **Brute-force protection:** Login attempts are rate-limited to 10 per minute per IP (see § 7).
- **Session invalidation:** On logout or password change, all existing tokens for the user are revoked.
- **Forced password change:** On first login (after admin password reset), the user must change their password.
- **MFA support:** (future; framework in place) TOTP or SMS-based second factor.

**Proof:** Test `test_deploy_contract.py` validates the auth separation. Test `test_rls.py` validates session isolation.

### A3 — Sensitive data exposure

**Vector:** Unencrypted PII, secrets in logs, credentials in error messages.

**GAAhex controls:**
- **Encryption at rest:** Secrets and sensitive PII are encrypted in the database (see § 4, § 5).
- **Encryption in transit:** All external connections use TLS (see § 4).
- **Generic error messages:** API errors never echo sensitive data. A 403 says "access denied", not "you don't have role admin".
- **Audit log encryption:** Future — audit log backups are encrypted at rest.
- **Secrets never in logs:** Application code never logs sensitive data. Secrets are logged only as fingerprints (hashes).

**Proof:** CI step `pip-audit` scans for known CVEs in Python dependencies. Manual code review of error handling.

### A4 — Broken access control

**Vector:** User A reading/modifying User B's data, privilege escalation, permission bypass.

**GAAhex controls:**
- **RLS at the database layer:** Every tenant-scoped table has a `tenant_isolation` RLS policy. Cross-tenant reads are impossible, even if application code is buggy.
- **RBAC at the API layer:** Every request is gated by permission checks before the handler is invoked.
- **Field-level visibility:** Sensitive fields are hidden from unauthorized roles (see § 3).
- **Audit on every change:** Permission grants and role assignments are audited.

**Proof:** Test `test_rls.py` validates RLS. Test `test_rls_parametric.py` validates RLS across every tenant-scoped table. Test `test_cross_tenant_*` validates API-layer isolation. CI job `backend-rls` runs the full suite with the `gaahex_app` role (dual-role enforcement).

### A5 — Security misconfiguration

**Vector:** Debug mode in production, default credentials, overly permissive CORS, exposed endpoints.

**GAAhex controls:**
- **Deploy contract:** The startup check refuses to boot if configuration is incorrect (see § 2).
- **Environment-based toggles:** Debug, tracing, and logging levels are set via `ENVIRONMENT` (dev/staging/production).
- **No default credentials:** Admin users are created only via seed code with strong passwords.
- **CORS policy:** Wildcard CORS is forbidden in production; origins must be explicitly whitelisted.
- **Endpoint registration:** Hidden or internal endpoints (`/meta/`, `/admin/`) are not exposed in Swagger unless `ENVIRONMENT != "production"`.

**Proof:** Test `test_deploy_contract.py::test_production_*` validates the startup checks.

### A6 — Insecure deserialization

**Vector:** Arbitrary code execution via deserialization of untrusted data.

**GAAhex controls:**
- **Pydantic validation:** All incoming JSON is parsed and validated by Pydantic models before deserialization. Unknown fields are rejected.
- **Type hints:** Every request handler is type-hinted; mismatched types are caught at parse time.
- **No pickle:** The platform never deserializes Python pickle or other code-execution formats from untrusted input.
- **External data is typed:** Webhook payloads, CSV imports, and external API responses are parsed into strict Pydantic schemas.

**Proof:** Integration tests validate webhook payload parsing. Import tests validate CSV schema validation.

### A7 — Cross-site scripting (XSS)

**Vector:** Malicious JavaScript injected into user-facing pages.

**GAAhex controls:**
- **React auto-escaping:** The frontend uses React, which auto-escapes HTML unless explicitly marked as unsafe (rare).
- **Content Security Policy (CSP):** (future; placeholder) HTTP header restricts script sources.
- **No `innerHTML`:** The frontend avoids `innerHTML` where possible; when necessary, content is sanitized via `DOMPurify`.
- **CSRF tokens:** Forms include CSRF tokens that are validated on submission.

**Proof:** Frontend integration tests validate escaping. Manual review of unsafe components.

### A8 — Insecure deserialization (API responses)

**Vector:** API responses contain user-controlled data that is used unsafely in the frontend.

**GAAhex controls:**
- **Response type hints:** All API responses are typed and validated by TypeScript on the frontend.
- **No dynamic imports:** The frontend does not `import()` user-supplied code.
- **Sandbox for user content:** User-generated content (comments, descriptions) is rendered as text, not HTML.

**Proof:** Frontend TypeScript compilation validates type safety. Integration tests validate response shape.

### A9 — Using components with known vulnerabilities

**Vector:** Outdated libraries with known security flaws.

**GAAhex controls:**
- **Dependency audit (Python):** CI step `pip-audit -r requirements.txt` scans for CVEs. Warn-only on landing; blocking on release.
- **Dependency audit (npm):** CI step `npm audit` scans for CVEs. Warn-only.
- **Supply chain scanning:** `gitleaks` detects accidentally-committed credentials.
- **Vulnerability patching:** CVEs in dependencies are patched within 24 hours (critical) or 7 days (high) of disclosure.

**Proof:** CI jobs `pip-audit`, `npm audit`, `gitleaks` gate every push.

### A10 — Insufficient logging & monitoring

**Vector:** Security incidents go undetected because events are not logged.

**GAAhex controls:**
- **Append-only audit log:** Every mutation, permission grant, secret access, and feature flag change is recorded (see § 12).
- **Authentication events:** Login, logout, token refresh, password change are logged.
- **Permission denials:** Every `AccessDenied` (403) is logged with the actor, resource, and action.
- **Anomaly detection:** (future) Automated alerting on suspicious patterns (brute-force, cross-tenant access attempts, bulk exports).

**Proof:** Test `test_audit_append_only.py` validates audit logging. Integration tests validate event emission.

---

## 11. Threat model & incident lifecycle

### Threat vectors (highest priority first)

| Threat | Impact | Likelihood | Detection | Mitigation |
|--------|--------|-----------|-----------|-----------|
| **Cross-tenant data exposure** | Catastrophic — tenant data leaks to another tenant | Low (RLS + RBAC layered) | Automated: RLS test suite, tenant-filter analyzer | Fail-closed RLS; dual-role CI enforcement |
| **Privilege escalation** | High — attacker gains admin access | Low (RBAC immutable post-release) | Manual: code review; automated: permission-registry drift check | RBAC lockdown; audit of permission grants |
| **RCE via injection** | Catastrophic — arbitrary code execution | Low (no eval, SQLAlchemy ORM) | Automated: static analysis; manual: security review | Input validation; no dynamic code execution |
| **Data exfiltration via export/report** | High — bulk data download with stolen credentials | Medium (API key compromise likely) | Audit log (user + timestamp); rate limit (see § 7) | API key rotation; audit alerts on large exports |
| **Brute-force password attack** | Medium — attacker gains user access | High (automated attack) | Failed login rate limiting | 10/minute per IP; MFA (future) |
| **Credential leakage (leaked API key)** | High — attacker uses key for 7 days (refresh rotation) | Medium (social engineering, accidental paste) | Audit on every API key use; automated scan (gitleaks) | Immediate revocation; short TTL; refresh rotation |
| **DoS (rate limit exhaustion)** | Medium — service degradation | Medium (low barrier to entry) | Rate-limit metrics; anomaly detection | Sliding-window limits; burst protection |
| **Misconfiguration (role split not enforced)** | Catastrophic — RLS silently bypassed | Low (deploy contract enforces) | CI test (`test_deploy_contract.py`) | Startup refusal if contract violated |

### Incident lifecycle

When a security incident is detected:

1. **Detect** (automated or manual) — anomaly detection, rate-limit spiking, suspicious access patterns, customer report.
2. **Classify** — severity (critical, high, medium, low) and category (injection, auth, exposure, etc.).
3. **Contain** — immediately revoke the affected API key, reset the user's password, or shut down the malicious service account.
4. **Investigate** — audit log is the source of truth. Trace the attacker's actions backward and forward in time.
5. **Mitigate** — patch the vulnerability, deploy the fix, validate RLS/RBAC still intact.
6. **Resolve** — confirm the attacker has no further access; conduct post-mortem to prevent recurrence.
7. **Post-mortem** — document the incident, the response, and the long-term fix in a sealed archive (future).

Every incident is **recorded** in an incident log (separate from the general audit log) with the timeline, the root cause, and the remediation.

---

## 12. Audit & security events

### Append-only audit at the database layer

Every mutation (create, update, delete, transition, permission grant, feature flag flip) is recorded in the `event` table via `workflow.emit(...)`. The schema:

```sql
CREATE TABLE event (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenant(id),
  event_type VARCHAR NOT NULL,  -- e.g. CUSTOMER_CREATED, PERMISSION_GRANTED
  entity_key VARCHAR NOT NULL,  -- e.g. customer, task, role_def
  record_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES user(id),
  actor_ip VARCHAR,
  actor_role VARCHAR,
  data JSONB,  -- Event-specific payload
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT event_append_only PRIMARY KEY (id)
);

-- DB trigger that enforces append-only
CREATE TRIGGER event_no_update BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
```

A Postgres trigger (per migration `b70ef3b98e27`) raises an exception on any UPDATE or DELETE, even by the table owner. The trigger fires for **every role**, including superusers, so the constraint is unforgeable.

### Audit events for security-sensitive actions

| Action | Event type | Payload |
|--------|-----------|---------|
| User login | `USER_LOGGED_IN` | `{ actor_id, ip, success: true/false, reason: "invalid_password" / "mfa_failed" / ... }` |
| User logout | `USER_LOGGED_OUT` | `{ actor_id, ip, session_duration_seconds }` |
| Password changed | `PASSWORD_CHANGED` | `{ actor_id, by_user_id, reason: "self" / "admin_reset" }` |
| Permission granted | `PERMISSION_GRANTED` | `{ actor_id, target_user_id, permission_key, scope }` |
| Permission revoked | `PERMISSION_REVOKED` | `{ actor_id, target_user_id, permission_key }` |
| Role assigned | `ROLE_ASSIGNED` | `{ actor_id, target_user_id, role_key, org_node, reason }` |
| API key created | `API_KEY_CREATED` | `{ actor_id, api_key_fingerprint, scopes, expires_at }` |
| API key revoked | `API_KEY_REVOKED` | `{ actor_id, api_key_fingerprint, reason }` |
| Secret accessed | `SECRET_ACCESSED` | `{ actor_id, secret_fingerprint, purpose, by_service }` |
| Feature flag toggled | `FEATURE_FLAG_UPDATE` | `{ actor_id, flag_key, old_value, new_value }` |
| Configuration changed | `CONFIG_CHANGED` | `{ actor_id, config_key, old_value, new_value }` |
| Cross-tenant access attempt (denied) | `CROSS_TENANT_DENIED` | `{ actor_id, actor_tenant, target_tenant, resource, action }` |
| Rate limit exceeded | `RATE_LIMIT_EXCEEDED` | `{ actor_id / ip, endpoint, limit, window }` |
| Malformed request | `MALFORMED_REQUEST` | `{ actor_id / ip, endpoint, reason }` |

### Audit retrieval and retention

- **Retrieval:** `/api/audit?entity_key=&record_id=&actor_id=&event_type=&from_date=&to_date=` filters audit logs. Pagination (Standard 9).
- **Access control:** Reading audit logs requires `audit.view` permission. Reading another tenant's audit logs is impossible (RLS).
- **Retention:** Audit logs are **immutable and indefinite** (no automatic deletion). Compliance-driven retention policies (future) can mask records from view without deleting them.
- **Export:** Audit exports are rate-limited (10 per hour per user). The export itself is an audit event.

---

## 13. Fail-closed feature gating

### Deploy-shape gates vs. tenant business flags

The platform has **two independent feature-gating systems**, and they must never be collapsed (see `docs/standards/FEATURE_GATING_POLICY.md`):

| System | Purpose | Scope | Failure mode |
|--------|---------|-------|--------------|
| **Deploy-shape gate** (`feature_gate.py`) | Technical availability in this deployment | Platform-wide | Feature is unavailable for **all tenants** |
| **Tenant flag** (`FeatureFlag` table) | Business preference per tenant | Per-tenant | Feature is unavailable for **one tenant only** |

### Deploy-shape gates (platform-wide)

A deploy-shape gate answers: "Can the platform technically provide this subsystem in this deployment?"

**Today's gates:**
- `radius` — RADIUS authentication/accounting
- `olt_provisioning` — OLT ONU provisioning
- `import_engine` — Bulk CSV/XLSX import
- `warehouse` — Inventory/asset warehouse

If `ENVIRONMENT=production` and `feature_<key>_required=True`, the backend must construct the service cleanly at boot. If construction fails, the platform refuses to start with a clear error.

### Tenant flags (per-tenant business choice)

A tenant flag answers: "Should this tenant be able to use this optional feature?"

**Examples** (future):
- `dunning_automation` — automated overdue-invoice escalation.
- `self_serve_signup` — customer portal self-signup.
- `advanced_analytics` — premium reporting dashboard.

Tenant flags are stored in the `FeatureFlag` table, which is tenant-scoped and RLS-protected. Each tenant controls its own flags via `/api/feature-flags` endpoints.

### The decision tree

For every feature:

1. **Is the question "can the platform technically provide this in this deployment?"**
   - Yes → use **deploy-shape gate**.
   - No → continue.

2. **Is the feature implemented in the platform code?**
   - No → use **deploy-shape gate** (fail-closed until code lands).
   - Yes → continue.

3. **Should two reasonable tenants be free to make different choices?**
   - Yes → use **tenant flag**.
   - No → this is not a feature gate; it's platform behavior. Encode it as configuration, not a flag.

### Forbidden patterns

- Adding `tenant_id` parameter to `feature_gate.is_enabled()` → collapses the two systems.
- Adding a tenant business preference to `feature_gate.py` keys → inverts tenant autonomy.
- Adding a deploy-shape gate to the `FeatureFlag` table → allows a tenant to flip infrastructure off.
- Collapsing both gates into one call → order matters; deploy-shape first (do we have a backend?), then tenant-flag (does this tenant want it?).
- Frontend reading `feature_gate.py` env vars → deploy-shape gating is server-side; frontend must rely on backend responses (403, 404, `FeatureDisabledError`).

---

## 14. Boot-time invariant checks

### The security kernel engine

The **Security Core** kernel engine runs at application startup and refuses to proceed if any invariant is violated. The checks are (in order):

1. **Role split check** (see § 2) — `DATABASE_URL` and `OWNER_DATABASE_URL` must use different Postgres roles.
2. **CORS policy** — no wildcard; origins must be explicitly whitelisted.
3. **Provider reality** — if a payment/email/SMS/RADIUS provider is marked ON, the real backend must construct cleanly.
4. **Portal auth mode** — must be one of `cookie`, `both` (never `token`-only).
5. **Feature flag consistency** — if a flag is ON, the feature must be implemented (not just stubbed).
6. **Seed data integrity** — initial users and roles must exist and have consistent permissions.

If any check fails, the application **exits with a non-zero code and a detailed error message**. There is no "continue anyway" option.

### Test coverage

Test `test_deploy_contract.py` validates:
- ✓ Dev mode (ENVIRONMENT != production) skips all checks.
- ✓ Production with equal URLs fails immediately.
- ✓ Production with same-role URLs fails immediately.
- ✓ Production with wildcard CORS fails immediately.
- ✓ Production with mock providers fails immediately.
- ✓ Correct production config boots cleanly.

---

## 15. Security ≠ Compliance ≠ Audit (PRM separation)

### Three separate cores

The Platform Reference Model separates three related but distinct responsibilities:

| Core | Owns | Does NOT own |
|------|------|--------------|
| **Security Core** | Authentication, RBAC, encryption, secrets, tokens, rate limits, deploy contract, threat controls | Compliance workflows, audit history, business permissions, entitlements |
| **Audit Core** | Immutable audit log, access log, change history, event evidence, actor/context/IP/source metadata | Operational metrics, analytics facts, notification history (unless evidence-grade) |
| **Compliance Core** | Privacy requests, retention policies, consent, regulatory evidence, data-subject operations | Raw audit log generation, general security controls, business approvals (unless compliance-specific) |

### How they interact

- **Security** emits events via `workflow.emit()` when sensitive actions occur (password change, permission grant, API key creation).
- **Audit** records those events in the append-only `event` table and exposes them via `/api/audit`.
- **Compliance** consumes audit records to answer regulatory questions: "Which users accessed this customer's data in the past 30 days?" or "Prove we deleted all data for user X on request."

A PR that blurs these boundaries (e.g., Compliance trying to delete an audit row for GDPR reasons, or Security trying to implement retention policies) is a boundary violation. Remediation: **escalate to architecture review**.

---

## 16. Cross-architecture dependencies

| This document depends on | For |
|---|---|
| `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` | Protected invariants (I3 tenant isolation, I5 RLS engagement, I8 deploy contract); approved extension points |
| `PLATFORM_REFERENCE_MODEL.md` | Security Core definition; what Security owns and does not own |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership boundaries; L5 tenant universality; L7 no hidden ownership |
| `03_INFORMATION_ARCHITECTURE.md` | Entity ownership; canonical entity matrix |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys; RBAC model; scope evaluation |
| `09_DATA_ARCHITECTURE.md` | Tenant-scoped table pattern; RLS policy template |
| `10_API_ARCHITECTURE.md` | API contract; error response shapes; 401 vs 403 distinction |
| `11_EVENT_ARCHITECTURE.md` | Event ownership; event schema registry; audit event naming |
| `14_TENANT_ARCHITECTURE.md` | Tenant isolation; tenant-scoped table definition; RLS policies |
| `17_GOVERNANCE_ARCHITECTURE.md` | Standards registry; constitution amendment process |
| `docs/standards/15-permission-registry.md` (LOCKED) | Canonical permission keys; immutability rules |
| `docs/standards/17-security-permission-standard.md` (LOCKED) | RBAC model (file 17); default-deny rule; layered decision stack |
| `docs/standards/20-data-validation-standard.md` (LOCKED) | Validation contract; canonicalization rules |
| `docs/standards/FEATURE_GATING_POLICY.md` (LOCKED) | Deploy-shape gates vs. tenant flags; decision tree |
| `docs/standards/RLS_EXEMPTION_POLICY.md` (LOCKED) | Fix-forward policy; exemption criteria; remediation requirements |
| `docs/M1A-DEPLOY-CONTRACT.md` | Role split enforcement; startup checks; Postgres setup |

| Documents that depend on this one |
|---|
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (server-side enforcement only) |
| `12_INTEGRATION_ARCHITECTURE.md` (webhook signing, credential management) |
| `18_OBSERVABILITY_ARCHITECTURE.md` (security metrics, anomaly alerts) |
| `19_INFRASTRUCTURE_ARCHITECTURE.md` (deploy contract, TLS config) |
| `21_AI_ARCHITECTURE.md` (AI action audit, permission gating) |

---

## 17. Implementation roadmap

### M0 (current) — Foundation complete

- [x] Deploy contract (role split, CORS, provider reality)
- [x] RBAC & tenant isolation (RLS policies, permission keys, assignment model)
- [x] Audit append-only (DB triggers, immutability)
- [x] Token lifecycle (JWT, refresh rotation, revocation cache)
- [x] Input validation (Pydantic schemas, type coercion)
- [x] Rate limiting (sliding-window, burst protection)
- [x] Secrets at rest (EncryptedString model)
- [x] Boot-time invariant checks (config validation, provider reality)

### M1 (Phase 1 RLS hardening) — Scoped

- [ ] Dual-role CI enforcement (`backend-rls` job) — remove `continue-on-error: true` flag.
- [ ] RLS exemption policy (Fix-Forward; sealed baseline governance).
- [ ] Secrets rotation framework (90-day auth tokens, 1-year signing keys).
- [ ] Field-level visibility enforcement across API, exports, reports, search.
- [ ] Anomaly detection (automated alerting on suspicious patterns).
- [ ] MFA support (TOTP or SMS-based; optional per tenant via feature flag).

### M2/M3 (future) — Intelligence & integration

- [ ] CSP header (X-Content-Security-Policy).
- [ ] Webhook signing (HMAC-SHA256; retry with backoff).
- [ ] Incident log (separate from audit; timeline + root cause + remediation).
- [ ] Compliance module integration (privacy requests, retention policies, consent).
- [ ] Encryption for audit log backups.
- [ ] Credential rotation for external integrations (OAuth refresh, API keys).

---

*End of 13 — Security Architecture.*
