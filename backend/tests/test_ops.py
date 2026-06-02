"""Coverage for ops status + maintenance toggle (ops.py).

NOTE: maintenance is a PROCESS-LOCAL in-memory flag (`ops._MAINTENANCE`). The in-process ASGI test
client shares that process, so a POST /api/ops/maintenance is read back via GET /api/status in the
same run. Each toggling test restores the flag to OFF so it leaves no global state dirty for the
rest of the suite.
"""


async def test_status_shape_and_db_ok(client, admin):
    r = await client.get("/api/status", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "gaahex"
    assert body["ok"] is True and body["db"] == "ok"
    assert body["version"] and body["time"]
    m = body["maintenance"]
    assert set(m) == {"active", "message", "since"}


async def test_maintenance_toggle_reflected_in_status(client, admin):
    try:
        # turn ON with a message
        on = await client.post("/api/ops/maintenance", headers=admin,
                               json={"active": True, "message": "Upgrading the core"})
        assert on.status_code == 200
        m = on.json()["maintenance"]
        assert m["active"] is True and m["message"] == "Upgrading the core" and m["since"]

        # reflected in /api/status (read back from the same process)
        st = (await client.get("/api/status", headers=admin)).json()["maintenance"]
        assert st["active"] is True and st["message"] == "Upgrading the core"

        # turn OFF → message + since cleared
        off = await client.post("/api/ops/maintenance", headers=admin, json={"active": False})
        assert off.status_code == 200
        mo = off.json()["maintenance"]
        assert mo["active"] is False and mo["message"] is None and mo["since"] is None

        st2 = (await client.get("/api/status", headers=admin)).json()["maintenance"]
        assert st2["active"] is False and st2["message"] is None
    finally:
        # ensure the global flag is OFF regardless of assertion outcome
        await client.post("/api/ops/maintenance", headers=admin, json={"active": False})


async def test_maintenance_requires_config_manage(client, agent):
    # agent has no config.manage → cannot toggle
    assert (await client.post("/api/ops/maintenance", headers=agent,
                              json={"active": True})).status_code == 403
