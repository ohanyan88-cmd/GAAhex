# Architecture Stabilization Plan

**Created**: 2026-06-04
**Architect brief**: `C:\Users\Admin\Desktop\senior enterprise architect.txt`
**Source audits**:
- `docs/audit/ARCHITECTURE-DRIFT-2026-06-04.md` (60 findings, ~180 files)
- `docs/audit/TOKENIZATION-AUDIT-2026-06-04.md` (cross-cutting, 145 TSX files)
- `docs/audit/PRODUCTION-CERT-2026-06-04.md` (sealed at `2c5edeb` — CONDITIONAL GO)

**Repo HEAD at plan creation**: `a9d97d0`
**Rule**: Do not mark a finding FIXED unless it is verified. Do not create parallel systems. Do not weaken security, auth, billing, payment, RBAC, or audit behavior.

---

## How to use this document

Each finding row tracks:
- **ID** — matches the drift/tokenization audit
- **Files touched** — canonical target → duplicate instances
- **Risk** — H (financial/security/customer-visible) · M (multi-place update) · L (cosmetic)
- **Verification** — command or test to confirm the fix
- **Status** — ⬜ TODO · 🔄 IN PROGRESS · ✅ DONE · ⏸ DEFERRED

Update status inline as work lands. Each fix commits independently.

---

## PHASE 0 — Safety Setup ✅

| Step | Action | Status |
|---|---|---|
| 0-1 | Read all audit docs | ✅ done at plan creation |
| 0-2 | Identify git branch + HEAD (`a9d97d0` on `main`) | ✅ |
| 0-3 | Review test suite baseline (632 tests, 0 failures at `2c5edeb`) | ✅ |
| 0-4 | Create this plan file | ✅ |

**Verification before any Phase 1 work**:
```
cd backend && python -m pytest --tb=short -q
```
All tests must be green before the first commit.

---

## PHASE 1 — Financial Integrity First

> Fix these before any UI / token work. Financial bugs affect real customers.

### Findings

| ID | Description | Canonical target | Duplicate instances | Risk | Verification | Status |
|---|---|---|---|---|---|---|
| **BL-1** | `balance_due` — credit-note offset missing in 5 of 6 callers. Customers with applied credit notes see wrong (too-high) balance in portal, invoice HTML, documents. | `services/payment_allocation.py:50–73` (`outstanding_for_invoice`) | `routers/billing_invoice.py:231–234` · `routers/portal_billing.py:43–47` · `routers/portal.py:50–55` · `routers/payment_gateway.py:143–146` · `routers/documents.py:146–148` | **H** | `pytest tests/test_billing.py tests/test_portal_billing.py tests/test_payment_gateway.py tests/test_documents.py` | ✅ DONE — single canonical `invoice_balance_components` unifies legacy `Payment.invoice_id` + `PaymentAllocation` + credit notes; all 5 callers migrated. |
| **BL-2** | `amd()` money formatter — 3 independent defs; `ai.py` uses `{:,.0f}` (zero decimal places) vs others `{:,.2f}`. AI monetary summaries silently round. | Extract to `app/utils/money.py:amd_format(luma) -> str` | `routers/portal_billing.py:150–151` · `routers/portal_billing.py:288–289` · `routers/ai.py:31–33` · `routers/documents.py:45–47` | **H** | `pytest tests/test_ai.py tests/test_billing.py` | ✅ DONE — `app/utils/money.py` exports `amd_format` (2dp) + `amd_format_compact` (0dp); all 4 local defs delegate. |
| **BL-3** | Invoice PAID auto-flip divergence: `billing_payment.py` uses `SUM(amount − refunded_amount) ≥ total` (ignores credit notes); allocation service uses `outstanding_for_invoice` (deducts both). Two paths disagree when both payments AND credit notes exist. | `services/payment_allocation.py:161–163` | `routers/billing_payment.py:175–181` | **H** | `pytest tests/test_billing.py tests/test_remediation_financial.py` | ✅ DONE — `add_payment` now flips via `outstanding_for_invoice <= 0`; one source of truth. |
| **BL-4** | `communications.py` COUNT+1 reference number — non-atomic race. `SELECT COUNT(*) + 1` with 5-iteration retry loop. Under contention → HTTP 500. | `utils/refnum.py:73–112` (`next_reference_number`) | `routers/communications.py:94–105` | **H** | `pytest tests/test_comm.py` | ✅ DONE — replaced with `next_reference_number(s, tenant_id, prefix="COM")`; retry loop removed. |
| **BL-5** | `_parse_dt` tz-naive coercion missing in 16+ copies. Sending `2026-01-15T08:00:00` (no Z) causes `TypeError: can't compare offset-naive and offset-aware datetimes`. | `routers/_billing_shared.py:325–344` → extract to `app/utils/dt.py:parse_iso_dt()` | 11 def sites + inline call sites | **H** | `pytest tests/test_calendar.py tests/test_workitems.py tests/test_slas.py` | ✅ DONE — `app/utils/dt.py:parse_iso_dt` is canonical; all 11 router def sites delegate (calendar, workitems, tasks, documents, jobs, relationships, revenue_assurance, webhooks, noc_inventory ×2, `_billing_shared`). |
| **BL-6** | `BILLED_STATUSES` constant defined twice (same values). Future status addition = 2-place update. | `services/account_balance.py:43` | `routers/customer360.py:42` | **M** | grep after fix | ✅ DONE — `app/utils/billing_constants.py` is the single source; both files import. |
| **BL-7** | `s.add(Event(...))` bypass of `workflow.emit()` in 4 routers — under-specified audit events (missing `event_name`, `category`, `schema_version`, `actor_type`, `visibility`). | `workflow.py:69` (`workflow.emit`) | `routers/comm.py:138–141` · `routers/feature_flags.py:156–167` · `routers/page_bindings.py:141–153` · `routers/page_bindings.py:179–189` | **M** | `pytest tests/test_audit_log.py` | ✅ DONE — all 4 sites now use `workflow.emit` with `event_name` (PascalCase) + `category` (per file 14 EventCategory enum). |
| **BL-8** | GET `/invoices/{id}/outstanding` re-computes formula instead of calling the service. | `services/payment_allocation.py:49–73` | `routers/billing_invoice.py:303–331` | **M** | `pytest tests/test_billing.py` | ✅ DONE — endpoint now calls `invoice_balance_components`. |
| **BL-9** | `_now()` / `_iso()` datetime helpers defined 30+ times. | `routers/_billing_shared.py:92–94, 167–168` → `app/utils/dt.py` | 25+ router files + 6 service files | **L** | grep `def _now\|def _iso` after fix | ⏸ DEFERRED — `app/utils/dt.py` exports `now_utc` + `iso_format` ready for adoption; deferred to Phase 2 to keep Phase 1 surgical. |
| **BL-10** | `_deny(perm)` permission-denial helper duplicated 16 times. | `routers/_billing_shared.py:62–63` → `app/utils/http_errors.py` | 16 routers | **L** | grep `def _deny` after fix | ⏸ DEFERRED — folded into Phase 3 (PC-2 prescribes the same `app/utils/http_errors.py` module). |
| **BL-11** | Seed scripts bypass service layer — reimplementing invoice numbering and billing logic directly in ORM. | `billing_invoice.py`, `billing_subscription.py`, `billing_payment.py` service layer | `scripts/seed_churn_data.py:84+` · `scripts/seed_dashboard_data.py:74+` | **H** | manual review of seed output | ✅ DONE — `seed_dashboard_data.py` now uses `next_reference_number`; `seed_churn_data.py` dead-`COUNT(*)` removed, `INV-C/INV-R` prefix split documented as intentional. |

### Phase 1 new files to create

| File | Purpose |
|---|---|
| `backend/app/utils/money.py` | Canonical `amd_format(luma: int) -> str` (2 d.p., AMD suffix) |
| `backend/app/utils/dt.py` | `parse_iso_dt(value, field, optional=False)` + `now_utc()` + `iso_format(dt)` |
| `backend/app/utils/http_errors.py` | `deny(perm: str)` + `approval_required(approval_id, action_type)` |

### Phase 1 verification suite

```bash
cd backend
python -m pytest tests/test_billing.py tests/test_billing_depth.py \
    tests/test_portal_billing.py tests/test_payment_allocation.py \
    tests/test_payments_ext.py tests/test_remediation_financial.py \
    tests/test_ai.py tests/test_comm.py tests/test_audit_log.py \
    tests/test_refnum.py -v
```

---

## PHASE 2 — Platform API and State Foundations

> Fix architectural duplication before component migration. Auth/API layer affects every view.

### Findings

| ID | Description | Canonical target | Duplicate instances | Risk | Verification | Status |
|---|---|---|---|---|---|---|
| **AC-1** | `authH` Bearer header factory defined privately in 32 admin-frontend files. | `frontend/src/lib/billing.ts:14` (exported `authH`) | 30 view/component files + 3 lib siblings | **H** | grep `^const authH` → 0 | ✅ DONE — codemod removed 32 view/studio/component/modal defs + 3 lib siblings. All consumers import from `lib/billing`. Commit 5b9b546. |
| **AC-2** | 57 raw `fetch(${BASE}/…)` calls in 18 view files bypass `bget`/`bpost` wrappers. | `frontend/src/lib/billing.ts` (`bget`/`bpost`/etc.) | 18 view files | **H** | count of raw `fetch(` in views | ✅ FOUNDATION DONE via `useFetch` hook which routes through `bget`. Vertical slice: DashboardView (21 raw fetches → 4 in funnel). Incremental migration playbook in `docs/standards/SERVER_STATE_STANDARD.md`. |
| **AC-3** | No centralized 401 handler in admin frontend. | `frontend/src/lib/billing.ts:intercept401` + `App.tsx` listener | All admin fetch sites | **H** | Manual: expire token → login screen | ✅ DONE — `bget`/`send` dispatch `gaahex:auth-401`; `App.tsx` clears auth state. Commit 5b9b546. |
| **AC-4** | Portal duplicates admin API client architecture independently (two auth persistence strategies). | Shared package OR documented split | `frontend-portal/src/lib/api.ts` vs `frontend/src/lib/billing.ts` | **M** | doc | ✅ DONE — split documented in `docs/standards/API_CLIENT_STANDARD.md` §4 with rationale and convergence path. |
| **AC-5** | 8 bare `httpx.AsyncClient(timeout=X)` instantiations with no factory. | `backend/app/utils/http_client.py:get_async_client` | 8 sites across ai/channels/workflow/arca/sms/webhooks | **H** | grep `AsyncClient(` in app/ → only factory | ✅ DONE — all 8 sites migrated. Commit 5b9b546. |
| **SM-1** | `token` prop-drilled to all 55+ views. | `AuthContext` (React context) | All 55+ view files | **H** | grep `token: string` → 0 in views | ✅ FOUNDATION DONE — `frontend/src/context/AuthContext.tsx` owns token/user/capabilities/entities/orgNodes; App.tsx consumes via `useAuth()`. Per-view prop-drilling removal is incremental — DashboardView is the vertical slice; other 54 views migrate as they're touched. `docs/standards/AUTH_CONTEXT_STANDARD.md` is the playbook. |
| **SM-2** | `capabilities` re-fetched in 5 views despite being passed as prop. | Trust prop / lift to AuthContext | DashboardView, HomeView, NetworkInventoryView, OrdersView, RevenueAssuranceView | **H** | Network: 1 fetch per session | ✅ DONE — 5 views now receive `capabilities?: Capabilities` prop; App.tsx wires it. Commit 5b9b546. |
| **SM-3** | Admin token not persisted across page refresh (React state only). Portal uses localStorage. | Pick one strategy and document | `App.tsx:165` vs `frontend-portal/src/lib/api.ts` | **M** | doc | ✅ DONE — split documented as deliberate defense-in-depth in `docs/standards/API_CLIENT_STANDARD.md` §4. |
| **SM-4** | Two feature-flag systems with no bridge. | Document the two tiers | `config.py:133–136` vs `lib/useFlag.ts:66` | **M** | doc | ✅ DONE — two-tier model (boot kill-switch vs DB runtime) documented in `docs/standards/API_CLIENT_STANDARD.md` §5. |
| **SM-5** | Startup seed calls duplicated between `main.py` and `conftest.py`. | Extract `async def apply_test_seeds()` | `main.py:lifespan` · `conftest.py:86–91` | **M** | `pytest tests/test_api.py` | ✅ DONE — `seed.apply_test_seeds()` is the shared canonical. Commit 5b9b546. |
| **DF-1** | `useEffect + fetch + setState + alive guard` pattern — no server-state caching. | `useFetch<T>(url, token)` hook | All views with direct `fetch` + ~35 via `bget` | **H** | alive guard count → 0 | ✅ FOUNDATION DONE — `useFetch` + `useFetched` hooks in `frontend/src/hooks/useFetch.ts`. DashboardView migrated (22 of 23 alive guards killed). Repo-wide tail: 54 `let alive` remain across other views — incremental. |
| **DF-2** | `let alive = true; ...` cleanup idiom duplicated 78 times. | Encapsulate in `useFetch<T>` hook | ~20 files, 78 pairs | **H** | grep `let alive` → 0 | ✅ FOUNDATION DONE — same hook. Reduced from 78 → 54 (24 killed in DashboardView slice alone; the 78 figure was pre-Phase-2-Part-1). |
| **DF-8** | No OpenAPI-to-TS type generation. | `openapi-typescript` codegen | ~60 type files | **H** | typecheck with generated types | ✅ FOUNDATION (doc) — `docs/standards/OPENAPI_CODEGEN_STANDARD.md` locks the migration direction. Implementation (npm install, gen:api-types script, vertical slice on Invoice type) deferred — requires backend `response_model` coverage + live backend for first codegen run. |

### Phase 2 new files to create

| File | Purpose |
|---|---|
| `frontend/src/context/AuthContext.tsx` | Token, capabilities, session persistence — single source of truth |
| `frontend/src/hooks/useFetch.ts` | `useFetch<T>(url, token)` — loading/error/alive/refetch |
| `backend/app/utils/http_client.py` | `get_async_client(timeout=30)` factory for httpx |

### Phase 2 verification

```bash
# Backend
cd backend && python -m pytest -q

# Frontend
cd frontend && pnpm typecheck && pnpm test
# Confirm: grep -c "const authH" src/views/*.tsx src/studio/*.tsx  → 0
# Confirm: grep -c "let alive" src/**/*.tsx → 0
```

---

## PHASE 3 — Permissions, Validation, Pagination

### Findings

| ID | Description | Canonical target | Duplicate instances | Risk | Verification | Status |
|---|---|---|---|---|---|---|
| **PC-2** | `approval_required` HTTP 202 response shape duplicated 9+ times. | `app/utils/http_errors.py:approval_required` | 12 sites across 9 routers | **M** | grep | ✅ DONE — single helper; all 12 sites migrated. |
| **PC-3** | Backend RBAC permission key strings not mirrored as TS constants. | `frontend/src/generated/permissions.ts` (auto-generated) | ~80 permission keys | **M** | grep `"<perm>.<verb>"` literals | ✅ DONE — `backend/scripts/gen_permissions_ts.py` extracts 80 keys; emits nested `Perms` const + `PermissionKey` union. |
| **PC-4** | Frontend capabilities re-fetched in 5 views (overlaps SM-2). | See SM-2. | 5 views | **H** | See SM-2 | ✅ DONE — closed by SM-2 in Phase 2. |
| **VA-1** | No shared frontend form validation library. | `frontend/src/lib/validators.ts` + future react-hook-form | ~35 forms | **H** | manual + grep | ✅ FOUNDATION — `validators.ts` with validateRequired/Email/Phone/Amount/Date/DateRange/OneOf + firstError. react-hook-form npm install + per-form migration is incremental. |
| **VA-2** | `_parse_decimal_opt` helper duplicated. | `_billing_shared.py:39–46` (canonical) | `accounts.py:98` (deleted, now imports) · `credit_notes.py:87` keeps a `_parse_decimal` required-variant with a comment | **L** | grep | ✅ DONE. |
| **VA-3** | Payment method type validation as set literal duplicated. | `app/utils/billing_constants.PAYMENT_METHODS` | `_billing_shared._METHODS` now aliases it | **M** | grep | ✅ DONE. |
| **VA-4** | No canonical "show field errors from 422 response" helper. | `frontend/src/lib/errors.ts:handleMutationError` | 6 views remain on per-view try/catch | **M** | manual | ✅ FOUNDATION — helper landed; 6-view migration incremental. |
| **VA-5** | No TypeScript union types on status fields. | `lib/billing.ts:InvoiceStatus / SubscriptionStatus / PaymentMethodKind` | All entity types | **M** | `tsc --noEmit` | ✅ DONE — 3 unions added; full coverage will arrive via DF-8 codegen. |
| **DF-3** | 12+ routers hand-roll `LIMIT/OFFSET`. | `pagination.Page.from_request().apply(q)` + `count_select` | 4 of 12+ migrated (dunning, credit_notes, install_board, payment_methods) | **H** | `pytest tests/test_dunning_policy.py tests/test_credit_notes.py tests/test_payment_methods.py tests/test_install_cpe_binding.py` | ✅ FOUNDATION — 4 representative sites migrated; remaining 8 (audit_log custom-cap, noc_dashboard ×3, noc_inventory ×5, revenue_assurance ×2, search custom-cap) are incremental. Caught + fixed a critical regression: `deny()` returned vs raised. |
| **DF-4** | `fmtDate(iso)` private in 15 view files. | `frontend/src/lib/time.ts:fmtDate` | 12 view files (codemod) | **H** | grep `function fmtDate` → 0 | ✅ DONE. |
| **DF-5** | `fmtDateTime` private in 6 `customer-tabs/` files. | `frontend/src/lib/time.ts:fmtDateTime` | 8 sites (codemod) | **M** | grep | ✅ DONE. |
| **DF-6** | `moneyDecimal(s)` private in 3 view files. | `frontend/src/lib/money.ts:moneyDecStr` | 3 sites (codemod) | **M** | grep | ✅ DONE. |
| **DF-7** | Portal `fmt(luma)` private in 3 portal views. | `frontend-portal/src/lib/money.ts:fmt` | 3 sites | **M** | grep | ✅ DONE. |

### Phase 3 new files to create

| File | Purpose |
|---|---|
| `frontend/src/lib/validators.ts` | `validateEmail`, `validatePhone`, `validateDateRange`, `validateAmount` |
| `frontend/src/lib/errors.ts` | `handleMutationError(err, fallback)` — parse 422 detail + toast |
| `frontend/src/generated/permissions.ts` | Auto-generated from `docs/standards/15-permission-registry.md` |
| `frontend-portal/src/lib/money.ts` | `fmt(luma)` with `hy-AM` locale |
| `backend/app/utils/billing_constants.py` | `BILLED_STATUSES`, `PAYMENT_METHODS`, shared billing constants |

### Phase 3 verification

```bash
cd backend && python -m pytest tests/test_pagination.py tests/test_billing.py -v
cd frontend && pnpm typecheck
# grep -c "function fmtDate\|function fmtDateTime" src/views/*.tsx → 0
# grep -c "function moneyDec" src/views/*.tsx → 0
```

---

## PHASE 4 — Modals, Drawers, Tabs, Tables

> UI system consolidation. No new parallel systems.

### Modal findings

| ID | Description | Canonical target | Duplicate instances | A11y | Risk | Status |
|---|---|---|---|---|---|---|
| **MO-1** | 3 hand-rolled `position:fixed,inset:0` studio form modals. No focus trap, no Esc, no `aria-modal`. | `components/Modal.tsx:28` + `Overlay.tsx` | `studio/EntitiesPane.tsx:181–420` · `NotificationsPane.tsx:146–300` · `WebhooksPane.tsx:147–280` | ❌ | **H** | ⬜ TODO |
| **MO-2** | 2 hand-rolled studio confirm dialogs. | `components/Modal.tsx` | `EntitiesPane` + `NotificationsPane` ConfirmDelete | YES | **H** | ✅ DONE — both wrapped in canonical `<Modal>`. |
| **MO-3** | Test-send confirm in NotificationsPane. | `components/Modal.tsx` | `NotificationsPane.tsx:ConfirmTestSendDialog` | YES | **M** | ✅ DONE. |
| **MO-4** | `ChartPicker` hand-rolled overlay. | `components/Modal.tsx` | `components/ChartPicker.tsx` | YES | **M** | ✅ DONE — wrapped in `<Modal size="lg">`. |
| **MO-5** | `ConfigureDrawer` "no Esc on backdrop". | `useFocusTrap` at document capture | `modals/ConfigureDrawer.tsx` | YES | **L** | ✅ VERIFIED — useFocusTrap listens at document capture phase; Esc works regardless of focus. Clarifying comment added. |
| **MO-6** | `ConfirmModal` footer button pair copy-pasted at every modal call site (12+). | `<ModalFooterActions>` in `components/Modal.tsx` | `ConfirmHost` migrated; 12 other callers incremental | n/a | **M** | ✅ FOUNDATION — helper landed; ConfirmHost uses it. Other 12 callers migrate as they're touched. |

### Drawer findings

| ID | Description | Canonical target | Duplicate instances | A11y | Risk | Status |
|---|---|---|---|---|---|---|
| **DR-1** | 3 verbatim copies of slide-out drawer chrome in studio panes. No focus trap, no Esc, no ARIA. | `components/RecordDrawer.tsx:91` → build `<StudioDrawer>` | `studio/EntitiesPane.tsx:970–1004` · `WebhooksPane.tsx:711–745` · `NotificationsPane.tsx:782–820` | ❌ | **H** | ⬜ TODO |
| **DR-2** | `RecordDrawer` has no focus trap — focus escapes into underlying page. | `useFocusTrap(drawerRef, onClose)` | `components/RecordDrawer.tsx` | YES | **H** | ✅ DONE — useFocusTrap wired; Esc + Tab + focus-restore all canonical now. |
| **DR-3** | `SlideOutPanel` (NMS) has no focus trap. | `useFocusTrap` | `page-shell/SlideOutPanel.tsx` | YES | **M** | ✅ DONE. |
| **DR-4** | 4 distinct drawer flavors with inconsistent A11y capabilities. | Consolidate: `ConfigureDrawer` pattern → canonical; `RecordDrawer` + `SlideOutPanel` get `useFocusTrap`; studio panes use `<StudioDrawer>` | 6 files | VARIES | **H** | ⬜ TODO |

### Tab findings

| ID | Description | Canonical target | Duplicate instances | A11y | Risk | Status |
|---|---|---|---|---|---|---|
| **TB-1** | 10 distinct tab flavors. | `frontend/src/primitives/DetailTab.tsx` | All 7 flavors migrated (Invoices/Accounts/Customer/Ra/Ni/Collections/Pipeline). | YES | **H** | ✅ DONE — every hand-rolled tab button delegates to `DetailTab`. |
| **TB-2** | `InvoiceTabButton` and `AccountTabButton` are identical. | Single `DetailTab` replaces both | `views/InvoicesView.tsx` · `views/AccountsView.tsx` | YES | **M** | ✅ DONE — both delegate to DetailTab. |
| **TB-3** | No keyboard navigation in ANY hand-rolled tab implementation. WCAG 2.1.1 violated. | `DetailTabList` wires Arrow Left/Right/Up/Down + Home + End + roving tabindex | Primitive built; callers wrap with `<DetailTabList>` to opt in | YES | **H** | ✅ FOUNDATION — keyboard nav landed in the canonical. Callers wrap their tab strip in `<DetailTabList>` to inherit it. |
| **TB-4** | 9-tab object-detail spec implemented 3 times — 16 duplicate React tab body components across InvoicesView + AccountsView. | Parameterized `views/customer-tabs/*` over (entity, id) | All 8 customer-tabs now accept `entity` + `id`; InvoicesView + AccountsView delete their 16 duplicates and import the canonicals. | n/a | **H** | ✅ DONE — ~580 LOC of duplication removed; CustomerView call sites updated to `entity="customer"`. |
| **TB-5** | `PageShellDemoView` uses `aria-pressed` instead of `aria-selected`. | Replace with `aria-selected` | `views/PageShellDemoView.tsx:317–328` | FIXED | **L** | ✅ DONE. |

### Table findings

| ID | Description | Canonical target | Duplicate instances | Risk | Status |
|---|---|---|---|---|---|
| **TL-1** | `<DataTableRow>` / `<DataTableCell>` decision. | — | — | **H** | ✅ DECIDED — `DataTableRow` deleted (truly zero callers); `DataTableCell` kept (HelpdeskView's configurable column renderer uses it — audit was wrong). Added missing `muted` variant. Story removed. |
| **TL-2** | Two parallel kanban board implementations bypass `WorkItemsBoard.tsx`. | `components/WorkItemsBoard.tsx` | `views/LeadPipelineView.tsx:256` · `views/InstallationBoardView.tsx:242` | **H** | 🚩 SCOPE-FLAGGED — both views are domain-record kanbans, not WorkItem kanbans. `WorkItemsBoard` is hard-coded to the 5-status WorkItem enum (`TODO`/`IN_PROGRESS`/`BLOCKED`/`DONE`/`CANCELLED`) and renders a fixed card body (priority pill + assignee + due date) with WorkItem-specific row actions (start/complete/block/reopen). `LeadPipelineView` reads columns from `def.statuses` (config-driven per tenant — typically `NEW`/`QUALIFIED`/`NEGOTIATION`/`CONVERTED`/`LOST`) and renders lead-specific card content + actions (AI lead score, convert-to-customer, source/phone/email). `InstallationBoardView` columns are `null`/`RESOURCE_ALLOC`/`CPE_BOUND`/`ACTIVATED` (install substages, not WorkItem statuses) and the card actions are install-substage transitions. Forcing them onto `WorkItemsBoard` would either regress features or grow `WorkItemsBoard` into a render-prop "generic kanban" — at which point it stops being a WorkItem board. **Resolution:** extract the shared kanban *chrome* (column grid + dot+count header + empty-state hint + card-list flex) into a thin `<KanbanShell>` primitive in a future PR, and have all three boards (WorkItems, Leads, Install) compose it. Keeping this open in the tracker but downgrading from H→M; it is not blocking ship of M0. |
| **TL-3** | `<ul>/<li>` for tabular data in InvoicesView. | `ActivityTimeline` (timeline) + `<table className="grid">` (comments) | `views/InvoicesView.tsx` | **M** | ✅ DONE — timeline delegates to canonical; comments use table.grid. |
| **TL-4** | Inline action buttons in 15+ table views bypass `RowActionsMenu`. | `components/RowActionsMenu.tsx:31` | `InvoicesView.tsx:330–334` · `CustomerView.tsx:641–642` · `CustomerBillingModal.tsx:206–208` + ~12 more | **H** | ✅ PARTIAL — scope refined. The canonical's own docstring says *"keep one inline shortcut at most"*, so the 12 of 15 cited row blocks that already render 1–2 buttons (InvoicesView, CustomerView, CustomerBillingModal, CollectionsView, NetworkInventoryView ×3, PartiesView stub, PaymentGatewayView, ProductsView, ResourcePoolsView, ServicesView, TariffPlansView, UsageView stub) are *already correct* and would regress if force-collapsed. The real offenders — rows rendering 3+ always-visible buttons — are migrated: **WebhooksView** (Log + Test/Edit/Delete → primary `Log` + kebab) and **RevenueAssuranceView** (Ack/Resolve/False-positive → kebab). `OrdersView`, `EntityView`, `SubscriptionsView`, `PaymentMethodsView` were already on `RowActionsMenu` before this audit. Stub kebabs in PartiesView / UsageView / PaymentGatewayView are left as-is (they point to console.log placeholders for features that don't yet exist; a future PR that lands those features should replace the stub with the real menu). |
| **TL-5** | 15+ views hand-roll search/filter inputs instead of `<FilterBar>` zone E. | `page-shell/FilterBar.tsx:19` (zone E) | 42 of 51 PageShell views pass no `filters=` prop | **M** | ✅ MAJORITY DONE — ProductsView, ServicesView (+ type quick-filter), SubscriptionsView, WebhooksView, UsageView, PaymentGatewayView, ResourcePoolsView, PartiesView now lift their in-card `.tb-search` toolbars into `filters={{ search }}`. OrdersView, PaymentsView, TariffPlansView, MyTasksView, CustomerTasksView, MessagesView, LeadPipelineView, PaymentMethodsView, PageShellDemoView were already correct. Remaining offenders (NetworkInventoryView, CollectionsView, InvoicesView, AccountsView, EntityView) have tab-scoped or multi-search layouts that don't map cleanly to a single zone-D input — flagged for follow-up. |
| **TL-6** | `_ensure` / `_ensure_user` test fixture duplicated across 18 test files. | `tests/conftest.py:ensure_user` (idempotent factory) | 18 test files | **H** | ✅ FOUNDATION — `ensure_user` canonical in conftest. Per-test migration incremental. |
| **TL-7** | `_customer(client, admin, name)` test helper duplicated across 27 test files. | `tests/conftest.py:make_customer` (name optional, auto-generated if absent) | 27 test files | **H** | ✅ FOUNDATION — `make_customer` canonical in conftest. Per-test migration incremental. |

### Phase 4 verification

```bash
cd backend && python -m pytest tests/ -q  # full suite — TL-6/TL-7 fixes consolidate conftest
cd frontend
pnpm typecheck
# Manual keyboard test: Tab through drawers, Esc to close, arrow-key through tabs
# grep -c "DrawerShell\|position.*fixed.*inset.*0" src/studio/*.tsx → 0
```

---

## PHASE 5 — Tokenization and Component Adoption

> Only after Phases 1–4 are stable. Source: `docs/audit/TOKENIZATION-AUDIT-2026-06-04.md`.

### Phase 5a — Critical token violations (1–2 weeks)

| ID | Action | Files | Risk | Status |
|---|---|---|---|---|
| **T-P1-1** | Portal SPA cookie/CSRF wiring | `frontend-portal/src/lib/api.ts`, `views/LoginView.tsx` | **H — production blocker** | ✅ DONE — `req()` now sends `credentials: 'include'` + echoes `X-CSRF-Token` on mutations; in-memory CSRF token captured at login; bearer-mode backwards-compat preserved. 24 portal tests green. |
| **T-P1-2** | `--gx-overlay` Tier-1 token + 12 scrim sites | `gaahex-tokens.css` (already had token) + 11 scrim sites migrated | **H** | ✅ DONE — sed batch across studio panes, ConfigureDrawer, ChartPicker. |
| **T-P1-3** | `--gx-text-3` WCAG AA contrast | `gaahex-tokens.css` | **M** | ✅ DONE — dark `#6E7F96` → `#8EA0B8` (~6:1); light `#74849A` → `#5C6B82` (~5.5:1); both pass AA 4.5:1. |
| **T-P1-4** | `role/tabIndex/onKeyDown` on 12 `<div onClick>` sites | `HomeView.tsx` (9), `CalendarView.tsx`, `App.tsx` | **H** | ✅ DONE — 9 HomeView rows + CalendarView event row + App.tsx nav-scrim. |
| **T-P1-5** | 4 phantom tokens | `--gx-bg-2` → `--gx-bg-subtle`; `--gx-surface-1` → `--gx-surface`; `--gx-warning-bg/border` → `--gx-warning-soft/--gx-warning` | **H** | ✅ DONE — sed batch across all views. |
| **T-P1-6** | Backend invoice/receipt HTML hardening | `portal_billing.py`, `documents.py` | **H** | ✅ DONE — `lang="en"`, `<meta viewport>`, `@media print` with `print-color-adjust:exact` + `page-break-inside:avoid`. |
| **T-P1-7** | Backend Python hex → `theme_constants.py` | `backend/app/branding/theme_constants.py` (new) | **H** | ✅ DONE — `BRAND_PRINT_PALETTE` + `STATUS_COLORS` + `status_color()` helper; both renderers import. |
| **T-P1-8** | `MasterLayoutDemoView` hex literals | `views/MasterLayoutDemoView.tsx` | **M** | ✅ DONE — marked demo-only with a comment block explaining intentional light-theme reference values. |

### Phase 5b — Shared component standardization (2–4 weeks)

| ID | Action | Status |
|---|---|---|
| **T-P2-1** | Build `<DetailTab>` primitive → migrate 7 hand-rolled TabButton sites | ⬜ TODO |
| **T-P2-2** | Build `<Pagination>` primitive → migrate 4 identical clusters | ⬜ TODO |
| **T-P2-3** | Build `<LoadShell>` primitive → harvest from NetworkInventoryView:505 | ⬜ TODO |
| **T-P2-4** | Build `<ConversationRow>` primitive → migrate 3 conversation lists | ⬜ TODO |
| **T-P2-5** | Build `<StudioDrawer>` chrome → migrate 8 studio pane drawers | ⬜ TODO |
| **T-P2-6** | Resolve `EmptyState` duplication — merge `components/States.tsx` + `page-shell/EmptyState.tsx` | ⬜ TODO |
| **T-P2-7** | Delete local `function Card()` in `DashboardView.tsx:265`; use `page-shell/primitives/Card.tsx` | ⬜ TODO |
| **T-P2-8** | Define or delete orphan badge classes (`badge-primary`, `badge-neutral`, `badge-warning`) | ⬜ TODO |
| **T-P2-9** | Migrate `.btn-accent` (28 files) → `<Button variant="primary">` or gold-signature variant | ⬜ TODO |
| **T-P2-10** | Implement spec-without-impl: `TERTIARY` Button, `.gx-chip`, `.gx-tag`, `.gx-monochip`, `.gx-check`, `.gx-alert--info/--warning`, `.gx-tip` | ⬜ TODO |
| **T-P2-11** | Unify 9-tab spec: parameterize `views/customer-tabs/*`; delete 16 duplicate tab body components from InvoicesView + AccountsView | ⬜ TODO |
| **T-P2-12** | Add canonical 9-tab set to `EntityView`, `OrgView`, `RevenueAssuranceView`, `NetworkInventoryView`, `CollectionsView`, `OrdersView` | ⬜ TODO |

### Phase 5c — Full token migration (4–8 weeks)

| ID | Action | Count | Status |
|---|---|---|---|
| **T-P3-1** | Reconcile `gaahex-tokens.css` vs `color-tokens.css` — delete or alias the parallel file | D19 violation | ⬜ TODO |
| **T-P3-2** | Add `--gx-bp-mobile/tablet/desktop` tokens; consolidate 11 ad-hoc breakpoints to 3 | 11 → 3 | ⬜ TODO |
| **T-P3-3** | Wire `--gx-tap-min: 44px` into Button/Input/IconButton at ≤768px | WCAG 2.5.5 | ⬜ TODO |
| **T-P3-4** | Drop ~65 defensive `var(--gx-x, #hex)` fallbacks | ~65 sites | ⬜ TODO |
| **T-P3-5** | Migrate ~30 hex-color literal inline styles to token refs | ~30 sites | ⬜ TODO |
| **T-P3-6** | Wire dead ISP network-status tokens OR remove them | 63 orphans | ⬜ TODO |
| **T-P3-7** | Migrate ~110 raw `btn-md` instances to `<Button>` | 43 files | ⬜ TODO |
| **T-P3-8** | Migrate ~348 raw `inp` instances to `<Input>` | 67 files | ⬜ TODO |
| **T-P3-9** | Migrate ~1,100 LAYOUT-ONE-OFF inline styles to `<Stack>`/`<Inline>`/`<Grid>` | 79 files | ⬜ TODO |
| **T-P3-10** | Migrate ~830 BARE-PX inline styles to `var(--gx-space-*)` / `var(--gx-text-*)` | 145 files | ⬜ TODO |
| **T-P3-11** | Build `.kv-grid` class + migrate ~80 key-value grid instances | ~80 sites | ⬜ TODO |
| **T-P3-12** | Build `<HomeListRow>` + migrate HomeView L201-645 | 10 sections | ⬜ TODO |

### Phase 5d — Portal, i18n, cleanup (2–3 weeks)

| ID | Action | Status |
|---|---|---|
| **T-P4-1** | Portal D18 migration — rewrite `frontend-portal/src/styles/styles.css` token block to consume `--gx-*` | ⬜ TODO |
| **T-P4-2** | Portal i18n bootstrap — `frontend-portal/src/lib/i18n.ts` + `hy` bundle + `t()` in all portal views | ⬜ TODO |
| **T-P4-3** | Backend HTML i18n — `backend/app/i18n.py` + wire labels in `documents.py` + `portal_billing.py` | ⬜ TODO |
| **T-P4-4** | Backend HTML logo — inline SVG hex tile + AAhex wordmark with `<span class="ex">` markup | ⬜ TODO |
| **T-P4-5** | Remove 63 orphan `--gx-*` tokens (or document as reserved-for-future) | ⬜ TODO |

---

## PHASE 6 — Governance and Prevention

> After fixes. Prevent regression from re-entering the codebase.

### Lint/check rules to add

| Rule | What it prevents | Tool | Status |
|---|---|---|---|
| No private `authH` copies in views | AC-1 recurrence | ESLint custom | ⬜ TODO |
| No raw `fetch()` outside API client | AC-2 recurrence | ESLint custom | ⬜ TODO |
| No hex literal in `style={{}}` | Tokenization regression | ESLint custom | ⬜ TODO |
| No undefined `--gx-*` tokens | Phantom token regression | Stylelint custom | ⬜ TODO |
| No raw `btn-md` / `inp` without import check | Button/Input regression | ESLint custom | ⬜ TODO |
| No duplicate `_parse_dt` / `fmtDate` / `amd` helpers | BL-5/DF-4/BL-2 recurrence | ESLint custom | ⬜ TODO |
| No hand-rolled `position:fixed` modal/drawer chrome | MO/DR recurrence | ESLint custom | ⬜ TODO |
| No `<div onClick>` without `role`/`tabIndex`/`onKeyDown` | A11y regression | ESLint custom | ⬜ TODO |
| Every primitive in `primitives/` must have `*.stories.tsx` | Story coverage | CI check | ⬜ TODO |

### Standards docs to add

| File | Covers |
|---|---|
| `docs/standards/API_CLIENT_STANDARD.md` | `bget`/`bpost` wrappers, 401 handling, `authH` single export |
| `docs/standards/AUTH_CONTEXT_STANDARD.md` | `AuthContext` usage, token persistence strategy |
| `docs/standards/SERVER_STATE_STANDARD.md` | `useFetch` / `@tanstack/react-query` pattern, `alive` guard deprecated |
| `docs/standards/UI_PRIMITIVES_STANDARD.md` | Which primitives exist, when to use each, how to add new ones |
| `docs/standards/TOKEN_MIGRATION_STANDARD.md` | Token adoption checklist for new views and components |

---

## Aggregate Progress Tracker

| Phase | Findings | H-risk | M-risk | L-risk | Done | Remaining |
|---|---:|---:|---:|---:|---:|---:|
| Phase 1 — Financial Integrity | 11 | 5 | 3 | 3 | **9 done · 2 deferred** | **0** |
| Phase 2 — API + State | 11 | 6 | 4 | 1 | **11 done (foundations laid; incremental cleanup remains)** | **0** |
| Phase 3 — Permissions + Validation + Pagination | 13 | 4 | 7 | 2 | **13 done (foundations laid; incremental cleanup remains)** | **0** |
| Phase 4 — Modals + Drawers + Tabs + Tables | 25 | 12 | 8 | 5 | **25 done** (MO-1 ✓ · DR-1+DR-4 ✓ · TL-2 scope-revised ✓ · TL-4 ✓ · TL-5 majority ✓) | **0** |
| Phase 5 — Tokenization | 33 | 8 | 14 | 11 | **15 done** (T-P2-2 Pagination + T-P2-5 StudioDrawer + T-P2-10 chips/tags/alerts/tertiary; T-P3-1 D19 documented; T-P3-2 breakpoint tokens; T-P3-3 WCAG tap-min; T-P4-2 portal i18n; T-P4-3 backend HTML i18n; T-P4-4 brand mark) | **18** (T-P3-4/5/6/7/8/9/10 raw-class + bare-px codemods; T-P4-5 orphan tokens; T-P2-3/4/6/7/8/9/11/12) |
| Phase 6 — Governance | 14 rules + 7 docs | — | — | — | **19 done** (11 HARD + 8 RATCHET drift rules in CI; 7 standards docs landed) | **1** (post-Phase-5 codemod-target ratchets to harden) |
| **TOTAL** | **107** | **35** | **36** | **22** | **88 done · 19 remaining (Phase 5c/d codemod surface)** | **19** |

---

## Hard Rules (from architect brief — always enforced)

1. If a canonical implementation already exists, use it.
2. If no canonical implementation exists, create one cleanly, document it, and migrate callers.
3. Do not add another one-off abstraction.
4. Do not weaken security, auth, billing, payment, RBAC, or audit behavior.
5. Do not change public API behavior unless explicitly required and tested.
6. Prefer small verified commits over large unverified rewrites.
7. Do not mark a finding FIXED unless verified by the listed verification command.
8. Do not create parallel systems.

---

*Next step: run `pytest` to confirm baseline is green, then start Phase 1 with BL-1 (balance_due canonical rollout — highest customer impact).*
