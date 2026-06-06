# 13 — Security Architecture

**Constitutional document.** Position in the hierarchy: foundational security governance; directly under `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`.

---

## 1. Purpose

Define GAAhex's security posture, governance model, and fail-closed enforcement mechanisms. Codify the architectural invariants that ensure authentication, authorization, secrets, tokens, encryption, rate-limiting, and audit are enforced uniformly at the platform boundary, database boundary, and kernel — never in application code or frontend logic alone.

The thesis: **GAAhex's security posture is fail-closed by default.** Every security control is enforced at multiple layers; unknown flags default to OFF; unknown permissions default to DENIED; defense-in-depth is constitutional.

## 2. Scope

In scope:

- The four-layer authorization decision stack (identity → tenant → role → record).
- Role-based access control (RBAC) model and permission key semantics.
- Row-Level Security (RLS) as the foundational tenant isolation mechanism.
- Encryption at rest (database layer) and in transit (TLS).
- Secret management, secret rotation, and access auditing.
- JWT structure, token TTL, refresh rotation, and revocation.
- API key / service account token semantics.
- Rate limiting (sliding-window, burst protection, per-endpoint limits).
- Idempotency keys and replay prevention.
- Input validation (Pydantic, type coercion, canonicalization).
- OWASP Top 10 threat vectors and GAAhex's controls.
- Threat model, incident lifecycle, and post-mortem process.
- Append-only audit logging at the database layer.
- Security-sensitive event taxonomy.
- Fail-closed feature gating (deploy-shape gates vs. tenant flags).
- Boot-time invariant checks (deploy contract).
- Separation of Security, Compliance, and Audit responsibilities.

Out of scope (handled by other constitution documents):

- Specific compliance frameworks (GDPR, HIPAA, SOC 2) — see `Compliance Core` docs.
- Infrastructure-level TLS / certificate pinning details — see `19_INFRASTRUCTURE_ARCHITECTURE.md`.
- Observability and alerting for anomalies — see `18_OBSERVABILITY_ARCHITECTURE.md`.
- AI action audit and gating — see `21_AI_ARCHITECTURE.md`.

## 3. Goals

- **G1** No security decision is made in the frontend; the backend is the authority.
- **G2** Every authentication event, authorization decision, secret access, and threat control is enforced at the platform boundary (API), database boundary (RLS), and kernel (constants) — never in application code alone.
- **G3** RLS is the foundational tenant isolation mechanism; every tenant-scoped table carries the `tenant_isolation` policy bound to `gaahex.tenant_id`.
- **G4** Every meaningful security action (login, permission grant, secret access, feature flag flip) is immutably recorded in the append-only audit log before the action completes.
- **G5** Unknown flags default to OFF; unknown permissions default to DENIED; unknown features default to DISABLED. Fail-closed is mandatory.
- **G6** The platform refuses to boot if the deploy contract is violated (role split, wildcard CORS, mock providers, invalid auth mode, feature flag inconsistencies, seed data integrity).
- **G7** Every security-related data model, enum, permission key, and lifecycle behavior aligns with the 70 LOCKED standards (files 15, 17, 20, 21 and security-specific policies).

## 4. Non-Goals

- **NG1** This document does NOT define UI presentation of security controls. (See `06_UI_EXPERIENCE_ARCHITECTURE.md`.)
- **NG2** This document does NOT define backend implementation modules or file layout. (See `02_DOMAIN_ARCHITECTURE.md`.)
- **NG3** This document does NOT implement compliance workflows, regulatory evidence, or retention policies. (See Compliance Core.)
- **NG4** This document does NOT design TLS certificates, key rotation infrastructure, or HSM integration. (See `19_INFRASTRUCTURE_ARCHITECTURE.md`.)
- **NG5** This document does NOT replace the standards registry. (See `docs/standards/15-permission-registry.md`, `docs/standards/17-security-permission-standard.md`, etc.)

## 5. Architecture Principles

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

## 6. Architecture Laws

### L1 — Fail-closed as invariant

> Unknown security state defaults to deny. No flag, permission, or feature gate is ever unknown; omission means OFF/DENIED/DISABLED.

A feature not yet implemented is unavailable to all tenants. A permission not granted is unavailable. A flag not configured is off. The default state is always safe.

### L2 — Role split is mandatory in production

> In production (`ENVIRONMENT == "production"`), the application must run under an unprivileged Postgres role (`gaahex_app`). The table owner role (`gaahex`) is reserved for schema ownership only. The deploy contract enforces this separation; violation is a boot error.

RLS applies only to non-owner roles. A single-role setup in production is a critical violation.

### L3 — RLS is the foundation, not optional

> Every tenant-scoped table carries a `tenant_isolation` RLS policy bound to `gaahex.tenant_id`. The policy is enforced by the database; it cannot be disabled by application code.

RLS is the architectural foundation of tenant isolation. It is not a feature that can be toggled; it is the platform's invariant.

### L4 — Audit is immutable and append-only

> Every mutation to the `event` table is forbidden. A database trigger (per migration `b70ef3b98e27`) raises an exception on any UPDATE or DELETE, even by superusers. The constraint is unforgeable; audit is the source of truth.

Audit records are created once, never modified, never deleted (except via compliance retention policies that mask rather than remove).

### L5 — Authentication vs. authorization are separate

> Authentication asks: "Who is the actor?" (JWT valid, session active, API key present and not revoked?) Authorization asks: "What can the actor do?" (permission grant, RBAC, role scope).  A JWT may be valid but a permission may be denied. The decisions are independent but sequential.

Failed authentication is `401 Unauthorized`. Failed authorization is `403 Forbidden`. The distinction is preserved in all error responses.

### L6 — Secrets are never plaintext

> Secrets (signing keys, webhook HMAC keys, OAuth tokens, database passwords) are stored encrypted at rest via the `EncryptedString` model. The database never holds plaintext. Encryption key is external to the database.

At-rest encryption is mandatory for all secrets. Plaintext in the database is a critical violation.

### L7 — Token revocation is immediate

> Revoked tokens and API keys are added to a **revocation list** cached in Redis (or in-process for dev). The list is checked on every request **before** the handler is invoked. Revocation is **immediate** — no eventual consistency.

If Redis is unavailable in production, the platform **fails closed**: requests are rejected with `503 Service Unavailable` rather than allowing potentially-revoked tokens.

### L8 — Deploy contract is non-negotiable

> The startup check `_assert_production_deploy_contract()` runs in the FastAPI lifespan startup, before any request handler executes. If any check fails, the application exits with a non-zero code and a detailed error message. There is no "continue anyway" option.

The deploy contract is the canonical authority for whether security controls are engaged. Violation is a boot error, not a runtime warning.

---

## 7. Core Concepts

### 7.1 Production deploy contract

The production deploy contract is the **canonical authority** for whether RLS actually engages. It lives in `app/config.py:_assert_production_deploy_contract()` and runs in the FastAPI lifespan startup, before any request handler executes.

**Principle: role split is mandatory.** Postgres RLS has a hard rule: the table owner bypasses RLS. GAAhex prevents this by running the application under a **second, unprivileged role** (`gaahex_app`). RLS then applies to every query the app issues. The owner role (`gaahex`) is reserved for:
- Schema ownership (migrations via Alembic)
- Pre-auth code paths (login email lookup, `/org-tree` boot read)
- Seed code (initial data population)

**Contract checks (in execution order):**

| # | Check | Condition | Consequence if violated |
|---|-------|-----------|------------------------|
| **1** | `DATABASE_URL ≠ OWNER_DATABASE_URL` | Postgres connection strings must differ | Boot error: `M1-A production deploy contract violation: DATABASE_URL and OWNER_DATABASE_URL are equal` |
| **2** | Role split (username check) | `DATABASE_URL` username ≠ `OWNER_DATABASE_URL` username | Boot error: `M1-A production deploy contract violation: ... use the same role` |
| **3** | No wildcard CORS | `CORS_ORIGINS` must not contain `*` | Boot error: wildcard CORS in production is a theft vector |
| **4** | No mock providers | Payment, email, SMS, RADIUS backends must be real | Boot error: mock providers in production fail startup |
| **5** | Portal auth mode | `PORTAL_AUTH_MODE ∈ {cookie, both}` | Boot error: invalid auth mode for external users |
| **6** | Feature flags imply backends | `feature_*_required=True` ⟹ backend constructs cleanly | Boot error: flag ON but real backend missing |

If `ENVIRONMENT != "production"`, all checks are no-ops. Development, testing, staging, and CI default to a single role for convenience.

**Roles and grants:**

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

### 7.2 RBAC & tenant isolation

**RLS as foundation, not a feature.** Row-Level Security is the **architectural foundation** of tenant isolation. It is not a feature that can be toggled off, and it is not a feature that is "nice to have." Every tenant-scoped table carries a `tenant_isolation` RLS policy bound to the `gaahex.tenant_id` session GUC.

**The RBAC model (file 17 — Security & Permission Standard).** The authorization system is a **four-layer decision stack**, evaluated in order:

1. **Identity layer:** Is the actor authenticated? (JWT valid, session active, API key present and not revoked?)
2. **Tenant layer:** Which tenant is the actor? (decoded from JWT `tenant` claim, validated against `User.tenant_id` server-side.)
3. **Role layer:** What permissions does the actor have? (role grants evaluated as a set of `permission_key` strings; wildcards allowed in grants: `*`, `object.*`, `object.action`.)
4. **Record layer:** Can the actor reach this specific record? (org-node scope, department filter, region scope, field visibility, record status, workflow state.)

**Permission keys are immutable and canonical.** Every permission is keyed as `{object}.{action}`, lowercase, dot-separated. Examples: `customer.view`, `customer.create`, `service.activate`, `configuration.manage`, `audit.export`.

**Permission keys are immutable once released to a tenant.** Renaming `customer.view` to `customer.read` is a breaking change for every existing role grant. Renaming is forbidden unless paired with a backfill migration that maintains all grants.

The canonical registry is `docs/standards/15-permission-registry.md`.

**Default-deny is the rule.** No grant means no access. `can(entity_key, verb, record_path)` returns true **iff**:
1. Some grant carries the permission (as `*`, `entity_key.*`, or the literal `entity_key.verb`), **AND**
2. The grant's scope covers the `record_path` (tenant, node, subtree, or region scope).

Otherwise, the decision is **default-deny** and the HTTP response is `403 AccessDenied`. The error message is **generic** — it never echoes which layer (role, department, region, ownership, field) refused, so a hostile caller can't map the matrix.

**Tenant isolation policy (RLS).** Every tenant-scoped table (`customer`, `service`, `contract`, `task`, etc.) has:

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

**Role denials override grants.** A role may declare **explicit denials** (`role_def_deny`) that override positive permissions.

Denial always wins over grant. A matching denial raises `AccessDenied` even if the role's positive permissions would allow the action.

**Field-level visibility.** A field may declare `view_roles` and `edit_roles` restrictions in its config. A field that a caller's roles may not view is **never** returned from the API, **never** included in search result snippets or highlights, **never** exported, **never** visible in reports, **never** exposed to AI views. This enforcement is identical across UI, API, exports, reports, and search — the security boundary is at the data layer, not the presentation layer.

Admins holding `configuration.manage` bypass field-level visibility.

### 7.3 Encryption posture

**Encryption at rest (database level).** Sensitive data in the database is encrypted at rest:

- **Secrets** (signing keys, webhook HMAC keys, OAuth tokens): stored via `EncryptedString` model — encrypted transparently on write, decrypted transparently on read. The database **never holds plaintext**. Encryption key is external to the database.
- **Credentials** in Integration/Developer Platform tables: encrypted at rest via the same pattern.
- **Personally identifiable information (PII)** in Party tables: encrypted at the model level where subject to regulatory requirements (future; placeholder for GDPR, CCPA, etc.).

**Encryption in transit (TLS).** All connections use TLS:

- **Database connections:** `postgresql://` is never acceptable in production. All connections use TLS: `postgresql+asyncpg://...` with certificate pinning where available.
- **API connections:** All external APIs are reached over HTTPS with certificate validation. No `verify=False` in production code.
- **Internal RPC:** Service-to-service calls within the platform default to HTTPS; plain HTTP is accepted only on loopback (`127.0.0.1:8099` in dev).
- **WebSocket (future):** If introduced, must use WSS (encrypted WebSocket), never WS.

**Encryption for blob storage.** Attachments, documents, and exports stored in object storage are encrypted at rest by the storage provider (S3-compatible, GCS, Azure Blob). Signed URLs enforce expiration and single-use constraints.

### 7.4 Secret management

**Never in plaintext environment variables.** The deploy contract forbids storing signing keys or credentials as plaintext in environment variables. At boot time, the application loads environment variables and immediately encrypts them for at-rest storage.

**Secrets are referenced by `secretRef`, not inline.** Any configuration that needs a secret (webhook signing key, OAuth client secret, database password) stores a **reference** (`secretRef`) to a `Secret` table row, not the plaintext value.

The `Secret` table is gated by a tight RLS policy: only the service that owns the secret can read it. Reading a secret is an audit event.

**Secret rotation policy.** Secrets are rotated on a schedule:
- **Short-lived** (OAuth tokens, API client secrets): 90 days.
- **Medium-lived** (signing keys, webhook HMAC keys): 1 year.
- **Long-lived** (database passwords): 1 year or on employee offboarding.

Rotation is **add-new-without-breaking-old**: a signing key is added, the next N requests are validated against both old and new, then the old key is retired. No service outage.

Rotation events are audit-logged with the actor, timestamp, and old/new secret fingerprints (not the plaintext).

**Access is always audited.** Every read of a secret (to sign a request, to decrypt stored data, to verify an incoming webhook) is recorded in the audit log as `SECRET_ACCESSED` with the service account, purpose, and timestamp.

A secret read with no corresponding event is a **security incident**.

### 7.5 Token lifecycle & JWT security

**JWT structure and claims.** GAAhex JWTs carry:

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

- **`sub` (subject):** The user's UUID. Immutable for the lifetime of the token.
- **`tenant`:** The user's tenant. **Validated server-side** against `User.tenant_id` — the user cannot claim a different tenant.
- **`role`:** The user's primary role key. Used for display; actual permissions are resolved server-side from the `assignment` table.
- **`iat` (issued at):** Seconds since epoch. Used to prevent token replay.
- **`exp` (expiration):** Seconds since epoch. Tokens older than this are rejected.
- **`jti` (JWT ID):** A unique identifier for this token instance. Used for revocation.

**Token TTL and refresh rotation.**

- **Access token TTL:** 1 hour. Frequent rotation reduces the window a stolen token can be used.
- **Refresh token TTL:** 7 days. Longer lived so users don't have to re-authenticate daily.
- **Refresh rotation:** On every refresh, the old refresh token is **invalidated**. Only the new token is valid. This prevents a leaked refresh token from being used multiple times.

**Token validation.** On every request:

1. **Extract the JWT** from the `Authorization: Bearer <jwt>` header.
2. **Verify the signature** (constant-time comparison) against the platform's signing key.
3. **Decode the payload** (do NOT trust claims before verification).
4. **Check expiration:** `exp > current_time`.
5. **Check revocation:** is `jti` in the revocation list? (checked against a fast-access cache; cache is invalidated on logout/revoke).
6. **Validate tenant:** does the JWT claim match `User.tenant_id` in the database?
7. **Resolve permissions:** load the user's role assignments and evaluate them against the requested action.

Failure at any step results in `401 Unauthorized` (not `403 Forbidden`; the distinction matters).

**Service account tokens.** Service accounts (integrations, background jobs, API clients) use **API keys** instead of JWTs:

```
Authorization: Bearer gaahex_prod_key_12345abcdef...
```

API keys are:
- **Scoped** to one service account and carry a list of permissions.
- **Rate-limited** per key (see § 7.6).
- **Logged** on every use (audit event: `API_KEY_USED`).
- **Rotatable** with the same add-new-keep-old pattern as secrets.
- **Revocable** immediately (list is checked against a fast cache).

**Revocation list.** Revoked tokens and keys are added to a **revocation list** cached in Redis (or in-process for dev). The list is checked on every request **before** the handler is invoked. Revocation is **immediate** — no eventual consistency.

If Redis is unavailable, the platform **fails closed**: requests are rejected with `503 Service Unavailable` rather than allowing potentially-revoked tokens.

### 7.6 Rate limiting

**Sliding-window algorithm.** Rate limits are enforced using a **sliding-window counter**. The window is 60 seconds; the limit is keyed by tenant + API key (or IP for unauthenticated endpoints).

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

**Limits by endpoint class:**

| Endpoint | Limit | Scope | Consequence |
|----------|-------|-------|-------------|
| Login / auth | 10 per minute | IP address | `429 Too Many Requests` |
| Password reset | 3 per hour | Email + IP | `429 Too Many Requests` |
| API write (create/update/delete) | 1,000 per minute | Tenant + API key | `429 Too Many Requests` |
| API read (list/get) | 10,000 per minute | Tenant + API key | `429 Too Many Requests` |
| Search | 1,000 per minute | Tenant + API key | `429 Too Many Requests` |
| Export | 10 per hour | Tenant + user | `429 Too Many Requests` |

Limits are **per-tenant** so one tenant's abuse doesn't affect others. A rogue API key can be rate-limited independently.

**Response format.** When a request is rate-limited:

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

**Burst protection.** To prevent abuse of the sliding window (e.g., 999 requests in second 1, then pause, then 999 in second 2), the platform also enforces a **per-second hard cap** of 50% of the per-minute limit. This prevents bursting to the limit in a single second.

### 7.7 Idempotency

**Idempotency keys for write endpoints.** Every POST/PUT/PATCH that mutates a record must carry an **Idempotency-Key** header:

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

**Implementation:**

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

**Audit trail.** Idempotent replays are **not re-audited**. The original event row in the audit log is the proof. A replay does not generate a second `CUSTOMER_CREATED` event.

### 7.8 Threat model & incident lifecycle

**Threat vectors (highest priority first):**

| Threat | Impact | Likelihood | Detection | Mitigation |
|--------|--------|-----------|-----------|-----------|
| **Cross-tenant data exposure** | Catastrophic — tenant data leaks to another tenant | Low (RLS + RBAC layered) | Automated: RLS test suite, tenant-filter analyzer | Fail-closed RLS; dual-role CI enforcement |
| **Privilege escalation** | High — attacker gains admin access | Low (RBAC immutable post-release) | Manual: code review; automated: permission-registry drift check | RBAC lockdown; audit of permission grants |
| **RCE via injection** | Catastrophic — arbitrary code execution | Low (no eval, SQLAlchemy ORM) | Automated: static analysis; manual: security review | Input validation; no dynamic code execution |
| **Data exfiltration via export/report** | High — bulk data download with stolen credentials | Medium (API key compromise likely) | Audit log (user + timestamp); rate limit (see § 7.6) | API key rotation; audit alerts on large exports |
| **Brute-force password attack** | Medium — attacker gains user access | High (automated attack) | Failed login rate limiting | 10/minute per IP; MFA (future) |
| **Credential leakage (leaked API key)** | High — attacker uses key for 7 days (refresh rotation) | Medium (social engineering, accidental paste) | Audit on every API key use; automated scan (gitleaks) | Immediate revocation; short TTL; refresh rotation |
| **DoS (rate limit exhaustion)** | Medium — service degradation | Medium (low barrier to entry) | Rate-limit metrics; anomaly detection | Sliding-window limits; burst protection |
| **Misconfiguration (role split not enforced)** | Catastrophic — RLS silently bypassed | Low (deploy contract enforces) | CI test (`test_deploy_contract.py`) | Startup refusal if contract violated |

**Incident lifecycle.** When a security incident is detected:

1. **Detect** (automated or manual) — anomaly detection, rate-limit spiking, suspicious access patterns, customer report.
2. **Classify** — severity (critical, high, medium, low) and category (injection, auth, exposure, etc.).
3. **Contain** — immediately revoke the affected API key, reset the user's password, or shut down the malicious service account.
4. **Investigate** — audit log is the source of truth. Trace the attacker's actions backward and forward in time.
5. **Mitigate** — patch the vulnerability, deploy the fix, validate RLS/RBAC still intact.
6. **Resolve** — confirm the attacker has no further access; conduct post-mortem to prevent recurrence.
7. **Post-mortem** — document the incident, the response, and the long-term fix in a sealed archive (future).

Every incident is **recorded** in an incident log (separate from the general audit log) with the timeline, the root cause, and the remediation.

---

## 8. Canonical Entities

Security Core owns the following canonical entities (per `09_DATA_ARCHITECTURE.md`):

- **Secret** — encrypted plaintext for signing keys, OAuth tokens, webhook HMAC keys, credentials.
- **EncryptionKey** — key material for at-rest encryption of secrets.
- **RateLimitPolicy** — configuration for sliding-window limits per endpoint.
- **IdempotencyKey** — cached response for replay prevention.
- **ThreatRule** — configuration for threat detection and incident response.

Supporting entities referenced:
- **User** (Identity Core) — bearer of authentication and role assignments.
- **RoleDefinition** (Policy Core) — named bundles of permissions.
- **Event** (Audit Core) — audit log records for all security actions.

---

## 9. Ownership Boundaries

Security Core is accountable for:

- **Positive surface (owns):** Authentication (JWT, API keys, sessions), RBAC (four-layer stack, permission evaluation, denials), encryption (at-rest, in-transit), secrets (storage, rotation, audit access), tokens (validation, revocation, TTL), rate-limiting, idempotency, threat model, incident response, deploy contract enforcement.
- **Negative surface (does NOT own):** Compliance workflows (Compliance Core), specific auth providers (Identity Core), observability alerting (Observability Core), AI action audit (AI Core), UI presentation of security controls (Workspace Core).

---

## 10. Relationships

### 10.1 Dependency direction

Security Core is **FOUNDATION tier**. It is depended on by all other cores:

```
[All other cores depend on Security Core]
           ↓
[FOUNDATION tier]
```

No core at any tier may bypass Security Core. Every request is evaluated for authentication and authorization by Security Core before the handler is invoked.

### 10.2 Universal dependencies

Security Core depends on:

- **Tenant Core** — every security decision is tenant-scoped.
- **Audit Core** — every security action is recorded.
- **Identity Core** — Security validates identities via Identity Core's User/ServiceAccount entities.
- **Time Core** — token TTL, token expiration, rate-limit windows.

### 10.3 Event subscription

Security Core emits events that other cores subscribe to:

- `User.Authenticated` — subscribed by Audit Core, Notification Core.
- `User.PermissionGranted` — subscribed by Audit Core, Notification Core.
- `Secret.Accessed` — subscribed by Audit Core, Observability Core.
- `ThreatDetected` — subscribed by Observability Core (alerting).

---

## 11. Responsibilities

### 11.1 Platform owner

- Approves changes to the threat model, deploy contract, or RBAC model.
- Reviews and approves all security-related PRs before merge.
- Escalates incidents and conducts post-mortems.

### 11.2 Security Core team (Platform Engineering)

- Maintains the deploy contract (`app/config.py:_assert_production_deploy_contract()`).
- Maintains RBAC evaluation logic (`app/kernel/authz.py`).
- Maintains RLS policies (alembic migrations for tenant-scoped tables).
- Maintains encryption/decryption helpers (`app/kernel/security.py`, `EncryptedString` model).
- Ensures every security action is recorded in the audit log.
- Runs the incident lifecycle on detected threats.
- Maintains the threat model and security documentation.

### 11.3 Code reviewers

- Confirm every permission check is present (no permission gaps).
- Confirm every mutation is audit-logged.
- Confirm no plaintext secrets in code.
- Confirm no `verify=False` in production API calls.
- Confirm no SQL string concatenation (SQLAlchemy ORM only).
- Confirm no dynamic code evaluation (no `eval`, no `exec`).

---

## 12. Allowed Patterns

### AP1 — Layered permission checks

A handler may check permissions at multiple layers (role layer, record layer, field layer) and deny at any layer. The decision tree is: role? → record? → field? → allow. Missing at any layer is deny.

### AP2 — Secrets via `secretRef`

Configuration that requires a secret stores a reference to a `Secret` table row, not the plaintext. Access to the secret is gated by RLS and audited on every read.

### AP3 — Token revocation via cache

A revoked token is added to the Redis revocation list immediately. The list is checked before the handler is invoked, so revocation is immediate even in distributed systems.

### AP4 — Rate-limit keys nested (tenant → key → endpoint)

A rate-limit counter is keyed by `f"ratelimit:{tenant}:{api_key}:{endpoint}"` so limits are enforced per tenant and per key independently. One tenant's abuse doesn't affect others.

### AP5 — Audit events emitted in the transaction

A mutation is wrapped in a transaction: (1) apply the change, (2) emit the audit event, (3) commit. If the audit fails, the transaction rolls back. Audit is always present.

---

## 13. Forbidden Patterns

### FP1 — Frontend permission gates

The frontend must never make permission decisions. The frontend may reflect backend decisions (hide a button), but the button's disabling is a display choice, not the authorization. Authorization is backend-only.

### FP2 — Plaintext secrets in environment

Secrets (signing keys, API tokens, credentials) are never stored plaintext in environment variables. At boot, they are loaded and immediately encrypted for at-rest storage.

### FP3 — Wildcard CORS in production

`CORS_ORIGINS` must not contain `*` in production. Every origin must be explicitly whitelisted. Wildcard CORS is a theft vector.

### FP4 — Single Postgres role in production

The application must run under `gaahex_app` (unprivileged). The owner role `gaahex` is for schema ownership only. A single-role setup in production bypasses RLS.

### FP5 — Permission checks only on the frontend

A feature that's disabled on the frontend but enabled in the backend (via permission grant) is a security bug. The backend is the authority; the frontend is the presentation.

### FP6 — Hardcoded permission checks in code

Permission checks must be data-driven (from `docs/standards/15-permission-registry.md`) and evaluated at runtime from the role definition, not hardcoded as `if role == "admin"`. Hardcoding prevents dynamic role customization.

### FP7 — Mutations without audit

A state change that is not recorded in the `event` table is a silent mutation — forbidden. Every CREATE, UPDATE, DELETE must emit an audit event.

### FP8 — Rate-limit bypass in code

Rate-limiting is enforced in the middleware, before the handler. It is never bypassed for internal endpoints or background jobs. Background jobs have their own rate-limit policies; internal endpoints use the same limits as external ones.

---

## 14. Cross-Architecture Dependencies

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

## 15. Implementation Requirements

### 15.1 Deploy contract enforcement

The application MUST run `_assert_production_deploy_contract()` in the FastAPI lifespan startup. If any of the 6 checks fails in production, the application exits with a non-zero code. The check is a no-op in non-production environments.

### 15.2 RBAC evaluation

Every request handler MUST be wrapped in a permission check via `require_permission(actor, permission_key, resource)`. The check happens before the handler is invoked. Failure returns `403 AccessDenied` with a generic error message.

### 15.3 RLS policies

Every tenant-scoped table MUST have a `tenant_isolation` RLS policy:

```sql
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id'), ''));
```

### 15.4 Audit logging

Every mutation MUST emit an audit event via `workflow.emit(event_type=..., entity_key=..., record_id=..., ...)`. The event is written to the `event` table in the same transaction as the mutation.

### 15.5 Secret encryption

Every secret (signing key, webhook HMAC key, OAuth token, credential) MUST be stored via the `EncryptedString` model. The model encrypts on write and decrypts on read; the database never holds plaintext.

### 15.6 Token revocation

Revoked tokens and API keys MUST be added to the Redis revocation list immediately. The revocation list MUST be checked on every request before the handler is invoked.

### 15.7 Input validation

Every request body MUST be validated against a Pydantic schema before the handler is invoked. Unknown fields MUST be rejected. Type coercion (dates to ISO 8601, enums to UPPER_SNAKE_CASE) MUST be applied.

### 15.8 Rate limiting

Every endpoint MUST be protected by a sliding-window rate limiter. The limit is per-tenant (for authenticated endpoints) or per-IP (for unauthenticated endpoints). Violation returns `429 Too Many Requests`.

### 15.9 OWASP Top 10 coverage

The implementation MUST address all 10 OWASP vectors: injection (SQLAlchemy ORM), broken auth (PBKDF2 + rate-limit), sensitive data (encryption), broken access (RLS + RBAC), misconfiguration (deploy contract), deserialization (Pydantic), XSS (React auto-escape), API response safety (type hints), vulnerable components (pip-audit), insufficient logging (append-only audit).

---

## 16. Future Expansion Rules

### 16.1 MFA framework

The platform reserves a future `MfaCredential` entity (Identity Core) and `MFA_REQUIRED` permission. MFA support (TOTP or SMS) will be optional per tenant via a feature flag.

### 16.2 Anomaly detection

Future: automated alerting on suspicious patterns (brute-force login attempts, cross-tenant access attempts, bulk exports, repeated rate-limit violations). Subscribes to audit events and emits `ThreatDetected` events.

### 16.3 Incident log

Future: a separate incident log (distinct from the general audit log) with timeline, root cause, and remediation. Incident records are created by the incident response team and marked as resolved/unresolved.

### 16.4 Secrets rotation automation

Future: automated rotation of signing keys, webhook HMAC keys, and API client secrets on schedule. Old and new secrets are valid during the rotation window; the old secret is retired after N requests are validated against both.

### 16.5 CSP header

Future: X-Content-Security-Policy header to restrict script sources, inline styles, and external resource loading on the frontend.

### 16.6 Compliance integration

Future: Privacy Core integration to support GDPR/CCPA data subject requests, retention policies, and consent auditing. Compliance requests are processed by Compliance Core; Security Core audits the processing.

### 16.7 Field-level encryption

Future: individual table columns (PII fields) encrypted at rest independent of the `EncryptedString` model. Decryption only by authorized roles (via field-level visibility configuration).

---

*End of 13 — Security Architecture.*
