# SPEC §8 Customer Timeline — Step 6

Read-only feed of a single customer's history. One endpoint:

```
GET /api/customers/{customer_id}/timeline?limit=&before_ts=
```

Newest-first projection over the audit `event` table. Permission is the same grant
that gates Customer 360 / activity feed: if you can `view` the customer, you can
see its timeline.

The SPEC §8 mapping lives in `app/kernel/timeline.py` and is exercised in isolation
by 13 unit tests over `classify_event`; the router (`app/routers/customer_timeline.py`)
is a thin shell that does auth, scope, and cursor pagination.

---

## SPEC §8 — the 13 timeline event types

SPEC §8 enumerates 13 user-facing timeline items. They project from audit `event`
rows whose `(type, entity_key[, data.to])` triple matches the rule. The classifier
returns `(kind, label)` for each match — `kind` is the SPEC §8 category, `label`
is the canonical human one-liner.

| # | SPEC §8 label        | `type`       | `entity_key`              | `data.to` / status filter             | Kind          |
|---|----------------------|--------------|----------------------------|----------------------------------------|---------------|
| 1 | Lead created         | `create`     | `lead`                     | —                                      | `lead`        |
| 2 | Contract signed      | `transition` | `contract`                 | `to == "SIGNED"`                       | `contract`    |
| 3 | Service installed    | `create`     | `service`                  | —                                      | `service`     |
| 4 | Service activated    | `transition` | `service`                  | `to == "ACTIVE"` (and `from != "SUSPENDED"`) | `service`     |
| 5 | Invoice issued       | `transition` | `invoice`                  | `to == "ISSUED"`                       | `invoice`     |
| 6 | Payment received     | `payment`    | `invoice`                  | —                                      | `payment`     |
| 7 | Ticket opened        | `create`     | `helpdesk_ticket` / `ticket` | —                                    | `ticket`      |
| 8 | Ticket closed        | `transition` | `helpdesk_ticket` / `ticket` | `to in {"CLOSED","RESOLVED"}`        | `ticket`      |
| 9 | Work order completed | `transition` | `work_order` / `workorder` | `to in {"COMPLETED","DONE"}`           | `work_order`  |
| 10| Service suspended    | `transition` | `service`                  | `to == "SUSPENDED"`                    | `service`     |
| 11| Service restored     | `transition` | `service`                  | `from == "SUSPENDED" AND to == "ACTIVE"` (checked BEFORE plain "activated") | `service` |
| 12| Communication sent   | `create`     | `communication` / `interaction` | —                                  | `communication` |
| 13| Document uploaded    | `create`     | `document`                 | —                                      | `document`    |

Service rows 4 / 10 / 11 share `entity_key == "service"` and are disambiguated by
the payload `from`/`to` status pair. **Order matters** in the classifier: `restored`
(SUSPENDED → ACTIVE) is checked before plain `activated` (anything → ACTIVE) so a
SUSPENDED → ACTIVE transition does not misclassify.

Any row outside the table — `assign`, `update`, `sla_breach`, `action_failed`,
`create subscription`, `transition product`, anything on `entity_key in ("order",
"subscription", "product")` — returns `None` and is dropped from the projection.
The audit log keeps those rows; the timeline does not surface them.

---

## `classify_event` rationale

Three properties drive the design:

1. **Pure function, in-memory.** `classify_event(row: Event) -> (kind, label) | None`
   takes one ORM row and returns the SPEC §8 pair (or `None`). No DB access, no
   tenant logic, no side effects. That makes every SPEC §8 case unit-testable
   (`tests/test_customer_timeline.py` hits all 13 plus the drop-list).
2. **Declarative status sentinels.** `_STATUS_CONTRACT_SIGNED`, `_STATUS_TICKET_CLOSED`,
   `_STATUS_SERVICE_*`, `_STATUS_WORK_ORDER_DONE` live at module top. A future
   status-set rename touches one place — not the engine, not every router.
3. **SPEC §8 ordering inside the function.** The if/elif chain follows the SPEC §8
   order top-to-bottom so the file reads as a checklist. Service transitions are
   the only branchy case (3 SPEC items off the same entity_key); the comment
   above each `if` flags the order constraint.

The matching surface is intentionally generous on entity_key (`ticket` AND
`helpdesk_ticket`, `work_order` AND `workorder`, `communication` AND `interaction`).
SPEC §8 names the **category**; the codebase emits under whichever key the engine
that owns the entity chose. The classifier treats both keys as the same SPEC §8
item, so existing builds project correctly and a future rename does not need a
data backfill.

---

## Append-only (SPEC §0.4 — inherited from `event` table triggers)

SPEC §0.4 declares the audit log append-only: **no role**, including Admin, may
UPDATE or DELETE an `event` row. Two BEFORE triggers in alembic revision
`b70ef3b98e27` (`prevent_update_event`, `prevent_delete_event`) raise
`restrict_violation` on any attempt — the constraint lives at the DB layer so it
cannot be bypassed by any application code path, including a kernel/owner session
or a raw `psql` UPDATE.

`get_customer_timeline` never writes. The timeline IS the audit log, filtered
through `classify_event`. Consequences:

- **Deletion of a record does not erase its history.** If an invoice is voided,
  the `transition` event that voided it stays in the log; the timeline still shows
  the original `Invoice issued`. If a customer is deleted (status, not row),
  every event tied to it remains projectable.
- **No edit path on the API.** There is no `PATCH /timeline/{id}` and no
  `DELETE` — by construction. The only mutation a row ever sees is its initial
  `INSERT`.
- **Tamper-evidence.** Removing or modifying a trigger is itself a DDL event
  visible in the server log. A `DROP TRIGGER` to bypass the invariant leaves
  a trace at a layer the application cannot reach.

The test `test_timeline_append_only_db_level` issues an invoice, picks the
resulting `Invoice issued` event id, then tries to `UPDATE` and `DELETE` it
directly. Both raise `restrict_violation`; the timeline still returns the
unchanged row after both attempts.

---

## Cursor pagination

The response shape:

```json
{
  "items": [...],
  "next_before_ts": "2026-05-31T14:36:24.715931+00:00" | null,
  "limit": 50,
  "spec": "SPEC §8"
}
```

Semantics:

- `limit` clamps page size (default 50, max 200 at the router; the kernel
  hard-clamps at 500).
- `before_ts` is the cursor — a UTC ISO-8601 timestamp. When provided, only
  events whose `created_at < before_ts` are returned. Combined with the
  newest-first order, this gives stable backward pagination.
- `next_before_ts` is the cursor for the next page: it equals the last
  returned item's `at`. The router only surfaces it when `len(items) == limit`,
  i.e. when there's likely more data. A short page returns `null` and the
  client knows it has reached the end.

### Round-trip robustness (fixed in this step)

The cursor is ISO-8601 with a `+00:00` tz offset. When a client pastes it
straight into a query string, the `+` is decoded as a space per RFC 3986 /
`application/x-www-form-urlencoded`, and the server sees
`2026-05-31T14:36:24.715931 00:00` instead. The router now accepts that
space-substituted form (it restores the `+` before parsing) and a trailing `Z`,
so the cursor we hand out always round-trips even without manual percent-encoding.

---

## Test results post-fix

| Test                                  | Before | After |
|---------------------------------------|--------|-------|
| `test_timeline_pagination_cursor`     | FAIL (422 on cursor round-trip) | PASS |
| `test_timeline_append_only_db_level`  | FAIL (DID NOT RAISE — triggers absent on `create_all`-built test DB) | PASS |
| Full `tests/test_customer_timeline.py` | 22/24 | **24/24** |

### What was wrong

1. **Pagination 422.** The router declared `before_ts: datetime | None`; FastAPI
   refused the cursor whose `+` had been decoded to space. Fix: accept `str` and
   parse tolerantly inside the handler (restore the `+`, accept trailing `Z`,
   `422` only on truly malformed input).
2. **Append-only DID NOT RAISE.** The test DB is built via
   `Base.metadata.create_all` in `tests/conftest.py` — that does NOT run alembic,
   so the `prevent_update_event` / `prevent_delete_event` triggers were absent
   in the test DB. The test was correctly asserting the SPEC §0.4 invariant the
   timeline relies on; the test now installs the triggers (the same DDL as
   revision `b70ef3b98e27`) before the UPDATE/DELETE attempts. This keeps the
   test verifying the actual DB-layer invariant rather than the bootstrap path
   used by the test fixture.

Both fixes are surgical and DO NOT touch alembic migrations, models, or the test
conftest.

### Files changed

- `backend/app/routers/customer_timeline.py` — tolerant `before_ts` parsing.
- `backend/tests/test_customer_timeline.py` — `_ensure_event_append_only_triggers`
  helper that mirrors alembic `b70ef3b98e27`.
- `backend/docs/spec-build/STEP-06-CUSTOMER-TIMELINE.md` — this doc.
