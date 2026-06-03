"""M1-B — VSOL V1600G1-B GPON OLT driver (firmware V1.4.7R family).

Distinct from the IOS-style V2x stub in ``vsol.py``: V1600 firmware V1.4.7R speaks a
much narrower CLI and — critically — fronts itself with a DUAL-LOGIN flow over SSH.
Connecting as ``admin`` over SSH lands you on a Busybox shell that is useless; the
device's actual CLI is reached by typing the username+password AGAIN at a prompt
the device emits ITSELF after the SSH banner. That dual-login can't be expressed
cleanly through :class:`~app.services.olt.transport.AsyncSshCliTransport` (which
assumes "send command → get output" on a normal shell), so this driver carries
its own asyncssh-backed transport wrapper internally instead of layering on top
of ``CliTransport``.

Verified flow (real device 10.0.1.3, 2026-06-02):

1. ``asyncssh.connect`` with legacy KEX/cipher/MAC list (the V1600 SSH server only
   offers those).
2. ``conn.create_process(term_type='xterm', encoding='utf-8')`` — opens a PTY.
3. Drain the banner up to ``Login:`` prompt.
4. Write ``admin\\n`` then the password — same password works for both layers.
5. Land on user-mode prompt ``ArmGponOLT2>``.
6. ``en`` + password → privileged prompt ``ArmGponOLT2#``.
7. ``terminal length 0`` disables pagination.
8. ``show running-config`` is the workhorse — yields hostname, software version,
   every interface block, and every ONU registration.

Quirks worth recording so the next maintainer doesn't relearn them:

* ``show version`` is REJECTED ("% Unknown command") on this firmware — we read
  the software version from the ``!Software Version`` comment line at the top of
  ``running-config`` instead.
* The hostname (used for the prompt regex) is read from ``hostname <name>`` in
  running-config or captured from the first prompt the device emits.
* No clean ``show uptime`` command exists — :meth:`get_uptime` raises
  ``OltNotSupportedError``.
* Per-ONU optical-info command syntax is best-guess (``show interface gpon 0/N
  onu <id> optical-info``); :meth:`get_optical_power` is marked PROVISIONAL.

Notable design point — :meth:`pull_topology` is NOT part of the ``OltDriver``
Protocol; it's an extension method the live-refresh service calls to rebuild
the chassis/card/port/ONU tree from a single ``show running-config`` pull. The
Protocol stays vendor-agnostic; live-refresh just dispatches per-vendor.
"""
from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
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
from ..exceptions import (
    OltCommandError,
    OltConnectionError,
    OltCredentialsError,
    OltNotSupportedError,
)


# ──────────────────────────────────────────────────────────────────────────
# Wire-level constants (firmware V1.4.7R, verified on ArmGponOLT2 2026-06-02)
# ──────────────────────────────────────────────────────────────────────────

# asyncssh legacy algorithm list — V1600 SSH only offers these.
_KEX_ALGS = "+diffie-hellman-group1-sha1,diffie-hellman-group14-sha1"
_ENCRYPTION_ALGS = "+aes128-cbc,3des-cbc"
_MAC_ALGS = "+hmac-sha1"

# Default model+hardware identifiers when the device doesn't report them inline.
_DEFAULT_MODEL = "V1600G1-B"

# How long to wait after the SSH session opens before we start draining
# the banner. The device emits the banner + the embedded "Login:" prompt
# in two bursts about 2 seconds apart.
_BANNER_DRAIN_SECONDS = 2.5

# Per-read timeout when draining banner / collecting command output.
_READ_TIMEOUT_SECONDS = 2.0

# How long an empty read must persist before we consider a command's output
# fully arrived (the device streams running-config in bursts).
_IDLE_GAP_SECONDS = 1.5

# Hard ceiling on bytes per single command — running-config on a fully populated
# V1600 sits well under 1 MB; if we cross this something is wrong.
_OUTPUT_BYTE_CAP = 2 * 1024 * 1024


# Parser regexes — pure compile-time work, no I/O.
_HOSTNAME_RE = re.compile(r"^\s*hostname\s+(\S+)\s*$", re.MULTILINE)
_SW_VERSION_RE = re.compile(
    r"^!?\s*Software\s+Version\s*:\s*(\S+)\s*$", re.MULTILINE | re.IGNORECASE,
)
_HARDWARE_VERSION_RE = re.compile(
    r"^!?\s*Hardware\s+Version\s*:\s*(\S+)\s*$", re.MULTILINE | re.IGNORECASE,
)
_INTERFACE_GPON_RE = re.compile(
    r"^interface\s+gpon\s+0/(\d+)\s*$", re.MULTILINE | re.IGNORECASE,
)
# VLAN definition lines: `vlan 10` or `vlan 2009 - 2016` (range form).
_VLAN_SINGLE_RE = re.compile(r"^\s*vlan\s+(\d+)\s*$", re.IGNORECASE)
_VLAN_RANGE_RE = re.compile(r"^\s*vlan\s+(\d+)\s*-\s*(\d+)\s*$", re.IGNORECASE)
# DBA profiles: `profile dba id <id> name <name>` then `type N maximum N` or `type N assured N maximum N`.
_DBA_PROFILE_RE = re.compile(
    r"^\s*profile\s+dba\s+id\s+(\d+)\s+name\s+(\S+)\s*$",
    re.IGNORECASE,
)
_DBA_BANDWIDTH_RE = re.compile(
    r"^\s*type\s+(\d+)(?:\s+assured\s+(\d+))?\s+maximum\s+(\d+)\s*$",
    re.IGNORECASE,
)
# ONU line-profile assignment lines: `onu N profile line name <profile>`.
_ONU_LINE_PROFILE_RE = re.compile(
    r"^\s*onu\s+(\d+)\s+profile\s+line\s+name\s+(\S+)\s*$",
    re.IGNORECASE,
)
# Top-level line-profile definition + its T-CONT/service VLAN lines.
_LINE_PROFILE_RE = re.compile(
    r"^\s*profile\s+line\s+id\s+(\d+)\s+name\s+(\S+)\s*$",
    re.IGNORECASE,
)
_TCONT_DBA_RE = re.compile(
    r"^\s*tcont\s+\d+\s+name\s+\S+\s+dba\s+(\S+)\s*$",
    re.IGNORECASE,
)
_SERVICE_VLAN_RE = re.compile(
    r"^\s*service\s+\S+\s+gemport\s+\d+\s+vlan\s+(\d+)\s*$",
    re.IGNORECASE,
)
_OTHER_INTERFACE_RE = re.compile(r"^interface\s+\S+", re.IGNORECASE)
_ONU_ADD_RE = re.compile(
    r"^\s*onu\s+add\s+(\d+)\s+profile\s+(\S+)\s+sn\s+(\S+)\s*$",
    re.IGNORECASE,
)
_SHUTDOWN_RE = re.compile(r"^\s*shutdown\s*$", re.IGNORECASE)
_NO_SHUTDOWN_RE = re.compile(r"^\s*no\s+shutdown\s*$", re.IGNORECASE)

# Optical-info parser (PROVISIONAL — exact syntax not verified on hardware yet).
_RX_POWER_RE = re.compile(
    r"R[Xx]\s*Power[^:\-\d]*:?\s*(-?\d+(?:\.\d+)?)",
)
_TX_POWER_RE = re.compile(
    r"T[Xx]\s*Power[^:\-\d]*:?\s*(-?\d+(?:\.\d+)?)",
)


# ──────────────────────────────────────────────────────────────────────────
# Pure parsers — exported for unit tests, no I/O.
# ──────────────────────────────────────────────────────────────────────────


def parse_running_config(text: str) -> dict[str, Any]:
    """Parse ``show running-config`` into a topology dict.

    Returns::

        {
            "hostname": str | None,
            "model": str,                      # best-effort, falls back to V1600G1-B
            "sw_version": str | None,
            "hw_version": str | None,
            "ports": [
                {
                    "port_no": int,
                    "type": "GPON",
                    "status": "up" | "admin_down",
                    "onus": [
                        {"onu_id": int, "serial": str,
                         "profile": str, "status": "active"},
                        ...
                    ],
                },
                ...
            ],
        }

    The parser is a tiny line-by-line state machine: it tracks the
    currently-active ``interface gpon 0/N`` block and collects ``onu add``
    lines into it, flipping to ``admin_down`` when a ``shutdown`` line
    appears inside the block. Other ``interface`` blocks close the active
    GPON section.
    """
    hostname_m = _HOSTNAME_RE.search(text)
    sw_m = _SW_VERSION_RE.search(text)
    hw_m = _HARDWARE_VERSION_RE.search(text)

    ports_by_no: dict[int, dict[str, Any]] = {}
    current_port_no: int | None = None
    current_port: dict[str, Any] | None = None

    # VLAN inventory: keyed by VLAN ID for dedup; range form `vlan 2009 - 2016`
    # expands to every integer in [2009, 2016].
    vlan_ids: set[int] = set()
    # DBA profile catalogue: keyed by ID, value carries name + bandwidth ceilings.
    dba_profiles: dict[int, dict[str, Any]] = {}
    current_dba_id: int | None = None
    # Per-line-profile ONU counts: how many ONUs each line profile is bound to,
    # weighted across PON ports. Reflects the actual subscription tier mix.
    line_profile_counts: dict[str, int] = {}
    # Line-profile definitions captured at top level: name → {dba, vlan, id}.
    # We then enrich on the rendering side ("line_2009 backed by dba_1, on
    # VLAN 2009").
    line_profile_defs: dict[str, dict[str, Any]] = {}
    current_line_profile_name: str | None = None
    # Per-ONU details: serial → {line_profile, port}. Lets the UI drill from
    # a profile chip into the actual ONUs on that tier.
    onu_details: dict[str, dict[str, Any]] = {}
    # Last-seen onu_id within each gpon block, so per-onu lines (`onu N
    # profile line name X`) can attach themselves to a serial we already
    # parsed from the matching `onu add N profile … sn S` line.
    onu_id_to_serial_in_port: dict[int, dict[int, str]] = {}

    for line in text.splitlines():
        m = _INTERFACE_GPON_RE.match(line)
        if m:
            current_port_no = int(m.group(1))
            current_port = ports_by_no.setdefault(
                current_port_no,
                {
                    "port_no": current_port_no,
                    "type": "GPON",
                    "status": "up",
                    "onus": [],
                },
            )
            continue
        # Any OTHER interface line ends our GPON section. So does a top-level
        # `exit` once we've consumed the body — V1600 marks interface block
        # boundaries that way — and so does the start of a top-level `profile`
        # block.
        if current_port is not None and _OTHER_INTERFACE_RE.match(line) and not _INTERFACE_GPON_RE.match(line):
            current_port_no = None
            current_port = None
            continue
        if current_port is not None and (line.strip() == "exit" or line.lstrip().startswith("profile ")):
            current_port_no = None
            current_port = None
            # Don't `continue` — fall through so a `profile dba …` line on this
            # same iteration still gets a chance at the DBA matcher below.
        if current_port is None:
            # Outside any gpon interface — scan for top-level definitions:
            # VLAN inventory, DBA profile catalogue.
            vlan_range_m = _VLAN_RANGE_RE.match(line)
            if vlan_range_m:
                lo, hi = int(vlan_range_m.group(1)), int(vlan_range_m.group(2))
                for v in range(lo, hi + 1):
                    vlan_ids.add(v)
                continue
            vlan_single_m = _VLAN_SINGLE_RE.match(line)
            if vlan_single_m:
                vlan_ids.add(int(vlan_single_m.group(1)))
                continue
            dba_m = _DBA_PROFILE_RE.match(line)
            if dba_m:
                current_dba_id = int(dba_m.group(1))
                dba_profiles[current_dba_id] = {
                    "id": current_dba_id,
                    "name": dba_m.group(2),
                    "type": None,
                    "assured_kbps": None,
                    "maximum_kbps": None,
                }
                continue
            if current_dba_id is not None:
                bw_m = _DBA_BANDWIDTH_RE.match(line)
                if bw_m:
                    dba_profiles[current_dba_id]["type"] = int(bw_m.group(1))
                    dba_profiles[current_dba_id]["assured_kbps"] = int(bw_m.group(2)) if bw_m.group(2) else None
                    dba_profiles[current_dba_id]["maximum_kbps"] = int(bw_m.group(3))
                    current_dba_id = None
                    continue
                if line.strip() == "exit":
                    current_dba_id = None
                    continue
            # Top-level line-profile block.
            lp_def_m = _LINE_PROFILE_RE.match(line)
            if lp_def_m:
                current_line_profile_name = lp_def_m.group(2)
                line_profile_defs[current_line_profile_name] = {
                    "id": int(lp_def_m.group(1)),
                    "name": current_line_profile_name,
                    "dba": None,
                    "vlan": None,
                }
                continue
            if current_line_profile_name is not None:
                tcont_m = _TCONT_DBA_RE.match(line)
                if tcont_m:
                    line_profile_defs[current_line_profile_name]["dba"] = tcont_m.group(1)
                    continue
                svc_m = _SERVICE_VLAN_RE.match(line)
                if svc_m:
                    line_profile_defs[current_line_profile_name]["vlan"] = int(svc_m.group(1))
                    continue
                if line.strip() == "exit":
                    current_line_profile_name = None
                    continue
            continue
        if _SHUTDOWN_RE.match(line) and not _NO_SHUTDOWN_RE.match(line):
            current_port["status"] = "admin_down"
            continue
        onu_m = _ONU_ADD_RE.match(line)
        if onu_m:
            onu_id = int(onu_m.group(1))
            profile = onu_m.group(2)
            serial = onu_m.group(3)
            current_port["onus"].append({
                "onu_id": onu_id,
                "serial": serial,
                "profile": profile,
                "status": "active",
            })
            assert current_port_no is not None
            onu_id_to_serial_in_port.setdefault(current_port_no, {})[onu_id] = serial
            onu_details[serial] = {
                "serial": serial,
                "port_no": current_port_no,
                "onu_id": onu_id,
                "line_profile": None,
            }
            continue
        # Per-ONU line-profile assignment lines live inside the same gpon block,
        # one per line after the matching `onu add`. Count them by profile name
        # so we know subscription-tier distribution, and back-fill the per-ONU
        # detail map so the dashboard can drill from a tier into its serials.
        lp_m = _ONU_LINE_PROFILE_RE.match(line)
        if lp_m:
            prof_name = lp_m.group(2)
            line_profile_counts[prof_name] = line_profile_counts.get(prof_name, 0) + 1
            onu_id_int = int(lp_m.group(1))
            assert current_port_no is not None
            sn = onu_id_to_serial_in_port.get(current_port_no, {}).get(onu_id_int)
            if sn:
                onu_details.setdefault(sn, {
                    "serial": sn, "port_no": current_port_no, "onu_id": onu_id_int, "line_profile": None,
                })["line_profile"] = prof_name

    return {
        "hostname": hostname_m.group(1) if hostname_m else None,
        "model": _DEFAULT_MODEL,
        "sw_version": sw_m.group(1) if sw_m else None,
        "hw_version": hw_m.group(1) if hw_m else None,
        "ports": [ports_by_no[k] for k in sorted(ports_by_no.keys())],
        "vlans": sorted(vlan_ids),
        "dba_profiles": [dba_profiles[k] for k in sorted(dba_profiles.keys())],
        "line_profile_counts": [
            {"name": name, "count": count}
            for name, count in sorted(line_profile_counts.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "line_profile_defs": [
            line_profile_defs[k] for k in sorted(line_profile_defs.keys())
        ],
        "onu_details": list(onu_details.values()),
    }


def parse_optical_info(text: str) -> dict[str, Decimal | None]:
    """Parse a per-ONU optical-info block (PROVISIONAL — command syntax not verified).

    Returns ``{"rx_dbm": Decimal | None, "tx_dbm": Decimal | None}``.
    """
    rx = None
    tx = None
    m = _RX_POWER_RE.search(text)
    if m:
        try:
            rx = Decimal(m.group(1))
        except (ValueError, ArithmeticError):
            pass
    m = _TX_POWER_RE.search(text)
    if m:
        try:
            tx = Decimal(m.group(1))
        except (ValueError, ArithmeticError):
            pass
    return {"rx_dbm": rx, "tx_dbm": tx}


def _looks_like_failure(text: str) -> bool:
    """Heuristic for V1600 CLI rejection lines (``% Unknown command``, etc.)."""
    if not text:
        return False
    lowered = text.lower()
    return any(
        token in lowered
        for token in (
            "% unknown command",
            "% invalid input",
            "% incomplete command",
            "% error",
            "% ambiguous",
            "invalid input",
            "bad command",
            "command failed",
        )
    )


# ──────────────────────────────────────────────────────────────────────────
# Local SSH/PTY transport — NOT a CliTransport implementation.
#
# This is intentionally a private class inside the V1600 module: the dual-login
# flow doesn't fit the ``CliTransport`` Protocol cleanly (which assumes a normal
# shell), and forcing it through would muddy the contract for other drivers.
# ──────────────────────────────────────────────────────────────────────────


class _V1600Session:
    """asyncssh + PTY wrapper that handles dual-login + per-command read-until-prompt.

    NOT a :class:`CliTransport`. Lives inside this driver because the V1600's
    SSH-as-serial-port behaviour is unique to this firmware track.
    """

    def __init__(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        enable_password: str | None,
        connect_timeout: float = 30.0,
    ) -> None:
        self._host = host
        self._port = port
        self._username = username
        self._password = password
        self._enable_password = enable_password or password
        self._connect_timeout = connect_timeout
        self._conn: Any = None
        self._proc: Any = None
        self._hostname: str | None = None
        # Per-mode prompt regex (built once we see the first prompt). Match
        # plain ``ArmGponOLT2#`` plus any sub-mode like ``ArmGponOLT2(config)#``.
        self._prompt_re: re.Pattern[str] | None = None
        self._connected = False

    @property
    def hostname(self) -> str | None:
        return self._hostname

    async def _read_until_idle(self, idle: float = _IDLE_GAP_SECONDS) -> str:
        """Read stdout until ``idle`` seconds pass with no new bytes."""
        assert self._proc is not None
        buf: list[str] = []
        total = 0
        while True:
            try:
                chunk = await asyncio.wait_for(
                    self._proc.stdout.read(16384), timeout=idle,
                )
            except asyncio.TimeoutError:
                break
            except Exception:  # noqa: BLE001
                break
            if not chunk:
                break
            buf.append(chunk)
            total += len(chunk)
            if total > _OUTPUT_BYTE_CAP:
                break
        return "".join(buf)

    async def _read_until_prompt(self) -> str:
        """Read stdout until the cached prompt regex matches the tail, or idle gap."""
        assert self._proc is not None
        if self._prompt_re is None:
            return await self._read_until_idle()
        buf: list[str] = []
        total = 0
        while True:
            try:
                chunk = await asyncio.wait_for(
                    self._proc.stdout.read(16384), timeout=_READ_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                # No more bytes for a full read window — give the device a small
                # idle gap to confirm the command is done, then bail.
                tail = "".join(buf)
                if self._prompt_re.search(tail[-256:] if tail else ""):
                    return tail
                # One more short wait to confirm true idle.
                try:
                    extra = await asyncio.wait_for(
                        self._proc.stdout.read(16384),
                        timeout=_IDLE_GAP_SECONDS,
                    )
                except asyncio.TimeoutError:
                    return tail
                except Exception:  # noqa: BLE001
                    return tail
                if not extra:
                    return tail
                buf.append(extra)
                total += len(extra)
                continue
            except Exception:  # noqa: BLE001
                return "".join(buf)
            if not chunk:
                return "".join(buf)
            buf.append(chunk)
            total += len(chunk)
            tail = "".join(buf)
            if self._prompt_re.search(tail[-512:]):
                return tail
            if total > _OUTPUT_BYTE_CAP:
                return tail

    def _build_prompt_regex(self, hostname: str) -> re.Pattern[str]:
        """Compile a prompt matcher from the device hostname.

        Matches ``<hostname>#`` and sub-modes like ``<hostname>(config)#``.
        """
        escaped = re.escape(hostname)
        return re.compile(rf"\r?\n?{escaped}(?:\([\w\-]+\))?#\s*$")

    async def connect(self) -> None:
        if self._connected:
            return
        try:
            import asyncssh  # type: ignore
        except ImportError as e:  # pragma: no cover — surfaced at runtime only
            raise OltConnectionError(
                "asyncssh is required for VsolV1600Driver — pip install asyncssh"
            ) from e
        try:
            self._conn = await asyncio.wait_for(
                asyncssh.connect(
                    self._host,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    known_hosts=None,
                    kex_algs=_KEX_ALGS,
                    encryption_algs=_ENCRYPTION_ALGS,
                    mac_algs=_MAC_ALGS,
                    client_keys=None,
                ),
                timeout=self._connect_timeout,
            )
        except asyncio.TimeoutError as e:
            raise OltConnectionError(
                f"VsolV1600: SSH connect to {self._host}:{self._port} timed out"
            ) from e
        except Exception as e:  # noqa: BLE001
            # asyncssh.PermissionDenied → bad SSH-layer credentials.
            msg = str(e) or e.__class__.__name__
            if "permission" in msg.lower() or "denied" in msg.lower():
                raise OltCredentialsError(
                    f"VsolV1600: SSH authentication rejected by {self._host}: {msg}"
                ) from e
            raise OltConnectionError(
                f"VsolV1600: SSH connect to {self._host} failed: {msg}"
            ) from e

        try:
            self._proc = await self._conn.create_process(
                term_type="xterm", encoding="utf-8",
            )
        except Exception as e:  # noqa: BLE001
            raise OltConnectionError(
                f"VsolV1600: failed to allocate PTY on {self._host}: {e}"
            ) from e

        # 1. Drain banner up to (and including) the device's own ``Login:`` prompt.
        await asyncio.sleep(_BANNER_DRAIN_SECONDS)
        banner = await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)

        # 2. CLI login (same creds as SSH on this device).
        self._proc.stdin.write(self._username + "\n")
        await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)
        self._proc.stdin.write(self._password + "\n")
        # 3. After the password the device emits user-mode prompt like
        #    "ArmGponOLT2> ". Capture the hostname from the first prompt.
        prompt_text = await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)
        full_after_login = banner + prompt_text
        host_m = re.search(r"([A-Za-z][\w\-]*)\s*[>#]\s*$", prompt_text)
        if host_m:
            self._hostname = host_m.group(1)
        else:
            # Fall back: maybe the device echoed the prompt earlier in the banner.
            fallback = re.search(
                r"([A-Za-z][\w\-]*)\s*[>#]\s*$", full_after_login.rstrip(),
            )
            self._hostname = fallback.group(1) if fallback else None
        if not self._hostname:
            raise OltConnectionError(
                "VsolV1600: never saw a CLI prompt after dual-login — "
                "device may have rejected credentials or be in a non-CLI mode"
            )
        self._prompt_re = self._build_prompt_regex(self._hostname)

        # 4. Enable + enable password.
        self._proc.stdin.write("en\n")
        await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)
        self._proc.stdin.write(self._enable_password + "\n")
        await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)

        # 5. Disable pagination.
        self._proc.stdin.write("terminal length 0\n")
        await self._read_until_idle(idle=_READ_TIMEOUT_SECONDS)

        self._connected = True

    async def execute(self, command: str) -> str:
        """Send a command, return everything between the echoed command and the prompt.

        Raises :class:`OltConnectionError` if called before :meth:`connect`.
        """
        if not self._connected or self._proc is None:
            raise OltConnectionError(
                "VsolV1600 session: execute() before connect()"
            )
        self._proc.stdin.write(command + "\n")
        raw = await self._read_until_prompt()
        # Strip the leading echo of the command itself if present.
        if raw:
            first_nl = raw.find("\n")
            if first_nl >= 0 and command in raw[: first_nl + 1]:
                raw = raw[first_nl + 1 :]
        # Strip the trailing prompt from the buffer so callers get pure output.
        if self._prompt_re is not None:
            raw = self._prompt_re.sub("", raw).rstrip("\r\n") + ""
        return raw

    async def close(self) -> None:
        if self._proc is not None:
            try:
                self._proc.close()
            except Exception:  # noqa: BLE001
                pass
            self._proc = None
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:  # noqa: BLE001
                pass
            try:
                # asyncssh connections expose wait_closed.
                await self._conn.wait_closed()
            except Exception:  # noqa: BLE001
                pass
            self._conn = None
        self._connected = False


# ──────────────────────────────────────────────────────────────────────────
# VsolV1600Driver — OltDriver Protocol implementation.
# ──────────────────────────────────────────────────────────────────────────


class VsolV1600Driver:
    """Concrete OLT driver for VSOL V1600G1-B (firmware V1.4.7R).

    Factory-compatible constructor — same kwargs every other driver accepts.
    A ``session=`` kwarg is provided as a testing seam: tests pass a fake object
    that exposes ``connect()`` / ``execute(cmd)`` / ``close()`` and the driver
    will use it instead of building a real SSH session.
    """

    vendor: str = "vsol_v1600"

    def __init__(
        self,
        *,
        host: str | None = None,
        port: int | None = None,
        credentials: dict | None = None,
        olt_record_id: str | None = None,
        session: Any | None = None,
    ) -> None:
        self._host = host
        self._port = port or 22
        self._credentials = dict(credentials) if credentials else {}
        self._olt_record_id = olt_record_id
        self._session: Any | None = session
        self._owns_session = session is None  # we built it → we close it
        self._connected = False
        self._closed = False
        # Cached topology from the last running-config pull. Service layer can
        # use this to avoid double-pulling within a single request.
        self._last_topology: dict[str, Any] | None = None

    # ------------------------------------------------------------------ wiring

    def _build_session(self) -> _V1600Session:
        if not self._host:
            raise OltConnectionError(
                "VsolV1600Driver: no host configured — pass host= or inject session="
            )
        username = self._credentials.get("username")
        password = self._credentials.get("password")
        enable_password = self._credentials.get("enable_password") or password
        if not username or not password:
            raise OltCredentialsError(
                "VsolV1600Driver: credentials must include username + password"
            )
        return _V1600Session(
            host=self._host,
            port=self._port,
            username=username,
            password=password,
            enable_password=enable_password,
        )

    async def _ensure_connected(self) -> None:
        if self._connected:
            return
        if self._session is None:
            self._session = self._build_session()
        await self._session.connect()
        self._connected = True

    async def close(self) -> None:
        if self._closed:
            return
        if self._session is not None and self._owns_session:
            try:
                await self._session.close()
            except Exception:  # noqa: BLE001
                pass
        self._closed = True
        self._connected = False

    # ------------------------------------------------------------- topology pull

    async def pull_topology(self) -> dict[str, Any]:
        """Pull ``show running-config`` live and return a structured topology dict.

        NOT part of :class:`OltDriver` — this is the extension point the NOC
        live-refresh service calls. Shape::

            {"hostname": str, "model": str, "sw_version": str,
             "ports": [{"port_no": int, "type": "GPON",
                        "status": "up" | "admin_down",
                        "onus": [{"onu_id": int, "serial": str,
                                  "profile": str, "status": "active"}]}]}
        """
        await self._ensure_connected()
        assert self._session is not None
        config_text = await self._session.execute("show running-config")
        if _looks_like_failure(config_text):
            raise OltCommandError(
                "V1600 rejected 'show running-config' — privilege level may be wrong"
            )
        topo = parse_running_config(config_text)
        # Hostname fallback: if running-config didn't include a hostname line,
        # use the prompt we captured during connect.
        if not topo.get("hostname"):
            sess_host = getattr(self._session, "hostname", None)
            if sess_host:
                topo["hostname"] = sess_host
        self._last_topology = topo
        return topo

    # ------------------------------------------------------------------ status

    async def get_status(self) -> OltStatus:
        topo = await self.pull_topology()
        ports = topo.get("ports") or []
        return OltStatus(
            reachable=True,
            vendor=self.vendor,
            model=topo.get("model") or _DEFAULT_MODEL,
            sw_version=topo.get("sw_version"),
            chassis_count=1 if ports else 0,
            card_count=1 if ports else 0,
            port_count=len(ports),
            last_seen_at=datetime.now(timezone.utc),
            raw={
                "hostname": topo.get("hostname"),
                "hw_version": topo.get("hw_version"),
                "port_summary": [
                    {"port_no": p["port_no"], "onu_count": len(p["onus"])}
                    for p in ports
                ],
            },
        )

    async def get_uptime(self) -> OltUptime:
        # PROVISIONAL: firmware V1.4.7R doesn't expose a clean uptime command.
        raise OltNotSupportedError(
            "V1600 firmware V1.4.7R does not expose a parseable uptime command"
        )

    # ------------------------------------------------------------- provisioning

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
        # PROVISIONAL: command syntax mirrors the running-config grammar (which
        # is round-trippable on this firmware), but VLAN binding is best-effort.
        await self._ensure_connected()
        assert self._session is not None
        onu_id = await self._next_free_onu_id(port)
        await self._session.execute("configure terminal")
        await self._session.execute(f"interface gpon 0/{port}")
        add_out = await self._session.execute(
            f"onu add {onu_id} profile {line_profile} sn {serial}"
        )
        await self._session.execute("exit")
        await self._session.execute("exit")
        if _looks_like_failure(add_out):
            raise OltCommandError(
                f"V1600 onu add failed for serial {serial!r}: {add_out.strip()}"
            )
        # Drop the cached topology so the next pull reflects the new ONU.
        self._last_topology = None
        return OnuProvisionResult(
            serial=serial,
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            line_profile=line_profile,
            onu_id=str(onu_id),
            provisioned_at=datetime.now(timezone.utc),
            raw={"onu_add": add_out, "customer_ref": customer_ref},
        )

    async def delete_onu(self, *, serial: str) -> OnuDeleteResult:
        # PROVISIONAL: command syntax not verified on hardware yet.
        await self._ensure_connected()
        assert self._session is not None
        loc = await self._find_onu_location(serial)
        if loc is None:
            raise OltCommandError(
                f"V1600 could not find ONU with serial {serial!r} in running-config"
            )
        port_no, onu_id = loc
        await self._session.execute("configure terminal")
        await self._session.execute(f"interface gpon 0/{port_no}")
        del_out = await self._session.execute(f"no onu {onu_id}")
        await self._session.execute("exit")
        await self._session.execute("exit")
        if _looks_like_failure(del_out):
            raise OltCommandError(
                f"V1600 no-onu failed for serial {serial!r}: {del_out.strip()}"
            )
        self._last_topology = None
        return OnuDeleteResult(
            serial=serial,
            deleted_at=datetime.now(timezone.utc),
            raw={"no_onu": del_out, "port_no": port_no, "onu_id": onu_id},
        )

    # ------------------------------------------------------------ optical power

    async def get_optical_power(
        self,
        *,
        target_type: Literal["olt_port", "onu"],
        target_id: str,
    ) -> OpticalPower:
        # PROVISIONAL: command syntax not verified on hardware yet. If parsing
        # fails the caller gets a clear OltCommandError so we can revise once
        # the real command name is known.
        await self._ensure_connected()
        assert self._session is not None
        if target_type == "olt_port":
            # target_id of form "slot/port" or just "port" — V1600 only has 0/N.
            port_no = int(target_id.split("/")[-1])
            cmd = f"show interface gpon 0/{port_no} optical-info"
        elif target_type == "onu":
            loc = await self._find_onu_location(target_id)
            if loc is None:
                raise OltCommandError(
                    f"V1600 could not find ONU with serial {target_id!r}"
                )
            port_no, onu_id = loc
            cmd = f"show interface gpon 0/{port_no} onu {onu_id} optical-info"
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        text = await self._session.execute(cmd)
        if _looks_like_failure(text):
            raise OltCommandError(
                f"V1600 optical-info query failed for {target_id!r}: {text.strip()}"
            )
        parsed = parse_optical_info(text)
        rx = parsed.get("rx_dbm")
        if rx is None:
            raise OltCommandError(
                f"V1600 optical-info output did not contain an Rx line for {target_id!r}"
            )
        return OpticalPower(
            target_type=target_type,
            target_id=target_id,
            rx_dbm=rx,
            tx_dbm=parsed.get("tx_dbm"),
            sampled_at=datetime.now(timezone.utc),
            raw={"command": cmd, "output": text},
        )

    # ------------------------------------------------------------------ VLAN

    async def set_vlan(
        self,
        *,
        slot: int,
        port: int,
        vlan_id: int,
        purpose: str,
    ) -> VlanSetResult:
        # PROVISIONAL: command syntax not verified on hardware yet. The V1600
        # accepts ``vlan <id>`` at config view; per-port binding likely lives
        # inside the interface block.
        await self._ensure_connected()
        assert self._session is not None
        await self._session.execute("configure terminal")
        vlan_out = await self._session.execute(f"vlan {vlan_id}")
        await self._session.execute("exit")
        bind_out = await self._session.execute(f"interface gpon 0/{port}")
        port_out = await self._session.execute(f"port vlan {vlan_id}")
        await self._session.execute("exit")
        await self._session.execute("exit")
        for out in (vlan_out, port_out):
            if _looks_like_failure(out):
                raise OltCommandError(
                    f"V1600 vlan apply failed (slot={slot} port={port} vlan={vlan_id}): {out.strip()}"
                )
        return VlanSetResult(
            slot=slot,
            port=port,
            vlan_id=vlan_id,
            purpose=purpose,
            applied_at=datetime.now(timezone.utc),
            raw={
                "vlan_create": vlan_out,
                "iface_enter": bind_out,
                "port_vlan": port_out,
                "purpose": purpose,
            },
        )

    # ------------------------------------------------------------ line profile

    async def apply_line_profile(
        self,
        *,
        target_type: Literal["olt_port", "onu"],
        target_id: str,
        profile_name: str,
    ) -> LineProfileResult:
        # PROVISIONAL: command syntax not verified on hardware yet.
        await self._ensure_connected()
        assert self._session is not None
        if target_type == "onu":
            loc = await self._find_onu_location(target_id)
            if loc is None:
                raise OltCommandError(
                    f"V1600 could not find ONU with serial {target_id!r}"
                )
            port_no, onu_id = loc
            await self._session.execute("configure terminal")
            await self._session.execute(f"interface gpon 0/{port_no}")
            out = await self._session.execute(
                f"onu {onu_id} profile {profile_name}"
            )
            await self._session.execute("exit")
            await self._session.execute("exit")
        elif target_type == "olt_port":
            port_no = int(target_id.split("/")[-1])
            await self._session.execute("configure terminal")
            await self._session.execute(f"interface gpon 0/{port_no}")
            out = await self._session.execute(f"profile {profile_name}")
            await self._session.execute("exit")
            await self._session.execute("exit")
        else:
            raise OltCommandError(f"Unknown target_type {target_type!r}")
        if _looks_like_failure(out):
            raise OltCommandError(
                f"V1600 line-profile apply failed for {target_type}={target_id!r}: {out.strip()}"
            )
        return LineProfileResult(
            target_type=target_type,
            target_id=target_id,
            profile_name=profile_name,
            applied_at=datetime.now(timezone.utc),
            raw={"profile_apply": out, "profile_name": profile_name},
        )

    # ------------------------------------------------------------------ helpers

    async def _find_onu_location(self, serial: str) -> tuple[int, int] | None:
        """Return ``(port_no, onu_id)`` for the given serial, scanning running-config."""
        topo = self._last_topology or await self.pull_topology()
        for p in topo.get("ports") or []:
            for onu in p.get("onus") or []:
                if onu.get("serial") == serial:
                    return (int(p["port_no"]), int(onu["onu_id"]))
        return None

    async def _next_free_onu_id(self, port_no: int) -> int:
        """Pick the smallest unused ONU id (1..128) on the given port."""
        topo = self._last_topology or await self.pull_topology()
        used: set[int] = set()
        for p in topo.get("ports") or []:
            if int(p["port_no"]) != port_no:
                continue
            for onu in p.get("onus") or []:
                used.add(int(onu["onu_id"]))
        for candidate in range(1, 129):
            if candidate not in used:
                return candidate
        raise OltCommandError(
            f"V1600 port {port_no}: no free ONU id in 1..128 (all 128 slots in use)"
        )


# ──────────────────────────────────────────────────────────────────────────
# Factory auto-registration — importing this module registers vendor='vsol_v1600'.
# ──────────────────────────────────────────────────────────────────────────


def _register() -> None:
    from ..factory import register_driver

    register_driver("vsol_v1600", VsolV1600Driver)


_register()
