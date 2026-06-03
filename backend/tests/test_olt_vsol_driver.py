"""M1-B Phase 5 — VsolDriver tests (VSOL V1600 / V2724 / V3608).

All driver tests use ``MockCliTransport`` with realistic VSOL CLI output as
canned responses — the driver never touches real network. Tests verify:

* Connection lifecycle (enable / configure-terminal view, idempotent close,
  enable-password injection).
* Each of the 7 OltDriver commands issues the right VSOL CLI string AND parses
  realistic responses correctly.
* Error paths surface ``OltCommandError`` on VSOL's ``ERROR:`` / ``% Invalid``
  / ``failed`` lines.
* Factory auto-registration at module import time exposes ``'vsol'``, and
  ``'huawei'`` + ``'zte'`` + ``'vsol'`` coexist in the registry.
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
from app.services.olt.drivers.vsol import (
    VsolDriver,
    _derive_onu_index,
    _looks_like_failure,
    _parse_show_card,
    _parse_show_onu_info,
    _parse_show_optical,
    _parse_show_version,
)
from app.services.olt.transport import MockCliTransport


# ──────────────────────────────────────────────────────────────────────────
# Canned VSOL CLI outputs (realistic V1600/V2724/V3608 syntax)
# ──────────────────────────────────────────────────────────────────────────


SHOW_VERSION = """\
V-SOL World Technology, OLT Software
Product: V2724G
Software Version: V2.0.4
Hardware Version: V1.0
Compiled: Sep 14 2023 12:08:42
Uptime: 12 days, 04:32:11
"""

SHOW_VERSION_NO_UPTIME = """\
V-SOL World Technology, OLT Software
Product: V2724G
Software Version: V2.0.4
Hardware Version: V1.0
Compiled: Sep 14 2023 12:08:42
"""

SHOW_CARD = """\
SlotID  CardType  PortNum  HardVer  SoftVer    Status
-----------------------------------------------------------
1       GPFA      8        V1.0     V2.0.4     ACTIVE
2       GPFA      8        V1.0     V2.0.4     ACTIVE
3       SCUA      0        V1.0     V2.0.4     STANDBY
-----------------------------------------------------------
"""

SHOW_ONU_BY_SN = """\
ONU SN-Lookup:
  ONU Location : 0/2/3:5
  ONU Type     : V-SOL-HG323A
  Status       : ONLINE
  Distance     : 1240 m
"""

SHOW_PON_OPTICAL = """\
PON Port 0/2/3 Optical Information
  RX Power(dBm) : -24.10
  Bias Current : 12 mA
"""

SHOW_ONU_OPTICAL = """\
ONU 0/2/3:5 Optical Information
  RX Power(dBm) : -23.45
  TX Power(dBm) :   2.10
  Temperature  : 42 C
"""

# VSOL error tokens — used by failure tests.
ERROR_INVALID = "  ERROR: % Invalid input detected at '^' marker"
ERROR_FAILED = "  Command failed: parameter is invalid"


# ──────────────────────────────────────────────────────────────────────────
# Fixtures + helpers
# ──────────────────────────────────────────────────────────────────────────


def _make_driver(transport: MockCliTransport | None = None,
                 enable_password: str | None = None) -> VsolDriver:
    if transport is None:
        transport = MockCliTransport()
    return VsolDriver(transport=transport, enable_password=enable_password)


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
    # Three rows present, one chassis (single-frame VSOL OLT).
    assert out["chassis_count"] == 1
    assert out["card_count"] == 3
    # 8 + 8 + 0 = 16 ports
    assert out["port_count"] == 16
    assert [s["slot"] for s in out["slots"]] == [1, 2, 3]
    assert out["slots"][0]["card_type"] == "GPFA"


def test_parse_show_card_empty_returns_zeros() -> None:
    out = _parse_show_card("Header only, no rows\n")
    assert out["chassis_count"] == 0
    assert out["card_count"] == 0
    assert out["port_count"] == 0
    assert out["slots"] == []


def test_parse_show_version_extracts_model_and_uptime() -> None:
    out = _parse_show_version(SHOW_VERSION)
    assert out["model"] == "V2724G"
    assert out["sw_version"] == "V2.0.4"
    # 12d 4h 32m 11s
    assert out["uptime_seconds"] == 12 * 86400 + 4 * 3600 + 32 * 60 + 11


def test_parse_show_version_uptime_missing_is_none() -> None:
    out = _parse_show_version(SHOW_VERSION_NO_UPTIME)
    assert out["uptime_seconds"] is None
    assert out["model"] == "V2724G"
    assert out["sw_version"] == "V2.0.4"


def test_parse_show_optical_olt_port_rx_only() -> None:
    out = _parse_show_optical(SHOW_PON_OPTICAL)
    assert out["rx_dbm"] == Decimal("-24.10")
    assert out["tx_dbm"] is None


def test_parse_show_optical_onu_rx_and_tx() -> None:
    out = _parse_show_optical(SHOW_ONU_OPTICAL)
    assert out["rx_dbm"] == Decimal("-23.45")
    assert out["tx_dbm"] == Decimal("2.10")


def test_parse_show_onu_info_extracts_location() -> None:
    out = _parse_show_onu_info(SHOW_ONU_BY_SN)
    assert len(out) == 1
    rec = out[0]
    assert rec["frame"] == 0
    assert rec["slot"] == 2
    assert rec["port"] == 3
    assert rec["onu_index"] == 5
    assert rec["state"] == "ONLINE"
    assert rec["onu_type"] == "V-SOL-HG323A"


def test_looks_like_failure_detects_vsol_error_tokens() -> None:
    assert _looks_like_failure("  ERROR: bad slot")
    assert _looks_like_failure("% Invalid input detected at '^' marker")
    assert _looks_like_failure("  Bad command: not recognized")
    assert _looks_like_failure("  Command failed: reason X")
    assert _looks_like_failure("  Failure: parameter is invalid")
    assert not _looks_like_failure("OK\n")
    assert not _looks_like_failure("")
    # Benign words shouldn't trip the detector.
    assert not _looks_like_failure("No errors reported")


def test_derive_onu_index_is_deterministic_and_in_range() -> None:
    idx1 = _derive_onu_index("VSOL12345678")
    idx2 = _derive_onu_index("VSOL12345678")
    assert idx1 == idx2
    assert 1 <= idx1 <= 128
    assert _derive_onu_index("VSOL11111111") != _derive_onu_index("VSOL99999999")


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
    assert drv.vendor == "vsol"


@pytest.mark.asyncio
async def test_build_transport_without_host_raises() -> None:
    drv = VsolDriver()  # no host, no transport
    with pytest.raises(Exception):
        # Either OltConnectionError from _build_transport or downstream.
        await drv._ensure_connected()


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
    assert status.vendor == "vsol"
    assert status.model == "V2724G"
    assert status.sw_version == "V2.0.4"
    assert status.chassis_count == 1
    assert status.card_count == 3
    # 8 + 8 + 0 = 16
    assert status.port_count == 16


@pytest.mark.asyncio
async def test_get_status_records_raw_outputs() -> None:
    t = MockCliTransport()
    _wire_status_defaults(t)
    drv = _make_driver(t)
    status = await drv.get_status()
    assert "show_card" in status.raw
    assert "show_version" in status.raw
    assert "GPFA" in status.raw["show_card"]
    assert "V-SOL" in status.raw["show_version"]


@pytest.mark.asyncio
async def test_get_status_sends_exact_vsol_commands() -> None:
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
async def test_provision_onu_sends_interface_and_onu_view_commands() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu add", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("service-port", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    result = await drv.provision_onu(
        serial="VSOL12345678",
        slot=2,
        port=3,
        line_profile="HSI_100M",
        vlan_id=100,
        customer_ref="CUST-99",
    )
    assert isinstance(result, OnuProvisionResult)
    assert result.serial == "VSOL12345678"
    assert result.vlan_id == 100
    assert result.line_profile == "HSI_100M"
    assert result.onu_id is not None and result.onu_id.isdigit()
    expected_idx = _derive_onu_index("VSOL12345678")
    # Interface entry uses the VSOL 0/slot/port form.
    assert "interface gpon 0/2/3" in t.executed_commands
    # onu add <idx> sn <serial> profile <profile> description "<desc>"
    add_cmds = [c for c in t.executed_commands if c.startswith("onu add")]
    assert len(add_cmds) == 1
    assert add_cmds[0] == (
        f'onu add {expected_idx} sn VSOL12345678 profile HSI_100M description "CUST-99"'
    )
    # Per-ONU sub-view entry.
    assert f"onu {expected_idx}" in t.executed_commands
    # Service-port bind under that view.
    assert "service-port 1 gemport 1 vlan 100" in t.executed_commands


@pytest.mark.asyncio
async def test_provision_onu_caches_index_for_later_lookups() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu add", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("service-port", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    await drv.provision_onu(
        serial="VSOL99887766",
        slot=4,
        port=7,
        line_profile="HSI_500M",
        vlan_id=200,
    )
    assert "VSOL99887766" in drv._onu_index_cache
    slot, port, onu_index = drv._onu_index_cache["VSOL99887766"]
    assert (slot, port) == (4, 7)
    assert onu_index == _derive_onu_index("VSOL99887766")


@pytest.mark.asyncio
async def test_provision_onu_onu_add_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu add", ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="VSOL00000001",
            slot=1, port=1,
            line_profile="HSI_100M", vlan_id=100,
        )


@pytest.mark.asyncio
async def test_provision_onu_service_port_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu add", "")
    t.set_prefix_response("onu ", "")
    t.set_prefix_response("service-port", ERROR_FAILED)
    t.set_response("exit", "")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.provision_onu(
            serial="VSOL11112222",
            slot=1, port=1,
            line_profile="HSI_100M", vlan_id=100,
        )


# ──────────────────────────────────────────────────────────────────────────
# delete_onu
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_onu_uses_cache_when_available() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu remove", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    # Seed cache as if a prior provision had happened.
    drv._onu_index_cache["VSOL12345678"] = (2, 3, 5)
    result = await drv.delete_onu(serial="VSOL12345678")
    assert isinstance(result, OnuDeleteResult)
    assert result.serial == "VSOL12345678"
    # Interface-view entry then "onu remove <idx>".
    assert "interface gpon 0/2/3" in t.executed_commands
    assert "onu remove 5" in t.executed_commands
    # No serial-resolve query needed when cached.
    assert not any(c.startswith("show onu info by-sn") for c in t.executed_commands)
    # Cache entry is gone post-delete.
    assert "VSOL12345678" not in drv._onu_index_cache


@pytest.mark.asyncio
async def test_delete_onu_falls_back_to_by_sn_lookup() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show onu info by-sn VSOL12345678", SHOW_ONU_BY_SN)
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu remove", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    await drv.delete_onu(serial="VSOL12345678")
    assert "show onu info by-sn VSOL12345678" in t.executed_commands
    # Parsed location (slot=2, port=3, onu_index=5) drives the delete.
    assert "interface gpon 0/2/3" in t.executed_commands
    assert "onu remove 5" in t.executed_commands


@pytest.mark.asyncio
async def test_delete_onu_unknown_serial_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show onu info by-sn UNKNOWN", "  ERROR: ONU not found")
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="UNKNOWN")


@pytest.mark.asyncio
async def test_delete_onu_failure_response_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu remove", ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["VSOL12345678"] = (2, 3, 5)
    with pytest.raises(OltCommandError):
        await drv.delete_onu(serial="VSOL12345678")


# ──────────────────────────────────────────────────────────────────────────
# get_optical_power
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_optical_power_olt_port_rx_only() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show pon optical-info 0/2/3", SHOW_PON_OPTICAL)
    drv = _make_driver(t)
    # 2/3 → normalized to 0/2/3.
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
    t.set_response("show pon optical-info 0/2/3", SHOW_PON_OPTICAL)
    drv = _make_driver(t)
    power = await drv.get_optical_power(target_type="olt_port", target_id="0/2/3")
    assert power.rx_dbm == Decimal("-24.10")


@pytest.mark.asyncio
async def test_get_optical_power_onu_resolves_serial_and_returns_both() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show onu optical-info 0/2/3 5", SHOW_ONU_OPTICAL)
    drv = _make_driver(t)
    # Pre-populate cache so we go straight to the optical query.
    drv._onu_index_cache["VSOL12345678"] = (2, 3, 5)
    power = await drv.get_optical_power(target_type="onu", target_id="VSOL12345678")
    assert power.rx_dbm == Decimal("-23.45")
    assert power.tx_dbm == Decimal("2.10")
    assert "show onu optical-info 0/2/3 5" in t.executed_commands


@pytest.mark.asyncio
async def test_get_optical_power_onu_resolves_via_by_sn() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show onu info by-sn VSOL12345678", SHOW_ONU_BY_SN)
    t.set_response("show onu optical-info 0/2/3 5", SHOW_ONU_OPTICAL)
    drv = _make_driver(t)
    # No cache → triggers by-sn lookup, then optical query.
    power = await drv.get_optical_power(target_type="onu", target_id="VSOL12345678")
    assert power.rx_dbm == Decimal("-23.45")
    assert power.tx_dbm == Decimal("2.10")
    assert "show onu info by-sn VSOL12345678" in t.executed_commands


@pytest.mark.asyncio
async def test_get_optical_power_olt_port_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("show pon optical-info 0/9/9", ERROR_INVALID)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.get_optical_power(target_type="olt_port", target_id="9/9")


# ──────────────────────────────────────────────────────────────────────────
# set_vlan
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_set_vlan_enters_vlan_database_and_binds_port() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("vlan database", "")
    t.set_response("vlan 100", "")
    t.set_response("exit", "")
    t.set_response("port vlan add 100 interface gpon 0/2/3", "")
    drv = _make_driver(t)
    result = await drv.set_vlan(slot=2, port=3, vlan_id=100, purpose="data")
    assert isinstance(result, VlanSetResult)
    assert result.vlan_id == 100
    assert result.purpose == "data"
    assert "vlan database" in t.executed_commands
    assert "vlan 100" in t.executed_commands
    assert "port vlan add 100 interface gpon 0/2/3" in t.executed_commands


@pytest.mark.asyncio
async def test_set_vlan_bind_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_response("vlan database", "")
    t.set_response("vlan 100", "")
    t.set_response("exit", "")
    t.set_response("port vlan add 100 interface gpon 0/2/3", ERROR_INVALID)
    drv = _make_driver(t)
    with pytest.raises(OltCommandError):
        await drv.set_vlan(slot=2, port=3, vlan_id=100, purpose="data")


# ──────────────────────────────────────────────────────────────────────────
# apply_line_profile
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_apply_line_profile_onu_enters_onu_view_and_binds_profile() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu ", "")
    t.set_response("service-profile bind RES_100M", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["VSOL12345678"] = (2, 3, 5)
    result = await drv.apply_line_profile(
        target_type="onu",
        target_id="VSOL12345678",
        profile_name="RES_100M",
    )
    assert isinstance(result, LineProfileResult)
    assert result.profile_name == "RES_100M"
    assert "interface gpon 0/2/3" in t.executed_commands
    assert "onu 5" in t.executed_commands
    assert "service-profile bind RES_100M" in t.executed_commands


@pytest.mark.asyncio
async def test_apply_line_profile_olt_port_enters_interface_and_sets_profile() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_response("profile-line BIZ_500M", "")
    t.set_response("exit", "")
    drv = _make_driver(t)
    result = await drv.apply_line_profile(
        target_type="olt_port",
        target_id="0/2/3",
        profile_name="BIZ_500M",
    )
    assert result.target_type == "olt_port"
    assert "interface gpon 0/2/3" in t.executed_commands
    assert "profile-line BIZ_500M" in t.executed_commands


@pytest.mark.asyncio
async def test_apply_line_profile_failure_raises() -> None:
    t = MockCliTransport()
    t.set_response("enable", "")
    t.set_response("configure terminal", "")
    t.set_prefix_response("interface gpon 0/", "")
    t.set_prefix_response("onu ", "")
    t.set_response("service-profile bind MISSING", ERROR_INVALID)
    t.set_response("exit", "")
    drv = _make_driver(t)
    drv._onu_index_cache["VSOL12345678"] = (2, 3, 5)
    with pytest.raises(OltCommandError):
        await drv.apply_line_profile(
            target_type="onu",
            target_id="VSOL12345678",
            profile_name="MISSING",
        )


# ──────────────────────────────────────────────────────────────────────────
# Factory integration (auto-registration at import time)
# ──────────────────────────────────────────────────────────────────────────


def test_factory_lists_vsol_after_import() -> None:
    # The package __init__ imports drivers.vsol which auto-registers.
    assert "vsol" in registered_vendors()


def test_factory_huawei_zte_vsol_coexist() -> None:
    vendors = registered_vendors()
    assert "huawei" in vendors
    assert "zte" in vendors
    assert "vsol" in vendors
    # Mock driver still there too.
    assert "mock" in vendors


@pytest.mark.asyncio
async def test_factory_get_driver_for_olt_vsol_returns_vsol_driver() -> None:
    record = {
        "vendor": "vsol",
        "host": "10.30.0.1",
        "port": 22,
        "credentials": {"username": "admin", "password": "s3cret"},
    }
    drv = await get_driver_for_olt(record)
    try:
        assert isinstance(drv, VsolDriver)
        assert drv.vendor == "vsol"
        # And NOT a HuaweiDriver / ZteDriver — sanity check the registry routes correctly.
        assert not isinstance(drv, HuaweiDriver)
        assert not isinstance(drv, ZteDriver)
    finally:
        await drv.close()


def test_factory_vsol_instance_satisfies_protocol() -> None:
    drv = VsolDriver(host="10.0.0.1", port=22, credentials={"username": "u"})
    assert isinstance(drv, OltDriver)
    assert drv.vendor == "vsol"


# ──────────────────────────────────────────────────────────────────────────
# Expected-fail placeholder — full bidirectional VSOL↔OLT integration is out
# of scope for the skeleton; documented for future lab integration.
# ──────────────────────────────────────────────────────────────────────────


@pytest.mark.xfail(reason="Live VSOL V2724G integration test — requires hardware; covered post-M1-B")
@pytest.mark.asyncio
async def test_vsol_driver_live_round_trip_placeholder() -> None:
    raise AssertionError("Live hardware test stub — not run in CI")
