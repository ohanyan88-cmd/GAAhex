# QA CHECKLIST — Design-system reskin (PROMPTS 1-12)

Manual click-through Gev runs after starting the backend. The headless screenshot
sweep in PROMPT 13 only proved the **login wall** renders at 4 viewports x 2
themes; everything past auth needs eyes.

---

## 1. Bring the stack up

```powershell
# repo root: C:\Users\Admin\Desktop\Portal
docker compose up -d                                                # Postgres :5433, Redis :6380
cd backend  ; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8099
cd frontend ; npm run dev                                           # :5173
# Login: admin@demo.isp / admin123
```

---

## 2. Per-surface check (5 lines each)

### Home — DashboardView
- **Visit:** `/` after login.
- **Look for:** KPI tiles with Space Grotesk numerals, marquee with gold rail + glow, line chart + donut visible, range toggle (30d / QTD / YTD) clickable.
- **Expected:** Numerals tabular and aligned, marquee scrolls smoothly, donut legend matches slices, range toggle re-fetches.
- **Common regressions:** KPI value reverts to Inter, marquee gold rail missing, chart canvas overflows card.
- **Fix-if-broken hint:** Check `.kpi-strip .kval` font stack and `--gx-font-mono`/Space Grotesk wiring in `gaaex-tokens.css`.

### CRM -> Customers — EntityView
- **Visit:** sidebar -> CRM -> Customers.
- **Look for:** `table.grid` hairline borders, StatusPill components in status column, mono IDs.
- **Expected:** Row hover = `--gx-hover`, selected row = `--gx-selected`, hairlines on every row.
- **Common regressions:** Old `.dt-row` styling leaks back, IDs in sans not mono.
- **Fix-if-broken hint:** Verify `EntityView.tsx` uses `<table className="grid">` and IDs render with `font-family:var(--gx-font-mono)`.

### Support -> Work Items — WorkItemsView
- **Visit:** sidebar -> Support -> Work Items.
- **Look for:** `table.grid` + `.toolbar`, SLA timers visible when data has them, StatusPills.
- **Expected:** Toolbar wraps correctly, SLA shows colored countdown chip, action menu opens above row.
- **Common regressions:** Toolbar overflows, SLA timer reads as raw timestamp instead of pill.
- **Fix-if-broken hint:** Check `.toolbar` flex-wrap and any SLA-pill helper component.

### Billing -> Invoices — InvoicesView (PROMPT 5 reference impl)
- **Visit:** sidebar -> Billing -> Invoices.
- **Look for:** Sortable columns, bulk-select bulkbar appears on row check, pagination footer, money in mono + tnum.
- **Expected:** Click row -> RecordDrawer slides from right; bulkbar shows count + actions.
- **Common regressions:** Bulkbar misaligned, money loses tabular-nums, pagination buttons unstyled.
- **Fix-if-broken hint:** InvoicesView is the canonical reskin template — other entity views should mirror it.

### Network -> Topology
- **Visit:** sidebar -> Network -> Topology.
- **Look for:** Existing topology view — NOT reskinned in PROMPTS 1-12.
- **Expected:** Nothing should look worse than before the reskin.
- **Common regressions:** Token changes leak into this view and break colors.
- **Fix-if-broken hint:** If broken, it's almost certainly a `--gx-*` token mismatch in a chart helper.

### Communications -> Messages — MessagesView (PROMPT 11)
- **Visit:** sidebar -> Communications -> Messages.
- **Look for:** `.msgr` two-pane (list left, thread right), bubbles in/out, composer at bottom.
- **Expected:** Outgoing bubbles right-aligned with primary tint; incoming left-aligned with neutral.
- **Common regressions:** Bubbles collapse single-pane below 900px (known + correct), but on desktop both panes must render.
- **Fix-if-broken hint:** Verify backend `/api/messages` returns data; CSS is in place but data wiring may be incomplete (see Known backend gaps below).

### Communications -> Outbound — OutboundView (PROMPT 11)
- **Visit:** sidebar -> Communications -> Outbound.
- **Look for:** `.mail` three-pane (folders / list / detail).
- **Expected:** Folder rail collapses below 900px; list+detail stack below 900px.
- **Common regressions:** Three-pane grid stays at one column on wide screens.
- **Fix-if-broken hint:** Check `.mail` `grid-template-columns` and that media query is `(max-width:900px)`.

### Calendar — CalendarView (PROMPT 11)
- **Visit:** sidebar -> Calendar.
- **Look for:** Month grid with `.cal-cell`, mini-cal rail on left, filters toggleable.
- **Expected:** Today cell has primary fill + white day number; off-month cells dimmed.
- **Common regressions:** Today highlight missing, week-day headers misaligned.
- **Fix-if-broken hint:** `.gx-comms .cal-day.today` is where the highlight lives.

### Studio — StudioView (PROMPT 8)
- **Visit:** sidebar -> Studio (admin only).
- **Look for:** Left rail grouped (Schema / UI / Logic / Tenant), entity builder, statuses with gold initial dot, live preview pane.
- **Expected:** Section headers in rail are styled headers, not generic nav items.
- **Common regressions:** Rail wraps to chip-row above 1180px (should only wrap **below** 1180px).
- **Fix-if-broken hint:** `@media (max-width:1180px)` block at styles.css ~line 2772.

### Detail drawer — RecordDrawer
- **Visit:** Click any invoice row.
- **Look for:** Drawer slides in from right with hero header + tabs + `.kv` key-value list.
- **Expected:** Drawer covers ~480px from right edge; backdrop dims main view; ESC closes.
- **Common regressions:** Drawer renders centered instead of right-anchored.
- **Fix-if-broken hint:** Verify drawer uses `.gx-scrim` backdrop and slide-from-right transform.

---

## 3. Theme toggle

- Click top-bar sun/moon -> `data-theme` on `<html>` flips instantly.
- Sidebar stays brand-dark in **both** themes (kit spec).
- Light mode text contrast: cards on light bg, `--gx-text-1` readable, no washed-out greys.
- Check StatusPill contrast in both themes — light-mode "warning" must still read as amber, not yellow-on-white.

---

## 4. Responsive

- **Under 900px:** sidebar collapses to off-canvas drawer (hamburger toggle), KPIs reflow to 2-col, toolbar wraps.
- **Under 560px:** KPIs go 1-col, toasts go full-width (left/right 12px).
- **Studio under 1180px:** rail collapses to horizontal chip row.
- **Squeeze < 380px:** verify nothing overflows horizontally.

---

## 5. Known cosmetic deltas vs hand-rolled icons (PROMPT 10)

- `PlayIcon` is stroked outline, not filled.
- `RowsIcon` has uniform-height rows.
- `SnoozeIcon` changed to AlarmClock silhouette.
- `PinIcon` shape changed.
- Flag if any of these read poorly in their context (action buttons, menu items).

---

## 6. Known backend gaps (PROMPT 11)

CSS is in place but data isn't wired:

- Channel tabs in Messages
- Presence dots / typing indicator / read receipts / reactions in Messages
- Current-user-id passthrough (own vs other bubble routing)
- Outbound labels / campaigns / archive

Don't file these as bugs — they're known. Expect empty states or hardcoded placeholders.

---

## 7. Studio AppearancePane (PROMPT 8)

- Real tenant settings (logo, brand colors) are kept as-is.
- Follow-up: if Gev wants the kit's accent/radius/density/theme preview demo added, that's a separate task — NOT shipped in PROMPT 8.

---

## 8. Deliberately NOT reskinned — future passes

- `KPITile.tsx` primitive (PROMPT 2 deferral)
- `DataTableCell.tsx` / `DataTableRow.tsx` primitives (PROMPT 2 deferral)
- Most entity views (Services, Payments, Subscriptions, etc.) — InvoicesView is the template
- Generic `Menu.tsx` component (PROMPT 9 — CSS in place, no extraction)
- `frontend/src/primitives/stories/` Storybook stories (need updating to new class structure)
- `AnalyticsView` / `ReportBuilderView` / `ReportsView` (PROMPT 7 deferral)

---

## 9. Smoke test for token regressions

Open DevTools -> Elements -> `<html>`:

1. Computed `--gx-bg`, `--gx-surface`, `--gx-text-1`, `--gx-primary`, `--gx-border` all resolve to non-`initial` values.
2. Switch theme -> values flip; no flash of unstyled content.
3. `getComputedStyle(document.body).fontFamily` -> includes `"Inter"` then `"Space Grotesk"` (sans), and `getComputedStyle(document.querySelector('.kbd')).fontFamily` -> `"IBM Plex Mono"`.

If any of these resolve to fallback `sans-serif` / `monospace`, the woff2 selfhost may have regressed.
