"""Coverage for the "configure in place" page-config store (page_config router/table).

Tenant-scoped key/value-ish store: one descriptor per (tenant, page_key). READ is open to any
authenticated tenant user (the bespoke view applies it on load); WRITE is gated on config.manage
(super_admin via `*`). The seeded agent lacks config.manage → 403 on write, 200 on read.
"""


SERVICES_CFG = {
    "title": "Provisioned services",
    "columns": [
        {"key": "name", "label": "Line", "visible": True},
        {"key": "customer", "label": "Customer", "visible": False},
        {"key": "type", "label": "Type", "visible": True},
        {"key": "status", "label": "State", "visible": True},
        {"key": "activated", "label": "Live since", "visible": True},
    ],
}


async def test_get_default_is_empty(client, admin):
    """No saved config ⇒ {page_key, config: {}} (the view falls back to page defaults)."""
    r = await client.get("/api/page-config/services", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["page_key"] == "services"
    assert body["config"] == {}


async def test_put_and_readback_roundtrip(client, admin):
    r = await client.put("/api/page-config/services", headers=admin, json={"config": SERVICES_CFG})
    assert r.status_code == 200, r.text
    assert r.json()["config"]["title"] == "Provisioned services"

    # GET reflects the saved descriptor verbatim
    got = (await client.get("/api/page-config/services", headers=admin)).json()
    assert got["config"] == SERVICES_CFG

    # PUT again replaces (upsert on the unique tenant+page_key)
    r2 = await client.put("/api/page-config/services", headers=admin, json={"config": {"title": "X", "columns": []}})
    assert r2.status_code == 200, r2.text
    assert (await client.get("/api/page-config/services", headers=admin)).json()["config"]["title"] == "X"


async def test_key_normalised(client, admin):
    """page_key is normalised (trim/lowercase) so a casing typo hits the same row."""
    await client.put("/api/page-config/services", headers=admin, json={"config": {"title": "lower"}})
    got = (await client.get("/api/page-config/SERVICES", headers=admin)).json()
    assert got["page_key"] == "services"
    assert got["config"]["title"] == "lower"


async def test_validation(client, admin):
    # config must be an object
    assert (await client.put("/api/page-config/services", headers=admin, json={"config": "nope"})).status_code == 422
    assert (await client.put("/api/page-config/services", headers=admin, json={})).status_code == 422


async def test_read_open_write_gated(client, admin, agent):
    """Agent (no config.manage) can READ but not WRITE."""
    # make sure something is saved by admin first
    await client.put("/api/page-config/services", headers=admin, json={"config": {"title": "shared"}})

    # agent reads fine
    r = await client.get("/api/page-config/services", headers=agent)
    assert r.status_code == 200, r.text
    assert r.json()["config"]["title"] == "shared"

    # agent write → 403
    w = await client.put("/api/page-config/services", headers=agent, json={"config": {"title": "hacked"}})
    assert w.status_code == 403, w.text
    # unchanged
    assert (await client.get("/api/page-config/services", headers=admin)).json()["config"]["title"] == "shared"
