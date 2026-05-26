"""Coverage for field-level access (FieldDef.config view_roles / edit_roles).

A field may declare `{"view_roles":[...]}` and/or `{"edit_roles":[...]}`:
  - no view_roles ⇒ visible to anyone who can view the record (default-open)
  - no edit_roles  ⇒ editable by anyone who can edit the record (default-open)
  - a config.manage holder (admin) bypasses both gates.

Setup: a Studio entity with a view-gated field, an edit-gated field, and an open field; the AGENT
gets an isolated role granting view/create/edit on just that entity (so records it makes are in its
team scope and viewable). The agent holds neither `super_admin` nor `config.manage`, so the
`["super_admin"]` gates exclude it. Unique entity/role keys per test.
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User, OrgNode, RoleDef, Assignment


async def _grant_agent_crud(entity_key):
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


async def _mk_entity(client, admin, key, slug):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key} items", "route_slug": slug, "icon": "x",
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "secret", "label": "Secret", "type": "text", "config": {"view_roles": ["super_admin"]}},
            {"key": "locked", "label": "Locked", "type": "text", "config": {"edit_roles": ["super_admin"]}},
            {"key": "openf", "label": "Open", "type": "text"},
        ],
    }
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


# ===================== view gate (meta) =====================

async def test_meta_hides_view_gated_field_from_agent(client, admin, agent):
    await _mk_entity(client, admin, "favm", "fa-vm")
    await _grant_agent_crud("favm")

    agent_fields = {f["key"]: f for f in (await client.get("/meta/entities/fa-vm", headers=agent)).json()["fields"]}
    assert "secret" not in agent_fields                      # view-gated → hidden from the agent
    assert {"name", "locked", "openf"} <= set(agent_fields)

    admin_fields = {f["key"]: f for f in (await client.get("/meta/entities/fa-vm", headers=admin)).json()["fields"]}
    assert "secret" in admin_fields                          # admin (config.manage) sees it
    assert all(f["editable"] is True for f in admin_fields.values())   # admin bypasses the edit gate


async def test_meta_editable_flag_per_role(client, admin, agent):
    await _mk_entity(client, admin, "fae", "fa-e")
    await _grant_agent_crud("fae")

    af = {f["key"]: f for f in (await client.get("/meta/entities/fa-e", headers=agent)).json()["fields"]}
    assert af["locked"]["editable"] is False                 # edit-gated for the agent
    assert af["openf"]["editable"] is True                   # no roles ⇒ default-open
    assert af["name"]["editable"] is True


# ===================== view gate (records output) =====================

async def test_records_strip_view_gated_value_for_agent(client, admin, agent):
    await _mk_entity(client, admin, "favr", "fa-vr")
    await _grant_agent_crud("favr")

    # agent creates a (team-owned, in-scope) record; it CAN set `secret` (no edit gate on it)
    rec = (await client.post("/api/fa-vr", headers=agent, json={"name": "r", "secret": "topsecret", "openf": "x"})).json()
    rid = rec["id"]
    assert "secret" not in rec                               # stripped even from the create response

    # agent reading it back: secret hidden, open field present
    got = (await client.get(f"/api/fa-vr/{rid}", headers=agent)).json()
    assert "secret" not in got and got["openf"] == "x"
    # and in the list view
    listed = next(r for r in (await client.get("/api/fa-vr", headers=agent)).json() if r["id"] == rid)
    assert "secret" not in listed

    # admin sees the value (bypasses the view gate; tenant scope covers the team record)
    admin_got = (await client.get(f"/api/fa-vr/{rid}", headers=admin)).json()
    assert admin_got["secret"] == "topsecret"


# ===================== edit gate (records write) =====================

async def test_edit_gated_field_blocks_agent_writes(client, admin, agent):
    await _mk_entity(client, admin, "faed", "fa-ed")
    await _grant_agent_crud("faed")

    # creating WITH the edit-gated field → 403
    assert (await client.post("/api/fa-ed", headers=agent,
                              json={"name": "r", "locked": "nope"})).status_code == 403

    # a record without it is fine; then patching the edit-gated field → 403
    rid = (await client.post("/api/fa-ed", headers=agent, json={"name": "r2"})).json()["id"]
    assert (await client.patch(f"/api/fa-ed/{rid}", headers=agent, json={"locked": "x"})).status_code == 403

    # an open field stays freely editable (default-open, no regression)
    assert (await client.patch(f"/api/fa-ed/{rid}", headers=agent, json={"openf": "y"})).status_code == 200

    # admin (bypass) can set the edit-gated field
    assert (await client.patch(f"/api/fa-ed/{rid}", headers=admin, json={"locked": "ok"})).status_code == 200
