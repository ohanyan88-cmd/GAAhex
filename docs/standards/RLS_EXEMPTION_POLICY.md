# RLS Exemption Policy

**Standard status:** **LOCKED** · operational standard (named, alongside the numbered 1–70)
**Date sealed:** 2026-06-05
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` § I3 (tenant isolation engages)
**Supersedes:** the inline policy block in `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` § 12 Q8 (left as origin record + pointer)
**Companion registry:** [`RLS_EXEMPTION_REGISTRY.md`](./RLS_EXEMPTION_REGISTRY.md)

> **What this standard is.** A canonical, discoverable, append-only policy for what an engineer does when an RLS gap is surfaced — on CI, at runtime, or in production. The default is *Fix Forward*. Exemption is rare, gated by sealed-baseline-level signoff, and always carries a remediation path back to RLS-clean.

---

## 1. Policy

**Default: Fix Forward.**

Every RLS gap surfaced by the platform's tenant-isolation guards is closed *in the same PR that surfaces it*, before the gate that surfaced it goes back to green. The platform's I3 invariant (tenant isolation engages) is preserved by closing the gap at the source — not by relaxing the gate that detected it.

Exemption is the **last resort**. It exists only for queries that are *provably correct under the owner role and have no tenant-scoped equivalent*. An exemption is not a way to ship faster; it is a way to record that a specific query, of necessity, lives outside RLS, with the full trail required to prove that necessity.

---

## 2. When this policy fires (triggers)

This policy applies whenever any of the following surfaces a gap:

| Trigger | Description |
|---|---|
| `backend-rls` CI job | The dual-role enforcement gate (`ci.yml` `backend-rls` job) surfaces a test failure under the `gaahex_app` NOSUPERUSER role |
| Runtime audit listener | `backend/app/tenant_query_audit.py` emits a runtime warning on a SQLAlchemy query that lacks an explicit `tenant_id` filter on a guarded model |
| Tenant-filter static analyzer | `backend/scripts/check_tenant_filter.py` flags a new violation not in `.tenant_filter_baseline` |
| Production incident | A cross-tenant data exposure is identified in prod logs, alerting, or customer report |
| Pre-merge review | A reviewer identifies a query that would pass CI today but breaks isolation in a known-future scenario (e.g. a new entity that becomes tenant-scoped after a migration) |

The policy applies identically across all triggers — the source of detection does not change the response.

---

## 3. Fix Forward path (default)

For every gap surfaced, the engineer walks this path in order. Step **n+1** is attempted only if step **n** is provably not the right shape.

### Step 1 — Audit the call site

Is this query on a **pre-auth or no-tenant code path** that legitimately runs under the owner role?
- Login email-lookup (no tenant context yet)
- `/org-tree` boot-time read (no actor)
- Seed/migration code (idempotent setup; `seed_*` / `migrate_*` functions are already bypassed by the static analyzer)

**If yes:** the query is already a documented exception in [sealed baseline § I3](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i3-tenant-isolation-engages). No new exemption is needed. Confirm the function name follows the documented bypass pattern (`seed_*`, `migrate_*`, or carries an `owner_session` / `_owner` parameter) and is annotated `# noqa: tenant-filter` with a rationale if it touches a guarded model. Close the gap by aligning the annotation with the analyzer's expectations.

**If no:** it is a bug. Proceed to step 2.

### Step 2 — Refactor the query to bind `tenant_id` correctly

The query should:
- Run on a session bound to `gaahex.tenant_id` GUC (RLS engages)
- Carry an explicit `WHERE tenant_id = ...` clause as defense-layer-2 (the static analyzer reads this)
- Reach guarded models only via tenant-internal IDs whose provenance is itself tenant-scoped (chain of trust)

If the call site genuinely lacks tenant context (e.g. a service called from both auth'd and pre-auth paths), split the function into two — one tenant-scoped, one owner-bypass — rather than blurring the boundary with optional kwargs.

Update `backend/scripts/check_tenant_filter.py` if a *new safe pattern* is needed in the static analyzer's catch list. Promote the missing pattern to the catch logic; do not add the call site to `.tenant_filter_baseline` unless step 1 already applied.

### Step 3 — Replace raw SQL with SQLAlchemy

If the query uses raw SQL (`text("SELECT ...")` or `s.connection().execute("...")`), it almost certainly bypasses the audit listener. Rewrite via SQLAlchemy ORM/Core; if a domain-specific query helper is needed, add it to `app/services/` with explicit `tenant_id` binding and tests.

---

## 4. Exemption requirements (criteria)

An exemption is granted **only** if **all** of the following are true:

1. **Owner-role correctness is provable.** The query produces the same correct result under the owner role as it would under the app role *plus the tenant_id filter*, and there is no equivalent app-role formulation that returns the same rows.
2. **Cross-tenant reach is intentional.** The query *legitimately* needs to read or write across tenants — typically a system-wide health check, a platform-level metrics rollup, or a seed/migration that pre-dates any tenant.
3. **No tenant-scoped alternative exists.** A tenant-scoped equivalent would either fail to express the question (e.g. "platform-wide active-session count") or would require fan-out across all tenants in a way that is provably worse than the owner-role read.
4. **The query is read-mostly OR a controlled write.** Cross-tenant writes are forbidden except in seed/migration code. A cross-tenant DELETE or UPDATE outside a `seed_*` / `migrate_*` function is **never** exempt — it must be refactored to per-tenant.
5. **The query is reachable only via a permission-gated surface.** A cross-tenant read endpoint must be gated by a `platform.*` permission (e.g. `platform.metrics.read`) granted only to platform-operator principals, not to any tenant's super_admin.

If any of these is false, the query is not an exemption candidate — it is a bug to fix forward.

---

## 5. Approval requirements

Granting an exemption requires a **sealed-baseline-level signoff** (mirroring I10's append-only signoff trail). The three required sign-offs:

| Signoff | Who | What they confirm |
|---|---|---|
| **Technical correctness** | An independent `code-reviewer`-role reviewer | The query satisfies all five criteria in § 4 (criterion-by-criterion in the PR description). The regression test (see § 7) genuinely proves the owner-role necessity. |
| **Policy compliance** | The author + reviewer jointly | The PR ships all four deliverables in § 7. The registry entry, the regression test, the migration path, and the successor-baseline line are all present and cross-link correctly. |
| **Platform-owner signoff** | Gev | Product-shape signoff — this exemption does not undermine the platform thesis. Acknowledged in the PR description (Gev's comment or merge action). |

The exemption is **not granted until all three signoffs are recorded** in the PR. Merging the PR without all three is a process violation.

**The PR landing the exemption MUST update all of:**
1. [`RLS_EXEMPTION_REGISTRY.md`](./RLS_EXEMPTION_REGISTRY.md) — append the new entry (never edit prior entries)
2. A successor sealed baseline file (`docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>-RLS-EXEMPTIONS.md`, OR an existing successor baseline if one is already open for the cycle) — add the exemption as an enumerated line item
3. The 2026-06-05 baseline's `Successor baselines` footer — add the successor baseline link (one-line edit per I10)
4. A new regression test under `backend/tests/test_rls_exemptions.py` that proves the exemption is still required (see § 7)

No PR may bundle multiple exemptions. **Each exemption is its own PR, its own registry line, and its own sealed-baseline line.** Batch exemptions are forbidden by construction — they are the failure mode this policy exists to prevent.

---

## 6. Expiration requirements

Every exemption declares its expiration shape at the time it is granted:

| Shape | Definition | Review cadence |
|---|---|---|
| **Structural** | The justification is permanent (e.g. pre-auth login lookup; no tenant context exists by definition). No expiration date. | Reviewed at each successor sealed baseline as part of the I10 trail. Surviving without challenge counts as renewal. |
| **Temporary — date-bound** | The exemption is intended to be removed by a specific date (typically because a refactor is planned). Carries an absolute date. | Status auto-flips to `EXPIRED-AWAITING-REMEDIATION` on the date. Cannot be silently extended. |
| **Temporary — trigger-bound** | The exemption is intended to be removed when a specific platform feature lands (e.g. "removed when the platform-metrics service ships"). Carries a documented trigger condition. | Reviewed at each successor sealed baseline; if the trigger has fired, the exemption must be retired or its status flipped to `EXPIRED-AWAITING-REMEDIATION` with a remediation deadline. |

**An exemption that has expired or been triggered without remediation is a high-priority bug.** The platform owner (Gev) is notified; the exemption's owner has 5 working days to either retire the exemption or write the remediation PR. Beyond that window, the exemption is escalated to a release-blocking issue.

**No exemption renews silently.** Renewal is an active decision in a successor sealed baseline; absence of a removal decision is *not* renewal.

---

## 7. Remediation requirements

Every exemption ships with all four artifacts at grant time:

| Artifact | Description |
|---|---|
| **Migration path** | A concrete, written-down sequence of steps that would remove the exemption (e.g. "build a per-tenant metrics materialized view, switch the read to it, retire this exemption"). The migration path is part of the registry entry — exempts with no documented migration path are **not eligible** for grant. |
| **Owner** | A named engineer (today: Ընգեր) responsible for executing the migration path when the expiration condition fires. The owner is recorded in the registry entry. |
| **Regression test** | A pytest under `backend/tests/test_rls_exemptions.py` that proves the exemption is still required: the test runs the query under the app role + tenant filter and asserts the result is *demonstrably different* from the owner-role result (e.g. zero rows vs the correct set). If a future refactor makes the test no longer demonstrate necessity, the exemption is auto-retire-eligible. |
| **Leak-vector check** | A second pytest, or an extension of the first, that confirms the exemption is *not* a cross-tenant leak vector — i.e. an unauthorized actor cannot reach the exempted code path. Typically a 403/permission test on the gated endpoint from § 4 criterion 5. |

The PR is rejected if any of the four artifacts is missing. A reviewer who detects a missing artifact during signoff must request changes; merging without all four is a process violation (see § 5).

---

## 8. Default expectation

The platform's RLS posture is **tight by design**. The expected exemption count:

- **0–2** exemptions during the M1 lifecycle (Phase 1 RLS hardening surface)
- **0–1** per platform-year thereafter

If the active registry grows past **3** entries simultaneously, this is a **signal that the RLS posture itself needs a rethink** — not a signal that more exemptions are warranted. The platform owner is notified at the third active exemption; the next sealed baseline must contain a posture review.

The exemption channel is build-paranoid scaffolding. **It should rarely be used.** The right default response to a CI red is to fix the underlying bug, not to widen the policy.

---

## 9. Anti-patterns (forbidden)

The following are **explicitly forbidden** by this policy:

| Anti-pattern | Why forbidden |
|---|---|
| **Adding new `continue-on-error: true` on an RLS-named CI job** | Soft-fail is policy-circumvention. The existing TD13 instance on the `backend-rls` job is *grandfathered* (it pre-dates this policy and is M1-resolution-scoped); new instances are forbidden. |
| **Removing the existing `backend-rls` job or its `gaahex_app` enforcement** | The dual-role gate is the detection mechanism this policy exists around. Removing it is a thesis-level change requiring a successor sealed baseline. |
| **Skipping or `xfail`-ing an RLS test to land a PR** | Same as soft-fail: the test exists to detect; skipping is hiding. The right move is to fix the gap or grant an exemption with all four artifacts. |
| **Batch exemptions** | "Several queries need exemption" is a posture problem, not an exemption problem. Each query gets its own PR, line, test, owner, and migration path. |
| **Exemption-then-fix later** | An exemption without a complete remediation package (§ 7) is denied. "We'll add the test later" is rejected at signoff. |
| **Editing or removing a prior registry entry** | The registry is append-only. Entries are *flipped* from ACTIVE → RETIRED / EXPIRED-AWAITING-REMEDIATION via an append-only update note, never overwritten or deleted. |
| **Bulk-disabling RLS via a feature flag** | The deploy contract gates this — but for clarity: a flag that flips RLS off platform-wide is not an exemption mechanism. It is a thesis-level change requiring a successor sealed baseline. |

---

## 10. Cross-references

| Document | Relationship |
|---|---|
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` § I3 | The invariant this policy operationally preserves |
| `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` § 12 Q8 | Origin record of the Fix Forward decision (Gev, 2026-06-05) |
| `docs/audit/POST-D19-STABILIZATION-COMPLETE-2026-06-05.md` | Milestone that scoped Q8 lock-in as forward priority #3 |
| `docs/architecture/Q1-Q5-Q8-DECISION-PACKAGE-2026-06-05.md` § Q8 | Decision package that produced this standard |
| [`RLS_EXEMPTION_REGISTRY.md`](./RLS_EXEMPTION_REGISTRY.md) | Append-only registry — every exemption is a line here |
| `backend/scripts/check_tenant_filter.py` | Static analyzer that fires on missing tenant filters |
| `backend/app/tenant_query_audit.py` | Runtime audit listener |
| `.github/workflows/ci.yml` § `backend-rls` job | The dual-role enforcement gate (currently grandfathered for TD13) |

---

## 11. Status flips

This file is **LOCKED**. The standard's *content* can only be relaxed via a successor sealed baseline (per I10). Mechanical updates (cross-references, formatting) follow normal doc-change rules.

If a future change to the platform's RLS posture genuinely requires relaxing this policy, the path is:
1. Author `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>-RLS-POSTURE-V2.md` with the new posture
2. Update this file's header `Status` line to `SUPERSEDED by <date>-RLS-POSTURE-V2`
3. Cross-link from the new baseline back to this file

This file is never edited in place beyond cross-reference upkeep and the one-line `SUPERSEDED` flip.

— Ընգեր, 2026-06-05
