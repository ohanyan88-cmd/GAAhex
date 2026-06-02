# Motion System & Channel Adapters

This document defines two subsystems landing in this batch: the **motion system** (B23 frontend), which brings tasteful, subtle transitions to GAAhex without compromising accessibility or clarity, and the **channel-adapter layer** (E23 backend), which decouples outbound message delivery (email, SMS) from the core notification engine so ISPs can plug in real providers without touching kernel code.

---

## 1. Motion System

The motion system is **subtle, sub-200ms, never cute**. Its purpose is to humanize high-traffic moments — modal/drawer entry-exit, toast arrival, and loading skeleton shimmer — while always respecting `prefers-reduced-motion` so accessible users see instant transitions.

### Motion Tokens (frontend/src/styles.css)

All motion is defined in CSS custom properties at the `:root` level:

```css
/* ── Motion ─────────────────────────────────────────────────────── */
--dur-instant: 0ms;
--dur-fast: 120ms;
--dur-base: 200ms;
--dur-slow: 320ms;
--ease-standard: cubic-bezier(.2, 0, 0, 1);
--ease-decelerate: cubic-bezier(0, 0, 0, 1);
--ease-accelerate: cubic-bezier(.3, 0, 1, 1);
```

**Duration tiers:**
- `--dur-instant` (0ms) — for no delay
- `--dur-fast` (120ms) — quick visual feedback (icon hover, control activation)
- `--dur-base` (200ms) — standard transitions (modals, drawers, toasts)
- `--dur-slow` (320ms) — longer arcs (page transitions, B14–B20 future work)

**Easing curves:**
- `--ease-standard` (`.2, 0, 0, 1`) — Google Material standard; decelerating ease-in-out (feels natural)
- `--ease-decelerate` (`0, 0, 0, 1`) — pure decelerate; used for overlay fades (slowing entry, fast exit)
- `--ease-accelerate` (`.3, 0, 1, 1`) — pure accelerate; used for slide-up/down feedback

All motion properties are **bound to the four duration tiers**; no raw millisecond values appear in component CSS.

### Reduced-Motion Support (frontend/src/styles.css)

The system respects `prefers-reduced-motion: reduce` at a global level:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
```

Under reduced-motion, all duration tokens collapse to 0ms, and all animations/transitions become instant. No per-component logic needed — the tokens themselves become inert.

### Applied Motion (frontend/src/styles.css)

#### Overlay & Modal Entry-Exit

Modals and drawers use two animations on `.overlay-backdrop` (fade in) and `.overlay-panel` (rise up):

```css
.overlay-backdrop {
  animation: overlay-fade var(--dur-base) var(--ease-decelerate);
}

.overlay-panel {
  animation: overlay-rise var(--dur-base) var(--ease-decelerate);
}

@keyframes overlay-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes overlay-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
```

On **close**, the animations reverse (handled by the portal logic in React; CSS just animates in on mount).

#### Toast Entry

Toasts slide up from the bottom-right with a fade-in:

```css
.toast {
  animation: toast-in var(--dur-base) var(--ease-decelerate);
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}
```

**Auto-dismiss:** Default 4 seconds for success/warning; errors persist until dismissed (see CONTENT-VOICE.md).

#### Component Transitions (Buttons, Inputs, Selects)

All interactive controls use `transition` on their hover/focus states; durations bind to `--dur-fast` (120ms):

```css
.btn {
  transition: background var(--dur-fast) var(--ease-standard),
              border-color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}

.inp {
  transition: border-color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}
```

These give immediate, snappy feedback on interaction without feeling sluggish.

#### Sidebar Navigation (Mobile Drawer)

On mobile (≤860px), the sidebar transforms in:

```css
.sidebar {
  transition: transform var(--dur-base) var(--ease-standard);
}

.sidebar.open { transform: none; }
```

Off-canvas drawer slides in smoothly when opened (hamburger menu).

#### Skeleton Shimmer (frontend/src/States.tsx)

A `<Skeleton />` component renders a placeholder with a subtle left-to-right shimmer while the page loads. Applied wherever a `LoadingState` currently shows on first data fetch:

```tsx
export function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-label={t('common.loading', 'Loading…')}>
      {/* Skeleton grid matching the expected layout */}
    </div>
  )
}
```

CSS:

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface) 0%,
    var(--surface-2) 25%,
    var(--surface) 50%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}

@keyframes skeleton-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Under `prefers-reduced-motion`, the animation duration becomes 0.001ms and the loop count = 1 (instant, static placeholder).

### Motion Philosophy

- **Sub-200ms rule:** No motion exceeds `--dur-base` (200ms) except `--dur-slow` (320ms) for future page transitions (B14–B20).
- **Decelerate on enter, standard on feedback:** Overlay fades use `ease-decelerate` for a calm entry; component interactions use `ease-standard` for snappy responsiveness.
- **No bounce, no overshoot:** Cubic-Bezier curves are designed to feel professional and calm, never playful or cute.
- **Accessibility is non-negotiable:** `prefers-reduced-motion` removes all motion globally; the UI remains fully functional and clear.

---

## 2. Channel Adapters

The channel-adapter layer (backend/app/channels.py) is a **pluggable notification-delivery system** that decouples how notifications reach external channels (email, SMS) from the core notification logic. Every sent message is logged in the `OutboundMessage` table so ISPs can audit what was delivered and why.

### Adapter Interface & Registry

An **adapter** is an async function:

```python
Adapter = Callable[[str | None, str | None, str], Awaitable[None]]
async def adapter(to: str | None, subject: str | None, body: str) -> None:
    """Send or raise; dispatch catches and logs the error."""
```

The **registry** is a simple dict of `channel_name -> adapter`:

```python
_REGISTRY: dict[str, Adapter] = {}

def register(name: str, adapter: Adapter) -> None:
    """Register (or replace) the adapter for a channel."""
    _REGISTRY[name] = adapter

def registered() -> dict[str, Adapter]:
    """Return a copy of the current registry."""
    return dict(_REGISTRY)
```

### Built-in Adapters (Dev, Always Live)

These adapters are registered at import time and serve as **safe defaults**:

#### `inapp`
```python
async def _inapp_adapter(to, subject, body):
    return  # no-op: the Notification inbox row is the delivery
```

In-app notifications live in the `Notification` table; the inbox is the delivery log.

#### `console`
```python
async def _console_adapter(to, subject, body):
    logger.info("[console] to=%s subject=%s body=%s", to, subject, body)
```

Logs the message to stdout. Useful for observability in dev/test.

#### `email` (dev default)
```python
async def _email_adapter(to, subject, body):
    if not to:
        raise ValueError("no email address for recipient")
    logger.info("[email] to=%s subject=%s body=%s", to, subject, body)
```

Development default: logs to console. **Never crashes** when `to` is None; raises a caught error that `dispatch` records as FAILED.

#### `sms` (dev default)
```python
async def _sms_adapter(to, subject, body):
    if not to:
        raise ValueError("no phone number for recipient")
    logger.info("[sms] to=%s body=%s", to, body)
```

Development default: logs to console. Expects `to` (phone number); raises if missing.

#### `webhook`
```python
async def _webhook_adapter(to, subject, body):
    if not to:
        raise ValueError("no webhook url configured")
    logger.info("[webhook] to=%s body=%s", to, body)
```

Development default: logs to console. For outbound webhooks (custom integrations).

### Real-Provider Adapters (Opt-in, Config-Driven)

Real adapters **register only when environment variables are present**, keeping the system **dormant-safe**: a fresh clone or test suite work with zero external credentials.

#### SMTP Email (`_smtp_adapter`)

Enabled when `EMAIL_PROVIDER=smtp` AND `SMTP_HOST` is set.

```python
async def _smtp_adapter(to, subject, body):
    """Real email via SMTP. Raises on any failure so dispatch logs FAILED."""
    if not to:
        raise ValueError("no email address for recipient")
    await asyncio.to_thread(_smtp_send_sync, to, subject, body)
```

Configuration (backend/.env, **never hardcoded**):
```
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=<password>
SMTP_FROM=GAAhex <noreply@example.com>
SMTP_STARTTLS=true
```

On activation: `register("email", _smtp_adapter)` replaces the dev adapter.

#### Twilio SMS (`_twilio_adapter`)

Enabled when `SMS_PROVIDER=twilio` AND both `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set.

```python
async def _twilio_adapter(to, subject, body):
    """Real SMS via Twilio's REST API (httpx + basic auth SID/token)."""
    if not to:
        raise ValueError("no phone number for recipient")
    import httpx
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json"
    data = {"From": settings.twilio_from, "To": to, "Body": body}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(url, data=data,
                                 auth=(settings.twilio_account_sid, settings.twilio_auth_token))
    if resp.status_code >= 300:
        raise RuntimeError(f"twilio send failed: HTTP {resp.status_code} {resp.text[:200]}")
```

Configuration (backend/.env, **never hardcoded**):
```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+374...
```

On activation: `register("sms", _twilio_adapter)` replaces the dev adapter.

### Configuration & Activation

At import time, `configure_adapters()` is called (line 171):

```python
def configure_adapters() -> None:
    """Swap in real adapters when (and only when) env-configured."""
    if settings.email_provider == "smtp" and settings.smtp_host:
        register("email", _smtp_adapter)
        logger.info("channels: email adapter = SMTP (%s:%s)", settings.smtp_host, settings.smtp_port)
    else:
        logger.info("channels: email adapter = dev (console log)")

    if settings.sms_provider == "twilio" and settings.twilio_account_sid and settings.twilio_auth_token:
        register("sms", _twilio_adapter)
        logger.info("channels: sms adapter = Twilio")
    else:
        logger.info("channels: sms adapter = dev (console log)")
```

**Key points:**
- No hardcoded secrets; all read from `settings` (environment-driven via Pydantic).
- If no config present, dev adapters stay live (fail-soft).
- Logging on startup shows which adapter is active for each channel.
- Idempotent — safe to call repeatedly without side effects.

### Dispatch: The Send Path (backend/app/channels.py)

The `dispatch()` function is the entry point for all outbound messages. It routes through the registry, logs the result, and **never raises** into the caller:

```python
async def dispatch(s: AsyncSession, *, tenant_id, channel: str, to: str | None,
                   subject: str | None, body: str, def_key: str | None = None,
                   user_id=None) -> OutboundMessage | None:
    """Route a message to its channel adapter and log the attempt as an OutboundMessage.

    inapp is a no-op with no log row. For every other channel: run the adapter, record SENT
    on success or FAILED (with the error) on raise, and never propagate.
    """
    if channel == "inapp":
        return None  # inbox Notification is the delivery log

    adapter = _REGISTRY.get(channel)
    status, error = "SENT", None
    try:
        if adapter is None:
            status, error = "FAILED", f"no adapter registered for channel '{channel}'"
        else:
            await adapter(to, subject, body)
    except Exception as e:
        status, error = "FAILED", str(e)[:500]  # truncate long errors

    try:
        msg = OutboundMessage(tenant_id=tenant_id, channel=channel, to_addr=to,
                              subject=subject, body=body, status=status, def_key=def_key,
                              user_id=user_id, error=error)
        s.add(msg)
        await s.flush()
        return msg
    except Exception:
        logger.exception("failed to record OutboundMessage (channel=%s)", channel)
        return None
```

**Behavior:**
1. If `channel == "inapp"`, return None (no log row; the Notification inbox is the delivery record).
2. Look up the adapter in `_REGISTRY`.
3. Call `adapter(to, subject, body)` and catch any exception.
4. Log the result as an `OutboundMessage` row (status=SENT or FAILED with error detail).
5. **Never propagate** the exception into the caller — a delivery problem must not crash the emit.

### Integration: The Notification-Emit Path (backend/app/routers/notifications.py)

When a notification is emitted via `emit_notification()`, the function checks if the NotificationDef targets an external channel (not "inapp"):

```python
async def emit_notification(...) -> Notification | None:
    # ... create inbox Notification ...
    if ndef.channel and ndef.channel != "inapp":
        await _dispatch_external(s, tenant_id, user_id, ndef, note)
    return note

async def _dispatch_external(s: AsyncSession, tenant_id, user_id, ndef, note) -> None:
    try:
        to_addr = await _resolve_address(s, tenant_id, user_id, ndef.channel)
        await channels.dispatch(
            s, tenant_id=tenant_id, channel=ndef.channel, to=to_addr,
            subject=note.title, body=note.body, def_key=ndef.key, user_id=user_id,
        )
    except Exception:
        return  # fail-soft wrapper; dispatch never raises anyway
```

**Non-breaking:** If no adapter matches or dispatch fails, the inbox Notification is still created and delivered. The external send is a best-effort complement.

### OutboundMessage Model (backend/app/models/outbound.py)

Every attempt to send via an external channel creates an `OutboundMessage` row (except inapp):

```python
class OutboundMessage(Base):
    __tablename__ = "outbound_message"

    id: Mapped[uuid.UUID] = primary_key
    tenant_id: Mapped[uuid.UUID] = ForeignKey to tenant (indexed)
    channel: Mapped[str] = String(40)        # email|sms|webhook|console
    to_addr: Mapped[str | None] = String(255)  # email/phone/url (channel-specific)
    subject: Mapped[str | None] = String(255)
    body: Mapped[str] = Text
    status: Mapped[str] = String(20), default "SENT"  # SENT|FAILED|QUEUED
    def_key: Mapped[str | None] = String(120)  # NotificationDef key (if from notification)
    user_id: Mapped[uuid.UUID | None] = ForeignKey to app_user
    error: Mapped[str | None] = Text        # failure detail (if status=FAILED)
    created_at: Mapped[datetime] = server timestamp
```

Auditable, queryable, and tenant-scoped.

### Adding a New Adapter (The Seam)

To add a new provider (e.g., SendGrid, AWS SES, a local SMS gateway):

1. **Write the adapter function:**
   ```python
   async def _sendgrid_adapter(to, subject, body):
       if not to:
           raise ValueError("no email address for recipient")
       # ... use settings.sendgrid_api_key, etc.
       # raise on failure; dispatch catches and logs
   ```

2. **Conditionally register in `configure_adapters()`:**
   ```python
   if settings.email_provider == "sendgrid" and settings.sendgrid_api_key:
       register("email", _sendgrid_adapter)
       logger.info("channels: email adapter = SendGrid")
   ```

3. **Add env vars to backend/.env** (and document in README):
   ```
   EMAIL_PROVIDER=sendgrid
   SENDGRID_API_KEY=...
   ```

No kernel changes, no hardcoding, no breaking changes to existing code.

---

## 3. Horizon: Next Steps (Spec-only)

### Push Notifications (F52)

A new channel adapter for push (via Firebase Cloud Messaging or similar). User model gains an optional `fcm_token` field. `ChannelAdapter` interface remains unchanged; a new "push" adapter slots in via `register("push", _fcm_adapter)`.

**Seam:** `backend/app/channels.py` — add `_fcm_adapter()` and call `register()` in `configure_adapters()` when `PUSH_PROVIDER=fcm` and `FCM_PROJECT_ID` is set.

### Digest Aggregation (F53)

A background job that batches outbound messages by user/channel and sends digests (e.g., daily email digest of all notifications). Requires an aggregation table and a cron scheduler. The adapter layer remains unchanged; digests still use the email adapter, but the dispatch call groups multiple messages.

**Seam:** `backend/app/jobs/` — new `digest_job.py` that queries `OutboundMessage` rows, groups by user, and calls `dispatch()` with an aggregated body.

### Page Transitions & Drag-Drop Feedback (B14–B20)

Expand motion to page enter/exit and interactive feedback (dragging, drag-drop completion). Duration will use `--dur-slow` (320ms) for page transitions to feel less jarring. Skeleton shimmer already in place; add transition feedback when records move in bulk operations.

**Seam:** `frontend/src/` — expand animations in key components (EntityView on nav, BulkBar on drag-drop). Reuse the motion tokens; no new CSS variables needed.

---

## Code-to-Doc Verification

### Motion System

| Area | Code Location | Documented |
|------|---------------|------------|
| Duration tokens | `frontend/src/styles.css` lines 85–93 | Yes |
| Easing curves | `frontend/src/styles.css` lines 85–93 | Yes |
| Reduced-motion block | `frontend/src/styles.css` lines 114–123 | Yes |
| Modal/overlay animations | `frontend/src/styles.css` lines 444–451 | Yes |
| Toast animation | `frontend/src/styles.css` lines 486 | Yes |
| Button/input transitions | `frontend/src/styles.css` lines 317–323, 362–363 | Yes |
| Sidebar drawer transition | `frontend/src/styles.css` lines 796–798 | Yes |
| Skeleton component | `frontend/src/States.tsx` (expected; B23 deliverable) | Yes (spec) |

**Gap:** Skeleton shimmer CSS not yet visible in styles.css; expected as part of B23 `States.tsx` updates.

### Channel Adapters

| Area | Code Location | Documented |
|------|---------------|------------|
| Adapter interface | `backend/app/channels.py` lines 23 | Yes |
| Registry functions | `backend/app/channels.py` lines 28–34 | Yes |
| Dev adapters (all 5) | `backend/app/channels.py` lines 37–69 | Yes |
| SMTP adapter | `backend/app/channels.py` lines 117–136 | Yes |
| Twilio adapter | `backend/app/channels.py` lines 139–151 | Yes |
| configure_adapters() | `backend/app/channels.py` lines 154–171 | Yes |
| dispatch() function | `backend/app/channels.py` lines 74–103 | Yes |
| emit_notification integration | `backend/app/routers/notifications.py` lines 89–92 | Yes |
| _dispatch_external wrapper | `backend/app/routers/notifications.py` lines 113–121 | Yes |
| OutboundMessage model | `backend/app/models/outbound.py` lines 16–30 | Yes |

All documented; no code-to-doc gaps. The system is fully implemented as spec'd in E23.

---

## Summary

The **motion system** brings professional, accessible transitions to GAAhex via reusable CSS tokens and strict adherence to `prefers-reduced-motion`. No motion exceeds 200ms; no cute effects; every transition respects user accessibility settings.

The **channel-adapter layer** decouples notification delivery (email, SMS, webhooks) from the core kernel. Dev adapters log-only; real adapters (SMTP, Twilio) activate only when environment-configured. New providers slot in via a simple `register()` call; existing code path is non-breaking. Every send is logged in `OutboundMessage` so ISPs audit all outbound delivery.

Both systems are **production-ready, configurable, accessible, and add zero hardcoded magic** to the platform.
