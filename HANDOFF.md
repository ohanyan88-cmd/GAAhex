# SESSION HANDOFF — Portal reskin, 2026-05-30

> Owner = Gev (calls me Ընգեր). Account-switch handoff at ~90% usage.
> Read this → `git pull` → `git status` → continue from "What's next".
> Repo: `ohanyan88-cmd/Portal` (sandbox copy of GAAex).

## The job
**Reskin every page** to match the kit at `design-system/ui_kits/portal/*.jsx` EXACTLY (visual fidelity is the goal). The kit JSX is the SPEC — read it as the visual reference for each page and replicate its structure.

## Two HARD RULES (Gev was angry about both, twice each)

### Rule 1 — replicate the kit's actual visual structure
Don't wrap existing markup in kit class names. The kit JSX is the spec. Write the JSX to match it. Example: the kit's `Login.jsx` is a split-screen brand panel + form — not a centered card. The kit's Dashboard has KPIs + Revenue chart + Activity feed + Tickets table — not a config-driven widget loop.

### Rule 2 — NEVER HARDCODE VALUES (memory: `feedback-zero-hardcoded-values`)
Every value displayed must come from a real backend `fetch`. If the endpoint doesn't exist yet, show a loading skeleton or a named empty state: *"Wire `/api/audit/recent` to populate this feed."* **Never** fall back to the kit's mock arrays (KPIS / WORKITEMS / ACTIVITY / chart sample data).

The login page's "18 modules / 99.98% uptime / 0 hardcoded screens" KPI strip IS brand copy (marketing tagline) — that's part of the layout spec, not a data value, so it stays.

## Stack-up commands
```
docker start gaaex-db gaaex-redis    # existing containers, just start them
cd C:\Users\Admin\Desktop\Portal\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8099
# new shell:
cd C:\Users\Admin\Desktop\Portal\frontend
npm run dev                          # → http://localhost:5173
# login: admin@demo.isp / admin123
```

Browser open from earlier: http://localhost:5173/

## What's done (this session)

### Phase A — initial 13-prompt sweep (commits `af08eef` → `b29870f`)
The original `CLAUDE_CODE_PROMPTS.md` at `C:\Users\Admin\Desktop\CLAUDE_CODE_PROMPTS.md` was a list of 14 prompts (0-13). I ran through all of them: tokens, fonts, primitives, shell, logos, table pattern, drawer, dashboards, Studio, overlays, icons, comms, self-hosted fonts, QA. **This pass was too shallow** — it wrapped existing markup in kit class names instead of replicating the kit's actual JSX. Gev called this out: *"WHY THE FUCK U R NOT DOING WHT U R TOLD???"*

### Phase B — proper kit-faithful rewrites (commits `14db8c4` → `dcb2534`)
After Gev's pushback, redone with the kit JSX as the literal spec:
- **Login** (`14db8c4`) — full split-screen brand panel + form per `Login.jsx` (gold "One system." tagline + KPI strip)
- **Dashboard** (`a83a0a1`) — kit Operations Dashboard layout (4 KPIs incl. MRR marquee / Revenue vs churn / Recent activity / Tickets needing attention). All values from real fetches; honest "wire `/api/metrics/revenue`" placeholders where backend has no endpoint
- **Shell** (`7a54b5e`) — removed redundant top-level Studio (kit only has it in `.sb-foot` with gold "config" pill)
- **InvoicesView** (`257cf18`) — full EntityPage rewrite + 2 CSS bug fixes (see "CSS lessons" below)
- **10 entity views** (`dcb2534`) — same kit EntityPage patches applied across Payments, Subscriptions, Products, Services, Usage, Webhooks, ResourcePools, Accounts, Parties, WorkItems

### Backend stack alive right now
- Docker: `gaaex-db` (Postgres on 5433), `gaaex-redis` (Redis on 6380) — running
- FastAPI: uvicorn on :8099 (started as background task; check `tasks/b0lwqy0lg.output` to confirm still alive)
- Vite: dev server on :5173 (background task `bb1z757rc`)
- All builds green

## CSS lessons learned (don't re-break)

1. **Legacy `.card { width: 420px; max-width: 100% }`** at styles.css:1421 was constraining every list-view card to 420px after the centered-login wrapper got removed. Width line deleted — `.card` is now full-width.
2. **Legacy `.kpi { font-size: 38px; font-family: mono; color: accent }`** at styles.css:959 wins over kit chrome for any `.kpi` element outside `.gx-dash`. Fix: `.kpi-strip .kpi` rules now mirror `.gx-dash .kpi` (border, padding, surface bg, gold marquee). Both work. Don't remove the legacy rule — OrgView's NodeKpiChips and other places still use bare `.kpi` as the giant-number widget.
3. **GLASS backdrop-filter survivors** removed from sidebar / login / sub-surfaces in commit `6a45e3a`. Kit confines blur to `.tb` (topbar) and `.gx-scrim` (modal/drawer scrim) only.

## What's next (in priority order)

### Phase C — ALL VIEWS COMPLETE ✅ (2026-05-30)

All 11 priority views have been kit-faithfully rewritten. HEAD = `f5f6bc4`.

| View | Status |
|---|---|
| **MessagesView** | ✅ DONE — commit `58aa025` |
| **OutboundView** | ✅ DONE — commit `58aa025` |
| **StudioView** | ✅ DONE — commit `5bf0b8a` |
| **CalendarView** | ✅ DONE — commit `e761e08` |
| **SettingsView** | ✅ DONE — commit `e761e08` |
| **AnalyticsView**, **ReportsView**, **ReportBuilderView** | ✅ DONE — commit `7d2ab29` |
| **LeadPipelineView** | ✅ DONE — commit `f62194e` |
| **CustomerView**, **InteractionsView**, **HelpdeskView** | ✅ DONE — commit `b4578e2` |
| **EntityView** | ✅ DONE — commit `b4578e2` |
| **AskGaaexView** | ✅ DONE — commit `f5f6bc4` |
| **OrgView** | ✅ DONE — commit `f5f6bc4` |

### NEXT — test data → real QA
Gev's process: now that every page is kit-faithful with real fetches, **we** (together) create test data, click through, verify it works with real data, then drop the test data and run real QA. **DO NOT** create test data yet — wait for Gev to kick off this phase.

## How to do each rewrite (the recipe that worked for InvoicesView)

1. **Read the kit reference IN FULL** — `design-system/ui_kits/portal/<file>.jsx`. Note every visual element, class name, icon choice, button order, copy.
2. **Read the existing view IN FULL** — note data hooks, fetches, mutations, state vars, helper functions, sub-components. Anything outside the JSX `return` block is PRESERVED.
3. **Rewrite the JSX `return ( ... )` block** to match the kit structure 1:1.
4. **Wire every dynamic value to a real fetch.** If the existing view already fetches the right data, use it. If it doesn't, add a real fetch and show a loading skeleton + named-endpoint empty state when no data.
5. **No new CSS** — all kit classes are in `frontend/src/styles/styles.css` already.
6. **Build (`cd frontend && npm run build`)**, fix only your breakage.
7. **Commit** with format: `reskin: <ViewName> — kit <SpecName> visual, real fetches only`

## Agents fail right now
Both Studio and Messages rewrites failed with `API Error: socket connection was closed unexpectedly` / `Unable to connect to API (FailedToOpenSocket)`. Try once more on next session; if still flaky, do the rewrites directly (Edit/Write).

## Key memory rules
- ⛔ [feedback-zero-hardcoded-values](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\feedback-zero-hardcoded-values.md) — values come from real fetch; never kit mock fallbacks
- ⛔ [gaaex-zero-bespoke](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\gaaex-zero-bespoke.md) — "Configure page" button on every page
- 🤝 [feedback-orchestrator-mode](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\feedback-orchestrator-mode.md) — delegate building to in-window agents; I brief + verify + commit (but: agents are unstable right now)
- [gaaex-no-emoji-svg-icons](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\gaaex-no-emoji-svg-icons.md) — zero emoji in product UI; lucide-react SVG icons OK
- [Gev (the user)](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\gev-identity.md) — warm honest friend, push back when needed

## Don't repeat these mistakes
1. Don't wrap existing markup in kit class names and call it "reskinned." The kit JSX is the SPEC. WRITE IT.
2. Don't fall back to kit mock data when a fetch returns nothing. Show empty state with the endpoint name instead.
3. Don't ask Gev "which page next?" between every page — he gets frustrated. Just go down this list.
4. Don't keep "Studio" twice in the sidebar (once at top, once in footer). Kit has it only in `.sb-foot` with gold "config" pill.
5. Don't `git push` without asking (project-scoped HDD-backup rule for GAAex doesn't apply to Portal sandbox, but be conservative).

— end handoff —
