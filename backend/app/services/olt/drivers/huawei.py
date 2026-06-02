"""M1-B Phase 3 — Huawei MA5800 / MA5600T OLT driver.

Implements the :class:`~app.services.olt.driver.OltDriver` Protocol for Huawei's
two most-deployed OLT families using realistic Huawei CLI syntax. The driver is
parser-first: every command output is run through a ``_parse_*`` helper so the
service layer always gets structured results (the raw text rides along under
``raw`` for diagnostics + ServiceActionLog).

Design notes
============

* **Transport via DI.** Accepts any :class:`~app.services.olt.transport.CliTransport`
  via the ``transport=`` kwarg. In tests pass a ``MockCliTransport`` with canned
  responses; in production the factory constructs an ``AsyncSshCliTransport``
  from the decrypted credentials.
* **Factory wiring — Option A.** The constructor ALSO accepts the factory's
  positional kwargs (``host``, ``port``, ``credentials``, ``olt_record_id``) so
  the existing ``get_driver_for_olt`` does not need a special hook. When the
  factory hands those in (no ``transport=``), the driver lazily builds an
  ``AsyncSshCliTransport`` on the first ``_ensure_connected`` call.
* **View management.** Huawei CLI has a system-view → config-view hierarchy.
  ``_ensure_connected`` enters ``enable`` + ``config`` once. Per-command helpers
  enter/leave ``interface gpon`` sub-views as needed and always ``quit`` back
  to ``config`` view so subsequent commands have a known starting state.
* **No DB, no models.** Driver returns dataclasses; service layer persists.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Literal

from ..driver import (
    LineProfileResult,
    OltStatus,
    OltUptime,
    OnuDeleteResult,
    OnuProvisionResult,
    OpticalPower,
    VlanSetResult,
)
from ..exceptions import OltCommandError, OltConnectionError
from ..transport import CliTransport


# ──────────────────────────────────────────────────────────────────────────
# Parser helpers — pure functions, no I/O. Take raw CLI text → structured dict.
# ──────────────────────────────────────────────────────────────────────────


_BOARD_ROW_RE = re.compile(
    r"^\s*(\d+)\s+(H\w+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$",
    re.MULTILINE,
)


def _parse_display_board(text: str) -> dict:
    """Parse ``display board 0`` output.

    Huawei's table layout:

        SlotID  BoardName  Status         SubType0  SubType1  Online/Offline
        0       H805GPFD   Normal         GPON      -         Online
        1       H802SCUN   Active_normal  -         -         Online
        ...

    Returns ``{chassis_count, card_count, port_count, slots: [{slot, board, status, subtype, online}, ...]}``.
    ``port_count`` is derived from board names — H8xxGPFD has 8 GPON ports per card by Huawei
    convention; H80x non-GPON cards contribute 0 user-facing PON ports. Good enough for
    chassis-summary purposes.
    """
    slots: list[dict] = []
    for m in _BOARD_ROW_RE.finditer(text):
        slot_id, board, status, sub0, _sub1, online = m.groups()
        slots.append({
            "slot": int(slot_id),
            "board": board,
            "status": status,
            "subtype": sub0,
            "online": online,
        })
    # chassis count: every Huawei OLT we care about is 1 chassis unless the
    # board listing announces multiple frames — we count distinct frame prefixes,
    # but for the realistic outputs we'll see, treat anything with rows as 1.
    chassis_count = 1 if slots else 0
    card_count = len(slots)
    # Port count: GPON service cards have 8 or 16 PON ports depending on model.
    # H805GPFD / H807GPFD = 8 ports, H808GPFD / H809GPFD = 16. Default 8 when
    # we can't tell.
    port_count = 0
    for s in slots:
        b = s["board"]
        if "GPFD" not in b:
            continue
        if b.startswith(("H808", "H809")):
            port_count += 16
        else:
            port_count += 8
    return {
        "chassis_count": chassis_count,
        "card_count": card_count,
        "port_count": port_count,
        "slots": slots,
    }


_VERSION_MODEL_RE = re.compile(r"VERSION\s*:\s*(\S+)\s+(V\S+)", re.IGNORECASE)
_UPTIME_RE = re.compile(
    r"Uptime\s+is\s+"
    r"(?:(\d+)\s*days?)?[,\s]*"
    r"(?:(\d+)\s*hours?)?[,\s]*"
    r"(?:(\d+)\s*minutes?)?",
    re.IGNORECASE,
)


def _parse_display_version(text: str) -> dict:
    """Parse ``display version`` output.

    Returns ``{model, sw_version, uptime_seconds}``. Any field that can't be
    located is ``None`` (caller decides whether to error).
    """
    model: str | None = None
    sw_version: str | None = None
    m = _VERSION_MODEL_RE.search(text)
    if m:
        model = m.group(1)
        sw_version = m.group(2)
    uptime_seconds: int | None = None
    u = _UPTIME_RE.search(text)
    if u and any(u.groups()):
        days = int(u.group(1) or 0)
        hours = int(u.group(2) or 0)
        minutes = int(u.group(3) or 0)
        uptime_seconds = days * 86_400 + hours * 3_600 + minutes * 60
    return {
        "model": model,
        "sw_version": sw_version,
        "uptime_seconds": uptime_seconds,
    }


_RX_POWER_RE = re.compile(r"Rx\s+optical\s+power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)", re.IGNORECASE)
_TX_POWER_RE = re.compile(r"Tx\s+optical\s+power\(dBm\)\s*:\s*(-?\d+(?:\.\d+)?)", re.IGNORECASE)


def _parse_optical_info(text: str) -> dict:
    """Parse Huawei optical-info output. Returns ``{rx_dbm, tx_dbm}`` with
    Decimal values (or ``None`` if a field is absent — some platforms only
    report Rx for ONUs)."""
    rx = None
    tx = None
    m = _RX_POWER_RE.search(text)
    if m:
        rx = Decimal(m.group(1))
    m = _TX_POWER_RE.search(text)
    if m:
        tx = Decimal(m.group(1))
    return {"rx_dbm": rx, "tx_dbm": tx}


_ONT_ID_RE = re.compile(r"ONT[-\s]*ID\s*:\s*(\d+)", re.IGNORECASE)
_ONT_SN_RE = re.compile(r"\bSN\s*:\s*([A-Z0-9]+)", re.IGNORECASE)
_ONT_RUN_STATE_RE = re.compile(r"Run\s*state\s*:\s*(\S+)", re.IGNORECASE)
_ONT_FSP_RE = re.compile(r"F/S/P\s*:\s*(\d+)/(\d+)/(\d+)", re.IGNORECASE)


def _parse_ont_info(text: str) -> list[dict]:
    """Parse one or more ONU records out of ``display ont info`` output.

    Returns a list of dicts ``{onu_index, serial, run_state, frame, slot, port}``.
    Missing fields are ``None``. Multiple ONUs in one buffer are split on the
    ``ONT-ID :`` boundary.
    """
    # Some Huawei outputs put the F/S/P line BEFORE the ONT-ID line for a
    # single-ONU record. Pre-scan for the first F/S/P that lacks a preceding
    # ONT-ID in the same chunk, and use it as the implicit context for the
    # first ONU we find.
    parts = re.split(r"(?=ONT[-\s]*ID\s*:)", text, flags=re.IGNORECASE)
    leading_fsp: tuple[int, int, int] | None = None
    if parts:
        fsp = _ONT_FSP_RE.search(parts[0])
        if fsp and _ONT_ID_RE.search(parts[0]) is None:
            leading_fsp = (int(fsp.group(1)), int(fsp.group(2)), int(fsp.group(3)))
    out: list[dict] = []
    for i, block in enumerate(parts):
        if "ONT" not in block.upper():
            continue
        idm = _ONT_ID_RE.search(block)
        if not idm:
            continue
        record: dict = {"onu_index": int(idm.group(1))}
        snm = _ONT_SN_RE.search(block)
        record["serial"] = snm.group(1) if snm else None
        rsm = _ONT_RUN_STATE_RE.search(block)
        record["run_state"] = rsm.group(1) if rsm else None
        fsp = _ONT_FSP_RE.search(block)
        if fsp:
            record["frame"] = int(fsp.group(1))
            record["slot"] = int(fsp.group(2))
            record["port"] = int(fsp.group(3))
        elif leading_fsp is not None and not out:
            # First record inherits the leading F/S/P context.
            record["frame"], record["slot"], record["port"] = leading_fsp
        else:
            record["frame"] = record["slot"] = record["port"] = None
        out.append(record)
    return out


def _looks_like_failure(text: str) -> bool:
    """Huawei sprinkles ``Failure``, ``Error`` and ``failed`` into CLI output on rejection."""
    if not text:
        return False
    lowered = text.lower()
    return any(token in lowered for token in ("failure", "failed", " error", "error:"))


def _derive_onu_index(serial: str) -> int:
    """Deterministic onu_index in [1, 128] derived from the serial.

    Huawei expects an integer ONT-ID within a PON port's allowed range (typically
    1..128 on MA5800). For the skeleton we hash the serial to a stable value; in
    production the service layer (or a future ``display ont info free-index`` query)
    will choose the real next-free slot. Documented as such.
    """
    # Sum of byte values gives us deterministic, dependable spread.
    n = sum(serial.encode("utf-8")) if serial else 1
    return (n % 128) + 1


# ──────────────────────────────────────────────────────────────────────────
# HuaweiDriver
# ──────────────────────────────────────────────────────────────────────────


class HuaweiDriver:
    """Concrete OLT driver for Huawei MA5800 / MA5600T platforms.

    Accepts any :class:`CliTransport` (real ``AsyncSshCliTransport`` in prod,
    ``MockCliTransport`` in tests) via dependency injection. All commands use
    realistic Huawei MA5800 CLI syntax.
    """

    vendor: str = "huawei"

    def __init__(
        self,
        *,
        transport: CliTransport | None = None,
        # Factory-compatible kwargs (Option A). When transport is None, the
        # driver lazily builds an AsyncSshCliTransport from these on first connect.
        host: str | None = None,
        port: int | None = None,
        credentials: dict | None = None,
        olt_record_id: str | None = None,
        enable_password: str | None = None,
    ) -> None:
        self._transport: CliTransport | None = transport
        self._host = host
        self._port = port or 22
        self._credentials = dict(credentials) if credentials else {}
        self._olt_record_id = olt_record_id
        # enable_password may also live in credentials under that key
        self._enable_password = enable_password or self._credentials.get("enable_password")
        self._connected = False
        self._closed = False
        # serial → (slot, port, onu_index) so delete_onu / optical-info don't
        # have to re-query the OLT for every operation.
        self._onu_index_cache: dict[str, tuple[int, int, int]] = {}

    # ------------------------------------------------------------------ wiring

    def _build_transport(self) -> CliTransport:
        """Lazy-construct an AsyncSshCliTransport from the factory's credentials."""
        from ..transport import AsyncSshCliTransport

        if not self._host:
            raise OltConnectionError(
                "HuaweiDriver: cannot build transport — no host configured and no transport injected"
            )
        username = self._credentials.get("username")
        password = self._credentials.get("password")
        ssh_key = self._credentials.get("ssh_key")
        return AsyncSshCliTransport(
            host=self._host,
            port=self._port or 22,
            username=username or "",
            password=password,
            ssh_key=ssh_key,
            enable_password=self._enable_password,
        )

    async def _ensure_connected(self) -> None:
        if self._connected:
            return
        if self._transport is None:
            self._transport = self._build_transport()
        await self._transport.connect()
        # Enter privileged + config view. Huawei flow: enable → (optional password) → config.
        await self._transport.execute("enable")
        if self._enable_password:
            await self._transport.execute(self._enable_password)
        await self._transport.execute("config")
        self._connected = True

    async def close(self) -> None:
        if self._connected and self._transport is not None:
            # Quit out of config view + system view. Swallow per-quit failures —
            # we're tearing down anyway.
            try:
                await self._transport.execute("quit")
            except Exception:  # noqa: BLE001
                pass
            try:
                await self._transport.execute("quit")
            except Exception:  # noqa: BLE001
                pass
            self._connected = False
        if self._transport is not None and not self._closed:
            try:
                await self._transport.close()
            except Exception:  # noqa: BLE001
                pass
        self._closed = True

    # ------------------------------------------------------------------ status

    async def get_status(self) -> OltStatus:
        await self._ensure_connected()
        assert self._transport is not None
        board_text = await self._transport.execute("display board 0")
        version_text = await self._transport.execute("display version")
        if _looks_like_failure(board_text) or _looks_like_failure(version_text):
            raise OltCommandError(
                "Huawei refused status query — check user privilege level"
            )
        board = _parse_display_board(board_text)
        ver = _parse_display_version(version_text)
        return OltStatus(
            reachable=True,
            vendor=self.vendor,
            model=ver["model"],
            sw_version=ver["sw_version"],
            chassis_count=board["chassis_count"],
            card_count=board["card_count"],
            port_count=board["port_count"],
            last_seen_at=datetime.now(timezone.utc),
            raw={
                "display_board": board_text,
                "display_version": version_text,
                "slots": board["slots"],
            },
        )

    # ------------------------------------------------------------------ uptime

    async def get_uptime(self) -> OltUptime:
        await self._ensure_connected()
        assert self._transport is not None
        version_text = await self._transport.execute("display version")
        ver = _parse_display_version(version_text)
        uptime_seconds = ver.get("uptime_seconds")
        if uptime_seconds is None:
            raise OltCommandError(
                "Huawei display version did not report an Uptime line — cannot derive uptime"
            )
        now = datetime.now(timezone.utc)
        boot = now - timedelta(seconds=uptime_seconds)
        return OltUptime(
            uptime_seconds=uptime_seconds,
            boot_time=boot,
            raw={"display_version": version_text},
        )

    # --------------------------------------------------------------- provision

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
        await self._ensure_connected()
        assert self._transport is not None
        onu_index = _derive_onu_index(serial)
        # Huawei's profile lookup happens by ID — when the caller supplies a
        # numeric profile_name we treat it as the ID, otherwise default to ID 10
        # which is the convention M1-A blueprints follow. (apply_line_profile
        # has the full lookup path.)
        try:
            profile_id = int(line_profile)
        except (TypeError, ValueError):
            profile_id = 10
        desc = customer_ref or serial
        # Enter the GPON interface for this slot/frame, issue ont add, quit.
        await self._transport.execute(f"interface gpon 0/{slot}")
        add_cmd = (
            f'ont add {port} {onu_index} sn-auth "{serial}" omci '
            f'ont-lineprofile-id {profile_id} ont-srvprofile-id {profile_id} '
            f'desc "{desc}"'
        )
        add_output = await self._transport.execute(add_cmd)
        await self._transport.execute("quit")
        if _looks_like_failure(add_output):
            raise OltCommandError(
                f"Huawei ont add failed for serial {serial!r}: {add_output.strip()}"
            )
        # VLAN binding for the new ONU.
        svc_cmd = (
            f"service-port vlan {vlan_id} gpon 0/{slot}/{port} "
            f"ont {onu_index} gemport 1 multi-service user-vlan {vlan_id}"
        )
        svc_output = await self._transport.execute(svc_cmd)
        if _looks_like_failure(svc_output):
            raise OltCommandError(
                f"Huawei service-port bind failed for serial {serial!r}: {svc_output.strip()}"
            )
        # Cache for delete / optical lookups.
        self._onu_index_cache[serial] = (slot, port, onu_index)
        now = datetime.now(timezone.utc)
        return OnuProvisionResult(
            serial=serial,
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            line_profile=line_profile,
            onu_id=str(onu_index),
            provisioned_at=now,
            raw={
                "ont_add": add_output,
                "service_port": svc_output,
                "customer_ref": customer_ref,
            },
        )

    # ------------------------------------------------------------------ delete

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        await self._ensure_connected()
        assert self._transport is not None
        loc = await self._resolve_onu_location(serial)
        slot, port, onu_index = loc
        await self._transport.execute(f"interface gpon 0/{slot}")
        delete_output = await self._transport.execute(f"ont delete {port} {onu_index}")
        await self._transport.execute("quit")
        if _looks_like_failure(delete_output):
            raise OltCommandError(
                f"Huawei ont delete failed for serial {serial!r}: {delete_output.strip()}"
            )
        # Drop the cache entry so a re-provision starts clean.
        self._onu_index_cache.pop(serial, None)
        return OnuDeleteResult(
            serial=serial,
            deleted_at=datetime.now(timezone.utc),
            raw={"ont_delete": delete_output, "location": {"slot": slot, "port": port, "onu_index": onu_index}},
        )

    async def _resolve_onu_location(self, serial: str) -> tuple[int, int, int]:
        """Return ``(slot, port, onu_index)`` for an ONU serial.

        Hits the cache first; falls back to ``display ont info by-sn`` which on
        Huawei takes the form ``display ont info by-sn <SN>``.
        """
        cached = self._onu_index_cache.get(serial)
        if cached:
            return cached
        assert self._transport is not None
        text = await self._transport.execute(f"display ont info by-sn {serial}")
        if _looks_like_failure(text):
            raise OltCommandError(
                f"Huawei could not find ONU with serial {serial!r}: {text.strip()}"
            )
        records = _parse_ont_info(text)
        if not records:
            raise OltCommandError(
                f"Huawei did not return any ONU records for serial {serial!r}"
            )
        rec = records[0]
        slot = rec.get("slot")
        port = rec.get("port")
        idx = rec.get("onu_index")
        if slot is None or port is None or idx is None:
            raise OltCommandError(
                f"Huawei ONU info for serial {serial!r} missing F/S/P or ONT-ID fields"
            )
        loc = (slot, port, idx)
        self._onu_index_cache[serial] = loc
        return loc

    # ------------------------------------------------------------- optical pwr

    async def get_optical_power(
        self,
        *,
        target_type: Literal["olt_port", "onu"],
        target_id: str,
    ) -> OpticalPower:
        await self._ensure_connected()
        assert self._transport is not None
        if target_type == "olt_port":
            cmd = f"display port optical-info {target_id}"
            text = await self._transport.execute(cmd)
        elif target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            cmd = f"display ont optical-info 0/{slot}/{port} {onu_index}"
            text = await self._transport.execute(cmd)
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        if _looks_like_failure(text):
            raise OltCommandError(
                f"Huawei optical-info query failed for {target_type}={target_id!r}: {text.strip()}"
            )
        parsed = _parse_optical_info(text)
        rx = parsed.get("rx_dbm")
        if rx is None:
            raise OltCommandError(
                f"Huawei optical-info did not contain an Rx power line for {target_type}={target_id!r}"
            )
        return OpticalPower(
            target_type=target_type,
            target_id=target_id,
            rx_dbm=rx,
            tx_dbm=parsed.get("tx_dbm"),
            sampled_at=datetime.now(timezone.utc),
            raw={"command": cmd, "output": text},
        )

    # --------------------------------------------------------------------- VLAN

    async def set_vlan(
        self,
        *,
        slot: int,
        port: int,
        vlan_id: int,
        purpose: str,
    ) -> VlanSetResult:
        await self._ensure_connected()
        assert self._transport is not None
        # Ensure the VLAN exists — Huawei prints a warning if it already does;
        # that's a documented benign case we don't treat as an error.
        vlan_out = await self._transport.execute(f"vlan {vlan_id} smart")
        # Bind the port. We use the service-port form since GPON ports almost
        # always have ONUs riding under them; if the port has no ONUs Huawei
        # still accepts the form (returns Failure, which we then surface).
        bind_cmd = f"port vlan {vlan_id} 0/{slot} {port}"
        bind_out = await self._transport.execute(bind_cmd)
        if _looks_like_failure(bind_out):
            raise OltCommandError(
                f"Huawei port-vlan bind failed for slot={slot} port={port} vlan={vlan_id}: {bind_out.strip()}"
            )
        return VlanSetResult(
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            purpose=purpose,
            applied_at=datetime.now(timezone.utc),
            raw={
                "vlan_create": vlan_out,
                "port_bind": bind_out,
                "purpose": purpose,
            },
        )

    # ----------------------------------------------------------- line profile

    async def apply_line_profile(
        self,
        *,
        target_type: Literal["olt_port", "onu"],
        target_id: str,
        profile_name: str,
    ) -> LineProfileResult:
        await self._ensure_connected()
        assert self._transport is not None
        # On Huawei, line profiles are referenced by integer ID. If the caller
        # supplies a string name, we look it up; if an int-like string, we use
        # it directly.
        try:
            profile_id = int(profile_name)
            lookup_raw = None
        except (TypeError, ValueError):
            lookup_text = await self._transport.execute("display ont-lineprofile profile-id all")
            profile_id = self._extract_profile_id(lookup_text, profile_name)
            lookup_raw = lookup_text
            if profile_id is None:
                raise OltCommandError(
                    f"Huawei ont-lineprofile {profile_name!r} not found in profile-id table"
                )
        if target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            await self._transport.execute(f"interface gpon 0/{slot}")
            mod_cmd = f"ont modify {port} {onu_index} ont-lineprofile-id {profile_id}"
            mod_out = await self._transport.execute(mod_cmd)
            await self._transport.execute("quit")
        elif target_type == "olt_port":
            # target_id format expected: "0/slot/port" or "slot/port"
            parts = target_id.split("/")
            if len(parts) == 3:
                _frame, slot_s, port_s = parts
            elif len(parts) == 2:
                slot_s, port_s = parts
            else:
                raise OltCommandError(
                    f"Huawei apply_line_profile: olt_port target_id must be 'slot/port' or '0/slot/port', got {target_id!r}"
                )
            try:
                slot_i = int(slot_s)
                port_i = int(port_s)
            except ValueError as e:
                raise OltCommandError(
                    f"Huawei apply_line_profile: bad slot/port in target_id {target_id!r}"
                ) from e
            await self._transport.execute(f"interface gpon 0/{slot_i}")
            mod_cmd = f"port {port_i} ont-lineprofile-id {profile_id}"
            mod_out = await self._transport.execute(mod_cmd)
            await self._transport.execute("quit")
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        if _looks_like_failure(mod_out):
            raise OltCommandError(
                f"Huawei line-profile apply failed for {target_type}={target_id!r}: {mod_out.strip()}"
            )
        return LineProfileResult(
            target_type=target_type,
            target_id=target_id,
            profile_name=profile_name,
            applied_at=datetime.now(timezone.utc),
            raw={
                "profile_id": profile_id,
                "lookup": lookup_raw,
                "modify": mod_out,
            },
        )

    @staticmethod
    def _extract_profile_id(text: str, profile_name: str) -> int | None:
        """Parse ``display ont-lineprofile profile-id all`` and locate the ID for ``profile_name``.

        Huawei prints rows like:

            Profile-ID  Profile-Name             Binding-times
            10          100M_RESIDENTIAL         128
            11          500M_BUSINESS            32
        """
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            parts = stripped.split()
            if len(parts) >= 2 and parts[1] == profile_name:
                try:
                    return int(parts[0])
                except ValueError:
                    continue
        return None


# ──────────────────────────────────────────────────────────────────────────
# Factory auto-registration (Option A from the playbook).
# Importing this module is enough to make ``get_driver_for_olt`` find Huawei.
# ──────────────────────────────────────────────────────────────────────────


def _register() -> None:
    from ..factory import register_driver

    register_driver("huawei", HuaweiDriver)


_register()
