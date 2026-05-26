"""Coverage for list pagination on GET /api/{slug} (records.py).

Backward-compatible: no params ⇒ a plain JSON list (no envelope). `?limit=N` caps, `?offset=M` skips,
applied LAST — after org-scope + view-gate + q/filter/sort — so paging never widens visibility.
Default page 200, capped at MAX_PAGE (500). Unique name-tokens isolate each test's records.
"""

from app.routers.records import _paginate, DEFAULT_PAGE, MAX_PAGE


async def _names(client, headers, query):
    r = await client.get(f"/api/leads{query}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


# ===================== backward-compat: plain list =====================

async def test_default_returns_plain_list(client, admin):
    body = (await client.get("/api/leads", headers=admin)).json()
    assert isinstance(body, list)                       # no envelope — still a bare list


# ===================== limit / offset walk =====================

async def test_limit_offset_walk(client, admin):
    tok = "zpage"
    for i in range(5):
        assert (await client.post("/api/leads", headers=admin, json={"name": f"{tok}_{i}"})).status_code == 201

    page0 = [r["name"] for r in await _names(client, admin, f"?q={tok}&sort=name&limit=2&offset=0")]
    page1 = [r["name"] for r in await _names(client, admin, f"?q={tok}&sort=name&limit=2&offset=2")]
    page2 = [r["name"] for r in await _names(client, admin, f"?q={tok}&sort=name&limit=2&offset=4")]
    assert page0 == [f"{tok}_0", f"{tok}_1"]
    assert page1 == [f"{tok}_2", f"{tok}_3"]
    assert page2 == [f"{tok}_4"]                        # last partial page


# ===================== paging is applied AFTER scope =====================

async def test_pagination_after_scope(client, admin, agent):
    tok = "zpagescope"
    admin_lead = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} hq"})).json()["id"]
    agent_lead = (await client.post("/api/leads", headers=agent, json={"name": f"{tok} team"})).json()["id"]

    agent_ids = {r["id"] for r in await _names(client, agent, f"?q={tok}&limit=50")}
    assert agent_lead in agent_ids                      # its own (team) record
    assert admin_lead not in agent_ids                  # paging never surfaces an out-of-scope record


# ===================== cap (unit-tested on the helper) =====================

def test_limit_capped_at_max():
    big = list(range(MAX_PAGE + 100))
    assert len(_paginate(big, 100000, 0)) == MAX_PAGE   # huge limit clamped to the documented max
    assert len(_paginate(big, None, 0)) == DEFAULT_PAGE # no limit ⇒ default page size
    assert _paginate(list(range(10)), 3, 4) == [4, 5, 6]  # offset + limit window
