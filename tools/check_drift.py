"""Architecture-drift guard — Phase 6 governance.

Scans the repo for forbidden patterns ruled out by the canonicals introduced
in Phases 1-4. Exits non-zero if any HARD rule is violated, or if a RATCHET
counter has INCREASED past its baseline.

Hard rules (immediate fail):
  * Local `def _deny(perm:` in any router (BL-10) — must `from
    app.utils.http_errors import deny as _deny`.
  * Local `def _parse_dt(` in any router (BL-5) — must use
    `app.utils.dt.parse_iso_dt`.
  * Direct `httpx.AsyncClient(` outside `app/utils/http_client.py` (AC-5)
  * Inline `HTTPException(202, detail={"status": "approval_required"`
    (PC-2) — must use `approval_required(...)` from `utils.http_errors`.
  * Local `def _amd(` or `def amd(` in any router (BL-2).
  * Local `const authH =` anywhere under `frontend/src/`, `frontend-portal/src/`
    (AC-1).
  * Local `function fmtDate(`, `function fmtDateTime(`, `function moneyDecimal(`
    (DF-4/5/6).
  * `aria-pressed=` on a `role="tab"` (TB-5).

Ratchet rules (fail if count INCREASES vs baseline):
  * `let alive = true` blocks in frontend (DF-1/2; baseline 54 — Phase 5 target 0)
  * Raw `fetch(${BASE}/...)` calls in frontend (AC-2; baseline 96)
  * Raw `className="btn btn-..."` instances (Phase-5 Button migration; baseline 428)
  * Raw `className="inp"` instances (Phase-5 Input migration; baseline 6)

Usage:
    python tools/check_drift.py            # check
    python tools/check_drift.py --update   # update baseline (use with care)

Exit codes:
    0 — all rules pass
    1 — hard-rule violation
    2 — ratchet violation (count increased)
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BASELINE_PATH = REPO / "tools" / "check_drift_baseline.json"


# ─────────────────────────────────────────────────────────────────────
# Hard rules — any match in scope = immediate failure.
# ─────────────────────────────────────────────────────────────────────

@dataclass
class HardRule:
    name: str
    description: str
    pattern: str
    paths: list[str]
    exclude: list[str] = field(default_factory=list)
    regex: bool = False


HARD_RULES: list[HardRule] = [
    HardRule(
        name="BL-10 local _deny def",
        description="Routers must `from app.utils.http_errors import deny as _deny`.",
        pattern=r"^def _deny\(perm: str\)",
        paths=["backend/app/routers/"],
        exclude=["records.py"],  # records._deny has different sig (entity_key, verb)
        regex=True,
    ),
    HardRule(
        name="BL-5 local _parse_dt def",
        description="Routers must use `app.utils.dt.parse_iso_dt` (directly or via local alias delegating to it).",
        pattern=r"^def _parse_(?:dt|iso)\(.+\):\n    (?:if )?value",
        paths=["backend/app/routers/"],
        regex=True,
    ),
    HardRule(
        name="AC-5 direct httpx.AsyncClient",
        description="Use `app.utils.http_client.get_async_client(timeout=...)` instead.",
        pattern=r"httpx\.AsyncClient\(",
        paths=["backend/app/"],
        exclude=["utils/http_client.py"],
        regex=True,
    ),
    HardRule(
        name="PC-2 inline approval_required HTTPException",
        description='Use `raise approval_required(approval_id, action_type)` from `app.utils.http_errors`.',
        pattern=r'HTTPException\(202,\s*detail=\{[^}]*"status":\s*"approval_required"',
        paths=["backend/app/"],
        exclude=["utils/http_errors.py"],
        regex=True,
    ),
    HardRule(
        name="BL-2 local AMD formatter def",
        description="Use `app.utils.money.amd_format` (or import as a local alias).",
        # Match a local def that ALSO contains the legacy body (returns f"..."
        # with the dram suffix). A thin wrapper `_amd = amd_format` or a body
        # like `return amd_format(int(luma))` delegating to the canonical
        # passes the rule.
        pattern=r'^def _?amd\(luma[^)]*\)[^\n]*:\n\s+return f"\{',
        paths=["backend/app/"],
        exclude=["utils/money.py"],
        regex=True,
    ),
    HardRule(
        name="AC-1 local authH def",
        description="Import `authH` from `lib/billing` (admin) or use `req()` (portal).",
        pattern=r"^const authH = \(",
        paths=["frontend/src/", "frontend-portal/src/"],
        exclude=["lib/billing.ts"],
        regex=True,
    ),
    HardRule(
        name="DF-4 local fmtDate def",
        description="Use `fmtDate` from `lib/time.ts`.",
        pattern=r"^function fmtDate\(",
        paths=["frontend/src/"],
        exclude=["lib/time.ts"],
        regex=True,
    ),
    HardRule(
        name="DF-5 local fmtDateTime def",
        description="Use `fmtDateTime` from `lib/time.ts`.",
        pattern=r"^function fmtDateTime\(",
        paths=["frontend/src/"],
        exclude=["lib/time.ts"],
        regex=True,
    ),
    HardRule(
        name="DF-6 local moneyDecimal/moneyDec def",
        description="Use `moneyDecStr` from `lib/money.ts`.",
        pattern=r"^function money(?:Decimal|Dec)\(",
        paths=["frontend/src/"],
        exclude=["lib/money.ts"],
        regex=True,
    ),
    HardRule(
        name="TB-5 aria-pressed on a tab",
        description="`role=\"tab\"` requires `aria-selected`, not `aria-pressed`.",
        pattern=r'role="tab"[^/]*aria-pressed|aria-pressed[^/]*role="tab"',
        paths=["frontend/src/", "frontend-portal/src/"],
        regex=True,
    ),
    # SM-1 — demoted to a ratchet rule below (45 views still take token; per-
    # view incremental migration). Promote back to HARD when count reaches 0.
]


# ─────────────────────────────────────────────────────────────────────
# Ratchet rules — count must not exceed baseline.
# ─────────────────────────────────────────────────────────────────────

@dataclass
class RatchetRule:
    name: str
    description: str
    pattern: str
    paths: list[str]
    regex: bool = False


RATCHET_RULES: list[RatchetRule] = [
    RatchetRule(
        name="DF-1/DF-2 alive guard",
        description="Use `useFetch`/`useFetched` from `hooks/useFetch.ts`. Baseline shrinks each phase.",
        pattern=r"let alive = true",
        paths=["frontend/src/"],
        regex=True,
    ),
    RatchetRule(
        name="AC-2 raw fetch in view",
        description="Use `bget`/`bpost` from `lib/billing` (or `useFetch`). Baseline shrinks each phase.",
        pattern=r"fetch\(`\$\{BASE\}",
        paths=["frontend/src/views/", "frontend/src/studio/", "frontend/src/components/"],
        regex=True,
    ),
    RatchetRule(
        name="Phase-5 raw btn-md",
        description="Migrate to `<Button>` primitive (Phase 5c).",
        pattern=r'className="btn btn-',
        paths=["frontend/src/"],
        regex=True,
    ),
    RatchetRule(
        name="Phase-5 raw inp",
        description="Migrate to `<Input>` primitive (Phase 5c).",
        pattern=r'className="inp"',
        paths=["frontend/src/"],
        regex=True,
    ),
    RatchetRule(
        name="SM-1 view with token: string prop",
        description="Admin views should consume token via `useAuth()`. Migrate per view as touched.",
        pattern=r"^export default function \w+View\([^)]*token: string",
        paths=["frontend/src/views/"],
        regex=True,
    ),
]


# ─────────────────────────────────────────────────────────────────────
# Scanner
# ─────────────────────────────────────────────────────────────────────

EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".css"}


def iter_files(roots: list[str], excludes: list[str]) -> list[Path]:
    out: list[Path] = []
    # Normalize excludes to forward-slash form so they match on both Windows
    # and POSIX paths uniformly.
    norm_excludes = [ex.replace("\\", "/") for ex in excludes]
    for root in roots:
        base = REPO / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix not in EXTENSIONS:
                continue
            posix = path.as_posix()
            if any(seg in posix for seg in (
                "node_modules", "__pycache__", ".venv", ".pytest_cache",
                ".ruff_cache", "dist", "build", ".storybook-static",
            )):
                continue
            if any(path.name == ex or posix.endswith(ex) for ex in norm_excludes):
                continue
            out.append(path)
    return out


def count_pattern(rule, files: list[Path]) -> tuple[int, list[tuple[Path, int, str]]]:
    """Return (count, sample list-of-(file, lineno, line)). Sample is capped at 5."""
    if rule.regex:
        rx = re.compile(rule.pattern, re.MULTILINE)
    else:
        rx = None
    count = 0
    sample: list[tuple[Path, int, str]] = []
    for p in files:
        try:
            text = p.read_text(encoding="utf-8")
        except Exception:
            continue
        if rule.regex:
            assert rx is not None
            matches = list(rx.finditer(text))
            count += len(matches)
            if len(sample) < 5 and matches:
                # Compute line number from offset.
                for m in matches[:5 - len(sample)]:
                    line_no = text.count("\n", 0, m.start()) + 1
                    line_text = text.splitlines()[line_no - 1] if line_no - 1 < len(text.splitlines()) else ""
                    sample.append((p, line_no, line_text.strip()[:120]))
        else:
            hits = text.count(rule.pattern)
            count += hits
            if len(sample) < 5 and hits > 0:
                for i, line in enumerate(text.splitlines(), start=1):
                    if rule.pattern in line:
                        sample.append((p, i, line.strip()[:120]))
                        if len(sample) >= 5:
                            break
    return count, sample


def load_baseline() -> dict:
    if not BASELINE_PATH.exists():
        return {}
    return json.loads(BASELINE_PATH.read_text(encoding="utf-8"))


def save_baseline(baseline: dict) -> None:
    BASELINE_PATH.write_text(json.dumps(baseline, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    update = "--update" in sys.argv
    hard_failures: list[str] = []
    ratchet_failures: list[str] = []

    print("== HARD rules ==")
    for rule in HARD_RULES:
        files = iter_files(rule.paths, rule.exclude)
        count, sample = count_pattern(rule, files)
        if count > 0:
            hard_failures.append(rule.name)
            print(f"  FAIL {rule.name}: {count} match(es)")
            print(f"        {rule.description}")
            for p, ln, line in sample[:3]:
                rel = p.relative_to(REPO)
                print(f"        {rel}:{ln}: {line}")
        else:
            print(f"  OK   {rule.name}")

    baseline = load_baseline()
    new_baseline: dict = dict(baseline)

    print("\n== RATCHET rules ==")
    for rule in RATCHET_RULES:
        files = iter_files(rule.paths, [])
        count, _ = count_pattern(rule, files)
        prev = baseline.get(rule.name)
        if update:
            new_baseline[rule.name] = count
            print(f"  SET  {rule.name}: {count} (was {prev})")
            continue
        if prev is None:
            # Establish baseline on first run.
            new_baseline[rule.name] = count
            print(f"  INIT {rule.name}: {count} (baseline established)")
            continue
        if count > prev:
            ratchet_failures.append(rule.name)
            print(f"  FAIL {rule.name}: {count} > baseline {prev} (+{count - prev})")
            print(f"        {rule.description}")
        elif count < prev:
            new_baseline[rule.name] = count
            print(f"  GOOD {rule.name}: {count} < baseline {prev} (baseline lowered)")
        else:
            print(f"  OK   {rule.name}: {count} == baseline")

    # Save updated baseline on success / when --update.
    if not hard_failures and not ratchet_failures:
        save_baseline(new_baseline)

    if hard_failures:
        print(f"\nFAIL — {len(hard_failures)} hard rule(s) violated.")
        return 1
    if ratchet_failures:
        print(f"\nFAIL — {len(ratchet_failures)} ratchet rule(s) regressed (count went UP).")
        return 2
    print("\nOK — all rules pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
