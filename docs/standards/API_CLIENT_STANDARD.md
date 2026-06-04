# API Client Standard

**Status**: LOCKED · Phase 6 deliverable from `senior enterprise architect.txt`
**Owner**: Architecture / Frontend
**Last updated**: 2026-06-04

This document is the single source of truth for how GAAhex frontend code talks
to the backend. It supersedes any per-view convention.

---

## 1. Canonical client modules

| Surface | Module | Responsibility |
|---|---|---|
| **Admin SPA** | `frontend/src/lib/billing.ts` | Exports `BASE`, `authH`, `bget`, `bpost`, `bpatch`, `bput`, `bdel`, `openDocument`, plus the `gaahex:auth-401` event symbol. Every admin fetch goes through these. |
| **Customer portal SPA** | `frontend-portal/src/lib/api.ts` | Standalone portal client with localStorage-backed bearer token (transitioning to HttpOnly cookie + CSRF per Stage-2 production cert — see `docs/audit/PRODUCTION-REMEDIATION-STAGE-2-PLAN-2026-06-04.md`). |

The two surfaces are intentionally separate today (different auth persistence,
different deploy targets). A shared `@gaahex/http-client` package may
consolidate them in a later phase; until then, both modules document their
divergence here.

## 2. Forbidden patterns (will be lint-blocked in Phase 6)

* **No private `authH` factories** in views, components, studio panes, or sibling lib files. Import `authH` from `lib/billing` (admin) or rely on `req()` (portal).
* **No raw `fetch(${BASE}/...)`** outside the canonical client modules. Use `bget` / `bpost` / `bpatch` / `bput` / `bdel`. Document any exception with a 1-line `// eslint-disable-...` justifying why the wrapper can't be used.
* **No `localStorage.getItem('admin-token')`** — the admin app deliberately keeps the token in React state only (see §4 below).
* **No per-view 401 handling** — the canonical client emits `gaahex:auth-401` and `App.tsx` (or its successor `AuthContext`) is the only listener.

## 3. The 401 contract (AC-3)

`bget` and the internal `send` wrapper both call `intercept401(status)` after
every response. When `status === 401`:

```ts
window.dispatchEvent(new CustomEvent('gaahex:auth-401'))
```

`App.tsx` registers a `useEffect` listener that clears every piece of auth
state (`token`, `user`, `entities`, `capabilities`, `view`) and resets the UI
to the login screen. No hard reload — the admin SPA owns its login route via
React state, and a `window.location.href = '/login'` would lose in-flight UX
context.

The event symbol is exported as `AUTH_401_EVENT` so tests and future
`AuthContext` listeners can subscribe by name rather than string literal.

## 4. Admin token persistence — deliberate split from portal (SM-3 / AC-4)

| Aspect | Admin SPA | Portal SPA |
|---|---|---|
| Storage | React state (`useState` in `App.tsx`) | `localStorage` (`gaahex-portal-token`) |
| Persists across page refresh | **No** — token cleared on F5; user re-authenticates | Yes |
| Persists across browser close | No (state is in-memory) | Yes (localStorage) |
| 401 handling | Dispatches `gaahex:auth-401`; React clears state | `clearToken()` + `window.location.href = '/login'` |
| Stage-2 production target | unchanged — admin operators tolerate re-login on refresh | HttpOnly cookie + CSRF (PORTAL_AUTH_MODE=cookie) |

**Why the split is intentional:**

* The admin SPA serves an internal operator audience that runs the app in one
  long browser session. Forcing re-auth on refresh is a thin **defense in
  depth** layer against stolen tokens — the token never lives in storage where
  a malicious extension can read it.
* The portal SPA serves end customers who expect "remember me" behavior across
  visits. localStorage was the M0 baseline; the Stage-2 cookie/CSRF migration
  is the right long-term path for customer browsers.

**When this might converge:** if/when the admin SPA gains an in-browser
"session resume" requirement, the cleanest target is HttpOnly cookie with
SameSite=Strict + CSRF echo — never localStorage. Until then, keep the split
and document it (this file).

## 5. Feature-flag tiers — boot vs runtime (SM-4)

The platform has **two independent feature-flag systems**, deliberately
non-bridged:

| Tier | Where | Purpose | Scope |
|---|---|---|---|
| **Boot kill-switch** | `backend/app/config.py:133–136` (`feature_radius_required`, `feature_olt_provisioning_required`, etc.) | Hard infra guard: "this capability must be reachable at startup or the process refuses to serve". Read once at lifespan; immutable after boot. | Whole tenant, all sessions. |
| **DB runtime flag** | `feature_flag` table; surfaced via `GET /api/feature-flags` and `frontend/src/lib/useFlag.ts:66` | Soft tenant UX switch: "show this Studio pane to admins" or "expose this beta widget to role X". Mutable via admin UI; takes effect on next render. | Per-tenant, per-role-scope. |

**Why not one bridge:**

* Boot flags answer "is the platform allowed to run this feature at all?" —
  the answer is the same for every user in the cluster and the cost of getting
  it wrong is downtime, not UX confusion.
* DB flags answer "should we show this widget to this user right now?" — the
  answer varies per user, per role, per tenant, and the cost of getting it
  wrong is a confused operator.

**Cross-check on startup:** `main.py:lifespan` reads boot flags and logs the
active set. A DB flag whose corresponding boot flag is disabled is **not**
auto-disabled — by design, because the DB flag may be a Studio toggle that
intentionally references a feature still being staged. Operators are expected
to read the startup log and align DB flags with their boot config.

## 6. Adding new endpoints — checklist

1. Backend: define the route; if it returns a non-trivial body, set `response_model` so it shows up in the generated OpenAPI schema (DF-8 — codegen target).
2. Frontend: extend `lib/billing.ts` with a domain-specific helper (e.g., `loadOrders(token)`) that wraps `bget` — do **not** call `bget` directly from a view if the same call appears in 2+ places.
3. Add the TS return type to the domain `.ts` file as a hand-mirrored shape **until DF-8 lands codegen**; mark it `// TODO codegen` so the migration sweep finds it.
4. Permission constants (PC-3 — Phase 3) — once `frontend/src/generated/permissions.ts` exists, never type a permission string literal in a component.

## 7. Migration tracker

* AC-1 — 32 view files dedupe'd 2026-06-04 (commit 5b9b546)
* AC-3 — 401 intercept landed 2026-06-04 (commit 5b9b546)
* AC-5 — backend httpx factory landed 2026-06-04 (commit 5b9b546)
* SM-2 — 5 redundant `fetchCapabilities` removed 2026-06-04 (commit 5b9b546)
* AC-2 — 57 raw `fetch()` calls in 18 views — deferred to DF-1/DF-2 useFetch wave
* SM-1 — token prop-drilling to 55+ views — deferred to DF-1/DF-2 wave (AuthContext refactor)
* DF-8 — OpenAPI → TS codegen — Phase 2 scaffolding TODO
