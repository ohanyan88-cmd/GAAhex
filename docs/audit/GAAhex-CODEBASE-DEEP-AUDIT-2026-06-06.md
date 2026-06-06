# GAAhex — Codebase Deep Audit (bugs · hardcodes · dead code)

**Date:** 2026-06-06 · **Scope:** entire repo (`backend/` + `frontend/src/`) · **Mode:** report-only (no fixes applied)
**Method:** 4 parallel auditors (backend · frontend-bugs · frontend-deadcode · frontend-hardcodes), each grep+read verified — no unverified guesses.

> Headline: the codebase is in good shape. The recent `record.entity_def_id` trigger drift is fixed (migration `f1a2b3c4d5e6`) and no other trigger/schema drift of that class exists. Most styling is already tokenized. The real, prioritized work is small and concrete — below.

---

## 🔴 Fix-first (highest impact)

| # | Where | What | Why it matters |
|---|-------|------|----------------|
| 1 | `backend/app/services/dunning.py:43, :302` | Walled-garden redirect hardcoded to `https://payment.example.com` (default policy **and** code fallback) | **Production customer impact** — a delinquent customer on the default dunning policy gets their browser redirected to a non-existent domain. Source from `settings.payment_callback_base_url` / tenant branding; refuse the action if no real URL. |
| 2 | `frontend/src/App.tsx:637` | HomeView lead/quote rows navigate with `slug: type` (always `'entity'`) instead of `slug: id` | Clicking a lead/quote on My Day lands on a broken/blank EntityView. One-line fix: `slug: id`. |
| 3 | `frontend/src/views/ComingSoonView.tsx:131` | `var(--gx-space-xl)` — token does not exist (spacing tokens are numeric) | Margin silently drops. Only broken `--gx-*` ref in the whole tree (cross-checked). Use `var(--gx-space-8)`. |
| 4 | `frontend/src/views/{Helpdesk,Orders,ResourcePools,Services}View` | Inline `zIndex: 9999` toast (×4) — above the entire `--gx-z-*` scale | D20 z-index violation; move to the existing `.gx-toast-host` class (uses `--gx-z-toast`). |

---

## Backend

### Bugs
- **[MED]** `services/dunning.py:302` — walled-garden fallback → `https://payment.example.com` (see #1).
- **[LOW]** `routers/report_schedules.py:369` — per-schedule `except Exception as e:` swallows error, never logs `e`. → `log.exception(e)`.
- **[LOW]** `middleware/idempotency.py:282-310` — vanished-row fallback can let a non-winner overwrite the winner's slot row (very narrow race). Gate the COMPLETED-write on `won_the_slot`.
- **[LOW]** `export_formats.py:237` — `offsets: list[int] = []` built/used nowhere in the hand-rolled PDF writer; verify the xref table uses real byte offsets or remove.

### Hardcodes
- **[MED]** `services/dunning.py:43, :302` — `payment.example.com` (see #1).
- **[LOW]** `routers/auth.py:203` (+ `seed.py:222`) — seeded `admin@demo.isp` / `admin123` string-compared in the must-change-password gate. Move the seeded-admin identity to a shared config constant so the two can't drift.
- **[INFO ✓OK]** `config.py:15,20,21` dev DB/Redis/JWT defaults are refused at prod boot by `_assert_production_deploy_contract`; AI provider URLs are legit defaults. No action.

### Dead code
- **[LOW]** `main.py:35,40` — unused seed imports (`seed_if_empty`, `seed_meta_if_empty`, `seed_access_if_empty`, `seed_demo_loop_if_empty`) never called in lifespan.
- **[LOW]** `services/dunning.py:291` `adapter_logger = adapter` never used; `routers/helpdesk.py:706` `old_agent` captured never read.
- **[LOW]** ~30 unused imports across `routers/{billing_invoice,billing_payment,credit_notes,documents,imports_exports,payment_gateway,payment_methods,portal_billing}.py`, `adapters/payment/arca.py`, `adapters/sms.py`, `services/privacy.py`, `routers/accounts.py`, `routers/calendar.py` — **all `ruff --fix` auto-removable (22 F401s)**.

### Verified NOT issues
- No trigger/schema drift beyond the already-fixed `spec6_check_polymorphic_record_kind`. All other trigger functions reference existing columns.
- `# noqa: tenant-filter` cross-tenant queries are on RLS-bound/owner sessions with caller-validated tenant — safe, not RLS holes.
- Auth tenant-claim re-validation, RLS GUC teardown, refresh-token family revoke, prod deploy contract — all sound.
- The `payment_gateway` / `sms_provider` / AI-provider duals are documented migration-window pairs, not dead code.

---

## Frontend

### Bugs
- **[HIGH]** `App.tsx:637` — lead/quote nav uses `slug: type` not `slug: id` (see #2).
- **[HIGH]** `ComingSoonView.tsx:131` — `--gx-space-xl` undefined (see #3).
- **[MED]** `ProductsView.tsx:122-126` — category chip filter reads `(p as any).category`, a field products never carry → any category except "All" renders empty. Acknowledged in-code as latent-until-backend-column. Hide/disable the chips until the column exists, or filter on a real field. *(In progress — flagged to Gev.)*
- **[LOW]** `lib/useFocusTrap.ts:11-50` — effect deps `[]` close over `onEscape`; stale-callback risk if a caller passes a changing identity (Overlay is stable today). Add `onEscape` to deps / ref it.
- **[LOW]** `lib/time.ts:7-9` — `timeAgo` returns 'just now' only for `<45s`; 45–59s renders "0m ago". Bump threshold to `<60`.
- *(Verified correct: useFetch, billing.ts, Toast, NotificationBell, Pagination, AuthContext, Overlay, validators, money, charts, i18n, 401 listener.)*

### Hardcodes (remaining — most already tokenized)
- **[HIGH]** `zIndex: 9999` toast ×4 (see #4).
- **[MED]** `styles/_auth.css:25,41` + `_login.css:6` — cobalt gradient stops as raw hex → tokenize (one stop is literally `--gx-bg`).
- **[MED]** `styles/_buttons.css:25,32,33` — `btn-accent`/`btn-danger` disabled+hover hexes off-token (need `--gx-danger-hover`, disabled tokens).
- **[MED]** `DashboardView.tsx` chart heights `160/140/180/120/110` (repeated) — mint a `--gx-chart-h-{sm,md,lg}` set (mirrors how `--gx-kpi-*` was done).
- **[MED]** `DashboardView.tsx:226,623,636,1181-1184` + `OrgView.tsx:1420-1421` — chart/heatmap palettes as raw hsl/rgba/hex; OrgView's are dark-theme-literal (wrong ramp in light theme). Need a chart sequential/heatmap token set or `getComputedStyle` resolution.
- **[LOW]** ~15 `#fff` literals in CSS partials (primitives/_typography/_tabs/_kanban/_auth/_comms…) — cosmetically correct but should be `var(--gx-on-primary)`.
- **[LOW]** high-frequency `letterSpacing` (0.4/0.5/0.06em) and `lineHeight` (1.4/1.5/1.6) numeric literals — `--gx-tracking-*` / `--gx-leading-*` tokens already exist; substitute.
- **[LOW]** scattered duration/debounce/poll/dismiss magic numbers (search-debounce 300/250, NotificationBell poll 60_000, toast dismiss 4000…) — centralize a config; `SystemHealthPane.REFRESH_MS` is the pattern to copy.
- **[✓ intentional — leave]** `CalendarView` swatches + `AppearancePane` presets (user-selectable palettes), `PaymentMethodsView` card-brand colors, OSM tile URLs, `lib/config.ts` env-driven API base, `example.com` placeholder URLs.
- **[product call]** `layout/master-layout.css` + `MasterLayoutDemoView.tsx` (~104 raw hex/px) — documented demo-only (T-P1-8), reachable via admin-gated "Master Layout Demo" nav. Delete the demo, or leave (only debt if it ships).

### Dead code
- **Unused whole files (delete, zero-risk):** `views/PageShellDemoView.tsx`, `views/CustomersListView.tsx` (+ its dead `App.tsx:30` import).
- **Pre-adoption scaffolds (product call — keep for roadmap or delete):** `lib/{metrics,action-menu,drawer-types,validators,errors,stripe,useFlag}.ts` — 0 references each.
- **7 unreachable view branches** in `App.tsx` — wired in the dispatch + `View` union but **no nav entry and nothing sets them**: `ask` (AskGaaexView), `global-search`, `recent-items`, `network-topology`, `scheduling`, `report-builder`, `parties`. Each has an orphaned backing view file. → **Decision needed: surface them in nav (they look like real features missing a nav entry) OR remove branch+view.**
- **~45 unused imports/locals** (tsc `--noUnusedLocals`), ~30 cleanly removable (App.tsx `CustomersListView`/`Wand`/type aliases; AccountsView/DashboardView/PipelineView/WorkItemsView/WebhooksView/PaymentsView/NetworkInventoryView/AnalyticsView unused icons+locals). ~13 are intentional shared prop-contract props (`canConfigure`/`onConfigure`/`onNavigate`) — keep or `_`-prefix.
- **5 orphan CSS classes** `_nms.css`: `.nms-dot-cyan`, `.nms-dot-gold`, `.nms-pill-gold`, `.nms-value-gold`, `.nms-value-sm` (no producer).
- **0 Interactions/Outbound remnants** — the earlier removal was clean.
- `lib/nav-loader.ts` (`loadDynamicNav`) is intentionally inert (documented OFF), not accidental dead code.

---

## Counts

| Area | Bugs | Hardcodes (actionable) | Dead code |
|------|------|------------------------|-----------|
| Backend | 4 (1 MED, 3 LOW) | 2 (1 MED, 1 LOW) | ~30 imports + 4 line-items |
| Frontend | 5 (2 HIGH, 1 MED, 2 LOW) | 1 HIGH, ~6 MED, long-tail LOW | 9 files + 7 dead routes + 45 imports + 5 CSS |

## Recommended order
1. The 4 fix-first items (dunning URL, App.tsx nav, `--gx-space-xl`, zIndex 9999).
2. Zero-risk dead-code: `ruff --fix` backend imports; delete PageShellDemoView + CustomersListView; remove the confirmed unused frontend imports; delete the 5 orphan `_nms` classes.
3. Product calls: the 7 unreachable views (nav vs delete), the 6 pre-adoption lib scaffolds, the Master Layout demo.
4. Token debt: chart-height + chart/heatmap palette token sets; auth/button gradient hexes; `#fff`→`--gx-on-primary`; letterSpacing/lineHeight; centralize durations.
</content>
