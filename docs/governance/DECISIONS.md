# GAAhex — Decision Log

Append-only log of reviewer↔executor rulings. One line per decision: `date · phase · question → decision (why)`. Keeps review-bursts coherent without shared chat memory. Newest at the bottom.

---

## Current status (update as phases close)
- **Plan:** Architecture redesign LOCKED → Phase 1 (Shell+gx) → Phase 2 (Workspace) → Phase 3 (CRM→Leads).
- ✅ **Ph0** lock-in · ✅ **Ph1** brand-align/tokens (`06f9ed28`) · ✅ **Ph2** components (`8e67e609`) · ✅ **Ph3** i18n/formatters/gate
- ✅ **Ph1a** nav rewire (`1e8ec1c9`) · ✅ **Ph1b** ASK ME → header · ✅ **Ph1c** gx-AppShell (`00b89605`)
- ✅ **Ph1d** gx-CommandBar (`394deaa8`) · ✅ **Ph1e** gx-StatusBadge (`92e95092`)
- 🔒 **Phase 1 SEALED (2026-06-15)** — close-out audit clean · canon docs in repo · tsc=0 vitest 66/66. Next: Phase 2 Workspace.
- **Push:** held — commits only, no push until owner says.

---

## Decisions
- Ph1 · token naming → keep existing `--gx-{role}` names, amend §2 (rename = cosmetic risk).
- Ph1 · `views/proto/*` → delete (git keeps history; capture patterns first).
- Ph1 · wire casing → thin camelCase boundary at the data seam (opt-in, not blanket).
- Ph1 · color tokens → theme-aware / semantic from the start (light = value-map).
- Ph0 · standard registration → index-registration, not per-file banners.
- Brand-align timing → focused pass before Ph2 so components inherit the right look. 4px-ladder = separate.
- Fonts · Sora not in repo → self-host woff2, 3 faces (Sora=Latin · Noto Sans Armenian=AM · Noto Sans=Cyrillic/RU); `@font-face` + `unicode-range`; one `--gx-font-family`. Source gwfh.mranftl.com (OFL).
- Light-mode bug → fix tokenized: pin dark-theme context on chrome (sidebar + auth panel). No hardcoded light hex.
- Ph2 · scope → GO full Part B. Table = §5+§6+§7+longest-wins+all-states · SearchBox = presentational only · Chip = status-only uppercase · `can()` = real default-deny.
- Ph2 · naming → `gx-` = CSS/token prefix; components keep PascalCase — no force-rename.
- Ph2 · `can()` → default-deny + `'*'` wildcard FULL_ACCESS (zero regression now, ready for live perms).
- Ph2 → Ph3 · sequencing → commit Ph2, GO Ph3, skip demo-adoption.
- Ph3 · gate → A (RATCHET): lint+format on staged files only; typecheck+test global; block via husky+lint-staged+CI. No blanket reformat.
- Ph3 · client-unify → one client (`bfetch`) + 401 everywhere; `login` stays raw; opt-in `camelKeys` seam.
- Workflow → keep the split (Bro = executor · reviewer = chat-bursts). Continuity via repo docs.

---

## Architecture Redesign — LOCKED (2026-06-15)

- **5 Platform Laws:** #1 Workspace=Where I Work / Left Nav=Where Data Lives · #2 Left Nav=System Map · #3 Left Nav=Business Domains/Root Objects only · #4 SST=Single Point of Creation · #5 Dashboards→Workspace (exception: real-time monitoring).
- **CRM** = Pipeline · Campaigns · Leads · Customers (Customer 360 = record workspace, not nav item).
- **Operations** = Orders · Work Orders (Order = root, born from Pipeline #6 SYSTEM ACTION).
- **Billing** = Invoices · Payments · Collections · Adjustments.
- **Network Operations** = NOC Dashboard · Incidents · Monitoring · RADIUS Sessions · IPAM · Fiber Network.
- **Inventory** = Equipment · Warehouses.
- **Reports · Organization · Admin Panel** = General section.
- **ERP Expansion** (HR/Procurement/Legal/Finance) = HIDDEN in nav, code/routes preserved, Phase N.
- **Header** = ASK ME (Platform AI, replaces Search) · Calendar · Messages · Mail · Notifications · User Menu.
- **RULE #001:** Customer created only at Pipeline #13 Activation. DB: `customer.lead_id UUID NOT NULL REFERENCES leads(id)`.

## Phase 1 Decisions (2026-06-15)

- Q1 · Support Tickets → HIDE · DO NOT DELETE · DO NOT MOVE TO NOC · keep route+entity+Pipeline Ticket Lifecycle · access via Customer 360 + deep links + Workspace · Phase 3 Customer Care decision pending.
- Q2 · Users → Organization (Departments · Employees · Roles · Users) · moved from Admin Panel.
- Q3 · Records → KEEP ENGINE · REMOVE NAV INJECTION · MOVE UNDER STUDIO → Entity Builder.
- Organization final = 4 items: Departments · Employees · Roles · Users.
- Ph1a · commit `1e8ec1c9` · nav rewire DONE · gate clean · sections 8→9 · items ~23→~31 · 9 hidden preserved · Admin Panel flattened · unused imports removed.
- Ph1b · ASK ME → header · azure pill · responsive collapse · zero hardcoded · DONE.
- Ph1c · commit `00b89605` · gx-AppShell composable (collapsed/navOpen state, skip-link, nav-scrim, logo swap, 3-col DOM) · App.tsx = thin wrapper · tsc=0 vitest 40/40 · DONE.
- **Bilingual law reminder:** all Bro artifacts EN + HY always (L0).

## Phase 1 Seal (2026-06-15)

- Canon docs → `docs/governance/`: `ARCHITECTURE_LOCKED.md` · `REVIEWER_PROTOCOL.md` · `GAAHEX_BRO_OPERATING_MANUAL.md` (+ `.docx`) placed from owner's canon zip.
- `GAAHEX_SYSTEM_STANDARD.md` → NOT duplicated into governance · single source stays at `docs/standards/GAAHEX_SYSTEM_STANDARD.md` (existing repo copy is the richer/canonical one: LAW-ST1 position block + repo-relative paths + standards-index #00). Duplicating = §0.3 one-source violation.
- `DECISIONS.md` in canon zip = older (Ph1d ⏳ / Ph1e ⬜) · repo copy is newer/authoritative · NOT overwritten (README rule: overwrite only if newer).
- `REVIEWER_PROTOCOL.md` → fixed broken paths on placement: `docs/decisions/DECISIONS.md` → `docs/governance/DECISIONS.md` (2×) · standard ref → `docs/standards/…` (refactor-on-sight; re-read must resolve).
- Stale comment → `CalendarView.tsx:387` "PageShell ActionBar's" → "CommandBar's". Zero `ActionBar` refs remain in `frontend/src/`.

## Phase 2 — Workspace (2026-06-15)

- **Scope:** redesign the role-personalized Workspace body into `gx-WorkspaceGrid` (approved Sales-Agent composition). UI grammar phase; real data in Phase 3.
- **Q1 · HomeView → A (redesign + delete duplicate nav):** workspace body becomes `gx-WorkspaceGrid`. The HomeView tab chrome (ask/messages/mail/calendar/requests/documents/benefits/kb) is **duplicate of the locked header** — verified reachable via header + standalone routes (`/ask` `/messages` `/mail` `/calendar` `/notifications` `/profile`). → DELETE the tab system (verify-before-delete: grep + tsc + test, before AND after). One home for comms = header.
- **Q2 · Data → A (contract-true seeded):** new typed `GET /api/workspace?role=`, ONE real fetch (§11). Real where available; every seeded/derived field listed by dot-path in `WorkspaceData.sample[]` — the Phase 3 live-swap tracker. No fake-as-real.
- **Q3 · Roles → A (Sales ref + config scaffold):** ship `b2b_am` (Sales-Agent reference) fully; `gx-WorkspaceGrid` is role-config-driven (composes existing `lib/workspace/registry.tsx` role-resolution + `can()`) so the other 9 roles slot via config. **DEFERRED + tracked:** Dispatcher + Operations Manager have no backend role-def in the 10-role vocab — add in a follow-up phase.
- **Compose, don't remake (HARD RULE):** reuse `KPITile` as the KPI tile (= gx-KpiTile; sparkline `chart` slot + gold progress) · `GxStatusBadge` for status/source chips · `Card` · `ActivityTimeline` grammar for calls · `AppShell` wraps · registry role-resolution + `can()`. New `gx-` only where none exists.
- **Foundation built:** `lib/workspace/contract.ts` (typed `WorkspaceData` SST) · `gx-Widget` base (title/states/refresh/link) · `--gx-focus-wash` token (both themes, on `--gx-interactive`) · `styles/_workspace.css` (zones + chrome) wired into aggregator.
- **i18n:** Phase 2 ships REAL trilingual keys (AM+EN+RU) in all three bundles — not English-fallback-only like Ph1 (parity test enforces identical key sets).
- **Build orchestration:** 8 leaf widgets + the backend endpoint built in parallel; each agent writes only its own component+test (unique files, collision-free) and returns its CSS + i18n for the integrator to merge into shared files; integrator (Bro) assembles `gx-WorkspaceGrid`, wires the fetch, swaps HomeView, deletes old `wx-*` widgets + tab chrome (verify-before-delete), gates, commits.
- **i18n chrome-vs-data split (locked):** widget CHROME (titles · buttons · empty/error states · ARIA · role-switcher labels · the 13 canonical aria stage labels) is trilingual via `ws.*` keys (AM+EN+RU, parity-enforced). Role-specific DATA labels (KPI/goal names, stage display labels, focus summary, names, alert text) come from the backend payload in English and are seeded → listed in `sample[]`; their localization is a Phase 3 concern (endpoint takes a locale + live data). Rationale: the backend reuses one `i18nKey` (e.g. `kpi.revenue`) across roles with different labels, so bundling those keys would collapse per-role meaning. Render via `t(i18nKey, label)` so it localizes for free once the backend emits a locale.
- **Token audit (mandate):** every `--gx-*` design token used in `_workspace.css` verified defined in `gaahex-tokens.css`; theme-aware (colour/surface/text/border/glass/chart/status) tokens confirmed present in BOTH the dark (`:root,[data-theme=dark]`) and light (`[data-theme=light]`) value-maps → all defined, both modes ✅. New token `--gx-focus-wash` added theme-aware. Component data-props (`--gx-pipe-fill`, `--gx-ring-circ`/`-dash`, `--gx-alert-dot-color`) are set inline from data and consumed via `var()` — correct token-consuming pattern, intentionally NOT in the token source.
- **Cleanup:** deleted dead registry-driven workspace CSS from `_addendum.css` (`.ws-home`/`.ws-urgent*`/`.ws-grid*`/`.wx-*`, 241→134 lines) — replaced by `gx-ws-*` / `gx-widget` / `gx-*` leaf classes; verify-before-delete (zero `.wx-*` refs in `src`). `lib/workspace/registry.tsx` slimmed to the role vocabulary only. Old HomeView tab chrome + `resolveWidgets` widget-bag removed.
- 🔒 **Phase 2 SEALED (2026-06-15)** — gate clean: tsc=0 · vitest 120/120 (+54) · eslint=0 · prettier clean · token audit both-modes ✅. Pushed to `origin` (GitLab/lab) + `github` (hub). Remaining: visual in-browser dark/light pass (manual); Phase 3 = CRM→Leads (RULE #001 + live workspace data, shrink `sample[]`).
