# Q1 / Q5 / Q8 — Decision Package

**Date:** 2026-06-05
**Status:** DRAFT — package authored to lock the three remaining open architecture decisions before broader M1 execution
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`
**Author:** Ընգեր

> **Goal of this package.** The three Q's were *resolved in plan* on 2026-06-05 (Q1 = yes, Q5 = in M1, Q8 = Fix Forward) and noted in `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` §12. They are not yet **locked artifacts**. This document is the bridge — for each Q it states the current state, the options that were considered, the recommendation (with rationale), the architectural impact, and the exact documentation changes needed to flip the Q from *resolved in plan* → *LOCKED*.
>
> **Out of scope.** This package does not begin onboarding the pilot ISP, does not start production cutover, and does not reopen any stabilization work. It produces sealed-decision artifacts only.

---

## Summary table

| Q | Topic | Current resolution | Recommended lock action |
|---|---|---|---|
| **Q1** | GXL business-condition workflow guards | RESOLVED in plan (yes — extend GXL); DRAFT SHELL addendum exists | Fill the 7 acceptance-criteria placeholders and seal the addendum |
| **Q5** | Per-tenant feature flags | RESOLVED in plan (in M1, not later); model already exists in code | Extend `feature_gate.is_enabled()` to be tenant-aware + ship KT-M1-5 |
| **Q8** | RLS exemption policy ("Fix Forward" default) | RESOLVED in plan (Fix Forward default; exemption rare) | Spin the policy out of M1 plan §12 Q8 into a standalone standards doc |

---

# Q1 — GXL business-condition workflow guards

## Q1.1 Current state

**Locked decision:** *"Yes, GXL must support business-condition workflow guards"* (Gev, 2026-06-05).

**Existing artifacts:**

- `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` — **DRAFT SHELL** (11 sections, 7 acceptance-criteria boxes unchecked). Drafted as the first artifact of Phase 1.5 Track A.
- `docs/runbooks/M1-PHASE-1.5-IMPLEMENTATION.md` — runbook draft (committed `6c3336d`).
- `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` §12 Q1 — decision log entry.
- `backend/app/gxl.py` — today's GXL implementation (local-field only; the surface this addendum widens).

**What is already settled in the DRAFT addendum:**

| Surface decision | Locked in DRAFT |
|---|---|
| Single-hop cross-record resolution syntax (`<ref_field>.<target_field>`) | ✓ §2.1 |
| Cardinality contract: single record only, no aggregates | ✓ §2.2 / §5 |
| Authorship: super_admin only for cross-record reach | ✓ §2.3 |
| Compatibility window: byte-for-byte unchanged for existing guards | ✓ §2.4 / §7 |
| Killer test KT-GXL-1 specification | ✓ §6 |
| Forbidden patterns (GXL-F1 through GXL-F5) | ✓ §5 |
| Rollback plan (3 tiers) | ✓ §9 |

**What is NOT yet settled (the D1 placeholders to fill at design review):**

| Open detail | Placeholder location |
|---|---|
| Exact resolver query shape for the linked-record pre-fetch | §2.1 implementation note |
| Exact grammar production for the dotted-identifier rule | §2.1 parser-enforced restriction |
| Exact super_admin scope predicate name in `meta.py` | §2.3 implementation note |
| Existing GXL test list that must pass byte-for-byte unchanged | §7 enforcement |
| Whether the new drift rule(s) for GXL-F1–GXL-F5 are HARD or RATCHET | §5 |

## Q1.2 Implementation options (considered)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Widen GXL to allow single-hop ref dereference (chosen)** | Engine stays the engine; guards stay in config; database stays normalized; killer test KT-GXL-1 proves it; rollback via feature flag in tier 2 of §9 | New parser code, new resolver path, new query in transition hot path | ✅ Recommended — DRAFT already settles the surface |
| B. Multi-hop refs (e.g., `customer.account.balance_due`) | More expressive | Quadratic resolver complexity; unbounded query fanout; no concrete tenant need | ❌ Forbidden by GXL-I1 in the DRAFT |
| C. Aggregates over collections (`count(services) > 5`) | Powerful business rules | Unbounded scan in latency-critical path; non-deterministic mid-transaction; difficult to explain to tenant admins | ❌ Forbidden by GXL-F1; addressed via denormalized fields when needed |
| D. Move the guard out of the engine into `app/services/...` | No language change | Violates I1 (engine stays small) and I5 (guards in config, not code) | ❌ Off the table |
| E. Denormalize cross-record state onto the record itself | No language change | Fanout-update problem (every payment touches every service); violates DB normalization invariants | ❌ Off the table for write-heavy cases; OK as a fallback for read-mostly aggregates |

## Q1.3 Recommendation

**Lock Option A by sealing the DRAFT addendum.** Specifically:

1. **Schedule Phase 1.5 Track A design review** — one focused meeting (engineer + Gev + one `code-reviewer`-role reviewer).
2. **Fill the 5 TBD placeholders** in §2.1, §2.3, §7, §5 of the addendum with concrete decisions reached in the meeting:
   - Resolver query shape (recommend: `SELECT * FROM <ref_target_table> WHERE id = $1 AND tenant_id = current_setting('gaahex.tenant_id')::uuid`, executed via the existing `s` session so RLS engages naturally).
   - Parser grammar production (recommend: extend the existing identifier rule to allow exactly one trailing `.<name>`; reject `.<name>.<name>` at the parser level with a precise error).
   - Super_admin scope predicate (recommend: reuse the existing `super_admin` capability check in `app/access.py` — no new permission key needed; I6 preserved).
   - Existing GXL test list for byte-for-byte compatibility (audit `backend/tests/test_gxl*.py` + any router test that exercises `WorkflowDef.config.transitions[].guard`).
   - HARD vs RATCHET drift rules for GXL-F1–GXL-F5 (recommend: **HARD** — these are parser-rejection rules, not migration-tail patterns; the parser itself enforces them at runtime, drift rules are belt-and-braces for source-tree regressions).
3. **Implement KT-GXL-1** (`backend/tests/test_workflow_engine.py::test_gxl_cross_record_guard_evaluation`) — exact spec in addendum §6, including the timing assertion (at most one extra query per evaluation).
4. **Implement the parser + resolver** (the only real code work — addendum estimates ~2 weeks for the full Phase 1.5).
5. **Run the compatibility corpus** (existing GXL tests pass unchanged + the new `test_gxl_compatibility_corpus.py` parser sweep + `test_gxl_compatibility_evaluation.py` byte-for-byte evaluation against a representative subset).
6. **Flip addendum status from DRAFT SHELL → SEALED** when D1–D7 all check (acceptance criteria §10).
7. **Predecessor `Successor baselines` footer** in `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` already lists the addendum as DRAFT SHELL; only the status word changes when sealed (per I10, the predecessor adds a single line and is not edited beyond that line).

**Why this is the right lock:** the surface is already minimally widened (one hop, single record, super_admin authorship, byte-for-byte compatibility). Sealing the addendum + implementing per §10 fulfills Q1 without expanding scope.

## Q1.4 Architectural impact

| Invariant | Affected? | How preserved |
|---|---|---|
| I1 — five kernel engines stay fixed | No | GXL is the *language* the WorkItem-movement engine consumes; the engine count stays 5, its vocabulary widens within itself. |
| I2 — audit append-only | No | Every guarded transition still emits exactly one Event; guard failures emit `TRANSITION_REJECTED` (existing pattern). |
| I3 — tenant isolation | No | The pre-fetch query runs under the same `gaahex.tenant_id` GUC; RLS fires. A guard CANNOT reach across tenants. |
| I4 — M0 killer test green | No | M0 killer uses a guard-free workflow (PLANNED → DONE); KT-GXL-1 rides alongside it. |
| I5 — config-only entities use generic API | No | Cross-record guards are GXL strings in `WorkflowDef.config.transitions[].guard` — pure config. |
| I6 — permission keys immutable | No | No new permission keys; reuse `super_admin` scope check. |
| I7 — enum values UPPER_SNAKE_CASE | No | Guards compare against enum values; format unchanged. |
| I8 — deploy contract gates production boot | No | No new deploy contract clause for GXL; optional tier-2 rollback flag is `FEATURE_GXL_CROSS_RECORD_ENABLED` defaulting `True` (additive only). |
| I9 — 70 LOCKED standards | No | None of the 70 standards changed. |
| I10 — append-only signoff trail for sealed baselines | **Yes — used** | This addendum IS I10 in action: predecessor links forward, addendum links back, neither edited in place. |

**New invariants added by this lock** (GXL-I1 through GXL-I4 — addendum §4):
- GXL-I1: single-hop only at parse time
- GXL-I2: at most one extra query per evaluation
- GXL-I3: super_admin-only authorship for cross-record guards
- GXL-I4: KT-GXL-1 stays green forever (never skip/flaky/xfail)

## Q1.5 Required documentation changes

| Doc | Change |
|---|---|
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` | Fill 5 TBD placeholders (§2.1, §2.3, §7, §5); flip status header DRAFT SHELL → SEALED with date; check D1–D7 boxes in §10. |
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` | Update the existing `Successor baselines` footer entry from "*DRAFT SHELL — pending Phase 1.5 design review*" → "**SEALED <date>** — GXL extension". One-line edit per I10. |
| `docs/standards/01-strategic-product-direction.md` | (Optional) cross-reference GXL extension addendum in the §"Locked extension points" list. |
| `docs/standards/00-standards-index.md` | (Optional) add the addendum to the standards-doc index. |
| `tools/check_drift.py` | Add the 5 new HARD/RATCHET rules from GXL-F1–GXL-F5 (per the design-review decision). |
| `tools/check_drift_baseline.json` | Update with the new rules' baseline values (likely 0 since the parser rejects them entirely; rules act as belt-and-braces). |
| `docs/runbooks/M1-PHASE-1.5-IMPLEMENTATION.md` | Promote Track A from "planned" to "actively implementing" once KT-GXL-1 lands. |

---

# Q5 — Per-tenant feature flags  ✅ LOCKED 2026-06-05

**Status:** IMPLEMENTED + LOCKED via commit `9662ea5`, verified green in CI run [`27036230536`](https://github.com/ohanyan88-cmd/GAAhex/actions/runs/27036230536).

**Locked policy:** [`docs/standards/FEATURE_GATING_POLICY.md`](../standards/FEATURE_GATING_POLICY.md) — the two-system rule that defines this Q's correct shape.

**Implementation surface:**
- `backend/app/services/tenant_flag.py` — server-side reader `is_flag_enabled_for_tenant(s, tenant_id, key, *, default=False)`.
- `backend/app/seed.py::seed_business_flags_if_empty()` — idempotent per-tenant default-OFF seed, wired into `apply_test_seeds()`.
- `backend/app/scheduler.py::_TENANT_FLAG_GATED_JOBS` map + `_resolve_tenant_gates()` — per-tenant flag check inside the tenant loop (policy §5.4). `billing.run_dunning` skips for tenants whose flag is OFF.
- `backend/app/services/feature_gate.py` — docstring updated with the two-system distinction; signature unchanged per policy §5.6.

**Killer test:** `backend/tests/test_feature_flags.py::test_m1_per_tenant_feature_flag_isolation` (KT-M1-5) + 3 helper unit tests.

**Net change:** +465 LOC across 5 files. Full backend smoke: 1,772 passed (was 1,768 pre-Q5; +4 new tests = exact match).

**Important:** the original "extend `is_enabled()` to accept `tenant_id`" sketch in §Q5.3 below was **superseded** by the locked Feature Gating Policy. The as-built implementation uses a separate `tenant_flag.py` helper; `feature_gate.is_enabled()` signature is unchanged. Future readers should treat §Q5.3 as historical decision-trail context, not the as-built shape.

The rest of this Q5 section is preserved as the decision trail.

---

## Q5.1 Current state

**Locked decision:** *"Per-tenant feature flags already in M1"* (Gev, 2026-06-05) — implementation in Phase 1.5 Track B per M1 plan §7.

**Important finding — partial code already exists:**

- ✅ `backend/app/models/feature_flag.py` — `FeatureFlag` model **already tenant-scoped** (UniqueConstraint on `(tenant_id, key)`, RLS-ready columns).
- ✅ `backend/app/routers/feature_flags.py` — CRUD endpoints (179 LOC) already exist, gated by `config.manage`, audit-logged via `workflow.emit`.
- ❌ `backend/app/services/feature_gate.py:is_enabled(feature)` — **still platform-wide** (only consults env-var settings: `feature_radius_required`, `feature_olt_provisioning_required`, `feature_import_engine_enabled`, `feature_warehouse_enabled`). Does not yet read the `feature_flag` table.

**So the gap to close is narrow:** the DB schema, RLS, and CRUD surface are landed. What's missing is the runtime lookup path — `is_enabled()` needs to grow a `tenant_id` parameter, and when provided, consult `feature_flag` first, then fall back to env-var default.

**Existing four flags are *platform-wide deploy-shape*, not tenant preferences:**

| Flag | Why it stays env-var-only |
|---|---|
| `feature_radius_required` | Determines whether the deploy boots without a real RADIUS backend — operational, not tenant choice |
| `feature_olt_provisioning_required` | Same — driver shape concern |
| `feature_import_engine_enabled` | Engine not shipped; flag exists to fail-closed |
| `feature_warehouse_enabled` | Same |

These are deploy contract gates; they must stay platform-wide for I8 to hold (deploy contract gates production boot).

## Q5.2 Implementation options (considered)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Hybrid lookup (chosen)** — `is_enabled(feature, tenant_id=None)`: when `tenant_id` given, check DB row first; fall back to env-var default. Existing 4 deploy-shape flags stay env-var-only. | Backward compatible; per-tenant only for new M1 features; existing call sites unchanged | New code path, new call-site discipline | ✅ Recommended — matches M1 plan §7 Track B sketch |
| B. All-DB — store every flag in `feature_flag`, drop env-var defaults | Single source of truth | Boot-time gates would need DB queries (chicken/egg with the deploy contract); breaks I8 | ❌ Off the table |
| C. All-env-var — keep platform-wide, don't add per-tenant | No new code | Tenant A wanting `dunning_automation` ON while tenant B wanting it OFF is the M1 use case Gev locked | ❌ Off the table |
| D. Tenant-context-implicit lookup — read `tenant_id` from a contextvar so call sites don't pass it explicitly | Minimal call-site churn | The risk in R13 of M1 plan (call site forgets `tenant_id`) becomes silent rather than caught by a lint rule | ⚠️ Considered; rejected because explicit `tenant_id` kwarg lets a ratchet drift rule catch missing isolation |

## Q5.3 Recommendation

**Lock Option A.** Specifically:

1. **Confirm the existing `FeatureFlag` model is the surface** — it already has `tenant_id`, `key`, `enabled`, `label`, `role_scope`, `created_at`, `updated_at`. No schema change needed; no new migration needed. (Q5 in M1 plan said *"A new `tenant_feature_flag` table"* — the existing `feature_flag` table is functionally that; rename in the spec, not in the schema.)
2. **Verify the RLS policy on `feature_flag`** — confirm migration history contains `CREATE POLICY tenant_isolation ON feature_flag ...`. (If missing, add it in a follow-up migration; the model declares `tenant_id` so the policy template applies cleanly.)
3. **Extend `feature_gate.is_enabled()`** to accept `tenant_id: uuid.UUID | None = None`:
   - When `tenant_id is None`: behave identically to today (env-var lookup only). Existing call sites unchanged.
   - When `tenant_id` is provided: SELECT from `feature_flag` WHERE `(tenant_id, key) = (?, ?)`; if row exists and enabled is set, return it; else fall back to env-var default. Single query, indexed by the existing unique constraint.
4. **Add a ratchet drift rule** in `tools/check_drift.py` per M1 plan §10 R13: a call to `is_enabled(<feature>)` from inside a request handler (function whose parameter list includes `user` or `request`) MUST pass `tenant_id` explicitly. Catches "call site forgets `tenant_id`" silently.
5. **Implement KT-M1-5** (`backend/tests/test_feature_flags.py::test_m1_per_tenant_feature_flag_isolation`):
   - Tenant A enables `dunning_automation` via `PATCH /api/feature-flags/...` as A's super_admin
   - Tenant B leaves `dunning_automation` at the env-var default (off)
   - A platform-wide automation pass exercises both tenants
   - Assert: A's overdue invoices receive automation, B's do not
   - Assert: cross-tenant flag lookup returns the env-var default (no leak)
6. **The four existing platform-wide flags stay env-var-only.** Document this explicitly in the `feature_gate.is_enabled()` docstring + addendum to the deploy contract: tenant overrides cannot affect deploy-shape gates.
7. **Add new M1 feature keys to the existing `feature_flag` seed list** (`dunning_automation`, `self_serve_signup`, etc.) — `app/seed.py` already supports inserting feature_flag rows; tenants opt in by flipping `enabled` via the existing CRUD router.

**Why this is the right lock:** the model + CRUD already exist. The remaining work is narrow (one function signature change + one drift rule + one killer test). The decision package's job is to confirm this shape and lock it before broader implementation.

## Q5.4 Architectural impact

| Invariant | Affected? | How preserved |
|---|---|---|
| I1 — five kernel engines stay fixed | No | `feature_gate` lives in `app/services/`, alongside the security engine; the engine count stays 5. |
| I3 — tenant isolation engages | **Yes — extended** | The `feature_flag` table is tenant-scoped + RLS-policied. The new per-tenant lookup path consults a tenant-scoped row; RLS catches cross-tenant leak. Killer test KT-M1-5 proves it. |
| I6 — permission keys immutable | No | CRUD gating uses the existing `config.manage` / `tenant.settings.manage` keys — no new keys. |
| I8 — deploy contract gates production boot | No | The 4 deploy-shape flags stay env-var-only; the deploy contract continues to validate them at boot. Per-tenant override CANNOT affect them. |
| I10 — append-only signoff trail | No | This is a pure E6 + E9 extension; no successor sealed baseline needed per M1 plan §12 Q5. |

**No new invariants needed** — the existing tenant-isolation invariant (I3) covers the new path. The killer test KT-M1-5 joins the inventory.

**Drift-rule expansion:** one new RATCHET rule in `tools/check_drift.py` per R13 (`is_enabled(...)` inside request handlers without `tenant_id`).

## Q5.5 Required documentation changes

| Doc | Change |
|---|---|
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` | (No edit) — Q5 is resolved-in-plan and does not require a successor baseline. The §"Resolved technical debt" section may gain an entry if Q5 is closed out via this package. |
| `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` | Phase 1.5 Track B P1.5B.1 says *"Migration adds `tenant_feature_flag` table"* — update to: *"Verify (and add if missing) the `tenant_isolation` RLS policy on the existing `feature_flag` table; no new table."* |
| `backend/app/services/feature_gate.py` docstring | After the signature change, document: per-tenant lookup priority, env-var fallback, the four deploy-shape flags stay platform-wide. |
| `tools/check_drift.py` | Add R13 ratchet rule. |
| `tools/check_drift_baseline.json` | Audit current `is_enabled` call sites; record the existing count as baseline. |
| `docs/standards/06-event-automation-integration-standards.md` | (Optional) cross-reference the per-tenant feature-flag surface as an E6/E9 extension example. |
| `backend/tests/test_feature_flags.py` (or new file) | Add KT-M1-5 per §Q5.3 step 5. |

---

# Q8 — RLS exemption policy ("Fix Forward" default)

## Q8.1 Current state

**Locked decision:** *"Fix Forward default policy. Exemption only in exceptional cases."* (Gev, 2026-06-05).

**Existing artifacts:**

- `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` §12 Q8 — the policy lives there as a multi-paragraph block (the fix path, the exemption channel, the default expectation).

**What is *not* yet locked:**

- The policy is **buried** inside the M1 plan. It's a project-execution detail there, not a discoverable standard.
- There's **no single doc** a future engineer can read titled "What do I do when CI's RLS check fails?". They have to know to look in §12 Q8 of the M1 plan.
- There's **no enumerated exemption registry** — the policy says "each exemption is its own line in the successor baseline; no batch exemptions" but no exemption registry file exists.

The decision content is correct and complete; the gap is *discoverability + policy-shape locking*.

## Q8.2 Implementation options (considered)

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Standalone policy doc (chosen)** — extract Q8's content into `docs/standards/RLS_EXEMPTION_POLICY.md` as a LOCKED standard; add an empty `RLS_EXEMPTION_REGISTRY.md` for future exemptions | Discoverable; canonical; ratchet-able; matches the 70-standards convention | One more standards doc to maintain | ✅ Recommended |
| B. Inline in M1 plan only | No new file | Future engineers will miss it; not a sealed contract | ❌ Off the table — the decision deserves standards-doc status |
| C. Section in `02-..-standards.md` | Reuses existing file | Mixes a runtime/operational policy with field-naming standards; harder to find | ❌ Off the table |
| D. Successor sealed baseline | Maximum weight | Overkill — Q8 doesn't relax an invariant, it formalizes an existing one (I3) | ❌ Off the table — successor baselines are for invariant change, not policy publication |

## Q8.3 Recommendation

**Lock Option A.** Specifically:

1. **Create `docs/standards/RLS_EXEMPTION_POLICY.md`** — content lifted from M1 plan §12 Q8, restructured as a standards doc:
   - **Default:** Fix Forward.
   - **Triggers:** what events surface an RLS gap (the `backend-rls` CI job, a runtime audit warning, a production incident).
   - **Fix path** (3 steps from M1 plan §12 Q8): pre-auth/no-tenant path audit · explicit `tenant_id` filter · rewrite raw SQL via SQLAlchemy.
   - **Exemption channel** (last resort): the exact criteria (provably correct under owner role + no tenant-scoped equivalent + system-wide health check style); the exact deliverables (sealed baseline line entry + regression test).
   - **Default expectation:** 0–2 real gaps in Phase 1; > 2 exemptions signals an RLS-posture rethink.
   - **Anti-patterns:** what NOT to do (don't add `continue-on-error: true`, don't bulk-exempt, don't soft-fail by skipping the test).
2. **Create `docs/standards/RLS_EXEMPTION_REGISTRY.md`** — empty registry file with a header explaining: each row is a line-item exemption; format is `(query, justification, regression-test pointer, sealed-baseline-line-link)`; the file is append-only; no removal without a sealed baseline.
3. **Cross-reference from**:
   - The sealed baseline §I3 — add a footer pointer to the policy doc.
   - The M1 plan §12 Q8 — replace the inline policy block with `See docs/standards/RLS_EXEMPTION_POLICY.md`.
   - The standards index `docs/standards/00-standards-index.md` — add the new policy doc as a LOCKED entry.
4. **Add a drift rule guard** in `tools/check_drift.py`: if any new `continue-on-error: true` appears in `.github/workflows/*.yml` for a job whose name contains "RLS" (case-insensitive), HARD-fail. (TD13's existing `continue-on-error` is grandfathered in the baseline; the rule guards against the **pattern** spreading.)

**Why this is the right lock:** the decision was made and documented in M1 plan §12. What's missing is *standards-grade discoverability*. A policy doc + a registry file + a drift rule make it findable, enforceable, and append-only.

## Q8.4 Architectural impact

| Invariant | Affected? | How preserved |
|---|---|---|
| I3 — tenant isolation engages | **Yes — formalized** | The policy doc IS the formal statement of how I3 is preserved when CI surfaces a gap. The invariant itself doesn't change; its operational guard does. |
| I9 — 70 LOCKED standards | **Yes — extended** | The 70-standards body gains the new policy doc as LOCKED standard #71 (the index will be updated; the count phrasing in CLAUDE.md / sealed baseline references "70 LOCKED" stays accurate because the new doc lives in `docs/standards/` alongside the originals — the body grows, the index reflects it). |
| I10 — append-only signoff trail | No | This isn't a sealed baseline change; it's a standards extension. |

**No new invariants needed.** The policy clarifies how I3 + TD13 are handled when CI catches a gap.

**The grandfathering of TD13's existing `continue-on-error: true`** stays — it's documented as the in-flight resolution path, scoped for M1 per the sealed baseline. The drift rule guards against *new* `continue-on-error` instances on RLS jobs.

## Q8.5 Required documentation changes

| Doc | Change |
|---|---|
| `docs/standards/RLS_EXEMPTION_POLICY.md` | **NEW** — lift content from M1 plan §12 Q8, restructure as a standards doc per §Q8.3 step 1. |
| `docs/standards/RLS_EXEMPTION_REGISTRY.md` | **NEW** — empty registry file with explanatory header; append-only. |
| `docs/standards/00-standards-index.md` | Add `RLS_EXEMPTION_POLICY.md` as a LOCKED entry. |
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` | §I3 footer pointer to the policy doc; §"Resolved technical debt" gains an entry for Q8 once locked. |
| `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` §12 Q8 | Replace the inline policy block with a one-line pointer: *"See `docs/standards/RLS_EXEMPTION_POLICY.md` for the locked policy."* |
| `tools/check_drift.py` | Add a HARD drift rule guarding against new `continue-on-error: true` on RLS-named CI jobs. |

---

# Path to LOCKED — recommended sequence

Lock the three Q's in order:

1. **Q8 first** — pure documentation; zero code; smallest blast radius; produces a discoverable policy doc that the rest of M1 references.
2. **Q5 second** — model + CRUD already exist; one function signature change + one drift rule + one killer test. No new schema. Confirms the shape.
3. **Q1 last** — biggest implementation lift (parser + resolver + KT-GXL-1 + compatibility corpus). Sealing the addendum gates the actual code work in Phase 1.5.

Each lock is committable as its own PR with a single review. None depend on the others; the ordering reflects implementation cost, not architectural dependency.

---

# Out of scope (do not touch as part of this package)

- ❌ Pilot ISP onboarding work
- ❌ Production cutover
- ❌ Re-opening stabilization (D19, TD11, tenant-filter remediation, T-P3-9, T-P2-4)
- ❌ TD13 resolution (M1 scope; this package's Q8 lock formalizes the policy, but does not implement TD13 itself)
- ❌ Manual staging walkthrough (intentionally deferred)
- ❌ Any code changes — this package is decision-shape only; implementation PRs follow each lock

---

— Ընգեր, 2026-06-05
