"""Coverage for the config-driven Dashboards engine.

Endpoints: GET /dashboards · GET /dashboards/{key} · GET /dashboards/{key}/data · POST /dashboards.
Widget data is org-scope filtered exactly like reports.py; each widget is computed fail-soft
(a forbidden or broken widget returns `error`, never a 500, and never breaks the rest of the board).

Seeded model recap: admin = super_admin/tenant/perms ["*"]; agent = sales_agent/node @
"grp.yerevan.sales1", can view leads (+ contact/deal + customer.view), NO ticket permission.

Shared session-scoped DB accumulates rows, so: fresh unique entity/dashboard keys per test, and
scope counts asserted as DELTAS.
"""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import DashboardDef, WidgetDef


# ---- helpers ----

async def _mk_entity(client, admin, key, slug, fields):
    """Create a throwaway entity via the Studio API so its record set is isolated for exact math."""
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key}s", "route_slug": slug, "icon": "x",
        "fields": [{"key": "name", "label": "Name", "type": "text", "required": True}] + fields,
    }
    r = await client.post("/meta/entities", headers=admin, json=body)
    assert r.status_code == 201, r.text


async def _data_map(client, headers, board):
    r = await client.get(f"/dashboards/{board}/data", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    return {w["widget_key"]: w for w in body["widgets"]}


# ---- create + list + resolve ----

async def test_create_dashboard_lists_and_resolves(client, admin):
    await _mk_entity(client, admin, "wbasic", "w-basic", [
        {"key": "amount", "label": "Amount", "type": "number"},
        {"key": "tier", "label": "Tier", "type": "select", "config": {"options": ["A", "B"]}},
    ])
    payload = {
        "key": "board_basic", "label": "Basic Board", "description": "demo", "order": 1,
        "widgets": [
            {"key": "cnt", "label": "Count", "type": "kpi", "query": {"entity": "wbasic", "metric": "count"}},
            {"key": "total", "label": "Total", "type": "kpi", "query": {"entity": "wbasic", "metric": "sum", "field": "amount"}},
            {"key": "by_tier", "label": "By Tier", "type": "bar", "query": {"entity": "wbasic", "metric": "count", "group_by": "tier"}},
        ],
    }
    r = await client.post("/dashboards", headers=admin, json=payload)
    assert r.status_code == 201, r.text
    assert r.json()["widgets"] == 3

    # lists
    keys = {d["key"] for d in (await client.get("/dashboards", headers=admin)).json()}
    assert "board_basic" in keys

    # resolves (config only)
    d = (await client.get("/dashboards/board_basic", headers=admin)).json()
    assert d["label"] == "Basic Board"
    wk = {w["key"]: w for w in d["widgets"]}
    assert set(wk) == {"cnt", "total", "by_tier"}
    assert wk["by_tier"]["type"] == "bar"
    assert wk["total"]["query"] == {"entity": "wbasic", "metric": "sum", "field": "amount"}


# ---- computed values: count / sum / avg / group_by ----

async def test_widget_values_count_sum_avg_groupby(client, admin):
    await _mk_entity(client, admin, "wcalc", "w-calc", [
        {"key": "amount", "label": "Amount", "type": "number"},
        {"key": "tier", "label": "Tier", "type": "select", "config": {"options": ["A", "B"]}},
    ])
    # known data: amounts 10,20,30 — tiers A,A,B  → count 3, sum 60, avg 20, buckets A:2 B:1
    for amt, tier in [(10, "A"), (20, "A"), (30, "B")]:
        r = await client.post("/api/w-calc", headers=admin, json={"name": f"r{amt}", "amount": amt, "tier": tier})
        assert r.status_code == 201, r.text

    payload = {
        "key": "board_calc", "label": "Calc Board",
        "widgets": [
            {"key": "cnt", "type": "kpi", "query": {"entity": "wcalc", "metric": "count"}},
            {"key": "total", "type": "kpi", "query": {"entity": "wcalc", "metric": "sum", "field": "amount"}},
            {"key": "mean", "type": "kpi", "query": {"entity": "wcalc", "metric": "avg", "field": "amount"}},
            {"key": "by_tier", "type": "bar", "query": {"entity": "wcalc", "metric": "count", "group_by": "tier"}},
        ],
    }
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201

    w = await _data_map(client, admin, "board_calc")
    assert w["cnt"]["result"]["value"] == 3
    assert w["total"]["result"]["value"] == 60
    assert w["mean"]["result"]["value"] == 20
    buckets = {b["group"]: b["value"] for b in w["by_tier"]["result"]}
    assert buckets == {"A": 2, "B": 1}


# ---- org-scope: same def, different numbers per viewer ----

async def test_dashboard_data_is_org_scoped(client, admin, agent):
    payload = {
        "key": "board_scope", "label": "Scope Board",
        "widgets": [{"key": "lead_count", "type": "kpi", "query": {"entity": "lead", "metric": "count"}}],
    }
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201

    admin_before = (await _data_map(client, admin, "board_scope"))["lead_count"]["result"]["value"]
    agent_before = (await _data_map(client, agent, "board_scope"))["lead_count"]["result"]["value"]
    assert (await client.post("/api/leads", headers=agent, json={"name": "Dash Agent Lead"})).status_code == 201
    assert (await client.post("/api/leads", headers=admin, json={"name": "Dash Above Lead"})).status_code == 201
    admin_after = (await _data_map(client, admin, "board_scope"))["lead_count"]["result"]["value"]
    agent_after = (await _data_map(client, agent, "board_scope"))["lead_count"]["result"]["value"]

    assert admin_after - admin_before == 2     # tenant scope sees both
    assert agent_after - agent_before == 1     # node scope sees only its own


# ---- fail-soft: forbidden widget doesn't break the board ----

async def test_failsoft_forbidden_widget(client, admin, agent):
    payload = {
        "key": "board_failsoft", "label": "Fail-soft Board",
        "widgets": [
            {"key": "leads", "type": "kpi", "query": {"entity": "lead", "metric": "count"}},
            {"key": "tix", "type": "kpi", "query": {"entity": "ticket", "metric": "count"}},
        ],
    }
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201

    w = await _data_map(client, agent, "board_failsoft")
    assert "result" in w["leads"] and "error" not in w["leads"]   # agent can view leads
    assert w["tix"]["error"] == "forbidden"                       # agent cannot view tickets
    # admin (perms *) sees both compute fine
    aw = await _data_map(client, admin, "board_failsoft")
    assert "result" in aw["leads"] and "result" in aw["tix"]


# ---- fail-soft: broken queries ----

async def test_failsoft_missing_entity(client, admin):
    payload = {
        "key": "board_broken", "label": "Broken Board",
        "widgets": [
            {"key": "ok", "type": "kpi", "query": {"entity": "lead", "metric": "count"}},
            {"key": "broken", "type": "kpi", "query": {"metric": "count"}},   # no 'entity'
        ],
    }
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201
    w = await _data_map(client, admin, "board_broken")
    assert "result" in w["ok"]
    assert "error" in w["broken"] and "entity" in w["broken"]["error"]


async def test_failsoft_bad_metric(client, admin):
    # POST validates metric, so inject a bad-metric widget straight into the table to exercise /data.
    payload = {"key": "board_badmetric", "label": "Bad Metric Board",
               "widgets": [{"key": "ok", "type": "kpi", "query": {"entity": "lead", "metric": "count"}}]}
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201

    async with SessionLocal() as s:
        dash = (await s.execute(select(DashboardDef).where(DashboardDef.key == "board_badmetric"))).scalar_one()
        s.add(WidgetDef(tenant_id=dash.tenant_id, dashboard_def_id=dash.id, key="bad", label="Bad",
                        type="kpi", order=9, query={"entity": "lead", "metric": "median"}))
        await s.commit()

    w = await _data_map(client, admin, "board_badmetric")
    assert "result" in w["ok"]
    assert "error" in w["bad"] and "median" in w["bad"]["error"]


# ---- guardrails ----

async def test_create_dashboard_forbidden_for_agent(client, agent):
    payload = {"key": "board_agent", "label": "Nope",
               "widgets": [{"key": "x", "type": "kpi", "query": {"entity": "lead", "metric": "count"}}]}
    assert (await client.post("/dashboards", headers=agent, json=payload)).status_code == 403


async def test_unknown_widget_type_422(client, admin):
    payload = {"key": "board_badtype", "label": "Bad Type",
               "widgets": [{"key": "x", "type": "pie", "query": {"entity": "lead", "metric": "count"}}]}
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 422


async def test_unknown_metric_422(client, admin):
    payload = {"key": "board_badmetric_post", "label": "Bad Metric",
               "widgets": [{"key": "x", "type": "kpi", "query": {"entity": "lead", "metric": "median"}}]}
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 422


async def test_duplicate_dashboard_key_409(client, admin):
    payload = {"key": "board_dupe", "label": "Dupe", "widgets": []}
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 201
    assert (await client.post("/dashboards", headers=admin, json=payload)).status_code == 409


async def test_unknown_dashboard_404(client, admin):
    assert (await client.get("/dashboards/does-not-exist", headers=admin)).status_code == 404
    assert (await client.get("/dashboards/does-not-exist/data", headers=admin)).status_code == 404
