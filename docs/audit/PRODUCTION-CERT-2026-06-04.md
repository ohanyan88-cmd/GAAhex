# GAAhex — Production Certification Audit

**HEAD**: `f4874a6`
**Date**: 2026-06-04
**Mode**: Code-only static audit, all 36 domains
**Auditor**: 8 specialist parallel audit packs + orchestrator synthesis

---

# Executive Summary

**Final verdict: NO-GO**

GAAhex has strong foundations — Wave 1/3/4 RLS coverage is complete (115 tenant-scoped tables, all policied), DB-level append-only triggers protect financial documents and the Event audit log, the production deploy contract refuses to boot with the wrong DB role split, Fernet field-encryption works, JWT-token tenant binding is enforced, Dockerfile hardening (non-root, tini, healthcheck) is correct, and the comprehensive DR runbook (`OPS-BACKUP.md`) is exemplary. D6 Tenant Isolation in particular CLEARS the production gate cleanly.

But across the other 35 domains the audit surfaced **27 Critical findings, 32 High findings, 33 Medium, and 14 Low** — a mix of code-correctness races, financial-integrity gaps, observability holes, compliance failures, and operational-readiness misses. Multiple categories trigger Gev's own NO-GO rules:

- **Financial integrity failures** (multiple): Stripe webhook lacks currency validation; usage rating runs `float` math; auto-PAID flip ignores `refunded_amount`; `mint_new_version` has a read-modify-write race on concurrent product edits; `settle_order` and `allocate_payment` both race on writes without `with_for_update`; credit-note numbering uses race-prone `COUNT(*)+1`; the physical `credit_note` + `payment_allocation` tables lack the SPEC §0.3 DELETE-blocking triggers.
- **Critical security gaps**: webhook receivers (Stripe/Twilio/SendGrid) silently fall back to mock gateways with no signature verification in production if the provider env var is misconfigured; deactivated users can still log in and refresh tokens; portal sessions stored in `localStorage` are stealable via the unescaped HTML in `portal_billing.invoice_document` / `payment_receipt`; no CSP header; public `/org-tree` leaks all tenants + org structure.
- **Token failures**: portal tokens have no revocation mechanism (no logout, no refresh, no `tnbf`); refresh-token replay does not revoke the session family; refresh path doesn't reject inactive users; API keys have no expiry, no scope.
- **Auditability failure**: the auth router emits ZERO Event entries — login success, login failure, password change, token rotation, logout all have no audit trail. The most security-critical operation in the system is invisible to SuperAdmin's audit-log view.
- **Restore failure**: `OPS-BACKUP.md` documents the backup procedure beautifully but the script itself is NOT committed — `scripts/backup-nightly.sh` doesn't exist. First-customer install has no runnable automation.
- **Data corruption risk**: `mint_new_version` race + missing partial-unique index `WHERE effective_to IS NULL` can produce two open product_version rows simultaneously; `current_version_for` then returns ambiguous results inside the overlap window — court-facing "what did this product cost" can return two different answers.
- **Operational missing pieces**: FreeRADIUS backend is `NotImplementedError`; OLT driver is never invoked from service-activation; warehouse/inventory subsystem doesn't exist; import-engine is a metadata-only stub.

**Final certification**: **NO-GO**.

---

# System Risk Score: 78/100

(Higher = worse.) Heavy weight from financial-correctness gaps (D7/D8), the workflow-engine duplication (D1), the unbounded list endpoints (D25), and the auth-audit blind spot (D27). RLS coverage + DR runbook + container hardening pull the score down from the 85+ band but don't compensate for the systemic concurrency weakness across financial paths.

# Production Readiness Score: 28/100

(Higher = better.) Architecture has real merit but is not deployable as-is. Once the 27 Critical findings + the audit + observability + GDPR gaps are closed, this score lifts to the 55–65 band; full Stage-7+ work (multi-node, HA, M1-B WAL archiving, M1-C webhook auto-retry, M1-D warehouse module) brings it to 75–80.

---

# Domain-by-Domain Results

| # | Domain | PASS | FAIL | NOT TESTED | Critical | High | Medium | Low |
|---|---|---|---|---|---|---|---|---|
| D1 | Architecture | 0 | 9 | 0 | 2 | 3 | 4 | 0 |
| D2 | Clean Code | 1 | 8 | 0 | 1 | 2 | 4 | 1 |
| D3 | Correct Code | 0 | 13 | 0 | 3 | 3 | 6 | 1 |
| D4 | Security | 7 | 9 | 1 | 2 | 4 | 3 | 0 |
| D5 | Tokens | 5 | 7 | 1 | 1 | 2 | 4 | 0 |
| D6 | **Tenant Isolation** | **19** | **1** | **0** | **0** | **0** | **1** | **0** |
| D7 | Date / Time | 5 | 4 | 1 | 1 | 3 | 0 | 0 |
| D8 | Billing | 5 | 7 | 1 | 5 | 2 | 0 | 0 |
| D9 | Customer Lifecycle | 2 | 2 | 0 | 0 | 1 | 1 | 0 |
| D10 | Network/ISP Ops | 0 | 3 | 0 | 3 | 0 | 0 | 0 |
| D11 | Inventory | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| D12 | Ticketing/Workforce | 1 | 3 | 0 | 0 | 1 | 2 | 0 |
| D13 | API | 1 | 4 | 0 | 0 | 0 | 2 | 2 |
| D14 | UI | 1 | 3 | 0 | 1 | 1 | 1 | 0 |
| D15 | Reporting | 1 | 1 | 0 | 0 | 0 | 1 | 0 |
| D16 | Search | 2 | 0 | 0 | 0 | 0 | 1 | 1 |
| D17 | File / Document | 1 | 3 | 1 | 0 | 1 | 2 | 0 |
| D18 | Notification | 3 | 1 | 0 | 0 | 0 | 1 | 1 |
| D19 | Queue / Job | 2 | 2 | 0 | 0 | 0 | 1 | 1 |
| D20 | Cache | 1 | 0 | 1 | 0 | 0 | 1 | 0 |
| D21 | Migration | 7 | 7 | 0 | 1 | 5 | 3 | 0 |
| D22 | Observability | 0 | 4 | 0 | 1 | 3 | 0 | 0 |
| D23 | Backup (code-level) | 1 | 1 | 0 | 1 | 0 | 0 | 0 |
| D24 | DR (code-level) | 1 | 1 | 0 | 0 | 0 | 1 | 0 |
| D25 | Performance (static) | 0 | 5 | 0 | 2 | 2 | 1 | 0 |
| D26 | Chaos (code-level) | 2 | 1 | 0 | 0 | 0 | 1 | 0 |
| D27 | Audit / Forensics | 1 | 2 | 0 | 1 | 0 | 1 | 0 |
| D28 | Deployment (config) | 4 | 2 | 0 | 1 | 0 | 1 | 0 |
| D29 | Compliance / Privacy | 1 | 3 | 0 | 2 | 1 | 0 | 0 |
| D30 | Admin Tools | 2 | 1 | 0 | 0 | 1 | 0 | 0 |
| D31 | Deletion / Retention | 1 | 2 | 0 | 0 | 1 | 1 | 0 |
| D32 | Import / Export | 2 | 2 | 0 | 1 | 1 | 0 | 0 |
| D33 | Integration | 4 | 1 | 0 | 0 | 0 | 1 | 0 |
| D34 | Configuration | 0 | 2 | 0 | 0 | 1 | 1 | 0 |
| D35 | Business Continuity | 1 | 1 | 0 | 0 | 1 | 0 | 0 |
| D36 | Final Go/No-Go | — | — | — | — | — | — | — |
| **Total** | | **84** | **120** | **6** | **27** | **32** | **33** | **6** |

---

# Critical Findings (all 27)

## Financial / Correctness
1. **D8 — Stripe webhook lacks currency validation** (`backend/app/services/payments/stripe_events.py:148`) — cross-currency charge stored as AMD luma → massive undercharge.
2. **D8 — Usage rating runs `float(quantity * unit_rate)`** (`backend/app/routers/usage.py:40,110`) — violates Phase A.1 Decimal-only money doctrine.
3. **D8 — Auto-PAID flip ignores `refunded_amount`** (`billing_payment.py:171-175`, `stripe_events.py:173-178`, `payment_gateway.py:275-287`) — post-refund invoice stays PAID even when net collected < total.
4. **D7/D21 — `mint_new_version` race + missing partial unique** (`backend/app/services/product_versions.py:97-128`) — two concurrent product edits can produce two open versions; `current_version_for` becomes non-deterministic.
5. **D8 — `_next_credit_note_number` uses `COUNT(*)+1`** (`routers/credit_notes.py:74`) — race-prone numbering despite safe sequence helper existing in `utils/refnum.py`.
6. **D8 — Physical `credit_note` + `payment_allocation` tables lack DELETE triggers** (alembic `b8e4d2f7a1c9`) — SPEC §0.3 financial-immutability invariant violated.
7. **D3 — `settle_order` race** (`backend/app/payment_gateway.py:253-296`) — concurrent webhook callbacks can double-insert Payment + double-flip invoice; no `with_for_update`.
8. **D3 — `allocate_payment` race** (`backend/app/services/payment_allocation.py:76-148`) — concurrent allocations can over-allocate against one Payment; no DB constraint catches it.
9. **D3 — Reference-number races repeat in 3 routers** — same COUNT+1 pattern in `imports_exports.py:106,115` despite `next_reference_number` available.

## Security
10. **D4 — Stripe/Twilio/SendGrid webhook silent fallback to mock** (`services/payments/factory.py:81-95`, `services/comms/factory.py:82-86,141-147`) — production deploy with misconfigured provider gives free webhook-signature bypass.
11. **D4 — Deactivated users can still log in + refresh** (`routers/auth.py:82-131`, `routers/users.py:288-292`) — soft-delete doesn't kill sessions; refresh tokens not revoked on deactivation.
12. **D14 — Portal token in `localStorage`** (`frontend-portal/src/lib/api.ts:2-13`) + **portal HTML XSS** (`routers/portal_billing.py:145-176, 276-289`) — combined → account-takeover chain.
13. **D5 — Portal has no token revocation** (`routers/portal_auth.py`) — no logout, no refresh, no `tnbf`; stolen portal token valid up to 60 minutes untouchable.
14. **D5 — Refresh-token replay does NOT revoke session family** (`routers/auth.py:104-131`) — token theft becomes invisible; attacker keeps refreshing while victim re-logs in.
15. **D5 — Refresh path does NOT reject inactive users** — same root cause as D4 #11, restated for token scope.

## Architecture / Code Quality
16. **D1 — Two parallel workflow engines** — `app/workflow.py` (437 LOC) + `app/kernel/workflow_engine.py` (585 LOC) overlap on audit, actions, notifications. Records.py uses one; kernel.trigger_workflow uses the other.
17. **D1 — `main.py` 22 KB single-line router-include block** (lines 53, 187-292) — no module composition, order-dependent registration, can't disable a feature without editing main.
18. **D2 — God files >1,000 LOC**: 18+ files including `OrgView.tsx` (2,078), `services/olt/drivers/vsol_v1600.py` (1,290), `routers/analytics.py` (1,128), `routers/notifications.py` (1,029).
19. **D3 — Idempotency middleware TOCTOU** (`middleware/idempotency.py:96-184`) — two simultaneous requests with same Idempotency-Key both run the handler before either INSERTs; double side-effect possible on concurrent retries.

## Audit / Compliance
20. **D27 — Auth events emit ZERO audit entries** (`routers/auth.py:82-145`) — login success, login failure, password change, token rotation all invisible to SuperAdmin audit-log view.
21. **D22 — PII in INFO logs** (`backend/app/channels.py:51,57,63,69`) — full email body, phone numbers, recipient addresses logged at INFO. GDPR Art. 32 violation.
22. **D29 — GDPR right-to-access not built** (per `docs/PRE-LAUNCH-CHECKLIST.md:84`).
23. **D29 — GDPR right-to-erasure not implemented** — `lifecycle.py:340-363` PURGED state only flips a column; no actual deletion happens.

## Operations / Readiness
24. **D23 — No backup script committed** — `OPS-BACKUP.md` documents the procedure; `scripts/backup-nightly.sh` doesn't exist in the repo.
25. **D25 — Generic records list reads entire entity into memory** (`routers/records.py:216-258`) — Python-side pagination on full result. Will not survive 15k subscribers under load.
26. **D25 — `pagination.DEFAULT_LIMIT = None`** — unbounded by default across the API.
27. **D28 — No backend service in `docker-compose.yml`** — only `db` + `redis`; first-customer install has no committed orchestration.

## ISP Operations (functional gaps that block service delivery)
- **D10 — FreeRADIUS backend is `NotImplementedError` stubs** (`services/radius/freeradius_backend.py:70-95`) (Critical)
- **D10 — RADIUS backend never wired** to service-lifecycle / install-board (Critical)
- **D10 — OLT driver never called** from install_board.activate_service (Critical)
- **D32 — Import engine is a metadata-only stub** (`routers/imports_exports.py:272-314`) (Critical)

---

# Production Blockers (ranked)

## Immediate blockers (Critical + Tenant-Iso-leak + Financial-integrity + Token + Compliance)

1. **D8 — All financial-correctness criticals** (#1–#9 above): Stripe currency, usage float, refunded_amount flip, mint race + partial unique, CN COUNT+1, missing DELETE triggers, settle_order race, allocate_payment race.
2. **D4 — Webhook signature mock-fallback in production** (#10).
3. **D4 — Deactivated user can still log in + refresh** (#11).
4. **D14 — Portal token + portal XSS chain** (#12).
5. **D5 — Portal token revocation missing** (#13).
6. **D5 — Refresh family revocation missing** (#14).
7. **D27 — Auth audit blind spot** (#20).
8. **D22 — PII in INFO logs** (#21).
9. **D29 — GDPR right-to-access + right-to-erasure missing** (#22, #23).
10. **D23 — Backup script not committed** (#24).
11. **D25 — Unbounded-list scaling cliff** (#25, #26).
12. **D28 — `docker-compose.yml` missing backend service** (#27).
13. **D10 — RADIUS + OLT not wired** — cannot deliver ISP service.
14. **D32 — Import engine missing** — silent data loss on day-1 customer migration.
15. **D9 — GDPR erasure not real** — PURGED is decorative.

## High priority (close before first revenue customer)

- **D4 — No login brute-force throttle** (`config.py:26-27` rate-limit-off by default; in-process counter only).
- **D4 — Public `/org-tree`** leaks all tenants + org structure (`main.py:307-330`).
- **D4 — Password change doesn't revoke refresh tokens** (`routers/me.py:79-98`).
- **D4 — Cross-tenant user enumeration** via globally-unique `User.email` + 409 message (`models/user.py:23`).
- **D17 — Content-Disposition filename injection** (`routers/attachments.py:326`).
- **D14 — No CSP header**.
- **D12 — WorkItem `/assign` IDOR** (`routers/workitems.py:353-387`).
- **D11 — Warehouse / inventory subsystem missing** (per nav-backlog memory).
- **D34 — Configuration JSONB writes have no schema validation**.
- **D7 — `_parse_dt` accepts tz-naive datetimes** → run_dunning crash (`_billing_shared.py:286-295`).
- **D7 — `_add_cycle` Feb 29 anchor loss**.
- **D7 — Dunning step timing from `now()` not opened_at**.
- **D21 — `CREATE INDEX` blocking on populated tables** (no `CONCURRENTLY` anywhere).
- **D21 — FK `ondelete=` discipline missing** on most pre-Wave-1 FKs.
- **D21 — Anonymous FK names** in `3aaf9ce9edeb` → downgrade fails.
- **D21 — Event-table immutability vs deferred backfill** — backfill plan is impossible.
- **D22 — No structured logging, no request-id, no error tracker** (#22 series).
- **D25 — `customer_360` does 3× full-record-table scans**.
- **D27 — Audit retention policy not encoded**.
- **D29 — No PII tagging on model fields**.
- **D31 — Hard-delete path doesn't exist** (PURGED state decorative).
- **D32 — CSV/XLSX/PDF export lacks formula-injection mitigation** (`routers/export.py:88-96`).
- **D35 — Single Postgres + single Redis, no failover declared**.

## Medium priority (close before SaaS scale)

- **D1 — Frontend has no module composition** — every view loaded eagerly; nav-config is hardcoded.
- **D1 — Kernel leaks into delivery layer** — `kernel/workflow_engine.py:407` imports `routers/notifications`.
- **D1 — `kernel/kpi_engine.py:382` commits the session** — violates "kernel never commits".
- **D1 — `scheduler.py` couples engine to routers** — runs HTTP handlers as job bodies.
- **D2 — 163 `any` usages across 50 frontend files** — type system effectively disabled in half the views.
- **D2 — 31 `eslint-disable`/`ts-ignore`/`ts-expect-error`** across 18 frontend files.
- **D2 — 140 `# noqa` annotations** across 59 backend files (most legitimate, but density high).
- **D2 — Hardcoded business thresholds** (`billing_invoice.py:86` 20% high_discount; `kernel/invariants.py:138` FIRST_CLASS_OWNER_MAP; `kernel/approvals.py:69` MANDATORY_APPROVAL_ACTIONS; `ai.py:142` lead-score deltas).
- **D3 — Only 1 `with_for_update` in the entire backend** (`services/install_board.py:83`).
- **D3 — No `version_no` / optimistic-locking column** on any first-class table.
- **D3 — Scheduler runs without distributed lock** — multi-instance double-execution risk.
- **D6 — `portal_billing.py:268` `select(Tenant)` defense-in-depth gap** (safe under prod RLS, broken in dev superuser).
- **D8 — Stripe webhook doesn't validate amount ≤ outstanding** before flipping invoice.
- **D12 — Hardcoded SLA defaults + ticket priorities + statuses** in router code.
- **D13 — CORS default `*`** not blocked in production contract.
- **D13 — Rate limiter is in-process only** — ineffective behind multi-worker uvicorn.
- **D13 — Many writes take `dict` payloads** — Pydantic schema lost.
- **D17 — No magic-byte content sniffing** on uploads; no AV scan.
- **D17 — No signed-URL storage backend** — `LocalDiskBackend` only.
- **D19 — Scheduler uses OwnerSession without `set_tenant_guc`** — every handler must remember the tenant filter; defense-in-depth.
- **D21 — `c4a1b5e7d29f` NOT NULL alter on `service.product_id`** relies on backfill from earlier revision.
- **D24 — RPO 1h target / 24h actual** until WAL archiving lands (documented gap).
- **D25 — No `selectinload`/`joinedload` used** anywhere — N+1 patterns latent.
- **D25 — FK indexing coverage incomplete** (~47 of 312 FK columns indexed).
- **D26 — No circuit breaker / no exponential backoff with jitter**.
- **D31 — Retention windows not configurable**.
- **D34 — Studio publish snapshot validation missing** on save AND rollback.

## Future improvements

- D1 — Standards index claims 70 standards; only 22 files exist (rename/split for clarity).
- D2 — `_node_path` / `_paginate` cross-router imports (underscore convention violated).
- D5 — JWT lacks `iss`/`aud` claims; `payload.update(extra)` can overwrite reserved.
- D5 — API keys have no expiry, no scope.
- D5 — Bcrypt cost factor default (12) is fine; consider 14 once perf budget allows.
- D7 — `current_version_for` tz-naive crash latent.
- D8 — `_credited_total` legacy O(N) over all credit notes per issue.
- D8 — luma/Decimal unit-system fork is documentation-only; needs programmatic assertions at boundaries.
- D9 — Customer hard-delete via `/api/{slug}/{id}` bypasses lifecycle soft-delete.
- D14 — Operator `GlobalSearchView` uses `dangerouslySetInnerHTML` (verified safe but worth comment).
- D17 — When MinIO/S3 backend lands, tenant-prefixed key convention must be honored (write contract test).
- D18 — No explicit CRLF reject on email To/Subject.
- D19 — Webhook delivery is single-attempt; no retry / DLQ for outbound webhooks (Phase 1 design).
- D20 — Future Redis cache must use tenant-namespaced keys + TTLs.
- D22 — Audit-retention category + sweep job.
- D28 — Make secret-scan + dep-audit blocking on `main` instead of `continue-on-error`.
- D30 — Add audited impersonation endpoint before first support escalation.

---

# Final Certification

# NO-GO

Triggers per the audit's own rules:
- 27 Critical findings (any one ≥ NO-GO).
- Financial integrity failure (multiple D7/D8 race + correctness issues).
- Token failure (multiple D5 issues).
- Critical security issues (multiple D4 issues).
- Auditability failure (D27 — auth blind spot).
- Restore failure (D23 — backup script not committed).
- Data corruption risk (D7/D21 mint race).
- Tenant isolation: D6 cleared (1 defense-in-depth Medium FAIL only, not a leak).

When the Immediate Blockers section is closed and re-audited, the verdict can advance to CONDITIONAL GO pending the High-priority list. A GO verdict requires all High items closed + a real-world layer (load test at 15k subs, restore drill, pen-test, GDPR audit signed) which is out of scope for code-only certification.

---

# Coverage caveats

- Audit was sample-based per pack (some packs covered 8 of 36 domains in one pass).
- D11 had nothing to sample (warehouse subsystem absent) — finding is "absence".
- D23/D24/D25/D26 audited at code/config level only (no actual restore drill, load test, fault injection).
- D6 cleared cleanly — single domain audited deeply.
- ~14 of ~110 routers and ~3 of ~6 portal views read end-to-end. Remaining sampled via grep for tenant_id filters, html escaping, timeouts. D13 systemic `dict` payload pattern documented as a follow-up sweep.
- D36 Final Go/No-Go is this synthesis step itself — not a separate audit subject.

— GAAhex Production Cert Audit, 2026-06-04, HEAD `f4874a6`
