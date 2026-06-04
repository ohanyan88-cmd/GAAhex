# Icon library choice — Lucide vs. Phosphor vs. Heroicons

Source: WebSearch summary 2026-06-04 (pkgpulse.com, shadcndesign.com, hugeicons.com)

## Current state in GAAhex

`frontend/package.json` already includes `lucide-react@^1.17.0`. The codebase
file `frontend/src/components/icons.tsx` (read 2026-06-04) is explicitly:

> "each export is a tiny wrapper around the equivalent lucide-react icon. We
> keep the EXACT same exported component names and a backwards-compatible
> prop signature... so every existing call site keeps working untouched."

So Lucide is already locked. The question is whether to reconsider.

## The three contenders — head to head

| | Lucide | Heroicons | Phosphor |
|---|---|---|---|
| Icon count | 1,500+ | 292 | 7,700+ |
| Weights | stroke-width customizable | outline + solid (2) | thin / light / regular / bold / fill / duotone (6) |
| Source | community / Cole Bemis-derived from Feather | Tailwind Labs | Phosphor team |
| House style | Feather-style (Lucide is the "active maintenance" Feather) | Tailwind-native, ships with releases | flexible family, distinct hierarchy weights |
| Ecosystem default | shadcn/ui | Tailwind | (independent) |
| 2026 "familiar" risk | high — most B2B uses Lucide | very high — saturates AI-generated UI | lower |

## Decision for GAAhex — KEEP Lucide

Reasons:

1. **Already installed and code-aligned.** Switching would be a Կյաժ-grade
   sweep across every view. No payoff justifies the cost.
2. **Stroke-identical to the in-repo custom set.** The repo originally had
   hand-rolled icons in the Feather/Lucide style; the migration to lucide-
   react was wrapper-only. The visual identity already matches.
3. **Operator-grade clarity is the priority, not icon-distinctiveness.** The
   Phosphor "we have 6 weights" argument is for products where icon variety
   communicates. GAAhex's NOC views need consistency, not variety.
4. **Stroke-width customization is the only knob we need.** D18 already
   constrains color to family roles; we don't need filled/duotone variants.

## What to specify in the brand bible

- **Single library:** `lucide-react`. No mixing with Phosphor or Heroicons.
- **Default stroke-width:** 2px.
- **Default size:** 18px (matches the current convention).
- **Inline / dense:** 14px.
- **Header / nav:** 16–18px.
- **Empty state:** 40–48px.
- **Color:** always `currentColor`. No hardcoded fills.
- **Forbidden:** emoji as icon (already locked by `docs/BRAND.md` §4),
  filled-only icons except the explicitly allowed: play ▶, certain status
  dots.
- **ISP-specific icons** (OLT, ONT, NAS, RADIUS, VLAN, PON port) — see
  `design-system/README.md` §4 for the existing Lucide → ISP-concept mapping
  (`router`, `server`, `radio`, `wifi`, `activity`, `gauge`, `network`,
  `cable`, `satellite-dish`). Reuse that map.

## Future flag

If we ever need a domain-specific icon Lucide doesn't have (e.g., specific
OLT chassis topology icons for the NOC), spec a `gx-isp-icons/` folder for
hand-rolled SVGs in the **exact same** Lucide style (24×24, 2px, round
caps, `currentColor`, `fill:none`). This keeps the visual register
consistent even when extending the set.
