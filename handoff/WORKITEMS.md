# Work Items — Handoff (Batch 32: A32/B32/C32/D32/E32)

This document covers GAAex's work items system: how discrete units of work (tasks, installs, repairs, surveys) are created, assigned to team members, tracked through a well-defined lifecycle, and dispatched to the field. The module is tenant-scoped with the same RLS (row-level security) and audit patterns as helpdesk and calendar; all mutations emit workflow events for compliance and traceability.

---

## 1. Overview

The work items module enables field-service and operations teams to organize, assign, and track work. A **work item** is a discrete unit of work assigned to a user, optionally tied to a customer record. The core workflow is **create → assign → start → complete**, with the ability to block (pause), cancel, and reopen. The system supports field dispatch through `scheduled_at` (when the work is scheduled) and `location` (address or GPS coords), enabling dispatch boards to filter work by date range and location.

Key features:
- **Assignment loop:** create a work item → pick an assignee from the `/api/users` picker → trigger notification webhook (fail-soft).
- **Field dispatch:** filter by `scheduled_at` date range (dispatch boards) and display `location` for navigation.
- **Status state machine:** `TODO` → `IN_PROGRESS` → `BLOCKED` / `DONE` / `CANCELLED` → optionally `TODO` (via reopen).
- **Priority & kind:** four work-item kinds (task, install, repair, survey) and four priorities (LOW, NORMAL, HIGH, URGENT) for categorization.
- **Tenant + org scoping:** same RLS policy as helpdesk; access control per `owner_node_id`.

---

## 2. Data Model

### WorkItem

**Model:** `backend/app/models/workitem.py:WorkItem`

A discrete unit of work assigned to a user and tracked to completion.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key (auto-generated) |
| `tenant_id` | UUID | Tenant scope (RLS-protected, indexed) |
| `owner_node_id` | UUID | Org node for access control; nullable |
| `title` | String(255) | Display name (required, non-empty on create/patch) |
| `description` | Text | Optional long description |
| `kind` | String(20) | One of: `task` (default), `install`, `repair`, `survey` |
| `status` | String(20) | One of: `TODO` (default), `IN_PROGRESS`, `BLOCKED`, `DONE`, `CANCELLED` (see state machine, section 4) |
| `priority` | String(20) | One of: `LOW`, `NORMAL` (default), `HIGH`, `URGENT` |
| `assigned_user_id` | UUID | User assigned to this work item; nullable, indexed |
| `customer_id` | UUID | Links to CRM customer Record; nullable, indexed |
| `due_at` | DateTime | Soft deadline; nullable (user-facing, no auto-enforcement) |
| `scheduled_at` | DateTime | When the work is scheduled (for field dispatch); nullable (e.g., 2026-05-28T14:00:00+00:00) |
| `location` | Text | Where the work happens (address, GPS coords, building); nullable; displayed in dispatch board |
| `completed_at` | DateTime | Set when status = `DONE`, cleared on reopen; nullable |
| `created_at` | DateTime | Server timestamp; indexed (descending order in list queries) |

**Constraints & Defaults:**
- `kind` defaults to `"task"` if omitted on create.
- `status` defaults to `"TODO"` on create.
- `priority` defaults to `"NORMAL"` on create.
- `created_at` is server-generated at insert time.
- RLS policy: `tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid`.

---

## 3. API Endpoints

All endpoints are under `/api/workitems` and inherit RLS tenant isolation from the model.

**Router registration:** The workitems router MUST be registered **before** the records router in `main.py` to avoid path conflicts (e.g., `/api/workitems` must be fixed, not a catch-all record path).

### List Work Items

**Endpoint:** `GET /api/workitems`

**Auth:** `workitem.view` permission (scoped to org node if `owner_node_id` is set).

**Query Parameters:**

| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `status` | string | `TODO` | Filter by status (exact match) |
| `assignee` | UUID | `550e8400-e29b-41d4-a716-446655440000` | Filter by assigned user |
| `mine` | boolean | `true` | Filter to work items assigned to caller |
| `kind` | string | `install` | Filter by kind (exact match) |
| `scheduled_from` | ISO datetime | `2026-05-28T00:00:00+00:00` | Lower bound for `scheduled_at` (inclusive) |
| `scheduled_to` | ISO datetime | `2026-05-30T23:59:59+00:00` | Upper bound for `scheduled_at` (inclusive) |
| `limit` | int | `200` | Pagination limit; default 200 |
| `offset` | int | `0` | Pagination offset; default 0 |

**Date Range Filtering (Dispatch Board):**
- `scheduled_from` and `scheduled_to` filter work items by `scheduled_at` (must be valid ISO 8601 strings with timezone info, e.g., `2026-05-28T00:00:00+00:00`).
- Both are optional; if omitted, no date-range constraint.
- If `scheduled_at` is null, the work item will not match any date range filter.

**Response:** 200 OK, array of `WorkItem` objects (see section 2).

**Pagination:** Results are ordered by `created_at` descending (newest first), then paginated by `limit` and `offset` on the client-filtered visible set (post-RLS, post-permission check).

### Get Work Item

**Endpoint:** `GET /api/workitems/{workitem_id}`

**Auth:** `workitem.view` permission (scoped to org node of the work item's `owner_node_id`).

**Response:** 200 OK, single `WorkItem` object. Returns 404 if not found or not in caller's tenant.

### Create Work Item

**Endpoint:** `POST /api/workitems`

**Auth:** `workitem.create` permission (scoped to org node).

**Request Body:**
```json
{
  "title": "Fix network link",
  "description": "Repair optical line at main office",
  "kind": "repair",
  "priority": "HIGH",
  "assigned_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "customer_id": "550e8400-e29b-41d4-a716-446655440001",
  "due_at": "2026-06-01T17:00:00+00:00",
  "scheduled_at": "2026-05-29T10:00:00+00:00",
  "location": "123 Main St, Yerevan"
}
```

**Validation:**
- `title` required, non-empty string (leading/trailing whitespace stripped).
- `kind` optional, must be one of `{task, install, repair, survey}` (case-insensitive, stored lowercase); defaults to `"task"`.
- `priority` optional, must be one of `{LOW, NORMAL, HIGH, URGENT}` (case-insensitive, stored uppercase); defaults to `"NORMAL"`.
- `description`, `assigned_user_id`, `customer_id`, `due_at`, `scheduled_at`, `location` optional.
- Datetime fields (due_at, scheduled_at) accept ISO 8601 strings; invalid format → 422 error.

**Behavior:**
- Sets `owner_node_id` to caller's `primary_node_id`.
- Sets `status = "TODO"`, `created_at = now()` (server-side).
- Emits workflow event: `{"type": "create", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"title": ..., "kind": ..., "priority": ...}}`.

**Response:** 201 Created, the created `WorkItem` object.

### Patch Work Item

**Endpoint:** `PATCH /api/workitems/{workitem_id}`

**Auth:** `workitem.edit` permission (scoped to org node).

**Request Body:** (all fields optional)
```json
{
  "title": "New title",
  "description": "Updated details",
  "kind": "task",
  "priority": "URGENT",
  "customer_id": "...",
  "due_at": "2026-06-02T12:00:00+00:00",
  "scheduled_at": "2026-05-30T14:00:00+00:00",
  "location": "Updated address"
}
```

**Validation:**
- `title` if present, must be non-empty (whitespace stripped).
- `kind`, `priority` validated as in create.
- Datetime fields validated as in create.

**Behavior:**
- Updates only fields present in payload.
- Emits workflow event: `{"type": "update", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"changed": {...}}}`.
- Returns 200 OK with updated `WorkItem` object.

### Assign Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/assign`

**Auth:** `workitem.edit` permission (scoped to org node).

**Request Body:**
```json
{
  "user_id": "550e8400-e29b-41d4-a716-446655440002"
}
```

**Validation:**
- `user_id` required.

**Behavior:**
- Sets `assigned_user_id` to the specified user.
- Emits workflow event: `{"type": "assign", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"assigned_user_id": <user_id>}}`.
- Attempts to fire a notification webhook (event_type = `"workitem_assign"`) to notify the assignee; **fail-soft** — if notification fails, assignment completes anyway.
- Returns 200 OK with updated `WorkItem` object.

### Start Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/start`

**Auth:** `workitem.edit` permission (scoped to org node).

**Behavior:**
- Transitions status `TODO` → `IN_PROGRESS`.
- Legal from: `TODO`, `BLOCKED`.
- Illegal transitions (409 Conflict):
  - Already `IN_PROGRESS`: "WorkItem is already IN_PROGRESS".
  - From `DONE` or `CANCELLED`: "Cannot start a DONE/CANCELLED WorkItem".
- Emits workflow event: `{"type": "transition", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"from": ..., "to": "IN_PROGRESS"}}`.
- Returns 200 OK with updated `WorkItem` object.

### Complete Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/complete`

**Auth:** `workitem.edit` permission (scoped to org node).

**Behavior:**
- Transitions any status → `DONE`, sets `completed_at = now()`.
- Illegal transitions (409 Conflict):
  - Already `DONE`: "WorkItem is already DONE".
  - From `CANCELLED`: "Cannot complete a CANCELLED WorkItem".
- Emits workflow event: `{"type": "transition", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"from": ..., "to": "DONE", "completed_at": ...}}`.
- Returns 200 OK with updated `WorkItem` object.

### Block Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/block`

**Auth:** `workitem.edit` permission (scoped to org node).

**Behavior:**
- Transitions status → `BLOCKED` (pause; allows resume later).
- Legal from: `TODO`, `IN_PROGRESS`.
- Illegal transitions (409 Conflict):
  - Already `BLOCKED`: "WorkItem is already BLOCKED".
  - From `DONE` or `CANCELLED`: "Cannot block a DONE/CANCELLED WorkItem".
- Emits workflow event: `{"type": "transition", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"from": ..., "to": "BLOCKED"}}`.
- Returns 200 OK with updated `WorkItem` object.

### Cancel Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/cancel`

**Auth:** `workitem.edit` permission (scoped to org node).

**Behavior:**
- Transitions status → `CANCELLED` (terminal, but reopenable).
- Legal from: `TODO`, `IN_PROGRESS`, `BLOCKED`.
- Illegal transitions (409 Conflict):
  - Already `CANCELLED`: "WorkItem is already CANCELLED".
  - From `DONE`: "Cannot cancel a DONE WorkItem".
- Emits workflow event: `{"type": "transition", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"from": ..., "to": "CANCELLED"}}`.
- Returns 200 OK with updated `WorkItem` object.

### Reopen Work Item

**Endpoint:** `POST /api/workitems/{workitem_id}/reopen`

**Auth:** `workitem.edit` permission (scoped to org node).

**Behavior:**
- Transitions status → `TODO`, clears `completed_at = null`.
- Legal from: `DONE`, `CANCELLED`, `BLOCKED`.
- Illegal transitions (409 Conflict):
  - From `TODO` or `IN_PROGRESS`: "Cannot reopen a WorkItem with status TODO/IN_PROGRESS (only from: {BLOCKED, CANCELLED, DONE})".
- Emits workflow event: `{"type": "transition", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"from": ..., "to": "TODO"}}`.
- Returns 200 OK with updated `WorkItem` object.

### Delete Work Item

**Endpoint:** `DELETE /api/workitems/{workitem_id}`

**Auth:** `workitem.delete` permission (scoped to org node).

**Behavior:**
- Deletes the work item from the database.
- Emits workflow event: `{"type": "delete", "entity": "workitem", "entity_id": <id>, "actor_id": <caller>, "extra": {"title": ..., "status": ...}}`.
- Returns 204 No Content.

---

## 4. Status State Machine

A work item progresses through a well-defined lifecycle. The state machine restricts illegal transitions and enforces compliance.

```
                    ┌─── TODO ───┐
                    │            │
                    ↓            ↓
                IN_PROGRESS    BLOCKED
                    │            │
                    ├────┬────────┘
                    ↓    ↓
                   DONE  CANCELLED
                    └────┬────────┘
                         ↓
                       TODO (reopen)
```

### Allowed Transitions

| From | To | Endpoint | Notes |
|------|----|-----------|----|
| `TODO` | `IN_PROGRESS` | `/start` | Begin work |
| `TODO` | `BLOCKED` | `/block` | Pause before starting |
| `TODO` | `CANCELLED` | `/cancel` | Abandon |
| `IN_PROGRESS` | `DONE` | `/complete` | Finish (sets `completed_at`) |
| `IN_PROGRESS` | `BLOCKED` | `/block` | Pause mid-work |
| `IN_PROGRESS` | `CANCELLED` | `/cancel` | Abandon mid-work |
| `BLOCKED` | `IN_PROGRESS` | `/start` | Resume |
| `BLOCKED` | `CANCELLED` | `/cancel` | Give up |
| `BLOCKED` | `TODO` | `/reopen` | Restart from beginning |
| `DONE` | `TODO` | `/reopen` | Undo completion |
| `CANCELLED` | `TODO` | `/reopen` | Undo cancellation |

### Illegal Transitions & HTTP 409 Responses

- **Start from `IN_PROGRESS`:** "WorkItem is already IN_PROGRESS"
- **Start from `DONE`/`CANCELLED`:** "Cannot start a DONE/CANCELLED WorkItem"
- **Complete from `DONE`:** "WorkItem is already DONE"
- **Complete from `CANCELLED`:** "Cannot complete a CANCELLED WorkItem"
- **Block from `BLOCKED`:** "WorkItem is already BLOCKED"
- **Block from `DONE`/`CANCELLED`:** "Cannot block a DONE/CANCELLED WorkItem"
- **Cancel from `CANCELLED`:** "WorkItem is already CANCELLED"
- **Cancel from `DONE`:** "Cannot cancel a DONE WorkItem"
- **Reopen from `TODO`/`IN_PROGRESS`:** "Cannot reopen a WorkItem with status TODO/IN_PROGRESS (only from: {BLOCKED, CANCELLED, DONE})"

---

## 5. Permissions Model

Work items follow GAAex's standard permission pattern: granular per-action (view, create, edit, delete) and scoped to the org node (`owner_node_id`).

| Permission | Scope | Applies To | Typical Roles |
|------------|-------|-----------|---------------|
| `workitem.view` | Org node | List, GET single | manager, sales_agent, super_admin |
| `workitem.create` | Org node | POST create | sales_agent, manager, super_admin |
| `workitem.edit` | Org node | PATCH, assign, transitions (start/complete/block/cancel/reopen) | manager, sales_agent, super_admin |
| `workitem.delete` | Org node | DELETE | manager, super_admin |

**Permission Flow:**
1. Check if user has permission for the action (e.g., `workitem.view`).
2. If scoped, also check if user's org node hierarchy includes the work item's `owner_node_id`.
3. If either check fails → 403 Forbidden.

**RLS:** All queries are protected by tenant-level RLS; the system also enforces row-level node scoping via the permission system.

---

## 6. Users Endpoint (Assignment Picker)

### GET /api/users

**Auth:** Any authenticated user (no specific permission gate; returns tenant-scoped data).

**Query Parameters:**

| Param | Type | Example | Description |
|-------|------|---------|-------------|
| `q` | string | `agent` | Case-insensitive substring filter on name or email |

**Response:** 200 OK, array of `User` objects.

**User Model (Serialization):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Alice Manager",
  "email": "alice@demo.isp",
  "primary_node_id": "550e8400-e29b-41d4-a716-446655440001"
}
```

**Notes:**
- `password_hash` is **never** returned (safe for public consumption).
- Results are ordered by `name` (nulls last), then `email`.
- Filter (`q`) performs a case-insensitive substring match on `name` or `email`; e.g., `?q=agent` returns users with "agent" in name or email.

**Behavior & Caching:**
- Frontend `UserPicker` component caches the user list per token; multiple pickers share the same fetch.
- Backend imposes no cache; each request hits the database.

**Cross-Module Use:**
- **WorkItemsView:** Uses `UserPicker` to assign work items.
- **HelpdeskView:** Uses `UserPicker` to assign tickets (now back-filled as of Batch 32).
- Any future module that needs user assignment can reuse this endpoint.

---

## 7. Frontend Architecture

### Main View: `WorkItemsView.tsx`

Root component that renders the work items list, filters, and modals.

**UI Structure:**
- **Header:** "Work Items" title + "New item" button.
- **Toolbar:** Tab selector (Active | All | Mine) + Status filter (on All/Mine) + Kind filter.
- **Table:** Columns: Title, Kind, Customer, Status, Priority, Assignee, Due, Scheduled.
- **Row Actions:** Status-specific buttons (Start, Complete, Block, Cancel, Reopen) + Edit + context (row becomes a clickable item for detail).

**Tabs:**
- **Active:** `status !== DONE && status !== CANCELLED` (client-side filtering).
- **All:** All work items (no filter).
- **Mine:** `assigned_user_id === currentUser.id`.

**Filters:**
- **Status:** Only visible on All/Mine tabs (Active tab is hardcoded above).
- **Kind:** Visible on all tabs; filters by kind (task, install, repair, survey).

**Data Flow:**
1. On mount: load users via `listUsers()` for the UserPicker (stored in state).
2. Load work items via `listWorkItems(filters)` on tab/filter change.
3. Load customer names via `loadCustomers()` (from billing module) to display customer_id as a name.
4. Click row → open detail modal; click Edit → same modal.
5. Click New Item → open create modal.

### Detail/Edit Modal: `WorkItemDetailModal`

Edit existing work item (or view-only if no permission).

**Fields:**
- Title (required, text input).
- Description (optional, textarea).
- Kind (select: task, install, repair, survey).
- Priority (select: LOW, NORMAL, HIGH, URGENT).
- Assignee (UserPicker dropdown, optionally via `/api/users`).
- Customer ID (text input; optional, stores UUID).
- Due (datetime-local input).
- Scheduled (datetime-local input).
- Location (text input; field dispatch address/coords).

**Timestamps (read-only):**
- Created (formatted).
- Completed (if set; formatted).

**Actions (conditional on status):**
- `TODO`: Start button.
- `IN_PROGRESS`: Complete + Block buttons.
- `BLOCKED`: Resume (reopen to TODO or start to IN_PROGRESS) + Cancel button.
- `TODO`/`IN_PROGRESS`/`BLOCKED`: Cancel button.
- `DONE`/`CANCELLED`: Reopen button.

**Delete:** Red trash icon in footer; confirms before delete.

### Create Modal: `CreateWorkItemModal`

Similar field layout to detail modal, minus timestamps.

**Submit:** "Create" button saves and closes modal, triggering refresh of list.

### UserPicker Component: `UserPicker.tsx`

Reusable dropdown for assignee selection.

**Props:**
- `token`: Auth token.
- `value`: Selected user_id (or empty string for unassigned).
- `onChange`: Callback when selection changes.
- `disabled`: Optional disable flag.
- `aria-label`: Accessibility label.
- `className`: Optional class name (defaults to `inp inp-md`).

**Behavior:**
- On mount: loads users via `listUsers(token)`.
- Caches user list in module-level state so multiple pickers don't re-fetch.
- Displays "Loading users…" while loading; "Unassigned" when no user selected.
- Maps each user to an option via `resolveUserName(user)` (name > email > short id).

### API Client: `workitems.ts`

Helper functions for all endpoints.

**Types:**
- `WorkItemKind`: `'task' | 'install' | 'repair' | 'survey'`
- `WorkItemStatus`: `'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'`
- `WorkItemPriority`: `'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'`
- `WorkItem`: Full object schema.
- `WorkItemCreate`: Request payload for create.
- `WorkItemPatch`: Request payload for patch (all optional, title included).
- `WorkItemFilters`: Query parameter object for list.

**Functions:**
- `listWorkItems(token, filters)`: GET `/api/workitems` with filters.
- `getWorkItem(token, id)`: GET `/api/workitems/{id}`.
- `createWorkItem(token, data)`: POST `/api/workitems`.
- `patchWorkItem(token, id, data)`: PATCH `/api/workitems/{id}`.
- `assignWorkItem(token, id, user_id)`: POST `/api/workitems/{id}/assign` (less commonly used in UI; detail modal uses patchWorkItem with assigned_user_id instead).
- `startWorkItem(token, id)`: POST `/api/workitems/{id}/start`.
- `completeWorkItem(token, id)`: POST `/api/workitems/{id}/complete`.
- `blockWorkItem(token, id)`: POST `/api/workitems/{id}/block`.
- `cancelWorkItem(token, id)`: POST `/api/workitems/{id}/cancel`.
- `reopenWorkItem(token, id)`: POST `/api/workitems/{id}/reopen`.
- `deleteWorkItem(token, id)`: DELETE `/api/workitems/{id}`.

### API Client: `users.ts`

Helper for the users endpoint.

**Types:**
- `User`: `{ id, name, email, primary_node_id, [k]: any }`.

**Functions:**
- `listUsers(token, q?)`: GET `/api/users`, optionally with `?q=<query>` filter.
- `resolveUserName(user)`: Maps user object to display string (name > email > short id).

---

## 8. Database Schema & RLS

### Table: `workitem`

**Columns:** (see section 2, Model)

**Indexes:**
- `ix_workitem_tenant_id`: On `tenant_id` (RLS filtering).
- `ix_workitem_assigned_user_id`: On `assigned_user_id` (filter by assignee).
- `ix_workitem_customer_id`: On `customer_id` (link to records).

**Migration:** `backend/alembic/versions/a1f4c8e23d709b52_workitem_tables.py`

**RLS Policy:**
```sql
ALTER TABLE workitem ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workitem
  USING (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid);
```

**Foreign Keys:**
- `tenant_id` → `tenant.id`
- `owner_node_id` → `org_node.id` (nullable)
- `assigned_user_id` → `app_user.id` (nullable)
- `customer_id` → `record.id` (nullable, allows linking to CRM records)

---

## 9. Dispatch Board Filters

The `scheduled_from` and `scheduled_to` query parameters power field-dispatch boards. A typical dispatch board:

1. Shows work items scheduled for a date range (e.g., today).
2. Filters by `scheduled_at` between start-of-day and end-of-day.
3. Displays location for each work item (for navigation or routing).
4. May filter by assignee to show one technician's scheduled work.

**Example Request:**
```
GET /api/workitems?scheduled_from=2026-05-28T00:00:00%2B00:00&scheduled_to=2026-05-28T23:59:59%2B00:00&kind=install
```

**Response:** Work items scheduled for 2026-05-28 of kind "install", with location displayed in the row.

---

## 10. Permissions & Access Control

### Permission Checks

Every endpoint (except `/api/users`) checks:
1. `can(grants, "workitem", <action>, owner_node)` where `<action>` ∈ {view, create, edit, delete}.
2. If the check fails → 403 Forbidden with message "Not allowed: workitem.<action>".

### Default Permission Map (by role)

| Role | Permissions |
|------|-----------|
| `super_admin` | workitem.{view, create, edit, delete} (all org nodes) |
| `manager` | workitem.{view, create, edit, delete} (scoped to own org node) |
| `sales_agent` | workitem.{view, create, edit} (scoped to own org node) |
| Field technician | workitem.view (scoped to own org node); can start/complete own assigned items |

(Exact roles and permissions are configurable in the Studio; the above are example defaults.)

---

## 11. Workflow Events & Audit

All mutations emit workflow events for audit and compliance.

**Event Structure:**
```json
{
  "entity": "workitem",
  "entity_id": "<workitem_id>",
  "type": "<action>",
  "actor_id": "<user_id>",
  "extra": { ... }
}
```

**Examples:**

**Create:**
```json
{
  "type": "create",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "title": "Fix network", "kind": "repair", "priority": "HIGH" }
}
```

**Assign:**
```json
{
  "type": "assign",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "assigned_user_id": "550e8402..." }
}
```

**Transition (Start):**
```json
{
  "type": "transition",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "from": "TODO", "to": "IN_PROGRESS" }
}
```

**Transition (Complete):**
```json
{
  "type": "transition",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "from": "IN_PROGRESS", "to": "DONE", "completed_at": "2026-05-27T15:30:00+00:00" }
}
```

**Update:**
```json
{
  "type": "update",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "changed": { "title": "New title", "priority": "URGENT", "scheduled_at": "2026-05-29T10:00:00+00:00" } }
}
```

**Delete:**
```json
{
  "type": "delete",
  "entity": "workitem",
  "entity_id": "550e8400...",
  "actor_id": "550e8401...",
  "extra": { "title": "Fix network", "status": "TODO" }
}
```

---

## 12. Notification Hooks

When a work item is **assigned**, the system attempts to fire a webhook of type `workitem_assign`:

```python
await notify_hooks.fire(
    s,
    tenant_id=user.tenant_id,
    event_type="workitem_assign",
    entity_key="workitem",
    record=w,
    actor_user_id=user.id,
    extra={"workitem_id": str(w.id), "user_id": str(user_id)}
)
```

**Behavior:**
- **Fail-soft:** If the webhook request fails (network error, timeout, hook not registered), the assignment is NOT rolled back; the work item is still assigned.
- **Recipient:** The assignee (user_id) is notified (e.g., via Slack, email, in-app notification).
- **Studio Configurable:** Hook URL and retry logic are configured in the Studio (see handoff docs).

---

## 13. Tests

Comprehensive test coverage in `backend/tests/test_workitems.py` and `backend/tests/test_users.py`.

### Work Items Tests (20 tests)
- Create (title only, with kind/scheduled_at/location).
- List (basic, with status/kind/assignee/date-range filters, mine filter).
- Get by ID (success, 404).
- Patch (title/priority/scheduled_at).
- Assign (set assigned_user_id).
- Transitions (start, complete, block, cancel, reopen; illegal transitions → 409).
- Delete.
- Auth gates (unauthenticated, permission checks).

### Users Tests (4 tests)
- List users (basic, with substring filter, ordering).
- Auth gates (unauthenticated).

Run tests:
```bash
cd backend
pytest tests/test_workitems.py tests/test_users.py -v
```

---

## 14. Deferred / Not Yet Built

The following features are outlined in the design prototype or backlog but not yet implemented:

### Calendar Tie-In
- **CalendarView** should display scheduled work items (where `scheduled_at` is not null) on the calendar.
- Requires adding a "Work Items" calendar or rendering WorkItems as events on the calendar grid.
- Scope: Display scheduled_at as a full-day or timed event; link to WorkItemsView for details.

### Recurring Work
- Support recurring work items (e.g., "Weekly network audit", "Monthly customer follow-up").
- Requires adding a recurrence pattern field and a scheduler job to auto-create instances.
- Scope: Define recurrence schema (daily, weekly, monthly); auto-generate future instances; manage cascade updates.

### SLA-at-Risk Tab & Metrics
- The design prototype includes a dashboard showing work items at risk of missing SLA (due_at overdue).
- Requires adding SLA computation logic (auto-set due_at from SLA policy) and a scheduler job to mark breached items.
- Scope: Add SLA fields; display at-risk items in a dedicated tab; emit alerts.

### Bulk Operations
- Bulk assign, status transition, or delete of multiple work items at once.
- Requires POST `/api/workitems/bulk` endpoint with a list of IDs and an action.
- Scope: Define bulk action payloads; validate permissions for each item; emit batch event.

### WorkItem Movement Engine (Studio-Configurable Stages)
- Currently, work-item status is hardcoded (TODO, IN_PROGRESS, BLOCKED, DONE, CANCELLED).
- Vision: Allow Studio to define custom stages (e.g., "Scheduled", "Assigned", "On-Site", "Completed", "Rescheduled") and drag-drop stage transitions.
- Requires a new `workitem_stage` configuration table and a workflow state-machine definition language.
- Scope: Refactor status to a pluggable stage system; define configuration schema; update frontend UI to render custom stages.

---

## 15. Key Implementation Notes

### Path Namespacing
The workitems router is registered **before** the records router in `main.py` to avoid conflicts:
```python
app.include_router(workitems.router)  # /api/workitems fixed
app.include_router(records.router)    # /api/records/* (catch-all)
```

### DateTime Handling
- All datetimes are stored and transmitted as ISO 8601 strings with timezone info (e.g., `2026-05-27T15:30:00+00:00`).
- Frontend `datetime-local` inputs use a simple slice to extract the first 16 characters (YYYY-MM-DDTHH:MM), losing timezone info on the client; the backend interprets as UTC.
- For dispatch boards, always include timezone in query params: `?scheduled_from=2026-05-28T00:00:00%2B00:00`.

### Pagination & Filtering
- The `listWorkItems` endpoint applies filters *before* pagination: RLS + permission checks → filter by status/kind/assignee/date-range → order by created_at descending → paginate by limit/offset.
- Client-side "Active tab" filtering (removing DONE/CANCELLED) happens *after* the full paginated list is returned; counts may not be exact if the full result set is large.

### Assignment Flow
1. User clicks on a work item row or opens the detail modal.
2. Selects an assignee from the UserPicker dropdown (backed by `/api/users`).
3. Modal auto-saves via `patchWorkItem` or user clicks Save.
4. Backend sets `assigned_user_id` and fires a `workitem_assign` notification webhook (fail-soft).
5. UI refreshes the work item and toasts success.

### Field Dispatch
- **Location Field:** Free-form text; can be an address (e.g., "123 Main St, Yerevan"), GPS coords (e.g., "40.1699° N, 44.5058° E"), or a building code.
- **Scheduled At:** ISO datetime when the work should begin; used for dispatch boards to filter by date range.
- **Dispatch Board (Deferred):** A future view that groups work items by scheduled date/time and location, allowing field teams to plan routes and see resource availability.

### Permissions & Org Scoping
- Every action is gated by both permission (`workitem.<action>`) and org-node scope (caller's node must be an ancestor of or equal to `owner_node_id`).
- If a work item has no `owner_node_id`, it's accessible to anyone in the tenant (assuming they have the permission).
- The permission system is flexible: a `manager` can be granted full permissions on a sub-node; a `sales_agent` can have limited edit permissions.

---

## 16. Summary

The work items module provides a flexible, configurable task-management system for ISP operations teams. It integrates with:
- **Users:** Assignment picker + notification hooks.
- **Records (CRM):** Customer linking for context.
- **Billing:** Customer name resolution.
- **Calendar:** (Deferred) Display scheduled work items on calendar view.
- **Workflow/Audit:** Event logging for all mutations.

The state machine, permissions, and RLS ensure data integrity and compliance. The field-dispatch filters enable teams to organize and execute work in the field. The module is ready for production use and extensible for future enhancements (SLA, recurring work, bulk operations, custom stages).
