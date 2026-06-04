# System Tokenization & Standardization Audit

**Date**: 2026-06-04
**Repo HEAD**: `2c5edeb` (Production Cert chain seal)
**Mode**: code-only inspection — no files changed
**Scope**: `frontend/`, `frontend-portal/`, `backend/app/routers/{portal_billing,documents}.py`, `docs/standards/`, `docs/specs/`
**Methodology**: 5 parallel audit packs (CSS hardcoding, inline-style TSX, component standardization, accessibility/responsive/enterprise, portal+backend HTML+standards parity) against canonical token source `frontend/src/styles/gaahex-tokens.css` and standards files 09 + 13.

---

## Executive Summary

**Overall verdict**: GAAhex has a **strong canonical token foundation** (237 Tier-1 `--gx-*` tokens, 69 Tier-0 scale stops, D17/D18/D19 family-role discipline encoded in `gaahex-tokens.css`) but **the codebase has not migrated to it**. Two parallel design systems coexist (admin frontend ~70% adopted, customer portal 0% adopted), the canonical primitive components (`<Button>`, `<Input>`, `<FormField>`, `<Stack>`, `<Inline>`, `<Grid>`) are **functionally dead** with single-digit use sites against hundreds of raw-class instances, and the 9-tab object-detail spec is implemented **three independent times** (CustomerView + InvoicesView + AccountsView each re-roll the same 8 tab body components).

**Headline numbers** (post Stage-2 cleanup at `2c5edeb`):

| Dimension | Count |
|---|---:|
| Inline `style={{...}}` instances across TSX | **2,509** in 145 files |
| `LAYOUT-ONE-OFF` (flex/grid/stack done inline) | ~1,100 (44% of all inline styles) |
| `BARE-PX-SPACING / BARE-PX-FONT` | ~830 (33%) |
| Raw `className="btn ..."` instances (bypass `<Button>`) | 111 in 43 files |
| Raw `className="inp"` instances (bypass `<Input>`) | 348 in 67 files |
| Hand-rolled `TabButton` reimplementations | 7 god files |
| Duplicate "Card" definitions in the wild | 3 (canonical + auth + local function in DashboardView) |
| Distinct breakpoint pixel thresholds (CSS) | 11 (5 ad-hoc + 3 centralized + 3 misc) |
| Orphan `--gx-*` tokens (defined, unused) | **63** |
| Phantom `--gx-*` tokens (used, undefined) | **4** |
| Hardcoded brand hex in backend Python | 14 locations (D18 backend-color-string guard violation) |
| Frontend-portal `--gx-*` token adoption | **0%** (100% legacy `--primary/--accent`) |
| Frontend-portal i18n coverage | **0%** (no `t()`, no `hy` bundle, only `toLocaleString('hy-AM')` for numbers) |
| WCAG AA color-contrast failures | `--gx-text-3` on `--gx-surface-2` (~3.4-3.6:1, fails 4.5:1) |
| Missing keyboard handlers on `<div onClick>` | 12 sites (HomeView ×10, CalendarView ×1, App.tsx ×1) |
| SVG charts without `aria-label`/`role="img"` | ~30 functions across DashboardView + NocDashboardView (~2,800 LOC of unlabeled data viz) |

**Critical risk**: the `frontend-portal/` SPA is on the **deprecated bearer-token + localStorage auth path** even though the backend ships HttpOnly-cookie + CSRF Stage-2 mode. Flipping `PORTAL_AUTH_MODE=cookie` in production today would 403 every mutating portal API call (no `credentials: 'include'`, no `X-CSRF-Token` echo). The audit chain's CONDITIONAL GO CANDIDATE assumed the portal SPA was wired to consume cookie mode; this audit reveals it is not. This belongs in the Phase-1 critical bucket.

---

## What Is Already Standardized

### Token registry — **canonical foundation is solid**

`frontend/src/styles/gaahex-tokens.css` (534 LOC) defines:

- **Tier-0 raw color scales** (theme-independent): cobalt-50..950 (11), azure-50..950 (11), gold-50..900 (10), slate-0..950 (13), green/amber/red/violet {400,500,600,soft} (16), viz-1..8 (8) = **69 stops**
- **Tier-1 semantic `--gx-*` tokens**: 237 declarations across `:root[data-theme="dark"]` (default) + `[data-theme="light"]` overrides, covering surfaces, text (text-1/2/3/disabled/inverse/on-primary/on-gold/placeholder), borders, brand (cobalt/gold), primary, interactive (+hover/active/soft/ring), hover/pressed/selected/ring, semantic status, 12 ISP/network statuses, chart roles, shadows, glows, skeleton
- **Scales**: spacing `--gx-space-0..12` (4px base, 13 steps), radius `--gx-radius-none/xs/sm/md/lg/xl/2xl/full` (8), border widths `--gx-border-1/2/3` (3), font sizes `--gx-text-xs..6xl` (11), weights, leading, tracking, motion durations + eases (11), z-index `--gx-z-base..tooltip` (8), sizing (control/row/header/sidebar), shadows xs/sm/md/lg/xl/inset (6)

### Standards parity — confirmed correct

| Standard | Implementation |
|---|---|
| D18 5-family color discipline (Cobalt/Gold/Azure/Slate/Semantic) | Encoded in `gaahex-tokens.css:339-365` with inline comments documenting role decoupling (L121-127, L312-336, L345-351) |
| D18 backend-color-string guard | Documented in `09-design-system-standards.md:169-173`. **Violated** by `documents.py:28-40` + `portal_billing.py:166-188` — see Section 3. |
| D18 `--gx-link` aliased to `--gx-interactive` | `gaahex-tokens.css:315, 435` |
| D18 `--gx-primary*` decoupled from `--azure-*` | Comments at L127-128, L338 explicitly document the cobalt-spine separation |
| D17 KPI tile rules | `primitives.css` — `.kpi-tile:hover` keeps gold (container-rule), tooltip fade+scale only, `kpiPremium` machinery removed in Sixth patch |
| `:focus-visible` global outline | `_base.css:47` — `outline: 2px solid var(--focus-ring); outline-offset: 2px` |
| `prefers-reduced-motion` | `gaahex-tokens.css:532-534` collapses all `--gx-dur-*` to 0ms |
| XSS hardening on backend HTML | `documents.py:50-51` (`_e()`) and `portal_billing.py:21-23` consistently escape every interpolation; status colors routed via whitelist dict |
| Font self-hosting | `gaahex-tokens.css:21-102` hosts Space Grotesk + IBM Plex Sans + IBM Plex Mono woff2; no Inter / system-ui references in main `frontend/src/` |
| `<html lang="en">` on staff invoice document | `documents.py:86` (missing on `portal_billing.py:168` — Section 3 flag) |

### Primitives + components — what's working

| Primitive/Component | File | Use sites |
|---|---|---:|
| `<KPITile>` | `frontend/src/primitives/KPITile.tsx` | 37 across 11 files; **0 ad-hoc reimplementations** |
| `<StatusPill>` | `frontend/src/primitives/StatusPill.tsx` | 84 across 37 files; always renders a text label (never color-only) |
| `<Toast>` / `toast.*` API | `frontend/src/components/Toast.tsx` | 239 call sites across 43 files |
| `<Modal>` + `ConfirmHost` | `frontend/src/components/Modal.tsx` | 18 sites, single `gx-dialog` chrome, centralized destructive confirms |
| `<RowActionsMenu>` | `frontend/src/components/RowActionsMenu.tsx` | Exemplary a11y: `aria-haspopup="menu"`, `aria-expanded`, roving Arrow + Home/End + Escape, focus restore |
| `<Overlay>` + `useFocusTrap` | `frontend/src/components/Overlay.tsx`, `frontend/src/lib/useFocusTrap.ts` | Full focus trap + restore + body scroll-lock + Esc; Modal/ConfirmHost inherit |
| `<EmptyState>` / `<LoadingState>` / `<ErrorBanner>` / `<SkeletonRows>` | `frontend/src/components/States.tsx` | 233 imports across 65 files; correct `role="status"`/`aria-live`/`aria-busy`/`role="alert"` |
| `<UserMenu>` | `frontend/src/components/UserMenu.tsx` | `aria-haspopup="menu"`, `aria-expanded`, language switcher is `role="group"` with `aria-pressed` per language |
| `<PageHeader>` (in PageShell) | `frontend/src/page-shell/PageHeader.tsx` | `<nav aria-label="Breadcrumb">` + single `<h1>` per page |
| `<PageShell>` | `frontend/src/page-shell/PageShell.tsx` | **51 of 55 views** adopted |
| `<KPIBar>` (PageShell zone B) | 38 adopters via `kpis=` prop |
| `<ActionBar>` (PageShell zone D) | 24 adopters via `primaryAction=` / `secondaryActions=` |
| `icons.tsx` 100+ named exports | `frontend/src/components/icons.tsx` | Centralized; `MoreVerticalIcon` dedup landed earlier this session |
| `OrgView` accessibility | 30+ `aria-label`, `role="tab"`/`aria-selected`, `role="img"+aria-label` on SVG, `aria-expanded`, `role="alert"`, `role="listbox"+option`. **Reference implementation other god views should mirror** |
| Audit-Event forensic immutability | Sealed in production cert at `2c5edeb`; not in tokenization scope |

---

## What Is Not Token-Based

### Category 1: CSS hardcoded values

Pack 1 confirmed the canonical token registry is comprehensive; the violations are **call-site adoption gaps**, not gaps in the token registry itself (with the exception of breakpoint tokens — see Token Gaps below).

**Top hardcoded-hex offenders in CSS**: most CSS files USE tokens correctly; the offenders are concentrated in:
- `frontend/src/styles/_section-polish.css` — some legacy hex literals that pre-date D18
- `frontend/src/styles/nms-tokens.css` — NMS namespace (`--nms-*`) parallel to `--gx-*` (intentional or accidental? — flag for product decision)
- `frontend/src/styles/color-tokens.css` — **duplicate token system**, see Section "Duplicate token systems" below

### Category 2: Inline `style={{...}}` hardcoding in TSX

**2,509 inline-style instances across 145 files** (Pack 2). Categorized:

| Category | Count | % | Verdict |
|---|---:|---:|---|
| LAYOUT-ONE-OFF (flex/grid that should be `<Stack>`/`<Inline>`/`<Grid>`) | ~1,100 | 44% | MIGRATE |
| BARE-PX-SPACING (should be `--gx-space-*`) | ~520 | 21% | MIGRATE |
| BARE-PX-FONT (should be `--gx-text-*`) | ~310 | 12% | MIGRATE |
| TOKEN-REFERENCE clean (`var(--gx-text-3)` inline — fine, could be class) | ~330 | 13% | KEEP / hoist to class |
| DYNAMIC-VAR (chart geometry, identity tones — legitimate) | ~140 | 5.6% | KEEP |
| SVG-PROP (icon tint via currentColor, SVG sizing) | ~70 | 2.8% | KEEP |
| TOKEN-REFERENCE with defensive HEX fallback (`var(--gx-text-3, #64748b)`) | ~65 | 2.6% | DROP fallback |
| HEX-COLOR literal | ~30 | 1.2% | MIGRATE → token |
| RGBA-LITERAL | ~25 | 1.0% | MIGRATE → token |
| CSS-VAR-INJECTION (`style={{ '--lt': tone }}` — sanctioned) | 1 | <0.1% | KEEP (underused — only StudioOverview.tsx:89) |

**Top 10 inline-style hotspots** (file:LOC, count):

1. `frontend/src/views/DashboardView.tsx` (1501 LOC) — **162** (mostly chart geometry, legitimate DYNAMIC-VAR; ~50 are duplicated card scaffolds)
2. `frontend/src/views/NocDashboardView.tsx` (1314 LOC) — **99** (uses `--nms-*` parallel namespace; verify intentional)
3. `frontend/src/views/InteractionsView.tsx` (702 LOC) — **75**
4. `frontend/src/views/NetworkInventoryView.tsx` (1224 LOC) — **64**
5. `frontend/src/studio/EntitiesPane.tsx` (1413 LOC) — **62** (drawer-scrim pattern duplicated)
6. `frontend/src/studio/WebhooksPane.tsx` (942 LOC) — **62**
7. `frontend/src/views/HomeView.tsx` (653 LOC) — **61** (12 list-card sections, same row pattern repeated)
8. `frontend/src/views/RevenueAssuranceView.tsx` (1508 LOC) — **59**
9. `frontend/src/studio/NotificationsPane.tsx` (995 LOC) — **58**
10. `frontend/src/studio/VersionHistory.tsx` (570 LOC) — **57**

**Critical hex literal pockets**:

| file:line | violation | suggested token | risk | effort |
|---|---|---|---|---|
| `frontend/src/views/MasterLayoutDemoView.tsx:118-209` | 17 hardcoded light-theme hex (`#ffffff`, `#0f172a`, `#475569`, `#94a3b8`, `#f1f5f9`) — fails in dark mode | `var(--gx-text-1/2/3)`, `var(--gx-border)`, `var(--gx-surface)` | High | Medium |
| `frontend/src/views/HomeView.tsx:136-151` | Quick-Action button colors hardcoded `#22c55e`, `#f59e0b`, `#8b5cf6`, `#ec4899` | `var(--gx-success/warning/...)` | High | Small |
| `frontend/src/views/DashboardView.tsx:617, 626-630` | Heatmap raw blue `rgba(59,130,246,${intensity})` | `--gx-chart-active` / `color-mix()` with `--gx-interactive` | Medium | Small |
| `frontend/src/views/DashboardView.tsx:222-225` | FunnelChart `hsl(${200 + i*20}, 70%, ${50 + i*5}%)` ignores `--viz-1..8` | `var(--viz-1..8)` | Medium | Medium |
| `frontend/src/views/CalendarView.tsx:439` | `color: '#0A1120'` checkmark — invisible in dark theme | `var(--gx-on-primary)` | Low | Small |

**Critical RGBA literal pockets**:

| pattern | sites | suggested token |
|---|---:|---|
| Drawer/modal scrim `background: 'rgba(0,0,0,0.55)'` or `0.45` | ~12 (EntitiesPane ×3, NotificationsPane ×4, WebhooksPane ~4, ConfigureDrawer L197, ChartPicker L40) | **Introduce `--gx-overlay`** — single token migration kills entire cluster |
| RA semantic-tinted bg `rgba(239,68,68,0.10)` etc | ~6 in `RevenueAssuranceView.tsx:1143-1478` | `var(--gx-danger-soft)`, `var(--gx-warning-soft)`, `var(--gx-success-soft)` |
| Identity-tone overlay `tone + '22'` (calendar) | 3 in `CalendarView.tsx:330,460,512` | Pre-computed soft variants or `color-mix()` |

**Token-reference with defensive hex fallback** — ~65 sites across views (AccountsView, InvoicesView, CollectionsView, ComingSoonView, NetworkInventoryView, PipelineView, ProductsView, RevenueAssuranceView, TariffPlansView, DashboardView, HomeView, PaymentMethodsView, ChartPicker, EntitiesPane, NotificationsPane). Verdict: tokens are now Tier-1; **drop hex fallbacks** in a single sweep.

### Category 3: Backend Python hex literals (D18 guard violation)

| file:line | hardcoded | risk |
|---|---|---|
| `backend/app/routers/documents.py:28-40` | Module constants `_COBALT="#1C3B68"`, `_GOLD="#C5A059"`, `_INK`, `_INK2`, `_INK3`, `_BORDER`, `_SURFACE`, `_STATUS_COLOR` dict — D18 backend-color-string guard violation | **High** |
| `backend/app/routers/portal_billing.py:166` | `status_color = {"PAID": "#10B981", "ISSUED": "#1C3B68", "OVERDUE": "#E65F00", "VOID": "#D90429"}` | **High** |
| `backend/app/routers/portal_billing.py:171-189, 295-296` | `<style>` block hardcodes `#111827, #fff, #1C3B68, #E2E8F0` inline in both invoice + receipt | **High** |
| `backend/app/routers/documents.py:85-115` | All CSS in `_page()` is Python f-string interpolation of module hex constants | **High** |

**Mitigation strategy**: server HTML cannot resolve `var(--gx-*)` (SPA isn't on the page). Either (a) introduce a Python-side `BRAND_PRINT_PALETTE` dict imported from a `theme_constants.py` module, OR (b) build a tenant-themable theme-config table that the renderer reads. Recommended approach: (a) — keeps it simple, makes the violation a single-source dict.

### Category 4: Duplicate token systems

`frontend/src/styles/color-tokens.css` exists alongside `gaahex-tokens.css` and defines overlapping `--gx-*` tokens with **different names for the same role** and **different scales**:

| `gaahex-tokens.css` (canonical) | `color-tokens.css` (parallel) |
|---|---|
| `--gx-text-xs/sm/base/md/lg/xl/2xl/3xl/4xl/5xl/6xl` | `--gx-text-9/10/11/12/13/14/16/18/22/28` |
| `--gx-space-0..12` (4px base) | `--gx-space-1..20` (mixed steps inc. `space-16: 32px`) |
| `--gx-weight-regular` | `--gx-weight-normal` |
| `--gx-dur-instant/fast/...` | `--gx-duration-instant/fast/...` |

**D19 ("no standing rule/code contradiction") is structurally violated** by having two files claim the `--gx-*` prefix with conflicting definitions.

### Token gaps (canonical registry is missing)

The audit found **no breakpoint token family**. CSS files invent their own thresholds: 560 / 600 / 720 / 880 / 900 / 1024 / 1100 / 1180 / 768 / 480 px in `_responsive.css` + `_overlays.css` + `_keyframes.css` + `_section-polish.css` + `_helpdesk.css` + `_app-shell.css` + `_comms.css` + `nms-tokens.css` + `_login.css` + `_dashboard-kit.css` + `_studio-kit.css` + `studio.css`. **Recommend introducing `--gx-bp-mobile: 480px`, `--gx-bp-tablet: 768px`, `--gx-bp-desktop: 1024px`** (matching the centralized Tier 1/2/3 already in `_responsive.css`).

`--gx-tap-min: 44px` **is defined but never referenced** anywhere (Pack 4 finding). Every button/control uses `--gx-control-sm: 28px`, `--gx-control-md: 34px`, `--gx-control-lg: 42px` — all **below** the WCAG 2.5.5 minimum touch-target.

---

## Components Not Following Standards

### Dead primitives (defined, almost never imported)

| Primitive | Canonical | Use sites | Raw-class instances bypassing it |
|---|---|---:|---:|
| `<Button>` | `frontend/src/primitives/Button.tsx` | **20** in 4 files | **111** `btn-md` in 43 files |
| `<Input>` | `frontend/src/primitives/Input.tsx` | **6** (4 in stories) | **348** `className="inp"` in 67 files |
| `<FormField>` | `frontend/src/primitives/FormField.tsx` | **8** (HelpdeskView only) + 2 stories | ad-hoc `<label>+<input>` everywhere |
| `<Stack>` / `<Inline>` / `<Grid>` | `frontend/src/page-shell/primitives/{Stack,Inline,Grid}.tsx` | **≤6 each** | **293** raw `style={{ display: 'flex' }}` in 79 files |

**Implication**: a `<Button>` migration that retroactively replaces 111 raw `btn-md` sites would reclaim disabled-state, loading-spinner, icon-slot, and focus-ring contract uniformity. Same for `<Input>` (lost `error`/`size` props on 348 sites).

### Three independent "Card" definitions

| Definition | Location | Class |
|---|---|---|
| Canonical | `frontend/src/page-shell/primitives/Card.tsx` | `.card-primitive` |
| Auth/section-page legacy | `frontend/src/styles/_section-polish.css` chain | `.card` |
| **Shadow primitive** | `views/DashboardView.tsx:265-280` — local `function Card()` | inline `<div className="card">` + `card-head` + `card-pad` |

The DashboardView local `Card` is invoked inside the file but **shadows the page-shell `Card` import** if any code path tries to use both. **High risk** because DashboardView is the highest-traffic view.

### Seven hand-rolled `TabButton` reimplementations

Same azure-2px-underline recipe copy-pasted across god files:

| file:line | component name |
|---|---|
| `views/CustomerView.tsx:933` | `CustomerTabButton` |
| `views/InvoicesView.tsx:401` | `InvoiceTabButton` |
| `views/AccountsView.tsx:471` | `AccountTabButton` |
| `views/RevenueAssuranceView.tsx:778` | `RaTabButton` |
| `views/NetworkInventoryView.tsx:439` | `NiTab` |
| `views/CollectionsView.tsx:916` | `TabButton` |
| `views/PipelineView.tsx:90` | `TabButton` |

**Canonical detail-tab primitive is missing**. The legacy `.tab/.tab.on` (pill flavor) in `_tabs.css` and the new `.drawer-tab` (underline) in `_drawer.css` are the two non-component flavors — **both exist in the wild**.

### Orphan badge classes

| file:line | class | status |
|---|---|---|
| `views/HomeView.tsx:206,525,548,580,615` | `badge-primary` | **Orphan** — no CSS file defines it; renders fallthrough to base `.badge` + inline `fontSize: 11` |
| `views/HomeView.tsx:206,...` | `badge-neutral` | **Orphan** |
| `views/DispatchBoardView.tsx:87,88` | `badge-neutral`, `badge-warning` | **Orphan** |

Falls back silently; visual drift will surface as soon as `.badge` styling changes.

### Legacy `.btn-accent` variant

Defined only in `_buttons.css:23` (NOT in `primitives.css` and NOT in the `<Button>` variant enum). Used in **28 files** including 5 god files: `EntitiesPane`, `InvoicesView` (L538, L1030), `CustomerView` (L642, L698), `AccountsView` (L341), `WorkItemsView` (L513,519), `MyTasksView` (L513,519). **Risk**: if `_buttons.css` is ever cleaned per a refactor, these all visually break.

### 9-tab object-detail spec — implemented 3 times

| View | 9-tab spec? | Implementation |
|---|---|---|
| `views/CustomerView.tsx` | ✓ all 9 | Uses canonical `views/customer-tabs/*` components |
| `views/InvoicesView.tsx` | ✓ all 9 | **Re-defines** 8 tab body components (`InvoiceTimelineTab` L695, `InvoiceTasksTab` L731, `InvoiceCommentsTab` L776, `InvoiceAttachmentsTab` L810, `InvoiceApprovalsTab` L856, `InvoiceRelatedTab` L902, `InvoiceCommunicationsTab` L906, `InvoiceAuditTab` L953) |
| `views/AccountsView.tsx` | ✓ all 9 | **Re-defines** 8 (same structure as Invoices) |
| `views/EntityView.tsx` (1116 LOC) | **✗** | Object-detail spec violated |
| `views/OrgView.tsx` (2078 LOC) | **✗** | Has own layout switcher; no canonical tab set |
| `views/RevenueAssuranceView.tsx` | **✗** | Custom tabs: Findings/Lifecycle/Reports/Settings |
| `views/NetworkInventoryView.tsx` | **✗** | Custom tabs: Fiber/IPAM/RADIUS/Broadcast |
| `views/CollectionsView.tsx` | **✗** | Custom tabs: Cases/Policies |
| `views/OrdersView.tsx` | **✗** | Action-only detail panel |

**Net result**: 16 duplicate tab-body React functions across InvoicesView + AccountsView (Invoices is essentially a copy-paste of customer-tabs renamed); 6 detail views missing the canonical 9-tab set entirely.

### Studio pane uniformity — drawer pattern

Same drawer scrim + panel + section-head skeleton repeats in: `EntitiesPane`, `WebhooksPane`, `NotificationsPane`, `AppearancePane`, `UsersPane`, `Permissions`, `AuditLogPane`, `ApiDocsPane`. Currently hand-rolled per pane (~80 inline styles total). **Single `.studio-drawer-scrim` + `.studio-drawer-panel` + `.studio-section-head` class set wipes ~120 inline styles across 8 panes.**

### Customer portal — wholesale parallel design system

`frontend-portal/src/styles/styles.css` defines its own token block (lines 40-149) — **zero `--gx-*` references**. Brand color VALUES are correct (cobalt-700 + gold-500) but token ROLES are merged: `--primary` carries brand-spine AND interactive AND link roles simultaneously, `--accent` (gold) is used for both signature AND interactive-hover (BillsView, ServiceView styles). **This is the exact "too much cobalt" + "gold-on-hover" D18 failure mode** the canonical token system was designed to prevent.

| Token (portal) | Verdict |
|---|---|
| `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-2`, `--text-3` | LEGACY — pre-D18 names |
| `--primary` `#3A6FB5`, `--primary-hover`, `--primary-soft` | **DIVERGES** — D18 violation (one token, three roles) |
| `--accent` `#C5A059`, `--accent-hover`, `--accent-soft` | **DIVERGES** — D18 violation (gold on interactive) |
| `--warning` `#F5A623` ≠ canonical `#F2AE3C` | DIVERGES |
| `--danger` `#E63946` ≠ canonical `#F0666B` | DIVERGES |
| `--focus-ring` gold-based ≠ canonical azure-based | DIVERGES (D18 violation) |
| `--font-body` `'IBM Plex Sans'` direct string | DIVERGES — no `--gx-font-sans` ref; missing Space Grotesk entirely |
| `--radius-sm/--radius/--radius-lg` AND `--r-sm/--r-md/--r-lg/--r-xl/--pill/--r-pill` | **Two parallel radius scales in the same file**; `--pill`/`--r-pill` defined twice with same value |
| `--sidebar-bg-image`, `--header-bg-image`, `--content-bg-image` | PORTAL-ONLY, no canonical equivalent |

---

## Duplicate / One-Off UI Patterns

| Pattern | Where it should live | Hand-rolled instances |
|---|---|---|
| Tab button (azure 2px underline + label + count) | **missing canonical primitive — needs `<DetailTab>`** | 7 files (see TabButton table above) |
| 9-tab object-detail bodies | `views/customer-tabs/*.tsx` (canonical) | Re-defined in `InvoicesView.tsx` L695-960 and `AccountsView.tsx` L677-960 — **16 duplicate React functions** |
| Inline KPI strip inside body | `<KPIBar>` via PageShell `kpis=` prop | `<div className="kpi-strip">` in body — CollectionsView L369, CustomerView L410/432, NetworkInventoryView L932, ReportBuilderView L298, RevenueAssuranceView L553/936 (these views render kpi-strip IN ADDITION to PageShell Zone B KPIs) |
| Filter UI | `<FilterBar>` zone E via PageShell `filters=` | Only 9 of 51 PageShell adopters pass `filters=`. Other 42 hand-roll `.toolbar` + raw selects |
| Card wrapper | `page-shell/primitives/Card.tsx` (`.card-primitive`) | Local `function Card()` in `views/DashboardView.tsx:265` |
| Pagination cluster (Prev / 1 2 3 / Next) | **missing canonical primitive — needs `<Pagination>`** | OrdersView L445-451, AccountsView L408-414, CollectionsView L518-524, WorkItemsView L333-339 — **4 identical inline implementations** |
| LoadShell (loading/empty/error wrapper) | **missing canonical primitive — needs `<LoadShell>`** | `LoadShell<T>` defined inline in `views/NetworkInventoryView.tsx:505` |
| Inline flex/grid/stack layouts | `<Inline>` / `<Stack>` / `<Grid>` page-shell primitives | **293 raw `style={{ display: 'flex' }}` across 79 files** — primitives effectively dead |
| Modal "Cancel + Action" footer pair | `<Modal footer={...}>` accepts buttons but no helper | Every modal repeats `<button className="btn btn-ghost btn-md">Cancel</button><button className="btn btn-primary btn-md">…</button>` |
| Conversation-list row (avatar + name + message preview) | **missing canonical primitive — needs `<ConversationRow>`** | InteractionsView, MessagesView, OutboundView — **3 identical copies, ~150 inline styles total** |
| Home-list-row (icon + label + chevron) | **missing canonical primitive — needs `<HomeListRow>`** | HomeView L201-645 — **10 sections, ~45 inline styles** |
| K/V grid (`gridTemplateColumns: '140px 1fr'`) | **missing canonical primitive — needs `.kv-grid` class** | NetworkInventoryView, InstallationBoardView, MessagesView, InteractionsView, CustomerView side panel, OrgIdentity — **~80 instances** |
| Drawer scrim + panel chrome | **missing canonical primitive — needs `<StudioDrawer>` or class set** | 8 studio panes + 4 modals — **~120 inline styles** |
| Defensive hex fallback in `var(--gx-x, #hex)` | (anti-pattern) | ~65 sites across views — drop in a single sweep |

---

## Accessibility / Responsive / Enterprise Risks

### Accessibility (top findings — full table in Pack 4 output)

| file:line | issue | risk |
|---|---|---|
| `views/HomeView.tsx:523, 532, 546, 555, 568, 578, 591, 600, 613, 622` | 10× `<div onClick>` for entity rows — no `role`, no `tabIndex`, no Enter/Space handler | **High** |
| `views/CalendarView.tsx:459` | `<div onClick={openEdit}>` no keyboard | **High** |
| `App.tsx:454` | `<div className="nav-scrim" onClick>` no `role`/`aria-label` | Medium |
| `components/SlideOutPanel.tsx` (whole) | No focus trap, no focus restore on close | **High** |
| `components/RecordDrawer.tsx:113-128` | Esc handler exists; **no focus trap, no focus restore** to trigger on close | **High** |
| `components/EmojiPicker.tsx:46` | `.emoji-backdrop` no `role`/`aria-label`; dialog `role="dialog"` but missing `aria-modal`, no focus trap | Medium |
| `views/NocDashboardView.tsx` (whole, 1314 LOC) | **0 `aria-label`** — every SVG bar/gauge/donut unlabeled; uplink bar has no `role="progressbar"`/`aria-valuenow`/`aria-valuemax` | **High** |
| `views/DashboardView.tsx` (whole, 1501 LOC) | **0 `aria-label`, 0 `role=`** — all 13 chart functions (BarChart, AreaChart, LineChart, DonutChart, HorizontalBarChart, FunnelChart, Pareto, Sankey, GeoMap, NetGrowthChart, GroupedBarChart, HeatmapChart, StackedBarChart) render data-bearing SVG with no accessible name | **High** |
| `views/DashboardView.tsx:603-635` HeatmapChart | Color-only legend ("Less … More" + 5 dots); cells unlabeled SVG | Medium |
| `views/HomeView.tsx:533-535, 591-593` | "5h" overdue cue is color-only (`var(--gx-danger)`) — no icon, no "overdue" text | Medium |
| `components/Toast.tsx:62` | `role={kind === 'error' ? 'alert' : 'status'}` but error toasts default to 4000ms auto-dismiss; WCAG 2.2.1 suggests ≥20s for errors | Medium |
| `gaahex-tokens.css:306, 426` | `--gx-text-3` on `--gx-surface-2`: dark ≈ 3.4:1, light ≈ 3.6:1 — **fails WCAG AA 4.5:1 for normal text**, passes only large-text 3:1 | Medium |
| `views/MasterLayoutDemoView.tsx:124-209` | 17 hardcoded light-theme hex — invisible in dark mode | Medium |
| `frontend-portal/src/views/*.tsx` all loading/empty/error | No `role="status"`/`aria-live`/`role="alert"`; empty states raw `<h3>` without EmptyState primitive | Medium |
| `frontend-portal/src/views/*.tsx` h-hierarchy | Portal pages start at `<h2>` — **no `<h1>` anywhere in the portal**; sidebar `<div className="sidebar-logo">G</div>` is a `<div>` | Medium |
| `frontend-portal/src/views/BillsView.tsx:43`, `ServiceView.tsx:44` | `alert(...)` for error UI — modal-blocking, no styling, escapes design system | Medium |
| `backend/app/routers/portal_billing.py:168` | Invoice HTML missing `lang` attribute; no `<meta name="viewport">`; no semantic `role` on status pill | Medium |
| `views/CustomerView.tsx:532` | `<div role="tabpanel" aria-label=…>` missing `aria-labelledby` back-reference to tab button id | Low |

### Responsive (breakpoint inventory + findings)

**11 distinct viewport-width thresholds in CSS** (5 ad-hoc + 3 centralized + 3 misc):

| Threshold | Where | Notes |
|---|---|---|
| 480px | `_responsive.css:149` | Centralized Tier 3 mobile |
| 560px | `_overlays.css:36` | Ad-hoc (Toast edge-to-edge) |
| 600px | `_keyframes.css:23` | Ad-hoc (empty rule — orphan) |
| 720px | `_section-polish.css:213` | Ad-hoc (Activity row) |
| 768px | `_responsive.css:56` | Centralized Tier 2 tablet |
| 880px | `_helpdesk.css:121` | Ad-hoc (Helpdesk rail) |
| 900px | `_app-shell.css:65,75`, `_comms.css:149`, `nms-tokens.css:318`, `_login.css:20`, `_dashboard-kit.css:50` | Ad-hoc (sidebar→drawer, comms, NMS, login, dashboard) |
| 1024px | `_responsive.css:29` | Centralized Tier 1 large tablet |
| 1100px | `_keyframes.css:19` | Ad-hoc (orphan) |
| 1180px | `_studio-kit.css:32`, `studio.css:821` | Ad-hoc (studio split-pane) |
| `prefers-reduced-motion` + `print` | `gaahex-tokens.css:532`, `_responsive.css:219` | Centralized |

**Responsive findings**:

| file:line | issue | risk |
|---|---|---|
| `gaahex-tokens.css:275` | `--gx-tap-min: 44px` defined, **never referenced**. All controls 28-42px. Below WCAG 2.5.5 / mobile 44px standard | **High** |
| `_responsive.css:200-201` | At ≤480px, `.btn { min-height: 36px }` and `.iconbtn { min-width/height: 36px }` — still below 44px and contradicts the token | Medium |
| 8 ad-hoc breakpoint pixel literals | `_responsive.css` comment self-flags "inconsistent mix of breakpoints"; Tier 1/2/3 added ON TOP rather than consolidating — net 11 thresholds in production | Medium |
| `backend/app/routers/portal_billing.py:171, 295` | Invoice + receipt HTML: `max-width:800px / 600px` but **no `<meta name="viewport">`** — mobile renders at default 980px desktop viewport, zoomed out | **High** |
| `backend/app/routers/portal_billing.py:170-178, 293-296` | **No `@media print` block**. Cobalt header band white-on-white in default print mode | **High** |
| `views/InstallationBoardView.tsx`, `components/WorkItemsBoard.tsx:71` | Kanban `gridTemplateColumns: repeat(N, minmax(220px, 1fr))` — 4-5 cols × 220 = 880-1100px; tablet+mobile clip without `overflow-x` wrapper | Medium |
| `frontend-portal/src/views/LoginView.tsx:31` | `<div className="card" style={{ width: 400 }}>` — fixed width, overflows at <420px | Medium |
| `frontend-portal/src/views/BillsView.tsx:90` | `<table className="grid">` without `.grid-wrap` parent → no horizontal-scroll on narrow viewports | Medium |
| 50+ sites: `whiteSpace: 'nowrap'` + `overflow:hidden` + `textOverflow: 'ellipsis'` | Long content silently truncated without `title=` hover. Customer names, helpdesk subjects, lead names. | Medium |

### Enterprise-grade risks

| file:line | issue | risk |
|---|---|---|
| `frontend-portal/src/lib/api.ts:1-23` | **SPA still uses localStorage Bearer auth.** Backend ships HttpOnly-cookie + CSRF (Stage-2 sealed at `2c5edeb`). Mutating endpoints will 403 if `PORTAL_AUTH_MODE=cookie` flipped in production | **High** |
| `frontend-portal/src/lib/api.ts:24` | `fetch()` calls don't pass `credentials: 'include'` — can't ride cookie cross-origin | **High** |
| `frontend-portal/src/lib/api.ts:147-178` | Mutating POSTs (`payInvoice`, `createTicket`, `replyTicket`, `serviceRequest`) don't send `X-CSRF-Token` | **High** |
| `frontend-portal/` whole SPA | **No i18n** — no `lib/i18n.ts`, no `t()`, no `hy` bundle; only `toLocaleString('hy-AM')` for numbers (mixed-locale output: Armenian numbers, English labels) | **High** |
| `backend/app/routers/portal_billing.py:180-188` + `documents.py:432-433` | Invoice/receipt/statement HTML: all English labels ("Invoice", "Customer", "Period", "Issued", "Due", "Description", "Qty", "Unit price", "Total", "Paid", "Balance due"). Customer-facing document — hy-AM customers receive English doc | **High** |
| `views/DashboardView.tsx`, `views/NocDashboardView.tsx` (both whole files) | 0 `t()` calls. Hardcoded English: "OLTs Online", "Total Uplink Capacity", "Optical RX Power", "vs 7d", "Net change", "Cumulative %", "80% target line", etc. | Medium |
| `views/MasterLayoutDemoView.tsx`, `views/HomeView.tsx:136-151`, `views/DashboardView.tsx:617-630, 222-225, 485-502`, `views/CalendarView.tsx:439` | Dark theme parity broken — hex literals don't switch with `data-theme` | Medium |
| `backend/app/routers/portal_billing.py:188, 303` | "Balance due" colored `style="color:#E65F00"` — color-only critical financial value, no icon, no aria-label | Medium |
| `frontend/src/styles/*` (15 files) | 24 `margin-left:` / `padding-left:` instances, **zero** `margin-inline-start` / logical properties — RTL future-cost | Low (today's primary languages are LTR) |
| `frontend-portal/src/views/PortalShell.tsx:73-77` | `.sidebar-logo` renders a literal "G" text — no SVG/PNG hex-tile logo asset (DESIGN_SYSTEM §1 violation) | Medium |
| `backend/app/routers/documents.py:172, 275, 377` + `portal_billing.py:179, 298` | All 5 server-rendered documents render issuer as plain text — **no `<img>` for hex tile logo**; "two gold A's" wordmark hand-styled via `.ex` CSS but no `<span class="ex">` markup wraps the letters | Medium |
| `backend/app/routers/documents.py:90-91` | Font stack: `-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif` — no IBM Plex Sans, no Space Grotesk, no woff2 `<link>` (font-stack lock violation) | Medium |
| `frontend/src/App.tsx` | No app-level `<ErrorBoundary>` mounted; single async view crash blanks whole app | Medium |
| `frontend/src/styles/_data-tables.css:75` | `.kpi-strip .kpi:hover { transform: translateY(-1px) }` — contradicts D17 "no movement on KPI tile hover" (dormant: `.kpi-strip` renders `.kpi-tile` not `.kpi`, but the rule is still incorrect) | Low |

### Orphan tokens (defined, unused) — 63 total

Highlights:
- **Entire ISP network-status palette** (`--gx-degraded`, `--gx-maintenance`, `--gx-offline`, `--gx-provisioned`, `--gx-throttled`, `--gx-quarantined`, `--gx-quality-good/warn/bad`, `--gx-unknown`) — the platform's central domain has tokens that no UI consumes
- **Entire chart-role family beyond default+active** (`--gx-chart-default-2`, `--gx-chart-grid`, `--gx-chart-peak`, `--gx-chart-sweep`, `--gx-chart-track`) — D18 chart-role rule documented but not wired
- **Brand-spine hover/active states** (`--gx-primary-hover`, `--gx-primary-active`) — if any code wants Cobalt-spine hover, it has nowhere to look
- **Armenian font stack** `--gx-font-am` — defined for `'Noto Sans Armenian'` fallback, never referenced; Armenian-script UI relies on browser default
- **Row-density family** (`--gx-row-compact/default/comfortable`) — defined for table density, no `.dtr-*` class consumes them
- 10 of 13 `--gx-space-*` steps unused (only `space-4/6/8` are referenced)
- `--gx-tap-min: 44px` (the WCAG touch-target)
- `--gx-text-inverse`, `--gx-text-on-primary`, `--gx-text-disabled`, `--gx-weight-bold`, `--gx-weight-regular`, `--gx-blur-{sm,md,lg}`, `--gx-shadow-inset`, `--gx-glow-primary`, `--gx-inverse-surface`

### Phantom tokens (used, undefined) — 4

| Token | First usage | Fallback |
|---|---|---|
| `--gx-bg-2` | `views/PipelineView.tsx:147,213`, `CustomerView.tsx:977`, `CollectionsView.tsx:757,774`, `ProductsView.tsx:338`, `NetworkInventoryView.tsx:749`, `TariffPlansView.tsx:517`, `RevenueAssuranceView.tsx:1146`, `ComingSoonView.tsx:73` | hex `#f1f5f9`/`#f8fafc` — silently renders fallback. **Probably intended as `--gx-bg-subtle` (defined L293, also unused)** |
| `--gx-surface-1` | `_notifications.css:7`; studio panes (ApiDocsPane, EntitiesPane, NotificationsPane, UsersPane, WebhooksPane — 15+ sites); `RevenueAssuranceView.tsx:1424,1479` | hex `#ffffff` fallback — studio panes silently render light surface in dark theme |
| `--gx-warning-bg` | `views/ComingSoonView.tsx:51` | hex `#fef3c7` — closest defined is `--gx-warning-soft` |
| `--gx-warning-border` | `views/ComingSoonView.tsx:53` | hex `#fde68a` |

### Spec-without-impl gaps (from `gx-to-repo-mapping.md`)

LOCKED primitives in `09-design-system-standards.md` missing canonical implementation:
- `.gx-btn--tertiary` button variant
- `.gx-chip` filter chip
- `.gx-tag` (vs. badge)
- `.gx-monochip` (inline IP/MAC chip — ISP-critical for NMS)
- Standalone `.gx-check` checkbox
- Inline `.gx-alert--info` and `.gx-alert--warning` (only `.error-banner` exists)
- Generic `.gx-tip` tooltip
- `.gx-avatar--sm` / `--lg`
- `.gx-card--clickable`
- `.gx-toast-title` / `.gx-toast-body` (title/body split)
- `.gx-sechead-rule`
- `.gx-crumbs .cur`

---

## Prioritized Fix Roadmap

### Phase 1 — Critical violations (1-2 weeks)

| # | Action | Files | Risk closed | Effort |
|---|---|---|---|---|
| 1 | **Wire portal SPA to cookie/CSRF mode** (api.ts: `credentials: 'include'`, `X-CSRF-Token` echo, drop `localStorage`/`Bearer`) | `frontend-portal/src/lib/api.ts`, `views/LoginView.tsx` | High — production blocker if backend forces cookie mode | Medium |
| 2 | **Introduce `--gx-overlay`** Tier-1 token + migrate 12 drawer/modal scrim sites | `gaahex-tokens.css`, 8 studio panes + 4 modals | High — RGBA literal cluster eliminated | Small |
| 3 | **Fix `--gx-text-3` contrast failure** on `--gx-surface-2` (dark `#6E7F96` → `#7E8FA6` or lift surface; light similar) | `gaahex-tokens.css:306, 426` | Medium — WCAG AA blocker for enterprise sales | Small |
| 4 | **Add keyboard handlers + role+tabIndex** to 12 `<div onClick>` sites (HomeView ×10, CalendarView, App.tsx) | HomeView, CalendarView, App.tsx | High — accessibility blocker | Medium |
| 5 | **Fix phantom token references** (4 tokens): rename `--gx-bg-2`→`--gx-bg-subtle` (or define), define `--gx-surface-1` or migrate to `--gx-surface`, define `--gx-warning-bg`/`--gx-warning-border` or migrate to `-soft` variants | 9 view files + 5 studio panes | High — silent dark-theme breakage | Small |
| 6 | **Backend invoice/receipt HTML**: add `lang="en"` to `portal_billing.py:168`, add `<meta name="viewport">`, add `@media print { -webkit-print-color-adjust: exact; page-break-inside: avoid; }`, add CSP header | `backend/app/routers/portal_billing.py`, `documents.py` | High — B2B print + mobile blockers | Small |
| 7 | **Backend Python hex constants → `theme_constants.py` module** (D18 backend-color-string guard fix) | `backend/app/routers/documents.py:28-40`, `portal_billing.py:166-188`; new file `backend/app/branding/theme_constants.py` | High — D18 standards compliance | Medium |
| 8 | **Document MasterLayoutDemoView as demo-only or fix dark-theme parity** (17 hex literals) | `views/MasterLayoutDemoView.tsx:118-209` | Medium — visible breakage if reached in dark mode | Small |

### Phase 2 — Shared component standardization (2-4 weeks)

| # | Action | Files | Risk closed | Effort |
|---|---|---|---|---|
| 1 | **Build `<DetailTab>` primitive** + migrate 7 hand-rolled TabButton sites | new `frontend/src/primitives/DetailTab.tsx`; replace `CustomerTabButton` (CustomerView L933), `InvoiceTabButton` (InvoicesView L401), `AccountTabButton` (AccountsView L471), `RaTabButton` (RevenueAssuranceView L778), `NiTab` (NetworkInventoryView L439), `TabButton` (CollectionsView L916, PipelineView L90) | High — closes 7-file tab drift | Medium |
| 2 | **Build `<Pagination>` primitive** + migrate 4 identical clusters | new `frontend/src/primitives/Pagination.tsx`; replace OrdersView L445-451, AccountsView L408-414, CollectionsView L518-524, WorkItemsView L333-339 | Medium | Small |
| 3 | **Build `<LoadShell>` primitive** that wraps loading/empty/error states | new `frontend/src/primitives/LoadShell.tsx`; harvest from NetworkInventoryView L505 | Medium — pattern reused 30+ times | Medium |
| 4 | **Build `<ConversationRow>` primitive** + migrate 3 conversation lists | new `frontend/src/components/ConversationRow.tsx`; replace InteractionsView, MessagesView, OutboundView | Medium — ~150 inline styles eliminated | Medium |
| 5 | **Build `<StudioDrawer>` chrome** + migrate 8 studio panes | new `frontend/src/studio/StudioDrawer.tsx`; replace scrim+panel+section-head in EntitiesPane, WebhooksPane, NotificationsPane, AppearancePane, UsersPane, ApiDocsPane, Permissions, AuditLogPane | Medium — ~120 inline styles eliminated | Medium |
| 6 | **Resolve EmptyState duplication** — single canonical, deprecate the other | merge `components/States.tsx EmptyState` + `page-shell/EmptyState.tsx` | Medium | Small |
| 7 | **Resolve Card triple definition** — delete local `function Card()` in DashboardView L265, use `page-shell/primitives/Card.tsx` | `views/DashboardView.tsx:265-280` | High — shadow primitive in highest-traffic view | Small |
| 8 | **Delete orphan badge classes OR define them**: `badge-primary`/`badge-neutral`/`badge-warning` referenced in HomeView + DispatchBoardView | 5 view sites + `primitives.css` | Medium | Small |
| 9 | **Migrate `.btn-accent` → `<Button variant="primary">` or gold-signature variant** across 28 files | EntitiesPane, InvoicesView, CustomerView, AccountsView, WorkItemsView, MyTasksView (and 22 others) | Medium — kills legacy variant | Medium |
| 10 | **Add canonical TERTIARY button variant**, `.gx-chip`, `.gx-tag`, `.gx-monochip`, `.gx-check`, `.gx-alert--info/--warning`, `.gx-tip` per spec | `primitives/Button.tsx`, new primitive files + `primitives.css` | Medium — closes spec-without-impl gap | Large |
| 11 | **Build `<Pagination>` + reduce `<FilterBar>` adoption gap** (encourage `filters=` prop usage in remaining 42 PageShell views) | 42 view files | Medium — closes Zone E gap | Large |
| 12 | **Unify 9-tab implementation** — make `views/customer-tabs/*` parameterized and use from InvoicesView + AccountsView; **delete 16 duplicate tab body components** | `views/InvoicesView.tsx:695-960`, `views/AccountsView.tsx:677-960`, `views/customer-tabs/*` | High — 16-file duplication closed | Large |
| 13 | **Add canonical 9-tab set to EntityView + OrgView + RevenueAssuranceView + NetworkInventoryView + CollectionsView + OrdersView** | 6 detail-view files | Medium — closes standards conformance gap | Large |

### Phase 3 — Full token migration (4-8 weeks)

| # | Action | Files | Risk closed | Effort |
|---|---|---|---|---|
| 1 | **Drop ~65 defensive hex fallbacks** in `var(--gx-x, #hex)` calls — single sweep | AccountsView, InvoicesView, CollectionsView, ComingSoonView, NetworkInventoryView, PipelineView, ProductsView, RevenueAssuranceView, TariffPlansView, DashboardView, HomeView, PaymentMethodsView, ChartPicker, EntitiesPane, NotificationsPane | Medium — fallback cruft | Medium |
| 2 | **Reconcile `gaahex-tokens.css` vs `color-tokens.css`** — pick one as canonical, redirect or delete the other | 2 CSS files | High — D19 violation closed | Medium |
| 3 | **Add breakpoint token family**: `--gx-bp-mobile/tablet/desktop` (480/768/1024) — consolidate 11 ad-hoc thresholds | `gaahex-tokens.css` + 12 CSS files | Medium | Large |
| 4 | **Wire `--gx-tap-min: 44px` into Button/Input/IconButton at mobile breakpoint** | `primitives.css` + `_responsive.css` | High — WCAG 2.5.5 compliance | Small |
| 5 | **Wire dead ISP network-status tokens to NMS UI** OR remove them | `gaahex-tokens.css:381-390` + NocDashboardView + NetworkInventoryView | Medium — orphan cleanup | Medium |
| 6 | **Wire dead chart-role tokens** (`--gx-chart-peak/sweep/grid/track/default-2`) to DashboardView charts OR remove | `gaahex-tokens.css:371-377` + `views/DashboardView.tsx` | Medium | Medium |
| 7 | **Migrate ~1,100 LAYOUT-ONE-OFF inline styles** to `<Stack>`/`<Inline>`/`<Grid>` primitives | 79 files | Medium | Large |
| 8 | **Migrate ~830 BARE-PX inline styles** to `var(--gx-space-*)` / `var(--gx-text-*)` references or shared classes | 145 files | Medium | Large |
| 9 | **Build `<HomeListRow>` + `.kv-grid` class** + migrate hand-rolled instances | HomeView (10 sections), NetworkInventoryView, InstallationBoardView, MessagesView, InteractionsView, CustomerView, OrgIdentity | Medium | Medium |
| 10 | **Replace 30 hex-color literal inline styles** with token references | MasterLayoutDemoView, HomeView, DashboardView, CalendarView, OrgIdentity | Medium | Small |
| 11 | **Migrate ~110 raw `btn-md` instances to `<Button>` primitive** | 43 files | Medium | Large |
| 12 | **Migrate ~348 raw `inp` instances to `<Input>` primitive** | 67 files | Medium | Large |

### Phase 4 — Cleanup, tests, and documentation (2-3 weeks)

| # | Action | Files | Risk closed | Effort |
|---|---|---|---|---|
| 1 | **Portal D18 migration** — rewrite `frontend-portal/src/styles/styles.css` to consume `--gx-*` tokens from main frontend; keep portal-only tokens namespaced (`--portal-*`) | `frontend-portal/src/styles/styles.css` (~150 LOC token block) | High — closes parallel design system | Large |
| 2 | **Portal i18n bootstrap** — copy `frontend/src/lib/i18n.ts` pattern; wire `t()` into all portal views; create `hy` bundle | new `frontend-portal/src/lib/i18n.ts` + 6 view files | High — closes the Voice Guide flag | Large |
| 3 | **Backend HTML i18n** — wire `documents.py` + `portal_billing.py` label strings through a backend `t(key, locale)` helper that reads `Accept-Language` or customer record locale | `backend/app/routers/documents.py`, `portal_billing.py`, new `backend/app/i18n.py` | High — customer-facing English-only docs | Large |
| 4 | **Backend HTML logo** — embed inline SVG hex tile + AAhex wordmark with explicit `<span class="ex">AA</span>` markup; reference `icon-light.png` for fallback | `backend/app/routers/documents.py`, `portal_billing.py` | Medium — brand parity on print | Small |
| 5 | **Remove 63 orphan `--gx-*` tokens** (or wire them) | `gaahex-tokens.css` | Low — code hygiene | Medium |
| 6 | **Add visual regression tests** for primitive consumers (per-tab snapshot of object-detail; per-modal snapshot of studio drawer) | new `frontend/tests/visual/*.test.tsx` (or Storybook chromatic) | Low — long-term drift prevention | Large |
| 7 | **Document the migration trail** in `docs/standards/14-tokenization-migration-2026-06.md` (this audit + per-phase outcomes) | new doc | Low | Small |
| 8 | **CI lint rules**: forbid `style={{` with hex literal OR bare px, forbid raw `className="btn ..."` without import-check, forbid `<div onClick>` without role | new `.eslintrc` rules + custom plugin | Medium — prevent backslide | Medium |
| 9 | **RTL preparation sweep** — replace `margin-left`/`padding-left` with logical `-inline-start` properties | 15 CSS files | Low — future-cost | Medium |
| 10 | **Delete `.search-kbd` dead CSS** in `_forms.css:57` (already confirmed orphan) | `_forms.css` | Low | Small |
| 11 | **Document NMS namespace decision** — is `--nms-*` intentionally parallel to `--gx-*`, or should it consolidate? | `docs/standards/` + `nms-tokens.css` | Low — clarity | Small |

---

## Recommended Claude Code Implementation Prompts

Each prompt below is **self-contained** — paste into a fresh Claude Code session in this repo and it will execute the phase. Save the prompts to `docs/audit/IMPLEMENTATION-PROMPTS-2026-06-04.md` for reuse.

### Prompt for Phase 1 — Critical violations

```text
GAAhex Tokenization Audit — Phase 1 Critical Remediation.
HEAD: 2c5edeb. Audit: docs/audit/TOKENIZATION-AUDIT-2026-06-04.md.

Execute the 8 Phase-1 actions from the audit. Hard rules:
- Do not weaken any production protection sealed at 2c5edeb (D6 RLS, append-only Event/Invoice/Payment triggers, deploy contract, JWT tenant binding, Fernet encryption, FeatureGate fail-closed, refresh revocation, audit logging).
- Preserve all D17/D18/D19 family-role discipline encoded in gaahex-tokens.css.
- Each action commits independently with a descriptive message.

Actions:
1. frontend-portal/src/lib/api.ts: add `credentials: 'include'` to every fetch(); add X-CSRF-Token echo header reading from the login response csrf_token; drop localStorage Bearer pattern; refactor LoginView to store csrf_token in memory.
2. frontend/src/styles/gaahex-tokens.css: add `--gx-overlay` Tier-1 token (dark `rgba(0,0,0,0.55)`, light `rgba(15,23,42,0.4)`). Migrate 12 drawer/modal scrim sites: studio/{EntitiesPane,NotificationsPane,WebhooksPane,AppearancePane,UsersPane,ApiDocsPane}, modals/ConfigureDrawer L197, components/ChartPicker L40.
3. gaahex-tokens.css L306, 426: lift `--gx-text-3` to hit WCAG AA 4.5:1 on `--gx-surface-2`. Verify across both themes.
4. Add role="button" + tabIndex={0} + onKeyDown Enter/Space handlers to 12 `<div onClick>` sites in views/HomeView.tsx L523-622, views/CalendarView.tsx:459, App.tsx:454.
5. Resolve phantom tokens: rename `--gx-bg-2` → `--gx-bg-subtle` (or define), define `--gx-surface-1` (or migrate refs to `--gx-surface`), define `--gx-warning-bg`/`--gx-warning-border` (or migrate refs to `-soft` variants).
6. backend/app/routers/portal_billing.py: add lang="en", <meta name="viewport">, @media print with -webkit-print-color-adjust:exact + page-break-inside:avoid + @page margin; add CSP header. Apply same to documents.py where missing.
7. backend/app/branding/theme_constants.py (new): module exporting BRAND_PRINT_PALETTE, STATUS_COLORS dicts. Refactor documents.py:28-40 and portal_billing.py:166-188 to import from it. D18 backend-color-string guard now satisfied via single-source dict.
8. views/MasterLayoutDemoView.tsx: replace 17 hardcoded light-theme hex values with token references OR mark file as light-theme-demo-only with a comment.

Validation after every action:
- alembic upgrade head (must still report c4e7a1f9b3d2 head)
- pytest tests/test_remediation_*.py tests/test_feature_gate.py (must stay 102 passed)
- visually verify the portal login + bill list + studio drawer in both dark and light themes
- contrast-check `--gx-text-3` against `--gx-surface-2` (must be ≥ 4.5:1 AA)

Report each action's outcome with file:line evidence. No silent caps. Commit independently. Push when complete.
```

### Prompt for Phase 2 — Shared component standardization

```text
GAAhex Tokenization Audit — Phase 2 Component Standardization.
Phase 1 must already be landed. Audit: docs/audit/TOKENIZATION-AUDIT-2026-06-04.md.

Build canonical primitives for 5 patterns currently hand-rolled across god files:
A. <DetailTab> — replaces 7 ad-hoc TabButton implementations (CustomerView L933, InvoicesView L401, AccountsView L471, RevenueAssuranceView L778, NetworkInventoryView L439, CollectionsView L916, PipelineView L90).
B. <Pagination> — replaces 4 identical Prev/Next clusters (OrdersView L445, AccountsView L408, CollectionsView L518, WorkItemsView L333).
C. <LoadShell> — generic loading/empty/error wrapper; harvest from views/NetworkInventoryView.tsx:505.
D. <ConversationRow> — replaces 3 conversation lists (InteractionsView, MessagesView, OutboundView).
E. <StudioDrawer> chrome — scrim + panel + section-head class set; replaces 8 studio pane drawers.

Then close 7 standardization gaps:
F. Delete the local function Card() in views/DashboardView.tsx:265-280; use page-shell/primitives/Card.tsx import.
G. Merge components/States.tsx EmptyState with page-shell/EmptyState.tsx — single canonical implementation.
H. Define or delete orphan badge classes: badge-primary, badge-neutral, badge-warning in HomeView + DispatchBoardView.
I. Migrate 28 .btn-accent uses to <Button variant="primary"> (or add gold-signature variant if the spec calls for it — check 09-design-system-standards.md).
J. Implement spec-without-impl primitives: TERTIARY Button variant, .gx-chip, .gx-tag, .gx-monochip (ISP-critical), .gx-check, .gx-alert--info/--warning, .gx-tip per docs/branding/gx-to-repo-mapping.md L188-206.
K. Unify 9-tab spec: parameterize views/customer-tabs/* to accept entity-type prop; delete 16 duplicate tab body components in InvoicesView L695-960 + AccountsView L677-960.
L. Add canonical 9-tab set to EntityView, OrgView, RevenueAssuranceView, NetworkInventoryView, CollectionsView, OrdersView. Each gets Overview + Timeline + Tasks + Comments + Attachments + Approvals + Related + Communications + Audit tabs at minimum.

Hard rules:
- Every new primitive lives in frontend/src/primitives/ or frontend/src/components/ and has a story file.
- Every migration commits independently with file:line evidence.
- No primitive may regress focus management, aria semantics, or D18 family-role discipline.
- After every migration: pnpm typecheck && pnpm test must pass.

Report each primitive build + each migration with before/after file:line diffs. Push when complete.
```

### Prompt for Phase 3 — Full token migration

```text
GAAhex Tokenization Audit — Phase 3 Full Token Migration.
Phases 1+2 must be landed. Audit: docs/audit/TOKENIZATION-AUDIT-2026-06-04.md.

Migrate the codebase to the canonical token system. Target:
- Zero hex literals in TSX inline styles (except CSS-VAR-INJECTION sanctioned pattern).
- Zero raw `style={{ display: 'flex', ... }}` for layouts that are <Stack>/<Inline>/<Grid> candidates.
- Zero defensive `var(--gx-x, #hex)` fallbacks.
- Single canonical token file (gaahex-tokens.css); color-tokens.css either deleted or aliased.
- All ~110 raw `className="btn ..."` migrated to <Button> primitive.
- All ~348 raw `className="inp"` migrated to <Input> primitive.
- Breakpoint token family introduced and 11 ad-hoc thresholds consolidated to 3.
- WCAG 2.5.5 tap-target enforcement on mobile via --gx-tap-min wiring.

Order (each step commits independently):
1. Reconcile gaahex-tokens.css vs color-tokens.css: pick one canonical, redirect or delete the other. Update all imports.
2. Add breakpoint tokens (`--gx-bp-mobile: 480px`, `--gx-bp-tablet: 768px`, `--gx-bp-desktop: 1024px`); replace 8 ad-hoc thresholds in {_overlays,_section-polish,_helpdesk,_app-shell,_comms,nms-tokens,_login,_dashboard-kit,_keyframes,_studio-kit,studio}.css with the tokens. Document via CSS custom media or fallback comments.
3. Wire `--gx-tap-min: 44px` into primitives.css `.btn`, `.iconbtn`, `.inp` at the ≤768px breakpoint.
4. Drop ~65 defensive hex fallbacks in `var(--gx-x, #hex)` calls across views.
5. Migrate ~30 HEX-COLOR literal inline styles to token refs (MasterLayoutDemoView, HomeView, DashboardView, CalendarView, OrgIdentity).
6. Wire dead ISP network-status tokens (`--gx-degraded`/`--gx-offline`/`--gx-provisioned`/etc.) into NocDashboardView + NetworkInventoryView OR remove them.
7. Wire dead chart-role tokens (`--gx-chart-peak`/`--gx-chart-sweep`/etc.) into DashboardView OR remove.
8. Migrate ~110 raw btn-md sites to <Button>.
9. Migrate ~348 raw `inp` sites to <Input> with proper FormField wiring.
10. Migrate ~1,100 LAYOUT-ONE-OFF inline styles to <Stack>/<Inline>/<Grid>.
11. Migrate ~830 BARE-PX inline styles to var(--gx-space-*) / var(--gx-text-*) references or new utility classes.
12. Build .kv-grid utility class + migrate ~80 instances (NetworkInventoryView, InstallationBoardView, MessagesView, InteractionsView, CustomerView, OrgIdentity).
13. Build <HomeListRow> primitive + migrate HomeView L201-645.

Hard rules:
- Visual regression must be zero (use Storybook + visual diff or manual audit per view).
- DYNAMIC-VAR inline styles stay (chart geometry, identity tones, theme picker — see audit Pack 2 KEEP list).
- After every step: pnpm typecheck && pnpm test && manual smoke of touched views in both themes.

Report progress per-step with file counts and inline-style delta. Push when complete.
```

### Prompt for Phase 4 — Cleanup, tests, and documentation

```text
GAAhex Tokenization Audit — Phase 4 Cleanup + Hardening.
Phases 1+2+3 must be landed. Audit: docs/audit/TOKENIZATION-AUDIT-2026-06-04.md.

Close the long-tail and lock the gains.

Actions:
1. Portal D18 migration: rewrite frontend-portal/src/styles/styles.css token block (L40-149) to consume `--gx-*` tokens from main frontend; keep portal-only tokens namespaced as `--portal-*`. Verify all portal views render correctly with shared tokens.
2. Portal i18n bootstrap: copy frontend/src/lib/i18n.ts to frontend-portal/src/lib/i18n.ts; create hy bundle; wire t() into every portal view (BillsView, ServiceView, SupportView, DashboardView, LoginView, PortalShell). Number formatting stays hy-AM; labels now also localized.
3. Backend HTML i18n: build backend/app/i18n.py with t(key, locale, fallback='en') helper reading customer record locale or Accept-Language; wire all label strings in documents.py + portal_billing.py through it. Add hy strings for invoice/receipt/statement bodies.
4. Backend HTML logo: embed inline SVG hex tile + AAhex wordmark with explicit `<span class="ex">AA</span>` markup in documents.py + portal_billing.py. Reference icon-light.png/icon-dark.png as fallback.
5. Remove 63 orphan `--gx-*` tokens from gaahex-tokens.css OR document them as reserved-for-future. Audit Pack 5 has the full list.
6. Add visual regression tests: snapshot per primitive in Storybook with Chromatic or custom Jest+puppeteer.
7. Document the migration outcome in docs/standards/14-tokenization-migration-2026-06.md: before/after counts (inline styles, raw classes, orphan tokens, contrast pairs), migration commits, lessons learned.
8. Add CI lint rules:
   - eslint custom rule: no hex literal in `style={{}}` (matches `#[0-9a-fA-F]{3,8}` in JSX attribute value)
   - eslint custom rule: no bare px in `style={{}}` for spacing/font properties
   - eslint custom rule: `<div onClick>` requires role="button" + tabIndex + onKeyDown
   - stylelint: no bare px below 4px boundary in color/spacing properties
   - CI rule: every new primitive in primitives/ must have a corresponding *.stories.tsx
9. RTL preparation sweep: replace `margin-left`/`padding-left`/`text-align: left|right` with logical `-inline-start`/`-inline-end` properties across 15 CSS files. No behavioral change in LTR locales today.
10. Delete confirmed-dead .search-kbd CSS in `_forms.css:57`.
11. Document NMS namespace decision: is `--nms-*` intentionally parallel to `--gx-*`, or should NocDashboardView migrate to the canonical token set? Record decision in docs/standards/.

Hard rules:
- No production-protection regression (sealed at 2c5edeb).
- CI rules ratchet — once landed, they prevent backslide.
- Every CI rule violation in existing code must either be fixed or explicitly waived with a comment.

Final deliverable: docs/audit/TOKENIZATION-MIGRATION-COMPLETE-2026-MM-DD.md sealing the migration with HEAD commit + before/after numbers + CI rules in effect. Push when complete.
```

---

## Appendix — How this audit composes with the Production Cert chain

This is a **separate audit lens** from the Production Cert chain sealed at `2c5edeb` (CONDITIONAL GO CANDIDATE).

The Production Cert focused on: tenant isolation, audit immutability, financial correctness, auth lifecycle, GDPR, fail-closed feature posture, deploy contract.

This audit focuses on: design-token adherence, primitive standardization, accessibility, responsive consistency, frontend portal alignment.

**No finding in this audit invalidates the CONDITIONAL GO CANDIDATE seal.** However:
- Phase-1 action #1 (portal SPA cookie-mode wiring) **does affect** the Stage-2 production contract — currently the portal SPA can't ride cookie mode even though backend supports it. If `PORTAL_AUTH_MODE=cookie` is flipped in production today, customer-facing portal mutations 403. This is a production-readiness gap not flagged by the cert audit (which scoped to backend-only).
- Phase-1 actions #3 + #4 close WCAG AA / 2.1.1 gaps that an enterprise pen-test or accessibility audit (one of the 6 Full-GO gates) would flag.

Other Full-GO gates remain pending per the certification arc:
1. Staging deployment validation
2. DR restore drill
3. Load testing at 15k subscribers
4. Independent pen-test
5. GDPR/privacy legal review
6. Operational readiness + production sign-off

---

**Audit chain commits (this audit + production cert)**:

| Commit | Audit | Outcome |
|---|---|---|
| `1b03a78` | 36-domain Production Certification Audit | NO-GO baseline |
| `d860639` | Stage-1 Production Remediation | 21 of 27 Criticals closed |
| `c48cc6d` | Stage-2 Production Rescue | All 27 Criticals closed via real-fix + fail-closed |
| `2c5edeb` | Production Cert SEAL | CONDITIONAL GO CANDIDATE |
| **next** | **Tokenization Audit** (this document) | **Phase 1-4 roadmap drafted** |
