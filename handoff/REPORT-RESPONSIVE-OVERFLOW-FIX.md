# Responsive Table Overflow — Fix Report

**Branch:** main · **Commit:** `9de3caf` · **Date:** 2026-05-31

---

## What was broken

At narrow viewport widths, list-page tables suffered from:
1. **7 inline row-action icons** (Sparkle/Users/Receipt/Clock/Message/ArrowRight/Close) colliding with cell text
2. **Stray AI-assist (Sparkle) icon overlapping the workflow "ACTIVE/CHURNED" button** in rows 1–6 — because both the icon stack and the move-to button-stack shared row space with no min-width to force a scroll
3. **No `min-width` on `table.grid`** — columns squashed below their natural widths instead of triggering the `.grid-wrap` horizontal scroll

---

## The fix

### 1. New shared component: `RowActionsMenu`

**File:** `frontend/src/components/RowActionsMenu.tsx`

```ts
type Props = {
  primary?: RowAction    // single inline icon button outside the menu
  actions: RowAction[]   // everything else, inside the ⋮ menu
  ariaLabel?: string
}
```

- `⋮` trigger = `MoreVertical` lucide icon
- Popover anchored below-right, **fixed-position** (escapes `.grid-wrap` overflow)
- Closes on outside-click and Esc; keyboard navigable
- Light + dark via `--gx-*` tokens, no emoji, no raw hex
- Danger actions colored with `--gx-danger`

### 2. View migrations

| View | Before | After |
|---|---|---|
| EntityView.tsx | 7 inline icons + workflow chip column | **Edit (inline) + ⋮ menu** containing Move-to, AI, Open workspace, Billing, Activity, Comments, Delete. "Move to" `<th>/<td>` column deleted (colSpan updated). |
| OrdersView.tsx | Submit / Advance / Cancel (3 buttons) | All 3 inside ⋮ menu |
| SubscriptionsView.tsx | Generate / Rate / Suspend\|Resume / Cancel (4 buttons) | All 4 inside ⋮ menu |

### 3. Views intentionally NOT migrated

| View | Why |
|---|---|
| InvoicesView | PayOnline + arrow (2 controls, primary action stays inline) |
| PartiesView, UsageView | Already a single `⋮` placeholder |
| PaymentGatewayView | Receipt + `⋮` placeholder |
| UsersPane, RolesPane | 2 buttons each, no crowding |
| StudioRichPanes.tsx / EntitiesPane.tsx / meta.py / StudioGenericPane.tsx | Module 2 territory — intentionally untouched |

### 4. CSS — `frontend/src/styles/styles.css`

```css
/* Scoped to .grid-wrap so modal/embedded tables aren't forced into 900px. */
.grid-wrap > table.grid { min-width: 900px; }

/* Tightened from 200 → 96px now that only 1 inline icon + the ⋮ live there. */
table.grid th.actions-col,
table.grid td.actions-col { width: 96px; ... }

/* Math: sel(40) + actions(96) + ~5 data cols × 140 ≈ 836 → 900 floor with breathing room */
```

`.grid-wrap` keeps `overflow-x: auto`. Below ~900px viewport → horizontal scroll appears; columns no longer squash.

---

## Verification — all 18 cases PASS

**Bounds-check** (Playwright; `verify_responsive_output.txt` for full log):

| Page | 1440px L/D | 700px L/D | 380px L/D |
|---|---|---|---|
| Customers | ✅✅ no overlap | ✅✅ no overlap, h-scroll engaged | ✅✅ no overlap, h-scroll engaged |
| Invoices | ✅✅ no overlap | ✅✅ no overlap, h-scroll engaged | ✅✅ no overlap, h-scroll engaged |
| Devices | ✅✅ no overlap | ✅✅ no overlap, h-scroll engaged | ✅✅ no overlap, h-scroll engaged |

Each case: `headerOverlap=0, bodyOverlap=0`. At 1440px the table fits naturally (`overflowsHorizontally=false`); at 700px and 380px the min-width gate engages (`overflowsHorizontally=true`).

**Menu interaction** (`verify_menu_open.js`):
- Trigger opens with all 8 items in declared order: Move to ACTIVE → Move to CHURNED → AI assist → Open workspace → Billing → Activity → Comments → **Delete (danger)**
- Esc closes
- Screenshot: `screenshots/resp_menu_open_customers_1440_light.png`

---

## The 6 screenshots Gev asked for

| Width | Customers | Invoices | Devices |
|---|---|---|---|
| 700px light | `resp_customers_700_light.png` | `resp_invoices_700_light.png` | `resp_devices_700_light.png` |
| 700px dark | `resp_customers_700_dark.png` | `resp_invoices_700_dark.png` | `resp_devices_700_dark.png` |
| 380px light | `resp_customers_380_light.png` | `resp_invoices_380_light.png` | `resp_devices_380_light.png` |
| 380px dark | `resp_customers_380_dark.png` | `resp_invoices_380_dark.png` | `resp_devices_380_dark.png` |

Plus 1440px equivalents for all three pages (6 more files). Total **19 screenshots** in `screenshots/resp_*.png`.

---

## Root cause of the "stray gear/sparkle over ACTIVE" overlap

The `SparkleIcon` (AI assist) lived in the `.row-actions` icon stack adjacent to the workflow `<button class="btn btn-ghost btn-sm">ACTIVE</button>` chip in the "Move to" column. Under `table-layout: fixed` with no min-width, narrow viewports collapsed column widths until those neighbours visually crashed into each other.

**Two-part fix:**
1. The workflow buttons now live inside the ⋮ menu (the "Move to" column was removed entirely)
2. `min-width: 900px` on the table forces horizontal scroll at narrow viewports instead of squashing

Both controls are no longer in "share-a-row" territory.

---

## Doctrine compliance

- ✅ Real fix at root cause, not per-view band-aid
- ✅ DELETE old code — 7-icon stack and "Move to" column gone, not feature-flagged
- ✅ No emoji in product UI (`⋮` is `MoreVertical` from lucide-react)
- ✅ Light + dark via `--gx-*` tokens, zero raw hex
- ✅ Keyboard accessible — Enter to open, arrow keys move, Esc closes, Tab exits
- ✅ Backend stays on :8099 (not touched)
- ✅ Module 2's scope (StudioGenericPane / StudioRichPanes / EntitiesPane / meta.py) untouched

---

## Commit

| Hash | Message |
|---|---|
| `9de3caf` | fix(tables): responsive overflow — ⋮ row-actions menu, table min-width, no icon collisions |

Pushed to `origin/main`.
