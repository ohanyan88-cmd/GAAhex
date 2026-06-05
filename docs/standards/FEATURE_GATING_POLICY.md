# Feature Gating Policy

**Standard status:** **LOCKED** · operational standard (named, alongside the numbered 1–70)
**Date sealed:** 2026-06-05
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` § I8 (deploy contract) + § I3 (tenant isolation)
**Product-owner clarification:** Gev, 2026-06-05 — *"For tenant business features, the tenant should be able to decide independently. The platform should not globally force all tenants ON or OFF for business preferences."*

> **What this standard is.** The canonical rule for choosing between the platform's two feature-gating systems. They are intentionally separate and must remain so. This standard exists to prevent future implementation work from collapsing them — which would either turn deploy contracts into per-tenant preferences (a fail-open risk) or turn tenant business preferences into platform-wide gates (a tenant-autonomy violation).

---

## 1. The rule

**Business-feature availability is tenant-controlled unless the underlying platform subsystem is technically unavailable.**

Two systems implement this rule:

| System | Purpose | Scope | Who decides |
|---|---|---|---|
| **Platform deploy-shape gates** | Technical / infrastructure availability | Platform-wide | The deploy contract (env vars + production guard) |
| **Tenant feature flags** | Business preferences | Per-tenant | The tenant's own super_admin |

A feature is gated by **exactly one** of these systems. Choosing the wrong one is a policy violation.

---

## 2. Platform deploy-shape gates (`app/services/feature_gate.py`)

### Purpose

Decide whether a platform subsystem is **technically available** in this deployment. The platform can block use of a subsystem **for all tenants** when its backend isn't wired (no real RADIUS server, no real OLT driver, no implemented import engine).

### Today's keys

| Key | Subsystem |
|---|---|
| `radius` | RADIUS authentication / accounting / disconnect |
| `olt_provisioning` | OLT ONU provisioning / VLAN / line-profile |
| `import_engine` | Bulk CSV/XLSX import pipeline |
| `warehouse` | Inventory / asset-location warehouse module |

These four are the **only** deploy-shape gates. New keys are added only when a new infrastructure subsystem ships and may legitimately be unwired in some deploys.

### How it works

- Source of truth: env-var settings in `Settings` (see `app/config.py`) — `feature_radius_required`, `feature_olt_provisioning_required`, `feature_import_engine_enabled`, `feature_warehouse_enabled`.
- Probe path: `feature_gate.is_enabled(key)` checks BOTH the env var AND whether the backend can construct (e.g., real RADIUS driver loads cleanly). Stub providers (`mock`, `stub`) read as disabled.
- Block path: `feature_gate.require(key)` raises `FeatureDisabledError` AND emits a `FEATURE_BLOCKED_USE` audit event when disabled.
- Production guard: `_assert_production_deploy_contract()` in `app/config.py` refuses to boot if a deploy-shape flag is ON in production without a real backend behind it.

### When to use it

Use a deploy-shape gate **when, and only when**, the answer to *"can the platform technically provide this?"* is potentially **no for the entire deployment**.

Concretely, deploy-shape gates exist because in some deploys:
- No RADIUS infrastructure exists at all (the operator runs without one)
- No OLT vendor driver is configured (FTTH not in scope)
- The import engine code hasn't shipped yet
- The warehouse module code hasn't shipped yet

In those deploys, the platform fail-closes for **all** tenants because no implementation exists. Tenant preference is irrelevant — the capability doesn't exist regardless.

---

## 3. Tenant feature flags (`FeatureFlag` table + the planned `app/services/tenant_flag.py`)

### Purpose

Let each tenant (= ISP company using GAAhex) **independently** decide whether to enable a business feature. Tenant A turns `dunning_automation` ON; Tenant B leaves it OFF. The platform respects each tenant's choice.

### Today's surface (already shipped)

- **Model:** `backend/app/models/feature_flag.py` — `FeatureFlag(id, tenant_id, key, label, enabled, role_scope, created_at, updated_at)` with `UniqueConstraint(tenant_id, key)`.
- **RLS:** Migration `e7f4a2b9c8d1` adds `ENABLE ROW LEVEL SECURITY` + `tenant_isolation` policy. Cross-tenant reads return zero rows.
- **CRUD router:** `backend/app/routers/feature_flags.py` — `/api/feature-flags` GET/POST/PATCH/DELETE. PATCH emits `FEATURE_FLAG.UPDATE` audit event via `workflow.emit`. POST/PATCH/DELETE require `config.manage`.
- **Frontend hook:** `frontend/src/lib/useFlag.ts` — `useFlag(key, token, userRole?)`. 5-minute module-level cache.
- **Studio UI:** `frontend/src/studio/FeatureFlagsPane.tsx`.

### The remaining gap (planned, not yet shipped)

- **Backend service helper** for server-side code that needs to read a tenant's flag (e.g., a cross-tenant background job that asks "is `dunning_automation` enabled for tenant X?"). Today the only way to read flags is via the HTTP endpoint — wrong for in-process service code. The helper lands as `backend/app/services/tenant_flag.py::is_flag_enabled_for_tenant(s, tenant_id, key, default=False)`.
- **Seed entries** for first M1 business features (`dunning_automation`, etc.) in `app/seed.py`, default `enabled=False`. Each tenant opts in by flipping via the CRUD router.
- **Killer test KT-M1-5** proving per-tenant isolation end-to-end.

### When to use it

Use a tenant feature flag **when, and only when**, the answer to *"should each tenant be free to decide this?"* is **yes**.

Concrete examples:
- `dunning_automation` — automated overdue-invoice escalation. Some tenants want it; some prefer manual control.
- `self_serve_signup` — a customer portal flow that lets new customers sign themselves up. Some tenants want it; others restrict signup to sales agents.
- Future ISP-optional workflows — anything where two reasonable tenants would make different choices.

---

## 4. Decision tree — which system to use

Walk top-to-bottom. The first match wins.

```
1. Is the question "can the platform technically provide this in this deploy?"
       ↓ yes              ↓ no
   deploy-shape gate     continue
   (feature_gate.py)

2. Is the feature implemented at all in the platform code?
       ↓ no              ↓ yes
   deploy-shape gate     continue
   (block fail-closed
    until code lands)

3. Should two reasonable tenants be free to make different choices?
       ↓ yes              ↓ no
   tenant flag          neither — this is not a feature flag,
   (FeatureFlag table)  it's a platform-wide policy. Encode it
                        as platform behavior, not a flag.
```

### Worked examples

| Feature | Decision | Why |
|---|---|---|
| `radius` | Deploy-shape | Some deploys have no RADIUS infrastructure. Tenant preference is irrelevant if the backend isn't wired. |
| `olt_provisioning` | Deploy-shape | Same — FTTH may not be in scope for a deploy. |
| `import_engine` | Deploy-shape | Engine code not shipped yet; fail-closed for all tenants until it lands. |
| `warehouse` | Deploy-shape | Same as `import_engine`. |
| `dunning_automation` | Tenant flag | Both backends exist; tenants make different business choices. |
| `self_serve_signup` | Tenant flag | Same logic — tenant business preference. |
| Audit logging | Neither — platform behavior | I2 (audit append-only) is a platform invariant; not optional. |
| RLS enforcement | Neither — platform behavior | I3 (tenant isolation) is a platform invariant; not optional. |
| A new ISP workflow that some tenants don't need | Tenant flag | If the code is implemented but optional per tenant, it's tenant-flag territory. |
| A new infrastructure backend (e.g., second OLT vendor) | Deploy-shape (if the vendor driver may be absent in some deploys) | If the deploy doesn't configure that vendor, fail-closed for all. |

---

## 5. Implementation rules (what must be preserved)

These are the binding rules every implementation PR must honor.

1. **`feature_gate.py` keys stay platform-wide.** New deploy-shape keys are added only when a new infrastructure subsystem ships. Adding a tenant business preference to `feature_gate.py` is forbidden.

2. **`FeatureFlag` table holds tenant business preferences.** New keys land via the CRUD endpoints or via idempotent seed inserts in `app/seed.py`. Adding a tenant flag for a *deploy-shape* concern (e.g., letting a tenant flip the RADIUS backend on) is forbidden.

3. **One feature, one system.** A feature gated by `feature_gate.is_enabled()` is *not* simultaneously gated by `tenant_flag` (and vice versa). If a feature truly needs both — *"deploy must wire it AND the tenant must opt in"* — the order is: `feature_gate.require()` first (technical availability), THEN `tenant_flag.is_flag_enabled_for_tenant()` second (tenant choice). Never the reverse, never collapsed into one call.

4. **Background jobs that span tenants check tenant flags per-tenant.** A cross-tenant automation pass that processes one tenant at a time must call `is_flag_enabled_for_tenant(s, tenant_id, key)` for each tenant; it must not short-circuit on a platform-wide check.

5. **Production deploy contract gates deploy-shape only.** `_assert_production_deploy_contract()` validates env-var deploy-shape gates. It does NOT read the `feature_flag` table — tenant choices are not deploy-time concerns.

6. **`feature_gate.is_enabled()` signature stays platform-wide.** It does not accept a `tenant_id` parameter. Mixing tenant scope into the deploy-shape gate would collapse the two systems and violate the rule in § 1.

7. **Tenant flag mutations emit audit events.** Every PATCH on `/api/feature-flags/<id>` emits `FEATURE_FLAG.UPDATE` via `workflow.emit` (already implemented). Audit append-only (I2) applies.

8. **Frontend `useFlag()` consults the DB-backed system only.** It must not be wired to read deploy-shape env vars. Deploy-shape decisions are server-side; the frontend simply renders what the backend permits.

---

## 6. Anti-patterns (forbidden)

| Anti-pattern | Why forbidden |
|---|---|
| **Adding `tenant_id` parameter to `feature_gate.is_enabled()`** | Collapses the two systems. Deploy-shape gates are platform-wide by design (I8); making them tenant-aware would make the deploy contract a per-tenant concern. |
| **Adding a tenant business preference (e.g., `dunning_automation`) to `feature_gate.py`'s recognised key list** | Inverts tenant autonomy — the platform would force the same choice on all tenants when each tenant should decide. Direct violation of § 1. |
| **Adding a deploy-shape gate (e.g., `radius`) to the `feature_flag` table as a row** | Inverts deploy contract — a tenant could flip "RADIUS available" on without the backend being wired, leading to runtime failures or silent stub passes. Direct violation of I8. |
| **Gating a single feature by both systems collapsed into one call** | Order matters: deploy-shape first, tenant choice second. Collapsing them hides the distinction and creates ambiguous failure modes. |
| **A background job that processes tenants but checks a single platform-wide flag at the top, then iterates** | If `dunning_automation` is on for tenant A but off for tenant B, a platform-wide check forces them to share the answer. Use per-tenant `is_flag_enabled_for_tenant()` inside the loop. |
| **Frontend reading deploy-shape env vars to render UI** | Deploy-shape gating is a server-side guard. The frontend must rely on backend responses (404, 403, `FeatureDisabledError`), not on environment knowledge. |
| **Emitting `FEATURE_BLOCKED_USE` for a tenant-flag rejection** | `FEATURE_BLOCKED_USE` is the deploy-shape audit event. Tenant-flag mutations use `FEATURE_FLAG.UPDATE`. Tenant-flag *read-and-skip* (the flag is off, so a job skips that tenant) does not emit any audit event — the read is not an attempted action. |

---

## 7. Cross-references

| Document | Relationship |
|---|---|
| `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` § I3, § I8 | The two invariants this policy operationally preserves (tenant isolation + deploy contract). |
| `docs/architecture/Q1-Q5-Q8-DECISION-PACKAGE-2026-06-05.md` § Q5 | Decision package that scoped Q5; the original "extend `is_enabled()` to be tenant-aware" shape is **superseded by this standard**. |
| `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` § 7 Track B (P1.5B.1–B.3), § 12 Q5 | Origin records of the per-tenant feature-flag decision. The "*tenant_feature_flag table*" wording there refers to the existing `feature_flag` table; the "*extend `is_enabled(feature, tenant_id=None)`*" wording is **superseded by this standard** — the corrected shape is a separate `tenant_flag.py` helper. |
| `backend/app/services/feature_gate.py` | The deploy-shape gate. Today's only implementation. |
| `backend/app/services/tenant_flag.py` | The tenant-flag service helper (**planned** — lands as part of the Q5 implementation PR). |
| `backend/app/models/feature_flag.py` | The DB-backed tenant flag model. |
| `backend/app/routers/feature_flags.py` | The tenant-flag CRUD router. |
| `frontend/src/lib/useFlag.ts` | The tenant-flag frontend hook. |
| `backend/tests/test_feature_gate.py` | Deploy-shape gate tests. |
| `backend/tests/test_feature_flags.py` | Tenant-flag CRUD tests; KT-M1-5 lands here in the Q5 implementation PR. |

---

## 8. Status flips

This file is **LOCKED**. The standard's *content* can only be relaxed via a successor sealed baseline (per I10). Mechanical updates (cross-references, formatting) follow normal doc-change rules.

If a future change to the platform's feature-gating shape genuinely requires collapsing the two systems or restructuring them, the path is:
1. Author `docs/architecture/SEALED-ARCHITECTURE-BASELINE-<date>-FEATURE-GATING-V2.md` with the new shape and the justification.
2. Update this file's header `Status` line to `SUPERSEDED by <date>-FEATURE-GATING-V2`.
3. Cross-link from the new baseline back to this file.

This file is never edited in place beyond cross-reference upkeep and the one-line `SUPERSEDED` flip.

— Ընգեր, 2026-06-05
