"""M1-B Phase 1 — vendor-agnostic OLT driver Protocol + MockOltDriver + factory tests.

Covers the contract that future Huawei/ZTE drivers (M1-B.3 / M1-B.4) must satisfy:

* MockOltDriver structurally satisfies the OltDriver Protocol.
* All 7 universal commands round-trip with the expected result shapes.
* Optical power is deterministic per target and distinct across targets.
* Provision/delete semantics raise OltCommandError on duplicate/missing.
* Factory dispatches by vendor + decrypts credentials via field_crypto.
* register_driver registers new vendors at runtime.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.security.field_crypto import encrypt_str
from app.services.olt import (
    LineProfileResult,
    MockOltDriver,
    OltCommandError,
    OltCredentialsError,
    OltDriver,
    OltNotSupportedError,
    OltStatus,
    OltUptime,
    OnuDeleteResult,
    OnuProvisionResult,
    OpticalPower,
    VlanSetResult,
    get_driver_for_olt,
    register_driver,
    registered_vendors,
)
from app.services.olt import factory as olt_factory


# ──────────────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────────────


def _mock_driver() -> MockOltDriver:
    return MockOltDriver(host="10.0.0.1", port=22, credentials={"username": "u", "password": "p"})


# ──────────────────────────────────────────────────────────────────────────
# Protocol conformance
# ──────────────────────────────────────────────────────────────────────────


def test_mock_driver_satisfies_protocol():
    """MockOltDriver must be recognized as an OltDriver via @runtime_checkable."""
    drv = _mock_driver()
    assert isinstance(drv, OltDriver)
    # vendor attribute is part of the Protocol surface
    assert drv.vendor == "mock"


def test_mock_driver_has_all_7_command_methods():
    """Belt-and-braces explicit check on the universal command surface."""
    drv = _mock_driver()
    for name in (
        "get_status", "get_uptime",
        "provision_onu", "delete_onu",
        "get_optical_power", "set_vlan", "apply_line_profile",
        "close",
    ):
        assert callable(getattr(drv, name)), f"MockOltDriver missing {name!r}"


# ──────────────────────────────────────────────────────────────────────────
# status / uptime
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_status_returns_reachable_olt_status():
    drv = _mock_driver()
    s = await drv.get_status()
    assert isinstance(s, OltStatus)
    assert s.reachable is True
    assert s.vendor == "mock"
    assert isinstance(s.chassis_count, int) and s.chassis_count >= 1
    assert isinstance(s.card_count, int) and s.card_count >= 1
    assert isinstance(s.port_count, int) and s.port_count >= 1
    assert isinstance(s.last_seen_at, datetime)
    assert s.last_seen_at.tzinfo is not None  # always tz-aware


@pytest.mark.asyncio
async def test_get_uptime_returns_positive_and_boot_time_in_past():
    drv = _mock_driver()
    up = await drv.get_uptime()
    assert isinstance(up, OltUptime)
    assert up.uptime_seconds > 0
    assert up.boot_time < datetime.now(timezone.utc)


# ──────────────────────────────────────────────────────────────────────────
# provision / delete ONU
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provision_onu_succeeds_for_new_serial():
    drv = _mock_driver()
    r = await drv.provision_onu(
        serial="HWTC00112233", slot=0, port=1,
        line_profile="100M_RES", vlan_id=100, customer_ref="CUST-1",
    )
    assert isinstance(r, OnuProvisionResult)
    assert r.serial == "HWTC00112233"
    assert r.slot == 0 and r.port == 1
    assert r.vlan_id == 100
    assert r.line_profile == "100M_RES"
    assert r.onu_id is not None and r.onu_id.startswith("mock-onu-")
    assert isinstance(r.provisioned_at, datetime)


@pytest.mark.asyncio
async def test_provision_onu_duplicate_raises_command_error():
    drv = _mock_driver()
    await drv.provision_onu(
        serial="HWTC00DUP", slot=0, port=1,
        line_profile="100M_RES", vlan_id=100,
    )
    with pytest.raises(OltCommandError) as exc:
        await drv.provision_onu(
            serial="HWTC00DUP", slot=0, port=2,
            line_profile="100M_RES", vlan_id=200,
        )
    assert "already provisioned" in str(exc.value)


@pytest.mark.asyncio
async def test_delete_onu_succeeds_after_provision():
    drv = _mock_driver()
    await drv.provision_onu(
        serial="HWTC00DEL", slot=0, port=1,
        line_profile="100M_RES", vlan_id=100,
    )
    r = await drv.delete_onu(serial="HWTC00DEL")
    assert isinstance(r, OnuDeleteResult)
    assert r.serial == "HWTC00DEL"
    assert isinstance(r.deleted_at, datetime)


@pytest.mark.asyncio
async def test_delete_onu_unknown_raises_command_error():
    drv = _mock_driver()
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="HWTC00MISSING")


@pytest.mark.asyncio
async def test_delete_onu_then_reprovision_same_serial_works():
    """After deletion, the same serial should be available for re-provisioning."""
    drv = _mock_driver()
    await drv.provision_onu(
        serial="HWTC00RE", slot=0, port=1,
        line_profile="100M_RES", vlan_id=100,
    )
    await drv.delete_onu(serial="HWTC00RE")
    r2 = await drv.provision_onu(
        serial="HWTC00RE", slot=0, port=2,
        line_profile="200M_BIZ", vlan_id=200,
    )
    assert r2.vlan_id == 200 and r2.line_profile == "200M_BIZ"


# ──────────────────────────────────────────────────────────────────────────
# optical power — deterministic + distinct
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_optical_power_is_deterministic_for_same_target():
    drv = _mock_driver()
    a = await drv.get_optical_power(target_type="onu", target_id="HWTC00DET")
    b = await drv.get_optical_power(target_type="onu", target_id="HWTC00DET")
    assert isinstance(a, OpticalPower)
    assert a.rx_dbm == b.rx_dbm
    assert a.tx_dbm == b.tx_dbm
    # Rx in [-30, -15], Tx in [0, 3]
    assert Decimal("-30") <= a.rx_dbm <= Decimal("-15")
    assert a.tx_dbm is not None and Decimal("0") <= a.tx_dbm <= Decimal("3")


@pytest.mark.asyncio
async def test_optical_power_differs_across_targets():
    drv = _mock_driver()
    readings = [
        await drv.get_optical_power(target_type="onu", target_id=f"HWTC00DIFF{i}")
        for i in range(8)
    ]
    rx_values = {r.rx_dbm for r in readings}
    # 8 distinct serials should map to more than 1 distinct Rx reading.
    assert len(rx_values) > 1


@pytest.mark.asyncio
async def test_optical_power_target_type_olt_port():
    drv = _mock_driver()
    r = await drv.get_optical_power(target_type="olt_port", target_id="0/1/0")
    assert r.target_type == "olt_port"
    assert r.target_id == "0/1/0"


# ──────────────────────────────────────────────────────────────────────────
# vlan / line profile
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_vlan_returns_success():
    drv = _mock_driver()
    r = await drv.set_vlan(slot=0, port=1, vlan_id=100, purpose="data")
    assert isinstance(r, VlanSetResult)
    assert r.slot == 0 and r.port == 1
    assert r.vlan_id == 100 and r.purpose == "data"
    assert isinstance(r.applied_at, datetime)


@pytest.mark.asyncio
async def test_apply_line_profile_returns_success():
    drv = _mock_driver()
    r = await drv.apply_line_profile(
        target_type="onu", target_id="HWTC00PROF", profile_name="100M_RES",
    )
    assert isinstance(r, LineProfileResult)
    assert r.target_type == "onu"
    assert r.target_id == "HWTC00PROF"
    assert r.profile_name == "100M_RES"


# ──────────────────────────────────────────────────────────────────────────
# close() idempotence
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_close_is_idempotent():
    drv = _mock_driver()
    await drv.close()
    await drv.close()  # second call must not raise
    # The driver remains usable for synchronous attribute reads after close.
    assert drv.vendor == "mock"


# ──────────────────────────────────────────────────────────────────────────
# factory: vendor dispatch
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_factory_returns_mock_driver_for_mock_vendor():
    record = {"data": {"vendor": "mock", "host": "10.0.0.1", "port": 22}}
    drv = await get_driver_for_olt(record)
    assert isinstance(drv, MockOltDriver)
    assert isinstance(drv, OltDriver)
    assert drv._host == "10.0.0.1"
    assert drv._port == 22


@pytest.mark.asyncio
async def test_factory_vendor_lookup_is_case_insensitive():
    record = {"data": {"vendor": "MOCK", "host": "10.0.0.1"}}
    drv = await get_driver_for_olt(record)
    assert isinstance(drv, MockOltDriver)


@pytest.mark.asyncio
async def test_factory_accepts_orm_like_record_with_data_attribute():
    """Anything exposing .data is acceptable (mimics SQLAlchemy Record)."""
    class _FakeRec:
        id = uuid.uuid4()
        data = {"vendor": "mock", "host": "10.0.0.2"}

    drv = await get_driver_for_olt(_FakeRec())
    assert isinstance(drv, MockOltDriver)
    assert drv._olt_record_id is not None


@pytest.mark.asyncio
async def test_factory_unknown_vendor_raises_not_supported():
    record = {"data": {"vendor": "cisco", "host": "10.0.0.1"}}
    with pytest.raises(OltNotSupportedError):
        await get_driver_for_olt(record)


@pytest.mark.asyncio
async def test_factory_missing_vendor_raises_not_supported():
    record = {"data": {"host": "10.0.0.1"}}
    with pytest.raises(OltNotSupportedError):
        await get_driver_for_olt(record)


@pytest.mark.asyncio
async def test_factory_missing_host_raises_credentials_error():
    record = {"data": {"vendor": "mock"}}
    with pytest.raises(OltCredentialsError):
        await get_driver_for_olt(record)


# ──────────────────────────────────────────────────────────────────────────
# factory: register_driver
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_driver_adds_new_vendor_to_registry():
    """register_driver wires a new vendor key to a driver class."""

    class DummyDriver(MockOltDriver):
        vendor: str = "dummy"

    assert "dummy" not in registered_vendors()
    register_driver("dummy", DummyDriver)
    try:
        assert "dummy" in registered_vendors()
        record = {"data": {"vendor": "dummy", "host": "1.2.3.4"}}
        drv = await get_driver_for_olt(record)
        assert isinstance(drv, DummyDriver)
        assert drv.vendor == "dummy"
    finally:
        # Restore registry — don't leak across tests.
        olt_factory._DRIVERS.pop("dummy", None)


def test_register_driver_rejects_empty_vendor():
    with pytest.raises(ValueError):
        register_driver("", MockOltDriver)


# ──────────────────────────────────────────────────────────────────────────
# factory: credentials decryption via field_crypto
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_factory_decrypts_credentials_via_field_crypto():
    """Encrypted credential values must arrive at the driver in plaintext."""
    enc_user = encrypt_str("admin")
    enc_pass = encrypt_str("s3cret-xyz")
    # encrypt_str should produce a Fernet token, NOT the plaintext.
    assert enc_user != "admin"
    assert enc_pass != "s3cret-xyz"

    record = {
        "data": {
            "vendor": "mock",
            "host": "10.0.0.9",
            "port": 22,
            "credentials": {
                "username": enc_user,
                "password": enc_pass,
                # Non-string values pass through untouched.
                "ssh_port": 2222,
            },
        }
    }
    drv = await get_driver_for_olt(record)
    assert drv._credentials["username"] == "admin"
    assert drv._credentials["password"] == "s3cret-xyz"
    assert drv._credentials["ssh_port"] == 2222


@pytest.mark.asyncio
async def test_factory_tolerates_plaintext_credentials():
    """If a value isn't valid Fernet ciphertext, decrypt_str returns None;
    the factory then passes the original value through unchanged."""
    record = {
        "data": {
            "vendor": "mock",
            "host": "10.0.0.10",
            "credentials": {"username": "legacy-plaintext-user"},
        }
    }
    drv = await get_driver_for_olt(record)
    assert drv._credentials["username"] == "legacy-plaintext-user"


@pytest.mark.asyncio
async def test_factory_handles_no_credentials():
    """Missing credentials is fine at factory time — concrete drivers can complain later."""
    record = {"data": {"vendor": "mock", "host": "10.0.0.11"}}
    drv = await get_driver_for_olt(record)
    assert drv._credentials == {}
