"""Coverage for the Studio AppearancePane backend: GET/PUT /api/tenant/settings/theme.

Tenant-level design tokens (accent / radius / density / mode). Writes are gated on
`tenant.settings` (same gate as the rest of the tenant profile). Allow-lists must match
the frontend AppearancePane (frontend/src/studio/StudioRichPanes.tsx).
"""


async def test_theme_round_trip_and_partial_update(client, admin):
    # On a clean tenant, every field is null (frontend picks defaults — backend does not).
    r = await client.get("/api/tenant/settings/theme", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"accent", "radius", "density", "mode"}
    assert all(v is None for v in body.values())

    # PUT a full theme — every key validated against its allow-list, returned saved.
    full = {"accent": "Gold", "radius": "Soft", "density": "Comfortable", "mode": "Dark"}
    r = await client.put("/api/tenant/settings/theme", headers=admin, json=full)
    assert r.status_code == 200, r.text
    assert r.json() == full

    # GET reflects the save.
    assert (await client.get("/api/tenant/settings/theme", headers=admin)).json() == full

    # Partial PUT preserves untouched fields.
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"accent": "Emerald"})
    assert r.status_code == 200, r.text
    assert r.json() == {"accent": "Emerald", "radius": "Soft", "density": "Comfortable", "mode": "Dark"}

    # Explicit null clears a single field back to "use frontend default".
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"radius": None})
    assert r.status_code == 200, r.text
    assert r.json() == {"accent": "Emerald", "radius": None, "density": "Comfortable", "mode": "Dark"}


async def test_theme_validates_allow_lists_and_gating(client, admin, agent):
    # Unknown field → 422 with the allowed set echoed back (matches existing /api/tenant/settings).
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"font": "Comic Sans"})
    assert r.status_code == 422
    assert "font" in r.text

    # Value off the allow-list → 422 (LEARN FROM the SettingsView bug: keep this strict).
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"accent": "Magenta"})
    assert r.status_code == 422
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"density": "tight"})
    assert r.status_code == 422
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"mode": "neon"})
    assert r.status_code == 422
    r = await client.put("/api/tenant/settings/theme", headers=admin, json={"radius": 8})  # must be string token
    assert r.status_code == 422

    # Non-object body → 422.
    r = await client.put("/api/tenant/settings/theme", headers=admin, json=["Azure"])
    assert r.status_code == 422

    # Auth gate: agent (no tenant.settings) can READ but cannot WRITE.
    assert (await client.get("/api/tenant/settings/theme", headers=agent)).status_code == 200
    r = await client.put("/api/tenant/settings/theme", headers=agent, json={"accent": "Azure"})
    assert r.status_code == 403
