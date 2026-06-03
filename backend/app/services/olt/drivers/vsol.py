"""M1-B Phase 5 — VSOL V1600 / V2724 / V3608 GPON OLT driver.

Implements the :class:`~app.services.olt.driver.OltDriver` Protocol for V-SOL
World Technology's GPON OLT line (V1600D, V2724G, V3608, plus the V-SOL G-series
boxes that share the same CLI dialect). Third concrete vendor alongside Huawei
(Phase 3) and ZTE (Phase 4); same shape and contract — parser-first, transport-
injected, factory-registered — just with VSOL's IOS-flavoured CLI vocabulary.

Design notes
============

* **Transport via DI.** Accepts any :class:`~app.services.olt.transport.CliTransport`
  via the ``transport=`` kwarg. In tests pass a ``MockCliTransport`` with canned
  responses; in production the factory constructs an ``AsyncSshCliTransport``
  from the decrypted credentials.
* **Factory wiring — Option A.** The constructor also accepts the factory's
  positional kwargs (``host``, ``port``, ``credentials``, ``olt_record_id``,
  ``enable_password``) so the existing ``get_driver_for_olt`` does not need a
  special hook. When the factory hands those in (no ``transport=``), the driver
  lazily builds an ``AsyncSshCliTransport`` on the first ``_ensure_connected``
  call.
* **View management.** VSOL CLI follows an IOS-style three-tier hierarchy:
  user (``>``) → privileged (``enable`` → ``#``) → config (``configure terminal``
  → ``(config)#``). Per-command helpers enter ``interface gpon 0/<slot>/<port>``
  and ``onu <idx>`` sub-views as needed and always ``exit`` back to config view
  so subsequent commands have a known starting state.
* **CLI dialect assumed.** V1600/V2724/V3608 family (firmware V2.x). VSOL's
  smaller V-series sticks (V1600D1/D2) share the same command set for the 7
  universal commands the Protocol defines. Specifics this driver assumes:

  - ``show card`` → chassis/slot inventory table
  - ``show version`` → model + sw version + uptime
  - ``show pon optical-info <fsp>`` → OLT-port Rx
  - ``show onu optical-info 0/<slot>/<port> <idx>`` → ONU Rx/Tx
  - ``onu add`` / ``onu remove`` in interface-gpon view
  - ``vlan database`` + ``vlan <id>`` for VLAN creation
  - ``service-profile bind`` for line-profile attach (or ``profile-line`` on V3608)

  Real-hardware lab testing will refine the specifics that vary across VSOL
  firmware tracks (the parsers are tolerant where possible).
* **No DB, no models.** Driver returns dataclasses; service layer persists.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Literal

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


# VSOL `show card` rows look like:
#   SlotID  CardType  PortNum  HardVer  SoftVer    Status
#   1       GPFA      8        V1.0     V2.0.4     ACTIVE
#   2       GPFA      8        V1.0     V2.0.4     ACTIVE
#   3       SCUA      0        V1.0     V2.0.4     STANDBY
_CARD_ROW_RE = re.compile(
    r"^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$",
    re.MULTILINE,
)


def _parse_show_card(text: str) -> dict:
    """Parse VSOL ``show card`` output.

    Returns ``{chassis_count, card_count, port_count, slots: [...]}`` where:

    * ``chassis_count`` = 1 if any rows present (VSOL boxes are single-chassis
      for the V1600/V2724/V3608 models we target; if a future stacked SKU
      reports a Frame column we'd inflate this).
    * ``card_count``    = number of card rows.
    * ``port_count``    = sum of the ``PortNum`` column across rows. VSOL reports
      this directly (like ZTE; unlike Huawei where we infer from board name).
    * ``slots``         = per-row details for diagnostics.
    """
    slots: list[dict] = []
    port_count = 0
    for m in _CARD_ROW_RE.finditer(text):
        # Skip the header row, which also matches the regex (digit-free first
        # token guarantees we won't match "SlotID  CardType ..."); but a row
        # like "1 GPFA 8 ..." starts with a digit which `\d+` requires.
        slot_id, card_type, ports, hardver, softver, status = m.groups()
        ports_i = int(ports)
        port_count += ports_i
        slots.append({
            "slot": int(slot_id),
            "card_type": card_type,
            "port_count": ports_i,
            "hardver": hardver,
            "softver": softver,
            "status": status,
        })
    chassis_count = 1 if slots else 0
    return {
        "chassis_count": chassis_count,
        "card_count": len(slots),
        "port_count": port_count,
        "slots": slots,
    }


# `show version` — VSOL banner has separate "Product:" and "Software Version:"
# lines, and an "Uptime:" line.
_VERSION_MODEL_RE = re.compile(r"Product\s*:\s*(\S+)", re.IGNORECASE)
_VERSION_SW_RE = re.compile(r"Software\s+Version\s*:\s*(\S+)", re.IGNORECASE)
# Uptime line examples:
#   Uptime: 12 days, 04:32:11
#   Uptime: 3 hours, 12 minutes
_UPTIME_DHMS_RE = re.compile(
    r"Uptime\s*:\s*"
    r"(?:(\d+)\s*days?,?\s*)?"
    r"(\d+):(\d+):(\d+)",
    re.IGNORECASE,
)
_UPTIME_WORDS_RE = re.compile(
    r"Uptime\s*:\s*"
    r"(?:(\d+)\s*days?,?\s*)?"
    r"(?:(\d+)\s*hours?,?\s*)?"
    r"(?:(\d+)\s*minutes?,?\s*)?"
    r"(?:(\d+)\s*seconds?)?",
    re.IGNORECASE,
)


def _parse_show_version(text: str) -> dict:
    """Parse VSOL ``show version`` output.

    Returns ``{model, sw_version, uptime_seconds}``. Any field that can't be
    located is ``None`` (caller decides whether to error). Tries the
    ``HH:MM:SS`` form first, then falls back to the ``N hours, N minutes``
    worded form.
    """
    model: str | None = None
    sw_version: str | None = None
    m = _VERSION_MODEL_RE.search(text)
    if m:
        model = m.group(1)
    m = _VERSION_SW_RE.search(text)
    if m:
        sw_version = m.group(1)
    uptime_seconds: int | None = None
    u = _UPTIME_DHMS_RE.search(text)
    if u:
        days = int(u.group(1) or 0)
        hours = int(u.group(2))
        minutes = int(u.group(3))
        seconds = int(u.group(4))
        uptime_seconds = days * 86_400 + hours * 3_600 + minutes * 60 + seconds
    else:
        u = _UPTIME_WORDS_RE.search(text)
        if u and any(u.groups()):
            days = int(u.group(1) or 0)
            hours = int(u.group(2) or 0)
            minutes = int(u.group(3) or 0)
            seconds = int(u.group(4) or 0)
            if days or hours or minutes or seconds:
                uptime_seconds = (
                    days * 86_400 + hours * 3_600 + minutes * 60 + seconds
                )
    return {
        "model": model,
        "sw_version": sw_version,
        "uptime_seconds": uptime_seconds,
    }


# VSOL `show pon optical-info` / `show onu optical-info` shape:
#   RX Power(dBm) : -23.45
#   TX Power(dBm) :   2.10
_RX_POWER_RE = re.compile(
    r"RX\s+Power\(?d?Bm\)?\s*:?\s*(-?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)
_TX_POWER_RE = re.compile(
    r"TX\s+Power\(?d?Bm\)?\s*:?\s*(-?\d+(?:\.\d+)?)",
    re.IGNORECASE,
)


def _parse_show_optical(text: str) -> dict:
    """Parse VSOL optical-info output.

    Returns ``{rx_dbm, tx_dbm}`` with Decimal values (or ``None`` if a field
    is absent — OLT-port queries only report Rx, ONU queries report both).
    """
    rx = None
    tx = None
    m = _RX_POWER_RE.search(text)
    if m:
        rx = Decimal(m.group(1))
    m = _TX_POWER_RE.search(text)
    if m:
        tx = Decimal(m.group(1))
    return {"rx_dbm": rx, "tx_dbm": tx}


# `show onu info by-sn <serial>` reply shape on V1600/V2724:
#   ONU SN-Lookup:
#     ONU Location : 0/2/3:5
#     ONU Type     : V-SOL-HG323A
#     Status       : ONLINE
_ONU_LOC_RE = re.compile(
    r"ONU\s+Location\s*:\s*(\d+)/(\d+)/(\d+):(\d+)",
    re.IGNORECASE,
)
_ONU_STATE_RE = re.compile(r"Status\s*:\s*(\S+)", re.IGNORECASE)
_ONU_TYPE_RE = re.compile(r"ONU\s+Type\s*:\s*(\S+)", re.IGNORECASE)


def _parse_show_onu_info(text: str) -> list[dict]:
    """Parse ``show onu info by-sn <serial>`` reply.

    Returns a list of dicts ``{frame, slot, port, onu_index, state, onu_type}``
    (one per ``ONU Location`` reference). The driver only needs slot/port/
    onu_index for the location tuple; ``frame`` is exposed for completeness.
    """
    state_match = _ONU_STATE_RE.search(text)
    type_match = _ONU_TYPE_RE.search(text)
    state = state_match.group(1) if state_match else None
    onu_type = type_match.group(1) if type_match else None
    out: list[dict] = []
    for m in _ONU_LOC_RE.finditer(text):
        frame, slot, port, idx = m.groups()
        out.append({
            "frame": int(frame),
            "slot": int(slot),
            "port": int(port),
            "onu_index": int(idx),
            "state": state,
            "onu_type": onu_type,
        })
    return out


def _looks_like_failure(text: str) -> bool:
    """VSOL prints ``ERROR:``, ``% Invalid``, ``Bad command`` and ``failed``
    on rejection. We match conservatively so benign words like ``error count:
    0`` in informational output don't trip us.
    """
    if not text:
        return False
    lowered = text.lower()
    return any(
        token in lowered
        for token in (
            "error:",
            "% invalid",
            "% error",
            "bad command",
            "invalid input",
            "invalid parameter",
            "command failed",
            "failure:",
            " failed",
        )
    )


def _derive_onu_index(serial: str) -> int:
    """Deterministic onu_index in [1, 128] derived from the serial.

    VSOL expects an integer ONU index within a PON port's allowed range
    (typically 1..128 on V1600/V2724/V3608). For the skeleton we hash the
    serial to a stable value; in production the service layer (or a future
    ``show onu unauth`` query) will choose the real next-free index.
    Documented as such.
    """
    n = sum(serial.encode("utf-8")) if serial else 1
    return (n % 128) + 1


# ──────────────────────────────────────────────────────────────────────────
# VsolDriver
# ──────────────────────────────────────────────────────────────────────────


class VsolDriver:
    """Concrete OLT driver for V-SOL V1600 / V2724 / V3608 GPON platforms.

    Accepts any :class:`CliTransport` (real ``AsyncSshCliTransport`` in prod,
    ``MockCliTransport`` in tests) via dependency injection. All commands use
    realistic VSOL CLI syntax (IOS-style three-tier view hierarchy).
    """

    vendor: str = "vsol"

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
                "VsolDriver: cannot build transport — no host configured and no transport injected"
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
        # Enter privileged + config view. VSOL flow: enable → (optional password)
        # → configure terminal.
        await self._transport.execute("enable")
        if self._enable_password:
            await self._transport.execute(self._enable_password)
        await self._transport.execute("configure terminal")
        self._connected = True

    async def close(self) -> None:
        if self._connected and self._transport is not None:
            # Exit config → privileged → user views. Swallow per-exit failures —
            # we're tearing down anyway.
            try:
                await self._transport.execute("exit")
            except Exception:  # noqa: BLE001
                pass
            try:
                await self._transport.execute("exit")
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
        version_text = await self._transport.execute("show version")
        card_text = await self._transport.execute("show card")
        if _looks_like_failure(version_text) or _looks_like_failure(card_text):
            raise OltCommandError(
                "VSOL refused status query — check user privilege level"
            )
        ver = _parse_show_version(version_text)
        card = _parse_show_card(card_text)
        return OltStatus(
            reachable=True,
            vendor=self.vendor,
            model=ver["model"],
            sw_version=ver["sw_version"],
            chassis_count=card["chassis_count"],
            card_count=card["card_count"],
            port_count=card["port_count"],
            last_seen_at=datetime.now(timezone.utc),
            raw={
                "show_version": version_text,
                "show_card": card_text,
                "slots": card["slots"],
            },
        )

    # ------------------------------------------------------------------ uptime

    async def get_uptime(self) -> OltUptime:
        await self._ensure_connected()
        assert self._transport is not None
        version_text = await self._transport.execute("show version")
        ver = _parse_show_version(version_text)
        uptime_seconds = ver.get("uptime_seconds")
        if uptime_seconds is None:
            raise OltCommandError(
                "VSOL show version did not report an Uptime line — cannot derive uptime"
            )
        now = datetime.now(timezone.utc)
        boot = now - timedelta(seconds=uptime_seconds)
        return OltUptime(
            uptime_seconds=uptime_seconds,
            boot_time=boot,
            raw={"show_version": version_text},
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
        desc = customer_ref or serial
        # VSOL flow: enter the interface gpon for this slot/port, add ONU with
        # serial authorization + profile, drop into the per-ONU view, bind VLAN
        # on gemport 1, exit out.
        await self._transport.execute(f"interface gpon 0/{slot}/{port}")
        add_cmd = (
            f"onu add {onu_index} sn {serial} profile {line_profile} "
            f'description "{desc}"'
        )
        add_output = await self._transport.execute(add_cmd)
        if _looks_like_failure(add_output):
            # Exit the interface view so the next caller starts in a clean state.
            try:
                await self._transport.execute("exit")
            except Exception:  # noqa: BLE001
                pass
            raise OltCommandError(
                f"VSOL onu add failed for serial {serial!r}: {add_output.strip()}"
            )
        # Per-ONU sub-view for VLAN binding.
        await self._transport.execute(f"onu {onu_index}")
        svc_cmd = f"service-port 1 gemport 1 vlan {vlan_id}"
        svc_output = await self._transport.execute(svc_cmd)
        await self._transport.execute("exit")  # leave onu <idx> view
        await self._transport.execute("exit")  # leave interface gpon view
        if _looks_like_failure(svc_output):
            raise OltCommandError(
                f"VSOL service-port bind failed for serial {serial!r}: {svc_output.strip()}"
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
                "onu_add": add_output,
                "service_port": svc_output,
                "customer_ref": customer_ref,
            },
        )

    # ------------------------------------------------------------------ delete

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        await self._ensure_connected()
        assert self._transport is not None
        slot, port, onu_index = await self._resolve_onu_location(serial)
        # Enter the interface view for the deletion, then exit back.
        await self._transport.execute(f"interface gpon 0/{slot}/{port}")
        delete_output = await self._transport.execute(f"onu remove {onu_index}")
        await self._transport.execute("exit")
        if _looks_like_failure(delete_output):
            raise OltCommandError(
                f"VSOL onu remove failed for serial {serial!r}: {delete_output.strip()}"
            )
        # Drop the cache entry so a re-provision starts clean.
        self._onu_index_cache.pop(serial, None)
        return OnuDeleteResult(
            serial=serial,
            deleted_at=datetime.now(timezone.utc),
            raw={
                "onu_remove": delete_output,
                "location": {"slot": slot, "port": port, "onu_index": onu_index},
            },
        )

    async def _resolve_onu_location(self, serial: str) -> tuple[int, int, int]:
        """Return ``(slot, port, onu_index)`` for an ONU serial.

        Hits the cache first; falls back to ``show onu info by-sn <serial>``.
        """
        cached = self._onu_index_cache.get(serial)
        if cached:
            return cached
        assert self._transport is not None
        text = await self._transport.execute(f"show onu info by-sn {serial}")
        if _looks_like_failure(text):
            raise OltCommandError(
                f"VSOL could not find ONU with serial {serial!r}: {text.strip()}"
            )
        records = _parse_show_onu_info(text)
        if not records:
            raise OltCommandError(
                f"VSOL did not return any ONU records for serial {serial!r}"
            )
        rec = records[0]
        slot = rec.get("slot")
        port = rec.get("port")
        idx = rec.get("onu_index")
        if slot is None or port is None or idx is None:
            raise OltCommandError(
                f"VSOL ONU info for serial {serial!r} missing slot/port/onu_index fields"
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
            # target_id is "slot/port" or "0/slot/port". Normalize to the VSOL
            # ``0/slot/port`` form expected by ``show pon optical-info``.
            fsp = self._normalize_olt_port_id(target_id)
            cmd = f"show pon optical-info {fsp}"
            text = await self._transport.execute(cmd)
            commands_for_raw: dict = {"command": cmd, "output": text}
            if _looks_like_failure(text):
                raise OltCommandError(
                    f"VSOL pon optical-info query failed for {target_id!r}: {text.strip()}"
                )
            parsed = _parse_show_optical(text)
        elif target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            cmd = f"show onu optical-info 0/{slot}/{port} {onu_index}"
            text = await self._transport.execute(cmd)
            commands_for_raw = {"command": cmd, "output": text}
            if _looks_like_failure(text):
                raise OltCommandError(
                    f"VSOL onu optical-info query failed for {target_id!r}: {text.strip()}"
                )
            parsed = _parse_show_optical(text)
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        rx = parsed.get("rx_dbm")
        if rx is None:
            raise OltCommandError(
                f"VSOL optical-info output did not contain an Rx power line for {target_type}={target_id!r}"
            )
        return OpticalPower(
            target_type=target_type,
            target_id=target_id,
            rx_dbm=rx,
            tx_dbm=parsed.get("tx_dbm"),
            sampled_at=datetime.now(timezone.utc),
            raw=commands_for_raw,
        )

    @staticmethod
    def _normalize_olt_port_id(target_id: str) -> str:
        """Normalize an olt_port target_id to the VSOL ``0/slot/port`` form.

        Accepts ``slot/port`` (assumes frame=0) or full ``0/slot/port``.
        """
        parts = target_id.split("/")
        if len(parts) == 2:
            return f"0/{parts[0]}/{parts[1]}"
        if len(parts) == 3:
            return target_id
        raise OltCommandError(
            f"VSOL olt_port target_id must be 'slot/port' or '0/slot/port', got {target_id!r}"
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
        # VSOL: enter vlan-database, declare the VLAN, exit back to config view,
        # then bind the port. The database-entry form is benign if the VLAN
        # already exists (VSOL prints a notice we don't treat as an error).
        db_out = await self._transport.execute("vlan database")
        if _looks_like_failure(db_out):
            raise OltCommandError(
                f"VSOL vlan database enter failed: {db_out.strip()}"
            )
        vlan_out = await self._transport.execute(f"vlan {vlan_id}")
        if _looks_like_failure(vlan_out):
            try:
                await self._transport.execute("exit")
            except Exception:  # noqa: BLE001
                pass
            raise OltCommandError(
                f"VSOL vlan {vlan_id} create failed: {vlan_out.strip()}"
            )
        await self._transport.execute("exit")  # leave vlan database
        # Bind the VLAN to the GPON port.
        bind_cmd = f"port vlan add {vlan_id} interface gpon 0/{slot}/{port}"
        bind_out = await self._transport.execute(bind_cmd)
        if _looks_like_failure(bind_out):
            raise OltCommandError(
                f"VSOL port-vlan bind failed for slot={slot} port={port} vlan={vlan_id}: {bind_out.strip()}"
            )
        return VlanSetResult(
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            purpose=purpose,
            applied_at=datetime.now(timezone.utc),
            raw={
                "vlan_database": db_out,
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
        # VSOL references line profiles by NAME (like ZTE; unlike Huawei's
        # integer IDs). The bind command varies by target:
        # * ONU: enter interface gpon, then onu <idx> view, ``service-profile
        #   bind <name>``.
        # * OLT-port: enter interface gpon, ``profile-line <name>``.
        if target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            await self._transport.execute(f"interface gpon 0/{slot}/{port}")
            await self._transport.execute(f"onu {onu_index}")
            mod_cmd = f"service-profile bind {profile_name}"
            mod_out = await self._transport.execute(mod_cmd)
            await self._transport.execute("exit")  # leave onu <idx>
            await self._transport.execute("exit")  # leave interface gpon
        elif target_type == "olt_port":
            fsp = self._normalize_olt_port_id(target_id)
            await self._transport.execute(f"interface gpon {fsp}")
            mod_cmd = f"profile-line {profile_name}"
            mod_out = await self._transport.execute(mod_cmd)
            await self._transport.execute("exit")
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        if _looks_like_failure(mod_out):
            raise OltCommandError(
                f"VSOL line-profile apply failed for {target_type}={target_id!r}: {mod_out.strip()}"
            )
        return LineProfileResult(
            target_type=target_type,
            target_id=target_id,
            profile_name=profile_name,
            applied_at=datetime.now(timezone.utc),
            raw={"profile_apply": mod_out, "profile_name": profile_name},
        )


# ──────────────────────────────────────────────────────────────────────────
# Factory auto-registration (Option A from the playbook).
# Importing this module is enough to make ``get_driver_for_olt`` find VSOL.
# ──────────────────────────────────────────────────────────────────────────


def _register() -> None:
    from ..factory import register_driver

    register_driver("vsol", VsolDriver)


_register()
