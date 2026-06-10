# GAAhex — What's Left (mapped)

**Compiled:** 2026-06-10 · verified against repo (not just memory).
**Anchored on:** `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` + `memory/project_next_work_queue.md`.
**Method:** swept code markers (TODO/FIXME/stub/NotImplemented), skipped/xfail tests, doc backlogs
(`REMAINING-WORK.md`, `HANDOFF.md`, `docs/NEXT-WORK.md`, stabilization plan), and the M1 phase plan.
Stale references corrected at compile time (e.g. `HANDOFF.md` still said "Q1 ACTIVE" — Q1 is closed).

> This is a **snapshot map**, not a new source of truth. The canonical execution order stays
> `memory/project_next_work_queue.md`; this file is the wide-angle inventory behind it.

---

## ✅ Recently closed (boundary marker)

- **Q1.A + Q1.B** — GXL cross-record guard extension; addendum **SEALED 2026-06-10** (uncommitted, batched for next push).
- **Q5** — per-tenant feature flags (LOCKED 2026-06-05; KT-M1-5 green in `test_feature_flags.py`).
- **Q8** — RLS exemption policy (LOCKED 2026-06-05).
- **TD13** — `backend-rls` is a real HARD gate; CI-1 drift rule locks it from regressing (2026-06-10).
- **All of `REMAINING-WORK.md`** — R-01..R-10 + P (payment gateways) = ✅ DONE.

---

## 🎯 Critical path — M1 ship

| Phase | What | Status |
|---|---|---|
| 0 · Pre-flight | staging snapshot + M0 12-step smoke | ⏸ deferred watch-item (needs a tester) |
| 1 · backend-rls hardening | hard gate + drift lock | ✅ mostly (full-suite-under-`gaahex_app` is its own deferred milestone — conftest alembic rearchitecture) |
| 1.5A · GXL extension (Q1) | parser + resolver + KT-GXL-1 | ✅ DONE 2026-06-10 |
| 1.5B · per-tenant flags (Q5) | `tenant_flag.py` + KT-M1-5 | ✅ DONE |
| **2 · Real provider wiring** | A SendGrid · B Twilio · C Stripe · D RADIUS | ⏸ **next blocker** — adapters exist; live wiring + per-provider staging smoke + deploy-contract-real-boot remain |
| 3 · Custom entity catalog | 3–5 tenant entities, config-only (KT-M1-2) | ⏸ blocked on Pilot.Discovery + Q1.B (Q1.B now ✅) |
| 4 · Performance baseline | 10K cust / 25K svc / 100K inv / 250K pay (KT-M1-4) | ⏸ blocked on Phase 3 |
| 5 · Onboarding runbook | `docs/runbooks/M1-TENANT-ONBOARDING.md` (KT-M1-3) | ⏸ blocked |
| 6 · Pilot cutover | real money, real tenant | ⏸ external coordination |

### M1 killer tests (acceptance A2)
- ✅ KT-M1-5 (`test_m1_per_tenant_feature_flag_isolation`) — present.
- ✅ KT-GXL-1 (`test_gxl_cross_record_guard_evaluation`) — present (2026-06-10).
- ✅ **KT-M1-1** `test_m1_real_customer_lifecycle_config_only` — DONE 2026-06-10 (`test_api.py`; LEAD→PROSPECT→ACTIVE→SUSPENDED→ACTIVE→CHURNED, GXL guard + RBAC + audit, green).
- ✅ **KT-M1-2** `test_m1_provisioning_workflow_through_workflow_engine` — DONE 2026-06-10 (`test_api.py`; 7-stage provisioning arc, undeclared jump → 409, every stage audited, green).
- ⬜ **KT-M1-3** `test_m1_deploy_contract_real_providers_boot` — NOT written (writable now against the deploy contract).
- ⬜ **KT-M1-4** `test_m1_killer_under_realistic_data_shape` (`@pytest.mark.perf`) — NOT written (needs the Phase 4 seeded dataset first).

---

## 🟢 Ready to start now (no blockers — parallel-eligible)

- **Pilot.Discovery** — 🟡 framework authored at `docs/pilot/PILOT-DISCOVERY.md` (2026-06-10); **data half blocked on real pilot input** (`⬜ PILOT INPUT` markers). When Gev/pilot answer, it drives the Phase 3 entity list + Phase 2 provider selection.
- **KT-M1-3** — writable now against the deploy contract (real-provider boot shape).
- **KT-M1-4** — needs the Phase 4 seeded perf dataset first.
- **Q4 drift rule** — "no new entity-specific routes" HARD rule. M1 plan §12 Q4 marked resolved-in-plan; verified NOT yet built in `tools/check_drift.py`. Small, mirrors the CI-1 pattern.

## 📊 M1 readiness (post-2026-06-10 execution)

| Dimension | Level | Note |
|---|---|---|
| Architecture risk | **LOW** | Q1/Q5/Q8 closed; GXL sealed; no law violations; no entity-specific routes added. |
| Domain risk | **MODERATE** | Pilot.Discovery framework ready but unanswered — the real unknown until pilot input lands. |
| Provider integration risk | **MODERATE** | Adapters exist; live wiring (Phase 2) not started — deliberately deferred. |
| Pilot readiness | **MODERATE→HIGH** | Killer-test coverage now proves customer + provisioning shapes config-only; gated on Pilot.Discovery answers. |

**Next authorized milestone:** Phase 2.A (SendGrid) — *after* Pilot.Discovery confirms the pilot uses email + which providers are in first-cutover scope.

---

## 🐞 Real bugs (not deferrals)

- ✅ **BUG-WHK1 — FIXED 2026-06-10.** `DELETE /api/webhooks/{id}` → 500 once the webhook had `WebhookDelivery` rows (FK lacked `ON DELETE CASCADE`). Fixed: model `ondelete="CASCADE"` + migration `b3c4d5e6f7a8`; xfail removed, `test_delete_webhook_with_deliveries` now a mandatory green path.

---

## 🧊 Deferred / non-blocking backlog

- **Tech-debt (queue):** TD1-6 / TD10 / TD12 / TD14 / TD15 (GXL action-expr parser gap).
- **Stabilization plan** (~63 items): T-P2 primitives (DetailTab, Pagination, ConversationRow, StudioDrawer, EmptyState/Card dedup, TERTIARY Button, 9-tab unification), T-P3 token discipline (~2,300 sites: breakpoints, 44px tap-min, hex→token, btn/inp/layout/spacing), modal/drawer consolidation.
- **41 dashboard charts** — `implemented: false` in `dashboard-catalog.ts` (visible to users as "coming soon").
- **`docs/NEXT-WORK.md` parked:** richer demo data · HouseNet on-prem deploy prep · token long-tail · full ISP lead form (50+ fields).
- **Catalog Layer** (API / Event / Page / Integration catalogs) — sits behind Track C.
- **Track C** — Product & UX research (paused).
- **Architecture residual** — Knowledge / Decision Support / OSS licensing / AI acceptable-use (future LAW-GV1 candidates; non-blocking).
- **`catalog_entity_status_null`** — entities with no status-type field create with `status=NULL` ("later we talk").
- **OLT / RADIUS real backends** — `NotImplementedError` stubs (FreeRADIUS, NETCONF/SNMP transport); OLT vendor drivers exist with hardware integration tests `xfail`-ed to post-M1-B.

---

## 🔌 External-blocked (needs Gev / third parties)

- Payment merchant credentials: ARCA / iDram / TelCell / EasyPay + Stripe **live** keys.
- SendGrid / Twilio / FreeRADIUS production account credentials.
- Pilot ISP cutover scheduling.
- Manual M0 staging smoke (needs a human tester).

---

## One-line read

The M0 thesis is proven and stable; M1's architecture decisions (Q1 / Q5 / Q8) are all closed. What
remains is **execution**: critical path = Phase 2 (real providers) → Phase 3 (pilot entities) →
cutover, with Pilot.Discovery and the 4 remaining killer tests runnable in parallel. Everything else
is non-blocking backlog or external-blocked.
