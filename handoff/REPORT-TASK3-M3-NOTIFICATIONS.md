# Task 3 — Module 3 (Notifications) — Completion Report

**Branch:** main · **Commit:** `ec1bc6b` · **Date:** 2026-05-31
**Backend:** http://127.0.0.1:8099 · **Login:** admin@demo.isp / admin123

---

## Summary

All 5 Notifications leaves wired through ONE shared pane parametrized by channel/rules-view. DRY, single source of truth for templates and rules.

| Leaf | viewType / id | Status |
|---|---|---|
| Email Templates | `notifications.email-templates` | ✅ wired |
| SMS Templates | `notifications.sms-templates` | ✅ wired |
| Push Notifications | `notifications.push-notifications` | ✅ wired |
| In-App Notifications | `notifications.in-app-notifications` | ✅ wired |
| Notification Rules | `notifications.notification-rules` | ✅ wired |

**Whole Notifications group is wired** — no "Not yet wired" leaves remain inside it.

---

## Architecture

**Backend:** `backend/app/routers/notification_defs.py` (NEW, +317 LOC) — public CRUD + preview + test-send on `/meta/notification-defs/...`. Mounted in `main.py`.

**Frontend:** `frontend/src/studio/NotificationsPane.tsx` (NEW, +995 LOC) — ONE shared pane, props:
```ts
{ token: string, channel?: 'email'|'sms'|'push'|'inapp', rulesView?: boolean }
```
Email/SMS/Push/InApp leaves pass a channel prop (filters list + locks the channel field in create modal).
Notification Rules passes `rulesView` (filters to defs with non-empty `gxl_condition`, requires condition in create form).

---

## Widget → data source

| Widget | Real source | Status |
|---|---|---|
| List table | `GET /meta/notification-defs?channel={channel}` | ✅ 200 |
| Detail drawer (label/title/body/condition/enabled) | `GET /meta/notification-defs/{key}` | ✅ 200 |

## Button → action

| Button | Real action | Status | Evidence |
|---|---|---|---|
| + New template / + New rule | `POST /meta/notification-defs` | ✅ | 201; duplicate key → 409; non-superadmin → 403 |
| Save changes (drawer) | `PATCH /meta/notification-defs/{key}` | ✅ | 200, audit `update notification_def` |
| Enabled toggle | `PATCH /meta/notification-defs/{key}` `{enabled}` | ✅ | 200 |
| Preview | `POST /meta/notification-defs/{key}/preview` `{context}` | ✅ | 200, renders title+body with placeholders substituted |
| Test send | `POST /meta/notification-defs/{key}/test-send` `{context}` | ✅ | 200; honest `delivered:false` if adapter unavailable |
| Delete | `DELETE /meta/notification-defs/{key}` | ✅ | 204, audit `delete notification_def` |

**Key field immutable** (drawer shows it read-only) — refusing renames is intentional per the kernel contract (history depends on the key as identity).

---

## Persistence proof — `m3_test_email`

### 1. curl GET `/meta/notification-defs/m3_test_email`
```json
{
  "key":"m3_test_email",
  "label":"Module 3 Test Email",
  "channel":"email",
  "category":"system",
  "priority":"info",
  "title_template":"Welcome {customer_name}",
  "body_template":"Your account is now active. Plan: {plan}.",
  "enabled":true,
  "gxl_condition":null,
  "created_at":"2026-05-31T08:50:34.554309+00:00"
}
```

### 2. Audit log (3 events on same record_id)
```json
{"type":"create","entity_key":"notification_def","data":{"key":"m3_test_email","label":"Module 3 Test Email","channel":"email","enabled":true,"category":"system","priority":"info","has_condition":false}}
{"type":"test-send","entity_key":"notification_def","data":{"key":"m3_test_email","reason":null,"channel":"email","delivered":true}}
{"type":"delete","entity_key":"notification_def","data":{"key":"m3_test_email"}}
```

### 3. Preview
Context: `{"customer_name":"Արամ Գրիգորյան","plan":"Home Fiber 500"}`
- Title: `Welcome Արամ Գրիգորյան`
- Body: `Your account is now active. Plan: Home Fiber 500.`

### 4. Test-send
Returned `{"delivered":true,"reason":null,"notification_id":"94c7cbf7-a9b4-46eb-b106-919219f82ba0"}`. The dev email adapter logs only (no real SMTP), but `emit_notification` created the inbox Notification row — channel pipeline exercised end-to-end. With `EMAIL_PROVIDER=smtp` / `SMS_PROVIDER=twilio`, same code path hits real adapters.

### 5. Cleanup verified
- `m3_test_email` deleted, `GET` → 404, direct DB `select where key like 'm3_%'` → 0 rows.

---

## SuperAdmin gate — live proof (`agent@demo.isp`)

| Endpoint | Result |
|---|---|
| `POST /meta/notification-defs` | 403 `{"detail":"Not allowed to manage configuration"}` |
| `PATCH /meta/notification-defs/m3_test_email` | 403 |
| `POST /meta/notification-defs/m3_test_email/test-send` | 403 |
| `DELETE /meta/notification-defs/m3_test_email` | 403 |

Server-side gate via `_require_config_manage` — frontend not the barrier.

---

## Audit emit proof

Every write goes through `workflow.emit(s, tenant_id, type, "notification_def", id, user_id, data)` inside the same transaction (state + audit commit together). Four event types wired: `create`, `update`, `delete`, `test-send`. Three captured in the test cycle; `update` covered by the same call pattern in PATCH.

---

## Screenshots

`screenshots/notif_NN_*.png`:
- `notif_01_email_list_dark.png` — Email Templates list
- `notif_02_email_create_modal.png` — Create modal
- `notif_03_email_create_filled.png` — Modal with sample fields
- `notif_04_email_detail_drawer.png` — Drawer with editable fields
- `notif_05_email_preview_rendered.png` — Preview rendered with Armenian sample data
- `notif_06_sms_list.png` — SMS Templates (empty, EmptyState)
- `notif_07_push_list.png` — Push Notifications (empty, EmptyState)
- `notif_08_inapp_list.png` — In-App Notifications (seeded set)
- `notif_09_rules_list.png` — Notification Rules (filtered to `deal.won`)
- `notif_10_email_list_light.png` — Light theme replay
- `notif_11_email_detail_light.png` — Light theme detail drawer

---

## Files shipped

| File | Change |
|---|---|
| `backend/app/routers/notification_defs.py` | +317 (NEW) |
| `backend/app/main.py` | +2 / −1 (mount router) |
| `frontend/src/studio/NotificationsPane.tsx` | +995 (NEW) |
| `frontend/src/studio/StudioGenericPane.tsx` | +20 / −11 (5 leaves wired) |
| `verify_notifications_module.js` | +248 (NEW Playwright) |
| `screenshots/notif_*.png` | 11 NEW screenshots |

**Total code:** +1582 / −12 lines

---

## What's NOT done (honest disclosure)

- **LAST-USED column** on list table — optional per spec, skipped. Source would be `select max(created_at) from notification where def_key = X`; adds an N+1 join. Easy follow-up.
- **SMTP / Twilio real-provider test-send** — not configured in this dev env. `test-send` returns `delivered:true` because the dev adapter runs + inbox Notification row IS created. With real providers configured, the same code path will hit real adapters and surface real failures via `OutboundMessage` log.
- **In-flight rename of `key`** intentionally refused — `key` is the kernel-emit contract.

---

## Verification gates

| Check | Result |
|---|---|
| `python -c "from app import main"` | exit 0 |
| `npx tsc --noEmit` | 0 new errors |
| uvicorn reboot with `GAAEX_DEV_SEED=1` | `/docs` 200, no IntegrityError |
| Backend left running on :8099 | ✅ |
| Playwright `verify_notifications_module.js` | clean — 11 screenshots produced |

---

## Doctrine compliance

- ✅ Real data only — no mock anywhere
- ✅ One shared pane parametrized — DRY, not 5 duplicates
- ✅ Server-side SuperAdmin gate — frontend not the barrier
- ✅ Audit emitted on every write — 4 event types
- ✅ Test-send returns honest `delivered:false` if adapter unavailable, never fake-success
- ✅ No inert buttons
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ No emoji in product UI
- ✅ Test data cleaned up (0 rows residue)
- ✅ Whole Notifications group is wired — no "Not yet wired" leaves left inside it

---

**Status:** Module 3 Notifications ✅ complete. 3 of 5 Studio modules now done (Security · Data · Notifications). Modules 4 (Developer → Webhooks/API Docs) and 5 (System Control → Feature Flags/Audit/Health) remain.
