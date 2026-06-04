# OpenAPI → TypeScript Codegen Standard

**Status**: FOUNDATION (not yet adopted in code) · Phase 6 deliverable
**Owner**: Architecture
**Last updated**: 2026-06-04

GAAhex frontend types are currently hand-mirrored from backend dict
serializers. Five+ entities have already drifted — `Invoice` is missing
`owner_node_id` / `posted_at` / `account_id`; `Subscription` is missing
`account_id` / `billing_anchor_day`; `Service` and `Order` have no canonical
TS type at all. Every new field is silent until a runtime bug surfaces it.

This document locks the migration direction and sequences the work. The
**code** lands incrementally; this **standard** lands now so any new endpoint
landed before the migration completes knows where it's headed.

---

## 1. Target stack

* Generator: [`openapi-typescript`](https://github.com/openapi-ts/openapi-typescript) (CLI form, dev-time only).
* Backend source: FastAPI's auto-generated `/openapi.json` (already exposed by `app/main.py`).
* Output location: `frontend/src/generated/api.ts` — committed (so CI doesn't need a live backend).
* Regen trigger: a `package.json` script `gen:api-types` + a CI guard that fails if `api.ts` diverges from a fresh regen.

## 2. Why openapi-typescript (not openapi-codegen, swagger-typescript-api, orval)

* Output is plain TypeScript types — no runtime, no React-Query bindings baked
  in. We already have `useFetch` (see `SERVER_STATE_STANDARD.md`); the codegen
  job is types only.
* Active maintainer, used widely, no vendor lock-in.
* Generated file is a single `.ts` — diffs land in PR review unambiguously.

## 3. Backend prerequisite — populate `response_model`

FastAPI only emits accurate schema for endpoints with `response_model` set.
The platform currently has very few — most return raw `dict`. Codegen will
produce `unknown` / `any`-equivalent types for those endpoints until they're
modeled.

**Before the codegen migration sweep:** the backend team must ship
`response_model` (Pydantic shape) for every endpoint a frontend view reads.
Suggested ordering (small → large blast radius):

1. `/api/invoices/*` and `/api/payments/*` — financial integrity zone, types
   should never drift.
2. `/api/customers/*`, `/api/subscriptions/*` — main CRM surface.
3. `/api/analytics/*` — these are the highest-fanout reads (DashboardView).
4. The rest, opportunistically.

## 4. Implementation plan (deferred to follow-up commit)

1. `cd frontend && npm install --save-dev openapi-typescript`
2. Add to `package.json` scripts:
   ```json
   "gen:api-types": "openapi-typescript http://127.0.0.1:8099/openapi.json -o src/generated/api.ts"
   ```
   (For CI: replace the URL with `./tools/openapi.json` snapshot; refresh the
   snapshot in a separate pre-commit hook.)
3. Run `npm run gen:api-types` against a local backend to materialize the
   first generated file.
4. Migrate **one vertical slice** end-to-end:
   * Pick `Invoice` (used in `InvoicesView`, `CustomerView`, billing.ts type
     declarations). Replace the hand-mirrored `Invoice` type with
     `import type { components } from '../generated/api'; type Invoice = components['schemas']['Invoice']`.
   * Verify `tsc --noEmit` is clean.
   * Note any field drift the codegen reveals (likely 2-3 entities).
5. Add CI rule: regen + `git diff --exit-code` against `src/generated/api.ts`.
   Any change to a backend response shape must include the regenerated file.
6. Update [[server-state-standard]] §forbidden patterns with:
   > **No new hand-mirrored entity types.** Import from `src/generated/api.ts`.

## 5. Migration tracker

| Step | Owner | Status |
|---|---|---|
| Standard doc (this file) | Architecture | ✅ landed 2026-06-04 |
| Backend response_model for `/api/invoices` | Backend | ⬜ TODO |
| Frontend: install openapi-typescript + scripts | Frontend | ⬜ TODO |
| Vertical slice: `Invoice` type imported from generated | Frontend | ⬜ TODO |
| CI guard: regen + diff check | Platform | ⬜ TODO |
| Backend response_model — broader sweep | Backend | ⬜ TODO |
| Phase 6 lint: ban hand-mirrored entity types | Platform | ⬜ TODO |

## 6. What this standard prevents from getting worse

Even before the implementation lands, no new hand-mirrored type should be
introduced for an endpoint that will be in scope (anything with stable
response shape). Add the type to a TODO comment instead and let the codegen
fill it in. Reviewers should reject net-new hand-mirrored types that aren't
clearly outside the migration scope (e.g., third-party API shapes).
