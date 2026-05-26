"""Coverage for branded document generation (documents.py) — print-ready HTML.

Invoice document + account statement render inline-CSS HTML on the BRAND light/print palette
(Cobalt #1C3B68), money as AMD ֏. Invoice-view / customer-view scope is enforced exactly like the
billing router — admin holds `*`; the seeded agent is out of scope → 403. Unique names per test
(the shared session DB accumulates).
"""

import uuid


async def _invoice_for(client, admin, *, amount, tag):
    """A DRAFT invoice (customer → subscription → generate) carrying one line of `amount` luma.
    Returns (customer_id, customer_name, invoice)."""
    name = f"Doc Cust {tag}"
    cust = (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]
    sub = (await client.post("/api/subscriptions", headers=admin, json={
        "plan_name": f"Plan {tag}", "amount": amount, "cycle": "monthly", "customer_id": cust})).json()
    inv = (await client.post(f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin)).json()
    return cust, name, inv


# ===================== invoice document =====================

async def test_invoice_document_html_brand_and_content(client, admin):
    _, _, inv = await _invoice_for(client, admin, amount=50000, tag=uuid.uuid4().hex[:6])
    r = await client.get(f"/api/invoices/{inv['id']}/document", headers=admin)
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    body = r.text
    assert "1c3b68" in body.lower()                       # BRAND cobalt (CSS uses uppercase #1C3B68)
    assert "֏" in body                                    # AMD symbol
    assert inv["number"] in body                          # the invoice's number
    assert f"{50000 / 100:,.2f}" in body                  # the total, grouped → "500.00"


async def test_invoice_document_404_for_bogus_id(client, admin):
    assert (await client.get(f"/api/invoices/{uuid.uuid4()}/document", headers=admin)).status_code == 404


# ===================== account statement =====================

async def test_statement_html_has_customer_and_a_line(client, admin):
    cust, name, inv = await _invoice_for(client, admin, amount=12000, tag=uuid.uuid4().hex[:6])
    r = await client.get(f"/api/customers/{cust}/statement", headers=admin)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    body = r.text
    assert name in body                                   # the account name
    assert inv["number"] in body                          # at least one ledger line (the invoice)
    assert "No activity" not in body


async def test_statement_404_for_bogus_customer(client, admin):
    assert (await client.get(f"/api/customers/{uuid.uuid4()}/statement", headers=admin)).status_code == 404


# ===================== scope / permission =====================

async def test_agent_out_of_scope_403(client, admin, agent):
    # invoice + customer are owned at the admin's (root) node; the seeded agent is scoped to sales1,
    # so the view-scope gate refuses both documents → 403 (same gate as the billing router).
    cust, _, inv = await _invoice_for(client, admin, amount=5000, tag=uuid.uuid4().hex[:6])
    assert (await client.get(f"/api/invoices/{inv['id']}/document", headers=agent)).status_code == 403
    assert (await client.get(f"/api/customers/{cust}/statement", headers=agent)).status_code == 403
