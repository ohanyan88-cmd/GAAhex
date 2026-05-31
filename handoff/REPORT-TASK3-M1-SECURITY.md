# Task 3 — Module 1 (Security) — Completion Report

**Branch:** main · **Commit:** `636652b` · **Date:** 2026-05-31
**Backend:** http://127.0.0.1:8099 · **Login:** admin@demo.isp / admin123

---

## Summary

3 of 17 Security leaves wired to the real RBAC kernel.
The other 14 stay on the honest "Not yet wired" empty state.

| Leaf | viewType / id | Status |
|---|---|---|
| Roles | `security.roles` | ✅ wired (`RolesPane.tsx`) |
| Permissions | RICH_PANE label `Permissions` | ✅ wired (`StudioRichPanes.tsx:1029`) |
| Users | `security.users` (NEW) | ✅ wired (`UsersPane.tsx`) |
| Policies, Authentication, Authorization, MFA, SSO, OAuth, Session Policies, Password Policies, Secrets Vault, Encryption, Certificates, IP Restrictions, Geo Restrictions, Device Trust, Threat Detection | — | 🚫 Not yet wired (intentional) |

---

## Leaf 1 — Roles

**File:** `frontend/src/studio/RolesPane.tsx` · **Backend:** `backend/app/routers/roles.py`

### Widget → data source

| Widget | Real source | Status | Evidence |
|---|---|---|---|
| Roles list | `GET /api/roles` | ✅ | 200, 3 roles (super_admin, manager, sales_agent) with permission counts |
| Permissions catalog | `GET /api/permissions` | ✅ | 200, ~31 permission keys grouped by entity |
| Permission matrix | join of the two | ✅ | renders real cells |

### Button → action

| Button | Real action | Status | Evidence |
|---|---|---|---|
| New role | `POST /api/roles` | ✅ | 201, audit `create role_def` emitted |
| Save role (perms) | `PATCH /api/roles/{id}` | ✅ | 200, audit `update role_def` emitted |
| Delete role | `DELETE /api/roles/{id}` | ✅ | 204, audit `delete role_def` emitted |

### Non-negotiables

- [x] Real data only — no mock/fake/hardcoded
- [x] Loading / error / 403 / empty states implemented
- [x] Zero inert buttons
- [x] Server-side gate: `config.manage` via `_require_config_manage()`
- [x] Audit events via `workflow.emit` (added this module — was missing before)

### Screenshot

`screenshots/sec_01_roles.png` — 3 roles with real permission counts.

---

## Leaf 2 — Permissions

**File:** `frontend/src/studio/StudioRichPanes.tsx` (`Permissions` rich pane, line 1029)

### Widget → data source

| Widget | Real source | Status | Evidence |
|---|---|---|---|
| Roles columns | `GET /api/roles` | ✅ | 200, 3 roles |
| Permission rows | `GET /api/permissions` | ✅ | 200, ~31 perms grouped |
| Cell state (granted/—) | derived from `role.permissions[]` | ✅ | matches role payload |

### Button → action

| Button / control | Real action | Status | Evidence |
|---|---|---|---|
| Cell click (toggle) | optimistic `PATCH /api/roles/{id}` | ✅ | 200 on success; revert + error on failure |

### Non-negotiables

- [x] Real data only
- [x] Loading / error / 403 / empty states
- [x] Zero inert controls
- [x] Server-side gate: `config.manage`
- [x] Optimistic UI with rollback on PATCH failure

### Screenshot

`screenshots/sec_02_permissions.png` — full Edit / View / — matrix across Manager, Sales Agent, Super Admin.

---

## Leaf 3 — Users (NEW)

**File:** `frontend/src/studio/UsersPane.tsx` (NEW, ~795 LOC)
**Backend:** `backend/app/routers/users.py` (extended) + `backend/app/routers/assignments.py` (NEW)
**Tree:** `frontend/src/studio/tree.ts` (`'Users'` added to Security group)
**Registration:** `'security.users': UsersPane` in `REAL_PANE_BY_LEAF_ID`

### Widget → data source

| Widget | Real source | Status | Evidence |
|---|---|---|---|
| Users list | `GET /api/users` | ✅ | 200, 3 users (admin, agent, soft-deleted test) |
| Role chips per row | denormalized `assignments[]` in GET serializer | ✅ | each chip shows role label + node code |
| ACTIVE / INACTIVE pill | `status` field | ✅ | inactive = soft-deleted users |
| Detail drawer assignments | `GET /api/assignments?user_id=` | ✅ | 200, tenant-scoped list |
| Primary node label | resolved via `org_nodes` | ✅ | shown as e.g. "Demo ISP Group grp" |

### Button → action

| Button | Real action | Status | Evidence |
|---|---|---|---|
| + Add user | `POST /api/users` | ✅ | 201; duplicate email → 409; non-superadmin → 403 |
| Edit user (save) | `PATCH /api/users/{id}` | ✅ | 200; audit `update app_user` |
| Delete user | `DELETE /api/users/{id}` (soft, `status='inactive'`) | ✅ | 204; self-delete → 422; audit emitted |
| + Add role assignment | `POST /api/assignments` | ✅ | 201; duplicate triple → 409 |
| Remove role chip | `DELETE /api/assignments/{id}` | ✅ | 204; audit `delete assignment` |

### Non-negotiables

- [x] Real data only
- [x] Loading / error / 403 / empty states (`PermissionDenied` rendered on 403)
- [x] Zero inert buttons
- [x] Self-delete refused server-side (422), not just UI
- [x] Zero raw hex; lucide-react + `components/icons` only
- [x] Light + dark via `--gx-*` tokens
- [x] Server-side gate: `config.manage`
- [x] Audit events via `workflow.emit` on every write

### Screenshots

- `screenshots/sec_03_users_list.png` — list with role chips + status pills
- `screenshots/sec_04_users_detail.png` — drawer: email, primary node, role chip "Super Admin super_admin at Demo ISP Group grp" with trash control

---

## SuperAdmin gate — live proof (non-superadmin attempts)

Logged in as `agent@demo.isp` (manager-tier, no `config.manage`):

```
POST   /api/users         → 403  {"detail":"Not allowed to manage users"}
POST   /api/assignments   → 403  {"detail":"Not allowed to manage assignments"}
PATCH  /api/roles/{id}    → 403  {"detail":"Not allowed to manage configuration"}
```

Same calls as `admin@demo.isp` → 201 / 200 as expected.

Gate location:
- `backend/app/routers/users.py:32` — `_require_config_manage()`
- `backend/app/routers/assignments.py:27` — `_require_config_manage()`
- `backend/app/routers/roles.py:23` — existing `_require_config_manage()`

Frontend is **not** the barrier — server enforces on every write.

---

## Audit log proof

Confirmed via `GET /api/audit-log` that these events were emitted during testing:

- `create app_user` · `update app_user` · `delete app_user`
- `create assignment` · `delete assignment`
- `create role_def` · `update role_def` · `delete role_def` (roles.py now emits — was missing)

---

## Verification gates (all green)

| Check | Result |
|---|---|
| `python -c "from app import main"` | exit 0 |
| `npx tsc --noEmit` (frontend) | 0 new errors (pre-existing HelpdeskView Lucide errors unchanged) |
| uvicorn boot clean | `/docs` 200, `/health` 200, no IntegrityError |
| Backend left running on :8099 | ✅ |

---

## What's NOT done (intentional)

- **15 remaining Security leaves:** Policies, Authentication, Authorization, MFA, SSO, OAuth, Session Policies, Password Policies, Secrets Vault, Encryption, Certificates, IP Restrictions, Geo Restrictions, Device Trust, Threat Detection — all stay on the "Not yet wired" empty state per the one-module-per-session cadence.

---

## Commit messaging snag (transparency)

The Module 1 work was bundled into commit `636652b` whose message reads `fix(topbar): show Configure gear on My Tasks / My Approvals / Activity Feed / Saved Views`. The **content is correct** (it includes all Module 1 files — `users.py`, `assignments.py`, `UsersPane.tsx`, `tree.ts`, `StudioGenericPane.tsx`, `verify_security.js`, 5 sec_*.png screenshots) — only the title under-sells it.

Cause: a pre-staged topbar fix was committed alongside the Module 1 work. Not force-pushed to fix the message (no authorization for `--force` to main). This report commit (next) carries the accurate Module 1 title in its own message.

---

## Files shipped (in commit `636652b`)

```
backend/app/main.py                       (mounted assignments router)
backend/app/routers/users.py              (POST/PATCH/DELETE + assignments denorm)
backend/app/routers/assignments.py        NEW
backend/app/routers/roles.py              (audit.emit added)
frontend/src/studio/UsersPane.tsx         NEW (~795 LOC)
frontend/src/studio/StudioGenericPane.tsx (security.users registered)
frontend/src/studio/tree.ts               ('Users' added to Security group)
verify_security.js                        NEW (Playwright proof script)
screenshots/sec_00_studio_landing.png
screenshots/sec_01_roles.png
screenshots/sec_02_permissions.png
screenshots/sec_03_users_list.png
screenshots/sec_04_users_detail.png
```

---

## Doctrine compliance

- ✅ Real data only — no mock/fake/hardcoded anywhere
- ✅ Server-side SuperAdmin gate — frontend is not the barrier
- ✅ Zero inert buttons — every control performs a real action
- ✅ Audit emitted on every write
- ✅ Idempotent — POST handles duplicates with 409
- ✅ No emoji in product UI
- ✅ Light + dark via `--gx-*` tokens
- ✅ Unwired leaves stay on honest "Not yet wired" — not faked

---

**Status:** Module 1 Security ✅ complete. Stopped here for review before Module 2 (Data → Models/Entities, Fields).
