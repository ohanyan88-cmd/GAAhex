"""M1-B Phase 1 — MockOltDriver.

A fully working in-memory OLT simulator. Sufficient to drive end-to-end development of
the install board (Stage 11 ACTIVATED) and the NOC dashboard before any real Huawei
or ZTE hardware exists.

Style notes
===========
* Mirrors the deterministic ``hash → scale`` approach used by ``SimulatedDiagnosticAdapter``
  (see ``backend/app/services/diagnostic_adapter.py``) so optical readings are stable
  across test runs and across processes.
* In-memory ONU registry is **per instance**, not class-level — each MockOltDriver is its
  own OLT. Two factories spawning two MockOltDrivers for two different Records should not
  bleed state into each other.
* No database access. No external I/O. ``close()`` is idempotent.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

from .driver import (
    LineProfileResult,
    OltStatus,
    OltUptime,
    OnuDeleteResult,
    OnuProvisionResult,
    OpticalPower,
    VlanSetResult,
)
from .exceptions import OltCommandError


# ──────────────────────────────────────────────────────────────────────────
# Deterministic helpers (mirrors SimulatedDiagnosticAdapter._hash_int / _scale)
# ──────────────────────────────────────────────────────────────────────────


def _hash_int(*parts: str) -> int:
    """Deterministic non-negative int derived from concatenated parts."""
    h = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big", signed=False)


def _scale(seed: int, lo: float, hi: float, *, decimals: int = 2) -> Decimal:
    """Map a non-negative int into [lo, hi) with the requested decimal precision."""
    span = hi - lo
    fraction = (seed % 100_000) / 100_000.0
    val = lo + (span * fraction)
    return Decimal(str(round(val, decimals)))


# ──────────────────────────────────────────────────────────────────────────
# MockOltDriver
# ──────────────────────────────────────────────────────────────────────────


class MockOltDriver:
    """Vendor-agnostic OLT driver — mock implementation.

    Behavior summary
    ----------------
    * ``get_status`` always returns ``reachable=True`` with realistic mock counts.
    * ``get_uptime`` reports ~30 days uptime from a fixed instance ``_boot_time``.
    * ``provision_onu`` registers a serial; raises :class:`OltCommandError` on duplicate.
    * ``delete_onu`` removes a serial; raises :class:`OltCommandError` if not found.
    * ``get_optical_power`` returns deterministic Rx in ``[-30.0, -15.0]`` and Tx in
      ``[0.0, 3.0]`` — same ``target_id`` always yields the same values.
    * ``set_vlan`` + ``apply_line_profile`` always succeed (mock ignores hardware constraints).
    * ``close()`` is a no-op + idempotent.

    The constructor accepts ``host`` / ``port`` / ``credentials`` so the factory wiring is
    testable, but the mock does not use them for any actual I/O.
    """

    vendor: str = "mock"

    def __init__(
        self,
        *,
        host: str,
        port: int = 0,
        credentials: dict | None = None,
        olt_record_id: str | None = None,
    ) -> None:
        self._host = host
        self._port = port
        self._credentials = dict(credentials) if credentials else {}
        self._olt_record_id = olt_record_id
        # serial → {slot, port, vlan_id, line_profile, customer_ref, provisioned_at}
        self._onus: dict[str, dict] = {}
        # vlan map: (slot, port) → {vlan_id, purpose, applied_at}
        self._vlans: dict[tuple[int, int], dict] = {}
        # profile map: (target_type, target_id) → {profile_name, applied_at}
        self._profiles: dict[tuple[str, str], dict] = {}
        self._boot_time: datetime = datetime.now(timezone.utc) - timedelta(days=30)
        self._closed: bool = False

    # ------------------------------------------------------------------ status

    async def get_status(self) -> OltStatus:
        return OltStatus(
            reachable=True,
            vendor=self.vendor,
            model="MockOLT-9600",
            sw_version="mock-1.0.0",
            chassis_count=1,
            card_count=4,
            port_count=64,
            last_seen_at=datetime.now(timezone.utc),
            raw={
                "host": self._host,
                "port": self._port,
                "provisioned_onus": len(self._onus),
            },
        )

    async def get_uptime(self) -> OltUptime:
        now = datetime.now(timezone.utc)
        uptime = int((now - self._boot_time).total_seconds())
        return OltUptime(
            uptime_seconds=uptime,
            boot_time=self._boot_time,
            raw={"host": self._host},
        )

    # -------------------------------------------------------------------- ONU

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
        if serial in self._onus:
            raise OltCommandError(
                f"ONU with serial {serial!r} is already provisioned on this OLT"
            )
        now = datetime.now(timezone.utc)
        onu_id = f"mock-onu-{_hash_int(serial) % 100_000:05d}"
        record = {
            "slot": slot,
            "port": port,
            "vlan_id": vlan_id,
            "line_profile": line_profile,
            "customer_ref": customer_ref,
            "onu_id": onu_id,
            "provisioned_at": now,
        }
        self._onus[serial] = record
        return OnuProvisionResult(
            serial=serial,
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            line_profile=line_profile,
            onu_id=onu_id,
            provisioned_at=now,
            raw={"customer_ref": customer_ref, "host": self._host},
        )

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        if serial not in self._onus:
            raise OltCommandError(
                f"ONU with serial {serial!r} is not provisioned on this OLT"
            )
        prev = self._onus.pop(serial)
        now = datetime.now(timezone.utc)
        return OnuDeleteResult(
            serial=serial,
            deleted_at=now,
            raw={"previous": {
                "slot": prev["slot"], "port": prev["port"],
                "vlan_id": prev["vlan_id"], "line_profile": prev["line_profile"],
            }},
        )

    # --------------------------------------------------------- optical power

    async def get_optical_power(
        self,
        *,
        target_type: Literal['olt_port', 'onu'],
        target_id: str,
    ) -> OpticalPower:
        # Deterministic — same target always yields the same Rx/Tx.
        seed_rx = _hash_int(target_type, target_id, "rx")
        rx = _scale(seed_rx, -30.0, -15.0, decimals=2)
        # ONUs report TX too in this mock (real ones may not — the Protocol allows None).
        seed_tx = _hash_int(target_type, target_id, "tx")
        tx: Decimal | None = _scale(seed_tx, 0.0, 3.0, decimals=2)
        return OpticalPower(
            target_type=target_type,
            target_id=target_id,
            rx_dbm=rx,
            tx_dbm=tx,
            sampled_at=datetime.now(timezone.utc),
            raw={"host": self._host},
        )

    # ------------------------------------------------------------------- VLAN

    async def set_vlan(
        self,
        *,
        slot: int,
        port: int,
        vlan_id: int,
        purpose: str,
    ) -> VlanSetResult:
        now = datetime.now(timezone.utc)
        self._vlans[(slot, port)] = {
            "vlan_id": vlan_id,
            "purpose": purpose,
            "applied_at": now,
        }
        return VlanSetResult(
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            purpose=purpose,
            applied_at=now,
            raw={"host": self._host},
        )

    # --------------------------------------------------------- line profile

    async def apply_line_profile(
        self,
        *,
        target_type: Literal['olt_port', 'onu'],
        target_id: str,
        profile_name: str,
    ) -> LineProfileResult:
        now = datetime.now(timezone.utc)
        self._profiles[(target_type, target_id)] = {
            "profile_name": profile_name,
            "applied_at": now,
        }
        return LineProfileResult(
            target_type=target_type,
            target_id=target_id,
            profile_name=profile_name,
            applied_at=now,
            raw={"host": self._host},
        )

    # ------------------------------------------------------------------ close

    async def close(self) -> None:
        # Idempotent — calling twice is fine.
        self._closed = True
