# 19 — Infrastructure Architecture

**Constitutional document.** Position in the hierarchy: operationalizes the 5 kernel engines' substrate layer and proves **Configuration from above, not hardcoded below** with immutable audit, fail-closed deployment, and dual-role database access.

**Governed by:** Sealed Baseline (§A2, A3, A5, A6), M1-A Deploy Contract, M1-C Environment, PRM (`Storage Core`, `Background Processing Core`), 01-Platform Core Architecture (`PLATFORM SERVICES` tier).

---

## 1. Purpose

Define the five fixed kernel engines' execution substrate and the non-negotiable infrastructure contracts that prove:

- **Tenant isolation engages at the database layer** (RLS via dual-role Postgres).
- **Audit is append-only at the database layer** (Postgres triggers on `event` and `audit_log`).
- **Background processing is reliable and observable** (queues substrate, worker health, job lineage).
- **Secrets and credentials are never stored in audit trails** (encrypted vault pattern).
- **The platform boots into a verified operational state** (deploy contract gates production startup).

---

## 2. Scope

In scope:

- Compute runtime (FastAPI / React, stateless design, concurrency model).
- Persistent storage (PostgreSQL primary + multi-tenancy via RLS, append-only audit tables).
- Ephemeral cache (Redis, request-scoped, no audit data).
- Network topology (dev via docker-compose, production via cloud VPC).
- Deploy contract (six mandatory infrastructure checks at app startup).
- Environment variables and secrets management (bootstrap, vendor integration, rotation).
- Background processing substrate (queues, workers, job lineage, idempotency).
- Binary asset storage (Storage Core abstraction, blob lifecycle, virus scanning).
- Scaling strategy (horizontal compute, vertical database, cache tier).
- Monitoring, observability, logging, and tracing.
- Backup, disaster recovery, and point-in-time recovery.
- Multi-region expansion paths (reserved for M2+).
- Security posture (secrets, database access, outbound calls, webhook verification).
- Configuration as code (environment-specific config, feature gates).
- Infrastructure testing (killer tests proving invariants, RLS enforcement).

Out of scope:

- Feature-level integrations (see `12_INTEGRATION_ARCHITECTURE.md`).
- Vendor-specific compliance (SaaS vendor contract terms, audit standards).
- Domain-specific data models (see `09_DATA_ARCHITECTURE.md`).
- UI experience and workspace layout (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).

---

## 3. Goals

- **G1.** Compute tier is stateless and horizontally scalable (FastAPI + Redis, no session affinity).
- **G2.** Persistent storage is single-source-of-truth for all state (PostgreSQL primary with RLS engagement).
- **G3.** Multi-tenant audit is immutable and queryable at the database layer (append-only triggers + GUC-bound tenant_id).
- **G4.** Background work is decoupled from request-reply (queues substrate, worker processes, observability).
- **G5.** Storage of binary assets is abstracted and lifecycle-governed (Storage Core; S3 / Azure Blob compatible).
- **G6.** Production boot is fail-closed and contract-enforced (deploy gate checks role separation, CORS, providers, feature flags).
- **G7.** Multi-region expansion is architected for M2+ without refactoring request-reply paths (single region for M1).

---

## 4. Non-Goals

- **NG1** This document does NOT define entity schemas or data models (see `09_DATA_ARCHITECTURE.md`).
- **NG2** This document does NOT prescribe vendor-specific compliance or audit standards (those are tenant or deployment choices).
- **NG3** This document does NOT define UI placement or workspace layout (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).
- **NG4** This document does NOT design microservice boundaries or internal package layout (see `02_DOMAIN_ARCHITECTURE.md`).
- **NG5** This document does NOT govern brand or visual identity (see `docs/branding/v3.0/`).

---

## 5. Architecture Principles

### P1 — Configuration drives behavior; infrastructure proves immutability.

The platform reads its behavior from configuration (Workflow Core, Background Processing Core, Governance Core, Policy Core). The infrastructure substrate (database, cache, queues, secrets vault) is configuration-*agnostic*; it enforces immutability (append-only audit) and isolation (RLS, tenant_id column) but never hardcodes business rules.

### P2 — Stateless compute means zero affinity, infinite scale.

Every request handler owns its transaction boundary and state; nothing persists in-process. This makes the backend horizontally scalable and eliminates sticky-routing complexity. Loss of a single instance does not lose user state.

### P3 — Tenant isolation is a database invariant, not an application courtesy.

RLS policies on every tenant-scoped table, enforced by a distinct database role (`gaahex_app` with NOBYPASSRLS), ensure that a code bug or a compromised request cannot leak cross-tenant data. Isolation is physical, not procedural.

### P4 — Audit is write-once, read-never-delete.

The `event` and `audit_log` tables are append-only (Postgres triggers forbid UPDATE / DELETE, even by table owner). Every state change is immutable evidence; deletion or mutation of audit records requires constitutional amendment to the trigger rule.

### P5 — Secrets live outside the application; retrieval is per-request or per-startup.

Database passwords, API keys, webhook secrets, and vendor credentials are stored in a secrets manager (AWS Secrets Manager, GCP Secret Manager, Vault), fetched at startup or per-request, and never logged or serialized in error messages.

### P6 — Fail-closed production deployment prevents unsafe configuration.

At application startup in production, six mandatory checks run (`_assert_production_deploy_contract()`). If any check fails, the app refuses to boot with an explicit error message. This prevents silent degradation and ensures every production instance is verified against invariants.

### P7 — Multi-tenant background processing is a first-class substrate.

Background jobs (imports, exports, async notifications, report generation) are queued, observable, and idempotent. Job execution is separated from the request-reply path; a failed job does not hang a user request. Job lineage is immutable (events + audit).

### P8 — Blob storage is abstracted; lifecycle is governed.

Documents, attachments, and assets are stored via the Storage Core abstraction (implementing S3 / Azure Blob compatible APIs). The Document Core owns the *meaning* (what bytes represent); Storage Core owns the *infrastructure* (where bytes live). Lifecycle (retention, soft-delete grace, virus scanning) is transparent to the application.

---

## 6. Architecture Laws

These are the hard rules. Violation is grounds to reject a PR.

### L1 — Dual-role Postgres contract is non-negotiable.

- `gaahex` (owner, BYPASSRLS) is used **only** by Alembic migrations, pre-auth code paths, and backup/restore scripts (ops only).
- `gaahex_app` (app, NOSUPERUSER NOBYPASSRLS) is used by all request handlers. RLS policies enforce tenant isolation on every read/write.
- Production startup MUST verify these roles are different and correctly assigned. If check fails, boot refusal with explicit error message + link to M1-A Deploy Contract.

### L2 — Append-only audit is a constitutional invariant.

The `event` and `audit_log` tables MUST NOT be mutated by any path except the append. Postgres triggers enforce this at the database layer, even for the table owner. A trigger rule change requires constitutional amendment.

### L3 — Every state-changing action produces an immutable audit record.

- Every create / update / delete / transition calls `workflow.emit(...)` which inserts exactly one `event` row.
- The row carries actor_user_id, tenant_id, timestamp, entity_key, record_id, old/new data, source (request / automation / integration), and context (approval chain, policy decision, workflow guard).
- The event is immutable once inserted.

### L4 — Secrets are never logged, ever.

- No secret (API key, password, webhook secret, API token) may appear in application logs, even at DEBUG level.
- A failed Stripe charge logs the charge ID and error code, never the card CVV or API secret.
- Pre-commit hooks scan for common secret patterns (gitleaks).
- `.env` files are in `.gitignore`; `.env.example` is in git (shows the shape, not the values).

### L5 — Production deploy contract gates all unsafe configurations.

At application startup in production (`settings.environment == "production"`), these six checks MUST pass:

1. **Role split (URL):** `DATABASE_URL ≠ OWNER_DATABASE_URL` (verified by parsing usernames).
2. **Role split (username):** App role ≠ owner role.
3. **CORS wildcard:** No `*` in `CORS_ORIGINS` list.
4. **Mock providers:** No mock payment gateway, email, SMS, RADIUS in production.
5. **Portal auth mode:** `PORTAL_AUTH_MODE ∈ {cookie, both}`.
6. **Feature gate consistency:** Every feature flag ON ⟹ real implementation present.

If any check fails, boot refusal with explicit error message and reason. New infrastructure invariants are added as checks #7, #8, etc. In dev / test / staging, all checks are skipped (no-op).

---

## 7. Core Concepts

### 7.1 Compute tier (request-reply)

- **Runtime:** Python 3.12+ with FastAPI (async HTTP server), Uvicorn (ASGI).
- **Concurrency:** Uvicorn spawns worker processes (1 in dev; auto-scaled in prod); each worker is async (250–500 concurrent requests via asyncio).
- **Statefulness:** Stateless by design; no in-memory session store, no sticky routing. All state lives in PostgreSQL or Redis.
- **Health check:** `GET /api/health` returns 200 + JSON `{"status": "ok"}` when app and database are reachable.
- **Frontend:** React 18 + TypeScript, bundled with Vite, served as static HTML + JS assets (dev on port 5173; prod on 3000+).
- **Request entry:** Every request sets `gaahex.tenant_id` GUC (Postgres session parameter) from JWT `tenant` claim before route handler runs. RLS policies read this GUC; if request user's tenant_id ≠ JWT tenant, 404.

### 7.2 Persistent storage (truth)

- **Primary:** PostgreSQL 16.x with PostGIS 3.4 (initialized M1-C.5).
- **Schema:** 111 migrations (as of 2026-06-05) defining 65 core tables + audit / event tables. All migrations are forward-only, append-only; downgrade migrations are not maintained.
- **Multi-tenancy:** Every tenant-scoped row carries `tenant_id` FK to `tenant.id`; 209 policy lines across 111 migrations enforce RLS.
- **Audit:** `event` table (append-only via Postgres triggers, forbid UPDATE/DELETE) + `audit_log` table (shadow of `event` for compliance queries, also append-only).
- **Transaction isolation:** PostgreSQL `READ COMMITTED` (default); long-running transactions forbidden (HTTP request timeout 30s).

### 7.3 Ephemeral cache (scale)

- **Redis 7.x:** Request-scoped caching (parsed JWT, role permissions, entity definitions), session store (optional), rate-limit counters, background-job queue (M1+).
- **Data lifetime:** Ephemeral; no guarantees beyond "best effort". Loss of Redis means cold cache reload; no audit or business data lives here exclusively.
- **Multi-tenancy:** No cross-tenant data; cache keys scoped by `tenant_id` (e.g., `role:tenant:{tenant_id}:user:{user_id}`).
- **Persistence:** `appendonly no` (no RDB snapshots or AOF logs; ephemeral by design).
- **Single instance (M0–M1):** `cache.r6g.large` (8 GB, `allkeys-lru` policy). Redis cluster (6 nodes) reserved for M2+.

### 7.4 Network topology

**Development (docker-compose):**
```
┌─────────────────────────────────────────┐
│ Browser:5173 (Vite) ──┐                 │
│                       ▼                  │
│               Backend (FastAPI:8099)    │
│                       │                  │
│         ┌─────────────┼─────────────┐    │
│         ▼             ▼             ▼    │
│      Postgres:5433  Redis:6380    (fs)  │
│    (pgdata volume)  (ephemeral)         │
└─────────────────────────────────────────┘
```

**Production (cloud VPC):**
```
┌───────────────────────────────────────────┐
│ Internet edge (CDN / TLS termination)    │
│         Cloudflare / AWS CloudFront       │
│         (CORS + rate-limit)               │
│                   │                        │
│                   ▼                        │
│         Load Balancer (ALB / NLB)         │
│       (health check, auto-scale)          │
│                   │                        │
│     ┌─────────────┼──────────────┐        │
│     ▼             ▼              ▼        │
│  Backend-1    Backend-2    Backend-N     │
│  (FastAPI)    (FastAPI)    (FastAPI)     │
│                   │                        │
│                   ▼ (read/write)          │
│          PostgreSQL RDS Primary           │
│   (gaahex_app + gaahex roles)             │
│                   │                        │
│     ┌─────────────┼────────────┐          │
│     ▼             ▼            ▼          │
│  Replica-A   Replica-B  (WAL archive)    │
│  (read-only) (standby)   (S3 / GCS)      │
│                                           │
│          Redis Cluster (Elasticache)     │
│       (6 nodes, replication enabled)      │
│                                           │
│          Background Job Workers           │
│  (separate auto-scale group, N instances) │
│          (connect to RDS + Redis)         │
│                                           │
│          Blob Storage (S3 / GCS)          │
│  (documents, attachments, backups)        │
│                                           │
│      Secrets Manager (AWS / GCP / Vault)  │
│  (API keys, DB passwords, webhook secrets)│
└───────────────────────────────────────────┘
```

- **TLS:** Terminated at edge (load balancer / CDN); plaintext within VPC.
- **Certificate management:** Auto-renewal via ACME (Let's Encrypt) or cloud provider's managed service.
- **Cross-region traffic (M2+):** VPN tunnel or cloud interconnect (AWS Direct Connect) to maintain encryption.
- **Egress:** Outbound calls to external vendors (Stripe, SendGrid, Twilio, FreeRADIUS) use HTTPS with certificate pinning (if available).

### 7.5 Deploy contract (production hardening)

The **M1-A Production Deploy Contract** (`_assert_production_deploy_contract()` in `app/config.py`, called from FastAPI lifespan) is a set of six non-negotiable checks executed at application startup. See §6, L5 for the full list.

**Trigger:** `settings.environment == "production"`. In dev / test / staging, all checks are skipped (no-op).

**Extensibility:** New infrastructure invariants are added as checks #7, #8, etc., with the same fail-closed pattern. Migration path: land the canonical implementation first, add the check, then flip the gate to ON in production.

### 7.6 Background processing substrate

**M0 (present):** Jobs are stubbed. `FEATURE_IMPORT_ENGINE_ENABLED=false` and `IMPORT_ENGINE_IMPLEMENTED=False`. The `/api/imports/{id}/start` endpoint returns 503 with `"feature_disabled"` body.

**M1 (planned):** Full background-job infrastructure with:
- **Queue technology:** Redis-backed queue (e.g., RQ / Celery) in M1-A; durable broker (RabbitMQ / AWS SQS) in M2+.
- **Job classes:** Import jobs, export jobs, async notifications, integration sync, report generation, billing cycles.
- **Worker pool:** Separate auto-scale group; N workers polling queue, each processing jobs until completion or dead-letter.
- **Idempotency:** Every job carries an idempotency key. Duplicate submissions (from webhook retries) are detected and de-duped at queue or job layer.
- **Observability:** Job start / progress / completion / failure are emitted as events and stored in `event` table. Job outcome is linked to the request that triggered it.

### 7.7 Storage Core (blobs)

**Provider abstraction:** Backend uses `app/services/storage.py::StorageClient` interface. Implementation may be:
- **Dev:** Local filesystem (`/tmp/gaahex-storage/`).
- **Prod:** S3 (AWS) or Azure Blob Storage (Microsoft).
- **On-prem:** MinIO or S3-compatible service.

**Ownership boundary:**
- **Storage Core owns infrastructure** (where bytes live, replication, disaster recovery).
- **Document Core owns meaning** (a Document record references a blob ID).

**Blob lifecycle:**
1. Upload: Client requests signed upload URL (15 min validity), uploads directly to storage, notifies backend with blob_id + metadata.
2. Backend validates blob exists and size matches, creates Document record with FK to blob.
3. Download: Client requests Document; backend checks permission + tenant filter, generates signed download URL (24h validity), client downloads directly from storage.
4. Retention: Default is blob lifetime = Document lifetime. Soft-delete: Document deleted → blob marked for deletion (24h grace period). After grace, blob purged. Compliance: Longer retention configured per-tenant via `TenantSetting` (e.g., 7-year hold for contracts). Blobs not deleted until both document lifecycle expires AND tenant retention policy allows.

**Virus scanning:** Async job receives blob_id, downloads blob, runs ClamAV (or equivalent), stores result in `blob.virus_scan_status`. Document with `virus_scan_status = 'INFECTED'` may not be accessed (fail-closed). If antivirus unavailable, blob marked `SCAN_PENDING` and access blocked.

---

## 8. Canonical Entities

### 8.1 Database tier

**Core tables (65 total, see `09_DATA_ARCHITECTURE.md` for full registry):**
- Tenant, User, Role, Permission, Session, MfaCredential (Identity Core, Tenant Core, Security Core).
- Event, AuditLog (Audit Core).
- WorkflowDefinition, State, Transition, WorkflowInstance, TransitionHistory (Workflow Core).
- And 58 more across all 7 tiers (see `09_DATA_ARCHITECTURE.md`).

**All tenant-scoped tables:**
- Carry `tenant_id` column (FK to `tenant.id`).
- Have RLS policy: `CREATE POLICY tenant_isolation ... USING (tenant_id = CURRENT_SETTING('gaahex.tenant_id')::uuid)`.

**Append-only tables:**
- `event` table: Insert-only; Postgres trigger forbids UPDATE / DELETE.
- `audit_log` table: Shadow of `event`; also append-only via trigger.

### 8.2 Cache tier (Redis)

- Request-scoped keys: `role:tenant:{tenant_id}:user:{user_id}`, `jwt:session:{session_id}`, etc.
- Rate-limit counters: `ratelimit:{endpoint}:{tenant_id}:{user_id}`.
- Job queue: `queue:background_jobs` (M1+).
- No cross-tenant data; keys are ephemeral (evicted via `allkeys-lru` when memory limit exceeded).

---

## 9. Ownership Boundaries

### 9.1 Storage Core owns infrastructure; Document Core owns meaning.

Storage Core is responsible for:
- Where blobs are stored (S3, Azure, local filesystem).
- Replication, disaster recovery, backup.
- Signed URL generation, TTL enforcement, access logging.
- Virus scanning integration and result storage.

Document Core is responsible for:
- Document record lifecycle (create, update, delete, archive).
- Linking Document to blob_id.
- Permission checks (`document.view`, `document.edit`, `document.delete`).
- Retention policies (when linked blob may be purged).

### 9.2 Background Processing Core owns job infrastructure; business cores own job semantics.

Background Processing Core is responsible for:
- Queue substrate (Redis, RabbitMQ, or SQS).
- Worker pool health and scaling.
- Job scheduling and retry logic.
- Dead-letter handling.
- Observability (metrics, traces, logs on job execution).

Business cores (Import Core, Export Core, Notification Core, Integration Core, Reporting Core) are responsible for:
- Job class definition (what work the job performs).
- Idempotency key logic.
- Event emission (job started, job completed, job failed).
- Audit record linkage (job outcome → audit trail).

### 9.3 Database access is split by role.

- `gaahex` role (owner, BYPASSRLS): Alembic migrations, pre-auth code (user lookup, org tree, seed), backup/restore scripts (ops only). **Never in production request handlers.**
- `gaahex_app` role (app, NOBYPASSRLS): All request handlers. RLS policies enforce tenant isolation on every read/write.

---

## 10. Relationships

### 10.1 Dependencies

**Infrastructure layer depends on:**
- **Identity Core** (who is making the request; JWT extraction, MFA validation).
- **Tenant Core** (which scope; tenant_id from JWT claim).
- **Audit Core** (recording state changes; event emission).
- **Security Core** (secret rotation, encryption keys, rate-limiting, webhook signature verification).
- **Governance Core** (deploy contract checks, configuration schema validation).

**Five kernel engines depend on Infrastructure layer:**
- **WorkItem movement engine** (request routing, state transitions, audit).
- **Auth/authz engine** (RLS enforcement, permission checks, JWT parsing).
- **Database engine** (Postgres primary, RLS policies, append-only audit).
- **Audit/log engine** (event table, audit_log table, immutability).
- **Security engine** (secrets manager, encryption, rate-limiting, webhook verification).

### 10.2 Background processing depends on

- **Queue substrate** (Redis, RabbitMQ, SQS).
- **Event Core** (job start / progress / completion / failure events).
- **Audit Core** (job execution immutable evidence).
- **Observability Core** (metrics, traces, logs on worker health).
- **Identity Core** (service account or worker identity for job execution).

### 10.3 Storage Core depends on

- **Blob provider** (S3, Azure Blob, MinIO).
- **Virus scanning service** (ClamAV or equivalent).
- **Audit Core** (blob upload / download / delete events).
- **Security Core** (signed URL generation with HMAC keys).
- **Observability Core** (storage I/O metrics, virus scan results).

---

## 11. Responsibilities

### 11.1 Infrastructure owner (platform engineer / ops)

- Provisions and operates compute tier (FastAPI + Uvicorn, load balancers, auto-scaling groups).
- Provisions and operates PostgreSQL (primary + replicas, RLS policies, migrations, backups).
- Provisions and operates Redis (cache tier, job queue substrate).
- Maintains deploy contract checks; adds new checks as invariants emerge.
- Manages secrets rotation (database passwords 90d, API keys 180d).
- Monitors infrastructure health (CPU, memory, I/O, replication lag, backup success).
- Executes disaster recovery runbook if primary database fails.

### 11.2 Backend team (application engineers)

- Ensures every request handler sets `gaahex.tenant_id` GUC before accessing state.
- Ensures every state-changing action calls `workflow.emit(...)` to create immutable audit record.
- Never logs secrets (API keys, passwords, webhook secrets).
- Ensures background jobs are idempotent and observable.
- Ensures blob uploads / downloads go through Storage Core API.
- Tests RLS enforcement via `backend/tests/test_rls.py`, `test_rls_parametric.py`.

### 11.3 Frontend team (client engineers)

- Expects backend to enforce tenant isolation and audit immutability.
- Implements signed URL flow for blob upload / download (no binary data in request body).
- Handles background job polling or webhook notifications for async work completion.

---

## 12. Allowed Patterns

### AP1 — Multi-role Postgres with BYPASSRLS split

A migration script runs as `gaahex` (BYPASSRLS) to ensure schema changes apply regardless of RLS policies. A request handler uses `gaahex_app` (NOBYPASSRLS) to ensure RLS policies are enforced. This dual-role contract is the single most important infrastructure invariant.

### AP2 — Append-only audit via Postgres triggers

The `event` and `audit_log` tables are protected by triggers that forbid UPDATE / DELETE. Even if a code path or a database user tries to mutate an audit record, the trigger blocks it. Immutability is enforced at the database layer, not by application discipline.

### AP3 — GUC tenant_id isolation

Every request handler sets `gaahex.tenant_id` (Postgres `CURRENT_SETTING()` parameter) from JWT claim. RLS policies read this GUC to filter rows. A bug in the application's tenant extraction logic is caught by RLS at the database layer (wrong tenant_id ≠ row's tenant_id → no access).

### AP4 — Idempotent background jobs with replay immunity

A job with idempotency key `job:import:tenant:123:key:abc` is processed exactly once. Duplicate submissions (from webhook retries, request retries) are detected at queue layer and de-duped. Job outcome is linked to the original request via event evidence.

### AP5 — Blob lifecycle with soft-delete grace period

When a Document is deleted, its blob is marked for deletion (not immediately purged). A 24-hour grace period allows recovery. After grace period, blob is purged. Compliance holds (e.g., 7-year retention) extend this grace period; blob is not purged until both document lifecycle expires AND tenant retention policy allows.

---

## 13. Forbidden Patterns

### FP1 — No hardcoded business rules in infrastructure

The infrastructure substrate (database, cache, queues, storage) is configuration-*agnostic*. It does NOT enforce workflow states, approval chains, SLA rules, or pricing tiers. Those are expressed in configuration (Workflow Core, Approval Core, SLA Core, Entitlement Core) and evaluated at request time.

### FP2 — No session affinity in the compute tier

Every request lands on any backend instance. No sticky routing based on user_id, tenant_id, or session_id. Stateless design means loss of a single instance does not lose user state.

### FP3 — No synchronous critical-path call to slow external APIs

A request handler that waits for Stripe to respond is a mistake; the HTTP request times out and the user sees a hang. Instead, the handler queues an async job and returns immediately. External API calls are non-blocking.

### FP4 — No ungoverned cron in code

If a job runs on a schedule (daily import, hourly sync), the schedule is expressed via configuration (Workflow Core or Background Processing Core config entity), not hardcoded `@schedule` decorators in Flask/FastAPI. Schedules are auditable and tenant-configurable.

### FP5 — No direct shell invocation to external systems

All external calls go through typed client libraries (e.g., `stripe.Charge.retrieve()`, not `os.system('curl stripe.com')`). Shell invocation loses type safety and auditability.

### FP6 — No secrets in .env files committed to git

`.env` files are in `.gitignore`. `.env.example` is in git (shows the shape, not the values). In production, secrets are fetched from AWS Secrets Manager / GCP Secret Manager / Vault at startup.

### FP7 — No cross-tenant cross-core direct write

A core does NOT directly write to another core's tables. Even within a transaction, writes go through the owning core's API or via a published event handler the owning core publishes. Cross-tenant pollution is prevented by RLS at the database layer.

### FP8 — No audit record mutation or deletion

The `event` and `audit_log` tables are append-only. No UPDATE, DELETE, or TRUNCATE is permitted, even by the table owner (`gaahex` role). If an audit record is erroneous, the correction is a *new* audit record explaining the error, not a deletion of the original.

---

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Storage Core, Background Processing Core definitions. |
| `08_PERMISSION_ARCHITECTURE.md` | RLS policies map to permission keys. |
| `09_DATA_ARCHITECTURE.md` | Canonical entity matrix; tenant_id column requirements. |
| `11_EVENT_ARCHITECTURE.md` | Job start/completion events published by Background Processing Core. |
| `13_SECURITY_ARCHITECTURE.md` | Secrets management, encryption, webhook signature verification. |
| `14_TENANT_ARCHITECTURE.md` | Tenant_id universality, RLS enforcement. |
| `PLATFORM_REFERENCE_MODEL.md` | Storage Core, Background Processing Core specifications. |

| Documents that depend on this one |
|---|
| `02_DOMAIN_ARCHITECTURE.md` (modules implement cores; infrastructure is substrate). |
| `05_OPERATIONAL_ARCHITECTURE.md` (ops runbooks assume these invariants). |
| `12_INTEGRATION_ARCHITECTURE.md` (integrations are async; depend on background processing). |
| `18_OBSERVABILITY_ARCHITECTURE.md` (metrics, logs, traces collected from infrastructure layer). |

| External implementation references | Reason |
|------------------------------------|--------|
| `../catalogs/SYSTEM_CAPABILITY_CATALOG.md` | ~110 non-UI system capabilities (motion / accessibility / WCAG / browser support / data-state / i18n / permission / observability) tier-by-tier with current build status. Single source for "do we have X yet?" infra-adjacent questions. |
| `../runbooks/M1A-DEPLOY-CONTRACT.md` | Production deploy contract for the two-role Postgres setup (RLS engagement). |
| `../runbooks/PRE-LAUNCH-CHECKLIST.md` | Pre-prod operational checklist (security, correctness, vendor configuration). |
| `../runbooks/LAUNCH-HARDENING.md` | Production deployment hardening guide. |
| `../runbooks/M1-C-ENV.md` | Production env-var shape for vendor integrations. |

---

## 15. Implementation Requirements

### 15.1 Deploy contract enforcement

The `_assert_production_deploy_contract()` function in `app/config.py` MUST be called from FastAPI lifespan (startup event) when `settings.environment == "production"`. All six checks (see §6, L5) MUST pass or the app refuses to boot with an explicit error message.

**New checks:** As invariants emerge, add check #7, #8, etc. to the deploy contract. Land the canonical implementation first (so it's always-true in all environments), add the check, then flip the gate to ON in production.

### 15.2 RLS policy enforcement

Every tenant-scoped table MUST have:
- `tenant_id` column (FK to `tenant.id`).
- RLS policy: `CREATE POLICY tenant_isolation ... USING (tenant_id = CURRENT_SETTING('gaahex.tenant_id')::uuid)`.
- Alembic migration enforcing both (209 policy lines across 111 migrations as of 2026-06-05).

**Testing:** `backend/tests/test_rls.py`, `test_rls_parametric.py`, `test_deploy_contract.py` prove RLS enforcement via `gaahex_app` role (NOBYPASSRLS).

### 15.3 Append-only audit triggers

Every `event` and `audit_log` table mutation attempt is intercepted by Postgres triggers:

```sql
CREATE TRIGGER event_immutability BEFORE UPDATE OR DELETE ON event
  FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
```

The `prevent_mutation()` function raises an exception. No UPDATE / DELETE succeeds, even if attempted by `gaahex` (owner) role.

### 15.4 Secrets management

**Bootstrap secrets:**
```bash
ENVIRONMENT=production                           # 'development' | 'production'
DATABASE_URL=postgresql+asyncpg://gaahex_app:...  # app role (NOBYPASSRLS)
OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:... # owner role (BYPASSRLS, migrations)
REDIS_URL=redis://redis:6379/0                    # ephemeral cache
```

**Vendor integration secrets (M1-C scaffold):**
```bash
PAYMENT_GATEWAY_PROVIDER=stripe              # 'mock' | 'stripe'
STRIPE_PUBLISHABLE_KEY=pk_live_xxx           # frontend-visible
STRIPE_SECRET_KEY=sk_live_xxx                # backend-only, never logged
STRIPE_WEBHOOK_SECRET=whsec_live_xxx         # verify webhook signatures

EMAIL_GATEWAY_PROVIDER=sendgrid              # 'mock' | 'sendgrid'
SENDGRID_API_KEY=SG.xxx                      # send emails, never logged
SENDGRID_WEBHOOK_PUBLIC_KEY=xxx              # verify webhook signatures

SMS_GATEWAY_PROVIDER=twilio                  # 'mock' | 'twilio'
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_MESSAGING_SERVICE_SID=MGxxx
TWILIO_WEBHOOK_AUTH_TOKEN=xxx                # verify webhook signatures

RADIUS_BACKEND_PROVIDER=freeradius           # 'mock' | 'freeradius'
RADIUS_HOST=10.0.0.1
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_SECRET=shared-secret                  # MAC for RADIUS packets, never logged
```

**Production secret storage:** AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault (not in git, not in .env files, not in container images).

**Rotation:** Database passwords every 90d, API keys every 180d (configurable). Rotation is transparent to app (new password issued, connection string updated in Secrets Manager, app reads new URL on next deploy).

### 15.5 Blob storage integration

Backend uses `app/services/storage.py::StorageClient` interface. Implementation options:
- **Dev:** Local filesystem (`/tmp/gaahex-storage/`).
- **Prod:** S3 (AWS) or Azure Blob Storage (Microsoft).
- **On-prem:** MinIO or S3-compatible service.

**Blob upload flow:**
1. Client requests signed upload URL: `POST /api/documents/upload-url?filename=...&content_type=...&size_bytes=...`.
2. Backend calls `storage_client.generate_signed_upload_url(tenant_id, filename, content_type, size_limit)`.
3. Signed URL returned (valid 15 min).
4. Client uploads directly to storage (browser → S3, not via backend).
5. Client notifies backend: `POST /api/documents` with `blob_id`, `filename`.
6. Backend validates blob exists and size matches, creates Document record with FK to blob.

**Blob download flow:**
1. Client requests: `GET /api/documents/{id}`.
2. Backend checks Document exists and user has `document.view` permission.
3. Backend calls `storage_client.generate_signed_download_url(blob_id)`.
4. Signed URL returned (valid 24h).
5. Client is redirected (HTTP 302) to signed URL; browser downloads directly from storage.

### 15.6 Background processing infrastructure (M1+)

**Queue technology:** Redis-backed queue (RQ / Celery) in M1-A; durable broker (RabbitMQ / AWS SQS) in M2+.

**Job idempotency:** Every job class defines an idempotency key (derived from job class, tenant_id, and user input). Duplicate job submissions are de-duped at queue layer.

**Job observability:** Job start / progress / completion / failure are emitted as events (`Background.JobStarted`, `Background.JobCompleted`, `Background.JobFailed`) and stored in `event` table.

**Worker health:** Separate auto-scale group; N workers polling queue, each processing jobs until completion or dead-letter. Worker metrics (CPU, memory, queue depth) are exposed via Prometheus.

### 15.7 Monitoring, observability, logging

**Metrics:** Prometheus endpoint at `/metrics` (Uvicorn built-in via Prometheus middleware).
- Request latency (p50 / p95 / p99).
- Request count (200 / 404 / 500 status codes).
- Database query latency (by query name / entity).
- Queue depth (jobs waiting, running, failed).
- Cache hit rate (Redis GET success / miss).
- Auth latency (JWT parse, RLS GUC set).

**Logs:** Structured JSON (key-value pairs).
- `timestamp` (ISO8601, UTC).
- `level` (DEBUG / INFO / WARNING / ERROR / CRITICAL).
- `logger_name` (module / function).
- `message` (event description).
- `request_id` (UUID, propagated through all logs).
- `tenant_id` (if available).
- `user_id` (if authenticated).
- `duration_ms` (for transactional logs).

**Destinations:**
- **Dev:** stdout (human-readable format).
- **Prod:** stdout → log aggregator (CloudWatch Logs, Stackdriver, ELK).
- **Retention:** 30 days live (queryable), 90 days archived (cold storage).

**Distributed tracing:** OpenTelemetry SDK (Python + JavaScript). Trace context (`traceparent` header) propagated across request → backend → database → external API calls. Sampling: 100% in dev / staging; 10% in production (configurable).

### 15.8 Backup and disaster recovery

**Database snapshots (RDS):**
- **Frequency:** Automated, every 4 hours.
- **Retention:** 7 days (automatic deletion after 7 days).
- **RPO:** 4 hours (max data loss acceptable).
- **RTO:** < 15 minutes (max downtime acceptable).

**WAL archival (continuous):**
- **Destination:** S3 (cross-region if multi-region).
- **Retention:** 30 days (complies with most audit requirements; configurable per tenant).
- **Point-in-time recovery (PITR):** Restore database to any point within last 30 days (1-minute granularity).

**Backup immutability (M1+):**
- Snapshots copied to separate AWS account (blast-radius isolation).
- Snapshots encrypted with separate KMS key (so compromised account cannot decrypt old backups).

**Disaster recovery runbook:**
1. **Detection:** Healthcheck fails (database returns 500 or times out). PagerDuty alert fires; on-call engineer is paged.
2. **Assessment:** Engineer verifies corruption via database logs. Estimates time to repair (< 1h) vs. restore (< 15m).
3. **Decision:** If restore faster, proceed. Otherwise, attempt repair in place.
4. **Restore:** Identify snapshot or PITR point. Provision new RDS instance. Verify schema sound; run migrations (fast, idempotent). Cut over load balancer (DNS CNAME update; 30s propagation). Tenants experience ~2 min downtime.
5. **Validation:** Run killer test against restored database (proves RLS, audit, config-driven entities intact).
6. **Post-incident:** Root-cause analysis within 48h. Backup integrity check runs weekly (automated restore-and-test in sandbox).

**Disaster recovery metrics:**
- **RPO:** 4 hours.
- **RTO:** < 15 minutes.
- **MTTR (mean time to repair):** Target < 30 min.
- **Backup test:** Weekly restore-in-sandbox to verify snapshots are valid.

### 15.9 Configuration as code

**Config sources (in order of precedence):**
1. Environment variables (for secrets and environment-specific settings).
2. `.env` file (for local overrides; not in git).
3. `backend/app/config.py` (canonical defaults; in git).

**Example (`config.py`):**
```python
class Settings:
    ENVIRONMENT: str = "development"  # 'development' | 'production'
    DATABASE_URL: str = "postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex"
    OWNER_DATABASE_URL: str | None = None  # defaults to DATABASE_URL if not set
    REDIS_URL: str = "redis://localhost:6380/0"
    CORS_ORIGINS: list[str] = ["http://localhost:5173"]  # dev only
    PAYMENT_GATEWAY_PROVIDER: str = "mock"  # 'mock' | 'stripe'
    # ... more fields
```

**Feature gates:** Every feature has a boolean flag in `config.py` and an entry in `feature_gate.py`:
```python
FEATURE_IMPORT_ENGINE_ENABLED: bool = False

FEATURE_GATES = {
    "import_engine": {
        "is_enabled": settings.FEATURE_IMPORT_ENGINE_ENABLED,
        "requires": ["IMPORT_ENGINE_IMPLEMENTED"],
        "_disabled_reason": "Import engine not yet shipped",
    },
}

# In deploy contract:
if settings.FEATURE_IMPORT_ENGINE_ENABLED and not IMPORT_ENGINE_IMPLEMENTED:
    raise RuntimeError("Feature gate 'import_engine' is ON but IMPORT_ENGINE_IMPLEMENTED is False.")
```

---

## 16. Future Expansion Rules

### 16.1 Multi-region (M2+)

**Single region in M1:** All tenants' data lives in one region. Simplifies RLS, audit trail consistency, deployment.

**Multi-region in M2:**
- **Primary region:** Reads + writes (primary RDS instance).
- **Secondary region(s):** Read-only replicas (compliance / data residency, or performance).
- **Tenant affinity:** Each tenant assigned to a primary region (e.g., EU customers in `eu-west-1`, US customers in `us-east-1`).
- **Replication:** Logical replication (PostgreSQL native) or physical replication (RDS multi-AZ within region, then cross-region read replicas).
- **Cross-region behavior:** Request routed to tenant's primary region (geo-IP or tenant lookup; no fallback). Writes hit primary. Reads hit replica (same region) for scale or primary (consistency). Audit trail region-local (cross-region consolidation reserved for M3+).
- **Data residency enforcement:** Tenant's `primary_region` recorded at creation. If tenant is EU-scoped, read/write only routes to EU region. Cross-region request rejected (403). Snapshots for EU tenants retained in EU-only buckets; tested quarterly.

### 16.2 Scaling evolution

**Compute (M0–M3+):**
- M0–M1: Stateless FastAPI; horizontal auto-scale (min 2, max configurable).
- M2+: CDN caching layer (frontend static assets); read replica routing for analytics queries.

**Database (M0–M3+):**
- M0–M1: Single PostgreSQL instance (no read replicas).
- M2: RDS multi-AZ (primary + standby same region), read replicas in 2nd region.
- M3: Sharding by tenant (hot tenants get own shard; others partitioned by region + hash).

**Cache (M0–M3+):**
- M0–M1: Single Redis instance (ephemeral, no persistence).
- M2: Redis cluster (6 nodes, 3 primary + 3 replica) for HA + multi-core scaling.
- M3: Multi-tier caching (local in-memory + distributed Redis).

**Background processing (M0–M3+):**
- M0: Stubbed (returns 503).
- M1: Redis-backed queue (RQ / Celery), separate worker auto-scale group (20–100 instances).
- M2+: Durable broker (RabbitMQ / SQS); per-region workers.
- M3: Cross-region job distribution; priority queues (urgent vs. batch).

### 16.3 Audit trail evolution (M1–M3+)

**M1:** Event table is region-local; audit trail lives in `event` + `audit_log` tables (single region, append-only).

**M2:** Cross-region replicas; audit trail per-region (no consolidation).

**M3:** Cross-region audit consolidation (audit events from all regions flow to canonical audit region for compliance queries). Immutability maintained; region-local append-only enforced locally, then replicated to audit region.

---

## Summary

GAAhex's infrastructure is **configuration-driven, fail-closed, and audit-first**. The five kernel engines consume a minimal compute substrate (stateless FastAPI, RLS-enforcing PostgreSQL, ephemeral Redis) and emit immutable evidence (append-only audit trails). The dual-role Postgres contract ensures RLS engages in production; the deploy-time checks ensure no unsafe configuration reaches production. Multi-region, read replicas, and advanced caching are architectural paths defined here for M2+, not disruptions to M1's proven shape.

---

*End of 19 — Infrastructure Architecture.*
