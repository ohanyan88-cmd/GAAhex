# SESSION HANDOFF — Portal, 2026-06-01 (post-dashboard split + full test data)

> Owner = Gev (calls me Ընгер).
> Repo: `ohanyan88-cmd/Portal` — THE ACTIVE PRODUCT. NEVER touch Desktop\GAAex.
> Read this → `git pull` → `git status` → continue from "What's next".

## Hard rules (every session)
- **Portal-only** — NEVER touch `C:\Users\Admin\Desktop\GAAex`
- **Orchestrator pushes** — agents commit locally; only main session runs `git push`
- **No clarifying gates** — autonomous execution
- DELETE old code, don't layer
- Stage 8 Control Gate is THE only gate

---

## State at HEAD (`3d3dd77`, pushed)

- **Tests: 664 passing, 0 failing, 0 skipped**
- Migration head: `b3d5f7a9c1e2` (live dev DB upgraded)
- Branch: `main` — clean working tree, HEAD == origin/main

### What landed this session

| Commit | Subject |
|---|---|
| `5435dac` | catalog: 71 entities expanded → 556 fields (avg 7.8/entity), full status flows |
| `a93baf7` | test data: `import_test_data.py` (1,150 Armenian records, 74 entities) + `seed_dashboard_data.py` |
| `fadb5a5` | test data: `seed_churn_data.py` — 37 churned subs, churn events per 7d/30d/QTD/YTD window |
| `5ea6fee` | **HomeView** (personal per-employee) split from **DashboardView** (company analytics) |
| `3d3dd77` | fix: --sp-* → px values; .view/.view-inner layout classes — panels no longer overlap |

---

## Current DB state (live dev)

| Table | Count |
|---|---|
| Records (74 entity types) | 1,150+ Armenian test records |
| Subscriptions | 108 total (71 active, 37 churned) |
| Invoices | 984 |
| Payments | 957 |
| Usage records | 441 |
| MRR | 745,400 AMD |
| Total collected | 4.5M+ AMD |

To re-seed a fresh DB:
```bash
.venv/Scripts/python.exe -m scripts.import_test_data
.venv/Scripts/python.exe -m scripts.seed_dashboard_data
.venv/Scripts/python.exe -m scripts.seed_churn_data
```

---

## Architecture split: Home vs Dashboard

| View | Route | What it shows |
|---|---|---|
| **HomeView** (`'home'`) | Workspace → Home | Personal: MY tasks, MY approvals, MY tickets, TODAY's schedule, MY activity |
| **DashboardView** (`'dashboards'`) | Analytics → Dashboards | Company: 7 chart types, MRR, AR aging, churn, sub mix, funnel — 7d/30d/QTD/YTD |

Both use `.view` + `.view-inner` layout classes. All spacing in hard px values (no `--sp-*` tokens).

---

## What's next (REMAINING-WORK.md status)

All R-01 → R-10 complete. P (payment gateways) complete to credential-slot level.

**Remaining open items (no code changes needed, just decisions or external gates):**

1. **Payment gateway credentials** — ARCA_MERCHANT + ARCA_PASSWORD from ACBA; IDRAM_MERCHANT_ID + IDRAM_SECRET_KEY from Unibank; TELCELL_MERCHANT + TELCELL_KEY from VivaCell-MTS; EasyPay docs from easypay.am
2. **Design reskin** — Gev said new design files coming → when they arrive, FULL DELETE old CSS + new design (feedback-design-full-delete.md in memory). Don't touch design until Gev says so.
3. **Wave 4 NOT NULL** — deferred until first real customer install gives live data
4. **3 deferred KPI formulas source data** — already have coverage_check + schedule_slot entities seeded; data needs to accumulate
5. **Studio builder depth** — `/api/studio/page-types`, `/api/studio/layout-blocks`, `/api/studio/components` endpoints (backend + Studio pane wiring)

---

## Stack-up commands

```powershell
docker start gaaex-db gaaex-redis
cd C:\Users\Admin\Desktop\Portal\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8099
```

Frontend (new shell):
```powershell
cd C:\Users\Admin\Desktop\Portal\frontend
npm run dev     # → http://localhost:5173
# login: admin@demo.isp / admin123
```

Tests:
```powershell
cd C:\Users\Admin\Desktop\Portal\backend
.venv\Scripts\python.exe -m pytest -q
```

---

— end handoff · HEAD 3d3dd77 · clean · Gev switching accounts now —
