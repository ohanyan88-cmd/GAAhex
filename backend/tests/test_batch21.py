"""Batch 21 tests — demo-loop seed (A21) + capabilities/access gating (E21).

A21: seed_demo_loop_if_empty() in backend/app/seed_demo_loop.py.
E21: GET /api/me/capabilities (not yet merged as of this write).

A21 is present in the codebase. The function guards on Subscription table emptiness, so in the
test DB (which accumulates state across the session) it may return None if earlier tests already
created subscriptions. We key off the demo customer name
(`seed_demo_loop.DEMO_CUSTOMER_NAME`) so we can find the seeded row directly if the seed ran,
and skip if the DB state prevented the seed from inserting.

E21 is not wired. The generic record router catches /api/me/capabilities (slug="me",
rec_id="capabilities") and returns 422. The skip condition covers 404 AND 422 so those
tests stay green until E21 lands.

Style follows test_loop_e2e.py (session-scoped client + admin/agent fixtures from conftest).
"""

import importlib
import uuid

import pytest

# ---------------------------------------------------------------------------
# Probe A21 — import the seed module + its constants
# ---------------------------------------------------------------------------

_SEED_FN = None
_DEMO_CUSTOMER_NAME = None
_A21_REASON = ""

try:
    _mod = importlib.import_module("app.seed_demo_loop")
    _SEED_FN = getattr(_mod, "seed_demo_loop_if_empty", None)
    _DEMO_CUSTOMER_NAME = getattr(_mod, "DEMO_CUSTOMER_NAME", None)
    if _SEED_FN is None:
        _A21_REASON = "seed_demo_loop.py exists but seed_demo_loop_if_empty() not found"
except ModuleNotFoundError:
    _A21_REASON = "app.seed_demo_loop module not yet merged (A21)"

_A21_PRESENT = _SEED_FN is not None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uniq(tag: str) -> str:
    return f"{tag}-{uuid.uuid4().hex[:8]}"


async def _run_seed_and_find_demo_customer(client, admin) -> dict | None:
    """Attempt to run the seed, then find the demo customer by name.
    Returns the customer dict, or None if the seed couldn't run (DB has prior subscriptions,
    so the idempotency guard fired before this test's session start).

    NOTE: records are serialized by _serialize() which flattens data fields directly into the
    response dict (not nested under a 'data' key), so we check c.get("name"), not c["data"]["name"].
    """
    result = await _SEED_FN()
    if result is None:
        # Guard fired — look for the demo customer by name in the DB
        all_customers = (await client.get("/api/customers", headers=admin)).json()
        for c in all_customers:
            # The records API flattens data fields into the top-level response dict
            if c.get("name") == _DEMO_CUSTOMER_NAME:
                return c
        # If not found either, the seed truly couldn't run (no tenant, etc.)
        return None
    # Seed ran and returned ids — fetch the customer record directly
    cid = result["customer_id"]
    r = await client.get(f"/api/customers/{cid}", headers=admin)
    if r.status_code == 200:
        return r.json()
    return None


async def _create_product(client, admin, *, name: str, amount: int, cycle: str = "monthly") -> dict:
    key = _uniq("b21prod")
    r = await client.post("/api/products", headers=admin, json={
        "key": key, "name": name, "default_amount": amount, "cycle": cycle,
    })
    assert r.status_code == 201, r.text
    return r.json()


async def _drive_order_to_completed(client, admin, customer_id: str, product_id: str, unit_amount: int) -> dict:
    """Create order with one line and walk DRAFT→SUBMITTED→PROVISIONING→COMPLETED."""
    order = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"product_id": product_id, "description": "Demo Plan",
                   "quantity": 1, "unit_amount": unit_amount}],
    })).json()
    oid = order["id"]
    r = await client.post(f"/api/orders/{oid}/submit", headers=admin)
    assert r.json()["status"] == "SUBMITTED", r.text
    r = await client.post(f"/api/orders/{oid}/advance", headers=admin)
    assert r.json()["status"] == "PROVISIONING", r.text
    r = await client.post(f"/api/orders/{oid}/advance", headers=admin)
    assert r.json()["status"] == "COMPLETED", r.text
    return r.json()


# ===========================================================================
# PART 1 — Demo-loop seed (A21)
# ===========================================================================

@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_produces_customer(client, admin):
    """After seed_demo_loop_if_empty() runs, the demo customer Record exists.
    The seed guards on Subscription emptiness; if the test DB already had subs (from prior
    tests in the session), we look for the demo customer by name as a secondary check."""
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip(
            "seed guard fired (Subscription table was non-empty from prior tests) "
            "and no demo customer found — seed cannot run on a pre-populated DB"
        )
    # Records API flattens data fields into top-level dict (see records._serialize)
    assert demo.get("name") == _DEMO_CUSTOMER_NAME, (
        f"demo customer name mismatch: {demo.get('name')!r} != {_DEMO_CUSTOMER_NAME!r}"
    )


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_customer_has_active_subscription(client, admin):
    """The demo customer seeded by A21 has at least one ACTIVE subscription."""
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip("Demo customer not found — seed guard fired on non-empty DB")
    cid = demo["id"]
    subs = (await client.get(f"/api/subscriptions?customer={cid}", headers=admin)).json()
    active = [s for s in subs if s["status"] == "ACTIVE"]
    assert active, f"demo customer {cid} has no ACTIVE subscription after seed"


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_customer_has_active_service(client, admin):
    """The demo customer seeded by A21 has at least one ACTIVE service."""
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip("Demo customer not found — seed guard fired on non-empty DB")
    cid = demo["id"]
    services = (await client.get(f"/api/services?customer={cid}", headers=admin)).json()
    active = [s for s in services if s["status"] == "ACTIVE"]
    assert active, f"demo customer {cid} has no ACTIVE service after seed"


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_customer_has_paid_invoice(client, admin):
    """The demo customer seeded by A21 has at least one PAID invoice."""
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip("Demo customer not found — seed guard fired on non-empty DB")
    cid = demo["id"]
    invoices = (await client.get(f"/api/invoices?customer={cid}", headers=admin)).json()
    paid = [i for i in invoices if i["status"] == "PAID"]
    assert paid, f"demo customer {cid} has no PAID invoice after seed"


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_360_has_ticket(client, admin):
    """The demo customer's 360 view shows at least one related ticket.

    This test documents a REAL FINDING in A21: the seed creates a Ticket Record
    but does NOT link it to the demo customer. The assertion will pass once
    seed_demo_loop.py adds {"customer": str(customer.id)} to the ticket's data dict.
    """
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip("Demo customer not found — seed guard fired on non-empty DB")
    cid = demo["id"]
    full = (await client.get(f"/api/customers/{cid}/360", headers=admin)).json()
    related = full.get("related", {})
    assert related.get("ticket", 0) >= 1, (
        f"360 shows no linked ticket for demo customer {cid}; related={related}. "
        f"Fix: add {{\"customer\": str(customer.id)}} to the Ticket's data in seed_demo_loop.py."
    )


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_idempotent(client, admin):
    """Calling seed_demo_loop_if_empty() twice does not duplicate the demo customer.
    On a pre-populated DB the guard fires both times (count stays the same either way)."""
    all_before = (await client.get("/api/customers", headers=admin)).json()
    count_before = len(all_before)
    await _SEED_FN()
    await _SEED_FN()
    all_after = (await client.get("/api/customers", headers=admin)).json()
    count_after = len(all_after)
    assert count_after == count_before, (
        f"seed is not idempotent: customer count went from {count_before} to {count_after} "
        f"after two consecutive calls"
    )


@pytest.mark.skipif(not _A21_PRESENT, reason=_A21_REASON or "A21 not wired")
async def test_seed_demo_loop_360_reflects_full_loop(client, admin):
    """The demo customer's 360 view shows subscriptions, invoices, and services.
    Ticket is not asserted here (separate test_seed_demo_loop_360_has_ticket covers that gap)."""
    demo = await _run_seed_and_find_demo_customer(client, admin)
    if demo is None:
        pytest.skip("Demo customer not found — seed guard fired on non-empty DB")
    cid = demo["id"]
    full = (await client.get(f"/api/customers/{cid}/360", headers=admin)).json()
    assert full["summary"]["subscription_count"] >= 1, "360 summary missing subscription"
    assert full["summary"]["invoice_count"] >= 1, "360 summary missing invoices"
    assert full["summary"]["service_count"] >= 1, "360 summary missing services"
    # At least one subscription is present in the subscriptions array
    assert full["subscriptions"], "360 subscriptions list is empty"
    # At least one PAID invoice appears
    invoice_statuses = {i["status"] for i in full["invoices"]}
    assert "PAID" in invoice_statuses, (
        f"no PAID invoice in 360 for demo customer; statuses={invoice_statuses}"
    )


# ===========================================================================
# PART 1b — E2E loop built from existing live endpoints
#            (runs unconditionally; proves subscription+service+invoice+ticket
#             chain is solid independent of A21)
# ===========================================================================

async def test_e2e_loop_subscription_active(client, admin):
    """Create a customer→order→COMPLETED: auto-provisioned subscription is ACTIVE."""
    cid = (await client.post("/api/customers", headers=admin,
                             json={"name": _uniq("B21 Cust")})).json()["id"]
    prod = await _create_product(client, admin, name=_uniq("B21 Plan"), amount=30000)
    completed = await _drive_order_to_completed(client, admin, cid, prod["id"], unit_amount=30000)
    assert completed["provisioned_subscriptions"], "no subscriptions provisioned on COMPLETED order"

    subs = (await client.get(f"/api/subscriptions?customer={cid}", headers=admin)).json()
    active = [s for s in subs if s["status"] == "ACTIVE"]
    assert active, f"no ACTIVE subscription for customer {cid} after order COMPLETED"


async def test_e2e_loop_service_active(client, admin):
    """After order→COMPLETED + service activate: service is ACTIVE with activated_at set."""
    cid = (await client.post("/api/customers", headers=admin,
                             json={"name": _uniq("B21 SvcCust")})).json()["id"]
    prod = await _create_product(client, admin, name=_uniq("B21 SvcPlan"), amount=25000)
    await _drive_order_to_completed(client, admin, cid, prod["id"], unit_amount=25000)

    services = (await client.get(f"/api/services?customer={cid}", headers=admin)).json()
    assert services, f"no services for customer {cid} after COMPLETED order"
    svc_id = services[0]["id"]

    activated = (await client.post(f"/api/services/{svc_id}/activate", headers=admin)).json()
    assert activated["status"] == "ACTIVE", f"service did not go ACTIVE: {activated}"
    assert activated["activated_at"] is not None, "activated_at not set"


async def test_e2e_loop_invoice_paid(client, admin):
    """Full billing cycle: generate-invoice → issue → pay → PAID; 360 reflects it."""
    cid = (await client.post("/api/customers", headers=admin,
                             json={"name": _uniq("B21 InvCust")})).json()["id"]
    prod = await _create_product(client, admin, name=_uniq("B21 InvPlan"), amount=50000)
    await _drive_order_to_completed(client, admin, cid, prod["id"], unit_amount=50000)

    subs = (await client.get(f"/api/subscriptions?customer={cid}", headers=admin)).json()
    sub_id = subs[0]["id"]

    inv = (await client.post(f"/api/subscriptions/{sub_id}/generate-invoice", headers=admin)).json()
    assert inv["status"] == "DRAFT", f"expected DRAFT invoice; got {inv['status']}"
    inv_id = inv["id"]

    issued = (await client.post(f"/api/invoices/{inv_id}/issue", headers=admin)).json()
    assert issued["status"] == "ISSUED"
    assert issued["due_at"] is not None

    pay_r = await client.post(f"/api/invoices/{inv_id}/payments", headers=admin,
                               json={"amount": inv["total"], "method": "card"})
    assert pay_r.status_code == 201, pay_r.text
    paid_inv = (await client.get(f"/api/invoices/{inv_id}", headers=admin)).json()
    assert paid_inv["status"] == "PAID"

    full = (await client.get(f"/api/customers/{cid}/360", headers=admin)).json()
    paid_in_360 = [i for i in full["invoices"] if i["id"] == inv_id and i["status"] == "PAID"]
    assert paid_in_360, "PAID invoice not reflected in 360"


async def test_e2e_loop_ticket_in_360(client, admin):
    """Create a customer + ticket; 360 is always accessible (no 500)."""
    cid = (await client.post("/api/customers", headers=admin,
                             json={"name": _uniq("B21 TktCust")})).json()["id"]
    subject = _uniq("B21 No internet")
    # Try with customer field (A20 lands this); fall back without
    tk = await client.post("/api/tickets", headers=admin,
                           json={"subject": subject, "customer": cid})
    if tk.status_code != 201:
        tk = await client.post("/api/tickets", headers=admin, json={"subject": subject})
    assert tk.status_code == 201, tk.text

    full = (await client.get(f"/api/customers/{cid}/360", headers=admin)).json()
    # The 360 must always respond 200 with a summary (no 500)
    assert "summary" in full, "360 response missing summary"
    assert full.get("subscriptions") is not None, "360 missing subscriptions key"


# ===========================================================================
# PART 2 — Capabilities endpoint (E21)
#
# E21 is not merged. /api/me/capabilities is caught by the generic records router
# (GET /api/{slug}/{rec_id}, slug="me", rec_id="capabilities") and returns 422.
# Skip condition: any status other than 200 means E21 is not live.
# ===========================================================================

_E21_NOT_LIVE_STATUSES = {404, 422}  # 404=no route; 422=generic router catches it first


async def test_capabilities_super_admin_never_500(client, admin):
    """GET /api/me/capabilities as super_admin must not 500 (404/422 acceptable while E21 is unmerged)."""
    r = await client.get("/api/me/capabilities", headers=admin)
    assert r.status_code != 500, f"capabilities endpoint 500'd: {r.text}"


async def test_capabilities_agent_never_500(client, agent):
    """GET /api/me/capabilities as sales_agent must not 500."""
    r = await client.get("/api/me/capabilities", headers=agent)
    assert r.status_code != 500, f"capabilities endpoint 500'd for agent: {r.text}"


async def test_capabilities_super_admin_all_verbs_true(client, admin):
    """E21: super_admin gets all entity verbs = True, read_only = False.
    Skipped until E21 lands (currently returns 422 — generic router intercepts first)."""
    r = await client.get("/api/me/capabilities", headers=admin)
    if r.status_code in _E21_NOT_LIVE_STATUSES:
        pytest.skip(
            f"E21 GET /api/me/capabilities not yet wired (status={r.status_code}); "
            "returns 422 because generic /api/{{slug}}/{{rec_id}} intercepts first"
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # super_admin must not be read-only
    assert body.get("read_only") is False, \
        f"super_admin should have read_only=False; got {body.get('read_only')}"
    # Every real verb must be True for super_admin (wildcard "*"); read_only is a derived
    # flag (view AND no-mutation) and is correctly False for an admin, so it's excluded here.
    entities = body.get("entities", {})
    for entity_key, verbs in entities.items():
        for verb in ("view", "create", "edit", "delete"):
            assert verbs.get(verb) is True, (
                f"super_admin missing {entity_key}.{verb} (expected True, got {verbs.get(verb)})"
            )
        assert verbs.get("read_only") is False, (
            f"super_admin {entity_key}.read_only should be False; got {verbs.get('read_only')}"
        )


async def test_capabilities_sales_agent_narrower_rights(client, agent):
    """E21: sales_agent sees only the rights granted by the sales_agent role.
    Skipped until E21 lands."""
    r = await client.get("/api/me/capabilities", headers=agent)
    if r.status_code in _E21_NOT_LIVE_STATUSES:
        pytest.skip(
            f"E21 GET /api/me/capabilities not yet wired (status={r.status_code})"
        )
    assert r.status_code == 200, r.text
    body = r.json()

    # sales_agent: lead/contact/deal view+create+edit, customer.view only
    entities = body.get("entities", {})
    customer = entities.get("customer", {})
    assert customer.get("view") is True, "sales_agent should have customer.view = True"
    assert customer.get("create") is not True, "sales_agent should NOT have customer.create"
    assert customer.get("delete") is not True, "sales_agent should NOT have customer.delete"

    # Ticket: not in sales_agent permissions
    ticket = entities.get("ticket", {})
    for verb in ("create", "edit", "delete"):
        if verb in ticket:
            assert ticket[verb] is not True, f"sales_agent should NOT have ticket.{verb}"


async def test_capabilities_sales_agent_read_only_correct(client, agent):
    """E21: sales_agent's read_only flag reflects whether ALL entity verbs are view-only.
    sales_agent has create/edit on leads/contacts/deals so read_only should be False.
    Skipped until E21 lands."""
    r = await client.get("/api/me/capabilities", headers=agent)
    if r.status_code in _E21_NOT_LIVE_STATUSES:
        pytest.skip(
            f"E21 GET /api/me/capabilities not yet wired (status={r.status_code})"
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("read_only") is False, \
        f"sales_agent has write perms so read_only should be False; got {body.get('read_only')}"


async def test_capabilities_requires_auth(client):
    """GET /api/me/capabilities without auth must return 401, 404, or 422 — never 200 or 500."""
    r = await client.get("/api/me/capabilities")
    assert r.status_code in (401, 404, 422), \
        f"unauthenticated capabilities must not return {r.status_code}"
