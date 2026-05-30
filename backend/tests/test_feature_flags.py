"""Feature-flag CRUD, auth gates, and audit-event emission."""
import pytest


# ── helpers ──────────────────────────────────────────────────────────────────

FLAG_URL = "/api/feature-flags"


async def _create(client, headers, key="new-dashboard", label="New Dashboard", **kw):
    body = {"key": key, "label": label, **kw}
    r = await client.post(FLAG_URL, headers=headers, json=body)
    return r


# ── CRUD round-trip ───────────────────────────────────────────────────────────

async def test_feature_flag_crud(client, admin):
    # CREATE
    r = await _create(client, admin, key="crud-flag", label="CRUD Flag")
    assert r.status_code == 201, r.text
    flag = r.json()
    assert flag["key"] == "crud-flag"
    assert flag["label"] == "CRUD Flag"
    assert flag["enabled"] is False
    assert flag["role_scope"] is None
    fid = flag["id"]

    # LIST — flag appears
    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    keys = [f["key"] for f in r.json()]
    assert "crud-flag" in keys

    # PATCH enabled
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"enabled": True})
    assert r.status_code == 200
    assert r.json()["enabled"] is True

    # PATCH role_scope
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"role_scope": "super_admin"})
    assert r.status_code == 200
    assert r.json()["role_scope"] == "super_admin"

    # DELETE
    r = await client.delete(f"{FLAG_URL}/{fid}", headers=admin)
    assert r.status_code == 204

    # LIST — flag gone
    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    keys = [f["key"] for f in r.json()]
    assert "crud-flag" not in keys


# ── 403 for non-admin on writes ───────────────────────────────────────────────

async def test_feature_flag_403_on_write(client, agent):
    """An agent (no config.manage) cannot create, patch or delete flags."""
    # POST
    r = await _create(client, agent, key="agent-flag", label="Agent Flag")
    assert r.status_code == 403, r.text

    # We need a valid flag id for PATCH/DELETE — create one as admin first.
    # Since the admin fixture is session-scoped, create inline via a separate token.
    # To keep this self-contained we just test with a fake uuid — the auth gate fires first.
    fake_id = "00000000-0000-0000-0000-000000000001"
    r = await client.patch(f"{FLAG_URL}/{fake_id}", headers=agent, json={"enabled": True})
    assert r.status_code == 403

    r = await client.delete(f"{FLAG_URL}/{fake_id}", headers=agent)
    assert r.status_code == 403


# ── audit event emitted on patch ──────────────────────────────────────────────

async def test_feature_flag_audit_event_on_patch(client, admin):
    # Create a flag
    r = await _create(client, admin, key="audit-flag", label="Audit Flag")
    assert r.status_code == 201, r.text
    fid = r.json()["id"]

    # Patch it
    r = await client.patch(f"{FLAG_URL}/{fid}", headers=admin, json={"enabled": True})
    assert r.status_code == 200

    # Verify an audit event exists for this flag_id
    r = await client.get(
        "/api/audit-log",
        headers=admin,
        params={"event_type": "feature_flag.update", "limit": 50},
    )
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    matching = [e for e in events if e.get("data", {}).get("flag_id") == fid]
    assert len(matching) >= 1, "Expected at least one audit event for the patched flag"
    ev = matching[0]
    assert ev["data"]["after"]["enabled"] is True
    assert ev["data"]["before"]["enabled"] is False

    # Cleanup
    await client.delete(f"{FLAG_URL}/{fid}", headers=admin)


# ── list sorted by key ────────────────────────────────────────────────────────

async def test_feature_flag_list_sorted(client, admin):
    created_ids = []
    for key in ["zzz-flag", "aaa-flag", "mmm-flag"]:
        r = await _create(client, admin, key=key, label=key)
        if r.status_code == 201:
            created_ids.append(r.json()["id"])

    r = await client.get(FLAG_URL, headers=admin)
    assert r.status_code == 200
    all_keys = [f["key"] for f in r.json()]
    # Assert our three are in sorted order relative to each other
    our_keys = [k for k in all_keys if k in ("aaa-flag", "mmm-flag", "zzz-flag")]
    assert our_keys == ["aaa-flag", "mmm-flag", "zzz-flag"]

    for fid in created_ids:
        await client.delete(f"{FLAG_URL}/{fid}", headers=admin)
