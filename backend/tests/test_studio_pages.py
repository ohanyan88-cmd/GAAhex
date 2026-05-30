"""Tests for Studio page-versioning system (Prompt 6 publish pipeline).

Covers:
  - Create page, save draft, publish → version_no=1, status='published'
  - Save second draft and publish → old version flips to draft
  - Rollback to v1 → v1 is published, v2 is draft
  - Diff is populated on publish
  - 403 for user without config.manage
"""
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _create_page(client, admin, key="home", label="Home"):
    r = await client.post("/api/studio/pages", headers=admin, json={"key": key, "label": label})
    assert r.status_code == 201, r.text
    return r.json()


async def _save_draft(client, admin, page_id, snapshot):
    r = await client.post(f"/api/studio/pages/{page_id}/versions", headers=admin, json={"snapshot": snapshot})
    assert r.status_code == 201, r.text
    return r.json()


async def _publish(client, admin, page_id, version_id):
    r = await client.post(f"/api/studio/pages/{page_id}/versions/{version_id}/publish", headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


async def _rollback(client, admin, page_id, version_id):
    r = await client.post(f"/api/studio/pages/{page_id}/versions/{version_id}/rollback", headers=admin)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

async def test_create_page(client, admin):
    """Create a page and verify it appears in the list."""
    page = await _create_page(client, admin, key="studio-test-create", label="Create Test")
    assert page["key"] == "studio-test-create"
    assert page["label"] == "Create Test"
    assert page["published_snapshot"] is None

    pages = (await client.get("/api/studio/pages", headers=admin)).json()
    keys = {p["key"] for p in pages}
    assert "studio-test-create" in keys


async def test_save_draft_and_publish_v1(client, admin):
    """Create page → save draft → publish; expect version_no=1, status=published."""
    page = await _create_page(client, admin, key="studio-test-pub1", label="Pub Test 1")
    page_id = page["id"]

    snap = {"layout": "grid", "columns": 2}
    v1 = await _save_draft(client, admin, page_id, snap)
    assert v1["status"] == "draft"
    assert v1["version_no"] == 1

    pub = await _publish(client, admin, page_id, v1["id"])
    assert pub["status"] == "published"
    assert pub["version_no"] == 1

    # GET page should now return the published snapshot
    pg = (await client.get(f"/api/studio/pages/{page_id}", headers=admin)).json()
    assert pg["published_snapshot"] == snap


async def test_publish_second_draft_demotes_first(client, admin):
    """Save v1, publish; save v2, publish → v1 becomes draft, v2 is published."""
    page = await _create_page(client, admin, key="studio-test-pub2", label="Pub Test 2")
    page_id = page["id"]

    v1 = await _save_draft(client, admin, page_id, {"a": 1})
    await _publish(client, admin, page_id, v1["id"])

    v2 = await _save_draft(client, admin, page_id, {"a": 1, "b": 2})
    assert v2["version_no"] == 2

    pub2 = await _publish(client, admin, page_id, v2["id"])
    assert pub2["status"] == "published"
    assert pub2["version_no"] == 2

    # List all versions — only v2 should be published
    versions = (await client.get(f"/api/studio/pages/{page_id}/versions", headers=admin)).json()
    by_no = {v["version_no"]: v for v in versions}
    assert by_no[1]["status"] == "draft"
    assert by_no[2]["status"] == "published"


async def test_rollback_to_v1(client, admin):
    """Publish v1, publish v2, rollback to v1 → v1 is published, v2 is draft."""
    page = await _create_page(client, admin, key="studio-test-rollback", label="Rollback Test")
    page_id = page["id"]

    v1 = await _save_draft(client, admin, page_id, {"version": "one"})
    await _publish(client, admin, page_id, v1["id"])

    v2 = await _save_draft(client, admin, page_id, {"version": "two"})
    await _publish(client, admin, page_id, v2["id"])

    rolled = await _rollback(client, admin, page_id, v1["id"])
    assert rolled["status"] == "published"
    assert rolled["version_no"] == 1

    versions = (await client.get(f"/api/studio/pages/{page_id}/versions", headers=admin)).json()
    by_no = {v["version_no"]: v for v in versions}
    assert by_no[1]["status"] == "published"
    assert by_no[2]["status"] == "draft"


async def test_diff_populated_on_publish(client, admin):
    """Diff is null on first publish, populated on subsequent publish."""
    page = await _create_page(client, admin, key="studio-test-diff", label="Diff Test")
    page_id = page["id"]

    v1 = await _save_draft(client, admin, page_id, {"x": 1, "y": 2})
    pub1 = await _publish(client, admin, page_id, v1["id"])
    # First publish has no previous — diff is None
    assert pub1["diff"] is None

    v2 = await _save_draft(client, admin, page_id, {"x": 99, "z": 3})
    pub2 = await _publish(client, admin, page_id, v2["id"])
    diff = pub2["diff"]
    assert diff is not None
    assert "y" in diff["removed"]
    assert "z" in diff["added"]
    assert "x" in diff["changed"]

    # GET /diff endpoint returns same diff
    r = await client.get(f"/api/studio/pages/{page_id}/versions/{v2['id']}/diff", headers=admin)
    assert r.status_code == 200
    assert r.json() == diff


async def test_diff_endpoint_computes_on_the_fly(client, admin):
    """GET /diff on a draft (no stored diff) computes on-the-fly vs previous version."""
    page = await _create_page(client, admin, key="studio-test-diff-fly", label="Diff Fly")
    page_id = page["id"]

    v1 = await _save_draft(client, admin, page_id, {"a": 1})
    v2 = await _save_draft(client, admin, page_id, {"a": 1, "b": 2})

    r = await client.get(f"/api/studio/pages/{page_id}/versions/{v2['id']}/diff", headers=admin)
    assert r.status_code == 200
    d = r.json()
    assert "b" in d["added"]
    assert d["changed"] == []
    assert d["removed"] == []


async def test_403_without_config_manage(client, agent):
    """A user without config.manage is rejected on all studio/pages endpoints."""
    r = await client.post("/api/studio/pages", headers=agent, json={"key": "forbidden", "label": "x"})
    assert r.status_code == 403

    r = await client.get("/api/studio/pages", headers=agent)
    assert r.status_code == 403


async def test_list_versions_sorted_desc(client, admin):
    """Versions are returned newest first (version_no descending)."""
    page = await _create_page(client, admin, key="studio-test-sort", label="Sort Test")
    page_id = page["id"]

    for i in range(3):
        await _save_draft(client, admin, page_id, {"i": i})

    versions = (await client.get(f"/api/studio/pages/{page_id}/versions", headers=admin)).json()
    nos = [v["version_no"] for v in versions]
    assert nos == sorted(nos, reverse=True)


async def test_duplicate_page_key_rejected(client, admin):
    """Creating two pages with the same key returns 409."""
    await _create_page(client, admin, key="studio-test-dup", label="Dup 1")
    r = await client.post("/api/studio/pages", headers=admin, json={"key": "studio-test-dup", "label": "Dup 2"})
    assert r.status_code == 409
