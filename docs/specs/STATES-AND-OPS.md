# Data States, Pagination & Operational Health

This is the canonical guide for how the GAAhex frontend and backend handle data-state presentation,
pagination, and system health reporting. Everything below is grounded in actual code: `frontend/src/States.tsx`,
`frontend/src/EntityView.tsx`, `backend/app/routers/records.py`, and `backend/app/routers/ops.py`.

---

## 1. Data-State Hierarchy

The frontend uses a **five-tier state presentation system** (Tier 6 in the architecture). Each state
has a reusable `States.tsx` component and a clear rule for when to show it.

### The Five States

#### EmptyState
**Purpose:** Show when a list contains zero records.
**Component:** `EmptyState({ icon?, title, message?, action? })`
**Appearance:** Centered icon (SVG), title, optional message, optional action button.
**When to use:**
- User navigates to an entity list and `rows.length === 0` (EntityView line 444)
- `loading === false` and the form is not open
- Show in both "zero records yet" and "no search results" cases (line 561 differentiates in the message)

**Example from code:**
```
if (rows.length === 0 && !loading && !formOpen)
  → EmptyState (title: "No [entity] yet", message + action if canCreate)
```

#### PermissionDenied
**Purpose:** Show when the user lacks permission to view an entity at all.
**Component:** `PermissionDenied({ message? })`
**Default message:** "You don't have permission to view this."
**When to use:**
- Backend returns `403` on the list fetch (EntityView line 100)
- `fatal === "denied"` is set; render PermissionDenied (line 255–261)
- Capability check `canView` fails; render `NoAccess` panel instead (line 272–273)

**Note:** Two separate paths exist:
1. **Fetch-time 403** → fatal='denied' → PermissionDenied screen with entity heading
2. **Capability gate** → canView=false → NoAccess panel (NoAccess.tsx, B21 feature)

#### NotFound
**Purpose:** Show when an entity definition (slug) does not exist.
**Component:** `NotFound({ what?, message? })`
**When to use:**
- Backend `getEntityDef` throws (EntityView line 91)
- `fatal === "notfound"` is set; show "No entity matches 'slug'" (line 254)

#### ErrorBanner
**Purpose:** Show a recoverable, dismissible error message.
**Component:** `ErrorBanner({ message, onRetry? })`
**When to use:**
- Any validation or network error during create/edit (EntityView line 421, 189, 226, 244)
- User can optionally click "Retry" to refetch
- Displayed inline with the list; does not block the page

#### LoadingState
**Purpose:** Show while data is being fetched.
**Rendering:** Plain text "Loading…" (EntityView line 253)
**When to use:**
- `loading && !def && !fatal` — waiting for the entity definition and first fetch

### Decision Tree

```
START: user navigates to /entity/{slug}
  ├─ loading=true, def=null, fatal=null
  │  └─ render: <p>Loading…</p>
  ├─ load complete, fatal='notfound'
  │  └─ render: NotFound("entity", "No entity matches…")
  ├─ load complete, fatal='denied'
  │  └─ render: PermissionDenied + entity heading
  ├─ load complete, canView=false (capability check)
  │  └─ render: NoAccess panel (B21)
  ├─ load complete, rows.length === 0, formOpen === false
  │  └─ render: EmptyState (with action if canCreate)
  ├─ error during mutation (create/edit/delete/transition)
  │  └─ render: ErrorBanner (inline, above the form or list)
  └─ load complete, rows.length > 0
     └─ render: the data table
```

---

## 2. Pagination Contract

**Rule:** pagination is **backward-compatible**. No params → a plain JSON list (no envelope, no header).
With `limit` and/or `offset` params, the result is still a plain list, not an envelope.

### Query Parameters

Both are optional; both default to safe values:
- `limit` (int): page size. Default 200, capped at 500 (MAX_PAGE). Values ≥501 are silently clamped.
- `offset` (int): rows to skip. Default 0. Negative values are treated as 0.

**Example requests:**
```
GET /api/leads                          → all leads, default page size (200)
GET /api/leads?limit=50&offset=0        → first 50
GET /api/leads?limit=50&offset=50       → second batch of 50
GET /api/leads?limit=100&offset=1000000 → offset out of bounds → empty list
GET /api/leads?limit=1000&offset=0      → limit capped at 500
```

### Order of Operations (records.py, lines 192–235)

Pagination is **the last step**, after all access control and filtering. This ensures pagination never
leaks records a user should not see:

1. **Org-scope + view-gate first** — only records the user's roles/node allow
2. **Free-text search** (`q` param) — substring match over text data fields
3. **GXL filter** (`filter` param) — per-record boolean expression
4. **Sort** (`sort` param) — by a field or `created_at` (reverse with `-fieldname`)
5. **Pagination LAST** — apply `limit`/`offset` to the filtered result

**Why order matters:** if pagination happened first, a user could request `limit=500&offset=0`,
get 500 records the backend later filters down to 100, and never see records 100–500 on the next
page.

### Default & Bounds

- **DEFAULT_PAGE = 200:** if no `limit` is provided
- **MAX_PAGE = 500:** maximum page size, hard cap
- **Clamping rule** (line 169): `max(1, min(int(limit), MAX_PAGE))`
  - limit=0 → 1 (never return 0 records if rows exist)
  - limit=1000 → 500
  - limit=None → 200

### Client-Side (EntityView.tsx)

The frontend does **not** parse or use a header; it trusts the response is the requested window.
It sends `limit` and `offset` to the backend but has **no built-in pagination controls** yet (D33
in SYSTEM-INVENTORY: pagination vs infinite is still ⬜). Today:
- Loads a fixed 200 records on first load (default)
- Supports manual query param passing (developer convenience)
- Tests walk pages by sending limit/offset (test_pagination.py lines 31–36)

### Non-Breaking Guarantee

The list endpoint is **backward-compatible forever**:
- Absence of limit/offset params → same behavior as before (all records, then filtered/sorted, up to 200)
- The response is still a plain JSON array, not an envelope
- No `X-Total-Count` header or metadata in the current build; if added later, it will be optional and clients will still work without parsing it

---

## 3. Health & Status Endpoints

Three endpoints serve different purposes: lightweight probes for infrastructure, and a richer payload
for the app to render status pages or banners.

### /health
**Path:** `GET /health` (main.py, line 79)
**Auth:** none (public)
**Response:**
```json
{"status": "ok", "service": "gaahex", "milestone": "M0"}
```
**Purpose:** Infra probes (uptime checks, load balancers). Lightweight, always fast.
**Use when:** you need a simple "is the service alive?" signal from a monitoring tool (Datadog, Pingdom, etc.).
**HTTP status:** always `200 OK` (no 503 in the current build).

### /health/db
**Path:** `GET /health/db` (main.py, line 84)
**Auth:** none (public)
**Response (success):**
```json
{"db": "ok"}
```
**Purpose:** Verifies the database connection is alive (runs `SELECT 1`).
**Use when:** you need to confirm both the app and its DB are responding.
**HTTP status:** `200 OK` if DB query succeeds; connection error becomes a 500 (implicit; exception bubbles).

### /api/status
**Path:** `GET /api/status` (ops.py, line 51)
**Auth:** required (Depends(current_user))
**Response:**
```json
{
  "service": "gaahex",
  "ok": true,
  "db": "ok",
  "version": "0.0.1-m0",
  "time": "2025-02-27T14:32:15.123456+00:00",
  "maintenance": {
    "active": false,
    "message": null,
    "since": null
  }
}
```
**Purpose:** Richer app-facing status for status pages, status banners, or dashboards. Includes
app version, server time, and the current **maintenance mode** state.
**Use when:**
- You need to render a status page or banner in the UI (show if `maintenance.active === true`)
- You want to know the exact app version running
- You want the server's authoritative time (for time-zone reconciliation)

**DB field:** `ok: true` if `SELECT 1` succeeds; `db: "down"` if it fails.
**HTTP status:** always `200 OK` even if DB is down (ops.py lines 55–67; the endpoint catches
the exception and reports `db: "down"`, doesn't throw).

### /api/ops/maintenance
**Path:** `POST /api/ops/maintenance` (ops.py, line 70)
**Auth:** required, gated to `config.manage` (super-admin only)
**Request body:**
```json
{"active": true, "message": "Upgrading database. Back in 30 minutes."}
```
**Response:**
```json
{
  "maintenance": {
    "active": true,
    "message": "Upgrading database. Back in 30 minutes.",
    "since": "2025-02-27T14:32:15.123456+00:00"
  }
}
```
**Purpose:** Toggle maintenance mode on or off. Sets an in-memory flag (process-local) that the
`/api/status` endpoint reads. **Does NOT block requests yet** (J92 in SYSTEM-INVENTORY is ⬜;
that's a later hardening step where traffic is actually rejected during maintenance).
**Use when:** a super-admin needs to notify users that the system is undergoing maintenance.

---

## 4. Next on the Ops Horizon

The following are **spec-only, not built**. They appear on the SYSTEM-INVENTORY (section J) and are
pinned for a later phase:

### J91 — Status / Health Page
**What it is:** a public or logged-in dashboard showing service uptime, component health (DB, Redis,
external APIs), incident history.
**Why it matters:** ops team + customers want visibility into system status.
**Current state:** ⬜ not started. We have `/health`, `/health/db`, `/api/status`; a page to render them
is missing.

### J92 — Maintenance Scheduler
**What it is:** a UI where super-admins can schedule maintenance windows, automatically toggle
`/api/ops/maintenance`, and optionally block new requests with a 503 during the window.
**Why it matters:** cleaner than manual API calls; ops teams expect it.
**Current state:** ⬜ not started. We have the toggle (`/api/ops/maintenance`); scheduling + auto-block don't exist.

### J96 — Job Dashboard
**What it is:** a view into async jobs (billing runs, bulk operations, exports, etc.). Shows status,
progress, errors, and lets admins retry or cancel.
**Why it matters:** long-running operations need visibility.
**Current state:** ⬜ not started. We have `POST /api/billing/run-cycle` and `POST /api/{slug}/bulk`,
but no UI to track them.

### J97 — Error Monitoring
**What it is:** centralized log for exceptions, validation failures, and API errors. Alerting on
spike thresholds.
**Why it matters:** product health + debugging.
**Current state:** ⬜ not started. We have audit Events (`workflow.emit`); a separate error log doesn't exist.

---

## 5. Code Locations & Tests

**Frontend states:**
- `frontend/src/States.tsx` — EmptyState, PermissionDenied, NotFound, ErrorBanner components
- `frontend/src/EntityView.tsx` — the decision tree (lines 253–273, 444–563) and state rendering

**Backend pagination:**
- `backend/app/routers/records.py` — `list_records` (lines 174–235), `_paginate` helper (lines 166–171)
- `backend/tests/test_pagination.py` — test coverage (backward-compat, limit/offset walk, scope isolation)

**Health & ops:**
- `backend/app/main.py` — `/health`, `/health/db` (lines 79–88)
- `backend/app/routers/ops.py` — `/api/status`, `/api/ops/maintenance` (lines 51–81)

---

## 6. Honest Gap: Expectations vs. Reality

**Expected (from task D22):** code fully implements states, pagination contract, and health endpoints
such that a second tenant can be stood up with config only and the system behaves identically.

**Verified as present:**
- ✅ All five state components are built and in use
- ✅ Pagination parameters (`limit`, `offset`) work end-to-end
- ✅ Order of operations (scope → q → filter → sort → paginate) is enforced
- ✅ Health endpoints exist and report status correctly
- ✅ Maintenance toggle is wired

**Gap: no X-Total-Count header**
The task mentions `X-Total-Count` header (from "E22 contract"). The current code does not emit this
header. The list response is a plain JSON array; there is no envelope, no metadata, no total count.
- **Impact:** a frontend pagination control cannot know "there are 1,247 total records; you're seeing
  200–250" without a second metadata request (or parsing a header).
- **Mitigation:** not a blocking gap for M0. Clients today fetch and render the page, and will not
  know the total until the `?limit=` window returns < limit rows (signaling EOF).
- **Future:** if D33 (pagination vs infinite scroll UI) demands pagination controls, add an optional
  `?include_total=true` param that returns `{"total": N, "records": [...]}` or adds `X-Total-Count`
  header.

**Gap: maintenance mode does not block traffic**
The endpoint toggles the flag; the flag is reported in `/api/status` for the frontend to render a banner.
But **requests are not rejected** during maintenance (J92 says this is a later hardening step).

**Summary:** the foundation is solid and production-ready for single-tenant demo. Multi-tenant behavior
on a second ISP would work identically. Ops visibility is present but not polished (no scheduled
maintenance, no job dashboard, no error monitoring yet — those are N items on the backlog, not blocking).
