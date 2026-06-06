"""Polish Pass B — bare-px → spacing token codemod.

Replaces bare-px values in inline style={{ }} blocks with their `var(--gx-space-*)`
runtime token equivalents. Same pattern as the prior T-P3-10 codemod (commit
4c7beae, which did 266 sites).

Safety contract (Gev's "go full"):
  - VALUE-IDENTICAL swaps only. Each px value maps to a token whose runtime
    value equals it exactly. Zero visual delta.
  - Scope: spacing-context properties only (margin*, padding*, gap, rowGap,
    columnGap, top, left, right, bottom). Skip width, height, fontSize, etc.
  - Skip MasterLayoutDemoView.tsx (T-P1-8 carve-out, documented).
  - Skip frontend-portal/ (different scope; out of this pass).
  - Skip `: 0` and `0px` — there's no `--gx-space-0` and it's the implicit
    default anyway.
  - Skip values that have no exact token: 18, 22, 30, 40 wait — 40 has
    --gx-space-9. Re-checked: only 18, 22, 30, anything >=33 except 40 will
    be skipped.

Runtime spacing scale (D19 Path A canonical, from gaahex-tokens.css):
   2px → --gx-space-1
   4px → --gx-space-2
   6px → --gx-space-3
   8px → --gx-space-4
  10px → --gx-space-5
  12px → --gx-space-6
  14px → --gx-space-7
  16px → --gx-space-8
  24px → --gx-space-12
  32px → --gx-space-16
  40px → --gx-space-9

Modes:
  --dry-run   show what WOULD change, no writes
  --apply     write the changes
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# px → token mapping (only exact-value entries, per safety contract)
# Values are JSX-quoted strings: inline style props need 'var(...)' (string),
# not var(...) (function call). The earlier codemod attempt at unquoted form
# broke tsc immediately — recorded here so future maintainers don't repeat it.
PX_TO_TOKEN: dict[int, str] = {
    2:  "'var(--gx-space-1)'",
    4:  "'var(--gx-space-2)'",
    6:  "'var(--gx-space-3)'",
    8:  "'var(--gx-space-4)'",
    10: "'var(--gx-space-5)'",
    12: "'var(--gx-space-6)'",
    14: "'var(--gx-space-7)'",
    16: "'var(--gx-space-8)'",
    24: "'var(--gx-space-12)'",
    32: "'var(--gx-space-16)'",
    40: "'var(--gx-space-9)'",
}

# Spacing-context properties only. Width/height/fontSize/etc. NOT included.
SPACING_PROPS = (
    "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
    "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "gap", "rowGap", "columnGap",
    "top", "right", "bottom", "left",
    "insetBlockStart", "insetBlockEnd", "insetInlineStart", "insetInlineEnd",
)

# Files to skip
SKIP_FILES = (
    "MasterLayoutDemoView.tsx",  # T-P1-8 documented carve-out
)

ROOT = Path(__file__).resolve().parent.parent
SCAN_DIRS = (
    ROOT / "frontend" / "src" / "views",
    ROOT / "frontend" / "src" / "components",
    ROOT / "frontend" / "src" / "studio",
    ROOT / "frontend" / "src" / "modals",
    ROOT / "frontend" / "src" / "page-shell",
    ROOT / "frontend" / "src" / "primitives",
    ROOT / "frontend" / "src" / "layout",
)


# Find a style={{ ... }} block. Greedy on outer braces; we'll process content
# character-by-character to handle nested braces correctly inside the codemod.
# But typical inline styles don't nest — they're flat key:value pairs — so the
# simple non-greedy match works for ~99% of cases.
STYLE_BLOCK_RE = re.compile(r"style=\{\{([^{}]*)\}\}", re.MULTILINE)


def make_value_pattern(prop: str) -> re.Pattern[str]:
    """Build a regex that matches `<prop>: <number>` where <number> is a
    bare integer (no `px` suffix, no string quotes). Captures the number so
    we can decide if it's swappable.

    Examples it matches:
      marginTop: 8
      marginTop:8
      padding: 12,
      gap: 16}
    Examples it does NOT match (intentionally — those forms are out of scope
    for the value-identical safety rule):
      padding: '8px 16px'   — multi-value strings (different replacement shape)
      marginTop: '8px'      — quoted string with px suffix (already explicit)
      paddingTop: someVar   — variable references
      padding: 0            — zero (handled separately; usually means "none")
    """
    # \b<prop>\s*:\s*(\d+)(?=\s*[,}]|\s*$|\s*\n)
    # The lookahead is intentionally STRICT — match only when the value is
    # immediately terminated by `,`, `}`, or end-of-line. This skips
    # arithmetic continuations like `bottom: 24 + stem - 5` which would
    # break if we swap the literal for a string (first-attempt codemod bug).
    return re.compile(rf"\b{re.escape(prop)}\s*:\s*(\d+)(?=\s*[,}}]|\s*\n)", re.MULTILINE)


# Pre-build the patterns once.
PROP_PATTERNS = [(prop, make_value_pattern(prop)) for prop in SPACING_PROPS]


def process_style_content(content: str) -> tuple[str, int]:
    """Process the inside of a `style={{ ... }}` block. Returns (new_content,
    num_swaps_made).
    """
    swaps = 0

    def replace_in_prop(prop: str, pat: re.Pattern[str], text: str) -> tuple[str, int]:
        local_swaps = 0
        def _sub(m: re.Match[str]) -> str:
            nonlocal local_swaps
            n = int(m.group(1))
            if n == 0:
                return m.group(0)  # don't touch zeros
            tok = PX_TO_TOKEN.get(n)
            if tok is None:
                return m.group(0)  # off-scale value, skip
            local_swaps += 1
            return f"{prop}: {tok}"
        new_text = pat.sub(_sub, text)
        return new_text, local_swaps

    for prop, pat in PROP_PATTERNS:
        content, n = replace_in_prop(prop, pat, content)
        swaps += n

    return content, swaps


def process_file(path: Path, write: bool) -> tuple[int, list[tuple[int, str, str]]]:
    """Process one .tsx file. Returns (num_swaps, list of (line_no, before, after))."""
    text = path.read_text(encoding="utf-8")
    new_text_parts: list[str] = []
    diffs: list[tuple[int, str, str]] = []
    last_end = 0
    total_swaps = 0

    for m in STYLE_BLOCK_RE.finditer(text):
        inner = m.group(1)
        new_inner, swaps = process_style_content(inner)
        if swaps > 0:
            # Record the diff at the line where this block starts
            line_no = text.count("\n", 0, m.start()) + 1
            diffs.append((line_no, inner.strip(), new_inner.strip()))
            total_swaps += swaps
        new_text_parts.append(text[last_end:m.start()])
        new_text_parts.append("style={{")
        new_text_parts.append(new_inner)
        new_text_parts.append("}}")
        last_end = m.end()
    new_text_parts.append(text[last_end:])
    new_text = "".join(new_text_parts)

    if write and total_swaps > 0:
        path.write_text(new_text, encoding="utf-8")

    return total_swaps, diffs


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="show changes only, don't write")
    parser.add_argument("--apply", action="store_true", help="write changes")
    parser.add_argument("--verbose", action="store_true", help="show every changed line")
    args = parser.parse_args(argv)
    if args.dry_run == args.apply:
        print("Pass --dry-run OR --apply (not both, not neither).", file=sys.stderr)
        return 2

    files_changed = 0
    total_swaps = 0
    per_file: list[tuple[Path, int]] = []

    for scan_dir in SCAN_DIRS:
        if not scan_dir.exists():
            continue
        for path in sorted(scan_dir.rglob("*.tsx")):
            if path.name in SKIP_FILES:
                continue
            try:
                swaps, diffs = process_file(path, write=args.apply)
            except Exception as e:
                print(f"  ERROR {path.relative_to(ROOT)}: {e}", file=sys.stderr)
                continue
            if swaps > 0:
                files_changed += 1
                total_swaps += swaps
                per_file.append((path, swaps))
                if args.verbose:
                    rel = path.relative_to(ROOT).as_posix()
                    print(f"\n  {rel} ({swaps} swap{'s' if swaps != 1 else ''}):")
                    for ln, before, after in diffs[:5]:
                        print(f"    L{ln}:")
                        print(f"      - {before[:120]}")
                        print(f"      + {after[:120]}")
                    if len(diffs) > 5:
                        print(f"    … and {len(diffs) - 5} more block(s)")

    print()
    print(f"Polish Pass B {'(DRY RUN)' if args.dry_run else '(APPLIED)'}:")
    print(f"  Files changed: {files_changed}")
    print(f"  Total swaps:   {total_swaps}")
    print()
    print("  Top files by swap count:")
    for path, n in sorted(per_file, key=lambda x: -x[1])[:15]:
        rel = path.relative_to(ROOT).as_posix()
        print(f"    {n:4d}  {rel}")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
