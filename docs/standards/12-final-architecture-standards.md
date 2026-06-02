# 12 — Final Architecture Standards

Covers: Workflow Engine, Relationship/Entity Link, Deletion/Archive/Restore, SLA, Customer
Communication, API, RBAC/Permission Model, Background Job, Data Retention, Webhook.
B1 (enum values UPPER_SNAKE), B3/D5 (ActorType), D2 (camelCase fields), D10 (canonical channel),
D11 (escalation = move), D14 (deletion state separate from lifecycle status), S5 (UUIDv7 id +
prefixes) applied throughout. Field identifiers are camelCase; enum values UPPER_SNAKE; event
names PascalCase.

---

## Workflow Engine Standard — LOCKED
A workflow is a governed state machine — not scattered UI logic. Every meaningful transition is a
business event with an audit record. Object `id` UUIDv7; reference prefix `WFL`.
Definition fields (camelCase): `id, referenceNumber (WFL-…), workflowKey, workflowName,
objectType, tenantId, version, status, stages, transitions, gates, entryConditions,
exitConditions, allowedActors, requiredPermissions, slaRules, automationHooks, approvalHooks,
createdAt, createdBy, updatedAt, updatedBy`.
Status enum: `DRAFT, ACTIVE, DEPRECATED, RETIRED`. Stages use canonical values; labels localized;
logic never depends on translated labels. Each transition defines from/to stage, allowed actor
type, required permission, validation, emitted event, audit record, optional approval/SLA/
automation. Invalid transitions rejected server-side. Gate types: `COMMERCIAL_GATE, TECHNICAL_GATE,
SERVICE_GATE, OPERATIONAL_GATE, APPROVAL_GATE, COMPLIANCE_GATE, MANUAL_REVIEW_GATE` — never
bypassed by UI/API/automation/import/integration/job. Transitions emit standardized events
(`Lead.Validated`, `Order.Created`, `Service.Activated`) with `correlationId` + `causationId`.
Definitions versioned; existing records keep their version unless explicitly migrated; changing a
definition never silently alters history. Permissions enforced server-side.

## Relationship / Entity Link Standard — LOCKED
Relationships use IDs internally; reference numbers for display; names never relationship keys.
Object `id` UUIDv7; reference prefix `REL`.
Fields (camelCase): `id, referenceNumber (REL-…), sourceEntityType, sourceEntityId,
targetEntityType, targetEntityId, relationshipType, direction, tenantId, status, createdAt,
createdBy, updatedAt, updatedBy`. Optional: `description, metadata, validFrom, validUntil,
sourceReferenceNumber, targetReferenceNumber`. `sourceEntityType`/`targetEntityType` use the
canonical `ObjectType` enum (file 03).
Type enum: `RELATED_TO, PARENT_OF, CHILD_OF, DEPENDS_ON, BLOCKED_BY, DUPLICATES, DUPLICATED_BY,
OWNS, USED_BY, ASSOCIATED_WITH, REPLACES, REPLACED_BY, CONNECTED_TO, BILLED_TO, SERVES,
LOCATED_AT, ASSIGNED_TO`. Direction enum: `DIRECTED, BIDIRECTIONAL`. No cross-tenant relationships
except explicit, permissioned, audited Super Admin design. A user sees a relationship only if they
can view both sides; never leak unauthorized object existence. Create/update/remove/restore create
audit events; important changes appear in timeline. No duplicate active relationship for the same
relationship/type/direction.

## Deletion / Archive / Restore Standard — LOCKED
Archive/soft delete is the default; hard delete is exceptional. Normal users never permanently
destroy business history.
**D14 — `deletionState` is a separate field and enum from an object's lifecycle `status`. The two
are never merged; both may legitimately hold the value `ACTIVE` (different enum types). Confirm
against the Global Status Standard when supplied.**
`deletionState` enum: `ACTIVE, ARCHIVED, SOFT_DELETED, PENDING_PURGE, PURGED`.
Normal removal archives or soft-deletes; hard delete/purge only via explicit Super Admin/system
retention cleanup obeying retention + legal-hold rules. Fields (use applicable only, camelCase):
`archivedAt, archivedBy, archiveReason, deletedAt, deletedBy, deleteReason, restoredAt,
restoredBy, restoreReason, purgeScheduledAt, purgedAt, purgedBy`. Restore validates
permissions/tenant, restores safe relationships, creates audit + system events, appears in
timeline. Legal hold / investigation / audit / compliance / open dispute / retention lock blocks
purge. Archive/delete defines behavior for child records, attachments, comments, timeline, audit,
notifications, tasks, relationships; audit/events remain permanent unless retention law requires
otherwise. Events: `Object.Archived, Object.Restored, Object.SoftDeleted, Object.PurgeScheduled,
Object.Purged, Object.PurgeBlocked`.

## SLA Standard — LOCKED
SLA measures accountable time against commitments and **is never affected by watchers** (awareness
only; never counted in SLA, workload, ownership, or performance). Object `id` UUIDv7; reference
prefix `SLA`.
Scope (default): tickets, tasks, installations, incidents, outages, approvals, service-delivery
stages, escalations (extensible by config). Fields (camelCase): `id, referenceNumber (SLA-…),
slaPolicyId, objectType, objectId, tenantId, status, startedAt, dueAt, pausedAt, resumedAt,
breachedAt, completedAt, ownerDepartment, primaryAssignee, priority, calendarId, timezone,
correlationId`. Status enum: `NOT_APPLICABLE, ON_TRACK, AT_RISK, PAUSED, BREACHED, COMPLETED,
CANCELLED`. Pause only on approved reasons: `WAITING_CUSTOMER, WAITING_EXTERNAL_PARTY,
WAITING_APPROVAL, WAITING_PARTS, SCHEDULED_APPOINTMENT, DEPENDENCY_BLOCKED` (pause/resume create
events + audit). Breach creates `SLA.Breached` event + audit + timeline + configured notification/
escalation. Escalation follows the Escalation Standard (not hardcoded in SLA). Supports business
calendars (business hours, holidays, weekends, timezone, 24x7). Reports use official SLA
definitions only. `ownerDepartment` is exactly one accountable department (B5).

## Customer Communication Standard — LOCKED
Communication channel = how we talk; lead source = how the lead came in. Never confused. Object
`id` UUIDv7; reference prefix `COM`.
**D10 — Canonical `CommunicationChannel` enum (single source of truth):** `WHATSAPP, MESSENGER,
SMS, EMAIL, CALLS, INTERNAL_CHAT, PORTAL_MESSAGE, SYSTEM_MESSAGE`. The Communications page (file
11) may display a subset of these but must not define a different enum.
Fields (camelCase): `id, referenceNumber (COM-…), channel, direction, tenantId, relatedEntityType,
relatedEntityId, participantType, participantId, subject, messageBody|contentReference, status,
createdAt, createdBy, sentAt, receivedAt, correlationId, eventId`. `relatedEntityType` uses the
canonical `ObjectType` enum; `participantType` uses the canonical `ParticipantType` enum =
`EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER` (file 03, E5). Direction enum: `INBOUND, OUTBOUND, INTERNAL, SYSTEM`. Status enum: `DRAFT, QUEUED,
SENT, DELIVERED, READ, FAILED, RECEIVED, ARCHIVED`. Links to lead/customer/order/ticket/task/
invoice/service/incident/approval via the Relationship Standard. Respects tenantId, participant
permissions, object visibility, internal/external visibility, field/channel restrictions; internal
chat never leaks to customer-facing portal. Events: `Communication.Created, .Sent, .Received,
.Failed, .Linked, .Archived`. Outbound standardized messages use localized templates storing keys.

## API Standard — LOCKED
API-first; business logic never UI-only. APIs enforce the same validation, permissions, tenant
isolation, audit, events, and workflow rules as UI. Style: REST-first, versioned, JSON,
event/webhook compatible; path `/api/v1/{resource}`. Versioned; breaking changes need a new
version; contracts never silently broken. Auth: session (first-party UI), API keys, OAuth, service
accounts where approved; secrets stored securely, never logged. Every request enforces tenantId,
permissions, role, object visibility, field restrictions, feature flags, workflow rules,
validation. Errors structured: `errorCode, message, field, correlationId, details` (no sensitive
internals, no stack traces). List APIs use standardized pagination; large lists server-side.
Mutating retryable APIs support `idempotencyKey` (no duplicate effects). Business-changing calls
create events + audit; **API caller `actorType = API` (canonical enum, B3)**.

## RBAC / Permission Model Standard — LOCKED
Roles group permissions; permissions authorize actions; access also considers tenant, department,
ownership, assignment, visibility, object state, feature flags, field restrictions, region/RLS.
Role name alone is never enough. Concepts: User, Role, Permission, PermissionGroup, tenantId,
Department, Team, Region, object visibility, field-level permissions, feature flag availability,
System/Super Admin scope, audit for permission changes. **Permission key format `object.action`
— lowercase, dot-separated, object first (D2)** (`ticket.view`, `report.export`,
`configuration.manage`); canonical, never localized; multi-word actions use snake_case
(`view_internal`); the full set
is held in the central Permission Registry (`permission-registry.md`). Every access decision
evaluates: identity, tenant, role permissions, explicit permissions, ownership, assignment,
department, team/region, visibility, feature flag, field restrictions, record status, workflow
state. **Watching grants no access; watchers never counted in workload/KPI/SLA/performance.**
Super Admin manages configuration but is always audited. Field-level masking applies to UI, API,
export, reports, search, AI views. Permission/role/group/membership changes create audit/security
events.
**D5/D12 — Principal axes:** `ActorType` (performer of an action) is distinct from `PrincipalType`
(`EMPLOYEE, ROLE, DEPARTMENT, TEAM, QUEUE` — the principal that owns/is assigned/watches/receives).
See file 03 for both enums and the per-context allowed subsets.

## Background Job Standard — LOCKED
Long-running/external work never blocks business transactions; background work is explicit,
tracked, recoverable. Object `id` UUIDv7; reference prefix `JOB` for business-visible jobs;
internal delivery/attempt records may be UUID-only (stated explicitly). Scope: imports, exports,
report generation, notification/webhook delivery, integration sync, automation execution, file
scanning, preview generation, scheduled SLA checks, retention cleanup, search indexing, email/SMS
sending. Fields (camelCase): `id, referenceNumber (JOB-… where business-visible), jobType,
queueName, tenantId, status, priority, createdAt, createdBy, startedAt, finishedAt, retryCount,
maxRetries, idempotencyKey, correlationId, causationId, payloadReference, errorCode, errorMessage`.
Status enum: `PENDING, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELLED, DEAD_LETTERED`. Run through
approved queues/workers; no long external work in business transactions. Controlled retries
preserve correlationId/causationId/idempotencyKey/triggering reference; no duplicate effects.
Exhausted retries → dead-letter (preserve failure reason + history). Tenant-scoped jobs enforce
tenantId. Jobs run under explicit system/user/automation context; privileged jobs auditable.

## Data Retention Standard — LOCKED
Audit, events, and operational history are permanent by default unless an approved rule says
otherwise; temporary generated files expire; legal hold overrides deletion. Category enum:
`PERMANENT, TENANT_CONFIGURED, FIXED_PERIOD, TEMPORARY, LEGAL_HOLD, COMPLIANCE_HOLD,
PURGE_ELIGIBLE`. Permanent default: audit records, event records, timelines, approval decisions,
security events, important workflow transitions, task completion history, material relationship
history. Temporary: export files, generated reports, temp uploads, failed import staging, preview
cache, transient job payloads — must expire. Attachments follow owner-object retention unless
category requires stricter; sensitive/legal/financial may be stricter and legal-hold protected.
Legal hold blocks deletion/purge/modification/cleanup and is auditable. Purge only when retention
expired, no hold, permitted, audited, purge event created, dependencies handled. Export files
expire per configured retention; never permanently public.

## Webhook Standard — LOCKED
Webhooks deliver events; they do not define business truth (the Event System is the source of
truth). Object `id` UUIDv7; reference prefix `WHK`. Subscription fields (camelCase): `id,
referenceNumber (WHK-…), tenantId, name, targetUrl, subscribedEvents, status, secretReference,
createdAt, createdBy, updatedAt, updatedBy`. Delivery fields: `id (UUID, internal), webhookId,
eventId, eventName, correlationId, causationId, idempotencyKey, attemptNumber, status,
requestedAt, deliveredAt, responseCode, errorMessage`. Subscription status enum: `ACTIVE,
INACTIVE, SUSPENDED, FAILED, DEPRECATED`. Delivery status enum: `PENDING, SENT, DELIVERED, FAILED,
RETRYING, DEAD_LETTERED`. Signed; secrets in approved storage, never in logs/events/payloads/UI/
exports/reports. Payload includes `eventId, eventName, occurredAt, schemaVersion, correlationId,
causationId, objectType, objectId, payload` and no unauthorized/sensitive data. Tenant +
subscription scoped (no cross-tenant events). Async delivery, controlled retries preserving
idempotency, exhausted → dead-letter. Webhook event names match the Event System; translated
labels are never event contract values. **Webhooks deliver events, not notifications; this is
distinct from any notification channel (D9, file 05).**

## Locked Decision
The final architecture is event-driven, versioned, permission/tenant-safe, idempotency-aware,
retention-governed, and watcher-neutral for SLA/KPI/workload. Standards creation is complete;
proceed to implementation review.
