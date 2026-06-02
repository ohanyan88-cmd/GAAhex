"""Edge-case tests for the GAAhex engine: scope leaks, validation, workflow, not-found, access verbs.

Reuses the session-scoped fixtures from conftest.py (client, admin, agent).
admin = super_admin @ tenant scope (primary node = group); agent = sales_agent @ node scope (team).
"""

import uuid


# ---- scope: an agent must not see or touch records outside its org subtree ----

async def test_agent_cannot_see_group_owned_record_in_list(client, admin, agent):
    # admin's primary node is the group → this lead is owned above the agent's team subtree
    hq = (await client.post("/api/leads", headers=admin, json={"name": "Group Owned"})).json()
    agent_ids = {r["id"] for r in (await client.get("/api/leads", headers=agent)).json()}
    assert hq["id"] not in agent_ids


async def test_agent_cannot_get_out_of_scope_record(client, admin, agent):
    # record exists in the tenant (so it's found), but the agent lacks scope → 403, not 404
    hq = (await client.post("/api/leads", headers=admin, json={"name": "HQ Secret"})).json()
    r = await client.get(f"/api/leads/{hq['id']}", headers=agent)
    assert r.status_code == 403


async def test_agent_cannot_transition_out_of_scope_record(client, admin, agent):
    hq = (await client.post("/api/leads", headers=admin, json={"name": "HQ WF", "phone": "+37411"})).json()
    r = await client.post(f"/api/leads/{hq['id']}/transition", headers=agent, json={"to": "CONTACTED"})
    assert r.status_code == 403


# ---- validation: bad field values are rejected with 422 ----

async def test_invalid_select_value_rejected(client, admin):
    r = await client.post("/api/leads", headers=admin, json={"name": "Sel", "source": "Carrier Pigeon"})
    assert r.status_code == 422


async def test_invalid_email_rejected(client, admin):
    r = await client.post("/api/leads", headers=admin, json={"name": "Mail", "email": "nope@@broken"})
    assert r.status_code == 422


async def test_unknown_field_rejected(client, admin):
    r = await client.post("/api/leads", headers=admin, json={"name": "Unk", "definitely_not_a_field": 7})
    assert r.status_code == 422


# ---- workflow: invalid transitions are blocked ----

async def test_unknown_transition_target_409(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "T409"})).json()
    r = await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "NOWHERE"})
    assert r.status_code == 409


async def test_transition_guard_failure_422(client, admin):
    # NEW->CONTACTED guard requires a phone; created without one → guard fails
    lead = (await client.post("/api/leads", headers=admin, json={"name": "T422"})).json()
    r = await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "CONTACTED"})
    assert r.status_code == 422


# ---- not-found: operations on a random uuid → 404 ----

async def test_get_nonexistent_404(client, admin):
    assert (await client.get(f"/api/leads/{uuid.uuid4()}", headers=admin)).status_code == 404


async def test_patch_nonexistent_404(client, admin):
    r = await client.patch(f"/api/leads/{uuid.uuid4()}", headers=admin, json={"name": "ghost"})
    assert r.status_code == 404


async def test_delete_nonexistent_404(client, admin):
    assert (await client.delete(f"/api/leads/{uuid.uuid4()}", headers=admin)).status_code == 404


# ---- access verbs: agent is view-only on customers and has no ticket access ----

async def test_agent_create_customer_forbidden(client, agent):
    # sales_agent has customer.view but NOT customer.create → 403
    r = await client.post("/api/customers", headers=agent, json={"name": "Nope Inc"})
    assert r.status_code == 403


async def test_agent_tickets_no_access(client, agent):
    # sales_agent has no permission on tickets at all → 403 on both read and write
    assert (await client.get("/api/tickets", headers=agent)).status_code == 403
    assert (await client.post("/api/tickets", headers=agent, json={"name": "X"})).status_code == 403
