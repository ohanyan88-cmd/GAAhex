# M1 — Platform Expansion Plan

**Status:** PLAN · pre-implementation
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`
**Baseline branch:** `main` @ `82c3e39` (sealed-baseline commit; full pytest green
1768/0/0, drift green, killer test passing, M0 staging GO).
**Author check:** I have read the sealed baseline. M1 expands the platform along
extension points E1, E2, E3, E4, E6, E7, E9 ([§8](#extension-points-used)). No §3
invariant is weakened; no §4 forbidden pattern is introduced. Every proposed deviation
goes through the successor-baseline channel ([I10](#i10-trail)), never a silent code
edit.

> **Rule of the road.** M1 ships *real product surface* — actual ISP entities, real
> provider integrations, realistic data shapes — *without the platform shape changing*.
> If a task feels like it needs a 6th kernel engine, an entity-specific route, or
> code in `app/routers/records.py` that branches on slug, the task is wrong, not the
> baseline.

---

## Table of contents

1. [M1 objective](#1-m1-objective)
2. [Scope](#2-scope)
3. [Non-scope](#3-non-scope)
4. [Extension points used](#4-extension-points-used)
5. [Protected invariants touched](#5-protected-invariants-touched)
6. [Risk register](#6-risk-register)
7. [Implementation sequence](#7-implementation-sequence)
8. [Killer tests required](#8-killer-tests-required)
9. [Manual staging smoke plan](#9-manual-staging-smoke-plan)
10. [Rollback plan](#10-rollback-plan)
11. [Acceptance criteria](#11-acceptance-criteria)
12. [Open questions / successor-baseline candidates](#12-open-questions--successor-baseline-candidates)

---

## 1. M1 objective

**Goal (from sealed baseline §11):** the second tenant onboards onto the live
platform with their real entities (customer types, service types, lifecycle
workflows, tariffs) defined entirely through `/meta/entities` + `/meta/page-configs`.

Concretely, M1 is **proven** when:

1. A real ISP tenant stands up on staging with their full operational model
   defined through config calls — not new model classes, not new routers, not
   new entity-specific code.
2. The platform serves that tenant's real traffic (customer signup → service
   activation → first invoice → payment → audit) end-to-end against **real
   providers** (Stripe live, SendGrid, Twilio, FreeRADIUS).
3. The M0 killer test still passes ([I4](#i4-killer-test-stays-green)),
   plus four new killer tests prove the M1-specific guarantees pass ([§8](#8-killer-tests-required)).
4. The `backend-rls` CI job is **green without `continue-on-error`** — the
   dual-role enforcement gate becomes hard ([TD13 → resolved](#td13-resolved)).
5. The platform thesis hasn't moved: a future M1-onboarded tenant can still
   stand up a *3rd* entity (their custom shape) with config alone, no
   engineering ticket.

What M1 is **not**: an admin UI for tenant onboarding (that's M2), an
external-integration marketplace (M3), or a kernel rewrite (forbidden).

---

## 2. Scope

### S1. Real ISP entity catalog as seed migrations

The "platform's idea of a real ISP" — Customer, Service, Subscription, Invoice,
Payment, Lead, WorkItem, Ticket, NetworkInventory items, Order — already
exists as built-in models. M1 layers on top:

- **Tenant-specific customer-type taxonomy** seeded through `POST
  /meta/entities/customer/fields/customer_type` config (enum values like
  `RESIDENTIAL`, `BUSINESS`, `WHOLESALE`, `GOVERNMENT`).
- **Tenant-specific service-plan catalog** as Tariff records (the model
  exists; M1 ships the seeded data shape).
- **Tenant-specific lifecycle workflows** for service provisioning — e.g.,
  `PENDING → SURVEY_SCHEDULED → SURVEY_DONE → INSTALL_BOOKED → ACTIVATED →
  SUSPENDED → TERMINATED` — defined via `/meta/entities/service/statuses` +
  `/meta/entities/service/transitions`.
- **3–5 tenant-custom config-only entities** that the real ISP needs but the
  platform doesn't ship: e.g., `SiteSurvey`, `TowerInspection`,
  `OutageIncident`, `CustomerComplaint`, `RegulatoryReport`. Each defined
  end-to-end through `POST /meta/entities`. Each appears in nav, in
  permissions, in audit, in tenant isolation — without code.

### S2. Real provider wiring

- **Payment**: `PAYMENT_GATEWAY_PROVIDER=stripe` with live keys.
- **Email**: `EMAIL_GATEWAY_PROVIDER=sendgrid`.
- **SMS**: `SMS_GATEWAY_PROVIDER=twilio`.
- **RADIUS**: `FEATURE_RADIUS_REQUIRED=true` + `RADIUS_BACKEND_PROVIDER=freeradius`
  (only if the tenant actually drives a BNG; otherwise stays off and gated).
- The deploy contract ([I8](#i8-deploy-contract)) already refuses
  `mock`; M1 verifies real-provider boot in staging then promotes to prod.

### S3. Performance baseline under realistic data

- Seed staging with **10K customers + 25K services + 100K invoices + 250K
  payments** (proportional to a small-to-mid ISP's annual shape).
- Measure: M0 killer test latency, customer-list page TTI, customer-detail
  TTI, invoice generation throughput, search response time.
- Establish budgets:
  - Killer test wall time ≤ 1.5× M0 (currently ≈ 8s isolated; budget 12s).
  - Customer list page TTI ≤ 2s (P95) at the staging data shape.
  - `/api/customers?q=...` substring search ≤ 500ms (P95).

### S4. backend-rls hardening

- Remove `continue-on-error: true` from the `backend-rls` CI job ([TD13](#td13-resolved)).
- Resolve every cross-tenant test failure that surfaces under the
  `gaahex_app` NOSUPERUSER role — these are *real* RLS gaps, not test bugs.

### S5. Tenant onboarding runbook

- Step-by-step admin checklist: provision the tenant row, seed roles, create
  the first super_admin user, walk through Studio to define tenant-specific
  customer types / workflows / custom entities, configure provider creds,
  smoke the killer flow.
- The runbook is operational documentation, not code. Lives in
  `docs/runbooks/M1-TENANT-ONBOARDING.md` (will be written during S5).

### S6. First real tenant cutover

- Tenant: ✅ **LOCKED 2026-06-05** — the real ISP pilot participant that already agreed to participate. (Strategic decision only; operational onboarding planning happens inside this M1 execution. Do not begin onboarding or production cutover from the strategic lock alone.)
- Migration of any pre-existing data into the platform's seed shape happens
  by **the platform's own `POST /api/{slug}` endpoints**, run as a one-shot
  Python script using the tenant's first super_admin's JWT. No bulk
  `INSERT INTO ...` SQL bypass. (Forbidden — would skip `workflow.emit`.)

---

## 3. Non-scope

Anything in this list **is not M1**. Adding it to M1 is scope creep and
must wait for M2/M3 or a successor-baseline conversation.

| Out of scope | Belongs to | Why excluded from M1 |
|---|---|---|
| Admin UI for tenant onboarding (a wizard) | M2 | Out-of-band today is fine — the runbook covers it. UI is a separate product surface. |
| External integration marketplace (Slack/Stripe/Shopify connectors) | M3 | Needs a feature-gate per integration; M3 lands the framework. |
| Frontend visual redesign | n/a | M0 sealed the UI primitives; redesign is a parallel design-led track. |
| 6th kernel engine | **forbidden** ([I1](#i1-kernel)) | If a task seems to need one, the task is wrong. |
| Entity-specific routes (`/api/customers/something-special`) | **forbidden** ([I5](#i5-config-only-entities)) | Generic `/api/{slug}` only. Custom verbs are workflow transitions, not new endpoints. |
| Per-tenant permission key naming (`tenantX.customer.view`) | **forbidden** ([I6](#i6-permission-keys)) | Permission keys come from the registry, not per-tenant. |
| Audit-row backfill / cleanup for migrated data | **forbidden** ([I2](#i2-audit-append-only)) | Audit is append-only. Migration emits fresh events through `workflow.emit`. |
| New full-text search engine (Elastic / OpenSearch) | post-M1 | Postgres FTS covers M1 data volumes. Reassess when search SLA breaks. |
| Tenant-level UI theming / white-labeling | post-M1 | Brand tokens exist (Cobalt + Gold); tenant override is M2-shaped. |
| Mobile app | post-M1 | Web responsive (post `--gx-tap-min: 44px` + `--gx-bp-*`) is M1's mobile story. |

---

## 4. Extension points used

Each work item in §7 maps to one or more of these **§8 approved extension
points**. No work item extends the platform by a different route.

| Extension point | Used by | Notes |
|---|---|---|
| **E1.** Add a new entity (via `/meta/entities`) | S1 (3–5 custom entities); S6 (any tenant-specific shape) | The killer-test path. Every M1 custom entity uses this. |
| **E2.** Add a new field type | S1 (likely 1–2 new types: e.g., `gps_point`, `cidr`) | Only added if a tenant's real form needs a type the platform doesn't have. New type lands in `ALLOWED_TYPES`, `FIELD_TYPES`, `FieldInput.tsx`, and validation — in the **same PR** so partial adoption can't happen. Each new field type lands its own *unit test* before the entity that uses it. |
| **E3.** Add a new status / transition / workflow | S1 (tenant service-provisioning workflow) | All goes through `/meta/entities/{slug}/statuses` + `/transitions`. |
| **E4.** Add a new page / view | S1 (custom-entity detail pages auto-rendered by EntityView); S5 (any new onboarding-flow pages) | Composes `<PageShell>` + canonical primitives. No new chrome. |
| **E6.** Add a new tenant-scoped table | S1 (potentially: tenant-specific dispatch zones, regulatory-report templates) | Each migration adds `tenant_id` + `RLS tenant_isolation` policy in the **same** migration ([I3](#i3-tenant-isolation)). |
| **E7.** Add a new permission | S1 (auto-generated per custom entity); S2 (`integration.payment.configure` etc. for the new provider admin surfaces) | All keys follow `object.action`, immutable post-release ([I6](#i6-permission-keys)). |
| **E9.** Add a new feature gate | S2 (per-provider gates beyond the existing 4: `feature_radius_required` already exists; M1 may add `feature_dunning_enabled`, `feature_self_serve_signup`) | Default OFF; deploy contract refuses if ON without backend. |

### Extension points NOT used by M1

- **E5** (new primitive) — M0 sealed the primitive set; M1 composes them.
  If S5 or S6 finds a gap, the new primitive is itself a successor-baseline
  conversation, not a quiet add.
- **E8** (new mutation that emits an audit event) — covered implicitly by
  every entity transition; M1 doesn't add a custom mutation outside the
  workflow engine.
- **E10** (new CI gate) — S4 *removes* the `continue-on-error` softening of
  an existing gate, but no new gates land in M1.

---

## 5. Protected invariants touched

This section is the **honest dossier** of which baseline invariants each work
item interacts with. "Touched" doesn't mean "weakened" — it means M1 has to
*honor* the invariant explicitly. A PR that touches an invariant must call it
out in the description.

### I1. The 5 kernel engines stay fixed

- **Touched by:** S1, S2, S3.
- **How honored:** Every M1 custom entity rides the existing engines —
  workflow for transitions, authz for the auto-generated permissions,
  database for tenant-scoped persistence, audit for state changes, security
  for the deploy gate. Zero new engine code.

### I2. Audit append-only

- **Touched by:** S6 (data import from any pre-existing tenant data).
- **How honored:** Import runs through `POST /api/{slug}` per record — each
  POST emits its own `CREATE` event via `workflow.emit`. No direct
  `INSERT INTO event` from migration / script code. No `DELETE FROM event`
  ever (the DB trigger refuses regardless).

### I3. Tenant isolation engages

- **Touched by:** S4 (RLS hardening), S6 (tenant cutover under real
  `gaahex_app` connection).
- **How honored:** Every M1 migration carries the `tenant_isolation` RLS
  policy. The `backend-rls` CI job (S4) is the proof; it removes
  `continue-on-error` once the audit closes the open RLS gaps.

### I4. Killer test stays green

- **Touched by:** All M1 work items.
- **How honored:** M1 adds four NEW killer tests ([§8](#8-killer-tests-required))
  that ride alongside the existing one. The existing test is **never
  modified except to extend** — its `route_slug` ("slas-test") and assertion
  shape stay byte-for-byte stable. Any divergence is a successor-baseline
  conversation.

### I5. Config-only entities use the generic API surface

- **Touched by:** S1 (tenant-custom entities), S6 (data import).
- **How honored:** Every M1 entity — built-in or tenant-custom — talks to
  `/api/{slug}/*`. The generic record router stays slug-agnostic. No
  `if slug == 'X':` branches in router code, ever.

### I6. Permission keys follow `object.action` and are immutable

- **Touched by:** S1 (auto-generation per entity), S2 (provider-admin
  permissions).
- **How honored:** Auto-generated keys flow from `entity_def.key`. New
  platform-level permissions (e.g., `integration.payment.configure`) are
  added to `docs/standards/15-permission-registry.md` *before* code lands.

### I7. Enum values are UPPER_SNAKE_CASE

- **Touched by:** S1 (status / type / category enums in custom entities).
- **How honored:** Every entity definition validated against the existing
  validator in `/meta/entities` POST handler — already lowercased→rejected
  for status keys. M1 doesn't relax this; the killer-test asserts it.

### I8. Deploy contract gates production boot

- **Touched by:** S2.
- **How honored:** Real-provider configuration **flows through** the contract
  — no code edits to weaken any of the 6 checks. The four `*_PROVIDER` env
  vars switch from `mock` to real values; the contract then passes because
  real values pass.

### I9. The 70 LOCKED standards

- **Touched by:** S1 (any new enum value lands in file 14;
  any new permission lands in file 15), S5 (the onboarding runbook is itself
  a standard candidate).
- **How honored:** Standards updated **before** the code that adopts them.
  No standard-drift in M1.

### I10. Append-only signoff trail

- **Touched by:** §12 (open questions that may evolve into a successor
  sealed baseline).
- **How honored:** When (if) M1 needs to relax an invariant, the conversation
  happens in `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>.md`,
  linking back to this M1 plan and the predecessor 2026-06-05 baseline.

---

## 6. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A new field type leaks beyond `ALLOWED_TYPES` (frontend rendering / backend validation drift) | M | M — silent data loss if validation gap | Each new field type's PR includes: backend validator unit test, frontend `FieldInput.tsx` story test, an entity-creation killer test that exercises the type end-to-end. Drift checker stays green. |
| R2 | Real provider keys (Stripe/SendGrid/Twilio) misconfigured at cutover | M | H — payments silently fail or duplicate | Provider-by-provider staging smoke before each `_PROVIDER` env var flips from `mock` to real. Documented per-provider rollback (env var revert + service restart). |
| R3 | RLS gaps surface under `gaahex_app` role with real data volumes | M | H — cross-tenant read in production | The S4 hardening (`continue-on-error` removed) is the gate. Every gap surfaced by the dual-role CI job is fixed *before* the tenant cutover. |
| R4 | Killer test slows past 1.5× under realistic data | M | M — flaky CI | S3 sets the budget. Performance budget is in the killer test docstring; PR that exceeds it owes a fix, not an `xfail`. |
| R5 | Tenant data migration script bypasses `workflow.emit` "for speed" | L | H — audit lineage gap | Forbidden by [I2](#i2-audit-append-only). Migration is per-record via `POST /api/{slug}`; if that's too slow at M1 volumes, S3 surfaces it and we either tune or batch (still through the API surface). |
| R6 | A "small" PR adds an entity-specific route to avoid `/meta/entities` ceremony | L | C — thesis collapse | Drift checker would not currently catch this; M1's first new ratchet rule should be **no new `@router.X("/api/{specific_slug}/something")` decorators** (see §12). |
| R7 | Production deploy contract weakened to ship faster | L | C — production deployed without RLS engaging | Sealed baseline I8 makes this an automatic NO. PR review must catch any edit to `_assert_production_deploy_contract`. |
| R8 | First tenant's data shape requires an entity field type the platform doesn't have, and the time pressure pushes a workaround | M | M | The right path: add the field type cleanly (E2) in a 1-day PR. The wrong path: encode it as JSON-in-`config`. Plan reserves 5 working days in the schedule for at most 2 new field types. |
| R9 | Performance baseline (S3) reveals a query path with no `tenant_id` filter — tenant-filter static analyzer missed it | L | C — cross-tenant read | The runtime audit (`backend/app/tenant_query_audit.py`) is the second line; M1 will log + alert on any query that the static analyzer didn't flag. |
| R10 | A custom entity in S1 needs a workflow guard that depends on data the engine doesn't see (e.g., "can only transition to ACTIVE if billing account is current") | **CONFIRMED (Q1)** | M — without resolution, guards either weakened or implemented outside the engine | **Phase 1.5 lands the GXL cross-record extension** (Q1 resolved). Successor sealed baseline drafted as Phase 1.5's first artifact, locking in the new GXL surface (cross-record fields, single-record cardinality, super_admin-only authorship) + killer test KT-GXL-1. Until Phase 1.5 ships, any custom entity that *requires* a cross-record guard is held out of Phase 3. |
| R13 | Per-tenant feature flag override is bypassed by a call site that forgets to pass `tenant_id` (Q5 resolution introduces this risk) | M | M — flag effectively platform-wide for that call site | Lint rule (ratchet) on `is_enabled(...)` calls inside request handlers — the `tenant_id` kwarg becomes required when the call site has `user` or `request` in scope. Killer test KT-M1-5 exercises the per-tenant isolation. |
| R14 | The GXL extension's cross-record resolution triggers N+1 in transition handlers | M | M — slow transitions; possible time-out under load | Cardinality contract in the successor baseline pins "single record" (no aggregates over collections). Resolver pre-fetches the referenced rows in one query before evaluation. KT-GXL-1 timing assertion gates this. |
| R11 | New killer test makes the suite take noticeably longer | L | L — CI slower but not blocking | Budget: total CI wall time stays ≤ 10 min for `backend` job. New killer tests are scoped tight (one-shot fixtures, no broad seeding). |
| R12 | Tenant onboarding runbook (S5) drifts from actual code paths | M | M — admins get stuck | Runbook updated in the same PR as any code change that affects the onboarding surface. Linked from `docs/standards/00-standards-index.md`. |

Color key: L=Low M=Medium H=High C=Critical (thesis-breaking).

---

## 7. Implementation sequence

Phased, not parallel. Each phase has an exit gate that must be passing before
the next begins. Estimated calendar time is a planning indicator, not a
commitment — actual cadence is set by review velocity + Gev's availability.

### Phase 0 — Pre-flight (target: ≤ 1 week)

| Task | Owner | Exit |
|---|---|---|
| **P0.1** Re-run the M0 staging smoke to confirm baseline still GO | Gev + a tester | All 12 manual flow steps still pass. |
| **P0.2** Snapshot the staging DB (named `pre-m1-baseline`) | Infra | Snapshot id documented in this file's Phase 0 entry. |
| **P0.3** Lock down the sealed baseline 2026-06-05 — confirm no edits since seal | Engineer | `git log docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` shows the seal commit only (typo/link edits OK, substantive edits NO). |
| **P0.4** Open an architecture-review thread for each §12 open question | Engineer | Each question has a draft successor-baseline file (or a resolution "no successor needed"). |

**Exit gate:** the sealed baseline is unchanged; staging passes; snapshot
exists. Phase 0 takes hours, not days — it's a sanity check, not work.

### Phase 1 — backend-rls hardening (target: 1 week)

The dual-role enforcement is M1's most leverage-y fix because it surfaces RLS
gaps **before** we put real tenant data in front of them.

| Task | Owner | Exit |
|---|---|---|
| **P1.1** Run the `backend-rls` job locally; capture every failure | Engineer | Failure list documented, each tagged "real RLS gap" or "test fixture artifact". |
| **P1.2** Fix the real-RLS-gap items (likely 0–5; the architecture already engaged RLS in M0) | Engineer | Each fix lands its own commit with a regression test. |
| **P1.3** Fix the test-fixture artifacts (extend `delete_tenant_cleanly` or per-fixture cleanup if needed) | Engineer | All cross-tenant tests pass under the `gaahex_app` role. |
| **P1.4** Remove `continue-on-error: true` from the `backend-rls` job in `.github/workflows/ci.yml` | Engineer | CI runs both jobs hard. |
| **P1.5** Confirm the M0 killer test still passes in both `backend` and `backend-rls` jobs | CI | Two PASS rows in the run summary. |

**Exit gate:** `backend-rls` job is green and hard; M0 killer test passes
under both roles.

### Phase 1.5 — GXL extension + per-tenant feature flags (target: 2 weeks)

Inserted by the 2026-06-05 resolution of Q1 and Q5. Two parallel tracks in
one phase because they share a review window (both touch the security /
feature-gate surface; reviewers can batch the conversation).

**Track A — GXL cross-record extension (Q1):**

| Task | Owner | Exit |
|---|---|---|
| **P1.5A.0** Draft `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>-GXL-EXTENSION.md` covering the four bullets from Q1's resolution (resolution surface, cardinality, authz, KT-GXL-1). | Engineer + Gev review | Successor baseline merged. **No GXL code lands before this.** |
| **P1.5A.1** Implement the cross-record resolver inside `app/gxl.py` (or wherever GXL lives today). Single-record-only cardinality enforced at parse time. | Engineer | All existing GXL guards parse + evaluate unchanged (compatibility window in the successor baseline §X). |
| **P1.5A.2** Add the resolver's pre-fetch pass so transition evaluation issues at most one extra query per guard (no N+1 — R14 mitigation). | Engineer | Killer test KT-GXL-1 timing assertion passes. |
| **P1.5A.3** Land KT-GXL-1: tenant defines guard `account.balance_due == 0` for `service.activate`; engine refuses when unpaid, allows when paid. Lives at `backend/tests/test_workflow_engine.py`. | Engineer | Test passes in `backend` AND `backend-rls` jobs. |
| **P1.5A.4** Gate: a deliberately-malformed guard expression that *would* enable an out-of-bound query (e.g., aggregate over a collection) fails parse with a clear error. | Engineer | Test passes; the parse-error message is the one the runbook will quote. |

**Track B — Per-tenant feature flags (Q5):**

| Task | Owner | Exit |
|---|---|---|
| **P1.5B.1** Migration adds `tenant_feature_flag` table (`tenant_id` + `flag_key` + `enabled` + `updated_at` + `updated_by`) with `tenant_isolation` RLS policy in the SAME migration ([I3](#i3-tenant-isolation)). | Engineer | Migration reversible; RLS policy verified by `backend-rls` job. |
| **P1.5B.2** Extend `app/services/feature_gate.py:is_enabled(feature, tenant_id=None)` per the Q5 design sketch. Tenant override only applies when `tenant_id` is provided. The 4 existing deploy-shape flags stay env-var-only. | Engineer | All existing call sites continue to work; new tenant-aware call sites pass `tenant_id` explicitly. |
| **P1.5B.3** Add the `tenant_feature_flag` CRUD endpoints — gated by `tenant.settings.manage` permission (auto-generated; no new key needed). Every CRUD operation emits `workflow.emit` for the audit trail. | Engineer | A super_admin can flip a flag via API; the flip lands in audit. |
| **P1.5B.4** Land KT-M1-5: tenant A enables `dunning_automation`, tenant B doesn't; an automation pass affects only A. | Engineer | Test passes. |
| **P1.5B.5** Lint rule (RATCHET) on `is_enabled(...)` inside request handlers: if `user` or `request` is in scope, `tenant_id` MUST be passed. Initial baseline = 0; any new violation fails CI. | Engineer | Rule lands in `tools/check_drift.py`; baseline auto-populates. |

**Exit gate:**
1. The successor sealed baseline for GXL is merged.
2. KT-GXL-1 + KT-M1-5 both pass in both `backend` and `backend-rls` jobs.
3. The new RATCHET rule for `is_enabled(... tenant_id)` lands and stays at baseline.
4. The M0 killer test still passes unchanged.

### Phase 2 — Real provider wiring (staging only) (target: 1–2 weeks)

Each provider is its own sub-phase. NEVER bundle "switch all 4 providers" in
one PR — staged rollout makes blast radius small.

| Sub-phase | Provider | Exit |
|---|---|---|
| **P2.A** | Email — `EMAIL_GATEWAY_PROVIDER=sendgrid` (staging key) | Outbound test email reaches a real address; deploy contract passes; audit row recorded. |
| **P2.B** | SMS — `SMS_GATEWAY_PROVIDER=twilio` (test number) | Outbound test SMS reaches a real phone; deploy contract passes. |
| **P2.C** | Payment — `PAYMENT_GATEWAY_PROVIDER=stripe` (test mode + then live in production) | Test charge succeeds; webhook delivery succeeds; refund succeeds; audit row recorded. **Live mode only after S6 sign-off.** |
| **P2.D** | RADIUS — only if the tenant drives a BNG; otherwise stays `mock` + `FEATURE_RADIUS_REQUIRED=false`. | If enabled: auth + accounting + disconnect against the real BNG; if not enabled: feature gate confirmed OFF. |

**Exit gate:** every provider that the tenant uses works end-to-end against
real infrastructure; deploy contract passes; no `mock` left.

### Phase 3 — Custom entity catalog (target: 2–3 weeks)

This is the meat of M1. Each custom entity is its own PR cycle: define →
seed → exercise → smoke.

For each of the 3–5 tenant-custom entities (the actual list comes from the
real tenant's discovery; placeholder names below):

| Step | What | Exit |
|---|---|---|
| **P3.x.1** Define | `POST /meta/entities` payload checked into `docs/runbooks/M1-TENANT-ONBOARDING.md` as a runbook step (NOT seed code — the tenant runs the POST themselves during onboarding). Or, for fully shipped-with-platform entities, an idempotent helper in `app/seed.py`. | Entity definition reviewed against [I7](#i7-enum-values) (UPPER_SNAKE_CASE), [I6](#i6-permission-keys) (object.action). |
| **P3.x.2** Exercise | Run the killer test variant against this entity (POST → record → transition → audit). | Test passes locally. |
| **P3.x.3** Frontend smoke | Entity appears in nav under Admin Panel → Records; detail page renders all fields; transitions work via UI. | Manual staging smoke captures screenshots. |
| **P3.x.4** Permissions check | A non-admin user without `{key}.view` grant gets 403. | Verified in staging. |

**Exit gate:** every M1 entity passes the killer test variant; nav + detail +
permissions all work; runbook step is reproducible by Gev as the tenant
admin.

### Phase 4 — Performance baseline (target: 1 week)

| Task | Exit |
|---|---|
| **P4.1** Seed staging with the realistic data shape (S3) via a one-shot script that runs the real `POST /api/{slug}` per record (NOT bulk SQL — [I2](#i2-audit-append-only)). | DB contains 10K customers + 25K services + 100K invoices + 250K payments; all rows have audit events. |
| **P4.2** Run the M0 killer test against the seeded DB; measure wall time. | ≤ 12s (budget = 1.5× M0). |
| **P4.3** Page-load smoke: customers list, customer detail, invoices list, search. | All P95 ≤ budgets in S3. |
| **P4.4** If a budget fails: profile the slow query, add index in a migration, re-run. **NEVER** add an index that bypasses RLS (e.g., on a non-`tenant_id`-prefixed column without the policy still firing). | New index migration committed; re-run passes. |
| **P4.5** Lock the performance baseline as a successor-baseline note or as a comment in the killer test. | Budget documented. |

**Exit gate:** all budgets met with realistic data shape.

### Phase 5 — Onboarding runbook (target: 1 week)

| Task | Exit |
|---|---|
| **P5.1** Write `docs/runbooks/M1-TENANT-ONBOARDING.md` — every command, env var, Studio click, and verification step. | Runbook reviewed by Gev + a second engineer. |
| **P5.2** Dry-run the runbook against a fresh staging tenant (NOT the real first tenant yet). Capture every snag. | Dry-run completes without deviation. |
| **P5.3** Iterate the runbook until the dry-run is reproducible by someone who hasn't seen the platform internals. | Reproducible. |

**Exit gate:** the runbook is a single document that another engineer can
follow end-to-end to onboard a fresh tenant. No tribal knowledge required.

### Phase 6 — First tenant cutover (target: 1 week — coordinated with the tenant)

| Task | Exit |
|---|---|
| **P6.1** Coordinate cutover window with the tenant. | Window booked. |
| **P6.2** Run the onboarding runbook against the real tenant's pre-prod (or directly against staging acting as their initial deploy). | Tenant exists, super_admin can log in. |
| **P6.3** Tenant admin walks through the manual M1 smoke ([§9](#9-manual-staging-smoke-plan)) under engineer supervision. | All 18 steps pass. |
| **P6.4** Flip `ENVIRONMENT=production` on the tenant's deployment. Deploy contract validates. | Boot succeeds, deploy contract passes, RBAC seed integrity intact. |
| **P6.5** First end-to-end real flow: tenant creates a real customer → activates a service → generates an invoice → charges via Stripe live → audit shows the trail. | Real money moved; audit row exists; killer test still passing in CI. |

**Exit gate:** the real tenant is live on the platform with real money moving
through real providers, with the audit trail intact.

---

## 8. Killer tests required

M1 ships **four new killer tests** that ride alongside `test_m0_killer_2nd_entity_config_only`. Each one
encodes one of M1's specific guarantees that doesn't already follow from M0.

> **Killer test rules** (sealed baseline §7): named so future engineers find by intent;
> docstring tied to the protected invariant; **never** skipped, flaky, or xfail.

### KT-M1-1. `test_m1_real_customer_lifecycle_config_only`

**Lives at:** `backend/tests/test_api.py` (sibling of `test_m0_killer_2nd_entity_config_only`).

**Proves:** a real-ISP customer-shape entity (with `customer_type ∈ {RESIDENTIAL, BUSINESS,
WHOLESALE}`, status workflow `LEAD → PROSPECT → ACTIVE → SUSPENDED → CHURNED`,
3+ custom fields) goes end-to-end through config alone: defined via `POST /meta/entities`,
record created, transitioned, RBAC-gated against an agent role lacking grants,
audit lineage assembled.

**Why required:** M0 proved an SLA-style entity works; M1's claim is that the
**real customer entity shape** the platform will actually serve also works.
Without this test, M1's thesis is "we believe it generalizes" — not "we
proved it does".

### KT-M1-2. `test_m1_provisioning_workflow_through_workflow_engine`

**Lives at:** `backend/tests/test_api.py`.

**Proves:** a multi-stage provisioning workflow (PENDING → SURVEY_SCHEDULED →
SURVEY_DONE → INSTALL_BOOKED → ACTIVATED), declared via
`/meta/entities/{slug}/transitions`, fires through the existing
`WorkflowEngine` — every stage emits an audit row; undeclared jumps fail
with 409; the engine treats this just like the M0 SLA workflow.

**Why required:** [I1](#i1-kernel) — the WorkItem movement engine stays fixed.
A real ISP's provisioning lifecycle is its hardest workflow; if it requires
engine surgery, the engine is too narrow and we have a successor-baseline
conversation. If this test passes, the engine generalizes.

### KT-M1-3. `test_m1_deploy_contract_real_providers_boot`

**Lives at:** `backend/tests/test_deploy_contract.py`.

**Proves:** with `ENVIRONMENT=production`, all four `*_PROVIDER` env vars set
to real provider names (`stripe`, `sendgrid`, `twilio`, `freeradius`), the
deploy contract passes. With any one of them set to `mock`, the contract
refuses.

**Why required:** [I8](#i8-deploy-contract). The existing
`test_production_with_separate_roles_passes` patches every value individually;
this test exercises the **full M1 production env shape** as one assertion.

### KT-M1-4. `test_m1_killer_under_realistic_data_shape`

**Lives at:** `backend/tests/test_api.py` (gated by a `@pytest.mark.perf` marker so
fast-feedback CI skips it; nightly CI runs it).

**Proves:** with 10K customers + 25K services + 100K invoices seeded as
fixtures, the M0 killer test wall time stays ≤ 1.5× its empty-DB baseline
(documented per-environment in the test docstring).

**Why required:** the performance budget from S3 needs a teeth-bearing
test, not just a number in a doc. A PR that adds an N+1 query inside the
generic record router would otherwise pass CI silently.

> **Marker discipline.** `@pytest.mark.perf` is the ONE marker M1 introduces.
> It's added to `pytest.ini` in the same PR as the test. Other markers
> (skip / xfail / flaky) are still forbidden on killer tests.

### KT-M1-5. `test_m1_per_tenant_feature_flag_isolation` *(added 2026-06-05 by Q5 resolution)*

**Lives at:** `backend/tests/test_feature_gate.py` (new or extending an existing file).

**Proves:** tenant A enables `dunning_automation` via `PATCH /api/tenants/{A}/feature-flags`; tenant B doesn't touch the flag. A platform-wide automation pass affects only A's overdue invoices, never B's. The fallback semantics work: a tenant that has never set the flag inherits the env-var default.

**Why required:** Q5's "per-tenant feature flags in M1" decision introduces a new gating axis. Without this test, a future PR that silently treats all flags as platform-wide could regress per-tenant behavior and we'd find out from a tenant complaint, not from CI.

### KT-GXL-1. `test_gxl_cross_record_guard_evaluation` *(added 2026-06-05 by Q1 resolution)*

**Lives at:** `backend/tests/test_workflow_engine.py`.

**Proves:** the new GXL cross-record resolver — landed in Phase 1.5 — works end-to-end. A `service.activate` transition guarded by `account.balance_due == 0` evaluates against the linked customer's account row; the transition is refused when the account has unpaid balance and allowed when paid. Also asserts the timing constraint (R14): the guard issues at most one extra query per evaluation (no N+1).

**Why required:** Q1 committed M1 to extending GXL with cross-record reach. The successor sealed baseline (`SEALED-ARCHITECTURE-BASELINE-<date>-GXL-EXTENSION.md`) defines the new surface; this test is the surface's mechanical proof. **Phase 1.5's exit gate.**

### Killer test inventory after M1

| Test | M0 | M1 |
|---|---|---|
| `test_m0_killer_2nd_entity_config_only` | ✓ (baseline) | ✓ unchanged |
| `test_studio_create_entity` (sibling existence proof) | ✓ | ✓ unchanged |
| RLS suite (3 files, 4 deploy contract tests) | ✓ | ✓ — `backend-rls` job goes hard |
| `test_m1_real_customer_lifecycle_config_only` | — | ✓ NEW (KT-M1-1) |
| `test_m1_provisioning_workflow_through_workflow_engine` | — | ✓ NEW (KT-M1-2) |
| `test_m1_deploy_contract_real_providers_boot` | — | ✓ NEW (KT-M1-3) |
| `test_m1_killer_under_realistic_data_shape` | — | ✓ NEW (KT-M1-4, perf-marked) |
| `test_m1_per_tenant_feature_flag_isolation` | — | ✓ NEW (KT-M1-5, from Q5) |
| `test_gxl_cross_record_guard_evaluation` | — | ✓ NEW (KT-GXL-1, from Q1, Phase 1.5 gate) |

---

## 9. Manual staging smoke plan

Extends the M0 smoke (12 steps from the staging readiness report) with M1-specific verifications.
Run in this exact order during P6.3. Each step has explicit pass criteria; a failure on any step is a NO-GO that halts cutover and triggers rollback.

| # | Step | Pass criteria |
|---|---|---|
| 1–12 | **M0 baseline smoke** (Studio → create entity → record → transition → audit → RBAC → tenant isolation → page reload → no hardcoded assumptions) | All 12 must still pass against the M1 build. |
| 13 | **Real-customer lifecycle in UI** — admin creates a Customer with `customer_type=BUSINESS`, transitions LEAD → PROSPECT → ACTIVE. | Each transition emits an audit row visible in the canonical Audit tab. |
| 14 | **Service provisioning** — admin attaches a Service to the customer, walks PENDING → SURVEY_SCHEDULED → ... → ACTIVATED. | Each transition appears in the customer's Timeline tab; status pill colors correct. |
| 15 | **Invoice generation** — admin triggers invoice generation for the customer's active service. | Invoice created with correct amount; visible in customer's Invoices tab; audit row recorded. |
| 16 | **Payment via real Stripe (test mode)** — admin processes payment using Stripe's test card. | Payment confirmed; receipt URL accessible; webhook delivered; invoice marked PAID; audit row. |
| 17 | **Email notification** — payment confirmation email arrives at a real inbox (via SendGrid). | Email received within 30s; correct branding; renders in major clients. |
| 18 | **Custom entity full flow** — tenant admin opens Studio, creates a brand-new entity (e.g., `OutageIncident`) from scratch, creates 2 records, transitions one, all via the running app. | All 4 auto-permissions present; entity in nav; tenant isolation verified by logging into a 2nd tenant. |
| 19 | **Performance feel** — customer list (with 10K rows seeded) loads in < 2s perceived; search returns in < 500ms. | Manually timed; no spinner > 2s. |
| 20 | **Production deploy contract** — restart the app with `PAYMENT_GATEWAY_PROVIDER=mock`. | App refuses to boot with the exact `mock providers in production` error. Revert env, restart, boot succeeds. |
| 21 | **RBAC under real role** — log in as agent (limited grants); attempt to view the OutageIncident entity. | Either hidden from nav or 403 on direct URL — never silent visibility. |
| 22 | **Cross-tenant isolation under real data shape** — log in to a 2nd tenant's super_admin (set up specifically for this smoke); verify zero leakage of the first tenant's customers / invoices / custom entities. | 2nd tenant sees only its own rows (= zero, for a fresh 2nd tenant). |

**Evidence to capture** during the smoke:
- CI run URL on the build under test.
- Stripe dashboard screenshot showing the test charge.
- SendGrid delivery log entry for the notification email.
- DB query: `SELECT type, entity_key, count(*) FROM event WHERE tenant_id = '<tenant-uuid>' GROUP BY 1,2` — shows the full audit shape.
- Studio entity creation HAR file from step 18.
- Page-load timing screenshots from step 19.

**Failure handling:** any failure between steps 13–22 is logged, screenshotted, NO-GO declared. Steps 1–12 failing is M0 regression — STOP, rollback to the snapshot, file a P0.

---

## 10. Rollback plan

M1 inherits the M0 rollback tiers (sealed baseline §10's three-tier plan) and adds M1-specific scenarios.

### Tier 1 — Application revert (5–10 min)

Triggered by: UI bug, transient API failure, killer test fails after deploy.

Action: revert the frontend / backend container to the last known good tag (pre-M1 commit `82c3e39` or whatever the prior phase exit gate commit was). Tenant data stays intact. Audit trail is append-only — no cleanup needed.

### Tier 2 — Migration revert (10–30 min)

Triggered by: schema-level bug surfaced after deployment (e.g., a new tenant-scoped table's RLS policy is malformed).

Action: `alembic downgrade -1` to the previous head. Stop the FastAPI process before reverting the binary so connections drain. Tenant data stays intact (every migration is reversible). If the bug was in a custom-entity definition (not a migration), there's nothing to downgrade — fix forward.

### Tier 3 — Provider revert (within 60 min of detected money-movement issue)

Triggered by: real-payment failures (Stripe webhooks not delivered; duplicate charges; refund failures).

Action: switch `PAYMENT_GATEWAY_PROVIDER` from `stripe` back to ... **NOT `mock`** — production deploy contract forbids `mock`. Instead:
1. If staging: `mock` is fine; the deploy contract is dev-default.
2. If production: revert to a known-good Stripe configuration (different account, archived keys, etc.) and restart. If no good Stripe config is available, take the payment endpoints OFFLINE (feature flag `feature_payment_enabled=false` — to be added in P2.C as a new feature gate, see E9) and restart.

The fact that there's no clean "production fallback" for payment is itself a risk — it's documented and accepted because the alternative (allow `mock` in production via a flag) violates [I8](#i8-deploy-contract).

### Tier 4 — Tenant data snapshot restore (1–4 hours)

Triggered by: catastrophic data corruption — multi-table inconsistency, audit gap that can't be reconstructed, tenant complaint.

Action: restore from the `pre-m1-baseline` snapshot taken in P0.2. Tenant data goes back to pre-cutover state. Apply any audit-emit-able replay through the API surface (no direct INSERT). Document the incident in `docs/incidents/M1-<date>.md`.

### Tier 5 — Killer test fails after M1 ship (immediate, automatic)

Triggered by: any future PR that breaks `test_m1_*` or `test_m0_killer_*` in CI.

Action: **the PR doesn't merge.** That's the entire mechanism. The killer tests in CI are the canary; if any of them fail, the build fails before the merge. If somehow they reach `main` (e.g., a force-push) and break post-merge, immediately revert the merge commit and document the bypass. This is the same mechanism M0 had; M1 just expands the set of canaries.

### Rollback rehearsal

P6 includes a **rollback rehearsal** between P6.4 and P6.5: deploy M1, deliberately trigger Tier 1 + Tier 2 against staging, confirm both work, document the timings. **The cutover doesn't happen if the rollback rehearsal hasn't.**

---

## 11. Acceptance criteria

M1 ships when ALL of the following are true. Partial completion is not "M1 shipped" — it's "M1 in progress".

### A1. CI is green and hardened

- `pytest --tb=short -q` passes (full suite, ≥ 1768 tests, 0 failed, 0 errors).
- `tools/check_drift.py` passes (11+ HARD + 8+ RATCHET, no ratchet over baseline).
- `backend-rls` CI job is green **without** `continue-on-error` ([TD13 resolved](#td13-resolved)).
- Frontend `tsc --noEmit` passes.

### A2. New killer tests are in CI and passing

- KT-M1-1: `test_m1_real_customer_lifecycle_config_only` — passes.
- KT-M1-2: `test_m1_provisioning_workflow_through_workflow_engine` — passes.
- KT-M1-3: `test_m1_deploy_contract_real_providers_boot` — passes.
- KT-M1-4: `test_m1_killer_under_realistic_data_shape` — passes (under `@pytest.mark.perf`, runs in nightly CI).
- KT-M1-5: `test_m1_per_tenant_feature_flag_isolation` — passes (Q5 resolution).
- KT-GXL-1: `test_gxl_cross_record_guard_evaluation` — passes in both `backend` and `backend-rls` jobs (Q1 resolution, Phase 1.5 gate).

### A3. M0 thesis still proven

- `test_m0_killer_2nd_entity_config_only` passes byte-for-byte unchanged.
- The M0 staging smoke (12 steps) still passes against the M1 build.

### A4. Real providers wired in production

- `PAYMENT_GATEWAY_PROVIDER=stripe` (live key in prod, test key in staging).
- `EMAIL_GATEWAY_PROVIDER=sendgrid`.
- `SMS_GATEWAY_PROVIDER=twilio`.
- `RADIUS_BACKEND_PROVIDER=freeradius` if the tenant uses RADIUS; else stays `mock` with `FEATURE_RADIUS_REQUIRED=false`.
- Production deploy contract passes at boot.

### A5. First real tenant cutover succeeded

- Real tenant has at least one real customer with at least one real service.
- At least one Stripe charge (test mode for staging; live for production) has settled successfully against an invoice for that customer.
- Audit trail for that customer's lifecycle shows the expected event types (CREATE × N, TRANSITION × N, payment-related events).

### A6. Performance budgets met

- M0 killer test wall time ≤ 1.5× M0 baseline under realistic data shape.
- Customer list page TTI ≤ 2s (P95) at 10K customer rows.
- `/api/customers?q=...` search response ≤ 500ms (P95).

### A7. Documentation handoff complete

- `docs/runbooks/M1-TENANT-ONBOARDING.md` exists, is reviewed, and has been successfully executed end-to-end by someone other than the author against a fresh staging tenant.
- This M1 plan (this file) has been amended with an `M1 SHIPPED` status block once A1–A6 are all green.
- The GXL successor sealed baseline `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<phase-1.5-date>-GXL-EXTENSION.md` exists, was reviewed before any GXL code landed, links back to the 2026-06-05 baseline, and locks in the cross-record GXL surface (Q1 resolution).
- No OTHER invariant in `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` was weakened. If any was relaxed beyond the documented GXL extension, an additional successor file exists and justifies that relaxation.

---

## 12. Open questions / successor-baseline candidates

These are decisions M1 will need to make. Each is tagged with how the decision lands: **resolved-in-plan** (decided here; no successor baseline needed), **needs-review** (needs Gev's input before P1 starts), or **successor-candidate** (if the decision relaxes a §3 invariant, it becomes a new sealed-baseline file).

> **Resolution log — 2026-06-05.** Gev resolved Q1, Q5, Q8. See each
> question below for the decision. The implementation sequence ([§7](#7-implementation-sequence))
> is updated accordingly: Phase 1.5 (GXL extension + per-tenant feature flags)
> is inserted between Phase 1 (backend-rls hardening) and Phase 2 (real
> provider wiring). Phase 1.5's first artifact is the successor sealed
> baseline `SEALED-ARCHITECTURE-BASELINE-<post-Q1-decision-date>.md`
> that locks in the new GXL surface.

### Q1. GXL expressiveness for workflow guards (R10) — **RESOLVED: yes**

Some tenant workflows want guards like "can transition to ACTIVE only if billing account is current". Today's `WorkflowDef.config.transitions[].guard` uses GXL. **Does GXL cover this?**

- **Status:** RESOLVED. Gev: **"Yes, GXL must support business-condition workflow guards."**
- **Implication:** GXL must reach cross-record state (e.g., the customer's `account.balance_due`, an SLA's status, an open approval). That's an extension of the language surface consumed by the WorkItem-movement engine. Under [A2](#a2-five-engines-fixed) the engine stays one of the 5 — but its *vocabulary* widens.
- **Decision:** **successor-candidate confirmed.** Phase 1.5 of M1 ([§7](#7-implementation-sequence)) lands the GXL extension. Its first task — before any code lands — is to draft `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<post-Q1-decision-date>.md` defining:
  1. The new GXL identifier-resolution surface (what cross-record references are reachable: same-entity fields, owner-account fields, parent-entity fields).
  2. The cardinality contract (single record only — no aggregates over a collection, to avoid hidden N+1 in transition).
  3. Authorization model: who can write a guard that reaches across records (super_admin only at first, expanding only by explicit grant in a future successor baseline).
  4. Killer test KT-GXL-1: a tenant defines a guard `account.balance_due == 0` for the `service.activate` transition; the engine refuses the transition when the linked account has unpaid balance and allows it when paid. Lives at `backend/tests/test_workflow_engine.py`.
- **What this does NOT change:** [I1](#i1-kernel) (engine count stays 5), [I2](#i2-audit-append-only) (every guarded transition still emits one event), [I5](#i5-config-only-entities) (the guard itself is config, not code).
### Q2. New field types beyond the 12 in `ALLOWED_TYPES`

A real ISP might want: `cidr` (network range), `mac_address` (RADIUS), `gps_point` (site survey), `signed_url` (file uploads to S3). Each is an E2 extension.

- **Status:** resolved-in-plan. Each new field type lands its own PR with the 4-piece pattern (backend `ALLOWED_TYPES` + validator + frontend `FieldInput` + entity-creation killer test) before any entity uses it. No successor baseline needed — E2 already exists.

### Q3. Bulk tenant data migration script (R5)

If the first tenant has 50K pre-existing customers in their old system, importing them one-record-at-a-time through `POST /api/customers` might take hours. Acceptable for one-time cutover?

- **Status:** resolved-in-plan. Yes — one-time cutover within a planned maintenance window is acceptable. Throughput is bounded by Postgres write speed, not by the API ceremony; a `POST` per customer is roughly 1–10ms. 50K customers × 5ms ≈ 4–5 minutes total. If the volume crosses an order of magnitude (500K+), revisit — but [I2](#i2-audit-append-only) is non-negotiable; bulk SQL bypass remains forbidden.

### Q4. New ratchet rule: no new entity-specific routes (R6)

The forbidden pattern §4 lists "no new entity-specific routes" as **implicit doctrine, no drift rule yet**. M1 is the right time to add the ratchet rule.

- **Status:** resolved-in-plan. Phase 1 (Pre-flight + RLS hardening) closes with a new HARD drift rule: `@router\.(get|post|patch|delete)\("/api/(customers|invoices|services|...)/[^{]` outside the generic record router → fail. (The exact regex landed in the PR that adds it.)
- **Not a successor-baseline candidate** because it *strengthens* the doctrine — adding a rule that enforces an already-stated invariant.

### Q5. Per-tenant feature flags — **RESOLVED: in M1** · ✅ LOCKED 2026-06-05

> **LOCKED 2026-06-05** — implemented in commit `9662ea5`; KT-M1-5 (`test_m1_per_tenant_feature_flag_isolation`) green in CI run [`27036230536`](https://github.com/ohanyan88-cmd/GAAhex/actions/runs/27036230536). Server-side reader at `backend/app/services/tenant_flag.py`; per-tenant gating wired in `scheduler.py::_run_for_tenant` via `_TENANT_FLAG_GATED_JOBS` map. The "extend `is_enabled(feature, tenant_id=None)`" wording in the design sketch below is **superseded** — the corrected shape is a separate `tenant_flag.py` helper per [`docs/standards/FEATURE_GATING_POLICY.md`](../standards/FEATURE_GATING_POLICY.md). The rest of this section is preserved as the design record.

Today's feature gates are platform-wide (`FEATURE_RADIUS_REQUIRED`). Some M1 tenants might want a feature ON for tenant A but OFF for tenant B (e.g., dunning automation: M1 tenant wants it; future M2 tenants might not).

- **Status:** RESOLVED. Gev: **"Per-tenant feature flags already in M1."**
- **Decision:** **resolved-in-plan.** Phase 1.5 of M1 ([§7](#7-implementation-sequence)) lands the per-tenant feature-flag layer alongside the GXL extension.
- **Design sketch (refined during Phase 1.5):**
  1. A new `tenant_feature_flag` table (`tenant_id` + `flag_key` + `enabled` + `updated_at` + `updated_by`) — tenant-scoped with the standard `tenant_isolation` RLS policy ([E6](#extension-points-used)).
  2. `app/services/feature_gate.py:is_enabled(feature, tenant_id=None)` grows an optional `tenant_id` parameter. When provided, the lookup checks `tenant_feature_flag` first, then falls back to the env-var default. When omitted (boot-time / non-request-scoped), behaves identically to today.
  3. The existing 4 features (`radius`, `olt_provisioning`, `import_engine`, `warehouse`) stay env-var-only — they're deploy-shape concerns, not tenant preferences. New M1 features (`dunning_automation`, `self_serve_signup`, etc.) opt into per-tenant by passing `tenant_id` at the call site.
  4. The deploy contract still gates env-var defaults; per-tenant overrides can only be set by a tenant's own super_admin (audit-logged via `workflow.emit`).
- **Killer test KT-M1-5** (added to the inventory in [§8](#8-killer-tests-required) below as a sibling to KT-M1-1..4): tenant A enables `dunning_automation`, tenant B doesn't; an automation pass affects only tenant A's overdue invoices. Proves per-tenant isolation of feature flags AND that the gate falls back correctly for non-overridden tenants.
- **What this does NOT change:** [I1](#i1-kernel) (still no 6th engine — this lives in `app/services/`, beside the security engine). [I3](#i3-tenant-isolation) (the new table is tenant-scoped + RLS-protected from migration #1). [I8](#i8-deploy-contract) (env-var contract still enforced for deploy-shape gates). No successor baseline needed — this is a pure E6 + E9 extension.

### Q6. Tenant-onboarded entities — pre-seed vs. runbook-driven

For entities the platform ships with (customer, invoice, etc.), seed lives in `app/seed.py`. For entities the *tenant* needs (OutageIncident, etc.), should they be in seed code or in the runbook (tenant runs the POST themselves)?

- **Status:** resolved-in-plan. Default to **runbook** — the tenant runs the POST during onboarding. This proves the killer-test thesis viscerally: the entity is born from config, not code. If the same custom entity appears across 3+ tenants, *then* it earns a place in `app/seed.py` as an idempotent helper.

### Q7. Killer test under realistic data — where do the budgets come from?

KT-M1-4 needs concrete numbers. Today's M0 killer is ~8s isolated. What's the right multiplier?

- **Status:** resolved-in-plan. 1.5× ≈ 12s as the M1 upper bound. The budget is **per environment**: CI may differ from local; both are documented in the test docstring. A budget breach is a regression; the PR owes a performance fix, not a budget increase. The budget itself can be revised in a successor sealed baseline if the real data shape ends up much larger than S3 assumed.

### Q8. `backend-rls` job — what if a real RLS gap can't be fixed in M1? — **RESOLVED: Fix Forward by default**

The phase 1 exit requires the dual-role job to be hard-green. If P1 surfaces a gap that needs an architectural fix (e.g., a query that genuinely needs the owner role to be correct), what happens?

- **Status:** RESOLVED. Gev: **"Fix Forward default policy. Exemption only in exceptional cases."**
- **Decision:** **resolved-in-plan, default Fix Forward.** Every RLS gap surfaced by Phase 1 is fixed before Phase 1's exit gate. The fix path:
  1. Query that genuinely needs the owner role → audit whether it's actually a pre-auth / no-tenant code path (login lookup, `/org-tree`, seed). If yes, it's already in the documented exception list ([sealed baseline §3 I3](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i3-tenant-isolation-engages)). If no, it's a bug — refactor the query to bind `tenant_id` correctly.
  2. Query that filters by tenant but the static analyzer / runtime audit missed → add the explicit `tenant_id` filter; promote the missing pattern to the static analyzer's catch list.
  3. Query that uses raw SQL bypassing SQLAlchemy → rewrite via SQLAlchemy or add a new tenant-scoped query helper in `app/services/`.
- **Exemption channel (last resort):** if and only if a query is provably correct under the owner role and has no tenant-scoped equivalent (e.g., a system-wide health check that legitimately reads across tenants), it lands in a successor sealed baseline as an **enumerated exemption** with: the exact query, the justification, the migration path back to RLS-clean, and a regression test that confirms the query continues to need owner-role and isn't a leak vector. Each exemption is its own line in the successor baseline; no batch exemptions.
- **Default expectation:** Phase 1 surfaces 0–2 real gaps, both fixable in-line. The exemption path is build-paranoid scaffolding; if M1 needs to use it more than twice, that's a signal the platform's RLS posture itself needs a re-think, not more exemptions.

### Q9. Successor sealed baseline trigger (added 2026-06-05 by Q1's resolution)

Q1's resolution committed M1 to extending GXL. **When does the successor sealed baseline get drafted?**

- **Status:** resolved-in-plan. The successor baseline is drafted as the **first artifact of Phase 1.5**, before any GXL implementation code lands. The file name is `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<implementation-start-date>-GXL-EXTENSION.md`. It links back to the 2026-06-05 baseline; it does not supersede it — it sits beside it as a sealed addendum that locks in the GXL extension surface.
- **What goes in it:** the four bullet points from Q1's decision (resolution surface, cardinality contract, authz model, KT-GXL-1 killer test) plus a "compatibility window" section that confirms every existing GXL guard still parses and evaluates identically (no semantics drift).
- **Review process:** drafted by the engineer, reviewed by Gev for product-shape, reviewed by anyone else with `code-reviewer` role for invariant impact. Merge of the successor baseline is the gate for starting GXL implementation.

---

## Closing

This plan is a contract with the sealed baseline. Every M1 work item maps to an
approved extension point, honors the protected invariants, and uses the existing
engines without surgery. Every M1 risk has a mitigation that is itself a
baseline-respecting practice. Every M1 killer test rides alongside M0's killer
test, not replacing it — the regression net grows; it never narrows.

When M1 ships, this file gets an `M1 SHIPPED` status block at the top, and the
next planning cycle (M2 admin UI for onboarding) opens its own plan file
`docs/roadmap/M2-MULTI-TENANT-ONBOARDING-PLAN.md` against this baseline and
whatever successor sealed-baseline files M1 produced along the way.

The seal holds. We ship product on top of it, not against it.

— Ընգեր, 2026-06-05
