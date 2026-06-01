"""NOC Phase B — DiagnosticAdapter protocol + v1 SimulatedDiagnosticAdapter.

Sibling of ``network_adapter.py``. Where NetworkAdapter actuates dunning steps,
DiagnosticAdapter READS optical telemetry (Rx/Tx power) and runs OTDR traces. v1
returns deterministic synthetic values keyed off (source_type, source_id) — no
real OLT/EMS contact. A real Huawei/ZTE adapter slots in behind the same Protocol.

Threshold rule for optical Rx (single source of truth — both the reading status
field AND the dashboard rollup use this):
  rx_dbm <  -28.0                  → 'critical'
  -28.0 <= rx_dbm <  -26.0          → 'warning'
  else                              → 'normal'
"""
from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Protocol, TypedDict
from uuid import UUID


# --------------------------------------------------------------------------------------
# Result shapes
# --------------------------------------------------------------------------------------

class OpticalReading(TypedDict):
    rx_dbm: Decimal
    tx_dbm: Decimal | None
    status: str   # 'normal' | 'warning' | 'critical'


class OtdrResult(TypedDict):
    trace_distance_m: int
    loss_db: Decimal
    events: list[dict]   # [{distance_m, type, loss_db}]
    status: str          # 'pass' | 'fail'


# --------------------------------------------------------------------------------------
# Threshold (single source of truth)
# --------------------------------------------------------------------------------------

def classify_rx(rx_dbm: Decimal) -> str:
    """Map an Rx power reading to {'normal','warning','critical'}.

    rx_dbm <  -28.0                  → 'critical'
    -28.0 <= rx_dbm <  -26.0          → 'warning'
    else                              → 'normal'
    """
    if rx_dbm < Decimal("-28.0"):
        return "critical"
    if rx_dbm < Decimal("-26.0"):
        return "warning"
    return "normal"


# --------------------------------------------------------------------------------------
# Protocol
# --------------------------------------------------------------------------------------

class DiagnosticAdapter(Protocol):
    async def read_optical_power(
        self, *, source_type: str, source_id: UUID,
    ) -> OpticalReading: ...

    async def run_otdr(
        self, *, target_type: str, target_id: UUID,
    ) -> OtdrResult: ...


# --------------------------------------------------------------------------------------
# v1: SimulatedDiagnosticAdapter
# --------------------------------------------------------------------------------------

def _hash_int(*parts: str) -> int:
    """Deterministic 32-bit-ish int derived from the concatenation of parts."""
    h = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big", signed=False)


def _scale(seed: int, lo: float, hi: float, *, decimals: int = 2) -> Decimal:
    """Map a non-negative int into [lo, hi) with the requested decimal precision."""
    span = hi - lo
    # Use a stable modulus so the same seed always yields the same value
    fraction = (seed % 100_000) / 100_000.0
    val = lo + (span * fraction)
    return Decimal(str(round(val, decimals)))


class SimulatedDiagnosticAdapter:
    """v1 — deterministic synthetic readings keyed off (source_type, source_id).

    Optical:
      * rx_dbm in [-30.0, -15.0] — distributed across the realistic ONU receive range
      * tx_dbm in [0.0, +3.0]
      * status derived from ``classify_rx``

    OTDR:
      * trace_distance_m in [200, 8000]
      * 3-5 events spread across the trace; each {distance_m, type, loss_db}
      * loss_db in [0.5, 2.5]; status='pass' when loss_db < 2.0 else 'fail'

    Same (source_type, source_id) → same values, always.
    """

    async def read_optical_power(
        self, *, source_type: str, source_id: UUID,
    ) -> OpticalReading:
        # Per-source deterministic Rx in a band that exercises all 3 status classes.
        seed_rx = _hash_int(source_type, str(source_id), "rx")
        rx = _scale(seed_rx, -30.0, -15.0, decimals=2)
        seed_tx = _hash_int(source_type, str(source_id), "tx")
        tx = _scale(seed_tx, 0.0, 3.0, decimals=2)
        return {
            "rx_dbm": rx,
            "tx_dbm": tx,
            "status": classify_rx(rx),
        }

    async def run_otdr(
        self, *, target_type: str, target_id: UUID,
    ) -> OtdrResult:
        seed = _hash_int(target_type, str(target_id), "otdr")
        # 200..8000m
        distance = 200 + (seed % (8000 - 200 + 1))
        # 3..5 events
        n_events = 3 + ((seed >> 8) % 3)
        events: list[dict] = []
        event_types = ["connector", "splice", "reflection", "fault"]
        for i in range(n_events):
            ev_seed = _hash_int(target_type, str(target_id), "event", str(i))
            ev_dist = max(1, int((ev_seed % distance)))
            ev_type = event_types[ev_seed % len(event_types)]
            ev_loss = _scale(ev_seed, 0.05, 0.6, decimals=2)
            events.append({
                "distance_m": ev_dist,
                "type": ev_type,
                "loss_db": str(ev_loss),
            })
        # Total trace loss in [0.5, 2.5]
        loss_seed = _hash_int(target_type, str(target_id), "loss")
        loss_db = _scale(loss_seed, 0.5, 2.5, decimals=2)
        status = "pass" if loss_db < Decimal("2.0") else "fail"
        return {
            "trace_distance_m": int(distance),
            "loss_db": loss_db,
            "events": events,
            "status": status,
        }


# --------------------------------------------------------------------------------------
# Factory
# --------------------------------------------------------------------------------------

_DEFAULT_ADAPTER: DiagnosticAdapter | None = None


def get_diagnostic_adapter() -> DiagnosticAdapter:
    """Single factory. Returns ``SimulatedDiagnosticAdapter`` for v1; future env switch
    picks the real Huawei/ZTE EMS adapter."""
    global _DEFAULT_ADAPTER
    if _DEFAULT_ADAPTER is None:
        _DEFAULT_ADAPTER = SimulatedDiagnosticAdapter()
    return _DEFAULT_ADAPTER
