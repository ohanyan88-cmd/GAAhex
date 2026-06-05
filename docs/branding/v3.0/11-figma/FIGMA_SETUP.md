# GAAhex™ Figma Setup

> **v3.0 logo (approved).** The canonical mark is now: the mark is the hexagon chevron with **filled cells** — four Cobalt structural hexagons, **two Azure signal hexagons** (the inner pair nearest the apex), and a **full-size Gold destination hexagon** at the apex. Wordmark: GAA Cobalt + hex Gold. Geometry, spacing, and typography are unchanged; only color assignment and the gold-node size changed. v2.0 mark archived at `_archive/v2.0/`.


> **D18 Color Architecture (authoritative).** Color is governed by `08-docs/GAAhex_D18_Color_Architecture_v2.0.md`: **Cobalt**=spine · **Gold**=signature · **Azure** `#0EA5E9`=interactive · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. Any earlier color guidance is superseded.

1. Import every SVG in `import/` (drag into a Figma page).
2. Create components: `Logo/Horizontal`, `Logo/Icon`, `Logo/Wordmark`; add variant property `mode = color | dark | white | black | grayscale | mono`.
3. Wrap mark+wordmark in Auto Layout (gap token = space-3). Add boolean prop `showWordmark`.
4. Import `tokens/gaahex-tokens.json` via the Tokens Studio plugin (or create Figma Variables) → color (light/dark modes), type, spacing, radius.
5. Publish as a Team Library. This file is the live design source of truth.
NOTE: native .fig authoring happens in Figma; these SVGs + tokens are the import package.