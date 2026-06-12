"""Coverage for /api/me/avatar — upload sets a data-URL avatar, DELETE clears it (idempotent).

The avatar lives as a base64 data URL on app_user.avatar_url (this codebase serves no static
files for user images), so both the endpoint response and a follow-up GET /auth/me are asserted —
proving the change persisted on the row, not just echoed back.
"""
import base64

# A 1x1 transparent PNG. The endpoint validates MIME + size + non-empty, not pixel content,
# so the smallest real PNG is enough to exercise the happy path.
_PNG_1x1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


async def _login(client, email="admin@demo.isp", password="admin123") -> dict:
    r = await client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(access_token: str) -> dict:
    return {"Authorization": f"Bearer {access_token}"}


async def test_upload_then_delete_avatar_roundtrip(client):
    h = _bearer((await _login(client))["access_token"])

    up = await client.post(
        "/api/me/avatar", headers=h, files={"file": ("a.png", _PNG_1x1, "image/png")}
    )
    assert up.status_code == 200, up.text
    data_url = up.json()["avatar_url"]
    assert data_url.startswith("data:image/png;base64,")
    # Persisted: /auth/me reflects the new avatar.
    assert (await client.get("/auth/me", headers=h)).json()["avatar_url"] == data_url

    rm = await client.delete("/api/me/avatar", headers=h)
    assert rm.status_code == 200, rm.text
    assert rm.json()["avatar_url"] is None
    # Persisted: /auth/me now shows no avatar (UI falls back to the name initial).
    assert (await client.get("/auth/me", headers=h)).json()["avatar_url"] is None


async def test_delete_avatar_is_idempotent(client):
    """Deleting when there is no avatar is a no-op 200 (not a 404) — safe to call repeatedly."""
    h = _bearer((await _login(client))["access_token"])
    await client.delete("/api/me/avatar", headers=h)  # ensure empty first
    again = await client.delete("/api/me/avatar", headers=h)
    assert again.status_code == 200, again.text
    assert again.json()["avatar_url"] is None


async def test_upload_avatar_rejects_non_image(client):
    """A non-image upload is rejected at the MIME gate (400), never stored."""
    h = _bearer((await _login(client))["access_token"])
    bad = await client.post(
        "/api/me/avatar", headers=h, files={"file": ("a.txt", b"not-an-image", "text/plain")}
    )
    assert bad.status_code == 400, bad.text


# ---- avatar focal point (object-position) -------------------------------------------------------

async def test_avatar_position_set_persists_and_resets_on_change(client):
    h = _bearer((await _login(client))["access_token"])
    await client.post("/api/me/avatar", headers=h, files={"file": ("a.png", _PNG_1x1, "image/png")})

    r = await client.put("/api/me/avatar/position", headers=h, json={"pos": "30% 70%"})
    assert r.status_code == 200, r.text
    assert r.json()["avatar_pos"] == "30% 70%"
    # Persisted on the row.
    assert (await client.get("/auth/me", headers=h)).json()["avatar_pos"] == "30% 70%"

    # A fresh upload re-centers (avatar_pos cleared) so the new image isn't off-set by the old focal point.
    await client.post("/api/me/avatar", headers=h, files={"file": ("b.png", _PNG_1x1, "image/png")})
    assert (await client.get("/auth/me", headers=h)).json()["avatar_pos"] is None

    # Removing the avatar also clears its focal point.
    await client.put("/api/me/avatar/position", headers=h, json={"pos": "10% 10%"})
    await client.delete("/api/me/avatar", headers=h)
    me = (await client.get("/auth/me", headers=h)).json()
    assert me["avatar_url"] is None and me["avatar_pos"] is None


async def test_avatar_position_rejects_malformed(client):
    h = _bearer((await _login(client))["access_token"])
    for bad in ["50%", "50 40", "abc", "120% 50%", "50%;40%"]:
        r = await client.put("/api/me/avatar/position", headers=h, json={"pos": bad})
        assert r.status_code == 422, f"{bad!r} should be rejected: {r.text}"
    # Empty/null re-centers (200, null).
    ok = await client.put("/api/me/avatar/position", headers=h, json={"pos": None})
    assert ok.status_code == 200 and ok.json()["avatar_pos"] is None


async def test_logo_position_via_tenant_settings(client):
    """The logo focal point rides on PUT /api/tenant/settings (admin is super_admin)."""
    h = _bearer((await _login(client))["access_token"])
    r = await client.put("/api/tenant/settings", headers=h, json={"logo_pos": "25% 80%"})
    assert r.status_code == 200, r.text
    assert r.json()["logo_pos"] == "25% 80%"
    assert (await client.get("/api/tenant/settings", headers=h)).json()["logo_pos"] == "25% 80%"
    # Malformed → 422.
    bad = await client.put("/api/tenant/settings", headers=h, json={"logo_pos": "nope"})
    assert bad.status_code == 422, bad.text
