# 04 — Audit, Activity Timeline, Comment & Attachment Standards

B3: ActorType references the canonical enum. B4: timeline is a projection of the Event System.
D1: `tenantId` added to audit. D2: field identifiers in camelCase (Naming Standard). D3: Audit
`EntityType` is the canonical `ObjectType` enum. D5/D12: `ActorType` (performer) and
`PrincipalType` (referenced principal) are distinct axes. D15: mention targets `UPPER_SNAKE_CASE`.

---

## Audit Standard — LOCKED

**D1 — one physical store.** The platform keeps a single append-only event store (Event System,
file 06) as the physical source of truth. **Audit is a governed *projection* over that store, not
a separate table** — the audit view is the set of compliance-relevant events carrying the
audit-required fields below (incl. before/after values). Immutability is enforced at the store
level (append-only; deletes rejected for all roles). This matches the deployed design, where the
event table is append-only by DB trigger.

Audit records are immutable, system-generated, fact-based records of significant actions. Audit
is the system of record (as a projection of the immutable event store).

Every audit event contains the fields (camelCase — D2):
`id, tenantId, entityType, entityId, eventType, occurredAt, actorType, actorId, source`.

- `id` uses UUIDv7.
- **`tenantId` is mandatory for tenant-owned audit entries (D1, Multi-Tenant Standard).**
- **`entityType` is the canonical `ObjectType` enum (D3)** — see file 03. Audit can reference
  every object that has a timeline (no narrower subset).
- `entityType` and `entityId` are always stored together; `entityId` alone is invalid.
- `eventType` is a controlled enum (**`AuditEventType`** — distinct from the Event System's
  `eventName`; E13), e.g.: `CREATED, UPDATED, DELETED, ASSIGNED, UNASSIGNED, REASSIGNED,
  OWNER_CHANGED, DEPARTMENT_CHANGED, ESCALATED, APPROVED, REJECTED, CLOSED, REOPENED,
  COMMENT_ADDED, COMMENT_EDITED, COMMENT_DELETED, ATTACHMENT_UPLOADED, ATTACHMENT_DOWNLOADED,
  ATTACHMENT_DELETED, ATTACHMENT_REFERENCED, ATTACHMENT_UNREFERENCED, ATTACHMENT_QUARANTINED,
  ATTACHMENT_SCAN_FAILED, STATUS_CHANGED` (E22 adds OWNER_CHANGED, DEPARTMENT_CHANGED).
- `occurredAt`: system-generated, UTC, immutable, ISO 8601.
- **`actorType`: canonical `ActorType` enum — `USER, SYSTEM, AUTOMATION, INTEGRATION, API,
  CUSTOMER` (B3).** This is the *performer* axis, distinct from `PrincipalType` (D5).
- `source` enum: `WEB, MOBILE, API, AUTOMATION, INTEGRATION, SYSTEM`.
- Updates store before/after values.
- Never store passwords, tokens, secrets, private keys, credentials; mask sensitive values.
- Internal by default; retention permanent by default.
- Searchable by entityType, entityId, referenceNumber, actor, occurredAt, eventType,
  department, status. Authorized export to CSV/Excel/PDF.

Principle: if it happened, it must be auditable; if it changed, traceable; if it cannot be
traced, it did not happen.

---

## Activity Timeline Standard — LOCKED

The Activity Timeline is the single chronological user-facing history view for an object.
Audit remains the system of record.

**B4 — Projection model:** the Event System is the canonical source. Timeline entries are
**projections/views** of events; the event is stored once. A single event may appear on
multiple object timelines when relevant (e.g. a task event on both the task timeline and its
parent object timeline).

Timeline consumes events from: Audit, Comments, Attachments, Assignments, Approvals,
Escalations, Status Changes, Tasks, Automation, Integration.

Object scope: the canonical `ObjectType` enum (file 03) — Customer, Lead, Employee, Role,
Department, Team, Queue, Ticket, Task, Invoice, Payment, Contract, Order, Approval, Project,
Asset, Service, Subscription, Network Device, Site, Location, Vendor, Purchase Order, Knowledge
Article, Change Request, Incident, Problem, Release, Campaign (and platform objects where
applicable).

Every timeline entry (camelCase — D2): `eventId (UUIDv7), eventName, category, occurredAt, actor,
description`. Ordered newest-first by default. `STATUS_CHANGED` is a mandatory first-class
event. **E14 — `category` is the canonical `EventCategory` enum (file 03/06); the timeline does
not define a separate category enum, since timeline entries are projections of events. The UI
may group/filter categories but must not redefine them.** Visibility classes: `INTERNAL, EXTERNAL`.
Filter by eventName, category, actor, date range. Text search across comments, descriptions,
attachment names, actor names. Entries immutable; deleted content never silently disappears.
Permanent retention by default; authorized export to PDF/Excel/CSV. Performance: pagination,
lazy loading, virtual scrolling.

**D4/D13:** the Timeline tab **is** the activity history. There is no separate "Activity" tab;
"Activity" and "Timeline" are the same surface. Object-detail tabs follow the canonical set in
the Object Detail Standard (file 10).

---

## Comment Standard — LOCKED

Comments are conversation, not audit. Each comment belongs to exactly one parent object
(immutable parent).
Types: `INTERNAL, EXTERNAL, PRIVATE, SYSTEM`.
Required (camelCase — D2): `id (UUIDv7), tenantId, parentObjectType, parentObjectId, commentType,
authorId, createdAt, content`. Optional: `editedBy, editedAt, deletedBy, deletedAt`. User refs
stored as IDs.
Status enum: `ACTIVE, EDITED, DELETED`.
Rich content allowed: text, links, mentions, lists, tables, code blocks. Disallowed: scripts,
executables, embedded programs.
Mentions store `mentionedEntityType` + `mentionedEntityId`. **Mention targets use the canonical
`PrincipalType` enum (D15, UPPER_SNAKE): `EMPLOYEE, ROLE, DEPARTMENT, TEAM`.** Mentions generate
notifications. Replies max recommended depth 2. Edit window default 15 min (configurable); edits
show label/editor/timestamp and create audit before/after. Soft delete only; deleted shows
"Comment Deleted"; deletion audited.
Permissions: `comment.create, comment.edit, comment.delete, comment.view_internal,
comment.view_external, comment.view_private`. Optional resolution flag: `RESOLVED, UNRESOLVED`.
Comments under investigation / legal hold / audit / compliance review cannot be edited or deleted.

---

## Attachment Standard — LOCKED

Attachments are first-class objects, not file fields. Governed with id, owner, metadata,
security, audit, timeline, permissions, retention. `id` uses UUIDv7.
Exactly one primary owner (`ownerEntityType`, `ownerEntityId`); cannot be moved between owners;
may be referenced by others (reference links never change ownership).
**No versioning** — each upload is a separate attachment (`contract_v1.pdf`, `contract_v2.pdf`),
each with its own id/metadata/audit/timeline/permissions. No file overwritten by a later upload.
Soft delete; deleted shows "Attachment Deleted". Files in object storage; DB stores metadata
only. No public links by default; authenticated access only. Default max size 100 MB
(configurable by tenant/department/object type/category).

Category enum: `DOCUMENT, IMAGE, PDF, OFFICE_DOCUMENT, TEXT_FILE, LOG_FILE,
CONFIGURATION_FILE, CONTRACT, INVOICE, IDENTITY_DOCUMENT, PHOTO_EVIDENCE, NETWORK_DIAGRAM,
SERVICE_PROOF, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, OTHER`.
Allowed types config-controlled (min: PDF, Image, Text, Office Docs, Log, CSV). Executables
blocked (EXE, BAT, CMD, JS, VBS, SCR, MSI). Preview: PDF, Image, Text, Office Docs. Download by permission.
Upload flow: `UPLOAD_STARTED → STORED_TEMPORARILY → MALWARE_SCAN → AVAILABLE | QUARANTINED`.
SHA-256 checksum stored. Status enum: `UPLOADING, SCANNING, AVAILABLE, QUARANTINED, DELETED,
FAILED`. Stored fields (camelCase — D2): `id, tenantId, ownerEntityType, ownerEntityId, fileName,
originalFileName, fileExtension, mimeType, fileSize, checksum, storageKey, category, status,
createdAt, createdBy, deletedAt, deletedBy`. Optional: `description, referenceLinks, scanResult,
scanProvider, scanCompletedAt, previewAvailable, downloadCount, lastDownloadedAt`. Original
filename preserved; system storage key generated; never use filename as identity.
Permissions: `attachment.view, attachment.download, attachment.upload, attachment.delete, attachment.reference, attachment.view_deleted`.
Stricter permissions for `IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, CONTRACT`.
Audit events use the canonical attachment event types. Sensitive downloads audited. Retention
permanent by default; follows owner object; legal-hold protected. Never allow executables,
anonymous download, direct bucket exposure, unscanned access, or filename-based authorization.

## Locked Decision
Comments are conversation. Audit is evidence. Timeline is the projected history view.
Attachments are secured evidence. The four remain separate but interlinked.
