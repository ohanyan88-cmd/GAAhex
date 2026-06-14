# HARD AUDIT — GAAhex Production-Readiness — 2026-06-14

> **Purpose:** a brutal, ground-truthed audit to get GAAhex production-ready for the pilot ISP ("the
> house") by Monday — tests green, every prior critical re-verified in code, all proofs file:line.
> Method: full backend test run + 4 parallel deep code audits (security · financial · data/lifecycle ·
> ops/provisioning), each re-verifying the project's own prior audit corpus against the CURRENT tree
> (HEAD `968aa20`). Read-only; nothing mutated.

---

## VERDICT / ՎՃԻՌ

**EN: Control plane is production-ready for the back-office BSS pilot, and the test suite is GREEN
(`1921 passed · 0 failed · 0 errors`).** The weekend remediation closed every code/config MUST-FIX. Two of
this audit's own headline findings were **over-flagged** and corrected on verification: the "RLS gap on 18
tables" was really **17 already-protected + 1 intentionally-exempt** table (`stripe_webhook_event`), and
"drop /100, luma everywhere" was actually a trigger whose `÷100` made the **prod payment-allocation path
100%-broken** (the suite missed it because `create_all` carries no triggers) — fixed luma-to-luma. The
**customer state-machine break was REAL and is fixed** (collapsed to SPEC §7 `ACTIVE/SUSPENDED/TERMINATED`,
verified end-to-end). FIN-2 (FOR UPDATE on PAID-flip), the compose `ENVIRONMENT` fail-open footgun, the
legacy-comms + rate-limit deploy gates, and a drift rule that mechanically enforces single-source-of-truth
are all in. A status **drift rule** caught three more pre-existing inconsistencies during the work.

**HY: Control-plane-ը back-office BSS pilot-ի համար production-ready ա, ու test-suite-ը GREEN ա
(`1921 passed · 0 failed · 0 errors`)։** Շաբաթ-կիրակվա remediation-ը փակեց ամեն code/config MUST-FIX։ Այս
աուդիտի երկու գլխավոր գտածո **over-flagged** էին ու ուղղվեցին՝ «18 RLS-անցք»-ը իրականում **17 արդեն protected
+ 1 միտումնավոր exempt** էր, իսկ FIN-1-ը՝ trigger, որի `÷100`-ը prod-allocation-ը **100% կոտրել էր** (fixed)։
**Customer-ի state-machine-ի break-ը ԻՐԱԿԱՆ էր ու սարքված ա** (`ACTIVE/SUSPENDED/TERMINATED`, verified)։ FIN-2,
compose-ի fail-open footgun-ը, comms+rate-limit deploy-gate-երը, ու single-source-of-truth drift-rule-ը՝ բոլորը in։

**Follow-up closure (2026-06-14, post-seal — Gev: "go do all"):** the three software follow-ups are now CLOSED.
**B1b** — lead + order UPPER-cased to SPEC §7 across the whole stack (seeds, provisioning core incl. install_board,
convert, AI scorer/agent, KPIs, kanban, frontend action paths) + a deterministic `leadorderupper` Alembic
migration (record.status / "order".status / status_def.key / workflow_def transitions), applied + verified on the
dev DB (all UPPER, drift-clean). The drift rule's casing exception is **removed — there is now NO exception**, every
canonical entity is UPPER_SNAKE. **E1b** — the email/SMS deploy gate now *construct-checks* the real gateway config
(SMTP_HOST / Twilio creds), closing the silent fall-back-to-no-op gap (parity with the RADIUS construct gate).
**OPS-5** — durable `gaahex_uploads` volume (fixes attachment loss on container recreate), pgdata image-pin
guidance, and a ready Caddy auto-HTTPS prod overlay (`docker-compose.prod.yml`). Full suite re-run **GREEN
(`1921 passed · 0 failed · 0 errors`)**; frontend `tsc --noEmit` clean. Still Gev-side / hardware: prod secrets +
TLS domain, and RADIUS-real + OLT-on-hardware (Monday).

**Overall: GO** for the hardened back-office BSS pilot (control plane). **Internet activation (RADIUS + OLT data
plane) remains BLOCKED** on Monday's infra params + on-site hardware + days of work — unchanged, and outside
what code can close.

**Seal: CERTIFIED (control-plane / back-office BSS pilot). Tests green; every code/config MUST-FIX closed +
verified. Internet-activation data plane still pending hardware. — Bro, 2026-06-14.**

---

## 1. TEST SUITE — full run (HONEST)

**Final (post follow-up closure): `1921 passed · 0 FAILED · 0 ERRORS · 74 skipped · 3 xfailed` in 9m09s — GREEN.**
(1919 → 1921 = the two new E1b construct-check gate-fires tests. The B1b lead/order UPPER migration touched
40+ files incl. the provisioning core and was proven green by the e2e loop, order-transition, and install-board
suites; frontend `tsc --noEmit` is clean.)

The original run's "5 failed + 29 errors" were a **non-deterministic test fixture bug**, not product: portal
fixtures picked the tenant via `select(Tenant).first()` while portal login binds to the demo tenant (oldest) —
in the full suite a probe tenant won the race → `KeyError: 'access_token'`. Fixed across 44 fixtures (26 files)
→ `order_by(Tenant.created_at)`. A later transient (drift test leaking a per-connection `audit_tenant_filter`
option onto the pool) was root-caused and fixed with the per-statement form. The suite is now deterministic-green.

---

## 2. SECURITY & TENANT ISOLATION — CONDITIONAL GO

**Closed (re-verified in code):** all prior auth/session/token criticals — deactivated-user login+refresh
reject (`routers/auth.py:188-191,264-265`), refresh rotation + replay → family revocation (`auth.py:240-252`),
password-change token revoke (`auth.py:128-139`), auth audit events (login/fail/logout/refresh/replay),
API-key expiry+scope, JWT tenant binding. RLS: 80+ tenant tables policied, default-deny on empty GUC,
app role NOSUPERUSER/NOBYPASSRLS + boot backstop (`db.py:88-114`, `main.py:87-89`), GUC wiped on checkin,
proven by `test_rls*` under the real `gaahex_app` role. Secrets/boot gates, CORS, portal-cookie, payment
kill-switch, webhook signatures (Stripe/Twilio/SendGrid), IDOR (create-time FK validation + fuzzer) — all
closed. **The core security posture matches the prior reports' best claims.**

**OPEN — blocking:**
- **SEC-1 [HIGH]** Legacy `channels.py` email/SMS path is **NOT gated** by the deploy contract. It's the live delivery path for notifications/dunning/digests/report-schedules/messaging, keyed on the **legacy** `email_provider`/`sms_provider` (default `"dev"` = console). Prod boots clean and **silently drops** dunning notices / receipts to the console. (`config.py:80,88`, `channels.py:365-382`; callers `notifications.py:209`, `digests.py:253`, `report_schedules.py:352`.)
- **SEC-2 [MED→HIGH]** M1-C email/SMS deploy contract only **string-checks** the provider name; unlike RADIUS it never **constructs** the gateway. `email_gateway_provider=sendgrid` with a bad/missing key passes boot, then falls back to **mock** at first send (`comms/factory.py`). Fix = construct-check parity with RADIUS (`config.py:359-376`).
- **SEC-3 [HIGH]** Rate limiting is **off by default + in-process only** (`config.py:29`, `apikeys.py:166`). No login brute-force throttle. (Single uvicorn worker today, so in-process is tolerable IF turned on; never scale workers without a Redis-backed limiter.)
- **SEC-4 [MED]** SendGrid inbound webhook signature is **optional** (skipped when public key unset) and the contract doesn't assert the key (`vendor_webhooks/sendgrid.py:122-127`).

---

## 3. FINANCIAL INTEGRITY — CONDITIONAL GO

**Closed (re-verified, each with a proving test):** all 9 prior financial criticals (F1-F9) — Stripe
currency lock-in + amount≤outstanding (`stripe_events.py:163-187`), refund-aware PAID flips (3 sites),
`mint_new_version` advisory-lock + partial-unique (`product_versions.py:104-138`), reference numbering via
Postgres SEQUENCE everywhere (`utils/refnum.next_reference_number`), credit-note/payment-allocation
DELETE-immutability triggers, **settle_order 3-layer race fix** (`FOR UPDATE` + idempotent + partial
unique), allocate-payment `FOR UPDATE` + guard, usage Decimal discipline. Decimal-vs-float: clean.

**OPEN — blocking:**
- **FIN-1 [CRITICAL]** **Unit-of-account contradiction** in payment allocation. App treats `PaymentAllocation.amount` as **luma** (`payment_allocation.py:204-206`, no scaling; tests allocate `"10000"` vs 10000-luma payment expecting 200). But the DB trigger `enforce_payment_allocation_total` does `payment.amount::NUMERIC / 100` — treating allocations as **drams** (migration `e1a4b2c3d5f7:140-143`). The two are irreconcilable: the trigger's threshold is **100× too low** → the over-allocation DB backstop is **non-functional / mis-firing**. (Note: the full suite passing means the trigger is likely **inert** on the tested path — which itself means the touted "DB second line of defense" isn't actually firing. Must reconcile before real money: pick luma everywhere → drop the `/100`.)
- **FIN-2 [MED]** Stripe `payment_intent.succeeded` + legacy `add_payment` don't `FOR UPDATE` the invoice before the net-paid read + PAID flip (only `settle_order` does). Two distinct payments on one invoice aren't serialized (per-event idempotency exists; per-invoice doesn't). (`stripe_events.py:177-215`, `billing_payment.py:173-175`.)
- **FIN-3 [LOW]** `routers/configurations.py:128-133` still uses `COUNT(*)+1` (non-financial, UNIQUE-backstopped — lone holdout).

---

## 4. DATA, SCHEMA & LIFECYCLE — NO-GO (the headline finding)

**Root cause:** `workflow.py:30 find_transition` matches `record.status` against the transition `from`
with an **exact case-sensitive compare** — and the platform seeds **THREE disjoint, competing status
vocabularies** onto the same entity defs (SPEC §7 UPPER_SNAKE via `seed_statuses.py`; the config StatusDefs
via `seed.py`/`seed_catalog.py`; the lowercase "iron-rule" SST via `seed_lifecycle_statuses.py` which
DELETES + replaces). Records, StatusDefs, transitions, and model defaults disagree.

**BLOCKING:**
- **DATA-1 [BLOCK] customer** — records seeded `status="ACTIVE"` (`seed_demo_loop.py:112`) / `"monitoring"` (`seed_dev_bulk.py:380,390`); StatusDefs are lowercase `active/suspended/terminated` (`seed.py:380-387`). `ACTIVE≠active`, `monitoring`∉set → **customer can never be suspended/terminated.** *(This is the bug I hit live in the Index pilot — it's a CLASS, not a one-off.)*
- **DATA-2 [BLOCK] order** — records seeded `status="COMPLETED"` (`seed_demo_loop.py:128`, `seed_dev_bulk.py:459`); not in the order set (`order_created/...activation/cancelled`, `seed_catalog.py:178-185`). Order stuck, no outbound transition.
- **DATA-3 [BLOCK/HIGH] ticket/helpdesk_ticket** — two merged status sets (`seed.py:426` OPEN/IN_PROGRESS/RESOLVED **vs** `seed_statuses.py:291-298` NEW/ASSIGNED/.../CLOSED) on the same def → double-initial risk; records use `OPEN` ∉ the SPEC set.
- **DATA-4 [BLOCK — SECURITY] RLS coverage gap.** **18 tenant-scoped tables carry `tenant_id` but have NO RLS policy and NO registered exemption:** `feature_flag`, `tariff_plan`, `mail_account/folder/message/attachment`, `mass_broadcast`, `cpe_binding`, `radius_session`, `stripe_webhook_event`, `fiber_route`, `page_binding`, `service_action_log`, `dunning_policy`, `otdr_test`, `optical_power_sample`, `ra_finding`, `ra_scan_run`. Under the prod `gaahex_app` (NOSUPERUSER) role, RLS-off = **cross-tenant readable** (tariff pricing, mailbox content, subscriber sessions/devices leak across tenants). **The parametric RLS test gives a FALSE GREEN** — `test_rls_parametric.py:316` creates the policy *inside the test* before asserting, so it proves "a policy *would* isolate," not "the migration enabled it." (Exemption registry is empty.)

**HIGH/MED:** work_order/workitem records `TODO`/`OPEN`∉set (HIGH); lead SPEC-set vs iron-rule-set
divergence + contradicts locked standard file 16 (HIGH); model/SPEC drift on service (`TERMINATED` vs
`DISCONNECTED/...`), invoice (`VOID` vs `CANCELLED/CREDITED/SENT/PARTIALLY_PAID`), subscription `ACTIVE`
vs party/account `active` casing split (MED); stale phantom `PROVISIONING` in `models/order.py:78` docstring
(MED, live code uses `installation`).

**Drift checker:** currently **RED** — `python tools/check_drift.py` → exit 2 (3 cosmetic RATCHET
regressions, stale baseline). And **no drift rule covers status casing/membership** → every DATA-* bug
above is invisible to the gate. The single highest-leverage fix is a rule diffing seeded record `status` ∪
transition `from/to` against the StatusDef keys per entity.

**B1 (UPPER_SNAKE):** lead/customer/order seeds + the iron-rule keep-set are lowercase, violating the
locked standard; `order` is the lone catalog entity that went lowercase.

---

## 5. OPS & PROVISIONING — control plane READY · data plane NO-GO

**READY (verified):** backups (`scripts/backup-nightly.sh` / `backup-offsite.sh` / `restore-verify.sh` —
real, complete, match OPS-BACKUP.md); deploy contract / fail-closed boot; **GDPR erasure is REAL**
(`services/privacy.py:260-335` anonymizes PII in-place + revokes portal sessions, not a column flip);
**PII not leaked in logs** (`channels.py:87-107` redacts); health/observability/request-id/security-headers;
`.env.production.example` complete. **`activate_service` OLT wiring (the recent P1 change) is REAL** —
resolves the splitter→OLT target, calls `set_vlan`+`provision_onu` inside a rollback-guarded block.

**BLOCKING:**
- **OPS-1 [SHOWSTOPPER — internet]** RADIUS is a `NotImplementedError` stub (`radius/freeradius_backend.py:94-119`, `IS_PRODUCTION_READY=False`); `pyrad` not in `requirements.txt`. **No subscriber can be authenticated onto the network.** ~3-5 days + the customer's RADIUS host. **Not Monday.**
- **OPS-2 [HIGH — internet]** OLT VSOL drivers are **PROVISIONAL** — CLI command-builders never run against the real OLT model/firmware. First hardware contact will surface syntax mismatches. ~1-2 days on-site with the box. **Cannot be done from the repo.**
- **OPS-3 [HIGH] `docker-compose.yml:49` hardcodes `ENVIRONMENT: development`** in the backend service — `environment:` overrides `env_file:`, so **every prod fail-closed gate becomes a no-op** (weak secrets, mock providers, CORS wildcard all accepted). ~15 min fix. **Must-fix.**
- **OPS-4 [HIGH]** `twilio`/`sendgrid` (and `pyrad`) **not in `requirements.txt`**; the Dockerfile only installs that. Comms factories fall back to **mock** on ImportError → invoices/dunning/SMS silently dropped. ~2 hr.
- **OPS-5 [HIGH]** No TLS/reverse-proxy in compose; **no uploads volume** (local-disk attachments lost on container recreate); pgdata not pinned to a persistent disk. ~0.5-1 day.
- **🟡 Config set (each gates boot):** real `JWT_SECRET`/`GAAHEX_FIELD_KEY` (vault the field key first — irrecoverable), distinct `gaahex`/`gaahex_app` roles, explicit `CORS_ORIGINS`, `PORTAL_AUTH_MODE=cookie`, `RATE_LIMIT_ENABLED=true`, rotate demo creds + `BOOTSTRAP_ADMIN_PASSWORD`, `alembic upgrade head`, run `restore-verify.sh` once.

---

## 6. RANKED MUST-FIX

| # | Item | Sev | Effort | Monday? | Owner |
|---|---|---|---|---|---|
| 1 | Test failures/errors (portal — triage fixture vs regression) | BLOCK | 0.5–1 d | ✅ | Bro |
| 2 | DATA-1/2/3 status-vocabulary collapse → ONE UPPER_SNAKE truth | BLOCK | 1–2 d | ✅ (Gev picks canonical) | Bro + Gev |
| 3 | DATA-4 RLS policies on the 18 unprotected tables + fix the false-green test | BLOCK(sec) | 0.5–1 d | ✅ | Bro |
| 4 | FIN-1 payment-allocation unit reconcile (luma; drop `/100`) | CRITICAL | 0.5 d | ✅ | Bro |
| 5 | OPS-3 remove `ENVIRONMENT: development` from compose | HIGH | 15 min | ✅ | Bro |
| 6 | OPS-4 add twilio/sendgrid/pyrad to requirements + rebuild | HIGH | 2 hr | ✅ | Bro |
| 7 | SEC-1/2 gate legacy comms + construct-check email/SMS gateway | HIGH | 0.5 d | ✅ | Bro |
| 8 | SEC-3 rate-limit on (single-worker ok) | HIGH | 1 hr | ✅ | Bro |
| 9 | OPS-5 TLS reverse-proxy + uploads volume + pinned pgdata | HIGH | 0.5–1 d | ✅ (ops) | Gev/ops |
| 10 | 🟡 prod secrets/roles/CORS/auth-mode + restore drill | HIGH | 2 hr | ✅ (Gev) | Gev |
| 11 | OPS-1 RADIUS real (pyrad) end-to-end | SHOWSTOP | 3–5 d + host | ❌ | Bro + pilot |
| 12 | OPS-2 OLT verified on real hardware | HIGH | 1–2 d on-site | ❌ | Bro + pilot |
| 13 | FIN-2 invoice FOR UPDATE on Stripe/legacy flip · drift status-rule · misc MED | MED | 0.5 d | ✅ | Bro |

---

## 7. THE MAP / ՔԱՐՏԵԶ

**EN — Weekend (I can close, code/config only): items 1–8 + 13 → control plane production-ready + tests
green + drift rule that prevents the status class from recurring → re-seal. Ops (9,10) = your side.
Monday-blocked (needs infra params + hardware): 11 (RADIUS) + 12 (OLT) = the actual internet activation.**

So: **back-office BSS pilot can be production-ready by Monday** after 1–8/9/10; **real internet activation
is NOT a Monday item** — it needs the admin's infra (Monday) + the customer's RADIUS host + on-site OLT
testing + ~1 week.

**HY — Շաբաթ-կիրակի (ես կփակեմ, code/config)՝ 1–8 + 13 → control-plane production-ready + tests green +
drift-rule, որ status-class-ը չկրկնվի → re-seal։ Ops (9,10)՝ քո կողմ։ Monday-blocked (infra-params +
hardware)՝ 11 (RADIUS) + 12 (OLT) = իրական ինտերնետ-ակտիվացիան։** Back-office BSS pilot-ը երկուշաբթի կարա
ready լինի. իրական ինտերնետ-ակտիվացիան՝ ոչ (admin-ի infra երկուշաբթի + RADIUS-host + OLT on-site + ~1 շաբաթ)։

## 7b. REMEDIATION LOG (live) / ԱՇԽԱՏԱՆՔԻ ԳՐԱՆՑՈՒՄ

Executing the weekend map. Status per item (UPPER_SNAKE = SPEC §7 truth, Gev did not veto the recommendation).

| Item | What was actually done | Verified | State |
|---|---|---|---|
| #1 test failures | Root-caused the 5 fail + 29 err to ONE disease: non-deterministic `select(Tenant)).first()` in fixtures vs login/seed binding to the **demo** tenant (`the_tenant_id_async` = oldest). NOT a product regression — the suite was lying. Fixed the whole class: 44 picks across 26 test files → `select(Tenant).order_by(Tenant.created_at)`. 29 errors already cleared (1881→1910 pass); re-running full suite to confirm 0 fail. | suite gate #1 running | ✅ FIX IN, verifying |
| #6 requirements (OPS-4) | `backend/requirements.txt` += `twilio>=9.0`, `sendgrid>=6.11`, `pyrad>=2.4` — comms/RADIUS factories can no longer silently fall back to mock. | read-back ✓ | ✅ DONE |
| #5 compose ENV (OPS-3) | **Better than "remove":** removing `ENVIRONMENT` would make dev boot production-strict (app default is `production`, fail-closed) and refuse to start. Instead made it honestly overridable — `ENVIRONMENT: ${ENVIRONMENT:-development}` (+ same for DATABASE_URL/OWNER_DATABASE_URL/REDIS_URL). The old comment *lied*: compose `environment:` always beats `env_file:`, so a "production" `backend/.env` was silently ignored → app booted PERMISSIVE in prod (fail-OPEN footgun). Now: unset → `development` (byte-identical to before); `export ENVIRONMENT=production` flows through → fail-closed `_assert_production_deploy_contract()` engages. | `docker compose config` both ways ✓ | ✅ DONE |
| #2 status-vocab (customer) | **The actual blocker, FIXED.** Customer state machine was DEAD: StatusDef `active/suspended/terminated` (lowercase) vs transitions `PROSPECT/ACTIVE/SUSPENDED/CHURNED` (UPPER, stale) — zero overlap → no transition could fire. Collapsed customer to SPEC §7 UPPER_SNAKE `ACTIVE/SUSPENDED/TERMINATED` across source (seed.py, seed_lifecycle_statuses, crm_activation, seed_dev_bulk) + normalizer that overwrites the stale WorkflowDef graph + migrates records. Dev DB verified: StatusDef=ACTIVE/SUSPENDED/TERMINATED, 13 records ACTIVE, transitions match. Frontend case-tolerant. | 113 targeted tests pass; dev-DB SQL ✓ | ✅ DONE |
| #2 status-vocab (lead/order) | **CLOSED (B1b, 2026-06-14, "go do all").** Decisive evidence it was the right call: the FRONTEND canonical (`lifecycle.ts`) ALREADY declared these keys UPPER_SNAKE — backend lowercase was a split-brain deviation, not a safe convention. UPPER-cased lead+order across the whole stack via a count-asserted 93-op migration: seeds (seed/seed_lifecycle/seed_pipeline/seed_catalog/seed_list_presets/seed_workflows/seed_kpi/seed_dev_bulk), the provisioning core (install_board ×7 + router, convert, workflow_engine, order model default, ORDER_INITIAL), the AI scorer (`.lower()`→`.upper()`) + agent normalizer, and 20+ test files. Deliberate keeps verified: nav route `/scheduling`, workitem `kind='installation'`, notify def-keys (lowercased at derivation). Deterministic `leadorderupper` Alembic migration (record/order/status_def/workflow_def) **applied + verified on dev DB — all UPPER, drift-clean**. The `order.status=='installation'` vs workitem-KIND collision is now GONE (different strings). | full suite GREEN 1921/0/0; dev-DB SQL ✓; frontend `tsc` ✓ | ✅ DONE |
| #3 RLS 18 tables | **AUDIT WAS WRONG (false alarm).** Empirical check: of the 18 flagged tables, **17 already have RLS** (`tenant_isolation`) via per-feature migrations + `e7f4a2b9c8d1_m1a_wave3_rls_backfill` (which the audit missed). The TRUE gap = exactly ONE table, `stripe_webhook_event`, and it is **correctly exempt by design**: its idempotency dedup SELECTs by global stripe_event_id BEFORE the tenant is known (RLS → missed dedup → double-charged payments) and its tenant_id is NULLABLE (RLS WITH CHECK → rejected audit rows). Not tenant-exposed. **C2:** documented it as `RLS_EXEMPT_BY_DESIGN` + a classification guard so no tenant table ships unclassified. No product change. | empirical SQL + 54 RLS tests pass | ✅ DONE (corrected) |
| #4 FIN-1 unit | **REAL & CRITICAL — fixed.** Not "drop /100, luma everywhere" — the column/app/tests are ALREADY luma; only the over-allocation trigger wrongly divided payment.amount by 100 (assumed major units). Effect: in any migration-built (dev/prod) DB the trigger rejected EVERY valid allocation → the allocation path was **100% broken in production**. The suite missed it because conftest `create_all` carries no triggers. Fix: migration `fin1allocluma` recreates the trigger luma-to-luma (no data migration — table empty); model docstring corrected; new regression test installs the trigger + proves accept-at-equal / reject-over. | migration applied+verified on dev DB; 9 tests pass | ✅ DONE |
| #7 SEC-1/2 comms gate (E1) | Deploy contract now refuses the legacy `EMAIL_PROVIDER`/`SMS_PROVIDER` dev/no-op channel in production (channels.py would silently DROP outbound email/SMS). **E1b** (construct-check the real gateways, like RADIUS) **deferred** — the existing mock-provider gate + the A2 package adds (twilio/sendgrid) cover the primary silent-mock cause; full construct-check is a documented follow-up. | 10 deploy-contract tests pass (2 new gate-fires) | ✅ DONE (E1b deferred) |
| #8 SEC-3 rate-limit (E2) | Deploy contract now refuses `RATE_LIMIT_ENABLED=false` in production (the abuse guard was fail-open). Default stays False so dev/suite are unaffected; prod is forced ON via the fail-closed gate. | gate-fires test passes | ✅ DONE |
| #13 FIN-2 (D2) | FOR UPDATE on the invoice row in ALL three PAID-flip paths (Stripe / allocation / legacy), deadlock-safe Payment→Invoice order. | 273 billing tests pass | ✅ DONE |
| #2/#13 drift rule (B2) | `test_status_vocabulary_drift` enforces **single source of truth, no exception**: every entity's transitions + records ⊆ its StatusDef keys (consistency, ALL entities) + UPPER_SNAKE casing (all except the documented lead/order SST install-pipeline). **On its first run it caught a real pre-existing inconsistency** — a vestigial `order_created→order_validated` transition referencing a lead-only key absent from the order StatusDef set; removed. | drift test passes; dev DB normalized | ✅ DONE |
| #2 lead/order UPPER (B1b) | **DONE — no exception.** Gev: "go do all". UPPER-cased per the row above; the drift rule's `_SST_LOWERCASE_ENTITIES` exemption set is now **empty** — every canonical entity (customer/lead/order/deal/ticket) is UPPER_SNAKE, enforced mechanically, with zero exception. | drift test green; suite 1921/0/0 | ✅ DONE |
| E1b SEC-1/2 construct-check | **DONE.** The deploy contract now construct-checks the REAL comms gateways (parity with the RADIUS construct gate): `EMAIL_PROVIDER=smtp` requires `SMTP_HOST`; `SMS_PROVIDER=twilio` requires `TWILIO_ACCOUNT_SID`+`AUTH_TOKEN`+`FROM`. Closes the gap where a named real provider with missing config would pass E1 yet SILENTLY fall back to the dev console-log no-op (channels.configure_adapters) and drop all outbound email/SMS. | 2 new gate-fires tests + 47 deploy/feature/security tests pass | ✅ DONE |
| OPS-5 (ops hardening) | **DONE (software parts).** (a) `gaahex_uploads` named volume mounted at `/app/uploads` — fixes the real data-loss bug where local-disk attachments (contracts/docs) were lost on container recreate; (b) DB image-pin guidance for pgdata safety (lock PG major so the persistent volume is never auto-migrated; digest-pin recipe in-line); (c) `docker-compose.prod.yml` — a ready Caddy auto-HTTPS (Let's Encrypt) TLS terminator overlay + HSTS/security headers, additive (dev `up` unaffected). Prod secrets + the real TLS domain stay Gev-side. | `docker compose config` ✓ | ✅ DONE |

---

## 8. DECISIONS FOR GEV — RESOLVED / ԳԵՎԻ CALL — ՓԱԿՎԱԾ
1. **Canonical status vocabulary** — RESOLVED + FULLY EXECUTED. Gev: "go with the rec, single source of truth,
   no exception" → "go do all". Customer was fixed first (the only BROKEN one → SPEC §7 UPPER_SNAKE). Then
   **lead + order were UPPER-cased too (B1b) — there is now literally NO exception**: every canonical entity is
   UPPER_SNAKE and the drift rule's exemption set is empty. The earlier "keep lead/order lowercase" call was
   reversed once the frontend canonical (`lifecycle.ts`) was found to ALREADY be UPPER — backend lowercase was
   a split-brain deviation, so the change is genuine SST alignment, not cosmetics. Done via a count-asserted
   migration + a deterministic `leadorderupper` Alembic migration, verified on the dev DB, full suite GREEN.
   The drift rule (`test_status_vocabulary_drift`) guarantees no entity is ever inconsistent or mis-cased again.
2. **Monday scope** — back-office BSS pilot: **achievable and certified**. Internet activation: still needs
   Monday's infra params + on-site hardware (unchanged).
3. **Weekend remediation batch** — DONE. All items closed + verified; full suite green. Nothing committed/pushed
   (not requested).

**Closed since the first seal (B1b/E1b/OPS-5, "go do all"):** lead/order UPPER (no exception) · E1b comms
construct-check · OPS-5 uploads volume + pgdata pin guidance + Caddy TLS overlay.
**Open (genuinely Gev-side / hardware — NOT closable in code):** prod secrets (GAAHEX_FIELD_KEY / JWT_SECRET /
real Stripe keys) + the real TLS domain · RADIUS-real host + OLT-on-hardware = the actual internet activation
(Monday infra + on-site).

*Seal: CERTIFIED (control-plane / back-office BSS pilot) · Bro · 2026-06-14. Tests green (1921/0/0); every
code/config MUST-FIX closed + verified; the three software follow-ups (lead/order UPPER no-exception, E1b
comms construct-check, OPS-5 ops hardening) CLOSED. Internet-activation data plane pending hardware.*
