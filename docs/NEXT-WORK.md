# GAAhex — Next-work queue

Parked items to pick up later (logged 2026-06-06, Gev's call).

## 1. Richer demo data
Fill the graceful-but-empty pages so the demo is fully alive:
- Move a few orders into the **provisioning** stage → Installation Board + Provisioning populate.
- Run the **dunning sweep** on the 4 overdue invoices → Collections shows active cases.
- Assign a few **tickets / work-orders to Demo Admin** → My Day "My Open Tickets" + "Open Work Orders" widgets show data (or make the owner widgets show ALL, not just assigned).
- (Optional) seed Campaigns, Customer Tasks if those pages are demo-targets.

## 2. Deploy prep — HouseNet on-prem
The big milestone. Server `gevorg@ghex` (Ubuntu 22.04, Docker installed).
- Clean export / clone the repo on the server (git creds already there).
- `backend/.env` provisioned with REAL strong secrets (NOT admin123; GAAHEX_FIELD_KEY set once + backed up — irrecoverable if lost).
- `ENVIRONMENT=production` (prod deploy contract: distinct `gaahex` / `gaahex_app` roles enforces RLS).
- `docker compose up`, `alembic upgrade head`, verify health.
- Demo-first: keep it private until ready to show HouseNet.

## 3. Token long-tail (low value)
The remaining D20 debt the deep audit flagged — deliberate, not rushed:
- Chart-height tokens (`--gx-chart-h-*`) + a chart/heatmap palette token set (DashboardView).
- `letterSpacing` / `lineHeight` inline literals → `--gx-tracking-*` / `--gx-leading-*` (imprecise mapping — needs an eye, changes typography subtly).
- Centralize duration/debounce/poll/dismiss magic numbers into a config constant.
- Auth/login brand-gradient hexes → minted gradient tokens.
Full inventory: `docs/audit/GAAhex-CODEBASE-DEEP-AUDIT-2026-06-06.md`.
