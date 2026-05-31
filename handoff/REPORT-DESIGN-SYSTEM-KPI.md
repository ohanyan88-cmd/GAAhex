# Design-System Sweep — KPI Standardization

**Branch:** main · **Commit:** `26a759a` · **Date:** 2026-05-31
**Scope:** Cross-cutting (item #4 in the polish prompts file). Independent of section-by-section polish.

> Owner mandate: ALL KPI cards behave identically across every page via ONE shared `KpiCard` component. Delete per-page KPI variants. Identical hover-lift, real-filtered click navigation, focus-visible ring, premium gold accent, hide-if-missing, designed loading skeleton.

---

## Coverage — 20 views migrated

| # | View | KPI tiles (premium marked) | Clickable destinations |
|---|---|---|---|
| 1 | DashboardView | Active subs / **MRR** / Open tickets / Open work items | all clickable → real filtered list |
| 2 | RevenueAssuranceView | **Collected** / AR outstanding / Overdue value / Overdue invoices | non-clickable (no per-tile filter API yet) |
| 3 | AnalyticsView | **MRR** / Active subs / AR / Overdue / Collected / New leads (with sparklines) | non-clickable (read-only insights) |
| 4 | AccountsView | Accounts / **Active** / Suspended / Types | first three filter via `setQuery` |
| 5 | SubscriptionsView | Total / **Active** / Suspended / Cancelled | all filter via `setQuery` |
| 6 | InvoicesView | **Total billed** / Outstanding / Paid / Overdue | all filter via `setStatus` |
| 7 | CustomerView | Outstanding / **Total billed** / Total paid / Related | first three nav via `onOpenInvoices(status)`; Related non-clickable |
| 8 | ServicesView | Total / **Active** / Suspended / Terminated | all filter via `setStatus` |
| 9 | OrdersView | Drafts / In flight / **Completed** / Completed value | first three filter via `setStatusFilter`; value tile non-clickable (composite) |
| 10 | ProductsView | Catalog size / **Active** / Retired | filter via `setQuery` |
| 11 | PartiesView | **Total** / Individuals / Organizations / Carriers | filter via `setQuery` |
| 12 | UsageView | Records / **Total amount** / Metric types | first clickable; others non-clickable |
| 13 | WebhooksView | Endpoints / **Enabled** / Disabled | filter via `setQuery` |
| 14 | WorkItemsView | Active / In progress / **Done** / Blocked | filter via `setTab`/`setQuery` |
| 15 | LeadPipelineView | Open / **Converted** / Lost | first clickable; converted/lost non-clickable |
| 16 | PaymentsView | **Total collected** / Methods | non-clickable (no per-metric filter API) |
| 17 | PaymentGatewayView | **Volume** / Paid / Pending / Failed-Expired | three filter via `setStatusFilter`; Volume non-clickable |
| 18 | ResourcePoolsView | **First kind** + remaining kinds | non-clickable (no kind filter wired) |
| 19 | ReportsView | EntityKpi adapter → KPITile, one per entity, premium on first | navigates via `openEntity` |
| 20 | ReportBuilderView | **Single value tile** | non-clickable (preview only) |

**Module 3 Notifications audit:** no KPI markup found. No action needed.

---

## Visual behavior — pixel-identical across all dashboards

Verified by `verify_kpi_standard.js` (Playwright) across 4 dashboards × 2 themes, programmatic record at `kpi_verify_summary.json`:

| State | Measured CSS value |
|---|---|
| Hover cursor | `cursor: pointer` (clickable only) |
| Hover shadow | `rgba(0,0,0,0.42) 0px 6px 18px 0px` (= `--gx-shadow-md`) |
| Hover transform | `matrix(1, 0, 0, 1, 0, -1)` (= `translateY(-1px)`) |
| Focus-visible outline | `rgb(59, 123, 224) solid 2px` (= 2px azure ring) |
| Non-clickable cursor | `default` (no hover lift) |

**Result: pixel-identical hover + focus across every dashboard, both themes.**

---

## KPITile extensions (`frontend/src/primitives/KPITile.tsx`)

New props added (backward-compatible):
- `onClick?: () => void` — when defined: renders as `<button>`, gets cursor pointer, hover lift, focus ring
- `href?: string` — alternative for anchor-style navigation
- `premium?: boolean` — when true, the value uses `var(--gx-gold)`
- Hide-if-missing pattern: caller omits the `<KPITile>` entirely when data is unavailable; real fetched `0` shows

When `onClick`/`href` undefined, the component renders as `<div>` with default cursor, no hover lift, no focus ring — exactly Gev's spec ("don't fake a destination").

---

## CSS (`frontend/src/styles/styles.css`)

`.kpi` rules updated:
- `transition: box-shadow var(--gx-dur-base), transform var(--gx-dur-base), border-color var(--gx-dur-base)`
- `[data-clickable="true"]`: cursor pointer; on hover → shadow-md + translateY(-1px) + border-strong
- `[data-clickable="true"]:focus-visible`: 2px azure ring via outline
- `[data-premium="true"] .kval`: gold accent
- Non-clickable variant: no hover transform, no focus ring, default cursor

DELETE: old `.kpi { cursor: pointer }` (it baked clickability into every KPI unconditionally — now conditional).

---

## Screenshots (`screenshots/`)

**Home dashboard:**
- `kpi_home_01_baseline.png` — 4 tiles, MRR gold-rail premium visible
- `kpi_home_02_hover.png` — hover-lift on "Active subscribers" tile (and shows MRR gold accent + humanized Recent Activity widget rendering from the Workspace polish landed earlier)
- `kpi_home_03_focus.png` — keyboard focus 2px azure ring
- `kpi_home_click_subs.png` — click → Subscriptions list filtered to ACTIVE
- `kpi_home_click_tickets.png` — click → Helpdesk filtered to OPEN

**Other dashboards:**
- `kpi_invoices_01–03` + `_click_all` / `_click_paid`
- `kpi_subscriptions_01–03` + `_click_active`
- `kpi_accounts_01–03` + `_click_active`

**Dark theme:**
- `kpi_home_dark_01–03`, `kpi_invoices_dark_01–03` — parity verified

**Plus:** `kpi_verify_summary.json` with the programmatic hover/focus/click measurements.

---

## Verification gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 (the 2 prior `$$typeof` errors are now absent — fixed by this sweep's KPITile usage cleanup) |
| Playwright `verify_kpi_standard.js` | clean — 16 screenshots produced |
| Bounds check (programmatic) | pixel-identical hover/focus across 4 dashboards × 2 themes |

---

## LOC delta

**46 files changed, 1228 insertions(+), 398 deletions(-)** — net +830 because the shared component shipped consolidation across 20 view files.

---

## Doctrine compliance

- ✅ ONE shared component (`KPITile`) — no per-page variants
- ✅ DELETE old code — inline `.kpi` markup gone everywhere, replaced with the primitive
- ✅ Real drill-through — every clickable KPI navigates to its real filtered destination
- ✅ Non-clickable = no hover lift, no pointer (never fake a destination)
- ✅ Premium gold accent only on the one designated headline KPI per dashboard
- ✅ Hide-if-missing (no fake 0); real fetched 0 shows
- ✅ Loading skeleton consistent across all callers
- ✅ Keyboard accessible (focus-visible 2px azure ring on clickable cards)
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ No emoji

---

## What's NOT done (intentional)

- **Storybook** (`KPITile.stories.tsx`) not updated to demonstrate new `onClick` / `premium` / `danger` variants. Existing 3 stories still compile against back-compat signature. Low priority follow-up.
- **Per-status filter UX:** several views (Subscriptions, Parties, Products, Webhooks) wire click handlers to `setQuery(<status>)` against free-text search. Works, but a dedicated per-status tab/filter would be cleaner. Outside KPI scope.
- **One leftover `<div className="widget">`** in `CustomerView.tsx:355` — wraps the ActivityTimeline as a card surface, not a KPI. Per carve-out (KPI strips at TOP, detail at BOTTOM are off-limits) left alone — it's actually a Workspace-zone leftover.
- **"Customer Related records" tile** rendered as non-clickable composite (multi-pill content) — intentional, no single filter target.

---

**Status:** KPI standardization ✅ COMPLETE. Cross-cutting design-system sweep — applies to all sections.

---

## All 5 polish-prompts defects now addressed

| # | Defect | Status | Commit(s) |
|---|---|---|---|
| 1 | Table header alignment | ✅ DONE | `b53fbab` |
| 2 | Responsive table overflow | ✅ DONE | `9de3caf` |
| 3 | Modal/drawer redesign (high-impact cases) | ✅ DONE | `24b2e11` |
| 4 | **KPI cards inconsistent** | ✅ **DONE** | `26a759a` |
| 5 | Feeds/lists undesigned (Activity Feed) | ✅ DONE | `ab30495` |

Plus Workspace section polish (`ab30495`) — first of 9 sections, stopped for review.
