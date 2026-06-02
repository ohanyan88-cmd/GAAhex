# Outbound Messaging — Handoff (A28/B28)

This document covers GAAhex's external-delivery subsystem: the delivery log (pre-existing) and the
manual compose-and-send endpoint (A28) with its frontend API function (B28). No compose modal has
landed in `OutboundView.tsx` yet; the B28 contribution is limited to `composeOutbound` in `api.ts`.

---

## 1. Overview

Every external-channel send (email, SMS, webhook, console) records one `OutboundMessage` row — an
observable, queryable record of what GAAhex tried to send and whether it succeeded. In-app
notifications are NOT logged here; the inbox `Notification` row is itself the delivery artifact.

The subsystem has two distinct entry paths:

1. **Kernel-driven dispatch** — `emit_notification` in `routers/notifications.py` fans out to
   `channels.dispatch` when a `NotificationDef` targets an external channel.
2. **Manual compose** (A28) — an admin calls `POST /api/outbound/compose` directly, bypassing
   the notification-definition machinery entirely.

Both paths route through the OOP adapter layer (`app/adapters/`) and write an `OutboundMessage`
row on completion.

---

## 2. Delivery Log — GET /api/outbound

**Router:** `outbound_router` in `backend/app/routers/notifications.py`, registered at `/api`
prefix, so the full path is `/api/outbound`.

### Auth & Permission

Requires a valid JWT (`current_user`). Additionally gated on the `config.manage` grant:

```
if not can(grants, "config", "manage"):
    raise HTTPException(403, "Not allowed: config.manage")
```

Non-admins receive 403. The frontend (`OutboundView.tsx`) catches this and renders
`<PermissionDenied message="Outbound delivery is admin-only." />`.

### Query Parameters

| Parameter | Type | Effect |
|-----------|------|--------|
| `channel` | string (optional) | Filter rows to this channel value |
| `status`  | string (optional) | Filter rows to this status value |

Both filters are exact-match (`==`), applied with `.where()`. Absent means no filter. Results are
ordered newest-first (`OutboundMessage.created_at.desc()`).

### Response Shape

Returns a JSON array. Each element is serialized by `_serialize_outbound`:

```json
{
  "id": "<uuid>",
  "channel": "email",
  "to_addr": "user@example.com",
  "subject": "Welcome",
  "body": "Hello …",
  "status": "SENT",
  "def_key": "welcome_email",
  "user_id": "<uuid or null>",
  "error": null,
  "created_at": "2026-05-27T03:00:00+00:00"
}
```

`def_key` is the `NotificationDef.key` that triggered the send (null for manual compose messages).
`error` is populated only when `status` is `FAILED` (or when the adapter returned `LOG` — see
section 4 for the LOG→SENT status mapping).

### Scope

Scoped to `OutboundMessage.tenant_id == user.tenant_id`. No cross-tenant leakage.

---

## 3. Compose & Send — POST /api/outbound/compose

**Route:** `POST /api/outbound/compose` (status 201 on success).

Implemented in `backend/app/routers/notifications.py` as `compose_and_send` on `outbound_router`.

### Auth & Permission

Requires a valid JWT (`current_user`). No additional permission check beyond authentication is
performed in the handler itself (the endpoint is implicitly admin-oriented but does not call
`can(grants, ...)`).

### Request Body (`ComposeIn`)

```json
{
  "channel": "email",
  "to": "recipient@example.com",
  "subject": "Optional subject",
  "body": "Message body (required)",
  "record_id": null,
  "entity_key": null
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `channel` | string | yes | Must be `"email"` or `"sms"` (enforced by `_SUPPORTED_CHANNELS`) |
| `to` | string | yes | Must not be blank |
| `body` | string | yes | Must not be blank |
| `subject` | string | no | Optional; passed as-is to the adapter |
| `record_id` | string | no | Stored context; not used in routing |
| `entity_key` | string | no | Stored context; not used in routing |

Validation is done in `ComposeIn.model_post_init`. Invalid `channel` or blank `to`/`body` returns
422 (Pydantic validation error before the handler body runs).

### Routing Logic

```python
adapter = adapter_registry.get(payload.channel)
if adapter is None:
    raise HTTPException(503, "channel not available")

result = await adapter.safe_send(
    to=payload.to,
    subject=payload.subject,
    body=payload.body,
    meta={"source": "manual", "user_id": str(user.id)},
)
```

`adapter_registry` is the OOP `adapters.registry` singleton imported from `adapters.base`. If no
adapter is registered for the channel, the handler returns 503 immediately.

`safe_send` never raises — failures are captured as `result["status"] == "FAILED"` with
`result["detail"]` as the error string.

### OutboundMessage Creation

After the adapter call, an `OutboundMessage` row is created directly (not via `channels.dispatch`):

```python
msg = OutboundMessage(
    tenant_id=user.tenant_id,
    channel=payload.channel,
    to_addr=payload.to,
    subject=payload.subject,
    body=payload.body,
    status=result["status"],   # raw adapter status: SENT / FAILED / LOG
    error=error_detail,        # detail string if FAILED, else None
)
s.add(msg)
await s.commit()
```

Note: unlike the `channels.dispatch` path, this handler stores the raw adapter status (including
`"LOG"`) directly. The `channels.dispatch` path maps `"LOG"` → `"SENT"` in the status column; this
compose handler does not apply that mapping.

### Response Shape

Returns the same `_serialize_outbound` shape as the delivery log (see section 2), with HTTP 201.

### Error Responses

| Status | Condition |
|--------|-----------|
| 201 | Message dispatched (even if adapter returned FAILED — the row is still created) |
| 422 | Invalid `channel`, blank `to`, or blank `body` |
| 503 | `adapter_registry.get(channel)` returned None (no adapter registered) |

---

## 4. Channel Adapters (email / SMS / dev log)

### Architecture

All adapters implement `ChannelAdapter` (abstract base in `backend/app/adapters/base.py`):

- `channel: str` — the canonical name this adapter handles
- `send(to, subject, body, meta) -> dict` — concrete delivery logic; MUST NOT raise
- `safe_send(...)` — wrapper that catches any exception and returns `{"status": "FAILED", ...}`

The module-level `registry = _AdapterRegistry()` maps channel names to instances. Import
`app.adapters` (via `__init__.py`) to auto-register all adapters at startup.

### Dispatch Path (kernel-driven)

`channels.dispatch` in `backend/app/channels.py` is the canonical dispatch entry point:

1. `inapp` channel: immediate no-op (no `OutboundMessage` created; the `Notification` row is the
   delivery).
2. A26 preference gate: if `user_id` is provided, `_pref_suppresses_external` checks whether the
   recipient's A26 delivery preference disables the channel. Default-send: no pref row = send.
3. OOP adapter registry: `adapters.registry.get(channel)` — used for `email` and `sms`.
4. Legacy functional registry (`_REGISTRY`): fallback for `console`, `webhook`, and any channel
   not in the OOP registry.
5. An `OutboundMessage` row is written regardless of outcome (SENT or FAILED).

Status mapping in `dispatch`: adapter result `"LOG"` is stored as `"SENT"` in the
`OutboundMessage.status` column; the `error` column holds the `"logged (no SMTP config)"` detail
string so the record remains queryable as successful.

### Email Adapter

Configured at import time by `adapters/email.py:configure()`:

| Condition | Adapter activated |
|-----------|------------------|
| `EMAIL_PROVIDER=smtp` and `SMTP_HOST` set in env | `SmtpEmailAdapter` |
| Otherwise (default) | `LogEmailAdapter` |

**`LogEmailAdapter`** (dev/default):
- No recipient → `status="FAILED"`, `detail="no email address for recipient"`
- Valid recipient → logs via `logger.info` and returns `status="LOG"`
- No external connections; no credentials required

**`SmtpEmailAdapter`** (production):
- Connects via `smtplib.SMTP` off the event loop (`asyncio.to_thread`)
- `STARTTLS` optional (`SMTP_STARTTLS` setting)
- No recipient → `status="FAILED"` immediately
- SMTP error → returns `status="FAILED"` with detail (via `safe_send` exception catch)
- Success → `status="SENT"`

SMTP settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`,
`SMTP_STARTTLS` — all read from `app.config.settings` (populated from `backend/.env`).

### SMS Adapter

Configured at import time by `adapters/sms.py:configure()`:

| Condition | Adapter activated |
|-----------|------------------|
| `SMS_PROVIDER=twilio` and `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` set | `TwilioSmsAdapter` |
| Otherwise (default) | `LogSmsAdapter` |

**`LogSmsAdapter`** (dev/default):
- No recipient → `status="FAILED"`, `detail="no phone number for recipient"`
- Valid recipient → logs via `logger.info` and returns `status="LOG"`

**`TwilioSmsAdapter`** (production):
- Calls Twilio REST API (`https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`)
- Uses `httpx.AsyncClient` with HTTP Basic auth (account SID + auth token)
- No recipient → `status="FAILED"` immediately
- Non-2xx HTTP response → `status="FAILED"` with detail (truncated to 200 chars)
- Success → `status="SENT"`

Twilio settings: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` — all from `.env`.
No secrets in source code.

Note: `User.phone` does not exist on the model yet. SMS dispatch from the kernel path resolves the
recipient phone via `_resolve_address`, which uses `getattr(recipient, "phone", None)` — this
returns `None`, causing the SMS adapter to record `status="FAILED"` with "no phone number for
recipient" for kernel-driven SMS sends until the `phone` field is added to `User`.

### Adding a New Channel

To add a provider for an existing channel or a wholly new channel:

1. Sub-class `ChannelAdapter` with the appropriate `channel` value.
2. Implement `send(to, subject, body, meta)` — return dict with `status`, `channel`, `to`,
   `detail`; never raise.
3. Add the provider name to `settings` and an `elif` branch in the module's `configure()`.
4. Import the new module in `adapters/__init__.py` so `configure()` runs at startup.

---

## 5. OutboundMessage Model

**File:** `backend/app/models/outbound.py`  
**Table:** `outbound_message`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | UUID | no | Primary key, auto-generated |
| `tenant_id` | UUID (FK → tenant) | no | Indexed; isolates rows per tenant |
| `channel` | String(40) | no | `inapp`, `email`, `sms`, `webhook`, `console` |
| `to_addr` | String(255) | yes | Email address, phone number, or None |
| `subject` | String(255) | yes | Subject line; None for SMS/push |
| `body` | Text | no | Full message body |
| `status` | String(20) | no | `SENT`, `FAILED`, or `QUEUED`; default `SENT` |
| `def_key` | String(120) | yes | `NotificationDef.key` that triggered the send; None for manual |
| `user_id` | UUID (FK → app_user) | yes | Recipient user; None for webhook / manual sends |
| `error` | Text | yes | Failure detail when `status=FAILED`; also stores "logged" note for LOG sends via `dispatch` |
| `created_at` | DateTime (tz) | no | Server-set via `func.now()` |

In-app notifications are not logged here; the `Notification` table is the in-app delivery record.

---

## 6. Frontend — OutboundView

**File:** `frontend/src/OutboundView.tsx`

### Component Props

```tsx
export default function OutboundView({ token }: { token: string })
```

### State

| State | Initial | Purpose |
|-------|---------|---------|
| `list` | `null` | Array of outbound rows (null = loading) |
| `channel` | `""` | Filter value (drives query param) |
| `status` | `""` | Filter value (drives query param) |
| `error` | `""` | Error message string |
| `unavailable` | `false` | True when backend returned 404 |
| `denied` | `false` | True when backend returned 403 |

### Data Loading

`load()` is called on mount and whenever `token`, `channel`, or `status` changes (via `useEffect`).
It constructs query params from state, calls `GET /api/outbound`, and handles:

- 404 → `unavailable = true`, shows empty-state with "Outbound log isn't available yet"
- 403 → `denied = true`, renders `<PermissionDenied message="Outbound delivery is admin-only." />`
- Other non-ok → `error` message, renders `<ErrorBanner onRetry={load} />`
- Success → sets `list` to the array

### Filter UI

Two `<select>` dropdowns: Channel and Status. Channel options are the hardcoded array
`['email', 'sms', 'push', 'webhook', 'inapp']`. Status options are
`['queued', 'sent', 'delivered', 'failed']` (lowercase; the backend stores uppercase — the
filter passes as-is to the backend `?status=` param).

### Table Columns

Rendered when `list` has entries:

| Column | Source |
|--------|--------|
| Channel | `o.channel` |
| To | `o.to` (mapped from `to_addr`) |
| Message | `o.subject \|\| o.body` truncated to 80 chars; shows `error` in red if present |
| Status | `statusPill(o.status)` — `pill-danger` for failed, `pill-success` for sent/delivered |
| When | `timeAgo(o.created_at)` |

### Compose Modal

`OutboundView.tsx` includes a full compose modal (B28). A **New Message** button (`btn btn-primary btn-sm` + `PlusIcon`) in the view header opens a `Modal` overlay with:

- **Channel** select — `email` or `sms`
- **To** text input — email address or phone number (required)
- **Subject** text input — shown only when channel is `email`
- **Body** textarea — 4 rows (required)

Send calls `composeOutbound(token, {channel, to, subject, body})` from `api.ts`. On 201: toast + modal closes + log refreshes. On error: inline `<p className="err">` inside the modal (modal stays open). Uses `MailIcon` (no SendIcon in the icon set). Send button disabled while in-flight or when required fields are empty.

---

## 7. Code to Doc Summary

| Feature | Backend | Frontend | Status |
|---------|---------|----------|--------|
| Delivery log (`GET /api/outbound`) | `routers/notifications.py` — `outbound_log` | `OutboundView.tsx` — `load()` | Complete |
| Compose & send (`POST /api/outbound/compose`) | `routers/notifications.py` — `compose_and_send`, `ComposeIn` | `api.ts` — `composeOutbound` | Backend + API fn complete; no UI modal yet |
| `OutboundMessage` model | `models/outbound.py` | (type inline in `OutboundView.tsx`) | Complete |
| Email adapter (log/SMTP) | `adapters/email.py` — `LogEmailAdapter`, `SmtpEmailAdapter` | — | Complete |
| SMS adapter (log/Twilio) | `adapters/sms.py` — `LogSmsAdapter`, `TwilioSmsAdapter` | — | Complete |
| Adapter base + registry | `adapters/base.py` — `ChannelAdapter`, `_AdapterRegistry` | — | Complete |
| Dispatch orchestration | `channels.py` — `dispatch` | — | Complete |
| Outbound compose modal UI | — | `OutboundView.tsx` (not yet) | Not landed |
| SMS recipient phone field | — (`User.phone` absent) | — | Horizon (degrades to FAILED) |
| Delivery receipts | — | — | Horizon |
| Message templates | — | — | Horizon |
| Scheduled sends | — | — | Horizon |

---

## 8. Horizon & Future Work

**Outbound compose modal UI:** `composeOutbound` in `api.ts` is wired; `OutboundView.tsx` needs a
"Compose" button and a modal form (channel selector, to-address, subject, body textarea, Send/Cancel
buttons). The 201/error response from `composeOutbound` should trigger a toast and refresh `list`.

**User.phone field:** The `User` model has no `phone` column. Kernel-driven SMS sends always resolve
`None` as the recipient address, writing `status=FAILED`. Adding `phone` to `User` (migration +
profile UI) unblocks real SMS delivery.

**Delivery receipts / webhooks:** The current `status` column has three values: `SENT`, `FAILED`,
`QUEUED`. Actual delivery confirmation (SMTP bounce, Twilio delivery callback) is not wired; `SENT`
means "dispatched without error," not "confirmed received."

**Message templates:** The compose endpoint accepts raw `body` text. A template system (pre-built
message templates selectable from a dropdown) is not implemented. Templates are a natural extension
of the `NotificationDef` model or a standalone `MessageTemplate` table.

**Scheduled sends:** No scheduling layer exists. All sends are immediate. A `send_at` field on
`ComposeIn` + a task queue (Celery, ARQ, or the existing daily-loop scheduler) would enable
deferred delivery.

**Pagination:** `GET /api/outbound` returns all rows for the tenant (no limit or cursor). A busy
tenant will accumulate large result sets. Cursor-based pagination (or a `limit`/`offset` param)
should be added before production scale.

**Webhook and push channels:** The `_REGISTRY` in `channels.py` has a `_webhook_adapter` stub and
`inapp` no-op. No `push` adapter is registered. The compose endpoint restricts to
`_SUPPORTED_CHANNELS = {"email", "sms"}`, so webhook and push are unreachable from manual compose
until explicitly added.

---

## 9. Run & Verify

```bash
# Start services
docker compose up -d
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099

# Swagger UI
# http://127.0.0.1:8099/docs  →  look for /api/outbound (GET) and /api/outbound/compose (POST)

# Delivery log (admin token required)
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8099/api/outbound

# Filter by channel and status
curl -H "Authorization: Bearer <token>" "http://127.0.0.1:8099/api/outbound?channel=email&status=SENT"

# Manual compose (A28)
curl -X POST http://127.0.0.1:8099/api/outbound/compose \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"channel":"email","to":"test@example.com","subject":"Test","body":"Hello from GAAhex"}'

# Expected: 201 with the OutboundMessage row (status=LOG in dev — no SMTP configured)

# Verify: the new row appears in the delivery log
curl -H "Authorization: Bearer <token>" http://127.0.0.1:8099/api/outbound
```

In dev (no SMTP config), email sends return `status="LOG"` from the adapter. The `channels.dispatch`
path maps this to `"SENT"` in the DB; the `compose_and_send` handler stores `"LOG"` as-is. The
delivery log in the UI will show `LOG` for manual compose messages until A28 normalizes to `"SENT"`.
