"""M1-C Phase 0 — MockRadiusBackend.

In-memory simulator. Sessions are tracked under ``sessions`` so dunning /
service-action tests can assert ``mock.sessions[sid]['status'] == 'started'``.

Behaviour summary
=================
* ``authenticate`` returns ``allowed=True`` and a deterministic ``framed_ip``
  in ``10.200.x.y`` (derived from a hash of the username) — UNLESS the password
  ends in ``deny`` in which case ``allowed=False``.
* ``acct_start`` registers the session.
* ``acct_stop`` flips the session status + accumulates byte counters.
* ``disconnect`` removes the session and returns ``status='ok'``.
"""
from __future__ import annotations

import hashlib
from typing import Any

from .backend import RadiusAcctResult, RadiusAuthResult, RadiusDisconnectResult


def _derive_ip(username: str) -> str:
    """Deterministic 10.200.X.Y from a username hash."""
    h = hashlib.sha256(username.encode("utf-8")).digest()
    return f"10.200.{h[0]}.{h[1] or 1}"


class MockRadiusBackend:
    """In-memory RADIUS backend simulator."""

    provider: str = "mock"

    def __init__(self) -> None:
        # session_id → {username, status, framed_ip, octets_in, octets_out, ...}
        self.sessions: dict[str, dict[str, Any]] = {}
        # ordered call history
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def reset(self) -> None:
        self.sessions.clear()
        self.calls.clear()

    def _track(self, op: str, **kwargs: Any) -> None:
        self.calls.append((op, kwargs))

    async def authenticate(
        self,
        *,
        username: str,
        password: str,
        nas_ip: str | None = None,
        nas_port: str | None = None,
        calling_station_id: str | None = None,
    ) -> RadiusAuthResult:
        self._track(
            "authenticate", username=username, nas_ip=nas_ip,
            nas_port=nas_port, calling_station_id=calling_station_id,
        )
        if password.endswith("deny"):
            return RadiusAuthResult(
                allowed=False,
                framed_ip=None,
                attributes={"Reply-Message": "denied by mock"},
                raw={"mock": True, "reason": "password ends in 'deny'"},
            )
        framed_ip = _derive_ip(username)
        return RadiusAuthResult(
            allowed=True,
            framed_ip=framed_ip,
            attributes={
                "Framed-IP-Address": framed_ip,
                "Acct-Interim-Interval": 300,
                "Session-Timeout": 86400,
            },
            raw={"mock": True},
        )

    async def acct_start(
        self,
        *,
        session_id: str,
        username: str,
        nas_ip: str | None = None,
        framed_ip: str | None = None,
    ) -> RadiusAcctResult:
        self._track(
            "acct_start", session_id=session_id, username=username,
            nas_ip=nas_ip, framed_ip=framed_ip,
        )
        self.sessions[session_id] = {
            "username": username,
            "status": "started",
            "framed_ip": framed_ip or _derive_ip(username),
            "octets_in": 0,
            "octets_out": 0,
        }
        return RadiusAcctResult(
            session_id=session_id, status="ok", raw={"mock": True},
        )

    async def acct_stop(
        self,
        *,
        session_id: str,
        username: str,
        octets_in: int = 0,
        octets_out: int = 0,
        termination_cause: str | None = None,
    ) -> RadiusAcctResult:
        self._track(
            "acct_stop", session_id=session_id, username=username,
            octets_in=octets_in, octets_out=octets_out,
            termination_cause=termination_cause,
        )
        sess = self.sessions.get(session_id)
        if sess is None:
            # Some BNGs send Stop without a prior Start (NAS reboot). Tolerate it.
            self.sessions[session_id] = {
                "username": username, "status": "stopped",
                "octets_in": octets_in, "octets_out": octets_out,
                "termination_cause": termination_cause,
            }
        else:
            sess["status"] = "stopped"
            sess["octets_in"] = octets_in
            sess["octets_out"] = octets_out
            sess["termination_cause"] = termination_cause
        return RadiusAcctResult(
            session_id=session_id, status="ok", raw={"mock": True},
        )

    async def disconnect(
        self,
        *,
        session_id: str,
        username: str,
        nas_ip: str | None = None,
    ) -> RadiusDisconnectResult:
        self._track(
            "disconnect", session_id=session_id, username=username, nas_ip=nas_ip,
        )
        sess = self.sessions.pop(session_id, None)
        return RadiusDisconnectResult(
            session_id=session_id,
            status="ok" if sess is not None else "not-found",
            raw={"mock": True, "found": sess is not None},
        )
