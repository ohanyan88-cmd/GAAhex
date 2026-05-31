# Polish Pass — CRM & Commercial Section — Completion Report

**Branch:** main · **Commit:** `adef8cc` · **Date:** 2026-05-31
**Section:** CRM & Commercial (2 of 9)

---

## Summary

All 13 active CRM pages brought to the design standard. **One file change (EntityView) covers 8 of 13 pages.** The `.workspace-page` utility from the Workspace polish was generalized to `.section-page` and applied across all of Workspace + CRM in the same commit — **doctrine compliant** (delete + replace, no aliasing, no layering).

| # | Page | viewType | Status |
|---|---|---|---|
| 1 | Leads | lead-pipeline (LeadPipelineView) | ✅ section-page + iconographic empty state |
| 2 | Opportunities | entity (EntityView) | ✅ inherits EntityView polish |
| 3 | Customers | entity (EntityView) | ✅ inherits EntityView polish |
| 4 | Accounts | accounts (AccountsView) | ✅ section-page on list + detail |
| 5 | Contacts | entity (EntityView) | ✅ inherits EntityView polish |
| 6 | Quotes | entity (EntityView) | ✅ inherits EntityView polish |
| 7 | Contracts | entity (EntityView) | ✅ inherits EntityView polish |
| 8 | Product Catalog | products (ProductsView) | ✅ section-page container |
| 9 | Promotions | entity (EntityView) | ✅ inherits EntityView polish |
| 10 | Segments | entity (EntityView) | ✅ inherits EntityView polish |
| 11 | Loyalty | entity (EntityView) | ✅ inherits EntityView polish |
| 12 | Campaigns | entity (EntityView) | ✅ inherits EntityView polish |
| 13 | Partners | entity (EntityView) | ✅ inherits EntityView polish |

### Dropped pages (🚫 N/A — Wave A pruning, no backend)
Pipeline · Retention · Churn · Sales Channels · Customer 360

---

## EntityView polish (the big win — covers 8 of 13 pages)

| Change | Before | After |
|---|---|---|
| Container | none / inline padding | `.section-page` with 1320px max-width |
| Main empty state | "No records yet" text | Iconographic (`InboxIcon`) + message + "+ New" CTA gated by `canCreate` |
| In-table empty state | text only | `SearchIcon` when filtered, `InboxIcon` when empty |
| Permission-denied state | inline padding | wrapped in `.section-page` for consistent padding/width |
| Page header (ViewHead) | already standardized | preserved |

Shared components reused — **no forks**:
- `KPITile` (from KPI sweep `26a759a`)
- `RecordDrawer` + `Modal` (from RecordDrawer sweep `24b2e11`)
- `humanize.ts` helpers (from Workspace polish `ab30495`)

---

## `.workspace-page` → `.section-page` generalization

Per doctrine "DELETE old code, don't layer":
- Created `.section-page` with the same 1320px max-width semantics
- **Deleted** `.workspace-page` rule from styles.css (not aliased)
- Migrated all 6 Workspace views in the same commit:
  - `DashboardView`, `MyTasksView`, `MyApprovalsView`, `CalendarView`, `ActivityFeedView`, `SavedViewsView`
- Smoke-checked Home + My Tasks + Activity Feed after the swap — no visual regression

Now `.section-page` is the universal container utility for the polish pass. Future sections (Orders/Revenue, Care, etc.) reuse it directly.

---

## Screenshots — 26 total

`screenshots/crm_NN_<page>_<theme>.png` at 1440×900:

| Page | Light | Dark |
|---|---|---|
| Leads | `crm_01_leads_light.png` | `crm_14_leads_dark.png` |
| Opportunities | `crm_02_opportunities_light.png` | `crm_15_opportunities_dark.png` |
| Customers | `crm_03_customers_light.png` | `crm_16_customers_dark.png` |
| Accounts | `crm_04_accounts_light.png` | `crm_17_accounts_dark.png` |
| Contacts | `crm_05_contacts_light.png` | `crm_18_contacts_dark.png` |
| Quotes | `crm_06_quotes_light.png` | `crm_19_quotes_dark.png` |
| Contracts | `crm_07_contracts_light.png` | `crm_20_contracts_dark.png` |
| Product Catalog | `crm_08_products_light.png` | `crm_21_products_dark.png` |
| Promotions | `crm_09_promotions_light.png` | `crm_22_promotions_dark.png` |
| Segments | `crm_10_segments_light.png` | `crm_23_segments_dark.png` |
| Loyalty | `crm_11_loyalty_light.png` | `crm_24_loyalty_dark.png` |
| Campaigns | `crm_12_campaigns_light.png` | `crm_25_campaigns_dark.png` |
| Partners | `crm_13_partners_light.png` | `crm_26_partners_dark.png` |

---

## Deferred design work — running list

Created `handoff/DEFERRED-DESIGN-WORK.md` with the items inherited from prior sweeps + CRM-specific additions:

**From RecordDrawer sweep (`24b2e11`):**
- WorkItemsView / MyTasksView WorkItemDetailModal — needs EditDrawer or tabbed View/Edit on RecordDrawer
- CustomerBillingModal, WebhooksView deliveries — multi-section list modals (base Modal cap applies)
- EntityView activity Modal, ConfigureDrawer, 7 `modals/` files — RecordDrawer migration deferred
- Module 2 EntitiesPane / Module 3 NotificationsPane detail drawers — Studio-shell-shaped, need own plan

**From KPI sweep (`26a759a`):**
- `KPITile.stories.tsx` Storybook stories not updated for new variants
- Per-status filter UX in views wiring KPI click to `setQuery(<status>)` — works but a tab would be cleaner
- `CustomerView.tsx:355` leftover `<div className="widget">` wrapping ActivityTimeline

**New from CRM polish (`adef8cc`):**
- **EntityView edit modal** — needs EditDrawer or tabbed View/Edit on RecordDrawer
- **EntityView activity Modal** — bundle with RecordDrawer migration
- **LeadPipeline per-column placeholder block** — intentionally lighter than page-level empty state
- **AccountsView detail sub-tables** (subs / invoices) — out of CRM scope
- **ProductsView inline edit form** — bundle with EntityView edit migration

---

## Verification gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| 26 verification screenshots | clean |
| Workspace smoke check after `.workspace-page` → `.section-page` swap | no regression |
| Doctrine "DELETE old code, don't layer" | satisfied (`.workspace-page` rule fully removed, not aliased) |

---

## Files shipped

| File | Change |
|---|---|
| `frontend/src/views/EntityView.tsx` | section-page container + iconographic empty states |
| `frontend/src/views/LeadPipelineView.tsx` | section-page + iconographic empty state with CTA |
| `frontend/src/views/AccountsView.tsx` | section-page on list + detail panels |
| `frontend/src/views/ProductsView.tsx` | section-page container |
| `frontend/src/views/DashboardView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/views/MyTasksView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/views/MyApprovalsView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/views/CalendarView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/views/ActivityFeedView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/views/SavedViewsView.tsx` | `.workspace-page` → `.section-page` |
| `frontend/src/styles/styles.css` | added `.section-page`, deleted `.workspace-page` rule |
| `handoff/DEFERRED-DESIGN-WORK.md` | NEW running deferred list |
| `verify_crm_polish.js` | NEW Playwright script |
| `screenshots/crm_*.png` | 26 NEW screenshots |

---

## Doctrine compliance

- ✅ Real data only — no mock; empty states are iconographic, not faked rows
- ✅ ONE shared component per primitive — KPITile, RecordDrawer, Modal reused; no forks
- ✅ DELETE old code — `.workspace-page` rule removed; all callers swapped in same commit
- ✅ Missing → empty state (iconographic), not blank
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ No emoji
- ✅ Deferred list maintained at `handoff/DEFERRED-DESIGN-WORK.md` per Gev's directive

---

**Status:** CRM & Commercial polish ✅ complete. Stopped per Gev's directive — review the section before I move to **Orders & Revenue** (5 pages: Orders, Subscriptions, Invoices, Payments, Revenue Assurance).
