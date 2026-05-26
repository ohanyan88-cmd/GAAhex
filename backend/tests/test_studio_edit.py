"""Coverage for the Studio edit/delete lifecycle (M8) in meta.py.

Every handler is gated by config.manage (super_admin). Each test builds its own fresh entity via
POST /meta/entities (unique key/slug — the session DB accumulates) and then exercises one surface:
entity patch/retire, field add/edit, status add/reorder/delete, transition replace.
"""


async def _mk_entity(client, admin, key, slug, *, fields=None, statuses=None, transitions=None):
    body = {
        "key": key, "label": key.title(), "label_plural": f"{key} items",
        "route_slug": slug, "icon": "x",
        "fields": fields if fields is not None else [
            {"key": "name", "label": "Name", "type": "text", "required": True},
        ],
    }
    if statuses is not None:
        body["statuses"] = statuses
    if transitions is not None:
        body["transitions"] = transitions
    r = await client.post("/meta/entities", headers=admin, json=body)
    assert r.status_code == 201, r.text


async def _def(client, headers, slug):
    return (await client.get(f"/meta/entities/{slug}", headers=headers)).json()


# ===================== entity-level patch =====================

async def test_patch_entity_presentation(client, admin):
    await _mk_entity(client, admin, "edlabel", "ed-label")
    r = await client.patch("/meta/entities/ed-label", headers=admin, json={
        "label": "Renamed", "label_plural": "Renamed Things", "icon": "star", "order": 7,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["label"] == "Renamed" and body["label_plural"] == "Renamed Things"
    assert body["icon"] == "star" and body["route_slug"] == "ed-label"   # slug immutable

    listing = {e["route_slug"]: e for e in (await client.get("/meta/entities", headers=admin)).json()}
    assert listing["ed-label"]["label"] == "Renamed" and listing["ed-label"]["order"] == 7


async def test_patch_entity_rejects_unknown_and_empty_label(client, admin):
    await _mk_entity(client, admin, "edreject", "ed-reject")
    # unknown / immutable key
    assert (await client.patch("/meta/entities/ed-reject", headers=admin, json={"route_slug": "x"})).status_code == 422
    # empty label
    assert (await client.patch("/meta/entities/ed-reject", headers=admin, json={"label": "   "})).status_code == 422


# ===================== entity soft-retire =====================

async def test_retire_entity_soft_deletes(client, admin):
    await _mk_entity(client, admin, "edretire", "ed-retire")
    rec = (await client.post("/api/ed-retire", headers=admin, json={"name": "keep me"})).json()

    r = await client.delete("/meta/entities/ed-retire", headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "retired"

    # gone from the default listing, present with ?include_retired=true, key/slug unchanged
    default = {e["route_slug"] for e in (await client.get("/meta/entities", headers=admin)).json()}
    assert "ed-retire" not in default
    retired = {e["route_slug"]: e for e in (await client.get("/meta/entities?include_retired=true", headers=admin)).json()}
    assert "ed-retire" in retired
    assert retired["ed-retire"]["status"] == "retired" and retired["ed-retire"]["key"] == "edretire"

    # records + events still readable
    assert (await client.get(f"/api/ed-retire/{rec['id']}", headers=admin)).status_code == 200
    assert [e["type"] for e in (await client.get(f"/api/ed-retire/{rec['id']}/history", headers=admin)).json()] == ["create"]
    # but no new records
    assert (await client.post("/api/ed-retire", headers=admin, json={"name": "nope"})).status_code == 409


# ===================== field add / edit =====================

async def test_add_field_renders_immediately(client, admin):
    await _mk_entity(client, admin, "edaddf", "ed-addf")
    r = await client.post("/meta/entities/ed-addf/fields", headers=admin,
                          json={"key": "notes", "label": "Notes", "type": "textarea"})
    assert r.status_code == 201, r.text
    keys = {f["key"] for f in (await _def(client, admin, "ed-addf"))["fields"]}
    assert "notes" in keys
    # duplicate field key → 409
    assert (await client.post("/meta/entities/ed-addf/fields", headers=admin,
                              json={"key": "notes", "type": "text"})).status_code == 409
    # bad type → 422
    assert (await client.post("/meta/entities/ed-addf/fields", headers=admin,
                              json={"key": "x", "type": "rocket"})).status_code == 422


async def test_patch_field_safe_edits(client, admin):
    await _mk_entity(client, admin, "edfedit", "ed-fedit", fields=[
        {"key": "name", "label": "Name", "type": "text", "required": True},
        {"key": "tier", "label": "Tier", "type": "select", "config": {"options": ["A", "B"]}},
    ])
    r = await client.patch("/meta/entities/ed-fedit/fields/tier", headers=admin,
                           json={"label": "Tier X", "required": True, "order": 9, "options": ["A", "B", "C"]})
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "Tier X" and r.json()["required"] is True
    assert r.json()["config"]["options"] == ["A", "B", "C"]

    # reflected in the rendered def
    tier = next(f for f in (await _def(client, admin, "ed-fedit"))["fields"] if f["key"] == "tier")
    assert tier["required"] is True and tier["config"]["options"] == ["A", "B", "C"]

    # options on a non-select field → 422
    assert (await client.patch("/meta/entities/ed-fedit/fields/name", headers=admin,
                               json={"options": ["x"]})).status_code == 422


async def test_patch_field_rename_type_and_unknown(client, admin):
    await _mk_entity(client, admin, "edfguard", "ed-fguard", fields=[
        {"key": "name", "label": "Name", "type": "text", "required": True},
        {"key": "tier", "label": "Tier", "type": "select", "config": {"options": ["A", "B"]}},
    ])
    # renaming the key → 409
    assert (await client.patch("/meta/entities/ed-fguard/fields/tier", headers=admin,
                               json={"key": "tier2"})).status_code == 409
    # changing the type → 409
    assert (await client.patch("/meta/entities/ed-fguard/fields/tier", headers=admin,
                               json={"type": "number"})).status_code == 409
    # unknown field → 404
    assert (await client.patch("/meta/entities/ed-fguard/fields/ghost", headers=admin,
                               json={"label": "x"})).status_code == 404


# ===================== status add / reorder / delete =====================

async def test_add_status_and_reorder(client, admin):
    await _mk_entity(client, admin, "edstat", "ed-stat",
                     statuses=[{"key": "OPEN", "label": "Open", "is_initial": True},
                               {"key": "DONE", "label": "Done"}])
    assert (await client.post("/meta/entities/ed-stat/statuses", headers=admin,
                              json={"key": "REVIEW", "label": "Review"})).status_code == 201
    keys = {s["key"] for s in (await _def(client, admin, "ed-stat"))["statuses"]}
    assert keys == {"OPEN", "DONE", "REVIEW"}

    r = await client.patch("/meta/entities/ed-stat/statuses/reorder", headers=admin,
                           json={"order": ["DONE", "REVIEW", "OPEN"]})
    assert r.status_code == 200
    ordered = [s["key"] for s in sorted((await _def(client, admin, "ed-stat"))["statuses"], key=lambda s: s["order"])]
    assert ordered == ["DONE", "REVIEW", "OPEN"]

    # unknown status in the reorder list → 422
    assert (await client.patch("/meta/entities/ed-stat/statuses/reorder", headers=admin,
                               json={"order": ["OPEN", "GHOST"]})).status_code == 422


async def test_delete_status_guards(client, admin):
    await _mk_entity(client, admin, "edstatdel", "ed-statdel", fields=[
        {"key": "name", "label": "Name", "type": "text", "required": True},
        {"key": "status", "label": "Status", "type": "status"},
    ], statuses=[{"key": "OPEN", "label": "Open", "is_initial": True},
                 {"key": "DONE", "label": "Done"},
                 {"key": "SPARE", "label": "Spare"}],
       transitions=[{"from": "OPEN", "to": "DONE", "guard": None}])
    # a record sits in OPEN
    assert (await client.post("/api/ed-statdel", headers=admin, json={"name": "r1"})).json()["status"] == "OPEN"

    # OPEN has a record → 409
    assert (await client.delete("/meta/entities/ed-statdel/statuses/OPEN", headers=admin)).status_code == 409
    # DONE is referenced by a transition → 409
    assert (await client.delete("/meta/entities/ed-statdel/statuses/DONE", headers=admin)).status_code == 409
    # SPARE is free → 200
    assert (await client.delete("/meta/entities/ed-statdel/statuses/SPARE", headers=admin)).status_code == 200
    # unknown → 404
    assert (await client.delete("/meta/entities/ed-statdel/statuses/GHOST", headers=admin)).status_code == 404


# ===================== transitions =====================

async def test_put_transitions_replace_and_validate(client, admin):
    await _mk_entity(client, admin, "edtrans", "ed-trans",
                     statuses=[{"key": "OPEN", "label": "Open", "is_initial": True},
                               {"key": "DONE", "label": "Done"}])
    # set an edge
    r = await client.put("/meta/entities/ed-trans/transitions", headers=admin,
                         json={"transitions": [{"from": "OPEN", "to": "DONE", "guard": None}]})
    assert r.status_code == 200
    assert (await _def(client, admin, "ed-trans"))["transitions"] == [{"from": "OPEN", "to": "DONE"}]

    # replace with empty
    assert (await client.put("/meta/entities/ed-trans/transitions", headers=admin,
                             json={"transitions": []})).status_code == 200
    assert (await _def(client, admin, "ed-trans"))["transitions"] == []

    # invalid target / source → 422
    assert (await client.put("/meta/entities/ed-trans/transitions", headers=admin,
                             json={"transitions": [{"from": "OPEN", "to": "GHOST"}]})).status_code == 422
    assert (await client.put("/meta/entities/ed-trans/transitions", headers=admin,
                             json={"transitions": [{"from": "GHOST", "to": "DONE"}]})).status_code == 422


# ===================== access =====================

async def test_agent_forbidden_on_all_studio_endpoints(client, agent):
    # config.manage is checked first → 403 regardless of body/target (use a real seeded entity)
    assert (await client.patch("/meta/entities/leads", headers=agent, json={"label": "X"})).status_code == 403
    assert (await client.delete("/meta/entities/leads", headers=agent)).status_code == 403
    assert (await client.post("/meta/entities/leads/fields", headers=agent,
                              json={"key": "z", "type": "text"})).status_code == 403
    assert (await client.patch("/meta/entities/leads/fields/name", headers=agent,
                               json={"label": "X"})).status_code == 403
    assert (await client.post("/meta/entities/leads/statuses", headers=agent,
                              json={"key": "Z"})).status_code == 403
    assert (await client.patch("/meta/entities/leads/statuses/reorder", headers=agent,
                               json={"order": ["NEW"]})).status_code == 403
    assert (await client.delete("/meta/entities/leads/statuses/NEW", headers=agent)).status_code == 403
    assert (await client.put("/meta/entities/leads/transitions", headers=agent,
                             json={"transitions": []})).status_code == 403
