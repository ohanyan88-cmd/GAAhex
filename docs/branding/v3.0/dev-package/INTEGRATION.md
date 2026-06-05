# GAAhex™ Developer Integration

**Brand version: v3.0 (current).** Approved canonical mark: filled hexagon chevron — four Cobalt structural hexagons, two Azure signal hexagons (inner pair), and a full-size Gold destination hexagon. Wordmark: GAA Cobalt + hex Gold. No connector/mesh lines. Geometry, spacing, and typography are locked.

> **D18 Color Architecture (authoritative, locked).** See the D18 Color Architecture standard in `08-docs/`. Roles: **Cobalt**=spine/structure · **Gold**=signature/destination · **Azure** `#0EA5E9`=interactive/signal · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. The D18 architecture is unchanged across brand versions; only the v3.0 logo color assignment was updated within it.

## Implementation
- **Logos:** serve SVG from `01-logo/`; PNG @2x fallback from `07-exports/png-transparent/`. Always `alt="GAAhex"`. Use the color lockup on light, the `-dark` lockup (cobalt-lift + azure + gold) on dark.
- **Dark mode:** swap to the `-dark` lockup via `prefers-color-scheme: dark`.
- **Favicons / PWA / OG:** wire up `03-favicon/head-snippet.html` and `site.webmanifest` (see also `03-favicon/README.md` for the intentional compact glyph).
- **Tokens:** import `11-figma/tokens/gaahex-tokens.css` (or `.scss/.js/.ts/.json/.swift/.xml`). Azure `#0EA5E9` is the interaction family.
- **Animation:** `09-animated/gaahex-anim-hero.svg` (looping signature) and `gaahex-anim-loading-loop.svg` / `gaahex-anim-loading-once.svg` (loaders) — distinct purposes, reduced-motion safe. Lottie: `gaahex-lottie-hero.json` (assemble showcase) and `gaahex-lottie-loading.json` (loader). GIFs: `gaahex-gif-social.gif` (light/social) and `gaahex-gif-dark.gif` (dark surfaces).
- **Component:** `dev-package/GaahexLogo.jsx` (loads the v3.0 SVGs; `mode="color|dark|white|black"`).

All references in this guide are v3.0. No prior-version guidance remains active.
