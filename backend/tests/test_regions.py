"""SPEC §0.6 canonical region table — smoke test.

Boots the app on the standard test DB (`gaaex_test` — `conftest.py` recreates it from
`Base.metadata.create_all` per session) and exercises the read-only `/api/regions`
router:

  1. GET /api/regions as admin → 200 + at least one region (the seeded YER).
  2. GET /api/regions/{id} → 200 + matching code/name.
  3. GET /api/regions/{wrong-uuid} → 404.

The conftest fixture only invokes `seed_if_empty` / `seed_meta_if_empty` /
`seed_access_if_empty` — it does NOT auto-run the lifespan seeders (httpx's
ASGITransport does not fire FastAPI lifespan events). So this test invokes
`seed_demo_regions_if_empty()` directly in its setup fixture, matching the pattern
used by other tests that depend on a SPEC-driven seeder.
"""
import uuid

import pytest
import pytest_asyncio

from app.seed_regions import seed_demo_regions_if_empty


@pytest_asyncio.fixture(scope="module", autouse=True)
async def _seed_regions():
    """Ensure the YER region row exists for the demo tenant before any test runs."""
    await seed_demo_regions_if_empty()
    yield


@pytest.mark.asyncio
async def test_list_regions_returns_seeded_yerevan(client, admin):
    """SPEC §0.6 smoke: tenant boot seeds at least the default YER region."""
    r = await client.get("/api/regions", headers=admin)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1, "expected at least the seeded YER region"

    codes = {row["code"] for row in data}
    assert "YER" in codes, f"expected YER in {codes}"

    yer = next(row for row in data if row["code"] == "YER")
    # Shape check — confirms the serializer carries the metadata, hierarchy, and audit fields.
    for key in ("id", "tenant_id", "code", "name", "parent_id",
                "region_type", "status", "timezone", "locale",
                "metadata", "created_at", "updated_at"):
        assert key in yer, f"missing key {key} in {yer}"
    assert yer["name"] == "Yerevan"
    assert yer["region_type"] == "region"
    assert yer["status"] == "active"
    assert yer["timezone"] == "Asia/Yerevan"
    assert yer["locale"] == "hy-AM"
    assert yer["parent_id"] is None  # top-level for now


@pytest.mark.asyncio
async def test_get_region_by_id_returns_matching_row(client, admin):
    """GET /api/regions/{id} on a known row returns the same shape as list[i]."""
    list_resp = await client.get("/api/regions", headers=admin)
    assert list_resp.status_code == 200
    rows = list_resp.json()
    assert rows, "list must be non-empty to test get-by-id"
    target = next(r for r in rows if r["code"] == "YER")

    r = await client.get(f"/api/regions/{target['id']}", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == target["id"]
    assert body["code"] == target["code"]
    assert body["name"] == target["name"]


@pytest.mark.asyncio
async def test_get_region_unknown_uuid_404(client, admin):
    """A well-formed UUID that doesn't match any row → 404 (not 500, not 401)."""
    missing = uuid.uuid4()
    r = await client.get(f"/api/regions/{missing}", headers=admin)
    assert r.status_code == 404, r.text


@pytest.mark.asyncio
async def test_seed_demo_regions_is_idempotent():
    """A second invocation of the seeder inserts 0 rows (idempotency contract)."""
    n = await seed_demo_regions_if_empty()
    assert n == 0, f"expected 0 new rows on idempotent re-run, got {n}"
