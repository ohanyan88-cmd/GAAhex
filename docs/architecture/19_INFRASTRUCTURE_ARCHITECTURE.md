# 19 — Infrastructure Architecture

**Governed by:** Sealed Baseline (§A2, A3, A5, A6), M1-A Deploy Contract, M1-C Environment, PRM (`Storage Core`, `Background Processing Core`), 01-Platform Core Architecture (`PLATFORM SERVICES` tier).

**Scope:** Platform infrastructure substrate — compute runtime, persistent & ephemeral storage, network topology, deploy contract, environment bootstrap, scaling capacity, backup + disaster recovery, and operational observability. Does not govern feature-level integrations, vendor-specific compliance, or domain-specific data models.

---

## 1. Purpose

Define the five fixed kernel engines' execution substrate and the non-negotiable infrastructure contracts that prove:

- **Tenant isolation engages at the database layer** (RLS via dual-role Postgres).
- **Audit is append-only at the database layer** (Postgres triggers on `event` and `audit_log`).
- **Background processing is reliable and observable** (queues substrate, worker health, job lineage).
- **Secrets and credentials are never stored in audit trails** (encrypted vault pattern).
- **The platform boots into a verified operational state** (deploy contract gates production startup).

---

## 2. Goals

- **G1.** Compute tier is stateless and horizontally scalable (FastAPI + Redis, no session affinity).
- **G2.** Persistent storage is single-source-of-truth for all state (PostgreSQL primary with RLS engagement).
- **G3.** Multi-tenant audit is immutable and queryable at the database layer (append-only triggers + GUC-bound tenant_id).
- **G4.** Background work is decoupled from request-reply (queues substrate, worker processes, observability).
- **G5.** Storage of binary assets is abstracted and lifecycle-governed (Storage Core; S3 / Azure Blob compatible).
- **G6.** Production boot is fail-closed and contract-enforced (deploy gate checks role separation, CORS, providers, feature flags).
- **G7.** Multi-region expansion is architected for M2+ without refactoring request-reply paths (single region for M1).

---

## 3. Compute Tier

### 3.1 Application runtime

**Runtime:** Python 3.12+ with FastAPI (async HTTP server), Uvicorn (ASGI).

**Container:** Dockerfile-based, deployed to orchestrator (Docker Compose in M0; Kubernetes-ready for M1+).

**Port:** 8099 (backend API, exposed via port forwarding in dev; load-balancer ingress in prod).

**Health check:** `GET /api/health` returns 200 + JSON `{"status": "ok"}` when app and database are reachable.

**Stateless design:**
- No in-memory session store; all state lives in PostgreSQL (session table persisted).
- No sticky routing required; requests may land on any instance.
- No local file I/O for application state (only transient build artifacts).

### 3.2 Frontend runtime

**Runtime:** React 18 + TypeScript, bundled with Vite, served as static HTML + JS assets.

**Container:** Static file server (e.g., `node:20-slim` serving `dist/` directory post-build, or Nginx).

**Port:** 5173 (dev via Vite, `npm run dev`); 3000+ (prod via Node / Nginx).

**Client-side state:** App state managed by React hooks + Context API; no server-side session affinity.

**Build artifact:** dist/ directory contains production-optimized bundles. Caching headers (`cache-control: max-age=31536000`) on content-hashed assets; `no-cache` on `index.html`.

### 3.3 Concurrency model

**Backend:** Uvicorn spawns worker processes (default 1 in dev; auto-scaled in prod). Each worker is async (250–500 concurrent requests per worker via asyncio).

**Request handling:** Every request sets `gaahex.tenant_id` GUC (Postgres session parameter) from JWT `tenant` claim before route handler runs. RLS policies read this GUC; if request user's tenant_id ≠ JWT tenant, 404.

**Database connection pooling:** SQLAlchemy async engine with `pool_size=10` (configurable). Connections are borrowed per-request and returned to pool. No global transaction state; each route handler owns its transaction boundary.

---

## 4. Persistent Storage

### 4.1 Primary data store: PostgreSQL

**Version:** 16.x with PostGIS 3.4 extension (for location queries in future; initialized in M1-C.5).

**Schema:** 111 migrations (as of 2026-06-05) defining 65 core tables + audit / event tables. All migrations are forward-only and append-only; downgrade migrations are not maintained.

**Multi-tenancy enforcement:**
- **`tenant_id` column:** Every tenant-scoped row carries a `tenant_id` foreign key to `tenant.id`.
- **RLS policies:** Every tenant-scoped table has `CREATE POLICY tenant_isolation ... USING (tenant_id = CURRENT_SETTING('gaahex.tenant_id')::uuid)` (209 policy lines across 111 migrations).
- **Role separation:** `gaahex` (owner, BYPASSRLS) used for migrations; `gaahex_app` (app user, NOSUPERUSER NOBYPASSRLS) used for request handling. This dual-role model is the **single most important infrastructure invariant** ([I3](#sealed-baseline-invariants-inherited), M1-A Deploy Contract).

**Audit trail:**
- **`event` table:** Append-only (Postgres triggers forbid UPDATE / DELETE, even by table owner).
- **`audit_log` table:** Shadow of `event` for compliance queries (also append-only).
- **Per-mutation record:** Every state change (create / update / delete / transition) calls `workflow.emit(...)` which inserts one `event` row. The row is immutable once inserted.
- **Lineage:** Event carries actor_user_id, tenant_id, timestamp, entity_key, record_id, old/new data, source (request vs automation vs integration), and context (approval chain, policy decision, workflow guard).

**Transaction isolation:** PostgreSQL `READ COMMITTED` (default); long-running transactions are forbidden (HTTP request timeout 30s). Each request owns a single transaction boundary.

**Backup & PITR:**
- **RPO (Recovery Point Objective):** Hourly snapshots (configurable; M1 default 4h). Any data loss > 4h is operationally unacceptable.
- **RTO (Recovery Time Objective):** < 15 minutes from snapshot start to restore-complete. Tenants are notified via status page; audit trail is non-lossy (append-only guarantee).
- **Mechanism:** Postgres WAL archival to S3 (or equivalent blob store). Point-in-time recovery supported to within 1 minute of failure.

### 4.2 Ephemeral cache: Redis

**Version:** 7.x.

**Purpose:** Request-scoped caching (parsed JWT, role permissions, entity definitions), session store (optional; presently not used for auth state), rate-limit counters, background-job queue (M1+).

**Data lifetime:** Ephemeral. No guarantees beyond "best effort". Loss of Redis means cold cache reload; no audit or business data lives here exclusively.

**Configuration:**
- **Max memory policy:** `allkeys-lru` (least-recently-used eviction).
- **Persistence:** `appendonly no` (no RDB snapshots or AOF logs; ephemeral by design).
- **Replication:** Single instance for M0; M1+ may add read replicas for scale.

**Multi-tenancy:** No cross-tenant data in Redis. Cache keys are scoped by tenant_id (e.g., `role:tenant:{tenant_id}:user:{user_id}`).

---

## 5. Network Topology

### 5.1 Development environment (docker-compose)

```
┌─────────────────────────────────────────────────────┐
│ Local machine (host)                                │
│                                                     │
│  Browser:5173 ──────────────────┐                  │
│    (React dev server)           │                  │
│                                 ▼                  │
│                         Frontend (Vite)            │
│                                 │                  │
│                                 │ proxies /api    │
│                                 ▼                  │
│                         Backend (FastAPI:8099)     │
│                                 │                  │
│         ┌───────────────────────┼──────────────────┐
│         │                       │                  │
│         ▼                       ▼                  │
│      Postgres:5433           Redis:6380           │
│    (Docker network)       (Docker network)        │
│         │                       │                  │
│         └─ pgdata volume        └─ (ephemeral)    │
└─────────────────────────────────────────────────────┘
```

### 5.2 Production environment (cloud / VPC)

```
┌─────────────────────────────────────────────────────┐
│ Internet edge (CDN + TLS termination)              │
│                                                     │
│         Cloudflare / AWS CloudFront                │
│              (CORS + rate-limit)                   │
│                      │                              │
│                      ▼                              │
│         Load Balancer (ALB / NLB)                  │
│       (health check, auto-scale group)             │
│                      │                              │
│     ┌────────────────┼────────────────┐            │
│     ▼                ▼                ▼            │
│  Backend-1    Backend-2       Backend-N           │
│  (FastAPI)    (FastAPI)       (FastAPI)           │
│  8099         8099            8099                 │
│     │                ▼                ▼            │
│     └────────────────┼────────────────┘            │
│                      │                              │
│                      ▼ (read/write)                 │
│          PostgreSQL RDS Primary                    │
│        (gaahex_app + gaahex roles)                 │
│                      │                              │
│          ┌───────────┼───────────┐                 │
│          ▼           ▼           ▼                 │
│       Replica-A   Replica-B  (WAL archive)        │
│       (read-only)  (standby)   (S3 / GCS)         │
│                                                     │
│          Background Job Workers                    │
│    (separate auto-scale group, N instances)       │
│          (connect to RDS + Redis)                  │
│                                                     │
│          Redis Cluster (Elasticache)              │
│       (6 nodes, replication enabled)              │
│                                                     │
│          Blob Storage (S3 / GCS)                  │
│     (documents, attachments, backups)             │
│                                                     │
│          Secrets Manager (AWS / GCP / Vault)      │
│     (API keys, DB passwords, webhook secrets)     │
└─────────────────────────────────────────────────────┘
```

### 5.3 TLS and network security

**TLS termination:** At edge (load balancer / CDN). Backend speaks plaintext within VPC; TLS negotiation is offloaded to edge.

**Certificate management:** Auto-renewal via ACME (Let's Encrypt) or cloud provider's managed certificate service.

**Cross-region traffic (M2+):** VPN tunnel or cloud interconnect (e.g., AWS Direct Connect) between regions to maintain encryption and avoid data exfiltration risk. Backup/restore operations use encrypted S3 cross-region replication.

**Egress:** Outbound calls to external vendors (Stripe, SendGrid, Twilio, FreeRADIUS) use HTTPS with certificate pinning (if vendor provides fingerprints; otherwise standard HTTPS validation).

---

## 6. Deploy Contract (Production Hardening)

The **M1-A Production Deploy Contract** is a set of non-negotiable checks executed at application startup (`_assert_production_deploy_contract()` in `app/config.py`, called from FastAPI lifespan).

### 6.1 Six mandatory checks

| # | Check | Condition | Fail mode |
|---|---|---|---|
| 1 | Role split (URL) | `DATABASE_URL ≠ OWNER_DATABASE_URL` | Boot refusal with explicit error + docs link |
| 2 | Role split (username) | App role ≠ owner role (parsed from connection strings) | Boot refusal; RLS would be silently bypassed |
| 3 | CORS wildcard | No `*` in `CORS_ORIGINS` list | Boot refusal; open relay for cross-origin attacks |
| 4 | Mock providers | No mock payment gateway, email, SMS, RADIUS in production | Boot refusal; a mock Stripe in prod is a business regression |
| 5 | Portal auth mode | `PORTAL_AUTH_MODE ∈ {cookie, both}` | Boot refusal; open auth mode is a security gap |
| 6 | Feature gate consistency | Every feature flag ON ⟹ real implementation present | Boot refusal with feature name + reason string (from `feature_gate.py`) |

**Trigger:** `settings.environment == "production"`. In dev / test / staging, all checks are skipped (no-op).

**Extensibility:** New infrastructure invariants are added as checks #7, #8, etc., with the same fail-closed pattern. Migration path: land the canonical implementation first, add the check, then flips the gate to ON in production.

---

## 7. Environment Variables & Secrets Management

### 7.1 Bootstrap secrets

```bash
ENVIRONMENT=production                           # 'development' | 'production'
DATABASE_URL=postgresql+asyncpg://gaahex_app:...  # app role (NOBYPASSRLS)
OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:... # owner role (BYPASSRLS, migrations)
REDIS_URL=redis://redis:6379/0                    # ephemeral cache
```

**Secret storage (production):**
- AWS Secrets Manager (preferred in M1+).
- GCP Secret Manager (if GCP deployment).
- HashiCorp Vault (on-premises option).
- **NOT in source control, NOT in .env files, NOT in container image.**

**Rotation:** Database passwords rotated every 90 days. Rotation is transparent to app (new password is issued, old connection string is updated in Secrets Manager, app reads the new URL on next deploy).

### 7.2 Vendor integration secrets (M1-C scaffold)

```bash
# ─── Payment gateway ────────
PAYMENT_GATEWAY_PROVIDER=stripe              # 'mock' | 'stripe'
STRIPE_PUBLISHABLE_KEY=pk_live_xxx           # frontend-visible; cannot read payments
STRIPE_SECRET_KEY=sk_live_xxx                # backend-only
STRIPE_WEBHOOK_SECRET=whsec_live_xxx         # verify inbound webhook signatures

# ─── Email gateway ──────────
EMAIL_GATEWAY_PROVIDER=sendgrid              # 'mock' | 'sendgrid'
SENDGRID_API_KEY=SG.xxx                      # send emails
SENDGRID_WEBHOOK_PUBLIC_KEY=xxx              # verify inbound webhook signatures

# ─── SMS gateway ────────────
SMS_GATEWAY_PROVIDER=twilio                  # 'mock' | 'twilio'
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_MESSAGING_SERVICE_SID=MGxxx           # preferred over TWILIO_FROM_NUMBER
TWILIO_WEBHOOK_AUTH_TOKEN=xxx                # verify inbound webhook signatures

# ─── RADIUS (network auth) ──
RADIUS_BACKEND_PROVIDER=freeradius           # 'mock' | 'freeradius'
RADIUS_HOST=10.0.0.1
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_SECRET=shared-secret                  # MAC for RADIUS packets
```

**Fallback:** If `*_PROVIDER` is set to a real vendor but its secrets are missing / malformed, the factory falls back to mock with a logged warning. App boots cleanly; full functionality is available in dev without any vendor account.

**Audit posture:** Vendor credentials are **never** logged, stored in audit trails, or embedded in error messages. A failed Stripe charge logs the charge ID and error code, not the card CVV or API secret.

---

## 8. Background Processing

### 8.1 Queue substrate (M0 spike; M1 full implementation)

**M0 (present):** Background jobs are stubbed. `FEATURE_IMPORT_ENGINE_ENABLED=false` and `IMPORT_ENGINE_IMPLEMENTED=False`. The `/api/imports/{id}/start` endpoint returns 503 with `"feature_disabled"` body.

**M1 (planned):** Full background-job infrastructure with:

- **Queue technology:** Redis-backed queue (e.g., RQ / Celery) in M1-A; durable broker (RabbitMQ / AWS SQS) in M2+.
- **Job classes:** Import jobs, export jobs, async notifications, integration sync, report generation, billing cycles.
- **Worker pool:** Separate auto-scale group; N workers polling queue, each processing jobs until completion or dead-letter.
- **Idempotency:** Every job carries an idempotency key. Duplicate submissions (from webhook retries) are detected and de-duped at the queue layer or job layer.
- **Observability:** Job start / progress / completion / failure are emitted as events and stored in `event` table. Job outcome is linked to the request that triggered it.

### 8.2 Forbidden patterns

- **No ungoverned cron in code.** If a job runs on a schedule (daily import, hourly sync), the schedule is expressed via configuration (Workflow Core or Background Processing Core config entity), not hardcoded `@schedule` decorators in Flask/FastAPI.
- **No synchronous critical-path call to slow external APIs.** A request handler that waits for Stripe to respond is a mistake; the HTTP request times out and the user sees a hang. Instead, the handler queues an async job and returns immediately.
- **No direct shell invocation to external systems.** All external calls go through typed client libraries (e.g., `stripe.Charge.retrieve()`, not `os.system('curl stripe.com')`).

---

## 9. Storage Core (Blobs)

### 9.1 Design

**Purpose:** Store binary assets (attachments, generated PDFs, contract files, avatars, import CSVs) with lifecycle governance.

**Ownership boundary:** Storage Core owns the **infrastructure** (where bytes live). Document Core owns the **meaning** (a Document record references a blob ID).

**Provider abstraction:** Backend uses `app/services/storage.py::StorageClient` interface. Implementation may be:
- **Dev:** Local filesystem (`/tmp/gaahex-storage/`).
- **Prod:** S3 (AWS) or Azure Blob Storage (Microsoft).
- **On-prem:** MinIO or equivalent S3-compatible service.

### 9.2 Blob lifecycle

**Upload flow:**
1. Request handler calls `storage_client.generate_signed_upload_url(tenant_id, filename, content_type, size_limit)`.
2. Signed URL is returned to client (valid for 15 minutes).
3. Client uploads directly to storage (browser → S3, not via backend).
4. Client notifies backend: `POST /api/documents` with `blob_id`, `filename`.
5. Backend validates blob exists and size matches, then creates Document record with FK to blob.

**Download flow:**
1. Client requests `GET /api/documents/{id}` (protected by permission check + tenant filter).
2. Backend checks Document exists and user has `document.view` permission.
3. Backend generates signed download URL (valid for 24 hours).
4. Client is redirected (HTTP 302) to signed URL; browser downloads directly from storage.

**Retention:**
- Default: blobs live as long as the Document record exists.
- Soft delete: When a Document is deleted, its blob is marked for deletion (24h grace period for recovery). After grace period, blob is purged.
- Compliance: Longer retention is configured per-tenant via `TenantSetting` (e.g., 7-year hold for contracts). Blobs are not deleted until both document lifecycle expires AND tenant retention policy allows.

### 9.3 Virus scanning

**On upload:** Async job receives blob_id, downloads blob from storage, runs ClamAV (or equivalent antivirus), stores result in `blob.virus_scan_status` table.

**Blocking:** A document with `virus_scan_status = 'INFECTED'` may not be downloaded or accessed by end users (admin can still quarantine/delete it).

**Failure mode:** If antivirus service is unavailable, blob is marked `SCAN_PENDING` and access is blocked (fail-closed). Retries are queued daily until service recovers.

---

## 10. Scaling Strategy

### 10.1 Horizontal (request-reply tier)

**Stateless design enables auto-scale:**
- Requests land on any backend instance; no affinity required.
- Concurrent requests per instance: 250–500 (Uvicorn async).
- Target: 80% CPU / 85% memory → scale up. 30% → scale down.
- Min instances: 2 (HA, rolling deployments). Max instances: configurable per environment.

**Load balancing:** Request-hash (X-Tenant-ID) is NOT used; pure round-robin with health checks.

### 10.2 Vertical (database tier)

**PostgreSQL primary:** No sharding in M1. Single RDS instance (db.r6g.xlarge or equivalent) serves all tenants.

- Compute: 4 CPU, 32 GB RAM (configurable by environment).
- Storage: 500 GB provisioned SSD, auto-scaling to 1 TB (configurable threshold).
- Backup: Automated RDS snapshots every 4 hours; point-in-time recovery enabled (7-day retention).

**Read replicas (M1+):** Analytics queries and heavy reporting are routed to read replicas (read-only). Application requests (mutations, transactional reads) always use primary.

**Scaling trigger:** When primary CPU > 80% sustained or query latency p95 > 500ms, provision read replica (1–2 day lead time in M1; auto-scale in M2+).

### 10.3 Cache tier

**Redis single instance (M0, M1):** `cache.r6g.large` or equivalent.
- Max memory: 8 GB (configurable).
- Policy: `allkeys-lru`.
- No persistence (ephemeral).

**Redis cluster (M2+):** 6 nodes (3 primary, 3 replica) for HA + multi-core scaling.

---

## 11. Monitoring & Observability

### 11.1 Application metrics

**Prometheus endpoints:** `/metrics` (Uvicorn built-in via Prometheus middleware).

**Tracked metrics:**
- Request latency (p50 / p95 / p99).
- Request count (200 / 404 / 500 status codes).
- Database query latency (by query name / entity).
- Queue depth (jobs waiting, jobs running, jobs failed).
- Cache hit rate (Redis GET success / miss).
- Auth latency (JWT parse, RLS GUC set).

**Retention:** 30 days (default Prometheus config). Older data is downsampled.

### 11.2 Logs

**Structured logging:** Every log line is JSON (key-value pairs).

- `timestamp` (ISO8601, UTC).
- `level` (DEBUG / INFO / WARNING / ERROR / CRITICAL).
- `logger_name` (module / function).
- `message` (event description).
- `request_id` (UUID, set at request entry, propagated through all logs).
- `tenant_id` (if available).
- `user_id` (if authenticated).
- `duration_ms` (for transactional logs).

**Destinations:**
- **Dev:** stdout (human-readable format).
- **Prod:** stdout → log aggregator (e.g., CloudWatch Logs, Stackdriver, ELK).

**Retention:** 30 days live (queryable), 90 days archived (cold storage).

**Audit-log query:** Compliance / security requests query the `audit_log` table (derived from `event`), not the application logs. Application logs are operational; audit logs are evidence.

### 11.3 Distributed tracing

**Instrumentation:** OpenTelemetry SDK (Python + JavaScript).

**Trace context:** `traceparent` header propagated across request → backend → database → external API calls.

**Sampling:** 100% sample rate in dev / staging; 10% in production (configurable).

**Destinations:** Jaeger (on-prem) or cloud trace service (e.g., AWS X-Ray, Google Cloud Trace).

---

## 12. Backup & Disaster Recovery

### 12.1 Backup strategy

**Database snapshots (RDS):**
- **Frequency:** Automated, every 4 hours.
- **Retention:** 7 days (automatic deletion after 7 days).
- **RPO:** 4 hours (max data loss is 4 hours of transactions).
- **RTO:** < 15 minutes (restore new RDS instance from snapshot).

**WAL archival (continuous):**
- **Destination:** S3 (cross-region if multi-region).
- **Retention:** 30 days (complies with most audit requirements; configurable per tenant).
- **Point-in-time recovery (PITR):** Restore database to any point within the last 30 days (1-minute granularity).

**Backup immutability (M1+):**
- Snapshots are copied to a separate AWS account (blast-radius isolation).
- Snapshots are encrypted with a separate KMS key (so a compromised account cannot decrypt old backups).

### 12.2 Disaster recovery runbook

**Scenario: Primary database is corrupted or deleted (rare).**

1. **Detection:** Healthcheck fails (database returns 500 or times out).
2. **Alert:** PagerDuty alert fires. On-call engineer is paged.
3. **Assessment:** Engineer verifies corruption via database logs. Estimates time to repair (< 1h) vs. restore (< 15m).
4. **Decision:** If restore is faster, proceed to step 5. Otherwise, attempt repair in place.
5. **Restore:**
   - Identify snapshot or PITR point (latest safe timestamp).
   - Provision new RDS instance from snapshot (via AWS console or CLI).
   - Verify schema is sound; run migrations if needed (fast, idempotent).
   - Cut over load balancer to new instance (DNS CNAME update; 30s propagation).
   - Tenants experience ~2 min downtime (alert, restore, cutover).
6. **Validation:** Run killer test against restored database (proves RLS, audit, config-driven entities are intact).
7. **Post-incident:** Root-cause analysis within 48h. Backup integrity check runs weekly (automated restore-and-test in sandbox environment).

**Scenario: Data loss (rare; RLS or audit integrity is compromised).**

1. Detection and remediation depend on the type of loss:
   - **Cross-tenant row leaked:** RLS policy check failed. Immediate audit of access logs; if breach is confirmed, notify affected tenants within 24h per GDPR/CCPA.
   - **Audit row was deleted:** Postgres trigger should have prevented this (if trigger is present). If triggered didn't fire, investigate migration that disabled it (log audit event with reason, require amendment).
   - **Entire tenant's data is gone:** Restore from snapshot to T-N and reapply transactions from WAL between T-N and loss. Validate row counts match before re-enabling access.

### 12.3 Disaster recovery metrics

- **RPO:** 4 hours (max data loss acceptable to business).
- **RTO:** < 15 minutes (max downtime acceptable to operations).
- **MTTR (mean time to repair):** Target < 30 min (reduce detection time, runbook clarity).
- **Backup test:** Weekly restore-in-sandbox to verify snapshots are valid (catches backup software failures early).

---

## 13. Multi-Region (M2+ roadmap)

### 13.1 Design principles

**Single region in M1:** All tenants' data lives in one AWS region (or GCP region, or Azure region). Simplifies RLS, audit trail consistency, and deployment.

**Multi-region in M2:**
- **Primary region:** Reads + writes (primary RDS instance).
- **Secondary region(s):** Read-only replicas (for compliance / data residency, or performance).
- **Tenant affinity:** Each tenant is assigned to a primary region (e.g., EU customers in `eu-west-1`, US customers in `us-east-1`).
- **Replication:** Logical replication (PostgreSQL native) or physical replication (RDS multi-AZ within region, then cross-region read replicas).

**Cross-region behavior:**
- Request is routed to the **tenant's primary region** (geo-IP or tenant lookup; no cross-region fallback).
- Writes always hit the primary.
- Reads may hit a read replica in the same region (for scale) or the primary (for consistency).
- Audit trail is region-local (no cross-region audit consolidation in M2; that's M3+).

### 13.2 Data residency & compliance

**GDPR (EU):** EU customer data must remain in EU regions (e.g., `eu-west-1` Frankfurt, `eu-central-1`).

**Enforcement:** Tenant's `primary_region` is recorded at creation. Migration Core (or Tenant Core) enforces: if tenant is EU-scoped, read/write only routes to EU region. A cross-region request is rejected (403).

**Backup residency:** Snapshots for EU tenants are retained in EU-only buckets (no replication to US). Tested quarterly.

---

## 14. Security Posture

### 14.1 Secrets

**Never in code:**
- No hardcoded API keys, database passwords, or webhook secrets in source tree.
- `.env` files are in `.gitignore`. `.env.example` is in git (shows the shape, not the values).
- Pre-commit hook scans for common secret patterns (gitleaks).

**At rest (production):**
- Secrets live in AWS Secrets Manager (or equivalent).
- Secrets are encrypted with a KMS key (separate from data encryption key).
- Rotation: passwords every 90 days, API keys every 180 days (configurable).

**In transit:**
- TLS 1.3 on all external connections (outbound to vendors, inbound from clients).
- Certificate pinning for vendor APIs (if vendor provides fingerprints).

**In application memory:**
- Secrets are fetched at startup and cached in-process (or fetched per-request, depending on vendor).
- Secrets are never logged, even at DEBUG level.
- Secrets are not serialized in error messages or stack traces.

### 14.2 Database access

**Postgres role split:**
- `gaahex` (owner, BYPASSRLS) is used **only** by:
  - Alembic migrations (upgrade / downgrade).
  - Pre-auth code paths (user lookup, org tree, seed).
  - Backup / restore scripts (by ops only, never by application).
- `gaahex_app` (app, NOSUPERUSER NOBYPASSRLS) is used by:
  - All request handlers (must connect via `DATABASE_URL`).
  - RLS policies enforce tenant isolation on every read/write.

**Verification (deploy contract):**
- Production startup checks: `DATABASE_URL` and `OWNER_DATABASE_URL` must use different roles.
- If check fails, app refuses to boot with explicit error message + link to M1-A Deploy Contract.

### 14.3 Outbound calls

**Vendor authentication:**
- Every outbound call to an external vendor (Stripe, SendGrid, Twilio) includes authentication (API key, HMAC signature, OAuth token).
- Authentication is validated by the vendor before processing; if invalid, vendor returns 401.

**Webhook inbound:**
- Every inbound webhook from a vendor (Stripe, SendGrid, Twilio) is **signature-verified** before processing.
- Signature is computed by the vendor (HMAC-SHA256) and included in the webhook request header.
- Backend verifies the signature matches the vendor's secret. If mismatch, webhook is rejected (403).
- No webhook is processed without signature verification (this is the fail-closed pattern).

---

## 15. Configuration as Code

### 15.1 Environment-specific config

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

**Production override (`.env` in production, not in repo):**
```bash
ENVIRONMENT=production
DATABASE_URL=postgresql+asyncpg://gaahex_app:$$$@prod-db.internal:5432/gaahex
OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:$$$@prod-db.internal:5432/gaahex
REDIS_URL=redis://prod-redis.internal:6379/0
CORS_ORIGINS=["https://api.yourisp.com", "https://yourisp.com"]
PAYMENT_GATEWAY_PROVIDER=stripe
STRIPE_SECRET_KEY=$$$  # fetched from Secrets Manager at startup
```

### 15.2 Feature gates

**Define a new feature:**
```python
# in backend/app/config.py
FEATURE_IMPORT_ENGINE_ENABLED: bool = False

# in backend/app/services/feature_gate.py
FEATURE_GATES = {
    "import_engine": {
        "is_enabled": settings.FEATURE_IMPORT_ENGINE_ENABLED,
        "requires": ["IMPORT_ENGINE_IMPLEMENTED"],
        "_disabled_reason": "Import engine not yet shipped",
    },
    # ... more gates
}

# in backend/app/config.py::_assert_production_deploy_contract()
if settings.FEATURE_IMPORT_ENGINE_ENABLED and not IMPORT_ENGINE_IMPLEMENTED:
    raise RuntimeError(
        "Feature gate 'import_engine' is ON but IMPORT_ENGINE_IMPLEMENTED is False. "
        "Production boot refused; see docs/standards/..."
    )
```

**Flip the gate (at M1 ship):**
```bash
FEATURE_IMPORT_ENGINE_ENABLED=true    # in production .env
```

**Deploy contract enforcement:** The gate ON ⟹ real implementation present check is baked into the boot flow. A gate that's ON but incomplete is caught at startup, not in production traffic.

---

## 16. Infrastructure Testing

### 16.1 Killer test proving infrastructure invariants

**Test:** `backend/tests/test_deploy_contract.py::test_production_with_separate_roles_passes`

**Proves:**
- Production environment is recognized.
- Role split check passes (different DATABASE_URL and OWNER_DATABASE_URL with different usernames).
- CORS is configured without wildcard.
- No mock providers are active.
- Portal auth mode is set correctly.
- All feature gates are consistent with implementations.

**Failure:** Any infrastructure misconfiguration (e.g., same role for both URLs) causes boot refusal.

### 16.2 RLS enforcement testing

**Test suite:** `backend/tests/test_rls.py`, `test_rls_parametric.py`, `test_deploy_contract.py`

**Proves:**
- A second connection pool (`gaahex_app` role) respects RLS policies.
- Cross-tenant reads are rejected at the database layer (not by application code).
- Tenant-filter check catches SQLAlchemy queries missing the tenant_id filter.

**CI enforcement:** `backend-rls` job in `.github/workflows/ci.yml` runs RLS subset with `DATABASE_URL` bound to the `gaahex_app` role (NOSUPERUSER NOBYPASSRLS). Currently `continue-on-error: true` (TD13); flag must come off before M1 ship.

---

## 17. Roadmap: M1-M3 Capacity & Evolution

### 17.1 M1 (present)

- Single region (primary only).
- Single PostgreSQL instance (no read replicas).
- Single Redis instance (ephemeral, no persistence).
- Background processing queued (architecture complete; implementation stubbed).
- Blobs stored in S3 (infrastructure in place; feature gates prevent production use).

### 17.2 M2 (multi-region + HA)

- **Database:** RDS multi-AZ (primary + standby in same region), read replicas in 2nd region (for data residency).
- **Cache:** Redis cluster (6 nodes, 3 primary + 3 replica).
- **Workers:** Separate auto-scale group for background jobs (20–100 instances, configurable per environment).
- **Backups:** Cross-region snapshots (blast-radius isolation).
- **Monitoring:** Enhanced dashboards (per-region, per-tenant view).

### 17.3 M3 (advanced features, integrations, marketplace)

- **Database:** Sharding by tenant (hot tenants get their own database shard; others are partitioned by region + hash).
- **Cache:** Multi-tier caching (local in-memory + distributed Redis).
- **Integrations:** Marketplace apps can provision infrastructure (queued jobs, webhooks, event subscriptions).
- **Audit:** Cross-region audit consolidation (audit events from all regions flow to a canonical audit region for compliance queries).

---

## Summary

GAAhex's infrastructure is **configuration-driven, fail-closed, and audit-first**. The five kernel engines consume a minimal compute substrate (stateless FastAPI, RLS-enforcing PostgreSQL, ephemeral Redis) and emit immutable evidence (append-only audit trails). The dual-role Postgres contract ensures RLS engages in production; the deploy-time checks ensure no unsafe configuration reaches production. Multi-region, read replicas, and advanced caching are architectural paths defined here for M2+, not disruptions to M1's proven shape.

---

*End of 19 — Infrastructure Architecture.*
