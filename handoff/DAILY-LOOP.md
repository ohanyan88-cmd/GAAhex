# ISP Daily Loop Runbook

The single document for understanding and running the back-office chain end-to-end:
**Lead → Customer → Order → Subscription + Service → activate → Invoice → Payment → Ticket.**
The chain works in the backend today; this captures it exactly (Gev's rule: everything written down).

Scope: this documents what **EXISTS in the code right now** and marks each step **AUTO** (the system
does it) or **MANUAL** (a person/API call does it).

**Money:** every amount is an integer in **luma** (AMD minor units, 1 ֏ = 100 luma). Clients divide
by 100 to display, e.g. `5000` luma → `֏50`. Never store fractional currency.

**Conventions in force on every step:** tenant-scoped + org-scoped (`owner_node_id` against the
caller's node/subtree/tenant grant), an `entity.verb` or `verb.entity` permission gate, and an immutable audit `Event`
emitted via `workflow.emit` on every mutation. Auth is `Depends(current_user)`.

---

## 1. The loop, one diagram

```
  [Lead]  record(entity_key="lead")
    |  MANUAL  POST /api/leads/{id}/convert  -> CONVERTED + create Customer (idempotent, A20)
    v
 [Customer]  record(entity_key="customer"), initial status PROSPECT
    |  MANUAL  POST /api/orders            (order.customer_id -> record.id)
    v
  [Order]  DRAFT
    |  MANUAL  POST /api/orders/{id}/submit         DRAFT -> SUBMITTED
    |  MANUAL  POST /api/orders/{id}/advance        SUBMITTED -> PROVISIONING
    |  MANUAL  POST /api/orders/{id}/advance        PROVISIONING -> COMPLETED
    v
  [Order COMPLETED]
    |  AUTO    per OrderItem with a product_id: create ACTIVE Subscription (amount/cycle copied from Product)
    |          (subscription.customer_id -> record.id, subscription.product_id -> product.id)
    +--AUTO--> [Subscription]  ACTIVE
    |              |  AUTO   provision_service_for_subscription(...)  (service.subscription_id -> subscription.id)
    |              v
    |          [Service]  PENDING   <-- note: lands PENDING, NOT active
    |              |  MANUAL  POST /api/services/{id}/activate        PENDING -> ACTIVE (sets activated_at)
    |              v
    |          [Service]  ACTIVE
    |
    +-- billing branch (per subscription) -----------------------------------------
                   |  AUTO (batch) POST /api/billing/run-cycle        -> ISSUED Invoice (no DRAFT, E20)
                   |           (or MANUAL single) POST /api/subscriptions/{id}/generate-invoice -> DRAFT
                   v
               [Invoice]  DRAFT (if single) or ISSUED (if run-cycle)
                   |  MANUAL  POST /api/invoices/{id}/issue            DRAFT -> ISSUED (if DRAFT)
                   v
               [Invoice]  ISSUED
                   |  MANUAL  POST /api/invoices/{id}/payments         (payment.invoice_id -> invoice.id)
                   |  AUTO    when Σ(payments) >= invoice.total  ->  Invoice flips to PAID
                   v
               [Invoice]  PAID
                   ...  MANUAL  POST /api/invoices/run-dunning  -> ISSUED past due_at flip to OVERDUE (AUTO within the run)

  [Ticket]  record(entity_key="ticket")   MANUAL, STANDALONE — no FK to service/subscription/customer
```

---

## 2. Stage-by-stage runbook

Each stage: the exact endpoint(s), the required body fields, the status it lands in, and the foreign
keys that link it to the previous stage. Verified against `backend/app/routers/` and `models/`.

### Stage 1 — Lead (CRM, config-driven Record)
- **Create:** `POST /api/leads` — body: `name` (required); optional `phone`, `email`, `source`
  (`Website|Referral|Cold Call|Ad`). Lands at the **initial status `NEW`** (status is lifecycle-managed,
  never set on create).
- **Work it:** `POST /api/leads/{rec_id}/transition` body `{"to": "CONTACTED"}` etc. Lifecycle
  `NEW → CONTACTED → QUALIFIED → CONVERTED` (or `→ LOST`). The `NEW→CONTACTED` move has a GXL guard
  `phone != None and phone != ''`.
- **Model:** `Record` (`entity_key="lead"`), data in the JSONB `data` bag, `owner_node_id`, `status`.
- **Link to next:** via A20 convert endpoint (Stage 1.5).

### Stage 1.5 — Lead Conversion (A20, convert.py)
- **Convert:** `POST /api/leads/{lead_id}/convert` — idempotent. In one call:
  1. Creates a new Customer `Record` (initial status `PROSPECT`)
  2. Copies shared fields from lead (name, phone, email, source, …) to customer.data
  3. Sets back-links: `lead.data.converted_customer_id = customer.id`, `customer.data.source_lead_id = lead.id`
  4. Transitions the lead to CONVERTED (resolves configured terminal or falls back to positive terminal)
  5. Emits: `create` Event for customer, `convert` Event for lead
- **Response:** `{"customer_id": "<uuid>", "lead_id": "<uuid>", "already": false|true}`. Second call returns the same customer (already=true), never a duplicate.
- **Permission:** must have `leads.edit` (to mutate the lead) and `customers.create` (to create the customer).

### Stage 2 — Customer (CRM, config-driven Record)
- **Create (manual, direct):** `POST /api/customers` — body: `name` (required); optional `email`, `phone`, `plan`
  (`Basic|Pro|Enterprise`). Lands at initial status **`PROSPECT`**.
- **Activate (optional):** `POST /api/customers/{rec_id}/transition` `{"to": "ACTIVE"}` — guard
  `email != None and email != ''`. Lifecycle `PROSPECT → ACTIVE ⇄ SUSPENDED → CHURNED`.
- **OR via conversion:** use Stage 1.5 (`/leads/{id}/convert`) to create + link in one call.
- **Model:** `Record` (`entity_key="customer"`). This record's `id` is the **customer key** every
  downstream BSS table points at.

### Stage 3 — Order
- **Create:** `POST /api/orders` — body: `customer_id` (validated against a `customer` Record, else 422),
  `items: [{description (required), quantity>=1, unit_amount (luma), product_id?}]`. Lands **`DRAFT`**;
  `total` is computed from items (Σ `line_total`, where `line_total = quantity * unit_amount`).
- **Edit (DRAFT only):** `PATCH /api/orders/{order_id}` — replace `items` and/or set `customer_id`.
  Refused once not DRAFT (409).
- **Lifecycle:** `POST /api/orders/{order_id}/submit` (DRAFT→SUBMITTED) → `POST /api/orders/{order_id}/advance`
  (SUBMITTED→PROVISIONING) → `advance` again (PROVISIONING→COMPLETED). `POST /api/orders/{order_id}/cancel`
  → CANCELLED (a COMPLETED order cannot be cancelled — its subscriptions already exist).
- **Models:** `Order` (`number` e.g. `ORD-00007`, `status`, `total` luma), `OrderItem`.
- **Link to previous:** `order.customer_id → record.id`; `order_item.product_id → product.id` (optional).

### Stage 4 — Subscription + Service (the AUTO bridge)
- **Trigger:** reaching **COMPLETED** in `advance_order`. For each `OrderItem` that has a `product_id`,
  `_provision_subscriptions` creates one **ACTIVE** `Subscription` with `plan_name`, `amount`,
  `cycle` **copied from the Product**, `started_at = now`, `next_invoice_at = now + 1 cycle`.
  Items with no `product_id` (one-off charges) are skipped; a since-deleted product is skipped (never
  fails the order). The `advance` response includes `provisioned_subscriptions: [ids]`.
- **Then (still AUTO, fail-soft):** for each new subscription, `provision_service_for_subscription`
  creates a `Service` named after `plan_name`, **status `PENDING`** (a service hiccup is swallowed so
  it never blocks the order).
- **Models:** `Subscription` (status `ACTIVE|SUSPENDED|CANCELLED`, `amount` luma/cycle,
  `cycle monthly|yearly`, `next_invoice_at`), `Service` (status `PENDING|ACTIVE|SUSPENDED|TERMINATED`,
  `activated_at`).
- **Links:** `subscription.customer_id → record.id`, `subscription.product_id → product.id`,
  `subscription.owner_node_id` = order's; `service.subscription_id → subscription.id`,
  `service.customer_id → record.id`.

### Stage 5 — Service activation (MANUAL)
- **Activate:** `POST /api/services/{service_id}/activate` — PENDING or SUSPENDED → **ACTIVE**, sets
  `activated_at` on first activation. (`/suspend` ACTIVE→SUSPENDED; `/terminate` →TERMINATED.)
- **Resources (MANUAL, freeform inventory):** `POST /api/services/{service_id}/resources`
  body `{kind: ip|mac|port|device|circuit|other, value, label?}` → `ServiceResource` status `ALLOCATED`.
  `DELETE …/resources/{id}` sets status `RELEASED` (row kept for history). There is **no** automatic
  IP pull from the IPAM pool here (§4).
- **Link:** `service_resource.service_id → service.id`.

### Stage 6 — Billing Cycle Run (E20, billing_cycle.py)
- **Batch run (the modern path):** `POST /api/billing/run-cycle` body (optional) `{"as_of": "YYYY-MM-DD"}`
  (defaults to today UTC) — in one idempotent transaction:
  1. Finds all ACTIVE subscriptions in the tenant
  2. For each subscription, checks if DUE using the rule: never billed (`last_invoiced_at IS NULL`) OR
     `_add_cycle(last_invoiced_at) <= as_of` (a full cycle has passed since last billing)
  3. For each DUE subscription, creates an **ISSUED** `Invoice` (not DRAFT):
     - period: `[next_invoice_at (or started_at), +1 cycle)`
     - total = subscription.amount
     - issued_at = as_of, due_at = as_of + 14 days
     - one InvoiceLine (description = plan_name, amount = subscription.amount)
     - Emits: `create` Event with `status: "ISSUED", via: "run-cycle"`
  4. Stamps `subscription.last_invoiced_at = as_of` (idempotency marker — rerunning same as_of generates 0)
  5. Advances `subscription.next_invoice_at` to period_end (same as manual generate-invoice)
  6. Fail-soft per-subscription: errors don't abort the batch, collected in `errors` array
  7. One final commit persists all successful invoices atomically
- **Response:** `{"as_of": "2025-02-20", "generated": 5, "skipped": 2, "errors": [], "invoices": [...]}`
- **Requires:** `invoice.create` permission (tenant-wide gate, same as dunning).

### Stage 6a — Manual Invoice Generation (Alternative to run-cycle)
- **Single subscription (the old path):** `POST /api/subscriptions/{sub_id}/generate-invoice`
  — creates a **DRAFT** `Invoice` for the period `[next_invoice_at, +1 cycle)` with one `InvoiceLine`
  (`description = plan_name`, `unit_amount = amount`), `total = sub.amount`, and **advances
  `sub.next_invoice_at` to period_end**. Requires `invoice.create`. Refused on a CANCELLED subscription (409).
  - Note: this path does NOT set `last_invoiced_at`, so the billing-cycle run will still consider the subscription due.
- **Manual invoice (freeform):** `POST /api/invoices` with `customer_id` + `lines:[{kind:
  charge|discount|tax, description, quantity, unit_amount}]`; `total = Σ(charge) − Σ(discount) + Σ(tax)`,
  clamped at ≥ 0. Creates DRAFT.

### Stage 6b — Invoice Issuance
- **Issue from DRAFT:** `POST /api/invoices/{inv_id}/issue` — DRAFT → **ISSUED**, sets `issued_at = now` and
  `due_at` (body `due_at`, else `now + 14 days`).
  - Note: run-cycle invoices are created ISSUED, so they skip this step.
- **Models:** `Invoice` (status `DRAFT|ISSUED|PAID|OVERDUE|VOID`, `number` e.g. `INV-00007`, `total`
  luma, `last_invoiced_at` for cycle tracking), `InvoiceLine`.
- **Link:** `invoice.customer_id → record.id`;
  `invoice_line.invoice_id → invoice.id`.

### Stage 7 — Payment
- **Record:** `POST /api/invoices/{inv_id}/payments` body `{amount (luma, >0), method: cash|card|transfer,
  note?}`. Refused on DRAFT/PAID/VOID (409). **AUTO:** when `Σ(payments) ≥ invoice.total` the invoice
  flips to **PAID**.
- **Model:** `Payment` (`amount` luma, `method`, `paid_at`). **Link:** `payment.invoice_id → invoice.id`.

### Stage 8 — Overdue / dunning (batch)
- **Run:** `POST /api/invoices/run-dunning` — every ISSUED invoice past its `due_at` flips to
  **OVERDUE** (idempotent; already-OVERDUE skipped). Returns `{checked, marked_overdue}`. Best-effort
  `invoice.overdue` notifications fire per newly-overdue invoice (no-op unless that notification def is
  seeded). On-demand only — there is no cron (§4).

### Stage 9 — Ticket (support, config-driven Record)
- **Create:** `POST /api/tickets` — `subject` (required), `priority` (`Low|Normal|High|Urgent`).
  Lands **`OPEN`**; lifecycle `OPEN → IN_PROGRESS → RESOLVED`.
- **Model:** `Record` (`entity_key="ticket"`). **No foreign key** to service/subscription/customer —
  see §3 and §4.

### Read-across: Customer 360
- `GET /api/customers/{customer_id}/360` — one read-only payload: the customer `profile`, its
  `subscriptions`, `invoices`, a money `summary` (`currency: AMD`, `total_billed`, `total_paid`,
  `outstanding`, `overdue_count`, counts), recent `activity` (the record's audit Events), and
  best-effort `related` counts for `deal|contact|ticket`. Permission + scope enforced (caller must be
  able to view that customer Record).

---

## 3. What's automatic vs manual today

**AUTOMATIC (the system does it):**
- **Order COMPLETED → Subscription:** each item with a `product_id` mints an ACTIVE subscription,
  amount/cycle copied from the Product (`orders.py::_provision_subscriptions`).
- **Subscription → Service:** the same path provisions a Service (status **PENDING**) per subscription
  (`services.py::provision_service_for_subscription`), fail-soft.
- **Payment fully covers invoice → PAID:** the payment endpoint flips status when `Σ payments ≥ total`.
- **`generate-invoice` + `run-cycle` advance the schedule:** `subscription.next_invoice_at` rolls forward one cycle.
- **`run-cycle` mints invoices:** every ACTIVE, due subscription gets an ISSUED invoice in one batch (E20).
- **`run-dunning` marks OVERDUE:** ISSUED-past-due invoices flip in one batch call.

**MANUAL (a person / API call drives it):**
- **Lead → Customer (via A20):** `POST /api/leads/{id}/convert` idempotently creates the customer,
  copies fields, back-links both records, and transitions the lead to CONVERTED. One call.
- **Order lifecycle:** create / submit / advance / advance are each separate calls.
- **Service activation:** the auto-provisioned service is PENDING; going ACTIVE is a manual
  `/activate`. Resource allocation is manual.
- **Billing:** use `POST /api/billing/run-cycle` (batch, E20) to bill all due subscriptions at once;
  or manually `POST /api/subscriptions/{id}/generate-invoice` for single subscriptions. Issuing
  (from DRAFT), recording payment, and running dunning are each manual calls (unless run-cycle
  creates ISSUED directly).
- **Tickets:** created and worked manually; not linked to the rest of the chain.

### Real findings: Code matches expectation (no discrepancies)
Both **A20 (convert.py)** and **E20 (billing_cycle.py)** ARE present and fully live:
- A20 `POST /api/leads/{lead_id}/convert` — idempotent, one call, creates + links customer
- E20 `POST /api/billing/run-cycle` — batch cycle billing, uses `subscription.last_invoiced_at` as idempotency marker
- Subscription model includes `last_invoiced_at` (nullable) for cycle tracking (separate from `next_invoice_at` schedule)

---

## 4. Known glue gaps / next (honest list)

- **Ticket has no FK to service / subscription / customer.** It is a standalone config Record.
  Customer 360's `related.ticket` count is a best-effort scan for a `customer`-id string sitting in any
  ticket data field — not a modeled relationship. Future: add `service_id` FK to ticket, or `ticket_ids` JSONB array on service.
- **Party / Account layer is dormant.** `order`, `subscription`, `service`, and `invoice` each carry an
  additive nullable `account_id` (FK → `account.id`, marked "17a"), but the loop never sets it — rows
  resolve via `customer_id`. The WHO/MONEY layer is reserved but not yet wired.
- **No automatic IP allocation on service activation.** Service resource allocation is manual
  (`POST /api/services/{id}/resources`). A future adapter (not core) will integrate with an IPAM pool.
- **No scheduled billing cron.** `POST /api/billing/run-cycle` and `POST /api/invoices/run-dunning` are
  on-demand HTTP calls. Future: Celery/APScheduler for daily/hourly automation.
- **Payment flow is stub-simple.** Manual recording only, no retry/reconciliation, no payment processor
  integration. Future: Stripe / bank API adapters.

---

## 5. Demo-loop seed SPEC (for a later batch to implement — SPEC ONLY, do not build here)

**Problem:** `seed.py` today is **config-only**. `seed_if_empty` (tenant + org tree + admin user),
`seed_meta_if_empty` (CRM/Ticket entities as config), and `seed_access_if_empty` (permissions + roles +
agent user) stand up the *shape* of the system but **zero business data** — no sample customer, order,
subscription, service, invoice, or ticket. A fresh install cannot demonstrate a full day's loop.

**Proposal:** an **additive** `seed_demo_loop_if_empty()` in `seed.py`, run at startup *after* the
three existing seeders, that stands up **one believable sample customer running end-to-end**.

**Hard rules (additive, never mutating):**
- Use `OwnerSessionLocal` (privileged, bypasses RLS) like the other seeders.
- **Own emptiness guard, independent of the others:** `return` immediately if any `Subscription` row
  already exists for the demo tenant (the loop's centre of gravity). This makes it idempotent and means
  it never re-creates data on restart.
- **Never touch** `build_crm_entities`, `build_access_config`, or any `*_if_empty` config seeder. It
  only inserts *data rows* (Records + BSS tables). It must no-op cleanly if the config seeders haven't
  run (e.g. no `customer` EntityDef, or no Product) — guard and return rather than raise.
- Resolve the demo `Tenant` and an `owner_node_id` (the group node) the same way `seed_access_if_empty`
  does (`select(Tenant)` first; node by `code`).

**What it creates (one of each, linked by the real FKs so it mirrors the live chain):**
1. **A Product** (if the catalog is empty) — e.g. `key="home-100"`, `name="Home 100 Mbps"`,
   `default_amount=1500000` luma (֏15,000), `cycle="monthly"`, `active=True`.
2. **A Customer `Record`** — `entity_key="customer"`, `status="ACTIVE"`, `data={name, email, phone,
   plan:"Pro"}`, `owner_node_id` = group node. Capture its `id` as `customer_id`.
3. **A COMPLETED `Order`** — `number` via the same `ORD-#####` scheme, `status="COMPLETED"`,
   `customer_id`, one `OrderItem` referencing the Product (`quantity=1`, `unit_amount =
   product.default_amount`), `total` = the line total.
4. **An ACTIVE `Subscription`** — mirror `_provision_subscriptions`: `customer_id`, `product_id`,
   `plan_name`/`amount`/`cycle` from the Product, `status="ACTIVE"`, `started_at`, `next_invoice_at`.
5. **An ACTIVE `Service`** — mirror `provision_service_for_subscription` but pass `status="ACTIVE"`
   (so the demo shows a live service, not PENDING): `subscription_id`, `customer_id`, `name = plan_name`,
   `activated_at = now`. Optionally one `ServiceResource` (`kind="ip"`, a sample value).
6. **One ISSUED + PAID `Invoice`** — `INV-#####`, `customer_id`, `total = subscription.amount`, one
   `InvoiceLine`, `status="PAID"`, `issued_at` set, `due_at` set; plus one `Payment`
   (`amount = total`, `method="card"`) so the money summary reconciles to zero outstanding.
7. **One open `Ticket` `Record`** — `entity_key="ticket"`, `status="OPEN"`, `data={subject, priority}`.

**Audit:** for fidelity, emit the same `workflow.emit` Events the live endpoints emit (create /
transition / payment), so Customer 360's `activity` and `/history` are populated. (Optional — a
seed may skip events; if so, note it.)

**Net effect:** a fresh `docker compose up` + seed yields a Customer whose 360 shows an active
subscription, an active service, a paid invoice (zero outstanding), and an open ticket — one complete
day of the loop, ready to demo. Because it is guarded on `Subscription` emptiness and only ever
*inserts*, it is safe to leave in the startup path permanently.
