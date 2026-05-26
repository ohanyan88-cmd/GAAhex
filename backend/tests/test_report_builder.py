"""Coverage for the report builder (report_builder.py) — saved aggregations over the dashboards engine.

A ReportDef carries a dashboard-widget-shaped `query` ({entity, metric, field?, group_by?, filter?})
and is computed by the same engine with the same org-scope filtering as reports.py. Saving needs
only `{entity}.view`; run is fail-soft. owner_user_id NULL ⇒ shared (tenant-wide), else private.

Hand-computed metric tests use fresh Studio entities so the record set is isolated and exact.
Unique entity/report keys per test (shared session DB accumulates).
"""

import uuid


async def _mk_entity(client, admin, key, slug, *, with_amount=False, with_status=False):
    fields = [{"key": "name", "label": "Name", "type": "text", "required": True}]
    if with_amount:
        fields.append({"key": "amount", "label": "Amount", "type": "number"})
    if with_status:
        fields.append({"key": "status", "label": "Status", "type": "status"})
    body = {"key": key, "label": key.title(), "label_plural": f"{key}s", "route_slug": slug, "icon": "x",
            "fields": fields}
    if with_status:
        body["statuses"] = [{"key": "OPEN", "label": "Open", "is_initial": True}, {"key": "DONE", "label": "Done"}]
        body["transitions"] = [{"from": "OPEN", "to": "DONE", "guard": None}]
    assert (await client.post("/meta/entities", headers=admin, json=body)).status_code == 201


async def _save(client, headers, **payload):
    return await client.post("/api/reports-builder", headers=headers, json=payload)


# ===================== metric correctness =====================

async def test_count_group_by_status(client, admin):
    await _mk_entity(client, admin, "rbcnt", "rb-cnt", with_status=True)
    ids = [(await client.post("/api/rb-cnt", headers=admin, json={"name": f"r{i}"})).json()["id"] for i in range(3)]
    assert (await client.post(f"/api/rb-cnt/{ids[0]}/transition", headers=admin, json={"to": "DONE"})).status_code == 200

    rep = (await _save(client, admin, key="rbcnt_rep", name="By status",
                       query={"entity": "rbcnt", "metric": "count", "group_by": "status"})).json()
    run = (await client.get(f"/api/reports-builder/{rep['id']}/run", headers=admin)).json()
    assert run["matched"] == 3
    buckets = {b["group"]: b["value"] for b in run["result"]}
    assert buckets == {"OPEN": 2, "DONE": 1}


async def test_sum_and_avg_over_numeric(client, admin):
    await _mk_entity(client, admin, "rbnum", "rb-num", with_amount=True)
    for amt in (10, 20, 30):
        assert (await client.post("/api/rb-num", headers=admin, json={"name": f"n{amt}", "amount": amt})).status_code == 201

    rsum = (await _save(client, admin, key="rbsum", name="Sum",
                        query={"entity": "rbnum", "metric": "sum", "field": "amount"})).json()
    run_sum = (await client.get(f"/api/reports-builder/{rsum['id']}/run", headers=admin)).json()
    assert run_sum["matched"] == 3 and run_sum["result"]["value"] == 60

    ravg = (await _save(client, admin, key="rbavg", name="Avg",
                        query={"entity": "rbnum", "metric": "avg", "field": "amount"})).json()
    assert (await client.get(f"/api/reports-builder/{ravg['id']}/run", headers=admin)).json()["result"]["value"] == 20


# ===================== scope =====================

async def test_run_is_org_scoped_admin_vs_agent(client, admin, agent):
    # admin-owned (group) leads the agent can't see, plus the agent's own
    for i in range(2):
        await client.post("/api/leads", headers=admin, json={"name": f"rbscope hq {i}"})
    await client.post("/api/leads", headers=agent, json={"name": "rbscope team"})

    rep = (await _save(client, admin, key="rbscope", name="Lead count", shared=True,
                       query={"entity": "lead", "metric": "count"})).json()
    admin_matched = (await client.get(f"/api/reports-builder/{rep['id']}/run", headers=admin)).json()["matched"]
    agent_matched = (await client.get(f"/api/reports-builder/{rep['id']}/run", headers=agent)).json()["matched"]
    assert admin_matched > agent_matched                    # tenant scope sees strictly more than node scope


async def test_run_forbidden_for_unviewable_entity(client, admin, agent):
    rep = (await _save(client, admin, key="rbtix", name="Tickets", shared=True,
                       query={"entity": "ticket", "metric": "count"})).json()
    # the agent can't view tickets → fail-soft forbidden, not a 500
    agent_run = await client.get(f"/api/reports-builder/{rep['id']}/run", headers=agent)
    assert agent_run.status_code == 200 and agent_run.json()["error"] == "forbidden"
    # admin computes it fine
    assert "result" in (await client.get(f"/api/reports-builder/{rep['id']}/run", headers=admin)).json()


# ===================== owner / shared visibility =====================

async def test_owner_and_shared_listing(client, admin, agent):
    p_admin = (await _save(client, admin, key="rbpriv_a", name="admin private",
                           query={"entity": "lead", "metric": "count"})).json()
    shared = (await _save(client, admin, key="rbshared_v", name="shared", shared=True,
                          query={"entity": "lead", "metric": "count"})).json()
    p_agent = (await _save(client, agent, key="rbpriv_b", name="agent private",
                           query={"entity": "lead", "metric": "count"})).json()

    agent_ids = {r["id"] for r in (await client.get("/api/reports-builder", headers=agent)).json()}
    assert p_agent["id"] in agent_ids and shared["id"] in agent_ids
    assert p_admin["id"] not in agent_ids                   # not another user's private

    admin_ids = {r["id"] for r in (await client.get("/api/reports-builder", headers=admin)).json()}
    assert p_admin["id"] in admin_ids and shared["id"] in admin_ids
    assert p_agent["id"] not in admin_ids


async def test_patch_delete_owner_only(client, admin, agent):
    p_admin = (await _save(client, admin, key="rbedit", name="to edit",
                           query={"entity": "lead", "metric": "count"})).json()
    # a non-owner is refused (the merged loader returns 403 for a found-but-unowned report)
    assert (await client.patch(f"/api/reports-builder/{p_admin['id']}", headers=agent,
                               json={"name": "hax"})).status_code == 403
    assert (await client.delete(f"/api/reports-builder/{p_admin['id']}", headers=agent)).status_code == 403
    # an id that doesn't exist → 404
    assert (await client.patch(f"/api/reports-builder/{uuid.uuid4()}", headers=admin,
                               json={"name": "x"})).status_code == 404
    # owner can edit + delete
    assert (await client.patch(f"/api/reports-builder/{p_admin['id']}", headers=admin,
                               json={"name": "renamed"})).json()["name"] == "renamed"
    assert (await client.delete(f"/api/reports-builder/{p_admin['id']}", headers=admin)).status_code == 204


# ===================== fail-soft =====================

async def test_broken_query_is_failsoft(client, admin):
    # sum without a field passes save validation but breaks at compute → error field, no 500
    rep = (await _save(client, admin, key="rbbroken", name="Broken",
                       query={"entity": "lead", "metric": "sum"})).json()
    run = await client.get(f"/api/reports-builder/{rep['id']}/run", headers=admin)
    assert run.status_code == 200 and "error" in run.json() and "result" not in run.json()
