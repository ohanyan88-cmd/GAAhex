"""M1-B — VsolV1600Driver tests (firmware V1.4.7R, dual-login flow).

The V1600 driver carries its own SSH/PTY session wrapper internally (not a
``CliTransport``), so tests inject a ``FakeV1600Session`` that mimics the
``connect()`` / ``execute()`` / ``close()`` surface and serves canned
running-config output. No real network, no asyncssh required.

Coverage:

* Pure parser unit tests (``parse_running_config``, ``parse_optical_info``).
* ``pull_topology()`` returns the right shape with the right per-port ONU counts.
* ``get_status()`` derives sensible counts from running-config.
* ``get_uptime()`` raises ``OltNotSupportedError`` (firmware lacks the command).
* Factory auto-registration exposes ``'vsol_v1600'`` alongside ``'vsol'`` etc.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.services.olt import OltNotSupportedError, registered_vendors
from app.services.olt.drivers.vsol_v1600 import (
    VsolV1600Driver,
    _looks_like_failure,
    parse_optical_info,
    parse_running_config,
)


# ──────────────────────────────────────────────────────────────────────────
# Canned V1600 outputs
# ──────────────────────────────────────────────────────────────────────────


RUNNING_CONFIG = """\
!
hostname ArmGponOLT2
!
!Software Version      :                V1.4.7R
!Hardware Version      :                V1.0
!
interface gpon 0/1
 no shutdown
 onu add 1 profile default sn VSOL00000001
 onu add 2 profile default sn VSOL00000002
exit
!
interface gpon 0/2
 shutdown
 onu add 1 profile vip sn VSOL00000003
exit
!
interface gpon 0/3
 no shutdown
exit
!
interface vlanif 1
 ip address 10.0.1.3 255.255.255.0
exit
!
end
"""

OPTICAL_INFO = """\
ONU 0/1:1 optical-info:
  Rx Power(dBm) : -23.45
  Tx Power(dBm) :   2.10
  Temperature   : 42 C
"""


# ──────────────────────────────────────────────────────────────────────────
# Pure-parser unit tests
# ──────────────────────────────────────────────────────────────────────────


def test_parse_running_config_extracts_hostname_and_versions() -> None:
    out = parse_running_config(RUNNING_CONFIG)
    assert out["hostname"] == "ArmGponOLT2"
    assert out["sw_version"] == "V1.4.7R"
    assert out["hw_version"] == "V1.0"
    assert out["model"] == "V1600G1-B"


def test_parse_running_config_collects_onus_per_port() -> None:
    out = parse_running_config(RUNNING_CONFIG)
    ports_by_no = {p["port_no"]: p for p in out["ports"]}
    assert set(ports_by_no.keys()) == {1, 2, 3}
    # Port 1: two ONUs, default profile, up.
    assert ports_by_no[1]["status"] == "up"
    serials_1 = sorted(o["serial"] for o in ports_by_no[1]["onus"])
    assert serials_1 == ["VSOL00000001", "VSOL00000002"]
    # Port 2: one ONU, vip profile, admin_down.
    assert ports_by_no[2]["status"] == "admin_down"
    assert ports_by_no[2]["onus"][0]["serial"] == "VSOL00000003"
    assert ports_by_no[2]["onus"][0]["profile"] == "vip"
    # Port 3: no ONUs, up.
    assert ports_by_no[3]["status"] == "up"
    assert ports_by_no[3]["onus"] == []


def test_parse_running_config_ignores_non_gpon_interfaces() -> None:
    """Other interface blocks (vlanif, mgmt, etc.) must not bleed into the GPON map."""
    out = parse_running_config(RUNNING_CONFIG)
    # The `interface vlanif 1` block exists in the fixture; it must not show up.
    assert all(p["type"] == "GPON" for p in out["ports"])
    # And it must not steal lines from the preceding gpon block.
    assert {o["serial"] for o in out["ports"][0]["onus"]} == {
        "VSOL00000001", "VSOL00000002",
    }


def test_parse_optical_info_extracts_rx_and_tx() -> None:
    out = parse_optical_info(OPTICAL_INFO)
    assert out["rx_dbm"] == Decimal("-23.45")
    assert out["tx_dbm"] == Decimal("2.10")


def test_looks_like_failure_detects_v1600_error_tokens() -> None:
    assert _looks_like_failure("% Unknown command")
    assert _looks_like_failure("  % Invalid input detected at '^' marker")
    assert _looks_like_failure("Command failed")
    assert not _looks_like_failure("OK\n")
    assert not _looks_like_failure("")


# ──────────────────────────────────────────────────────────────────────────
# pull_topology + get_status (with a fake session)
# ──────────────────────────────────────────────────────────────────────────


class FakeV1600Session:
    """Mimics _V1600Session for tests: connect/execute/close + canned responses."""

    def __init__(self, *, responses: dict[str, str], hostname: str = "ArmGponOLT2"):
        self._responses = responses
        self.hostname = hostname
        self.executed: list[str] = []
        self.connected = False
        self.closed = False

    async def connect(self) -> None:
        self.connected = True

    async def execute(self, command: str) -> str:
        if not self.connected:
            raise AssertionError("execute before connect")
        self.executed.append(command)
        if command in self._responses:
            return self._responses[command]
        # Benign default for view-entry commands ("configure terminal" / "exit" / etc.).
        return ""

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_pull_topology_returns_structured_dict() -> None:
    session = FakeV1600Session(responses={"show running-config": RUNNING_CONFIG})
    drv = VsolV1600Driver(session=session)
    topo = await drv.pull_topology()
    assert topo["hostname"] == "ArmGponOLT2"
    assert topo["sw_version"] == "V1.4.7R"
    assert {p["port_no"] for p in topo["ports"]} == {1, 2, 3}
    # Port 1 has two ONUs.
    p1 = next(p for p in topo["ports"] if p["port_no"] == 1)
    assert len(p1["onus"]) == 2
    # Driver actually sent the command we expect.
    assert "show running-config" in session.executed


@pytest.mark.asyncio
async def test_get_status_derives_counts_from_running_config() -> None:
    session = FakeV1600Session(responses={"show running-config": RUNNING_CONFIG})
    drv = VsolV1600Driver(session=session)
    status = await drv.get_status()
    assert status.reachable is True
    assert status.vendor == "vsol_v1600"
    assert status.model == "V1600G1-B"
    assert status.sw_version == "V1.4.7R"
    assert status.chassis_count == 1
    assert status.card_count == 1
    assert status.port_count == 3


@pytest.mark.asyncio
async def test_get_uptime_raises_not_supported() -> None:
    session = FakeV1600Session(responses={})
    drv = VsolV1600Driver(session=session)
    with pytest.raises(OltNotSupportedError):
        await drv.get_uptime()


@pytest.mark.asyncio
async def test_close_disposes_owned_session_only_once() -> None:
    session = FakeV1600Session(responses={"show running-config": RUNNING_CONFIG})
    # session= injected → driver does NOT own it, so close() should not propagate.
    drv = VsolV1600Driver(session=session)
    await drv.pull_topology()
    await drv.close()
    # Owned-session path: build internally → close propagates. We can't fully
    # exercise that without asyncssh, but we can assert ``close()`` is idempotent.
    assert session.closed is False
    await drv.close()  # second call is a no-op


# ──────────────────────────────────────────────────────────────────────────
# Factory auto-registration
# ──────────────────────────────────────────────────────────────────────────


def test_factory_registers_vsol_v1600_alongside_other_vendors() -> None:
    vendors = set(registered_vendors())
    # Must include the new V1600 key plus the existing ones.
    assert "vsol_v1600" in vendors
    assert {"huawei", "zte", "vsol", "mock"}.issubset(vendors)
