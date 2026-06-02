"""Coverage for workflow on-enter actions + the approval step (M12).

Actions: a transition's `actions` run on entry, inside the transaction, fail-soft (a broken action
logs an `action_failed` Event and never breaks the move).

Approval: a transition flagged `approval` parks a PendingApproval instead of moving the record;
an eligible approver (a covering holder of a qualifying role — here `super_admin`) decides it.
To get a distinct requester vs approver we create a Studio entity with approval:{roles:[super_admin]}
and grant the AGENT edit on just that entity (isolated RoleDef+Assignment via SessionLocal), so the
agent can *request* but only the admin (super_admin) can *approve*.
"""

import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, OrgNode, RoleDef, Assignment
from app.models.approval import PendingApproval


# ---- helpers ----

async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        return admin.id, agent.id


async def _grant_agent_edit(entity_key):
    """Give the agent view/create/edit on `entity_key` at its team node (isolated to this entity)."""
    async with SessionLocal() as s:
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        team = (await s.execute(
            select(OrgNode).where(OrgNode.tenant_id == agent.tenant_id, OrgNode.code == "sales1")
        )).scalar_one()
        role = RoleDef(tenant_id=agent.tenant_id, key=f"{entity_key}_agent_role", label=f"{entity_key} agent",
                       scope="node", permissions=[f"{entity_key}.view", f"{entity_key}.create", f"{entity_key}.edit"])
        s.add(role)
        await s.flush()
        s.add(Assignment(tenant_id=agent.tenant_id, user_id=agent.id, role_id=role.id, node_id=team.id))
        await s.commit()


async def _mk_entity(client, admin, key, slug, transitions, *, extra_fields=None):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key} items", "route_slug": slug, "icon": "x",
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "status", "label": "Status", "type": "status"},
        ] + (extra_fields or []),
        "statuses": [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": transitions,
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _history_types(client, headers, slug, rid):
    return [e["type"] for e in (await client.get(f"/api/{slug}/{rid}/history", headers=headers)).json()]


async def _pa(approval_id):
    async with SessionLocal() as s:
        return (await s.execute(
            select(PendingApproval).where(PendingApproval.id == uuid.UUID(approval_id))
        )).scalar_one()


# ===================== on-enter actions =====================

async def test_actions_set_field_and_emit_event(client, admin):
    await _mk_entity(client, admin, "actset", "act-set", extra_fields=[{"key": "flag", "label": "Flag", "type": "text"}],
                     transitions=[{"from": "OPEN", "to": "DONE", "guard": None, "actions": [
                         {"type": "set_field", "field": "flag", "value": "SET"},
                         {"type": "emit_event", "event_type": "custom_thing", "data": {"k": "v"}},
                     ]}])
    rec = (await client.post("/api/act-set", headers=admin, json={"name": "r"})).json()
    moved = (await client.post(f"/api/act-set/{rec['id']}/transition", headers=admin, json={"to": "DONE"})).json()
    assert moved["status"] == "DONE"
    assert moved["flag"] == "SET"                                  # set_field applied

    types = await _history_types(client, admin, "act-set", rec["id"])
    assert "TRANSITION" in types and "CUSTOM_THING" in types       # custom Event recorded
    assert "ACTION_FAILED" not in types


async def test_broken_action_is_failsoft(client, admin):
    await _mk_entity(client, admin, "actbad", "act-bad", extra_fields=[{"key": "flag", "label": "Flag", "type": "text"}],
                     transitions=[{"from": "OPEN", "to": "DONE", "guard": None, "actions": [
                         {"type": "set_field", "field": "flag", "value": "OK"},   # good
                         {"type": "set_field"},                                   # broken: no 'field'
                     ]}])
    rec = (await client.post("/api/act-bad", headers=admin, json={"name": "r"})).json()
    moved = await client.post(f"/api/act-bad/{rec['id']}/transition", headers=admin, json={"to": "DONE"})
    assert moved.status_code == 200                                # transition still succeeds
    assert moved.json()["status"] == "DONE" and moved.json()["flag"] == "OK"

    types = await _history_types(client, admin, "act-bad", rec["id"])
    assert "TRANSITION" in types and "ACTION_FAILED" in types      # the bad action was logged, not fatal


# ===================== approval step =====================

async def test_approval_parks_lists_to_approver_and_approves(client, admin, agent):
    admin_id, agent_id = await _user_ids()
    await _mk_entity(client, admin, "apprmain", "appr-main",
                     transitions=[{"from": "OPEN", "to": "DONE", "guard": None,
                                   "approval": {"roles": ["super_admin"]}}])
    await _grant_agent_edit("apprmain")

    rec = (await client.post("/api/appr-main", headers=agent, json={"name": "needs ok"})).json()
    # agent (requester) performs the transition → it PARKS, record stays OPEN
    resp = await client.post(f"/api/appr-main/{rec['id']}/transition", headers=agent, json={"to": "DONE"})
    assert resp.status_code == 200
    parked = resp.json()
    assert parked["status"] == "OPEN" and parked["pending_approval"]["status"] == "PENDING"
    approval_id = parked["pending_approval"]["id"]
    assert (await client.get(f"/api/appr-main/{rec['id']}", headers=admin)).json()["status"] == "OPEN"

    # only the eligible approver (admin/super_admin) sees it; the agent does not
    admin_inbox = {a["id"] for a in (await client.get("/api/approvals", headers=admin)).json()}
    assert approval_id in admin_inbox
    assert approval_id not in {a["id"] for a in (await client.get("/api/approvals", headers=agent)).json()}

    # agent is not an eligible approver → 403
    assert (await client.post(f"/api/approvals/{approval_id}/approve", headers=agent)).status_code == 403

    # admin approves → move completes, approval flips APPROVED
    done = await client.post(f"/api/approvals/{approval_id}/approve", headers=admin)
    assert done.status_code == 200 and done.json()["status"] == "APPROVED"
    assert (await client.get(f"/api/appr-main/{rec['id']}", headers=admin)).json()["status"] == "DONE"
    types = await _history_types(client, admin, "appr-main", rec["id"])
    assert types == ["CREATE", "APPROVAL_REQUESTED", "TRANSITION"]


async def test_approval_reject_leaves_record(client, admin, agent):
    await _mk_entity(client, admin, "apprrej", "appr-rej",
                     transitions=[{"from": "OPEN", "to": "DONE", "guard": None,
                                   "approval": {"roles": ["super_admin"]}}])
    await _grant_agent_edit("apprrej")

    rec = (await client.post("/api/appr-rej", headers=agent, json={"name": "to reject"})).json()
    approval_id = (await client.post(f"/api/appr-rej/{rec['id']}/transition", headers=agent,
                                     json={"to": "DONE"})).json()["pending_approval"]["id"]

    rej = await client.post(f"/api/approvals/{approval_id}/reject", headers=admin, json={"note": "no"})
    assert rej.status_code == 200 and rej.json()["status"] == "REJECTED"
    # record untouched
    assert (await client.get(f"/api/appr-rej/{rec['id']}", headers=admin)).json()["status"] == "OPEN"
    types = await _history_types(client, admin, "appr-rej", rec["id"])
    assert types == ["CREATE", "APPROVAL_REQUESTED", "APPROVAL_REJECTED"]
    assert (await _pa(approval_id)).status == "REJECTED"


async def test_approval_guardrails(client, admin, agent):
    admin_id, _ = await _user_ids()
    await _mk_entity(client, admin, "apprgrd", "appr-grd",
                     transitions=[{"from": "OPEN", "to": "DONE", "guard": None,
                                   "approval": {"roles": ["super_admin"]}}])
    await _grant_agent_edit("apprgrd")

    # --- deciding a non-PENDING approval → 409 ---
    rec1 = (await client.post("/api/appr-grd", headers=agent, json={"name": "double decide"})).json()
    a1 = (await client.post(f"/api/appr-grd/{rec1['id']}/transition", headers=agent,
                            json={"to": "DONE"})).json()["pending_approval"]["id"]
    assert (await client.post(f"/api/approvals/{a1}/approve", headers=admin)).status_code == 200
    assert (await client.post(f"/api/approvals/{a1}/approve", headers=admin)).status_code == 409
    assert (await client.post(f"/api/approvals/{a1}/reject", headers=admin)).status_code == 409

    # --- requester cannot approve their own (admin requests on a group-owned record) ---
    rec2 = (await client.post("/api/appr-grd", headers=admin, json={"name": "self approve"})).json()
    a2 = (await client.post(f"/api/appr-grd/{rec2['id']}/transition", headers=admin,
                            json={"to": "DONE"})).json()["pending_approval"]["id"]
    assert (await client.post(f"/api/approvals/{a2}/approve", headers=admin)).status_code == 403

    # --- unknown approval id → 404 ---
    assert (await client.post(f"/api/approvals/{uuid.uuid4()}/approve", headers=admin)).status_code == 404
