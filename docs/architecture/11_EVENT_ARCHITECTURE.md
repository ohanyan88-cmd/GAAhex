# 11 — Event Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`, after `10_API_ARCHITECTURE.md`. Defines domain events, the event store, event publishing, event subscription, idempotency, replay policy, and the relationship between Events, Audit records, and Notifications. All implementations, cores, and integrations must remain consistent with this document.

---

## 1. Purpose

Define the **event system** as the single source of truth for inter-core communication, audit history, and asynchronous orchestration. Every meaningful state change in the platform emits exactly one immutable event; events are owned by the core whose responsibility changed; subscribers react asynchronously; the event store is append-only; events drive audit trails, timelines, notifications, automations, and integrations.

Events are historical facts, not actions or intentions. An event describes what *already happened*, never what *might happen* or what a user *tried to do*.

---

## 2. Scope

In scope:

- Event ownership, naming, and identity.
- The event store (append-only physical truth).
- Required event fields and versioning.
- Event bus architecture (M1 in-process, M2+ broker).
- Subscriber registry and contract declarations.
- Idempotency and deduplication.
- Retry and dead-letter policies.
- Replay and time-travel rules.
- Cross-core event relationships (causation chain).
- Distinction between Event ≠ Audit ≠ Notification (PRM separation rule).

Out of scope:

- Specific domain event payloads (declared per core — see `10_API_ARCHITECTURE.md`).
- Webhook or integration delivery (see `12_INTEGRATION_ARCHITECTURE.md`).
- Audit query/compliance evidence mechanics (see Audit Core in PRM).
- Notification template rendering (see Template Core in PRM).
- Real-time WebSocket delivery (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).

---

## 3. Goals

- **G1** Every meaningful state change emits exactly one immutable event.
- **G2** Events are published via a single chokepoint (`workflow.emit(...)` in the kernel) — no silent mutations; no multi-event per state change; no cross-tenant events.
- **G3** Events are owned by the core that holds responsibility for the state (e.g., `Service.Activated` is owned by Service Core, even though Financial, Notification, and Integration may subscribe).
- **G4** Events are idempotent; subscribers track `(subscriberId, eventId)` pairs to prevent duplicate work.
- **G5** The event store is append-only at the database layer (triggers enforce immutability for all roles, including Admin).
- **G6** Events are replayable from the event store on demand.
- **G7** Event schema is versioned and additive-changes-only (backward-compatible forever).
- **G8** Causation chains are traceable: every event knows what event caused it.

---

## 4. Non-Goals

- **NG1** This document does NOT define event payload structure per domain (declared in core-specific docs and `10_API_ARCHITECTURE.md`).
- **NG2** This document does NOT mandate async event delivery (M1 is in-process, M2+ uses a broker; both allowed).
- **NG3** This document does NOT design webhook payloads or external system contracts (see Integration Core).
- **NG4** This document does NOT define Notification delivery semantics (Notification Core subscribes to events; the send mechanism is its own).

---

## 5. Architecture Principles

### P1 — Single publisher, many subscribers

An event is published exactly once by the core that owns the state change. Publishers and subscribers are decoupled; subscribers discover events via the subscriber registry (not hardcoded routing).

### P2 — Events are facts, not commands

An event name describes what *happened* (past tense): `Service.Activated`, `Invoice.Issued`, `Deal.Won`. Never: `ActivateService` (command), `ShouldActivateService` (question), `ServiceMightActivate` (uncertain).

### P3 — Kernel chokepoint: `workflow.emit(...)`

The **only** way to publish an event is via the single function `app.workflow.emit(...)` in the kernel. Every state-changing operation routes through this chokepoint. No direct Event table writes; no Event creation in business logic without routing through `emit`.

### P4 — One event per state change

A state change from `DRAFT` → `ACTIVE` emits one `Object.StatusChanged` event (or `Object.Activated` if idiomatic), not separate events for "status changed", "updated by", "updated at", etc. Multi-event-per-state-change is a sign the state change is composite and should be decomposed.

### P5 — Event ownership = core ownership

`Invoice.Paid` is owned by Financial Core (the invoice is Financial's canonical entity). `Service.ResourceAssigned` is owned by Service Core. The publisher core is always the owning core of the primary entity.

### P6 — Tenant-scoped and audit-traced

Every event carries `tenantId` and is traceable to an actor (`actorType`, `actorId`). Tenant-isolated data never appears in cross-tenant events.

### P7 — Immutable and append-only

Events are never updated, deleted, or reordered. Mistakes are corrected with a new event (e.g., `Invoice.PaymentReversed` if a charge was applied in error). The event store enforces immutability with database triggers (RAISE EXCEPTION on UPDATE or DELETE for all roles, including Admin).

### P8 — Causation chain

Every event except the first in a process knows its cause. `causationId` points to the event that triggered it; chaining backwards reconstructs the causal path.

---

## 6. Architecture Laws

### L1 — Single chokepoint

> Every event is published via `app.workflow.emit(...)` in the kernel. Direct Event table writes are forbidden.

### L2 — Immutable at DB layer

> Postgres triggers enforce RAISE EXCEPTION on any UPDATE or DELETE to the `event` table, for all roles including Admin. Deletes are permanent failures; there is no soft-delete for events.

### L3 — One event per state change

> A single, atomic state mutation to a canonical entity produces exactly one event. If multiple entities change simultaneously (a transactional bundling), each publishes its own event and they are linked by `correlationId`.

### L4 — Ownership is publisher

> The core that publishes an event is the core that owns the primary entity in the event. Cross-core publishing of "foreign" events is forbidden.

### L5 — No cross-tenant events

> An event's `tenantId` is a single tenant. Events do not span or reference multiple tenants. Cross-tenant operations (super-admin bulk work) emit separate tenant-scoped events per tenant.

### L6 — Versioning is additive-only

> Event payloads are versioned via `eventVersion`. Once released, an event schema may only *add* optional fields. Removing, renaming, or retyping fields is forbidden; instead, deprecate the old event and publish a new versioned event alongside.

### L7 — Events are replayable

> A subscriber processing events from the store must be able to replay a year of events from scratch and arrive at the same state as the live system. Replay must be idempotent (same event + same actor + same context always produces the same result).

---

## 7. Core Concepts

### 7.1 Event identity

Every event carries:

- **`id: UUIDv7`** — primary key, generated at insert, immutable. Used for idempotency and causation.
- **`eventName: string`** — `<Object>.<Action>` in PascalCase (e.g., `Customer.Created`, `Invoice.Issued`). Human-readable, business-semantic name of the event. Immutable after release.
- **`eventVersion: int`** — payload schema version (default 1). Incremented only for additive changes to payload schema (new optional fields). Allows old and new events to coexist.
- **`category: enum`** — `EventCategory` (UPPER_SNAKE): `LIFECYCLE`, `STATUS`, `ASSIGNMENT`, `OWNERSHIP`, `APPROVAL`, `FINANCIAL`, `COMMENT`, `ATTACHMENT`, `COMMUNICATION`, `TASK`, `ESCALATION`, `NOTIFICATION`, `AUTOMATION`, `INTEGRATION`, `SECURITY`, `SYSTEM`. Immutable after release.

### 7.2 Required event fields (always present)

```
id: UUIDv7
tenantId: UUIDv7
eventName: string (e.g., "Service.Activated")
eventVersion: int
category: EventCategory enum
correlationId: UUIDv7 or string (COR-YYYYMMDD-XXXXXX format permitted)
causationId: UUIDv7
actorType: ActorType enum (USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER)
actorId: UUIDv7 (nullable for SYSTEM events)
timestamp: timestamptz (UTC, millisecond precision, system-generated)
payload: JSON object (max 64 KB, never includes secrets/passwords/API keys)
objectType: ObjectType enum (from standard 03; e.g., SERVICE, INVOICE, CUSTOMER)
objectId: UUIDv7 (the primary entity that changed)
visibility: enum (PUBLIC, INTERNAL, RESTRICTED, SYSTEM)
```

### 7.3 Causation chain

- **`correlationId`** connects all events in a single business process. Generated at process start (e.g., a workflow run) and reused across all events spawned from that run. Format: `COR-YYYYMMDD-XXXXXX` is permitted; UUIDs also allowed.
- **`causationId`** identifies the single event that caused this one. For the first event in a process, `causationId == id` (the event "is caused by" itself). For subsequent events, `causationId` references the preceding event's `id`, forming a chain. Reconstructing the chain by following `causationId` backwards gives the complete causal path.

### 7.4 Actor axis

**`actorType`** (standard 06, distinct from `PrincipalType`) names the *performer*:

- **`USER`** — authenticated internal principal (employee, admin).
- **`SYSTEM`** — platform internal process (scheduled job, migration, system cleanup).
- **`AUTOMATION`** — configured automation rule triggered an action.
- **`INTEGRATION`** — external system pushed a change (Stripe webhook, third-party sync).
- **`API`** — first-party or service account API call.
- **`CUSTOMER`** — customer portal user or public API call.

**`actorId`** is the UUIDv7 of the user/account/system. May be NULL for SYSTEM events.

### 7.5 Event example

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "tenantId": "50e8400-e29b-41d4-a716-446655440001",
  "eventName": "Service.Activated",
  "eventVersion": 1,
  "category": "LIFECYCLE",
  "correlationId": "550e8400-e29b-41d4-a716-446655440002",
  "causationId": "550e8400-e29b-41d4-a716-446655440003",
  "actorType": "USER",
  "actorId": "550e8400-e29b-41d4-a716-446655440004",
  "timestamp": "2026-06-06T14:30:45.123Z",
  "payload": {
    "serviceId": "svc-123",
    "customerId": "cus-456",
    "activatedReason": "manual_approval",
    "previousStatus": "PENDING",
    "newStatus": "ACTIVE"
  },
  "objectType": "SERVICE",
  "objectId": "550e8400-e29b-41d4-a716-446655440000",
  "visibility": "INTERNAL"
}
```

---

## 8. Event Store

### 8.1 Physical storage

The **event store** is a single append-only table (`event`) in Postgres:

```sql
CREATE TABLE event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_name varchar(255) NOT NULL,
  event_version int NOT NULL DEFAULT 1,
  category varchar(50) NOT NULL,
  correlation_id varchar(255),
  causation_id uuid,
  actor_type varchar(50) NOT NULL,
  actor_id uuid,
  timestamp timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  object_type varchar(50) NOT NULL,
  object_id uuid NOT NULL,
  visibility varchar(50) NOT NULL DEFAULT 'INTERNAL',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_tenant_timestamp ON event(tenant_id, timestamp);
CREATE INDEX idx_event_object_id ON event(object_id);
CREATE INDEX idx_event_correlation_id ON event(correlation_id);
CREATE UNIQUE INDEX idx_event_id ON event(id);

-- Immutability enforcement: prevent updates and deletes for ALL roles.
CREATE FUNCTION prevent_event_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Events are immutable; cannot UPDATE or DELETE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_immutable_insert
AFTER INSERT ON event
FOR EACH ROW
EXECUTE FUNCTION log_insert_audit();  -- audit log only

CREATE TRIGGER event_immutable_prevent_update
BEFORE UPDATE ON event
FOR EACH ROW
EXECUTE FUNCTION prevent_event_mutation();

CREATE TRIGGER event_immutable_prevent_delete
BEFORE DELETE ON event
FOR EACH ROW
EXECUTE FUNCTION prevent_event_mutation();
```

### 8.2 Guarantees

- **Append-only** — only INSERT; no UPDATE, DELETE, TRUNCATE allowed.
- **Immutable at all privilege levels** — triggers fire for all roles, including superuser/Admin, preventing any mutation.
- **Time-ordered** — `timestamp` is the primary ordering field; tie-break by `id` (UUIDv7 is sortable).
- **Tenant-isolated** — every row carries `tenant_id`; queries always filter by tenant.
- **Permanent** — archived events remain in the table with metadata; logical deletion never occurs.

---

## 9. Event Publishing

### 9.1 The single chokepoint: `workflow.emit(...)`

Located in `app.kernel.workflow_engine` or `app.workflow` (unified by M2):

```python
async def emit(
    session: AsyncSession,
    tenant_id: UUID,
    type_: str,  # event type (legacy field; maps to event_name)
    object_type: str,  # "service", "invoice", etc.
    object_id: UUID,
    actor_id: UUID | None,  # None for SYSTEM events
    payload: dict,
    *,
    event_name: str,           # "Service.Activated"
    category: str,             # "LIFECYCLE", "STATUS", etc.
    correlation_id: UUID | str | None = None,
    causation_id: UUID | None = None,
) -> Event:
    """Publish one immutable event.
    
    This is the ONLY way to create an Event row. All state-changing code
    routes through this function; there is no direct Event table write path.
    """
    # Generates UUIDv7 if not provided; returns the newly inserted Event row.
    pass
```

### 9.2 Naming convention for `eventName`

- **Format**: `<Object>.<Action>` in PascalCase.
- **Object**: singular, canonical entity name (e.g., `Service`, `Invoice`, `Customer`).
- **Action**: past tense, idiomatic (e.g., `Created`, `Activated`, `Paid`, `Resolved`).
- **Examples**: `Service.Activated`, `Invoice.Issued`, `Deal.Won`, `Ticket.Resolved`, `Payment.Received`, `Contract.Renewed`.

Never: `ActivateService` (command), `ServiceActivation` (noun), `SERVICE_ACTIVATED` (enum style).

### 9.3 When to emit

**Emit an event when**:

- An entity is created (first time).
- Status or lifecycle state changes.
- Ownership, assignment, or department changes.
- An approval is requested, granted, or denied.
- A financial transaction completes (invoice issued, payment received, credit applied).
- A comment, note, or attachment is added.
- An automation rule executes.
- An integration syncs or pushes data.
- A security-sensitive action occurs (role granted, secret rotated, permission changed).

**Never emit**:

- UI clicks or temporary UI state.
- Planned future actions or scheduled-for-later mutations.
- Intermediate states in a multi-step operation (emit once at the end).
- Repeated fetches or reads (only state changes).

---

## 10. Subscriber Registry

### 10.1 Declarative subscription

Every subscriber declares what it listens to. The registry is a configuration file or database table:

```yaml
subscribers:
  - id: "notification-service"
    name: "Notification Core"
    subscribes_to:
      - event_name: "Service.Activated"
        handler: "notify_customer_activation"
      - event_name: "Invoice.Issued"
        handler: "send_invoice_email"
  - id: "automation-engine"
    name: "Automation Core"
    subscribes_to:
      - event_name: "Ticket.Created"
        handler: "trigger_automation_rules"
  - id: "timeline-projector"
    name: "Timeline Core (read-only projection)"
    subscribes_to:
      - pattern: ".*"  # All events
        handler: "project_to_timeline"
  - id: "analytics-warehouse"
    name: "Analytics Core"
    subscribes_to:
      - pattern: ".*"  # All events
        handler: "emit_to_warehouse"
```

### 10.2 No hidden subscriptions

Every subscription is declared in the registry. Searching the codebase for event handlers should find the registry and confirm the relationship is documented.

### 10.3 Handler contract

A subscriber handler:

- **Receives**: the Event row from the store.
- **Returns**: nothing (or optional acknowledgment status).
- **Idempotent**: processing the same event twice with the same actor and context produces the same side effect. (Idempotency is enforced via `(subscriberId, eventId)` tracking in the subscriber state; see §11.)
- **Never fails silently**: unhandled exceptions are logged and re-raised (dead-letter handling is orthogonal; see §12).

---

## 11. Idempotency

### 11.1 Subscriber tracking

Every subscriber tracks `(subscriberId, eventId)` pairs in a table:

```sql
CREATE TABLE event_subscriber_state (
  subscriber_id varchar(255) NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL,
  PRIMARY KEY (subscriber_id, event_id)
);
```

### 11.2 Idempotent processing

When a subscriber receives an event:

1. Check if `(subscriberId, eventId)` exists in `event_subscriber_state`.
2. If yes, skip processing (already handled).
3. If no, process the event and INSERT the `(subscriberId, eventId)` row.
4. If processing fails before the INSERT, the next replay will retry.

### 11.3 Replay safety

Because subscribers are idempotent, replaying events is safe:

- A subscriber can be reset to a past state by deleting its rows from `event_subscriber_state`.
- Replaying from that point forward will re-process all subsequent events.
- The same event never produces duplicate side effects (e.g., duplicate notifications, duplicate automation executions).

---

## 12. Retry and Dead-Letter Handling

### 12.1 Retry policy (M1 in-process)

In M1, the event bus is in-process. A subscriber failure is immediate and synchronous:

- **Immediate retry**: on exception, retry up to 3 times with exponential backoff (1s, 2s, 4s).
- **Timeout**: if a handler takes >30s, log and skip (consider it failed).
- **Dead-letter**: after 3 retries or timeout, log to dead-letter queue (a `dead_letter_event` table or file) and continue.

### 12.2 Dead-letter queue (M1+)

```sql
CREATE TABLE dead_letter_event (
  id uuid PRIMARY KEY,
  subscriber_id varchar(255) NOT NULL,
  event_id uuid NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now(),
  error_message text,
  retry_count int DEFAULT 0,
  last_retry_at timestamptz
);
```

Failed events land here so operators can inspect, fix the subscriber bug, and manually re-process.

### 12.3 M2+ broker retry policy

When an external broker (Kafka, NATS) is in use:

- **Acknowledgment-based**: subscriber must acknowledge receipt within a timeout (e.g., 30s). No ack = requeue.
- **Requeue with backoff**: failed events are requeued up to 5 times with exponential backoff.
- **Dead-letter topic**: after 5 requeue attempts, the event lands in a dead-letter topic for operator inspection.

---

## 13. Replay Policy

### 13.1 Time-travel semantics

A subscriber can be reset and replayed from any point in time:

```sql
-- Reset notification service to a past point.
DELETE FROM event_subscriber_state
WHERE subscriber_id = 'notification-service'
AND processed_at > '2026-06-01 12:00:00Z';

-- On next boot, the subscriber will re-process all events after 2026-06-01 12:00:00Z.
```

### 13.2 Immutability requirement for replay

Because events are immutable and append-only, replay always sees the same sequence:

- Event order is fixed (by `timestamp`, then `id`).
- Event content never changes.
- Causation chains are stable.

### 13.3 Replay performance

For large-scale replays (e.g., resetting Analytics to recompute a year of KPIs):

- Batch-fetch events in time-ordered chunks (e.g., 1000 events per query).
- Process subscribers in parallel (different subscribers do not share state).
- Track high-water mark in subscriber state so restarts resume, not restart from the beginning.

---

## 14. Cross-Core Event Relationships

### 14.1 Event ownership

`Service.Activated` is published by Service Core. If Financial, Notification, and Integration subscribe to it, they are *subscribers*, not *publishers*. Service Core owns the event.

### 14.2 Cross-core causation

A workflow that triggers multiple cores emits one `correlationId` and a causation chain:

```
User clicks "Activate Service"
  ↓
Service Core emits `Service.Activated` (correlation_id=COR-123, causation_id=COR-123)
  ↓
Notification Core listens, emits `Notification.Sent` (correlation_id=COR-123, causation_id=<Service.Activated id>)
  ↓
Timeline projector listens, adds entries (correlation_id=COR-123 for traceability)
```

All events in the chain share `correlationId=COR-123`, forming a traceable process. `causationId` forms the direct parent-child link.

### 14.3 Forbidden patterns

- **Cross-tenant events**: an event never spans multiple tenants.
- **Inverted ownership**: Financial Core does NOT publish `Service.Activated` events; Service Core does.
- **Multi-publish**: a single state change does not emit from multiple cores. One core publishes; others subscribe.
- **Implicit subscriptions**: a core does NOT listen to another core's events via direct database queries. All cross-core communication is explicit event-based.

---

## 15. Event ≠ Audit ≠ Notification (PRM Separation)

### 15.1 Event

A **fact that happened**: immutable, append-only, owned by the changing core. Example: `Invoice.Paid` (the invoice is now paid). Payload includes business details (amount, method, reference).

Purposes:
- Audit trail source.
- Timeline entries.
- Automation triggers.
- Integration webhooks.
- Analytics input.
- Replay/time-travel.

### 15.2 Audit

A **compliance-relevant slice** of events. Derived from the event store, not independent. Audit entries reference the event `id` and include actor, context (IP, source), before/after snapshots, and timestamps.

Purposes:
- Compliance evidence.
- User-activity reports.
- Regulatory proofs.
- Security investigation.

**Implementation**: The Audit Core reads events and projects them into audit records (or embeds audit context in the Event row itself). Audit is never the *source*; events are.

### 15.3 Notification

A **delivery artifact**. When an event occurs, Notification Core may react by sending email, SMS, or in-app notification. The Notification record stores who was notified, when, and delivery status.

Purposes:
- User communication.
- Alert delivery.
- Subscription preferences.

**Implementation**: Notification Core subscribes to events and emits `Notification.Sent` events for audit. The notification itself is a by-product, not the source.

### 15.4 Separation enforced

- **Events are mandatory** for every state change.
- **Audit is a projection** over events (derived, never primary).
- **Notifications are optional** — a system can emit events and audit without notifying (e.g., internal-only changes).
- **No silent mutations** — if there's no event, the mutation doesn't happen.

---

## 16. Event Schema Versioning

### 16.1 Versioning scheme

Every event carries `eventVersion` (int, default 1). The version increments when the payload schema changes.

### 16.2 Additive-only rule

Once released, an event schema **may only ADD new optional fields**. Removing, renaming, or retyping fields is **forbidden**. Example:

```json
// Version 1 (released)
{ "invoiceId": "...", "amount": 100.50 }

// Version 2 (allowed) — added optional field
{ "invoiceId": "...", "amount": 100.50, "currency": "USD" }

// Version 3 (FORBIDDEN) — removed "invoiceId"
// Would break subscribers expecting it.

// Version 3 (correct alternative) — deprecate old event, publish new event
// Deprecate: Invoice.Paid v1 → v2 adds currency
// New event: Invoice.PaidWithCurrency (new event name, carries both old and new fields)
```

### 16.3 Subscriber compatibility

A subscriber processing `eventVersion=1` and `eventVersion=2` of `Invoice.Paid` must handle both:

- Fetch the `eventVersion` from the event.
- Route to a handler that understands both versions.
- New optional fields default to NULL or sensible defaults if missing.

### 16.4 Deprecation path

If a payload schema must break (impossible under additive-only):

1. Introduce a new event name (e.g., `Invoice.PaidWithCurrency` instead of changing `Invoice.Paid` v3).
2. Have the publisher emit both `Invoice.Paid` (v2, old subscribers) and `Invoice.PaidWithCurrency` (v1, new subscribers) for a transition period.
3. Migrate subscribers to the new event.
4. Stop emitting the old event.
5. Archive old events (retain for replay, but no longer published).

---

## 17. Implementation Requirements

### 17.1 Event emission from `workflow.emit(...)`

Every module that performs a state-changing operation must route through the single `emit` function:

```python
# ❌ Wrong: direct Event creation
event = Event(
    type_="service.activated",
    object_id=service.id,
    ...
)
db.add(event)

# ✅ Correct: route through the kernel chokepoint
await emit(
    session,
    tenant_id=service.tenant_id,
    type_="service.activated",
    object_type="service",
    object_id=service.id,
    actor_id=user_id,
    payload={"status_before": "PENDING", "status_after": "ACTIVE"},
    event_name="Service.Activated",
    category="LIFECYCLE",
    correlation_id=workflow_run_id,
    causation_id=previous_event_id,
)
```

### 17.2 Declaring events in architecture docs

Each core declares its events in this document (or a core-specific section) with:

- Event name (e.g., `Service.Activated`).
- Category (e.g., `LIFECYCLE`).
- Payload schema (JSON schema or TypeScript interface).
- `eventVersion` (start at 1).
- Subscribers (by name, from the registry).
- When it's emitted (what state change triggers it).

Example:

| Event Name | Category | Owner Core | Payload Schema | Subscribers | v |
|---|---|---|---|---|---|
| Service.Activated | LIFECYCLE | Service | `{status_before: enum, status_after: enum, activatedBy: uuid}` | Notification, Timeline, Analytics | 1 |
| Invoice.Issued | FINANCIAL | Financial | `{invoiceId: uuid, customerId: uuid, amount: decimal, currency: string}` | Notification, Timeline, Accounting | 1 |

### 17.3 Subscriber handler registration

Subscribers register in `docs/architecture/EVENT_SUBSCRIBER_REGISTRY.md` (separate file, updated per core hardening). At boot, the platform loads the registry and confirms all handlers are present.

```yaml
subscribers:
  - id: "notification-core"
    handlers:
      Service.Activated: "app.routers.notifications:handle_service_activated"
      Invoice.Issued: "app.routers.notifications:handle_invoice_issued"
  - id: "timeline-projector"
    handlers:
      ".*": "app.projections.timeline:project_event"
```

### 17.4 Drift check

`tools/check_drift.py` adds a rule: every event emitted must be registered in the subscriber registry (or explicitly marked as "no subscribers"). Unknown events fail the check.

### 17.5 Testing events

- **Unit tests**: mock `emit()` and verify the correct call is made with the right payload.
- **Integration tests**: trigger a state change, query the event store, confirm the event is present and subscribers were notified.
- **Replay tests**: delete subscriber state, replay events, verify idempotency (same state reached).

---

## Summary

The event system is GAAhex's audit trail, integration hub, and asynchronous backbone. Every meaningful state change produces exactly one immutable event via the single chokepoint `workflow.emit(...)`. Events are owned by their publishing core, subscribed to by other cores, and stored append-only in Postgres. Subscribers are idempotent and replayable. Events are distinguished from Audit (a compliance projection) and Notification (a delivery artifact). The architecture enforces that no mutation happens silently—every change is a recorded fact, forever discoverable, always replayable.

---

*End of 11 — Event Architecture.*
