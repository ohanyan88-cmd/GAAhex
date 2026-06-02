"""End-to-end tests for the GAAex engine: auth, config-driven CRUD, access, workflow, audit."""


# ---- health & auth ----

async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json()["service"] == "gaaex"


async def test_login_bad_password(client):
    r = await client.post("/auth/login", json={"email": "admin@demo.isp", "password": "nope"})
    assert r.status_code == 401


async def test_me(client, admin):
    r = await client.get("/auth/me", headers=admin)
    assert r.status_code == 200 and r.json()["email"] == "admin@demo.isp"


async def test_me_requires_token(client):
    assert (await client.get("/auth/me")).status_code == 401


# ---- config-driven entities ----

async def test_entities_seeded(client, admin):
    slugs = {e["route_slug"] for e in (await client.get("/meta/entities", headers=admin)).json()}
    assert {"leads", "customers", "contacts", "deals", "tickets"} <= slugs


async def test_entity_def_has_fields(client, admin):
    d = (await client.get("/meta/entities/leads", headers=admin)).json()
    keys = {f["key"] for f in d["fields"]}
    assert {"name", "phone", "status"} <= keys
    assert any(s["is_initial"] and s["key"] == "NEW" for s in d["statuses"])


# ---- generic CRUD + validation ----

async def test_lead_crud(client, admin):
    created = (await client.post("/api/leads", headers=admin, json={"name": "Test Lead", "phone": "+37411"})).json()
    assert created["name"] == "Test Lead" and created["status"] == "NEW"
    got = (await client.get(f"/api/leads/{created['id']}", headers=admin)).json()
    assert got["id"] == created["id"]
    ids = {r["id"] for r in (await client.get("/api/leads", headers=admin)).json()}
    assert created["id"] in ids


async def test_validation(client, admin):
    assert (await client.post("/api/leads", headers=admin, json={"phone": "x"})).status_code == 422   # missing name
    assert (await client.post("/api/leads", headers=admin, json={"name": "Y", "bogus": 1})).status_code == 422


async def test_create_forces_initial_status(client, admin):
    # asking for CONTACTED at create is ignored — lifecycle starts at NEW
    r = (await client.post("/api/leads", headers=admin, json={"name": "Z", "status": "CONTACTED"})).json()
    assert r["status"] == "NEW"


async def test_field_type_validation(client, admin):
    # phone field must look like a phone (your "surname in the phone box" case)
    assert (await client.post("/api/leads", headers=admin, json={"name": "P", "phone": "Petrosyan"})).status_code == 422
    # email field must be a valid email
    assert (await client.post("/api/leads", headers=admin, json={"name": "E", "email": "not-an-email"})).status_code == 422
    # select must be one of the configured options
    assert (await client.post("/api/leads", headers=admin, json={"name": "S", "source": "Telepathy"})).status_code == 422
    # valid values pass
    ok = await client.post("/api/leads", headers=admin, json={"name": "Good", "phone": "+374 91 234567", "email": "g@x.io", "source": "Website"})
    assert ok.status_code == 201


# ---- workflow ----

async def test_workflow_guard_and_transitions(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "WF"})).json()
    # guard: NEW->CONTACTED requires phone
    r = await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "CONTACTED"})
    assert r.status_code == 422
    await client.patch(f"/api/leads/{lead['id']}", headers=admin, json={"phone": "+37499"})
    r = await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "CONTACTED"})
    assert r.status_code == 200 and r.json()["status"] == "CONTACTED"
    # invalid transition
    r = await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "NEW"})
    assert r.status_code == 409


# ---- access control ----

async def test_agent_scope_and_permissions(client, admin, agent):
    # admin lead is owned by the group node; agent (node scope @ team) must NOT see it
    admin_lead = (await client.post("/api/leads", headers=admin, json={"name": "HQ Only"})).json()
    agent_lead = (await client.post("/api/leads", headers=agent, json={"name": "Team Only"})).json()
    agent_ids = {r["id"] for r in (await client.get("/api/leads", headers=agent)).json()}
    assert agent_lead["id"] in agent_ids
    assert admin_lead["id"] not in agent_ids
    # agent has no delete / no customer-create / no ticket access
    assert (await client.delete(f"/api/leads/{agent_lead['id']}", headers=agent)).status_code == 403
    assert (await client.post("/api/customers", headers=agent, json={"name": "Nope"})).status_code == 403
    assert (await client.get("/api/tickets", headers=agent)).status_code == 403


# ---- audit ----

async def test_audit_history(client, admin):
    lead = (await client.post("/api/leads", headers=admin, json={"name": "Audited"})).json()
    await client.patch(f"/api/leads/{lead['id']}", headers=admin, json={"phone": "+37412"})
    await client.post(f"/api/leads/{lead['id']}/transition", headers=admin, json={"to": "CONTACTED"})
    types = [e["type"] for e in (await client.get(f"/api/leads/{lead['id']}/history", headers=admin)).json()]
    assert types == ["CREATE", "UPDATE", "TRANSITION"]


# ---- SuperAdmin Studio (config-write) ----

async def test_me_can_configure(client, admin, agent):
    assert (await client.get("/auth/me", headers=admin)).json()["can_configure"] is True
    assert (await client.get("/auth/me", headers=agent)).json()["can_configure"] is False


async def test_studio_create_entity(client, admin, agent):
    body = {
        "key": "project", "label": "Project", "label_plural": "Projects", "route_slug": "projects", "icon": "folder",
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [{"key": "PLANNED", "label": "Planned", "is_initial": True}, {"key": "DONE", "label": "Done"}],
        "transitions": [{"from": "PLANNED", "to": "DONE", "guard": None}],
    }
    # non-super-admin is denied config writes
    assert (await client.post("/meta/entities", headers=agent, json=body)).status_code == 403
    # super-admin creates the entity entirely from the API — no SQL, no code
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201
    assert "projects" in {e["route_slug"] for e in (await client.get("/meta/entities", headers=admin)).json()}
    # and it immediately works: create + workflow transition
    proj = (await client.post("/api/projects", headers=admin, json={"name": "Build GAAex"})).json()
    assert proj["status"] == "PLANNED"
    moved = (await client.post(f"/api/projects/{proj['id']}/transition", headers=admin, json={"to": "DONE"})).json()
    assert moved["status"] == "DONE"
    # duplicate slug rejected
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 409
