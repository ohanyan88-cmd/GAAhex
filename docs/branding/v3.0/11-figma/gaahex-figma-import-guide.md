# GAAhex™ — Figma Library Build Guide

> **v3.0 logo (approved).** The canonical mark is now: the mark is the hexagon chevron with **filled cells** — four Cobalt structural hexagons, **two Azure signal hexagons** (the inner pair nearest the apex), and a **full-size Gold destination hexagon** at the apex. Wordmark: GAA Cobalt + hex Gold. Geometry, spacing, and typography are unchanged; only color assignment and the gold-node size changed. v2.0 mark archived at `_archive/v2.0/`.


> **D18 Color Architecture (authoritative).** Color is governed by `08-docs/GAAhex_D18_Color_Architecture_v2.0.md`: **Cobalt**=spine · **Gold**=signature · **Azure** `#0EA5E9`=interactive · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. Any earlier color guidance is superseded.


A `.fig` is authored inside Figma; this package provides everything to assemble it in minutes.

## Tokens (Variables)
1. Install the "Tokens Studio" plugin.
2. Import `11-figma/tokens/gaahex-tokens.json` (W3C DTCG). It creates color/font/radius variables.
3. Push to Figma Variables; create modes `light` / `dark` (dark swaps cobalt → cobalt-lift).

## Components — import the SVGs
Drag these into a "GAAhex / Logos" page and convert each to a component, then add a `mode` variant property:
- `01-logo/horizontal/*.svg` (8 modes)
- `01-logo/secondary|stacked|vertical/*.svg`
- `01-logo/icon/*.svg`, `01-logo/wordmark/*.svg`, `01-logo/monogram/*.svg`

Icon page "GAAhex / Icons": logomark, monogram, favicon glyph (`03-favicon/favicon.svg`), app icon (`04-pwa/pwa-512.png` reference).

## Auto layout
Build the lockup as auto-layout: mark + wordmark, gap token `--gx-space-3`. Boolean prop `showWordmark`.

## Export presets
Attach: SVG, PNG @1x/2x/3x, and ICO (16/32/48) on the icon components.

## Publish
Publish as a team library; product + marketing consume components, never copies.
