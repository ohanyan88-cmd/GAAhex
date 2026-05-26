"""Coverage for the Reports surface: /reports/summary and /reports/{slug}/by-status.

Both endpoints are org-scope filtered and view-gated exactly like records.py.
Seeded model (see seed.py / CONTRIBUTING.md):
  admin = super_admin, scope=tenant, perms=["*"], primary node = group (path "grp")  → sees all
  agent = sales_agent, scope=node @ "grp.yerevan.sales1", perms = lead/contact/deal view+create+edit
          + customer.view; NO ticket permission; primary node = team

The suite shares one session-scoped, seeded test DB across files, so records accumulate — every
count assertion here is a DELTA (measure, mutate, re-measure), never an absolute.
"""


async def _summary_map(client, headers) -> dict:
    r = await client.get("/reports/summary", headers=headers)
    assert r.status_code == 200, r.text
    return {item["route_slug"]: item for item in r.json()}


# ---- summary shape ----

async def test_summary_shape_and_crm_present(client, admin):
    r = await client.get("/reports/summary", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, list) and body
    for item in body:
        assert {"entity_key", "route_slug", "label_plural", "count"} <= set(item)
        assert isinstance(item["count"], int)
    slugs = {item["route_slug"] for item in body}
    assert {"leads", "customers", "contacts", "deals", "tickets"} <= slugs


async def test_summary_item_fields_match_meta(client, admin):
    summary = await _summary_map(client, admin)
    leads = summary["leads"]
    assert leads["entity_key"] == "lead"
    assert leads["label_plural"] == "Leads"


# ---- counts are real ----

async def test_summary_count_rises_by_n(client, admin):
    before = (await _summary_map(client, admin))["leads"]["count"]
    n = 3
    for i in range(n):
        r = await client.post("/api/leads", headers=admin, json={"name": f"Report Lead {i}"})
        assert r.status_code == 201
    after = (await _summary_map(client, admin))["leads"]["count"]
    assert after - before == n


# ---- counts are org-scoped ----

async def test_summary_count_is_org_scoped(client, admin, agent):
    agent_before = (await _summary_map(client, agent))["leads"]["count"]
    admin_before = (await _summary_map(client, admin))["leads"]["count"]
    # one lead in the agent's own node subtree, one owned above it (admin's group node)
    assert (await client.post("/api/leads", headers=agent, json={"name": "Agent Scoped"})).status_code == 201
    assert (await client.post("/api/leads", headers=admin, json={"name": "Above Agent"})).status_code == 201
    agent_after = (await _summary_map(client, agent))["leads"]["count"]
    admin_after = (await _summary_map(client, admin))["leads"]["count"]
    assert agent_after - agent_before == 1     # only its own; the admin's group-owned lead is invisible
    assert admin_after - admin_before == 2     # tenant scope sees both


# ---- view-gating ----

async def test_summary_view_gated_for_agent(client, admin, agent):
    agent_slugs = {item["route_slug"] for item in (await client.get("/reports/summary", headers=agent)).json()}
    admin_slugs = {item["route_slug"] for item in (await client.get("/reports/summary", headers=admin)).json()}
    # agent has no ticket permission at all → tickets must not surface in its summary
    assert "tickets" not in agent_slugs
    assert "tickets" in admin_slugs
    # but it does have customer.view → customers is present even though it can't create them
    assert "customers" in agent_slugs


# ---- by-status ----

async def test_by_status_lists_every_defined_status(client, admin):
    meta = (await client.get("/meta/entities/leads", headers=admin)).json()
    defined = {st["key"]: st["label"] for st in meta["statuses"]}

    rep = await client.get("/reports/leads/by-status", headers=admin)
    assert rep.status_code == 200
    body = rep.json()
    assert body["entity_key"] == "lead"
    reported = {row["status"]: row["label"] for row in body["by_status"]}

    # every StatusDef appears (even zero-count ones) with the matching label
    for key, label in defined.items():
        assert key in reported, f"status {key} missing from by-status"
        assert reported[key] == label
    # counts are non-negative ints
    assert all(isinstance(row["count"], int) and row["count"] >= 0 for row in body["by_status"])
    # at least one status is currently zero-count (proves zero rows are still listed)
    assert any(row["count"] == 0 for row in body["by_status"])


async def test_by_status_counts_sum_to_scoped_total(client, admin):
    # measured for the same user → by-status total must equal the summary count for that entity
    summary_count = (await _summary_map(client, admin))["leads"]["count"]
    body = (await client.get("/reports/leads/by-status", headers=admin)).json()
    assert sum(row["count"] for row in body["by_status"]) == summary_count


async def test_by_status_scoped_for_agent(client, admin, agent):
    # agent's by-status total must equal the agent's scoped summary count, not the tenant-wide one
    agent_summary = (await _summary_map(client, agent))["leads"]["count"]
    body = (await client.get("/reports/leads/by-status", headers=agent)).json()
    assert sum(row["count"] for row in body["by_status"]) == agent_summary


# ---- by-status errors ----

async def test_by_status_unknown_slug_404(client, admin):
    assert (await client.get("/reports/not-an-entity/by-status", headers=admin)).status_code == 404


async def test_by_status_forbidden_for_unviewable_entity(client, agent):
    # agent has no ticket permission → 403 on the ticket report
    assert (await client.get("/reports/tickets/by-status", headers=agent)).status_code == 403
