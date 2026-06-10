# Sealed Architecture Baseline — GXL Extension Addendum

**File status:** **SEALED 2026-06-10** — all 7 acceptance boxes in §10 are checked. D1 placeholders filled + D2 product-shape sign-off (2026-06-09); D3 invariant review, D4 KT-GXL-1 (green in `backend` + `backend-rls`), D5 compatibility corpus, D6 predecessor footer, D7 status flip all landed in the Phase 1.5 (Q1.B) implementation pass on 2026-06-10. The GXL cross-record surface below is now the architectural contract.

> **Sealing erratum correction (2026-06-10).** Two statements in the pre-seal draft contradicted the engine's *locked* guard-failure contract and were corrected at seal time to match what actually ships (and what the four compatibility tests assert): a guard-blocked transition returns **422** (not 409 — 409 is reserved for "no such transition"), and a failed guard emits **no audit event** (there is no `TRANSITION_REJECTED` event; the prior "existing pattern, unchanged" claim was false). Auditing rejected transitions is a possible future enhancement, tracked separately — it is **not** part of this addendum. Corrected inline in §2.1, §3, and §6 below.

> **Original note:** structural placeholder authored 2026-06-05 by the Q1 resolution in `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md`.

**Type:** **ADDENDUM** to `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`. This file **sits beside** the 2026-06-05 baseline — it does NOT supersede it. The 2026-06-05 baseline remains the architectural contract for everything outside the narrow GXL surface this addendum widens.

**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`
**Triggered by:** Q1 resolution in `docs/roadmap/M1-PLATFORM-EXPANSION-PLAN.md` (2026-06-05)
**Phase:** M1 Phase 1.5 Track A — first artifact, drafted **before** any GXL implementation code lands.

> **Why this file is here in DRAFT.** The 2026-06-05 baseline's I10 (append-only signoff trail) requires that any change to a kernel surface go through a successor sealed baseline. Q1's resolution committed M1 to widening GXL's vocabulary; this file is the *structural* version of that signoff. The implementation engineer fills in the TBD sections during Phase 1.5 design review, Gev signs off, the file is committed as **SEALED**, and only then does GXL code start landing.

---

## Table of contents

1. [Why this addendum exists](#1-why-this-addendum-exists)
2. [What this addendum changes](#2-what-this-addendum-changes)
3. [What this addendum does NOT change](#3-what-this-addendum-does-not-change)
4. [New protected invariants](#4-new-protected-invariants-gxl-i)
5. [New forbidden patterns](#5-new-forbidden-patterns)
6. [KT-GXL-1 specification](#6-kt-gxl-1-specification)
7. [Compatibility window](#7-compatibility-window)
8. [Migration path](#8-migration-path)
9. [Rollback plan](#9-rollback-plan)
10. [Acceptance criteria for sealing this addendum](#10-acceptance-criteria-for-sealing-this-addendum)
11. [Successor-baseline considerations](#11-successor-baseline-considerations)

---

## 1. Why this addendum exists

The M1 plan's Q1 was resolved 2026-06-05 by Gev: **"Yes, GXL must support business-condition workflow guards."**

The driving requirement: real ISP tenants need transition guards that depend on data the engine doesn't currently see — typically the linked **billing account**, **owner customer**, or **active SLA** of the record being transitioned. Concrete examples:

- `service.activate` allowed only if `account.balance_due == 0`.
- `customer.upgrade_to_premium` allowed only if `account.payment_method != null`.
- `incident.close` allowed only if `sla.met_at != null`.

Today's GXL (`backend/app/gxl.py`) evaluates expressions against the record's own fields plus the transition context (`from`, `to`, actor). Cross-record state isn't reachable. The two unacceptable workarounds are:

1. **Move the guard out of the engine** — implement the check in `app/services/...` and call it from the transition handler. Violates [I1](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i1-the-5-kernel-engines-stay-fixed) (engine stays small) and [I5](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i5-config-only-entities-use-the-generic-api-surface) (guards in code, not config).
2. **Express the check as a status field on the entity itself** — denormalize `balance_due` onto every service record. Violates the database engine's normalization invariants and creates a fanout-update problem (every payment must touch every service).

The right path is widening GXL's resolution surface so the guard stays in config, the engine stays the engine, and the database stays normalized. That's what this addendum locks in.

---

## 2. What this addendum changes

### 2.1 GXL identifier resolution surface (NEW)

**Before this addendum** (2026-06-05 baseline):

GXL identifiers resolve to:

- Fields on the record being transitioned (`status`, `name`, `priority`, any FieldDef key)
- Transition context (`from`, `to`, `actor`, `at`)
- Built-in literal types (string, number, boolean, null)

**After this addendum** (Phase 1.5 sealed):

GXL identifiers ALSO resolve to:

- **Linked-record fields** via FieldDef refs. Syntax: `<ref_field_key>.<target_field_key>` — for example, if the entity has a `account` FieldDef of type `ref` pointing at the `account` entity, then `account.balance_due` resolves to the `balance_due` field on the linked account record.

**Resolution semantics:**

| Identifier shape | Resolves to | Allowed |
|---|---|---|
| `status` | The transitioned record's `status` field | ✓ (already supported) |
| `to` | The transition target status | ✓ (already supported) |
| `account.balance_due` | The linked account record's `balance_due` field | ✓ NEW |
| `account.holder.name` | Multi-hop reach — TWO hops, not allowed | ✗ rejected at parse |
| `services.length` | Aggregate over a collection — not allowed | ✗ rejected at parse |
| `now()` | Side-effect function | ✗ rejected at parse |
| `account.balance_due > random()` | Non-deterministic | ✗ rejected at parse |

**Parser-enforced restriction (grammar production filled 2026-06-09):** at most **one** dot in any cross-record identifier. The extended grammar is:

```
identifier ::= NAME | NAME "." NAME
NAME       ::= [a-zA-Z_][a-zA-Z0-9_]*
```

Enforcement uses **AST pre-scan** (not a new grammar library — `gxl.py` stays small): `ast.parse(expr, mode='eval')` walks `ast.Attribute` nodes before `simpleeval` runs. Any `Attribute(value=Attribute(...), ...)` node (two-hop) triggers a **GXL-F2** error immediately, before any DB call. Any `Attribute(value=Name(id=ref_key), attr=field_key)` node where `ref_key` is not a declared `ref` FieldDef on the entity also triggers an error. Single-hop refs that match a declared FieldDef proceed to the resolver. A guard expression that uses `a.b.c` (two dots) fails parse with a clear error message.

**Resolver query shape (filled 2026-06-09):** All catalog entities (including any ref target) live in the generic `record` table with a JSONB `data` column. The resolver pre-fetches the linked row **once per unique ref key** using a parameterized query under the existing RLS-bound session:

```sql
SELECT data FROM record
WHERE id = :ref_id
  AND tenant_id = current_setting('gaahex.tenant_id', true)::uuid
```

> **As-shipped note (2026-06-10):** `:ref_id` is bound as a `uuid.UUID` parameter (never string-interpolated — GXL-F4), and the ref field key is validated to a real UUID in Python *before* the query, so a malformed ref fails closed with no DB round-trip and no transaction-poisoning cast. The tenant predicate uses the `, true` (missing_ok) form of `current_setting` so an unset GUC yields `NULL` (→ zero rows → fail-closed) instead of raising. Resolver lives at `app.workflow.resolve_cross_record`; only `FieldDef.type == "ref"` resolves (ref_user / ref_orgnode target other tables and fail closed to null).

`ref_id` is the UUID value stored in the transitioning record's `data` JSONB at the ref field key (e.g. `record.data['customer_account']`). RLS fires automatically — a cross-tenant `ref_id` returns zero rows, resolving to `null` (fail-closed, no data leak; satisfies GXL-I3 and I3). The resolved `data` dict is injected into the GXL evaluation context as `context[ref_key] = {field: value, ...}` (e.g. `context['account'] = {'balance_due': 0, 'status': 'ACTIVE'}`). `EvalWithCompoundTypes` with `ATTR_INDEX_FALLBACK = True` then evaluates `account.balance_due` as attribute access on the dict — no expression rewriting required.

A guard like `account.balance_due == 0 and account.status == 'ACTIVE'` references two fields on the same linked account; the resolver fetches the account row **once** and reuses it (satisfies GXL-I2).

### 2.2 Cardinality contract: single-record only (NEW)

A cross-record identifier resolves to **exactly one row** — the row whose primary key matches the ref field's value. Aggregates over collections (`count(services)`, `sum(invoices.amount)`, `any(tickets, open)`) are explicitly forbidden and rejected at parse time.

**Rationale:**

- **Performance.** A collection aggregate would require an unbounded scan inside a transition, which is on the latency-critical path (the customer is waiting for the API response). The single-record contract caps guard evaluation at O(1) extra query.
- **Determinism.** A collection's contents can shift mid-transaction; an aggregate would force the engine to define a "read snapshot" semantics that doesn't exist today. Single-record reads inherit Postgres' snapshot isolation cleanly.
- **Explainability.** Tenant admins write guards in Studio; a parser error like "`count(services) > 5` not supported — guards reach exactly one record" is far clearer than a runtime "guard evaluation took too long" later.

Aggregate-style business rules belong outside transition guards — they're scheduled checks (think `seed_notifications`-style background pass) that flip a denormalized flag on the record. The flag is then reachable by GXL as a local field, no cross-record reach needed.

### 2.3 Authorship: super_admin only (NEW)

Writing a cross-record GXL guard requires `super_admin` scope. The Studio WorkflowsPane refuses to save a transition whose guard contains a `.` (cross-record reach) unless the calling user has super_admin grant.

**Rationale:**

- Cross-record reach lets a guard inspect data the entity doesn't own. A misconfigured guard could leak that other entity's state into transition behavior in ways that surprise non-admin tenant users.
- Local-field guards (no `.`) remain authorable by any user with the entity's `config.manage` grant — that's how today's guards work, unchanged.
- The check is at write time (POST `/meta/entities/{slug}/transitions`), not at evaluation time. Once authored, the guard evaluates with the actor's scope.

**Scope predicate (filled 2026-06-09):** the check lands in the `transitions` POST handler in `backend/app/routers/meta.py`. The exact predicate is `can(grants, "config", "manage")` — the same helper already used by `_require_config_manage(s, user)` throughout `meta.py`. Super_admin users hold `"*"` in their permissions set; `_has_perm` returns `True` for any object/verb check against `*`. No new permission key is introduced (I6 preserved). The guard:

```python
if "." in (transition.get("guard") or ""):
    if not can(grants, "config", "manage"):
        raise HTTPException(403, "Cross-record guards require config.manage (super_admin)")
```

A super_admin authoring guards on behalf of a sub-tenant is the canonical pattern.

> **As-shipped note (2026-06-10):** rather than a `if "." in guard` conditional, the implementation gates the *entire* transition-authoring surface — both `POST /meta/entities` (`create_entity`) and `PUT /meta/entities/{slug}/transitions` (`set_transitions`) — on `can(grants, "config", "manage")` (the existing `_require_config_manage`). This is **strictly stronger** than the drafted predicate: *every* guard, local or cross-record, requires `config.manage`. In this platform `config.manage` **is** the super_admin grant (super_admin holds `"*"`), so GXL-I3 holds with no new key (I6). A separate write-time step, `_validate_transition_guards`, parses each guard (`gxl.validate_guard`) and rejects forbidden patterns (GXL-F1..F5) with a 422 at authorship — the parser-rejection half of GXL-I3/§5. **Sealer confirmation:** the super_admin↔config.manage collapse is intentional; if a future role model splits them, cross-record authorship gating must be revisited.

### 2.4 Compatibility window (NEW)

Every GXL guard that exists today MUST parse and evaluate **byte-for-byte unchanged** after the extension. The extension adds new resolution capability; it does not change any existing semantics.

**Enforcement:** the existing GXL test suite (`backend/tests/test_gxl*.py` — TBD list at design review) MUST pass without modification on the Phase 1.5 PR. Any test that needs to change is a compatibility regression, not a test bug.

The compatibility window holds **forever** — there is no future "GXL v2" that breaks v1 guards silently. If a future change to GXL requires breaking semantics, that's its own successor sealed baseline conversation.

---

## 3. What this addendum does NOT change

This is the explicit "what stays the same" dossier. Reviewers verify each invariant below is preserved by the Phase 1.5 PR.

| Invariant from 2026-06-05 baseline | Preserved? | How |
|---|---|---|
| [I1](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i1-the-5-kernel-engines-stay-fixed) — 5 kernel engines stay fixed | ✓ | GXL is a *language* consumed by the WorkItem-movement engine. The engine count stays 5; the engine's vocabulary widens within itself. |
| [I2](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i2-audit-append-only-at-the-db-layer) — audit append-only | ✓ | Every *successful* guarded transition still emits exactly one `TRANSITION` Event via `workflow.emit`. A **failed** guard raises 422 and emits **no** event — the engine's locked contract, unchanged by this addendum (the four compatibility tests assert the failed attempt writes nothing). *(Corrected 2026-06-10: the pre-seal draft wrongly claimed a `TRANSITION_REJECTED` event was emitted "unchanged"; no such event exists. Auditing rejected transitions is a separate future enhancement.)* |
| [I3](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i3-tenant-isolation-engages) — tenant isolation engages | ✓ | The pre-fetch query for the linked record runs under the same `gaahex.tenant_id` GUC as the transition itself. RLS fires on the linked-record query exactly as on any other tenant-scoped query. A guard CANNOT reach across tenants — even if the ref field's value pointed at a row in another tenant, RLS would return zero rows and the guard evaluates against an absent record (treated as `null`). |
| [I4](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i4-the-killer-test-is-in-ci-and-passing) — M0 killer test passing | ✓ | The M0 killer test uses a guard-free workflow (PLANNED → DONE). It's untouched. New killer test KT-GXL-1 rides alongside it. |
| [I5](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i5-config-only-entities-use-the-generic-api-surface) — config-only entities use generic API | ✓ | Cross-record guards are written as GXL strings in `WorkflowDef.config.transitions[].guard` — pure config. No new entity-specific code paths. |
| [I6](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i6-permission-keys-follow-objectaction-and-are-immutable) — permission keys immutable | ✓ | No new permission keys land. The super_admin authorship check uses an existing scope predicate, not a new permission. |
| [I7](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i7-enum-values-are-upper_snake_case) — enums UPPER_SNAKE_CASE | ✓ | Unchanged. Guards compare against enum values; the value format is unchanged. |
| [I8](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i8-the-deploy-contract-gates-production-boot) — deploy contract gates prod boot | ✓ | No change to `_assert_production_deploy_contract`. The GXL extension does not introduce a new feature flag. |
| [I9](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i9-the-70-locked-standards-in-docsstandards) — 70 LOCKED standards | ✓ | No standards changed. The GXL grammar lives in `app/gxl.py` and its docstring; the addendum below is its sealed reference. |
| [I10](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i10-append-only-signoff-trail-for-sealed-baselines) — append-only signoff trail | ✓ | This file IS the I10 mechanism in action. The 2026-06-05 baseline links forward to this addendum once this addendum is sealed; this addendum links back to 2026-06-05; neither file is edited in place. |

If any cell above flips to ✗ during Phase 1.5 implementation, **the implementation is wrong** — not the invariant. The fix is to the code, not to this addendum.

---

## 4. New protected invariants (GXL-I*)

These four invariants are introduced by this addendum. They join the [§3 invariants of the 2026-06-05 baseline](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#3-protected-invariants); a PR that breaks any of them is an automatic NO.

### GXL-I1. Cross-record resolution is single-hop only

A GXL identifier with more than one `.` (e.g., `a.b.c`) is rejected at parse time. The parser MUST enforce this; runtime fallback is forbidden (a runtime error here would leak across compatibility windows).

### GXL-I2. Cross-record guards issue at most one extra query per evaluation

Regardless of how many cross-record identifiers a guard references, the resolver pre-fetches **once** per linked record. A guard that references three fields on the same linked account fetches the account once and reuses it; a guard that references fields on two different linked records fetches each once. The KT-GXL-1 timing assertion (§6) gates this.

### GXL-I3. Cross-record guard authorship is super_admin-only

The write-time check (POST `/meta/entities/{slug}/transitions`) refuses guards containing a `.` (cross-record reach) unless the caller has `super_admin` scope. Local-field guards continue to require only `config.manage`.

### GXL-I4. The KT-GXL-1 killer test stays green

A PR that makes KT-GXL-1 fail is a GXL-extension regression. Like other killer tests ([sealed baseline §7](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#killer-test-rules)), KT-GXL-1 is **never** marked skip / flaky / xfail.

---

## 5. New forbidden patterns

These join the [§4 forbidden patterns of the 2026-06-05 baseline](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#4-forbidden-patterns). The drift checker gains corresponding rules — **all five are HARD** (filled 2026-06-09): each is a parser-rejected pattern with zero legitimate occurrences; RATCHET implies a count that may grow, which is never acceptable for these rules.

### GXL-F1. Aggregate functions in guards

`count(...)`, `sum(...)`, `any(...)`, `all(...)`, `every(...)`, `some(...)` etc. — explicitly rejected at parse time with the message: *"GXL guards reach exactly one record per ref; aggregates over collections are forbidden. Express collection-derived state as a denormalized field on the record."*

### GXL-F2. Multi-hop refs

Any identifier with more than one `.` — rejected at parse. Error message: *"GXL guards may dereference at most one level (`account.balance_due` is OK, `account.holder.name` is not). If you need a two-hop value, denormalize it onto the first hop."*

### GXL-F3. Side-effect-causing functions

`now()`, `random()`, `uuid()`, `current_user()` — any function that returns a value not derivable from the record + linked record. Rejected at parse. Guards are pure functions of state.

### GXL-F4. SQL injection via identifier names

Identifier names MUST match the existing GXL identifier grammar (alphanumeric + underscore). Quoted-string identifiers and any identifier containing characters that could escape an SQL context are rejected. The resolver MUST use parameterized queries for the pre-fetch pass — string-concatenated SQL is forbidden.

### GXL-F5. Guard expressions calling out to external services

`http_get(...)`, `redis_get(...)`, `feature_gate_enabled(...)`, etc. — explicitly rejected at parse. Guards are evaluated synchronously inside the transition transaction; any external call is a latency surprise + a side-effect risk. The right place for "ask an external service before transitioning" is a workflow event handler, not a guard.

---

## 6. KT-GXL-1 specification

**Test name:** `test_gxl_cross_record_guard_evaluation`
**Lives at:** `backend/tests/test_workflow_engine.py`
**Marker:** none (this is a regular killer test, not perf-marked)
**Runs in:** both `backend` and `backend-rls` CI jobs (the latter proves RLS engages on the pre-fetch query under the NOSUPERUSER role)

### Setup

The test creates, via the existing `POST /meta/entities` killer-test path:

1. An `account` entity with `balance_due: number` and `status: {ACTIVE, SUSPENDED}` fields.
2. A `service` entity with:
   - a `name` field
   - a `customer_account` field of type `ref` targeting `account`
   - a `status` field with initial `PENDING` and target `ACTIVE`
   - a transition `PENDING → ACTIVE` with guard `customer_account.balance_due == 0`
3. One account record with `balance_due = 100` (in arrears).
4. One service record linked to that account.

### Assertions

| Step | Assertion |
|---|---|
| 1 | Transition `service.PENDING → ACTIVE` is **refused** with status **422** + body naming the failed guard (the engine's locked guard-failure contract — 409 is reserved for "no such transition"). |
| 2 | The service's status is unchanged after the refused transition. |
| 3 | The account's `balance_due` is updated to 0 (via PATCH on the account record — exercises the existing patch path; no special "pay the account" endpoint). |
| 4 | Transition `service.PENDING → ACTIVE` is now **allowed**; status becomes `ACTIVE`. |
| 5 | The audit trail contains a `TRANSITION` event for step 4 and **no** event for the refused step 1 (a failed guard writes nothing — the locked contract). |
| 6 | **Timing assertion ([GXL-I2](#gxl-i2-cross-record-guards-issue-at-most-one-extra-query-per-evaluation)):** the guard evaluation issues at most one extra SQL query (the pre-fetch of the linked account). Measured by counting queries via SQLAlchemy's event listener around the transition call. |

### What the test proves

- **Cross-record reach works** (`customer_account.balance_due` resolves correctly).
- **The guard refuses when business state forbids** (step 1 fails as expected).
- **The guard allows when business state permits** (step 4 succeeds).
- **The engine stays the engine** — same 422 guard-failure contract as the pre-extension guards, same audit shape, same generic `/api/{slug}` surface.
- **No N+1** — the timing assertion bounds the query count.
- **RLS is unaffected** — the test passes in the `backend-rls` job (running under `gaahex_app`), proving the pre-fetch query respects tenant isolation.

### What the test does NOT cover

- Multi-hop refs (those are forbidden by [GXL-I1](#gxl-i1-cross-record-resolution-is-single-hop-only); a separate negative test in `test_gxl_parser.py` confirms the parser rejection).
- Aggregates ([GXL-F1](#gxl-f1-aggregate-functions-in-guards); separate parser test).
- Cross-tenant ref values (forced to `null` by RLS; covered by an RLS-specific guard test, TBD).

---

## 7. Compatibility window

**Promise:** every GXL guard that exists in production today parses and evaluates byte-for-byte unchanged after the extension. The extension is purely additive.

**Enforcement:**

1. The existing GXL test suite passes unmodified on the Phase 1.5 PR.
2. A new test `test_gxl_compatibility_corpus.py` loads every guard string from every WorkflowDef in the test DB and parses each one; all must parse cleanly.
3. A new test `test_gxl_compatibility_evaluation.py` evaluates the representative guard corpus below and asserts results are identical pre- and post-extension. Runs once per Phase 1.5 PR; not a permanent CI step.

**Existing GXL test list (filled 2026-06-09):** There are no dedicated `test_gxl*.py` files pre-Phase 1.5. Guard evaluation is exercised via integration tests against the seeded `lead` entity (guard: `phone != None and phone != ''`) and the `customer` entity (guard: `email != None and email != ''`). The 4 tests that exercise live GXL evaluation — all must pass unmodified on the Phase 1.5 PR:

| Test | File | Guard exercised |
|---|---|---|
| `test_guard_pass_and_fail_same_edge` | `tests/test_workflow.py` | Phone guard: fail (422) → patch phone → pass (200); failed attempt emits no TRANSITION event |
| `test_full_lifecycle_and_history` | `tests/test_workflow.py` | Full lifecycle NEW→CONTACTED (phone guard)→QUALIFIED→CONVERTED; audit trail in order |
| `test_transition_emits_single_event` | `tests/test_workflow.py` | Guard passes; exactly one Event emitted |
| `test_workflow_guard_and_transitions` | `tests/test_api.py` | Guard fail (422), guard pass (200), invalid transition (409) |

**The compatibility window holds forever.** Any future GXL change that breaks an existing guard's semantics is its own successor sealed baseline conversation, with its own justification + migration path.

---

## 8. Migration path

### For existing tenants

No migration. The compatibility window guarantees existing guards continue to work. Tenant admins who want to add cross-record guards simply edit their workflow definitions in Studio after Phase 1.5 ships.

### For Phase 3 of M1 (custom entity catalog)

The 3–5 tenant-custom entities defined in Phase 3 are written **after** Phase 1.5 ships. Their workflow definitions can use cross-record guards from the start.

### For Studio WorkflowsPane

The pane gains a "Guard expression" field on each transition (likely already exists for local-field guards; the extension just allows the `.` character to be typed). Validation is done server-side by the parser; client-side help text describes the surface:

> *"Guards are pure expressions evaluated when a user attempts the transition. They can read fields on this record (`status == 'PENDING'`) or fields on a linked record one hop away (`account.balance_due == 0`). Aggregates, multi-hop refs, and external calls are not supported."*

Phase 1.5's frontend work is small: the help text, a click-target for super_admin scope check, and a clear error display when the parser rejects a guard.

---

## 9. Rollback plan

If KT-GXL-1 or the compatibility corpus fails after Phase 1.5 ships:

### Tier 1 — Revert the Phase 1.5 PR

The extension is purely additive. Reverting the PR restores the pre-extension GXL grammar; existing guards (none of which use cross-record reach by construction — they were authored before the extension) continue to work unchanged. Any custom guards authored *after* Phase 1.5 that use cross-record reach become parse errors, and the tenants who authored them are notified.

### Tier 2 — Disable cross-record reach via feature flag

If the bug is in the resolver (not the parser), Phase 1.5 ships a kill-switch: `FEATURE_GXL_CROSS_RECORD_ENABLED` defaults to `True`, can be flipped to `False` to fall back to parser-rejection of any guard with a `.` *(equivalent to pre-extension behavior for new authorship)*. Existing pre-extension guards continue to parse + evaluate. The flag is a defense-in-depth fail-closed mechanism; flipping it OFF in production is an immediate mitigation that can land in minutes, not the PR-revert window.

### Tier 3 — Re-issue the sealed addendum

If the extension surface itself was wrong (e.g., single-hop turns out to be insufficient for a real tenant use case discovered post-ship), this addendum is **superseded** by a further-successor file `SEALED-ARCHITECTURE-BASELINE-<date>-GXL-V2.md` that documents the new surface, the migration from v1, and the new killer tests. The 2026-06-05 baseline still anchors; this file is marked SUPERSEDED in its header.

---

## 10. Acceptance criteria for sealing this addendum

This file moves from **DRAFT SHELL** to **SEALED** when ALL of the following are true:

- [x] **D1.** Sections 2.1, 2.3, 2.4, and 6 have their placeholders replaced with concrete design decisions: resolver query shape (parameterized `SELECT data FROM record WHERE id=:ref_id AND tenant_id=…`), parser grammar production (AST pre-scan, `identifier ::= NAME | NAME "." NAME`), super_admin scope predicate (`can(grants, "config", "manage")`), existing GXL test list (4 tests enumerated in §7). ✅ 2026-06-09
- [x] **D2.** Gev reviewed all 5 filled placeholders and signed off verbally ("Agree go") on 2026-06-09. ✅ 2026-06-09
- [x] **D3.** A `code-reviewer`-role reviewer confirmed each preserved invariant in [§3](#3-what-this-addendum-does-not-change) and the four GXL-I invariants against the actual implementation (gxl.py / workflow.py / records.py / bulk.py / meta.py). Verdict: all 12 checked items PASS; two non-code errata (§6/§3 "409 + TRANSITION_REJECTED") corrected at seal time; collapse of super_admin→config.manage confirmed intentional. ✅ 2026-06-10
- [x] **D4.** KT-GXL-1 (`test_gxl_cross_record_guard_evaluation`) implemented in `backend/tests/test_workflow_engine.py`, passing locally, and added to the `backend-rls` job's subset in `.github/workflows/ci.yml` so it runs in both jobs. ✅ 2026-06-10
- [x] **D5.** Compatibility corpus tests implemented + passing: `test_gxl_compatibility_corpus.py` (every seeded guard parses, none use cross-record reach) + `test_gxl_compatibility_evaluation.py` (local-field guard results unchanged) + `test_gxl_parser.py` (F1..F5 rejection). The four pre-existing GXL tests (§7) pass unmodified. ✅ 2026-06-10
- [x] **D6.** The 2026-06-05 baseline gained a `Successor baselines` footer entry linking forward to this file (single appended line, per [I10](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i10-append-only-signoff-trail-for-sealed-baselines)). ✅ 2026-06-10
- [x] **D7.** This file's `Status` header line is flipped to **SEALED 2026-06-10**. ✅ 2026-06-10

All 7 boxes checked → this file is a **sealed contract** as of 2026-06-10. The GXL implementation now lands legitimately against the sealed surface.

---

## 11. Successor-baseline considerations

This file itself follows [I10](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i10-append-only-signoff-trail-for-sealed-baselines): it can only be relaxed by a further-successor file. Specific scenarios:

### S1. M2 needs aggregates in guards

If M2 surfaces a real requirement that needs `count(services) > 5`-style aggregates, the answer is **not** to relax [GXL-F1](#gxl-f1-aggregate-functions-in-guards) in this file. The answer is a new sealed baseline `SEALED-ARCHITECTURE-BASELINE-<date>-GXL-AGGREGATES.md` that:

1. Justifies why the denormalized-field workaround is insufficient.
2. Defines the aggregate grammar.
3. Defines the latency contract (e.g., aggregate guard must complete in ≤ 50ms via a materialized view or cached counter).
4. Lands a killer test that exercises the new surface.

The current file stays sealed; the new file references it; both are active simultaneously, with the new file scoped narrowly to aggregates.

### S2. M2 needs multi-hop refs

Same pattern as S1. The new file `SEALED-ARCHITECTURE-BASELINE-<date>-GXL-MULTIHOP.md` justifies why the one-hop limit is insufficient, defines the cardinality contract for multi-hop (e.g., capped at 2 hops, single-record at each), defines the new resolver query shape, and lands its own killer test.

The default disposition for any future GXL relaxation: **prefer a denormalized field on the record** before a new sealed baseline. The denormalization solves the same problem with less architectural surface.

### S3. The compatibility window must break

If a future change to GXL truly requires breaking the byte-for-byte compatibility window in [§7](#7-compatibility-window), that's a thesis-level change — not a successor sealed baseline alone but a successor to the **2026-06-05 baseline itself**. The trigger is "every tenant's existing guards need to be rewritten" — which is a tenant-coordination event with calendar implications, not a casual PR.

### S4. RLS interaction with the pre-fetch pass needs auditing

If [I3](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#i3-tenant-isolation-engages) ever needs explicit per-query audit of cross-record reads (e.g., compliance regime requires logging every cross-record read for forensic), a successor sealed baseline locks in the audit surface: which event types are emitted, which fields, which retention.

---

## Closing

This addendum is the structural seal for the GXL extension. It exists in DRAFT today so that when Phase 1.5 starts, the design conversation has somewhere to land — Gev's product input, the engineer's surface choices, the reviewer's invariant check all converge on this one file. When the 7 acceptance boxes in [§10](#10-acceptance-criteria-for-sealing-this-addendum) are all checked, this file becomes SEALED and GXL code starts landing against the sealed surface.

The 2026-06-05 baseline is unchanged. The five engines stay five. The killer tests stay green. The audit trail stays append-only. The GXL extension is the smallest possible widening of the WorkItem-movement engine's vocabulary that lets a real ISP express its workflows in config, not code — and this file is its bond.

— Ընգեր, 2026-06-05 (DRAFT SHELL)

— Design review complete, D1+D2 locked, 2026-06-09. D3–D7 gate the Phase 1.5 (Q1.B) PR.

— **SEALED 2026-06-10.** Q1.B landed the implementation: AST-pre-scan parser (`gxl.validate_guard`), single-query RLS-bound resolver (`workflow.resolve_cross_record`), write-time authorship validation, the `FEATURE_GXL_CROSS_RECORD_ENABLED` kill-switch, and KT-GXL-1 + the compatibility corpus. Independent D3 invariant review passed all 12 checks; two draft errata (409→422, the phantom `TRANSITION_REJECTED` event) were corrected at seal. The five engines stay five; the four pre-extension guards pass unmodified. — Ընգեր
