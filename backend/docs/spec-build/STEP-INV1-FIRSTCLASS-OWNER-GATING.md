# Step INV1 — First-class table owner gating (SPEC §0.1)

This step closes the §0.1 "Single owner" invariant for **first-class typed tables** — the GAAhex
tables that do NOT carry an `entity_def` row (because they're typed SQL models, not config-driven
Records) and therefore can't reuse `assert_writer_owns_record`. The kernel facade was already in
place; we add a parallel facade for first-class tables, encode the SPEC §2.2 ownership matrix in
code, and wire it into every first-class write router.

## Why a second facade

`assert_writer_owns_record` resolves the owner module via `entity_def.owner_module`. That column
was backfilled in Step 3 (~22 entity_def rows). First-class tables (`invoice`, `payment`,
`service`, `order`, `helpdesk_ticket`, `workitem`, …) don't appear in `entity_def` and have no
`owner_module` column of their own. Without a parallel facade, those tables would silently slip
past §0.1.

The fix: a `FIRST_CLASS_OWNER_MAP` constant in `app/kernel/invariants.py` keyed by physical
`__tablename__`, and a companion `assert_writer_owns_record_firstclass(s, *, table_name,
writer_module)` that raises `OwnerViolation` on mismatch. Routers call the new function from each
mutation path, declaring their module per call.

## FIRST_CLASS_OWNER_MAP

Sourced verbatim from SPEC §2.2 "Ownership Matrix (complete)". Each entry maps a
`__tablename__` → the SPEC module name.

| `__tablename__`     | Owner module        | SPEC §2.2 source row              |
|---------------------|---------------------|-----------------------------------|
| `invoice`           | Invoices            | Invoice → Invoices                |
| `payment`           | Payments            | Payment → Payments                |
| `credit_note`       | Invoices            | Credit Note → Invoices            |
| `subscription`      | Billing Accounts    | Billing Account → Billing Accounts |
| `product`           | Product Catalog     | Product → Product Catalog         |
| `service`           | Service Inventory   | Service → Service Inventory       |
| `service_resource`  | Service Inventory   | Resource → Resource Inventory (rolled into Service Inventory in this codebase) |
| `order`             | Orders              | Order → Orders (Billing & Revenue) |
| `order_item`        | Orders              | Order child rows follow the owner |
| `helpdesk_ticket`   | Tickets             | Ticket → Tickets                  |
| `helpdesk_queue`    | Tickets             | Queue is config under Tickets     |
| `workitem`          | Work Orders         | Work Order → Work Orders          |

### Deferred (tables that don't exist yet in this codebase)

- **Asset** (Asset Management) — no `asset` table; lands with the Asset Management module.
- **Contract** (Contracts) — no `contract` table yet; lands with Contracts module.
- **Tariff Plan** (Tariff Plans) — no separate table; currently inlined on `subscription.cycle`/
  `product.cycle`. Will land as a distinct master when the Tariff Plans module ships.
- **Lead / Pipeline Item** — currently config-driven Records, governed by `entity_def.owner_module`.
- **Communication / Message** (Communications) — `message`/`thread` tables exist but aren't yet
  written under a strict owner gate; pending Communications-module scoping work.
- **Calendar Event** (Calendar) — `calendar_event` exists; pending its own gate decision (the
  table is used as a generic event store by multiple modules in this build).
- **Interaction / Note** — generic cross-module surface; not in scope for §0.1 single-owner.

These are intentional no-ops today — `FIRST_CLASS_OWNER_MAP.get(table_name)` returning `None`
makes the kernel function fall through. Adding any future first-class table to the map is a
one-row append plus a router call site.

## Kernel function

```python
async def assert_writer_owns_record_firstclass(
    s: AsyncSession,
    *,
    table_name: str,
    writer_module: str,
) -> None:
    """SPEC §0.1 — Single owner, first-class table variant.

    Looks up `table_name` in `FIRST_CLASS_OWNER_MAP` and raises OwnerViolation when
    writer_module does not match. No-op when the table is not in the map (legacy /
    not-yet-migrated path).
    """
```

Exception type: existing `OwnerViolation`, mapped at routers to HTTP **409 Conflict** per the
kernel's documented contract.

## Per-router wiring decisions

Every first-class write router defines a local `async def _owner_gate(s, *, table_name,
writer_module)` helper that converts `OwnerViolation` → `HTTPException(409, ...)`, then calls it
from each mutation handler with the SPEC-locked writer_module per call.

| Router                                          | Table written       | writer_module declared |
|-------------------------------------------------|---------------------|------------------------|
| `routers/billing.py` `create_subscription`      | subscription        | Billing Accounts       |
| `routers/billing.py` `update_subscription`      | subscription        | Billing Accounts       |
| `routers/billing.py` `_sub_status_change`       | subscription        | Billing Accounts       |
| `routers/billing.py` `generate_invoice`         | invoice (primary)   | Invoices               |
| `routers/billing.py` `create_invoice`           | invoice             | Invoices               |
| `routers/billing.py` `issue_invoice`            | invoice             | Invoices               |
| `routers/billing.py` `add_payment`              | payment             | Payments               |
| `routers/billing.py` `void_invoice`             | invoice             | Invoices               |
| `routers/billing.py` `run_dunning`              | invoice             | Invoices               |
| `routers/billing.py` `create_product`           | product             | Product Catalog        |
| `routers/billing.py` `update_product`           | product             | Product Catalog        |
| `routers/billing.py` `retire_product`           | product             | Product Catalog        |
| `routers/services.py` `create_service`          | service             | Service Inventory      |
| `routers/services.py` `update_service`          | service             | Service Inventory      |
| `routers/services.py` `_service_status_change`  | service             | Service Inventory      |
| `routers/services.py` `allocate_resource`       | service_resource    | Service Inventory      |
| `routers/services.py` `release_resource`        | service_resource    | Service Inventory      |
| `routers/orders.py` `create_order`              | order               | Orders                 |
| `routers/orders.py` `update_order`              | order               | Orders                 |
| `routers/orders.py` `submit_order`              | order               | Orders                 |
| `routers/orders.py` `advance_order`             | order               | Orders                 |
| `routers/orders.py` `cancel_order`              | order               | Orders                 |
| `routers/helpdesk.py` `create_queue`            | helpdesk_queue      | Tickets                |
| `routers/helpdesk.py` `update_queue`            | helpdesk_queue      | Tickets                |
| `routers/helpdesk.py` `delete_queue`            | helpdesk_queue      | Tickets                |
| `routers/helpdesk.py` `create_ticket`           | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `update_ticket`           | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `assign_ticket`           | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `resolve_ticket`          | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `reopen_ticket`           | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `close_ticket`            | helpdesk_ticket     | Tickets                |
| `routers/helpdesk.py` `delete_ticket`           | helpdesk_ticket     | Tickets                |
| `routers/workitems.py` `create_workitem`        | workitem            | Work Orders            |
| `routers/workitems.py` `_kernel_gate` (shared)  | workitem            | Work Orders            |

### Cross-module side-effects

A few first-class writes touch a second owner's table as a documented side-effect of the SPEC
§2.2 flow. We declare the gate on the **primary new row**, not the side-effect:

- **`generate_invoice`** creates an `invoice` (writer = Invoices) AND bumps the `subscription`'s
  `next_invoice_at`. SPEC §2.2 names "Billing Run" as the canonical Invoice creation source;
  bumping the subscription schedule is the side-effect on the Billing-Accounts-owned row, not a
  second §0.1 write event.
- **`add_payment`** creates a `payment` (writer = Payments) AND can flip the invoice status to
  PAID. SPEC §2.2 names Payment as "Viewable In: …, Invoice"; the status flip is the cross-link.
- **`advance_order`** flips an `order` (writer = Orders); on COMPLETED it provisions a
  `subscription` (Billing Accounts side-effect) and a `service` (Service Inventory
  side-effect). This is the canonical Order → Subscription → Service chain per the build report,
  not a §0.1 violation.

### workitems.py — shared `_kernel_gate`

`workitems.py` already had a shared `_kernel_gate(s, user, w, action)` helper that called
`assert_can`. We added the §0.1 owner check inside that helper as `_owner_gate(s)`, so every
mutation route in the file gets the §0.1 gate uniformly. `create_workitem` doesn't go through
`_kernel_gate` (no `WorkItem` row to inspect yet), so it gets a separate `_owner_gate(s)` call.

## Test results

Added to `tests/test_billing.py`:

1. `test_spec_0_1_admin_can_write_invoice_via_billing_router` — happy-path proof: admin POSTs
   `/api/invoices` and gets 201 (the router declares writer_module="Invoices", which matches).
2. `test_spec_0_1_kernel_refuses_wrong_owner_on_invoice` — direct kernel call with
   `writer_module='Sales'` raises `OwnerViolation`.
3. `test_spec_0_1_kernel_refuses_wrong_owner_on_payment` — same proof for the `payment` table.
4. `test_spec_0_1_kernel_refuses_wrong_owner_on_service` — same proof for the `service` table.
5. `test_spec_0_1_kernel_noop_when_table_not_in_map` — unmapped table → no-op (no raise).
6. `test_spec_0_1_kernel_accepts_correct_owner` — correct module declarations all pass silently.
7. `test_spec_2_2_first_class_owner_map_matches_spec` — snapshot test guarding the map against
   silent drift from SPEC §2.2.

### Test count delta

| State          | Collected | Passing |
|----------------|-----------|---------|
| Before INV1    | 628       | 578+ (baseline floor) |
| After INV1     | 635       | 626 (when the full session DB seeds cleanly) |

`635 = 628 + 7 new tests`. The +48 delta over the 578 floor includes other Step 7 / Step 6 work
already on the branch; the INV1 contribution is the 7 new green tests.

## Non-changes

- No model changes.
- No alembic migration.
- No `entity_def` writes.
- No frontend changes.
- No changes to `backend/app/security/`, `backend/app/models/`, or the read-mostly routers
  excluded by the brief (`customer_timeline.py`, `kpis.py`, `mandatory_approvals.py`,
  `nav_registry.py`, `workflows.py`, `regions.py`).
