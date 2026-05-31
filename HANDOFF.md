# SESSION HANDOFF — Portal SPEC kernel + polish, 2026-05-31

> Owner = Gev (calls me Ընգեր).
> Repo: `ohanyan88-cmd/Portal` — **THE ACTIVE PRODUCT** (not the GAAex repo).
> Read this → `git pull` → `git status` → continue from "What's next".

## Hard rules (load these into every session)
- **Portal-only** — NEVER touch `C:\Users\Admin\Desktop\GAAex`. All work here.
- **Orchestrator pushes** — agents commit locally; only main session runs `git push`.
- Metadata/config — no hardcoded enums; everything in `_def` tables.
- Real data only — missing → empty state, never fake.
- DELETE old code, don't layer.
- Stage 8 Control Gate is THE only gate; don't build a second.

---

## What's in Portal right now (current main)

### Kernel (full SPEC build)
- 6 kernel steps complete: `record_def`, `stage_def`, `kpi_def`, ownership matrix, statuses, permissions engine
- 7 SPEC §0 invariants enforced:
  - #1 single-owner — facade ready; first-class table coverage deferred
  - #2 default-deny — 4-layer `assert_can(Role × Dept × Region × Ownership)` operational, 18+ routers wired
  - #3 financial immutability — DB triggers on invoice/payment DELETE
  - #4 audit append-only — DB triggers on event UPDATE/DELETE
  - #5 references not copies — `assert_no_inline_master_copies` ready; full router wiring deferred
  - #6 region partition — schema present, full runtime guard deferred
  - #7 KPI uniqueness — UNIQUE constraint on kpi_def
- Stage 8 Control Gate enforced at orders advance
- §0.6 Region table + seed + API
- §4.5 Mandatory Approvals: scaffolding + 8 of 12 action paths wired (contract_change, payment_adjust, high_discount, customer_delete, role_perm_change, workflow_override, service_suspend, invoice_cancel)
- §5 Workflow Orchestration: universal contract + W1-W5 + engine
- §7 status seeds: Lead, Contract (Active/Terminated/Expired), Order (Cancelled), Payment (Chargeback)
- §8 Customer Timeline: append-only feed from audit events
- §9 KPI computation engine: formula_spec evaluator + /api/kpis + 4-6 seeded formulas
- §1 Nav Registry: 9 groups + 71 modules per tenant + frontend nav-loader

### Polish (Portal frontend)
- Workspace section ✅ (Activity Feed redesign with avatars + day grouping + humanized text)
- CRM section ✅ (13 pages, EntityView covers 8 in one file change, `.section-page` utility)
- Orders & Revenue ⚠️ (4 of 5 pages — Revenue Assurance pending)
- 5 cross-cutting design fixes ✅:
  1. Table header alignment (Tailwind `.grid` utility clash fixed)
  2. Responsive table overflow (RowActionsMenu ⋮ + min-width)
  3. Modal/drawer redesign (RecordDrawer for detail panes)
  4. KPI standardization (shared KPITile across 20 views)
  5. Activity Feed redesign (humanize.ts helpers)

### Studio Modules
- Module 1 Security (Roles/Permissions/Users) ✅
- Module 2 Data (Entities/Fields) ✅
- Module 3 Notifications (Email/SMS/Push/InApp Templates + Rules) ✅
- Module 4 Developer (Webhooks + API Docs) 🟡 in flight
- Module 5 System Control (Feature Flags + Audit + Health) ⏳ pending

---

## Migration chain (single head: `b9d1c2e3a4f5`)

```
Portal base → page_bindings (d3e4f5a6b7c8) → ... merge ...
            → SPEC kernel chain (c5e9a3b1d7f4 → ... → 19f9f4bd6599 + 7a4b1e9c2f08)
            → MERGE COMMIT b9d1c2e3a4f5
```

Alembic upgrade head runs clean on a fresh DB. Verified.

---

## In-flight (4 agents currently running, commit-only no-push)

1. **Step 7.2** — remaining ~17 routers wired with `assert_can`
2. **§4.4 ACTIVATE** — Fernet AEAD field encryption + webhook secret
3. **Portal Care section polish** — 9 pages
4. **Studio Module 4 Developer** — Webhooks + API Docs panes

When each lands: orchestrator reviews + pushes.

---

## What's next (after the 4 in-flight land)

| Pri | Task | Files |
|---|---|---|
| 1 | Studio Module 5 System Control (Feature Flags + Audit + Health) | `frontend/src/studio/` |
| 2 | Step 2 ACTIVATE — FK migration from relationship map | `backend/app/models/`, new alembic |
| 3 | First-class table owner gating (invoice/payment/service/product) | `backend/app/routers/` |
| 4 | Portal polish — Orders & Revenue final (Revenue Assurance) | `frontend/src/views/RevenueAssuranceView.tsx` |
| 5 | Portal polish — Network section (12 pages) | `frontend/src/views/` |
| 6 | Portal polish — Analytics (4 pages) + Enterprise (7 pages) + System (5 pages) + Studio | `frontend/src/views/` |
| 7 | Specialty modal migrations (deferred from RecordDrawer sweep) | `frontend/src/modals/` |
| 8 | Full test suite verification + Live DB migration with backup | ops |

---

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

For a fresh test DB:
```
docker exec -i gaaex-db psql -U gaaex -c "CREATE DATABASE portal_test;"
$env:DATABASE_URL="postgresql+asyncpg://gaaex:gaaex@localhost:5433/portal_test"
$env:OWNER_DATABASE_URL="postgresql+asyncpg://gaaex:gaaex@localhost:5433/portal_test"
cd backend
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8099
```

— end handoff —
