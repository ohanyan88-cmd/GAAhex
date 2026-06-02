# SESSION HANDOFF — GAAhex, 2026-06-01 (audit P0/P1 cleared + 5 new advanced charts)

> Owner = Gev (calls me Ընգեր).
> Repo: `ohanyan88-cmd/GAAhex` — THE ACTIVE PRODUCT.
> Read this → `git pull` → `git status` → continue from "What's next".

## Hard rules (every session)
- **Orchestrator pushes** — agents commit locally; only main session runs `git push`
- **No fake / mock / hardcoded data** — every chart fetches from a real backend endpoint
- DELETE old code, don't layer
- Stage 8 Control Gate is THE only gate

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
