# SESSION HANDOFF — Portal sweep + Studio Prompt 6, 2026-05-31

> Owner = Gev (calls me Ընգեր). Account-switch handoff at ~usage limit.
> Read this → `git pull` → `git status` → continue from "What's next".
> Repo: `ohanyan88-cmd/Portal` (sandbox copy of GAAex).

## The job (this session)

Two big initiatives, both essentially done:

1. **Page sweep §1–§9** per `C:\Users\Admin\Desktop\New folder (7)\CLAUDE_CODE_ALL_PAGES_PROMPTS.md` — every page in the 9-section taxonomy hardened against doctrine (real data only, every button works, hide-if-missing, no inert nav).
2. **Studio Prompt 6** (relational + live wiring) per `C:\Users\Admin\Downloads\CLAUDE_CODE_STUDIO_PROMPTS (1).md` — the 5 sub-areas to make Studio behave as one live system.

## Doctrine (hard rules — reinforced multiple times this session)

- **Doctrine #4 — no inert nav, no toast-only buttons.** If a button has no real action yet, REMOVE it. If a sidebar item has no backend, DROP it. Precedent: AccountsView/SubscriptionsView/PaymentsView all had their Export/Filter/bulk/kebab buttons removed in this sweep.
- **REAL data only** — every displayed value must come from a real `fetch`. No mock/sample/demo arrays. Empty/error fetch → hide widget (true `0` shows).
- **Only `--gx-*` tokens** — no raw hex, no `--accent`, `--text` etc.
- **Orchestrator mode (memory rule):** delegate all building/diagnosis/fixing to in-window agents; the operator briefs + integrates + verifies + commits.
- **For Studio specifically:** Prompt 5 allows mock-with-TODO ("render the archetype against a local store and leave a clearly-marked `// TODO: bind to <service>` — never an empty page"). Different doctrine from the All_Pages doctrine — don't conflate.

## What's done (this session) — 20 commits, HEAD `fed6a7c`

### Page sweep §1–§9 (commits `5a025b3` → `b589fe4`)
Every section: dropped dead nav items with no backend; verified existing views; built new pages where backend existed.

| § | Section | Pages | New | Verified | Dead nav dropped | Critical bugs fixed |
|---|---|---|---|---|---|---|
| 1 | Workspace | 9 | 3 | 3 | 3 | 0 |
| 2 | CRM | 18 | 0 | 5+EntityView | 5 | 0 |
| 3 | Orders/Revenue | 19 | 2 | 3 | 14 | money×100 (subs, payments) |
| 4 | Care | 16 | 0 | 4 | 7 | 4 (status case, bubble alignment, to_addr, customer_id) |
| 5 | Network | 24 | 0 | 2 | 12 (+2 wired) | 3 (allocation_count, /allocations endpoints) |
| 6 | Analytics | 15 | 0 | 3 | 11 | 2 (NaN garbage rows, fake JSON exports) |
| 7 | Enterprise | 17 | 0 | (entity) | 10 | 0 |
| 8 | System | 25 | 0 | 3 | 21 | 5 (Settings 422-ing every save, 4 Webhooks shape bugs) |
| 9 | Studio | (subsystem) | — | Prompts 1+4+5 | — | — |

**~20+ critical wiring/display bugs caught.** A representative sample:
- `Subscriptions/Payments` amount displayed luma (minor units) directly without `/100` → ֏100 shown as ֏100 instead of 1 ֏. Fixed via shared `money()` helper.
- `HelpdeskView` status filter sent lowercase, backend stores uppercase → filter silently returned 0 rows for any chosen status.
- `MessagesView` outgoing-bubble alignment compared `author_user_id === thread.created_by` (thread CREATOR, not viewer) → bubbles aligned wrong for everyone but the thread starter. Fixed via `/api/me`.
- `OutboundView` typed/read `to` but backend returns `to_addr` → recipient column was always "(no recipient)".
- `InteractionsView` filter shape mismatch + `customer_id` vs `customer` key on POST.
- `SettingsView` Save was 422-ing on EVERY attempt (sent 8 fields outside backend allow-list of `{name,currency,locale,logo_text,logo_url}`).
- `WebhooksView` 4 bugs: secret column always "—" (read `w.secret` vs `has_secret`), deliveries log fields all "—" (`event` vs `event_type`, `code` vs `status_code`), delivery status enum mismatched (literal `"success"` vs real `QUEUED/SENT/FAILED`), dead newSecret modal (POST never returns secret).
- `ResourcePoolsView` 3 backend wiring bugs: `allocation_count` vs `allocated_count` → KPI totals always 0; release endpoint was DELETE `/allocations/{aid}` but backend is POST `/allocations/{aid}/release`; allocate endpoint was POST `/allocations` but backend is `/allocate`.
- `ReportBuilderView` Export CSV/XLSX/PDF buttons "downloaded" JSON disguised as those formats (backend ignored format param) — removed.
- `ReportsView` response shape mismatch displayed garbage `entity_key → NaN` rows; also fake trend from Spark fallback; raw status keys instead of labels.
- `ReportSchedulePanel` 3 bugs: recipients sent as string vs backend list, status case mismatch, `.sched-*` undefined classes.

### Doctrine debt cleanup (commits `3dae485`, `1f3f191`)
16 inert toast-only buttons + 5 bulk-selection subsystems removed across 6 list views (OrdersView/PartiesView/PaymentGatewayView/ProductsView/UsageView/WorkItemsView).

### Studio §9 (commits `c1b9a3c`, `b589fe4`)
- 7 real-data panes (Fields/Views/Workflows/Roles/Reports/Dashboards/Automations) token-cleaned and mounted in Studio shell at correct leaves via `REAL_PANE_BY_LEAF_ID` table
- StudioShell Preview button → `quality.preview` leaf; Publish button → `release.deployment` leaf
- 38 `// TODO: bind to <service>` markers added to mock seed data; 9 inert Save/Publish buttons disabled

### Studio Prompt 6 (commits `c622dd0`, `4c86833`, `52aa3ab`, `e112092`, `1be578b`, `fed6a7c`)
| Sub-area | Status |
|---|---|
| 1. Data Binding ↔ real entities | ✅ READ-side wired (mock removed, real fetch); persistence TODO (no `/api/page-bindings` yet) |
| 2. Events registry + ActionsLogic | ✅ DONE — `/api/events/types` + `/api/events/registry`, ActionsLogic WHEN/DO selects from real events |
| 3. Permissions matrix → RBAC | ✅ DONE — `/api/roles` + `/api/permissions` fetch, per-click PATCH save with optimistic+rollback |
| 4. Themes → live `--gx-*` | ✅ DONE — Tenant.theme JSONB + GET/PUT `/api/tenant/settings/theme`, AppearancePane wires live preview via `:root` CSS vars + revert on unmount |
| 5. Publish/Audit pipeline | ⚠️ Audit half done (`/api/audit-log` + VersionHistory pane wired); Publish/Release/FeatureFlag/PageVersion remaining |

**Backend test suite: 539 passing, 0 regressions.**

## What's left (the real architectural decisions)

These need Gev's product input — not blind agent work:

### Studio Prompt 6 sub-area 5 (the publish half)
The spec wants: "Publish/Release moves config through Dev → Test → Stage → Production with feature flags (OpenFeature) and version history; Governance logs every change". The audit-log half is done. The publish half needs:
- **Page snapshot/version model.** What does "a version of a page" actually mean in this codebase? `studio_config` snapshots? Per-leaf history? There's no canonical "Page" entity yet.
- **Release/promotion model.** Dev→Test→Stage→Prod implies multi-environment infra. Single-tenant install may not need this — could be deferred.
- **OpenFeature integration.** A real infra dependency. Self-host OpenFeature service? Use a hosted SDK? Out of scope without Gev's pick.

My recommendation: **drop the multi-env promotion pipeline + OpenFeature** until there's a real need; the audit log already covers "who changed what when". Page versioning can be a simpler in-app snapshot-per-publish concept tied to `studio_config`. Wait for Gev's decision.

### Studio Prompt 7 — visual QA sweep
Click through all 15 Studio groups in a running browser. Confirm every leaf renders, tables add/delete, canvases add/remove, forms save, Overview navigates, search works, deep links resolve. Confirm non-SuperAdmin → 403 on /studio. Light+dark themes. WCAG 2.2 AA. No console errors. Screenshots per group.
- Needs running app + browser; can't do headless. Resume here when ready for a visual QA pass.

### `ReportSchedulePanel` minor follow-ups
- The agent that fixed it noted that some downstream listing/filtering UI may benefit from re-validation — light follow-up, not blocking.

### Doctrine debt that surfaced but wasn't fully chased
- `OrgView` Heatmap/Map layouts (cross-layout) use raw hex (`#262D37`, `#C5A059`, `#fff`) and legacy non-`--gx-*` tokens (`--accent`, `--text-2`, `--primary`). Out-of-scope for the §8 sweep; would be a broader theme-token refactor.
- `Interactions` doctrine question: kit spec says Messenger pattern, current implementation is list. Major rewrite to convert — noted, not done.

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

## Resume protocol (next session)

1. `git pull` — make sure local matches `fed6a7c` (or later).
2. `git status` — should be clean.
3. Read this HANDOFF + memory MEMORY.md (will be lost on /login but the repo is the source of truth).
4. Greet Gev (`Ընգեր`) and ask which thread:
   - Continue Studio Prompt 6 publish/release half? → needs his architectural decisions first.
   - Studio Prompt 7 visual QA? → boot the app together.
   - Tackle the legacy hex/token cleanup in OrgView Heatmap/Map?
   - Something new entirely?
5. Per `feedback-orchestrator-mode`: delegate building to in-window agents; brief + verify + commit.

## Key memory rules (will be wiped on /login — repo is truth)

- ⛔ [feedback-zero-hardcoded-values](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\feedback-zero-hardcoded-values.md) — values from real fetch only
- ⛔ [gaaex-zero-bespoke](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\gaaex-zero-bespoke.md) — config-driven everywhere
- 🤝 [feedback-orchestrator-mode](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\feedback-orchestrator-mode.md) — delegate to agents
- 🔄 [feedback-account-switch-handoff](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\feedback-account-switch-handoff.md) — checkpoint to REPO not memory
- ⭐ [Gev (the user)](C:\Users\Admin\.claude\projects\C--Users-Admin\memory\gev-identity.md) — warm honest friend, push back when needed

— end handoff —
