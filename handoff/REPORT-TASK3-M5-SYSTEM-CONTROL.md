# Task 3 — Module 5 (System Control) — Completion Report

**Branch:** main · **Commits:** `10c174c` (content) + `0a383e1` (marker) · **Date:** 2026-05-31
**Backend:** http://127.0.0.1:8099 · **Login:** admin@demo.isp / admin123

---

## Summary

3 of System Control's leaves wired. All 5 Studio modules are now complete.

| Leaf (actual id) | Source pane | Status |
|---|---|---|
| `release.feature-flags` | `FeatureFlagsPane` (existing rich pane, extended with DELETE) | ✅ |
| `governance.audit-logs` | `AuditLogPane.tsx` (NEW) | ✅ |
| `system-control.system-health` | `SystemHealthPane.tsx` (NEW) | ✅ |
| Maintenance Mode, Caching, Background Jobs, Schedulers, Environment, Configuration, etc. | — | 🚫 Not yet wired (intentional) |

Note: `Feature Flags` lives under **Release** group, `Audit Logs` under **Governance**, only `System Health` is in **System Control** per `tree.ts`. Wired by actual leaf IDs.

---

## Leaf 1 — Feature Flags (`release.feature-flags`)

**File:** `frontend/src/studio/StudioRichPanes.tsx:FeatureFlagsPane` (existing, extended)
**Extension:** Added DELETE column (red Trash2 icon + `window.confirm` + optimistic update + revert on failure) — the backend supported it, the pane was missing it.

### Widget → data source

| Widget | Real source |
|---|---|
| List table (key/label/enabled/role_scope) | `GET /api/feature-flags` |
| Enabled toggle | optimistic `PATCH /api/feature-flags/{id}` `{enabled}` |
| Role-scope pill | row data |
| Trash icon (per row) | confirm dialog → `DELETE /api/feature-flags/{id}` (204) |

### Button → action

| Button | Real action | Status |
|---|---|---|
| New flag | open inline create form | ✅ |
| Create | `POST /api/feature-flags {key, label, role_scope}` | ✅ 201 |
| Enabled toggle | `PATCH /api/feature-flags/{id}` `{enabled}` | ✅ 200 with revert-on-error |
| Delete | `DELETE /api/feature-flags/{id}` | ✅ 204 with confirm |

---

## Leaf 2 — Audit Logs (`governance.audit-logs`)

**File:** `frontend/src/studio/AuditLogPane.tsx` (NEW, +462 LOC)

### Widget → data source

| Widget | Real source |
|---|---|
| Event-type dropdown | `GET /api/events/types` (fallback list if 403/404) |
| Entity / actor / since / until inputs | local state |
| Audit table rows | `GET /api/audit-log?...&limit=50&offset=N` |
| Actor cell | `actor_name` (server left-join) or `actor_user_id` short or "system" |
| Type pill | mapped variant from `event_type` |
| Expansion payload | event `data` JSON (key:value diff list) |
| "X of Y events" counter | server `total` |

### Button → action

| Button | Real action |
|---|---|
| Apply | re-fetch with applied filters at `offset=0` |
| Clear | reset all filters and re-fetch |
| Refresh | re-fetch with current filters at `offset=0` |
| Row click / chevron | toggle payload expand |
| Load more | `GET /api/audit-log?...&offset={items.length}` |

### Non-negotiables

- [x] Real data only — `/api/audit-log` is the SPEC §0.4 append-only feed
- [x] `PermissionDenied` on 403; `ErrorBanner` with retry on other errors
- [x] `SkeletonRows` on initial load; `EmptyState` when no events match
- [x] Pagination via offset/limit + "Load more"

---

## Leaf 3 — System Health (`system-control.system-health`)

**File:** `frontend/src/studio/SystemHealthPane.tsx` (NEW, +444 LOC)

### Widget → data source

| Widget | Real source |
|---|---|
| Headline pill | worst-of (liveness/readiness/status) variants |
| KPI: Uptime | `/api/health/status.uptime_seconds` (formatted) |
| KPI: Tenants/Users/Records | `/api/health/status.counts.*` |
| Liveness panel | `GET /api/health` (status / version) |
| Readiness panel | `GET /api/health/ready` (db boolean + error) |
| Operational Status panel | `GET /api/health/status` (service / version / uptime / db_error) |
| Last-checked timestamps | local `Date.now()` per probe |

### Button → action

| Button | Real action |
|---|---|
| Auto-refresh checkbox | enable/disable 30s interval |
| Refresh all | trigger all 3 probes immediately |
| Per-panel refresh icon | trigger one probe immediately |

### Honest probe behavior

- 5xx response → panel surfaces as `DEGRADED` (not faked OK)
- Network failure → panel surfaces as `CRITICAL`
- KPI strip only renders when `/api/health/status` returns OK (hide-if-missing)

---

## Registry (StudioGenericPane.tsx)

```ts
'release.feature-flags':         FeatureFlagsPane,
'governance.audit-logs':         AuditLogPane,
'system-control.system-health':  SystemHealthPane,
```

---

## Screenshots (12 total)

`screenshots/sc_NN_*.png`:
- `sc_01_feature_flags_list_dark.png` — list with Delete column
- `sc_02_feature_flags_create_modal_dark.png` — inline create form
- `sc_03_feature_flags_toggle_dark.png` — toggle interaction
- `sc_04_audit_logs_table_dark.png` — filter bar + table (empty per demo seed)
- `sc_05_audit_logs_payload_expanded_dark.png`
- `sc_06_audit_logs_filtered_dark.png` — `create` filter applied
- `sc_07_system_health_dashboard_dark.png` — 3 panels OPERATIONAL + KPI strip (6h 43m uptime, 4 tenants, 6 users, 89 records)
- `sc_08_system_health_refreshed_dark.png`
- `sc_09_unwired_not_wired_dark.png` — Maintenance Mode shows "Not yet wired" (intentional)
- `sc_10_feature_flags_list_light.png` — light theme replay
- `sc_11_audit_logs_table_light.png`
- `sc_12_system_health_dashboard_light.png`

---

## Verification gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 new errors |
| Playwright `verify_system_control_module.js` | clean — 12 screenshots produced |
| Backend `:8099` / Frontend `:5173` | both 200 OK |

---

## What's NOT done (intentional)

- **Other System Control leaves** (Maintenance Mode, Caching, Background Jobs, Schedulers, Environment, Configuration) — left on "Not yet wired" per M5 scope
- **Metrics endpoint optional probes** (CPU/memory/request rate) — `backend/app/routers/health.py` doesn't expose them; SPEC marks optional. Counts from `/api/health/status` cover the headline need.
- **Audit log table is empty in screenshots** — demo seed has zero audit events for the admin tenant. Honest hide-if-missing is intentional; no mock fallback.

---

## Commit messaging snag (transparency)

Commit `10c174c` carries the file diff but its message says `fix(nav): rewrite static fallback…` — another agent's `git add -A` swept the Module 5 staged files into that commit mid-flight. The empty marker `0a383e1` carries the proper Module 5 attribution. Content is correct.

---

## Doctrine compliance

- ✅ Real data only — no mock; hide-if-missing throughout
- ✅ Shared components: `StatusPill`, `KPITile`, `EmptyState`, `PermissionDenied`, `SkeletonRows`, `ErrorBanner`
- ✅ DELETE old code — FeatureFlagsPane extended in place (no fork)
- ✅ Server-side gate inherited: `/api/feature-flags` writes use `_require_config_manage`; `/api/audit-log` is admin-scoped; health probes are appropriately public/auth-gated
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ No emoji; lucide-react icons only
- ✅ Unwired leaves stay on honest "Not yet wired"

---

**Status:** Module 5 System Control ✅ complete. **All 5 Studio modules now done** (Security · Data · Notifications · Developer · System Control).
