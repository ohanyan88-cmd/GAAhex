# GAAhex™ — Developer Implementation Package

> **v3.0 logo (approved).** The canonical mark is now: the mark is the hexagon chevron with **filled cells** — four Cobalt structural hexagons, **two Azure signal hexagons** (the inner pair nearest the apex), and a **full-size Gold destination hexagon** at the apex. Wordmark: GAA Cobalt + hex Gold. Geometry, spacing, and typography are unchanged; only color assignment and the gold-node size changed. v2.0 mark archived at `_archive/v2.0/`.


> **D18 Color Architecture (authoritative).** Color is governed by `08-docs/GAAhex_D18_Color_Architecture_v2.0.md`: **Cobalt**=spine · **Gold**=signature · **Azure** `#0EA5E9`=interactive · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. Any earlier color guidance is superseded.


Self-contained integration guide. All assets in this package; tokens in `11-figma/tokens/`.

## 1. Logo usage
Serve SVG; PNG @2x fallback for legacy email. Always `alt="GAAhex"`.
```html
<img src="/01-logo/horizontal/gaahex-logo-horizontal-color.svg" alt="GAAhex" height="40">
```
Dark mode swap:
```html
<picture>
  <source srcset="/01-logo/horizontal/gaahex-logo-horizontal-dark.svg" media="(prefers-color-scheme: dark)">
  <img src="/01-logo/horizontal/gaahex-logo-horizontal-color.svg" alt="GAAhex" height="40">
</picture>
```
Sticky header collapses to icon-only below 640px (`/02-web-app/gaahex-header-mobile-color.svg`).

## 2. Favicon + PWA (head)
Use `03-favicon/head-snippet.html` verbatim. Manifest: `site.webmanifest` (icons 72–512 + maskable).

## 3. Open Graph / Twitter
```html
<meta property="og:image" content="https://www.gaahex.com/05-social/og-default.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://www.gaahex.com/05-social/twitter-card.png">
```

## 4. Tokens
Import `11-figma/tokens/gaahex-tokens.css` globally; consume `--gx-*`. SCSS, JSON (W3C DTCG), and JS variants provided. Dark mode auto-swaps `--gx-color-cobalt` → cobalt-lift.

## 5. Animation
```html
<object data="/09-animated/gaahex-anim-loading-loop.svg" type="image/svg+xml" aria-label="GAAhex loading"></object>
```
Hexagon-based (fade + scale + gold-node pulse). Built-in `prefers-reduced-motion` fallback to the static mark. No line/path animation. GIF fallbacks: `09-animated/gaahex-gif-{dark,transparent}-256.gif`.

## 6. Accessibility
`alt="GAAhex"` on informative logos; `aria-hidden="true"` on decorative repeats. High-contrast: `15-accessibility/gaahex-a11y-highcontrast-{dark,light}.svg` under `@media (forced-colors: active)` with `forced-color-adjust:none` on the logo only.

## 7. Brand rule (v2.0)
No connector/mesh lines anywhere. The mark = hexagon outline cells + gold destination hexagon + wordmark.
