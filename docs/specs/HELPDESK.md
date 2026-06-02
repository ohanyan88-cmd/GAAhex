# Helpdesk — Handoff (Batch 31: A31/B31/C31)

This document covers GAAhex's helpdesk system: how queues and tickets are managed, how SLA tracking
works, how the status state machine governs ticket lifecycle, and how the frontend renders queues,
ticket lists, and detail views with assignment and resolution workflows.

---

## 1. Overview

The helpdesk module enables support teams to organize incoming requests into named queues (e.g.,
"Tier-1 Support", "Network NOC"), create and track support tickets, assign tickets to agents,
and monitor SLA compliance. Tickets flow through a well-defined status state machine (OPEN → IN_PROGRESS
→ PENDING/RESOLVED/CLOSED), and the system automatically marks SLA violations via a scheduler job
(`helpdesk.sla_breach`).

The data model follows the same tenant + org-node scoping and audit patterns as billing and
interactions: all mutations emit workflow events, RLS (row-level security) gates access by tenant,
and permissions are granular (view/create/edit/delete for tickets, view/manage for queues).

---

## 2. Data Models

### HelpdeskQueue

**Model:** `backend/app/models/helpdesk.py:HelpdeskQueue`

A logical inbox/queue that tickets are routed into.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope (RLS-protected) |
| `owner_node_id` | UUID | Org node for access control; nullable |
| `name` | String(160) | Display name (required) |
| `description` | Text | Optional long description |
| `default_sla_minutes` | Integer | SLA window in minutes; nullable (tickets in this queue inherit this value at creation) |
| `created_at` | DateTime | Server timestamp |

### HelpdeskTicket

**Model:** `backend/app/models/helpdesk.py:HelpdeskTicket`

A support ticket optionally queued, assigned to an agent, and SLA-tracked.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope (RLS-protected) |
| `owner_node_id` | UUID | Org node for access control; nullable |
| `customer_id` | UUID | Links to CRM customer Record; nullable |
| `queue_id` | UUID | Which queue this ticket belongs to; nullable |
| `subject` | String(255) | Ticket title (required) |
| `body` | Text | Detailed description; nullable |
| `priority` | String(20) | One of: `LOW`, `NORMAL` (default), `HIGH`, `URGENT` |
| `status` | String(20) | One of: `OPEN`, `IN_PROGRESS`, `PENDING`, `RESOLVED`, `CLOSED` (see state machine) |
| `assigned_agent_id` | UUID | User assigned to this ticket; nullable |
| `sla_due_at` | DateTime | When SLA compliance expires; nullable (computed at ticket creation from queue's default_sla_minutes) |
| `sla_breached` | Boolean | True when sweep marks ticket past SLA; default false |
| `resolved_at` | DateTime | When ticket was marked RESOLVED; set at resolution, cleared at reopen |
| `created_at` | DateTime | Server timestamp |

**SLA Computation at Creation:**
If ticket is assigned to a queue that has `default_sla_minutes` set, `sla_due_at = now + timedelta(minutes=default_sla_minutes)`.
If no queue or queue has null `default_sla_minutes`, then `sla_due_at = null`.

---

## 3. API Endpoints

All endpoints are under `/api/helpdesk` and inherit RLS tenant isolation from the models.

### Queue Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/helpdesk/queues` | GET | `helpdesk_queue.view` | List queues (paginated, tenant-scoped) |
| `/api/helpdesk/queues` | POST | `helpdesk_queue.manage` | Create a new queue |
| `/api/helpdesk/queues/{queue_id}` | PATCH | `helpdesk_queue.manage` | Edit queue (name, description, default_sla_minutes) |
| `/api/helpdesk/queues/{queue_id}` | DELETE | `helpdesk_queue.manage` | Delete queue (no cascade; tickets remain) |

### Ticket Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/helpdesk/tickets` | GET | `helpdesk_ticket.view` | List tickets (filterable by status, queue, assignee, mine; paginated) |
| `/api/helpdesk/tickets` | POST | `helpdesk_ticket.create` | Create a new ticket |
| `/api/helpdesk/tickets/{ticket_id}` | GET | `helpdesk_ticket.view` (scoped) | Retrieve single ticket |
| `/api/helpdesk/tickets/{ticket_id}` | PATCH | `helpdesk_ticket.edit` (scoped) | Edit ticket (subject, body, priority, queue_id) |
| `/api/helpdesk/tickets/{ticket_id}/assign` | POST | `helpdesk_ticket.edit` (scoped) | Assign ticket to agent (auto-transitions OPEN → IN_PROGRESS) |
| `/api/helpdesk/tickets/{ticket_id}/resolve` | POST | `helpdesk_ticket.edit` (scoped) | Transition to RESOLVED, set resolved_at |
| `/api/helpdesk/tickets/{ticket_id}/reopen` | POST | `helpdesk_ticket.edit` (scoped) | Reopen from RESOLVED/CLOSED/PENDING → OPEN, clear resolved_at |
| `/api/helpdesk/tickets/{ticket_id}/close` | POST | `helpdesk_ticket.edit` (scoped) | Transition to CLOSED (final) |
| `/api/helpdesk/tickets/{ticket_id}` | DELETE | `helpdesk_ticket.delete` (scoped) | Delete ticket (audit-logged) |

---

## 4. Ticket Status State Machine

All tickets start in `OPEN`. The legal transitions are:

```
                        ┌──────────────────┐
                        │      OPEN        │
                        │   (new ticket)   │
                        └────────┬─────────┘
                                 │ [assign] (status → IN_PROGRESS)
                                 ▼
                        ┌──────────────────┐
                        │   IN_PROGRESS    │
                        │  (being worked)  │
                        └────┬──────────┬──┘
                     [resolve] │        │ [close]
                            │        │
                            ▼        ▼
                    ┌─────────────┐  CLOSED
                    │  RESOLVED   │  (final)
                    │ (fixed)     │
                    └────────┬────┘
                             │ [reopen]
                             ▼
                           OPEN

                        ┌──────────────────┐
                        │     PENDING      │
                        │  (awaiting info) │
                        └────────┬─────────┘
                                 │ [reopen]
                                 ▼
                               OPEN
```

### Detailed Transition Rules

| From Status | Transition | To Status | Endpoint | Notes |
|-------------|-----------|-----------|----------|-------|
| OPEN | (assign) | IN_PROGRESS | `/assign` | Auto-transition when assigned |
| OPEN | resolve | RESOLVED | `/resolve` | Sets resolved_at |
| OPEN | close | CLOSED | `/close` | Final state |
| IN_PROGRESS | resolve | RESOLVED | `/resolve` | Sets resolved_at |
| IN_PROGRESS | close | CLOSED | `/close` | Final state |
| PENDING | reopen | OPEN | `/reopen` | Clears resolved_at |
| PENDING | close | CLOSED | `/close` | Final state |
| RESOLVED | reopen | OPEN | `/reopen` | Clears resolved_at |
| RESOLVED | close | CLOSED | `/close` | Final state |
| CLOSED | — | (rejected) | — | No transitions from CLOSED; returns 409 |

### Error Cases (409 Conflict)

- **Resolve RESOLVED ticket:** Already resolved → 409
- **Resolve CLOSED ticket:** Cannot resolve closed ticket → 409
- **Reopen OPEN ticket:** Cannot reopen an open ticket → 409
- **Close CLOSED ticket:** Already closed → 409

### Assign Endpoint Logic

`POST /api/helpdesk/tickets/{ticket_id}/assign`

**Request body:**
```json
{
  "agent_id": "uuid-of-app_user"
}
```

**Behavior:**
1. Assign the agent via `assigned_agent_id = agent_id`.
2. If ticket is in OPEN status, automatically transition to IN_PROGRESS.
3. Emit audit event: `type="assign"`, include agent_id and new status.
4. Fire best-effort notification (fail-soft): `event_type="helpdesk_assign"` to notify the assignee.

**Error:**
- No agent_id → 422
- Invalid agent_id (no such user) → endpoint does NOT validate; user ID is trusted (ForeignKey enforces at DB level).

---

## 5. SLA Tracking & Breach Sweep

### SLA Setup

When a ticket is created in a queue with `default_sla_minutes` set (e.g., 480 minutes = 8 hours):

```python
sla_due_at = now + timedelta(minutes=default_sla_minutes)
sla_breached = False
```

The ticket is fully compliant until `now > sla_due_at`. The `sla_breached` flag remains false until
the sweep job explicitly marks it.

### SLA Breach Sweep Function

**Function:** `backend/app/routers/helpdesk.py:run_sla_breach_sweep(user: User, s: AsyncSession) -> dict`

This is a **scheduler-callable** function (not a FastAPI endpoint) that finds all tickets past their
SLA and marks them breached.

**Logic:**
1. Query all tickets in this tenant where:
   - `status IN (OPEN, IN_PROGRESS)` — only active tickets count toward SLA
   - `sla_due_at IS NOT NULL` — only tickets with an SLA
   - `sla_due_at < now` — past deadline
   - `sla_breached == FALSE` — not already marked
2. For each ticket found:
   - Set `sla_breached = TRUE`
   - Emit audit event: `type="sla_breach"`, include subject, sla_due_at, status
3. Record a JobRun (same pattern as billing.run_dunning): status=SUCCESS, summary={"breached": N}
4. Fire best-effort notification to the assigned agent (fail-soft)
5. Return summary dict: `{"breached": <count>}`

**Error Handling:**
- If any exception occurs during sweep, rollback the transaction, record JobRun with status=ERROR,
  and re-raise the exception.
- Notification failures are silent (fail-soft); they do not prevent the sweep from succeeding.

### Scheduler Integration

The sweep is registered as a scheduler job with key `"helpdesk.sla_breach"`. The coordinator calls
it on a cron schedule (e.g., every 5 minutes) via the scheduler framework:

```python
# In backend/app/scheduler.py or similar
await run_sla_breach_sweep(user=actor, s=s)
```

The function signature accepts `user=` and `s=` as kwargs so it can be called without FastAPI Depends.

---

## 6. Permissions Model

The helpdesk module uses four permission strings:

| Permission | Description |
|-----------|-------------|
| `helpdesk_queue.view` | Can list and view queues |
| `helpdesk_queue.manage` | Can create, edit, delete queues |
| `helpdesk_ticket.view` | Can list and view tickets |
| `helpdesk_ticket.create` | Can create new tickets |
| `helpdesk_ticket.edit` | Can edit ticket details and change status (resolve, reopen, assign, etc.) |
| `helpdesk_ticket.delete` | Can delete tickets |

### Default Grants (Provisional)

Based on GAAhex role architecture:

| Role | Permissions |
|------|-----------|
| `super_admin` | `helpdesk_queue.{view,manage}`, `helpdesk_ticket.{view,create,edit,delete}` |
| `manager` | `helpdesk_queue.{view,manage}`, `helpdesk_ticket.{view,create,edit,delete}` |
| `sales_agent` | `helpdesk_ticket.{view,create,edit}` |
| Other roles | `helpdesk_ticket.view` (read-only) |

Access is scoped by org node: a user only sees queues and tickets under their node hierarchy
(via `load_grants` and the `can()` helper in `backend/app/access.py`).

---

## 7. Frontend Architecture

**View:** `frontend/src/HelpdeskView.tsx`
**API client:** `frontend/src/helpdesk.ts`

### Layout & Navigation

The UI is split into three sections:

1. **Left Rail (Sidebar):** Queue list + "All tickets" nav button
   - Queues fetched on mount (via `loadQueues()`)
   - Queue counts derived from all loaded tickets
   - Clicking a queue sets `selectedQueue` and filters the ticket list
   - "New queue" button (visible if `canConfigure=true`; permission TBD)

2. **Top Header:** Title + "New ticket" button
   - Shows queue name if a queue is selected
   - "New ticket" opens `CreateTicketModal`

3. **Main Area:**
   - Filters bar: Status dropdown, Queue dropdown (if not queue-filtered), "My tickets" checkbox
   - Ticket table: Subject, Customer, Priority, Status, Assignee, SLA, Actions
   - Row action: "Open" button → `TicketDetailModal`

### Data Flow

**Load tickets:**
1. `useEffect` on `[token, statusFilter, queueFilter, mineOnly, selectedQueue]` calls `loadData()`
2. `listTickets(token, filters)` fetches filtered list
3. `listTickets(token, {})` fetches ALL tickets (no filter) to compute queue counts
4. `loadCustomers(token)` fetches customer names for display

**Create ticket:**
1. "New ticket" button → `CreateTicketModal`
2. User fills: Subject (required), Body, Priority, Queue, Customer ID
3. `createTicket(token, data)` posts to `/api/helpdesk/tickets`
4. Modal closes, `loadData()` refreshes list

**Create queue:**
1. "New queue" button (if `canConfigure=true`) → `CreateQueueModal`
2. User fills: Name (required), Description, Default SLA (minutes)
3. `createQueue(token, data)` posts to `/api/helpdesk/queues`
4. Modal closes, `loadQueues()` refreshes list

**Detail view:**
1. Click "Open" on a ticket row → `TicketDetailModal(id, ...)`
2. `getTicket(token, id)` loads full ticket data
3. Display: Meta (Customer, Priority, Status, Queue, SLA due, Created), Body, Assignee input, Actions buttons
4. Actions: Resolve (if OPEN/IN_PROGRESS/PENDING), Reopen (if RESOLVED/CLOSED/PENDING), Close (if not CLOSED)
5. Assignee is a **type-in UUID box** (no agent picker yet; deferred feature)
6. On action, call endpoint, toast success/error, reload via `load()`

### UI Components

#### Priority Pill
- URGENT → danger (red)
- HIGH → warning (orange)
- NORMAL → default (gray)
- LOW → muted (light gray)

#### Status Pill
- OPEN → info (blue)
- IN_PROGRESS → default (gray)
- PENDING → warning (orange)
- RESOLVED → success (green)
- CLOSED → muted (light gray)

#### SLA Badge
- `sla_breached=true` → pill-danger "Breached" + clock icon
- `sla_due_at` within 1 hour → pill-warning "Due soon" + clock icon
- `sla_due_at` in future → pill-muted with date (short format)
- No SLA → em-dash (muted)

### API Client (`frontend/src/helpdesk.ts`)

Type definitions:
```typescript
export type Queue = { id, name, description?, default_sla_minutes?, created_at? }
export type Ticket = { id, subject, body?, priority?, status?, customer_id?, queue_id?, 
                       assigned_agent_id?, sla_due_at?, sla_breached?, resolved_at?, created_at? }
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'
```

Functions (all use `bget/bpost/bpatch/bdel` for error handling):
- `listQueues(token)` → `Fetched<Queue[]>`
- `createQueue(token, {name, description?, default_sla_minutes?})` → `Queue`
- `listTickets(token, filters?)` → `Fetched<Ticket[]>` (filters: status, queue, assignee, mine)
- `getTicket(token, id)` → `Fetched<Ticket>`
- `createTicket(token, {subject, body?, priority?, queue_id?, customer_id?})` → `Ticket`
- `patchTicket(token, id, data)` → `Ticket` (generic partial update)
- `assignTicket(token, id, agent_id)` → `Ticket`
- `resolveTicket(token, id)` → `Ticket`
- `reopenTicket(token, id)` → `Ticket`
- `closeTicket(token, id)` → `Ticket`
- `deleteTicket(token, id)` → `void`

---

## 8. Database Migration

**Migration:** `backend/alembic/versions/d9f3b1e72c4a8051_helpdesk_tables.py`

Creates two tables with RLS policies:

- **helpdesk_queue:** id (PK), tenant_id (FK, indexed), owner_node_id (FK, nullable), name, description, default_sla_minutes, created_at
- **helpdesk_ticket:** id (PK), tenant_id (FK, indexed), owner_node_id (FK, nullable), customer_id (FK, indexed), queue_id (FK, indexed), subject, body, priority, status, assigned_agent_id, sla_due_at, sla_breached, resolved_at, created_at

Both tables have row-level security (RLS) with `NULLIF`-guarded `tenant_isolation` policy (tenant_id matches current_setting).

---

## 9. Audit & Notifications

### Audit Events

All mutations emit events via `workflow.emit(s, tenant_id, type, entity, record_id, actor_id, extra)`:

| Action | Type | Entity | Extra Data |
|--------|------|--------|-----------|
| Create queue | `create` | `helpdesk_queue` | {name, description?, default_sla_minutes?} |
| Update queue | `update` | `helpdesk_queue` | {changed: {...}} |
| Delete queue | `delete` | `helpdesk_queue` | {name} |
| Create ticket | `create` | `helpdesk_ticket` | {subject, priority, queue_id?, sla_due_at?} |
| Update ticket | `update` | `helpdesk_ticket` | {changed: {...}} |
| Assign ticket | `assign` | `helpdesk_ticket` | {agent_id, status} |
| Transition ticket | `transition` | `helpdesk_ticket` | {from, to} |
| SLA breach | `sla_breach` | `helpdesk_ticket` | {subject, sla_due_at, status} |
| Delete ticket | `delete` | `helpdesk_ticket` | {subject, status} |

### Notifications

Two notification hooks fire (best-effort, fail-soft):

1. **helpdesk_assign** (fired on assign endpoint):
   - `event_type="helpdesk_assign"`
   - `entity_key="helpdesk_ticket"`
   - `extra={ticket_id, agent_id}`

2. **sla_breach** (fired by sweep job for each breached ticket with assigned_agent_id):
   - `event_type="sla_breach"`
   - `entity_key="helpdesk_ticket"`
   - `extra={ticket_id, sla_due_at}`

Notification failures do not block the operation (fail-soft).

---

## 10. Tests

**Test file:** `backend/tests/test_helpdesk.py`

Coverage includes:

- Create queue with default_sla_minutes (Test 1)
- List queues, verify created queue included (Test 2)
- Create ticket in queue, verify sla_due_at populated (Test 3)
- Create ticket without queue, verify sla_due_at null (Test 4)
- List tickets after creation (Test 5)
- Filter tickets by status (Test 6)
- Filter tickets by queue (Test 7)
- Get single ticket by ID (Test 8)
- Get unknown ticket ID → 404 (Test 9)
- Assign ticket (Test 10, partial/placeholder)
- Resolve ticket (Test 11)
- Resolve closed ticket → 409 (Test 12)
- Reopen resolved ticket (Test 13)
- Close ticket (Test 14)
- Patch ticket subject/priority (Test 15)
- Delete ticket (Test 16)
- SLA breach sweep (Test 17)
- Tickets unauthenticated → 401/403 (Test 18)
- Queues unauthenticated → 401/403 (Test 19)

---

## 11. Deferred / Not Yet Built

The following features are planned but not yet implemented:

1. **Real agent picker:** Detail modal currently has a type-in UUID box. A future UI should display a dropdown of eligible agents (sales_agents, managers) and allow selection by name + ID.

2. **Linking Interactions to helpdesk tickets:** The `Interaction` model (from the interactions module) could reference `helpdesk_ticket` to keep conversation history tied to support tickets. Currently no such link exists.

3. **Escalation rules:** Auto-escalate tickets based on criteria (priority, SLA approach, queue depth, etc.).

4. **Queue auto-assignment:** Automatically assign new tickets to the least-busy agent in the queue rather than requiring manual assignment.

5. **Bulk actions:** Resolve/close multiple tickets at once from the list view.

---

## 12. Router Registration Note

The helpdesk router **must be registered BEFORE** the records router in `backend/app/main.py`.
Helpdesk endpoints are fixed under `/api/helpdesk`, so they must match before the generic
`/api/{entity}` paths in the records router. See the coordinator paste-lines at the bottom of
the Lane A31 report for the exact order.

---

## 13. Known Constraints

- **Agent ID input:** No validation that the provided agent_id is actually an eligible agent role. The frontend assumes the user knows the ID; a future picker UI is needed.
- **No cascade on queue delete:** Deleting a queue leaves orphaned tickets (queue_id remains as FK reference, but the queue is gone). A future migration might add ON DELETE CASCADE or soft-delete queues.
- **Ticket body immutable in detail view:** The detail modal shows the body as read-only. Currently, only subject and priority are editable via PATCH. Body edit is deferred.
- **Customer name lookup:** The frontend loads customer names via `loadCustomers()` (from the billing module). If a customer record is deleted, tickets still reference the ID; the UI shows the short ID.

---

End of Helpdesk Handoff. For integration questions, see the coordinator's batch 31 summary.
