# Lifecycle Model — THE IRON RULE (canonical) + correction plan

> **Status:** CANONICAL model locked by Gev 2026-06-11 ("iron rule, last time"). This **supersedes and
> deletes** the earlier "A′ merge lead+order into one journey" idea — that was WRONG. The model is
> **3 separate entities, each owning a stage-slice, with 2 conversions.** Parallel iron rule: **NO
> HARDCODE** — every correction lands as config / WorkflowDef / kernel, never bespoke code.

---

## 1. THE IRON RULE

```
  14-stage SST (frontend/src/lib/lifecycle.ts)  split into 3 OWNED slices + 2 conversions:

  ┌──────────────── LEAD  (sales pipeline) ────────────────┐
  │ 1 LEAD → 2 VALIDATED_LEAD → 3 ASSIGNED → 4 DEAL        │
  │ → 5 CONTRACT_SIGNED → 6 ORDER_CREATED                  │   enters from anywhere:
  └────────────────────────────────────────────────────────┘   manual OR autogen (call, social…)
                         │
              stage 6 ORDER_CREATED = SALES DONE
                         ▼  ── CONVERT: lead → ORDER ──
  ┌──────────────── ORDER  (fulfillment pipeline) ─────────┐
  │ 7 ORDER_VALIDATED → 8 SCHEDULING → 9 CONFIG            │
  │ → 10 INSTALLATION → 11 CONNECTION_TEST                 │
  │ → 12 PAYMENT_CONFIRMED → 13 ACTIVATION                 │
  └────────────────────────────────────────────────────────┘
                         │
              stage 13 ACTIVATION = DONE
                         ▼  ── CONVERT: order → CUSTOMER ──
  ┌──────────────── CUSTOMER  (active base — NOT a pipeline) ┐
  │ Full member of the active base the instant activation    │
  │ completes — 1 second or 10 years, same status.           │
  │ Operational: search → find → act (pay / change / care).  │
  └──────────────────────────────────────────────────────────┘

  S14 MONITORING — NOT network monitoring. It is a CUSTOMER-CARE CHECK-CALL
  (all OK? services activated? were our people polite?). OPEN: is it a stage or a care activity?
```

**3 entities · 2 conversions · Customer = active base, separate.**

---

## 2. Current code CONTRADICTS the rule — what's WRONG (must be deleted/corrected)

| # | Today (WRONG) | Must become (iron rule) | Surface |
|---|---|---|---|
| 1 | `lead` statuses = stages 1→5 (no ORDER_CREATED) | LEAD owns 1→6 (gains **ORDER_CREATED** as terminal sales stage) | `seed.py` lead StatusDefs (config) |
| 2 | `order` statuses = 6→13 (has order_created) | ORDER owns 7→13; **drop order_created** (belongs to lead) | `seed_catalog.py` order StatusDefs (config) |
| 3 | `convert.py`: **lead → customer** at contract_signed | **lead → ORDER** at ORDER_CREATED | `routers/convert.py` (delete/replace) |
| 4 | order created manually under existing customer (`POST /api/orders` + customer_id) | order is **born from the lead's conversion** at stage 6 | `routers/orders.py` create |
| 5 | customer created EARLY (at convert) | customer **created only at ACTIVATION** (stage 13) | conversion logic |
| 6 | `orders.py` = bespoke hardcoded router (stage machine, control gate, provisioning in code) | dissolve into **WorkflowDef guards + kernel automation** (NO HARDCODE) | `routers/orders.py` (retire) |
| 7 | "A′ merge lead+order" proposal | **deleted** — 3 entities stay separate | this doc |

---

## 3. Correction sequence (config-first, no-hardcode, phased — never break billing)

**Step 1 — Stage slices (config only, safe, reversible).**
Move ORDER_CREATED to LEAD; order starts at ORDER_VALIDATED. Update the two page_config presets:
leads kanban = stages 1→6, orders kanban = 7→13. (page_config + StatusDef config — no code logic.)

**Step 2 — Conversion 1 (lead → order @ ORDER_CREATED).**
Replace `convert.py` (lead→customer) with a config/kernel conversion: when a lead reaches ORDER_CREATED,
the kernel spawns an ORDER (entity_key=order) carrying the lead's identity; lead becomes terminal.

**Step 3 — Conversion 2 (order → customer @ ACTIVATION).**
At ACTIVATION, the kernel creates the CUSTOMER (active base) + provisions subscriptions — as **automation
rules**, not `orders.py` code. Customer exists **only from here on**.

**Step 4 — Dissolve `orders.py`.**
Re-express its stage machine + control gate as WorkflowDef transitions + GXL guards on the order entity;
provisioning as kernel automation. Retire the bespoke router. KT-JOURNEY-style killer test proves it.

**Step 5 — Cleanup.**
Remove dead perms/routes; data migration of existing rows to the corrected slices; reversible, dev-bulk first.

> Customers' billing/subscription/invoice/payment web is **never touched** — it stays keyed on customer_id.
> Each step ships green (tests + drift) and is independently reversible.

---

## 4. Open question for Gev
**S14 MONITORING** — is the customer-care check-call a **pipeline stage** (a 14th stage the customer
passes through once) or a **recurring care activity** (a task/touchpoint on an active customer, not a
status)? This decides whether customer has any "stage" at all or is purely an active-base record with
care tasks hanging off it.

---

## 5. Governance
3-entity model + re-pointed conversions + dissolving `orders.py` = **LAW-GV1 sealed-baseline** change.
Amends `02_DOMAIN`, `03_INFORMATION`, `07_WORKFLOW` (KT-JOURNEY), `08_PERMISSION`, and adds an
INV invariant: *lifecycle is owned by 3 config-driven entities with kernel-driven conversions and zero
bespoke routers.* Ratify before code.
