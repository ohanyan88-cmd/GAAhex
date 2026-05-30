# §3 Orders & Revenue — Completion Audit Report

**Commit:** add312d  
**Audited:** 2026-05-31  
**Backend:** http://127.0.0.1:8099  
**Auth:** Bearer JWT (admin@demo.isp / admin123 via POST /auth/login)

---

## Page 1 — Orders

**Route:** `/orders` (viewType: `orders`)  
**File:** `frontend/src/views/OrdersView.tsx`  
**Commit:** add312d

### Widget → Data Wiring

| Widget | Real source (endpoint) | Status | Evidence |
|--------|------------------------|--------|----------|
| Orders list table | GET /api/orders | ✅ wired & verified | HTTP 200, array `{id,number,customer_id,status,total,created_at}` — 3 records (2 COMPLETED, 1 DRAFT) |
| Customer name column | GET /api/customers (loadCustomers) | ✅ wired & verified | HTTP 200, resolves customer_id → display name |
| KPI: Drafts count | Derived client-side from /api/orders | ✅ wired & verified | `all.filter(o => o.status === 'DRAFT').length` |
| KPI: In-flight count | Derived client-side from /api/orders | ✅ wired & verified | SUBMITTED + PROVISIONING statuses |
| KPI: Completed count + value | Derived client-side from /api/orders | ✅ wired & verified | `money(completedValue)` — luma division applied |
| Order detail modal | GET /api/orders/{id} | ✅ wired & verified | HTTP 200, order with `items[]` |
| New-order customer dropdown | GET /api/customers (loadCustomerOptions) | ✅ wired & verified | HTTP 200 |
| Permissions gate | GET /api/me/capabilities | ✅ wired & verified | HTTP 200, `order.view/create/edit` present |

### Button → Action Wiring

| Button/control | Real action/endpoint | Status | Evidence |
|----------------|----------------------|--------|----------|
| New order | POST /api/orders | ✅ wired | HTTP 201 confirmed |
| Submit (row + modal) | POST /api/orders/{id}/submit | ✅ wired | HTTP 409 on COMPLETED (endpoint live, state conflict) |
| Provision / Complete (advance) | POST /api/orders/{id}/advance | ✅ wired | HTTP 409 on COMPLETED (endpoint live) |
| Cancel (row + modal) | POST /api/orders/{id}/cancel | ✅ wired | HTTP 409 on COMPLETED (endpoint live) |
| Row click → detail modal | Client: setDetailId → GET /api/orders/{id} | ✅ wired | Fetches real detail |
| Pagination prev/next/page | Client-side state | ✅ wired | No inert buttons |
| Search / Status filter | Client-side filter on loaded list | ✅ wired | No extra fetch |

### Non-Negotiables Checklist

- [x] ZERO hardcoded values — grep result: only `placeholder` input hint strings (no hardcoded money/IDs)
- [x] Missing data → skeleton/empty — `list === null` → "Loading…"; `length === 0` → EmptyState; 404 → unavailable empty state
- [x] Luma bug fixed — all monetary display uses `money()` (divides by 100). CreateOrderModal converts user input via `Math.round(parseFloat(unitAmount) * 100)`. CLEAN.
- [x] Every button wired — Submit/Advance/Cancel/Create POST to real endpoints; lifecycle buttons hidden (not greyed) per status
- [x] Loading/error/empty states — Loading + ErrorBanner with retry + EmptyState all present
- [⚠️] Light + dark — cannot verify code-only
- [⚠️] No console errors — cannot verify code-only

### NOT Done / Uncertain

None identified. Orders is complete.

---

## Page 2 — Subscriptions

**Route:** `/subscriptions` (viewType: `subscriptions`)  
**File:** `frontend/src/views/SubscriptionsView.tsx`  
**Commit:** add312d

### Widget → Data Wiring

| Widget | Real source (endpoint) | Status | Evidence |
|--------|------------------------|--------|----------|
| Subscriptions list table | GET /api/subscriptions | ✅ wired & verified | HTTP 200, 4 records — `{id,customer_id,plan_name,amount,cycle,status}` |
| Customer name column | GET /api/customers (loadCustomers) | ✅ wired & verified | HTTP 200 |
| New-sub form: customer dropdown | GET /api/customers (loadCustomerOptions) | ✅ wired & verified | HTTP 200 |
| New-sub form: product dropdown | GET /api/products (loadProducts) | ✅ wired & verified | HTTP 200 |
| KPI: Total/Active/Suspended/Cancelled counts | Derived client-side from /api/subscriptions | ✅ wired & verified | Status-filtered counts |
| Page config (columns/labels) | GET /api/page-config/subscriptions | ✅ wired & verified | HTTP 200 → `{page_key:"subscriptions",config:{}}` |
| Custom fields | useCustomFields hook (page config) | ✅ wired | Renders nothing when empty |

### Button → Action Wiring

| Button/control | Real action/endpoint | Status | Evidence |
|----------------|----------------------|--------|----------|
| New subscription (Create) | POST /api/subscriptions | ✅ wired | HTTP 422 on empty body (endpoint live); `toMinor(draft.amount)` used |
| Generate invoice (row) | POST /api/subscriptions/{id}/generate-invoice | ✅ wired | HTTP 409 on CANCELLED sub (endpoint live) |
| Rate usage (row) | POST /api/usage/rate `{subscription_id}` | ✅ wired | HTTP 409, `{"detail":"No unrated usage"}` — endpoint live |
| Suspend (ACTIVE rows) | POST /api/subscriptions/{id}/suspend | ✅ wired | HTTP 409 (endpoint live) |
| Resume (SUSPENDED rows) | POST /api/subscriptions/{id}/resume | ✅ wired | HTTP 409 (endpoint live) |
| Cancel (ACTIVE/SUSPENDED rows) | POST /api/subscriptions/{id}/cancel | ✅ wired | HTTP 409 (endpoint live) |
| Configure gear icon | onConfigure() callback | ✅ wired | Conditional on `canConfigure && onConfigure` |

### Non-Negotiables Checklist

- [x] ZERO hardcoded values — grep: only `placeholder="Fiber 100"` (input hint) and `placeholder="Search subscriptions"`
- [x] Missing data → skeleton/empty — `list === null` → "Loading…"; `length === 0` → EmptyState; 404 → unavailable empty state
- [x] Luma bug fixed — `money(s.amount)` in renderCell('mrr'); `toMinor(draft.amount)` on POST; `p.default_amount / 100` when pre-filling form. CLEAN — luma bug NOT present.
- [x] Every button wired — all 6 action buttons POST to real endpoints; status-conditional visibility
- [x] Loading/error/empty states — all states handled
- [⚠️] Light + dark — cannot verify code-only
- [⚠️] No console errors — cannot verify code-only

### NOT Done / Uncertain

None identified. Luma bug reported in HANDOFF is not present in this file.

---

## Page 3 — Invoices

**Route:** `/invoices` (viewType: `invoices`)  
**File:** `frontend/src/views/InvoicesView.tsx`  
**Commit:** add312d

### Widget → Data Wiring

| Widget | Real source (endpoint) | Status | Evidence |
|--------|------------------------|--------|----------|
| Invoices list table | GET /api/invoices (+ optional ?status=) | ✅ wired & verified | HTTP 200, 6 records — `{id,number,customer_id,status,total,issued_at,due_at}` |
| Customer name column | GET /api/customers (loadCustomers) | ✅ wired & verified | HTTP 200 |
| Status tabs filter | Same endpoint with `?status=` param | ✅ wired & verified | HTTP 200 with `?status=OVERDUE` confirmed |
| KPI: Total billed | Client-side sum of `inv.total` | ⚠️ partial | Sum correct but displayed as `(totalBilled/1000).toFixed(1)k` — totalBilled is minor units, so shows 100× too large (e.g. "1500.0k ֏" instead of "15.0k ֏") |
| KPI: Outstanding | Client-side sum of ISSUED+OVERDUE totals | ⚠️ partial | Same /1000 bug as Total billed |
| Invoice detail view | GET /api/invoices/{id} | ✅ wired & verified | HTTP 200 |
| Invoice payments list (detail) | GET /api/invoices/{id}/payments | ✅ wired & verified | HTTP 200, 1 payment record returned |
| Line items table (detail) | Part of /api/invoices/{id} via `inv.lines` | ✅ wired & verified | `money()` applied to unit_amount and line_total |
| Page config | GET /api/page-config/invoices | ✅ wired & verified | HTTP 200 |

### Button → Action Wiring

| Button/control | Real action/endpoint | Status | Evidence |
|----------------|----------------------|--------|----------|
| Run dunning (toolbar) | POST /api/invoices/run-dunning | ✅ wired | HTTP 200 verified |
| Run billing cycle (toolbar) | POST /api/billing/run-cycle | ✅ wired | HTTP 200 verified |
| Pay online (list + detail) | POST /api/invoices/{id}/pay | ✅ wired | HTTP 409 on PAID inv (state guard, endpoint live) |
| Confirm dev payment (modal) | POST /api/payment-orders/{orderId}/confirm-dev | ✅ wired | HTTP 404 on invalid id (endpoint exists) |
| Open detail (arrow icon) | Client: setDetailId → GET /api/invoices/{id} | ✅ wired | Real fetch |
| Issue (detail, DRAFT only) | POST /api/invoices/{id}/issue | ✅ wired | HTTP 409 on PAID (state guard; endpoint live) |
| Record payment (detail) | POST /api/invoices/{id}/payments | ✅ wired | HTTP 409 on PAID (endpoint live); `toMinor()` used |
| Void (detail) | POST /api/invoices/{id}/void | ✅ wired | HTTP 409 on PAID (state guard; endpoint live) |
| Print / Download (detail) | GET /api/invoices/{id}/document | ✅ wired | HTTP 200 verified |

### Non-Negotiables Checklist

- [⚠️] ZERO hardcoded values — no hardcoded data values, but two luma rendering bugs present
- [x] Missing data → skeleton/empty — Loading, EmptyState, ErrorBanner all handled; detail: "Loading…" with retry
- [❌] Luma bug fixed — NOT FIXED. Two distinct bugs:
  1. **Line 115** `renderInvoiceCell('amount')`: `` `֏${(inv.total ?? 0).toLocaleString()}` `` — raw minor units. INV-00001 (total=1500000) renders "֏1,500,000" instead of "15,000 ֏"
  2. **Lines 250+256** KPI strip: `(totalBilled/1000).toFixed(1)k` and `(outstanding/1000).toFixed(1)k` — totalBilled is in minor units; must divide by 100000, not 1000. Shows "1500.0k ֏" instead of "15.0k ֏"
- [x] Every button wired — all action buttons POST to real endpoints; status-conditional logic prevents inert buttons
- [x] Loading/error/empty states — all states handled
- [⚠️] Light + dark — cannot verify code-only
- [⚠️] No console errors — cannot verify code-only

### NOT Done / Uncertain

1. **LUMA BUG — list table Amount column (line 115):** `\`֏${(inv.total ?? 0).toLocaleString()}\`` must become `{money(inv.total)}`
2. **LUMA BUG — KPI strip (lines 250, 256):** `(totalBilled / 1000)` must become `(totalBilled / 100000)` (and same for outstanding)

---

## Page 4 — Payments

**Route:** `/payments` (viewType: `payments`)  
**File:** `frontend/src/views/PaymentsView.tsx`  
**Commit:** add312d

### Widget → Data Wiring

| Widget | Real source (endpoint) | Status | Evidence |
|--------|------------------------|--------|----------|
| Payments list table | GET /api/payments | ✅ wired & verified | HTTP 200, 1 record — `{id,invoice_id,amount,method,paid_at,note}` |
| Invoice number cross-ref | GET /api/invoices (parallel) | ✅ wired & verified | HTTP 200; `invoiceMap[p.invoice_id]` resolved |
| Customer name column | GET /api/customers (loadCustomers) | ✅ wired & verified | HTTP 200; via invoiceMap → customer_id |
| KPI: Total collected | Derived: `pList.reduce` on `p.amount` | ✅ wired & verified | `money(totalSettled)` — 1500000 minor = "15,000 ֏" |
| KPI: Methods used | Derived client-side | ✅ wired & verified | Distinct methods displayed |
| Page config | GET /api/page-config/payments | ✅ wired & verified | HTTP 200 |

### Button → Action Wiring

| Button/control | Real action/endpoint | Status | Evidence |
|----------------|----------------------|--------|----------|
| Configure gear icon | onConfigure() callback | ✅ wired | Conditional on `canConfigure && onConfigure` |
| Pagination / sort / search | Client-side state | ✅ wired | No inert buttons |

Note: Payments is a read-only ledger — no create/edit/delete affordances expected by design.

### Non-Negotiables Checklist

- [x] ZERO hardcoded values — grep: only `placeholder="Search payments"`
- [x] Missing data → skeleton/empty — `payments === null` → "Loading…"; `length === 0` → EmptyState; error → ErrorBanner
- [x] Luma bug fixed — `money(totalSettled)` for KPI; `money(p.amount)` in renderCell('amount'). CLEAN.
- [x] Every button wired — read-only page; configure button conditional
- [x] Loading/error/empty states — all states handled
- [⚠️] Light + dark — cannot verify code-only
- [⚠️] No console errors — cannot verify code-only

### NOT Done / Uncertain

None identified. Payments is complete and luma-clean.

---

## Page 5 — Revenue Assurance

**Route:** `/revenue-assurance` (viewType: `revenue-assurance`)  
**File:** `frontend/src/views/RevenueAssuranceView.tsx`  
**Commit:** add312d

### Widget → Data Wiring

| Widget | Real source (endpoint) | Status | Evidence |
|--------|------------------------|--------|----------|
| KPI: Collected this month | GET /api/analytics/overview → collected_this_month | ✅ wired & verified | HTTP 200; `collected_this_month:1500000` → `money()` = "15,000 ֏" |
| KPI: AR outstanding | GET /api/analytics/overview → ar_outstanding | ✅ wired & verified | HTTP 200; `ar_outstanding:1980000` → "19,800 ֏" |
| KPI: Overdue value | GET /api/analytics/overview → overdue_total | ✅ wired & verified | HTTP 200; `overdue_total:0` → "0 ֏" |
| KPI: Overdue invoices count | GET /api/analytics/overview → overdue_count | ✅ wired & verified | HTTP 200; `overdue_count:0` |
| KPI delta vs prev month | GET /api/analytics/overview → collected_prev_month | ✅ wired & verified | `collected_prev_month:0`; delta computed correctly |
| Revenue trend chart | GET /api/analytics/revenue-trend?months=6 | ✅ wired & verified | HTTP 200; 6-month array — May 2026: `{collected:1500000,invoiced:5040000}` |
| AR aging bars | GET /api/analytics/ar-aging | ✅ wired & verified | HTTP 200; `{current:1980000,d1_30:0,…}`; `money()` on bar values |
| Overdue invoices table | GET /api/invoices?status=OVERDUE | ✅ wired & verified | HTTP 200; empty array → widget state:'hide' (hide-if-missing confirmed) |
| Customer names (overdue table) | GET /api/customers (parallel with overdue) | ✅ wired | Loaded in parallel |
| Permission gate | GET /api/me/capabilities → invoice.view | ✅ wired | HTTP 200; invoice absent from map → can() returns true (default-open) |

### Button → Action Wiring

| Button/control | Real action/endpoint | Status | Evidence |
|----------------|----------------------|--------|----------|
| Configure gear icon | onConfigure() callback | ✅ wired | Conditional on `canConfigure && onConfigure` |

Note: Revenue Assurance is a read-only dashboard — no create/edit/delete affordances expected.

### Non-Negotiables Checklist

- [x] ZERO hardcoded values — grep: only `'6 mo'` pill label and code comments; no hardcoded data values
- [x] Missing data → renders nothing — per-widget `Fetched<T>` state machine; overdue table correctly hides on empty array; all widgets hide independently on failure/403
- [x] Luma bug fixed — all amounts through `money()` (KPI tiles, aging bar values). CLEAN.
- [x] Every button wired — only configure button; conditional
- [x] Loading/error/empty states — per-widget loading; PermissionDenied on caps denial; hide-if-missing on failures
- [⚠️] Light + dark — cannot verify code-only
- [⚠️] No console errors — cannot verify code-only

### NOT Done / Uncertain

None identified. Revenue Assurance is complete and correctly implements hide-if-missing.

---

## Master Summary Table — §3 Orders & Revenue

| # | Page | Status | Note |
|---|------|--------|------|
| 1 | Orders | ✅ Complete | All endpoints live; luma clean; lifecycle buttons wired; permission-gated |
| 2 | Subscriptions | ✅ Complete | All endpoints live; luma bug NOT present; all action buttons wired |
| 3 | Invoices | ❌ 2 Luma Bugs | List table Amount column (line 115) raw toLocaleString; KPI /1000 instead of /100000 |
| 4 | Payments | ✅ Complete | Read-only ledger; luma clean; all wired |
| 5 | Revenue Assurance | ✅ Complete | All 4 analytics endpoints live; hide-if-missing correct; luma clean |

---

## Required Fixes (Blocking for Invoices)

### Fix 1 — InvoicesView.tsx line 115: list table Amount column

**Current (bug):**
```
case 'amount': return `֏${(inv.total ?? 0).toLocaleString()}`
```
**Fix:**
```
case 'amount': return money(inv.total)
```
Evidence: `inv.total` is integer minor units (1500000 = 15000 ֏). `toLocaleString()` renders "1,500,000 ֏" — 100× too large.

### Fix 2 — InvoicesView.tsx lines 250, 256: KPI strip k-notation

**Current (bug):**
```
{(totalBilled / 1000).toFixed(1)}k    // line 250
{(outstanding / 1000).toFixed(1)}k    // line 256
```
**Fix:**
```
{(totalBilled / 100000).toFixed(1)}k    // line 250
{(outstanding / 100000).toFixed(1)}k    // line 256
```
Evidence: `totalBilled` is sum of minor-unit totals. Must divide by 100 (minor→major) then 1000 (→k) = /100000. Current code shows "1500.0k ֏" instead of "15.0k ֏".
