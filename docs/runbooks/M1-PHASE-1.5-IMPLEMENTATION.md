# M1 Phase 1.5 — Implementation Runbook

**Audience:** the engineer who picks up Phase 1.5 of the M1 expansion. Read this before opening a PR.

**Prerequisites:**
1. Read `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` — the architectural contract.
2. Read `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` — the **DRAFT SHELL** sealed addendum for Track A. Your first job is to fill in the *(filled at design review)* placeholders and get it sealed.
3. Read `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` §7 Phase 1.5 — the two-track sequence with explicit exits.

**Status of this runbook:** living document. Update as you go — every step you complete, mark it ✓ here. Every surprise you hit, add a "Gotcha" subsection. When Phase 1.5 ships, this runbook gets a `PHASE 1.5 SHIPPED` block at the top.

---

## Phase 1.5 has TWO tracks running in parallel

| Track | Owner of decisions | Lands |
|---|---|---|
| **A.** GXL cross-record extension (Q1 resolution) | Engineer + Gev product-shape sign-off | Successor sealed baseline → resolver code → KT-GXL-1 → frontend WorkflowsPane help text |
| **B.** Per-tenant feature flags (Q5 resolution) | Engineer (mostly self-determined; Gev rubber-stamps the migration shape) | Migration + table + extended `is_enabled` + CRUD endpoints + KT-M1-5 + new RATCHET rule |

The phases share a review window because both touch the security / feature-gate surface; reviewers can batch the conversation. **Land them in separate PRs** so revert blast radius stays tight.

---

## Track A — GXL Cross-Record Extension

### A.0 — Seal the addendum (the only thing that gates everything else)

| Step | What | Done? |
|---|---|---|
| A.0.1 | Open `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md`. Read every section. | [ ] |
| A.0.2 | Fill in §2.1's *(filled at design review)* placeholder: the exact identifier-resolver query shape. Pseudocode is fine; the contract is "one extra SELECT per linked record, parameterized, RLS-respecting." | [ ] |
| A.0.3 | Fill in §2.3's placeholder: the exact super_admin scope predicate name (look at `app/access.py` for the canonical scope check pattern). | [ ] |
| A.0.4 | Fill in §2.4's placeholder: the exact list of existing GXL test files that prove the compatibility window. | [ ] |
| A.0.5 | Fill in §6's *(filled at design review)* placeholders: the exact assertion shape for KT-GXL-1 (any helper functions, fixture entities, etc.). | [ ] |
| A.0.6 | Walk the §3 "What this addendum does NOT change" table with a `code-reviewer` — confirm each invariant is genuinely preserved by your draft. | [ ] |
| A.0.7 | Get Gev's product-shape sign-off in the PR description (one-paragraph "yes, this is what I meant"). | [ ] |
| A.0.8 | Flip the addendum's header from `DRAFT SHELL` to `SEALED <date>`. **Merge the addendum PR.** | [ ] |
| A.0.9 | **Stop here if any A.0 step is incomplete.** No GXL implementation code lands while the addendum is `DRAFT SHELL`. This is the I10 mechanism. | [ ] |

### A.1 — Add the parser-level rejection rules (red tests first)

Add these tests **before** changing the resolver. They prove the forbidden patterns from the addendum §5 are rejected:

| Step | Test | File |
|---|---|---|
| A.1.1 | Multi-hop ref `account.holder.name` → ParseError | `backend/tests/test_gxl_parser.py` (new or extend existing) |
| A.1.2 | Aggregate `count(services) > 5` → ParseError | same |
| A.1.3 | Side-effect function `now() > 0` → ParseError | same |
| A.1.4 | SQL-injectable identifier `"; DROP TABLE` → ParseError | same |
| A.1.5 | External-service call `http_get(...)` → ParseError | same |
| A.1.6 | All these tests RED before implementation; GREEN after. **TDD discipline.** | [ ] |

### A.2 — Implement the parser change

| Step | What | File |
|---|---|---|
| A.2.1 | Locate the existing GXL grammar in `backend/app/gxl.py` (or wherever the parser lives — `grep -rn "def parse" backend/app/gxl*.py`). | [ ] |
| A.2.2 | Add the one-hop identifier production: `<local_field>` OR `<ref_field>.<linked_field>`. Reject `a.b.c` at parse time. | [ ] |
| A.2.3 | Add forbidden-pattern guards for aggregates / side-effects / SQL-injection / external calls. Each one raises a specific parse error with a clear message (the runbook quotes from addendum §5 verbatim). | [ ] |
| A.2.4 | Re-run the A.1 tests — they should turn GREEN. | [ ] |
| A.2.5 | Run the existing GXL test suite — every existing guard string MUST still parse (compatibility window from addendum §7). If any fails, the parser change is wrong. | [ ] |

### A.3 — Implement the resolver

| Step | What | File |
|---|---|---|
| A.3.1 | Add the resolver function that takes a parsed guard expression + the record being transitioned, identifies all `<ref_field>.<linked_field>` identifiers, fetches the referenced rows in **one pass** (group by ref_field; one SELECT per distinct ref_field — multiple linked-field reads share the fetched row). | `backend/app/gxl.py` or new `gxl_resolver.py` |
| A.3.2 | The fetch query MUST: (a) use parameterized SQL (no string-concat); (b) run under the request's RLS GUC (`gaahex.tenant_id` already bound); (c) return `null` if the row isn't found (could be deleted, could be cross-tenant). | [ ] |
| A.3.3 | Integrate the resolver into the transition handler so guards evaluate with cross-record state available. The integration point is wherever `gxl.eval(guard, context)` is currently called from `WorkflowEngine`. | [ ] |
| A.3.4 | Add the **timing assertion** as part of KT-GXL-1: wrap the resolver call with a SQLAlchemy event listener that counts queries; assert ≤ 1 extra query per evaluation regardless of how many cross-record identifiers the guard references. | [ ] |

### A.4 — Implement KT-GXL-1 (the killer test)

Per addendum §6. The full test setup (one account entity, one service entity, one transition with cross-record guard, account in arrears, etc.) is detailed in the addendum.

| Step | What | Done? |
|---|---|---|
| A.4.1 | Add `test_gxl_cross_record_guard_evaluation` to `backend/tests/test_workflow_engine.py`. | [ ] |
| A.4.2 | Test passes in `pytest --tb=short -q` (the `backend` job). | [ ] |
| A.4.3 | Test passes in the `backend-rls` job (NOSUPERUSER role). Proves RLS engages on the cross-record fetch. | [ ] |
| A.4.4 | Add the test name to `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` §7 killer test inventory (per I10, the only edit to the baseline is appending the killer test name — discuss with Gev whether this counts as "footer-link" territory or needs its own micro-successor file). **Default position:** appending to the killer-test inventory is the same channel as appending a successor-baseline link, so it lands. | [ ] |

### A.5 — Implement the write-time super_admin check

Per addendum §2.3 / GXL-I3.

| Step | What | File |
|---|---|---|
| A.5.1 | In `backend/app/routers/meta.py`'s `PUT /meta/entities/{slug}/transitions` handler, after parsing each transition's `guard`, check if the parsed AST contains any cross-record identifier (a `.` in any identifier node). If yes, require the caller to have `super_admin` scope. | [ ] |
| A.5.2 | Test: an admin without super_admin authors a guard `account.balance_due == 0` → 403 with message "Cross-record GXL guards require super_admin scope." | [ ] |
| A.5.3 | Test: super_admin authors the same guard → 200. | [ ] |
| A.5.4 | Test: any admin authors a local-only guard `status == 'ACTIVE'` → 200 (unchanged from today). | [ ] |

### A.6 — Implement the frontend Studio help text

Small frontend work — no new primitives, just a help text + a parse-error display.

| Step | What | File |
|---|---|---|
| A.6.1 | In `frontend/src/studio/WorkflowsPane.tsx` (or wherever transition guards are edited), add help text below the guard input — quote the addendum §8 description verbatim. | [ ] |
| A.6.2 | On API error (the new 403 for super_admin scope OR a parse error), surface the server message cleanly in the UI — no swallowed errors. | [ ] |
| A.6.3 | `tsc --noEmit` passes. | [ ] |

### A.7 — Track A exit gate

- [ ] All A.0–A.6 boxes checked.
- [ ] Addendum is `SEALED`.
- [ ] KT-GXL-1 + 5 parser-rejection tests passing in both CI jobs.
- [ ] Existing GXL test suite passes unmodified.
- [ ] Compatibility corpus tests (if implemented per addendum §7) passing.

---

## Track B — Per-Tenant Feature Flags

No successor sealed baseline needed for this track — it's a pure E6 + E9 extension (per Q5 resolution in M1 plan §12).

### B.1 — Migration: `tenant_feature_flag` table

| Step | What | File |
|---|---|---|
| B.1.1 | `alembic revision -m "per_tenant_feature_flags"`. | [ ] |
| B.1.2 | Schema: `tenant_id UUID FK→tenant.id NOT NULL`, `flag_key VARCHAR(120) NOT NULL`, `enabled BOOLEAN NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_by UUID FK→app_user.id`. Composite PK `(tenant_id, flag_key)` — one row per (tenant, flag) pair, upsert semantics. | [ ] |
| B.1.3 | **Same migration** adds RLS policy: `CREATE POLICY tenant_isolation ON tenant_feature_flag USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)`. NULLIF-guarded — matches the rest of the codebase. | [ ] |
| B.1.4 | Migration is reversible (`downgrade()` drops the policy then the table). | [ ] |
| B.1.5 | Migration runs cleanly under both `gaahex` (owner) and `gaahex_app` (NOSUPERUSER) — verify with `alembic upgrade head` + `alembic downgrade -1` + `alembic upgrade head` cycles. | [ ] |

### B.2 — Extend `feature_gate.is_enabled` signature

| Step | What | File |
|---|---|---|
| B.2.1 | Edit `backend/app/services/feature_gate.py`. Add a kwarg: `def is_enabled(feature: str, tenant_id: UUID | None = None) -> bool:`. | [ ] |
| B.2.2 | When `tenant_id` is provided AND the `tenant_feature_flag` table has a row for `(tenant_id, feature)`, that row's `enabled` value wins. Else, fall back to the existing env-var lookup. | [ ] |
| B.2.3 | The 4 existing deploy-shape flags (`radius`, `olt_provisioning`, `import_engine`, `warehouse`) IGNORE `tenant_id` — they're deploy-shape, not tenant-preference. Hardcode the bypass for these 4 keys. | [ ] |
| B.2.4 | Add a unit test: per-tenant override works for a non-deploy-shape flag. Per-tenant override is ignored for the 4 deploy-shape flags. | [ ] |

### B.3 — Add CRUD endpoints for tenant feature flags

| Step | What | File |
|---|---|---|
| B.3.1 | New router `backend/app/routers/tenant_feature_flags.py`. Endpoints: `GET /api/tenants/{tenant_id}/feature-flags` (list), `PATCH /api/tenants/{tenant_id}/feature-flags/{flag_key}` (upsert enabled). | [ ] |
| B.3.2 | Gate the PATCH on `tenant.settings.manage` permission (already exists in the registry; or auto-generate during the migration if not). | [ ] |
| B.3.3 | Every PATCH emits `workflow.emit(... 'TENANT_FEATURE_FLAG_CHANGED' ...)` — audit row mandatory. | [ ] |
| B.3.4 | Tests: super_admin can flip; non-admin gets 403; cross-tenant attempt (PATCH a different tenant's flag) is RLS-blocked (returns 404 from the policy). | [ ] |

### B.4 — Implement KT-M1-5

Per M1 plan §8.

| Step | What | Done? |
|---|---|---|
| B.4.1 | Add `test_m1_per_tenant_feature_flag_isolation` to `backend/tests/test_feature_gate.py` (new file or extend). | [ ] |
| B.4.2 | Setup: tenant A and tenant B both exist (via cross-tenant fixture); both have the new flag default-disabled by env var; A flips it ON via PATCH. | [ ] |
| B.4.3 | Assertion: `is_enabled('dunning_automation', tenant_id=A)` → True; `is_enabled('dunning_automation', tenant_id=B)` → False. | [ ] |
| B.4.4 | Assertion: `is_enabled('radius', tenant_id=A)` is unchanged regardless of per-tenant flag flip (deploy-shape flag bypass). | [ ] |
| B.4.5 | Test passes in both `backend` and `backend-rls` jobs. | [ ] |

### B.5 — Add the new RATCHET drift rule

| Step | What | File |
|---|---|---|
| B.5.1 | Edit `tools/check_drift.py`. Add a RATCHET rule: `is_enabled\(` calls in `app/routers/`, `app/services/` (anywhere a `user` / `request` is in scope) that DON'T pass `tenant_id=` are counted. | [ ] |
| B.5.2 | Initial baseline auto-populates. Today's call sites (the 4 deploy-shape flags) all call without `tenant_id`, so the baseline starts at whatever that count is. Verify by running `python tools/check_drift.py --update` after the rule lands. | [ ] |
| B.5.3 | Document the rule's exception list (the 4 deploy-shape flag call sites) inline in the drift checker so future tenant-aware call sites can't pretend to be deploy-shape to dodge the ratchet. | [ ] |

### B.6 — Track B exit gate

- [ ] All B.1–B.5 boxes checked.
- [ ] Migration applies cleanly under both roles.
- [ ] KT-M1-5 passing in both CI jobs.
- [ ] RATCHET rule landed at baseline.
- [ ] M0 killer test passes unchanged (B.2's signature change is backward-compatible).

---

## Common gotchas (update as you encounter them)

### G1. Forgetting to add the RLS policy in the same migration

The sealed baseline's I3 is hard about this: **never** a two-step "table now, RLS next sprint." Migration must add both atomically. If you commit the table without the policy, the next PR will surface the leak.

### G2. Editing the addendum after sealing

Per I10 — once the addendum is `SEALED`, **only typo / link / cross-reference edits**. Any substantive change to the GXL surface AFTER sealing means a new successor file (`SEALED-ARCHITECTURE-BASELINE-<later-date>-GXL-V2.md`).

### G3. Marking a killer test with `@pytest.mark.skip` "temporarily"

Forbidden by sealed baseline §7. A killer test that's broken is the rollback signal — fix forward, don't suppress.

### G4. Touching `app/routers/records.py` to special-case the GXL extension

If you find yourself editing the generic record router for the GXL change, **stop.** The router is slug-agnostic by design (I5). All GXL work lives in `gxl.py`, `workflow_engine.py`, and `routers/meta.py` (for the write-time super_admin check). The record router is unchanged.

### G5. Performance regression on M0 killer test

The M0 killer test does NOT use cross-record guards (its workflow is `DRAFT → ACTIVE → RETIRED`, no guards). If your GXL change makes the M0 killer test slower, you've introduced an N+1 on the no-guard path — investigate before merging.

---

## Closing

Phase 1.5 is two parallel tracks, both modest in scope. Track A's hardest work is the **design review for the addendum** — once that's sealed, the code is mostly mechanical. Track B's hardest work is the **migration shape review** — the table + RLS policy + signature change must each be reviewed in isolation, then together.

When both tracks ship, run the full M0 + M1 manual smoke (22 steps in the staging readiness report). If green, mark this runbook `PHASE 1.5 SHIPPED` at the top and move on to Phase 2 (real provider wiring).

— Ընգեր, 2026-06-05 (autonomous session, runbook draft)
