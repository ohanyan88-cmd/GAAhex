"""Audit v4 D4 close-out (part 2) — PROVE a drift gate FAILS on a planted violation (not vacuously pass).

The forensic re-audit (G3) left "gates fail on a planted violation" UNPROVEN — it could only inspect the
drift checks read-only. This plants a known-bad pattern in a temp file, points the slug-agnostic drift
check at it, and asserts the check REPORTS the violation (count >= 1); a companion test feeds it clean
code and asserts 0. If the detector were a no-op (empty baseline / swallowed exit / wrong regex / dead
path), the first test would fail — so a green pair proves the gate genuinely bites.

The slug-agnostic check (Q4/R6) is chosen because it is a pure function over a path list + REPO root,
both monkeypatchable, so the violation is planted in a tmp file and the real repo is never touched.
"""
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]      # backend/tests -> backend -> repo root
sys.path.insert(0, str(_REPO / "tools"))
import check_drift  # noqa: E402  (tools/check_drift.py)


def test_slug_drift_gate_fires_on_planted_violation(tmp_path, monkeypatch):
    bad = tmp_path / "fake_records.py"
    # An entity-specific branch in a "generic" record router — exactly what R6 forbids.
    bad.write_text(
        "async def handler(slug):\n"
        "    if slug == 'lead':\n"
        "        return special_lead_path()\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(check_drift, "REPO", tmp_path)
    monkeypatch.setattr(check_drift, "_GENERIC_ROUTER_FILES", ["fake_records.py"])
    count, violations = check_drift.check_generic_router_slug_agnostic()
    assert count >= 1, "drift gate must DETECT a planted `slug == 'literal'` branch — it is not vacuous"


def test_slug_drift_gate_silent_on_clean_code(tmp_path, monkeypatch):
    clean = tmp_path / "fake_records.py"
    clean.write_text(
        "async def handler(slug):\n"
        "    return generic_dispatch(slug)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(check_drift, "REPO", tmp_path)
    monkeypatch.setattr(check_drift, "_GENERIC_ROUTER_FILES", ["fake_records.py"])
    count, _ = check_drift.check_generic_router_slug_agnostic()
    assert count == 0, "drift gate must NOT false-positive on slug-agnostic code"
