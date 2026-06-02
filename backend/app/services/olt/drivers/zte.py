"""M1-B Phase 4 — ZTE C300 / C320 / C600-series OLT driver.

Implements the :class:`~app.services.olt.driver.OltDriver` Protocol for ZTE's
three most-deployed C-series OLT platforms (C300, C320, C600) using realistic
ZTE ZXA10 CLI syntax. Same shape and contract as the Huawei driver (Phase 3) —
parser-first, transport-injected, factory-registered — just with ZTE's
Cisco-style command set instead of Huawei's view-based hierarchy.

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
* **View management.** ZTE CLI is Cisco-style: ``enable`` (privileged) → ``configure
  terminal`` (config). ``_ensure_connected`` enters that pair once. Per-command
  helpers enter/leave ``interface gpon-olt_<fsp>`` and ``pon-onu-mng
  gpon-onu_<fsp>:<idx>`` sub-views as needed and always ``exit`` back to config
  view so subsequent commands have a known starting state.
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


# `show card` rows look like:
#   Rack Shelf Slot CfgType  RealType  Port HardVer SoftVer    Status
#   1    1     1    GTGO     GTGO      16   V2.0    V2.1.1.B5  INSERVICE
_CARD_ROW_RE = re.compile(
    r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$",
    re.MULTILINE,
)


def _parse_show_card(text: str) -> dict:
    """Parse ZTE ``show card`` output.

    Returns ``{chassis_count, card_count, port_count, slots: [...]}`` where:

    * ``chassis_count`` = number of unique ``Rack`` values across rows.
    * ``card_count``    = number of card rows.
    * ``port_count``    = sum of the ``Port`` column across rows (ZTE reports
      port count directly, unlike Huawei where we infer from board name).
    * ``slots``         = per-row details for diagnostics.
    """
    slots: list[dict] = []
    racks: set[int] = set()
    port_count = 0
    for m in _CARD_ROW_RE.finditer(text):
        rack, shelf, slot, cfg_type, real_type, ports, hardver, softver, status = m.groups()
        rack_i = int(rack)
        ports_i = int(ports)
        racks.add(rack_i)
        port_count += ports_i
        slots.append({
            "rack": rack_i,
            "shelf": int(shelf),
            "slot": int(slot),
            "cfg_type": cfg_type,
            "real_type": real_type,
            "port_count": ports_i,
            "hardver": hardver,
            "softver": softver,
            "status": status,
        })
    return {
        "chassis_count": len(racks),
        "card_count": len(slots),
        "port_count": port_count,
        "slots": slots,
    }


# `show version` — ZTE's banner has a "Version:" line and a "Model:" line.
_VERSION_VER_RE = re.compile(r"Version\s*:\s*(\S+)", re.IGNORECASE)
_VERSION_MODEL_RE = re.compile(r"Model\s*:\s*(\S+)", re.IGNORECASE)
# Uptime line example: ``System Up Time: 12 days 04:32:11``
_UPTIME_RE = re.compile(
    r"System\s+Up\s+Time\s*:\s*"
    r"(?:(\d+)\s+days?\s+)?"
    r"(\d+):(\d+):(\d+)",
    re.IGNORECASE,
)


def _parse_show_version(text: str) -> dict:
    """Parse ZTE ``show version`` output.

    Returns ``{model, sw_version, uptime_seconds}``. Any field that can't be
    located is ``None`` (caller decides whether to error).
    """
    model: str | None = None
    sw_version: str | None = None
    m = _VERSION_VER_RE.search(text)
    if m:
        sw_version = m.group(1)
    m = _VERSION_MODEL_RE.search(text)
    if m:
        model = m.group(1)
    uptime_seconds: int | None = None
    u = _UPTIME_RE.search(text)
    if u:
        days = int(u.group(1) or 0)
        hours = int(u.group(2))
        minutes = int(u.group(3))
        seconds = int(u.group(4))
        uptime_seconds = days * 86_400 + hours * 3_600 + minutes * 60 + seconds
    return {
        "model": model,
        "sw_version": sw_version,
        "uptime_seconds": uptime_seconds,
    }


# `show pon power onu-rx` / `onu-tx` / `olt-rx` all share the same `XX power : <val> dBm` shape.
_RX_POWER_RE = re.compile(r"RX\s+power\s*:?\s*(-?\d+(?:\.\d+)?)\s*dBm", re.IGNORECASE)
_TX_POWER_RE = re.compile(r"TX\s+power\s*:?\s*(-?\d+(?:\.\d+)?)\s*dBm", re.IGNORECASE)
# olt-rx output uses "Last value :" inside a multi-line statistics block.
_OLT_RX_LAST_RE = re.compile(
    r"Last\s+value\s*:?\s*(-?\d+(?:\.\d+)?)\s*dBm",
    re.IGNORECASE,
)


def _parse_pon_power(text: str) -> dict:
    """Parse ZTE optical-power output.

    Handles three ZTE formats:
    * ``RX power : -23.45 dBm`` → ``rx_dbm``
    * ``TX power :  2.10 dBm`` → ``tx_dbm``
    * ``Last value : -24.10 dBm`` (olt-rx statistics block) → ``rx_dbm``

    Returns ``{rx_dbm, tx_dbm}`` with Decimal values (or ``None`` if a field is
    absent — ZTE olt-rx only reports Rx, onu-rx/tx are queried separately).
    """
    rx = None
    tx = None
    m = _RX_POWER_RE.search(text)
    if m:
        rx = Decimal(m.group(1))
    else:
        # Fall back to olt-rx statistics block's "Last value" line.
        m = _OLT_RX_LAST_RE.search(text)
        if m:
            rx = Decimal(m.group(1))
    m = _TX_POWER_RE.search(text)
    if m:
        tx = Decimal(m.group(1))
    return {"rx_dbm": rx, "tx_dbm": tx}


# ``show gpon onu by-sn`` reply shape:
#   SN-LookupResult:
#     GPON-onu: gpon-onu_1/2/3:5
#     ONU Type: ZTE-F660
#     State: AT_WORKING
_BY_SN_GPON_ONU_RE = re.compile(
    r"gpon-onu_(\d+)/(\d+)/(\d+):(\d+)",
    re.IGNORECASE,
)
_BY_SN_STATE_RE = re.compile(r"State\s*:\s*(\S+)", re.IGNORECASE)
_BY_SN_TYPE_RE = re.compile(r"ONU\s+Type\s*:\s*(\S+)", re.IGNORECASE)


def _parse_onu_by_sn(text: str) -> list[dict]:
    """Parse ``show gpon onu by-sn <serial>`` reply.

    Returns a list of dicts ``{rack, slot, port, onu_index, state, onu_type}``
    (one per ``gpon-onu_...`` reference). On ZTE the rack/slot/port comes from
    the ``gpon-onu_X/Y/Z:idx`` identifier itself; we expose ``rack`` for
    completeness but the driver only needs ``slot``, ``port``, ``onu_index``
    for the location tuple.
    """
    out: list[dict] = []
    state_match = _BY_SN_STATE_RE.search(text)
    type_match = _BY_SN_TYPE_RE.search(text)
    state = state_match.group(1) if state_match else None
    onu_type = type_match.group(1) if type_match else None
    for m in _BY_SN_GPON_ONU_RE.finditer(text):
        rack, slot, port, idx = m.groups()
        out.append({
            "rack": int(rack),
            "slot": int(slot),
            "port": int(port),
            "onu_index": int(idx),
            "state": state,
            "onu_type": onu_type,
        })
    return out


def _looks_like_failure(text: str) -> bool:
    """ZTE sprinkles ``Error:``, ``Invalid input``, ``% Error`` and ``failed``
    into CLI output on rejection. We match conservatively so benign words like
    ``no error`` or ``error count: 0`` in informational output don't trip us.
    """
    if not text:
        return False
    lowered = text.lower()
    return any(
        token in lowered
        for token in (
            "error:",
            "% error",
            "invalid input",
            "invalid parameter",
            "command failed",
            "failure:",
            " failed",
        )
    )


def _derive_onu_index(serial: str) -> int:
    """Deterministic onu_index in [1, 128] derived from the serial.

    ZTE expects an integer ONU index within a PON port's allowed range
    (typically 1..128 on C300/C320/C600). For the skeleton we hash the serial
    to a stable value; in production the service layer (or a future ``show gpon
    onu uncfg`` / ``show gpon onu state`` query) will choose the real next-free
    index. Documented as such.
    """
    n = sum(serial.encode("utf-8")) if serial else 1
    return (n % 128) + 1


# ──────────────────────────────────────────────────────────────────────────
# ZteDriver
# ──────────────────────────────────────────────────────────────────────────


class ZteDriver:
    """Concrete OLT driver for ZTE C300 / C320 / C600 platforms.

    Accepts any :class:`CliTransport` (real ``AsyncSshCliTransport`` in prod,
    ``MockCliTransport`` in tests) via dependency injection. All commands use
    realistic ZTE ZXA10 CLI syntax (Cisco-style).
    """

    vendor: str = "zte"

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
                "ZteDriver: cannot build transport — no host configured and no transport injected"
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
        # Enter privileged + config view. ZTE flow: enable → (optional password) → configure terminal.
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
                "ZTE refused status query — check user privilege level"
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
                "ZTE show version did not report a System Up Time line — cannot derive uptime"
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
        # ZTE uses rack 1 / shelf 1 by convention on C300/C320/C600; slot/port
        # come from the caller. The on-the-wire identifier uses the colon form
        # for ONU references (gpon-onu_1/<slot>/<port>:<idx>).
        fsp = f"1/{slot}/{port}"
        # Step 1 — enter the OLT-side GPON interface, add the ONU.
        await self._transport.execute(f"interface gpon-olt_{fsp}")
        add_cmd = f"onu {onu_index} type {line_profile} sn {serial}"
        add_output = await self._transport.execute(add_cmd)
        await self._transport.execute("exit")
        if _looks_like_failure(add_output):
            raise OltCommandError(
                f"ZTE onu add failed for serial {serial!r}: {add_output.strip()}"
            )
        # Step 2 — enter the per-ONU management view, bind VLAN via service mapping.
        await self._transport.execute(f"pon-onu-mng gpon-onu_{fsp}:{onu_index}")
        svc_cmd = f"service GPON gemport 1 vlan {vlan_id}"
        svc_output = await self._transport.execute(svc_cmd)
        await self._transport.execute("exit")
        if _looks_like_failure(svc_output):
            raise OltCommandError(
                f"ZTE service-vlan bind failed for serial {serial!r}: {svc_output.strip()}"
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
                "service_vlan": svc_output,
                "customer_ref": customer_ref,
            },
        )

    # ------------------------------------------------------------------ delete

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        await self._ensure_connected()
        assert self._transport is not None
        slot, port, onu_index = await self._resolve_onu_location(serial)
        # Cisco-style "no" negation, issued from config view (no need to enter
        # the interface view for the deletion form).
        del_cmd = f"no onu {onu_index} from interface gpon-olt_1/{slot}/{port}"
        delete_output = await self._transport.execute(del_cmd)
        if _looks_like_failure(delete_output):
            raise OltCommandError(
                f"ZTE no onu (delete) failed for serial {serial!r}: {delete_output.strip()}"
            )
        # Drop the cache entry so a re-provision starts clean.
        self._onu_index_cache.pop(serial, None)
        return OnuDeleteResult(
            serial=serial,
            deleted_at=datetime.now(timezone.utc),
            raw={
                "no_onu": delete_output,
                "location": {"slot": slot, "port": port, "onu_index": onu_index},
            },
        )

    async def _resolve_onu_location(self, serial: str) -> tuple[int, int, int]:
        """Return ``(slot, port, onu_index)`` for an ONU serial.

        Hits the cache first; falls back to ``show gpon onu by-sn <serial>``.
        """
        cached = self._onu_index_cache.get(serial)
        if cached:
            return cached
        assert self._transport is not None
        text = await self._transport.execute(f"show gpon onu by-sn {serial}")
        if _looks_like_failure(text):
            raise OltCommandError(
                f"ZTE could not find ONU with serial {serial!r}: {text.strip()}"
            )
        records = _parse_onu_by_sn(text)
        if not records:
            raise OltCommandError(
                f"ZTE did not return any ONU records for serial {serial!r}"
            )
        rec = records[0]
        slot = rec.get("slot")
        port = rec.get("port")
        idx = rec.get("onu_index")
        if slot is None or port is None or idx is None:
            raise OltCommandError(
                f"ZTE ONU info for serial {serial!r} missing slot/port/onu_index fields"
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
            # target_id is expected to be "slot/port" or "rack/slot/port".
            fsp = self._normalize_olt_port_id(target_id)
            cmd = f"show pon power olt-rx gpon-olt_{fsp}"
            text = await self._transport.execute(cmd)
            commands_for_raw: dict = {"command": cmd, "output": text}
            if _looks_like_failure(text):
                raise OltCommandError(
                    f"ZTE olt-rx query failed for {target_id!r}: {text.strip()}"
                )
            parsed = _parse_pon_power(text)
        elif target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            fsp_idx = f"1/{slot}/{port}:{onu_index}"
            rx_cmd = f"show pon power onu-rx gpon-onu_{fsp_idx}"
            tx_cmd = f"show pon power onu-tx gpon-onu_{fsp_idx}"
            rx_text = await self._transport.execute(rx_cmd)
            tx_text = await self._transport.execute(tx_cmd)
            if _looks_like_failure(rx_text) or _looks_like_failure(tx_text):
                raise OltCommandError(
                    f"ZTE onu optical-power query failed for {target_id!r}: "
                    f"rx={rx_text.strip()} tx={tx_text.strip()}"
                )
            parsed_rx = _parse_pon_power(rx_text)
            parsed_tx = _parse_pon_power(tx_text)
            parsed = {
                "rx_dbm": parsed_rx.get("rx_dbm"),
                "tx_dbm": parsed_tx.get("tx_dbm"),
            }
            commands_for_raw = {
                "rx_command": rx_cmd,
                "rx_output": rx_text,
                "tx_command": tx_cmd,
                "tx_output": tx_text,
            }
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        rx = parsed.get("rx_dbm")
        if rx is None:
            raise OltCommandError(
                f"ZTE optical-power output did not contain an Rx power line for {target_type}={target_id!r}"
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
        """Normalize an olt_port target_id to the ZTE ``rack/slot/port`` form.

        Accepts ``slot/port`` (assumes rack=1) or full ``rack/slot/port``.
        """
        parts = target_id.split("/")
        if len(parts) == 2:
            return f"1/{parts[0]}/{parts[1]}"
        if len(parts) == 3:
            return target_id
        raise OltCommandError(
            f"ZTE olt_port target_id must be 'slot/port' or 'rack/slot/port', got {target_id!r}"
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
        # Derive VLAN name from purpose: "DATA-VLAN", "VOIP-VLAN", etc.
        purpose_label = (purpose or "data").strip().upper()
        vlan_name = f'"{purpose_label}-VLAN"'
        vlan_out = await self._transport.execute(f"vlan {vlan_id}")
        if _looks_like_failure(vlan_out):
            raise OltCommandError(
                f"ZTE vlan {vlan_id} entry failed: {vlan_out.strip()}"
            )
        name_out = await self._transport.execute(f"name {vlan_name}")
        await self._transport.execute("exit")
        if _looks_like_failure(name_out):
            raise OltCommandError(
                f"ZTE vlan name set failed for vlan {vlan_id}: {name_out.strip()}"
            )
        return VlanSetResult(
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            purpose=purpose,
            applied_at=datetime.now(timezone.utc),
            raw={
                "vlan_enter": vlan_out,
                "vlan_name": name_out,
                "name_string": vlan_name,
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
        # ZTE references line profiles by NAME (not numeric ID like Huawei).
        if target_type == "onu":
            slot, port, onu_index = await self._resolve_onu_location(target_id)
            fsp_idx = f"1/{slot}/{port}:{onu_index}"
            await self._transport.execute(f"pon-onu-mng gpon-onu_{fsp_idx}")
            mod_out = await self._transport.execute(f"profile {profile_name}")
            await self._transport.execute("exit")
        elif target_type == "olt_port":
            fsp = self._normalize_olt_port_id(target_id)
            await self._transport.execute(f"interface gpon-olt_{fsp}")
            mod_out = await self._transport.execute(f"profile {profile_name}")
            await self._transport.execute("exit")
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        if _looks_like_failure(mod_out):
            raise OltCommandError(
                f"ZTE line-profile apply failed for {target_type}={target_id!r}: {mod_out.strip()}"
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
# Importing this module is enough to make ``get_driver_for_olt`` find ZTE.
# ──────────────────────────────────────────────────────────────────────────


def _register() -> None:
    from ..factory import register_driver

    register_driver("zte", ZteDriver)


_register()
