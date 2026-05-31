"""SPEC §4.5 Mandatory Approvals — smoke test for the kernel + router scaffolding.

Covers the happy-path state progression PENDING -> APPROVED -> EXECUTED through the
HTTP surface, plus the kernel-level idempotency contract on create_approval_request.
This is intentionally scoped to scaffolding correctness; the full adoption sweep
(refund / credit-note / invoice-cancel / ... wiring) is covered separately when each
adopter lands. See SPEC-4-5-APPROVALS.md.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.kernel.approvals import (
    MANDATORY_APPROVAL_ACTIONS,
    create_approval_request,
)
from app.models import Event, User
from app.models.approval import Approval


# ---------------------------------------------------------------------------- helpers

async def _admin_id() -> uuid.UUID:
    async with SessionLocal() as s:
        return (
            await s.execute(select(User).where(User.email == "admin@demo.isp"))
        ).scalar_one().id


async def _approval(approval_id: str) -> Approval:
    async with SessionLocal() as s:
        return (
            await s.execute(select(Approval).where(Approval.id == uuid.UUID(approval_id)))
        ).scalar_one()


async def _audit_types(approval_id: str) -> list[str]:
    """Audit Events emitted against (entity_key='approval', record_id=approval_id)."""
    async with SessionLocal() as s:
        rows = (await s.execute(
            select(Event.type).where(
                Event.entity_key == "approval",
                Event.record_id == uuid.UUID(approval_id),
            ).order_by(Event.created_at)
        )).all()
        return [r[0] for r in rows]


# ===================== happy path through the HTTP surface =====================

async def test_create_decide_execute_progression_and_audit(client, admin):
    """End-to-end: a high_discount request progresses PENDING -> APPROVED -> EXECUTED,
    each transition emits an audit Event, and the GET / LIST endpoints reflect each
    state change."""
    target_record_id = str(uuid.uuid4())

    # ---- 1. CREATE (PENDING) ----
    created = (await client.post("/api/mandatory-approvals", headers=admin, json={
        "action_type": "high_discount",
        "target_entity_key": "invoice",
        "target_record_id": target_record_id,
        "payload": {"amount": 250, "reason": "loyalty bonus"},
    })).json()
    assert created["status"] == "PENDING"
    assert created["action_type"] == "high_discount"
    assert created["payload"] == {"amount": 250, "reason": "loyalty bonus"}
    assert created["target_record_id"] == target_record_id
    assert created["decided_by"] is None
    assert created["executed_at"] is None
    approval_id = created["id"]

    # GET single
    fetched = (await client.get(f"/api/mandatory-approvals/{approval_id}", headers=admin)).json()
    assert fetched["status"] == "PENDING"

    # LIST with status filter sees it
    listed = (await client.get("/api/mandatory-approvals?status=PENDING", headers=admin)).json()
    assert approval_id in {a["id"] for a in listed}

    # ---- 2. DECIDE: APPROVED ----
    decided = (await client.patch(
        f"/api/mandatory-approvals/{approval_id}/decide",
        headers=admin, json={"decision": "APPROVED", "reason": "policy met"},
    )).json()
    assert decided["status"] == "APPROVED"
    assert decided["decided_by"] is not None
    assert decided["decision_reason"] == "policy met"
    assert decided["executed_at"] is None

    # Re-deciding the same row is refused (409, forward-only).
    again = await client.patch(
        f"/api/mandatory-approvals/{approval_id}/decide",
        headers=admin, json={"decision": "REJECTED", "reason": "nope"},
    )
    assert again.status_code == 409

    # ---- 3. EXECUTE ----
    executed = (await client.post(
        f"/api/mandatory-approvals/{approval_id}/execute", headers=admin,
    )).json()
    assert executed["status"] == "EXECUTED"
    assert executed["executed_at"] is not None

    # Re-executing is refused (409).
    re_exec = await client.post(
        f"/api/mandatory-approvals/{approval_id}/execute", headers=admin,
    )
    assert re_exec.status_code == 409

    # ---- 4. Audit (SPEC §0.4): every state change recorded ----
    audit = await _audit_types(approval_id)
    assert audit == ["create approval", "update approval", "execute approval"]

    # DB row matches HTTP surface
    row = await _approval(approval_id)
    assert row.status == "EXECUTED"
    assert row.decision_reason == "policy met"


# ===================== reject path =====================

async def test_decide_rejected_blocks_execute(client, admin):
    """A REJECTED approval cannot be EXECUTED (409). Audit trail still captures the
    rejection."""
    created = (await client.post("/api/mandatory-approvals", headers=admin, json={
        "action_type": "refund",
        "target_entity_key": "invoice",
        "target_record_id": str(uuid.uuid4()),
        "payload": {"amount": 99},
    })).json()
    approval_id = created["id"]

    rej = (await client.patch(
        f"/api/mandatory-approvals/{approval_id}/decide",
        headers=admin, json={"decision": "REJECTED", "reason": "out of policy"},
    )).json()
    assert rej["status"] == "REJECTED"

    # Execute on a REJECTED row → 409.
    ex = await client.post(
        f"/api/mandatory-approvals/{approval_id}/execute", headers=admin,
    )
    assert ex.status_code == 409

    audit = await _audit_types(approval_id)
    assert audit == ["create approval", "update approval"]


# ===================== validation =====================

async def test_invalid_action_type_rejected(client, admin):
    """An action_type outside MANDATORY_APPROVAL_ACTIONS is 422."""
    r = await client.post("/api/mandatory-approvals", headers=admin, json={
        "action_type": "not_a_real_action",
        "payload": {},
    })
    assert r.status_code == 422


async def test_all_spec_action_types_accepted(client, admin):
    """Every SPEC §4.5 action type is accepted by the create endpoint."""
    for action_type in sorted(MANDATORY_APPROVAL_ACTIONS):
        r = await client.post("/api/mandatory-approvals", headers=admin, json={
            "action_type": action_type,
            "payload": {"smoke": True},
        })
        assert r.status_code == 201, f"action_type={action_type} got {r.status_code}: {r.text}"


# ===================== kernel idempotency =====================

async def test_create_approval_request_is_idempotent():
    """The kernel-level helper dedupes on (tenant, action_type, target_*, requested_by)
    when an existing PENDING / APPROVED row matches — protects against UI retries."""
    admin_id = await _admin_id()
    target_record_id = uuid.uuid4()

    async with SessionLocal() as s:
        user = (
            await s.execute(select(User).where(User.id == admin_id))
        ).scalar_one()
        tenant_id = user.tenant_id

        first = await create_approval_request(
            s,
            tenant_id=tenant_id,
            action_type="credit_note",
            requested_by_user_id=admin_id,
            target_entity_key="invoice",
            target_record_id=target_record_id,
            payload={"reason": "billing error"},
        )
        await s.commit()
        first_id = first.id

    async with SessionLocal() as s:
        # Second submission — should return the SAME row, not a new one.
        second = await create_approval_request(
            s,
            tenant_id=tenant_id,
            action_type="credit_note",
            requested_by_user_id=admin_id,
            target_entity_key="invoice",
            target_record_id=target_record_id,
            payload={"reason": "retry"},
        )
        await s.commit()
        assert second.id == first_id
        assert second.status == "PENDING"
        # Original payload is preserved — dedupe returns the existing row.
        assert second.payload == {"reason": "billing error"}


# ===================== adoption: customer_delete on DELETE /api/customers/{id} =====================


async def test_spec_4_5_customer_delete_gate(client, admin):
    """DELETE /api/customers/{id} parks a customer_delete approval; second call deletes."""
    # Create a throwaway customer.
    cust = (await client.post("/api/customers", headers=admin,
                              json={"name": "DoomedCo"})).json()
    cid = cust["id"]

    # 1. First DELETE returns 202 with approval_id.
    pending = await client.delete(f"/api/customers/{cid}", headers=admin)
    assert pending.status_code == 202
    body = pending.json()["detail"]
    assert body["status"] == "approval_required"
    assert body["action_type"] == "customer_delete"
    aid = body["approval_id"]

    # Customer is still listed (no deletion happened).
    listed = (await client.get("/api/customers", headers=admin)).json()
    assert cid in {c["id"] for c in listed}

    # 2. Approve.
    decided = await client.patch(f"/api/mandatory-approvals/{aid}/decide", headers=admin,
                                 json={"decision": "APPROVED"})
    assert decided.status_code == 200

    # 3. Retry DELETE — succeeds (204).
    final_del = await client.delete(f"/api/customers/{cid}", headers=admin)
    assert final_del.status_code == 204

    # Customer is gone.
    listed_after = (await client.get("/api/customers", headers=admin)).json()
    assert cid not in {c["id"] for c in listed_after}

    # The approval row is now EXECUTED.
    final = (await client.get(f"/api/mandatory-approvals/{aid}", headers=admin)).json()
    assert final["status"] == "EXECUTED"


async def test_spec_4_5_non_customer_delete_passes_through(client, admin):
    """DELETE on a non-customer slug does NOT trigger the customer_delete gate."""
    # Leads (route_slug='leads') are a plain record; DELETE should pass through.
    lead = (await client.post("/api/leads", headers=admin,
                              json={"name": "Throwaway lead"})).json()
    r = await client.delete(f"/api/leads/{lead['id']}", headers=admin)
    assert r.status_code == 204  # no 202 parking step


# ===================== adoption: asset_writeoff on POST /api/assets/{id}/writeoff =====================


async def _create_asset_record(tag: str, name: str = "Test Asset", kind: str = "switch") -> str:
    """Insert an asset Record directly via SessionLocal. The 'asset' entity_def isn't seeded in
    the test DB (it's part of the lifespan-time catalog seed, which ASGITransport skips), so
    POST /api/assets via the generic record router 404s with 'Unknown entity'. The writeoff
    endpoint queries the Record table directly by id+tenant+entity_key — no entity_def lookup —
    so a hand-inserted Record is sufficient for the §4.5 gate tests."""
    from app.models import Record
    async with SessionLocal() as s:
        admin_user = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        rec = Record(
            tenant_id=admin_user.tenant_id,
            entity_key="asset",
            owner_node_id=None,
            status="ACTIVE",
            data={"tag": tag, "name": name, "kind": kind},
        )
        s.add(rec)
        await s.commit()
        return str(rec.id)


async def test_spec_4_5_asset_writeoff_gated_by_approval_then_executed(client, admin):
    """POST /api/assets/{id}/writeoff parks an asset_writeoff approval; second call performs the
    status mutation ACTIVE → WRITTEN_OFF and stamps writeoff metadata on the asset record."""
    aid = await _create_asset_record(f"AST-WO-{uuid.uuid4().hex[:8]}", "Cisco SG350", "switch")

    # 1. First writeoff returns 202 with approval_id.
    pending = await client.post(f"/api/assets/{aid}/writeoff", headers=admin,
                                json={"reason": "stolen on-site", "residual_amount": 0})
    assert pending.status_code == 202, pending.text
    body = pending.json()["detail"]
    assert body["status"] == "approval_required"
    assert body["action_type"] == "asset_writeoff"
    approval_id = body["approval_id"]

    # 2. Approve.
    decided = await client.patch(f"/api/mandatory-approvals/{approval_id}/decide",
                                 headers=admin, json={"decision": "APPROVED"})
    assert decided.status_code == 200, decided.text

    # 3. Retry — succeeds, status flips, writeoff metadata stamped.
    final = await client.post(f"/api/assets/{aid}/writeoff", headers=admin,
                              json={"reason": "stolen on-site", "residual_amount": 0})
    assert final.status_code == 200, final.text
    out = final.json()
    assert out["status"] == "WRITTEN_OFF"
    wo = out["writeoff"]
    assert wo["reason"] == "stolen on-site"
    assert wo["residual_amount"] == 0
    assert wo["previous_status"] == "ACTIVE"
    assert wo["written_off_at"]

    # The approval row is now EXECUTED.
    appr = (await client.get(f"/api/mandatory-approvals/{approval_id}", headers=admin)).json()
    assert appr["status"] == "EXECUTED"

    # Idempotency / re-writeoff is rejected with 409.
    again = await client.post(f"/api/assets/{aid}/writeoff", headers=admin,
                              json={"reason": "again"})
    assert again.status_code == 409, again.text


async def test_spec_4_5_asset_writeoff_requires_reason(client, admin):
    """asset_writeoff requires a non-empty reason on the request body (422)."""
    aid = await _create_asset_record(f"AST-WO-{uuid.uuid4().hex[:8]}", "Patch panel")
    bad = await client.post(f"/api/assets/{aid}/writeoff", headers=admin, json={})
    assert bad.status_code == 422
