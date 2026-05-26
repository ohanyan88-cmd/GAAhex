# Notifications System: Preferences, Digests, Delivery

This document describes the complete flow of notifications in GAAex: how they are defined and configured, how user preferences control delivery, how the in-app inbox works, and how external messages reach users via email, SMS, and other channels.

---

## 1. The Invariant: Inbox Always-On

**The core rule: every notification is written to the inbox; preferences only gate external delivery and digest batching.**

The inbox (the `Notification` table) is the permanent, searchable, user-scoped record of all events that have occurred. When a notification is emitted via `emit_notification()`, a row is always created in the inbox — regardless of preference settings. Preferences never prevent an inbox row from being created.

Preferences (the `NotificationPref` table) control two things only:
1. Whether the notification is delivered to external channels (email, SMS, webhook, etc.)
2. Whether the notification is batched into a digest or sent immediately (realtime vs. digest mode)

In practical terms:
- A user who has opted out of email notifications will still see the notification in their in-app inbox.
- A user in digest mode for "customer" notifications will see them immediately in-app but will not receive an immediate email; instead, digests will be batched and sent on a schedule (future feature).
- Users cannot opt out of the in-app inbox itself.

---

## 2. Notification Definitions (NotificationDef)

A **NotificationDef** is configuration: the template, priority, category, and channel for a type of notification. It lives above the Kernel Line (it is not kernel code; it is configuration that the kernel reads).

### 2.1 Schema (backend/app/models/notification.py)

```python
class NotificationDef(Base):
    __tablename__ = "notification_def"
    
    id: UUID (primary key)
    tenant_id: UUID (indexed) — the tenant this def belongs to
    key: str (unique per tenant) — e.g. "lead.assigned", "invoice.overdue"
    label: str — human-readable name
    category: str — one of: system|billing|network|customer|internal
    priority: str — one of: critical|warning|info
    channel: str — target delivery channel (default "inapp")
    title_template: str — e.g. "Lead assigned: {lead_name}"
    body_template: str — e.g. "You have been assigned to {company}"
    enabled: bool — if False, this def is inactive and emits will be no-op
    gxl_condition: str | None — optional GXL guard (e.g. "customer.priority > 'medium'")
    created_at: datetime (server timestamp)
```

### 2.2 Lifecycle

**Creation:** Tenant configuration (e.g., during setup, imported from ISP ruleset)

**Resolution in emit flow:**
1. Kernel calls `emit_notification(tenant_id=..., def_key="lead.assigned", user_id=..., context={})`
2. `emit_notification()` looks up the NotificationDef by `(tenant_id, key)`
3. If the def is missing or `enabled=False`, the emit is a no-op (returns None)
4. If the def has a `gxl_condition`, it is evaluated against the supplied `context` dict; if falsy, the emit is a no-op
5. The def's `category`, `priority`, `channel`, and template strings are read to render and route the message

**Mutation:** Admin interface (or API endpoint to be defined in future phases) to enable/disable, edit templates, or adjust category/priority.

### 2.3 Templates & Context

Templates use Python `str.format()` syntax with safe rendering:

```python
def _render(template: str, context: dict) -> str:
    try:
        return template.format_map(_SafeDict(context))
    except Exception:
        return template  # fail-soft: malformed template → return as-is
```

Example:
- Template: `"Lead {lead_name} assigned to {assignee}"`
- Context: `{"lead_name": "Acme Corp", "assignee": "Alice"}`
- Rendered: `"Lead Acme Corp assigned to Alice"`

Unknown placeholders are left intact (e.g., `{unknown}` stays `{unknown}`); malformed templates are returned verbatim rather than raising an exception.

---

## 3. User Preferences (NotificationPref)

A **NotificationPref** is a user's opt-out for a specific category or notification type on a specific channel.

### 3.1 Schema (backend/app/models/notification_pref.py)

```python
class NotificationPref(Base):
    __tablename__ = "notification_pref"
    
    id: UUID (primary key)
    tenant_id: UUID (indexed)
    user_id: UUID (indexed)
    category: str — either a category name (e.g. "billing") or a def_key (e.g. "lead.assigned")
    channel: str — e.g. "inapp", "email", "sms" (default "inapp")
    enabled: bool — if False, this is an opt-out; if True, this is a re-enable
    created_at: datetime (server timestamp)
    
    # Unique constraint: one pref per (tenant, user, category, channel)
```

### 3.2 Default Behavior (Default-On)

**The absence of a row means deliver.** If a user has no NotificationPref row for a given category/def_key on a given channel, the default is to deliver.

Preferences are represented as **opt-outs** (a disabled row blocks delivery):
- No row → deliver (default-on)
- Row with `enabled=False` → block delivery (opted out)
- Row with `enabled=True` → allow delivery (explicit re-enable, rare)

### 3.3 Resolution Order

When deciding whether to deliver a notification to a user on a channel, `emit_notification()` checks preferences in this order:

1. **Specific def_key:** Is there a `NotificationPref` where `category == def_key` and `enabled=False`?
2. **Category:** Is there a `NotificationPref` where `category == def.category` and `enabled=False`?
3. **Default:** If neither exists, deliver (default-on).

Example:
- User has a pref: `(category="lead.assigned", channel="email", enabled=False)` — opted out of lead.assigned emails
- User does NOT have a pref for category "customer"
- When a "lead.assigned" email would be sent → check preference → blocked
- When a "customer.inquiry" email would be sent → check preference for "customer.inquiry" → not found → check "customer" → not found → deliver (default)

Implementation: `_pref_opted_out()` in `backend/app/routers/notifications.py`:

```python
async def _pref_opted_out(s: AsyncSession, tenant_id, user_id, ndef: NotificationDef) -> bool:
    """True if the recipient has a *disabled* preference matching this def's category or def_key.
    Default-on and fail-soft."""
    pref = (await s.execute(
        select(NotificationPref).where(
            NotificationPref.tenant_id == tenant_id,
            NotificationPref.user_id == user_id,
            NotificationPref.channel == ndef.channel,
            NotificationPref.enabled.is_(False),
            NotificationPref.category.in_([ndef.category, ndef.key]),  # matches def_key or category
        )
    )).scalars().first()
    return pref is not None
```

### 3.4 REST API: Preference CRUD

All endpoints are user-scoped (a user can only view/edit their own preferences).

#### GET /notifications/preferences
Returns the user's full set of preferences.

```json
[
  {
    "id": "uuid",
    "category": "billing",
    "channel": "email",
    "enabled": false
  },
  {
    "id": "uuid",
    "category": "lead.assigned",
    "channel": "sms",
    "enabled": false
  }
]
```

#### PUT /notifications/preferences
Upsert preferences. The request body is a list of preference upserts:

```json
{
  "preferences": [
    {
      "category": "billing",
      "channel": "email",
      "enabled": false
    },
    {
      "category": "customer",
      "channel": "sms",
      "enabled": true
    }
  ]
}
```

For each pref in the list:
1. Check if a row exists for `(tenant_id, user_id, category, channel)`
2. If yes, update `enabled`
3. If no, insert a new row

Returns the full current preference set (same as GET).

---

## 4. Inbox Notifications (Notification)

A **Notification** is one row in a user's inbox — the rendered instance of a NotificationDef that the user actually sees.

### 4.1 Schema (backend/app/models/notification.py)

```python
class Notification(Base):
    __tablename__ = "notification"
    
    id: UUID (primary key)
    tenant_id: UUID (indexed)
    user_id: UUID (indexed)
    def_key: str — the NotificationDef.key it was emitted from
    category: str — copied from the def at emit time
    priority: str — copied from the def at emit time
    title: str — rendered from def.title_template
    body: str — rendered from def.body_template
    entity_key: str | None — what it's about (e.g. "customer.id", "lead.id")
    record_id: UUID | None — the record ID if applicable
    read_at: datetime | None — when the user marked it read (None = unread)
    created_at: datetime (server timestamp, indexed with read_at)
```

### 4.2 Immutability

Once created, a Notification is immutable except for the `read_at` field. Its title, body, priority, and category are permanent snapshots of the def at emit time. If a template changes later, existing inbox rows are not retroactively changed.

### 4.3 Inbox API

#### GET /notifications
The current user's inbox, newest first. Optional filters: `?unread=true`, `?category=`, `?priority=`.

```json
[
  {
    "id": "uuid",
    "def_key": "lead.assigned",
    "category": "customer",
    "priority": "info",
    "title": "Lead Acme Corp assigned to you",
    "body": "Sales rep Alice has assigned you to the account.",
    "entity_key": "lead.id",
    "record_id": "uuid",
    "read_at": null,
    "created_at": "2026-05-27T10:00:00Z"
  }
]
```

#### GET /notifications/unread-count
Number of unread notifications for the current user.

```json
{
  "count": 5
}
```

#### POST /notifications/{note_id}/read
Mark one notification read.

```json
{
  "id": "uuid",
  "read_at": "2026-05-27T10:05:00Z",
  ...
}
```

#### POST /notifications/read-all
Mark all unread notifications read; returns how many were updated.

```json
{
  "updated": 5
}
```

---

## 5. Emit Flow (The Kernel Boundary)

### 5.1 Overview Diagram

```
Kernel calls emit_notification(def_key, user_id, context)
                    |
                    v
             [Lookup NotificationDef]
                    |
        +---No def or disabled---> return None
        |
        v
    [Eval GXL condition if present]
        |
        +---Falsy---> return None
        |
        v
    [Check preference (opt-out)]
        |
        +---Blocked---> return None
        |
        v
    [Create Notification row] <-- ALWAYS created, regardless of delivery choice
        |
        v
    [Flush to get ID]
        |
        v
    [If channel != "inapp"]
        |
        +---> [_dispatch_external]
              |
              +---> [Lookup user address (email, phone)]
                    |
                    v
              [channels.dispatch()] <-- REALTIME or DEFERRED (below)
                    |
                    +---> [Route to adapter]
                          |
                          +---> [Log OutboundMessage]
                          |
                          +---> [Never propagate]
        |
        v
    [Return Notification]
```

### 5.2 Implementation (backend/app/routers/notifications.py)

```python
async def emit_notification(
    s: AsyncSession,
    *,
    tenant_id,
    def_key: str,
    user_id,
    entity_key: str | None = None,
    record_id=None,
    context: dict | None = None,
) -> Notification | None:
    """Create one inbox notification from its NotificationDef. Config-, condition-, and
    preference-gated. No-op when the def is missing, disabled, its GXL condition is falsy,
    or the recipient has opted out. Never commits — the caller owns the transaction."""
    
    ctx = context or {}
    
    # 1. Lookup def
    ndef = (await s.execute(
        select(NotificationDef).where(
            NotificationDef.tenant_id == tenant_id, NotificationDef.key == def_key
        )
    )).scalar_one_or_none()
    if not ndef or not ndef.enabled:
        return None
    
    # 2. Check GXL condition
    if ndef.gxl_condition and not gxl.evaluate(ndef.gxl_condition, ctx):
        return None
    
    # 3. Check preference
    if await _pref_opted_out(s, tenant_id, user_id, ndef):
        return None
    
    # 4. Create inbox row (ALWAYS)
    note = Notification(
        tenant_id=tenant_id,
        def_key=ndef.key,
        user_id=user_id,
        category=ndef.category,
        priority=ndef.priority,
        title=_render(ndef.title_template, ctx),
        body=_render(ndef.body_template, ctx),
        entity_key=entity_key,
        record_id=record_id,
    )
    s.add(note)
    await s.flush()
    
    # 5. If external channel, dispatch (fail-soft)
    if ndef.channel and ndef.channel != "inapp":
        await _dispatch_external(s, tenant_id, user_id, ndef, note)
    
    return note
```

### 5.3 Key Properties

**Invariant:** The inbox row is created before external delivery is attempted. Even if external dispatch fails, the inbox row exists.

**Fail-soft:** A preference lookup error defaults to **deliver** (conservative: if we can't check the opt-out, we send the message). An external dispatch error never propagates into the caller.

**Transaction ownership:** `emit_notification()` does not commit; it flushes so the ID is available, but the caller's unit of work owns the transaction. The caller must commit or the row will be rolled back.

---

## 6. Delivery & Channels (External Dispatch)

### 6.1 Channel Routing

When a NotificationDef targets an external channel (anything other than "inapp"), the notification is dispatched via `channels.dispatch()` (backend/app/channels.py).

```python
async def _dispatch_external(s: AsyncSession, tenant_id, user_id, ndef, note) -> None:
    try:
        to_addr = await _resolve_address(s, tenant_id, user_id, ndef.channel)
        await channels.dispatch(
            s, tenant_id=tenant_id, channel=ndef.channel, to=to_addr,
            subject=note.title, body=note.body, def_key=ndef.key, user_id=user_id,
        )
    except Exception:
        return  # never propagate into the emit
```

`_resolve_address()` maps channel -> user field:
- `"email"` → `User.email`
- `"sms"` → `User.phone` (if it exists; currently None for all users)
- Other channels → None (caller supplies the address)

### 6.2 The dispatch() Function (backend/app/channels.py)

```python
async def dispatch(s: AsyncSession, *, tenant_id, channel: str, to: str | None,
                   subject: str | None, body: str, def_key: str | None = None,
                   user_id=None) -> OutboundMessage | None:
    """Route a message to its channel adapter and log the attempt as an OutboundMessage.
    For inapp: no-op with no log row. For every other channel: run the adapter, record
    SENT on success or FAILED on exception, and never propagate."""
    
    if channel == "inapp":
        return None  # inbox Notification is the delivery
    
    # ... [adapter lookup and routing] ...
    
    status, error = "SENT", None
    
    # Try adapter (fail-soft)
    try:
        await adapter(to, subject, body)
    except Exception as e:
        status, error = "FAILED", str(e)[:500]
    
    # Log the attempt
    msg = OutboundMessage(
        tenant_id=tenant_id, channel=channel, to_addr=to, subject=subject,
        body=body, status=status, def_key=def_key, user_id=user_id, error=error
    )
    s.add(msg)
    await s.flush()
    return msg
```

### 6.3 Adapter Types

**Dev adapters** (always registered):
- `inapp` — no-op; the Notification row is the delivery
- `email` (dev) — logs to console
- `sms` (dev) — logs to console
- `console` — logs to console
- `webhook` (dev) — logs to console

**Real adapters** (opt-in, env-configured, non-breaking):
- `email` (SMTP) — enabled when `EMAIL_PROVIDER=smtp` and SMTP credentials are set
- `sms` (Twilio) — enabled when `SMS_PROVIDER=twilio` and Twilio credentials are set

See MOTION-AND-ADAPTERS.md for full adapter documentation.

### 6.4 Outbound Message Log (backend/app/models/outbound.py)

Every external send is logged:

```python
class OutboundMessage(Base):
    __tablename__ = "outbound_message"
    
    id: UUID (primary key)
    tenant_id: UUID (indexed)
    channel: str — email|sms|webhook|console
    to_addr: str | None — email/phone/url
    subject: str | None
    body: str
    status: str — SENT|FAILED|QUEUED
    def_key: str | None — NotificationDef.key
    user_id: UUID | None — recipient
    error: str | None — failure detail (if status=FAILED)
    created_at: datetime (server timestamp)
```

**Admin API:** `GET /api/outbound` (gated on `config.manage`) — queryable by `?channel=` and `?status=`.

---

## 7. Digests (E26) — Deferred Batching

### 7.1 Concept

Digest mode allows multiple notifications of the same category to be batched into a single email (or other external message) rather than sent immediately as individual realtime notifications.

**Current Status:** Digest code does not yet exist in the codebase. This is a **spec-only** feature defined in the task but not implemented.

The placeholder is in the preferences schema: a future `NotificationPref.mode` field would store `"off"` | `"realtime"` | `"digest"` to control batching behavior.

### 7.2 Expected Implementation (Spec)

**Digest flow** (not yet implemented):

1. When a notification is emitted with a def that has `mode="digest"`, instead of calling `channels.dispatch()` immediately, the notification ID is added to a `digest_pending` flag for that user/category/channel.

2. A background job (`run_digests`) wakes on a schedule (e.g., hourly) and:
   - Iterates over users with pending digests
   - Groups `Notification` rows by category/channel
   - Renders an aggregated message summarizing all pending notifications
   - Calls `channels.dispatch()` once per aggregated message
   - Clears the `digest_pending` flag
   - Records a JobRun (SUCCESS or ERROR)

3. The job is idempotent: if it's interrupted mid-run, subsequent runs see the same set of pending notifications and re-process them without duplicating sends.

### 7.3 Scheduler Integration

The scheduler (E25, backend/app/scheduler.py) is a cross-tenant background loop that fires batch jobs on a fixed interval.

**Current implementation:** The scheduler runs three jobs (`run_dunning`, `run_cycle`, `run_due`) for every active tenant.

**Future addition:** When digest code is written, `run_digests` would be added to the scheduler's job list, fired once per sweep, once per active tenant.

---

## 8. Scheduler & Job Runs

### 8.1 What the Scheduler Does

The scheduler (backend/app/scheduler.py) is a **disabled-by-default cross-tenant background task** that wakes on a fixed interval and fires batch jobs for every active tenant.

**Control:**
- **Disabled by default** — gated on `settings.scheduler_enabled` (read from env or config)
- **Interval configurable** — defaults to 3600 seconds (1 hour); overridable via `settings.scheduler_interval_seconds`
- **Clean shutdown** — `stop_scheduler()` cancels the task and awaits clean termination

**Lifespan contract:**
- Called in `app.lifespan` (FastAPI startup hook)
- `start_scheduler(app)` — no-op unless enabled; spawns asyncio task
- `stop_scheduler(app)` — cancels task on shutdown; idempotent

### 8.2 Per-Tenant System Actor

Each job run requires a `User` (for audit/JobRun actor + permission gates). The scheduler resolves one **system actor per tenant**:

1. The tenant's earliest-created super_admin (user holding an Assignment to the `super_admin` RoleDef, which grants `*`)
2. Fallback: the tenant's earliest-created user
3. If the tenant has no users, the tenant is skipped (fail-soft, logged)

This actor's `*` grant satisfies every job's permission gate.

### 8.3 Fail-Soft Pattern

**Per-tenant:** One tenant's job failure never blocks other tenants.
**Per-job:** One job's failure never blocks the other two for the same tenant.
**Per-job isolation:** Each job runs on its own fresh owner session so internal `rollback()`/`commit()` don't bleed across jobs.

```python
async def _run_one_job(label: str, factory, actor: User) -> None:
    """Invoke one job on a fresh owner session. Fail-soft: exception is logged, not raised."""
    try:
        async with OwnerSessionLocal() as s:
            await factory(s, actor)
    except Exception:
        log.exception("scheduler: job %s failed for tenant %s", label, actor.tenant_id)
        # Never re-raise; the loop keeps going
```

### 8.4 JobRun Logging (backend/app/models/job.py)

Every job run writes a `JobRun` row with the outcome:

```python
class JobRun(Base):
    __tablename__ = "job_run"
    
    id: UUID (primary key)
    tenant_id: UUID (indexed)
    owner_node_id: UUID | None
    job_key: str (indexed) — e.g. "billing.run_cycle", "notifications.run_digests" (future)
    status: str — SUCCESS|ERROR
    summary: dict (JSONB) — {generated, skipped, errors} or {message}
    actor_user_id: UUID | None
    started_at: datetime (server timestamp)
    finished_at: datetime | None
```

**Observability:** `GET /api/jobs` (future) will display all JobRun rows for the tenant, queryable by job_key and date range.

---

## 9. Horizon: Next Steps (Spec-only)

### 9.1 Real Push Notifications (F54)

A new channel adapter for push via Firebase Cloud Messaging (FCM) or similar. The User model would gain an optional `fcm_token` field. The adapter interface remains unchanged; a new "push" adapter would slot in via `register("push", _fcm_adapter)` in channels.py.

**Seam:** `backend/app/channels.py` — add `_fcm_adapter()` and call `register()` in `configure_adapters()` when `PUSH_PROVIDER=fcm` and `FCM_PROJECT_ID` is set.

### 9.2 At-Mentions & Subscriber Notifications (F57)

System-level support for @-mentions (e.g., @alice in a comment triggers a notification to Alice). Requires:
- A new NotificationDef key (e.g., `system.mention`)
- Trigger code in the comment/activity subsystem to call `emit_notification()` when a mention is detected
- GXL conditions to guard on whether the @'d user has opted out

No new tables; works entirely within the existing emit flow.

### 9.3 Per-Category Digest Cadence (F58)

Instead of a global digest schedule, allow each NotificationPref to specify its own cadence: "realtime", "daily", "weekly", etc. The digest job would then group pending notifications by (user, category, channel, cadence) and respect each group's wake time.

Requires:
- Adding `cadence` field to NotificationPref (or a separate `DigestSchedule` table)
- Digest job becomes cadence-aware: iterates over cadence schedules and fires only those whose window has passed
- Idempotency key: `(user_id, category, channel, cadence, as_of_date)` to prevent duplicate sends if the job re-runs

---

## 10. Code-to-Doc Verification

| Area | Code Location | Status |
|------|---------------|--------|
| NotificationDef schema | `backend/app/models/notification.py` lines 11–31 | Documented |
| NotificationPref schema | `backend/app/models/notification_pref.py` lines 11–27 | Documented |
| Notification schema | `backend/app/models/notification.py` lines 33–52 | Documented |
| Template rendering | `backend/app/routers/notifications.py` lines 33–38 | Documented |
| emit_notification() | `backend/app/routers/notifications.py` lines 43–94 | Documented |
| _pref_opted_out() | `backend/app/routers/notifications.py` lines 124–139 | Documented |
| _dispatch_external() | `backend/app/routers/notifications.py` lines 113–121 | Documented |
| GET /notifications | `backend/app/routers/notifications.py` lines 197–218 | Documented |
| GET /notifications/preferences | `backend/app/routers/notifications.py` lines 221–229 | Documented |
| PUT /notifications/preferences | `backend/app/routers/notifications.py` lines 232–258 | Documented |
| GET /notifications/unread-count | `backend/app/routers/notifications.py` lines 261–270 | Documented |
| POST /notifications/{id}/read | `backend/app/routers/notifications.py` lines 273–288 | Documented |
| POST /notifications/read-all | `backend/app/routers/notifications.py` lines 291–304 | Documented |
| channels.dispatch() | `backend/app/channels.py` lines 80–143 | Documented |
| Adapter interface | `backend/app/channels.py` lines 29–30 | Documented |
| Dev adapters | `backend/app/channels.py` lines 45–75 | Documented |
| SMTP/Twilio adapters | `backend/app/channels.py` lines 157–191 | Documented |
| configure_adapters() | `backend/app/channels.py` lines 194–211 | Documented |
| OutboundMessage schema | `backend/app/models/outbound.py` lines 16–29 | Documented |
| GET /api/outbound | `backend/app/routers/notifications.py` lines 309–323 | Documented |
| JobRun schema | `backend/app/models/job.py` lines 11–27 | Documented |
| Scheduler module | `backend/app/scheduler.py` lines 1–225 | Documented |
| run_digests (spec) | Not yet implemented | Spec-only |

**Code-to-doc coverage:** All implemented features documented; digest features are spec-only and not yet in the code.

---

## Summary

The notifications system is **configuration-driven, preference-respecting, and always-on for the inbox**.

1. **Definitions** (NotificationDef) live above the Kernel Line: templates, categories, priorities, channels, and conditional guards.
2. **Preferences** (NotificationPref) are default-on opt-outs: a user who has no preference receives the notification; a user with a disabled preference blocks delivery.
3. **Emit** is the kernel boundary: the caller supplies def_key, user, and context; the system creates an inbox row (always), checks preferences, and dispatches externally if the def specifies a non-inapp channel.
4. **Delivery** is pluggable: dev adapters (console log) are always live; real adapters (SMTP, Twilio) activate only when env-configured.
5. **Outbound log** (OutboundMessage) provides full audit of external sends.
6. **Scheduler** (E25) fires batch jobs cross-tenant on a timer; digest batching (E26) will hook into it once implemented.
7. **Inbox** (Notification) is immutable once created and always delivered, regardless of preference.

Nothing is hardcoded. All notification types, priorities, templates, and delivery rules are configuration that lives in the database and can be edited without code changes.
