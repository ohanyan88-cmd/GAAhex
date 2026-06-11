"""Coverage for search/filter/sort on GET /api/{slug} and the saved-views API (M11).

Search runs strictly AFTER access control: org-scope + view-gate first, then q (case-insensitive
substring over text data), then a GXL `filter` (fail-closed per record), then `sort` (missing values
last). Saved views live at /api/views, which must NOT be shadowed by the generic /api/{slug} router.

Shared session DB accumulates, so every test tags its records with a unique token and asserts on
that subset; saved-view assertions key on the ids we create.
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User


async def _user_ids():
    async with SessionLocal() as s:
        admin = (await s.execute(select(User).where(User.email == "admin@demo.isp"))).scalar_one()
        agent = (await s.execute(select(User).where(User.email == "agent@demo.isp"))).scalar_one()
        return admin.id, agent.id


async def _names(client, headers, query):
    r = await client.get(f"/api/leads{query}", headers=headers)
    assert r.status_code == 200, r.text
    return [x.get("name") for x in r.json()]


# ===================== q (free-text) =====================

async def test_q_substring_case_insensitive(client, admin):
    for nm in ["zzq Apple", "ZZQ Banana", "Nothing Relevant"]:
        assert (await client.post("/api/leads", headers=admin, json={"name": nm})).status_code == 201

    hits = await _names(client, admin, "?q=zzq")
    assert "zzq Apple" in hits and "ZZQ Banana" in hits        # case-insensitive
    assert "Nothing Relevant" not in hits
    # narrower substring
    assert await _names(client, admin, "?q=apple") == ["zzq Apple"]


async def test_blank_q_is_unchanged(client, admin):
    """`?q=` (empty value) must be treated identically to no `q` at all.

    The invariant under test is: `blank == no_q`. The leaked-row check
    (`"zzblank token" in no_q`) used to bake in an additional assumption — that
    the new lead appears in the default first-page response. In a clean DB
    that's fine, but the full suite leaves hundreds of leads, and pagination
    pushes the just-created row off the first page. Filter the search to the
    new lead's substring so the existence check is robust to suite ordering.
    """
    assert (await client.post("/api/leads", headers=admin, json={"name": "zzblank token"})).status_code == 201
    no_q = await _names(client, admin, "")
    blank = await _names(client, admin, "?q=")
    # core invariant: blank q behaves identically to no q
    assert blank == no_q
    # the new lead is reachable via a substring filter, regardless of pagination
    found = await _names(client, admin, "?q=zzblank")
    assert "zzblank token" in found


# ===================== filter (GXL) =====================

async def test_filter_narrows_and_broken_excludes(client, admin):
    a = (await client.post("/api/leads", headers=admin, json={"name": "ffilt one", "phone": "+37411"})).json()
    (await client.post("/api/leads", headers=admin, json={"name": "ffilt two"})).json()
    # move 'one' to CONTACTED so it falls out of a status=='lead' filter
    assert (await client.post(f"/api/leads/{a['id']}/transition", headers=admin, json={"to": "validated_lead"})).status_code == 200

    new_only = await _names(client, admin, "?q=ffilt&filter=status == 'lead'")
    assert new_only == ["ffilt two"]

    # a broken expression fails closed (no 500) → excludes everything
    r = await client.get("/api/leads?q=ffilt&filter=:::not valid:::", headers=admin)
    assert r.status_code == 200 and r.json() == []


# ===================== sort =====================

async def test_sort_ascending_descending(client, admin):
    for nm in ["zsrt_b", "zsrt_a", "zsrt_c"]:
        assert (await client.post("/api/leads", headers=admin, json={"name": nm})).status_code == 201
    assert await _names(client, admin, "?q=zsrt&sort=name") == ["zsrt_a", "zsrt_b", "zsrt_c"]
    assert await _names(client, admin, "?q=zsrt&sort=-name") == ["zsrt_c", "zsrt_b", "zsrt_a"]


async def test_sort_missing_field_last(client, admin):
    await client.post("/api/leads", headers=admin, json={"name": "mmiss b", "email": "b@m.io"})
    await client.post("/api/leads", headers=admin, json={"name": "mmiss a", "email": "a@m.io"})
    await client.post("/api/leads", headers=admin, json={"name": "mmiss none"})   # no email

    asc = await _names(client, admin, "?q=mmiss&sort=email")
    assert asc == ["mmiss a", "mmiss b", "mmiss none"]           # missing sorts last
    desc = await _names(client, admin, "?q=mmiss&sort=-email")
    assert desc == ["mmiss b", "mmiss a", "mmiss none"]          # still last on descending


# ===================== scope + view-gate hold under search =====================

async def test_search_respects_scope_and_view_gate(client, admin, agent):
    admin_lead = (await client.post("/api/leads", headers=admin, json={"name": "sscope hq"})).json()
    agent_lead = (await client.post("/api/leads", headers=agent, json={"name": "sscope team"})).json()

    agent_hits = {x["id"] for x in (await client.get("/api/leads?q=sscope", headers=agent)).json()}
    assert agent_lead["id"] in agent_hits           # its own (team) record
    assert admin_lead["id"] not in agent_hits        # never leaks the group-owned one

    # view-gate unaffected by search params: agent has no ticket view → 403
    assert (await client.get("/api/tickets?q=anything", headers=agent)).status_code == 403


# ===================== saved views =====================

async def test_create_own_and_shared_view(client, admin):
    admin_id, _ = await _user_ids()
    own = (await client.post("/api/views", headers=admin,
                             json={"entity_key": "lead", "name": "My NEW leads",
                                   "config": {"filter": "status == 'lead'", "sort": "name"}})).json()
    assert own["shared"] is False and own["owner_user_id"] == str(admin_id)
    assert own["config"]["sort"] == "name"

    shared = (await client.post("/api/views", headers=admin,
                                json={"entity_key": "lead", "name": "Shared board", "shared": True})).json()
    assert shared["shared"] is True and shared["owner_user_id"] is None


async def test_list_views_own_plus_shared_not_others(client, admin, agent):
    v_admin = (await client.post("/api/views", headers=admin,
                                 json={"entity_key": "lead", "name": "admin private"})).json()
    v_shared = (await client.post("/api/views", headers=admin,
                                  json={"entity_key": "lead", "name": "team shared", "shared": True})).json()
    v_agent = (await client.post("/api/views", headers=agent,
                                 json={"entity_key": "lead", "name": "agent private"})).json()

    agent_ids = {v["id"] for v in (await client.get("/api/views?entity=lead", headers=agent)).json()}
    assert v_agent["id"] in agent_ids and v_shared["id"] in agent_ids
    assert v_admin["id"] not in agent_ids                       # not another user's private

    admin_ids = {v["id"] for v in (await client.get("/api/views?entity=lead", headers=admin)).json()}
    assert v_admin["id"] in admin_ids and v_shared["id"] in admin_ids
    assert v_agent["id"] not in admin_ids


async def test_patch_delete_owner_only(client, admin, agent):
    v_admin = (await client.post("/api/views", headers=admin,
                                 json={"entity_key": "lead", "name": "to edit"})).json()
    v_shared = (await client.post("/api/views", headers=admin,
                                  json={"entity_key": "lead", "name": "shared noedit", "shared": True})).json()
    v_agent = (await client.post("/api/views", headers=agent,
                                 json={"entity_key": "lead", "name": "agent owns"})).json()

    # non-owner cannot patch/delete another's private view → 404
    assert (await client.patch(f"/api/views/{v_admin['id']}", headers=agent, json={"name": "hax"})).status_code == 404
    assert (await client.delete(f"/api/views/{v_admin['id']}", headers=agent)).status_code == 404
    # a shared view has no owner → not editable by anyone (even its creator) → 404
    assert (await client.patch(f"/api/views/{v_shared['id']}", headers=admin, json={"name": "x"})).status_code == 404
    # owner can patch own
    r = await client.patch(f"/api/views/{v_admin['id']}", headers=admin, json={"name": "renamed"})
    assert r.status_code == 200 and r.json()["name"] == "renamed"
    # owner can delete own
    assert (await client.delete(f"/api/views/{v_agent['id']}", headers=agent)).status_code == 204


async def test_views_unknown_entity_and_no_perm(client, admin, agent):
    # unknown entity → 404 on both create and list
    assert (await client.post("/api/views", headers=admin,
                              json={"entity_key": "ghost", "name": "x"})).status_code == 404
    assert (await client.get("/api/views?entity=ghost", headers=admin)).status_code == 404
    # agent has no ticket.view → 403
    assert (await client.post("/api/views", headers=agent,
                              json={"entity_key": "ticket", "name": "x"})).status_code == 403
    assert (await client.get("/api/views?entity=ticket", headers=agent)).status_code == 403


async def test_views_route_not_shadowed_by_records(client, admin):
    # if /api/{slug} shadowed this, GET /api/views?entity=lead would 404 as "Unknown entity 'views'".
    r = await client.get("/api/views?entity=lead", headers=admin)
    assert r.status_code == 200 and isinstance(r.json(), list)
