# 08 — Reporting, Import/Export, Multi-Tenant, Localization, Configuration & Feature Flag Standards

B1: enum values `UPPER_SNAKE_CASE`. S5: Import/Export/Config/Feature Flag carry UUIDv7 `id` +
registered reference prefixes. D1/D2: `tenantId` field, camelCase field identifiers.

---

## Reporting & Analytics Standard — LOCKED

Reports are governed views over system data — not separate sources of truth. They must be
accurate, permission-safe, tenant-safe, traceable, canonical-value based, and use official
KPI definitions.

- **Source rule:** only approved sources — business objects, standardized events, audit
  records, timeline views, approved aggregates/read models/reporting tables. Never raw
  ungoverned reads, frontend caches, manual spreadsheets, translated labels as canonical,
  deprecated fields, or tenant-specific meanings.
- **Permission rule:** enforce tenantId, role permissions, explicit report permission, object
  visibility, department access, ownership/assignment, restricted/system rules, field-level
  restrictions. A user must not see report records they cannot access normally.
- **Aggregate leakage rule:** counts must not include records the user cannot see; never
  reveal hidden counts unless authorized.
- **KPI rule:** every KPI has one official definition (name, object source, event source,
  included/excluded statuses, date basis, formula, permission behavior, tenant behavior,
  refresh behavior). No report redefines KPI logic locally.
- **Canonical value rule:** report on canonical values (`ACTIVE`), never translated labels.
- **Date/time rule:** define which timestamp is used (`createdAt, updatedAt, occurredAt,
  resolvedAt, closedAt, paidAt, dueAt, startedAt, finishedAt`); event reports use `occurredAt`;
  stored UTC, display may convert.
- **Traceability:** KPI → row → source object → source event/audit. No unexplained numbers.
- **Export rule:** obeys Import/Export Standard; preserves filters, permission scope, tenantId,
  visibility, field restrictions, masking. No hidden data in exports.
- **Dashboard rule:** dashboards obey the same rules; widgets never bypass permissions or leak.
- **AI rule:** AI reads only permission-safe views; never broader than the user is authorized.

MUST: server-side permissions, tenantId, canonical values, official KPIs, approved sources,
visibility, no aggregate leakage, traceability, export permissions, filter preservation.
MUST NOT: create separate truth, redefine statuses/KPIs, expose unauthorized rows/counts, use
translated labels as values, bypass tenant/field restrictions, export unviewable data.

---

## Import / Export Standard — LOCKED

Imports behave like validated create/update actions; exports behave like permission-filtered
views. Both are auditable, permission-safe, tenant-safe, validation-driven. Files stored as
attachments. Object `id` UUIDv7; reference prefixes `IMP`, `EXP` (S5).

### Import job (camelCase — D2)
Fields: `id (UUIDv7), referenceNumber (IMP-…), importType, tenantId, sourceFileAttachmentId,
createdBy, createdAt, startedAt, finishedAt, status, totalRows, validRows, failedRows,
skippedRows, createdRecords, updatedRecords, errorReportAttachmentId, correlationId, eventId`.
Status enum: `DRAFT, VALIDATING, VALIDATION_FAILED, READY_TO_IMPORT, IMPORTING, COMPLETED,
COMPLETED_WITH_ERRORS, FAILED, CANCELLED`.
Validation (before applying changes) checks file type/size, required columns/fields, types,
lengths, enums, canonical values, tenantId, references, duplicates, permission scope, status
transitions, ownership, assignment, attachment, security rules. Invalid rows never create
corrupted records. Imports use the same Data Validation Standard as UI/API/automation/
integration/admin/jobs. Explicit server-side import permission, object-specific. tenantId
assigned from trusted server context. Import events (PascalCase event names): `Import.Started,
Import.Validated, Import.ValidationFailed, Import.Completed, Import.Failed, Customer.Imported, …`.
Auditable. Partial imports allowed only if clearly reported with an error report; partial success
is never shown as full success.

### Export job (camelCase — D2)
Fields: `id (UUIDv7), referenceNumber (EXP-…), exportType, tenantId, requestedBy, requestedAt,
startedAt, finishedAt, status, objectType, filtersApplied, rowCount, fileAttachmentId,
correlationId, eventId`.
Status enum: `REQUESTED, RUNNING, COMPLETED, FAILED, CANCELLED, EXPIRED`.
Explicit server-side export permission; respects object-view/report permissions. Preserves
tenantId scope, active/search/report filters, visibility, permission, field restrictions,
masking. A user must not export records/fields they cannot view. Sensitive fields masked or
excluded unless permitted. Export events: `Export.Requested, Export.Completed, Export.Failed,
Report.Exported`; sensitive exports also create Security Events. Export files have controlled
retention and expire; never permanently public.

MUST: enforce permissions/tenantId, validate server-side, canonical values, events, audit,
preserve filters, mask sensitive data, store files as attachments, error reports on failure.
MUST NOT: bypass platform rules, accept invalid records, leak unauthorized data, expose
secrets, use translated labels as canonical, allow arbitrary tenantId, silently ignore
failures, create unaudited bulk changes.

---

## Multi-Tenant Standard — LOCKED

Single shared database; every tenant-owned business object includes mandatory `tenantId`. No
database-per-tenant, no schema forks, no business-logic forks.

`tenantId` is a mandatory security boundary: required, indexed where needed, server-assigned,
server-enforced, never editable by normal users, never trusted from unvalidated frontend input.
**It is a required field on tenant-owned events and audit entries (D1).** Applies to customers,
leads, accounts, tickets, tasks, invoices, payments, services, subscriptions, comments,
attachments, notifications, approvals, escalations, queues, reports, imports, exports, automation
runs, integration runs, events, audit entries, timeline entries.

Isolation applies to every access path: list/detail queries, create/update/delete, search,
filters, autocomplete, counts, reports, dashboards, exports, imports, APIs, automations,
integrations, notifications, attachments, comments, timelines, audit logs, background jobs,
AI-readable views. No path skips tenantId enforcement.

Cross-tenant access is forbidden for normal users; allowed only for explicit Super Admin
functionality that is intentionally designed, permission-protected, labeled, audited, and
event-recorded. tenantId assigned from trusted backend context; never accepted blindly from
frontend, import files, integration payloads, query params, hidden inputs, local storage, or
browser state. Tenant data movement only via explicit Super Admin migration (audited,
event-recorded, traceable). Tenant configuration must not create logic forks: allowed = feature
flags, display settings, localization labels, approved notification preferences; forbidden =
custom enum/status meanings, hidden workflows, validation/permission bypass, schema changes.

MUST: single shared DB, tenantId on tenant-owned objects (incl. events/audit), server-side
enforcement on every path, prevent cross-tenant leakage, audit Super Admin cross-tenant actions,
no schema forks. MUST NOT: database-per-tenant, tenant schemas, normal-user cross-tenant access,
trust frontend tenantId, leak counts/autocomplete/attachments across tenants, hidden tenant
workflows.

---

## Localization Standard — LOCKED

Localization is display translation only and never changes business meaning. Canonical internal
values are the source of truth; translated labels are display only (store `ACTIVE`, display
"Active"/"Ակտիվ"). Never store translated labels as values.

Canonical values required for: statuses, enums, object types, event types, permission names,
role keys, feature flag keys, workflow states, automation trigger names, integration values,
report/KPI definitions. Translation may apply to page/button/field labels, helper/error text,
notification text, status/enum display labels, report/nav labels, table headers, empty states.
Localization must not alter canonical enum values, status logic, event names, permission/role
keys, API contracts, DB values, automation logic, integration canonical values, or KPI
definitions. Missing translations fall back to default language and never break forms/reports/
automations/integrations/validations/exports/imports.

APIs use canonical values (localized labels only as presentation metadata). Imports use
canonical values unless an explicit, validated, auditable mapping exists. Machine-readable
exports use canonical values. Reports/KPIs use canonical values. Automations and integrations
use canonical values (`if status == ACTIVE`, never `if label == "Ակտիվ"`). Permission keys are
not localized.

MUST: stable canonical values, translate display only, safe fallback, preserve API/automation/
integration contracts and KPI definitions. MUST NOT: redefine meaning, tenant-specific statuses/
enums, store translated labels as values, change workflow/validation/report behavior, become an
integration contract.

---

## Configuration Standard — LOCKED

Platform configuration is **Super Admin only**. Department Managers, Team Leads, normal Admins,
and normal users cannot change platform configuration. Configuration controls approved behavior
and never bypasses core standards or creates hidden tenant logic forks. Object `id` UUIDv7;
reference prefix `CFG` (S5).

Each configuration record (camelCase — D2): `id (UUIDv7), referenceNumber (CFG-…),
configurationKey, configurationScope, configurationValue, status, createdBy, createdAt,
updatedBy, updatedAt, version, description, changeReason`.
Scope enum: `GLOBAL, TENANT, DEPARTMENT, ROLE, USER, ENVIRONMENT`.
Status enum: `ACTIVE, INACTIVE, DEPRECATED, PENDING_REVIEW`.
Validated before save (key format, scope, value type/range, dependencies, tenant/permission/
feature-flag impact, backwards compatibility, security). Invalid config not saved. Changes
create audit + events: `Configuration.Created, .Updated, .Disabled, .Deprecated, .Restored`;
security-sensitive changes also create Security Events. Dangerous changes require explicit
confirmation. Configuration must not bypass permissions, tenant isolation, validation, audit,
events, security, enum standards, localization, or feature-flag rules. Business-affecting config
is versioned. Tenant config only within approved keys (display preferences, feature enablement,
approved notification preferences); never custom enum/status meanings, schema changes, hidden
workflows, or validation/permission bypass.

MUST: Super Admin only, centrally managed, validated, audited/event-recorded, actor-traceable,
tenant-isolation respecting, approved scopes only. MUST NOT: editable by normal admins, bypass
standards, redefine meaning, replace feature flags, disable audit/events, create tenant schemas/
meanings, silently change behavior.

---

## Feature Flag Standard — LOCKED

Feature Flags control whether a feature is available. Permissions control whether a user may use
it. Both may be required. Flags do not replace permissions, do not delete data, do not redefine
business logic. Object `id` UUIDv7; reference prefix `FFL` (S5).

Each flag (camelCase — D2): `id (UUIDv7), referenceNumber (FFL-…), featureFlagKey,
featureFlagName, description, scope, enabled, owner, createdBy, createdAt, updatedBy, updatedAt,
status, rolloutStrategy, environment, changeReason`.
Scope enum: `GLOBAL, TENANT, ROLE, USER, ENVIRONMENT`.
Status enum: `DRAFT, ACTIVE, INACTIVE, DEPRECATED, RETIRED`.
`featureFlagKey` stable, canonical, never localized, never casually renamed. Access considers:
feature enabled + user permission + tenant scope + role scope + object visibility + security.
A disabled feature hides/blocks; an enabled feature does not authorize. Disabling a feature
must not delete data (hide entry points, block new actions, preserve records, allow read-only
where approved, keep audit/event history). Rollout patterns: global, tenant, role, user
allowlist, environment-only; auditable. Environment enum: `DEVELOPMENT, STAGING, PRODUCTION`
(production changes controlled/audited). Changes create audit + events: `FeatureFlag.Created,
.Enabled, .Disabled, .Updated, .Deprecated, .Retired`; security-sensitive changes create
Security Events. Tenant-scoped flags enforce tenantId server-side; UI may hide, backend must
enforce. Automations/integrations respect flags. Reports keep historical feature-disabled data.

MUST: control availability, central management, stable canonical keys, approved scopes, respect
tenantId/permissions, audit/event on change, preserve data when disabled, server-side
enforcement. MUST NOT: replace permissions, delete data/audit/events, rely on frontend hiding,
localize keys, create hidden logic, bypass validation/security, replace configuration, redefine
KPI/enum meanings.
