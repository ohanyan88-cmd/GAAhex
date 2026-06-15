# GAAhex — Decision Log

Append-only log of reviewer↔executor rulings. One line per decision: `date · phase · question → decision (why)`. Keeps review-bursts coherent without shared chat memory. Newest at the bottom.

---

## Current status (update as phases close)
- **Plan:** Architecture redesign LOCKED → Phase 1 (Shell+gx) → Phase 2 (Workspace) → Phase 3 (CRM→Leads).
- ✅ **Ph0** lock-in · ✅ **Ph1** brand-align/tokens (`06f9ed28`) · ✅ **Ph2** components (`8e67e609`) · ✅ **Ph3** i18n/formatters/gate
- ✅ **Ph1a** nav rewire (`1e8ec1c9`) · ✅ **Ph1b** ASK ME → header · ✅ **Ph1c** gx-AppShell (`00b89605`)
- ⏳ **Ph1d** gx-CommandBar · ⬜ **Ph1e** gx-StatusBadge
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
