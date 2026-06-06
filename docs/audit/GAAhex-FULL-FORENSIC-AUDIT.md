# GAAhex Full Forensic Audit Report

> **Date:** 2026-06-06 · **Mode:** AUDIT ONLY — no code modified, no fixes, no refactor.
> **Method:** live commands on the real working tree (`C:\Users\Admin\Desktop\GAAhex`) + full deep-read of all 199 docs + 4 read-only code-forensic passes. Every claim carries a file path or command. DOCS-EXIST is separated from CODE-EXISTS, MOCK from REAL, WARN-ONLY from HARD-GATED, ENV-failure from CODE-failure. `UNKNOWN` is used where evidence is missing.
> **Saved as:** `docs/audit/GAAhex-FULL-FORENSIC-AUDIT.md` (audit box — repo root kept clean per the project's own categorization law).

---

## 1. Executive Verdict

**Overall: PARTIAL. Production: NOT SAFE for enterprise yet. Enterprise: NOT READY.**

GAAhex has an exceptional skeleton and a strong, real backend. It is **not** held back by architecture or vision; it is held back by **runtime/operational enforcement, provider wiring, and frontend/CI hardening**.

- **Backend is genuinely strong:** full pytest suite **1,772 passed / 0 failed** (real Postgres+Redis), 100% `tenant_id` coverage across 81 models, **118 RLS policies**, 3-layer tenant isolation, single audit-emit chokepoint, bcrypt + Fernet, a comprehensive production deploy contract, idempotency middleware with an atomic race fix, **0 hardcoded secrets, 0 SQL-injection vectors, 0 prod CORS wildcards**.
- **Architecture compliance is high:** 11 of 12 separation laws COMPLIANT, drift guard **PASS** (13 HARD + 8 RATCHET), 51-core matrix has **zero FAKE cores**.
- **The real debt is operational:** CI lets critical gates pass as warnings; `ruff` has **154 errors** hidden by `--exit-zero`; Email/SMS can **silently mock in production** (not feature-gated); a **dual workflow engine** overlap is deferred; frontend has **god-files** (OrgView 2,083 LOC), **no client router**, **no offline/PWA**, and a **1.49 MB un-split bundle**; dependencies are **range-pinned, not locked**; **18 commits are unpushed**.

**This is a fixable hardening problem, not a rebuild.**

---

## 2. Evidence Summary

| Check | Command | Result |
|---|---|---|
| Backend tests | `pytest -q` (Postgres+Redis via docker compose) | ✅ **1772 passed, 74 skipped, 4 xfailed**, 5:13, exit 0 |
| Drift guard | `python tools/check_drift.py` | ✅ PASS (13 HARD + 8 RATCHET), exit 0 |
| Frontend typecheck | `npx tsc --noEmit` | ✅ PASS, exit 0 |
| Frontend build | `npm run build` | ✅ PASS, 9.0s; ⚠️ 1.49 MB JS chunk |
| Backend lint | `ruff check backend/app` | ❌ **154 errors**, exit 1 (CI uses `--exit-zero`) |
| Frontend deps | `npm audit` | ✅ 0 vulnerabilities |
| Backend deps | `pip_audit` | 🟡 1 vuln — in `pip` itself (26.1.1→26.1.2); app deps clean |
| Secrets | grep `secret/password/api_key="..."` in `backend/app` | ✅ 0 matches |
| RLS | grep migrations | ✅ 118 `ENABLE RLS`/`CREATE POLICY` |

---

## 3. Commands Run

`Get-ChildItem` (structure) · `git ls-files | measure` (1538) · `git status -sb` · `git diff --stat` (clean) · `git log` · `git check-ignore backend/.env` · `python tools/check_drift.py` · `npx tsc --noEmit` · `npm run build` · `ruff check backend/app` · `npm audit` · `python -m pip_audit` · `docker compose up -d` · `pytest -q` · file-size/LOC scans · `Select-String` for RLS, GAAex, mock/stub · 4 read-only Explore code-forensic passes (laws, 51-core matrix, frontend, data/API/security).

---

## 4. Repository Inventory

**Source:** `backend/app` (101 routers, 80 models, 64 services, kernel/), `frontend/src` (63 views, 28 components), `frontend-portal/src` (9 tsx), `design-system/`, `tools/`, `scripts/`, `docs/` (199 .md).
**Generated/dependency/cache (all gitignored, local-only):** `backend/.venv` (198 MB), `frontend/node_modules` (208 MB), `frontend/dist` (2 MB), `.git` (60 MB), `*.pytest_cache`, `*.ruff_cache`, `__pycache__`.
**Config/secret-risk:** `.env.example` + `.env.production.example` (tracked, safe), `backend/.env` (**NOT tracked — gitignored** ✅).
**Should not be committed:** none currently are. **Should not be packaged:** the 4 artifact dirs above (a naive zip grabs ~500 MB — this is what a prior external audit mistook for repo pollution).

---

## 5. Package Hygiene

✅ **Clean.** `git ls-files` = 1,538; grep for `.venv/|node_modules/|dist/|__pycache__|.pytest_cache|.ruff_cache|.env$|.pyc` in tracked files → **0 matches**. `.gitignore` is thorough (artifacts + secret scripts: `seed_real_olt.py`, `probe_*.py` with live OLT creds, `cookies*.txt`, `token.txt`). **Gap:** no clean release-export script/denylist → distributable zips are polluted by ignored dirs.

---

## 6. Git State

Branch `main`, **HEAD `7f1d5b4`**, **18 commits ahead of `origin/main` (NOT pushed → no remote backup)**. `git diff --stat` = **clean (0 tracked changes)**. Untracked: `docs/audit/GAAhex-full-hard-audit-report.md` + `docs/product/` (today's audit + persona docs). **No dirty cross-cutting diff** (the prior external audit saw an older snapshot).

---

## 7. Documentation Audit

**Documented (extensive, locked):** Project Constitution v1.0 (36 LAW-XX), PRM (51 cores × 7 tiers), 22 Architecture Constitution docs, 70 numbered + 11 named standards, 5 catalogs, Brand v3.0, sealed baseline 2026-06-05, M1 plan, runbooks, OPS-BACKUP.
**Missing:** `STUB_REGISTRY`, `STANDARD_ENFORCEMENT_MATRIX` (rule→check), one canonical audit-status dashboard, the 4 pending catalogs (API/Event/Page/Integration — LAW-GV4 blocker).
**Outdated/conflicting:** `docs/BRAND.md` + `docs/specs/DESIGN_SYSTEM.md` predate D18 (flagged in `docs/branding/AUDIT.md`); `HANDOFF.md` HEAD `6ea8277` is stale (real HEAD `7f1d5b4`); `REMAINING-WORK.md` overlaps roadmap/queue.
**DOCS-EXIST vs CODE-PROVES:** docs/code alignment is **49/51 cores exact** (Agent B). Aspirational-only: AI, Forecasting, Marketplace, Mobile, Knowledge (docs/reserved, thin/no code).

---

## 8. Architecture Law Compliance

(Evidence: `backend/app/models/*`, code-forensic pass A)

| # | Law | Verdict | Evidence |
|---|---|---|---|
| 1 | Governance ≠ Policy | COMPLIANT | `models/access.py` PermissionDef/RoleDef distinct; governance = Constitution+drift |
| 2 | Permission ≠ Entitlement | COMPLIANT | `PermissionDef`/`RoleDef`/`Assignment` vs `feature_flag.py` |
| 3 | Tenant ≠ Organization | COMPLIANT | `models/tenant.py` vs `models/orgnode.py`; tenant_id FK everywhere |
| 4 | Product ≠ Service | COMPLIANT | `models/product.py` vs `models/service.py` |
| 5 | Resource ≠ Service | COMPLIANT | `ServiceResource` (service.py) vs `Service` |
| 6 | Case ≠ Work | COMPLIANT | `models/helpdesk.py` (ticket) vs `models/workitem.py` |
| **7** | **Workflow ≠ Automation** | **PARTIAL** | `AutomationRule` distinct, but **dual engines**: `app/workflow.py` (legacy) + `kernel/workflow_engine.py` both drive `workflow_def`; `main.py:104-140` runs an overlap scan + defers collapse |
| 8 | Communication ≠ Notification | COMPLIANT | `models/communication.py` vs `models/notification.py` + `NotificationDelivery` |
| 9 | Document ≠ Storage | COMPLIANT | `Attachment` model vs `services/storage/` backend abstraction |
| 10 | Analytics ≠ Reporting | COMPLIANT | `routers/analytics.py` (fixed KPIs) vs `routers/reports.py` (builder) |
| 11 | Workspace ≠ Platform Core | COMPLIANT | `workspace.py` is layout/view; cores in `kernel/` |
| 12 | Navigation ≠ Core taxonomy | COMPLIANT | `models/nav_module.py` data-driven, workflow-grouped (`nav_registry.py`) |

**11/12 COMPLIANT, 1 PARTIAL.** The dual-workflow-engine overlap is the one real architectural debt (acknowledged, audited, fail-soft, multi-week collapse deferred).

---

## 9. Platform Core Coverage Matrix

(Agent B; existence verified via code/router/model/test presence. Tier totals match PRM.)

**Totals: STRONG 8 · PARTIAL 37 · WEAK 4 · MISSING 2 · FAKE 0.**

- **STRONG (8, full code+router+model+tests):** Identity, Tenant, Audit, Configuration, Organization, Work, Workflow, Event.
- **WEAK (4):** Knowledge (no code/model), Template (router only), AI (`routers/ai.py` exists, no models), Mobile (no code).
- **MISSING (2, reserved):** Forecasting, Marketplace.
- **FAKE: 0** — no doc/UI core pretends to have a backend that doesn't exist.
- **Doc-vs-code variance (2):** AI and Portal docs say WEAK/PARTIAL but code shows a router with thin/no models — minor, honestly an over-statement risk, not a fake.
- **Nuance (UNKNOWN-by-shape):** Governance/Security/Policy show "no dedicated model" because they are **cross-cutting/kernel** concerns (Constitution+drift / `kernel/security`+`field_crypto` / GXL guards), not table-backed entities — PARTIAL-by-design, not gaps.

The remaining 37 PARTIAL cores have code+router+model but incomplete API surface / event contracts / tests.

---

## 10. Project Structure Map

| Path | Purpose | Type | Verdict |
|---|---|---|---|
| `backend/app/kernel/` | 5 fixed engines (invariants, workflow_engine, approvals, control_gate, timeline, kpi_engine) | source | strong |
| `backend/app/models/` | 80 entity models | source | strong (100% tenant_id) |
| `backend/app/routers/` | 101 API modules | source | good (no /v1, sparse DTO) |
| `backend/app/services/` | 64 business-logic modules + factories | source | good (email/sms mock gap) |
| `backend/alembic/versions/` | 111 migrations | source | strong (schema-first, RLS) |
| `backend/tests/` | 165 test files | test | strong (1772 pass) |
| `frontend/src/` | admin SPA, 63 views | source | partial (god-files, no router) |
| `frontend-portal/src/` | customer portal, 9 tsx | source | strong (cookie+CSRF, lean) |
| `docs/` | 199 docs across 11 boxes | doc | strong (some stale brand docs) |
| `tools/check_drift.py` | architecture drift guard | source | strong asset |
| `.github/workflows/ci.yml` | CI | config | partial (warn-only gates) |
| `backend/.venv`, `frontend/node_modules`, `*/dist` | deps/build | generated | gitignored ✅ |
| `.env.example`, `.env.production.example` | config templates | config | safe |

---

## 11. Backend Audit

Framework FastAPI (async, SQLAlchemy 2 async). Entry `app/main.py` (437 LOC, clean lifespan). Layers: `kernel/` ≠ `models/` ≠ `routers/` ≠ `services/`. **Auth:** JWT (HS256) + GUC tenant binding + rotating refresh w/ family revoke + replay detect (`security/auth.py`, `routers/auth.py`). **Permissions:** `kernel/invariants.assert_can()` default-deny + `FIRST_CLASS_OWNER_MAP`. **Audit/events:** single chokepoint `workflow.emit()` (`app/workflow.py:43-82`), append-only triggers on `event`/`audit_log`. **Idempotency:** `middleware/idempotency.py` (atomic INSERT…ON CONFLICT, AC4 race fix). **Errors:** typed exceptions + global handler.
**Gaps:** (a) **scattered serialization** — no unified DTO layer, ad-hoc per-router serializers; (b) **dual workflow engines** (Law 7); (c) **551 `Any`** usages (dense in analytics/noc); (d) likely **dead code** in `app/adapters/` (superseded by `services/`); (e) 154 ruff errors (F841/F401 mostly). Largest: `services/olt/drivers/vsol_v1600.py` 1,290; `routers/analytics.py` 1,128; `routers/notifications.py` 1,029.

---

## 12. Frontend Audit

React 18 + Vite. **No client router** — imperative `useState<View>` switching (~128 view types in `App.tsx`); scales poorly past ~60 views. **AuthContext** (token/user/capabilities). **API clients:** `lib/billing.ts` (canonical, 401-interception), `frontend-portal/src/lib/api.ts` (cookie+CSRF dual-mode ✅). **Permission-aware UI** via `can()`. **i18n:** admin en/hy/ru (RU has a `TODO` — incomplete), portal en/hy/ru complete. **States:** loading/error/empty present; ARIA + `useFocusTrap` present but **0 frontend tests**, keyboard shortcuts not bound.
**Gaps:** **god-files** OrgView.tsx **2,083 LOC**, RevenueAssuranceView 1,476, NocDashboard 1,314, DashboardView 1,303; **no offline/PWA/service-worker**; **1.49 MB un-split bundle**; 2 `console.log` (PartiesView); 52 hardcoded hex (mostly CalendarView swatches + demo view). Verdict: **Admin ~80% / Portal ~90%** production-ready.

---

## 13. Data Model Audit

**100% tenant_id coverage** — all 81 tenant-scoped models carry `tenant_id` NOT NULL indexed FK (User.py:17, Order.py:31, Record.py:18…). A past `product_version` cross-tenant leak was **closed** (migration `d1a7b2c4e6f8`). **Audit fields** consistent (`created_at`/`updated_at`/`created_by`). **`deletion_state` separate from `status`** (D14): ACTIVE/ARCHIVED/SOFT_DELETED/PENDING_PURGE/PURGED. **Enums UPPER_SNAKE** (B1). **118 RLS policies** (`3a9203795d07` + waves). **JSON fields** explicit/validated (`Record.data`, `Tenant.theme`) — no hidden business logic. **No synonym duplication** (Party/Account/Subscription/Service layered, not Customer/Client/Subscriber dupes). **Relationship** is first-class (`models/relationship.py`). 111 migrations, schema-first, no detected drift. **Risk: low.**

---

## 14. API Audit

**Strong on auth/perm/tenant:** every sampled endpoint = `current_user` + `load_grants` + `can(...)` + `tenant_id` filter + org-scope (`routers/subscriptions.py:49-69`). **Idempotency** standardized. **Pagination** standardized (`Page`, `X-Total-Count`, default 200/max 500).
**Gaps:** **no URL versioning** (`/api/{slug}`, no `/api/v1`); **sparse DTOs** (dict serializers, few `response_model`) → raw-model-exposure risk and OpenAPI types degrade to `unknown` (blocks the codegen standard); **error model is plain `{"detail":...}`, not RFC 7807**; **sort/filter ad-hoc** per router. `/org-tree` and `/health` reviewed — `/org-tree` now auth-gated (S5 fix), `/health` intentionally public. **No unguarded admin route found.**

---

## 15. Permission / Policy / Entitlement Audit

Three separated systems: **Permission** (`object.action` keys, immutable, `models/access.py` + `standards/15`) enforced server-side via `assert_can()` default-deny + field-level `can_edit_field()`/`can_view_field()`; **Policy** = GXL expression guards on workflows/automations (`gxl.py`, simpleeval); **Entitlement** = `feature_flag.py` (per-tenant) vs `feature_gate.py` (deploy-shape) — the two-system rule is intact (do-not-merge). **UNKNOWN:** ABAC depth and whether every router consistently reaches `assert_can` (kernel gate has a documented role-only fallback when metadata isn't backfilled — `kernel/invariants.py`).

---

## 16. Tenant / White-label Audit

**Tenant isolation: STRONG** — 3 layers: RLS (`gaahex_app` NOSUPERUSER, 118 policies) + query-audit listener (`tenant_query_audit.py`) + per-request app filter. Production deploy contract refuses boot if app/owner DB roles aren't distinct. **White-label: PARTIAL/UNKNOWN** — tenant logo+name+theme tokens configurable (`Tenant.theme` JSONB), but GAAhex brand is hardcoded on the login page and there's no full per-tenant brand override surface verified. Multi-org via `OrgNode` tree (≠ multi-tenant).

---

## 17. Event / Audit / Observability Audit

**Event/Audit: STRONG** — single `workflow.emit()` chokepoint, append-only DB triggers (immutable for all roles), rich contract (event_name/category/actor/correlation/causation/idempotency). **Observability: WEAK→PARTIAL** — `logging` per-module + `/health` + `/health/db` + golden-signals **documented** in `18_OBSERVABILITY`, but **decentralized logging, no central trace aggregation** verified; Observability core is PARTIAL. CI/runtime SLO burn-rate gates: UNKNOWN/not verified in code.

---

## 18. Workflow / Automation Audit

Kernel `workflow_engine.py` (693 LOC) implements the §5 Universal Workflow Contract (transitions, gates incl. Stage-8 control gate, approvals as Approval-core events). `AutomationRule` (event-triggered: notify/set_field/webhook/emit_event) is distinct. **The one debt:** legacy `app/workflow.py` and kernel `workflow_engine.py` both touch `workflow_def`; overlap-scan at boot warns but does not block (Law 7 PARTIAL).

---

## 19. Reporting / Analytics Audit

Separated (Law 10): `routers/analytics.py` = fixed KPIs/dashboards (29 charts, custom SVG — Donut/LineChart/Spark, no charting lib); `routers/reports.py` + `report_schedules.py` = config-driven builder + scheduled delivery (CSV/JSON/XLSX/PDF, stdlib). All real backend SQL aggregates. **Risk:** `analytics.py` 1,128 LOC + heavy `Any` typing.

---

## 20. AI / Marketplace / Mobile / Localization Audit

- **AI:** WEAK — `routers/ai.py` exists (Ask-GAAhex chat), no models; governance docs (`21_AI`) ahead of code. Aspirational.
- **Marketplace:** MISSING (reserved, M2+). No code.
- **Mobile/Offline:** WEAK — no PWA, no service worker, no sync queue; `22_MOBILE` doc exists, models reserved.
- **Localization:** PARTIAL→good — `t()` system both SPAs, hy complete, ru complete (portal) / incomplete (admin), Noto Sans Armenian. Backend HTML i18n partial.

---

## 21. Security Audit

| Finding | Severity | Evidence |
|---|---|---|
| 0 hardcoded secrets in app code | ✅ | grep 0 matches; all via env; `field_crypto` warns on dev key |
| Prod CORS wildcard refused at boot | ✅ | `config.py:208-216` |
| bcrypt password hashing + policy | ✅ | `security/auth.py:15-23` |
| Fernet field encryption at rest | ✅ | `security/field_crypto.py`, `webhook.py:43` |
| File upload hardened (ext blocklist, size, checksum, safe filename) | ✅ | `attachments.py:66-97` |
| No raw-SQL injection | ✅ | all `text()` parameterized (`db.py:49`) |
| Rotating refresh + family revoke + replay detect | ✅ | `auth.py:72-134` |
| **Email/SMS can silently MOCK in production** | 🔴 **P1** | `services/comms/mock_email.py`/`mock_sms.py` factory fallback **not feature-gated** (unlike RADIUS/OLT/payments which ARE gated) |
| **gitleaks secret-scan is WARN-ONLY** | 🟡 P1 | `ci.yml:270-285` `continue-on-error: true` |
| **RLS dual-role gate WARN-ONLY** (TD13) | 🟡 P1 | `ci.yml:137-141` `continue-on-error: true` |
| pip self-vuln | ⚪ low | `pip` 26.1.1→26.1.2 |
| Signed-URL download | UNKNOWN | not implemented (direct download endpoint); M0 scope |

---

## 22. CI/CD Audit

`.github/workflows/ci.yml` — 4 jobs.
**HARD-GATED (block merge):** tenant-filter static analysis (`check_tenant_filter.py`), architecture drift guard (`check_drift.py`), **pytest** (`backend` job), **tsc --noEmit** (`frontend` job).
**WARN-ONLY (must be reported as blockers for prod):** **`ruff check app/ --exit-zero`** (hides 154 errors), **`pip-audit ... continue-on-error`**, **`npm audit ... continue-on-error`**, **`backend-rls` RLS subset `continue-on-error`** (TD13), **`secret-scan` gitleaks `continue-on-error`**.
**Missing:** no `npm run build` gate, **no frontend unit/e2e/a11y tests**, no migration-up check, no lockfile-based install (uses `npm ci` ✅ for frontend but backend `pip install -r requirements.txt` with `>=` ranges).

---

## 23. Test Audit

**Backend:** 165 test files; full suite **1,772 passed / 0 failed / 74 skipped / 4 xfailed** against real Postgres 16 + Redis 7 (5:13). Includes RLS (`test_rls*.py`), deploy-contract, M0 killer test, billing/auth/workflow. **This is a real pass, not assumed.**
**Frontend:** Vitest + Playwright **deps present but NO tests authored / NO CI gate** — 0 frontend tests is a real gap.
**Environment vs code:** the only blocker (Docker daemon off) was resolved live; not a code failure. **Test reliability note:** memory flags occasional fixture-teardown FK noise on full-suite runs (none failed this run).

---

## 24. UX / Product Readiness Audit

**Feels production:** Helpdesk, Billing, Work Items, Calendar, Customer 360 (9 canonical tabs), Analytics (29 charts), Global Search/command palette, Portal (Bills/Support/Service). **All real backend data.**
**Feels demo/explicitly-stubbed (clearly marked, not hidden):** `MasterLayoutDemoView` (T-P1-8 demo), `ComingSoonView` (STUB_PREVIEWS for unbuilt pages — **production-visible "coming soon" is a trust risk**), `LoginView` demo creds `admin@demo.isp/admin123` (shown in hint).
**Missing for real ISP ops:** live RADIUS/OLT provisioning (fail-closed stubs), warehouse/inventory, offline field-tech mode, no client router for deep-linking.

---

## 25. Enterprise Readiness Audit

| Capability | Verdict | Evidence / Gap |
|---|---|---|
| Multi-tenant SaaS | READY | 118 RLS, 3-layer isolation, deploy contract |
| White-label | PARTIAL | logo/name/theme only; brand hardcoded on login |
| Enterprise admin | PARTIAL | Studio config-driven; RBAC assign UI thin |
| ISP OSS/BSS | PARTIAL | billing/helpdesk REAL; **RADIUS/OLT fail-closed stubs** |
| CRM / ERP expansion | READY (config) | config-over-code thesis proven (M0 killer test) |
| Customer portal | READY | cookie+CSRF, real data, i18n |
| Workforce mgmt | PARTIAL | work items REAL; offline/mobile WEAK |
| Communications | PARTIAL | inbox REAL; **email/SMS can silently mock** |
| Automation/Reporting/Analytics | PARTIAL→READY | engines real; dual-workflow debt |
| AI / Marketplace / Mobile | NOT READY | WEAK/MISSING/reserved |
| API developer ecosystem | PARTIAL | API keys + idempotency; no versioning, sparse DTO/OpenAPI |

---

## 26. Code Cleanliness Findings

154 ruff errors (`ruff check backend/app`, exit 1) — F841/F401 dominant; 31 auto-fixable. Frontend: 2 `console.log` (PartiesView), 1 RU-i18n TODO. 551 `Any` in backend routers. Backend god-files (vsol 1,290 / analytics 1,128 / notifications 1,029). Frontend god-files (OrgView 2,083 / RevenueAssurance 1,476). No build artifacts under any `src/`.

---

## 27. Mock / Stub / Fake Data Findings

**Backend (~49 markers):** legitimate **feature-gated** stubs (RADIUS/OLT/import/warehouse/payments — refused in prod via `feature_gate.py` + deploy contract) ✅; **NOT gated → 🔴 risk:** `services/comms/mock_email.py`, `mock_sms.py` (silent prod mock possible). **Frontend:** production views use **real backend data exclusively**; demo data confined to clearly-marked `MasterLayoutDemoView`, `ComingSoonView`, `LoginView` creds, `CalendarView` swatches. **No production mock data.**

---

## 28. Dead Code / Duplication Findings

- **Dual workflow engines** — `app/workflow.py` (legacy) + `kernel/workflow_engine.py` (deliberate overlap, deferred collapse).
- **Likely dead:** `app/adapters/` (email/sms/payment) superseded by `services/comms/*`, `services/payments/*`; `app/comm.py`/`Interaction` legacy (migrated to Record).
- **Frontend copy-paste risk:** ~57 similar list-view patterns not extracted into a meta-component (UNKNOWN if truly dead).

---

## 29. Performance / Scalability Risks

- **Frontend bundle 1.49 MB** single chunk, no code-splitting (`npm run build` warning).
- **No client router** → imperative view state won't scale cleanly past ~60 views.
- **god-files** raise regression risk (OrgView 2,083 LOC tree CRUD).
- **HA deferred** — single Postgres for M1, WAL-archiving/RPO-1h deferred (OPS-BACKUP).
- **Load test at 15k subs: not run** (UNKNOWN headroom).

---

## 30. Scores (0–10, with reason)

| Dimension | Score | Reason |
|---|---|---|
| Repository hygiene | 9 | 0 artifacts tracked, .env ignored; no release-export script |
| Architecture documentation | 10 | PRM + 22 docs + Constitution + 70 standards |
| Architecture compliance | 8 | 11/12 laws, drift PASS; dual-engine PARTIAL; catalogs incomplete |
| Backend quality | 8 | tests pass; gaps: DTO, 154 ruff, dual engine, 551 Any |
| Frontend quality | 6 | real data; god-files, no router, no offline, 2 console.log |
| Data model quality | 9 | 100% tenant_id, deletion_state, enums, 118 RLS, indexes |
| API quality | 7 | auth/perm/tenant + idempotency solid; no versioning/DTO/RFC7807 |
| Security | 8 | secrets/bcrypt/Fernet/deploy-contract; email/SMS mock + gitleaks warn-only |
| Tenant isolation | 9 | 3-layer RLS+audit+filter; full-suite dual-role not blocking |
| Permission model | 8 | object.action default-deny + field-level; kernel fallback partial |
| Auditability | 9 | single emit + append-only triggers + rich contract |
| Observability | 5 | logging+health+docs; decentralized, no central trace |
| Test coverage | 7 | 1772 backend pass; 0 frontend tests, no e2e/a11y |
| CI/CD quality | 5 | good structure; critical gates warn-only |
| Production readiness | 6 | M0 strong; provider stubs, manual smoke pending, deps unpinned |
| Enterprise scalability | 7 | multi-tenant by construction; frontend scale + HA gaps |
| ISP operations readiness | 5 | CRM/billing real; RADIUS/OLT/provisioning fail-closed |
| Mobile/offline readiness | 2 | no PWA/service-worker; Mobile core WEAK |
| AI readiness | 3 | AI WEAK, router stub, no models |
| Marketplace readiness | 1 | MISSING/reserved |
| Documentation truthfulness | 8 | 49/51 docs↔code; some stale brand/handoff docs |

**Weighted overall ≈ 6.6/10 — strong core, operational debt.**

---

## 31. Critical Blockers (fix before enterprise production)

1. **Email/SMS can silently mock in prod** — gate `mock_email.py`/`mock_sms.py` like RADIUS/OLT (deploy-contract refusal).
2. **CI critical gates warn-only** — make **gitleaks** + **RLS subset** blocking; drop `ruff --exit-zero` (or track the 154 with owners/dates).
3. **Provider wiring stubbed** — Stripe/SendGrid/Twilio/FreeRADIUS/OLT not live; a `STUB_REGISTRY` must prove each is prod-blocked or wired.
4. **18 commits unpushed** — `git push` for remote backup.
5. **Manual M0 staging smoke never run** (12 steps, 4–8 = thesis).

---

## 32. Major Risks

154 ruff errors hidden; dual workflow engine overlap; frontend god-files + no client router + 1.49 MB bundle; dependencies range-pinned (no lockfile); 0 frontend tests; catalog layer incomplete (LAW-GV4) + Q1 GXL DRAFT; white-label only logo/name; production-visible "coming soon" pages.

---

## 33. Medium Risks

`GAAex` naming in code (`AskGaaexView.tsx` + 2 `App.tsx` refs); no API versioning / sparse DTOs (blocks OpenAPI codegen); RFC 7807 not adopted; observability decentralized; dead `app/adapters/`; admin RU i18n incomplete; stale brand/handoff docs.

---

## 34. Low Risks

`pip` 26.1.1→26.1.2; 2 `console.log`; CalendarView hardcoded swatches; root/docs overlap (`REMAINING-WORK.md`); 551 `Any` (mostly query builders).

---

## 35. Remediation Plan (NOT executed)

**Phase 0 — package/git:** release-export script + CI denylist; `git push`; rename `AskGaaexView`.
**Phase 1 — CI hard gates:** ruff blocking (auto-fix 31, triage rest); gitleaks + RLS subset blocking; add frontend `npm run build` + Vitest + Playwright smoke; add `requirements.lock`.
**Phase 2 — security/tenant/audit:** gate email/SMS mocks; `STUB_REGISTRY` + boot-guard tests; move TD13 to full `gaahex_app` RLS suite then block.
**Phase 3 — architecture:** collapse dual workflow engine; finish 4 catalogs (lock layer, LAW-GV4); seal Q1; `STANDARD_ENFORCEMENT_MATRIX`; split god-files; bundle code-splitting; adopt OpenAPI codegen + response_models.
**Phase 4 — production:** real provider wiring; pilot data-shape; manual staging smoke; DR drill; load test (15k); pen-test; GDPR legal; white-label surface.

---

## 36. Acceptance Criteria

1. `ruff`, `tsc`, `npm run build`, `check_drift`, **full `pytest`** all green **as blocking CI gates**; gitleaks + RLS subset blocking.
2. 0 secrets; full `gaahex_app` RLS suite green; email/SMS cannot mock in prod.
3. `requirements.lock` committed + CI builds from it; deps audits clean/tracked.
4. `STUB_REGISTRY` proves every mock prod-blocked or gated, with boot guards + tests.
5. Release package excludes all artifacts/secrets (CI-enforced).
6. Catalog Layer locked (4 done); Q1 sealed; dual workflow engine collapsed.
7. No frontend file > ~800 LOC unjustified; largest bundle chunk < 500 kB; client router or documented decision.
8. ≥1 frontend test gate (unit + e2e smoke); 0 production-visible "coming soon".
9. `origin/main` == local; brand v3.0 + 70 standards + Constitution un-regressed (drift green).
10. Manual M0 staging smoke passed; provider wiring live behind deploy contract.

---

## 37. Final Production Decision

- **Overall verdict: PARTIAL.**
- **Production verdict: NOT SAFE for enterprise today** — backend core is production-grade, but email/SMS silent-mock risk, warn-only security gates, stubbed providers, and unrun staging smoke block a safe enterprise launch.
- **Enterprise verdict: NOT READY** — multi-tenant SaaS foundation is READY; ISP-operations (RADIUS/OLT), mobile/AI/marketplace, white-label, and frontend hardening are not.

**Biggest 10 blockers:** (1) email/SMS prod-mock gating (2) CI gates warn-only (3) provider wiring stubbed (4) STUB_REGISTRY absent (5) staging smoke unrun (6) dual workflow engine (7) frontend god-files + no router (8) 0 frontend tests (9) deps unlocked (10) catalogs/Q1 incomplete.

**Freeze before more features:** package hygiene, CI enforcement posture, the stub/mock registry, dependency locking. **Delete from package (not repo):** `.git/.venv/node_modules/dist/caches/.env` via a release script. **Turn into hard CI gate:** ruff, gitleaks, RLS subset, `npm run build`, a frontend smoke test.

**Bottom line:** GAAhex is on the right path with a real, tested, secure backend core. The work before enterprise production is **hardening and wiring, not redesign.**

*End of report. No code was modified.*
