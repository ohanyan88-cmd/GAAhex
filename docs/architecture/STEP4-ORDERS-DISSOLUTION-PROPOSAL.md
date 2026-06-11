# Step 4 (FULL) — Dissolving `orders.py` into config + kernel

> **Status:** DRAFT design proposal for Gev review. Sealed-baseline / **LAW-GV1** change (extends the
> Workflow + Automation kernel engines). Nothing built yet. Step-4 **partial** is already live
> (config-driven stage sequence with fallback, commit `b52e390`); this proposal is the rest.

---

## 1. Goal + the core tension

**Goal:** the order's whole fulfillment lifecycle (stages, control gate, side-effects) renders/behaves
from **configuration + the 5 kernel engines** — no bespoke router. Today `orders.py` = **763 lines, 11
endpoints** hand-coding it.

**The tension (the wall we hit):** the `order` is a **first-class table**, not a config `Record`. It
carries relational, billing/NOC-critical columns that a JSONB Record cannot hold safely:
`control_pass*`, `install_substage*`, `deposit_*`, `splitter_strand_allocation_id`, `vlan_assignment_id`,
`cpe_binding_id`, `subscription_id`, `lead_id`, `customer_id`, `number`, `total`, FKs to account/payment.

**Therefore the decision is NOT "convert order → Record."** That would shred the FKs and the
billing/NOC integrity. The decision is: **extend the Workflow + Automation engines to DRIVE first-class
entities (starting with `order`), and express the order's behavior as config.** The order stays a
first-class table; its *lifecycle logic* leaves the router and becomes config + kernel.

---

## 2. Target architecture — 3 engine pieces

### A. A generic transition kernel that works on first-class tables (not only Records)
Today: `records.py` runs config-driven transitions for **Records**; `orders.py` hand-codes them for the
**order table** (`submit`/`advance`/`cancel`). Target: **one transition service** both use, via a small
**entity adapter** that knows how to (a) load the row, (b) read/write its `status`, (c) emit the
`transition` Event. Records use the JSONB adapter; order uses an `OrderAdapter` (status column on the
table). The transition service validates against the entity's **WorkflowDef** (config — already done in
Step-4 partial), runs guards (B), and fires automation (C).

→ `submit`/`advance`/`cancel` collapse into the generic `POST /api/{entity}/{id}/transitions` path with
an order adapter. `orders.py`'s bespoke endpoints retire.

### B. The Stage-8 Control Gate → a named transition GUARD
Today: `compute_stage8_status` + kernel `assert_can_advance_to_scheduling` hard-wired into `advance`.
Target: the `order_validated → scheduling` WorkflowDef transition declares a **guard reference**, e.g.
`guard: "control_gate:stage8"`. GXL alone can't compute stage-8 (it needs credit/deposit/payment-method
checks), so we add a **kernel guard registry**: config names the guard, the kernel holds the
implementation (`stage8_gate.compute_stage8_status`). The transition service refuses the step unless the
named guard passes — **config declares it, kernel enforces it**, exact same revenue-control safety.

### C. Activation side-effects → kernel AUTOMATION actions
Today: `advance` hand-calls `_provision_subscriptions`, `_create_customer_from_lead`,
`_create_care_checkcall_task` on entering `activation`. The automation engine's action types today are
**`notify | set_field | webhook | emit_event`** — none of these can provision/convert. Target: add a
small set of **first-class automation actions**, invoked by config rules `on_enter(activation)`:
- `provision_subscriptions`
- `create_customer_from_order` (the lead→customer carry, sets `order.customer_id`)
- `create_task` (the Customer-Care welcome check-call)

The automation rules live in config (`automation` rows: trigger = enter stage, action = one of the
above). The kernel holds the action implementations. → the side-effects leave the router.

---

## 3. What each current hardcode becomes
| Today in `orders.py` (hardcode) | Target (config + kernel) |
|---|---|
| `_ADVANCE` map → next stage | ✅ already config (WorkflowDef transitions, Step-4 partial) — drop the fallback once B/A land |
| `submit` / `advance` / `cancel` endpoints | generic `/api/{entity}/{id}/transitions` + `OrderAdapter` |
| Stage-8 control gate in `advance` | WorkflowDef transition `guard: control_gate:stage8` + kernel guard registry |
| `_provision_subscriptions` at activation | automation action `provision_subscriptions` on_enter(activation) |
| `_create_customer_from_lead` at activation | automation action `create_customer_from_order` |
| `_create_care_checkcall_task` at activation | automation action `create_task` (CC welcome call) |
| deposit collection / release endpoints | stay first-class for now (Phase 5+) — they're operational write APIs, not lifecycle |

---

## 4. Phased migration (billing-safe, never a big-bang)

**Phase 0 — Ratify (LAW-GV1).** This doc.

**Phase 1 — Transition kernel + OrderAdapter.** Build the shared transition service + an `OrderAdapter`.
`advance` internally delegates to it (behavior identical). No endpoint change yet. KT proves parity.

**Phase 2 — Guard registry.** Move the Stage-8 gate behind a named guard `control_gate:stage8`; the
WorkflowDef `order_validated→scheduling` transition references it. `advance` calls the generic guard
path instead of inline `compute_stage8_status`. KT proves the gate still blocks/passes identically.

**Phase 3 — Automation actions.** Add `provision_subscriptions` / `create_customer_from_order` /
`create_task` actions + seed the `automation` rules on_enter(activation). `advance` stops hand-calling
the helpers; the engine fires them. KT proves subs+customer+task still appear, idempotently.

**Phase 4 — Cutover endpoints.** Point the frontend at `/api/{entity}/{id}/transitions`; retire
`orders.py` `submit`/`advance`/`cancel`. Remove `_FORWARD_FALLBACK`.

**Phase 5 — Cleanup.** Fold remaining bespoke bits (deposit/release) where sensible; shrink `orders.py`
to thin first-class CRUD + the operational write APIs that genuinely belong there.

> Each phase ships **green (E2E + drift)** and is independently reversible. Billing (subs/invoices) and
> NOC (install substages) integrity preserved at every step — that's the whole point of phasing.

---

## 5. What breaks / risks
| Surface | Risk | Mitigation |
|---|---|---|
| Billing | provisioning → subscriptions → invoices → payments | Phase 3 KT asserts identical subs/invoices; idempotency keys |
| NOC | install substages / VLAN / CPE bindings | left first-class; transitions don't touch them in this scope |
| Control gate | a config/guard regression = provisioning without credit/deposit checks | Phase 2 KT: gate blocks an unpaid order, passes a cleared one — exact parity |
| Transactionality | side-effects must be atomic with the transition | run in the same DB transaction as the status write |
| Duplicate WorkflowDef rows | the stale-row issue behind the Step-4 fallback | Phase 1: dedupe order WorkflowDef rows; make `get_transitions` deterministic |

---

## 6. Killer test — `KT-ORDER-CONFIG`
A single test that proves the thesis for orders: an order is configured **entirely** via WorkflowDef
(transitions + `control_gate:stage8` guard) + `automation` rules (on_enter activation →
provision/customer/task), and a lead converts → order advances through 7→13 → at activation a customer
+ subscriptions + a CALL_CUSTOMER task all appear — **with ZERO order-specific code in the transition
path** (the OrderAdapter is generic infra, not order business logic). This becomes the M1 proof that a
first-class operational entity can be lifecycle-driven by config.

---

## 7. Governance (LAW-GV1)
Extends the kernel engines → sealed-baseline. Amends:
- `Architecture Constitution` — Workflow engine drives first-class entities via adapters; Automation
  engine gains first-class action types; guard registry pattern.
- `07_WORKFLOW_PROCESS_ARCHITECTURE.md` — **KT-ORDER-CONFIG**.
- Automation action-type registry doc — add `provision_subscriptions` / `create_customer_from_order` /
  `create_task`.
- PRM — order lifecycle maps to its Platform Core via the generic engine, not a bespoke router.

---

## 8. Open decisions for Gev
1. **Guard expression:** named kernel guard (`control_gate:stage8`, recommended — GXL can't do credit
   checks) vs. trying to push the whole gate into GXL (not feasible for the financial checks).
2. **Automation action set:** add exactly the 3 actions above (recommended), or a more general
   "run named kernel hook" action (more flexible, less explicit).
3. **`orders.py` end-state:** thin first-class CRUD + deposit/release write APIs remain (recommended),
   vs. push even those into config later.
4. **Scope now:** do all of Phases 1-4, or start with **Phase 1 (transition kernel + OrderAdapter)** as
   the first concrete, low-risk slice and re-evaluate.

---

## 9. Recommendation
A′ Step-4-full is the right end-state and the biggest no-hardcode payoff, but it is **engine work, not a
refactor** — do it **phased, KT-gated, billing-safe**, one engine piece at a time. Recommend ratifying
this, then executing **Phase 1** as the first slice. The lifecycle iron rule (Steps 1-3) already stands;
this makes the order's *behavior* config-driven without risking billing.
