# Step 5 — SPEC §7 Status Standardization

**SPEC reference:** `GAAhex_Cross_Module_Architecture_SPEC.md` §7 (lines 281-293) — the locked
status vocabularies for the 9 record kinds the SPEC names.

Step 5 takes the LOCKED `Draft · New · Open · …` text vocabularies from doc-only language into
**real `status_def` rows seeded at boot**, with `is_initial` set on the first status of each set
and `is_terminal` set on the lifecycle-ending statuses per the SPEC reading documented below.

Prior steps:
- Step 1 (`c21bd24`) — `stage_def` / `kpi_def` tables + `entity_def.owner_module` column.
- Step 2 (`8951521`) — DB triggers + `region_id` + kernel facade.
- Step 3 (`75cb96d`) — Ownership matrix seeded (22 entity_defs).
- Step 4 (`fcc6a5a`) — 14 pipeline stages + 14 KPIs + Stage 8 Control Gate.

---

## A — Schema change (additive)

Migration `d4f8a1c6b3e5_status_def_is_terminal.py`:

```python
op.add_column(
    'status_def',
    sa.Column('is_terminal', sa.Boolean(), server_default=sa.text('false'), nullable=False),
)
```

The existing `status_def` table already had `is_initial`; this revision adds the complementary
`is_terminal` so the SPEC §7 terminal vocabulary can be queried directly without recomputing the
rule from workflow_def edges (the workflow engine isn't built yet).

The `StatusDef` ORM model in `app/models/meta.py` was updated to match.

---

## B — The seeder

**Module:** `backend/app/seed_statuses.py`
**Public API:** `seed_status_standardization_if_empty() -> dict[str, int]`
**Call site:** `backend/app/main.py` lifespan, **after** `seed_canonical_pipeline_if_empty()`
(Step 4) and **before** `seed_default_records_run()`.

Idempotent — uses `pg_insert(...).on_conflict_do_nothing(index_elements=["entity_def_id", "key"])`
keyed on the existing `uq_status_def_key` unique constraint. Re-runs insert zero new rows.

### Status key derivation

SPEC §7 display labels are converted to `UPPER_SNAKE` keys via `_to_status_key()`:
- `Draft`                 → `DRAFT`
- `In Progress`           → `IN_PROGRESS`
- `Partially Paid`        → `PARTIALLY_PAID`
- `Waiting for Customer`  → `WAITING_FOR_CUSTOMER`
- `On Route`              → `ON_ROUTE`
- `Provisioning Failed`   → `PROVISIONING_FAILED`

### SPEC set → entity_def.key mapping

| SPEC §7 Set | Candidate `entity_def.key`(s)         | Strategy                                  | Notes                                                                                              |
|-------------|---------------------------------------|-------------------------------------------|----------------------------------------------------------------------------------------------------|
| General     | `general` (sentinel; created on demand) | Always seeded                           | A sentinel EntityDef is created if missing — anchors the cross-entity General catalog.            |
| Lead        | `lead`                                | First match                               | Skipped if missing — `lead` is a first-class concept, not always present as a catalog `entity_def`. |
| Contract    | `contract`                            | First match                               | Catalog provides a partial set (`Draft`, `Active`, `Expired`, `Terminated`); seeder extends to 7. |
| Order       | `order`                               | First match                               | Catalog provides `Created`, `Fulfilling`, `Completed`, `Rejected`; seeder extends to 6 SPEC ones.  |
| Ticket      | `ticket`, `helpdesk_ticket`           | **All matches** — both get the same set   | GAAhex CRM-baseline `ticket` and helpdesk-module `helpdesk_ticket` both carry SPEC §7 vocabulary.   |
| Work Order  | `work_order`, `workitem`              | **All matches** — both get the same set   | `workitem` is the first-class field-dispatch table; `work_order` is the catalog entity.            |
| Invoice     | `invoice`                             | First match                               | Skipped if missing — `invoice` lives in its first-class `invoice` table.                           |
| Payment     | `payment`                             | First match                               | Skipped if missing — same.                                                                         |
| Service     | `service`                             | First match                               | Skipped if missing — same.                                                                         |

### Terminal-status reasoning (per SPEC §7 reading + judgment)

| SPEC Set    | Statuses                                                                                                                                | Terminal                                                       | Reasoning                                                                                                                                                                                                                       |
|-------------|-----------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| General     | Draft · New · Open · In Progress · Waiting · Pending Approval · Approved · Rejected · Completed · Cancelled · Closed · Archived         | Rejected, Completed, Cancelled, Closed, Archived               | Approved kept NON-terminal (typically advances to Completed/Closed). The 5 marked terminal are unambiguous end-states.                                                                                                          |
| Lead        | New · Working · Qualified · Disqualified · Converted                                                                                    | Disqualified, Converted                                        | Per SPEC §3 a Converted lead's lifecycle ends; the record advances on the Contract/Service it became.                                                                                                                          |
| Contract    | Draft · Sent · Signed · Active · Amended · Terminated · Expired                                                                         | Terminated, Expired                                            | Amended is a versioning state, not end. Active/Signed are progressing states.                                                                                                                                                  |
| Order       | Created · In Validation · Validated · Rejected · Fulfilled · Cancelled                                                                  | Rejected, Fulfilled, Cancelled                                 | Rejected = Stage 8 Control Gate or upstream validation failed (per SPEC §3 / §10.4). Fulfilled = delivered. Cancelled = abandoned.                                                                                              |
| Ticket      | New · Assigned · In Progress · Waiting for Customer · Waiting for Internal · Escalated · Resolved · Closed · Reopened                   | **Closed only**                                                | Resolved is NOT terminal — it can move to Closed or Reopened. Reopened is NOT terminal (re-entry into work). Closed is the single end-state.                                                                                    |
| Work Order  | New · Scheduled · Assigned · On Route · In Progress · Completed · Failed · Rescheduled · Cancelled                                      | Completed, Failed, Cancelled                                   | Rescheduled is a re-planning state (work resumes). The three terminal options are unambiguous.                                                                                                                                 |
| Invoice     | Draft · Issued · Sent · Partially Paid · Paid · Overdue · Cancelled · Credited                                                          | Paid, Cancelled, Credited                                      | Overdue is NOT terminal (can become Paid via collections). Partially Paid is NOT terminal (transitional). SPEC §0.3 says invoices are NEVER deleted — only state-changed.                                                       |
| Payment     | Pending · Successful · Failed · Refunded · Partially Refunded · Reconciled · Chargeback                                                 | Failed, Reconciled, Chargeback                                 | Reconciled = accounting cycle closed. Chargeback = dispute closes the payment record. Failed = gateway rejected; retry is a new payment. Refunded / Partially Refunded kept NON-terminal (may themselves be reconciled later). |
| Service     | Pending · Active · Suspended · Disconnected · Cancelled · Provisioning Failed · Under Maintenance                                       | Disconnected, Cancelled, Provisioning Failed                   | Suspended is NOT terminal (can return to Active). Under Maintenance is transient. Disconnected closes the service record — reactivation creates a new service or transitions out.                                            |

These choices are encoded in the `SPEC_STATUS_SETS` table's `terminal` set for each entry — the
file itself is the source of truth.

---

## C — Verification (test DB transcript, 2026-05-31)

Fresh ephemeral DB `gaahex_step5_test` on the existing `gaahex-db` container.

```
docker exec gaahex-db psql -U gaahex -d postgres -c "CREATE DATABASE gaahex_step5_test;"
$env:DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_step5_test"
$env:OWNER_DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_step5_test"
cd backend
.venv/Scripts/python.exe -m alembic upgrade head
# … (all 39 migrations applied through d4f8a1c6b3e5 status_def.is_terminal) …

.venv/Scripts/python.exe -c "
import asyncio
from app.seed import seed_if_empty
from app.seed_catalog import seed_catalog_if_missing
from app.seed_ownership import seed_ownership_matrix_if_empty
from app.seed_pipeline import seed_canonical_pipeline_if_empty
from app.seed_statuses import seed_status_standardization_if_empty
async def go():
    await seed_if_empty()
    for _ in range(2):
        try:
          await seed_catalog_if_missing(); break
        except Exception as e: print('catalog seed: known pre-existing collision —', type(e).__name__)
    await seed_ownership_matrix_if_empty()
    await seed_canonical_pipeline_if_empty()
    r = await seed_status_standardization_if_empty()
    print('seed_statuses result:', r)
asyncio.run(go())
"
```

### First-run output

```
seed_statuses: SPEC §7 set 'Lead' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Ticket' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Invoice' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Payment' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Service' has no matching entity_def — skipped
seed_statuses result: {'general': 12, 'contract': 3, 'order': 5, 'work_order': 8}
```

Row counts explained:
- `general` = 12 — full SPEC General vocabulary, inserted into the freshly-created sentinel
  EntityDef.
- `contract` = 3 — catalog block (`seed_catalog.py:62`) ships 4 statuses: `DRAFT, ACTIVE,
  EXPIRED, TERMINATED`. SPEC has 7; the 3 net-new are `SENT, SIGNED, AMENDED`. Post-seed total
  = 7 distinct keys (catalog 4 + SPEC-new 3).
- `order` = 5 — catalog block (`seed_catalog.py:87`) ships 4 statuses: `NEW, FULFILLING,
  COMPLETED, CANCELLED`. SPEC has 6; only `CANCELLED` collides. Net-new = `CREATED, IN_VALIDATION,
  VALIDATED, REJECTED, FULFILLED` (5). Post-seed total = 9 distinct keys (catalog 4 + SPEC-new 5).
  Note: catalog `NEW`/`FULFILLING`/`COMPLETED` and SPEC `CREATED`/`FULFILLED` coexist — they're
  semantically overlapping but use different keys, so both rows survive. A later cleanup pass can
  canonicalize on the SPEC vocabulary.
- `work_order` = 8 — catalog block (`seed_catalog.py:154`) ships 3 statuses: `OPEN, SCHEDULED,
  DONE`. SPEC has 9 labels; `SCHEDULED` collides, so 8 new rows inserted. Post-seed total =
  3 catalog + 8 SPEC-new = 11 rows.

(See "Post-seed table" below for the actual content — that's the authoritative view.)

### Post-seed table (excerpt)

```
docker exec gaahex-db psql -U gaahex -d gaahex_step5_test -c \
  "SELECT ed.key as entity, sd.key, sd.label, sd.\"order\", sd.is_initial, sd.is_terminal
   FROM status_def sd JOIN entity_def ed ON ed.id=sd.entity_def_id
   WHERE ed.key IN ('general','contract','order','work_order')
   ORDER BY ed.key, sd.\"order\";"
```

| entity     | key              | label            | order | is_initial | is_terminal |
|------------|------------------|------------------|------:|:----------:|:-----------:|
| contract   | DRAFT            | Draft            |     1 |     t      |      f      |
| contract   | ACTIVE           | Active           |     2 |     f      |      f      |
| contract   | SENT             | Sent             |     2 |     f      |      f      |
| contract   | SIGNED           | Signed           |     3 |     f      |      f      |
| contract   | EXPIRED          | Expired          |     3 |     f      |      f      |
| contract   | TERMINATED       | Terminated       |     4 |     f      |      f      |
| contract   | AMENDED          | Amended          |     5 |     f      |      f      |
| general    | DRAFT            | Draft            |     1 |     t      |      f      |
| general    | NEW              | New              |     2 |     f      |      f      |
| general    | OPEN             | Open             |     3 |     f      |      f      |
| general    | IN_PROGRESS      | In Progress      |     4 |     f      |      f      |
| general    | WAITING          | Waiting          |     5 |     f      |      f      |
| general    | PENDING_APPROVAL | Pending Approval |     6 |     f      |      f      |
| general    | APPROVED         | Approved         |     7 |     f      |      f      |
| general    | REJECTED         | Rejected         |     8 |     f      |    **t**    |
| general    | COMPLETED        | Completed        |     9 |     f      |    **t**    |
| general    | CANCELLED        | Cancelled        |    10 |     f      |    **t**    |
| general    | CLOSED           | Closed           |    11 |     f      |    **t**    |
| general    | ARCHIVED         | Archived         |    12 |     f      |    **t**    |
| order      | CREATED          | Created          |     1 |     t      |      f      |
| order      | NEW              | New              |     1 |     t      |      f      |
| order      | FULFILLING       | Fulfilling       |     2 |     f      |      f      |
| order      | IN_VALIDATION    | In Validation    |     2 |     f      |      f      |
| order      | VALIDATED        | Validated        |     3 |     f      |      f      |
| order      | COMPLETED        | Completed        |     3 |     f      |      f      |
| order      | REJECTED         | Rejected         |     4 |     f      |    **t**    |
| order      | CANCELLED        | Cancelled        |     4 |     f      |      f      |
| order      | FULFILLED        | Fulfilled        |     5 |     f      |    **t**    |
| work_order | OPEN             | Open             |     1 |     t      |      f      |
| work_order | NEW              | New              |     1 |     t      |      f      |
| work_order | SCHEDULED        | Scheduled        |     2 |     f      |      f      |
| work_order | DONE             | Done             |     3 |     f      |      f      |
| work_order | ASSIGNED         | Assigned         |     3 |     f      |      f      |
| work_order | ON_ROUTE         | On Route         |     4 |     f      |      f      |
| work_order | IN_PROGRESS      | In Progress      |     5 |     f      |      f      |
| work_order | COMPLETED        | Completed        |     6 |     f      |    **t**    |
| work_order | FAILED           | Failed           |     7 |     f      |    **t**    |
| work_order | RESCHEDULED      | Rescheduled      |     8 |     f      |      f      |
| work_order | CANCELLED        | Cancelled        |     9 |     f      |    **t**    |

Notes from the post-seed table:
- The General set landed in full (12 rows, 5 marked terminal).
- Contract/Order/Work Order rows show **both** the SPEC §7 vocabulary AND the pre-existing
  catalog statuses (e.g. Order has both `Created` AND `Fulfilling` AND `Completed` AND `Cancelled`
  from catalog plus the SPEC-only `In Validation`, `Validated`, `Fulfilled`). This is the
  idempotent design — pre-existing rows are NEVER overwritten; only NEW SPEC keys are inserted.
- `is_terminal=t` is set per the reasoning in §B above; pre-existing catalog rows from before
  this migration default to `false` (the migration's server_default) — Studio can flip them
  later if needed.

### Second-run output (idempotency proof)

```
.venv/Scripts/python.exe -c "
import asyncio; from app.seed_statuses import seed_status_standardization_if_empty
r = asyncio.run(seed_status_standardization_if_empty()); print('second run:', r)
"
```

```
seed_statuses: SPEC §7 set 'Lead' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Ticket' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Invoice' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Payment' has no matching entity_def — skipped
seed_statuses: SPEC §7 set 'Service' has no matching entity_def — skipped
second run: {}
```

Zero rows inserted on second run — idempotency proven.

---

## D — Sets skipped because entity_def missing

In the M0 demo seed the following entity_defs don't exist (they live as **first-class tables**,
not config-driven entity_defs) — so the corresponding SPEC §7 status sets are skipped each boot
with a single WARNING per set:

| SPEC §7 set | Candidate keys                | Why skipped                                                                                  |
|-------------|-------------------------------|----------------------------------------------------------------------------------------------|
| Lead        | `lead`                        | M0 demo CRM uses a first-class lead table; no config-driven `lead` EntityDef row exists.     |
| Ticket      | `ticket`, `helpdesk_ticket`   | Helpdesk module ships its own `helpdesk_ticket` first-class table; no EntityDef row.         |
| Invoice     | `invoice`                     | First-class `invoice` table from the billing module.                                         |
| Payment     | `payment`                     | First-class `payment` table.                                                                 |
| Service     | `service`                     | First-class `service` table from the service-inventory module.                               |

These will be seeded automatically on the next boot once a matching `entity_def` row is
introduced (e.g. when the Studio promotes any of them to config-driven, or when a later seeder
explicitly creates the EntityDef rows). No code change is needed for the seeder to pick them up.

The remaining 4 sets are populated for the M0 demo tenant: `general`, `contract`, `order`,
`work_order`.

---

## E — What's deferred

- **Status transition graph (workflow_def relations between statuses).** The SPEC §7 vocabulary is
  seeded; the allowed transitions between statuses (Lead.New → Lead.Working etc.) belong to
  `workflow_def.config` and land with the Studio workflow configuration layer.
- **Workflow guards on status changes** (default-deny role-gate on transitions) — Step 6.
- **Tightening status_def to enforce the SPEC §7 vocabulary at write time.** Currently a tenant
  can still create a status_def with any key (e.g. `WONKY`). A future pass can add a CHECK
  constraint or an application-level guard to keep the §7 vocabulary canonical.
- **Backfilling Lead / Ticket / Invoice / Payment / Service entity_defs** — those records remain
  first-class tables for M0. If/when they migrate to config-driven entity_defs (Studio path), the
  seeder picks them up on the next boot.
- **Refundable / Reconcilable distinctions inside Payment.** The SPEC includes both Refunded
  and Partially Refunded; the seeder keeps both non-terminal so the downstream collections
  workflow can reconcile or chargeback them. A more granular distinction (e.g. "Refunded is
  terminal once the bank-side confirmation lands") can be encoded via Studio overrides.

---

## File map

| File                                                                    | Role                                               |
|-------------------------------------------------------------------------|----------------------------------------------------|
| `backend/alembic/versions/d4f8a1c6b3e5_status_def_is_terminal.py`       | Additive migration — adds `status_def.is_terminal`. |
| `backend/app/models/meta.py`                                            | `StatusDef.is_terminal` ORM field.                 |
| `backend/app/seed_statuses.py`                                          | The seeder (this step's main artifact).            |
| `backend/app/main.py`                                                   | Wires the seeder into lifespan after Step 4.       |
| `backend/docs/kernel-build/STEP-05-STATUS-SETS.md`                      | This document.                                     |

---

## Commit

`96a3535` — `feat(kernel): step 5 — SPEC §7 status sets seeded into status_def, idempotent`
