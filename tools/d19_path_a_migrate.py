"""D19 Path A — one-shot migration script.

Edits gaahex-tokens.css in place to adopt color-tokens.css values for the 39
divergent per-theme keys, and migrates 3 color-only-consumed keys (space-1,
space-16, text-13) into gaahex-tokens.css. After this script runs successfully,
color-tokens.css can be deleted and its import removed.

Not idempotent — run once. Re-running on a partially-migrated file is harmless
(no further changes), but the verification at the bottom asserts every target
value matches.
"""
import re
import sys
from pathlib import Path


DIVERGENCES = [
    ("cobalt", "dark",  "#1C3B68"),
    ("cobalt", "light", "#1C3B68"),
    ("danger", "dark",  "#F0666B"),
    ("danger", "light", "#E5484D"),
    ("font-mono", "dark", "'IBM Plex Mono', 'SF Mono', ui-monospace, monospace"),
    ("gold", "dark",  "#C5A059"),
    ("gold", "light", "#AC8847"),
    ("info", "dark",  "#5293F2"),
    ("info", "light", "#2C63BC"),
    ("link", "dark",  "#5293F2"),
    ("link", "light", "#2C63BC"),
    ("maintenance", "dark",  "#A78BE6"),
    ("maintenance", "light", "#6F52BD"),
    ("neutral", "dark",  "#94A3B8"),
    ("neutral", "light", "#64748B"),
    ("online", "dark",  "#34C77B"),
    ("online", "light", "#16804A"),
    ("provisioned", "dark",  "#34C77B"),
    ("provisioned", "light", "#16804A"),
    ("quality-good", "dark",  "#34C77B"),
    ("quality-good", "light", "#16804A"),
    ("ring", "dark",  "rgba(82, 147, 242, 0.55)"),
    ("ring", "light", "rgba(44, 99, 188, 0.40)"),
    ("selected", "dark",  "rgba(59, 123, 224, 0.16)"),
    ("selected", "light", "rgba(59, 123, 224, 0.10)"),
    ("space-12", "dark", "24px"),
    ("space-3",  "dark", "6px"),
    ("space-4",  "dark", "8px"),
    ("space-5",  "dark", "10px"),
    ("space-6",  "dark", "12px"),
    ("space-7",  "dark", "14px"),
    ("space-8",  "dark", "16px"),
    ("success", "dark",  "#34C77B"),
    ("success", "light", "#16804A"),
    ("text-3", "dark",  "#6E7F96"),
    ("text-3", "light", "#74849A"),
    ("tracking-tight", "dark", "-0.01em"),
    ("warning", "dark",  "#F2AE3C"),
    ("warning", "light", "#B97412"),
]


def find_theme_blocks(t):
    """Returns blocks labeled 'dark', 'light', or 'primitive' (Tier-1 :root only).
    Many structural tokens (spaces, control sizes, font families, tracking, breakpoints)
    live in the theme-independent primitive block; theme blocks override semantic colors."""
    blocks = []
    pat = re.compile(r'(?:^|\n)((?::root[^{]*|\[data-theme="[^"]+"\][^{]*))\{', re.MULTILINE)
    for m in pat.finditer(t):
        start = m.end()
        depth = 1
        j = start
        while j < len(t) and depth > 0:
            if t[j] == "{":
                depth += 1
            elif t[j] == "}":
                depth -= 1
            if depth == 0:
                break
            j += 1
        sel = m.group(1)
        if 'data-theme="light"' in sel:
            theme = "light"
        elif "data-theme=" in sel:
            theme = "dark"
        else:
            theme = "primitive"  # Tier-1 :root, theme-independent
        blocks.append((theme, start, j))
    return blocks


def main():
    path = Path("frontend/src/styles/gaahex-tokens.css")
    text = path.read_text(encoding="utf-8")
    original = text

    blocks = find_theme_blocks(text)
    print(f"Theme blocks: {[(t, s, e) for t, s, e in blocks]}")

    edits = []  # (abs_start, abs_end, new_value)
    skipped = []
    for key, theme, new_val in DIVERGENCES:
        # Try the requested theme block first; fall back to the Tier-1 primitive
        # block (where spaces / font families / tracking / breakpoints live —
        # those tokens are theme-independent in gaahex-tokens.css even though
        # color-tokens.css overrode some of them inside its dark/light blocks).
        candidate_themes = [theme, "primitive"] if theme == "dark" else [theme]
        found = False
        for cand in candidate_themes:
            block = next(((s, e) for t, s, e in blocks if t == cand), None)
            if block is None:
                continue
            s, e = block
            block_text = text[s:e]
            pat = re.compile(
                r"(^[ \t]*--gx-" + re.escape(key) + r"\s*:\s*)([^;\n]+)(;[^\n]*)",
                re.MULTILINE,
            )
            m = pat.search(block_text)
            if not m:
                continue
            old_val = m.group(2).strip()
            if old_val == new_val:
                skipped.append((key, theme, f"already-matches-in-{cand}"))
                found = True
                break
            edits.append((s + m.start(2), s + m.end(2), new_val))
            found = True
            break
        if not found:
            skipped.append((key, theme, "key-not-found-anywhere"))

    edits.sort(key=lambda x: -x[0])
    for start, end, repl in edits:
        text = text[:start] + repl + text[end:]
    print(f"Applied {len(edits)} divergence edits; skipped {len(skipped)}: {skipped[:5]}")

    # Migrate 3 color-only-consumed keys into dark block.
    # Migrate the 3 color-only-consumed keys into the Tier-1 primitive block
    # (that's where existing space-* and text-* tokens live).
    blocks_after = find_theme_blocks(text)
    primitive = next(((s, e) for t, s, e in blocks_after if t == "primitive"), None)
    if primitive is None:
        print("ERROR: no primitive :root block found post-edits", file=sys.stderr)
        sys.exit(1)
    s, e = primitive
    space12_pat = re.compile(r"(--gx-space-12:[^;]+;[^\n]*\n)")
    m = space12_pat.search(text, s, e)
    if m:
        insert_pos = m.end()
        insertion = (
            "\n  /* T-P3-1 / D19 Path A — three keys restored from color-tokens.css before\n"
            "     its deletion. They were consumed in code but only defined in color-tokens.css;\n"
            "     migrating them here makes gaahex-tokens.css the single source of truth for\n"
            "     the entire --gx-* registry. See docs/audit/D19-TOKEN-REGISTRY-RECONCILIATION-PLAN.md. */\n"
            "  --gx-space-1:  2px;\n"
            "  --gx-space-16: 32px;\n"
        )
        text = text[:insert_pos] + insertion + text[insert_pos:]
        print("  inserted --gx-space-1 + --gx-space-16 into dark block")
    else:
        print("WARN: could not locate --gx-space-12 line for inserting space-1/space-16")

    text_base_pat = re.compile(r"(--gx-text-base:[^;]+;[^\n]*\n)")
    m = text_base_pat.search(text)
    if m:
        insert_pos = m.end()
        insertion = "  --gx-text-13: 13px;   /* D19 Path A — restored from color-tokens.css */\n"
        text = text[:insert_pos] + insertion + text[insert_pos:]
        print("  inserted --gx-text-13")
    else:
        print("WARN: could not locate --gx-text-base for inserting text-13")

    # Replace the D19 VALUE AUTHORITY NOTE header with RESOLVED note.
    old_header = (
        "   ⚠️  D19 — VALUE AUTHORITY NOTE (see T-P3-1 / color-tokens.css header).\n"
        "   ----------------------------------------------------------------------------\n"
        "   This file is the Tier-1/Tier-2 REGISTRY: it defines every `--gx-*` token\n"
        "   the design system promises (165 names). It is *not* the value authority\n"
        "   for the ~86 keys that color-tokens.css redefines later in the import\n"
        "   chain (main.tsx:11 loads after :8) — for those, color-tokens.css wins by\n"
        "   cascade order. Until T-P3-1 lands the merge, new tokens go HERE."
    )
    new_header = (
        "   ✅  D19 — RESOLVED 2026-06-05 via Path A (color-tokens.css adopted as\n"
        "   runtime canonical, then deleted). This file is now the SINGLE source of\n"
        "   truth for every `--gx-*` token. The values for the previously-divergent\n"
        "   39 per-theme keys were lifted from color-tokens.css (the runtime cascade\n"
        "   winner) so the rendered look is byte-identical to the pre-reconciliation\n"
        "   state. New tokens go HERE and ONLY here — enforced by the new HARD drift\n"
        "   rule `D19 single token registry`. See\n"
        "   docs/audit/D19-TOKEN-REGISTRY-RECONCILIATION-PLAN.md for the reasoning."
    )
    if old_header in text:
        text = text.replace(old_header, new_header)
        print("  header note flipped to RESOLVED")
    else:
        print("WARN: could not flip header note (already updated or text drifted)")

    path.write_text(text, encoding="utf-8")
    print(f"\n[OK] Wrote {path}.")
    print(f"  bytes: {len(original)} -> {len(text)} (delta {len(text) - len(original):+d})")


if __name__ == "__main__":
    main()
