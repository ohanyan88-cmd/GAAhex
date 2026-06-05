# SESSION HANDOFF — GAAhex

> Owner = Gev (calls me Ընգեր).
> Repo: `ohanyan88-cmd/GAAhex` — THE ACTIVE PRODUCT.
> Read this → `git pull` → `git status` → continue from "What's next".

## Hard rules (every session)
- **Orchestrator pushes** — agents commit locally; only main session runs `git push`
- **No fake / mock / hardcoded data** — every chart fetches from a real backend endpoint
- DELETE old code, don't layer
- Stage 8 Control Gate is THE only gate

---

## Execution queue + command grammar (read this first when Gev says "next")

The canonical "what's next" lives in the auto-memory: **`memory/project_next_work_queue.md`**. It enumerates every remaining task (active queue + low-priority TD queue), the binding priority rules, and the 4-verb grammar below. Future sessions should consult that file before responding to any of the four verbs.

| Verb | Behavior |
|---|---|
| **`next`** | Begin the top in-progress/ready task in the queue. Propose the first concrete sub-action. Run verification. **Pause for explicit `go` before commit/push.** |
| **`skip`** | Mark current top-of-queue task `deferred` with a brief reason; move it below the line; advance to the next. |
| **`status`** | Show queue state (top, ready count, blocked count, deferred count, low-priority TD count). No file changes. |
| **`pause`** | Stop immediately. No file changes. No new task. |

**Default `next` action (as of 2026-06-06):** `Q1.A` — seal the GXL extension addendum at `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` (5 TBD placeholders to fill, D1–D7 acceptance boxes to check, then `DRAFT SHELL → SEALED`).

**Three items are parallel-eligible** today: `Q1.A`, `TD13`, `Pilot.Discovery`. Use `next td13` or `next pilot` to pick one of the parallels instead.

---

## Current state (2026-06-06) — Q5 LOCKED · Q1 next

| | |
|---|---|
| HEAD | `6ea8277` on `main` (pushed) |
| Working tree | clean |
| Main-branch CI | ✅ **GREEN** (most recent: run `27036230536` — Q5 implementation) |
| M0 staging readiness | ✅ GO (one watch-item: manual frontend smoke — DEFERRED) |
| Full pytest suite | ✅ **1,772 passed** (was 1,768; +4 from Q5 unit tests + KT-M1-5) |
| Drift checker | ✅ 12 HARD + 8 RATCHET rules pass |
| M0 killer test | ✅ in CI (`test_m0_killer_2nd_entity_config_only`) |
| Architecture stabilization | ✅ 105/107 closed (T-P3-9 + T-P2-4 explicitly non-blocking) |
| **Open architecture decisions** | **Q1 only** (Q5 and Q8 LOCKED 2026-06-05) |

### Closed in this stabilization cycle

- **D19 / TD11 — token registry double-definition** → CLOSED via Path A — commit `46f25d0`. `color-tokens.css` absorbed into `gaahex-tokens.css`; new HARD drift rule prevents recurrence; zero pixel change.
- **Tenant-filter CI gate** → CLOSED — commit `87bb42c`. Six safe-by-RLS sites annotated with `# noqa: tenant-filter` rationales; comment-only diff.

### Open (intentionally — non-blocking)

- **TD13** — `backend-rls` dual-role enforcement gate runs with `continue-on-error: true`. Tracked in sealed baseline §9 for **M1**. Not a release blocker.
- **T-P3-9** — ~1,100 layout one-offs → `<Stack>/<Inline>/<Grid>` consolidation. Drift checker prevents new instances; per-PR migration as files are touched.
- **T-P2-4** — `<ConversationRow>` primitive scope-flagged (only n=2 sites with divergent shapes). Revisit when a 3rd surface lands.

### Forward focus (active priorities)

**Goal: seal Q1 (the last open architecture decision) before broader M1 execution.** Manual staging walkthrough is intentionally deferred — it stays open as the M0 watch-item, but does not gate Q1. Onboarding the pilot ISP and any production cutover work are explicitly OUT OF SCOPE here.

1. **Q1 — GXL business-condition workflow guards** → finalize the DRAFT successor baseline at `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` (Phase 1.5 design review).
2. **Manual staging walkthrough** — DEFERRED. Steps 1–12 from `docs/audit/M0-STAGING-READINESS-2026-06-05.md` §3; remains the M0 watch-item but does not block Q1.

### Resolved (locked in)

- **First tenant selected: real ISP pilot participant.** ✅ RESOLVED 2026-06-05 — LOCKED. Strategic decision only — operational onboarding planning lives inside M1 execution. **Do not begin onboarding or production cutover from this decision alone.**
- **Q5 — Per-tenant feature flags.** ✅ IMPLEMENTED + LOCKED 2026-06-05 (commit `9662ea5`, CI run [`27036230536`](https://github.com/ohanyan88-cmd/GAAhex/actions/runs/27036230536) green). Server-side reader `backend/app/services/tenant_flag.py` + per-tenant `dunning_automation` seed + scheduler gate `_TENANT_FLAG_GATED_JOBS` + KT-M1-5 in CI. Each tenant decides `dunning_automation` independently; deploy-shape gates remain untouched per `docs/standards/FEATURE_GATING_POLICY.md`.
- **Q8 — RLS exemption policy.** ✅ LOCKED 2026-06-05 (commit `7e17707`). Standards docs at `docs/standards/RLS_EXEMPTION_POLICY.md` + `docs/standards/RLS_EXEMPTION_REGISTRY.md` (append-only, initialized empty).
- **Brand v3.0 — Production Ready · Certified · LOCKED.** ✅ Integrated 2026-06-06. Canonical brand package at `docs/branding/v3.0/` (340 files, 3.04 MB; entry `v3.0/README.md`). Frontend public assets (`logo/` · `favicon/` · `app-icons/` · `social/`) rotated to v3.0 derivatives; old assets archived at `frontend/public/_archive-pre-v3.0/`. D18 Color Architecture authoritative (Cobalt spine · Gold signature · Azure interactive · Slate neutrals · Semantic status; one family one role). Trademark **GAAhex™**. Original certified zip at `D:\GAAhex-Brand-v3.0-Final (1).zip` (sha256 `fc06401997…d46f80dfa`). **Do not redesign, reinterpret, or modify.** Source-of-truth pointer doc at `docs/branding/README.md`. Memory entry [`project_brand_source_of_truth.md`](auto-memory).

### After Q1/Q5/Q8 lock in

- **M1 implementation** — execute `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` (S1 → S9) against the locked pilot tenant.

### Sealed baselines

- `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` — current sealed baseline (post-M0-staging).
- `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` — DRAFT SHELL (Phase 1.5 GXL widening).

### Reference commits

```
87bb42c  ci(tenant-filter): annotate 6 safe-by-RLS query sites with noqa rationales
46f25d0  fix(D19 Path A): single token registry — color-tokens.css absorbed into gaahex-tokens.css
6c3336d  docs+i18n: autonomous session — forward-link, ru bundle, D19 analysis, Phase 1.5 runbook
8d84d02  docs(arch): DRAFT shell — GXL extension successor sealed baseline
8a09206  docs(roadmap): M1 plan — lock in Q1/Q5/Q8 resolutions
66c3b24  docs(roadmap): M1 platform expansion plan
82c3e39  docs(arch): sealed architecture baseline 2026-06-05
78636a1  docs(m0): staging readiness pass — GO with watch-item
b977db8  test(infra): full pytest suite now green — 1768/0/0
0559916  test(m0): killer test — 2nd entity from config alone, all 5 engines
```

---

## Legacy session log (pre-2026-06-05 — preserved for context)

# SESSION HANDOFF — GAAhex, 2026-06-01 (audit P0/P1 cleared + 5 new advanced charts)

---

## State at HEAD (pushed, clean)

- **Tests: 666 passing, 0 failing**
- Migration head: `c5e7f3a9b1d8` (live dev DB upgraded)
- Branch: `main`, HEAD == origin/main

### What landed this session (in order)

| Commit prefix | Subject |
|---|---|
| `feat(dashboard)` | WoW/MoM/QoQ/YoY comparisons, weekly multi-line, daily heatmap, 4 status breakdowns |
| `feat(dashboard)` | Chart picker: 70-chart catalog (24 implemented); fix fake customerData → real weekly data; 6 new endpoints |
| `fix(audit-P0-1)` | Hardcoded `localhost:8099` → `VITE_API_BASE` env var (10 frontend files + `lib/config.ts`) |
| `feat(audit-P0-2)` | `httpx` moved to runtime `requirements.txt`; production Dockerfiles for backend + frontend |
| `feat(audit-P0-3)` | `.github/workflows/ci.yml` — backend (pytest+ruff+pip-audit) + frontend (tsc+npm audit) + secret scan |
| `feat(audit-P1)` | Security headers middleware (X-Frame, X-Content-Type, Referrer-Policy, HSTS) + 1 test |
| `feat(audit-P1)` | DB indexes (record/workitem.status, event.created_at) + first-login forced password change |
| `feat(dashboard)` | **5 new advanced charts: Gantt, Pareto, Sankey, Geographic Map, Net Subscriber Growth** |

---

## Architecture: Home vs Dashboard

| View | Route | What it shows |
|---|---|---|
| **HomeView** (`'home'`) | Workspace → Home | Personal: MY tasks, MY approvals, MY tickets, TODAY's schedule, MY activity |
| **DashboardView** (`'dashboards'`) | Analytics → Dashboards | Company-wide: **29 charts now**, picker-configurable, 7d/30d/QTD/YTD |

### Dashboard charts (29 fully implemented)
- 4 KPI cards (MRR / AR / Collected / New leads)
- Revenue vs Churn bar · Subscription Donut · Payment Area · New vs Churned line
- AR Aging · Monthly Revenue · Sales Funnel
- WoW (8 cards) · MoM (8 cards) · QoQ + YoY grouped bars
- Weekly Multi-line · Daily Payment Heatmap
- 4 Status Breakdowns (workitems / tickets / invoices / subs)
- RAG Health Donut · Task Aging · Issue Aging · Risk Heatmap · Lead Source Donut · Salesperson Ranking
- **Gantt (projects) · Pareto (lead sources) · Sankey (sales conversion) · Geographic Map · Net Subscriber Growth**

41 more chart slots reserved as catalog stubs (visible in picker as "coming soon").

---

## Backend analytics endpoints (all real-data SQL aggregates)

```
GET /api/analytics/overview
GET /api/analytics/revenue-trend?months=N
GET /api/analytics/subscription-mix
GET /api/analytics/ar-aging
GET /api/analytics/comparisons             — week/month/quarter/year vs prior
GET /api/analytics/weekly-trend?weeks=N
GET /api/analytics/daily-heatmap?days=N
GET /api/analytics/status-breakdown
GET /api/analytics/task-aging
GET /api/analytics/ticket-aging
GET /api/analytics/risk-heatmap
GET /api/analytics/leads-by-source
GET /api/analytics/sales-by-user
GET /api/analytics/rag-health
GET /api/analytics/gantt                   — projects with start/due dates
GET /api/analytics/pareto/{entity}?group_field=
GET /api/analytics/sankey-leads
GET /api/analytics/geo-points              — sites + customers with lat/lon
GET /api/analytics/net-subscriber-growth?weeks=N
```

---

## Production-readiness state

| Item | Status |
|---|---|
| CI/CD on PR + push to main | ✅ `.github/workflows/ci.yml` |
| Backend production Dockerfile (multi-stage, non-root, healthcheck) | ✅ `backend/Dockerfile` |
| Frontend production Dockerfile (Node build + nginx) | ✅ `frontend/Dockerfile` |
| `.dockerignore` files (root + backend + frontend) | ✅ |
| `httpx` in runtime requirements | ✅ moved from dev to runtime |
| Frontend API base configurable via env | ✅ `VITE_API_BASE` |
| Security headers (X-Frame, X-Content-Type, Referrer-Policy, HSTS) | ✅ middleware live |
| First-login forced password change for seeded admin | ✅ + 1 test |
| DB indexes on hot status/created_at columns | ✅ migration `c5e7f3a9b1d8` |
| `.env.production.example` | ✅ + new `VITE_API_BASE` section |
| Real-data-only doctrine | ✅ fake customerData computation removed |

---

## What's still open

1. **22 other frontend files** still have `const BASE = 'http://127.0.0.1:8099'` (studio panes + 8 views + 1 modal). Same refactor pattern as the 10 done in P0-1 — just hadn't been in scope. Quick follow-up.
2. **41 chart catalog stubs** — visible in picker as "coming soon". Top priorities if you want more:
   - Burnup/Burndown · CFD · Sprint Velocity · Project Bubble Chart · EVM (EV/PV/AC)
   - Revenue Waterfall · MRR Trend · ARPU Trend · Coverage Expansion · ARR
   - CSAT/NPS · Customer Onboarding Progress · Win Rate Trend · Pipeline Progress
3. **Payment gateway credentials** — waiting on you (external, ARCA/iDram/TelCell/EasyPay merchant onboarding).
4. **Design reskin** — waiting on you to deliver new design files (memory rule: full-delete old when they arrive).

---

## Stack-up commands

```powershell
docker start gaahex-db gaahex-redis
cd C:\Users\Admin\Desktop\GAAhex\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8099
```

Frontend (new shell):
```powershell
cd C:\Users\Admin\Desktop\GAAhex\frontend
npm run dev      # → http://localhost:5173
# login: admin@demo.isp / admin123
# On first login you'll see must_change_password=true — change via Settings → Security
```

Tests:
```powershell
cd C:\Users\Admin\Desktop\GAAhex\backend
.venv\Scripts\python.exe -m pytest -q
```

---

— end handoff · 666/0 · clean · pushed —
