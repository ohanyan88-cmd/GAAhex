"""M1-B Phase 1 — Vendor-agnostic OLT driver Protocol + return-type dataclasses.

Design intent
=============

* **Protocol, not ABC.** Concrete vendors (Huawei, ZTE) get duck-typed — no inheritance
  coupling. ``@runtime_checkable`` so the service layer can ``isinstance(drv, OltDriver)``.
* **Universal-only surface (7 commands).** Vendor-specific niceties live on the concrete
  class but stay off this Protocol so callers can swap vendors without code edits.
* **Dataclasses, not TypedDict.** We can add fields later without breaking pattern matches.
* **Frozen + ``raw`` escape hatch.** Result objects are immutable; vendor-specific extras
  ride along in ``raw`` (opaque ``dict``) so the service layer can persist them in
  ServiceActionLog without the Protocol growing per-vendor.
* **Driver returns structured results; SERVICE layer writes the DB.** Drivers do not
  import anything from ``app.models``. Period.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal, Protocol, runtime_checkable


# ──────────────────────────────────────────────────────────────────────────
# Return types — frozen dataclasses so callers can pattern-match safely
# ──────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class OltStatus:
    """Basic health snapshot for an OLT chassis stack."""

    reachable: bool
    vendor: str             # 'huawei' | 'zte' | 'mock' | ...
    model: str | None
    sw_version: str | None
    chassis_count: int      # how many chassis are present
    card_count: int
    port_count: int
    last_seen_at: datetime  # when this status was sampled
    raw: dict = field(default_factory=dict)  # vendor-specific extras, opaque to caller


@dataclass(frozen=True)
class OltUptime:
    """How long the OLT has been running."""

    uptime_seconds: int
    boot_time: datetime
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class OnuProvisionResult:
    """Outcome of registering a new ONU."""

    serial: str
    slot: int
    port: int
    vlan_id: int
    line_profile: str
    onu_id: str | None  # vendor-assigned ID (some OLTs auto-assign)
    provisioned_at: datetime
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class OnuDeleteResult:
    """Outcome of removing an ONU from the OLT."""

    serial: str
    deleted_at: datetime
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class OpticalPower:
    """A single optical-power reading from an OLT port or an ONU."""

    target_type: Literal['olt_port', 'onu']
    target_id: str
    rx_dbm: Decimal
    tx_dbm: Decimal | None  # ONUs may not report TX
    sampled_at: datetime
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class VlanSetResult:
    """Outcome of configuring a VLAN on a port."""

    slot: int
    port: int
    vlan_id: int
    purpose: str  # 'data' | 'voip' | 'iptv' | 'mgmt'
    applied_at: datetime
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class LineProfileResult:
    """Outcome of applying a service line-profile to a port or an ONU."""

    target_type: Literal['olt_port', 'onu']
    target_id: str
    profile_name: str
    applied_at: datetime
    raw: dict = field(default_factory=dict)


# ──────────────────────────────────────────────────────────────────────────
# Driver Protocol — concrete vendors implement these 7 methods + close()
# ──────────────────────────────────────────────────────────────────────────


@runtime_checkable
class OltDriver(Protocol):
    """Vendor-agnostic OLT driver. All methods async, all I/O-bound.

    Concrete implementations (MockOltDriver, HuaweiDriver, ZteDriver) communicate with
    the hardware and return structured results. They MUST NOT touch the database — the
    service layer (caller) is responsible for persisting ServiceActionLog,
    OpticalPowerSample, etc.

    On failure, raise one of:
    * :class:`~.exceptions.OltConnectionError` — couldn't reach OLT
    * :class:`~.exceptions.OltCommandError`    — OLT responded but rejected the command
    * :class:`~.exceptions.OltCredentialsError`— auth failed
    * :class:`~.exceptions.OltTimeoutError`    — operation took too long
    * :class:`~.exceptions.OltNotSupportedError` — command not supported on this hardware
    """

    vendor: str  # set by concrete drivers, used by service layer for routing/logging

    async def get_status(self) -> OltStatus:
        """Basic health check. Returns chassis/card/port counts + last_seen_at."""
        ...

    async def get_uptime(self) -> OltUptime:
        """Returns uptime_seconds + boot_time."""
        ...

    async def provision_onu(
        self,
        *,
        serial: str,
        slot: int,
        port: int,
        line_profile: str,
        vlan_id: int,
        customer_ref: str | None = None,
    ) -> OnuProvisionResult:
        """Register a new ONU on a specific slot/port with a line profile + VLAN."""
        ...

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        """Remove an ONU from the OLT."""
        ...

    async def get_optical_power(
        self,
        *,
        target_type: Literal['olt_port', 'onu'],
        target_id: str,
    ) -> OpticalPower:
        """Read Rx/Tx power.

        ``target_id`` is the slot/port string for ``target_type='olt_port'`` (e.g.
        ``'0/1/0'``) or the ONU serial for ``target_type='onu'``.
        """
        ...

    async def set_vlan(
        self,
        *,
        slot: int,
        port: int,
        vlan_id: int,
        purpose: str,
    ) -> VlanSetResult:
        """Configure a VLAN on a port. ``purpose`` in ``{data, voip, iptv, mgmt}``."""
        ...

    async def apply_line_profile(
        self,
        *,
        target_type: Literal['olt_port', 'onu'],
        target_id: str,
        profile_name: str,
    ) -> LineProfileResult:
        """Apply a service line profile to a port or an ONU."""
        ...

    async def close(self) -> None:
        """Release any held connections. Idempotent."""
        ...
