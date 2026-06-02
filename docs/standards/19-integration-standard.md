# Integration Standard (file 19)

LOCKED. Resolves SOURCE NOT PROVIDED for **Integration** (display-order #21; file 19). Written
code-accurate against `models/webhook.py`, `models/outbound.py`, and `routers/vendor_webhooks/`.

## 1. Outbound webhooks (`webhook_def`)
A `WebhookDef` is an outbound subscription: POST a **signed** payload to `url` whenever a kernel
event of a subscribed type fires.
- `events` — JSONB list of event types; `"*"` subscribes to all.
- `secret` — the HMAC-SHA256 signing key, stored via `EncryptedString` (encrypted at rest, §4.4);
  the database never holds the plaintext. Deliveries are signed HMAC-SHA256.
- `active` toggles the subscription. Tenant-scoped (RLS).

## 2. Delivery log (`webhook_delivery`)
One row per attempted POST — the observable, queryable delivery record:
`id, tenantId, webhookId, eventName, payload, status, attempts, statusCode, error, createdAt`.
- `status ∈ QUEUED | SENT | FAILED`.
- Phase-1 records a single attempt; a queue/worker with retries is a later addition. The contract
  (one row per attempt, observable status) does not change when retries land.

## 3. Webhook payload
The signed payload carries `eventId, eventName, occurredAt, schemaVersion, correlationId` (D1
rename: `eventName`, the `<Object>.<Action>` event name; not `eventType`). Webhook event names
match the Event System (file 06).

## 4. Outbound messages — channel adapters (`outbound_message`)
Every external-channel send records one `OutboundMessage`: the observable record of what the
platform tried to send and whether it worked.
- `channel ∈ inapp | email | sms | webhook | console`.
- Fields: `to_addr, subject, body, status (SENT | FAILED | QUEUED), def_key (the NotificationDef
  it came from), user_id (recipient), error`.
- **In-app notifications are NOT logged here** — the inbox `Notification` row is itself the
  delivery (Notification Standard, file 05).

## 5. Inbound vendor webhooks (`routers/vendor_webhooks/`)
Signed inbound callbacks from providers (`stripe`, `twilio`, `sendgrid`). Each verifies the
provider's signature, is **idempotent** by the provider's event id (a replayed callback is a
no-op), and lands its effect through the normal kernel write path (events + audit), never by
bypassing invariants.

## 6. Boundaries
- Secrets at rest use `EncryptedString` (§4.4) — see Security/Permission Standard (file 17).
- An integration write obeys every §0 invariant (owner, default-deny, references-not-copies); an
  inbound callback is not a privilege escalation.
- Delivery state is always observable; integrations never silently drop.
