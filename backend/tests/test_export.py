"""Coverage for record export: GET /api/{slug}/export?format=csv|json.

Export uses the SAME org-scope + view-gate + q/filter/sort pipeline as the list view, so it never
leaks beyond what's on screen. Columns = data FieldDefs (status-type folded into core `status`),
then Status, ID, Created At, Created By. The shared DB accumulates, so every test scopes rows with a unique
name-token via `q` to make counts deterministic.

Lead data fields are defined in seed.py (`_LEAD_FIELDS`) and evolve, so these tests assert the
SHAPE rather than an exact column list: every export ends with the four fixed trailing columns
and includes the key data columns. This keeps the suite stable as lead fields are added/removed.
"""

import csv
import io
import json

# The fixed tail every record export ends with (after the entity's data fields).
TRAILING = ["Status", "ID", "Created At", "Created By"]
# Data columns we always expect a lead export to carry (by their field labels).
KEY_COLS = ["ԱԱՀ", "Primary Phone", "Email"]   # 'name' field's export header (config.export_label)


def _csv_rows(text):
    # Strip the UTF-8 BOM the export prepends for spreadsheet apps before parsing.
    return list(csv.reader(io.StringIO(text.lstrip("﻿"))))


async def _export(client, headers, query):
    r = await client.get(f"/api/leads/export{query}", headers=headers)
    return r


# ---- csv shape ----

async def test_csv_export_header_and_rows(client, admin):
    tok = "zexpcsv"
    for i in range(2):
        assert (await client.post("/api/leads", headers=admin, json={"name": f"{tok} {i}"})).status_code == 201

    r = await _export(client, admin, f"?format=csv&q={tok}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")

    rows = _csv_rows(r.text)
    header = rows[0]
    assert header[-4:] == TRAILING, f"export must end with {TRAILING}; got {header[-4:]}"
    assert all(c in header for c in KEY_COLS), f"missing key columns in {header}"
    data = rows[1:]
    assert len(data) == 2
    name_col = header.index("ԱԱՀ")
    assert {row[name_col] for row in data} == {f"{tok} 0", f"{tok} 1"}     # Name column


# ---- json shape mirrors csv rows ----

async def test_json_export_rows(client, admin):
    tok = "zexpjson"
    for i in range(2):
        assert (await client.post("/api/leads", headers=admin, json={"name": f"{tok} {i}"})).status_code == 201

    r = await _export(client, admin, f"?format=json&q={tok}")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/json")
    rows = r.json()
    assert len(rows) == 2
    assert {"name", "phone", "email", "source", "status", "id", "created_at"} <= set(rows[0])
    assert {row["name"] for row in rows} == {f"{tok} 0", f"{tok} 1"}


async def test_unknown_format_400(client, admin):
    assert (await _export(client, admin, "?format=xml")).status_code == 400


# ---- same filtering/ordering as the list view ----

async def test_export_filter_matches_list(client, admin):
    tok = "zexpfilt"
    a = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} contacted", "phone": "+37411"})).json()
    (await client.post("/api/leads", headers=admin, json={"name": f"{tok} new"})).json()
    assert (await client.post(f"/api/leads/{a['id']}/transition", headers=admin, json={"to": "CONTACTED"})).status_code == 200

    rows = (await _export(client, admin, f"?format=json&q={tok}&filter=status == 'NEW'")).json()
    assert [row["name"] for row in rows] == [f"{tok} new"]          # only the NEW record


async def test_export_sort_matches_list(client, admin):
    tok = "zexpsort"
    for nm in [f"{tok}_b", f"{tok}_a", f"{tok}_c"]:
        assert (await client.post("/api/leads", headers=admin, json={"name": nm})).status_code == 201

    export_names = [row["name"] for row in (await _export(client, admin, f"?format=json&q={tok}&sort=name")).json()]
    list_names = [r["name"] for r in (await client.get(f"/api/leads?q={tok}&sort=name", headers=admin)).json()]
    assert export_names == [f"{tok}_a", f"{tok}_b", f"{tok}_c"]      # ascending
    assert export_names == list_names                               # identical to the list view


# ---- scope + view-gate ----

async def test_export_respects_scope_and_view_gate(client, admin, agent):
    tok = "zexpscope"
    admin_lead = (await client.post("/api/leads", headers=admin, json={"name": f"{tok} hq"})).json()["id"]
    agent_lead = (await client.post("/api/leads", headers=agent, json={"name": f"{tok} team"})).json()["id"]

    agent_ids = {row["id"] for row in (await _export(client, agent, f"?format=json&q={tok}")).json()}
    assert agent_lead in agent_ids
    assert admin_lead not in agent_ids                              # never exports out-of-scope rows

    # an entity the agent can't view → 403
    assert (await client.get("/api/tickets/export?format=csv", headers=agent)).status_code == 403


# ---- empty result is a valid empty file ----

async def test_empty_export_is_valid(client, admin):
    nohits = "zexpnone_xyz"
    csv_rows = _csv_rows((await _export(client, admin, f"?format=csv&q={nohits}")).text)
    assert len(csv_rows) == 1                                       # header only, no data rows
    assert csv_rows[0][-4:] == TRAILING and all(c in csv_rows[0] for c in KEY_COLS)
    assert (await _export(client, admin, f"?format=json&q={nohits}")).json() == []
