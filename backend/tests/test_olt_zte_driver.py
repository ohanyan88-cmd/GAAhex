"""M1-B Phase 4 — ZteDriver tests (ZTE C300 / C320 / C600).

All driver tests use ``MockCliTransport`` with realistic ZTE ZXA10 CLI output
as canned responses — the driver never touches real network. Tests verify:

* Connection lifecycle (enable/configure-terminal view, idempotent close,
  enable-password injection).
* Each of the 7 OltDriver commands issues the right ZTE CLI string AND parses
  realistic responses correctly.
* Error paths surface ``OltCommandError`` on ZTE's ``Error:`` / ``Invalid input``
  / ``failed`` lines.
* Factory auto-registration at module import time exposes ``'zte'``, and both
  ``'huawei'`` AND ``'zte'`` coexist in the registry.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest

from app.services.olt import (
    HuaweiDriver,
    LineProfileResult,
    OltCommandError,
    OltDriver,
    OltStatus,
    OltUptime,
    OnuDeleteResult,
    OnuProvisionResult,
    OpticalPower,
    VlanSetResult,
    ZteDriver,
    get_driver_for_olt,
    registered_vendors,
)
from app.services.olt.drivers.zte import (
    _derive_onu_index,
    _looks_like_failure,
    _parse_onu_by_sn,
    _parse_pon_power,
    _parse_show_card,
    _parse_show_version,
)
from app.services.olt.transport import MockCliTransport


# ──────────────────────────────────────────────────────────────────────────
# Canned ZTE CLI outputs (realistic ZXA10 syntax)
# ──────────────────────────────────────────────────────────────────────────


SHOW_VERSION = """\
ZTE ZXA10 Software, Version: V2.1.1.B5
Copyright (c) ZTE Corporation
Compiled date: Aug 30 2022 16:42:18
Hardware version: V2.0
System Up Time: 12 days 04:32:11
System Memory: 4096MB
Model: C320
"""

SHOW_VERSION_NO_UPTIME = """\
ZTE ZXA10 Software, Version: V2.1.1.B5
Copyright (c) ZTE Corporation
Compiled date: Aug 30 2022 16:42:18
Hardware version: V2.0
System Memory: 4096MB
Model: C320
"""

SHOW_CARD = """\
Rack Shelf Slot CfgType            RealType            Port HardVer SoftVer    Status
-----------------------------------------------------------------------------------------
1    1     1    GTGO               GTGO                16   V2.0    V2.1.1.B5  INSERVICE
1    1     2    GTGO               GTGO                16   V2.0    V2.1.1.B5  INSERVICE
1    1     3    SCXM               SCXM                0    V1.0    V2.1.1.B5  INSERVICE
1    1     4    PRWG               PRWG                0    V1.0    V2.1.1.B5  INSERVICE
-----------------------------------------------------------------------------------------
"""

SHOW_GPON_ONU_BY_SN = """\
SN-LookupResult:
  GPON-onu: gpon-onu_1/2/3:5
  ONU Type: ZTE-F660
  State: AT_WORKING
  Distance: 1240 m
"""

SHOW_PON_POWER_ONU_RX = """\
Gpon-onu_1/2/3:5
  RX power : -23.45 dBm
"""

SHOW_PON_POWER_ONU_TX = """\
Gpon-onu_1/2/3:5
  TX power : 2.10 dBm
"""

SHOW_PON_POWER_OLT_RX = """\
Gpon-olt_1/2/3
  RX power statistics:
    Last value : -24.10 dBm
"""

# ZTE error tokens — used by failure tests.
ERROR_INVALID = "  Error: Invalid input detected at '^' marker"
ERROR_FAILED = "  Command failed: parameter is invalid"


# ──────────────────────────────────────────────────────────────────────────
# Fixtures + helpers
# ──────────────────────────────────────────────────────────────────────────


def _make_driver(transport: MockCliTransport | None = None,
                 enable_password: str | None = None) -> ZteDriver:
    if transport is None:
        transport = MockCliTransport()
    return ZteDriver(transport=transport, enable_password=enable_password)


def _wire_status_defaults(t: MockCliTransport) -> None:
    """Pre-load status-related responses + benign defaults for view-entry commands."""
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("exit", "")
    t.set_response("show version", SHOW_VERSION)
    t.set_response("show card", SHOW_CARD)


# ──────────────────────────────────────────────────────────────────────────
# Parser unit tests
# ──────────────────────────────────────────────────────────────────────────


def test_parse_show_card_counts_cards_and_ports() -> None:
    out = _parse_show_card(SHOW_CARD)
    # All four rows share rack=1 → one chassis.
    assert out["chassis_count"] == 1
    assert out["card_count"] == 4
    # 16 + 16 + 0 + 0 = 32 ports
    assert out["port_count"] == 32
    assert [s["slot"] for s in out["slots"]] == [1, 2, 3, 4]
    assert out["slots"][0]["cfg_type"] == "GTGO"


def test_parse_show_card_empty_returns_zeros() -> None:
    out = _parse_show_card("Header only, no rows\n")
    assert out["chassis_count"] == 0
    assert out["card_count"] == 0
    assert out["port_count"] == 0
    assert out["slots"] == []


def test_parse_show_version_extracts_model_and_uptime() -> None:
    out = _parse_show_version(SHOW_VERSION)
    assert out["model"] == "C320"
    assert out["sw_version"] == "V2.1.1.B5"
    # 12d 4h 32m 11s
    assert out["uptime_seconds"] == 12 * 86400 + 4 * 3600 + 32 * 60 + 11


def test_parse_show_version_uptime_missing_is_none() -> None:
    out = _parse_show_version(SHOW_VERSION_NO_UPTIME)
    assert out["uptime_seconds"] is None
    assert out["model"] == "C320"
    assert out["sw_version"] == "V2.1.1.B5"


def test_parse_pon_power_onu_rx() -> None:
    out = _parse_pon_power(SHOW_PON_POWER_ONU_RX)
    assert out["rx_dbm"] == Decimal("-23.45")
    assert out["tx_dbm"] is None


def test_parse_pon_power_onu_tx() -> None:
    out = _parse_pon_power(SHOW_PON_POWER_ONU_TX)
    assert out["rx_dbm"] is None
    assert out["tx_dbm"] == Decimal("2.10")


def test_parse_pon_power_olt_rx_uses_last_value() -> None:
    out = _parse_pon_power(SHOW_PON_POWER_OLT_RX)
    assert out["rx_dbm"] == Decimal("-24.10")
    assert out["tx_dbm"] is None


def test_parse_onu_by_sn_extracts_location() -> None:
    out = _parse_onu_by_sn(SHOW_GPON_ONU_BY_SN)
    assert len(out) == 1
    rec = out[0]
    assert rec["rack"] == 1
    assert rec["slot"] == 2
    assert rec["port"] == 3
    assert rec["onu_index"] == 5
    assert rec["state"] == "AT_WORKING"
    assert rec["onu_type"] == "ZTE-F660"


def test_looks_like_failure_detects_zte_error_tokens() -> None:
    assert _looks_like_failure("  Error: bad slot")
    assert _looks_like_failure("% Error at line 1")
    assert _looks_like_failure("Invalid input detected at '^' marker")
    assert _looks_like_failure("  Command failed: reason X")
    assert _looks_like_failure("  Failure: parameter is invalid")
    assert not _looks_like_failure("OK\n")
    assert not _looks_like_failure("")
    # Benign words shouldn't trip the detector.
    assert not _looks_like_failure("No errors reported")


def test_derive_onu_index_is_deterministic_and_in_range() -> None:
    idx1 = _derive_onu_index("ZTEG12345678")
    idx2 = _derive_onu_index("ZTEG12345678")
    assert idx1 == idx2
    assert 1 <= idx1 <= 128
    assert _derive_onu_index("ZTEG11111111") != _derive_onu_index("ZTEG99999999")


# ──────────────────────────────────────────────────────────────────────────
# Connection lifecycle
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ensure_connected_enters_enable_and_configure_terminal() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv._ensure_connected()
    assert "enable" in t.executed_commands
    assert "configure terminal" in t.executed_commands
    # Second call is a no-op (no extra enable/configure-terminal).
    pre = len(t.executed_commands)
    await drv._ensure_connected()
    assert len(t.executed_commands) == pre


@pytest.mark.asyncio
async def test_ensure_connected_sends_enable_password_when_set() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("MY_ENABLE", "")
    t.set_response("configure terminal", "")
    drv = _make_driver(t, enable_password="MY_ENABLE")
    await drv._ensure_connected()
    # enable, MY_ENABLE, configure terminal in that order
    assert t.executed_commands[:3] == ["enable", "MY_ENABLE", "configure terminal"]


@pytest.mark.asyncio
async def test_close_exits_views_and_is_idempotent() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv._ensure_connected()
    await drv.close()
    # Two `exit`s issued during close.
    assert t.executed_commands.count("exit") >= 2
    # Calling close a second time is fine.
    await drv.close()


@pytest.mark.asyncio
async def test_driver_satisfies_oltdriver_protocol() -> None:
    drv = _make_driver()
    assert isinstance(drv, OltDriver)
    assert drv.vendor == "zte"


# ──────────────────────────────────────────────────────────────────────────
# get_status
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_status_parses_card_and_version() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    status = await drv.get_status()
    assert isinstance(status, OltStatus)
    assert status.reachable is True
    assert status.vendor == "zte"
    assert status.model == "C320"
    assert status.sw_version is not None and "V2.1.1" in status.sw_version
    assert status.chassis_count == 1
    assert status.card_count == 4
    # 16 + 16 + 0 + 0 = 32
    assert status.port_count == 32


@pytest.mark.asyncio
async def test_get_status_records_raw_outputs() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    status = await drv.get_status()
    assert "show_card" in status.raw
    assert "show_version" in status.raw
    assert "GTGO" in status.raw["show_card"]
    assert "ZTE ZXA10" in status.raw["show_version"]


@pytest.mark.asyncio
async def test_get_status_sends_exact_zte_commands() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv.get_status()
    assert "show version" in t.executed_commands
    assert "show card" in t.executed_commands


@pytest.mark.asyncio
async def test_get_status_failure_raises_command_error() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show version", ERROR_INVALID)
    t.set_response("show card", SHOW_CARD)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_status()


# ──────────────────────────────────────────────────────────────────────────
# get_uptime
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_uptime_parses_days_hours_minutes_seconds() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    up = await drv.get_uptime()
    assert isinstance(up, OltUptime)
    expected = 12 * 86400 + 4 * 3600 + 32 * 60 + 11
    assert up.uptime_seconds == expected
    # boot_time within a few seconds of (now - uptime).
    now = datetime.now(timezone.utc)
    delta = abs((now - up.boot_time).total_seconds() - up.uptime_seconds)
    assert delta < 5


@pytest.mark.asyncio
async def test_get_uptime_missing_uptime_raises_command_error() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show version", SHOW_VERSION_NO_UPTIME)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_uptime()


# ──────────────────────────────────────────────────────────────────────────
# provision_onu
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provision_onu_sends_interface_and_pon_mng_commands() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon-olt_", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("pon-onu-mng gpon-onu_", "")
    t.set_prefix_response("service GPON", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    result = await drv.provision_onu(
        serial="ZTEG12345678",
        slot=2,
        port=3,
        line_profile="ZTE-F660",
        vlan_id=100,
        customer_ref="CUST-99",
    )
    assert isinstance(result, OnuProvisionResult)
    assert result.serial == "ZTEG12345678"
    assert result.vlan_id == 100
    assert result.line_profile == "ZTE-F660"
    assert result.onu_id is not None and result.onu_id.isdigit()
    # Interface entry uses ZTE's gpon-olt_<rack>/<slot>/<port> form.
    assert "interface gpon-olt_1/2/3" in t.executed_commands
    # onu <idx> type <profile> sn <serial>
    expected_idx = _derive_onu_index("ZTEG12345678")
    onu_cmds = [c for c in t.executed_commands if c.startswith("onu ")]
    assert len(onu_cmds) == 1
    assert onu_cmds[0] == f"onu {expected_idx} type ZTE-F660 sn ZTEG12345678"
    # pon-onu-mng entry uses the colon form.
    assert f"pon-onu-mng gpon-onu_1/2/3:{expected_idx}" in t.executed_commands
    # Service VLAN binding under that view.
    assert "service GPON gemport 1 vlan 100" in t.executed_commands


@pytest.mark.asyncio
async def test_provision_onu_caches_index_for_later_lookups() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon-olt_", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("pon-onu-mng gpon-onu_", "")
    t.set_prefix_response("service GPON", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    await drv.provision_onu(
        serial="ZTEG99887766",
        slot=4,
        port=7,
        line_profile="ZTE-F601",
        vlan_id=200,
    )
    assert "ZTEG99887766" in drv._onu_index_cache
    slot, port, onu_index = drv._onu_index_cache["ZTEG99887766"]
    assert (slot, port) == (4, 7)
    assert onu_index == _derive_onu_index("ZTEG99887766")


@pytest.mark.asyncio
async def test_provision_onu_onu_add_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon-olt_", "")
    t.set_prefix_response("onu ", ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="ZTEG00000001",
            slot=1, port=1,
            line_profile="ZTE-F660", vlan_id=100,
        )


@pytest.mark.asyncio
async def test_provision_onu_service_vlan_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon-olt_", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("pon-onu-mng gpon-onu_", "")
    t.set_prefix_response("service GPON", ERROR_FAILED)
    t.set_response("exit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="ZTEG11112222",
            slot=1, port=1,
            line_profile="ZTE-F660", vlan_id=100,
        )


# ──────────────────────────────────────────────────────────────────────────
# delete_onu
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_onu_uses_cache_when_available() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("no onu", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    # Seed cache as if a prior provision had happened.
    drv._onu_index_cache["ZTEG12345678"] = (2, 3, 5)
    result = await drv.delete_onu(serial="ZTEG12345678")
    assert isinstance(result, OnuDeleteResult)
    assert result.serial == "ZTEG12345678"
    # Cisco-style negation with full identifier.
    assert "no onu 5 from interface gpon-olt_1/2/3" in t.executed_commands
    # No serial-resolve query needed when cached.
    assert not any(c.startswith("show gpon onu by-sn") for c in t.executed_commands)
    # Cache entry is gone post-delete.
    assert "ZTEG12345678" not in drv._onu_index_cache


@pytest.mark.asyncio
async def test_delete_onu_falls_back_to_by_sn_lookup() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show gpon onu by-sn ZTEG12345678", SHOW_GPON_ONU_BY_SN)
    t.set_prefix_response("no onu", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    await drv.delete_onu(serial="ZTEG12345678")
    assert "show gpon onu by-sn ZTEG12345678" in t.executed_commands
    # Parsed location (slot=2, port=3, onu_index=5) drives the delete.
    assert "no onu 5 from interface gpon-olt_1/2/3" in t.executed_commands


@pytest.mark.asyncio
async def test_delete_onu_unknown_serial_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show gpon onu by-sn UNKNOWN", "  Error: ONU not found")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="UNKNOWN")


@pytest.mark.asyncio
async def test_delete_onu_failure_response_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("no onu", ERROR_INVALID)
    drv = _make_driver(t)
    drv._onu_index_cache["ZTEG12345678"] = (2, 3, 5)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="ZTEG12345678")


# ──────────────────────────────────────────────────────────────────────────
# get_optical_power
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_optical_power_olt_port_rx_only() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response(
        "show pon power olt-rx gpon-olt_1/2/3",
        SHOW_PON_POWER_OLT_RX,
    )
    drv = _make_driver(t)
    # 2/3 (slot/port) → normalized to 1/2/3.
    power = await drv.get_optical_power(target_type="olt_port", target_id="2/3")
    assert isinstance(power, OpticalPower)
    assert power.target_type == "olt_port"
    assert power.target_id == "2/3"
    assert power.rx_dbm == Decimal("-24.10")
    # OLT-side Rx-only — tx_dbm is None.
    assert power.tx_dbm is None


@pytest.mark.asyncio
async def test_get_optical_power_olt_port_full_fsp() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response(
        "show pon power olt-rx gpon-olt_1/2/3",
        SHOW_PON_POWER_OLT_RX,
    )
    drv = _make_driver(t)
    power = await drv.get_optical_power(target_type="olt_port", target_id="1/2/3")
    assert power.rx_dbm == Decimal("-24.10")


@pytest.mark.asyncio
async def test_get_optical_power_onu_resolves_serial_then_queries_both() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response(
        "show pon power onu-rx gpon-onu_1/2/3:5", SHOW_PON_POWER_ONU_RX,
    )
    t.set_response(
        "show pon power onu-tx gpon-onu_1/2/3:5", SHOW_PON_POWER_ONU_TX,
    )
    drv = _make_driver(t)
    # Pre-populate cache so we go straight to the optical queries.
    drv._onu_index_cache["ZTEG12345678"] = (2, 3, 5)
    power = await drv.get_optical_power(target_type="onu", target_id="ZTEG12345678")
    assert power.rx_dbm == Decimal("-23.45")
    assert power.tx_dbm == Decimal("2.10")
    assert "show pon power onu-rx gpon-onu_1/2/3:5" in t.executed_commands
    assert "show pon power onu-tx gpon-onu_1/2/3:5" in t.executed_commands


@pytest.mark.asyncio
async def test_get_optical_power_onu_resolves_via_by_sn() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show gpon onu by-sn ZTEG12345678", SHOW_GPON_ONU_BY_SN)
    t.set_response(
        "show pon power onu-rx gpon-onu_1/2/3:5", SHOW_PON_POWER_ONU_RX,
    )
    t.set_response(
        "show pon power onu-tx gpon-onu_1/2/3:5", SHOW_PON_POWER_ONU_TX,
    )
    drv = _make_driver(t)
    # No cache → triggers by-sn lookup, then both onu-rx and onu-tx.
    power = await drv.get_optical_power(target_type="onu", target_id="ZTEG12345678")
    assert power.rx_dbm == Decimal("-23.45")
    assert power.tx_dbm == Decimal("2.10")
    assert "show gpon onu by-sn ZTEG12345678" in t.executed_commands


@pytest.mark.asyncio
async def test_get_optical_power_olt_port_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show pon power olt-rx gpon-olt_1/9/9", ERROR_INVALID)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_optical_power(target_type="olt_port", target_id="9/9")


# ──────────────────────────────────────────────────────────────────────────
# set_vlan
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_vlan_enters_vlan_and_names_it() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("vlan 100", "")
    t.set_response('name "DATA-VLAN"', "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    result = await drv.set_vlan(slot=2, port=3, vlan_id=100, purpose="data")
    assert isinstance(result, VlanSetResult)
    assert result.vlan_id == 100
    assert result.purpose == "data"
    assert "vlan 100" in t.executed_commands
    assert 'name "DATA-VLAN"' in t.executed_commands


@pytest.mark.asyncio
async def test_set_vlan_purpose_label_uppercased() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("vlan 200", "")
    t.set_response('name "VOIP-VLAN"', "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    await drv.set_vlan(slot=1, port=1, vlan_id=200, purpose="voip")
    assert 'name "VOIP-VLAN"' in t.executed_commands


@pytest.mark.asyncio
async def test_set_vlan_name_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("vlan 100", "")
    t.set_response('name "DATA-VLAN"', ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.set_vlan(slot=2, port=3, vlan_id=100, purpose="data")


# ──────────────────────────────────────────────────────────────────────────
# apply_line_profile
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apply_line_profile_onu_enters_pon_mng_and_sets_profile() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("pon-onu-mng gpon-onu_", "")
    t.set_response("profile RES_100M", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["ZTEG12345678"] = (2, 3, 5)
    result = await drv.apply_line_profile(
        target_type="onu",
        target_id="ZTEG12345678",
        profile_name="RES_100M",
    )
    assert isinstance(result, LineProfileResult)
    assert result.profile_name == "RES_100M"
    assert "pon-onu-mng gpon-onu_1/2/3:5" in t.executed_commands
    assert "profile RES_100M" in t.executed_commands


@pytest.mark.asyncio
async def test_apply_line_profile_olt_port_enters_interface() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon-olt_", "")
    t.set_response("profile BIZ_500M", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    result = await drv.apply_line_profile(
        target_type="olt_port",
        target_id="1/2/3",
        profile_name="BIZ_500M",
    )
    assert result.target_type == "olt_port"
    assert "interface gpon-olt_1/2/3" in t.executed_commands
    assert "profile BIZ_500M" in t.executed_commands


@pytest.mark.asyncio
async def test_apply_line_profile_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("pon-onu-mng gpon-onu_", "")
    t.set_response("profile MISSING", ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["ZTEG12345678"] = (2, 3, 5)
    with pytest.raises(OltCommandError):
        await drv.apply_line_profile(
            target_type="onu",
            target_id="ZTEG12345678",
            profile_name="MISSING",
        )


# ──────────────────────────────────────────────────────────────────────────
# Factory integration (auto-registration at import time)
# ──────────────────────────────────────────────────────────────────────────


def test_factory_lists_zte_after_import() -> None:
    # The package __init__ imports drivers.zte which auto-registers.
    assert "zte" in registered_vendors()


def test_factory_huawei_and_zte_coexist() -> None:
    vendors = registered_vendors()
    assert "huawei" in vendors
    assert "zte" in vendors
    # Mock driver still there too.
    assert "mock" in vendors


@pytest.mark.asyncio
async def test_factory_get_driver_for_olt_zte_returns_zte_driver() -> None:
    record = {
        "vendor": "zte",
        "host": "10.20.0.1",
        "port": 22,
        "credentials": {"username": "admin", "password": "s3cret"},
    }
    drv = await get_driver_for_olt(record)
    try:
        assert isinstance(drv, ZteDriver)
        assert drv.vendor == "zte"
        # And NOT a HuaweiDriver — sanity check the registry routes correctly.
        assert not isinstance(drv, HuaweiDriver)
    finally:
        await drv.close()


def test_factory_zte_instance_satisfies_protocol() -> None:
    drv = ZteDriver(host="10.0.0.1", port=22, credentials={"username": "u"})
    assert isinstance(drv, OltDriver)
    assert drv.vendor == "zte"


# ──────────────────────────────────────────────────────────────────────────
# Expected-fail placeholder — full bidirectional ZTE↔OLT integration is out
# of scope for the skeleton; documented for future lab integration.
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.xfail(reason="Live ZTE C320 integration test — requires hardware; covered post-M1-B")
@pytest.mark.asyncio
async def test_zte_driver_live_round_trip_placeholder() -> None:
    raise AssertionError("Live hardware test stub — not run in CI")
