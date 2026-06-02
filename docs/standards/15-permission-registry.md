# 15 — Central Permission Registry

LOCKED. Satisfies the permission-registry requirement referenced by Comment, Attachment, Task,
Watcher, Notification, Configuration, and RBAC standards.
**Key format `object.action` — lowercase, dot-separated, object first (D2).** Keys are canonical,
stable, never localized. Enforced server-side; a feature flag never replaces a permission;
watching grants no permission.

> D2 note: the convention is lowercase `object.action` (e.g. `ticket.view`), matching the
> codebase's seeded keys. The standard's value is the *shape* (object.action, canonical,
> immutable, never localized) — case is not load-bearing, so lowercase is canonical here.

## Comment
`comment.create, comment.edit, comment.delete, comment.view_internal, comment.view_external,
comment.view_private, comment.moderate`
`comment.moderate` = soft-delete + resolve/reopen of **any** user's comment within scope; it does
NOT permit editing another user's content, and it does NOT bypass `hold` (hold beats every role).
Distinct from `configuration.manage`, which is not overloaded for moderation.

## Attachment
`attachment.view, attachment.download, attachment.upload, attachment.delete,
attachment.reference, attachment.view_deleted`
Sensitive categories (IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT, CONTRACT) require
stricter grants; downloads of sensitive attachments are audited.

## Task
`task.view, task.create, task.edit, task.assign, task.complete, task.cancel, task.reopen,
task.delete, task.comment, task.attach`

## Watcher
`watch.view, watch.add, watch.remove, watch.pause, watch.resume, watch.manage_others`

## Notification
`notification.view, notification.manage_preferences, notification.acknowledge,
notification.dismiss`

## Reporting / Import / Export
`report.view, report.export, import.run, export.run` (export/import are object-specific:
e.g. `customer.import`, `invoice.export`, enforced server-side)

## Configuration / Feature Flag (Super Admin scope)
`configuration.manage, feature_flag.manage` — Super Admin only; every change audited + event-recorded.

## Workflow / SLA / Relationship / Communication / Webhook / API
`workflow.manage, sla.manage, relationship.create, relationship.delete, communication.view,
communication.send, webhook.manage, api_key.manage`
(object CRUD/action permissions follow the same `object.action` pattern: `ticket.view`,
`ticket.edit`, `ticket.assign`, `invoice.view`, `customer.edit`, etc.)

## RBAC administration
`role.view, role.manage, permission.manage, permission_group.manage, user.manage_roles`
— all permission/role/group/membership changes create audit + security events.

## Access-decision inputs (RBAC Standard, file 12)
A permission grant alone is never sufficient. Every decision also evaluates: authenticated
identity, tenantId, role permissions, explicit permissions, ownership, assignment, department,
team/region, object visibility, feature flag, field restrictions, record status, workflow state.
Field-level masking applies to UI, API, export, reports, search, and AI-readable views.

## Governance
Permission keys are immutable once released (renaming breaks RBAC, API, audit). New keys follow
lowercase `object.action`, are added through governance, and are never derived from translated
labels. Multi-word actions use snake_case within the action segment (`view_internal`,
`manage_others`).
