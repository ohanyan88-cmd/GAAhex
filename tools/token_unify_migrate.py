"""Token unification migration — single source of truth (Gev 2026-06-06).

Locked decision: the platform must have exactly ONE design token registry,
`frontend/src/styles/gaahex-tokens.css`. This codemod migrates every
`var(--xxx)` consumer of `_tokens.css` (unprefixed) and `nms-tokens.css`
(`--nms-*` prefixed) to the canonical `--gx-*` tokens.

After this codemod applies, two files are deleted (handled outside this
script): `_tokens.css` and `nms-tokens.css`. The NMS component classes
(`.nms-*`) are extracted into a new component-style file `_nms.css` BEFORE
deletion, and they reference `--gx-*` directly.

Mapping table:
  - Source of truth: Gev's locked spec in the migration directive.
  - Edge cases (tokens not in Gev's spec): decided per "prefer existing
    --gx-* over adding tokens"; documented inline at the mapping site.

Scope:
  - Scans every .tsx, .ts, .css file under frontend/src/.
  - Replaces `var(--<old>)` with `var(--gx-<new>)` per the table.
  - Skips `_tokens.css` and `nms-tokens.css` themselves (they're getting
    deleted; no point migrating their internal references).
  - Skips any file under node_modules/.

Safety:
  - Dry-run by default; pass --apply to write.
  - Reports per-file change counts and total swap count.
  - Each replacement is text-exact: `var(--<old>)` → `var(--gx-<new>)`.
    We do NOT match `var(--<old>, fallback)` separately — the entire
    pattern up to `)` is left for the caller to inspect. But we DO match
    the bare `var(--<old>)` form which is what 99% of consumers use.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "src"

# Files NOT to migrate (they're getting deleted by a separate step).
SKIP_FILES = {
    SRC / "styles" / "_tokens.css",
    SRC / "styles" / "nms-tokens.css",
}

# ----------------------------------------------------------------------
# MAPPING TABLE
#
# Each entry: legacy-token-name → canonical-target
# `target` is the bare token name (no `var(...)` wrapper); the codemod
# wraps it as `var(--gx-<target>)`. Or, if the target is a literal value
# (no `--`), we emit it inline.
#
# Per Gev's locked spec. Edge cases I added (not in Gev's spec) are
# annotated with `# EDGE` and a one-line justification.
# ----------------------------------------------------------------------

# Format: { legacy_name: ('token'|'literal', value) }
LEGACY_MAP: dict[str, tuple[str, str]] = {
    # ----- colors / surfaces ------------------------------------------
    "bg":            ("token", "--gx-bg"),
    "surface":       ("token", "--gx-surface"),
    "surface-2":     ("token", "--gx-surface-2"),
    "border":        ("token", "--gx-border"),
    "border-soft":   ("token", "--gx-border-subtle"),
    # ----- text -------------------------------------------------------
    "text":          ("token", "--gx-text-1"),
    "text-2":        ("token", "--gx-text-2"),
    "text-3":        ("token", "--gx-text-3"),
    # text-inv has 2 valid mappings; default to text-on-primary (light
    # text on dark, dark text on light — the "inverse of body text"
    # semantic). The 0 sites consuming --text-inv directly mean this
    # entry is documentation-only.
    "text-inv":      ("token", "--gx-text-on-primary"),
    # ----- brand / interactive ----------------------------------------
    "brand":         ("token", "--gx-cobalt"),                  # EDGE: not in spec; --brand value #1C3B68 = --gx-cobalt exactly. 1 use.
    "primary":       ("token", "--gx-interactive"),
    "primary-hover": ("token", "--gx-interactive-hover"),
    "primary-soft":  ("token", "--gx-interactive-soft"),
    "accent":        ("token", "--gx-gold"),
    "accent-hover":  ("token", "--gx-gold"),                    # EDGE: --accent-hover was `var(--gold-400)`; closest gx semantic is --gx-gold (same family). 0 uses today.
    "accent-soft":   ("token", "--gx-gold-soft"),
    "accent-text":   ("token", "--gx-text-on-gold"),
    # ----- status -----------------------------------------------------
    "success":       ("token", "--gx-success"),
    "success-soft":  ("token", "--gx-success-soft"),
    "warning":       ("token", "--gx-warning"),
    "warning-soft":  ("token", "--gx-warning-soft"),
    "danger":        ("token", "--gx-danger"),
    "danger-soft":   ("token", "--gx-danger-soft"),
    "focus-ring":    ("token", "--gx-focus-ring"),
    # ----- typography -------------------------------------------------
    "font-body":     ("token", "--gx-font-sans"),
    "font-mono":     ("token", "--gx-font-mono"),
    "fs-h1":         ("token", "--gx-text-3xl"),                # 28
    "fs-h2":         ("token", "--gx-text-2xl"),                # 22
    "fs-h3":         ("token", "--gx-text-xl"),                 # EDGE: --fs-h3 was 17px; closest gx is --gx-text-xl (18) or --gx-text-lg (16). Pick xl (1px drift, larger end).
    "fs-body":       ("token", "--gx-text-md"),                 # 14
    "fs-sm":         ("token", "--gx-text-13"),                 # 13
    "fs-caption":    ("token", "--gx-text-xs"),                 # 11
    "fw-regular":    ("token", "--gx-weight-regular"),
    "fw-medium":     ("token", "--gx-weight-medium"),
    "fw-semibold":   ("token", "--gx-weight-semibold"),
    "fw-bold":       ("token", "--gx-weight-bold"),
    "lh-tight":      ("token", "--gx-leading-tight"),
    "lh-base":       ("token", "--gx-leading-normal"),
    "lh-relaxed":    ("token", "--gx-leading-relaxed"),
    # ----- spacing scale (--sp-*) -------------------------------------
    # --sp-0 (0px, 0 uses) — no token needed; inline 0 if encountered
    "sp-0":          ("literal", "0"),                          # EDGE: 0 uses; inline if encountered
    "sp-1":          ("token", "--gx-space-2"),                 # 4
    "sp-2":          ("token", "--gx-space-4"),                 # 8
    "sp-3":          ("token", "--gx-space-6"),                 # 12
    "sp-4":          ("token", "--gx-space-8"),                 # 16
    "sp-5":          ("token", "--gx-space-20"),                # 20
    "sp-6":          ("token", "--gx-space-12"),                # 24
    "sp-7":          ("token", "--gx-space-16"),                # 32
    "sp-8":          ("token", "--gx-space-9"),                 # 40
    "sp-9":          ("literal", "48px"),                       # EDGE: 1 use, no --gx-* for 48; inline. "Prefer mapping over adding".
    "sp-10":         ("literal", "64px"),                       # EDGE: 1 use, no --gx-* for 64; inline.
    # ----- legacy second-level spacing aliases (resolved to underlying values) ---
    "gap":           ("token", "--gx-space-8"),                 # = --sp-4 = 16px (1 use)
    "pad":           ("token", "--gx-space-20"),                # = --sp-5 = 20px (2 uses)
    "row-pad-y":     ("token", "--gx-space-6"),                 # = --sp-3 = 12px (0 uses)
    "row-pad-x":     ("token", "--gx-space-8"),                 # = --sp-4 = 16px (0 uses)
    "control-pad-y": ("token", "--gx-space-6"),                 # = --sp-3 = 12px (0 uses)
    "page-pad-x":    ("token", "--gx-space-12"),                # = --sp-6 = 24px (4 uses)
    "page-pad-y":    ("token", "--gx-space-20"),                # = --sp-5 = 20px (2 uses)
    "section-gap":   ("token", "--gx-space-12"),                # = --sp-6 = 24px (0 uses)
    "card-pad":      ("token", "--gx-space-20"),                # = --sp-5 = 20px (6 uses)
    "card-gap":      ("token", "--gx-space-8"),                 # = --sp-4 = 16px (4 uses)
    "kpi-gap":       ("token", "--gx-space-8"),                 # = --sp-4 = 16px (2 uses)
    "form-gap":      ("token", "--gx-space-8"),                 # = --sp-4 = 16px (0 uses)
    "inline-gap":    ("token", "--gx-space-4"),                 # = --sp-2 = 8px (7 uses)
    # ----- radius -----------------------------------------------------
    "radius-sm":     ("token", "--gx-radius-sm"),               # 5 → 5 ✓ exact
    "radius":        ("token", "--gx-radius-md"),               # EDGE: was 7px; --gx-radius-md is 8px. 6 uses. 1px drift, prefer mapping.
    "radius-lg":     ("token", "--gx-radius-lg"),               # EDGE: was 10px; --gx-radius-lg is 12px. 5 uses. 2px drift, prefer mapping.
    "r-sm":          ("token", "--gx-radius-sm"),               # EDGE: was 6px; nearest --gx-radius-sm = 5px. 11 uses. 1px drift, prefer mapping.
    "r-md":          ("token", "--gx-radius-md"),               # 8 → 8 ✓ exact
    "r-lg":          ("token", "--gx-radius-lg"),               # EDGE: was 10px; --gx-radius-lg is 12px. 10 uses. 2px drift, prefer mapping.
    "r-xl":          ("token", "--gx-radius-lg"),               # 12 → 12 ✓ exact (Gev spec)
    "pill":          ("token", "--gx-radius-full"),
    "r-pill":        ("token", "--gx-radius-full"),
    # ----- border widths ----------------------------------------------
    "bw-1":          ("literal", "1px"),                        # EDGE: no --gx-border-1; 2 uses; inline.
    "bw-2":          ("token", "--gx-border-2"),
    # ----- shadows ----------------------------------------------------
    "shadow":        ("token", "--gx-shadow-xs"),               # EDGE: was `0 1px 3px rgba(0,0,0,.35)`; closest semantic. 9 uses.
    "shadow-card":   ("token", "--gx-shadow-md"),               # EDGE: closest semantic. 0 uses today.
    "shadow-pop":    ("token", "--gx-shadow-lg"),               # EDGE: closest semantic. 4 uses.
    # ----- motion -----------------------------------------------------
    "dur-instant":   ("literal", "0ms"),                        # EDGE: 0 uses; inline if encountered.
    "dur-fast":      ("token", "--gx-dur-fast"),                # 100ms vs 120ms — 20ms drift, prefer mapping
    "dur-base":      ("token", "--gx-dur-base"),
    "dur-slow":      ("token", "--gx-dur-moderate"),            # EDGE: was 320ms; --gx-dur-moderate is 300ms. 0 uses.
    "ease-standard": ("token", "--gx-ease-standard"),
    "ease-decelerate": ("token", "--gx-ease-emphasis"),         # EDGE: was cubic-bezier(0,0,0,1); --gx-ease-emphasis is closest semantic. 3 uses.
    "ease-accelerate": ("token", "--gx-ease-standard"),         # EDGE: 0 uses.
    # ----- z-index ----------------------------------------------------
    "z-base":        ("literal", "0"),                          # EDGE: 0 uses; inline.
    "z-dropdown":    ("literal", "1000"),                       # EDGE: 1 use, no --gx-z-dropdown; inline.
    "z-sticky":      ("token", "--gx-z-sticky"),
    "z-modal":       ("token", "--gx-z-modal"),
    "z-toast":       ("token", "--gx-z-toast"),
    # ----- sidebar (0 uses; documented anyway for completeness) -------
    # Removed with the file. No mapping needed.
    # ----- NMS (per Gev spec) -----------------------------------------
    "nms-bg":              ("token", "--gx-bg"),
    "nms-surface":         ("token", "--gx-surface"),
    "nms-surface-2":       ("token", "--gx-surface-2"),
    "nms-surface-3":       ("token", "--gx-border-strong"),     # EDGE: Gev spec only names surface/2; --nms-surface-3 was defined as --gx-border-strong (5 uses in NocDashboard).
    "nms-border":          ("token", "--gx-border"),
    "nms-border-strong":   ("token", "--gx-border-strong"),
    "nms-border-soft":     ("token", "--gx-border-subtle"),
    "nms-text":            ("token", "--gx-text-1"),
    "nms-text-2":          ("token", "--gx-text-2"),
    "nms-text-3":          ("token", "--gx-text-3"),
    "nms-text-inv":        ("token", "--gx-bg"),
    "nms-neon-green":      ("token", "--gx-text-2"),
    "nms-neon-amber":      ("token", "--gx-text-3"),
    "nms-neon-red":        ("token", "--gx-gold"),
    "nms-neon-cyan":       ("token", "--gx-interactive"),
    "nms-accent-gold":     ("token", "--gx-gold"),
    "nms-neon-green-soft": ("literal", "rgba(244,246,249,0.04)"),  # EDGE: kept as literal — was already a custom near-transparent neutral. 0 uses in app; deleted with the file.
    "nms-neon-amber-soft": ("literal", "transparent"),               # was already `transparent`. 0 uses.
    "nms-neon-red-soft":   ("token", "--gx-gold-soft"),
    "nms-neon-cyan-soft":  ("token", "--gx-interactive-soft"),
    "nms-accent-gold-soft":("token", "--gx-gold-soft"),
    "nms-cobalt-dim":      ("token", "--gx-text-3"),
    "nms-radius-sm":       ("token", "--gx-radius-sm"),
    "nms-radius-md":       ("token", "--gx-radius-md"),
    "nms-radius-lg":       ("token", "--gx-radius-lg"),
    "nms-sp-1":            ("token", "--gx-space-2"),
    "nms-sp-2":            ("token", "--gx-space-4"),
    "nms-sp-3":            ("token", "--gx-space-6"),
    "nms-sp-4":            ("token", "--gx-space-8"),
    "nms-sp-5":            ("token", "--gx-space-12"),
    "nms-sp-6":            ("token", "--gx-space-16"),
    "nms-shadow-sm":       ("token", "--gx-shadow-xs"),
    "nms-shadow-md":       ("token", "--gx-shadow-sm"),
    "nms-shadow-lg":       ("token", "--gx-shadow-md"),
    "nms-dur-fast":        ("token", "--gx-dur-fast"),
    "nms-dur-base":        ("token", "--gx-dur-base"),
    "nms-dur-slow":        ("token", "--gx-dur-moderate"),
    "nms-ease":            ("token", "--gx-ease-standard"),
    # NMS glow tokens — all were `none` in the source, deleted with the file
    "nms-glow-green":      ("literal", "none"),
    "nms-glow-amber":      ("literal", "none"),
    "nms-glow-red":        ("literal", "none"),
    "nms-glow-cyan":       ("literal", "none"),
}


def make_pattern(old: str) -> re.Pattern[str]:
    """Match `var(--<old>)` exactly (no fallback) AND `var(--<old>, fallback)`.

    The replacement strategy:
      - For `var(--<old>)`: swap to `var(--gx-<new>)` or the literal.
      - For `var(--<old>, fallback)`: swap the inner reference but keep
        the fallback intact (which is now redundant but harmless).
    """
    return re.compile(rf"var\(--{re.escape(old)}(?P<rest>\s*[,)]|\s+[,)])")


def replace_in_text(text: str, old: str, kind: str, target: str) -> tuple[str, int]:
    """Replace every `var(--<old>...)` occurrence in `text`. Returns
    (new_text, count_replaced).
    """
    count = 0
    pat = re.compile(rf"var\(--{re.escape(old)}\s*\)")  # bare form: var(--xxx)
    if kind == "token":
        repl = f"var({target})"
        text, n = pat.subn(repl, text)
        count += n
    else:  # literal — replace `var(--xxx)` with the bare value
        text, n = pat.subn(target, text)
        count += n

    # Also handle the `var(--xxx, fallback)` form — replace the inner ref,
    # leave the fallback alone (now redundant but harmless).
    pat_fb = re.compile(rf"var\(--{re.escape(old)}\s*,")
    if kind == "token":
        repl = f"var({target},"
        text, n = pat_fb.subn(repl, text)
        count += n
    else:
        # For literal target, drop the fallback wrapper entirely:
        # `var(--xxx, fb)` → `literal`. The fb becomes dead syntax — drop the
        # whole var() call. Match through the closing paren conservatively.
        pat_fb_full = re.compile(rf"var\(--{re.escape(old)}\s*,[^)]*\)")
        text, n = pat_fb_full.subn(target, text)
        count += n

    return text, count


def process_file(path: Path, write: bool) -> tuple[int, dict[str, int]]:
    """Process one source file. Returns (total_swaps, per_token_counts)."""
    if not path.exists():
        return 0, {}
    text = path.read_text(encoding="utf-8")
    new_text = text
    per_token: dict[str, int] = {}
    for old, (kind, target) in LEGACY_MAP.items():
        new_text, n = replace_in_text(new_text, old, kind, target)
        if n > 0:
            per_token[old] = n
    total = sum(per_token.values())
    if write and total > 0:
        path.write_text(new_text, encoding="utf-8")
    return total, per_token


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    if args.dry_run == args.apply:
        print("Pass --dry-run OR --apply.", file=sys.stderr)
        return 2

    files_changed = 0
    total_swaps = 0
    grand_totals: dict[str, int] = {}
    top_files: list[tuple[Path, int]] = []

    for path in sorted(SRC.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix not in (".tsx", ".ts", ".css"):
            continue
        if "node_modules" in path.parts:
            continue
        if path in SKIP_FILES:
            continue
        n, per_token = process_file(path, write=args.apply)
        if n > 0:
            files_changed += 1
            total_swaps += n
            top_files.append((path, n))
            for k, v in per_token.items():
                grand_totals[k] = grand_totals.get(k, 0) + v

    print()
    print(f"Token unification {'(DRY RUN)' if args.dry_run else '(APPLIED)'}:")
    print(f"  Files changed: {files_changed}")
    print(f"  Total swaps:   {total_swaps}")
    print()
    print("  Per-token swap totals (top 30):")
    for tok, n in sorted(grand_totals.items(), key=lambda x: -x[1])[:30]:
        kind, target = LEGACY_MAP[tok]
        arrow = target if kind == "literal" else f"var({target})"
        print(f"    {n:4d}  --{tok:20s} ->  {arrow}")
    print()
    print("  Top 15 files by swap count:")
    for path, n in sorted(top_files, key=lambda x: -x[1])[:15]:
        print(f"    {n:4d}  {path.relative_to(ROOT).as_posix()}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
