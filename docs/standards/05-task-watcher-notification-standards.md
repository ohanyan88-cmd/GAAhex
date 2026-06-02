# 05 — Task, Watcher / Subscriber & Notification Standards

B4 patch: task events project onto both the task timeline and the parent object timeline as
views of one stored event. Enum values are `UPPER_SNAKE_CASE` (already compliant).

---

## Task Standard — LOCKED

A task is first-class accountable work — not a comment, notification, or audit event.
It answers: what, who owns it, who is the primary assignee, when due, current state, related object.

Every task has: ID (UUIDv7), Reference Number (`TSK-000001`), Owner, single Primary Assignee,
optional Watchers/Collaborators, Status, Priority, Due Date, Audit, Timeline, Comments,
Attachments, Permissions.
Search supports `TSK-000001, TSK000001, TSK-1, 000001, 1`.

Scope enum: `OBJECT_LINKED, STANDALONE`.
Status enum: `OPEN, IN_PROGRESS, BLOCKED, WAITING, COMPLETED, CANCELLED`. Terminal:
`COMPLETED, CANCELLED` (read-only unless reopened by permission).
Priority enum: `LOW, MEDIUM, HIGH, URGENT` (default `MEDIUM`).
Owner/Assignee types: `EMPLOYEE, ROLE, DEPARTMENT, QUEUE` (PrincipalType subset — D12; not TEAM). Single primary assignee; no
multiple equal assignees; watchers optional.
Type enum: `GENERAL, FOLLOW_UP, REVIEW, APPROVAL_PREP, CALL_CUSTOMER, CONTACT_VENDOR,
COLLECT_DOCUMENT, VERIFY_DOCUMENT, VERIFY_PAYMENT, PAYMENT_FOLLOW_UP, CHECK_SERVICE,
CONFIGURE_DEVICE, INSTALLATION, MAINTENANCE, FIELD_VISIT, SITE_SURVEY, NETWORK_CHECK,
OUTAGE_INVESTIGATION, INCIDENT_ACTION, PROBLEM_INVESTIGATION, CHANGE_PREP, CHANGE_EXECUTION,
RELEASE_PREP, RELEASE_VALIDATION, ESCALATION_ACTION, CUSTOMER_UPDATE, INTERNAL_HANDOFF,
QUALITY_CHECK, COMPLIANCE_REVIEW, LEGAL_REVIEW, FINANCE_REVIEW, MANAGER_REVIEW,
DATA_CORRECTION, KNOWLEDGE_UPDATE`.
SLA status enum: `ON_TRACK, AT_RISK, BREACHED, PAUSED, NOT_APPLICABLE`.
Dependency type enum: `BLOCKED_BY, BLOCKS, RELATED_TO, DUPLICATES, DUPLICATED_BY`.
Resolution enum: `DONE, NOT_NEEDED, DUPLICATE, CANNOT_COMPLETE, INVALID, MERGED` (required for
`COMPLETED`, `CANCELLED`).

Stored fields: `taskId, referenceNumber, title, taskType, taskScope, status, priority,
ownerType, ownerId, assigneeType, assigneeId, createdAt, createdBy, updatedAt`.
Conditional: `parentEntityType, parentEntityId, dueAt, slaId, slaDueAt, slaStatus,
blockedReason, blockedAt, blockedBy, waitingReason, waitingUntil, completedAt, completedBy,
completionNote, cancelledAt, cancelledBy, cancellationReason, resolution`.

Hard validation: no active task without owner; no active task without primary assignee; no
`OBJECT_LINKED` task without parent; no `COMPLETED` without completedAt/completedBy; no
`CANCELLED` without cancellationReason; no `BLOCKED` without blockedReason; no duplicate active
reference number; no value outside its enum.

Integration: Comments, Attachments, Audit, Timeline, Assignment, Queue Ownership, Watcher,
Notification. Permissions: `task.view, task.create, task.edit, task.assign, task.complete, task.cancel, task.reopen,
.Delete, .Comment, .Attach`.

**B4:** task events are stored once in the Event System and **projected** onto the Task
Timeline and the Parent Object Timeline. Soft delete only.

Principle: if no one owns it, it is not a task; without state it cannot be managed; if not
auditable it cannot be trusted.

---

## Watcher / Subscriber Standard — LOCKED

Watching is awareness. Assignment is responsibility. Ownership is accountability. These stay
separate. A watcher is interested but not responsible. **Watching never implies ownership,
assignment, KPI credit, SLA impact, workload, or performance impact.**

Object scope: Customer, Employee, Role, Ticket, Invoice, Contract, Asset, Project, Order,
Task, Approval, Queue, Service, Subscription, Network Device, Site, Location, Vendor, Purchase
Order, Knowledge Article, Change Request, Incident, Problem, Release.

Watcher type: `EMPLOYEE, ROLE, DEPARTMENT, TEAM` (PrincipalType subset — D12; not QUEUE). Status: `ACTIVE, PAUSED, REMOVED`.
Source: `MANUAL, AUTOMATIC, MENTION, ASSIGNMENT, ESCALATION, APPROVAL, SYSTEM, AUTOMATION`.
Scope: `OBJECT_ONLY, OBJECT_AND_CHILDREN, OBJECT_AND_RELATED`. Priority: `LOW, NORMAL, HIGH,
CRITICAL`. Notification frequency: `IMMEDIATE, HOURLY_DIGEST, DAILY_DIGEST, WEEKLY_DIGEST,
DISABLED`.
Watcher event type: `STATUS_CHANGED, ASSIGNED, UNASSIGNED, REASSIGNED, COMMENT_ADDED,
COMMENT_REPLY, MENTIONED, ATTACHMENT_ADDED, APPROVAL_COMPLETED, ESCALATED, TASK_CREATED,
TASK_COMPLETED, TASK_CANCELLED, OBJECT_CLOSED, OBJECT_REOPENED`.

Stored: `watcherRelationshipId, watcherType, watcherId, targetEntityType, targetEntityId,
status, source, scope, priority, createdAt, createdBy`. Optional: `watchReason, expiresAt,
pausedAt/By, removedAt/By`.
Auto-watch: Creator, Owner, Primary Assignee (unless disabled). **E15 — if the Owner is a
`QUEUE` (not a valid watcher type, D12), auto-watch resolves to the queue's owning department;
non-watchable owners always resolve to a watchable principal before a watcher is created.** Mention watchers default 30
days (configurable), auto-removed after expiry unless made permanent. Department/role watchers
resolve dynamically (no membership snapshot).
Audit events: `WATCH_ADDED, WATCH_REMOVED, WATCH_PAUSED, WATCH_RESUMED, WATCH_SCOPE_CHANGED,
WATCH_PREFERENCE_CHANGED`. Permissions: `watch.view, watch.add, watch.remove, watch.pause, watch.resume,
.manage_others`. Unique key: target type+id + watcher type+id where `status=ACTIVE`.
Removed/paused watchers receive no notifications. Watchers preserved under legal hold.

Principle: Ownership = who is accountable; Assignment = who does the work; Watching = who wants to know.

---

## Notification Standard — LOCKED

Notifications deliver information; they do not create work or replace tasks/audit.
First-class object: `notificationId (UUIDv7), tenantId, recipient, channel, priority, status,
eventId, timestamp, delivery history`. **D16 — every notification stores the triggering `eventId`
(the Event System event it was created from), giving a full Event → Notification trace.**
Recipient type: canonical `RecipientType` = `EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER` (file 03,
E5 — includes the external portal principal; not QUEUE).
Source: `TASK, COMMENT, ATTACHMENT, APPROVAL, ASSIGNMENT, ESCALATION, WATCHER, MENTION,
STATUS_CHANGE, AUTOMATION, SYSTEM, INTEGRATION`.
Category: `ACTION_REQUIRED, INFORMATIONAL, WARNING, SUCCESS, ERROR, SECURITY, COMPLIANCE`.
Priority: `LOW, NORMAL, HIGH, CRITICAL` (controls urgency). Severity: `INFO, WARNING, ERROR,
CRITICAL` (describes impact).
Status: `PENDING, DELIVERED, READ, ACKNOWLEDGED, DISMISSED, EXPIRED, FAILED`.
Channel: `IN_APP, EMAIL, SMS, PUSH` (IN_APP always supported).
**D9 — `WEBHOOK` is not a notification channel. Outbound webhooks deliver events (Webhook
Standard, file 12), not notifications; there is one outbound-webhook path, and it is event-driven.**
Event type (initial): `TASK_ASSIGNED, TASK_REASSIGNED, TASK_DUE_SOON, TASK_OVERDUE,
TASK_COMPLETED, TASK_CANCELLED, COMMENT_ADDED, COMMENT_REPLY, MENTIONED, APPROVAL_REQUESTED,
APPROVAL_APPROVED, APPROVAL_REJECTED, ESCALATED, STATUS_CHANGED, ATTACHMENT_ADDED,
OBJECT_CREATED, OBJECT_CLOSED, OBJECT_REOPENED, WATCH_ADDED, AUTOMATION_FAILED,
INTEGRATION_FAILED, SECURITY_EVENT, COMPLIANCE_EVENT`.

Templates mandatory (no hardcoded text); store keys, render localized.
Suppression mode: `NONE, DEDUPLICATE, AGGREGATE, THROTTLE, MUTE` (audit still generated).
Digest first-class (`HOURLY, DAILY, WEEKLY`). Delivery attempts stored; result enum:
`SENT, DELIVERED, FAILED, REJECTED, BOUNCED, EXPIRED`. Retry schedule 1/5/15/60 min; never
retry invalid recipient/address or permission-denied. Async only — never send inside business
transactions. Architecture: queue, worker, retry engine, dead-letter queue.
CRITICAL: no digest, deliver immediately, may bypass quiet hours, may escalate.
ACTION_REQUIRED: no auto-dismiss. Compliance: cannot be muted. Security: not suppressible by
normal users (admin override only).
Preference hierarchy: Global → Object Type → Event Type → Rule (most specific wins). Channel
order: `IN_APP, EMAIL, PUSH, SMS`; SMS reserved for HIGH/CRITICAL unless configured.
Audit: `NOTIFICATION_CREATED, _SENT, _READ, _ACKNOWLEDGED, _FAILED`. Permissions:
`notification.view, notification.manage_preferences, notification.acknowledge, notification.dismiss`.

Principle: the right person, the right information, the right channel, the right time, without noise.

## Locked Decision
Tasks = accountable work. Watching = awareness only (never KPI/SLA/workload). Notification =
delivery of awareness.
