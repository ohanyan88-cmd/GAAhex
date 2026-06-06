# 12 — Integration Architecture

**Position in hierarchy:** Constitutional document under `PLATFORM_REFERENCE_MODEL.md`, sibling to `01_PLATFORM_CORE_ARCHITECTURE.md`. All integration development must remain consistent with this document and the locked Integration Standard (`standards/19-integration-standard.md`).

---

## 1. Purpose

Define how external systems connect to GAAhex: the connector framework, authentication postures, inbound and outbound patterns, mapping rules, credential handling, idempotency enforcement, failure strategies, and audit trails. Ensure every external integration is declarative, observable, secure, compliant with Standards D1 and M1, and governed by Integration Core with support from Security, Event, Audit, and Tenant Cores.

---

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

---

## 3. Architecture Principles

### P1 — Integrations are event-driven, not table-driven.

External systems consume GAAhex events via webhooks or polling for updates; they do not query internal tables directly. Integration code never bypasses the Event Core publish path or writes directly to business-core database tables.

### P2 — Integrations are tenant-scoped by default.

Every connector instance carries `tenantId`. Multi-tenant isolation is enforced: a Stripe connector for Tenant A cannot access Tenant B's configuration, credentials, or payment data. Global connectors (rare) are explicitly flagged.

### P3 — Credentials are secrets, not configuration.

API keys, OAuth tokens, secrets, and mTLS certs are stored via Security Core's `Secret` entity (encrypted at rest). Integration code references secrets by `secretRef` ID only; it never embeds, retrieves, or logs plaintext credentials. Credential rotation is managed via Secret Core versioning.

### P4 — Every integration write is idempotent.

Inbound webhook handlers deduplicate via `idempotencyKey` (from vendor or assigned by platform). Replayed callbacks are no-ops. Outbound API calls are idempotent by design or retried safely. Financial transactions and state mutations use idempotency strictly.

### P5 — Mapping is declarative and pluggable.

Field mapping (source → canonical) is authored in Studio domain as a `MappingRule` entity. Tenant admins configure mappings without code changes. Mapping rules version with the integration, and old rules remain readable for historical sync jobs.

### P6 — Integration runs are fully auditable.

Every external call produces an `IntegrationRun` record with status, payload, result, error, and a link to the published event (if state-changing). All traces feed Audit Core, Observability Core, and timeline feeds.

### P7 — Failures are terminal → dead-letter or handled explicitly.

If an integration fails, it routes to a dead-letter queue and triggers an alert. No silent failures. Replay is manual or governed by a retry policy declared in the `Connector` or `IntegrationRun` entity.

### P8 — Integrations own only the framework; target cores own domain connectors.

Integration Core governs the connector framework, idempotency keys, and webhook delivery infrastructure. A Stripe connector is owned and hardened by Financial Core; a ServiceNow connector by Case Core. Target cores define validation, transformation, and business logic.

---

## 4. Core Governed

**Primary:** Integration (PLATFORM SERVICES tier)

**Supporting:**
- **Security Core** — credential storage, rate limiting, token validation.
- **Audit Core** — integration run records, access logs.
- **Event Core** — event publishing, schema registry, replay checkpoints.
- **Tenant Core** — multi-tenant isolation, credential binding.
- **Background Processing Core** — async job execution, retry queues.
- **Identity Core** — API client authentication.
- **Target business cores** (Financial, Party, Case, etc.) — domain validation and state mutation.

---

## 5. Canonical Entities & Data Model

### 5.1 `Connector`

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
- `name`, `type`, `targetCore` are immutable post-creation (breaking changes require connector versioning, e.g., "Stripe v2").
- `active`, `secretRef`, `retryPolicy`, `rateLimit` are mutable by Integration Admins.
- Mutations logged as `IntegrationRun` status-change events; no silent config edits.

---

### 5.2 `IntegrationRun`

One row per integration execution (inbound webhook received, outbound API call made, polling sync executed).

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

**Immutability:** `IntegrationRun` is immutable post-creation. Corrections (retries, manual fixes) create new rows. The stream of runs is the authoritative history.

---

### 5.3 `MappingRule`

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

**Tenant-configurable:** Mapping rules are **never** hardcoded. Every tenant can author rules for their integrations. Rules version independently of connectors, enabling A/B testing different mappings with feature flags.

---

### 5.4 `WebhookDef` (Outbound)

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

**Signature verification:** Every outbound webhook payload includes an `X-Signature` header (HMAC-SHA256). Receivers verify before processing. Replayed payloads use the same `idempotencyKey` and must be no-ops.

---

### 5.5 `WebhookDelivery` (Outbound Log)

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

**Delivery guarantee:** Every `WebhookDelivery` is observable. If a delivery is FAILED after max retries, it routes to dead-letter and triggers an alert. No silent drops.

---

### 5.6 `OutboundMessage` (Multi-Channel Log)

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

**Note:** In-app notifications (channel = INAPP) are **not** logged here; the `Notification` inbox row is itself the delivery record (file 05, Notification Standard).

---

### 5.7 `IntegrationAlert`

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

---

## 6. Connector Framework

### 6.1 Declarative Connector Descriptor

Every connector is registered via a `Connector` entity:

```
POST /api/v1/integrations/connectors
{
  "tenantId": "TENANT-000001",
  "name": "Stripe",
  "type": "INBOUND_WEBHOOK",
  "targetCore": "Financial",
  "description": "Inbound payment callbacks from Stripe; handles charge.completed, charge.refunded.",
  "schema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "object": { "type": "string", "enum": ["charge", "refund"] },
      "amount": { "type": "integer" },
      "customer": { "type": "string" },
      "metadata": { "type": "object" }
    }
  },
  "secretRef": "SECRET-000042",
  "rateLimit": { "perMinute": 1000, "perHour": 10000 },
  "retryPolicy": {
    "maxAttempts": 5,
    "backoffMs": 5000,
    "backoffMultiplier": 2,
    "deadLetterThreshold": 3
  },
  "circuitBreakerThreshold": 10
}
```

The API response includes the endpoint URL to register with the external provider:

```
{
  "id": "INTC-000001",
  "webhookUrl": "https://gaahex-prod.example.com/webhooks/stripe",
  "createdAt": "2026-06-06T14:32:00Z"
}
```

---

### 6.2 Authentication Methods

Integration Core supports four native authentication postures:

#### 6.2.1 **OAuth 2.0** (Authorization Code Flow)

For integrations requiring user delegation (e.g., Salesforce, HubSpot CRM).

```
Connector.secretRef -> Secret (stores encrypted OAuth client ID, client secret, redirect URI)
```

Flow:
1. Tenant admin clicks "Connect [provider]" in Studio.
2. Platform redirects to provider's `/authorize` endpoint with `client_id, redirect_uri, scopes`.
3. User authenticates and grants permission.
4. Provider redirects to `POST /api/v1/integrations/oauth/callback?code=...&state=...`.
5. Platform exchanges code for access token + refresh token.
6. Platform stores access token + refresh token in `Secret`, encrypted.
7. Future runs use `Secret` to retrieve current access token (refresh if expired).

**Tenant isolation:** Every tenant's OAuth token is stored in a separate `Secret` with `tenantId`. No cross-tenant leakage.

---

#### 6.2.2 **API Key**

For integrations with static authentication (e.g., Stripe API key, custom REST API).

```
Connector.secretRef -> Secret (stores encrypted API key)
```

Example:
```
Connector:
  name: "Stripe API"
  type: "API_CALL"
  secretRef: SECRET-000042

Secret (SECRET-000042):
  name: "Stripe API key"
  value: "<encrypted: sk_live_...>"
  algorithm: "AES-256-GCM"
  rotationSchedule: "90d"
```

**Key rotation:** When an API key is rotated (security incident or scheduled), a new `Secret` version is created with `version: 2`. Old versions remain readable for historical replay; the connector points to the latest.

---

#### 6.2.3 **mTLS (Mutual TLS)**

For integrations requiring certificate-based authentication (e.g., proprietary ISP integrations).

```
Connector.secretRef -> Secret (stores encrypted client cert + key + CA cert chain)
```

---

#### 6.2.4 **Bearer Token (Custom)**

For proprietary or OIDC-style integrations.

```
Connector.secretRef -> Secret (stores encrypted bearer token)
```

---

### 6.3 Rate Limiting & Backpressure

Rate limits are declared on the `Connector` and enforced by Security Core:

```
Connector.rateLimit:
  perMinute: 1000
  perHour: 10000
  perDay: 100000
```

**Enforcement:**
1. IntegrationRun checks Connector.rateLimit before queuing.
2. If limit exceeded, status = QUEUED; nextRetryAt set to next available window.
3. If persistent overload (backpressure), circuit breaker opens: Connector.status = CIRCUIT_OPEN.
4. Receiver (external system) sends `429 Too Many Requests`; platform backs off exponentially.

---

### 6.4 Retry Logic & Circuit Breaker

Retry policy on `Connector`:

```
Connector.retryPolicy:
  maxAttempts: 5
  backoffMs: 5000              # initial backoff
  backoffMultiplier: 2          # exponential: 5s, 10s, 20s, 40s, 80s
  deadLetterThreshold: 3        # fail after 3 attempts; route to dead-letter on attempt 4+
```

Circuit breaker on `Connector`:

```
Connector.circuitBreakerThreshold: 10
# If 10 consecutive failures occur, set Connector.status = CIRCUIT_OPEN
# Incoming runs are rejected (status = CIRCUIT_OPEN) until circuit recovers
# (manual acknowledgment + 5 successful runs, or time-decay window expires)
```

---

## 7. Inbound Integrations

### 7.1 Webhook Handlers (Vendor Callbacks)

External systems (Stripe, Twilio, SendGrid, etc.) POST signed callbacks to:

```
POST /api/v1/integrations/webhooks/{connectorSlug}
```

**Handler flow:**

1. **Signature verification.** Verify webhook signature matches `Secret.value` (HMAC-SHA256).
   - If invalid: reject with 403 Forbidden; log security event.

2. **Deduplication.** Extract idempotency token from vendor event ID or `Idempotency-Key` header.
   - Query `IntegrationRun` for existing run with same `idempotencyKey + connectorId + 5min window`.
   - If found: return 200 OK (idempotent no-op); skip processing.

3. **Schema validation.** Validate inbound payload against `Connector.schema`.
   - If invalid: log validation error; route to dead-letter; return 202 Accepted (ack receipt).

4. **Tenant routing.** Extract tenant identifier from payload (e.g., Stripe: `stripe_account` header).
   - Map external account ID → GAAhex `tenantId` via `ExternalTenantMapping` (per-core responsibility).
   - If mapping fails: reject with 400 Bad Request.

5. **Mapping rule application.** Load `MappingRule` for this connector.
   - Transform source fields → canonical fields.
   - Apply fallback values for missing fields.
   - If transformation fails: log error; route to dead-letter.

6. **Canonical write.** Call the target business core's API (e.g., Financial Core's `POST /api/v1/financial/payments`).
   - Write goes through kernel invariants (permission, tenant scope, audit).
   - Target core emits domain event (e.g., `Payment.Received`).

7. **Event linkage.** Record `IntegrationRun`:
   ```
   {
     connectorId: INTC-000001,
     direction: INBOUND,
     externalId: "evt_1234...",
     idempotencyKey: "evt_1234...",
     payload: { ... },
     status: SUCCESS,
     relatedEventId: EVT-000042,  # the Payment.Received event
     completedAt: now
   }
   ```

8. **Response.** Return 200 OK with acknowledgment.

---

### 7.2 Polling Sync

For integrations without push webhooks (e.g., legacy APIs, file-based sync).

**Trigger:** Background job (`SyncJob` in Background Processing Core).

```
SyncJob:
  name: "Salesforce contacts → Party sync"
  connectorId: INTC-000002
  schedule: "every 30min"
  cursor: { lastSyncAt: "2026-06-06T14:00:00Z", lastId: "PARTY-000999" }
```

**Flow:**

1. **Query external system.** Use connector's API credentials to fetch changes since `cursor.lastSyncAt`.
   ```
   GET https://salesforce.example.com/api/v1/contacts?updatedSince=2026-06-06T14:00:00Z
   ```

2. **Deduplication.** For each record, check `IntegrationRun` for existing sync of `externalId` within `checkpointWindow` (e.g., 24h).
   - If found: skip record.

3. **Mapping & validation.** Apply `MappingRule` to each record.

4. **Write.** Call target core API for each transformed record.
   - Batch writes if possible (e.g., `POST /api/v1/parties/batch`).

5. **Checkpoint.** Update `SyncJob.cursor` with latest `lastSyncAt` and `lastId`.
   - Record `IntegrationRun` for the entire batch:
   ```
   {
     connectorId: INTC-000002,
     direction: INBOUND,
     status: SUCCESS,
     sourceFieldCounts: { total_fields: 150, mapped_fields: 148, skipped_fields: 2 },
     completedAt: now
   }
   ```

6. **Alert on partial failure.** If some records fail:
   - Mark `status: PARTIAL_FAILURE`.
   - Log individual failures in notes.
   - Retry failed records in next sync run.

---

### 7.3 File-Drop Import

For integrations relying on bulk file upload (CSV, JSON, Excel).

**Trigger:** Manual upload via Studio or scheduled SFTP/S3 poll.

**Flow:**

1. **Upload to Storage Core.** File stored in secure bucket; virus scan on receipt.

2. **Parse.** Detect format (CSV, JSON, Excel); parse to JSON records.

3. **Schema validation.** Validate against `Connector.schema`; report mismatches.

4. **Mapping & write.** Apply `MappingRule` per record (same as polling sync).

5. **Rollback on critical failure.** If more than `rollbackThreshold` (e.g., 10%) of records fail:
   - Mark import `status: FAILED`.
   - Rollback all writes (via transaction or event-compensation).
   - Notify tenant admin; request manual review.

---

## 8. Outbound Integrations

### 8.1 Webhook Subscriptions

Outbound webhooks (platform emits, external system receives) are governed by `WebhookDef` entities.

**Creation:**
```
POST /api/v1/integrations/webhooks
{
  "tenantId": "TENANT-000001",
  "url": "https://external-app.example.com/webhooks/gaahex",
  "events": ["Payment.Received", "Invoice.Generated"],
  "secret": "<HMAC-SHA256 key to sign payloads>"
}
```

**Event publishing:** When `Payment.Received` event is emitted by Financial Core:

1. **Query subscriptions.** Find all `WebhookDef` with `events = ["*"]` or `events = ["Payment.Received"]`.

2. **Dispatch.** For each subscription:
   - Create `IntegrationRun` (direction: OUTBOUND).
   - Sign payload: `X-Signature: sha256=<HMAC-SHA256(payload, secret)>`.
   - Queue POST to webhook URL.

3. **Delivery.** Background worker picks up queue:
   - POST to receiver URL with timeout (e.g., 10s).
   - Record `WebhookDelivery` with status, HTTP code, response.
   - If 2xx: mark SUCCESS.
   - If 4xx (client error): mark FAILED (no retry).
   - If 5xx or timeout: mark FAILED; enqueue for retry (exponential backoff, max 5 attempts).
   - If all retries exhausted: mark DEAD_LETTER; alert operator.

4. **Idempotency.** Include `idempotencyKey` in payload (UUIDv7, unique per webhook per event).
   - Receiver uses key to deduplicate replayed payloads (same event emitted twice = same key).

---

### 8.2 Direct API Calls

For integrations requiring synchronous writes to external systems (e.g., real-time charge capture, compliance reporting).

**Example:** When a `Invoice.Generated` event fires, post to tax integration API (TaxJar).

**Flow:**

1. **Event trigger.** Automation or workflow rule subscribes to `Invoice.Generated`.
   ```
   EventSubscription:
     event: "Invoice.Generated"
     targetConnector: INTC-000003 (TaxJar)
     action: "POST_TAX_CALCULATION"
   ```

2. **Fetch connector secrets.** Load `Connector.secretRef` and retrieve API credentials.

3. **Build payload.** Transform domain event → external API format via `MappingRule`.

4. **Call external API.**
   ```
   POST https://api.taxjar.com/v2/transactions
   Authorization: Bearer <API_KEY>
   {
     "transaction_id": "INV-000042",
     "amount": 100.00,
     ...
   }
   ```

5. **Handle response.**
   - 2xx: Record `IntegrationRun` (status: SUCCESS); emit `TaxCalculation.Completed` event.
   - 4xx: Log validation error; may retry (idempotent check) or mark FAILED.
   - 5xx or timeout: Enqueue for retry (exponential backoff, deadletter after max attempts).
   - Error: Record `IntegrationRun` (status: FAILED, error: "connection timeout"); alert.

6. **Timeout & circuit breaker.** If API is slow (> 10s) or repeatedly failing:
   - Connector circuit breaker opens.
   - Fall back to async: queue the call for background retry (async path).
   - Alert on SLA breach.

---

## 9. Mapping Rules & Transformation

### 9.1 Declarative Mapping

Mapping rules are authored in the Studio domain by tenant admins; no hardcoding.

```
MappingRule:
  connectorId: INTC-000001 (Stripe)
  direction: INBOUND
  name: "Stripe event → Financial payment"
  
  mappings: [
    {
      "sourcePath": "$.id",
      "targetPath": "$.externalPaymentId",
      "transformer": "identity",
      "required": true
    },
    {
      "sourcePath": "$.amount",
      "targetPath": "$.amountCents",
      "transformer": "multiplyByHundred",
      "fallback": null,
      "required": true
    },
    {
      "sourcePath": "$.customer",
      "targetPath": "$.customerId",
      "transformer": "stripPrefix('cus_')",
      "fallback": "UNKNOWN",
      "required": false
    },
    {
      "sourcePath": "$.metadata.invoice_id",
      "targetPath": "$.invoiceId",
      "transformer": "uppercase",
      "required": false
    }
  ]
```

### 9.2 Transformer Plugins

Standard transformers (extensible per target core):

- `identity` — pass through unchanged.
- `stripPrefix(prefix)` — remove leading string.
- `stripSuffix(suffix)` — remove trailing string.
- `uppercase` / `lowercase` — case conversion.
- `dateFormat(fromFormat, toFormat)` — parse and reformat dates.
- `multiplyBy(factor)` — numeric scaling (e.g., cents → dollars).
- `dividedBy(factor)` — numeric division.
- `lookupTable(map)` — enum mapping (e.g., `"pending" -> "PENDING"`).
- `jsonPath(path)` — extract nested value.
- `default(value)` — use value if source is null.
- Custom transformers per target core (Financial, Party, etc.).

### 9.3 Tenant-Scoped Override

Tenants can override rules:

```
TenantMappingOverride:
  tenantId: TENANT-000001
  mappingRuleId: MAP-000001
  overrideField: "$.amount"
  transformer: "multiplyBy(1000)"  # for this tenant, multiply by 1000 instead of 100
```

Overrides are applied at runtime, preserving the base rule for other tenants.

---

## 10. Credential & Secret Handling

### 10.1 Credential Storage

All credentials are stored via Security Core's `Secret` entity:

```
Secret:
  id: SECRET-000042
  name: "Stripe API key for Tenant A"
  type: "API_KEY"
  value: "<encrypted: sk_live_...>"  # encrypted at rest via AES-256-GCM
  algorithm: "AES-256-GCM"
  encryptionKeyId: KEY-000001
  tenantId: TENANT-000001
  expiresAt: "2026-09-06T00:00:00Z"  # optional rotation date
  rotationSchedule: "90d"
  lastRotatedAt: "2026-03-06T00:00:00Z"
  createdAt, createdBy, updatedAt, updatedBy
  audit: [...]
```

**Immutability:** `Secret.value` is **never** readable via API after creation (write-only). Only the integration worker can decrypt secrets at runtime using its own key material.

### 10.2 Credential Rotation

When an API key expires or is compromised:

1. **New secret created.** A new `Secret` row with `version: 2` is inserted.
2. **Connector updated.** `Connector.secretRef` points to the latest secret version.
3. **Old secret preserved.** Version 1 remains readable for historical audit (e.g., replay old integration runs with the key they used).
4. **Immediate effect.** Future runs use the new secret; old secrets are logged as "retired" in audit.

### 10.3 Secrets in Code

**Forbidden patterns:**
- Hardcoded API keys in source.
- Environment variables with plaintext secrets.
- Secrets in commit history or logs.

**Required pattern:**
```python
# ❌ WRONG
stripe_key = "sk_live_abc123"

# ✅ CORRECT
secret = security_core.get_secret(secret_ref_id)
stripe_key = secret.decrypt()  # only integration worker can decrypt
```

---

## 11. Idempotency & Deduplication

### 11.1 Inbound Idempotency

Every inbound webhook must be idempotent. Duplication can occur:
- Network retry (webhook resent by provider).
- Platform failure during processing (partial write, then crash).
- Clock skew (provider replays old events).

**Mechanism:**

1. **Extract idempotency token** from vendor's event ID or custom `Idempotency-Key` header.
   ```
   Stripe: use evt_1234... as idempotencyKey
   Custom: use X-Idempotency-Key header or payload field
   ```

2. **Check for duplicate.** Query `IntegrationRun`:
   ```sql
   SELECT * FROM IntegrationRun
   WHERE connectorId = ? 
     AND idempotencyKey = ?
     AND createdAt > now() - interval '5 minutes'
   LIMIT 1
   ```

3. **If found:** Return 200 OK (no processing). Webhook is deduplicated.

4. **If not found:** Proceed with processing. Record `IntegrationRun` with `idempotencyKey` before writing state.

**Token format:** UUIDv7 or vendor-provided opaque string. Must be unique per connector per 5-minute window (or longer if configured).

### 11.2 Outbound Idempotency

Outbound webhooks include `idempotencyKey` in the payload and headers:

```json
{
  "eventId": "EVT-000042",
  "eventName": "Payment.Received",
  "idempotencyKey": "idp-2026-06-06-abc123xyz",
  "payload": { ... }
}

// Also in header:
X-Idempotency-Key: idp-2026-06-06-abc123xyz
```

Receiver is expected to deduplicate on the receiver's side. Platform tracks delivery attempts; if a webhook is replayed, the same `idempotencyKey` is used.

---

## 12. Failure Handling & Dead-Letter Queues

### 12.1 Failure Classification

Integration failures are categorized:

- **Transient:** Timeout, 5xx, temporary network error → retry with backoff.
- **Permanent:** 4xx validation error, auth failure, schema mismatch → dead-letter immediately.
- **Rate-limited:** 429 Too Many Requests → back off; may recover.
- **Circuit open:** Repeated consecutive failures → circuit breaker opens; reject new attempts.

### 12.2 Dead-Letter Queue

When a run fails permanently (after max retries):

1. **Create `DeadLetter` record:**
   ```
   DeadLetter:
     id: DLQ-000001
     tenantId: TENANT-000001
     connectorId: INTC-000001
     relatedRunId: INTRUN-000042
     reason: "MAX_RETRIES_EXCEEDED"
     originalPayload: { ... }
     createdAt: now
     status: PENDING_REVIEW
   ```

2. **Alert operator.**
   - Create `IntegrationAlert` (severity: CRITICAL).
   - Notify Integration Admin via Notification Core.

3. **Operator review.** Admin reviews payload in dead-letter UI:
   - Inspect error details.
   - Optionally fix payload and retry.
   - Or create manual workaround (e.g., direct API call).

4. **Replay.** Once fixed, operator can replay:
   ```
   POST /api/v1/integrations/dead-letters/{id}/replay
   ```
   - Platform reprocesses the original payload with the same `idempotencyKey`.
   - New `IntegrationRun` created; old run remains in history.

---

### 12.3 Circuit Breaker Recovery

When a circuit opens (e.g., 10 consecutive failures):

1. **Incoming requests rejected.** Status = CIRCUIT_OPEN.
2. **Alert.** Integration Admin notified.
3. **Manual acknowledgment.** Admin reviews error logs and fixes root cause (e.g., credential rotation, external API change).
4. **Reset.** Admin calls:
   ```
   PATCH /api/v1/integrations/connectors/{id}/reset-circuit
   ```
   - Connector status → ACTIVE.
   - Failure counter reset to 0.
5. **Verification.** Next 5 successful runs automatically recover; if failure reoccurs, circuit opens again.

---

## 13. Observability & Audit

### 13.1 Integration Run Observability

Every `IntegrationRun` is observable via:

- **Dashboard:** Query `IntegrationRun` by connector, status, date range.
  ```
  GET /api/v1/integrations/runs?connectorId=...&status=FAILED&fromDate=...&toDate=...
  ```

- **Timeline:** `IntegrationRun` events appear in audit timelines and activity feeds.

- **Metrics:** Observability Core tracks:
  - Delivery rate (% SUCCESS / total attempts).
  - Latency histogram (p50, p95, p99 of `durationMs`).
  - Error rate by error code.
  - Retry rate.

- **Alerts:** Integration Core emits alerts for:
  - Dead-letter threshold (e.g., > 5 dead-letter runs in 1h).
  - Circuit breaker open.
  - Rate limiting / backpressure.
  - Timeout spike (avg latency > 30s).

### 13.2 Audit Trail

Every integration mutation is auditable:

- **Connector creation/update:** Logged as `IntegrationAlert` or audit event.
- **Secret rotation:** Logged in Security Core audit.
- **Mapping rule change:** Logged as audit event; old version preserved.
- **Webhook subscription add/remove:** Logged as audit event.
- **Dead-letter replay:** Logged with operator name and original run ID.
- **Circuit breaker reset:** Logged with operator and reason.

---

## 14. Schema Registry & Versioning

### 14.1 Schema Versioning

Every `Connector` and `MappingRule` carries `schemaVersion`:

```
Connector:
  schemaVersion: "1.0"
  schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      amount: { type: "integer" }
    }
  }

// Later, provider adds new fields:

Connector (updated):
  schemaVersion: "1.1"
  schema: {
    type: "object",
    properties: {
      id: { type: "string" },
      amount: { type: "integer" },
      currency: { type: "string" }  // NEW
    }
  }
```

### 14.2 Backward Compatibility

Old mapping rules remain valid for new schema versions (as long as old fields exist). New mappings can opt into new fields:

```
MappingRule (v1.0):
  schemaVersion: "1.0"
  mappings: [
    { sourcePath: "$.id", targetPath: "$.externalId" },
    { sourcePath: "$.amount", targetPath: "$.amount" }
  ]

MappingRule (v1.1, NEW):
  schemaVersion: "1.1"
  mappings: [
    { sourcePath: "$.id", targetPath: "$.externalId" },
    { sourcePath: "$.amount", targetPath: "$.amount" },
    { sourcePath: "$.currency", targetPath: "$.currency" }  // NEW
  ]
```

### 14.3 Historical Replay

When debugging a past integration run, the original schema and mapping rule are retrieved from history (immutable audit trail). Replay uses the same rule version that processed the original payload.

---

## 15. Connector Ownership & Governance

### 15.1 Framework Ownership

**Integration Core** owns:
- Connector framework (`Connector` entity, registry).
- Webhook delivery infrastructure (`WebhookDelivery`, queues, retries).
- Rate limiting, circuit breaker, idempotency mechanics.
- Credential reference model (`secretRef`, no hardcoding).
- Outbound webhook subscriptions (`WebhookDef`).

### 15.2 Domain Connector Ownership

Each connector is owned by its **target business core:**

- **Stripe connector** → Financial Core (payment processing is financial business logic).
- **Salesforce connector** → Party Core / Service Core (CRM data is customer/service data).
- **ServiceNow connector** → Case Core (ticket/incident integration).
- **Twilio connector** → Notification Core (SMS/voice is a notification channel).

Target core responsibility:
- Validate inbound data (schema, business rules).
- Define mapping rules for their domain.
- Emit or consume domain events.
- Hardening checklist (8-item list per §15 in `01_PLATFORM_CORE_ARCHITECTURE.md`).

---

## 16. Forbidden Patterns

### FP1 — Hardcoded credentials in code
Credentials must be stored in `Secret` and referenced by ID only.

### FP2 — Direct database writes from integration code
Integrations must call target core APIs or publish events; they never bypass invariants.

### FP3 — Ungoverned cross-system sync
Every external sync must:
- Go through Integration Core's idempotency and retry mechanics.
- Be auditable (logged in `IntegrationRun`).
- Emit domain events for state changes.
- Have a declared mapping rule.

### FP4 — Silent failures
No integration operation is silent. Failures are logged, alerted, and dead-lettered.

### FP5 — Cross-tenant credential leakage
Secrets are tenant-scoped. No tenant can access another's credentials via Connector or IntegrationRun queries (enforced via RLS on both tables).

### FP6 — Unmapped external data
All inbound data must be mapped to canonical fields via `MappingRule` before storage. No raw "other" JSON blobs.

---

## 17. Implementation Checklist

- [ ] Connector entity, API (create/read/update/delete/list), and RLS enforcement.
- [ ] IntegrationRun entity, immutable-append audit log, observability queries.
- [ ] MappingRule entity, Studio UI for authoring rules, tenant-scoped overrides.
- [ ] WebhookDef and WebhookDelivery entities; outbound subscription API.
- [ ] OutboundMessage entity; multi-channel logging.
- [ ] Webhook handler (`/webhooks/{connectorSlug}`): signature verification, deduplication, mapping, tenant routing.
- [ ] Polling sync framework (SyncJob in Background Processing Core).
- [ ] File-drop handler (upload, parse, validate, map, write).
- [ ] Outbound webhook dispatcher (Background Processing Core worker).
- [ ] Direct API call handler (synchronous with timeout/fallback).
- [ ] Retry logic, exponential backoff, circuit breaker (Security Core support).
- [ ] Dead-letter queue, operator UI, replay endpoint.
- [ ] Secret storage via Security Core; integration worker decryption.
- [ ] Credential rotation mechanism.
- [ ] Idempotency key validation and deduplication.
- [ ] OAuth 2.0 flow (callback endpoint, token refresh, secure storage).
- [ ] Alert mechanism (IntegrationAlert entity, Notification Core integration).
- [ ] Audit trail (immutable logs in Audit Core, timeline projections).
- [ ] Schema registry and versioning.
- [ ] Observability (metrics, traces, logs per `18_OBSERVABILITY_ARCHITECTURE.md`).
- [ ] Tenant isolation (RLS, secretRef scoping, external account mapping).
- [ ] Documentation: Connector author guide, SDK, webhook signing spec.

---

*End of 12 — Integration Architecture.*
