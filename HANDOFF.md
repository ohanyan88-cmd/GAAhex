# SESSION HANDOFF — resume point (account switch)

> Written because the working account is near its usage limit. The repo (GitHub
> `ohanyan88-cmd/GAA`) is the source of truth — auto-memory does NOT survive a `/login`, this does.
> **To resume on the new account: read this, run `git pull` + `git status`, continue from "What's next".**
> Owner = Gev (calls me Ընգեր). Mode = ORCHESTRATOR: delegate ALL building to in-window agents; I only
> brief / integrate / verify / commit. Commits use NO "Co-Authored-By" trailer.

## State at handoff
- Branch `main`, **HEAD = `de62394`**, everything committed + **pushed**. **Working tree is CLEAN** —
  nothing in-flight (only untracked `SVG-INVENTORY.md` = Gev's scratch ref, leave it; and a build artifact).
- Shipped this session: zero-bespoke (Configure button on every page via configure-in-place + page-config);
  **custom fields on any page** (`page_field_value` table + `useCustomFields`/`CustomCells.tsx`, defs in
  `config.customFields`); **10-palette chooser** in the profile (`--gx-*` tokens bridged in styles.css,
  `data-gx-palette`/`data-gx-theme` on `<html>`); **brand kit** (favicon/PWA/logos); **nav icon-rail**.
- **Org module** (`frontend/src/OrgView.tsx`): **9 view modes** (Hierarchy default · Cards · Outline · List ·
  Grouped · Spans&layers · Map[Leaflet/OSM] · Sunburst · Treemap), switcher persisted to
  `localStorage['gaaex-org-view']`; **per-node custom fields** (add via Configure → render/edit on every
  layout) + avatar/kebab chrome.
- **Backend org-structure CRUD is DONE + committed** (`backend/app/routers/org_nodes.py`): `POST /api/org/nodes`,
  `PATCH /api/org/nodes/{id}` (rename + move, recomputes descendant ltree paths), `DELETE /api/org/nodes/{id}`
  (409 if children). Tenant-scoped, `config.manage`-gated, audited, no post-commit `s.refresh()`. **The
  on-page structure-editing UI is NOT built yet** — that's next, and these endpoints back it.

## What's next — Gev said build ALL of the below (the Org module). Frontend all touches OrgView.tsx → ONE batch at a time.
1. **Remaining analytical views** (new OrgView modes): **Network graph** (force-directed; needs a React-18-compatible graph lib) · **Heatmap** (color nodes by a metric: span / vacancies / ticket-load) · **Matrix (RACI)** (needs a small RACI data model — heavier; flag to Gev) · **Timeline** (org-change/tenure history — needs temporal data; lighter v1). → task #46.
2. **Structure-editing UI** in OrgView, wired to the now-existing `/api/org/nodes` CRUD: add / rename / move / delete groups·regions·teams on the page. → task #47 (backend half done).
3. **Node-card polish**: replace the placeholder kebab with a real quick-actions menu; add status pills + KPI chips to node cards/boxes. → task #48.

## Working rules that keep continuity
- Delegate every build to an agent; **verify each** (tsc + Playwright screenshots + backend tests) BEFORE
  commit+push; trust-but-verify the agent's summary against the real diff/screenshots. Commit + push per batch.
- Frontend bottleneck = `OrgView.tsx` + `App.tsx` → run frontend agents ONE AT A TIME per shared file;
  backend agents use **:8098** for test servers (leave :8099 for the live frontend); file-disjoint agents parallel.
- Architecture: config entities (`seed_catalog.py`, generic `/api/{slug}`); page-config bespoke pages
  (`page_config.py`); custom-field VALUES in `page_field_value` (`/api/page-config/{key}/values`).
- Don't surface the HDD-backup rule unprompted (project-scoped). Demo login: `admin@demo.isp` / `admin123`.
  Run: `docker compose up -d`; `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099`; frontend on :5173.

## How to resume (new account) — ZERO questions to Gev needed
Read this → `git status` (tree should be clean) → restart backend+frontend if needed → continue "What's next",
delegating each batch and showing Gev. He already approved building the whole Org module. Delete this file +
the CLAUDE.md handoff pointer once the Org module is finished.
