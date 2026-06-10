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
  * `next_reference_number(prefix='XYZ')` where XYZ is not in the canonical
    Std03 prefix registry (PR-1). Same self-enforcement pattern that closed
    the frontend D19 token rubbish — converts Std03 from "discipline" to
    "CI-enforced." Catches both invention (LAW-GV5 violation) and registry
    drift (LAW-GV1 amendment needed).
  * `continue-on-error: true` inside any RLS-named CI job in
    `.github/workflows/*.yml` (CI-1, zero baseline). TD13 close-out: the
    `backend-rls` job must stay a HARD gate — re-adding continue-on-error would
    silently turn dual-role RLS enforcement back into decoration.

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
# PR-1 — Canonical prefix registry (Standard 03, LOCKED, LAW-GV1 amendment #3).
# ─────────────────────────────────────────────────────────────────────
# Mirror of `docs/standards/03-identity-reference-naming-enum-standards.md`
# §Prefix Registry. Every `next_reference_number(prefix='XYZ')` call site
# in backend code MUST use a prefix that appears in CANONICAL_PREFIXES or
# DEPRECATED_PREFIX_ALIASES. Unknown prefixes fail the drift check.
#
# This converts the architecture-layer discipline ("Std03 is the single
# authoritative prefix registry") into CI-enforced reality. Same pattern
# that closed the frontend D19 token rubbish in 2026-06.
#
# To add a new prefix:
#   1. LAW-GV1 amendment to Standard 03 + IA8 §7.4 (architecture layer).
#   2. Mirror the addition here (catalog layer reflection).
#   3. Both changes land in the same commit.
#
# To deprecate a prefix:
#   1. LAW-GV1 amendment moves the entry from CANONICAL_PREFIXES to
#      DEPRECATED_PREFIX_ALIASES.
#   2. Existing reference numbers using the deprecated prefix are
#      immutable per Standard 03 rule 6 (no retroactive renaming).
CANONICAL_PREFIXES: frozenset[str] = frozenset({
    "ADD", "AIA", "AMD", "API", "APP", "APR", "APT", "ATT", "AUT",
    "BND", "BRC",
    "CAM", "CFG", "CHG", "CMP", "CMT", "CN", "CNT", "CNX", "COM", "CON",
    "CRD", "CTR", "CUS",
    "DEP", "DNG", "DOC",
    "EMP", "EPL", "EVT", "EXC", "EXE", "EXP", "EXT",
    "FAQ", "FBR", "FFL", "FJB", "FRC",
    "IMP", "INC", "INV", "IPP",
    "JOB",
    "KBA",
    "LED", "LIC", "LOC",
    "MNT", "MSG",
    "NDV", "NTF",
    "OAP", "OLT", "ONU", "ORD",
    "PAY", "PLN", "PRB", "PRD", "PRJ", "PRQ", "PRR", "PRT", "PTK", "PUR",
    "QUE", "QUO",
    "REC", "REL", "REN", "RES", "RLE", "ROL", "RPS", "RPT", "RTP", "RTR",
    "SAC", "SCH", "SIT", "SLA", "SOP", "SRQ", "STK", "SUB", "SVA", "SVC", "SWT",
    "TEM", "THR", "TKT", "TLS", "TNT", "TPL", "TSK",
    "USR",
    "VEN", "VHC",
    "WFI", "WFL", "WHK", "WIT", "WO",
})

# Aliases retained for backward-compatibility with reference numbers
# already issued under the old prefix. New code must use the canonical
# replacement (Standard 03 § Deprecated aliases table).
DEPRECATED_PREFIX_ALIASES: frozenset[str] = frozenset({
    "WBH",  # deprecated 2026-06-06 (amendment #3) → replaced by WHK (Webhook)
})

# Regex for `next_reference_number(prefix='XYZ')` or `prefix="XYZ"` style
# literals. Captures the prefix token. Only matches uppercase canonical
# form (lowercase / mixed-case would fail upstream validation anyway).
PREFIX_LITERAL_RE = re.compile(
    r"""prefix\s*=\s*['"]([A-Z][A-Z0-9_]{0,5})['"]""",
)


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

    # Phase 6 — new prevention rules.
    HardRule(
        name="MO-* hand-rolled fixed modal/drawer chrome",
        description=(
            "New `position:fixed,inset:0,background:var(--gx-overlay)` blocks "
            "are forbidden. Use `<Modal>` / `<StudioDrawer>` / `<Overlay>`."
        ),
        # Matches the canonical hand-rolled shape: position:fixed + inset:0 + the
        # gx-overlay backdrop literal, which together identify a custom modal
        # overlay (not a tooltip or popover, which have different anchors).
        pattern=r"position:\s*['\"]fixed['\"]\s*,\s*inset:\s*0\s*,\s*background:\s*['\"]var\(--gx-overlay\)",
        paths=["frontend/src/", "frontend-portal/src/"],
        # Canonical implementations LIVE in these files; the rule applies to
        # any other module that re-implements the chrome by hand.
        exclude=[
            "components/Overlay.tsx",
            "components/Modal.tsx",
            "primitives/StudioDrawer.tsx",
            "modals/ConfigureDrawer.tsx",  # MO-5 — pre-migration; FocusTrap-wrapped
        ],
        regex=True,
    ),
    HardRule(
        name="D19 single token registry",
        description=(
            "All `--gx-*` token DEFINITIONS must live in "
            "`frontend/src/styles/gaahex-tokens.css`. Defining the same `--gx-*` "
            "key in two CSS files reintroduces the cascade-order trap that the "
            "D19 Path A reconciliation closed on 2026-06-05 — a future token "
            "codemod would read one value from the registry doc and the browser "
            "would render the other. See "
            "docs/audit/D19-TOKEN-REGISTRY-RECONCILIATION-PLAN.md."
        ),
        # Any `--gx-X:` line in a CSS file that isn't gaahex-tokens.css is a
        # token DEFINITION outside the registry. `var(--gx-X)` consumers are
        # untouched (they're not at line-start with a colon).
        pattern=r"^\s*--gx-[a-z0-9-]+\s*:\s*[^;\n]+;",
        paths=["frontend/src/styles/", "frontend-portal/src/styles/"],
        exclude=[
            "frontend/src/styles/gaahex-tokens.css",
            # nms-tokens.css uses its own `--nms-*` namespace; the rule's
            # `--gx-*` pattern doesn't match it, so no explicit exclude needed.
        ],
        regex=True,
    ),
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
    # Phase 6 — additional ratchet rules.
    RatchetRule(
        name="Phase-5 hex literal in style={{}}",
        description=(
            "Inline `style={{ ...:'#abc...' }}` literals bypass D18 token "
            "discipline. Migrate to `var(--gx-*)` references. Per-PR ratchet."
        ),
        # Matches `'#abc'`, `'#abcdef'`, `"#abc"`, `"#abcdef"` inside a JSX
        # attribute value (we sweep `style={{` blocks broadly; false positives
        # in raw string templates are accepted noise — the trend matters).
        pattern=r"style=\{\{[^}]*['\"]#[0-9A-Fa-f]{3,8}['\"]",
        paths=["frontend/src/", "frontend-portal/src/"],
        regex=True,
    ),
    RatchetRule(
        name="Phase-5 var(--gx-x, #hex) fallback",
        description=(
            "Defensive hex fallbacks in `var(--gx-foo, #abc)` mean the token "
            "definition is presumed missing. Drop the fallback once the token "
            "is in gaahex-tokens.css. Per-PR ratchet."
        ),
        pattern=r"var\(--gx-[a-z0-9-]+,\s*#[0-9A-Fa-f]{3,8}\)",
        paths=["frontend/src/", "frontend-portal/src/"],
        regex=True,
    ),
    RatchetRule(
        name="A11y div onClick",
        description=(
            "`<div onClick>` without role+tabIndex+onKeyDown breaks keyboard "
            "users (WCAG 2.1.1). Use <button> or add the trio. Per-PR ratchet."
        ),
        # Matches any `<div ... onClick={...}>` opening; a follow-up audit
        # task verifies the matching divs DO include role/tabIndex/onKeyDown.
        # The ratchet keeps the count from growing while we migrate existing
        # ones to <button>.
        pattern=r"<div\b[^>]*\sonClick=\{",
        paths=["frontend/src/", "frontend-portal/src/"],
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


def check_prefix_registry() -> tuple[int, list[tuple[Path, int, str]]]:
    """PR-1 — Std03 canonical prefix registry enforcement.

    Scans every `*.py` under `backend/` for `prefix='XYZ'` / `prefix="XYZ"`
    literal patterns. Each captured prefix must appear in
    `CANONICAL_PREFIXES` or `DEPRECATED_PREFIX_ALIASES`. Returns
    (violation_count, sample_violations) where each sample is
    (file_path, line_no, "prefix='XYZ' — message").

    Excludes `.venv`, `__pycache__`, and the file that DEFINES the registry
    (this file itself) since its frozenset literals are documentation, not
    runtime call sites.
    """
    backend_root = REPO / "backend"
    if not backend_root.exists():
        return 0, []
    violations: list[tuple[Path, int, str]] = []
    excluded_files = {
        "tools/check_drift.py",  # the registry itself
        "tools/check_drift_baseline.json",
    }
    for path in backend_root.rglob("*.py"):
        posix = path.as_posix()
        if any(seg in posix for seg in (
            "__pycache__", ".venv", ".pytest_cache",
        )):
            continue
        rel = path.relative_to(REPO).as_posix()
        if rel in excluded_files:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            continue
        for m in PREFIX_LITERAL_RE.finditer(text):
            prefix = m.group(1)
            if prefix in CANONICAL_PREFIXES:
                continue
            if prefix in DEPRECATED_PREFIX_ALIASES:
                # Deprecated but not a hard failure — kept for backward
                # compatibility on existing reference numbers. Not flagged
                # to avoid breaking the build; a separate ratchet could
                # be added later if we want to enforce migration.
                continue
            line_no = text.count("\n", 0, m.start()) + 1
            line_text = text.splitlines()[line_no - 1] if line_no - 1 < len(text.splitlines()) else ""
            msg = f"prefix='{prefix}' — not in Std03 canonical registry"
            violations.append((path, line_no, f"{msg} | {line_text.strip()[:80]}"))
    return len(violations), violations


# ─────────────────────────────────────────────────────────────────────
# CI-1 — RLS CI job stays a HARD gate (no continue-on-error). Zero baseline.
# ─────────────────────────────────────────────────────────────────────
# TD13 close-out. The `backend-rls` job runs the RLS subset under the
# NOSUPERUSER `gaahex_app` role and MUST be able to fail the build. A
# `continue-on-error: true` anywhere inside an RLS-named job would silently
# turn the dual-role enforcement back into decoration — the exact regression
# `ci.yml` carried until it was made a hard gate. This check forbids it,
# forever, with a zero baseline. Parsed line-by-line (stdlib-only, matching
# this tool's no-extra-deps discipline — no PyYAML import).
WORKFLOWS_DIR = REPO / ".github" / "workflows"
_JOB_HEADER_RE = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")
_NAME_FIELD_RE = re.compile(r"^\s*name:\s*(.+?)\s*$")
_CONTINUE_ON_ERROR_TRUE_RE = re.compile(r"^\s*continue-on-error:\s*true\b")


def check_rls_ci_hard_gate() -> tuple[int, list[tuple[Path, int, str]]]:
    """CI-1 — forbid `continue-on-error: true` inside any RLS-named CI job (zero baseline).

    A job is "RLS-named" when its job id matches /rls/i or its `name:` field contains "rls".
    Any `continue-on-error: true` within such a job's line block is a violation. Returns
    (violation_count, sample) shaped like `check_prefix_registry`.
    """
    if not WORKFLOWS_DIR.exists():
        return 0, []
    violations: list[tuple[Path, int, str]] = []
    workflow_files = sorted(WORKFLOWS_DIR.glob("*.yml")) + sorted(WORKFLOWS_DIR.glob("*.yaml"))
    for wf in workflow_files:
        try:
            lines = wf.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        # Job headers are the only 2-space-indented `key:` lines (under `jobs:`).
        headers = [(i, m.group(1)) for i, line in enumerate(lines)
                   if (m := _JOB_HEADER_RE.match(line))]
        for n, (start, job_id) in enumerate(headers):
            end = headers[n + 1][0] if n + 1 < len(headers) else len(lines)
            block = lines[start:end]
            name_val = ""
            for bl in block:
                nm = _NAME_FIELD_RE.match(bl)
                if nm:
                    name_val = nm.group(1)
                    break
            if "rls" not in job_id.lower() and "rls" not in name_val.lower():
                continue
            for off, bl in enumerate(block):
                if _CONTINUE_ON_ERROR_TRUE_RE.match(bl):
                    ln = start + off + 1
                    violations.append(
                        (wf, ln, f"continue-on-error in RLS job '{job_id}': {bl.strip()[:80]}")
                    )
    return len(violations), violations


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

    # PR-1 — prefix registry enforcement (separate from the regex-based
    # HARD_RULES because it asserts membership in a frozenset, not
    # absence of a regex pattern).
    pr_count, pr_violations = check_prefix_registry()
    if pr_count > 0:
        hard_failures.append("PR-1 prefix registry drift")
        print(f"  FAIL PR-1 prefix registry drift: {pr_count} unknown prefix literal(s)")
        print(f"        Every `next_reference_number(prefix='XYZ')` must use a prefix in")
        print(f"        Standard 03's canonical registry (LAW-GV1 amendment process to add).")
        for p, ln, line in pr_violations[:3]:
            rel = p.relative_to(REPO)
            print(f"        {rel}:{ln}: {line}")
    else:
        print(f"  OK   PR-1 Std03 prefix registry")

    # CI-1 — RLS CI job must stay a hard gate (no continue-on-error). Zero baseline.
    rls_count, rls_violations = check_rls_ci_hard_gate()
    if rls_count > 0:
        hard_failures.append("CI-1 RLS job hard-gate")
        print(f"  FAIL CI-1 RLS job hard-gate: {rls_count} continue-on-error in RLS-named job(s)")
        print(f"        An RLS CI job with continue-on-error masks dual-role RLS failures (TD13).")
        for p, ln, line in rls_violations[:3]:
            rel = p.relative_to(REPO)
            print(f"        {rel}:{ln}: {line}")
    else:
        print(f"  OK   CI-1 RLS CI job stays a hard gate")

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
