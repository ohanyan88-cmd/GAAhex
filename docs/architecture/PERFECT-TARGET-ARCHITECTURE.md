# PERFECT TARGET ARCHITECTURE — "50 ISPs, never breaks"

> **Status:** the locked NORTH STAR. Every refactor moves toward this; nothing ships that violates an
> invariant below or lacks a clear path to it. Sealed-baseline / **LAW-GV1**. Gev's bar: the platform
> must run **50 ISPs (tenants) and never break.**
> **Author:** Ընգեր · 2026-06-12

---

## 0. What "never breaks at 50 ISPs" actually means
50 ISPs = 50 tenants, each with its own data, its own entities/workflows/pricing/teams, all on **one**
codebase. "Never breaks" is not a wish — it's a set of **enforceable invariants**. If every invariant
has a guard/test that fails the build when violated, the system *cannot* silently rot. That is how we
get to perfect: not a clean slate, but **invariants that can't be broken without the CI screaming.**

---

## 1. THE INVARIANTS (each has an enforcing mechanism — that's the point)

### I1 — Tenant isolation is absolute
Every row, every query, every engine is tenant-scoped. RLS (`gaahex_app` NOSUPERUSER role) is the hard
fence; no endpoint runs as owner. **Zero** tenant-unscoped queries on tenant tables.
**Enforced by:** RLS policies + the `tenant_audit` warner promoted to a **hard CI gate** (today it only
warns — at 50 ISPs a single unscoped query is a cross-tenant leak; it must fail the build).

### I2 — Behavior is configuration, never a per-tenant fork
Each ISP differs (entities, statuses, pricing, org). All of it is **config** (EntityDef / FieldDef /
StatusDef / WorkflowDef / page_config / automation rows), **per tenant**. Zero `if slug == 'x'`, zero
per-tenant code branches, zero bespoke routers for one entity.
**Enforced by:** the drift guard's slug-agnostic rules (Q4) + the config-only killer test, extended to
**KT-2ND-TENANT**: stand up a full 2nd ISP with config only.

### I3 — Engines are decoupled; cross-domain work is EVENT choreography
The lifecycle engine moves a record through stages and **emits an Event**. It knows nothing about
billing/CRM/care. The **Billing**, **CRM**, and **Customer-Care** engines each **subscribe** and react
in their own domain. No engine reaches into another. (`order.activated` → Billing provisions ·
CRM activates customer · Care creates the check-call task — independently.)
**Enforced by:** an Event bus contract + per-engine subscriber registry; a rule that side-effects are
*never* inline calls across domains (lint/review gate).

### I4 — Side-effects are exactly-once and atomic
At 50 ISPs, retries/races happen. Every side-effect (provision, invoice, customer-create, task) is
**idempotent** (keyed on source id) and runs **in the same DB transaction** as the trigger, or via a
durable outbox if cross-process.
**Enforced by:** idempotency keys + transactional emit; KT replays a trigger and asserts no duplicate.

### I5 — Determinism: one source of truth, no ambiguity
Exactly **one** WorkflowDef per entity (no duplicate/stale rows → no `.first()` roulette — the bug
behind today's Step-4 fallback). Exactly one StatusDef set = the SST slice. No legacy rows.
**Enforced by:** unique constraints + the normalizer (prune-no-mercy) + parity rules.

### I6 — No drift, ever
The SST, the entity defs, the pipeline, the standards stay in lockstep. Code and config can't silently
diverge.
**Enforced by:** the drift guard (SST-1 parity already live) extended to cover WorkflowDef↔SST,
page_config↔def.fields, perms registry — all **hard CI gates**.

### I7 — Everything load-bearing has a killer test
Each invariant + each cross-engine flow has a KT that fails the build if broken. The E2E walks the full
ISP loop (lead → order → customer → subscription → invoice → payment → care task) end to end.
**Enforced by:** KT suite in CI; the E2E is mandatory-green.

---

## 2. THE LIFECYCLE TARGET (the concrete application of I1–I7)

```
  CONFIG (per tenant)                         KERNEL ENGINES (decoupled, event-driven)
  ───────────────────                         ────────────────────────────────────────
  EntityDef + StatusDef (SST slices)          Workflow engine — drives transitions on any entity
  WorkflowDef transitions + GUARD refs          (Records AND first-class tables) via adapters
  automation rows (trigger=Event, action)     Guard registry — Revenue-Control registers stage-8 gate
                                              Event bus — emits lifecycle Events
                                              Billing / CRM / Care engines — SUBSCRIBE + react

  LEAD (Record, stages 1→6) --convert@ORDER_CREATED-->  ORDER (first-class, stages 7→13)
     emits lead.* events                                  transitions = config; gate = guard ref
                                                           --emits order.activated@ACTIVATION-->
                                                              ├─ Billing engine  → provision subscriptions
                                                              ├─ CRM engine      → create+activate CUSTOMER
                                                              └─ Care engine     → create welcome check-call task
  CUSTOMER (Record, active base) — operational, event-fed
```

- **Order stays first-class** (real FKs: control_pass, subscription_id, VLAN/CPE, deposit) — I-correct.
- **Order lifecycle = config** — WorkflowDef transitions (live) + a generic transition kernel + OrderAdapter.
- **Control gate = a named guard** the Revenue-Control engine registers — config declares, kernel enforces.
- **Side-effects = events** — order emits `order.activated`; each engine subscribes (I3), idempotently (I4).
- **`orders.py` end-state:** thin first-class data CRUD only. Zero lifecycle/business logic.

---

## 3. THE PATH (refactor toward the north star — phased, KT-gated, billing-safe)
Already done: iron-rule lifecycle (lead/order/customer, 2 conversions, CC task) + config-driven list
pages + config-driven order stage sequence (with a temporary fallback). Remaining, in order:

1. **Determinism (I5):** dedupe order WorkflowDef rows; make `get_transitions` deterministic; drop the
   Step-4 fallback. *(Small, safe, removes the last order-sequence hardcode.)*
2. **Transition kernel + OrderAdapter (I3 base):** one transition service for Records + first-class
   tables. `advance` delegates; behavior identical; KT parity.
3. **Guard registry (I3):** stage-8 gate → `guard: control_gate:stage8`, Revenue-Control registers the
   impl. KT: blocks unpaid, passes cleared.
4. **Event choreography (I3+I4):** `order.activated` Event; Billing/CRM/Care become subscribers; remove
   inline side-effect calls. KT: subs+customer+task appear once, idempotent.
5. **Cutover (I2):** frontend → generic `/transitions`; retire `orders.py` lifecycle endpoints.
6. **Harden the gates (I1+I6):** promote `tenant_audit` + drift to hard CI gates; add KT-2ND-TENANT.

**Definition of "perfect" / done:** every invariant I1–I7 has a live enforcing guard/test. Then the
system *structurally cannot* break silently at 50 ISPs — the build fails first.

---

## 4. Why this never breaks at 50 ISPs
- 50 tenants share one codebase; each is **pure config** (I2) → no forks to drift.
- RLS + hard tenant gate (I1) → no cross-tenant leak, ever.
- Engines decoupled by events (I3) → adding tenants/load can't create breakage cascades.
- Idempotent + atomic (I4) → retries/races at scale don't double-bill or half-provision.
- One source of truth (I5) + no drift (I6) → no ambiguous/stale behavior across tenants.
- KTs (I7) → any regression fails the build before it reaches a tenant.

This is the perfect way: not zero imperfections today, but **imperfections that cannot survive CI.**
