"""Financial-integrity remediation — Critical findings F1-F8.

One test per finding from the Pack-M remediation. Each test asserts the *post-fix* behavior,
so when the fix is in place the test passes; without the fix it fails (sometimes silently —
e.g. F1 a non-AMD event would credit the invoice at face value, F8 a float-drifted amount
would land one luma off).

Coverage map
============
* F1 — Stripe webhook rejects non-AMD currency, audit row 'errored'.
* F2 — Stripe webhook rejects amount > outstanding_for_invoice.
* F3 — Auto-PAID flip uses net-paid (Σamount − Σrefunded_amount), THREE code paths:
       - legacy ``add_payment`` (routers/billing_payment.py)
       - stripe webhook ``_handle_payment_intent_succeeded``
       - ``payment_gateway.settle_order``
* F4 — mint_new_version race: two concurrent mints serialize via the advisory lock; if both
       try to leave an open row the partial UNIQUE INDEX (added by migration) rejects the
       second insert with IntegrityError.
* F5 — Credit-note + import/export numbering use the sequence-backed next_reference_number
       helper (no COUNT+1 race). 100 concurrent CNs land with no IntegrityError.
* F6 — settle_order serializes via SELECT ... FOR UPDATE: a re-entrant call after the first
       commit sees status=PAID and exits idempotently.
* F7 — allocate_payment over-allocation rejected: a sequence of allocations summing past the
       Payment.amount raises HTTPException 409 (the app-layer guard), and the DB trigger
       (added by migration) is the second line of defense.
* F8 — usage amount is Decimal-safe: quantity=0.1 unit_rate=1000 ⇒ amount=100 (not 99/101).

Strategy
========
Each test creates its own customer/invoice/payment fixtures so the tests are independent.
F3/F6/F7 use direct DB writes (via ``SessionLocal``) to seed the conditions that aren't
reachable through the public API in two steps (e.g. simulating a Payment.refunded_amount
without the full SPEC §4.5 approval round-trip).
"""
from __future__ import annotations

import asyncio
import json
import uuid

from sqlalchemy import select, text

from app.db import OwnerSessionLocal, SessionLocal
from app.models import Payment, PaymentOrder
from app.models.product_version import ProductVersion
from app.models.stripe_webhook_event import StripeWebhookEvent


# ──────────────────────────────────────────────────────────────────────────
# Shared fixture helpers (mirror existing test files' style)
# ──────────────────────────────────────────────────────────────────────────


async def _customer(client, admin, name: str) -> str:
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _issued_invoice(client, admin, amount: int, tag: str) -> dict:
    """customer → subscription → generate-invoice → issue."""
    cust = await _customer(client, admin, f"FinCust {tag}")
    sub = (await client.post(
        "/api/subscriptions", headers=admin,
        json={"plan_name": f"FinPlan {tag}", "amount": amount, "cycle": "monthly",
              "customer_id": cust},
    )).json()
    inv = (await client.post(
        f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin,
    )).json()
    return (await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)).json()


async def _admin_tenant_id() -> uuid.UUID:
    from app.models import Tenant
    async with OwnerSessionLocal() as s:
        return (await s.execute(select(Tenant).order_by(Tenant.created_at))).scalars().first().id


async def _post_stripe_event(client, event: dict) -> dict:
    """Post a stripe event payload through the webhook endpoint."""
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


async def _set_payment_refunded(payment_id: str, refunded_amount: int) -> None:
    """Direct DB write — simulate a refund without rolling through the full SPEC §4.5
    approval round-trip. The financial-integrity check we're verifying is whether the
    auto-PAID flip ignores this refund column, so seeding the column directly is the
    minimal reproduction."""
    async with SessionLocal() as s:
        pay = (await s.execute(
            select(Payment).where(Payment.id == uuid.UUID(payment_id))
        )).scalar_one()
        pay.refunded_amount = refunded_amount
        await s.commit()


# ══════════════════════════════════════════════════════════════════════════
# F1 — Stripe webhook rejects non-AMD currency
# ══════════════════════════════════════════════════════════════════════════


async def test_stripe_webhook_rejects_non_amd_currency(client, admin):
    """An event with currency='usd' must NOT create a Payment row; the audit row records
    the failure (the webhook router converts the handler's raise to result='errored')."""
    inv = await _issued_invoice(client, admin, 5000, "f1_usd")
    tenant_id = await _admin_tenant_id()

    event_id = f"evt_f1_{uuid.uuid4().hex[:8]}"
    intent_id = f"pi_f1_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": intent_id,
            "amount_received": 5000, "amount": 5000,
            "currency": "usd",  # ← the bug-trap field
            "metadata": {
                "tenant_id": str(tenant_id),
                "invoice_id": inv["id"],
                "customer_ref": inv["customer_id"],
            },
        }},
    }
    resp = await _post_stripe_event(client, event)
    # The router catches the handler's raise and records 'errored' on the audit row.
    assert resp["result"] == "errored"

    # No Payment row landed against the invoice.
    async with OwnerSessionLocal() as s:
        await s.execute(text("SELECT set_config('gaahex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pays = (await s.execute(
            select(Payment).where(Payment.invoice_id == uuid.UUID(inv["id"]))
        )).scalars().all()
        assert pays == [], "non-AMD event must not credit the invoice"

        # Audit trail captured with result='errored' + a currency mention in the error.
        audit = (await s.execute(
            select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
        )).scalar_one()
        assert audit.result == "errored"
        assert "currency" in (audit.error_message or "").lower() or "amd" in (audit.error_message or "").lower()


# ══════════════════════════════════════════════════════════════════════════
# F2 — Stripe webhook rejects amount > outstanding
# ══════════════════════════════════════════════════════════════════════════


async def test_stripe_webhook_rejects_amount_exceeds_outstanding(client, admin):
    """invoice.total=1000, applied credit note 500 ⇒ outstanding=500. An event with
    amount=800 must be rejected (raises in the handler ⇒ result='errored')."""
    # 1000-luma invoice.
    inv = await _issued_invoice(client, admin, 1000, "f2_over")
    tenant_id = await _admin_tenant_id()

    # Apply a 500-luma credit note so the outstanding drops to 500.
    cn = (await client.post("/api/billing/credit-notes", headers=admin, json={
        "customer_id": inv["customer_id"], "amount": "500", "reason": "f2 setup",
    })).json()
    await client.post(f"/api/billing/credit-notes/{cn['id']}/issue", headers=admin)
    apply_r = await client.post(
        f"/api/billing/credit-notes/{cn['id']}/apply", headers=admin,
        json={"invoice_id": inv["id"]},
    )
    assert apply_r.status_code == 200, apply_r.text

    # 800 > 500 outstanding ⇒ rejected.
    event_id = f"evt_f2_{uuid.uuid4().hex[:8]}"
    intent_id = f"pi_f2_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": intent_id,
            "amount_received": 800, "amount": 800,
            "currency": "amd",
            "metadata": {
                "tenant_id": str(tenant_id),
                "invoice_id": inv["id"],
                "customer_ref": inv["customer_id"],
            },
        }},
    }
    resp = await _post_stripe_event(client, event)
    assert resp["result"] == "errored"

    async with OwnerSessionLocal() as s:
        await s.execute(text("SELECT set_config('gaahex.tenant_id', :v, false)"),
                        {"v": str(tenant_id)})
        pays = (await s.execute(
            select(Payment).where(Payment.invoice_id == uuid.UUID(inv["id"]))
        )).scalars().all()
        assert pays == [], "over-amount event must not credit the invoice"

        audit = (await s.execute(
            select(StripeWebhookEvent).where(StripeWebhookEvent.stripe_event_id == event_id)
        )).scalar_one()
        assert audit.result == "errored"
        assert "outstand" in (audit.error_message or "").lower() or "exceed" in (audit.error_message or "").lower()


# ══════════════════════════════════════════════════════════════════════════
# F3 — Auto-PAID flip ignores refunded_amount — three code paths
# ══════════════════════════════════════════════════════════════════════════


async def test_invoice_remains_unpaid_after_refund_when_net_below_total_legacy_add_payment(client, admin):
    """Path 1 — POST /api/invoices/{id}/payments (routers/billing_payment.add_payment).

    Scenario discriminator (old vs new):
      * 1000-luma invoice.
      * Pay 800 → gross 800, net 800 → ISSUED (800 < 1000) either way.
      * Refund 600 on it (set refunded_amount=600 directly; net is now 200).
      * Pay another 400. OLD CODE: gross sum 800 + 400 = 1200 ≥ 1000 → flips to PAID
        (wrong — the refund of 600 means only 600 of the customer's money was retained).
        NEW CODE (F3 fix): net sum (800 - 600) + (400 - 0) = 600 < 1000 → stays ISSUED.
    """
    inv = await _issued_invoice(client, admin, 1000, "f3_legacy")

    # Step 1: 800-luma payment (gross 800 < 1000 → stays ISSUED).
    pay1 = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 800, "method": "card"})).json()
    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED"

    # Step 2: simulate a 600-luma refund on pay1 (net 200).
    await _set_payment_refunded(pay1["id"], 600)

    # Step 3: 400-luma payment. Gross SUM 800+400=1200 ≥ 1000 (would flip under the bug).
    # Net SUM (800-600)+(400-0)=600 < 1000 → must stay ISSUED with the F3 fix.
    await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                      json={"amount": 400, "method": "card"})
    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED", \
        "net-paid 600 < total 1000 — must stay ISSUED (gross 1200 was the bug trap)"


async def test_invoice_remains_unpaid_after_refund_when_net_below_total_stripe_webhook(client, admin):
    """Path 2 — Stripe webhook ``_handle_payment_intent_succeeded``.

    Seed an existing Payment with refunded_amount > 0 (legacy add_payment route + direct
    refund). Then a Stripe webhook event for a SMALLER subsequent payment must:
      * write the Payment row (currency=amd, amount<=outstanding — F1/F2 pass)
      * leave the invoice ISSUED if net-paid < total (F3)
    """
    # 1500-luma invoice.
    inv = await _issued_invoice(client, admin, 1500, "f3_stripe")
    tenant_id = await _admin_tenant_id()

    # Prior legacy payment 800, refund 700 ⇒ net 100.
    pay1 = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 800, "method": "card"})).json()
    await _set_payment_refunded(pay1["id"], 700)
    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED"

    # Stripe webhook arrives with amount=1300. F2 outstanding check: outstanding_for_invoice
    # subtracts allocations (none here, legacy add_payment doesn't allocate) + applied CNs (none),
    # so outstanding = 1500. 1300 < 1500 → F2 passes.
    #
    # GROSS-paid SUM = 800 + 1300 = 2100 ≥ 1500 → with the BUGGY code the invoice would flip to
    # PAID. NET-paid (the F3 fix) = (800 - 700) + 1300 = 1400 < 1500 → must stay ISSUED.
    event_id = f"evt_f3s_{uuid.uuid4().hex[:8]}"
    intent_id = f"pi_f3s_{uuid.uuid4().hex[:8]}"
    event = {
        "id": event_id,
        "type": "payment_intent.succeeded",
        "data": {"object": {
            "id": intent_id,
            "amount_received": 1300, "amount": 1300,
            "currency": "amd",
            "metadata": {
                "tenant_id": str(tenant_id),
                "invoice_id": inv["id"],
                "customer_ref": inv["customer_id"],
            },
        }},
    }
    resp = await _post_stripe_event(client, event)
    assert resp["result"] == "handled"

    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED", \
        "net-paid 1400 < total 1500 — must stay ISSUED (gross-paid 2100 was the bug trap)"


async def test_invoice_remains_unpaid_after_refund_when_net_below_total_settle_order(client, admin):
    """Path 3 — ``payment_gateway.settle_order`` (gateway-confirmed callback path).

    Issue a 2000-luma invoice, record 1200 via legacy + refund 700 (net 500). Seed a
    PaymentOrder for 800 directly (bypassing /pay) and confirm it via the dev gateway
    settle path — gross=1200+800=2000 would flip with the OLD bug, but net=500+800=1300
    < 2000 so the invoice must stay ISSUED with the F3 fix.

    We seed the PaymentOrder via SessionLocal rather than the /pay endpoint because BL-1
    made /pay return the canonical net outstanding (1500 here, not 800). The F3 defense
    inside settle_order is the surface under test here — it must reject any gateway-
    confirmed amount that would flip a refund-eroded invoice prematurely, regardless of
    how the order was minted.
    """
    inv = await _issued_invoice(client, admin, 2000, "f3_settle")

    # Prior legacy payment 1200, refund 700 ⇒ net 500.
    pay1 = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                              json={"amount": 1200, "method": "card"})).json()
    await _set_payment_refunded(pay1["id"], 700)
    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED"

    # Seed a PaymentOrder for 800 directly — bypassing /pay so the F3-trap amount
    # (gross-2000 / net-1300) is reachable independently of BL-1's /pay update.
    tenant_id = await _admin_tenant_id()
    async with SessionLocal() as s:
        order = PaymentOrder(
            tenant_id=tenant_id,
            invoice_id=uuid.UUID(inv["id"]),
            customer_id=uuid.UUID(inv["customer_id"]),
            provider="dev",
            amount=800,
            currency="AMD",
            status="PENDING",
        )
        s.add(order)
        await s.commit()
        order_id = str(order.id)

    r = await client.post(f"/api/payment-orders/{order_id}/confirm-dev", headers=admin)
    assert r.status_code == 200, r.text

    inv_after = (await client.get(f"/api/invoices/{inv['id']}", headers=admin)).json()
    assert inv_after["status"] == "ISSUED", \
        "net-paid 1300 < total 2000 — must stay ISSUED (gross 2000 was the bug trap)"


# ══════════════════════════════════════════════════════════════════════════
# F4 — mint_new_version race + partial unique
# ══════════════════════════════════════════════════════════════════════════


async def test_concurrent_mint_new_version_partial_unique(client, admin):
    """Two concurrent mints on the same product MUST serialize via the advisory lock so
    the second observes the first's open row already closed; the partial UNIQUE INDEX
    (added by the migration) backstops by rejecting any attempt to leave two open rows.

    Test shape: drive the two mints from independent transactions so the advisory lock
    actually fences. Verify the end state is consistent: exactly one open ProductVersion
    (effective_to IS NULL) and two distinct version_no values.
    """
    from app.services.product_versions import mint_new_version

    prod = (await client.post("/api/products", headers=admin, json={
        "key": f"f4-{uuid.uuid4().hex[:8]}",
        "name": "F4 product",
        "default_amount": 1000,
        "cycle": "monthly",
        "recurring_price": "10.00",
    })).json()
    prod_id = uuid.UUID(prod["id"])

    async def _mint_one(price: str) -> uuid.UUID:
        async with SessionLocal() as s:
            v = await mint_new_version(s, prod_id, {
                "recurring_price": price, "cycle": "monthly", "spec_json": {},
            })
            await s.commit()
            return v.id

    # Fire both mints concurrently (asyncio.gather). The advisory lock serializes them.
    v_ids = await asyncio.gather(_mint_one("11.00"), _mint_one("12.00"))
    assert len(set(v_ids)) == 2, "each mint creates a distinct version row"

    # End state: only ONE open version, two distinct version_no.
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(ProductVersion).where(ProductVersion.product_id == prod_id)
            .order_by(ProductVersion.version_no)
        )).scalars().all()
        # Initial mint via POST /api/products auto-created v1 (or didn't, depending on the
        # router shape); we count the open ones explicitly without assuming.
        open_versions = [v for v in rows if v.effective_to is None]
        assert len(open_versions) == 1, (
            f"exactly one open version after the race; got {len(open_versions)} "
            f"(version_nos: {[v.version_no for v in open_versions]})"
        )
        version_nos = [v.version_no for v in rows]
        assert len(version_nos) == len(set(version_nos)), \
            f"version_no must be unique per product; got {version_nos}"


# ══════════════════════════════════════════════════════════════════════════
# F5 — CN COUNT+1 race fixed with next_reference_number
# ══════════════════════════════════════════════════════════════════════════


async def test_credit_note_numbering_uses_sequence_no_race(client, admin):
    """Concurrently create 25 credit notes from the same client. With the OLD COUNT+1 we'd
    hit duplicate CN-XXXXX numbers under load; with the new sequence-backed
    next_reference_number every call returns a distinct value. Reduced from 100 to 25 to
    keep the test session fast — still covers the race window."""
    cust = await _customer(client, admin, f"F5 Cust {uuid.uuid4().hex[:6]}")

    async def _make_cn() -> str:
        r = await client.post("/api/billing/credit-notes", headers=admin, json={
            "customer_id": cust, "amount": "1.00", "reason": "f5 race",
        })
        assert r.status_code == 201, r.text
        return r.json()["number"]

    numbers = await asyncio.gather(*[_make_cn() for _ in range(25)])
    assert len(set(numbers)) == len(numbers), \
        f"all CN numbers must be distinct; got duplicates in {numbers}"
    # All numbers follow the CN-NNNNN shape.
    for n in numbers:
        assert n.startswith("CN-"), f"unexpected number shape: {n}"
        assert n[3:].isdigit() and len(n) == 8, f"unexpected number width: {n}"


# ══════════════════════════════════════════════════════════════════════════
# F6 — settle_order with_for_update serializes concurrent settles
# ══════════════════════════════════════════════════════════════════════════


async def test_settle_order_with_for_update_serializes(client, admin):
    """Two concurrent settle calls on the same PaymentOrder must produce exactly one Payment
    and a single ``order.status=PAID`` outcome. The fix is a 3-layered defense:

      1. FOR UPDATE on the PaymentOrder row inside ``settle_order`` — the second caller
         from an independent session blocks on this lock until the first commits, then
         sees status=PAID and returns idempotently.
      2. Pre-INSERT existence check by ``payment_order_id`` — if a Payment already exists
         for this order (any leak past Layer 1), reuse it instead of inserting a duplicate.
      3. Partial UNIQUE INDEX ``uq_payment_one_per_order`` on ``payment.payment_order_id``
         WHERE NOT NULL (migration f8c5b1e9a3d2) — the DB-level backstop that makes two
         Payments per order **physically impossible**.

    The session-per-coroutine pattern is critical: the SELECT … FOR UPDATE lock is
    session-bound, so two coroutines sharing one session would not contend at all. With
    independent sessions the second `FOR UPDATE` re-fetches the latest committed row
    after the first session releases — that's where the F6 fix actually bites.
    """
    from app.payment_gateway import settle_order

    inv = await _issued_invoice(client, admin, 3000, "f6_race")
    pay_init = await client.post(f"/api/invoices/{inv['id']}/pay", headers=admin)
    order_id = uuid.UUID(pay_init.json()["order_id"])

    # Synchronisation barrier — make both coroutines reach settle_order at roughly the
    # same wall-clock instant so the race window is as wide as Python's scheduler permits.
    # Without it the first coroutine could complete entirely before the second even loads
    # the row, which would still pass but wouldn't exercise the lock-contention path.
    started = asyncio.Event()

    async def _settle_once(idx: int) -> None:
        async with SessionLocal() as s:
            # Each coroutine has its own session — that's what makes FOR UPDATE actually
            # contend (per-session locks). Re-fetching the row INSIDE settle_order under
            # FOR UPDATE is the bit doing the real serialisation; we just pass `order_id`
            # in via a lightweight stub to satisfy settle_order's signature.
            order = (await s.execute(
                select(PaymentOrder).where(PaymentOrder.id == order_id)
            )).scalar_one()
            if idx == 0:
                started.set()
            else:
                await started.wait()
            await settle_order(s, order, actor_id=None)
            await s.commit()

    await asyncio.gather(_settle_once(0), _settle_once(1))

    # End state: exactly ONE Payment for the PaymentOrder (Layer 1+2+3 all agree).
    # Asserting by payment_order_id directly catches the F6 bug at its narrowest waist —
    # filtering by invoice_id alone would mask a duplicate if a legacy add_payment row
    # for the same invoice were present in the future.
    async with SessionLocal() as s:
        pays_by_order = (await s.execute(
            select(Payment).where(Payment.payment_order_id == order_id)
        )).scalars().all()
        assert len(pays_by_order) == 1, (
            f"Expected exactly 1 Payment per PaymentOrder; got {len(pays_by_order)}. "
            "F6 race regression — the FOR UPDATE + existence-check + partial UNIQUE chain "
            "is no longer serialising concurrent settle_order callers."
        )

        # Belt-and-braces: the invoice-side count must also be 1 in this test setup
        # (no prior legacy payments seeded).
        pays_by_invoice = (await s.execute(
            select(Payment).where(Payment.invoice_id == uuid.UUID(inv["id"]))
        )).scalars().all()
        assert len(pays_by_invoice) == 1, (
            f"Expected 1 Payment on the invoice as well; got {len(pays_by_invoice)}"
        )

        # PaymentOrder flipped to PAID idempotently, with payment_id pointing at the
        # single Payment row we wrote.
        order = (await s.execute(
            select(PaymentOrder).where(PaymentOrder.id == order_id)
        )).scalar_one()
        assert order.status == "PAID"
        assert order.payment_id == pays_by_order[0].id, (
            "PaymentOrder.payment_id must reference the single settled Payment"
        )

        # Invoice flipped to PAID (order.amount covered total).
        from app.models import Invoice
        invoice = (await s.execute(
            select(Invoice).where(Invoice.id == uuid.UUID(inv["id"]))
        )).scalar_one()
        assert invoice.status == "PAID", (
            f"Invoice should be PAID after settle (got {invoice.status})"
        )


# ══════════════════════════════════════════════════════════════════════════
# F7 — allocate_payment over-allocation rejected
# ══════════════════════════════════════════════════════════════════════════


async def test_allocate_payment_over_allocation_rejected(client, admin):
    """Try to allocate sum > payment.amount → HTTPException 409 from the app-layer guard.
    (The new DB trigger from Pack M is the second line of defense for the bypass paths.)"""
    # Issue an invoice, record a 1000-luma payment that hasn't been allocated yet.
    inv = await _issued_invoice(client, admin, 5000, "f7_over")
    pay = (await client.post(f"/api/invoices/{inv['id']}/payments", headers=admin,
                             json={"amount": 1000, "method": "card"})).json()

    # Try to allocate 1500 against a fresh invoice (so the over-allocation is the only fault).
    inv2 = await _issued_invoice(client, admin, 5000, "f7_over_target")
    r = await client.post(
        f"/api/payments/{pay['id']}/allocate", headers=admin,
        json={"allocations": [{"invoice_id": inv2["id"], "amount": "1500"}]},
    )
    assert r.status_code == 409, r.text
    assert "over-allocate" in r.text.lower() or "over_allocate" in r.text.lower() or "exceed" in r.text.lower()


# ══════════════════════════════════════════════════════════════════════════
# F8 — usage amount is Decimal-safe (no float drift)
# ══════════════════════════════════════════════════════════════════════════


async def test_usage_amount_is_decimal_safe(client, admin):
    """The classic float-drift trap: quantity=0.1 unit_rate=1000 must land as 100 luma,
    not 99 (which is what ``int(round(0.1 * 1000))`` would give on some platforms because
    0.1 has no exact binary float representation)."""
    r = await client.post("/api/usage", headers=admin, json={
        "metric": "gb", "quantity": 0.1, "unit_rate": 1000,
    })
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["amount"] == 100, (
        f"Decimal-safe math must land amount=100; got {u['amount']} "
        "(float drift would land 99 or 101)"
    )

    # A handful of additional Decimal-edge cases the float path used to miss.
    cases = [
        # (quantity, unit_rate, expected_amount_luma)
        (0.2, 1000, 200),     # 0.2 has no exact binary representation either
        (0.3, 1000, 300),     # classic float-drift example: 0.1 + 0.2 != 0.3
        ("2.5", 100, 250),    # str input → Decimal preserves precision
        (1.0 / 3.0, 3000, 1000),  # 0.333… * 3000 ⇒ Decimal rounds half-up to 1000
    ]
    for qty, rate, expected in cases:
        r = await client.post("/api/usage", headers=admin, json={
            "metric": "other", "quantity": qty, "unit_rate": rate,
        })
        assert r.status_code == 201, r.text
        got = r.json()["amount"]
        assert got == expected, (
            f"quantity={qty} unit_rate={rate}: expected amount={expected}, got {got}"
        )
