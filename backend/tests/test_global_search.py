"""Coverage for global cross-entity search: GET /api/search?q=&limit=.

Spans every viewable entity, org-scope filtered like the records engine; grouped by entity; blank q
returns []. Each test tags its records with a UNIQUE token (the session DB accumulates) so only its
own records match.
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant, Record


def _groups(body):
    return {g["entity_key"]: g for g in body}


def _all_match_ids(body):
    return {m["id"] for g in body for m in g["matches"]}


async def _search(client, headers, q, limit=None):
    url = f"/api/search?q={q}" + (f"&limit={limit}" if limit is not None else "")
    r = await client.get(url, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ---- cross-entity grouping + response shape ----

async def test_search_groups_across_entities(client, admin):
    tok = "zsrchgrp"
    leads = [(await client.post("/api/leads", headers=admin, json={"name": f"{tok} lead {i}"})).json()["id"]
             for i in range(2)]
    custs = [(await client.post("/api/customers", headers=admin, json={"name": f"{tok} cust {i}"})).json()["id"]
             for i in range(2)]

    body = await _search(client, admin, tok)
    groups = _groups(body)
    assert set(groups) == {"lead", "customer"}            # only entities with matches, grouped

    # right matches per group
    assert {m["id"] for m in groups["lead"]["matches"]} == set(leads)
    assert {m["id"] for m in groups["customer"]["matches"]} == set(custs)

    # response shape (merged contract)
    assert {"entity_key", "label_plural", "route_slug", "matches"} <= set(groups["lead"])
    a_match = groups["lead"]["matches"][0]
    assert {"id", "status", "label", "snippet"} <= set(a_match)
    assert "_label_hit" not in a_match                     # internal ranking field stripped


async def test_blank_q_returns_empty(client, admin):
    assert await _search(client, admin, "") == []
    r = await client.get("/api/search", headers=admin)     # no q at all
    assert r.status_code == 200 and r.json() == []


async def test_limit_caps_total_matches(client, admin):
    tok = "zsrchlim"
    for i in range(3):
        assert (await client.post("/api/leads", headers=admin, json={"name": f"{tok} {i}"})).status_code == 201
    body = await _search(client, admin, tok, limit=2)
    total = sum(len(g["matches"]) for g in body)
    assert total == 2                                       # capped to the requested limit


# ---- scope + permission ----

async def test_search_respects_scope_and_view_gate(client, admin, agent):
    tok = "zsrchscope"
    admin_lead = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} hq"})).json()["id"]
    agent_lead = (await client.post("/api/leads", headers=agent, json={"name": f"{tok} team"})).json()["id"]
    ticket = (await client.post("/api/tickets", headers=admin, json={"subject": f"{tok} ticket"})).json()["id"]

    # agent: sees only its own team lead; never the group-owned lead; no ticket group at all
    agent_body = await _search(client, agent, tok)
    agent_groups = _groups(agent_body)
    assert set(agent_groups) == {"lead"}
    assert {m["id"] for m in agent_groups["lead"]["matches"]} == {agent_lead}
    assert admin_lead not in _all_match_ids(agent_body)
    assert "ticket" not in agent_groups

    # admin: sees both leads + the ticket → strictly more than the agent for the same q
    admin_body = await _search(client, admin, tok)
    admin_ids = _all_match_ids(admin_body)
    assert {admin_lead, agent_lead, ticket} <= admin_ids
    assert "ticket" in _groups(admin_body)
    assert len(admin_ids) > len(_all_match_ids(agent_body))


# ---- tenant isolation ----

async def test_search_is_tenant_isolated(client, admin):
    tok = "zsrchtenant"
    mine = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} mine"})).json()["id"]

    # a record in a DIFFERENT tenant carrying the same token, inserted directly
    async with SessionLocal() as s:
        other = Tenant(name=f"Other ISP {tok}")
        s.add(other)
        await s.flush()
        foreign = Record(tenant_id=other.id, entity_key="lead", owner_node_id=None,
                         status=None, data={"name": f"{tok} foreign"})
        s.add(foreign)
        await s.commit()
        foreign_id = str(foreign.id)

    ids = _all_match_ids(await _search(client, admin, tok))
    assert mine in ids
    assert foreign_id not in ids                            # never crosses the tenant boundary
