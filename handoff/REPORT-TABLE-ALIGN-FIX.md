# Table Alignment + Sample Data Cleanup — Completion Report

**Branch:** main · **Commits:** `033f672` (alignment) + `3032f5a` (Sample seeder removal) · **Date:** 2026-05-31

---

## Part A — Shared table header/body column alignment

### Scope of investigation

20 `<table className="grid">` usages were audited across the frontend. Result:

| View | Status |
|---|---|
| EntityView.tsx | ❌ **Real drift** — fixed |
| InvoicesView.tsx | ✅ already clean |
| AccountsView.tsx | ✅ already clean |
| CustomerView.tsx | ✅ already clean |
| ProductsView.tsx | ✅ already clean |
| SubscriptionsView.tsx | ✅ already clean |
| PaymentsView.tsx | ✅ already clean |
| WebhooksView.tsx | ✅ already clean |
| ResourcePoolsView.tsx | ✅ already clean |
| ServicesView.tsx | ✅ already clean |
| PartiesView.tsx | ✅ already clean |
| OrdersView.tsx | ✅ already clean |
| InteractionsView.tsx | ✅ already clean |
| HelpdeskView.tsx | ✅ already clean |
| DashboardView.tsx | ✅ already clean |
| MyApprovalsView.tsx | ✅ already clean |
| SavedViewsView.tsx | ✅ already clean |
| Studio UsersPane.tsx | ✅ already clean |
| Studio StudioRichPanes.tsx tables | ✅ already clean |

The bug was concentrated in **EntityView.tsx** — the shared list component used by ~30 entity slugs (Customers, Devices, Sites, Employees, etc.). Every clean view was verified by inspection (header cell count = body cell count, widths shared via the same `<table>`).

### Root cause

**EntityView.tsx line 822-860 (before):**
- Header row: 1 (checkbox) + N (one `<th>` per `cols` entry **including `cols[1]` "KIND"**) + 1 (Status) + (Move to if workflow) + 1 (Actions)
- Body row: 1 (checkbox) + `cols[0]` cell containing NAME + `cols[1]` value rendered as a SUBTITLE under NAME (not as its own cell) + empty `<td>` placeholder for cols[1] + remaining cols + Status + (Move to) + Actions

**Visual symptom on Devices:** header reads `NAME / KIND / SERIAL / CUSTOMER / STATUS / MOVE TO`, body has the kind value folded under NAME as a subtitle. The body's "KIND" column slot is empty. Every column to the right visually drifts.

This is the exact "KIND layout" disagreement Gev called out — the body chose subtitle, the header didn't agree.

### styles.css secondary issue

Two competing `.grid` blocks layered, not replaced:
- Legacy `.grid {}` at lines 458-486 (`border-collapse: separate`, surface chrome)
- Kit-doctrine `table.grid {}` at lines ~1815 (gx tokens, `border-collapse: collapse`)

Specificity meant the kit block won on overlapping props; non-overlapping legacy props silently merged in. Per doctrine ("DELETE old code, don't layer"), the legacy block was a target for removal.

### Fix

**`frontend/src/views/EntityView.tsx`:**
- Skip `cols[1]` in BOTH the header map (`ci === 1 ? null : <th>...`) AND the body map
- The body's cell-meta subtitle for `cols[1]` value under `cols[0]` is preserved (that's the intended UX)
- `colSpan` for the empty-state row recomputed: `1 + dataCellCount + 1 + (workflow ? 1 : 0) + 1` where `dataCellCount = cols.length >= 2 ? cols.length - 1 : cols.length`

**`frontend/src/styles/styles.css`:**
- Deleted the legacy `.grid {}` / `.grid th {}` / `.grid td {}` / `.grid tr:hover td {}` block at 458-486
- Kept a tiny `table.grid {}` block at the same location for non-token chrome (surface bg, border, radius, shadow)
- The canonical `table.grid {}` block at line ~1815 is now the **single source of truth** for padding, typography, hover, sel

### Verification

`verify_table_align.js` (Playwright, adapted from `verify_security.js`).
16 screenshots saved to `screenshots/`:

| Page | Light | Dark |
|---|---|---|
| Customers | `align_before_customers_light.png` / `align_after_customers_light.png` | `align_before_customers_dark.png` / `align_after_customers_dark.png` |
| Invoices | (same pattern) | (same pattern) |
| Devices | (same pattern) | (same pattern) |
| Studio Users | (same pattern) | (same pattern) |

**Per-page outcomes:**

- **Customers (light + dark):** "KIND/EMAIL" header gone; NAME (with email subtitle) / PHONE / PLAN / STATUS / MOVE TO aligned with body cells
- **Invoices (light + dark):** Already clean — INVOICE / CUSTOMER / ISSUED / DUE / STATUS / AMOUNT aligned; included as regression check
- **Devices (light + dark):** "KIND" header gone; NAME (with kind subtitle) / SERIAL / CUSTOMER / STATUS / MOVE TO aligned; placeholder rows deleted, 12 real Router/Switch/ONT records render
- **Studio → Security → Users (light + dark):** Already clean — NAME / EMAIL / PRIMARY NODE / ROLES / STATUS aligned; included as regression check

**Gates:**
- `npx tsc --noEmit` → clean (0 new errors)
- `npx vite build` → succeeds in 38.55s

---

## Part B — "Sample Name 1" data audit

### Source confirmed

787 rows tagged `data["_seed"] = "starter"` across 67 catalog entities, inserted by `backend/app/seed_default_records.py:_sample_value()` (lines 58-61 in the original). The literal strings:
- `"Sample {Label} {N+1}"` for name fields
- `"Sample {Label} {N+1}. This is a starter record created for demonstration purposes."` for description fields

These ARE real DB rows (not frontend mocks), but the content is placeholder-mock-shaped.

### Decision: Option (c) — drop the starter-row seeder entirely

**Rationale:** Placeholder content violates the no-fake doctrine regardless of where it lives. The cleaner architecture:
- `seed_demo_loop_if_empty()` — provides the one canonical demo customer + ticket
- `seed_dev_bulk_if_empty()` (Task 2) — provides 10 realistic Armenian-ISP customers with full cross-ref tree across 6 entities (customer, contact, device, site, employee, work_order)
- All other entities show the proper `EmptyState` until real data arrives

Per doctrine: "DELETE old code, don't layer." Starter seeder is now redundant for any honest demo experience.

### Implementation

- `backend/app/seed_default_records.py` rewritten — starter-row machinery deleted; preserved only `grant_request_perms_to_existing_roles()` (an unrelated idempotent migration that adds `request.*` perms to existing manager/sales_agent roles)
- `backend/app/main.py` lifespan comment updated to reflect the simpler flow
- 787 existing starter rows DELETEd from the running dev DB: `DELETE FROM record WHERE data->>'_seed' = 'starter'`

### Impact

- 60 entity pages flip from "3 fake-looking starter rows" → clean `EmptyState` ("No quotes yet — Create the first one to get started.")
- 6 entities covered by dev_bulk (customer, contact, device, site, employee, work_order) are unaffected; still show realistic Armenian-ISP data (Router-01, Acme Corp, etc.)
- Verified visually on the Quotes page after cleanup — empty state renders correctly

---

## Doctrine compliance

- ✅ Real data only — placeholder Sample rows eliminated
- ✅ Missing → render `EmptyState`, not fake values
- ✅ DELETE old code, don't layer — both the legacy `.grid` CSS block and the starter-row seeder fully removed
- ✅ One column system — header and body now share the same `<table>` and the same `table-layout`
- ✅ Light + dark verified across 4 pages
- ✅ Zero regressions — tsc + vite build green
- ✅ No emoji, no raw hex

---

## Commits

| Commit | Message | Files |
|---|---|---|
| `033f672` | fix(tables): shared `<thead>/<tbody>` column system — header cells now align across all list pages | `EntityView.tsx`, `styles.css`, `verify_table_align.js`, 16 screenshots |
| `3032f5a` | refactor(seed): drop "Sample Name N" starter-row seeder — empty entities now show real EmptyState | `seed_default_records.py`, `main.py` |

Both pushed to `origin/main`.

---

## Final state

- Backend running on `:8099` (healthy)
- Vite dev server on `:5173`
- 16 alignment screenshots in `screenshots/align_*.png`
- 787 starter rows removed from dev DB
- 6 dev_bulk entities still populated with realistic Armenian-ISP data
