# 12 — Integration Architecture

**Constitutional document.** Position in the hierarchy: directly under
`PLATFORM_REFERENCE_MODEL.md`; sibling to `01_PLATFORM_CORE_ARCHITECTURE.md`.
All integration development must remain consistent with this document and the
locked Integration Standard (`standards/19-integration-standard.md`).

---

## 1. Purpose

Define how external systems connect to GAAhex: the connector framework,
authentication postures, inbound and outbound patterns, mapping rules,
credential handling, idempotency enforcement, failure strategies, and audit
trails. Ensure every external integration is declarative, observable, secure,
compliant with Standards D1 and M1, and governed by Integration Core with
support from Security, Event, Audit, and Tenant Cores.

## 2. Scope

In scope:

- Declarative connector descriptor (the `Connector` entity model and registration).
- Authentication methods: OAuth 2.0, API key, mTLS, bearer tokens.
- Inbound integrations: vendor webhooks (e.g., Stripe, Twilio), polling sync jobs, file-drop imports.
- Outbound integrations: platform-emitted webhooks, direct API calls to external systems.
- Mapping rules: field-level transformation (source → canonical) via Studio domain (tenant-configurable).
- Credential and secret handling: `Secret` entity, `secretRef` references, no plaintext storage in code.
- Retry logic, circuit breaker, rate limiting governed by Security Core.
- Idempotency guarantees: inbound deduplication via `IdempotencyKey` or vendor token.
- Connector ownership: target domain core is the primary owner (Stripe → Financial; Salesforce → Party/Service).
- Integration runs as auditable transactions: every call logged, every event produced.
- Dead-letter and replay handling for failed integrations.
- Schema registry for versioning integration data shapes.
- Tenant-scoped integration configuration and credential binding.

Out of scope:

- Developer Portal UX (see `05_OPERATIONAL_ARCHITECTURE.md`).
- Event bus implementation (see `11_EVENT_ARCHITECTURE.md`).
- Background Processing queue infrastructure (see `19_INFRASTRUCTURE_ARCHITECTURE.md`).
- Tenant branding and white-label rules (see `14_TENANT_ARCHITECTURE.md`).

## 3. Goals

- **G1** Every external system (vendor, API, file-based service) connects via a
  declarative `Connector` entity, never via hardcoded SDK or custom code.
- **G2** All integration data flows through a mapping/transformation layer
  (`MappingRule`), tenant-configurable in Studio, no raw data stored.
- **G3** Every integration run is fully observable: logged, auditable,
  retryable, and replayable with idempotency guarantees.
- **G4** Inbound and outbound integrations are composable patterns: webhooks,
  polling, file-drop, direct API calls, each with consistent retry/failure
  semantics.
- **G5** Credentials are encrypted and versioned; integration code never
  embeds or logs plaintext secrets.
- **G6** No integration operation fails silently; all failures route to
  dead-letter queues and trigger alerts.

## 4. Non-Goals

- **NG1** This document does NOT define the Event Core (see `11_EVENT_ARCHITECTURE.md`).
- **NG2** This document does NOT define Secret storage mechanics (see `13_SECURITY_ARCHITECTURE.md`).
- **NG3** This document does NOT define the Background Processing queue (see `19_INFRASTRUCTURE_ARCHITECTURE.md`).
- **NG4** This document does NOT prescribe whether connectors are implemented as
  microservices or monolithic modules (see `02_DOMAIN_ARCHITECTURE.md`).
- **NG5** This document does NOT govern the Developer Portal UI (see `05_OPERATIONAL_ARCHITECTURE.md`).

## 5. Architecture Principles

### P1 — Integrations are event-driven, not table-driven.

External systems consume GAAhex events via webhooks or polling for updates;
they do not query internal tables directly. Integration code never bypasses
the Event Core publish path or writes directly to business-core database
tables.

### P2 — Integrations are tenant-scoped by default.

Every connector instance carries `tenantId`. Multi-tenant isolation is enforced:
a Stripe connector for Tenant A cannot access Tenant B's configuration,
credentials, or payment data. Global connectors (rare) are explicitly flagged.

### P3 — Credentials are secrets, not configuration.

API keys, OAuth tokens, secrets, and mTLS certs are stored via Security Core's
`Secret` entity (encrypted at rest). Integration code references secrets by
`secretRef` ID only; it never embeds, retrieves, or logs plaintext credentials.
Credential rotation is managed via Secret Core versioning.

### P4 — Every integration write is idempotent.

Inbound webhook handlers deduplicate via `idempotencyKey` (from vendor or
assigned by platform). Replayed callbacks are no-ops. Outbound API calls are
idempotent by design or retried safely. Financial transactions and state
mutations use idempotency strictly.

### P5 — Mapping is declarative and pluggable.

Field mapping (source → canonical) is authored in Studio domain as a
`MappingRule` entity. Tenant admins configure mappings without code changes.
Mapping rules version with the integration, and old rules remain readable for
historical sync jobs.

### P6 — Integration runs are fully auditable.

Every external call produces an `IntegrationRun` record with status, payload,
result, error, and a link to the published event (if state-changing). All
traces feed Audit Core, Observability Core, and timeline feeds.

### P7 — Failures are terminal → dead-letter or handled explicitly.

If an integration fails, it routes to a dead-letter queue and triggers an
alert. No silent failures. Replay is manual or governed by a retry policy
declared in the `Connector` or `IntegrationRun` entity.

### P8 — Integrations own only the framework; target cores own domain connectors.

Integration Core governs the connector framework, idempotency keys, and webhook
delivery infrastructure. A Stripe connector is owned and hardened by Financial
Core; a ServiceNow connector by Case Core. Target cores define validation,
transformation, and business logic.

## 6. Architecture Laws

### L1 — All credentials via `secretRef` only; no plaintext in code or logs

> Integration code must retrieve credentials by `Secret` ID reference. No
> credentials are hardcoded, environment-variabled, or logged. Violations are
> detected by code scanning and rejected at review.

### L2 — Every integration run is idempotent

> Inbound webhook handlers deduplicate within a 5-minute window via
> `idempotencyKey`. Outbound webhook payloads include `idempotencyKey` headers.
> Retried operations use the same key. Non-idempotent operations are forbidden.

### L3 — All external calls are audited and observable

> Every `Connector` call (inbound, outbound, polling, file-drop) creates an
> `IntegrationRun` record before or immediately after execution. The run record
> includes payload, status, error detail, duration, and linkage to the emitted
> event (if state-changing). Failure to record an integration run is an L4
> violation (see `01_PLATFORM_CORE_ARCHITECTURE.md` § L4 Audit Universality).

### L4 — Failures route to dead-letter or are handled explicitly

> On permanent failure (validation error, auth failure, max retries exhausted),
> an integration run transitions to DEAD_LETTER status and creates an
> `IntegrationAlert`. The run is never silently dropped. Manual replay via the
> dead-letter endpoint is the only recovery path until the underlying issue is
> fixed.

### L5 — Every connector is assigned to exactly one owning core

> Integration Core owns the framework; the target business core (Financial,
> Party, Case, etc.) owns the connector semantics. A Stripe connector is owned
> by Financial Core; ownership is recorded in the Core Ownership Matrix
> (`09_DATA_ARCHITECTURE.md`).

## 7. Core Concepts

### 7.1 Connector Framework

A **Connector** is a declarative descriptor of an external system connection:
name, type (webhook, polling, API, file-drop), target core, schema, credentials,
retry policy, and rate limits. Connectors are *not* code; they are *configuration*,
immutable on critical fields (name, type, targetCore), mutable on operational
fields (active, secretRef, retryPolicy).

### 7.2 Integration Patterns

Four canonical patterns by which external systems connect to GAAhex:

1. **Inbound Webhooks** — external system POSTs signed callbacks to
   `/webhooks/{connectorSlug}` (e.g., Stripe charge events).
2. **Polling Sync** — background job periodically queries external system and
   pulls changes (e.g., Salesforce contact sync).
3. **File-Drop Import** — bulk file (CSV, JSON, Excel) uploaded or SFTP-dropped;
   parsed, mapped, and written in batch.
4. **Outbound Webhooks** — GAAhex publishes domain events; external subscribers
   receive signed POST callbacks. Also includes direct synchronous API calls to
   external systems (e.g., tax calculation on invoice emit).

### 7.3 Mapping Rule

A declarative transformation applied to inbound or outbound data, authored in
Studio domain, versioned, and tenant-configurable. Maps source fields (from
external system) to target fields (canonical GAAhex shape) via named transformer
functions (stripPrefix, dateFormat, lookupTable, etc.). Rules are immutable
post-creation; new versions are created for changes.

### 7.4 Idempotency Key

A unique token (UUIDv7 or vendor-provided) assigned to each integration
operation. For inbound: extracted from vendor event ID or custom header. For
outbound: generated by platform. Deduplication window: 5 minutes (configurable).
Idempotency key must be unique per connector per time window.

### 7.5 Integration Run

An immutable log record of one integration execution: inbound webhook received,
outbound call made, polling sync executed, or file import processed. Carries
direction, connector ID, payload, status, error detail, duration, and linkage
to emitted event. The stream of IntegrationRuns is the authoritative audit trail.

### 7.6 Dead-Letter Queue

A holding area for integration runs that have failed permanently (after max
retries or due to validation error). Operator reviews the run, fixes the
underlying issue (e.g., credential rotation, payload correction), and replays
via the replay endpoint. No automatic recovery.

### 7.7 Core Governed

**Primary:** Integration Core (PLATFORM SERVICES tier)

**Supporting:**
- **Security Core** — credential storage, rate limiting, token validation.
- **Audit Core** — integration run records, access logs.
- **Event Core** — event publishing, schema registry, replay checkpoints.
- **Tenant Core** — multi-tenant isolation, credential binding.
- **Background Processing Core** — async job execution, retry queues.
- **Identity Core** — API client authentication.
- **Target business cores** (Financial, Party, Case, etc.) — domain validation
  and state mutation.

## 8. Canonical Entities

### 8.1 `Connector`

Declarative connector descriptor; represents a potential integration.

```
Connector
├─ id (UUIDv7)
├─ referenceNumber (INTC-000001, S5)
├─ tenantId (mandatory, D1)
├─ name (human-readable: "Stripe", "Salesforce", "ServiceNow")
├─ type (ENUM: OUTBOUND_WEBHOOK | INBOUND_WEBHOOK | POLLING_SYNC | API_CALL | FILE_DROP)
├─ targetCore (ENUM: Financial | Party | Case | Service | … — the owning core)
├─ description (purpose, scope, linked business process)
├─ schema (JSON schema of expected inbound payload or outbound data shape)
├─ schemaVersion (versioning for multi-format support, D6)
├─ secretRef (FK to Secret; API key, OAuth config, mTLS cert ID)
├─ active (boolean; false halts new runs)
├─ rateLimit (max calls per minute/hour, governed by Security Core)
├─ retryPolicy (backoff strategy, max attempts, dead-letter threshold)
├─ circuitBreakerThreshold (fail-open count before circuit opens)
├─ lastSyncAt (ISO 8601 timestamp of last successful run)
├─ lastErrorAt (timestamp of last error, for monitoring)
├─ lastErrorMessage (truncated error detail for dashboard)
├─ createdAt, updatedAt, createdBy, updatedBy (audit fields)
├─ audit (immutable event log of connector mutations)
└─ status (ENUM: ACTIVE | INACTIVE | ERROR | CIRCUIT_OPEN)
```

**Immutability & mutation:**
- `name`, `type`, `targetCore` are immutable post-creation (breaking changes
  require connector versioning, e.g., "Stripe v2").
- `active`, `secretRef`, `retryPolicy`, `rateLimit` are mutable by Integration
  Admins.
- Mutations logged as `IntegrationRun` status-change events; no silent config
  edits.

### 8.2 `IntegrationRun`

One row per integration execution (inbound webhook received, outbound API call
made, polling sync executed).

```
IntegrationRun
├─ id (UUIDv7)
├─ referenceNumber (INTRUN-000001, S5)
├─ tenantId (mandatory, D1)
├─ connectorId (FK to Connector)
├─ direction (ENUM: INBOUND | OUTBOUND)
├─ eventName (optional; if state-changing, the emitted event name, e.g. "Payment.Received")
├─ externalId (vendor callback ID or external request ID for deduplication)
├─ idempotencyKey (UUIDv7 or vendor-provided token; must be unique per connector per 5min window, D1)
├─ payload (JSON; max 256 KB; no secrets, no passwords)
├─ payloadHash (SHA256 of payload; enables diff/validation)
├─ status (ENUM: QUEUED | PROCESSING | SUCCESS | FAILED | DEAD_LETTER | REPLAYED)
├─ httpStatus (HTTP response code from external system, if applicable)
├─ errorCode (canonical error type: TIMEOUT | AUTH_FAILED | RATE_LIMITED | VALIDATION | UNKNOWN)
├─ errorMessage (truncated error detail; max 500 chars, no secrets)
├─ mappingRuleId (FK to MappingRule; which transformation was applied)
├─ sourceFieldCounts (JSON; { "total_fields": 42, "mapped_fields": 40, "skipped_fields": 2 })
├─ startedAt (ISO 8601)
├─ completedAt (ISO 8601)
├─ durationMs (wall-clock duration)
├─ retryCount (0 if first attempt)
├─ nextRetryAt (timestamp for retry queue, null if final)
├─ relatedEventId (FK to Event; the state-changing event this run triggered)
├─ causationId (event causation chain; E13)
├─ createdAt, createdBy (audit fields; updatedAt not applicable — immutable)
└─ notes (optional; operator/alert annotation)
```

**Immutability:** `IntegrationRun` is immutable post-creation. Corrections
(retries, manual fixes) create new rows. The stream of runs is the authoritative
history.

### 8.3 `MappingRule`

Declarative field transformation; Studio domain (tenant-configurable).

```
MappingRule
├─ id (UUIDv7)
├─ referenceNumber (MAP-000001, S5)
├─ tenantId (mandatory, D1)
├─ connectorId (FK to Connector; which integration this rule applies to)
├─ name (e.g., "Stripe invoice → Financial invoice")
├─ description (purpose and scope)
├─ direction (ENUM: INBOUND | OUTBOUND)
├─ sourceSchema (JSON schema of external data shape)
├─ targetSchema (JSON schema of canonical GAAhex shape)
├─ mappings (JSON array of field transformations)
│  └─ [
│     {
│       "sourcePath": "$.amount",
│       "targetPath": "$.lineItems[*].amount",
│       "transformer": "multiplyByHundred",
│       "fallback": null,
│       "required": true
│     },
│     {
│       "sourcePath": "$.customer.id",
│       "targetPath": "$.customerId",
│       "transformer": "stripPrefix('cus_')",
│       "fallback": "UNKNOWN",
│       "required": false
│     }
│   ]
├─ transformerRegistry (list of transformer plugins available; e.g., "stripPrefix", "toUpperCase", "dateFormat")
├─ version (semver; new versions keep old ones readable for historical replays)
├─ active (boolean; false hides from new runs, allows historical queries)
├─ createdAt, updatedAt, createdBy, updatedBy (audit fields)
├─ lastUsedAt (timestamp of last IntegrationRun that referenced this rule)
└─ audit (immutable log of rule changes)
```

**Tenant-configurable:** Mapping rules are **never** hardcoded. Every tenant can
author rules for their integrations. Rules version independently of connectors,
enabling A/B testing different mappings with feature flags.

### 8.4 `WebhookDef` (Outbound)

Outbound subscription model (platform emits, external system receives).

```
WebhookDef
├─ id (UUIDv7)
├─ referenceNumber (WHDEF-000001, S5)
├─ tenantId (mandatory, D1)
├─ url (https endpoint to POST to; no http://)
├─ events (JSONB list of event names: ["Payment.Received", "Invoice.Generated"] or ["*"] for all)
├─ secret (HMAC-SHA256 signing key; encrypted at rest via EncryptedString, no plaintext in DB)
├─ active (boolean; false pauses subscriptions)
├─ createdAt, updatedAt, createdBy, updatedBy (audit fields)
└─ audit (immutable event log)
```

**Signature verification:** Every outbound webhook payload includes an
`X-Signature` header (HMAC-SHA256). Receivers verify before processing.
Replayed payloads use the same `idempotencyKey` and must be no-ops.

### 8.5 `WebhookDelivery` (Outbound Log)

Observable record of each outbound webhook delivery attempt.

```
WebhookDelivery
├─ id (UUIDv7)
├─ tenantId (mandatory, D1)
├─ webhookDefId (FK to WebhookDef)
├─ eventId (FK to Event; the triggering domain event)
├─ eventName (string; e.g. "Payment.Received"; matches event.eventName)
├─ payload (JSON; the signed body sent)
├─ status (ENUM: QUEUED | SENT | FAILED | DEAD_LETTER)
├─ attempts (integer; count of POST attempts made)
├─ lastAttemptAt (timestamp of most recent try)
├─ nextRetryAt (timestamp for retry queue, null if final)
├─ httpStatus (HTTP response code from receiver: 200, 429, 500, TIMEOUT, etc.)
├─ responseBody (truncated response from receiver; max 1 KB)
├─ error (canonical error type or network error message)
├─ durationMs (wall-clock duration of last attempt)
├─ createdAt (immutable; never updated after creation)
├─ lastModifiedAt (updated only on retry)
└─ signature (HMAC-SHA256 value sent; for audit trail only)
```

**Delivery guarantee:** Every `WebhookDelivery` is observable. If a delivery is
FAILED after max retries, it routes to dead-letter and triggers an alert. No
silent drops.

### 8.6 `OutboundMessage` (Multi-Channel Log)

Observable record of all external-channel sends (email, SMS, webhook, console).

```
OutboundMessage
├─ id (UUIDv7)
├─ tenantId (mandatory, D1)
├─ channel (ENUM: EMAIL | SMS | WEBHOOK | CONSOLE)
├─ to_addr (email addr, phone, or webhook URL)
├─ subject (for EMAIL; nullable for others)
├─ body (message content; max 64 KB)
├─ status (ENUM: SENT | FAILED | QUEUED)
├─ def_key (reference to NotificationDef, WebhookDef, or outbound connector rule)
├─ user_id (optional; recipient user ID if internal)
├─ error (error detail if status = FAILED)
├─ createdAt, sentAt (immutable timestamps)
└─ notes (operator annotation)
```

**Note:** In-app notifications (channel = INAPP) are **not** logged here; the
`Notification` inbox row is itself the delivery record (file 05, Notification
Standard).

### 8.7 `IntegrationAlert`

Alert trigger for integration failures and anomalies.

```
IntegrationAlert
├─ id (UUIDv7)
├─ tenantId (mandatory, D1)
├─ connectorId (FK to Connector)
├─ alertType (ENUM: CIRCUIT_OPEN | DEAD_LETTER_THRESHOLD | TIMEOUT_SPIKE | AUTH_FAILURE | RATE_LIMITED | SCHEMA_MISMATCH)
├─ severity (ENUM: INFO | WARNING | CRITICAL)
├─ description (human-readable message)
├─ relatedRunIds (list of IntegrationRun IDs that triggered the alert)
├─ createdAt (timestamp)
├─ acknowledgedAt (null if unacknowledged)
├─ acknowledgedBy (user ID who acknowledged)
└─ resolution (text note on remediation)
```

## 9. Ownership Boundaries

### 9.1 Integration Core owns the framework

**Integration Core** owns:
- Connector entity, registry, and lifecycle (create/update/delete).
- Webhook delivery infrastructure (inbound handlers, outbound dispatchers).
- Retry mechanics, circuit breaker, rate limiting (delegated to Security Core).
- Idempotency enforcement (deduplication logic, key validation).
- Dead-letter queue and replay endpoints.
- Integration run audit trail (immutable log).

### 9.2 Target cores own domain connectors

Each connector is owned by its **target business core**:

- **Stripe connector** → Financial Core (payment processing is financial business logic).
- **Salesforce connector** → Party Core / Service Core (CRM data is customer/service data).
- **ServiceNow connector** → Case Core (ticket/incident integration).
- **Twilio connector** → Notification Core (SMS/voice is a notification channel).

Target core responsibility:
- Validate inbound data (schema, business rules).
- Define mapping rules for their domain.
- Emit or consume domain events.
- Hardening checklist (8-item list per § in `01_PLATFORM_CORE_ARCHITECTURE.md`).

### 9.3 Security Core owns credential storage

Security Core owns:
- `Secret` entity and encryption at rest.
- Credential rotation versioning.
- Rate limiting policies.
- Token validation and refresh.

### 9.4 Audit Core owns audit trail

Audit Core owns:
- Audit records for connector mutations.
- Access logs on secret retrieval.
- Timeline projections of integration runs.

## 10. Relationships

### 10.1 Dependency direction

Integration Core is in PLATFORM SERVICES tier. It depends on:
- **FOUNDATION:** Security (credential storage), Audit (run logging), Identity
  (API client auth), Tenant (scoping).
- **BUSINESS OBJECTS & COMMERCE:** Target cores (Financial, Party, Case, etc.);
  Integration Core calls their APIs to write data.
- **PLATFORM SERVICES:** Event Core (publishes event on state change), Background
  Processing Core (retry queues), Storage Core (file upload).

### 10.2 Cross-core integration via events

Integration Core publishes:
- `Integration.RunCompleted` — emitted on every integration run completion
  (success or failure).
- `Integration.ConnectorStatusChanged` — emitted on circuit breaker state change.
- `Integration.AlertGenerated` — emitted on failure/anomaly alert.

Target cores subscribe to integration events and react (e.g., Financial Core
subscribes to `Integration.RunCompleted` to confirm payment write is audited).

### 10.3 Supporting cores

**Event Core:** Integration publishes events via Event Core's `publish()` method.
Integration also *consumes* domain events to trigger outbound webhooks
(subscription pattern in Outbound Webhooks § 8.1 above).

**Background Processing Core:** Integration uses BPC's queue for:
- Webhook delivery retries.
- Polling sync jobs.
- File-drop processing.

## 11. Responsibilities

### 11.1 Integration Core team

- Owns the connector framework, idempotency mechanics, and retry infrastructure.
- Maintains the Connector, IntegrationRun, WebhookDef, WebhookDelivery entities.
- Hardening checklist: entity, API, events, permissions, audit, UI, tests, docs.

### 11.2 Target business core teams

- Own the domain connectors (Stripe for Financial, Salesforce for Party, etc.).
- Define mapping rules and validation rules for their domain.
- Hardening checklist per core (8-item list in `01_PLATFORM_CORE_ARCHITECTURE.md`).

### 11.3 Security Core team

- Owns Secret storage and encryption.
- Owns rate limiting and circuit breaker policies.

### 11.4 Audit Core team

- Owns audit trail projection for integration runs.
- Surfaces audit records in timeline feeds.

## 12. Allowed Patterns

### AP1 — Declarative connector via registration API

A connector is created via `POST /api/v1/integrations/connectors` with a full
descriptor (name, type, schema, secretRef, retryPolicy, etc.). No hardcoded
SDK, no custom code per integration. Response includes the webhook URL to
register with the external provider.

### AP2 — Inbound webhook with signature verification

External system POSTs to `/api/v1/integrations/webhooks/{connectorSlug}` with
an `X-Signature` header (HMAC-SHA256). Handler verifies signature against
Connector.secretRef, deduplicates on idempotency key, maps payload via
MappingRule, and writes to target core API.

### AP3 — Idempotent deduplication within 5-minute window

Handler checks `IntegrationRun` table: `WHERE connectorId = ? AND
idempotencyKey = ? AND createdAt > now() - 5min LIMIT 1`. If found, return
200 OK (no processing). If not found, proceed with processing and record the
run.

### AP4 — Outbound webhook subscription with event filter

Tenant admin creates `WebhookDef` with `events = ["Payment.Received",
"Invoice.Generated"]`. When an event is published by a business core, Event
Core publishes; Integration Core's dispatcher queries matching WebhookDefs and
enqueues POST operations.

### AP5 — Polling sync via background job

Background Processing Core runs a `SyncJob` per schedule. Job calls target
external API with a cursor (lastSyncAt, lastId). For each record, deduplicates
on externalId, maps via MappingRule, writes to target core API. Updates cursor
and records IntegrationRun.

### AP6 — File-drop import with rollback on threshold

Tenant uploads CSV/JSON file. Handler parses, validates against
Connector.schema, maps each record, writes to target core. If > 10% fail, mark
import as FAILED; no writes committed (or event-compensation rollback).

### AP7 — Direct API call with timeout and fallback

Workflow rule subscribes to `Invoice.Generated`. On event, Integration Core
synchronously calls TaxJar API (tax calculation). If timeout or 5xx: enqueue
for async retry. If 4xx: log validation error, dead-letter. If 2xx: emit
`TaxCalculation.Completed` event.

### AP8 — Mapping rule with transformer plugins

A `MappingRule` defines transformations: identity, stripPrefix, stripSuffix,
uppercase, lowercase, dateFormat, multiplyBy, dividedBy, lookupTable, jsonPath,
default, custom per target core. Transformations are applied per field per
mapping rule.

### AP9 — Credential rotation via Secret versioning

When an API key is compromised, Security Core creates a new `Secret` version
(v2). Connector.secretRef points to latest. Old version remains readable for
historical replay. Future runs use new key; audit logs the rotation event.

### AP10 — Dead-letter replay endpoint

Operator reviews a DEAD_LETTER run in the UI. After fixing underlying issue
(credential rotation, external API change), calls `POST
/api/v1/integrations/dead-letters/{id}/replay`. Platform reprocesses original
payload with same idempotencyKey; new IntegrationRun created.

## 13. Forbidden Patterns

### FP1 — Hardcoded credentials in code

Credentials must be stored in `Secret` and referenced by ID only. No API keys
in source, environment variables, or logs.

### FP2 — Direct database writes from integration code

Integrations must call target core APIs or publish events; they never bypass
invariants. No integration code writes directly to business-core tables.

### FP3 — Ungoverned cross-system sync

Every external sync must:
- Go through Integration Core's idempotency and retry mechanics.
- Be auditable (logged in `IntegrationRun`).
- Emit domain events for state changes.
- Have a declared mapping rule.

### FP4 — Silent failures

No integration operation is silent. Failures are logged, alerted, and
dead-lettered.

### FP5 — Cross-tenant credential leakage

Secrets are tenant-scoped. No tenant can access another's credentials via
Connector or IntegrationRun queries (enforced via RLS on both tables).

### FP6 — Unmapped external data

All inbound data must be mapped to canonical fields via `MappingRule` before
storage. No raw "other" JSON blobs.

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Core definitions and ownership. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core lifecycle, ownership laws, audit universality. |
| `09_DATA_ARCHITECTURE.md` | Canonical entities, referenceNumber formats (S5). |
| `11_EVENT_ARCHITECTURE.md` | Event publishing, schema registry, replay checkpoints. |
| `13_SECURITY_ARCHITECTURE.md` | Secret storage, credential management, rate limiting. |
| `14_TENANT_ARCHITECTURE.md` | Tenant scoping, multi-tenant isolation, RLS. |
| `19_INFRASTRUCTURE_ARCHITECTURE.md` | Background Processing Core, queue infrastructure, storage. |

| Documents that depend on this one |
|---|
| `02_DOMAIN_ARCHITECTURE.md` (integrations assembled by domain). |
| `05_OPERATIONAL_ARCHITECTURE.md` (Developer Portal, connector UI). |
| `10_API_ARCHITECTURE.md` (Integration Core REST surface). |
| `18_OBSERVABILITY_ARCHITECTURE.md` (metrics, traces, logs for integration runs). |

## 15. Implementation Requirements

### 15.1 Connector entity and framework

- [ ] `Connector` entity (UUIDv7, referenceNumber S5, tenant-scoped, immutable
      critical fields).
- [ ] Connector registration API: `POST /api/v1/integrations/connectors`.
- [ ] Connector CRUD endpoints (read, update active/secretRef/retryPolicy/rateLimit,
      list, delete).
- [ ] RLS enforcement: connectorId scoped to tenantId.

### 15.2 IntegrationRun entity and immutable audit log

- [ ] `IntegrationRun` entity (UUIDv7, referenceNumber S5, tenant-scoped,
      immutable post-creation).
- [ ] Immutable append-only log; no updates after creation (corrections create
      new rows).
- [ ] Indexing: by connectorId, status, createdAt (for queries, filtering).
- [ ] Observability queries: `GET /api/v1/integrations/runs?connectorId=...&status=...&fromDate=...`.

### 15.3 MappingRule entity

- [ ] `MappingRule` entity (UUIDv7, referenceNumber S5, tenant-scoped, versioned).
- [ ] Studio domain UI for authoring rules (tenant-configurable).
- [ ] Transformer plugin registry (identity, stripPrefix, dateFormat, multiplyBy,
      etc.).
- [ ] Tenant-scoped overrides for rule fields.

### 15.4 WebhookDef and WebhookDelivery entities

- [ ] `WebhookDef` entity (outbound subscription model, HMAC-SHA256 secret,
      event filter).
- [ ] `WebhookDelivery` entity (immutable delivery log, status, attempts,
      response).
- [ ] Outbound subscription API: `POST /api/v1/integrations/webhooks`.
- [ ] Event dispatch logic: on event publish, query matching WebhookDefs and
      enqueue deliveries.

### 15.5 Webhook handler (inbound)

- [ ] Handler at `POST /api/v1/integrations/webhooks/{connectorSlug}`.
- [ ] Signature verification (HMAC-SHA256 against Connector.secretRef).
- [ ] Deduplication: 5-minute window on idempotencyKey.
- [ ] Schema validation against Connector.schema.
- [ ] Tenant routing (extract tenant from payload/header; map to tenantId).
- [ ] Mapping rule application (load MappingRule, transform source → canonical).
- [ ] Target core API call (call Financial Core, Party Core, etc.).
- [ ] Event linkage: record IntegrationRun with relatedEventId.
- [ ] Dead-letter on permanent failure.

### 15.6 Polling sync framework

- [ ] `SyncJob` entity (Background Processing Core).
- [ ] Job handler: query external system with cursor, dedup on externalId,
      apply MappingRule, batch-write to target core, update cursor.
- [ ] IntegrationRun recording per batch.
- [ ] Partial failure handling (mark PARTIAL_FAILURE, log individual errors).

### 15.7 File-drop handler

- [ ] Upload to Storage Core; virus scan on receipt.
- [ ] Parse (CSV, JSON, Excel to JSON records).
- [ ] Schema validation.
- [ ] Mapping rule application per record.
- [ ] Rollback on threshold (e.g., > 10% fail).
- [ ] IntegrationRun recording.

### 15.8 Outbound webhook dispatcher

- [ ] Background Processing Core worker.
- [ ] Pick up queued WebhookDelivery.
- [ ] POST to receiver URL (timeout: 10s).
- [ ] Record response: status, httpStatus, responseBody.
- [ ] Retry logic: exponential backoff, max 5 attempts.
- [ ] Dead-letter on exhaustion; alert operator.

### 15.9 Direct API call handler

- [ ] Synchronous handler on event trigger (e.g., Invoice.Generated).
- [ ] Fetch Connector.secretRef, retrieve API credentials.
- [ ] Apply MappingRule; build external API payload.
- [ ] Call external API with timeout (10s).
- [ ] On 2xx: emit domain event (e.g., TaxCalculation.Completed).
- [ ] On 4xx: log validation error, dead-letter.
- [ ] On 5xx/timeout: enqueue for async retry.

### 15.10 Retry logic and circuit breaker

- [ ] Retry policy on Connector: maxAttempts, backoffMs, backoffMultiplier,
      deadLetterThreshold.
- [ ] Circuit breaker: open after circuitBreakerThreshold consecutive failures.
- [ ] Circuit breaker recovery: manual reset + 5 successful runs to recover.
- [ ] Exponential backoff: 5s, 10s, 20s, 40s, 80s (configurable multiplier).

### 15.11 Dead-letter queue and replay

- [ ] `DeadLetter` record: tenantId, connectorId, relatedRunId, reason,
      originalPayload, status (PENDING_REVIEW).
- [ ] Operator UI to review and replay.
- [ ] Replay endpoint: `POST /api/v1/integrations/dead-letters/{id}/replay`.
- [ ] Reprocess with same idempotencyKey; create new IntegrationRun.

### 15.12 Secret storage via Security Core

- [ ] Secret entity: encrypted at rest, versioned.
- [ ] Integration worker: decrypt at runtime (only integration worker can
      decrypt).
- [ ] Credential rotation: new version created, old version preserved for
      historical replay.
- [ ] No plaintext in logs or API responses.

### 15.13 Idempotency key validation

- [ ] Check IntegrationRun for duplicate (connectorId, idempotencyKey,
      createdAt within 5min).
- [ ] Token format: UUIDv7 or vendor-provided opaque string.
- [ ] Outbound payloads include idempotencyKey header and payload field.

### 15.14 OAuth 2.0 flow (if applicable)

- [ ] Callback endpoint: `POST /api/v1/integrations/oauth/callback`.
- [ ] Exchange code for access token + refresh token.
- [ ] Store tokens in Secret (encrypted).
- [ ] Tenant isolation: OAuth token scoped to tenantId.
- [ ] Token refresh on expiry.

### 15.15 Alert mechanism

- [ ] `IntegrationAlert` entity: alertType (CIRCUIT_OPEN, DEAD_LETTER_THRESHOLD,
      etc.), severity, description, createdAt, acknowledgedAt.
- [ ] Alert triggers: circuit open, dead-letter threshold breached, timeout
      spike, auth failure, rate limited, schema mismatch.
- [ ] Notification Core integration: emit Notification on alert creation.

### 15.16 Audit trail

- [ ] Connector mutation audit: immutable log of create, update, delete.
- [ ] Secret rotation audit: logged in Security Core.
- [ ] MappingRule change audit: immutable log, old version preserved.
- [ ] WebhookDef add/remove audit.
- [ ] Dead-letter replay audit: logged with operator name and original run ID.
- [ ] Circuit breaker reset audit: logged with operator and reason.
- [ ] All traces feed Audit Core and timeline feeds.

### 15.17 Schema registry and versioning

- [ ] Connector.schemaVersion and schema (JSON schema).
- [ ] MappingRule.schemaVersion; new versions for schema evolution.
- [ ] Backward compatibility: old rules valid for new schemas (if old fields
      exist).
- [ ] Historical replay: retrieve original schema + mapping rule version used.

### 15.18 Observability

- [ ] Dashboard: query IntegrationRun by connector, status, date range.
- [ ] Timeline: IntegrationRun events appear in audit timelines and activity
      feeds.
- [ ] Metrics: delivery rate (% SUCCESS / total), latency histogram (p50, p95,
      p99), error rate by code, retry rate.
- [ ] Logs: all integration operations logged to observability platform per
      `18_OBSERVABILITY_ARCHITECTURE.md`.

### 15.19 Tenant isolation

- [ ] RLS enforcement: connectorId, IntegrationRunId scoped to tenantId.
- [ ] secretRef scoping: credentials only accessible by runs in same tenant.
- [ ] External account mapping: map vendor account ID → GAAhex tenantId
      (per-core responsibility).
- [ ] Cross-tenant isolation check: no tenant can access another's credentials,
      runs, or configurations.

### 15.20 Documentation

- [ ] Connector author guide: how to register, test, monitor a connector.
- [ ] SDK (if applicable): helper library for common integration patterns.
- [ ] Webhook signing spec: HMAC-SHA256 signature verification.
- [ ] API documentation: Connector CRUD, IntegrationRun queries, dead-letter
      replay.
- [ ] Troubleshooting guide: common failure modes, dead-letter recovery.

## 16. Future Expansion Rules

### 16.1 Adding a new connector type

If a new integration pattern emerges (beyond webhook, polling, file-drop, direct
API call), it must:
1. Define the new pattern in a proposal.
2. Register as a new Connector.type enum value.
3. Implement handler logic following the same structure as existing patterns
   (signature verification, deduplication, mapping, error handling).
4. Update this document with the new pattern.

### 16.2 Splitting Integration Core

If Integration Core grows large enough that two distinct ownership boundaries
are visible (e.g., framework vs. domain-specific connectors):
1. Document the split candidate.
2. Identify which connectors move to which side.
3. Migrate in a single amendment, preserving event-name continuity and FK
   continuity.
4. Requires constitution amendment.

### 16.3 Merging with another core

If Integration Core discovers it should merge with (e.g.) Event Core:
1. Document the merge candidate.
2. Identify which side absorbs which entities.
3. Migrate on documented timeline.
4. Requires constitution amendment.

### 16.4 Extending transformation language

The transformer plugin system is extensible. New transformers (per target core
or globally) can be added without amending this document, as long as:
1. Transformer is registered in MappingRule.transformerRegistry.
2. Transformer is documented in the Connector author guide.
3. Transformer is tested.

### 16.5 Adding new authentication methods

New auth postures (SAML, OAuth PKCE, WebAuthn, etc.) can be added by:
1. Registering a new Secret.type enum value.
2. Implementing the auth flow (callback, token exchange, refresh).
3. Documenting in the Connector author guide.

---

*End of 12 — Integration Architecture.*
