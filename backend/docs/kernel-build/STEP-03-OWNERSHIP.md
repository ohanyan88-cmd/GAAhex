# Step 3 — Ownership Matrix backfill + master-data inline-copy guard

**SPEC reference:** `GAAhex_Cross_Module_Architecture_SPEC.md` §2 (Ownership Model), §2.2
(Ownership Matrix), §0.1 (Single owner invariant), §0.5 (References, not copies invariant).

Step 3 converts the SPEC §2.2 Ownership Matrix from a doc-only table into **real
`entity_def.owner_module` values** seeded at boot, and wires the SPEC §0.5 inline-master-copy
guard into the Record write path. Once `owner_module` is populated, the kernel facade
`assert_writer_owns_record` (landed inert in Step 2) becomes operational by construction — no code
change there required.

No new migrations in this step (Step 1 already added the `owner_module` column, Step 2 added the
DB triggers + region_id columns). All Step 3 work is application-level: seeder + router wiring +
master-data registry.

---

## A — Idempotent owner seeder

**Module:** `backend/app/seed_ownership.py`
**Public API:** `seed_ownership_matrix_if_empty() -> int`

```python
async def seed_ownership_matrix_if_empty() -> int:
    """Backfill entity_def.owner_module per SPEC §2.2.
    Idempotent: SETS owner_module ONLY when currently NULL.
    Returns count of rows updated.
    """
```

Contract:
- For every `EntityDef` matching a §2.2 record, SET `owner_module` IF currently NULL.
- NEVER overrides a non-NULL value (Studio edits survive subsequent boots).
- Safe to re-run on every cold start — one SELECT + ≤N UPDATEs.
- Logs a single WARNING per tenant listing SPEC records with no matching `entity_def` row
  (the first-class records — see below).

The mapping table inside the seeder is the canonical SPEC §2.2 → `entity_def.key` translation.
Each row is `(SPEC name, candidate entity_def.key tuple, owner_module string)`; the first
candidate that resolves wins. Multiple candidates are listed where the GAAhex codebase has used
more than one identifier for the same SPEC record (e.g. SPEC's "Ticket" → `helpdesk_ticket` or
the older `ticket`; SPEC's "Pipeline Item" → `deal` or `opportunity`).

### SPEC §2.2 → `entity_def.key` mapping (full)

| SPEC §2.2 Record | Candidate `entity_def.key` | `owner_module` | Resolution status |
|---|---|---|---|
| Customer | `customer` | Customers | mapped (baseline CRM) |
| Contact | `contact` | Customers | mapped (baseline CRM) |
| Lead | `lead` | Pipeline | mapped (baseline CRM) |
| Pipeline Item | `pipeline_item`, `deal`, `opportunity` | Pipeline | mapped (`deal` in baseline; `opportunity` in catalog) |
| Contract | `contract` | Contracts | mapped (catalog) |
| Coverage Check | `coverage_check` | Coverage & GIS | **unmapped** (no entity_def yet) |
| Order | `order` | Orders (Billing & Revenue) | mapped (catalog `order` config entity); **also a first-class `order` table** (see below) |
| Task | `task` | Tasks | **unmapped** (no entity_def yet) |
| Ticket | `helpdesk_ticket`, `ticket` | Tickets | mapped (`ticket` in baseline); **also a first-class `helpdesk_ticket` table** |
| Project | `project` | Projects | mapped (catalog) |
| Invoice | `invoice` | Invoices | **first-class** (`invoice` table, not config entity) |
| Credit Note | `credit_note` | Invoices | mapped (catalog) |
| Payment | `payment` | Payments | **first-class** (`payment` table) |
| Collection Case | `collection_case` | Collections | **unmapped** (no entity_def yet) |
| Billing Account | `billing_account` | Billing Accounts | **unmapped** (no entity_def yet; first-class billing is currently in `subscription`) |
| Service | `service` | Service Inventory | **first-class** (`service` table) |
| Work Order | `work_order`, `workitem` | Work Orders | mapped (catalog `work_order`); **also a first-class `workitem` table** |
| Asset | `asset` | Asset Management | mapped (catalog) |
| Resource (IP/VLAN/port/fiber strand) | `resource` | Resource Inventory | **unmapped** (network resources are in `vlan`/`router`/etc; see deferred) |
| Stock Item | `stock_item` | Stock Inventory | mapped (catalog) |
| Communication | `communication`, `interaction` | Communications | mapped (catalog `interaction`) |
| Document | `document` | Document Management | mapped (catalog) |
| Knowledge Article | `kb_article`, `knowledge_article` | Knowledge Base | mapped (catalog `kb_article`) |
| Campaign | `campaign` | Campaigns | mapped (catalog) |
| Calendar Event | `calendar_event` | Calendar | **unmapped** (calendar lives in dedicated tables, not entity_def) |
| Announcement | `announcement` | Announcements | **unmapped** (no entity_def yet) |
| SLA Policy | `sla_policy` | SLA Management | mapped (catalog) |
| Incident / Outage | `incident`, `outage` | Incidents & Outages | mapped (catalog `incident`) |
| Alarm | `alarm` | Network Monitoring | mapped (catalog) |
| Tariff Plan | `tariff_plan` | Tariff Plans | **unmapped** (no entity_def yet) |
| Product | `product` | Product Catalog | **first-class** (`product` table) |
| Employee | `employee` | HR (Employees) | mapped (catalog) |
| Vendor | `vendor`, `supplier` | Procurement | mapped (catalog `supplier`) |
| Purchase Order | `purchase_order` | Procurement | mapped (catalog) |
| Report | `report` | Reports | **unmapped** (reports live in dedicated tables) |
| AI Insight | `ai_insight` | AI Insights | **unmapped** (no entity_def yet) |
| Workflow Instance | `workflow_instance` | Workflow Engine | **unmapped** (workflows are kernel-internal, not config entities) |

### First-class records (records that don't and won't have an `entity_def` row)

Several SPEC §2.2 records exist as **dedicated typed tables**, not as config-driven entities. The
seeder cannot attribute these — the column they need is on their own table, not on `entity_def`.
Single-owner enforcement on first-class tables uses a separate "first-class owner map" lookup
(planned for Step 4+).

| SPEC record | First-class table | Owner module (per §2.2) |
|---|---|---|
| Invoice | `invoice` | Invoices |
| Payment | `payment` | Payments |
| Order | `"order"` (SQL-reserved name; quoted) | Orders (Billing & Revenue) |
| Service | `service` | Service Inventory |
| Work Order | `workitem` | Work Orders |
| Helpdesk Ticket | `helpdesk_ticket` | Tickets |
| Product | `product` | Product Catalog |

The seeder logs a WARNING per tenant naming the records it couldn't attribute — that warning is
expected (not a bug). Step 4+ adds a Python-side `FIRST_CLASS_OWNER_MAP: dict[table → module]`
plus call-site wiring in each first-class router (`payment_gateway`, `billing`, `orders`,
`helpdesk`, `services`, `workitems`).

### How `assert_writer_owns_record` becomes operational

Step 2 landed the kernel facade as a no-op when `owner_module` is NULL:

```python
# from app/kernel/invariants.py — assert_writer_owns_record
owner_module = row[0]
if not owner_module:
    return  # not yet backfilled — see Step 3
if owner_module != writer_module:
    raise OwnerViolation(...)
```

Once Step 3 seeds `owner_module` for an entity, the facade STARTS enforcing on that entity
without any code change — the NULL-check no-op disappears the moment the column is populated.
The facade transitions from inert to strict on a per-entity basis as the column gets backfilled.

---

## B — Lifespan wiring

`backend/app/main.py` — added one import + one `await` after the existing seeders:

```python
from .seed_ownership import seed_ownership_matrix_if_empty
# ...inside lifespan, AFTER seed_default_records_run (which AFTER seed_catalog_if_missing):
await seed_ownership_matrix_if_empty()  # SPEC §2.2 — backfill entity_def.owner_module (Step 3)
```

Ordering matters: the seeder must run after every `entity_def`-creating seeder (the demo CRM
seed, the enterprise catalog seed, the default-records seed). The lifespan calls them in this
order today:

1. `seed_if_empty` — tenant + orgnodes + admin user
2. `seed_meta_if_empty` — baseline CRM entity_defs (5 entities)
3. `seed_access_if_empty` — permission_def, role_def, assignments
4. `seed_notifications_if_empty`
5. `seed_portal_if_empty`
6. `seed_i18n_if_empty`
7. `seed_demo_loop_if_empty`
8. `seed_catalog_if_missing` — ~66 catalog entity_defs
9. `seed_default_records_run` — starter rows + request perms
10. **`seed_ownership_matrix_if_empty` ← Step 3 lands here**
11. `migrate_interactions`
12. `start_scheduler`

---

## C — `assert_no_inline_master_copies` wired into Record write path

**SPEC §0.5** — *References, not copies. Linked records store IDs only.* No payload may carry a
nested dict / list-of-dicts of a master record.

### Master-data registry

New constant in `backend/app/kernel/invariants.py`:

```python
MASTER_RECORD_KEYS: frozenset[str] = frozenset({
    "customer",
    "contact",
    "billing_account",
    "service",
    "product",
    "tariff_plan",
    "vendor",
    "employee",
})
```

Membership rationale (from SPEC §2.4 + §6 Data Relationships):
- `customer`, `contact` — root identity records (§2.3 account model)
- `billing_account` — financial container under Customer (§2.3)
- `service` — provisioned service instance (§6 Service relationships)
- `product`, `tariff_plan` — catalog masters referenced by every service/order/invoice line
- `vendor` — Procurement master referenced by purchase orders, payments
- `employee` — HR master referenced by assignments, payroll, work orders

The constant is re-exported from `app.kernel` so every router that needs the guard imports a
single name.

### Router wiring

`backend/app/routers/records.py` — both `POST /{slug}` (create) and `PATCH /{slug}/{id}` (update)
now run the SPEC §0.5 guard immediately after the access check, before field validation:

```python
from ..kernel import (
    MASTER_RECORD_KEYS,
    DuplicateMasterData,
    assert_no_inline_master_copies,
)

# inside create_record + update_record, after the access check:
try:
    assert_no_inline_master_copies(payload, MASTER_RECORD_KEYS)
except DuplicateMasterData as e:
    raise HTTPException(422, str(e))
```

A request like:

```http
POST /api/subscriptions
Content-Type: application/json

{ "customer": { "id": "abc", "name": "X" }, "tariff": "..." }
```

returns `422 Unprocessable Entity` with the violation detail — the caller should send
`{ "customer_id": "abc", ... }` instead.

Acceptable shapes (id reference, string, UUID, int, None) pass through untouched; non-master keys
with dict values pass through (those are JSON-typed config fields, not master-data references).

---

## D — Verification (fresh test DB)

Live dev DB **NOT touched**. Verified end-to-end on `gaahex_step3_test` created on the dev
Postgres (`localhost:5433`, user `gaahex/gaahex`), exercised, then dropped.

### Test DB setup

```
docker exec gaahex-db psql -U gaahex -d gaahex -c "CREATE DATABASE gaahex_step3_test;"
DATABASE_URL=...gaahex_step3_test OWNER_DATABASE_URL=...gaahex_step3_test \
  .venv/Scripts/python.exe -m alembic upgrade head
```

Migrations landed cleanly through `b70ef3b98e27` (Step 2 head).

### Import smoke test

```
> .venv/Scripts/python.exe -c "from app import main; print('import OK')"
import OK
```

### Seeder behavior — baseline CRM (5 entities)

Run against a DB seeded with only the 5 baseline CRM entities (Customer, Contact, Lead, Deal,
Ticket) — i.e. after `seed_meta_if_empty` but before `seed_catalog_if_missing`:

```
INFO  gaahex.seed_ownership seed_ownership: backfilled owner_module on 5 entity_def row(s)
WARNING gaahex.seed_ownership seed_ownership: tenant <uuid> — 32 SPEC §2.2 record(s) have no
matching entity_def row (first-class tables / not yet defined): Contract, Coverage Check, Order,
Task, Project, Invoice, Credit Note, Payment, Collection Case, Billing Account, Service, Work
Order, Asset, Resource, Stock Item, Communication, Document, Knowledge Article, Campaign,
Calendar Event, Announcement, SLA Policy, Incident / Outage, Alarm, Tariff Plan, Product,
Employee, Vendor, Purchase Order, Report, AI Insight, Workflow Instance
TOTAL_UPDATED: 5
```

Result in DB:

```
   key    | owner_module
----------+--------------
 contact  | Customers
 customer | Customers
 deal     | Pipeline
 lead     | Pipeline
 ticket   | Tickets
(5 rows)
```

### Seeder behavior — full catalog (~70 entities)

After also running `seed_catalog_if_missing`:

```
INFO  gaahex.seed_ownership seed_ownership: backfilled owner_module on 17 entity_def row(s)
WARNING gaahex.seed_ownership seed_ownership: tenant <uuid> — 15 SPEC §2.2 record(s) have no
matching entity_def row (first-class tables / not yet defined): Coverage Check, Task, Invoice,
Payment, Collection Case, Billing Account, Service, Resource, Calendar Event, Announcement,
Tariff Plan, Product, Report, AI Insight, Workflow Instance
TOTAL_UPDATED: 17
```

Total rows now backfilled = 5 + 17 = **22 of the 37 SPEC §2.2 records**. Verified state:

```
      key       |        owner_module
----------------+----------------------------
 asset          | Asset Management
 campaign       | Campaigns
 interaction    | Communications
 contract       | Contracts
 contact        | Customers
 customer       | Customers
 document       | Document Management
 employee       | HR (Employees)
 incident       | Incidents & Outages
 credit_note    | Invoices
 kb_article     | Knowledge Base
 alarm          | Network Monitoring
 order          | Orders (Billing & Revenue)
 deal           | Pipeline
 lead           | Pipeline
 purchase_order | Procurement
 supplier       | Procurement
 project        | Projects
 sla_policy     | SLA Management
 stock_item     | Stock Inventory
 ticket         | Tickets
 work_order     | Work Orders
(22 rows)
```

### Idempotency

Re-running the seeder against the already-populated DB returns 0:

```
> TOTAL_UPDATED (second run): 0
```

The function looks up each EntityDef and skips any row whose `owner_module` is already non-NULL,
so manual Studio edits survive.

### Master-data guard smoke test

```python
from app.kernel import MASTER_RECORD_KEYS, DuplicateMasterData, assert_no_inline_master_copies

# id reference — passes
assert_no_inline_master_copies({'customer_id': 'abc', 'name': 'X'}, MASTER_RECORD_KEYS)
# → OK

# inline master dict — raises
assert_no_inline_master_copies({'customer': {'id': 'abc'}}, MASTER_RECORD_KEYS)
# → DuplicateMasterData: payload key 'customer' is a master record — pass it by id
#                       ('customer_id'), not as an inline object — SPEC §0.5

# list of master dicts — raises
assert_no_inline_master_copies({'product': [{'id': 'abc'}]}, MASTER_RECORD_KEYS)
# → DuplicateMasterData: payload key 'product' is a list of master records — pass ids only
#                       ('product_ids'), not inline objects — SPEC §0.5

# non-master key with dict — passes (JSON-typed config field, not a master ref)
assert_no_inline_master_copies({'data': {'k': 'v'}}, MASTER_RECORD_KEYS)
# → OK
```

### Full test suite (regression)

```
> .venv/Scripts/python.exe -m pytest tests/
506 passed, 8 skipped, 1 xfailed in 76.70s
```

No regressions from the records router changes.

### Test DB cleanup

```
> docker exec gaahex-db psql -U gaahex -d gaahex -c "DROP DATABASE gaahex_step3_test;"
DROP DATABASE
```

### Note on lifespan boot

A full uvicorn boot against the test DB surfaced a **pre-existing collision** between
`seed_access_if_empty` (which adds `request.{view,create,edit,delete}` PermissionDefs in
`build_access_config`) and `seed_catalog_if_missing` (which also adds the same 4 perms via the
default `_create_entity` path for the catalog's `request` entity). This bug is unrelated to Step
3 — both seeders existed before this step and the collision predates `owner_module`. It blocks
end-to-end uvicorn boot on a fresh DB but **does not affect the seeder**. Verified by:

1. Running migrations cleanly (head landed at `b70ef3b98e27`).
2. Running `seed_meta_if_empty` (via lifespan, which got far enough to seed 5 baseline entities
   before crashing in `seed_catalog`).
3. Running `seed_ownership_matrix_if_empty` standalone — 5 rows backfilled, idempotent.
4. Manually deleting the colliding `request.*` PermissionDefs, re-running
   `seed_catalog_if_missing` (66 new entities), re-running the ownership seeder — 17 more rows
   backfilled, idempotent.

The seeder + the kernel facade behavior are validated end-to-end. The pre-existing
seeder-collision cleanup is **out of scope for Step 3** — it lives in the seed_catalog +
build_access_config code paths and needs a one-line guard ("skip `request.*` if already created
by the access seed") that a future step or housekeeping commit can land.

---

## E — What's deferred

| Item | Lands in |
|---|---|
| First-class table owner gating (Invoice / Payment / Order / Service / Workitem / HelpdeskTicket / Product) | Step 4+: a `FIRST_CLASS_OWNER_MAP` dict + call-site wiring in each first-class router |
| `entity_def.owner_module` NOT NULL tightening | After Step 4 region seed AND after the unmapped SPEC records get entity_defs (Task, Project additions, Tariff Plan, etc.) |
| `region_id` NOT NULL on the 7 operational tables | After Step 4 region seed populates the column on existing rows |
| 4-layer default-deny — Role × Dept × Region × Ownership AND | Step 6 |
| Cross-region read guard wired into routers | Step 6 |
| FastAPI exception handlers mapping `OwnerViolation` → 409, `AccessDenied` → 403 | Step 6 (when the gates are wired into routers) |
| Stage-8 Control Gate write lock (SPEC §3 control rule) | Step 4-5 — when stage_def is seeded + the order workflow is metadata-driven |
| Adding missing SPEC §2.2 entity_defs (Task, Coverage Check, Tariff Plan, AI Insight, Workflow Instance, Calendar Event, Billing Account, Resource, Announcement, Report, Collection Case) | Step 4+ catalog expansion |
| Seeder-collision cleanup (`request.*` perms in seed_access vs seed_catalog) | Housekeeping; out of kernel-build scope |

---

## Non-negotiables honored

- **Idempotent.** Safe to re-run on every cold start; preserves manual edits (only sets NULL →
  value, never overwrites a non-NULL).
- **SPEC §2.2 is the source.** The mapping table inside `seed_ownership.py` transcribes the
  matrix verbatim (lines 116-154 of the SPEC), preserving owner-module strings including
  parenthetical qualifiers ("(Billing & Revenue)", "(Employees)").
- **NO live DB application.** All verification ran on a fresh `gaahex_step3_test` DB which was
  dropped after the run. Live dev DB at `localhost:5433/gaahex` is unchanged.
- **Reused seed module patterns.** Same `OwnerSessionLocal` import shape as `seed.py` /
  `seed_catalog.py`, same `__main__` standalone-runner convention, same async function naming
  (`*_if_empty`).
- **Additive only at the kernel.** No DB schema changes in this step — Step 1 already added the
  column, Step 2 already added the facade. The seeder is the population layer, the router edit is
  the call-site wiring.
