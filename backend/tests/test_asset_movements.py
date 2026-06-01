"""NOC Phase C — Asset location movement tests.

Covers:
  * POST /assets/{id}/move creates AssetLocationHistory row
  * GET /assets/{id}/location-history returns ordered trail
  * Moving twice creates two history rows
  * Record.data updated with new location_type + location_id after move
  * Non-admin 403
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models.record import Record
from app.models.user import User


# ==========================================================================================
# helpers
# ==========================================================================================

async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _seed_asset_record(tenant_id: uuid.UUID, location_type: str = "warehouse") -> uuid.UUID:
    """Create a Record(entity_key='asset') with an initial location and return its id."""
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id,
            entity_key="asset",
            status="ACTIVE",
            data={
                "name": f"Asset-{uuid.uuid4().hex[:6]}",
                "kind": "CPE",
                "location_type": location_type,
                "location_id": None,
            },
        )
        s.add(rec)
        await s.commit()
        return rec.id


# ==========================================================================================
# tests
# ==========================================================================================

@pytest.mark.asyncio
async def test_move_asset_creates_history_row(client, admin):
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset_record(tenant_id, "warehouse")

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "truck", "reason": "Deployment dispatch"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["asset_record_id"] == str(asset_id)
    assert body["to_location_type"] == "truck"
    assert body["from_location_type"] == "warehouse"
    assert body["reason"] == "Deployment dispatch"
    assert body["moved_at"] is not None


@pytest.mark.asyncio
async def test_location_history_returns_ordered_trail(client, admin):
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset_record(tenant_id, "warehouse")

    # Move 1: warehouse → truck
    r1 = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "truck"},
    )
    assert r1.status_code == 200, r1.text

    # Move 2: truck → install_site
    r2 = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "install_site"},
    )
    assert r2.status_code == 200, r2.text

    # Fetch trail
    trail_r = await client.get(f"/api/assets/{asset_id}/location-history", headers=admin)
    assert trail_r.status_code == 200, trail_r.text
    items = trail_r.json()
    assert len(items) >= 2
    # Most-recent first (install_site move should be first)
    assert items[0]["to_location_type"] == "install_site"
    assert items[1]["to_location_type"] == "truck"


@pytest.mark.asyncio
async def test_two_moves_create_two_history_rows(client, admin):
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset_record(tenant_id, "hub")

    await client.post(f"/api/assets/{asset_id}/move", headers=admin,
                      json={"to_location_type": "truck"})
    await client.post(f"/api/assets/{asset_id}/move", headers=admin,
                      json={"to_location_type": "install_site"})

    trail_r = await client.get(f"/api/assets/{asset_id}/location-history", headers=admin)
    assert trail_r.status_code == 200, trail_r.text
    assert len(trail_r.json()) >= 2


@pytest.mark.asyncio
async def test_move_updates_record_data(client, admin):
    """Record.data should reflect the new location_type + location_id after move."""
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset_record(tenant_id, "warehouse")
    dest_location_id = str(uuid.uuid4())

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "hub", "to_location_id": dest_location_id},
    )
    assert r.status_code == 200, r.text

    # Read Record.data directly from DB
    async with SessionLocal() as s:
        rec = (await s.execute(
            select(Record).where(Record.id == asset_id)
        )).scalar_one()
        assert rec.data.get("location_type") == "hub"
        assert rec.data.get("location_id") == dest_location_id


@pytest.mark.asyncio
async def test_move_asset_non_admin_returns_403(client, agent):
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset_record(tenant_id, "warehouse")

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=agent,
        json={"to_location_type": "truck"},
    )
    assert r.status_code == 403, r.text
