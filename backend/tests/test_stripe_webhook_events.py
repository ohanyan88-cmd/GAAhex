"""M1-C.1 — Stripe webhook router + event dispatcher tests.

Covers:
  * Each supported event_type maps to the right DB-state change
  * Tenant scoping: missing metadata.tenant_id → skipped
  * Idempotency: same event_id processed twice → second call returns duplicate=True
  * Signature verification failure still goes through the path (mock mode is permissive)
  * Unknown event_type → result='ignored' with no mutation

Strategy
========
The endpoint runs through ``MockPaymentGateway.verify_webhook`` (permissive — no real
signature check). We compose minimal Stripe event payloads as plain JSON dicts and POST
them to ``/api/webhooks/stripe`` via the existing test client. After each POST we open a
fresh DB session via ``OwnerSessionLocal`` to verify the side-effects landed.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.db import OwnerSessionLocal
from app.models import Payment
from app.models.billing import Invoice
from app.models.payment_method import PaymentMethod
from app.models.stripe_webhook_event import StripeWebhookEvent


# ──────────────────────────────────────────────────────────────────────────
# Fixture helpers (mirrors test_payments_ext.py style)
# ──────────────────────────────────────────────────────────────────────────


async def _customer(client, admin, name: str) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _issued_invoice(client, admin, amount: int, tag: str) -> dict:
    """customer → subscription → generate-invoice → issue. Returns the issued invoice dict."""
    cust = await _customer(client, admin, f"Cust {tag}")
    sub = (await client.post(
        "/api/subscriptions", headers=admin,
        json={"plan_name": f"Plan {tag}", "amount": amount, "cycle": "monthly", "customer_id": cust},
    )).json()
    inv = (await client.post(
        f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin,
    )).json()
    issued = (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()
    return issued


async def _post_event(client, event: dict) -> dict:
    """Post a stripe event payload through the webhook endpoint. Returns the response JSON."""
    r = await client.post(
        "/api/webhooks/stripe",
        content=json.dumps(event).encode(),
        headers={
            "Stripe-Signature": "t=0,v1=mock",
            "Content-Type": "application/json",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()


async def _admin_tenant_id(admin) -> uuid.UUID:
    """Pull the tenant id off the JWT subject — admin user's tenant for the duration of the suite."""
    # The admin client carries a Bearer JWT; the test isolated DB has exactly one tenant
    # (the demo-loop seed), so any tenant row is the right one.
    from app.models import Tenant
    async with OwnerSessionLocal() as s:
        t = (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first()
    return t.id


# ──────────────────────────────────────────────────────────────────────────
# payment_intent.succeeded
# ──────────────────────────────────────────────────────────────────────────


async def test_payment_intent_succeeded_creates_payment_and_pays_invoice(client, admin):
    """The handler should write a Payment row, flip the Invoice to PAID, and ack handled."""
    inv = await _issued_invoice(client, admin, 5000, "pi_success")
    tenant_id = await _admin_tenant_id(admin)

    event_id = f"evt_test_{uuid.uuid4().hex[:8]}"
    intent_id = f"pi_test_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": intent_id,
                "amount_received": 5000,
                "amount": 5000,
                "currency": "amd",
                "metadata": {
                    "tenant_id": str(tenant_id),
                    "invoice_id": inv["id"],
                    "customer_ref": inv["customer_id"],
                },
            }
        },
    }
    resp = await _post_event(client, event)
    assert resp["received"] is True
    assert resp["result"] == "handled"

    # Verify the Payment row landed AND the invoice flipped to PAID.
    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pay = (await s.execute(
            select(Payment).where(Payment.invoice_id == uuid.UUID(inv["id"]))
        )).scalars().all()
        assert len(pay) == 1
        assert pay[0].amount == 5000
        assert pay[0].method == "card"
        assert pay[0].note == f"stripe:{intent_id}"
        inv_row = (await s.execute(
            select(Invoice).where(Invoice.id == uuid.UUID(inv["id"]))
        )).scalar_one()
        assert inv_row.status == "PAID"

    # Audit row present + result='handled'.
    async with OwnerSessionLocal() as s:
        audit = (await s.execute(
            select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
        )).scalar_one()
        assert audit.result == "handled"
        assert audit.event_type == "payment_intent.succeeded"
        assert audit.tenant_id == tenant_id


async def test_payment_intent_succeeded_missing_metadata_is_ignored(client, admin):
    """If metadata.tenant_id/invoice_id is missing, handler should skip + audit as ignored."""
    event_id = f"evt_test_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": "pi_no_meta", "amount": 100, "metadata": {}}},
    }
    resp = await _post_event(client, event)
    assert resp["result"] == "ignored"
    async with OwnerSessionLocal() as s:
        audit = (await s.execute(
            select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
        )).scalar_one()
        assert audit.result == "ignored"


# ──────────────────────────────────────────────────────────────────────────
# payment_intent.payment_failed
# ──────────────────────────────────────────────────────────────────────────


async def test_payment_intent_payment_failed_is_handled_without_mutation(client, admin):
    """A failed PaymentIntent leaves the invoice ISSUED, doesn't write Payment, audits handled."""
    inv = await _issued_invoice(client, admin, 7000, "pi_failed")
    tenant_id = await _admin_tenant_id(admin)

    event_id = f"evt_test_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.payment_failed",
        "data": {
            "object": {
                "id": "pi_failed_x",
                "amount": 7000,
                "last_payment_error": {"message": "Your card was declined.", "code": "card_declined"},
                "metadata": {"tenant_id": str(tenant_id), "invoice_id": inv["id"]},
            }
        },
    }
    resp = await _post_event(client, event)
    assert resp["result"] == "handled"

    # No Payment row written.
    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pay = (await s.execute(
            select(Payment).where(Payment.invoice_id == uuid.UUID(inv["id"]))
        )).scalars().all()
        assert pay == []
        inv_row = (await s.execute(
            select(Invoice).where(Invoice.id == uuid.UUID(inv["id"]))
        )).scalar_one()
        assert inv_row.status == "ISSUED"  # unchanged


# ──────────────────────────────────────────────────────────────────────────
# charge.refunded
# ──────────────────────────────────────────────────────────────────────────


async def test_charge_refunded_updates_payment_refunded_amount(client, admin):
    """A refund event bumps Payment.refunded_amount + refunded_at."""
    inv = await _issued_invoice(client, admin, 4000, "charge_refunded")
    tenant_id = await _admin_tenant_id(admin)

    intent_id = f"pi_test_{uuid.uuid4().hex[:8]}"

    # First: simulate the successful payment so we have a Payment row to refund against.
    succ_event = {
        "id": f"evt_succ_{uuid.uuid4().hex[:8]}",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": intent_id, "amount_received": 4000, "amount": 4000, "currency": "amd",
                "metadata": {
                    "tenant_id": str(tenant_id),
                    "invoice_id": inv["id"],
                    "customer_ref": inv["customer_id"],
                },
            }
        },
    }
    await _post_event(client, succ_event)

    # Now: refund event with amount_refunded=1500 (partial).
    refund_event = {
        "id": f"evt_refund_{uuid.uuid4().hex[:8]}",
        "type": "charge.refunded",
        "data": {
            "object": {
                "id": "ch_settled", "payment_intent": intent_id,
                "amount_refunded": 1500,
                "metadata": {"tenant_id": str(tenant_id)},
            }
        },
    }
    resp = await _post_event(client, refund_event)
    assert resp["result"] == "handled"

    # Payment.refunded_amount should reflect Stripe's cumulative total.
    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pay = (await s.execute(
            select(Payment).where(Payment.note == f"stripe:{intent_id}")
        )).scalar_one()
        assert pay.refunded_amount == 1500
        assert pay.refunded_at is not None


async def test_charge_refunded_same_total_is_idempotent(client, admin):
    """Re-posting a refund event with the same cumulative amount must NOT double-apply."""
    inv = await _issued_invoice(client, admin, 4000, "refund_idem")
    tenant_id = await _admin_tenant_id(admin)
    intent_id = f"pi_test_{uuid.uuid4().hex[:8]}"

    await _post_event(client, {
        "id": f"evt_s_{uuid.uuid4().hex[:8]}",
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": intent_id, "amount_received": 4000, "amount": 4000, "currency": "amd",
            "metadata": {"tenant_id": str(tenant_id), "invoice_id": inv["id"],
                         "customer_ref": inv["customer_id"]},
        }},
    })
    # First refund (cumulative=2000)
    rfd_event_a = {
        "id": f"evt_r_a_{uuid.uuid4().hex[:8]}",
        "type": "charge.refunded",
        "data": {"object": {
            "id": "ch_a", "payment_intent": intent_id, "amount_refunded": 2000,
            "metadata": {"tenant_id": str(tenant_id)},
        }},
    }
    await _post_event(client, rfd_event_a)
    # Second event repeats the SAME total (a webhook retry on the same refund).
    rfd_event_b = {
        "id": f"evt_r_b_{uuid.uuid4().hex[:8]}",
        "type": "charge.refunded",
        "data": {"object": {
            "id": "ch_a", "payment_intent": intent_id, "amount_refunded": 2000,
            "metadata": {"tenant_id": str(tenant_id)},
        }},
    }
    resp_b = await _post_event(client, rfd_event_b)
    assert resp_b["result"] == "ignored"

    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pay = (await s.execute(
            select(Payment).where(Payment.note == f"stripe:{intent_id}")
        )).scalar_one()
        assert pay.refunded_amount == 2000  # unchanged on the duplicate


# ──────────────────────────────────────────────────────────────────────────
# payment_method.attached
# ──────────────────────────────────────────────────────────────────────────


async def test_payment_method_attached_inserts_new_row(client, admin):
    """When the PM isn't already vaulted, the webhook inserts a new payment_method row."""
    cust_id = await _customer(client, admin, "PM Attached Customer")
    tenant_id = await _admin_tenant_id(admin)
    pm_token = f"pm_test_{uuid.uuid4().hex[:8]}"

    event = {
        "id": f"evt_pm_{uuid.uuid4().hex[:8]}",
        "type": "payment_method.attached",
        "data": {
            "object": {
                "id": pm_token,
                "card": {"last4": "4242", "brand": "visa", "exp_month": 11, "exp_year": 2029},
                "metadata": {"tenant_id": str(tenant_id), "customer_ref": cust_id},
            }
        },
    }
    resp = await _post_event(client, event)
    assert resp["result"] == "handled"

    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pm = (await s.execute(
            select(PaymentMethod).where(PaymentMethod.gateway_token == pm_token)
        )).scalar_one()
        assert pm.last4 == "4242"
        assert pm.brand == "visa"
        assert pm.gateway == "stripe"


# ──────────────────────────────────────────────────────────────────────────
# Idempotency
# ──────────────────────────────────────────────────────────────────────────


async def test_duplicate_event_id_returns_duplicate(client, admin):
    """Stripe retries until 2xx — the same evt_... posted twice yields duplicate=True."""
    inv = await _issued_invoice(client, admin, 1000, "dup")
    tenant_id = await _admin_tenant_id(admin)
    event_id = f"evt_dup_{uuid.uuid4().hex[:8]}"
    intent_id = f"pi_dup_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id, "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": intent_id, "amount_received": 1000, "amount": 1000, "currency": "amd",
            "metadata": {"tenant_id": str(tenant_id), "invoice_id": inv["id"],
                         "customer_ref": inv["customer_id"]},
        }},
    }
    r1 = await _post_event(client, event)
    assert r1.get("duplicate") in (None, False)
    r2 = await _post_event(client, event)
    assert r2.get("duplicate") is True

    # Exactly ONE Payment row landed despite two POSTs.
    async with OwnerSessionLocal() as s:
        from sqlalchemy import text
        await s.execute(text("SELECT set_config('gaaex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        payments = (await s.execute(
            select(Payment).where(Payment.note == f"stripe:{intent_id}")
        )).scalars().all()
        assert len(payments) == 1


# ──────────────────────────────────────────────────────────────────────────
# Unknown event type
# ──────────────────────────────────────────────────────────────────────────


async def test_unknown_event_type_is_ignored(client, admin):
    """An event_type we don't handle audits as ignored — no exception, no mutation."""
    event = {
        "id": f"evt_unk_{uuid.uuid4().hex[:8]}",
        "type": "review.opened",  # not in our handler map
        "data": {"object": {"id": "rev_x"}},
    }
    resp = await _post_event(client, event)
    assert resp["result"] == "ignored"


async def test_setup_intent_succeeded_is_ignored(client, admin):
    """setup_intent.succeeded is intentionally a no-op (vault flow uses PaymentMethod.attach)."""
    tenant_id = await _admin_tenant_id(admin)
    event = {
        "id": f"evt_si_{uuid.uuid4().hex[:8]}",
        "type": "setup_intent.succeeded",
        "data": {"object": {"id": "seti_x", "metadata": {"tenant_id": str(tenant_id)}}},
    }
    resp = await _post_event(client, event)
    assert resp["result"] == "ignored"


# ──────────────────────────────────────────────────────────────────────────
# Signature verification (real-mode rejection)
# ──────────────────────────────────────────────────────────────────────────


async def test_stripe_webhook_real_signature_rejection(client, monkeypatch):
    """When the gateway is the real StripeGateway, a bogus signature yields 400."""
    pytest.importorskip("stripe")
    from app.services.payments import StripeGateway

    monkeypatch.setattr("app.config.settings.payment_gateway_provider", "stripe", raising=False)
    monkeypatch.setattr("app.config.settings.stripe_secret_key", "sk_test_x", raising=False)
    monkeypatch.setattr("app.config.settings.stripe_webhook_secret", "whsec_x", raising=False)

    from app.services.payments import get_payment_gateway
    gw = get_payment_gateway()
    if not isinstance(gw, StripeGateway):
        pytest.skip("StripeGateway not active in this env")

    r = await client.post(
        "/api/webhooks/stripe",
        content=b'{"id":"evt_x","type":"payment_intent.succeeded"}',
        headers={"Stripe-Signature": "t=0,v1=garbage", "Content-Type": "application/json"},
    )
    assert r.status_code == 400, r.text
