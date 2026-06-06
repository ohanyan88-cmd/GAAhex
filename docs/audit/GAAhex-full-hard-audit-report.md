# GAAhex Full Hard Audit Report

> **Date:** 2026-06-06 · **Auditor:** Ընգեր (in-session, evidence-based) · **Mode:** audit only, **no fixes applied**.
> **Method:** live commands on the real working tree at `C:\Users\Admin\Desktop\GAAhex` + full prior deep-read of all 199 docs. Every claim below is backed by a command or a file path. Environment-failures are separated from real failures.
> **Saved as:** `docs/audit/GAAhex-full-hard-audit-report.md` (placed in the audit box per the repo's own categorization law; repo root is kept free of new `.md`).

---

## 1. Executive verdict

**PARTIAL — strong architecture and clean repo hygiene, NOT yet production-ready.**

The project is genuinely above the bar for an early-stage platform: sealed Platform Reference Model (51 cores × 7 tiers), 22-document Architecture Constitution, governance Constitution v1.0 (36 LAW-XX), 70 locked standards, 5 locked catalogs, a passing drift-guard, **118 RLS policy statements** across 111 migrations, clean git hygiene (0 build artifacts tracked, `.env` ignored, 0 hardcoded secrets found), passing TypeScript typecheck, passing production build, and 0 dependency vulnerabilities in app packages.

It is **not** production-ready because the gap is **runtime/operational enforcement**, not architecture:
- CI lets critical gates pass as warnings (`ruff --exit-zero`, gitleaks/RLS/audits `continue-on-error`).
- `ruff` finds **154 real lint errors** that CI currently hides.
- Real provider subsystems (payments, SMS/email, RADIUS, OLT) are **fail-closed stubs**, not wired.
- Frontend has **god-files** (OrgView.tsx = 1,935 LOC) and a **1.49 MB un-split JS bundle**.
- Dependencies are **range-pinned, not locked**.
- 18 commits are **committed but never pushed** to `origin/main` (no remote backup).

**Verdict basis:** strong skeleton, real but bounded debt, zero catastrophic findings. Fixable in a focused hardening pass.

---

## 2. What is in the project

Top-level (real, from `Get-ChildItem`):

| Path | Purpose |
|---|---|
| `backend/` | FastAPI app — 101 routers, 80 models, 64 services, 111 Alembic migrations, 165 test files, kernel engines |
| `frontend/` | Vite + React admin SPA — 63 views, 28 components, `gaahex-tokens.css` design system |
| `frontend-portal/` | Customer self-service SPA (2nd app) — 9 `.tsx`, own `api.ts` |
| `design-system/` | Design-system reference + `ui_kits/portal/` |
| `docs/` | All knowledge layers: `governance/` `architecture/` `standards/` `catalogs/` `specs/` `runbooks/` `audit/` `roadmap/` `branding/` `product/` |
| `tools/` | `check_drift.py` (drift guard), codemods |
| `scripts/` | backup/ops scripts |
| `.github/workflows/ci.yml` | CI pipeline |
| `.claude/` | session config (gitignored) |
| root config | `docker-compose.yml`, `.dockerignore`, `.env.example`, `.env.production.example`, `.gitignore` |
| root docs | `CLAUDE.md`, `CONTRIBUTING.md`, `HANDOFF.md`, `OPS-BACKUP.md`, `README.md`, `REMAINING-WORK.md` |

**Git state:** branch `main`, **HEAD `7f1d5b4`**, **18 commits ahead of `origin/main` (NOT pushed)**, working tree clean except untracked `docs/product/` (today's persona/journey docs).

---

## 3. What is written / implemented

- **Kernel (5 engines):** WorkItem movement / auth-authz / database / audit-log / security — config-over-code thesis, M0 killer test (`test_m0_killer_2nd_entity_config_only`).
- **Backend features (shipped, per specs + code):** billing (subscriptions→invoices→payments→dunning), helpdesk (queues/tickets/SLA sweep), work items (dispatch), calendar, notifications (inbox + adapters), outbound, payment gateway (DevGateway + Idram/TelCell/ARCA scaffolds), reporting + export (CSV/JSON/XLSX/PDF), global search + command palette, analytics (29 charts), field-level access, scheduler jobs.
- **Multi-tenancy:** 118 `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` statements in migrations; dual-role Postgres direction; tenant-id discipline.
- **Frontend:** 63 admin views, PageShell + 6 zones, D17/D18 token system, Lucide icons; **customer portal** (`frontend-portal`) with cookie+CSRF auth.
- **Governance/architecture/standards/catalogs:** Constitution v1.0, PRM, 22 arch docs, 70+11 standards, 5 catalogs, drift guard (13 HARD + 8 RATCHET rules).

---

## 4. What is missing / incomplete

- **Provider wiring dormant** — payments (real ARCA/Idram/TelCell), SendGrid, Twilio, **FreeRADIUS**, **OLT drivers** are fail-closed stubs; need real credentials + activation.
- **Catalog layer incomplete** — 4 of ~8 catalogs PENDING (API, Event, Page, Integration); **LAW-GV4 blocks layer advance** until locked.
- **Q1 (GXL workflow guards)** — `SEALED-...-GXL-EXTENSION.md` still DRAFT SHELL (5 TBD).
- **WEAK/MISSING cores (PRM):** WEAK = Knowledge, Template, AI, Mobile; MISSING = Forecasting, Marketplace (reserved, M2+).
- **GDPR** — minimum-viable (anonymize-on-purge); full Art.12/21 pipeline + legal review pending.
- **Frontend test depth** — no unit/component/a11y/Playwright gates (only tsc + npm audit).
- **Dependency locking** — `requirements.txt` uses `>=` ranges, no lockfile.
- **Non-engineering tracks** — Product/UX (Track C, just started), Content/i18n (portal 0% i18n), Legal/trademark, GTM.

---

## 5. Architecture compliance

**Strong.** Implementation matches locked architecture on the dimensions checkable today:

| Dimension | Evidence | Status |
|---|---|---|
| Drift guard (locked patterns) | `tools/check_drift.py` → **13 HARD + 8 RATCHET all PASS, exit 0** | ✅ |
| Multi-tenancy / RLS | 118 RLS policy statements across migrations | ✅ (warn-only gate — see §8) |
| Separation of concerns | Constitution LAW-AR4 boundaries documented; drift PR-1 enforces prefix registry | ✅ |
| Config-over-code | M0 killer test in suite | ✅ (pending run, §7) |
| Audit immutability | append-only triggers on `event`/`audit_log` (migrations) | ✅ |
| API-first | 101 routers, OpenAPI; codegen standard exists | 🟡 (codegen not yet adopted) |
| Catalog completeness (LAW-GV4) | 4 catalogs pending | 🔴 self-imposed blocker |
| Observability / mobile / marketplace / AI | documented, cores WEAK/RESERVED | 🟡 future |

No boundary violations or duplicated ownership detected by the drift guard. The architecture is the project's strongest asset.

---

## 6. Code cleanliness

- **Backend:** mostly clean structure, but **`ruff check` = 154 errors** (e.g. `F841` unused `adapter_logger` in `services/dunning.py:291`, `F401` unused `sqlalchemy.text` in `services/privacy.py:32`; 31 auto-fixable). Largest files: `services/olt/drivers/vsol_v1600.py` (1,167), `routers/analytics.py` (955), `seed_catalog.py` (901), `routers/notifications.py` (898) — large but domain-justified. **49 mock/stub/TODO markers across 15 files** (mostly intentional production-refusal guards in `feature_gate.py`/`config.py`). **Verdict: clean structure, real lint debt hidden by CI.**
- **Frontend:** typecheck clean, **only 1** `console.log/TODO` in `src` (`lib/i18n.ts`). But **god-files**: `OrgView.tsx` **1,935 LOC**, `RevenueAssuranceView.tsx` 1,392, `studio/EntitiesPane.tsx` 1,307, `NocDashboardView.tsx` 1,238, `DashboardView.tsx` 1,229, `NetworkInventoryView.tsx` 1,139. Build warns: **1.49 MB JS chunk, no code-splitting**. **Verdict: clean of debug cruft, but large-file + bundle debt.**
- **Shared/config:** `.gitignore` thorough; `docker-compose.yml` + `.env.*.example` present; **`requirements.txt` not pinned** (`>=` ranges). **Verdict: good hygiene, weak reproducibility.**
- **Scripts/tools:** `tools/check_drift.py` is a genuine self-enforcement asset. **Verdict: good.**
- **Tests:** 165 backend test files (run result §7). Frontend has Vitest/Playwright deps but **no enforced frontend test gate**. **Verdict: strong backend test breadth, frontend test enforcement missing.**

---

## 7. Test and validation results

| Command | Result | Notes |
|---|---|---|
| `python tools/check_drift.py` | ✅ **PASS** (exit 0) | 13 HARD + 8 RATCHET rules all OK |
| `npx tsc --noEmit` (frontend) | ✅ **PASS** (exit 0) | strict typecheck clean |
| `npm run build` (frontend) | ✅ **PASS** (exit 0, 9.0s) | ⚠️ 1.49 MB JS chunk (>500 kB), no code-split |
| `ruff check backend/app` | ❌ **154 errors** (exit 1) | CI hides via `--exit-zero`; 31 auto-fixable |
| `npm audit` (frontend) | ✅ **0 vulnerabilities** | |
| `python -m pip_audit` (backend venv) | 🟡 **1 vuln — in `pip` itself** (26.1.1→26.1.2) | app deps clean |
| **`pytest` (backend full suite)** | ⏳ **RUNNING** — DB up (Postgres 5433 + Redis 6380 healthy via `docker compose up -d`) | result appended below; HANDOFF claims 1,772 passing |
| Backend tests (initial attempt) | ⚠️ blocked then unblocked | Docker daemon was off; started Docker Desktop, brought up compose, DB healthy, suite now executing |

**Environment vs real failures:** the only environment blocker (Docker daemon off) was resolved live; tooling (python 3.12, node 22, venv 3.12.10) is all present. The 154 ruff errors are **real**, not environmental.

> **PYTEST RESULT (completed):** ✅ **1,772 passed · 0 failed · 74 skipped · 4 xfailed** in 313.55s (5:13), exit 0 — against real Postgres 16 + Redis 7 (`docker compose up -d`). Confirmed, not assumed.

---

## 8. Security findings

| Severity | Finding | Evidence |
|---|---|---|
| 🟢 good | No hardcoded secrets in `backend/app` | grep for `secret/password/api_key = "..."` → **0 matches** |
| 🟢 good | `backend/.env` not tracked; ignored | `git ls-files backend/.env` empty; `.gitignore` covers `.env` + secret scripts (OLT credential probes, `cookies*.txt`, `token.txt`) |
| 🟢 good | App dependency vulns | npm audit **0**; pip-audit only flags `pip` itself |
| 🟢 good | Tenant isolation present | 118 RLS policy statements |
| 🟡 P1 | **RLS enforcement gate is warn-only** | CI `backend-rls` job `continue-on-error: true` (TD13) — owner-role tests pass, full `gaahex_app` runtime gate not blocking |
| 🟡 P1 | **Secret-scan (gitleaks) warn-only** | CI `continue-on-error: true` — should block before real customer data |
| 🟡 P1 | **Stub/mock subsystems in operational paths** | 49 markers; payments/RADIUS/OLT/import fail-closed but unproven-by-registry |
| 🟢 note | Portal auth hardened | `frontend-portal/src/lib/api.ts` now sends `credentials:'include'` + `X-CSRF-Token` (cookie mode) — the old "portal localStorage blocker" is **resolved** |

No injection, unsafe-CORS-in-prod, or missing-auth findings surfaced in this pass (deploy contract enforces CORS/role-split/mock-refusal at boot, per architecture docs).

---

## 9. Repo hygiene findings

**Good — the repo itself is clean** (contradicts the external zip-audit, which audited a polluted *zip*, not the repo):

- ✅ **0 build artifacts tracked** in git (no `.venv/`, `node_modules/`, `dist/`, `__pycache__`, caches, `.pyc`).
- ✅ `backend/.env` **not tracked**.
- ✅ `.gitignore` is thorough (artifacts + secret scripts + session debris).
- ✅ 1,538 tracked files.
- ⚠️ Local-only (gitignored, fine on disk): `.git` 60 MB, `backend/.venv` 198 MB, `frontend/node_modules` 208 MB, `frontend/dist` 2 MB.
- ⚠️ **No clean-export/release packaging** — a naive `zip` of the working dir grabs ~500 MB of ignored artifacts (this is what the prior external audit mistook for repo pollution).
- ⚠️ Root holds 6 operational `.md` (`README`, `CLAUDE`, `CONTRIBUTING`, `HANDOFF`, `OPS-BACKUP`, `REMAINING-WORK`) — conventional, but `REMAINING-WORK.md`/`HANDOFF.md` overlap the `docs/roadmap` + queue.

---

## 10. Critical blockers (must fix before any production)

1. **18 commits unpushed** → no remote backup. `git push` (orchestrator).
2. **CI critical gates warn-only** → make **gitleaks** + **RLS subset** blocking; remove `ruff --exit-zero` (or track the 154 with owners/dates).
3. **Provider stubs unproven** → a `STUB_REGISTRY` proving every mock is production-blocked/feature-gated before real ISP data.
4. **Pytest green must be confirmed in CI on every push** (result §7) — not assumed.

---

## 11. Major risks

- **154 ruff errors** hidden by `--exit-zero` — unused vars/imports today, masks worse tomorrow.
- **Frontend god-files** (OrgView 1,935 LOC) + **1.49 MB un-split bundle** — maintainability + load perf.
- **Dependencies range-pinned, not locked** — non-reproducible builds.
- **No frontend test gate** (unit/a11y/Playwright) — typecheck alone can't protect nav/modal/tenant-visibility.
- **Catalog layer incomplete** (LAW-GV4) + **Q1 GXL DRAFT** — self-imposed governance blockers.

---

## 12. Medium / low risks

- `GAAex` naming drift in code: `frontend/src/views/AskGaaexView.tsx` + 2 refs in `App.tsx` (docs hits are historical sweep records — fine).
- `pip` 26.1.1 → 26.1.2 (toolchain only).
- Doc traceability: standards lack a `STANDARD_ENFORCEMENT_MATRIX` mapping rule→check.
- Multiple audit reports lack one canonical status dashboard.
- Root/docs overlap (`REMAINING-WORK.md`, `HANDOFF.md`).

---

## 13. Exact fix plan (phased — NOT executed)

**Phase 0 — repo/package cleanup**
- Add `scripts/make-release.ps1` + CI check: distributable zip must exclude `.git/.venv/node_modules/dist/caches/.env`.
- `git push` the 18 commits (remote backup).
- Rename `AskGaaexView` → `AskGaahexView` (controlled, with alias if a route depends on it).

**Phase 1 — tests / CI hard gates**
- Make `ruff` blocking (auto-fix the 31, triage the rest); drop `--exit-zero`.
- Make **gitleaks** + **RLS subset** blocking.
- Add frontend gate: `npm run build` + a Vitest smoke + Playwright smoke for top workflows.
- Add `requirements.lock` (uv/pip-tools); CI builds from lockfile.

**Phase 2 — security / tenant / audit**
- `STUB_REGISTRY.md` (+ machine-readable) proving every stub is prod-blocked or feature-gated, with boot-guard tests.
- Move TD13 to full `gaahex_app` runtime RLS suite (Alembic-managed test schema), then make blocking.

**Phase 3 — architecture boundary**
- Finish the 4 pending catalogs (API/Event/Page/Integration) → lock the Catalog Layer (LAW-GV4).
- Seal Q1 (GXL extension addendum).
- `STANDARD_ENFORCEMENT_MATRIX.md` (rule → check → files/tests → status).
- Split frontend god-files (start OrgView 1,935 → composed panels); add bundle code-splitting (`manualChunks`/dynamic import).

**Phase 4 — production readiness**
- Real provider wiring (Stripe/SendGrid/Twilio/FreeRADIUS/OLT) behind deploy contract.
- Pilot ISP data-shape discovery; manual M0 staging smoke (12 steps); DR restore drill; load test (15k); pen-test; GDPR legal review.

---

## 14. Acceptance criteria (project = "clean")

1. `ruff check`, `tsc --noEmit`, `npm run build`, `python tools/check_drift.py`, **full `pytest`** all green **as blocking CI gates**.
2. gitleaks + RLS subset **blocking**; 0 secrets; full `gaahex_app` RLS suite green.
3. `requirements.lock` committed; CI builds from it; `pip-audit`/`npm audit` clean (or tracked exceptions).
4. `STUB_REGISTRY` proves every mock/stub is production-impossible or feature-gated, with boot guards + tests.
5. Distributable release package excludes all artifacts/secrets; CI check enforces it.
6. Catalog Layer locked (4 pending done); Q1 sealed.
7. No frontend file > ~800 LOC without justification; largest bundle chunk < 500 kB (or documented).
8. 0 production-visible "coming soon" pages; every nav item routes to a real/entity-backed/explicitly-disabled page.
9. 18-commit gap pushed; `origin/main` == local `main`.
10. Brand v3.0 + 70 standards + Constitution remain LOCKED and un-regressed (drift guard green).

---

*End of report. No code was modified. Pytest result is appended to §7 on completion.*
