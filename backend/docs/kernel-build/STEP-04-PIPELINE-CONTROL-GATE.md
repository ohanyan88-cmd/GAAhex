# Step 4 — Canonical Pipeline (§3) + Stage 8 Control Gate

Step 4 takes the LOCKED pipeline vocabulary from doc-only text into **real `stage_def` + `kpi_def`
rows seeded at boot**, and lands the kernel function that enforces the **single mandatory gate**
between Sales and Fulfillment. Stage 8 (`order_validation`, owner = Revenue Control) is the only
row with `is_control_gate = TRUE`; every other stage is a regular sequence row.

Prior steps:
- Step 1 (`c21bd24`) — `stage_def`, `kpi_def`, `entity_def.owner_module NULL` columns landed.
- Step 2 (`8951521`) — DB triggers + `region_id` on 7 tables + kernel facade exceptions.
- Step 3 (`75cb96d`) — Ownership matrix seeded; master-data inline-copy guard wired.

---

## A — The 14 stages + 14 KPIs (seeded)

**Module:** `backend/app/seed_pipeline.py`
**Public API:** `seed_canonical_pipeline_if_empty() -> dict[str, int]`
**Call site:** `backend/app/main.py` lifespan, **after** `seed_catalog_if_missing()` (so `order`
etc. exist as `entity_def` rows first) and **before** `seed_default_records_run()`.

Idempotent — uses `pg_insert(...).on_conflict_do_nothing(index_elements=["tenant_id", "key"])`
keyed on the existing `uq_stage_def_key` / `uq_kpi_def_key` unique constraints. Re-runs insert zero
new rows.

### SPEC §3 table → seeded rows

| # | `stage_def.key`         | Stage Name             | Owner Module          | Exit Gate                                                       | `kpi_def.key`               | KPI Name                    | `is_control_gate` |
|---|-------------------------|------------------------|-----------------------|-----------------------------------------------------------------|-----------------------------|-----------------------------|-------------------|
| 1 | `lead`                  | Lead                   | Marketing             | Mandatory fields complete                                       | `lead_capture_rate`         | Lead Capture Rate           | false             |
| 2 | `qualified`             | Qualified              | Pre-Sales             | Coverage=YES, Reachable, Intent≥threshold                       | `validation_rate`           | Validation Rate             | false             |
| 3 | `assigned`              | Assigned               | Sales Ops             | Agent acceptance ≤ SLA                                          | `assignment_sla_compliance` | Assignment SLA Compliance   | false             |
| 4 | `deal`                  | Deal                   | Sales Agent           | Offer accepted (digital)                                        | `deal_conversion`           | Deal Conversion             | false             |
| 5 | `contract_signed`       | Contract Signed        | Sales Agent           | Signed contract validated                                       | `contract_close_rate`       | Contract Close Rate         | false             |
| 6 | `service_qualification` | Service Qualification  | Coverage & GIS        | Coverage/feasibility = PASS                                     | `feasibility_pass_rate`     | Feasibility Pass Rate       | false             |
| 7 | `order_created`         | Order Created          | Orders                | Order record with valid tariff + product                        | `order_creation_accuracy`   | Order Creation Accuracy     | false             |
| **8** | **`order_validation`** | **Order Validation**   | **Revenue Control**   | **KYC + Credit/Risk + Fraud + Tariff/Product match = ALL PASS** | **`control_pass_rate`**     | **Control Pass Rate**       | **TRUE**          |
| 9 | `scheduling`            | Scheduling             | Dispatch              | Slot within capacity window                                     | `schedule_fill_rate`        | Schedule Fill Rate          | false             |
| 10 | `installation`         | Installation           | Field Ops             | Install complete, signal confirmed                              | `install_success_rate`      | Install Success Rate        | false             |
| 11 | `connection`           | Connection             | Field Ops / NOC       | Link up, device provisioned                                     | `connection_success_rate`   | Connection Success Rate     | false             |
| 12 | `payment`              | Payment                | Billing               | First payment cleared                                           | `first_payment_rate`        | First Payment Rate          | false             |
| 13 | `activation`           | Activation             | Billing (Activation)  | Account live, billing cycle started                             | `activation_rate`           | Activation Rate             | false             |
| 14 | `monitoring`           | Monitoring             | Customer Care / NOC   | Continuous post-activation                                      | `thirty_day_retention`      | 30-Day Retention            | false             |

Each `kpi_def` row is bound to its stage via `kpi_def.bound_stage_key = stage_def.key`. `formula`
and `denominator` are left NULL at seed time — those land with the KPI computation engine in a
later step. The structural `UNIQUE(tenant_id, key)` constraint on `kpi_def` enforces the
"one KPI = one owner" half of SPEC §0 invariant 7.

---

## B — The Stage 8 kernel function

**Module:** `backend/app/kernel/control_gate.py`
**Public surface (re-exported from `app.kernel`):**
```python
class ControlGateNotPassed(Exception): ...
async def assert_can_advance_to_scheduling(s, *, order_id, control_pass) -> None: ...
```

The function is a read-only check (no DB writes, no side effects). It raises `ControlGateNotPassed`
unless `control_pass is True`. Both `NULL` (Revenue Control hasn't validated yet) and `FALSE`
(Revenue Control explicitly rejected) are blocked — only literal `True` permits the transition.

The kernel exception type maps to **HTTP 409 Conflict** at the router boundary, consistent with
SPEC §0 contract for write/transition rejections.

### Where it's wired

`backend/app/routers/orders.py::advance_order`, in the SUBMITTED→PROVISIONING branch:

```python
from ..kernel import assert_can_advance_to_scheduling, ControlGateNotPassed

# inside advance_order, before _set_status:
if frm == "SUBMITTED" and nxt == "PROVISIONING":
    try:
        await assert_can_advance_to_scheduling(s, order_id=order.id, control_pass=order.control_pass)
    except ControlGateNotPassed as e:
        raise HTTPException(status_code=409, detail=str(e))
```

**Why SUBMITTED → PROVISIONING and not a literal "Scheduling" transition?** The current Orders
lifecycle in GAAhex is `DRAFT → SUBMITTED → PROVISIONING → COMPLETED`. There's no explicit
"Scheduling" state on the `order` table yet — that surfaces later when the Dispatch module lands.
SUBMITTED → PROVISIONING is **the** Sales-to-Fulfillment crossing in today's code: it's the moment
an order leaves Sales and enters work that touches Field Ops / Billing / Provisioning. That maps
1:1 to the SPEC §3 stage 7 → 9 transition the Control Gate is designed to police.

When the literal Scheduling state lands (Dispatch module), the gate moves to that transition; the
kernel function is unchanged and the import already exists.

---

## C — The `order` table additions

**Migration:** `backend/alembic/versions/98d4d53f889c_order_control_pass_columns.py`
**Revision:** `98d4d53f889c`
**Down-revision:** `b70ef3b98e27` (Step 2)

Additive only — three nullable columns on `"order"` (quoted because `order` is a SQL reserved word):

| Column            | Type          | Semantic                                                         |
|-------------------|---------------|------------------------------------------------------------------|
| `control_pass`    | `boolean NULL`| `NULL` = pending validation, `TRUE` = passed, `FALSE` = failed.  |
| `control_pass_at` | `timestamptz NULL` | When the verdict was recorded (audit trail).                 |
| `control_pass_by` | `uuid NULL`   | User who recorded the verdict (no FK yet; role-gate in Step 6).  |

Also mirrored in the ORM model `backend/app/models/order.py`.

No DB-level CHECK constraint — the transition is to a sibling row (workitem / dispatch), not a
column mutation on `order` itself, so the gate has to live in application code.

---

## D — Verification transcript

Fresh `gaahex_step4_test` database, dropped after the test:

```
$ docker exec -i gaahex-db psql -U gaahex -c "CREATE DATABASE gaahex_step4_test;"
CREATE DATABASE

$ DATABASE_URL=...gaahex_step4_test  alembic upgrade head
INFO  [alembic.runtime.migration] Running upgrade b70ef3b98e27 -> 98d4d53f889c,
      kernel: order.control_pass trio for Stage 8 Control Gate (SPEC §3 / §10.4)

$ docker exec -i gaahex-db psql -U gaahex -d gaahex_step4_test -c '\d "order"'
…
 control_pass    | boolean                  |           |          | 
 control_pass_at | timestamp with time zone |           |          | 
 control_pass_by | uuid                     |           |          | 
```

**Pipeline seeder (idempotent):**
```
first run:  {'stages_inserted': 14, 'kpis_inserted': 14}
second run: {'stages_inserted': 0,  'kpis_inserted': 0}
```

**stage_def contents (sorted by sequence):**
```
          key          | sequence | is_control_gate 
-----------------------+----------+-----------------
 lead                  |        1 | f
 qualified             |        2 | f
 assigned              |        3 | f
 deal                  |        4 | f
 contract_signed       |        5 | f
 service_qualification |        6 | f
 order_created         |        7 | f
 order_validation      |        8 | t      ← THE CONTROL GATE
 scheduling            |        9 | f
 installation          |       10 | f
 connection            |       11 | f
 payment               |       12 | f
 activation            |       13 | f
 monitoring            |       14 | f
(14 rows)
```

**kpi_def contents (one per stage, bound via `bound_stage_key`):**
```
            key            |    bound_stage_key    |     owner_module     
---------------------------+-----------------------+----------------------
 lead_capture_rate         | lead                  | Marketing
 validation_rate           | qualified             | Pre-Sales
 assignment_sla_compliance | assigned              | Sales Ops
 deal_conversion           | deal                  | Sales Agent
 contract_close_rate       | contract_signed       | Sales Agent
 feasibility_pass_rate     | service_qualification | Coverage & GIS
 order_creation_accuracy   | order_created         | Orders
 control_pass_rate         | order_validation      | Revenue Control
 schedule_fill_rate        | scheduling            | Dispatch
 install_success_rate      | installation          | Field Ops
 connection_success_rate   | connection            | Field Ops / NOC
 first_payment_rate        | payment               | Billing
 activation_rate           | activation            | Billing (Activation)
 thirty_day_retention      | monitoring            | Customer Care / NOC
(14 rows)
```

**Kernel function isolation test:**
```
PASS: gate refused False - SPEC §3 Stage 8 violation: control_pass must be TRUE…
PASS: gate refused None  - SPEC §3 Stage 8 violation: control_pass must be TRUE…
PASS: gate allowed True
```

### Boot note (pre-existing, NOT a Step 4 regression)

A fresh-DB boot still hits the same pre-existing `request.*` permission collision documented in the
Step 3 report (`seed_catalog_if_missing` re-adds `request.*` permission_defs that
`seed_access_if_empty` already inserted). The collision fires in `seed_catalog`, before the new
Step 4 seeder runs, so it does **not** indicate any issue with `seed_canonical_pipeline_if_empty`.
We verified the Step 4 seeder by invoking it directly after `seed_if_empty()` on the fresh DB —
output above. The pre-existing collision is a separate cleanup target, untouched by this step.

---

## What's deferred

- **Real workflow that calls the gate from a stage-9 transition.** The Scheduling/Dispatch module
  doesn't exist yet as a first-class state. Today the gate is wired into the closest analog,
  SUBMITTED → PROVISIONING in `orders.advance_order`. When Scheduling lands as its own state, the
  gate moves to the explicit stage 7 → stage 9 transition (no kernel-function change).
- **Revenue Control role gating** — the rule that "only the Revenue Control role may flip
  `control_pass` to TRUE" lands with the full default-deny matrix in **Step 6**. Until then any
  user with `order.edit` can flip the column; the gate still enforces the Sales→Fulfillment
  invariant on read.
- **KPI computation engines** — `formula` and `denominator` on the seeded `kpi_def` rows are NULL.
  The KPI compute pass (denominators, time-windowing, dashboards) is Step 6+ territory.
- **Audit emission on `control_pass` flips** — when the Revenue Control surface lands, it should
  emit a `workflow.emit("transition", "order", …, {"control_pass": True/False, "by": user_id})`
  event so the verdict is in the audit log (SPEC §0.4 append-only).
