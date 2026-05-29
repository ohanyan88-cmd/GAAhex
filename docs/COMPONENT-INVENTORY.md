# GAAex Component Inventory & Roadmap

The full ISP/CRM design-system inventory (~80 components, 7 tiers). Priority-ordered. Builds on
`BRAND.md` (tokens, themes, no-emoji/SVG rule) and `frontend/COMPONENTS.md` (buttons/inputs/search).
**Status:** ✅ built · 🟡 partial/basic · ⬜ not started. Build top→bottom, but see "Review & flags".

## Tier 1 — Critical (CRM cannot ship without)
1. ⬜ Select/Dropdown (single+multi, searchable) · 2. ⬜ Checkbox+Radio (group, indeterminate) ·
3. ⬜ Toggle/Switch · 4. ⬜ Date/Time picker (date/range/datetime/time) ·
5. 🟡 Table/DataGrid (have basic `.grid`; need sort, sticky, row-select, pagination, inline-edit, density) ·
6. ⬜ Modal/Dialog (+ confirm) · 7. ⬜ Drawer/Side-panel · 8. 🟡 Toast (transient) — NOTE: distinct
from the existing **NotificationCenter** (persistent inbox, ✅) · 9. ⬜ Form Group wrapper ·
10. ⬜ Pagination.

## Tier 2 — Standard UI
11. ⬜ Tabs (have ad-hoc `.tab` in DashboardView 🟡) · 12. ⬜ Breadcrumbs · 13. ⬜ Tooltip ·
14. ⬜ Popover · 15. 🟡 Badge/Pill/Chip (have `.pill`/`.badge`; need removable chip + count) ·
16. ⬜ Avatar · 17. 🟡 Card (ad-hoc; need base/stat/list/expandable) · 18. 🟡 Empty State (ad-hoc text) ·
19. ⬜ Skeleton Loader · 20. ⬜ Spinner/Progress · 21. ⬜ Divider · 22. 🟡 Icon Button (`.iconbtn`) ·
23. ⬜ Menu/Context Menu · 24. ⬜ Accordion/Collapsible.

## Tier 3 — Domain-specific
25. ✅ RefPicker (basic async lookup — built; upgradeable) · 26. 🟡 Status Indicator (dot+label via
`.pill`; need traffic-light/signal-bars — **SVG/CSS, not emoji**) · 27. 🟡 KPI Card (DashboardView kpi
widget) · 28. 🟡 Metric Tile · 29. ⬜ Activity Timeline (data exists via `/history`; no UI) ·
30. ⬜ Comments/Notes Thread (→ communication module spec) · 31. ⬜ Filter Bar · 32. ⬜ Bulk Action Bar ·
33. ⬜ Inline Edit Cell · 34. ⬜ Tag Input · 35. ⬜ File Upload · 36. ⬜ Code/Mono Block ·
37. ⬜ JSON Viewer · 38. ⬜ Map View (network topology — **see flag: network = adapters, likely defer**) ·
39. ⬜ Signal Strength Bars (SVG) · 40. ⬜ Form Stepper/Wizard.

## Tier 4 — Layout & structure
41. 🟡 App Shell · 42. 🟡 Sidebar Nav (have; need collapsible/sectioned/badges) · 43. 🟡 Top Bar ·
44. 🟡 Page Header · 45. ⬜ Section Header · 46. ⬜ Two-pane (master-detail) · 47. ⬜ Grid system tokens ·
48. 🟡 Spacing scale (partial in styles.css) · 49. ⬜ Elevation/Shadow scale (light-mode only — see flag) ·
50. ⬜ Z-index scale.

## Tier 5 — Charts & visuals
51. ⬜ Line · 52. 🟡 Bar (inline SVG in DashboardView) · 53. ⬜ Area · 54. 🟡 Pie/Donut (inline SVG) ·
55. ⬜ Sparkline · 56. ⬜ Gauge/Radial · 57. ⬜ Heatmap · 58. ⬜ Funnel · 59. 🟡 Chart tokens (PALETTE in
DashboardView) · 60. ⬜ Legend.

## Tier 6 — Feedback & micro-states
61. ⬜ Inline Alert/Banner · 62. 🟡 Confirmation (window.confirm on delete) · 63. ⬜ Validation Summary ·
64. ⬜ Success State · 65. 🟡 Loading States (ad-hoc "Loading…") · 66. ⬜ Offline banner ·
67. ⬜ Permission-denied (403) · 68. ⬜ Not-found (404) · 69. ⬜ Maintenance mode ·
70. ⬜ Keyboard-shortcuts overlay (⌘K).

## Tier 7 — Tokens & foundation
71. ✅ Color tokens (BRAND.md) · 72. ⬜ Typography scale · 73. 🟡 Border-radius scale (ad-hoc 6/8/10) ·
74. ⬜ Border-width scale · 75. ⬜ Motion/easing tokens · 76. ✅ Focus-ring system (gold/cobalt) ·
77. ⬜ Density modes (comfortable/compact) · 78. ✅ Dark/Light theme switcher · 79. ⬜ A11y primitives
(sr-only, focus-trap, skip-link) · 80. ⬜ Print stylesheet.

---

## Review & flags (honest)

- **Net-new is ~60, not 80.** Already built/partial: buttons, inputs, search, RefPicker, KPI, bar/donut,
  pill/status, icon button, app-shell/sidebar/topbar/header, color tokens, focus ring, theme switcher.
- **#1 risk — breadth starving depth.** 80 primitives ≈ a multi-week design-system project. Building it
  all up front would grow a beautiful component shelf while the *platform* (billing, network adapters,
  real multi-tenant ops, M11–M13) stays thin. **Recommendation: build components just-in-time** (when a
  feature needs one) — **except front-load Tier 7 foundation** (typography, radius, border, motion,
  z-index, density, a11y), because retrofitting tokens across 60 components later is the expensive path
  (matches the inventory's own "do Tier 7 first or refactor later").
- **Charts (Tier 5) = the effort spike + a real decision.** Hand-rolling 10 chart types (heatmap, funnel,
  gauge, axed line/area + tooltips) is a lot and bug-prone. Decide: a small charting lib vs continue
  hand-SVG. Tradeoff: dev-time/consistency vs bundle-size/brand-control. **Needs Gev's call.**
- **Map View / topology (38) + signal bars (39):** network is "adapters, not core" in our scope — heavy,
  likely **defer to the network-adapter phase**, not Phase 1.
- **Status/traffic-light/signal-bars (26/39):** must be SVG/CSS, never 🔴🟢 emoji (BRAND.md §4).
- **Shadows light-mode only (49):** good — but dark mode then separates with borders/surfaces; our dark
  tokens already do (`border-subtle/strong`). Confirm, no problem.
- **Density (77) is an axis, not a size.** sm/md/lg = component size; comfortable/compact = row/padding
  density. Decide the model BEFORE mass-building, since it doubles padding variants on tables/forms.
- **Overlay family is interdependent.** Modal, Drawer, Toast, Popover, Menu all need ONE overlay/portal
  primitive + z-index scale (50) + focus-trap (79). Build that base first, then the five on top.
