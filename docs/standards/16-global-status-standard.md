# Global Status Standard (file 16)

LOCKED. Resolves the SOURCE NOT PROVIDED placeholder for **Global Status** (display-order #2 in
the index; this is file 16 in `docs/standards/`).
Written code-accurate against `status_def` (models/meta.py), `seed_statuses.py`, and SPEC §7.

## 1. What a status is
A status is a **lifecycle state** of a record — where it sits in its own progression (Draft → …
→ terminal). Status is stored per entity in `status_def`, one row per allowed value.

Status is **not**:
- a pipeline **stage** — stages live in `stage_def` (§3, Pipeline) and are a separate axis;
- a **deletionState** — soft-delete/active is a separate field (D14), never folded into status;
- an **enum lifecycle** — the ACTIVE/DEPRECATED governance of an enum value is unrelated.

## 2. Storage + keys
`status_def`: `id, tenantId, entityDefId, key, label, order, isInitial, isTerminal`.
- `key` is **UPPER_SNAKE** (Enum Standard, file 03). Display labels convert to keys by:
  uppercase, non-alphanumeric runs → `_`, trim (`"Waiting for Customer"` → `WAITING_FOR_CUSTOMER`,
  `"On Route"` → `ON_ROUTE`, `"Partially Paid"` → `PARTIALLY_PAID`).
- `isInitial`: exactly **one** per entity — the state a new record enters. Seeding must never
  create a second `isInitial` row (existing initial wins). This is enforced at seed time only;
  recommended hardening is a DB partial unique index
  (`CREATE UNIQUE INDEX ... ON status_def (entity_def_id) WHERE is_initial`) so a buggy writer
  cannot create a second initial. (Future Alembic line; not a blocker.)
- `isTerminal`: the lifecycle stops here; no outbound transition except an explicit re-entry
  (e.g. Ticket `CLOSED` → `REOPENED` is a new, explicit transition, not a continuation).
- `order`: display order within the set.
- Tenant-scoped: each tenant gets its own `status_def` rows; vocabularies are seeded per tenant
  and are idempotent.

## 3. Canonical status vocabularies (SPEC §7 — LOCKED, 9 sets)
Keys shown UPPER_SNAKE; **(I)** = initial, **(T)** = terminal.

- **General** (default set for any entity without a specific set):
  `DRAFT (I), NEW, OPEN, IN_PROGRESS, WAITING, PENDING_APPROVAL, APPROVED, REJECTED (T),
  COMPLETED (T), CANCELLED (T), CLOSED (T), ARCHIVED (T)`
- **Lead:** `NEW (I), WORKING, QUALIFIED, DISQUALIFIED (T), CONVERTED (T)`
- **Contract:** `DRAFT (I), SENT, SIGNED, ACTIVE, AMENDED, TERMINATED (T), EXPIRED (T)`
- **Order:** `CREATED (I), IN_VALIDATION, VALIDATED, REJECTED (T), FULFILLED (T), CANCELLED (T)`
- **Ticket:** `NEW (I), ASSIGNED, IN_PROGRESS, WAITING_FOR_CUSTOMER, WAITING_FOR_INTERNAL,
  ESCALATED, RESOLVED, CLOSED (T), REOPENED`
  (RESOLVED is **not** terminal — it can go to CLOSED or REOPENED; CLOSED is the lifecycle end.)
- **Work Order:** `NEW (I), SCHEDULED, ASSIGNED, ON_ROUTE, IN_PROGRESS, COMPLETED (T),
  FAILED (T), RESCHEDULED, CANCELLED (T)`
- **Invoice:** `DRAFT (I), ISSUED, SENT, PARTIALLY_PAID, PAID (T), OVERDUE, CANCELLED (T),
  CREDITED (T)`
  (OVERDUE is **not** terminal — collections can move it to PAID. Invoices are never deleted,
  only state-changed — §0.3.)
- **Payment:** `PENDING (I), SUCCESSFUL, FAILED (T), REFUNDED, PARTIALLY_REFUNDED, RECONCILED (T),
  CHARGEBACK (T)`
- **Service:** `PENDING (I), ACTIVE, SUSPENDED, DISCONNECTED (T), CANCELLED (T),
  PROVISIONING_FAILED (T), UNDER_MAINTENANCE`

New status values or sets require platform approval; a tenant may not invent statuses ad hoc.

## 4. Entity → set mapping
- General set anchors on the sentinel `general` entity (created on demand) and is the fallback.
- Lead and Payment also anchor on on-demand sentinels (`lead`, `payment`) until first-class
  catalog entities ship; the vocabulary stays queryable regardless.
- Ticket vocabulary applies to **both** `ticket` and `helpdesk_ticket`; Work Order to **both**
  `work_order` and `workitem`.
- When no entity matches a set and no sentinel covers it, seeding logs a warning and skips that
  set until the entity exists.

## 5. Transitions
- Status changes go through **guarded transitions**, not free PATCH. The allowed transitions for
  an entity lifecycle live in `workflow_def` (legacy entity-lifecycle shape, `config.transitions`)
  and are enforced by the workflow engine; an illegal transition is rejected.
- Every accepted status change **emits a `STATUS_CHANGED` event** (Event System, file 06) — a
  mandatory first-class timeline category (file 04). The event carries old → new status.
  *Substrate note:* today the code emits these as `event.type = "transition"` (the append-only
  event substrate, `routers/records.py`, `services.py`, `helpdesk.py`, `workitems.py`); the
  literal `eventName = STATUS_CHANGED` becomes real when the Event System extension lands
  (D1 projection + the `eventName` field). Until then, "transition" events are the substrate.
- A terminal status accepts no outbound transition except an explicit, modelled re-entry
  (Ticket `CLOSED` → `REOPENED`). Re-entry is a new transition with its own event.

## 6. Relationship to other standards
- **Pipeline stages (§3, file 11)** are a separate axis from status; a record has both a stage and
  a status. The Pipeline-Stage vocabulary is **not** seeded into `status_def` — it lives in
  `stage_def`.
- **Audit/Timeline (file 04):** `STATUS_CHANGED` is the canonical status-history event.
- **Financial immutability (§0.3):** invoice/payment records are never deleted; their lifecycle is
  expressed entirely through status (terminal = `PAID`/`CANCELLED`/`CREDITED`,
  `RECONCILED`/`CHARGEBACK`/`FAILED`).
- **Deletion (D14):** active/deleted is a separate `deletionState`, never a status value.
