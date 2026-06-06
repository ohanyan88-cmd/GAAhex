# M1-C Environment Variables

This is the complete `.env` shape for Portal's vendor integrations. Copy the
block below into your local `.env` file and populate as you acquire each
vendor's credentials.

The four frameworks all share the same shape:

- A `*_PROVIDER` switch (`mock` keeps the in-memory adapter; the vendor name
  switches to the real adapter).
- Vendor credentials (API keys / shared secrets).
- A signature-verification key for inbound webhooks where applicable.

If `*_PROVIDER` is set to a real vendor but its credentials are missing /
malformed, the factory logs a warning and **falls back to the mock**. The app
boots cleanly either way; you never have to populate all four to ship.

---

## Sample `.env` block (test keys)

```bash
# ─── Payment gateway: Stripe ──────────────────────────────────
PAYMENT_GATEWAY_PROVIDER=stripe        # 'mock' (dev) | 'stripe' (prod)
STRIPE_PUBLISHABLE_KEY=pk_test_xxx     # used by the frontend (Stripe Elements)
STRIPE_SECRET_KEY=sk_test_xxx          # used by the server
STRIPE_WEBHOOK_SECRET=whsec_xxx        # used to verify Stripe → us webhooks
STRIPE_API_VERSION=2024-06-20          # pinned API version

# ─── SMS gateway: Twilio ──────────────────────────────────────
SMS_GATEWAY_PROVIDER=twilio            # 'mock' | 'twilio'
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=+14155551234        # OR use a Messaging Service SID instead
TWILIO_MESSAGING_SERVICE_SID=MGxxx
TWILIO_STATUS_CALLBACK_URL=https://api.yourisp.com/api/webhooks/twilio
TWILIO_WEBHOOK_AUTH_TOKEN=xxx          # usually the same as TWILIO_AUTH_TOKEN

# ─── Email gateway: SendGrid ──────────────────────────────────
EMAIL_GATEWAY_PROVIDER=sendgrid        # 'mock' | 'sendgrid'
SENDGRID_API_KEY=SG.xxx
SENDGRID_FROM_EMAIL=billing@yourisp.com
SENDGRID_FROM_NAME=Your ISP Billing
SENDGRID_WEBHOOK_PUBLIC_KEY=xxx        # for Event Webhook ECDSA verification

# ─── RADIUS: FreeRADIUS ───────────────────────────────────────
RADIUS_BACKEND_PROVIDER=freeradius     # 'mock' | 'freeradius'
RADIUS_HOST=10.0.0.1
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_SECRET=your-shared-secret
RADIUS_NAS_IP=10.0.0.100               # our app's NAS-IP-Address attribute
RADIUS_DICTIONARY_PATH=/etc/freeradius/3.0/dictionary
```

---

## Per-vendor setup guide

### Stripe

1. Register at https://stripe.com — Test-mode credentials are free.
2. Dashboard → Developers → API keys → copy the Publishable + Secret keys.
3. Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://api.yourisp.com/api/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`,
     `charge.refunded`, `payment_method.attached`.
4. Copy the endpoint's Signing secret as `STRIPE_WEBHOOK_SECRET`.

### Twilio

1. Register at https://twilio.com — the free trial includes test SMS credit.
2. Console → Account → API keys & tokens → copy Account SID + Auth Token.
3. Console → Phone Numbers → buy a trial number → set as `TWILIO_FROM_NUMBER`.
4. Optional but recommended: Console → Messaging → Services → create a
   Messaging Service with the trial number; use the `MG...` SID as
   `TWILIO_MESSAGING_SERVICE_SID` for compliance + queue management.
5. The status callback URL Twilio uses is configured per-message via
   `TWILIO_STATUS_CALLBACK_URL` (or per-service in the console).

### SendGrid

1. Register at https://sendgrid.com — the free tier is 100 emails/day forever.
2. Settings → API Keys → create one with Mail Send + Event Webhook Stats
   permissions. Copy as `SENDGRID_API_KEY`.
3. Settings → Sender Authentication → verify a single sender
   (`billing@yourisp.com`) OR set up Domain Authentication for production.
4. Settings → Mail Settings → Event Webhook:
   - URL: `https://api.yourisp.com/api/webhooks/sendgrid`
   - Enable Signed Event Webhook → copy Public Key as
     `SENDGRID_WEBHOOK_PUBLIC_KEY`.

### FreeRADIUS

1. Install on a Linux host: `apt install freeradius freeradius-utils`.
2. Edit `/etc/freeradius/3.0/clients.conf`:
   ```
   client portal {
     ipaddr = <our app server IP>
     secret = <random 32-char secret>
   }
   ```
3. Set `RADIUS_HOST` to the FreeRADIUS server IP, `RADIUS_SECRET` to the
   same shared secret.
4. `RADIUS_NAS_IP` is the IP of our Portal API server — it goes into every
   Acct-Start / Acct-Stop packet as the `NAS-IP-Address` attribute.
5. `RADIUS_DICTIONARY_PATH` should point to the standard FreeRADIUS dictionary
   directory (varies by install — `/etc/freeradius/3.0/dictionary` on Debian).

---

## Fallback behavior

When `*_PROVIDER` is set to `mock`, OR when the corresponding `*_API_KEY` /
`*_SECRET` is missing or malformed, the factory falls back to the **Mock**
implementation with a logged warning. The app boots cleanly either way — it
never crashes on missing optional config.

That means a fresh `git clone && python -m uvicorn app.main:app` works
without any vendor account. As Gev acquires real keys, drop them into `.env`
and flip the corresponding `*_PROVIDER` to the vendor name to switch.

---

## Webhook endpoints

| Vendor | URL | Required header | Implemented in |
|---|---|---|---|
| Stripe | `POST /api/webhooks/stripe` | `Stripe-Signature` | M1-C.0 signature verify; M1-C.1 event handlers |
| SendGrid | `POST /api/webhooks/sendgrid` | `X-Twilio-Email-Event-Webhook-Signature` + `-Timestamp` | M1-C.0 signature verify; M1-C.3 event handlers |
| Twilio | `POST /api/webhooks/twilio` | `X-Twilio-Signature` | M1-C.0 signature verify; M1-C.2 status handlers |

All three live under `backend/app/routers/vendor_webhooks/` (named
`vendor_webhooks` to avoid colliding with the existing outbound webhooks
module at `backend/app/routers/webhooks.py`).

---

## Vendor SDK Python packages

These will be installed in production deploys. They're NOT in the default
Portal dev install — the lazy-import pattern means they're only needed when
you actually use the corresponding real adapter:

- `stripe`   (Stripe Python SDK)
- `twilio`   (Twilio Python SDK)
- `sendgrid` (SendGrid Python SDK)
- `pyrad`    (RADIUS client library)

To enable real-adapter testing locally:

```bash
pip install stripe twilio sendgrid pyrad
```

After installation, the mocks remain available — `*_PROVIDER` controls which
one is active at runtime.

---

## What M1-C Phase 0 ships vs what's deferred

**Phase 0 (this PR):** the four Protocol surfaces + fully-working mocks +
real-vendor skeletons (init + webhook signature verify) + the three inbound
webhook routes + the env documentation above.

**Deferred to M1-C.1 .. .4:**

- M1-C.1 Stripe: wire `vault_card` / `charge` / `refund` / `void` to real
  Stripe API calls. Wire `payment_intent.succeeded` → Invoice paid.
- M1-C.2 Twilio: wire `send` to `twilio.rest.Client(...).messages.create()`.
  Wire status callback → MassBroadcast row + outbound\_message row.
- M1-C.3 SendGrid: wire `send` to `sendgrid.SendGridAPIClient(...).send(Mail(...))`.
  Wire event webhook → MassBroadcast row + outbound\_message row.
- M1-C.4 FreeRADIUS: wire `authenticate` / `acct_start` / `acct_stop` /
  `disconnect` to `pyrad.client.Client` packets. Wire into the dunning
  runner's suspend / restore path as an alternative to `LoggingAdapter`.
