"""M1-C Phase 0 — Vendor webhook routers package.

Named ``vendor_webhooks`` (not ``webhooks``) to avoid a collision with the
existing ``app/routers/webhooks.py`` module (outbound webhook *senders* — that
module powers ``POST /api/webhooks`` for tenants to register their own URLs).
This package is for inbound webhooks *we receive* from upstream vendors.

Three routers live here, each a thin signature-verify + log + ack shell:

* ``stripe``   — Stripe payment + refund event hooks
* ``sendgrid`` — SendGrid event-webhook (delivered / bounced / opened / clicked)
* ``twilio``   — Twilio SMS status callback (delivered / failed / undelivered)

Phase-0 just verifies signatures + logs + acks 200. Phase M1-C.1/.2/.3 wires
the event payload to its domain handler (mark Invoice paid, update
MassBroadcast row, etc.).
"""
