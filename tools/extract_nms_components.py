"""One-shot extraction: read nms-tokens.css L94+ (component classes), apply
the token-unify mapping for --nms-* → --gx-*, and write the result to
frontend/src/styles/_nms.css.

After this runs, the new file:
  - Contains ONLY the .nms-* component class definitions (no token defs).
  - References --gx-* directly.
  - Is ready to replace the `import './styles/nms-tokens.css'` in main.tsx.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "src"

sys.path.insert(0, str(ROOT / "tools"))
from token_unify_migrate import LEGACY_MAP, replace_in_text  # type: ignore


def main() -> int:
    src = SRC / "styles" / "nms-tokens.css"
    dst = SRC / "styles" / "_nms.css"
    if not src.exists():
        print(f"source missing: {src}", file=sys.stderr)
        return 1

    text = src.read_text(encoding="utf-8")
    # The component classes begin at the first `.nms-page` rule. Everything
    # before that is the :root { ... } token-definition block.
    idx = text.find(".nms-page {")
    if idx == -1:
        print("could not locate .nms-page in source", file=sys.stderr)
        return 1
    # Walk back to the nearest block-comment opener (so the section header
    # comment travels with the rules).
    comment_idx = text.rfind("/*", 0, idx)
    if comment_idx == -1:
        comment_idx = idx

    component_block = text[comment_idx:]

    # Apply the token-unification migration to the extracted block.
    swaps = 0
    for old, (kind, target) in LEGACY_MAP.items():
        component_block, n = replace_in_text(component_block, old, kind, target)
        swaps += n

    header = (
        "/* GAAhex — NMS component classes.\n"
        " *\n"
        " * Extracted 2026-06-06 from the now-deleted nms-tokens.css. Tokens\n"
        " * referenced here are CANONICAL --gx-* tokens from gaahex-tokens.css.\n"
        " * This file is component-CSS only; no token DEFINITIONS live here.\n"
        " *\n"
        " * Origin: Gev's locked decision (2026-06-06) — single token registry.\n"
        " */\n\n"
    )

    dst.write_text(header + component_block, encoding="utf-8")

    print(f"Wrote {dst.relative_to(ROOT)} ({len(component_block.splitlines())} lines)")
    print(f"  Internal --nms-*/legacy swaps applied during extraction: {swaps}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
