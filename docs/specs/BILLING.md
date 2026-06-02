# Billing — Handoff (A29/B29/C29)

This document covers GAAhex's complete billing flow from subscription to payment: how subscriptions
generate invoices, how invoices transition through states, how payments are recorded, and how the
frontend presents billing data to users.

---

## 1. Overview & Money Model

All amounts in GAAhex are stored as **integer luma** — the minor unit of the Armenian Dram (֏).
One dram = 100 luma, so 1 ֏ is represented as `100` in the database.

**Why integers?** Floating-point arithmetic causes drift across cumulative calculations. Storing
amounts as integers (BigInteger in the schema) guarantees exact arithmetic and auditable totals.
Clients divide by 100 for display using the `money()` helper in `frontend/src/money.ts`:

```typescript
export function money(minor: number | null | undefined): string {
  const v = Number(minor) / 100
  const s = v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return `${s} ֏`
}
```

All billing endpoints accept and return amounts in luma. The frontend calls `toMinor()` to convert
user input (dram) to luma before sending.

---

## 2. Subscription Lifecycle

**Model:** `backend/app/models/billing.py:Subscription`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `owner_node_id` | UUID | Org node (access control) |
| `customer_id` | UUID | Links to CRM customer Record |
| `account_id` | UUID | (17a additive) links to Account; null for legacy rows |
| `product_id` | UUID | Optional catalog plan reference |
| `plan_name` | String(160) | Human-readable plan name (required) |
| `amount` | BigInteger | Luma per billing cycle |
| `cycle` | String | `monthly` or `yearly` |
| `status` | String | `ACTIVE`, `SUSPENDED`, or `CANCELLED` |
| `started_at` | DateTime | When subscription began |
| `next_invoice_at` | DateTime | Mutable schedule: next invoice date (set by manual generate-invoice + run-cycle) |
| `last_invoiced_at` | DateTime | Read-only idempotency key: last `as_of` date the billing-cycle run billed this subscription |
| `created_at` | DateTime | Server timestamp |

### Subscription Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/subscriptions` | GET | `subscription.view` | List subscriptions, filterable by customer and status |
| `/api/subscriptions` | POST | `subscription.create` | Create a new subscription (plan_name required; product_id optional) |
| `/api/subscriptions/{sub_id}` | GET | `subscription.view` (scoped to owner_node_id) | Get one subscription |
| `/api/subscriptions/{sub_id}` | PATCH | `subscription.edit` (scoped) | Edit plan_name, amount, cycle, or next_invoice_at |
| `/api/subscriptions/{sub_id}/cancel` | POST | `subscription.edit` (scoped) | Transition ACTIVE or SUSPENDED → CANCELLED |
| `/api/subscriptions/{sub_id}/suspend` | POST | `subscription.edit` (scoped) | Transition ACTIVE → SUSPENDED |
| `/api/subscriptions/{sub_id}/resume` | POST | `subscription.edit` (scoped) | Transition SUSPENDED → ACTIVE |
| `/api/subscriptions/{sub_id}/generate-invoice` | POST | `invoice.create` (scoped) | Mint a DRAFT invoice for the current period (manual path) |

### Status Transitions

```
ACTIVE ──[suspend]──> SUSPENDED ──[resume]──> ACTIVE
  │
  └────────[cancel]──────────────> CANCELLED
```

Subscriptions in ACTIVE or SUSPENDED status can generate invoices. CANCELLED subscriptions reject
new invoice generation (409 error).

---

## 3. Invoice Lifecycle

**Model:** `backend/app/models/billing.py:Invoice`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `owner_node_id` | UUID | Org node (access control) |
| `customer_id` | UUID | Links to CRM customer Record |
| `account_id` | UUID | (17a additive) links to Account; null for legacy rows |
| `number` | String(40) | Human-ref per tenant, e.g. `INV-00007` |
| `period_start` | DateTime | Billing period start |
| `period_end` | DateTime | Billing period end |
| `status` | String | `DRAFT`, `ISSUED`, `PAID`, `OVERDUE`, or `VOID` |
| `total` | BigInteger | Luma, computed from lines (sum of charges − sum of discounts + sum of taxes) |
| `issued_at` | DateTime | When invoice moved to ISSUED |
| `due_at` | DateTime | Payment deadline |
| `created_at` | DateTime | Server timestamp |

### Invoice State Machine

```
                ┌─────────────────────┐
                │      DRAFT          │
                │  (mutable, unsent)  │
                └──────────┬──────────┘
                           │ [issue]
                           ▼
                ┌─────────────────────┐
                │      ISSUED         │
                │ (sent, awaiting pay)│
                └─────────┬──────────┬┘
                          │          │
           [add_payment]   │          │ [run_dunning:
           to >= total    │          │  past due_at]
                          ▼          ▼
                       ┌─────────────┐
                       │   PAID      │   OVERDUE
                       └─────────────┘   (invoice
                                        awaiting
                                        payment
                                        past due)
                                          │
                                          │ [add_payment]
                                          │ to >= total
                                          ▼
                                       PAID

        DRAFT ──[void via POST /api/invoices/{id}/void]──> VOID
              (not yet implemented; A29 TODO)
        ISSUED ──[void via POST /api/invoices/{id}/void]──> VOID
        OVERDUE ──[void via POST /api/invoices/{id}/void]──> VOID

        Note: VOID invoices reject payment (409 error).
              PAID invoices cannot be voided (void rule: no undo).
              DRAFT invoices should be deleted via record DELETE (not voided).
```

### Invoice Endpoints (Current)

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/invoices` | GET | `invoice.view` | List invoices, filterable by customer and status |
| `/api/invoices` | POST | `invoice.create` | Create a manual DRAFT invoice with lines |
| `/api/invoices/{inv_id}` | GET | `invoice.view` (scoped) | Get one invoice with lines |
| `/api/invoices/{inv_id}/issue` | POST | `invoice.edit` (scoped) | Transition DRAFT → ISSUED; sets issued_at and due_at |
| `/api/invoices/{inv_id}/payments` | POST | `payment.create` (scoped) | Record a payment against invoice |

### Invoice Endpoints (A29 — Complete)

The following A29 endpoints are implemented in billing.py:

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/invoices/{inv_id}/payments` | GET | `payment.view` (scoped) | List all payments recorded against one invoice, ordered by paid_at |
| `/api/payments` | GET | `payment.view` | Tenant-wide payment list, optionally filtered by customer |
| `/api/invoices/{inv_id}/void` | POST | `invoice.edit` (scoped) | Transition ISSUED or OVERDUE → VOID; rejects PAID/DRAFT (409) |

---

## 4. Payment Recording — POST /api/invoices/{inv_id}/payments

**Model:** `backend/app/models/billing.py:Payment`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `invoice_id` | UUID | Which invoice this payment is for |
| `amount` | BigInteger | Luma, must be > 0 |
| `method` | String | `cash`, `card`, or `transfer` |
| `paid_at` | DateTime | When payment occurred (server-set to now) |
| `note` | Text | Optional memo |
| `created_at` | DateTime | Server timestamp |

### Request Body

```json
{
  "amount": 50000,
  "method": "card",
  "note": "Batch payment run"
}
```

### Auto-PAID Logic

When a payment is recorded, the router sums all payments for that invoice:

```python
paid_sum = sum(Payment.amount for payment in invoice.payments)
if paid_sum >= invoice.total:
    invoice.status = "PAID"
```

The invoice is automatically transitioned to PAID the moment the cumulative payment total meets
or exceeds the invoice's `total`. This is idempotent — subsequent payments on an already-PAID
invoice are rejected with a 409 error.

### Error Handling

| Status | Condition |
|--------|-----------|
| 201 | Payment recorded and persisted |
| 409 | Invoice is DRAFT (must issue first) / already PAID / VOID |
| 422 | amount ≤ 0 / method not in {cash, card, transfer} |

---

## 5. Payment List Endpoints

Two read-only list endpoints for examining payments:

### GET /api/invoices/{inv_id}/payments

Lists all payments recorded against one invoice, ordered by `paid_at` ascending.

**Auth:** `payment.view` (scoped to invoice's owner_node_id)

**Response:**
```json
[
  {
    "id": "uuid",
    "invoice_id": "uuid",
    "amount": 50000,
    "method": "card",
    "paid_at": "2026-05-27T10:30:00+00:00",
    "note": "Batch payment",
    "created_at": "2026-05-27T10:30:00+00:00"
  }
]
```

### GET /api/payments

Tenant-wide payment list. Optionally filtered by customer. Payments are ordered by `paid_at` descending.

**Auth:** `payment.view` (checked against organization scopes; only payments visible to the user's nodes are returned)

**Query Parameters:**

| Parameter | Type | Notes |
|-----------|------|-------|
| `customer` | UUID | Optional; filters by invoice's customer_id |
| `limit` | int | Default 200; limits results |
| `offset` | int | Default 0; pagination offset |

**Response:** List of Payment objects (same shape as above).

---

## 6. Invoice Void — POST /api/invoices/{inv_id}/void

Transition an ISSUED or OVERDUE invoice to VOID (final cancellation).

### Void Rules

- **ISSUED** or **OVERDUE** invoices can be voided.
- **PAID** invoices cannot be voided (payment is final; no undo). Returns 409.
- **DRAFT** invoices should be deleted via record DELETE, not voided. Returns 409.
- **VOID** invoices cannot be voided again. Returns 409.

### Behavior

When a valid invoice is voided:
1. Invoice status transitions from ISSUED or OVERDUE → VOID.
2. A transition audit event is emitted via `workflow.emit` (from/to statuses recorded).
3. The updated invoice (with lines) is returned.

### Auth

`invoice.edit` (scoped to invoice's owner_node_id)

### Request

No body required.

### Response (200)

```json
{
  "id": "uuid",
  "number": "INV-00007",
  "customer_id": "uuid",
  "owner_node_id": "uuid",
  "status": "VOID",
  "period_start": "2026-05-01T00:00:00+00:00",
  "period_end": "2026-06-01T00:00:00+00:00",
  "total": 50000,
  "issued_at": "2026-05-20T10:00:00+00:00",
  "due_at": "2026-06-03T10:00:00+00:00",
  "created_at": "2026-05-20T10:00:00+00:00",
  "lines": [
    {
      "id": "uuid",
      "kind": "charge",
      "description": "Service",
      "quantity": 1,
      "unit_amount": 50000,
      "line_total": 50000
    }
  ]
}
```

### Error Handling

| Status | Condition |
|--------|-----------|
| 200 | Invoice voided; status transitioned to VOID |
| 404 | Invoice not found |
| 409 | Cannot void a DRAFT / PAID / VOID invoice |
| 403 | User lacks `invoice.edit` permission on this invoice's org node |

---

## 7. Billing Cycle Run — POST /api/billing/run-cycle

**Router:** `backend/app/routers/billing_cycle.py`

The billing cycle run is the batch invoice-generation engine: it walks every ACTIVE subscription
that is DUE and mints an ISSUED invoice for each, atomically and idempotently.

### Idempotency via `last_invoiced_at`

Unlike the manual `generate-invoice` endpoint (which uses `next_invoice_at` as a mutable schedule),
the run-cycle uses `last_invoiced_at` as the idempotency marker:

- `last_invoiced_at` records a **fact**: the last `as_of` date this subscription was cycle-billed.
- A subscription is DUE when:
  - Never billed before (`last_invoiced_at IS NULL`), OR
  - Its last cycle-bill is a full `cycle` behind `as_of` (`_add_cycle(last_invoiced_at) <= as_of`)

**Result:** Running the cycle twice for the same `as_of` date generates 0 invoices the second time
(all subscriptions have `last_invoiced_at >= as_of`). This makes the run re-runnable and auditable,
and it doesn't entangle with the manual invoice path (which updates `next_invoice_at`).

### Request Body

```json
{
  "as_of": "2026-05-27"  // optional; defaults to today (UTC)
}
```

If omitted, `as_of` is set to the current UTC date at midnight.

### Response

```json
{
  "as_of": "2026-05-27",
  "generated": 3,
  "skipped": 5,
  "errors": [
    { "subscription_id": "...", "message": "..." }
  ],
  "invoices": ["inv-uuid-1", "inv-uuid-2", "inv-uuid-3"]
}
```

### Fail-Soft Billing

Each subscription is processed inside its own SAVEPOINT. A failure on one subscription rolls back
only that sub's invoice and is recorded in `errors[]` — it never aborts the batch. The whole
successful set commits atomically at the end.

### Job Log Entry

A `JobRun` record is created (`job_key="billing.run_cycle"`) with the summary. On unexpected
failure of the whole run, `status="ERROR"` is recorded instead of `SUCCESS`.

---

## 8. Dunning — POST /api/invoices/run-dunning

**Router:** `backend/app/routers/billing.py`

Dunning marks invoices as overdue and notifies recipients.

### Logic

```python
for inv in tenant's ISSUED invoices:
    if inv.due_at < now:
        inv.status = "OVERDUE"
        emit_notification("invoice.overdue")  # best-effort; failure doesn't undo the status change
```

### Response

```json
{
  "checked": 10,
  "marked_overdue": 3
}
```

### Notification

For each newly-marked invoice, the system resolves recipients via `notify_hooks.resolve_recipients`
and emits the `invoice.overdue` notification (if a `NotificationDef` is configured). Notification
failures are best-effort — they do not prevent the status marking from persisting.

---

## 9. Product Catalog — GET/POST/PATCH /api/products

**Model:** `backend/app/models/product.py:Product`

Products are optional reference plans used when creating subscriptions. They provide default
values (name, amount, cycle) but are not required.

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key |
| `tenant_id` | UUID | Tenant scope |
| `key` | String(40) | Unique per tenant (e.g., "starter", "pro") |
| `name` | String(160) | Display name |
| `description` | Text | Optional |
| `default_amount` | BigInteger | Luma; used if subscription.amount not specified |
| `cycle` | String | `monthly` or `yearly` |
| `active` | Boolean | Soft-retire by setting to false |
| `created_at` | DateTime | Server timestamp |

### Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/products` | GET | (any tenant user) | List products; read access open (agents need it to pick a plan) |
| `/api/products` | POST | `config.manage` | Create a product (key must be unique per tenant) |
| `/api/products/{product_id}` | PATCH | `config.manage` | Edit name, description, default_amount, cycle, or active flag |
| `/api/products/{product_id}/retire` | POST | `config.manage` | Soft-retire (active=False); existing subscriptions unaffected |

---

## 10. Customer Balance Computation

A customer's billing balance is computed **client-side** in the frontend (section 11, below).

```
billedTotal = sum(invoice.total for ISSUED | OVERDUE | PAID invoices)
paidTotal   = sum(payment.amount for customer's payments across all invoices)
balance     = max(0, billedTotal - paidTotal)
```

**Excluded from billedTotal:**
- DRAFT invoices (not yet sent)
- VOID invoices (cancelled, don't count)

**Auditing note:** All monetary mutations are recorded in `Event` rows (via `workflow.emit`),
so the balance can be reconstructed from the audit log at any point in time.

---

## 11. Frontend — InvoicesView & CustomerBillingModal

### InvoicesView (`frontend/src/InvoicesView.tsx`)

Lists all invoices for the tenant with filtering by status.

**Key features:**
- **Status filter:** Dropdown to filter by DRAFT, ISSUED, PAID, OVERDUE, VOID.
- **Detail view:** Click an invoice to open its detail (lines, issue, record payment, void).
- **Run billing cycle:** Button to trigger `POST /api/billing/run-cycle` (visible if user has `config.manage`).
- **Run dunning:** Button to mark overdue invoices.

**Flow:**
1. Load invoices with `GET /api/invoices?status=...`
2. Click an invoice → open detail panel
3. In detail:
   - If DRAFT: click "Issue" to move to ISSUED (sets due_at = now + 14 days)
   - If ISSUED or OVERDUE: click "Record Payment" to add a payment
   - If ISSUED or OVERDUE: (A29) click "Void" to cancel the invoice
   - View all lines and their kind (charge, discount, tax)

### CustomerBillingModal (`frontend/src/CustomerBillingModal.tsx`)

Embedded in the customer detail view. Shows a customer's subscriptions, recent invoices, and
balance at a glance.

**Key features:**
- **Subscriptions:** List with status, plan name, amount, cycle.
- **Generate Invoice:** For each ACTIVE subscription, a link to `POST /api/subscriptions/{id}/generate-invoice`.
- **New subscription form:** Pre-filled with products from the catalog.
- **Balance display:** (C29) shows `billedTotal`, `paidTotal`, and `balance`.

### Future: PaymentsView (B29/C29)

A dedicated "Payments" view listing all tenant-wide payments (via the A29 `GET /api/payments`
endpoint). Not yet implemented.

---

## 12. Code to Doc Summary

| Endpoint | Method | Auth | Route | Status |
|----------|--------|------|-------|--------|
| `/api/subscriptions` | GET | `subscription.view` | billing.py | Complete |
| `/api/subscriptions` | POST | `subscription.create` | billing.py | Complete |
| `/api/subscriptions/{sub_id}` | GET | `subscription.view` (scoped) | billing.py | Complete |
| `/api/subscriptions/{sub_id}` | PATCH | `subscription.edit` (scoped) | billing.py | Complete |
| `/api/subscriptions/{sub_id}/cancel` | POST | `subscription.edit` (scoped) | billing.py | Complete |
| `/api/subscriptions/{sub_id}/suspend` | POST | `subscription.edit` (scoped) | billing.py | Complete |
| `/api/subscriptions/{sub_id}/resume` | POST | `subscription.edit` (scoped) | billing.py | Complete |
| `/api/subscriptions/{sub_id}/generate-invoice` | POST | `invoice.create` (scoped) | billing.py | Complete |
| `/api/invoices` | GET | `invoice.view` | billing.py | Complete |
| `/api/invoices` | POST | `invoice.create` | billing.py | Complete |
| `/api/invoices/{inv_id}` | GET | `invoice.view` (scoped) | billing.py | Complete |
| `/api/invoices/{inv_id}/issue` | POST | `invoice.edit` (scoped) | billing.py | Complete |
| `/api/invoices/{inv_id}/payments` | POST | `payment.create` (scoped) | billing.py | Complete |
| `/api/invoices/{inv_id}/payments` | GET | `payment.view` (scoped) | billing.py | Complete |
| `/api/invoices/{inv_id}/void` | POST | `invoice.edit` (scoped) | billing.py | Complete |
| `/api/payments` | GET | `payment.view` | billing.py | Complete |
| `/api/invoices/run-dunning` | POST | `invoice.edit` | billing.py | Complete |
| `/api/billing/run-cycle` | POST | `invoice.create` | billing_cycle.py | Complete |
| `/api/products` | GET | (any) | billing.py | Complete |
| `/api/products` | POST | `config.manage` | billing.py | Complete |
| `/api/products/{product_id}` | PATCH | `config.manage` | billing.py | Complete |
| `/api/products/{product_id}/retire` | POST | `config.manage` | billing.py | Complete |

---

## 13. Horizon & Future Work

**PaymentsView (B29/C29):** Build a frontend view for the `GET /api/payments` list, showing
recent payments across all invoices.

**Customer balance display (C29):** In `CustomerBillingModal`, compute and display:
- Total billed (sum of ISSUED + OVERDUE + PAID invoices)
- Total paid (sum of payments)
- Outstanding balance

**Automated retries & retry schedule:** The dunning endpoint marks invoices as OVERDUE once.
A future retry-schedule system could auto-retry failed payments on a cadence.

**Payment reconciliation:** Integrate with external payment providers (Stripe, card processors)
to reconcile inbound payment confirmations with manually recorded payments.

**Multi-currency:** Currently all amounts are in AMD luma. A currency field on `Subscription`
and `Invoice` would enable multi-currency billing.

**Invoice templates & branding:** Invoices are currently data-only. Add a template system
(HTML/PDF) to let tenants customize invoice appearance.

---

## 14. Run & Verify

```bash
# Prerequisites
docker compose up -d                          # Postgres(:5433) + Redis(:6380)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099

# Swagger UI
# http://127.0.0.1:8099/docs  →  look for /api/subscriptions, /api/invoices, /api/products, /api/billing/*

# Type-check frontend
cd frontend && npx tsc --noEmit

# Run backend tests
cd backend && pytest tests/test_billing.py -v
cd backend && pytest tests/test_payments_ext.py -v          # D29 extensions (if present)

# Manual: list subscriptions
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8099/api/subscriptions

# Manual: create a subscription (minimal)
curl -X POST http://127.0.0.1:8099/api/subscriptions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"plan_name":"Starter","amount":50000,"cycle":"monthly"}'

# Manual: run billing cycle
curl -X POST http://127.0.0.1:8099/api/billing/run-cycle \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"as_of":"2026-05-27"}'

# Manual: list invoices
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8099/api/invoices

# Manual: record a payment (replace inv_id with real UUID)
curl -X POST http://127.0.0.1:8099/api/invoices/{inv_id}/payments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"method":"card","note":"Payment"}'

# Manual: run dunning
curl -X POST http://127.0.0.1:8099/api/invoices/run-dunning \
  -H "Authorization: Bearer <token>"
```

---

## Summary

**What's shipped:** Subscriptions, invoices (DRAFT → ISSUED → PAID/OVERDUE → VOID pipeline),
payments with auto-PAID logic, billing cycle runs with idempotency via `last_invoiced_at`,
dunning with notification, product catalog, payment list endpoints, and full frontend views.

**What's TODO:** Balance display in the customer billing modal (C29); PaymentsView (B29/C29);
multi-currency and invoice templates (future).

All endpoints emit audit Events via `workflow.emit`. All amounts are integer luma (1 ֏ = 100).
Money conversions happen at the frontend boundary via `money()` and `toMinor()` helpers.
