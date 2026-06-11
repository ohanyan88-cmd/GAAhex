"""Stage 2 remediation — fail-closed OLT provisioning gate on Stage-11 activate.

Audit finding (Stage 2): ``services/install_board.activate_service`` flips DB status to
ACTIVE without invoking the OLT driver — the service claims ACTIVE while the optical port
is never provisioned. This test pack pins the corrective fail-closed behaviour:

  * REQUIRED + driver unavailable        → FeatureDisabledError (caller maps to 503)
  * REQUIRED + manual override + perm    → DB-only update + SERVICE_ACTIVATION_BYPASS_PROVISIONING audit
  * NOT REQUIRED (dev/test)              → legacy DB-only behaviour preserved
  * Already-ACTIVATED + re-call          → idempotent + SERVICE_ACTIVATION_REATTEMPTED audit; no double provisioning

The HTTP→503 mapping itself is owned by the router layer (FeatureDisabledError is a pure
domain exception). These tests exercise the service function directly so they cover the
fail-closed contract regardless of router wiring, which is being treated as a follow-up.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.exceptions import FeatureDisabledError
from app.models.cpe_binding import CpeBinding
from app.models.event import Event
from app.models.order import Order
from app.models.record import Record
from app.models.respool import ResourcePool
from app.models.splitter import SplitterStrandAllocation
from app.models.user import User
from app.services import install_board as ib_service


# =========================================================================================
# helpers — mirror the conventions in test_install_activate.py
# =========================================================================================

async def _admin_user() -> User:
    async with SessionLocal() as s:
        return (await s.execute(
            select(User).where(User.email == "admin@demo.isp")
        )).scalar_one()


async def _customer(client, admin, name: str | None = None) -> str:
    name = name or f"Stg2 Cust {uuid.uuid4().hex[:6]}"
    return (await client.post("/api/customers", headers=admin, json={"name": name})).json()["id"]


async def _make_order_provisioning(client, admin, customer_id: str) -> str:
    o = (await client.post("/api/orders", headers=admin, json={
        "customer_id": customer_id,
        "items": [{"description": "x", "quantity": 1, "unit_amount": 1000}],
    })).json()
    async with SessionLocal() as s:
        order = (await s.execute(select(Order).where(Order.id == uuid.UUID(o["id"])))).scalar_one()
        order.status = "installation"
        order.control_pass = True
        await s.commit()
    return o["id"]


async def _seed_splitter(tenant_id: uuid.UUID, strand_count: int = 4) -> uuid.UUID:
    async with SessionLocal() as s:
        rec = Record(
            tenant_id=tenant_id, entity_key="optical_splitter",
            status="active",
            data={"name": f"SPL-{uuid.uuid4().hex[:6]}", "ratio": f"1:{strand_count}"},
        )
        s.add(rec)
        await s.flush()
        for n in range(1, strand_count + 1):
            s.add(SplitterStrandAllocation(
                tenant_id=tenant_id, splitter_record_id=rec.id, strand_no=n,
                status="free", allocated_at=datetime.now(timezone.utc),
            ))
        await s.commit()
        return rec.id


async def _seed_vlan_pool(tenant_id: uuid.UUID, *, frm: int, to: int) -> uuid.UUID:
    async with SessionLocal() as s:
        pool = ResourcePool(
            tenant_id=tenant_id, owner_node_id=None,
            name=f"Stg2 VLAN pool {uuid.uuid4().hex[:4]}", kind="vlan",
            spec={"from": frm, "to": to},
        )
        s.add(pool)
        await s.commit()
        return pool.id


def _u_mac() -> str:
    h = uuid.uuid4().hex[:12]
    return ":".join(h[i:i + 2] for i in range(0, 12, 2))


def _u_serial() -> str:
    return f"SN{uuid.uuid4().hex[:10].upper()}"


async def _prepare_order(client, admin, *, vlan_from: int, vlan_to: int) -> str:
    """Set up a PROVISIONING order with strand + VLAN + CPE all bound. Returns order_id."""
    admin_user = await _admin_user()
    tenant_id = admin_user.tenant_id
    await _seed_splitter(tenant_id, strand_count=4)
    await _seed_vlan_pool(tenant_id, frm=vlan_from, to=vlan_to)
    cust = await _customer(client, admin)
    oid = await _make_order_provisioning(client, admin, cust)
    r = await client.post(
        f"/api/install-board/orders/{oid}/allocate-resources", headers=admin,
    )
    assert r.status_code == 200, r.text
    r = await client.post(
        f"/api/install-board/orders/{oid}/bind-cpe", headers=admin,
        json={"mac_address": _u_mac(), "serial": _u_serial(), "vendor": "ZTE"},
    )
    assert r.status_code == 200, r.text
    return oid


def _gate_state(monkeypatch, *, enabled: bool, required: bool) -> None:
    """Drive the feature_gate state seen by services/install_board.

    P1's :func:`feature_gate.is_enabled` returns True iff BOTH the required flag is set in
    ``settings`` AND a real OLT driver is registered, so its False alone cannot tell us
    whether OLT provisioning is "required but unavailable" or "not required at all". The
    service layer therefore looks at TWO signals:

      1. ``feature_gate.is_enabled("olt_provisioning")`` — the all-in-one probe (enabled+real)
      2. ``feature_gate.feature_olt_provisioning_required`` (shim) OR
         ``settings.feature_olt_provisioning_required`` — the "required" posture by itself

    We patch both to give the tests a clean two-bit lever (enabled, required) without
    touching env vars or the global settings object.
    """
    gate = ib_service.feature_gate

    def _is_enabled(key: str) -> bool:
        if key in ("olt", "olt_provisioning"):
            return enabled
        return False

    monkeypatch.setattr(gate, "is_enabled", _is_enabled, raising=False)
    monkeypatch.setattr(
        gate, "feature_olt_provisioning_required", required, raising=False,
    )


# =========================================================================================
# tests
# =========================================================================================

@pytest.mark.asyncio
async def test_activate_service_blocked_when_olt_required_unavailable_in_production(
    client, admin, monkeypatch,
):
    """Production posture: feature REQUIRED, no driver → FeatureDisabledError + audit Event.

    Pins the fail-closed contract: when the OLT subsystem is mandatory and nothing can
    actually provision the port, we refuse the activation rather than lying about it.
    """
    _gate_state(monkeypatch, enabled=False, required=True)
    oid = await _prepare_order(client, admin, vlan_from=2000, vlan_to=2010)
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        with pytest.raises(FeatureDisabledError) as ei:
            await ib_service.activate_service(
                s,
                order_id=uuid.UUID(oid),
                tenant_id=admin_user.tenant_id,
                actor_id=admin_user.id,
            )
        await s.commit()

    assert ei.value.feature == "olt_provisioning"
    assert "unavailable" in ei.value.reason.lower() or "required" in ei.value.reason.lower()

    # Order must NOT have been moved to ACTIVATED.
    async with SessionLocal() as s:
        order = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(oid))
        )).scalar_one()
        assert order.install_substage != "ACTIVATED"
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        assert cpe.status == "pending"
        # And the blocked attempt was audited.
        blocked = (await s.execute(
            select(Event).where(
                Event.type == "SERVICE_ACTIVATION_BLOCKED",
                Event.record_id == order.id,
            )
        )).scalars().all()
        assert len(blocked) >= 1
        assert blocked[-1].data.get("feature") == "olt_provisioning"


@pytest.mark.asyncio
async def test_activate_service_succeeds_with_manual_override_and_audit(
    client, admin, monkeypatch,
):
    """REQUIRED + driver unavailable + manual override + caller holds permission → activates.

    admin@demo.isp holds ``*`` (super_admin) so ``can(grants, 'service', 'bypass_provisioning')``
    is satisfied without touching the permission registry. The bypass reason is recorded on
    the audit Event and on the CPE's last_payload_json so the trail is reconstructable.
    """
    _gate_state(monkeypatch, enabled=False, required=True)
    oid = await _prepare_order(client, admin, vlan_from=2100, vlan_to=2110)
    admin_user = await _admin_user()

    reason = "emergency fiber down — manual splice authorised by NOC lead"
    async with SessionLocal() as s:
        result = await ib_service.activate_service(
            s,
            order_id=uuid.UUID(oid),
            tenant_id=admin_user.tenant_id,
            actor_id=admin_user.id,
            payload={"bypass_provisioning_reason": reason},
        )
        await s.commit()

    assert result["idempotent"] is False
    assert result["activated_at"]

    async with SessionLocal() as s:
        order = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(oid))
        )).scalar_one()
        assert order.install_substage == "ACTIVATED"
        cpe = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        assert cpe.status == "provisioned"
        assert cpe.last_payload_json.get("bypass_provisioning_reason") == reason

        bypass_evts = (await s.execute(
            select(Event).where(
                Event.type == "SERVICE_ACTIVATION_BYPASS_PROVISIONING",
                Event.record_id == order.id,
            )
        )).scalars().all()
        assert len(bypass_evts) == 1
        evt = bypass_evts[0]
        assert evt.data.get("bypass_provisioning_reason") == reason
        assert evt.data.get("permission") == "service.bypass_provisioning"
        # Categorised as SECURITY so it surfaces in the compliance projection of the audit log.
        assert evt.category == "SECURITY"


@pytest.mark.asyncio
async def test_activate_service_blocks_when_override_lacks_permission(
    client, admin, monkeypatch,
):
    """REQUIRED + bypass reason supplied but caller LACKS the override permission → still blocks.

    Tightens the override path: a reason string alone isn't enough — the caller must also hold
    ``service.bypass_provisioning``. Without it, the service falls through to FeatureDisabledError.
    """
    _gate_state(monkeypatch, enabled=False, required=True)
    oid = await _prepare_order(client, admin, vlan_from=2150, vlan_to=2160)
    admin_user = await _admin_user()

    # Force the permission check to fail regardless of admin's ``*`` grant.
    monkeypatch.setattr(ib_service, "can", lambda *a, **kw: False)

    async with SessionLocal() as s:
        with pytest.raises(FeatureDisabledError):
            await ib_service.activate_service(
                s,
                order_id=uuid.UUID(oid),
                tenant_id=admin_user.tenant_id,
                actor_id=admin_user.id,
                payload={"bypass_provisioning_reason": "trying to slip through"},
            )
        await s.commit()


@pytest.mark.asyncio
async def test_activate_service_in_dev_mode_succeeds_without_olt_driver(
    client, admin, monkeypatch,
):
    """Feature NOT required (dev/test) → legacy DB-only activation path is preserved.

    This guards against accidental tightening: until a deployment opts INTO required-OLT,
    development and CI must keep using the simulated path with zero ceremony.
    """
    _gate_state(monkeypatch, enabled=False, required=False)
    oid = await _prepare_order(client, admin, vlan_from=2200, vlan_to=2210)
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        result = await ib_service.activate_service(
            s,
            order_id=uuid.UUID(oid),
            tenant_id=admin_user.tenant_id,
            actor_id=admin_user.id,
        )
        await s.commit()

    assert result["idempotent"] is False

    async with SessionLocal() as s:
        order = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(oid))
        )).scalar_one()
        assert order.install_substage == "ACTIVATED"
        # No bypass / blocked Event in the dev path.
        blocked = (await s.execute(
            select(Event).where(
                Event.type.in_(
                    ("SERVICE_ACTIVATION_BLOCKED", "SERVICE_ACTIVATION_BYPASS_PROVISIONING")
                ),
                Event.record_id == order.id,
            )
        )).scalars().all()
        assert blocked == []


@pytest.mark.asyncio
async def test_activate_service_idempotent_with_reattempt_audit(
    client, admin, monkeypatch,
):
    """Calling activate twice → second call audited as re-attempt; no double provisioning.

    Locks in idempotency at the service layer: the strand/CPE/order rows touched on the first
    call must NOT mutate again on the second, and a SERVICE_ACTIVATION_REATTEMPTED Event must
    sit on the order so the trail records the duplicate call.
    """
    _gate_state(monkeypatch, enabled=True, required=True)  # feature on → driver dev-mode path
    oid = await _prepare_order(client, admin, vlan_from=2300, vlan_to=2310)
    admin_user = await _admin_user()

    async with SessionLocal() as s:
        r1 = await ib_service.activate_service(
            s,
            order_id=uuid.UUID(oid),
            tenant_id=admin_user.tenant_id,
            actor_id=admin_user.id,
        )
        await s.commit()
    assert r1["idempotent"] is False

    # Snapshot the post-activation state to assert no double provisioning happened on call 2.
    async with SessionLocal() as s:
        order = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(oid))
        )).scalar_one()
        cpe_before = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        strand_before = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == order.splitter_strand_allocation_id
            )
        )).scalar_one()
        first_provisioned_at = cpe_before.provisioned_at
        first_substage_at = order.install_substage_at
        first_strand_status = strand_before.status

    async with SessionLocal() as s:
        r2 = await ib_service.activate_service(
            s,
            order_id=uuid.UUID(oid),
            tenant_id=admin_user.tenant_id,
            actor_id=admin_user.id,
        )
        await s.commit()
    assert r2["idempotent"] is True

    async with SessionLocal() as s:
        order = (await s.execute(
            select(Order).where(Order.id == uuid.UUID(oid))
        )).scalar_one()
        cpe_after = (await s.execute(
            select(CpeBinding).where(CpeBinding.id == order.cpe_binding_id)
        )).scalar_one()
        strand_after = (await s.execute(
            select(SplitterStrandAllocation).where(
                SplitterStrandAllocation.id == order.splitter_strand_allocation_id
            )
        )).scalar_one()
        assert cpe_after.provisioned_at == first_provisioned_at
        assert order.install_substage_at == first_substage_at
        assert strand_after.status == first_strand_status

        reattempts = (await s.execute(
            select(Event).where(
                Event.type == "SERVICE_ACTIVATION_REATTEMPTED",
                Event.record_id == order.id,
            )
        )).scalars().all()
        assert len(reattempts) == 1
