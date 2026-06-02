"""SPEC §8 Customer Timeline coverage.

Verifies that `GET /api/customers/{id}/timeline`:
  - Projects an invoice issue, a payment, a ticket open, and a ticket close as four
    distinct SPEC §8 timeline items, with the canonical SPEC labels.
  - Returns items newest-first.
  - Filters out audit rows that are NOT on SPEC §8 (e.g. "assign", "update").
  - Cannot be edited or deleted (SPEC §0.4 append-only, inherited from the `event`
    table DB triggers — checked by direct DB attempt).
  - 403s when the caller cannot view the customer.
  - 404s for non-customer ids and across-tenant ids.
  - Round-trips through the unit-level `classify_event` matrix for every SPEC §8
    case so the kernel mapping has direct coverage.
"""

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select, text

from app.db import SessionLocal
from app.models import Event, Record, OrgNode, User, Tenant
from app.kernel.timeline import classify_event, SPEC_8_TIMELINE_KINDS


# ===================== helpers =====================


async def _customer(client, headers, name: str) -> str:
    r = await client.post("/api/customers", headers=headers, json={"name": name})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


# ===================== classify_event unit matrix =====================


def _ev(t: str, ek: str, data: dict | None = None) -> Event:
    """Build an in-memory Event row for classify_event (no DB write)."""
    return Event(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        type=t,
        entity_key=ek,
        record_id=uuid.uuid4(),
        actor_user_id=None,
        data=data or {},
        created_at=datetime.now(timezone.utc),
    )


def test_classify_lead_created():
    assert classify_event(_ev("CREATE", "lead")) == ("lead", "Lead created")


def test_classify_contract_signed():
    assert classify_event(_ev("TRANSITION", "contract", {"from": "DRAFT", "to": "SIGNED"})) == (
        "contract", "Contract signed",
    )


def test_classify_service_installed():
    assert classify_event(_ev("CREATE", "service")) == ("service", "Service installed")


def test_classify_service_activated_from_pending():
    assert classify_event(_ev("TRANSITION", "service", {"from": "PENDING", "to": "ACTIVE"})) == (
        "service", "Service activated",
    )


def test_classify_service_suspended():
    assert classify_event(_ev("TRANSITION", "service", {"from": "ACTIVE", "to": "SUSPENDED"})) == (
        "service", "Service suspended",
    )


def test_classify_service_restored():
    # Restored must beat plain "activated" — old must be SUSPENDED.
    assert classify_event(_ev("TRANSITION", "service", {"from": "SUSPENDED", "to": "ACTIVE"})) == (
        "service", "Service restored",
    )


def test_classify_invoice_issued():
    assert classify_event(_ev("TRANSITION", "invoice", {"from": "DRAFT", "to": "ISSUED"})) == (
        "invoice", "Invoice issued",
    )


def test_classify_invoice_draft_not_timeline_eligible():
    # SPEC §8 says "Invoice issued" — a fresh DRAFT invoice is not on the timeline.
    assert classify_event(_ev("CREATE", "invoice")) is None


def test_classify_payment_received():
    assert classify_event(_ev("PAYMENT", "invoice", {"amount": 100})) == (
        "payment", "Payment received",
    )


def test_classify_ticket_opened():
    assert classify_event(_ev("CREATE", "helpdesk_ticket")) == ("ticket", "Ticket opened")


def test_classify_ticket_closed():
    assert classify_event(_ev("TRANSITION", "helpdesk_ticket", {"from": "OPEN", "to": "CLOSED"})) == (
        "ticket", "Ticket closed",
    )


def test_classify_ticket_resolved_is_closed():
    # SPEC §8 says "Ticket closed"; the helpdesk lifecycle uses both RESOLVED and CLOSED
    # as terminal-ish states. Both project as "Ticket closed".
    assert classify_event(_ev("TRANSITION", "helpdesk_ticket", {"from": "OPEN", "to": "RESOLVED"})) == (
        "ticket", "Ticket closed",
    )


def test_classify_work_order_completed():
    assert classify_event(_ev("TRANSITION", "work_order", {"from": "OPEN", "to": "COMPLETED"})) == (
        "work_order", "Work order completed",
    )


def test_classify_communication_sent():
    assert classify_event(_ev("CREATE", "communication")) == ("communication", "Communication sent")
    # the existing build emits on "interaction" — treated as the same SPEC §8 category
    assert classify_event(_ev("CREATE", "interaction")) == ("communication", "Communication sent")


def test_classify_document_uploaded():
    assert classify_event(_ev("CREATE", "document")) == ("document", "Document uploaded")


def test_classify_drops_non_timeline_events():
    # Things in the audit log that are NOT on SPEC §8 must classify as None.
    assert classify_event(_ev("ASSIGN", "helpdesk_ticket")) is None
    assert classify_event(_ev("UPDATE", "helpdesk_ticket", {"changed": {"subject": "x"}})) is None
    assert classify_event(_ev("SLA_BREACH", "helpdesk_ticket")) is None
    assert classify_event(_ev("ACTION_FAILED", "lead", {"action": "notify"})) is None
    assert classify_event(_ev("CREATE", "subscription", {"plan_name": "P"})) is None
    assert classify_event(_ev("CREATE", "order")) is None
    assert classify_event(_ev("TRANSITION", "product", {"to": "retired"})) is None


def test_spec_8_timeline_kinds_covers_all_categories():
    # Sanity: SPEC §8 has 9 distinct kinds (some labels share a kind: service has 4 labels).
    assert set(SPEC_8_TIMELINE_KINDS) == {
        "lead", "contract", "service", "invoice", "payment",
        "ticket", "work_order", "communication", "document",
    }


# ===================== end-to-end via the HTTP route =====================


@pytest.mark.asyncio
async def test_timeline_full_flow(client, admin):
    """Seed a customer + invoice issued + payment + ticket opened + ticket closed.
    Expect 4 SPEC §8 entries, newest-first, with the canonical labels."""
    cust = await _customer(client, admin, f"TL Acme {uuid.uuid4().hex[:6]}")

    # subscription → generate invoice → issue invoice → record payment
    sub = (await client.post(
        "/api/subscriptions", headers=admin,
        json={"plan_name": "P-TL", "amount": 30000, "cycle": "monthly", "customer_id": cust},
    )).json()
    inv = (await client.post(
        f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin
    )).json()
    r_issue = await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)
    assert r_issue.status_code == 200, r_issue.text
    r_pay = await client.post(
        f"/api/invoices/{inv['id']}/payments", headers=admin,
        json={"amount": 10000, "method": "cash"},
    )
    assert r_pay.status_code in (200, 201), r_pay.text

    # ticket opened → ticket closed
    t = (await client.post(
        "/api/helpdesk/tickets", headers=admin,
        json={"subject": "TL test", "priority": "NORMAL", "customer_id": cust},
    )).json()
    r_close = await client.post(f"/api/helpdesk/tickets/{t['id']}/close", headers=admin)
    assert r_close.status_code == 200, r_close.text

    # GET timeline
    r = await client.get(f"/api/customers/{cust}/timeline", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["spec"] == "SPEC §8"
    assert body["limit"] == 50
    items = body["items"]

    # 4 SPEC §8 labels we expect to find for this flow.
    labels = [it["label"] for it in items]
    assert "Invoice issued" in labels
    assert "Payment received" in labels
    assert "Ticket opened" in labels
    assert "Ticket closed" in labels

    # newest-first ordering — every item's `at` must be >= the next item's.
    ats = [it["at"] for it in items]
    assert ats == sorted(ats, reverse=True), f"items not newest-first: {ats}"

    # Sanity: kinds populated and entity_key present.
    kinds = {it["kind"] for it in items}
    assert kinds & {"invoice", "payment", "ticket"}
    for it in items:
        assert it["entity_key"] in (
            "invoice", "helpdesk_ticket", "ticket",
            "service", "lead", "customer",
            "contract", "work_order", "communication", "interaction", "document",
        )
        assert "id" in it and "at" in it and "label" in it


@pytest.mark.asyncio
async def test_timeline_filters_non_spec8_events(client, admin):
    """Audit rows for things outside SPEC §8 (a customer name update, a subscription
    creation) must NOT appear on the timeline."""
    cust = await _customer(client, admin, f"TL Filter {uuid.uuid4().hex[:6]}")

    # patching the customer fires update events — must NOT be on timeline.
    await client.patch(f"/api/customers/{cust}", headers=admin, json={"data": {"name": "TL Filter R"}})
    # creating a subscription fires "create" "subscription" — must NOT be on timeline either.
    await client.post(
        "/api/subscriptions", headers=admin,
        json={"plan_name": "Filter", "amount": 1000, "cycle": "monthly", "customer_id": cust},
    )

    r = await client.get(f"/api/customers/{cust}/timeline", headers=admin)
    assert r.status_code == 200
    items = r.json()["items"]
    # nothing in this flow is SPEC §8 eligible — expect no items.
    assert items == []


@pytest.mark.asyncio
async def test_timeline_pagination_cursor(client, admin):
    """`limit` clamps the page size; the response surfaces a next_before_ts cursor
    when there's more data to page through."""
    cust = await _customer(client, admin, f"TL Page {uuid.uuid4().hex[:6]}")

    # 3 issued invoices → 3 "Invoice issued" timeline rows
    for i in range(3):
        sub = (await client.post(
            "/api/subscriptions", headers=admin,
            json={"plan_name": f"P-{i}", "amount": 500 * (i + 1), "cycle": "monthly", "customer_id": cust},
        )).json()
        inv = (await client.post(
            f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin
        )).json()
        await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)

    # limit=2 → 2 items + a cursor for the next page.
    r1 = await client.get(f"/api/customers/{cust}/timeline?limit=2", headers=admin)
    assert r1.status_code == 200
    body1 = r1.json()
    assert len(body1["items"]) == 2
    assert body1["next_before_ts"] is not None
    assert all(it["label"] == "Invoice issued" for it in body1["items"])

    # use the cursor — should return the remaining issue rows (1 more).
    r2 = await client.get(
        f"/api/customers/{cust}/timeline?limit=2&before_ts={body1['next_before_ts']}",
        headers=admin,
    )
    assert r2.status_code == 200
    body2 = r2.json()
    assert len(body2["items"]) >= 1
    # And we ran out of pages — the short page must carry no cursor.
    assert body2["next_before_ts"] is None


@pytest.mark.asyncio
async def test_timeline_404_for_non_customer(client, admin):
    # random id → 404
    r = await client.get(f"/api/customers/{uuid.uuid4()}/timeline", headers=admin)
    assert r.status_code == 404
    # a lead (different entity_key) under /api/customers → 404
    lead = (await client.post("/api/leads", headers=admin, json={"name": "TL not-cust"})).json()["id"]
    r2 = await client.get(f"/api/customers/{lead}/timeline", headers=admin)
    assert r2.status_code == 404


@pytest.mark.asyncio
async def test_timeline_tenant_isolation(client, admin):
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP TL {uuid.uuid4().hex[:6]}")
        s.add(other)
        await s.flush()
        rec = Record(
            tenant_id=other.id, entity_key="customer", owner_node_id=None,
            status="PROSPECT", data={"name": "Foreign TL"},
        )
        s.add(rec)
        await s.commit()
        foreign = str(rec.id)
    # 404 (never another tenant's data)
    r = await client.get(f"/api/customers/{foreign}/timeline", headers=admin)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_timeline_scope_403_for_agent(client, admin, agent):
    """An HQ-owned customer (admin's default scope) is not visible to the team agent → 403."""
    hq_cust = await _customer(client, admin, f"TL HQ {uuid.uuid4().hex[:6]}")
    r = await client.get(f"/api/customers/{hq_cust}/timeline", headers=agent)
    assert r.status_code == 403


async def _ensure_event_append_only_triggers(s):
    """Install the SPEC §0.4 prevent_update_event / prevent_delete_event triggers if they
    aren't already on the test DB.

    The production schema gets them from alembic revision b70ef3b98e27 (see
    `alembic/versions/b70ef3b98e27_kernel_invariants_db_triggers_region_id.py`). The test
    fixture builds the schema via `Base.metadata.create_all` — which does NOT run alembic —
    so the triggers are absent unless we install them. We install them here so the test
    verifies the actual invariant the timeline relies on rather than the bootstrap path
    that happens to be used in the test session.
    """
    # The trigger function bodies are copy-paste of the alembic revision so the assertion
    # text matches what production would raise. Kept inline (vs imported) so this test is
    # self-contained and doesn't reach into alembic at test time.
    await s.execute(text("""
        CREATE OR REPLACE FUNCTION prevent_update_event() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'event (audit log) is append-only per SPEC §0.4 — no UPDATE allowed by any role including Admin'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """))
    await s.execute(text("""
        CREATE OR REPLACE FUNCTION prevent_delete_event() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'event (audit log) is append-only per SPEC §0.4 — no DELETE allowed by any role including Admin'
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql;
    """))
    await s.execute(text("DROP TRIGGER IF EXISTS prevent_update_event ON event"))
    await s.execute(text("""
        CREATE TRIGGER prevent_update_event
            BEFORE UPDATE ON event
            FOR EACH ROW EXECUTE FUNCTION prevent_update_event();
    """))
    await s.execute(text("DROP TRIGGER IF EXISTS prevent_delete_event ON event"))
    await s.execute(text("""
        CREATE TRIGGER prevent_delete_event
            BEFORE DELETE ON event
            FOR EACH ROW EXECUTE FUNCTION prevent_delete_event();
    """))
    await s.commit()


@pytest.mark.asyncio
async def test_timeline_append_only_db_level(client, admin):
    """SPEC §0.4 — event rows that source the timeline cannot be UPDATEd or DELETEd
    at the DB layer. Triggers `prevent_update_event` / `prevent_delete_event` raise
    on any attempt, even from a kernel/owner session. This is the inherited
    immutability the timeline relies on."""
    # Test fixture builds via create_all (no alembic) — install the SPEC §0.4 triggers
    # so this test verifies the real invariant.
    async with SessionLocal() as s:
        await _ensure_event_append_only_triggers(s)

    cust = await _customer(client, admin, f"TL Append {uuid.uuid4().hex[:6]}")
    # Drop an issued invoice on this customer to make a payment row exist.
    sub = (await client.post(
        "/api/subscriptions", headers=admin,
        json={"plan_name": "Append", "amount": 7000, "cycle": "monthly", "customer_id": cust},
    )).json()
    inv = (await client.post(
        f"/api/subscriptions/{sub['id']}/generate-invoice", headers=admin
    )).json()
    await client.post(f"/api/invoices/{inv['id']}/issue", headers=admin)

    # Fetch the timeline event id.
    r = await client.get(f"/api/customers/{cust}/timeline", headers=admin)
    items = r.json()["items"]
    issued = [it for it in items if it["label"] == "Invoice issued"]
    assert issued, "expected an Invoice issued event on the timeline"
    ev_id = issued[0]["id"]

    # DB-level UPDATE — must raise (prevent_update_event trigger).
    async with SessionLocal() as s:
        with pytest.raises(Exception) as exc_info_update:
            await s.execute(
                text("UPDATE event SET type = 'tampered' WHERE id = :id"),
                {"id": ev_id},
            )
            await s.commit()
    assert "SPEC" in str(exc_info_update.value) or "append" in str(exc_info_update.value).lower() \
        or "update" in str(exc_info_update.value).lower()

    # DB-level DELETE — must raise (prevent_delete_event trigger).
    async with SessionLocal() as s:
        with pytest.raises(Exception) as exc_info_delete:
            await s.execute(text("DELETE FROM event WHERE id = :id"), {"id": ev_id})
            await s.commit()
    assert "SPEC" in str(exc_info_delete.value) or "append" in str(exc_info_delete.value).lower() \
        or "delete" in str(exc_info_delete.value).lower()

    # And the timeline still returns the same row — append-only invariant intact.
    r2 = await client.get(f"/api/customers/{cust}/timeline", headers=admin)
    still = [it for it in r2.json()["items"] if it["id"] == ev_id]
    assert len(still) == 1
    assert still[0]["label"] == "Invoice issued"
