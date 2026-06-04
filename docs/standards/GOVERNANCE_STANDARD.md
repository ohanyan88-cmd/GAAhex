# Governance Standard

**Status**: LOCKED · Phase 6 deliverable
**Owner**: Architecture / Platform
**Last updated**: 2026-06-04

How GAAhex's architecture-stabilization work is **prevented from un-doing
itself**. Every canonical / pattern / discipline introduced in Phases 1-5
needs a guard, or the codebase drifts back into the original mess within
two PRs.

This document is that guard.

---

## 1. The mechanism — `tools/check_drift.py`

A single Python script (stdlib-only — same discipline as
`backend/scripts/check_tenant_filter.py`) runs in CI on every push / PR.
Two kinds of rules:

* **HARD rules** — pattern match anywhere in scope = **immediate CI fail**.
  Used for canonicals that are 100% rolled out (no exceptions). Examples:
  - Local `def _deny(perm: str)` in any router (BL-10 closed; only the
    `_billing_shared` alias is allowed).
  - Direct `httpx.AsyncClient(...)` outside `app/utils/http_client.py`.
  - Local `const authH = (` in any TSX file.
  - `aria-pressed=` on `role="tab"` (TB-5 fixed; the rule prevents the
    next bug).
  - …see `tools/check_drift.py:HARD_RULES` for the full list.

* **RATCHET rules** — count must not INCREASE vs the baseline stored in
  `tools/check_drift_baseline.json`. Used for migration-tail items that
  are still incrementally cleaning up but where any net regression is the
  bad thing. Examples:
  - `let alive = true` blocks (DF-1/DF-2; baseline 54, Phase 5 target 0).
  - Raw `fetch(${BASE}/...)` calls in views (AC-2; baseline 60).
  - Raw `className="btn btn-..."` instances (Phase 5 Button target;
    baseline 428).
  - Raw `className="inp"` instances (Phase 5 Input target; baseline 6).
  - Views with `token: string` prop (SM-1; baseline 45).

When a count DECREASES (someone migrated a view), the script automatically
updates the baseline to the new lower number. The ratchet only goes down.

## 2. How to add a new rule

A new canonical lands in `frontend/src/lib/foo.ts`. To prevent a future
PR from rolling its own `foo`:

1. Identify the pattern that uniquely matches the local re-roll
   (`^function foo\(` or `^const foo = \(` is usually enough).
2. Open `tools/check_drift.py` and add a `HardRule(...)` entry to
   `HARD_RULES`. Set:
   - `name` — short ID (no spaces in the lookup key)
   - `description` — what the developer should do INSTEAD
   - `pattern` — regex or literal
   - `paths` — root directories to scan
   - `exclude` — files where the pattern is the canonical itself
3. Run `python tools/check_drift.py` locally. If it surfaces existing
   sites you didn't know about, FIX THEM in the same PR. The point is to
   ratchet only from a clean baseline.
4. If "fix them all" isn't realistic in one PR, add a `RatchetRule(...)`
   to `RATCHET_RULES` instead. The first CI run after the rule lands will
   establish the baseline.
5. Document the rule in the related standard (e.g.
   [[server-state-standard]] for fetch patterns).

## 3. How to LOWER a ratchet baseline

This is the normal case — a PR migrates 5 views off `let alive = true`.

1. Run `python tools/check_drift.py` locally; it will REPORT the new
   lower count and AUTO-UPDATE `check_drift_baseline.json`.
2. Commit the updated baseline file alongside the migration.
3. The next CI run uses the new floor; no further regression past that
   point is allowed.

## 4. How to bypass a hard rule (almost never)

If you genuinely need to bypass a hard rule for one site (a legacy
integration, a third-party shim, a temporary scaffold):

1. The rule should be **demoted to a ratchet** instead, OR
2. The specific file should be added to the rule's `exclude` list with
   a comment explaining why.

A `# noqa: <rule>` comment IS NOT recognized — that would be a flag for
"this lives forever," which is exactly what we're preventing. If you
need an exception, the exception itself should land in the rule
definition where future reviewers can see it.

## 5. The standards docs

Every architecture canonical introduced in Phases 1-5 has a locked
standards doc. The CI guard enforces the canonical; the doc explains
what / why / how.

| Phase | Standard | Covers |
|---|---|---|
| 2 | `API_CLIENT_STANDARD.md` | `lib/billing.ts`, `authH`, `bget`/`bpost`, the 401 contract, admin-vs-portal split |
| 2 | `AUTH_CONTEXT_STANDARD.md` | `AuthContext`, `useAuth()`, the 401 listener, token persistence |
| 2 | `SERVER_STATE_STANDARD.md` | `useFetch` / `useFetched`, alive-guard ban, mutation refetch |
| 2 | `OPENAPI_CODEGEN_STANDARD.md` | DF-8 direction, `openapi-typescript`, vertical-slice plan |
| 4 | `UI_PRIMITIVES_STANDARD.md` | `DetailTab`, `ModalFooterActions`, drawer/modal A11y contract |
| 5 | `TOKEN_MIGRATION_STANDARD.md` | D17/D18/D19, phantom tokens, breakpoint scale, migration patterns |
| 6 | `GOVERNANCE_STANDARD.md` | This doc — how the rules are wired |

## 6. CI integration

`.github/workflows/ci.yml` runs `tools/check_drift.py` in the backend
job, after the existing tenant-filter static analysis. Failure
modes:

* Hard rule violation → exit 1, CI red, PR blocked.
* Ratchet regression → exit 2, CI red, PR blocked.
* Pass → exit 0, baseline auto-updated for lowered counters; commit
  the new `check_drift_baseline.json` alongside the migration.

## 7. The escape hatch — `--update`

`python tools/check_drift.py --update` forces a baseline rewrite at the
current counts. Use this ONLY when:

* A new ratchet rule was added (the first run establishes the baseline
  automatically; `--update` is just for re-establishing if the file was
  deleted).
* A rule's regex was tightened / broadened and the baseline shape
  changed; the PR should explain why.

A PR that calls `--update` without one of those reasons is a regression
in disguise. Reviewers should treat it as such.
