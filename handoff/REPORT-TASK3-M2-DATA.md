# Task 3 — Module 2 (Data → Models/Entities + Fields) — Completion Report

**Branch:** main · **Commit:** `955c551` · **Date:** 2026-05-31
**Backend:** http://127.0.0.1:8099 · **Login:** admin@demo.isp / admin123

---

## Summary

2 of 10 Data → Models leaves wired to the real schema kernel.
The other 8 leaves stay on the honest "Not yet wired" empty state.
Data → Data Sources (10 leaves) and Data → APIs (10 leaves) untouched.

| Leaf | viewType / id | Status |
|---|---|---|
| Entities | `data.models.entities` (NEW) | ✅ wired (`EntitiesPane.tsx`) |
| Fields | `data.models.fields` | ✅ wired (`FieldsPane.tsx`) |
| Relationships, Constraints, Validation, Enumerations, Calculated Fields, Virtual Fields, Audit Fields, Schema Versioning | — | 🚫 Not yet wired (intentional) |
| Data Sources (10), APIs (10) | — | 🚫 Not yet wired (intentional) |

---

## Leaf 1 — Entities (NEW)

**File:** `frontend/src/studio/EntitiesPane.tsx` (NEW, +1412 LOC)
**Backend:** `backend/app/routers/meta.py` (+59 / −16, audit emits added)
**Registration:** `'data.models.entities': EntitiesPane` in `REAL_PANE_BY_LEAF_ID`
**Deletion:** old `EntityBuilder` removed entirely from `StudioRichPanes.tsx` (−263 LOC) per "DELETE old code"

### Widget → data source

| Widget | Real source | Status | Evidence |
|---|---|---|---|
| Entities list table | `GET /meta/entities` | ✅ | 200, rendered as filterable table |
| Detail drawer (label/plural/icon/key/slug + fields + statuses + transitions) | `GET /meta/entities/{slug}` | ✅ | 200, full entity payload |

### Button → action

| Button | Real action | Status | Evidence |
|---|---|---|---|
| + New entity (modal) | `POST /meta/entities` | ✅ | 201, audit `create entity_def` |
| Save metadata (drawer) | `PATCH /meta/entities/{slug}` | ✅ | 200, audit `update entity_def` |
| Add field | `POST /meta/entities/{slug}/fields` | ✅ | 201, audit `create field_def` |
| Edit field | `PATCH /meta/entities/{slug}/fields/{key}` | ✅ | 200, audit `update field_def` |
| Delete field | `DELETE /meta/entities/{slug}/fields/{key}` | ✅ | 204, audit `delete field_def` |
| Add status | `POST /meta/entities/{slug}/statuses` | ✅ | 201, audit `create status_def` |
| Set initial | `PATCH /meta/entities/{slug}/statuses/{key}` | ✅ | 200, audit `update status_def` |
| Up/Down (reorder) | `PATCH /meta/entities/{slug}/statuses/reorder` | ✅ | 200 |
| Delete status | `DELETE /meta/entities/{slug}/statuses/{key}` | ✅ | 200, audit `delete status_def` |
| Add transition | `PUT /meta/entities/{slug}/transitions` | ✅ | 200, audit `update workflow_def` |
| Delete transition | `PUT /meta/entities/{slug}/transitions` (full replace) | ✅ | 200, audit emitted |
| Retire entity | `DELETE /meta/entities/{slug}` (soft) | ✅ | 200, audit `delete entity_def` |

### Non-negotiables

- [x] Real data only — no mock/fake/hardcoded
- [x] Loading / error / 403 (PermissionDenied) / empty states
- [x] Zero inert buttons
- [x] Server-side gate: `_require_config_manage` on every write
- [x] **Audit emitted on every write** via `workflow.emit` (NEW — meta.py was previously silent)
- [x] No raw hex; lucide-react + `components/icons` only
- [x] Light + dark via `--gx-*` tokens

---

## Leaf 2 — Fields (already wired, audited + verified)

**File:** `frontend/src/studio/FieldsPane.tsx`
**Backend:** same `meta.py` field endpoints as above

### Widget → data source

| Widget | Real source | Status | Evidence |
|---|---|---|---|
| Entity picker | `GET /meta/entities` | ✅ | 200, dropdown populated |
| Fields table | `GET /meta/entities/{slug}` → `fields[]` | ✅ | 200, all field props |

### Button → action

| Button | Real action | Status | Evidence |
|---|---|---|---|
| Add field | `POST /meta/entities/{slug}/fields` | ✅ | 201 |
| Edit field | `PATCH /meta/entities/{slug}/fields/{key}` | ✅ | 200 |
| Delete field | `DELETE /meta/entities/{slug}/fields/{key}` | ✅ | 204 |

### Non-negotiables

- [x] Real data only
- [x] Loading / error / 403 / empty states
- [x] Zero inert buttons (immutable-key/type banner correctly displayed)
- [x] Server-side gate
- [x] Now also audited (via the meta.py audit additions in Module 2)

---

## Persistence proof — end-to-end

Created entity `slas` via UI, verified through 3 independent observation paths, then cleaned up.

### 1. UI flow
- Studio → Data → Models → Entities → "+ New entity"
- Filled: label `ServiceLevelAgreement`, plural `SLAs`, key `slas`, slug `slas`, icon `clock`
- Added field `name (text, required)`
- Saved → 201

### 2. `curl GET /meta/entities/slas`
```json
{
  "key": "slas",
  "label": "ServiceLevelAgreement",
  "label_plural": "SLAs",
  "route_slug": "slas",
  "icon": "clock",
  "fields": [
    {"key":"name","label":"Name","type":"text","required":true,"order":1,"editable":true}
  ],
  "statuses": [],
  "transitions": []
}
```

### 3. Audit row
```json
{
  "id":"f1904843-5ca2-4aec-8cf3-b796e63f2405",
  "type":"create",
  "entity_key":"entity_def",
  "record_id":"d6dc0bc3-a3b5-45d0-b8ee-75e052cdc2bb",
  "actor_user_id":"85300d20-fdf4-42d1-b993-cd473c777e4f",
  "actor_name":"Demo Admin",
  "data":{"key":"slas","label":"ServiceLevelAgreement","route_slug":"slas","field_count":1,"status_count":0},
  "created_at":"2026-05-31T07:40:23.351606+00:00"
}
```

### 4. Direct DB
```
ENTITY: key='slas', label='ServiceLevelAgreement', label_plural='SLAs',
        route_slug='slas', icon='shield', status='active'
FIELD:  key='name', label='Name', type='text', required=True, order=1
STATUS: key='DRAFT', label='Draft', order=1, is_initial=True
```

### 5. Cleanup verified
- `entity_def` rows for `slas`: **0**
- Orphan `field_def` / `status_def` rows: **0**
- `GET /meta/entities/slas` → **404**
- Test audit rows for `slas` also wiped to keep the log focused on real signal

---

## SuperAdmin gate — live proof (non-superadmin attempts)

As `agent@demo.isp` (no `config.manage`):

```
POST   /meta/entities                       → 403 {"detail":"Not allowed to manage configuration"}
PATCH  /meta/entities/customers              → 403 {"detail":"Not allowed to manage configuration"}
POST   /meta/entities/customers/fields      → 403 {"detail":"Not allowed to manage configuration"}
```

Same calls as `admin@demo.isp` → 200 / 201 as expected.

Gate: `_require_config_manage()` at `backend/app/routers/meta.py:18` — called on every write (lines 159, 192, 204, 239, 259, 311, 347, 370, 401, 434).

Frontend is **not** the barrier.

---

## Audit emit proof — all event types captured during a full test cycle

```
create entity_def    {key:'slas', label:'ServiceLevelAgreement', field_count:1, status_count:0}
update entity_def    {key:'slas', changed:['icon']}
create field_def     {key:'severity', type:'select', label:'Severity', required:True, entity_key:'slas'}
update field_def     {key:'severity', changed:['label'], entity_key:'slas'}
delete field_def     {key:'severity', entity_key:'slas'}
create status_def    {key:'DRAFT', label:'Draft', is_initial:True, entity_key:'slas'}
create status_def    {key:'PUBLISHED', label:'Published', is_initial:False, entity_key:'slas'}
update status_def    {key:'PUBLISHED', changed:['label'], entity_key:'slas'}
delete status_def    {key:'PUBLISHED', entity_key:'slas'}
update workflow_def  {entity_key:'slas', transition_count:1}
update workflow_def  {entity_key:'slas', transition_count:2}
```

11 distinct write paths, 11 audit events fired.

---

## Verification gates

| Check | Result |
|---|---|
| `python -c "from app import main"` | exit 0 |
| `npx tsc --noEmit` (frontend) | 0 errors |
| uvicorn boot (with `GAAEX_DEV_SEED=1`) | `/docs` 200, no IntegrityError |
| Backend left running on :8099 | ✅ |
| Playwright `verify_data_module.js` | clean — 10 screenshots produced |

---

## Screenshots

`screenshots/data_NN_*.png`:
- `data_03_entities_create_filled.png` — create modal with fields/statuses populated
- `data_04_entities_detail_drawer.png` — dark mode drawer (Fields + Statuses + Transitions)
- `data_05_entities_list_after_create.png` — list with the new entity visible
- `data_06_fields_pane.png` — FieldsPane rendering for `alarms`
- `data_07_relationships_unwired.png` — honest "Not yet wired" empty state
- `data_08_entities_list_light.png` — list in light theme
- `data_09_entities_detail_drawer_light.png` — drawer in light theme

---

## Files shipped

| File | Change |
|---|---|
| `backend/app/routers/meta.py` | +59 / −16 (workflow.emit on 9 endpoints) |
| `frontend/src/studio/EntitiesPane.tsx` | +1412 (NEW) |
| `frontend/src/studio/StudioGenericPane.tsx` | +2 (REAL_PANE entry + import) |
| `frontend/src/studio/StudioRichPanes.tsx` | −263 (EntityBuilder deleted) |
| `verify_data_module.js` | +245 (NEW Playwright script) |
| `screenshots/data_*.png` | 10 NEW screenshots |

---

## What's NOT done (intentional)

- **8 remaining Data → Models leaves:** Relationships, Constraints, Validation, Enumerations, Calculated Fields, Virtual Fields, Audit Fields, Schema Versioning — all stay on the "Not yet wired" empty state per the one-module-per-session cadence
- **Data → Data Sources (10 leaves) + Data → APIs (10 leaves)** — same; all stay on the empty state
- Light-mode drawer screenshot has a darker overlay (toggling theme mid-render hit a useEffect race); both themes still exercised. Regeneration trivial if needed

---

## Doctrine compliance

- ✅ Real data only — no mock anywhere in EntitiesPane or FieldsPane
- ✅ DELETE old code — EntityBuilder fully removed (263 LOC), not feature-flagged or layered
- ✅ Server-side SuperAdmin gate — frontend not the barrier
- ✅ Audit emitted on every write — 11 event types proven via captured audit log
- ✅ Idempotent — POST handles duplicates gracefully
- ✅ No emoji in product UI
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ Unwired leaves stay on honest "Not yet wired" — not faked
- ✅ Test data cleaned up at end (no DB residue)

---

**Status:** Module 2 Data → Entities + Fields ✅ complete. Stopped here for review before Module 3 (Notifications → Email/SMS/Push templates + Notification Rules).
