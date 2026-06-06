# 08 — Permission Architecture

**Constitutional document.** This is the second of the 22 Architecture Constitution documents, positioned directly under the Platform Reference Model and Core Architecture. All API endpoints, database tables, UI surfaces, and audit logs must conform to the permission model defined herein.

---

## 1. Purpose

Define how access to platform resources is granted, checked, audited, and revoked. Permission Architecture governs Role-Based Access Control (RBAC), permission key semantics, scope evaluation, field-level security, approval-grade permissions, audit trails, and the separation of permission (access control), policy (decision logic), entitlement (availability by plan), and tenant (data isolation).

## 2. Scope

In scope:

- RBAC — roles assigned to users; permissions assigned to roles.
- Permission key format (`object.action`, immutable once released).
- Permission catalog derived from the canonical entity model.
- Core permission types: view, edit, create, delete, manage, assign, approve.
- Scope evaluation — tenant, organizational node, department, region.
- Field-level read / write / redact security.
- Record-level permissions — ownership, watchers, escalation chains.
- Approval-grade permissions — approve, reject, delegate.
- Super Admin — explicit, audited, time-tracked.
- Row-Level Security (RLS) — Postgres-native tenant fence.
- Permission audit — every grant/revoke tracked; permission checks observable in metrics.

Out of scope (handled by other constitution documents):

- *Policy execution* — see `07_WORKFLOW_PROCESS_ARCHITECTURE.md`.
- *Entitlement logic (plan-based availability)* — see `PLATFORM_REFERENCE_MODEL.md` § Entitlement Core.
- *Tenant scoping and data partitioning* — see `14_TENANT_ARCHITECTURE.md`.
- *UI rendering decisions based on permissions* — see `06_UI_EXPERIENCE_ARCHITECTURE.md`.
- *Audit evidence storage* — see Audit Core in PRM; events in `11_EVENT_ARCHITECTURE.md`.

## 3. Goals

- **G1** Every API endpoint, data mutation, and admin action is protected by an explicit permission check.
- **G2** Permission keys are immutable, canonical, never derived from translated labels, and follow `object.action` (lowercase, dot-separated) format.
- **G3** Access decisions are server-side authority; UI hiding is presentation, never authorization.
- **G4** Every permission grant and revoke is audited with actor, timestamp, scope, and tenure metadata.
- **G5** Separation is strict: Permission (who can act) ≠ Policy (what decision applies) ≠ Entitlement (what is available by plan) ≠ Tenant (data partition).
- **G6** Row-level security is enforced at the database layer for tenant isolation and supported by application-layer permission checks for fine-grained access.
- **G7** Field-level permissions (read, edit) are enforced identically across UI, API, export, reports, and AI-readable views.

## 4. Non-Goals

- **NG1** This document does NOT define policy evaluation (who *should* act given business rules) — that is Policy Core.
- **NG2** This document does NOT define plan entitlements (what features are available in which tier) — that is Entitlement Core.
- **NG3** This document does NOT define organizational structures — that is Organization Core in Information Architecture.
- **NG4** This document does NOT define how to display UI based on permissions — that is Experience Architecture; this defines what checks the backend enforces.
- **NG5** This document does NOT replace the immutable Permission Registry (file 15) or the Security Standard (file 17).

## 5. Architecture Principles

### P1 — Default-deny: no grant means no access

An access decision is **allowed** only if a positive grant covers both the resource and the action. Any decision the permission system cannot explicitly grant is **denied** (HTTP 403). The denial response is generic and never echoes which layer (role, department, region, ownership, field) refused, preventing attackers from mapping the permission matrix.

### P2 — Permission keys are the stable naming surface

Permission keys (`object.action`) are public, immutable once released, and follow a strict canonical naming convention (lowercase, dot-separated, object first, multi-word actions in snake_case). Keys are never derived from UI labels, never translated, never inflected. They are the contract between backend and frontend, backend and audit, backend and policy engines.

### P3 — Server-side authority is final

The backend is the authority for every permission check. UI hiding (graying out buttons, omitting nav entries) is *presentation*; it is *not* authorization. A browser extension, API client, or logged-in terminal that bypasses UI can still access a resource if and only if the backend permission check passes. UI is a courtesy; the server is the truth.

### P4 — Scope is composable: tenant + org node + department + region

A permission grant names a scope:
- **Tenant** — all nodes in the tenant.
- **Org node** — a single org hierarchy node (ltree path).
- **Subtree** — the node plus all descendants.
- **Department** — optionally, a department filter within that org scope.
- **Region** — a region scope filter (home_only, subtree, or any).

Access is granted iff all applicable scope layers agree.

### P5 — Approval-grade permissions are distinct and mutually exclusive

Permissions like `ticket.approve`, `ticket.reject`, `ticket.escalate` are specific to approval workflows. Holding `ticket.edit` does NOT grant `ticket.approve`. Approval chains and delegation are separate from base RBAC; they do not inherit base permissions.

### P6 — Field-level security is enforced uniformly

A field with restricted view/edit roles is **never** returned, labeled, used as a search highlight, exported, reported, or exposed to AI-readable views — enforced identically across UI, REST API, CSV export, reports, and AI-readable JSON. No layer is permitted to leak restricted fields.

### P7 — Super Admin is audited and time-scoped

Super Admin (user holding `configuration.manage`) is an elevated role with full platform access. Every Super Admin action is audited; Super Admin rights may be time-limited by policy (organization-specific rules, not platform-hardcoded).

### P8 — Permission is not entitlement

A user may hold the permission `report.create` but not be entitled to create reports if their plan does not include the Reporting feature. Entitlement is checked *before* the permission check (fail-closed on entitlement denial); permission is checked *after*. Permission gates *who* can act; entitlement gates *whether* they *should* be allowed to try.

### P9 — Role deny (hard-denials) wins over permission grant

A role may explicitly deny a permission via the `role_deny` list. A matching deny raises `AccessDenied` even when the role's positive permissions would have allowed the action. Deny always wins.

## 6. Architecture Laws

### L1 — Permission keys are immutable once released

A key published in a release cannot change. Renaming breaks RBAC, audit logs, API documentation, and external integrations. New actions require new keys. Deprecated keys are supported for one release, then removed in a minor version bump with documented migration.

### L2 — All permission checks are server-side

No permission check logic is executed in the browser, CLI, SDK, or third-party app. All such contexts invoke backend APIs that perform the check server-side and return 403 on denial.

### L3 — Permission + ownership + scope all must pass

A decision is allowed iff:
1. The acting user's role(s) grant the permission (or a wildcard covering it), *and*
2. The resource's owner (if required by the entity) matches the user or the user's department/team, *and*
3. The org-node scope of the grant covers the resource's node, *and*
4. The department filter (if set) matches the resource's department, *and*
5. The region scope (if set) includes the resource's region.

Any layer denying causes the decision to be denied.

### L4 — Every grant and revoke is audited

When a user is assigned a role, that assignment is recorded in `assignment` with timestamp, granter, tenure, and scope. When a role's permissions are modified, that change is audited via `role_def.updated_at`, actor, and event emission. Audit logs are immutable (append-only).

### L5 — Every permission check is observable

Permission decisions are logged to metrics / observability. Denied checks are flagged for security monitoring. Denial patterns (e.g., repeated denials from the same user) trigger alerts.

### L6 — Role deny is checked after grant

When evaluating a decision:
1. Determine if the user's granted role(s) cover the action.
2. Evaluate scope layers (tenant, org node, department, region).
3. Check `role_deny` list; if a match exists, deny.
4. Otherwise, grant.

### L7 — Field-level security is part of the permission model

A field that declares `view_roles` or `edit_roles` is treated as permission-protected. The permission gate is checked by the field-access layer before the field is returned, exported, or indexed.

## 7. Core Concepts

### 7.1 Permission key

A canonical, immutable identifier for an action on an entity. Format: `object.action` (lowercase, dot-separated). Examples:

- `ticket.view` — read a ticket.
- `ticket.edit` — modify a ticket.
- `ticket.assign` — assign a ticket to a user or team.
- `ticket.approve` — approve a ticket (approval context only).
- `comment.view_internal` — read internal comments (sensitive vs. external).
- `configuration.manage` — Super Admin: modify platform settings.

Keys are defined in the Permission Registry (file 15) and are immutable once released.

### 7.2 Role

A tenant-scoped, named bundle of permissions assigned to users. A role has:

- **`key`** — machine identifier (e.g., `support_agent`, `billing_admin`).
- **`permissions`** — list of keys or wildcards (`*`, `object.*`, or `object.action`).
- **`scope`** — default scope level when assigned: `tenant`, `node`, or `subtree`.
- **`deny_list`** (optional) — explicit denials that override positive permissions.
- **`is_active`** — soft-delete flag.

Roles are configuration (edited by Super Admin); the RBAC engine is fixed kernel.

### 7.3 Assignment (grant)

A binding between a user and a role within a specific scope. An assignment records:

- **`userId`**, **`roleId`**, **`tenantId`** — who, to what, in which tenant.
- **`org_node_path`** (ltree) — the org hierarchy node where the role applies.
- **`scope ∈ node | subtree | tenant`** — whether the role applies to this node only, its descendants, or the entire tenant.
- **`department`** (optional) — if set, the role applies only in this department.
- **`region_scope ∈ home_only | subtree | any`** — how far the role reaches across the region partition (NULL is `home_only`).
- **`valid_from`, `valid_until`** (optional) — tenure constraints (Super Admin roles may have time bounds).
- **`granter_id`**, **`granted_at`** — who granted this role and when (audit).

An assignment is the unit of permission grant. Users may hold multiple assignments.

### 7.4 Access decision (`can`)

The core permission gate. Signature: `can(actor, entity_key, verb, record_path)` → boolean.

**Returns true iff:**
1. The actor's role(s) grant the permission (literal `entity_key.verb`, wildcard `entity_key.*`, or wildcard `*`), *and*
2. At least one grant's scope covers the record's org-node path (tenant or node/subtree match), *and*
3. If the grant has a department filter, the record's department matches, *and*
4. If the grant has a region filter, the region scope includes the record's region, *and*
5. The role's deny list does not match the entity/verb pair.

**Returns false (default-deny) for any path not explicitly granted.** List/search endpoints filter every row through this gate; a caller never sees a row outside their scope.

### 7.5 Field-level access

A field may declare:

- **`view_roles`** — list of role keys that may view the field. If empty/null, visible to anyone who can view the record (default-open). If set, only holders of one of those roles see the field.
- **`edit_roles`** — list of role keys that may edit the field. If empty/null, editable by anyone who can edit the record (default-open). If set, only holders of one of those roles may modify it.

Enforcement:
- The field-access layer checks these gates **before** returning, labeling, exporting, or indexing the field.
- A field a user's roles cannot view is **never** present in API responses, CSV exports, reports, search, or AI-readable views.
- `configuration.manage` (Super Admin) bypasses both gates.

### 7.6 Row-level security (RLS)

Tenant-scoped tables carry a Postgres-native RLS policy (`tenant_isolation` policy, NULLIF-guarded) that ensures no query crosses a tenant boundary. Every row has `tenantId`; the RLS policy filters to the authenticated user's tenant automatically at the database layer, before application permission checks run. RLS is the first gate; application permissions sit on top.

### 7.7 Ownership

Some entities have a required owner (user or team). Ownership is a shorthand for permission: only the owner (or a Super Admin) may modify the record unless a broader permission grant overrides. Ownership is recorded in `owner_id` (user) or `owner_team_id` (team) on the entity and is checked as part of the access decision (L3 layer 2).

### 7.8 Watchers and subscribers

A user watching a record is **not** granted any permission by watching. Watching is a visibility/notification preference, separate from RBAC. A watcher sees the record in their stream (if they have view permission) and is notified of changes. Watching grants no edit, delete, approve, or other permissions.

### 7.9 Super Admin

The user holding `configuration.manage` has full platform access: all entities, all actions, all scopes, all tenants (for multi-tenant admins). Super Admin actions are:

- **Audited in detail** — every action logs actor, timestamp, resource, change, and rationale.
- **Optionally time-scoped** — organization policy may set valid_from/valid_until on Super Admin role assignments.
- **Observable in metrics** — frequency, scope, and patterns of Super Admin actions are tracked.

## 8. Canonical Entities

The Permission Core owns:

| Entity | Purpose |
|---|---|
| `role_def` | Role definition — permissions, scope, deny list. |
| `assignment` | Role assignment to a user at an org node with scope filters. |
| `role_def_deny` | Hard-denial list — explicitly forbidden actions. |

Supporting entities (owned by other cores, referenced by Permission Core):

| Entity | Owner | Reference |
|---|---|---|
| `user` | Identity Core | user being granted a role. |
| `org_node` | Organization Core | scope anchor (org hierarchy node). |
| `entity_def` | Information Architecture / Data Core | entity key for a permission. |

## 9. Ownership Boundaries

### 9.1 Permission Core owns

- **Role definitions** (`role_def`): creation, modification, deletion, versioning.
- **Permission assignment** (`assignment`): granting roles to users, modifying scope, revoking.
- **Role deny lists** (`role_def_deny`): explicit denial rules.
- **Permission audit log** (`audit_log` records tagged with permission events).

### 9.2 Permission Core does NOT own

- **Entity schemas** — owned by Information Architecture / Data Core.
- **Org hierarchy** — owned by Organization Core.
- **User identity** — owned by Identity Core.
- **Policy evaluation** — owned by Policy Core.
- **Entitlement checks** — owned by Entitlement Core.
- **Audit evidence storage** — owned by Audit Core (Permission Core emits events to Audit).

## 10. Relationships

### 10.1 Permission ← Identity

Every permission check requires an authenticated identity (from Identity Core). The `can` function takes an authenticated actor; an unauthenticated request is denied before permission evaluation.

### 10.2 Permission ← Tenant

Every grant is scoped to a tenant. RLS ensures no query crosses a tenant boundary. Permission checks include tenant in the decision path (L3 layer 0: tenantId must match the authenticated user's tenant).

### 10.3 Permission ← Audit

Every grant/revoke is audited by Audit Core. Permission checks are observable in metrics. `configuration.manage` actions are flagged for compliance.

### 10.4 Permission ← Security

Permission checks are the enforcement layer for security boundaries. Security Core defines threat rules and rate limits; Permission Core enforces who can act. Together they form the access-control surface.

### 10.5 Permission → Policy (downstream)

Policy Core consumes Permission Core's public API (`can(...)` function) and grants to determine whether a user is eligible to approve a workflow transition, execute an automation, or sign off on a change. Policy does not bypass permission checks; it uses them as a prerequisite.

### 10.6 Permission → Entitlement (downstream)

Entitlement Core checks whether a plan includes a feature, then Permission Core checks whether a user is allowed to use it. Fail-closed on entitlement; permission checked after.

### 10.7 Permission → Event (publishing)

Permission grants and revokes are published as domain events (e.g., `RoleAssigned`, `RoleRevoked`) for audit, analytics, and downstream subscribers.

## 11. Responsibilities

### 11.1 Permission Core team

- Maintains the Permission Registry (file 15) — stable canonical keys.
- Operates the RBAC engine — evaluates `can(...)` checks.
- Manages role and assignment lifecycle — creation, updates, soft-delete.
- Emits permission events (RoleAssigned, RoleRevoked, RoleModified, PermissionGranted).
- Ensures every permission check is audited and observable.

### 11.2 Reviewers of permission-related PRs

- Confirm all new actions register permission keys in file 15.
- Confirm every data-mutating endpoint enforces a permission check.
- Confirm field-level security is declared for sensitive fields.
- Confirm scope layers (tenant, org node, department, region) are all evaluated.

### 11.3 Super Admin approver

- Grants Super Admin roles only after vetting the user and use case.
- Sets time bounds on Super Admin assignments if policy requires.
- Reviews Super Admin audit logs periodically for anomalies.

## 12. Allowed Patterns

### AP1 — Wildcards in role permissions

A role may grant `*` (all actions on all entities) or `object.*` (all actions on a single object). Wildcards are *declarations in role definitions*; they are never accepted in permission check calls (always expanded to literal keys before evaluation).

### AP2 — Explicit denial (role_deny)

A role can declare explicit denials: `role_def_deny` rows listing entity/action pairs that are never allowed for that role, even if the positive permission list would grant them. Denials are checked *after* positive grants; a match raises `AccessDenied`.

### AP3 — Scope filters on assignments

An assignment may narrow its scope by setting:
- A department filter (applies only in that department).
- A region scope (home_only, subtree, or any).

These filters are *restrictions*; they do not expand a grant beyond the role's base scope.

### AP4 — Time-scoped assignments

Super Admin roles (and other elevated roles per policy) may have `valid_from` and `valid_until`. The `can(...)` function checks tenure; an expired assignment is treated as if it does not exist.

### AP5 — Ownership as a shorthand for permission

An entity may require ownership (user or team). The entity owner holds effective edit/delete permissions unless a broader permission grant is present. Ownership is recorded in `owner_id` (user) and is evaluated as part of the access decision (L3 layer 2).

## 13. Forbidden Patterns

### FP1 — Permission checks in the UI only

A PR that moves permission checking to the browser (showing/hiding buttons based on local state) without enforcing a backend check is rejected. The backend must be the authority.

### FP2 — Implicit permissions via feature flags

A feature flag controlling whether a button is visible is **not** a permission check. Flags control UX; permissions control access. A user must never be able to call an API by disabling or flipping a feature flag locally.

### FP3 — Watching grants access

Assigning a user to watch a ticket does not grant them `ticket.view` or `ticket.edit`. Watching is a preference; permissions are separate.

### FP4 — Permission keys derived from translations

A permission key is never derived from a translated UI label. Keys are canonical (English), immutable, and never inflected. Translations apply to role names and UI descriptions, not to the key itself.

### FP5 — Cross-tenant permission checks

A permission check must always include `tenantId` as a parameter. A check that does not validate tenant boundaries is rejected.

### FP6 — Org-node scope evaluation without ltree

Org nodes are addressed by ltree `path`. A scope check that does not use ltree prefix matching (or equality for `node` scope) is rejected.

### FP7 — Field-level security only in the UI

A field with restricted `view_roles` is protected at the API, export, report, and search layers — not just the UI. A field that is hidden in the UI but returned in an API response is a leak.

### FP8 — Super Admin without audit

A Super Admin action that is not audited (or is audited with minimal context) is rejected. Every Super Admin change logs actor, timestamp, resource, change, and impact.

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Permission Core definition, separation from Policy/Entitlement/Tenant. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership, Permission is not Entitlement law (L3). |
| `03_INFORMATION_ARCHITECTURE.md` | Entity definitions (which entities permission keys reference). |
| `09_DATA_ARCHITECTURE.md` | Canonical entity matrix; ownership by core. |
| `11_EVENT_ARCHITECTURE.md` | Permission events (RoleAssigned, RoleRevoked, PermissionGranted). |
| `14_TENANT_ARCHITECTURE.md` | Tenant scoping, RLS policies. |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` | UI rendering respects permission decisions (but does not enforce). |
| `05_OPERATIONAL_ARCHITECTURE.md` | Super Admin audit, observability. |
| Standards files 15, 17 | Permission Registry (immutable keys); Security & Permission Standard (RBAC contract). |

| Documents that depend on this one |
|---|
| `10_API_ARCHITECTURE.md` (every endpoint declares permission keys it checks). |
| `02_DOMAIN_ARCHITECTURE.md` (domain API surface includes permission checks). |
| `04_NAVIGATION_ARCHITECTURE.md` (nav entries gated by permissions). |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (UI hiding is presentation, not authorization). |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` (approval permissions; Policy Core consumes `can(...)`). |
| `12_INTEGRATION_ARCHITECTURE.md` (external API clients authenticated and permission-checked). |
| `13_SECURITY_ARCHITECTURE.md` (threat controls + permission enforcement). |
| `15_REPORTING_ARCHITECTURE.md` (report queries filtered by user permissions). |
| `16_ANALYTICS_ARCHITECTURE.md` (analytics dashboards respect user scopes). |
| `18_OBSERVABILITY_ARCHITECTURE.md` (permission denial rates, Super Admin action frequency). |
| `21_AI_ARCHITECTURE.md` (AI-readable views enforce field-level security). |

## 15. Implementation Requirements

### 15.1 Permission Registry maintenance

The `docs/standards/15-permission-registry.md` file is LOCKED and immutable. Every new action (endpoint, data mutation, admin function) adds an entry to the registry **before** the PR merges. Entries follow the format:

```
`object.action` — description (e.g., "view a ticket", "approve a ticket").
```

Renaming or deleting a key requires a constitution amendment and deprecation period.

### 15.2 Permission check on every data-mutating endpoint

Every endpoint that writes to the database (POST, PUT, PATCH, DELETE) enforces a permission check before the write:

```python
assert_can(actor, "ticket.edit", ticket.org_node_path)  # or ticket.view, ticket.create, etc.
```

GET endpoints enforce a view check, either per-row (in list filters) or on detail endpoints.

### 15.3 Field-level security declaration

Sensitive fields (e.g., SSN, billing account number, internal comments) declare `view_roles` and/or `edit_roles` in `entity_def.field_defs`:

```python
{
  "key": "billing_account_number",
  "view_roles": ["billing_admin", "finance_director"],
  "edit_roles": ["finance_director"]
}
```

### 15.4 Audit and observability

Every permission grant, revoke, and check is:

- **Audited** in `audit_log` with actor, timestamp, entity, scope.
- **Published as an event** (RoleAssigned, RoleRevoked, PermissionGranted).
- **Observable in metrics** — permission-check frequency, denial rate, Super Admin action frequency.

### 15.5 RLS policy enforcement

Every tenant-scoped table has a Postgres RLS policy:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenantId = current_setting('app.tenant_id')::uuid);
```

The policy is applied automatically by ORM middleware before any query.

### 15.6 Super Admin audit trail

Every Super Admin action (`configuration.manage`) is logged with:

- Actor (user ID, email).
- Timestamp.
- Resource (entity type, entity ID).
- Change (before/after if applicable).
- Rationale (optional user-provided note).
- Session context (IP, user-agent, device).

## 16. Future Expansion Rules

### 16.1 Adding new permission keys

New keys are added to the Permission Registry (file 15) *before* the feature is implemented. The key must:

- Follow `object.action` format (lowercase, dot-separated).
- Be unique (never duplicate an existing key).
- Be immutable once released.
- Include a short description in the registry.

Keys are released in a minor version and frozen.

### 16.2 Deprecating a permission key

If a key is no longer used, it is **deprecated** (not deleted):

1. Document the deprecation in file 15 with a "DEPRECATED" marker.
2. Support reads of the key for one release (wildcard `*` and `object.*` still apply).
3. In the next minor version, remove the key from the registry.

Existing role grants using the deprecated key still evaluate (they just never match new actions).

### 16.3 Adding a new role type

New role types (e.g., custom tenant-defined roles) must:

1. Inherit from the core role model (`role_def`).
2. Use the same permission-key format and wildcard semantics.
3. Be subject to the same audit and scope rules.
4. Support the deny list.

### 16.4 Tenant-defined custom roles

Tenants may define custom roles (in the future, when multi-tenancy is enabled). Custom roles:

- Use the same `role_def` table (tenant-scoped).
- Use the same permission keys (no custom keys per tenant).
- Are subject to the same audit and scope rules.
- May be granted only by a Super Admin of that tenant.

### 16.5 Field-level security enhancements

Future enhancements to field-level security:

- **Data masking** — return redacted values for users without view_roles (e.g., SSN as `***-**-1234`).
- **Export controls** — fields with export restrictions cannot appear in CSV/Excel downloads for users without explicit export_roles.
- **Report-level controls** — reports themselves may have permission keys (e.g., `revenue_report.view`), separate from field-level controls.

## 17. Future Expansion Rules (Extended)

### 17.1 Scope enhancements

Future scope types may include:

- **Customer-scoped** — a user is granted a role for a specific customer only.
- **Service-scoped** — a user is granted a role for a specific service or resource.
- **Time-windowed** — role applies only during business hours, or on specific dates.

Each new scope type is added as a separate filter layer in the `can(...)` function and documented in this architecture.

### 17.2 Approval-chain enhancements

Approval permissions may evolve to support:

- **Escalation chains** — if approver A is unavailable, escalate to approver B.
- **Voting approvals** — require N of M approvers to agree.
- **Conditional approvals** — approval is required only if the change meets certain criteria.

These are implemented in the Approval Core (not Permission Core), but they depend on permission keys like `ticket.approve` existing.

### 17.3 Integration with policy engines

Policy Core may evolve to offer:

- **Dynamic role grants** — a policy evaluates conditions at request time and grants a temporary role (e.g., escalation to manager for urgent tickets).
- **Deny policies** — policies that revoke permissions based on conditions (e.g., suspend write access if a customer is on hold).

Permission Core provides the `can(...)` interface that Policy Core consumes.

---

*End of 08 — Permission Architecture.*
