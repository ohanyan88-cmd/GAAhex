"""Pack P6 / Stage 2 — warehouse subsystem fail-closed remediation.

The 2026-06-04 audit flagged that GAAhex has no warehouse module (no stock_item,
no transfer, no receiving) but several code paths semantically claim inventory
tracking. Strategy:

* **Real stock-movement endpoints** (transfer / receive / issue / return /
  stock_*) — when the warehouse feature is disabled, refuse with 503 +
  ``WAREHOUSE_DISABLED_BLOCKED`` audit Event. ``noc_inventory.py`` ships ZERO
  such endpoints today (only ``move_asset`` exists, which is asset-row only),
  so the 503 path has nothing to assert against in this file. The 503 path
  IS exercised by Pack P1's :func:`app.services.feature_gate.require_warehouse`
  unit tests; this file owns the noc_inventory router layer specifically.

* **Asset-row "move"** — keep the existing single-row patch behavior so
  current install + dispatch flows don't regress, BUT every call emits an
  ``INVENTORY_TRACKING_LIMITED`` audit Event with
  ``feature_warehouse_enabled=False`` so SuperAdmin's audit log surfaces the
  limited-tracking state. When the real warehouse module ships and the flag
  flips on, this audit ceases firing — the cessation itself is the signal.

Default test posture: ``feature_warehouse_enabled=False`` (Settings default,
see ``app.config.Settings``), so we exercise the "warehouse disabled" branch
without monkeypatching. The "warehouse enabled" branch (no audit) is asserted
by patching :func:`app.routers.noc_inventory.is_enabled` to return True for
the warehouse key.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Event, Record, User


# ──────────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────────


async def _admin_tenant_id() -> uuid.UUID:
    async with SessionLocal() as s:
        u = (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()
        return u.tenant_id


async def _seed_asset(tenant_id: uuid.UUID, location_type: str = "warehouse") -> uuid.UUID:
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


async def _limited_tracking_events_for(asset_id: uuid.UUID) -> list[Event]:
    async with SessionLocal() as s:
        return (await s.execute(
            select(Event).where(
                Event.type == "INVENTORY_TRACKING_LIMITED",
                Event.record_id == asset_id,
            )
        )).scalars().all()


# ──────────────────────────────────────────────────────────────────────────────
# Tests — move_asset under disabled warehouse
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_move_asset_emits_limited_tracking_audit_when_warehouse_disabled(client, admin):
    """move_asset with the warehouse feature OFF (the default) MUST emit an
    INVENTORY_TRACKING_LIMITED audit Event documenting the gap."""
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset(tenant_id, "warehouse")

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "truck", "reason": "Stage-2 audit smoke"},
    )
    assert r.status_code == 200, r.text

    evs = await _limited_tracking_events_for(asset_id)
    assert len(evs) >= 1, "expected an INVENTORY_TRACKING_LIMITED audit Event"
    ev = evs[-1]
    assert ev.entity_key == "asset"
    assert ev.tenant_id == tenant_id
    # The audit payload MUST carry the feature flag state — that's what makes
    # the audit row machine-readable for SuperAdmin's gap dashboard.
    assert ev.data.get("feature_warehouse_enabled") is False
    assert "note" in ev.data
    # Event System enrichment (D1) — not strictly required, but verifies the
    # call site uses the modern emit kwargs.
    assert ev.event_name == "Asset.InventoryTrackingLimited"
    assert ev.category == "SYSTEM"


@pytest.mark.asyncio
async def test_move_asset_works_in_dev_mode(client, admin):
    """Core move_asset behaviour MUST be preserved when warehouse is disabled —
    we only ADD an audit row, we don't change the semantics of the patch."""
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset(tenant_id, "warehouse")

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "install_site"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["asset_record_id"] == str(asset_id)
    assert body["to_location_type"] == "install_site"
    assert body["from_location_type"] == "warehouse"
    assert body["moved_at"] is not None

    # Record.data must reflect the new location (existing contract from test_asset_movements).
    async with SessionLocal() as s:
        rec = (await s.execute(
            select(Record).where(Record.id == asset_id)
        )).scalar_one()
        assert rec.data.get("location_type") == "install_site"


@pytest.mark.asyncio
async def test_move_asset_skips_audit_when_warehouse_enabled(client, admin, monkeypatch):
    """When the warehouse feature is enabled (the future state, once the real
    module ships), the limited-tracking audit MUST stop firing. The cessation
    is the forensic signal that full warehouse tracking is now in effect."""
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset(tenant_id, "warehouse")

    # Patch the symbol the router module imported, not the source module —
    # otherwise the router keeps its already-bound reference and the patch is invisible.
    from app.routers import noc_inventory as nic
    monkeypatch.setattr(nic, "is_enabled", lambda key: True if key == "warehouse" else False)

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "hub"},
    )
    assert r.status_code == 200, r.text

    evs = await _limited_tracking_events_for(asset_id)
    assert evs == [], (
        "INVENTORY_TRACKING_LIMITED MUST NOT fire when warehouse is enabled "
        f"(got {len(evs)} events)"
    )


@pytest.mark.asyncio
async def test_audit_emit_failure_does_not_break_move(client, admin, monkeypatch):
    """The audit emit is best-effort. If workflow.emit blows up (e.g. transient
    DB issue, future schema drift), the user's move MUST still succeed — the
    fail-closed posture is for warehouse-required flows, not for advisory audits."""
    tenant_id = await _admin_tenant_id()
    asset_id = await _seed_asset(tenant_id, "warehouse")

    from app.routers import noc_inventory as nic

    async def _explode(*args, **kwargs):
        raise RuntimeError("simulated audit-layer failure")

    monkeypatch.setattr(nic.workflow, "emit", _explode)

    r = await client.post(
        f"/api/assets/{asset_id}/move", headers=admin,
        json={"to_location_type": "truck"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["to_location_type"] == "truck"
