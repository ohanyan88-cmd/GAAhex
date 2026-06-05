# Sealed Architecture Baseline — 2026-06-05

**Status:** SEALED · post-M0-staging
**Branch baseline:** `main` @ `b977db8` (full pytest green 1768/0/0, drift green, killer test passing)
**Authoritative source:** this document supersedes ad-hoc architecture notes. If something
here contradicts a Slack message, this document wins.

This is the **canonical "what must never be broken" reference** for every contributor
post-M0. Read it before you open a PR that touches kernels, audit, RLS, multi-tenancy, the
config-driven entity pipeline, or any of the 5 fixed engines. The platform thesis is
proven, the regression net is wired, and that net only stays useful if the patterns below
stay intact.

> **Versioning rule.** This document is date-stamped. When the baseline materially shifts
> (a new locked invariant lands, a kernel engine grows, a drift rule promotes from RATCHET
> to HARD), the next contributor adds a successor file `SEALED-ARCHITECTURE-BASELINE-<date>.md`
> and links the previous one as superseded. Editing this file in place is reserved for
> typo / link / cross-reference fixes — every substantive change is a new file.

---

## Table of contents

1. [Architecture principles](#1-architecture-principles)
2. [Platform thesis](#2-platform-thesis)
3. [Protected invariants](#3-protected-invariants)
4. [Forbidden patterns](#4-forbidden-patterns)
5. [CI enforcement](#5-ci-enforcement)
6. [Drift enforcement](#6-drift-enforcement)
7. [Killer test inventory](#7-killer-test-inventory)
8. [Approved extension points](#8-approved-extension-points)
9. [Accepted technical debt](#9-accepted-technical-debt)
10. [Migration history](#10-migration-history)
11. [Future M1/M2/M3 expansion rules](#11-future-m1m2m3-expansion-rules)

---

## 1. Architecture principles

These ten principles describe how GAAhex is *meant to be built*. Every principle below has at
least one [Protected invariant](#3-protected-invariants), one [Forbidden pattern](#4-forbidden-patterns),
or both. The principles are the doctrine; the invariants and forbidden patterns are the teeth.

### A1. Config, not code, drives behavior

The platform renders & behaves from configuration. New entities, new fields, new workflows,
new statuses, and new permissions are added through `POST /meta/entities` and its sibling
config endpoints — **never** through code that names a specific entity. The killer test
([§7](#7-killer-test-inventory)) is the mechanical proof that this holds end-to-end.

### A2. Five engines, fixed

There are five kernel engines, and there are only ever five kernel engines:

| Engine | Lives in | Owns |
|---|---|---|
| **WorkItem movement** | `app/kernel/workflow_engine.py` + `app/notify_hooks.py` | record lifecycle transitions, transition guards, transition audit |
| **Auth / authz** | `app/access.py` + `app/routers/auth.py` + `app/security.py` | identity, JWT lifecycle, capability resolution, scope checks |
| **Database** | `app/db.py` + `app/models/*` + `alembic/versions/*` | schema, RLS, persistence, tenant-scoped queries, foreign keys |
| **Audit / log** | `workflow.emit(...)` + `event` table + append-only triggers | every state change → one Event row, append-only at the DB layer |
| **Security** | `app/config.py:_assert_production_deploy_contract` + `app/services/feature_gate.py` | boot-time deploy gates, fail-closed feature posture, RBAC seed integrity |

Adding a 6th engine is a thesis change, not a feature. If a PR feels like it needs one,
the answer is almost always "express it as configuration consumed by one of the existing
five".

### A3. The kernel stays small

`app/kernel/*` is load-bearing for the thesis. New code goes *beside* the kernel
(`app/services/*`, `app/routers/*`) or *consumes* it via `workflow.emit` — never *inside* it.

### A4. Every tenant-scoped row carries `tenant_id`

D1 doctrine: there is no row in any tenant-scoped table without a `tenant_id`. The RLS
policy `tenant_isolation` on that table fences cross-tenant reads in the database itself.
209 `CREATE POLICY tenant_isolation` lines across the 111 migrations enforce this.

### A5. RLS engages in production

The production deploy contract refuses to boot if `DATABASE_URL` and `OWNER_DATABASE_URL`
resolve to the same Postgres role. The app role (`gaahex_app`) is `NOSUPERUSER NOBYPASSRLS`;
the owner role (`gaahex`) is the table owner and is used only by migrations and pre-auth
code paths. RLS isn't a Postgres feature we use — it's the foundation we sit on. See
`docs/M1A-DEPLOY-CONTRACT.md`.

### A6. Audit is append-only, at the DB layer

Migration `b70ef3b98e27_kernel_invariants_db_triggers_region_id.py` installs Postgres
triggers that `RAISE EXCEPTION` on any UPDATE or DELETE to `event` or `audit_log`. The
trigger fires for **every role including the table owner** (`RestrictViolationError:
event (audit log) is append-only per SPEC §0.4 — no DELETE allowed by any role including
Admin`). Application code that "just needs to clean up an audit row" is wrong.

### A7. Every mutation emits one event

A record write that doesn't pass through `workflow.emit(...)` is a hole in the lineage. The
WorkItem-movement engine is the single chokepoint; if it isn't called, the change didn't
happen as far as the platform is concerned.

### A8. Canonical implementations, not parallel ones

For every cross-cutting concern (`bget`/`bpost`, `authH`, `fmtDate`, `_deny`, AMD formatter,
async HTTP client, page-shell zones, button/input primitives, etc.) there is exactly one
canonical implementation. Local copies are forbidden patterns enforced by the drift checker
([§6](#6-drift-enforcement)).

### A9. Fail-closed, not fail-open

A feature flag that is ON but whose implementation hasn't shipped MUST refuse to boot in
production. A mock payment gateway in production MUST be a startup error. A wildcard CORS
in production MUST refuse to start. The default posture is "no", and the contract enforces
the "yes" requires real proof. See `app/services/feature_gate.py` + the deploy contract.

### A10. Standards locked, evolution explicit

`docs/standards/` holds **70 LOCKED platform standards** (data models, enums, permission
keys, UI primitives, page types, lifecycle behavior). LOCKED means: a PR that diverges from
a standard either aligns with it, documents an exception, or revises the standard *first*.
A divergent PR that does none of the three is the canonical regression.

---

## 2. Platform thesis

> **The system renders & behaves from configuration, enforced by 5 fixed kernel engines
> (WorkItem movement · auth/authz · database · audit/log · security) — with no hardcoded
> screens or business rules. The killer test: stand up a 2nd entity with config only.**

— from `CLAUDE.md` (canonical project brief)

### What the thesis means in practice

A new operational concept (an "SLA", a "Connection Order", an "Onboarding Task", a
"Vehicle", a "Pole") is brought into existence by inserting four kinds of config rows
in one atomic `POST /meta/entities`:

1. **EntityDef** — the entity's key, label, route slug, icon.
2. **FieldDef[]** — the columns / form fields. Type ∈ `ALLOWED_TYPES` (`text`, `textarea`,
   `number`, `money`, `boolean`, `date`, `datetime`, `email`, `phone`, `select`, `ref`, `status`).
3. **StatusDef[]** — the lifecycle states. Exactly one carries `is_initial: true`.
4. **WorkflowDef** transitions — declared `{from, to, guard}` edges between statuses.

The platform then exposes the entity through the same `/api/{slug}/*` surface every
built-in entity uses (list / get / create / update / delete / transition / history),
auto-generates four permissions (`{key}.view`, `.create`, `.edit`, `.delete`), and
auto-injects the entity into the Admin Panel → Records subsection of the frontend
sidebar. **Zero application code is written.** The system already knows what to do
because the five engines consume the same config rows.

### Why this matters

If the thesis breaks, GAAhex becomes a hand-written CRUD app like every other ISP back
office. The whole premise — that tomorrow's "we need to track Y" is a config commit, not
an engineering ticket — collapses. So the killer test ([§7](#7-killer-test-inventory))
is in CI on every push, and a PR that breaks the thesis fails the build before it ever
reaches a reviewer.

---

## 3. Protected invariants

These are the hard things. A PR that breaks any of them is an automatic NO.

### I1. The 5 kernel engines stay fixed

The set of engines listed in [A2](#a2-five-engines-fixed) is exhaustive. No PR adds a 6th
engine, splits one of them, or moves logic *out* of one into application code in a way
that bypasses it. New work composes the engines; it doesn't replace them.

### I2. Audit append-only at the DB layer

The triggers installed by `b70ef3b98e27` (and reinforced by `3a86ae0ed044_comment_hold_db_trigger.py`,
`7a4b1e9c2f08_spec_5_workflows.py`, `b5e8f1c2d3a4_spec_4_5_mandatory_approvals.py`,
`85e76746332e_event_system_extension_d1.py`) MUST NOT be dropped or weakened. UPDATE and
DELETE against `event` and `audit_log` are forbidden, including by the table owner. A
migration that removes this trigger is forbidden unless it's replaced by a stricter one.

### I3. Tenant isolation engages

`gaahex_app` is `NOSUPERUSER NOBYPASSRLS`. Every tenant-scoped table has a
`tenant_isolation` RLS policy bound to the `gaahex.tenant_id` GUC. The per-request GUC is
set by `routers/auth.py::current_user` from the JWT `tenant` claim, validated against
`User.tenant_id` server-side. Production refuses to boot when the role split is missing
([A5](#a5-rls-engages-in-production)).

### I4. The killer test is in CI and passing

`backend/tests/test_api.py::test_m0_killer_2nd_entity_config_only` runs on every push via
`pytest --tb=short -q` ([§7](#7-killer-test-inventory)). A PR that makes it fail is a
thesis regression — not a flaky test, not an acceptable change.

### I5. Config-only entities use the generic API surface

A config-defined entity is reachable via the same `/api/{slug}/*` shape as a built-in.
Application code that branches on `if slug == "lead"` (or any specific entity key) inside
the generic record router is forbidden. The router handles entity-specific behavior via
config (FieldDef, StatusDef, WorkflowDef) — never via inline switches.

### I6. Permission keys follow `object.action` and are immutable

Permission key shape is `{entity_key}.{verb}` per `docs/standards/15-permission-registry.md`.
Once a permission key has been released to a tenant's role grants, the key is **immutable**.
Renaming `customer.view` to `customer.read` is a breaking change for every existing role
that has it. Renaming a permission key is forbidden unless paired with a backfill migration
that maintains all grants.

### I7. Enum values are `UPPER_SNAKE_CASE`

B1 standard. `status`, `type`, `category`, `priority`, `severity`, and every other
business-visible enum value is `UPPER_SNAKE_CASE` on the wire. `Active` or `active` on
the wire is forbidden; locale-specific labels are an i18n concern, not a model concern.

### I8. The deploy contract gates production boot

`_assert_production_deploy_contract()` runs in FastAPI's `lifespan` startup. The contract
enforces (in this order):

| # | Check | Source |
|---|---|---|
| 1 | `DATABASE_URL` ≠ `OWNER_DATABASE_URL` (URL) | `config.py:178-188` |
| 2 | App role ≠ owner role (username) | `config.py:190-202` |
| 3 | No wildcard in `CORS_ORIGINS` | `config.py:204-216` |
| 4 | No mock providers (payment/email/sms/radius) | `config.py:218-238` |
| 5 | `PORTAL_AUTH_MODE ∈ {cookie, both}` | `config.py:240-260` |
| 6 | Feature flag ON ⟹ real backend constructs | `config.py:262-346` |

Removing or weakening any of these checks in `config.py` is a production-grade regression.

### I9. The 70 LOCKED standards in `docs/standards/`

Every PR that touches a tenant-scoped data model, an enum, a permission key, a UI primitive,
a page type, or a lifecycle behavior **consults the relevant standard first**. The standards
index is `docs/standards/00-standards-index.md`. A PR that diverges flags it in the PR
description so the orchestrator can decide: align, document an exception, or revise the
standard. Drift is forbidden.

### I10. Append-only signoff trail for sealed baselines

This file (and its dated successors) is the architectural contract. A successor file
`SEALED-ARCHITECTURE-BASELINE-<date>.md` MUST link back to its predecessor and explain
**every** invariant it relaxes — with a justification, the killer test impact, and the
migration path. Tombstoning an invariant silently is the architectural equivalent of
deleting an audit row.

---

## 4. Forbidden patterns

These are the textual forms the drift checker enforces. The grep for each pattern is in
`tools/check_drift.py`; the baselines are in `tools/check_drift_baseline.json`.

### HARD-forbidden — any match is an immediate CI fail

| # | Rule | Pattern | Canonical |
|---|---|---|---|
| F1 | **BL-10** local `_deny` def in routers | `^def _deny\(perm: str\)` | `from app.utils.http_errors import deny as _deny` |
| F2 | **BL-5** local `_parse_dt` def in routers | `^def _parse_(?:dt|iso)\(...\)` | `app.utils.dt.parse_iso_dt` |
| F3 | **AC-5** direct `httpx.AsyncClient` | `httpx\.AsyncClient\(` outside `utils/http_client.py` | `get_async_client(timeout=...)` |
| F4 | **PC-2** inline `approval_required` HTTPException | `HTTPException\(202, detail={...status.*approval_required` | `raise approval_required(approval_id, action_type)` |
| F5 | **BL-2** local AMD formatter | `^def _?amd\(luma..\)...:` outside `utils/money.py` | `app.utils.money.amd_format` |
| F6 | **AC-1** local `authH` def | `^const authH = \(` outside `lib/billing.ts` | `import { authH } from 'lib/billing'` |
| F7 | **DF-4** local `fmtDate` def | `^function fmtDate\(` outside `lib/time.ts` | `import { fmtDate } from 'lib/time'` |
| F8 | **DF-5** local `fmtDateTime` def | `^function fmtDateTime\(` outside `lib/time.ts` | `import { fmtDateTime } from 'lib/time'` |
| F9 | **DF-6** local `moneyDecimal`/`moneyDec` def | `^function money(?:Decimal|Dec)\(` outside `lib/money.ts` | `import { moneyDecStr } from 'lib/money'` |
| F10 | **TB-5** `aria-pressed` on a tab | `role="tab"[^/]*aria-pressed` | `aria-selected` |
| F11 | **MO-\*** hand-rolled modal/drawer chrome | `position: 'fixed', inset: 0, background: 'var(--gx-overlay)` | `<Modal>` / `<StudioDrawer>` / `<Overlay>` |

### RATCHET-forbidden — count must not exceed the baseline

These patterns have a non-zero baseline (existing tail to migrate over time). A PR that
introduces a NEW instance fails CI; touching one of the existing ones counts toward
your PR's clean-up budget.

| # | Rule | Pattern | Baseline | Notes |
|---|---|---|---|---|
| R1 | **DF-1/DF-2** alive guard | `let alive = true` in `frontend/src/` | 54 | Migrate to `useFetch` / `useFetched` |
| R2 | **AC-2** raw `fetch(${BASE}/...)` | in views/studio/components | 60 | Migrate to `bget` / `bpost` |
| R3 | **Phase-5** raw `btn-md` | `className="btn btn-..."` | 6 | Migrate to `<Button>`; intentional exceptions documented |
| R4 | **Phase-5** raw `inp` | `className="inp"` | 5 | Migrate to `<Input>`; textareas need `<Textarea>` first |
| R5 | **SM-1** view with `token: string` prop | `^export default function \w+View\([^)]*token: string` | 45 | Migrate to `useAuth()` |
| R6 | **Phase-5** hex literal in `style={{}}` | `style=\{\{[^}]*['\"]#[0-9A-Fa-f]+['\"]` | 22 | All in MasterLayoutDemoView (intentional reference) |
| R7 | **Phase-5** `var(--gx-x, #hex)` fallback | `var\(--gx-[a-z0-9-]+,\s*#[0-9A-Fa-f]+\)` | 0 | Drop the fallback once the token is in `gaahex-tokens.css` |
| R8 | **A11y** `<div onClick>` | `<div\b[^>]*\sonClick=\{` | 41 | Use `<button>` or add `role`+`tabIndex`+`onKeyDown` |

The ratchets only move down. A PR's net effect on each counter is **≤ 0**. The drift
checker auto-lowers the baseline when a PR reduces a count, locking in the win.

### Implicit (no drift rule yet, but doctrine)

- **No new entity-specific routes.** A new entity uses `/api/{slug}/*` — period. `POST
  /api/customers/something-special` is the wrong shape; the right shape is a config-driven
  transition or action on the generic surface.
- **No bypassing the deploy contract.** A PR that adds `if settings.environment ==
  "production": pass` to skip a gate is an automatic NO.
- **No DELETE/UPDATE on `event` or `audit_log` from application code.** Even in tests —
  the cross-tenant teardown helper had to be updated to skip these tables because the DB
  trigger fires for every role.
- **No `ON DELETE CASCADE` from `tenant.id`.** Audit lineage can't be tombstoned by a
  tenant deletion (SPEC §0.4). Tenants are soft-state at the lifecycle level.

---

## 5. CI enforcement

`.github/workflows/ci.yml` defines four jobs that all gate `main`:

### Job `backend`

| Step | Tool | What it catches |
|---|---|---|
| Lint | `ruff check app/ --exit-zero` | Style (warn-only until backlog cleaned) |
| Tenant-filter static analysis | `python backend/scripts/check_tenant_filter.py` | New SQLAlchemy queries on tenant-scoped tables without `tenant_id` filter |
| Architecture-drift guard | `python tools/check_drift.py` | Every HARD + RATCHET rule above |
| Tests | `pytest --tb=short -q` | **Includes the killer test by collection** — every push proves the M0 thesis |
| Dependency audit | `pip-audit -r requirements.txt --strict` | Known CVEs in Python deps (warn-only on landing) |

### Job `backend-rls`

Re-runs the RLS subset (`test_rls.py`, `test_rls_parametric.py`, `test_rls_wave4_spot.py`,
`test_deploy_contract.py`) with `DATABASE_URL` bound to `gaahex_app:gaahex_app` (NOSUPERUSER
NOBYPASSRLS). This is the dual-role enforcement gate — catches RLS-bypass bugs that the
main `backend` job (running as the owner role) hides. Currently `continue-on-error: true`
during the team's triage window; that flag MUST come off before M1 ship.

### Job `frontend`

| Step | Tool | What it catches |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | TypeScript regressions |
| Dependency audit | `npm audit --audit-level=high` | Known CVEs in npm deps (warn-only) |

### Job `secret-scan`

`gitleaks` — accidentally-committed credentials. Warn-only.

### The CI promise

If all four jobs pass on a PR, the PR is safe to merge with respect to: the thesis (killer
test), tenant isolation (RLS subset + tenant-filter), drift (architecture-drift guard),
type safety (tsc), and basic supply-chain hygiene (audit + gitleaks). What CI **can't**
catch by definition is visual UI regression and runtime behavior under production traffic
shapes; those are the staging smoke's responsibility.

---

## 6. Drift enforcement

The drift checker (`tools/check_drift.py`) is the regression net for the patterns above.
Today's state:

- **11 HARD rules.** Match anywhere → immediate exit 1.
- **8 RATCHET rules.** Count must be `≤ baseline`. Exceed → exit 2. Equal → pass and auto-
  lower the baseline if the actual count is below.
- **Baseline file:** `tools/check_drift_baseline.json`. Hand-edits are forbidden in PRs
  that aren't dedicated baseline maintenance — `--update` is the right path.

### Ratchet philosophy

A ratchet rule encodes "we couldn't migrate every existing site in one pass, but no new
site of this shape is acceptable". The counter never goes up under normal operation:

- A new instance ⟹ counter goes up ⟹ CI fails the PR.
- An instance removed by another change ⟹ counter goes down ⟹ baseline auto-lowers ⟹
  the win is locked in.
- The same instance touched without structural change ⟹ counter unchanged ⟹ pass.

### Adding a new drift rule

1. Land the canonical implementation first (so existing call sites can migrate to it).
2. Migrate the highest-leverage call sites manually.
3. Add the pattern to `tools/check_drift.py` as a `RatchetRule` with `pattern`, `paths`,
   `regex=True`.
4. Run the checker once to populate the baseline (it auto-initializes a new key).
5. Commit baseline + rule in one commit so reviewers see both.
6. Once a ratchet rule's count reaches 0 in two consecutive commits, **promote it to HARD**:
   move it from `RATCHET_RULES` to `HARD_RULES`, delete the baseline key, ship.

### Removing a drift rule

Allowed only if the underlying doctrine itself is being retired (e.g., the canonical it
gates is being replaced by a deliberately-different one). Document the retirement in the
next sealed baseline file as a justified relaxation.

---

## 7. Killer test inventory

These are the tests that prove load-bearing invariants. A PR that touches the kernel,
audit, RLS, or the config-driven entity pipeline runs THESE tests locally **before** the
push; CI runs them on every push regardless.

### M0 thesis

| Test | Proves | If it fails |
|---|---|---|
| `tests/test_api.py::test_m0_killer_2nd_entity_config_only` | All 5 engines wire correctly for a brand-new entity defined ONLY in config. Exercises security gate, entity-def atomic create, auto-generated permissions, generic CRUD, workflow guards (declared vs undeclared transitions), audit history, RBAC denial for non-owner. | M0 is broken. Don't merge. |
| `tests/test_api.py::test_studio_create_entity` | The existence proof: admin POSTs to `/meta/entities` and the entity is reachable. Lighter than the killer; the killer's older sibling. | Same as above. |

### Tenant isolation

| Test file | Proves |
|---|---|
| `tests/test_rls.py` | Spins up a 2nd engine on the `gaahex_app` role and verifies RLS isolates cross-tenant reads. |
| `tests/test_rls_parametric.py` | Same shape, parameterized across every tenant-scoped table. |
| `tests/test_rls_wave4_spot.py` | Spot-checks for the Wave 4 multi-tenant hardening pass. |
| The 16 `test_*::test_cross_tenant_*` tests | API-level cross-tenant 404s (a user from tenant B can't see / mutate tenant A's rows through the HTTP surface). |

### Production boot contract

| Test | Proves |
|---|---|
| `tests/test_deploy_contract.py::test_dev_default_does_not_fire` | The contract is a no-op in non-production. |
| `tests/test_deploy_contract.py::test_production_with_equal_urls_raises` | Same-URL config refuses to boot. |
| `tests/test_deploy_contract.py::test_production_with_same_role_raises` | Same-role config refuses to boot. |
| `tests/test_deploy_contract.py::test_production_with_separate_roles_passes` | Correct prod config + CORS + non-mock providers + portal_auth_mode boots cleanly. |

### Audit append-only

The DB trigger itself is the proof; any test that tries to DELETE from `event` or
`audit_log` will fail with `RestrictViolationError`. That failure mode is exercised
indirectly by `delete_tenant_cleanly()` in `tests/conftest.py` (skips both tables on
purpose).

### Killer test rules

- Each killer test is named so future engineers can find it by intent (`test_m0_*`,
  `test_rls_*`, `test_deploy_contract_*`).
- Each killer test has a docstring tied back to the invariant it protects.
- Killer tests are **never** marked `@pytest.mark.skip`, `@pytest.mark.flaky`, or
  `xfail`. A killer test that's broken is the rollback signal.

---

## 8. Approved extension points

This is the **only** sanctioned list of "how to add something without breaking the
baseline". A PR that extends the platform along one of these axes inherits the existing
proofs; a PR that adds capability by a different route doesn't, and the reviewer is right
to push back.

### E1. Add a new entity

**Don't** write a new model + router + view trio. Instead:

- `POST /meta/entities` with the entity definition (or Studio → Entities → New entity).
- The platform auto-generates 4 permissions (`{key}.view/.create/.edit/.delete`).
- The entity is reachable at `/api/{slug}/*` (list/get/create/update/delete/transition/history).
- The frontend auto-injects it into Admin Panel → Records via the `extraEntities` filter.

### E2. Add a new field type

- Add the type string to `ALLOWED_TYPES` in `backend/app/routers/meta.py`.
- Add the type to `FIELD_TYPES` in `frontend/src/studio/EntitiesPane.tsx`.
- Implement rendering in `frontend/src/components/FieldInput.tsx`.
- Implement validation in the backend (write the field-type-specific validator beside the
  existing ones in `app/services/field_validation.py` or wherever the existing types live).

A new field type that breaks the surface contract (e.g., changes how `status` is resolved
to a transition target) is a thesis change, not a field type.

### E3. Add a new status / transition / workflow

- For an existing entity: `POST /meta/entities/{slug}/statuses` and `PUT
  /meta/entities/{slug}/transitions`.
- The workflow engine consumes these immediately; no code changes.

### E4. Add a new page / view

- Compose `<PageShell>` with the 6 standard zones (file 10 of the standards).
- Use the canonical primitives (`<Button>`, `<Input>`, `<Modal>`, `<StudioDrawer>`,
  `<Pagination>`, `<LoadShell>`, `<DetailTab>`, `<StatusPill>`, `<KPITile>`,
  `<RowActionsMenu>`, `<FormField>`, `<DataTableCell>`).
- Detail pages expose the canonical 9-tab set (Overview, Timeline, Tasks, Comments,
  Attachments, Approvals, Related, Communications, Audit) before any object-specific tabs.

### E5. Add a new primitive

- Lives in `frontend/src/primitives/`.
- Has a `*.stories.tsx` companion (future drift rule will require it).
- Is exported from `primitives/index.ts`.
- Documented in `docs/standards/UI_PRIMITIVES_STANDARD.md`.

### E6. Add a new tenant-scoped table

- Migration adds the `tenant_id` column with FK to `tenant.id`.
- Migration adds an `RLS tenant_isolation` policy (NULLIF-guarded; mirror the existing
  pattern from any migration in `alembic/versions/`).
- Model class extends `Base` and inherits the `tenant_id` mixin if available.
- Tenant-filter static analyzer (`backend/scripts/check_tenant_filter.py`) will catch
  any query that forgets the filter.

### E7. Add a new permission

- Either auto-generated (created by `POST /meta/entities` for the 4 standard verbs) or
  hand-written in `seed_spec_roles_if_missing()` for SPEC-level platform permissions.
- Key MUST be `{object}.{action}`, both lowercase, both in the registry
  (`docs/standards/15-permission-registry.md`).
- Permission keys are **immutable post-release** ([I6](#i6-permission-keys-follow-objectaction-and-are-immutable)).

### E8. Add a new mutation that emits an audit event

- Call `await workflow.emit(s, tenant_id, event_type, entity_key, record_id, actor_user_id,
  data, event_name=..., category=...)`.
- Do **not** insert into `event` directly. The kernel owns event-row construction so
  invariants (schema, append-only, lineage) hold uniformly.

### E9. Add a new feature gate

- Add the flag to `Settings` in `app/config.py` (default `False`).
- Add the gate key + reason string to `app/services/feature_gate.py` (`is_enabled` +
  `_disabled_reason`).
- Add the production check to `_assert_production_deploy_contract` so a gate-ON-without-
  backend prod boot is refused.
- Add an `IMPORT_*_IMPLEMENTED` sentinel (or equivalent) that flips to `True` in the same
  commit as the real backend lands.

### E10. Add a new CI gate

- Add the step to `.github/workflows/ci.yml`.
- Document it in [§5](#5-ci-enforcement) of the **next** sealed baseline.
- If the gate has a backlog tail, structure it as a ratchet rule
  ([§6](#6-drift-enforcement)) so the baseline only moves down.

---

## 9. Accepted technical debt

These are the known compromises. They were considered, weighed, and **deliberately deferred**.
A PR that fixes one of these is welcome; a PR that complains they aren't fixed without doing
the fix is noise.

### TD1. T-P3-9 — Layout one-offs (~1,100)

`style={{ display: 'flex', gap: N }}` inline blocks could become `<Stack>/<Inline>/<Grid>`,
but the primitives' xs/sm/md/lg/xl gap scale doesn't align to common inline gap values
(6/10/12/14/20px). Mass migration would either shift visual rhythm or require Stack to
grow a numeric `gap` prop — both need design input. The drift checker prevents new
instances. Per-PR migration is welcome.

### TD2. T-P2-4 — No `<ConversationRow>` primitive

Only n=2 conversation surfaces (MessagesView + HelpdeskView) and they render rows
differently. Building a primitive over n=2 with different requirements is over-engineering.
Revisit when a 3rd conversation surface arrives.

### TD3. 48 orphan `--gx-*` tokens

The remaining orphans are documented future-use: NMS network-status family
(`--gx-active/-degraded/-quality-*`/etc), chart tokens, breakpoint constants, typography
weight/leading/tracking aliases. Removing them is a CSS payload reduction (a few hundred
bytes); leaving them is harmless. Future passes can drop them in batches.

### TD4. 22 hex literals in `MasterLayoutDemoView`

Intentional. The demo view documents the print/light palette as concrete reference values
so designers can read them. T-P1-8 marked this file as a documented exception.

### TD5. 6 raw `btn-md` sites

All intentional:
- 1 in `StudioDrawer.tsx` is a docstring (documentation of the pre-migration pattern).
- 4 in studio panes use `style={{ color: 'var(--gx-danger)' }}` for "destructive but not
  prominent" UX — `variant="danger"` would fill the surface red, which is a different
  intent.
- 1 in `ConfigureDrawer.tsx` is `<button role="option" aria-selected>` — a list-row-as-
  button, not a CTA.

### TD6. 5 raw `inp` sites

4 are `<textarea className="inp">` — `<Input>` doesn't handle textareas (a `<Textarea>`
primitive doesn't exist yet). 1 is `<input className="inp">` in `MessagesView.tsx` that
uses a `ref` — `<Input>` doesn't forward refs. Both are tractable; neither is urgent.

### TD7. 60 raw `fetch(${BASE}/...)` in views

AC-2 ratchet. Migration to `bget`/`bpost` is per-touched-file. The canonical client is
fully featured (401 interception, error funneling, response typing); existing sites work
because the manual fetch wires the same headers via `authH`. Drift checker prevents new
ones.

### TD8. 54 `let alive = true` guards in views

DF-1/2 ratchet. Migration to `useFetch`/`useFetched` from `hooks/useFetch.ts` is per-
touched-file. Existing sites work; the `alive` pattern is a correct (if verbose) way to
avoid stale `setState` after unmount.

### TD9. 45 views still take `token: string` prop

SM-1 ratchet. The canonical is `useAuth()` from `context/AuthContext.tsx`. Existing prop-
drilled views work; migration is mechanical when a view is touched anyway.

### TD10. 41 `<div onClick>` a11y sites

T-P1-4 ratchet. Each one should be either a `<button>` or a `<div>` with `role`,
`tabIndex`, and `onKeyDown` for Enter/Space. WCAG 2.1.1 + 4.1.2. Drift checker prevents
new ones.

### TD11. T-P3-1 — `gaahex-tokens.css` vs `color-tokens.css` double-registry (D19)

Both files define `--gx-*` tokens; `color-tokens.css` loads after `gaahex-tokens.css` and
wins by cascade order for the 86 keys they share. Headers in both files document this.
Merging properly requires a key-by-key visual audit across both themes — a multi-day
task. Until then, **new tokens go in `gaahex-tokens.css`**; `color-tokens.css` is override-
only.

### TD12. Cross-tenant tests leave a 2nd tenant row

The `delete_tenant_cleanly()` helper skips the final `DELETE FROM tenant` because the
`event` FK still references it and `ON DELETE CASCADE` isn't allowed by SPEC §0.4. The
orphan tenant row is benign — each fixture creates a fresh uuid; the test DB is recreated
at session start. Documented in the helper's docstring.

### TD13. Backend RLS CI job is `continue-on-error: true`

The `backend-rls` job (dual-role enforcement) is allowed to fail on landing while the
team triages individual cross-tenant test failures. **This flag MUST come off before M1.**

### TD14. The import engine is fail-closed and stubbed

`FEATURE_IMPORT_ENGINE_ENABLED=false` and `IMPORT_ENGINE_IMPLEMENTED=False` are both the
default; the production deploy contract refuses to boot with the flag ON until both flip.
`/api/imports/{id}/start` returns 503 with `feature_disabled` body until the engine
ships.

---

## 10. Migration history

`backend/alembic/versions/` holds **111 migrations** as of this baseline. The high-points
that future engineers must understand:

| Migration | What it locked in |
|---|---|
| `1278af39f621_initial_schema.py` | Base schema. Every later migration is an *additive* delta. |
| `3a9203795d07_rls_role_split.py` *(name approx — see file)* | The `gaahex_app` role contract that makes RLS engage. The deploy contract enforces this at boot. |
| `b70ef3b98e27_kernel_invariants_db_triggers_region_id.py` | **The most load-bearing migration in the repo.** Installs the append-only triggers on `event` + `audit_log` (per SPEC §0.4); adds region_id everywhere; lays down the kernel invariant guards. Reverting this is the architectural equivalent of unplugging the audit recorder. |
| `b5e8f1c2d3a4_spec_4_5_mandatory_approvals.py` | SPEC §4.5 mandatory-approval state machine (the customer_delete gate the killer test sibling exercises). |
| `7a4b1e9c2f08_spec_5_workflows.py` | SPEC §0.5 workflow_def shape — what the config-only entity transitions go through. |
| `85e76746332e_event_system_extension_d1.py` | D1 multi-tenant audit fields; reinforces append-only constraint. |
| `02b1e0fef42e_relationship_add_first_class.py`, `19da2573e24e_configuration_add_first_class.py`, `19f9f4bd6599_nav_registry.py` | Pattern for adding new tenant-scoped tables — each lands `tenant_id` + `RLS tenant_isolation`. Use these as templates. |
| `3a86ae0ed044_comment_hold_db_trigger.py` | DB-trigger pattern for "this constraint MUST hold even against a buggy migration". |

### Migration rules going forward

- Every migration that adds a tenant-scoped table MUST add the `RLS tenant_isolation` policy
  in the same migration. A two-step "table now, RLS next sprint" pattern is forbidden — the
  window in between is a silent leak.
- Migrations are **forward-only by intent**; downgrades exist as a safety net for catastrophic
  bugs, not for routine reversion. Every migration is reviewed against this baseline document.
- A migration that drops or weakens an audit trigger, an RLS policy, or the `gaahex_app`
  role contract is **forbidden** unless paired with a successor sealed baseline that justifies
  the relaxation.

---

## 11. Future M1/M2/M3 expansion rules

These are the rules every milestone after M0 must honor. The intent of M1/M2/M3 is to add
*real* product surface — ISP-domain entities, integrations, scale — *without* the platform
shape changing.

### M1 — Real ISP entity onboarding

**Goal:** the second tenant onboards onto the live platform with their real entities
(customer types, service types, lifecycle workflows, tariffs) defined entirely through
`/meta/entities` + `/meta/page-configs`.

**Rules:**

1. The killer test still passes. If M1's "real ISP customer model" requires a code change
   in `app/routers/records.py`, that's a thesis violation, not a feature.
2. Every M1 entity that ships pre-seeded (so a fresh deployment has it on day one) is
   defined in `app/seed.py` using the same `POST /meta/entities` data shape — not by
   model classes.
3. M1's NMS / NOC features compose the 5 engines; they don't add a 6th.
4. The `backend-rls` job's `continue-on-error` flag comes off before M1 ship.
5. Performance regressions on the M0 killer test (> 50% latency increase under M1 schema
   shape) gate the milestone.

### M2 — Multi-tenant onboarding flow

**Goal:** a non-engineer admin stands up tenant #N (region / org / data) through a UI flow
backed by the same `/meta/*` endpoints the killer test uses.

**Rules:**

1. The onboarding flow doesn't introduce a new SQL path that bypasses RLS. Every write
   passes through `gaahex_app`.
2. A new tenant's audit trail starts at the moment the tenant row is created — the
   onboarding act itself is the first event row.
3. Permission keys for the new tenant come from the same registry as built-in tenants. No
   per-tenant permission key naming.
4. The deploy contract gains a 6th check at this milestone: **a new tenant's first user
   MUST NOT be auto-granted super_admin scope unless explicitly opted-in by an existing
   super_admin.**
5. A killer test extension lands in M2: stand up a 2nd *tenant* (not just a 2nd entity)
   with two-tenant isolation proven across the same record shape.

### M3 — External integrations / marketplace

**Goal:** third-party integrations (payment gateways, billing aggregators, hardware vendor
APIs) bind to the platform through declarative integration definitions, not code.

**Rules:**

1. Every integration goes through the feature-gate contract: ON in production ⟹ real
   backend constructs at boot.
2. Webhook deliveries are events, signed with HMAC-SHA256, retried with exponential
   backoff. The webhook system already exists; M3 does not replace it.
3. External provider credentials are NEVER stored in `event` data. The audit row references
   a credential by id; the credential is in a separate, encrypted table with restricted RLS.
4. Marketplace integrations don't get to import `app.kernel.*`. They consume the platform
   through the same `/api/*` surface a tenant admin would.
5. The killer test at M3 extends to: stand up a 2nd integration with config alone — a
   webhook target, a payment gateway adapter, an OLT vendor driver. If "code change to add
   an integration" is the answer, the integration framework is wrong.

### Universal rules (apply at every milestone)

| Rule | Why |
|---|---|
| The 5 kernel engines stay 5. | [A2](#a2-five-engines-fixed). A 6th engine is a thesis change, not a feature. |
| Every tenant-scoped table has `tenant_id` + RLS policy from migration #1. | [I3](#i3-tenant-isolation-engages). Two-step adoption leaks. |
| Every mutation calls `workflow.emit(...)`. | [A7](#a7-every-mutation-emits-one-event). Holes in lineage compound silently. |
| Every new permission key is `object.action`, immutable post-release. | [I6](#i6-permission-keys-follow-objectaction-and-are-immutable). Permission renames break role grants. |
| Every new enum value is `UPPER_SNAKE_CASE`. | [I7](#i7-enum-values-are-upper_snake_case). Mixed casing on the wire is what causes integration grief. |
| Every CI job that gates production stays GREEN — no `continue-on-error` past triage. | [§5](#5-ci-enforcement). A flaky gate is a deferred regression. |
| Every successor sealed baseline links back to its predecessor and justifies every relaxation. | [I10](#i10-append-only-signoff-trail-for-sealed-baselines). The architecture trail itself is append-only. |

---

## Closing

This document is the seal. If you're about to merge a PR and you can't articulate which
extension point in [§8](#8-approved-extension-points) it falls under, **don't merge**.
If you're about to merge a PR that adjusts an invariant in [§3](#3-protected-invariants),
the right path is: open a successor baseline file, get architecture review on the
relaxation, *then* merge. The CI net catches mechanical drift; this document catches
conceptual drift.

The platform thesis is proven. The 5 engines are wired. The audit trail is sealed in
Postgres. The killer test runs on every push. Keep it that way.

— Ընգեր, 2026-06-05

---

## Successor baselines

Per I10, the architecture trail is append-only. As successor sealed baselines are
authored, they're linked here. This is the **one** edit channel this file accepts
after the seal — every other change opens a new file.

- **`SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md`** *(DRAFT SHELL — pending Phase 1.5 design review)* — addendum widening the WorkItem-movement engine's GXL vocabulary to support one-hop cross-record workflow guards. Status flips to SEALED when its §10 acceptance checklist completes.

## Resolved technical debt

The TD entries listed in §9 of this file are the original M0-staged TD inventory. As specific entries are resolved, they're noted here (cross-reference fix per I10 — the §9 list itself is not edited).

- **TD11 (D19 token registry double-definition)** — RESOLVED 2026-06-05 via Path A. `color-tokens.css` was adopted as the runtime-canonical source (all 39 per-theme divergent keys lifted into `gaahex-tokens.css`), then `color-tokens.css` was deleted. New HARD drift rule `D19 single token registry` prevents recurrence — `--gx-*` definitions outside `gaahex-tokens.css` fail CI. See `docs/audit/D19-TOKEN-REGISTRY-RECONCILIATION-PLAN.md`. Rendered look is byte-identical to pre-reconciliation; no visual change.
