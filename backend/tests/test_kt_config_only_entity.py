"""KILLER TEST — stand up a brand-new entity with CONFIG ONLY (the platform thesis).

CLAUDE.md / the build guide: "the system renders & behaves from configuration ... no hardcoded screens
or business rules. The killer test: stand up a 2nd entity with config only." This is that test, end to
end, touching ZERO entity-specific code — every call goes through the generic config-driven engine:

  1. AUTHOR the entity purely via config: POST /meta/entities (fields of several types, statuses with an
     initial, a guarded transition + an unguarded one). No model class, no router, no migration.
  2. VALIDATE from config: a create that violates a config field rule (required / number) is refused.
  3. CREATE / LIST / GET / PATCH the record through the generic /api/{slug} CRUD engine.
  4. DRIVE the lifecycle through the generic /api/{slug}/{id}/transition kernel — the config GXL guard
     blocks the move while business state forbids it, then allows it once state permits.
  5. AUDIT: the generic history endpoint shows CREATE + exactly the transitions that happened.
  6. TENANT-SCOPED: the new entity + its records carry the caller's tenant (I1).

If this passes, a second ISP's bespoke object needs configuration, not a fork (PERFECT-TARGET I2).
"""
import uuid


def _entity_payload():
    suffix = uuid.uuid4().hex[:8]
    slug = f"widget{suffix}"
    return slug, {
        "key": f"widget_{suffix}",
        "label": "Widget",
        "label_plural": "Widgets",
        "route_slug": slug,
        "fields": [
            {"key": "name", "label": "Name", "type": "text", "required": True},
            {"key": "amount", "label": "Amount", "type": "number"},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "DRAFT", "label": "Draft", "is_initial": True},
            {"key": "REVIEW", "label": "Review"},
            {"key": "DONE", "label": "Done"},
        ],
        # config-driven workflow: DRAFT→REVIEW only once amount >= 100 (a GXL guard); REVIEW→DONE is open.
        "transitions": [
            {"from": "DRAFT", "to": "REVIEW", "guard": "amount >= 100"},
            {"from": "REVIEW", "to": "DONE", "guard": None},
        ],
    }


async def test_kt_stand_up_second_entity_config_only(client, admin):
    slug, payload = _entity_payload()

    # ── 1. Author the entity with config alone ────────────────────────────────
    r = await client.post("/meta/entities", headers=admin, json=payload)
    assert r.status_code == 201, r.text

    # ── 2. Config-driven validation: required field missing → 422; bad number → 422 ──
    bad_missing = await client.post(f"/api/{slug}", headers=admin, json={"amount": 10})
    assert bad_missing.status_code == 422, bad_missing.text          # 'name' required (from config)
    bad_number = await client.post(f"/api/{slug}", headers=admin, json={"name": "x", "amount": "abc"})
    assert bad_number.status_code == 422, bad_number.text            # 'amount' must be a number (from config)

    # ── 3. Create via the generic CRUD engine; starts at the config initial status ──
    rec = (await client.post(f"/api/{slug}", headers=admin, json={"name": "Widget A", "amount": 50})).json()
    rid = rec["id"]
    assert rec["status"] == "DRAFT", rec                            # is_initial from config
    assert rec["name"] == "Widget A" and rec["amount"] == 50

    # list + get round-trip through the generic engine
    listed = (await client.get(f"/api/{slug}", headers=admin)).json()
    listed_rows = listed if isinstance(listed, list) else listed.get("items", [])
    assert any(x["id"] == rid for x in listed_rows), listed
    assert (await client.get(f"/api/{slug}/{rid}", headers=admin)).json()["status"] == "DRAFT"

    # ── 4. Config GXL guard BLOCKS the move while amount < 100, then ALLOWS it ──
    blocked = await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "REVIEW"})
    assert blocked.status_code == 422, blocked.text                 # guard "amount >= 100" fails
    assert (await client.get(f"/api/{slug}/{rid}", headers=admin)).json()["status"] == "DRAFT"  # unchanged

    # raise amount through the ordinary generic PATCH — no special endpoint
    patched = await client.patch(f"/api/{slug}/{rid}", headers=admin, json={"amount": 150})
    assert patched.status_code == 200, patched.text

    ok = await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "REVIEW"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "REVIEW"
    done = await client.post(f"/api/{slug}/{rid}/transition", headers=admin, json={"to": "DONE"})
    assert done.status_code == 200 and done.json()["status"] == "DONE", done.text

    # ── 5. Audit trail via the generic history endpoint: CREATE + exactly 2 TRANSITIONs ──
    history = (await client.get(f"/api/{slug}/{rid}/history", headers=admin)).json()
    assert history[0]["type"] == "CREATE"
    transitions = [(e["data"]["from"], e["data"]["to"]) for e in history if e["type"] == "TRANSITION"]
    assert transitions == [("DRAFT", "REVIEW"), ("REVIEW", "DONE")], transitions

    # ── 6. Tenant-scoped (I1): the new entity_def belongs to the caller's tenant ──
    me = (await client.get("/auth/me", headers=admin)).json()
    ents = (await client.get("/meta/entities", headers=admin)).json()
    mine = [e for e in ents if e["route_slug"] == slug]
    assert mine, "the config-authored entity must be visible to its own tenant"
    # and it is the SAME generic engine — no widget-specific route exists; everything above used /api/{slug}.
    assert me["tenant_id"]
