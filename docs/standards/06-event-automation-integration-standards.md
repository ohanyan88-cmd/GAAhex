# 06 — Event System, Automation & Integration Standards

B2: Event primary `id` is UUIDv7; `EVT-000001` is its reference number. B3/D5: `actorType` uses
the canonical enum (performer axis). D1: `tenantId` added to event required fields. D2: field
identifiers camelCase. M1: CorrelationID/CausationID are internal trace keys.

---

## Event System Standard — LOCKED

The Event System is the backbone of the platform: audit history, activity timelines,
notifications, automations, integrations, SLA tracking, reporting, AI agents, troubleshooting,
future workflow intelligence. Every meaningful business action produces a standardized event.

An event is a completed fact that already happened — not a UI click, planned action, or
temporary state. Events are permanent historical facts.

Core rule: the object stores the latest state; the event stream stores the full history.

**D1 — single physical store.** The event store is the one append-only physical source of truth.
**Audit and Activity Timeline are governed projections over it, not separate tables** — Audit =
the compliance-relevant slice (with audit fields + before/after); Timeline = the user-facing
chronological view. Immutability is enforced at the store (append-only; deletes rejected for all
roles, including Admin).

### Mandatory event creation
Every important business action creates an event: object created/updated, status changed,
assignment/owner/department changed, approval requested/approved/rejected, comment added,
attachment added, task created/completed, escalation created, notification generated,
automation executed, integration synced, payment received, invoice generated, security-
sensitive action. No silent business changes.

### Categories (canonical `EventCategory` — UPPER_SNAKE, E21)
`LIFECYCLE, STATUS, ASSIGNMENT, OWNERSHIP, APPROVAL, FINANCIAL, COMMENT, ATTACHMENT,
COMMUNICATION, TASK, ESCALATION, NOTIFICATION, AUTOMATION, INTEGRATION, SECURITY, SYSTEM`.
New categories require platform approval. **E14 — the Activity Timeline uses this same
`EventCategory` enum (timeline is a projection); there is no separate timeline-category enum.**

### Naming
Event names: `<Object>.<Action>` — object singular, action past tense, PascalCase, immutable
after release, describing a business fact (`Customer.Created`, `Invoice.Generated`,
`Ticket.Resolved`). Event names are PascalCase by the Event Naming rule; they are **not** enum
values and are exempt from the UPPER_SNAKE rule. UI actions like `ClickedSaveButton` are wrong.

### Required fields (camelCase — D2)
`id, tenantId, eventName, category, schemaVersion, occurredAt, objectType, objectId, actorType,
actorId, department, visibility, correlationId, causationId, payload`.
- **`eventName` (E13) holds the `<Object>.<Action>` event name** (e.g. `Customer.Created`); this
  is distinct from Audit's coarse `eventType` enum. `category` is the `EventCategory` enum.
- **`tenantId` is mandatory for tenant-owned events (D1, Multi-Tenant Standard).**
- `objectType` is the canonical `ObjectType` enum (file 03).

### Identity (B2)
- **`id` = UUIDv7** — system-generated primary identifier (immutable, never reused).
- **`referenceNumber` = `EVT-000001`** — human reference, prefix `EVT` registered. Never used
  as the primary id.

### Actor (B3 / D5)
`actorType` = canonical `ActorType` enum `USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER`
— the *performer* axis. Definitions: USER = authenticated internal principal performing the
action; SYSTEM = internal platform process; AUTOMATION = configured workflow rule; INTEGRATION =
external connected system; API = first-party/service API caller; CUSTOMER = customer portal user.
`ActorType` (who performed) is distinct from `PrincipalType` (who is referenced/owns/assigned —
file 03).

### CorrelationID / CausationID (M1)
Internal trace keys, exempt from the Reference Number Standard.
- `correlationId`: connects all events in one business process; format `COR-YYYYMMDD-XXXXXX`
  permitted; generated at process start; reused across related events; never edited.
- `causationId`: identifies the event that caused this one; if first in a process, equals this
  event's `id` (UUIDv7); otherwise references the triggering event's `id`; never references UI actions.

### Timestamp & ordering
`occurredAt`: UTC, millisecond precision, system-generated, never editable, main ordering field.
Tie-break by `occurredAt + id`. Never order by DB insertion or UI display order.

### Payload
Structured JSON only. No HTML, rich text, blobs, screenshots, files, secrets, passwords, or
API keys. Max 64 KB. Large files stored as attachments and referenced by attachmentId.

### Immutability & corrections
Events cannot be edited, deleted, replaced, overwritten, or reordered. Mistakes are fixed with
a correction event (`Invoice.PaymentReversed`), never by modifying the original.

### Visibility
`PUBLIC, INTERNAL, RESTRICTED, SYSTEM`.

### Integration rules
- Timelines are generated from events (entries are projections, not independent records — B4).
- Audit entries reference the event `id` where possible.
- Notifications are created from events, never directly from UI clicks; the notification stores
  the triggering `eventId` (D16, file 05).
- Automations trigger from events only.
- External systems consume events; integrations must not depend on internal DB tables.
- Idempotency: integration- and automation-generated events require `idempotencyKey`; duplicate
  keys must not create duplicate business effects.
- `schemaVersion` mandatory on every event; old events remain readable forever.

### Retention & security
Events never deleted (permanent). Archiving allowed; archived events stay searchable. Events
never expose passwords, keys, tokens, credentials, raw card data, or unmasked sensitive IDs.

### Locked Decision
The platform is an immutable, event-driven system. Events are the source of truth for history,
timelines, automations, notifications, integrations, audit, analytics, and future AI agents.

---

## Automation Standard — LOCKED (written: file 18)
→ See **18-automation-standard.md** (code-accurate). Was SOURCE NOT PROVIDED; now resolved.

Referenced as locked by Event System, Workflow Engine, Notification, Reporting, Localization,
Multi-Tenant, Background Job. **Source text was not provided to this patch.** No rules are
invented. Imposed constraints already binding it: event-only triggering (no UI-click triggers);
`actorType = AUTOMATION` (canonical enum); enum values `UPPER_SNAKE_CASE`; field names camelCase;
`tenantId`-scoped execution; audit/event on every run; `idempotencyKey` required.

---

## Integration Standard — LOCKED (written: file 19)
→ See **19-integration-standard.md** (code-accurate). Was SOURCE NOT PROVIDED; now resolved.

Referenced as locked by Event System, API, Webhook, Background Job, Multi-Tenant, Import/Export.
**Source text was not provided to this patch.** No rules are invented. Imposed constraints:
event-driven contract (consume/emit events, never depend on internal DB tables);
`actorType = INTEGRATION` (canonical enum); tenant mapping enforced; `idempotencyKey` required;
canonical values only (no translated labels).
