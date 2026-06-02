"""M1-B Phase 3 — HuaweiDriver tests (MA5800 / MA5600T families).

All driver tests use ``MockCliTransport`` with realistic Huawei CLI output as
canned responses — the driver never touches real network. Tests verify:

* Connection lifecycle (enable/config view, idempotent close, enable-password).
* Each of the 7 OltDriver commands issues the right Huawei CLI string AND
  parses realistic responses correctly.
* Error paths surface ``OltCommandError`` on Huawei's ``Failure``/``Error`` lines.
* Factory auto-registration at module import time exposes ``'huawei'``.
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
    get_driver_for_olt,
    registered_vendors,
)
from app.services.olt.drivers.huawei import (
    _derive_onu_index,
    _looks_like_failure,
    _parse_display_board,
    _parse_display_version,
    _parse_ont_info,
    _parse_optical_info,
)
from app.services.olt.transport import MockCliTransport


# ──────────────────────────────────────────────────────────────────────────
# Canned Huawei CLI outputs (realistic MA5800 syntax)
# ──────────────────────────────────────────────────────────────────────────


DISPLAY_BOARD = """\
  -------------------------------------------------------------------------
  SlotID  BoardName  Status         SubType0 SubType1 Online/Offline
  -------------------------------------------------------------------------
  0       H805GPFD   Normal         GPON     -        Online
  1       H802SCUN   Active_normal  -        -        Online
  2       H801GICK   Normal         GE       -        Online
  -------------------------------------------------------------------------
"""

DISPLAY_VERSION = """\
  VERSION   :  MA5800-X17 V100R019C10
  PATCH     :  SPC100
  BUILD     :  Sep 14 2022 10:32:21
  Uptime is 45 days, 3 hours, 12 minutes
"""

DISPLAY_VERSION_NO_UPTIME = """\
  VERSION   :  MA5800-X17 V100R019C10
  PATCH     :  SPC100
  BUILD     :  Sep 14 2022 10:32:21
"""

DISPLAY_ONT_OPTICAL_INFO = """\
  ----------------------------------------------------------------------------
  F/S/P                       : 0/1/0
  ONT-ID                      : 1
  Rx optical power(dBm)       : -22.50
  Tx optical power(dBm)       :  2.30
  ONT Voltage (V)             :  3.31
  ONT Temperature (C)         :  42
  Laser Bias Current(mA)      :  10
  ----------------------------------------------------------------------------
"""

DISPLAY_PORT_OPTICAL_INFO = """\
  ----------------------------------------------------------------------------
  F/S/P                       : 0/1/0
  Rx optical power(dBm)       : -25.10
  Tx optical power(dBm)       :  4.10
  ----------------------------------------------------------------------------
"""

DISPLAY_ONT_OPTICAL_INFO_RX_ONLY = """\
  ----------------------------------------------------------------------------
  F/S/P                       : 0/1/0
  ONT-ID                      : 5
  Rx optical power(dBm)       : -18.75
  ----------------------------------------------------------------------------
"""

DISPLAY_ONT_INFO_SINGLE = """\
  F/S/P                  : 0/1/0
  ONT-ID                 : 7
  SN                     : HWTC12345678
  Control flag           : active
  Run state              : online
  Match state            : match
"""

DISPLAY_LINE_PROFILES = """\
  Profile-ID  Profile-Name             Binding-times
  10          100M_RESIDENTIAL         128
  11          500M_BUSINESS            32
  12          1G_PREMIUM               4
"""

FAILURE_RESPONSE = "  Failure: parameter is invalid"


# ──────────────────────────────────────────────────────────────────────────
# Fixtures + helpers
# ──────────────────────────────────────────────────────────────────────────


def _make_driver(transport: MockCliTransport | None = None,
                 enable_password: str | None = None) -> HuaweiDriver:
    if transport is None:
        transport = MockCliTransport()
    return HuaweiDriver(transport=transport, enable_password=enable_password)


def _wire_status_defaults(t: MockCliTransport) -> None:
    """Pre-load status-related responses + benign defaults for view-entry commands."""
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("quit", "")
    t.set_response("display board 0", DISPLAY_BOARD)
    t.set_response("display version", DISPLAY_VERSION)


# ──────────────────────────────────────────────────────────────────────────
# Parser unit tests
# ──────────────────────────────────────────────────────────────────────────


def test_parse_display_board_counts_cards_and_ports() -> None:
    out = _parse_display_board(DISPLAY_BOARD)
    assert out["chassis_count"] == 1
    assert out["card_count"] == 3
    # One H805GPFD card → 8 GPON ports; the other two cards have 0.
    assert out["port_count"] == 8
    assert [s["slot"] for s in out["slots"]] == [0, 1, 2]
    assert out["slots"][0]["board"] == "H805GPFD"


def test_parse_display_board_empty_returns_zeros() -> None:
    out = _parse_display_board("no rows here\n")
    assert out["chassis_count"] == 0
    assert out["card_count"] == 0
    assert out["port_count"] == 0
    assert out["slots"] == []


def test_parse_display_version_extracts_model_and_uptime() -> None:
    out = _parse_display_version(DISPLAY_VERSION)
    assert out["model"] == "MA5800-X17"
    assert out["sw_version"] == "V100R019C10"
    # 45d 3h 12m → 45*86400 + 3*3600 + 12*60
    assert out["uptime_seconds"] == 45 * 86400 + 3 * 3600 + 12 * 60


def test_parse_display_version_uptime_missing_is_none() -> None:
    out = _parse_display_version(DISPLAY_VERSION_NO_UPTIME)
    assert out["uptime_seconds"] is None
    assert out["model"] == "MA5800-X17"


def test_parse_optical_info_decimal_values() -> None:
    out = _parse_optical_info(DISPLAY_ONT_OPTICAL_INFO)
    assert out["rx_dbm"] == Decimal("-22.50")
    assert out["tx_dbm"] == Decimal("2.30")


def test_parse_optical_info_rx_only_returns_none_tx() -> None:
    out = _parse_optical_info(DISPLAY_ONT_OPTICAL_INFO_RX_ONLY)
    assert out["rx_dbm"] == Decimal("-18.75")
    assert out["tx_dbm"] is None


def test_parse_ont_info_extracts_serial_and_index() -> None:
    out = _parse_ont_info(DISPLAY_ONT_INFO_SINGLE)
    assert len(out) == 1
    rec = out[0]
    assert rec["onu_index"] == 7
    assert rec["serial"] == "HWTC12345678"
    assert rec["run_state"] == "online"
    assert rec["frame"] == 0
    assert rec["slot"] == 1
    assert rec["port"] == 0


def test_looks_like_failure_detects_huawei_error_tokens() -> None:
    assert _looks_like_failure("  Failure: bad slot")
    assert _looks_like_failure("Error: not allowed")
    assert _looks_like_failure("command failed for reason X")
    assert not _looks_like_failure("OK\n")
    assert not _looks_like_failure("")


def test_derive_onu_index_is_deterministic_and_in_range() -> None:
    idx1 = _derive_onu_index("HWTC12345678")
    idx2 = _derive_onu_index("HWTC12345678")
    assert idx1 == idx2
    assert 1 <= idx1 <= 128
    # Different serials usually produce different indexes (not a strict guarantee
    # but the spread should be obvious here).
    assert _derive_onu_index("HWTC11111111") != _derive_onu_index("HWTC99999999")


# ──────────────────────────────────────────────────────────────────────────
# Connection lifecycle
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ensure_connected_enters_enable_and_config() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv._ensure_connected()
    assert "enable" in t.executed_commands
    assert "config" in t.executed_commands
    # Second call is a no-op (no extra enable/config).
    pre = len(t.executed_commands)
    await drv._ensure_connected()
    assert len(t.executed_commands) == pre


@pytest.mark.asyncio
async def test_ensure_connected_sends_enable_password_when_set() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("MY_PASS", "")
    t.set_response("config", "")
    drv = _make_driver(t, enable_password="MY_PASS")
    await drv._ensure_connected()
    # enable, MY_PASS, config in that order
    assert t.executed_commands[:3] == ["enable", "MY_PASS", "config"]


@pytest.mark.asyncio
async def test_close_quits_views_and_is_idempotent() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv._ensure_connected()
    await drv.close()
    # Two quits issued during close.
    assert t.executed_commands.count("quit") >= 2
    # Calling close a second time is fine.
    await drv.close()


@pytest.mark.asyncio
async def test_driver_satisfies_oltdriver_protocol() -> None:
    drv = _make_driver()
    assert isinstance(drv, OltDriver)
    assert drv.vendor == "huawei"


# ──────────────────────────────────────────────────────────────────────────
# get_status
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_status_parses_board_and_version() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    status = await drv.get_status()
    assert isinstance(status, OltStatus)
    assert status.reachable is True
    assert status.vendor == "huawei"
    assert status.model == "MA5800-X17"
    assert status.sw_version == "V100R019C10"
    assert status.chassis_count == 1
    assert status.card_count == 3
    assert status.port_count == 8


@pytest.mark.asyncio
async def test_get_status_records_raw_outputs() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    status = await drv.get_status()
    assert "display_board" in status.raw
    assert "display_version" in status.raw
    assert "H805GPFD" in status.raw["display_board"]
    assert "MA5800-X17" in status.raw["display_version"]


@pytest.mark.asyncio
async def test_get_status_sends_exact_huawei_commands() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    await drv.get_status()
    assert "display board 0" in t.executed_commands
    assert "display version" in t.executed_commands


# ──────────────────────────────────────────────────────────────────────────
# get_uptime
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_uptime_parses_days_hours_minutes() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    up = await drv.get_uptime()
    assert isinstance(up, OltUptime)
    assert up.uptime_seconds == 45 * 86400 + 3 * 3600 + 12 * 60
    # boot_time within a few seconds of (now - uptime).
    now = datetime.now(timezone.utc)
    delta = abs((now - up.boot_time).total_seconds() - up.uptime_seconds)
    assert delta < 5


@pytest.mark.asyncio
async def test_get_uptime_missing_uptime_raises_command_error() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display version", DISPLAY_VERSION_NO_UPTIME)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_uptime()


# ──────────────────────────────────────────────────────────────────────────
# provision_onu
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_provision_onu_sends_ont_add_and_service_port() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont add", "  Success")
    t.set_prefix_response("service-port vlan", "  service-port 12 created")
    t.set_response("quit", "")
    drv = _make_driver(t)
    result = await drv.provision_onu(
        serial="HWTC12345678",
        slot=1,
        port=0,
        line_profile="10",
        vlan_id=100,
        customer_ref="CUST-42",
    )
    assert isinstance(result, OnuProvisionResult)
    assert result.serial == "HWTC12345678"
    assert result.vlan_id == 100
    assert result.line_profile == "10"
    assert result.onu_id is not None and result.onu_id.isdigit()
    # Verify the wire-level commands the driver chose.
    ont_add_cmds = [c for c in t.executed_commands if c.startswith("ont add")]
    assert len(ont_add_cmds) == 1
    expected_idx = _derive_onu_index("HWTC12345678")
    assert f"ont add 0 {expected_idx}" in ont_add_cmds[0]
    assert 'sn-auth "HWTC12345678"' in ont_add_cmds[0]
    assert "ont-lineprofile-id 10" in ont_add_cmds[0]
    assert 'desc "CUST-42"' in ont_add_cmds[0]
    svc_cmds = [c for c in t.executed_commands if c.startswith("service-port vlan")]
    assert len(svc_cmds) == 1
    assert "vlan 100" in svc_cmds[0]


@pytest.mark.asyncio
async def test_provision_onu_caches_index_for_later_lookups() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont add", "  Success")
    t.set_prefix_response("service-port vlan", "")
    t.set_response("quit", "")
    drv = _make_driver(t)
    await drv.provision_onu(
        serial="HWTC99887766",
        slot=2,
        port=3,
        line_profile="11",
        vlan_id=200,
    )
    assert "HWTC99887766" in drv._onu_index_cache
    slot, port, onu_index = drv._onu_index_cache["HWTC99887766"]
    assert (slot, port) == (2, 3)
    assert onu_index == _derive_onu_index("HWTC99887766")


@pytest.mark.asyncio
async def test_provision_onu_defaults_desc_to_serial_when_no_customer_ref() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont add", "")
    t.set_prefix_response("service-port vlan", "")
    t.set_response("quit", "")
    drv = _make_driver(t)
    await drv.provision_onu(
        serial="HWTC55555555",
        slot=0, port=2,
        line_profile="10",
        vlan_id=50,
    )
    ont_add = next(c for c in t.executed_commands if c.startswith("ont add"))
    assert 'desc "HWTC55555555"' in ont_add


@pytest.mark.asyncio
async def test_provision_onu_failure_response_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont add", FAILURE_RESPONSE)
    t.set_response("quit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="HWTC00000001",
            slot=0, port=0,
            line_profile="10", vlan_id=100,
        )


@pytest.mark.asyncio
async def test_provision_onu_service_port_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont add", "  Success")
    t.set_prefix_response("service-port vlan", FAILURE_RESPONSE)
    t.set_response("quit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="HWTC11112222",
            slot=0, port=0,
            line_profile="10", vlan_id=100,
        )


# ──────────────────────────────────────────────────────────────────────────
# delete_onu
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_onu_uses_cache_when_available() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont delete", "  Success")
    t.set_response("quit", "")
    drv = _make_driver(t)
    # Seed cache as if a prior provision had happened.
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    result = await drv.delete_onu(serial="HWTC12345678")
    assert isinstance(result, OnuDeleteResult)
    assert result.serial == "HWTC12345678"
    assert "ont delete 0 7" in t.executed_commands
    # No display-by-sn query needed when cached.
    assert not any(c.startswith("display ont info by-sn") for c in t.executed_commands)
    # Cache entry is gone post-delete.
    assert "HWTC12345678" not in drv._onu_index_cache


@pytest.mark.asyncio
async def test_delete_onu_falls_back_to_display_by_sn() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont delete", "  Success")
    t.set_response("display ont info by-sn HWTC12345678", DISPLAY_ONT_INFO_SINGLE)
    t.set_response("quit", "")
    drv = _make_driver(t)
    await drv.delete_onu(serial="HWTC12345678")
    assert "display ont info by-sn HWTC12345678" in t.executed_commands
    # The parsed location (slot=1, port=0, onu_index=7) drives the delete.
    assert "ont delete 0 7" in t.executed_commands


@pytest.mark.asyncio
async def test_delete_onu_unknown_serial_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display ont info by-sn UNKNOWN", "  Failure: ONT not found")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="UNKNOWN")


@pytest.mark.asyncio
async def test_delete_onu_failure_response_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont delete", FAILURE_RESPONSE)
    t.set_response("quit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="HWTC12345678")


# ──────────────────────────────────────────────────────────────────────────
# get_optical_power
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_optical_power_olt_port() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display port optical-info 0/1/0", DISPLAY_PORT_OPTICAL_INFO)
    drv = _make_driver(t)
    power = await drv.get_optical_power(target_type="olt_port", target_id="0/1/0")
    assert isinstance(power, OpticalPower)
    assert power.target_type == "olt_port"
    assert power.target_id == "0/1/0"
    assert power.rx_dbm == Decimal("-25.10")
    assert power.tx_dbm == Decimal("4.10")


@pytest.mark.asyncio
async def test_get_optical_power_onu_resolves_serial_then_queries() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display ont optical-info 0/1/0 7", DISPLAY_ONT_OPTICAL_INFO)
    drv = _make_driver(t)
    # Pre-populate cache so we go straight to the optical query.
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    power = await drv.get_optical_power(target_type="onu", target_id="HWTC12345678")
    assert power.rx_dbm == Decimal("-22.50")
    assert power.tx_dbm == Decimal("2.30")
    assert "display ont optical-info 0/1/0 7" in t.executed_commands


@pytest.mark.asyncio
async def test_get_optical_power_handles_rx_only() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display ont optical-info 0/1/0 5", DISPLAY_ONT_OPTICAL_INFO_RX_ONLY)
    drv = _make_driver(t)
    drv._onu_index_cache["HWTC99999999"] = (1, 0, 5)
    power = await drv.get_optical_power(target_type="onu", target_id="HWTC99999999")
    assert power.rx_dbm == Decimal("-18.75")
    assert power.tx_dbm is None


@pytest.mark.asyncio
async def test_get_optical_power_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display port optical-info 9/9/9", FAILURE_RESPONSE)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_optical_power(target_type="olt_port", target_id="9/9/9")


# ──────────────────────────────────────────────────────────────────────────
# set_vlan
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_vlan_creates_vlan_and_binds_port() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("vlan 100 smart", "")
    t.set_response("port vlan 100 0/1 0", "")
    drv = _make_driver(t)
    result = await drv.set_vlan(slot=1, port=0, vlan_id=100, purpose="data")
    assert isinstance(result, VlanSetResult)
    assert result.vlan_id == 100
    assert result.purpose == "data"
    assert "vlan 100 smart" in t.executed_commands
    assert "port vlan 100 0/1 0" in t.executed_commands


@pytest.mark.asyncio
async def test_set_vlan_bind_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("vlan 100 smart", "")
    t.set_response("port vlan 100 0/1 0", FAILURE_RESPONSE)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.set_vlan(slot=1, port=0, vlan_id=100, purpose="data")


# ──────────────────────────────────────────────────────────────────────────
# apply_line_profile
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apply_line_profile_onu_with_named_profile_lookup() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response(
        "display ont-lineprofile profile-id all",
        DISPLAY_LINE_PROFILES,
    )
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont modify", "  Success")
    t.set_response("quit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    result = await drv.apply_line_profile(
        target_type="onu",
        target_id="HWTC12345678",
        profile_name="500M_BUSINESS",
    )
    assert isinstance(result, LineProfileResult)
    assert result.profile_name == "500M_BUSINESS"
    # Profile ID 11 was resolved from the table.
    mod_cmd = next(c for c in t.executed_commands if c.startswith("ont modify"))
    assert "ont-lineprofile-id 11" in mod_cmd
    # The modify happened inside the right gpon interface.
    assert "interface gpon 0/1" in t.executed_commands


@pytest.mark.asyncio
async def test_apply_line_profile_numeric_profile_skips_lookup() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_prefix_response("interface gpon", "")
    t.set_prefix_response("ont modify", "  Success")
    t.set_response("quit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    await drv.apply_line_profile(
        target_type="onu", target_id="HWTC12345678", profile_name="12",
    )
    # No lookup table query was issued.
    assert not any(
        c.startswith("display ont-lineprofile") for c in t.executed_commands
    )
    mod_cmd = next(c for c in t.executed_commands if c.startswith("ont modify"))
    assert "ont-lineprofile-id 12" in mod_cmd


@pytest.mark.asyncio
async def test_apply_line_profile_unknown_named_profile_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("config", "")
    t.set_response("display ont-lineprofile profile-id all", DISPLAY_LINE_PROFILES)
    drv = _make_driver(t)
    drv._onu_index_cache["HWTC12345678"] = (1, 0, 7)
    with pytest.raises(OltCommandError):
        await drv.apply_line_profile(
            target_type="onu",
            target_id="HWTC12345678",
            profile_name="NO_SUCH_PROFILE",
        )


# ──────────────────────────────────────────────────────────────────────────
# Factory integration (auto-registration at import time)
# ──────────────────────────────────────────────────────────────────────────


def test_factory_lists_huawei_after_import() -> None:
    # The package __init__ imports drivers.huawei which auto-registers.
    assert "huawei" in registered_vendors()


@pytest.mark.asyncio
async def test_factory_get_driver_for_olt_huawei_returns_huawei_driver() -> None:
    record = {
        "vendor": "huawei",
        "host": "10.10.0.1",
        "port": 22,
        "credentials": {"username": "admin", "password": "s3cret"},
    }
    drv = await get_driver_for_olt(record)
    try:
        assert isinstance(drv, HuaweiDriver)
        assert drv.vendor == "huawei"
    finally:
        # The driver lazily builds a transport; close() is idempotent and
        # tolerates an un-built transport.
        await drv.close()


def test_factory_huawei_instance_satisfies_protocol() -> None:
    drv = HuaweiDriver(host="10.0.0.1", port=22, credentials={"username": "u"})
    assert isinstance(drv, OltDriver)
    assert drv.vendor == "huawei"


# ──────────────────────────────────────────────────────────────────────────
# Expected-fail placeholder — full bidirectional Huawei↔OLT integration is out
# of scope for the skeleton; documented so the M1-B.4 ZTE work can mirror it.
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.xfail(reason="Live Huawei MA5800 integration test — requires hardware; covered post-M1-B")
@pytest.mark.asyncio
async def test_huawei_driver_live_round_trip_placeholder() -> None:
    raise AssertionError("Live hardware test stub — not run in CI")
