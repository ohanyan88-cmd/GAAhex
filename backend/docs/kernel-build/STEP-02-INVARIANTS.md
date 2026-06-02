# Step 2 — Kernel Invariants (DB triggers + Python facade)

**SPEC reference:** `GAAhex_Cross_Module_Architecture_SPEC.md` §0 (Global Invariants).

Step 2 enforces the 7 Global Invariants at the kernel level — the DB-level halves via Postgres
triggers and partition-key columns, the runtime/application halves via a new `backend/app/kernel`
package. No seeds, no wiring into routers — that happens in Steps 3-6. The kernel SURFACE is in
place so adopters can call the gates today; engines expand without changing call sites.

---

## The 7 invariants — what enforces each

| # | SPEC §0 invariant | Enforcement layer | Location |
|---|---|---|---|
| 1 | Single owner. Every record has exactly one source module. | Python kernel facade (DB schema in Step 1) | `app/kernel/invariants.py::assert_writer_owns_record` |
| 2 | Default deny. No access unless explicitly granted by Role × Dept × Region × Ownership. | Python kernel facade (real 4-layer engine in Step 6) | `app/kernel/invariants.py::assert_can` |
| 3 | Financial immutability. Invoices and Payments are never deleted. | **DB triggers** | migration `b70ef3b98e27`: `prevent_delete_invoice`, `prevent_delete_payment` |
| 4 | Audit append-only. Audit log cannot be edited or deleted by any role. | **DB triggers** | migration `b70ef3b98e27`: `prevent_update_event`, `prevent_delete_event` |
| 5 | References, not copies. Linked records store IDs only. | Python kernel helper (call-site wiring in Step 3) | `app/kernel/invariants.py::assert_no_inline_master_copies` |
| 6 | Region/Branch is a partition key. Cross-region read requires explicit grant. | **DB column** `region_id` + Python kernel facade | migration `b70ef3b98e27` (column); `app/kernel/invariants.py::assert_can_read_region` (read guard) |
| 7 | One KPI = one owner = one formula = one valid denominator. | **DB constraint** `UNIQUE(tenant_id, key)` on `kpi_def` | landed in Step 1 (revision `c5e9a3b1d7f4`) — Step 2 adds no new DB work for this rule |

---

## A — Alembic migration

**Revision:** `b70ef3b98e27`
**down_revision:** `c5e9a3b1d7f4`
**Filename:** `backend/alembic/versions/b70ef3b98e27_kernel_invariants_db_triggers_region_id.py`

### Triggers added (SPEC §0.3 + §0.4)

```sql
-- §0.3 financial immutability
CREATE FUNCTION prevent_delete_invoice() ... RAISE EXCEPTION '... SPEC §0.3 ...';
CREATE TRIGGER prevent_delete_invoice BEFORE DELETE ON invoice ...;

CREATE FUNCTION prevent_delete_payment() ... RAISE EXCEPTION '... SPEC §0.3 ...';
CREATE TRIGGER prevent_delete_payment BEFORE DELETE ON payment ...;

-- §0.4 audit append-only
CREATE FUNCTION prevent_update_event() ... RAISE EXCEPTION '... SPEC §0.4 ...';
CREATE TRIGGER prevent_update_event BEFORE UPDATE ON event ...;

CREATE FUNCTION prevent_delete_event() ... RAISE EXCEPTION '... SPEC §0.4 ...';
CREATE TRIGGER prevent_delete_event BEFORE DELETE ON event ...;
```

Triggers raise with `ERRCODE = 'restrict_violation'` so callers can distinguish them
cleanly from generic exceptions. Status UPDATEs on `invoice` and `payment` remain allowed —
the invariant is about deletion, not edits.

### Columns added (SPEC §0.6)

`region_id UUID NULL` added to every operational record table (no FK yet — the canonical region
table doesn't exist as a first-class entity; today regions are projected from `org_node` ltree).
A later step (after Step 3 backfill, before the NOT NULL tightening) adds the FK.

| Table | Reason |
|---|---|
| `record` | the generic config-entity record bag |
| `invoice` | billing operational record |
| `payment` | billing operational record |
| `"order"` | sales/provisioning order (SQL-reserved name; quoted) |
| `service` | service inventory |
| `helpdesk_ticket` | support ticket |
| `workitem` | GAAhex's work-order table — SPEC §0.6 calls it "work_order" |

Each column carries a Postgres comment citing SPEC §0.6.

### Invariant #7 — already enforced

The `UNIQUE(tenant_id, key)` constraint on `kpi_def` (revision `c5e9a3b1d7f4`, Step 1) guarantees
the one-owner half of the invariant structurally. The one-formula / one-denominator halves are
single-row-shape constraints (a `kpi_def` row HAS exactly one `formula` and exactly one
`denominator`), so the structural uniqueness on `key` is the whole DB-level enforcement. No new
DB work needed in Step 2.

---

## B — Application kernel (`backend/app/kernel/invariants.py`)

New package. Public surface re-exported from `app.kernel`:

```python
from app.kernel import (
    OwnerViolation, AccessDenied, DuplicateMasterData, CrossRegionDenied,
    assert_writer_owns_record,      # §0.1
    assert_can,                     # §0.2
    assert_no_inline_master_copies, # §0.5
    assert_can_read_region,         # §0.6 read guard
)
```

### HTTP code mapping (caught by FastAPI handlers — wired in later steps)

| Exception | HTTP code | When |
|---|---|---|
| `OwnerViolation` | 409 Conflict | Non-owner module tried to WRITE a record kind |
| `AccessDenied` | 403 Forbidden | No grant covers the request (default-deny) |
| `DuplicateMasterData` | 409 Conflict | Payload inlined a master record by value |
| `CrossRegionDenied` | 403 Forbidden | Caller's region scope doesn't include the target |

### Per-function contract

- **`assert_writer_owns_record(s, *, entity_key, writer_module)`** — looks up
  `entity_def.owner_module`. Raises `OwnerViolation` on mismatch. No-op when the entity_def row is
  missing OR when `owner_module` is NULL (Step 3 backfill not yet run). The kernel gate is
  adoptable today and becomes strict by construction when the column is universally non-NULL.

- **`assert_can(s, user, *, action, entity_key, region_id=None)`** — facade over the existing
  `app.access.load_grants` / `app.access.can` engine. Raises `AccessDenied` if no grant covers
  `(entity_key, action)`. When `region_id` is supplied, also passes through `assert_can_read_region`.
  Step 6 expands this to the full Role × Dept × Region × Ownership AND.

- **`assert_no_inline_master_copies(payload, master_keys)`** — synchronous payload scanner. Raises
  `DuplicateMasterData` if any key in `master_keys` carries a dict or list-of-dicts value (the
  duplicated-master shape) rather than an id/ref. STUB STATUS: function is fully working; Step 3
  wires the call into the Record write path with the master-key set.

- **`assert_can_read_region(s, user, *, region_id)`** — facade. Today is a no-op (returns when
  `region_id is None`, falls through otherwise). Step 6 swaps the engine in.

### Notes

- The kernel package keeps a thin import surface — `app.access`, `app.models`. No router
  imports, no FastAPI imports — these are pure domain assertions that any layer can call.
- Module-level comments added to `app/models/billing.py` and `app/models/event.py` document the
  DB-level invariants on those tables so a reader of the model file sees the constraint without
  having to spelunk into the alembic versions directory.

---

## C — Verification on a fresh test DB

Same pattern as Step 1: create `gaahex_invariant_test` against the dev Postgres (`localhost:5433`,
user `gaahex/gaahex`), point both `DATABASE_URL` and `OWNER_DATABASE_URL` at it, run `alembic
upgrade head`, verify, exercise the triggers, downgrade, drop.

### Migration applied

```
INFO  [alembic.runtime.migration] Running upgrade c5e9a3b1d7f4 -> b70ef3b98e27,
      kernel: SPEC §0 invariants — DB triggers (financial + audit) + region_id partition key
```

Head landed at `b70ef3b98e27` (`SELECT version_num FROM alembic_version;`).

### Triggers verified present

```
      trigger_name      | event_object_table | event_manipulation
------------------------+--------------------+--------------------
 prevent_delete_event   | event              | DELETE
 prevent_delete_invoice | invoice            | DELETE
 prevent_delete_payment | payment            | DELETE
 prevent_update_event   | event              | UPDATE
(4 rows)
```

### region_id columns verified present

```
   table_name    | column_name | data_type | is_nullable
-----------------+-------------+-----------+-------------
 helpdesk_ticket | region_id   | uuid      | YES
 invoice         | region_id   | uuid      | YES
 order           | region_id   | uuid      | YES
 payment         | region_id   | uuid      | YES
 record          | region_id   | uuid      | YES
 service         | region_id   | uuid      | YES
 workitem        | region_id   | uuid      | YES
(7 rows)
```

### Triggers actually fire (behavioral test)

After seeding one row each into `invoice`, `payment`, `event`:

```
> DELETE FROM invoice WHERE id = '...';
ERROR: invoice records are immutable per SPEC §0.3 — use status mutations ...

> DELETE FROM payment WHERE id = '...';
ERROR: payment records are immutable per SPEC §0.3 — use refund/reconcile state mutations ...

> DELETE FROM event WHERE id = '...';
ERROR: event (audit log) is append-only per SPEC §0.4 — no DELETE allowed by any role including Admin

> UPDATE event SET type='changed' WHERE id = '...';
ERROR: event (audit log) is append-only per SPEC §0.4 — no UPDATE allowed by any role including Admin

> UPDATE invoice SET status='PAID' WHERE id = '...';
UPDATE 1
> SELECT status FROM invoice WHERE id = '...';
 status
--------
 PAID
```

All 4 triggers raise the expected exception. Status UPDATE on `invoice` correctly remains allowed
(invariant is about DELETE, not edit).

### Downgrade tested

```
> alembic downgrade -1
INFO  [alembic.runtime.migration] Running downgrade b70ef3b98e27 -> c5e9a3b1d7f4, ...

> SELECT version_num FROM alembic_version;
 c5e9a3b1d7f4

> SELECT trigger_name FROM information_schema.triggers WHERE trigger_name LIKE 'prevent_%';
(0 rows)

> SELECT table_name, column_name FROM information_schema.columns WHERE column_name = 'region_id';
(0 rows)
```

All 4 triggers removed, all 4 trigger FUNCTIONS removed, all 7 `region_id` columns dropped. Fully
reversible.

### Test DB dropped

```
docker exec gaahex-db psql -U gaahex -d gaahex -c "DROP DATABASE gaahex_invariant_test;"
DROP DATABASE
```

---

## What's deferred

| Item | Lands in |
|---|---|
| `region_id NOT NULL` constraint on the 7 operational tables | After Step 3 backfill populates the column on existing rows |
| FK from `region_id` to a canonical region table | After the canonical region table is defined (today regions are projected from `org_node` ltree) |
| Real default-deny engine — 4-layer AND across Role × Dept × Region × Ownership | Step 6 |
| Cross-region read guard wired into routers | Step 6 |
| `assert_no_inline_master_copies` wired into the Record write path | Step 3 (needs the master-key registry from the §2.2 ownership backfill) |
| FastAPI exception handlers mapping `OwnerViolation` → 409, `AccessDenied` → 403, etc. | Step 6 (when the gates are wired into routers — handler without callers would be inert) |
| Stage-8 Control Gate write lock (SPEC §3 control rule) | Step 4-5, when stage_def is seeded + the order workflow is metadata-driven |
| Step 1's "live dev DB stuck at unknown revision `d3e4f5a6b7c8`" cleanup | Out of scope for the kernel build — needs a deliberate revision-graph reconciliation |

---

## Non-negotiables honored

- **Additive only.** No DROP, no ALTER of existing columns. All 7 region_id additions are
  `ADD COLUMN ... NULL`. All 4 triggers are `CREATE`. Downgrade cleanly reverses everything.
- **Live dev DB untouched.** Verified end-to-end on a fresh `gaahex_invariant_test` DB which was
  dropped after verification. Live dev DB at `localhost:5433/gaahex` is unchanged.
- **Reusing migration style.** Same revision-header layout, same module docstring pattern, same
  `op.execute` for raw SQL as `enable_rls_tenant_isolation` (`3a9203795d07`) and the Step 1
  migration (`c5e9a3b1d7f4`).
- **Reversible downgrade.** All 4 triggers, all 4 trigger functions, all 7 columns are removed by
  `downgrade()`. Verified.
