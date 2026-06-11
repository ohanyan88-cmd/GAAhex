"""Step 1 of the orders.py NO-HARDCODE cutover — the GENERIC transition path honors NAMED guards.

Before this, a config transition guard like ``control_gate:stage8`` (services/transition_guards.
NAMED_GUARDS) was resolved ONLY in the bespoke orders.py advance path; the generic endpoints
(records.py ``POST /api/{slug}/{id}/transition`` and bulk.py) passed the guard NAME straight to
``gxl.evaluate`` as an expression — so a named, kernel-held policy gate would silently mis-evaluate.

These tests prove the shared ``workflow.evaluate_guard`` makes ANY Record-backed entity carry a
named guard via config, end-to-end:
  * authorship accepts a named guard (it is NOT GXL — meta.py skips GXL parsing for it),
  * a blocking named guard refuses the move with **409 + its reason** (the orders.py contract),
  * a passing named guard allows the move,
  * the bulk path honors it too,
  * a real GXL guard still fails with the locked **422** (no regression).

This is the prerequisite that lets the generic path carry the Stage-8 revenue gate before any order
is ever routed through it (cutover steps 3-5).
"""
import uuid

from app.services.transition_guards import NAMED_GUARDS


def _entity_payload(guard_name):
    """A minimal Record-backed entity DRAFT --(guard)--> DONE, unique per test run."""
    suffix = uuid.uuid4().hex[:8]
    slug = f"thing{suffix}"
    return slug, {
        "key": f"thing_{suffix}", "label": "Thing", "label_plural": "Things", "route_slug": slug,
        "fields": [{"key": "status", "label": "Status", "type": "status"}],
        "statuses": [
            {"key": "DRAFT", "label": "Draft", "is_initial": True},
            {"key": "DONE", "label": "Done"},
        ],
        "transitions": [{"from": "DRAFT", "to": "DONE", "guard": guard_name}],
    }


async def test_generic_transition_named_guard_blocks_with_409(client, admin, monkeypatch):
    async def _blocker(s, rec):
        return False, "blocked: revenue gate not passed (test)"
    monkeypatch.setitem(NAMED_GUARDS, "test:block", _blocker)

    slug, payload = _entity_payload("test:block")
    # authorship accepts the named guard (would have 422'd as invalid GXL before the meta.py fix)
    r = await client.post("/meta/entities", headers=admin, json=payload)
    assert r.status_code == 201, r.text

    rec = (await client.post(f"/api/{slug}", headers=admin, json={})).json()
    assert rec["status"] == "DRAFT", rec

    blocked = await client.post(f"/api/{slug}/{rec['id']}/transition", headers=admin, json={"to": "DONE"})
    # named policy gate → 409 Conflict + blocker reason (matches the orders.py Stage-8 contract),
    # NOT the GXL-expression 422.
    assert blocked.status_code == 409, blocked.text
    assert "blocked: revenue gate not passed (test)" in blocked.text

    # status unchanged after the refused move
    still = (await client.get(f"/api/{slug}/{rec['id']}", headers=admin)).json()
    assert still["status"] == "DRAFT"


async def test_generic_transition_named_guard_passes(client, admin, monkeypatch):
    async def _passer(s, rec):
        return True, None
    monkeypatch.setitem(NAMED_GUARDS, "test:pass", _passer)

    slug, payload = _entity_payload("test:pass")
    assert (await client.post("/meta/entities", headers=admin, json=payload)).status_code == 201
    rec = (await client.post(f"/api/{slug}", headers=admin, json={})).json()

    ok = await client.post(f"/api/{slug}/{rec['id']}/transition", headers=admin, json={"to": "DONE"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "DONE"


async def test_bulk_transition_honors_named_guard(client, admin, monkeypatch):
    async def _blocker(s, rec):
        return False, "blocked by named guard (bulk)"
    monkeypatch.setitem(NAMED_GUARDS, "test:block_bulk", _blocker)

    slug, payload = _entity_payload("test:block_bulk")
    assert (await client.post("/meta/entities", headers=admin, json=payload)).status_code == 201
    rec = (await client.post(f"/api/{slug}", headers=admin, json={})).json()

    res = await client.post(f"/api/{slug}/bulk", headers=admin,
                            json={"action": "transition", "ids": [rec["id"]], "to": "DONE"})
    assert res.status_code == 200, res.text
    body = res.json()
    # the one id fails (its own failure, partial-failure model) carrying the guard's reason
    assert body["summary"]["failed"] == 1, body
    assert "blocked by named guard (bulk)" in body["results"][0]["error"]

    still = (await client.get(f"/api/{slug}/{rec['id']}", headers=admin)).json()
    assert still["status"] == "DRAFT"


async def test_gxl_guard_still_returns_422(client, admin):
    """Regression: a real GXL expression guard that evaluates false keeps the locked 422 contract
    (named-guard 409 must not leak onto the GXL path)."""
    suffix = uuid.uuid4().hex[:8]
    slug = f"gthing{suffix}"
    payload = {
        "key": f"gthing_{suffix}", "label": "GThing", "label_plural": "GThings", "route_slug": slug,
        "fields": [
            {"key": "amount", "label": "Amount", "type": "number"},
            {"key": "status", "label": "Status", "type": "status"},
        ],
        "statuses": [
            {"key": "DRAFT", "label": "Draft", "is_initial": True},
            {"key": "DONE", "label": "Done"},
        ],
        "transitions": [{"from": "DRAFT", "to": "DONE", "guard": "amount == 0"}],
    }
    assert (await client.post("/meta/entities", headers=admin, json=payload)).status_code == 201
    rec = (await client.post(f"/api/{slug}", headers=admin, json={"amount": 100})).json()
    blocked = await client.post(f"/api/{slug}/{rec['id']}/transition", headers=admin, json={"to": "DONE"})
    assert blocked.status_code == 422, blocked.text
