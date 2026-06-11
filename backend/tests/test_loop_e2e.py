"""The full ISP daily loop, driven start-to-finish in ONE flow (batch 20 glue).

Lead → Customer → Order → Subscription → Service → Invoice → Payment → Ticket, as the authenticated
demo admin. This is the proof that the per-module bridges actually chain together end-to-end.

Two lanes may not be merged when this runs; we probe at runtime and skip *only* those assertions so
the suite stays green, while the assertions are written to pass once the lanes land:
  - A20  — POST /api/leads/{id}/convert (+ source_lead_id / converted_customer_id, services in 360).
           Probed by the convert call returning 404 → we fall back to creating the customer directly
           so the rest of the chain still runs.
  - E20  — POST /api/billing/run-cycle. Probed by 404 → we fall back to per-sub generate-invoice.

Money is integer luma. Unique keys/names per run (the session DB accumulates across tests).
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models.billing import Subscription


def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


async def _pass_control_gate(order_id: str) -> None:
    """SPEC §3 Stage 8 stand-in: flip the order's `control_pass` to TRUE so the kernel gate
    permits the SUBMITTED → PROVISIONING transition (Step 4). Mirrors test_orders.py's helper."""
    from app.models.order import Order
    async with SessionLocal() as s:
        o = (await s.execute(select(Order).where(Order.id == uuid.UUID(order_id)))).scalar_one()
        o.control_pass = True
        await s.commit()


async def _product(client, admin, *, default_amount, cycle="monthly"):
    key = _uniq("loopprod")
    return (await client.post("/api/products", headers=admin, json={
        "key": key, "name": key.title(), "default_amount": default_amount, "cycle": cycle})).json()


async def _drive_order_to_completed(client, admin, customer_id, product_id, unit_amount):
    """Create an order with one product-bearing line and walk it DRAFT→…→COMPLETED. Returns the
    COMPLETED order body (which carries provisioned_subscriptions)."""
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"product_id": product_id, "description": "Fiber plan", "quantity": 1,
                   "unit_amount": unit_amount}],
    })).json()
    oid = order["id"]
    assert (await client.post(f"/api/orders/{oid}/submit", headers=admin)).json()["status"] == "order_validated"
    await _pass_control_gate(oid)                                               # control gate (SST #7→#8)
    completed = None
    for expected in ["scheduling", "config", "installation", "connection_test", "payment_confirmed", "activation"]:
        completed = (await client.post(f"/api/orders/{oid}/advance", headers=admin)).json()
        assert completed["status"] == expected, completed
    return completed


async def _summary(client, admin, customer_id) -> dict:
    return (await client.get(f"/api/customers/{customer_id}/360", headers=admin)).json()["summary"]


async def test_full_isp_loop_e2e(client, admin):
    """One flow across six stages:
      1. lead → convert (A20) → customer carries source_lead_id; lead CONVERTED + converted_customer_id;
         convert is idempotent. (Falls back to a direct customer create if A20 isn't merged.)
      2. order (product line) → submit → advance → COMPLETED → a subscription AND a service are
         auto-provisioned for the customer.
      3. activate the service → ACTIVE + activated_at set.
      4. run the billing cycle (E20 run-cycle, else per-sub generate-invoice) → an ISSUED invoice
         exists for the customer; a second run generates nothing (E20 idempotency).
      5. record a full payment → invoice PAID + 360 outstanding drops by the amount paid.
      6. create a ticket → 360 reflects the whole loop (subscriptions, invoices, ticket related,
         services per A20).
    """
    # ============ STAGE 1: lead → customer ============
    lead = (await client.post("/api/leads", headers=admin, json={
        "name": _uniq("E2E Lead"), "phone": "+37411223344", "email": f"{_uniq('e2e')}@demo.isp",
    })).json()
    lead_id = lead["id"]

    convert = await client.post(f"/api/leads/{lead_id}/convert", headers=admin, json={})
    a20 = convert.status_code != 404
    if a20:
        assert convert.status_code in (200, 201), convert.text
        # The lead is now CONVERTED and points at the new customer (the authoritative link).
        lead_after = (await client.get(f"/api/leads/{lead_id}", headers=admin)).json()
        assert lead_after["status"] == "contract_signed"
        customer_id = lead_after["converted_customer_id"]
        assert customer_id, "convert did not stamp converted_customer_id on the lead"
        # The customer records where it came from.
        cust = (await client.get(f"/api/customers/{customer_id}", headers=admin)).json()
        assert cust["source_lead_id"] == lead_id
        # Idempotent: converting again yields the same customer, not a second one.
        again = await client.post(f"/api/leads/{lead_id}/convert", headers=admin, json={})
        assert again.status_code in (200, 201, 409), again.text
        lead_again = (await client.get(f"/api/leads/{lead_id}", headers=admin)).json()
        assert lead_again["converted_customer_id"] == customer_id
    else:
        # A20 not merged — create the customer directly so the chain below still runs end-to-end.
        customer_id = (await client.post("/api/customers", headers=admin,
                                         json={"name": _uniq("E2E Cust")})).json()["id"]

    # ============ STAGE 2: order → subscription + service (auto-provision) ============
    prod = await _product(client, admin, default_amount=45000, cycle="monthly")
    # fresh customer has nothing yet
    assert (await client.get(f"/api/subscriptions?customer={customer_id}", headers=admin)).json() == []

    completed = await _drive_order_to_completed(client, admin, customer_id, prod["id"], unit_amount=99999)
    assert len(completed["provisioned_subscriptions"]) == 1

    subs = (await client.get(f"/api/subscriptions?customer={customer_id}", headers=admin)).json()
    services = (await client.get(f"/api/services?customer={customer_id}", headers=admin)).json()
    assert len(subs) == 1 and subs[0]["status"] == "ACTIVE"
    assert subs[0]["amount"] == 45000 and subs[0]["plan_name"] == prod["name"]   # product terms, not line price
    assert len(services) == 1
    sub_id, service_id = subs[0]["id"], services[0]["id"]
    assert services[0]["subscription_id"] == sub_id           # the service fulfils the subscription
    assert services[0]["status"] == "PENDING"

    # ============ STAGE 3: activate the service ============
    activated = (await client.post(f"/api/services/{service_id}/activate", headers=admin)).json()
    assert activated["status"] == "ACTIVE" and activated["activated_at"] is not None

    # ============ STAGE 4: billing cycle → an ISSUED invoice ============
    run = await client.post("/api/billing/run-cycle", headers=admin, json={})
    # 404 (no route) or 405 (the generic GET /{slug}/{rec_id} pattern shadows the path for POST) both
    # mean E20 isn't merged → fall back to per-subscription generate-invoice.
    e20 = run.status_code not in (404, 405)
    if e20:
        assert run.status_code in (200, 201), run.text
        body = run.json()
        generated = body.get("generated", body.get("invoices_generated"))
        assert generated and int(generated) >= 1                 # at least our due subscription
        # idempotent: a second run for the same period generates nothing new
        again = await client.post("/api/billing/run-cycle", headers=admin, json={})
        again_gen = again.json().get("generated", again.json().get("invoices_generated"))
        assert int(again_gen) == 0
        invoices = (await client.get(f"/api/invoices?customer={customer_id}", headers=admin)).json()
        issued = [i for i in invoices if i["status"] == "ISSUED"]
        assert issued, "run-cycle produced no ISSUED invoice for the customer"
        invoice = issued[0]
    else:
        # Fallback: generate a DRAFT from the auto-provisioned subscription, then issue it.
        invoice = (await client.post(f"/api/subscriptions/{sub_id}/generate-invoice", headers=admin)).json()
        assert invoice["status"] == "DRAFT" and invoice["total"] == 45000

    inv_id = invoice["id"]
    # Issue if still DRAFT (the fallback path; E20 is expected to issue already).
    current = (await client.get(f"/api/invoices/{inv_id}", headers=admin)).json()
    if current["status"] == "DRAFT":
        issued = (await client.post(f"/api/invoices/{inv_id}/issue", headers=admin)).json()
        assert issued["status"] == "ISSUED" and issued["due_at"]
    inv = (await client.get(f"/api/invoices/{inv_id}", headers=admin)).json()
    assert inv["status"] == "ISSUED"
    amount_due = inv["total"]

    # ============ STAGE 5: payment → PAID + outstanding drops ============
    before = await _summary(client, admin, customer_id)
    pay = await client.post(f"/api/invoices/{inv_id}/payments", headers=admin,
                            json={"amount": amount_due, "method": "card"})
    assert pay.status_code == 201, pay.text
    paid_inv = (await client.get(f"/api/invoices/{inv_id}", headers=admin)).json()
    assert paid_inv["status"] == "PAID"
    after = await _summary(client, admin, customer_id)
    assert after["outstanding"] == before["outstanding"] - amount_due
    assert after["total_paid"] == before["total_paid"] + amount_due

    # ============ STAGE 6: ticket → 360 reflects the whole loop ============
    # Try to link the ticket to the customer (A20 may add a customer ref field on the ticket entity);
    # fall back to an unlinked ticket if that field doesn't exist yet.
    subject = _uniq("E2E No internet")
    tk = await client.post("/api/tickets", headers=admin, json={"subject": subject, "customer": customer_id})
    ticket_linked = tk.status_code == 201
    if not ticket_linked:
        tk = await client.post("/api/tickets", headers=admin, json={"subject": subject})
    assert tk.status_code == 201, tk.text

    full = (await client.get(f"/api/customers/{customer_id}/360", headers=admin)).json()
    assert len(full["subscriptions"]) == 1
    assert any(i["id"] == inv_id and i["status"] == "PAID" for i in full["invoices"])
    assert full["summary"]["subscription_count"] == 1
    assert "ticket" in full["related"]
    if ticket_linked:
        assert full["related"]["ticket"] >= 1          # the linked ticket shows up in related

    # A20 surfaces the customer's services in the 360 payload.
    if "services" in full:
        assert any(svc["id"] == service_id for svc in full["services"])

    # sanity: the subscription row really belongs to this customer in the DB (the bridge wrote it)
    async with SessionLocal() as ses:
        from sqlalchemy import select
        row = (await ses.execute(
            select(Subscription).where(Subscription.id == uuid.UUID(sub_id)))).scalar_one()
        assert str(row.customer_id) == str(customer_id)
