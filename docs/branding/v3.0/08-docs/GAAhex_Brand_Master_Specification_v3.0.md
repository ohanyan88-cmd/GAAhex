# GAAhex™ — Brand Master Specification v3.0

*Current brand version: **v3.0** (logo updated; geometry/spacing/typography unchanged). Supersedes the v2.0 predecessor.*

> **v3.0 logo (approved).** The canonical mark is now: the mark is the hexagon chevron with **filled cells** — four Cobalt structural hexagons, **two Azure signal hexagons** (the inner pair nearest the apex), and a **full-size Gold destination hexagon** at the apex. Wordmark: GAA Cobalt + hex Gold. Geometry, spacing, and typography are unchanged; only color assignment and the gold-node size changed. v3.0 mark archived at `_archive/v3.0/`.


> **D18 Color Architecture (authoritative).** Color is governed by `08-docs/GAAhex_D18_Color_Architecture_v3.0.md`: **Cobalt**=spine · **Gold**=signature · **Azure** `#0EA5E9`=interactive · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. Any earlier color guidance is superseded.


**Single source of truth for all GAAhex branding, design, web, mobile, SaaS, marketing, product, partnership, accessibility, merchandise, legal, and governance work.**

| | |
|---|---|
| Document | GAAhex Brand Master Specification |
| Version | 2.0 |
| Status | Active — authoritative |
| Total deliverables | 95 (88 production assets + 7 governance deliverables) |
| Replaces | All prior package specifications (fully consolidated herein) |
| Audience | Designers · Developers · Product · Marketing · Agencies · Partners · Legal · Leadership |

---

> **v2.0 — MAJOR visual identity change (connector lines removed).** Classified **MAJOR** per governance: removal of the connector/mesh layer is a change to the mark's visual composition. *Definition:* "geometry" = node coordinates and proportions (unchanged here); decorative layers (the former mesh) are not geometry. Connector lines removed. All connector / mesh / network / decorative line systems are deprecated and removed from the entire brand system. The mark now consists only of hexagon outline cells, the gold destination hexagon, and the wordmark. **The network is represented by the spatial relationship of the hexagonal nodes themselves. No explicit connector lines are used.** Geometry, spacing, colors, chevron direction, the gold destination node, and the wordmark are unchanged.

---

## Table of Contents

1. Brand Foundation
2. Brand Identity
3. Logo System
4. Color System
5. Typography System
6. Website & Application Assets
7. Favicon System
8. PWA & Mobile Install Assets
9. Social Media Assets
10. Marketing Assets
11. Print Assets
12. Source Files
13. Export Assets
14. Documentation Standards
15. Animated Logo System
16. Motion Guidelines
17. Email Signature System
18. Figma Design System
19. Design Tokens
20. Wallpaper System
21. Video Meeting Background System
22. Partner Branding
23. Co-Branding Rules
24. Sponsorship Branding
25. Merchandise System
26. Embroidery Standards
27. Engraving Standards
28. Vinyl Standards
29. Apparel Standards
30. Accessibility System
31. High Contrast Assets
32. WCAG Compliance
33. Small Size Optimization Rules
34. Developer Integration Guide
35. HTML Integration
36. PWA Manifest Integration
37. Open Graph Integration
38. Versioning Strategy
39. Maintenance Strategy
40. Governance System
41. Brand Approval Workflow
42. Asset Request Workflow
43. Agency Handoff Package
44. Trademark Usage Rules
45. Legal Protection Guidelines
46. International Usage & Localization Rules
47. Rebranding & Migration Framework
48. Enterprise Expansion Framework
49. Production Readiness Checklist
50. Master Asset Inventory

Appendices: A. Folder Structure · B. File Naming System

---

# 1. Brand Foundation

**Brand name:** GAAhex.

**The mark's meaning.** The logomark is a hexagonal chevron: six outlined hexagon cells step diagonally and converge into a single filled hexagon at the leading point. The hexagon is the universal cell of a network; the chevron is forward motion. Together the mark states the brand's core idea — a connected network moving toward a single point of value. Six cells (the served network) stream into one gold leading node (the destination, the outcome, the "hex"). It reads simultaneously as connectivity, momentum, and arrival.

**Brand essence.** Engineered, directional, premium, trustworthy. Cool structural blue carries the network; warm gold carries the value it delivers.

**Design philosophy.** Geometric precision over decoration. Flat, single-weight strokes. No gradients, glows, or effects on the mark. The mark must survive from a 16-pixel favicon to a building-scale banner without losing identity.

**Non-negotiables.** The geometry, proportions, and the cobalt/gold relationship are locked. The only sanctioned modification is geometric simplification at small sizes (Section 33).

---

# 2. Brand Identity

## 2.1 Mark anatomy

| Element | Definition |
|---|---|
| Cells | 6 pointy-top hexagons, outline only (no fill), Deep Cobalt stroke |
| Leading tip | 1 pointy-top hexagon, filled, Matte Gold, positioned at the chevron's apex (right) |
| Wordmark | `GAAhex` — `GAA` Deep Cobalt, `hex` Matte Gold |

**Network expression (brand law).** The network is represented by the spatial relationship of the hexagonal nodes themselves. No explicit connector, mesh, network, or decorative line is used anywhere in the brand system.

## 2.2 Construction (locked geometry)

The mark is built on pointy-top hexagons (a vertex at top). For a hexagon of circumradius `R` centered at `(cx, cy)`, vertices are at angles 30°, 90°, 150°, 210°, 270°, 330°, computed as `x = cx + R·cos(θ)`, `y = cy − R·sin(θ)`.

- **Outline cell radius `R_out` : fill tip radius `R_fill` = 34 : 30** (tip is ~88% of a cell).
- **Chevron arms.** Two arms of three cells each. Adjacent cell centers step by ratio **Δx : Δy = 62 : 52** (forward-and-up for the top arm, forward-and-down for the bottom arm). The filled tip leads by one additional step at the vertical center.
- **Stroke weight.** Outline cells use a stroke equal to `3.4 / 34 ≈ 10%` of the outline circumradius.

**Exact normalized coordinates** (the locked reference, in lockup units after the 0.62 build scale; preserve all relationships if rescaling):

| Cell | Center (x, y) | Type |
|---|---|---|
| Upper arm 1 | 90.8, 53.4 | cobalt outline |
| Upper arm 2 | 129.2, 85.6 | cobalt outline |
| Upper arm 3 | 167.6, 117.8 | cobalt outline |
| Lower arm 1 | 167.6, 182.2 | cobalt outline |
| Lower arm 2 | 129.2, 214.4 | cobalt outline |
| Lower arm 3 | 90.8, 246.6 | cobalt outline |
| Leading tip | 206, 150 | gold fill |

`R_out = 34 × 0.62 = 21.08`; `R_fill = 30 × 0.62 = 18.60`; outline stroke `= 3.4 × 0.62 = 2.108`. The mark contains no connector lines — the chevron is read from node spacing alone.

## 2.3 Wordmark

`GAAhex` set in **Sora**, weight 500, letter-spacing −1 (proportional to size). `GAA` in Deep Cobalt, `hex` in Matte Gold. In production source files the wordmark is converted to vector outlines so no live font is required for rendering.

## 2.4 Lockup relationship

In the primary horizontal lockup the mark sits left, vertically centered to the wordmark's optical center; the wordmark sits immediately right with a gap ≈ 10 units (at the 150-unit cap height). This spacing is fixed — mark and wordmark never re-scale independently.

---

# 3. Logo System

## 3.1 Variant catalog (assets 1–14)

| # | Asset / Purpose | Dimensions (master) | Format | Background | Light/Dark | Filename | Where used / Notes |
|---|---|---|---|---|---|---|---|
| 1 | Primary horizontal — mark left, wordmark right | 2400×740 (3.24:1) | SVG + PNG | Transparent | Both | `gaahex-logo-horizontal-color.svg` | Default everywhere; canonical lockup. |
| 2 | Primary vertical — mark top, wordmark below, left baseline | 1200×1600 | SVG + PNG | Transparent | Both | `gaahex-logo-vertical-color.svg` | Narrow columns, sidebars. |
| 3 | Primary stacked — mark centered above centered wordmark | 1400×1500 | SVG + PNG | Transparent | Both | `gaahex-logo-stacked-color.svg` | Splash, loading, print covers. |
| 4 | Secondary — wordmark left, mark right | 2400×740 | SVG + PNG | Transparent | Both | `gaahex-logo-secondary-color.svg` | Right-aligned footers, invoice headers. |
| 5 | Icon-only logomark | 1024×1024 | SVG + PNG | Transparent | Both | `gaahex-icon-color.svg` | App icon, favicon source, avatars; mark in safe square, 12% padding. |
| 6 | Text-only wordmark | 1800×520 | SVG + PNG | Transparent | Both | `gaahex-wordmark-color.svg` | Body lockups, email. |
| 7 | Monogram / initials | 1024×1024 | SVG + PNG | Transparent | Both | `gaahex-monogram-color.svg` | Tight avatars; bare gold tip hex if `Gh` illegible < 48 px. |
| 8 | Full-color version | Vector master | SVG | Transparent | — | `…-color.svg` | Master from which all derive. |
| 9 | Black version (`#0B0B0C`) | Vector master | SVG + PNG | Transparent | Light bg | `…-black.svg` | Single-ink, legal docs. |
| 10 | White version (`#FFFFFF`) | Vector master | SVG + PNG | Transparent | Dark bg | `…-white.svg` | Photo overlays, dark heroes. |
| 11 | Grayscale (cobalt→`#3A3D42`, gold→`#9A9A9A`) | Vector master | SVG + PNG | Transparent | Both | `…-grayscale.svg` | B/W print. |
| 12 | Single-color brand (one ink) | Vector master | SVG + PNG | Transparent | Light/Dark | `…-mono-cobalt.svg`, `…-mono-gold.svg` | Embroidery, one-color print. |
| 13 | Dark-mode (cobalt-lift cells + `GAA`, gold tip + `hex`) | Vector master | SVG + PNG | Transparent / `#0B0B0C` | Dark | `…-dark.svg` | Dark UI themes. |
| 14 | Light-mode (true cobalt + gold) | Vector master | SVG + PNG | Transparent / `#F4F5F7` | Light | `…-light.svg` | Light UI themes (= full-color). |

## 3.2 Clear space

Define `x` = the height of one hexagon cell in the mark. Minimum clear space on every side = **1×**. No text, edge, or other logo enters this zone.

## 3.3 Minimum sizes

| Lockup | Digital min | Print min |
|---|---|---|
| Horizontal full lockup | 120 px wide | 28 mm |
| Stacked / vertical | 90 px wide | 22 mm |
| Icon-only mark | 16 px | 6 mm |
| Wordmark only | 90 px wide | 22 mm |

## 3.4 Do / Don't

**Do:** use the master vector; scale uniformly; keep mark↔wordmark spacing locked; pick the color mode that matches the background; preserve clear space and minimum size.

**Don't:** recolor, gradient, or restyle the mark; stretch, skew, rotate, or reproportion; change the wordmark typeface or its cobalt/gold split; add shadows, outlines, or effects; place the full-color logo on busy or low-contrast backgrounds (use white/black version); recreate the mark by hand.

---

# 4. Color System

## 4.1 Palette

> **SUPERSEDED BY D18.** Retained for history only. Authoritative color = `GAAhex_D18_Color_Architecture_v2.0.md`. Interactive elements now use **Azure `#0EA5E9`**, not cobalt/cobalt-lift.

| Token | Hex | Role |
|---|---|---|
| `cobalt` | `#1C3B68` | Primary — mark cells, `GAA`, on light backgrounds |
| `cobalt-lift` | `#4E7FC4` | Dark-background substitute for cobalt (true cobalt is invisible on black) |
| `gold` | `#C5A059` | Accent — leading tip, `hex` |
| `ink` | `#0B0B0C` | Dark plate, black version base |
| `cloud` | `#F4F5F7` | Light plate |
| `border` | `#E2E5EA` | Optional plate/container edge (UI chrome — not a brand line; may be omitted) |
| `silver` | `#D8DCE0` | Neutral mark fill for single-color use on dark |

## 4.2 Light/dark behavior

- Backgrounds lighter than ~`#C8C8C8`: use true `cobalt` + `gold`.
- Backgrounds darker than ~`#3A3A3A`: swap `cobalt → cobalt-lift` for cells and `GAA`; `gold` is unchanged.
- Single-ink contexts: `mono-cobalt` on light, `mono-gold` or white on dark.
- The gold tip is never recolored to anything other than `#C5A059`.

## 4.3 Contrast (see Section 32 for full table)

`cobalt` on `cloud` = 9.2:1 (AAA). `cobalt` on white = 10.1:1 (AAA). `gold` on `ink` = 6.4:1 (AA; AAA for large only). Never set gold text on a light background without the cobalt anchor.

## 4.4 Print conversion (verify on press)

Cobalt ≈ C82 M65 Y22 K47. Gold ≈ C20 M33 Y68 K6. Pantone match to be confirmed with vendor against physical proof.

---

# 5. Typography System

**Primary typeface:** Sora (open-source, OFL). **Wordmark:** weight 500. **Headings:** weight 600. **Body:** weight 400. **Numerals:** tabular for data and tables.

**Fallback stack:** `'Sora', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.

**Email fallback** (web fonts unsupported): `Arial, Helvetica, sans-serif`; in email the wordmark always ships as a hosted image, never live text.

**Casing:** sentence case in all communications. The brand name renders exactly as `GAAhex`.

---

# 6. Website & Application Assets

| # | Asset / Purpose | Dimensions | Format | Background | Light/Dark | Filename | Placement / Notes |
|---|---|---|---|---|---|---|---|
| 15 | Website header logo | 220×64 / 440×128 @2x | SVG + PNG | Transparent | Both | `gaahex-header.svg` | Top nav left; serve SVG, PNG @2x fallback. |
| 16 | Sticky header logo (condensed) | 160×48 / 320×96 @2x | SVG + PNG | Transparent | Both | `gaahex-header-sticky.svg` | Shrinks on scroll; icon-only < 640 px viewport. |
| 17 | Mobile header logo | 40×40 | SVG + PNG | Transparent | Both | `gaahex-header-mobile.svg` | Mobile nav bar (icon-only). |
| 18 | Footer logo | 200×58 | SVG + PNG | Transparent | Dark typical | `gaahex-footer.svg` | Footer; often white/grayscale on dark. |
| 19 | Mobile menu logo | 180×120 | SVG + PNG | Transparent | Both | `gaahex-menu-mobile.svg` | Slide-out drawer header. |
| 20 | Loading screen logo (stacked) | 320×340 | SVG + PNG | Transparent / plate | Both | `gaahex-loading.svg` | Splash anchor; pulse on gold tip. |
| 21 | Empty-state logo (40% opacity) | 120×120 | SVG | Transparent | Both | `gaahex-emptystate.svg` | "No data" panels. |
| 22 | Error-page logo | 200×200 | SVG | Transparent | Both | `gaahex-error.svg` | 404 / 500 pages. |

---

# 7. Favicon System

| # | Asset / Purpose | Dimensions | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 23 | favicon.ico (multi-res) | 16/32/48 | ICO | Transparent | `favicon.ico` | Site root. Legacy browsers. |
| 24 | 16×16 favicon | 16×16 | PNG | Transparent | `favicon-16.png` | Uses compact 3-hex chevron (Section 33). |
| 25 | 32×32 favicon | 32×32 | PNG | Transparent | `favicon-32.png` | Simplified compact glyph. |
| 26 | 48×48 favicon | 48×48 | PNG | Transparent | `favicon-48.png` | Windows taskbar. |
| 27 | SVG favicon | scalable | SVG | Transparent | `favicon.svg` | Modern browsers; `prefers-color-scheme` swaps cobalt→cobalt-lift. |
| 28 | Safari pinned tab | scalable | SVG (1-color) | Transparent | `safari-pinned-tab.svg` | Monochrome flat silhouette; color via `mask-icon`. |
| 29 | Browser mask icon | scalable | SVG (1-color) | Transparent | `mask-icon.svg` | Identical geometry to #28. |

**Small-size rule:** at 16/24 px the favicon renders as the compact 3-hex filled chevron (two cobalt cells + gold tip); 32/48 px use the simplified full mark. The seven-cell outline mark is never used below 48 px.

---

# 8. PWA & Mobile Install Assets

| # | Asset / Purpose | Dimensions | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 30 | PWA icon | 72×72 | PNG | `#F4F5F7` | `pwa-72.png` | manifest. |
| 31 | PWA icon | 96×96 | PNG | `#F4F5F7` | `pwa-96.png` | manifest. |
| 32 | PWA icon | 128×128 | PNG | `#F4F5F7` | `pwa-128.png` | manifest. |
| 33 | PWA icon | 144×144 | PNG | `#F4F5F7` | `pwa-144.png` | manifest. |
| 34 | PWA icon | 152×152 | PNG | `#F4F5F7` | `pwa-152.png` | iOS legacy. |
| 35 | PWA icon | 192×192 | PNG | `#F4F5F7` | `pwa-192.png` | Android home (required). |
| 36 | PWA icon | 384×384 | PNG | `#F4F5F7` | `pwa-384.png` | Splash. |
| 37 | PWA icon | 512×512 | PNG | `#F4F5F7` | `pwa-512.png` | Install/splash (required). |
| 37m | PWA maskable | 512×512 | PNG | `#F4F5F7` | `pwa-512-maskable.png` | 20% safe padding inside circle. |
| 38 | Apple touch icon | 180×180 | PNG (no alpha) | `#F4F5F7` solid | `apple-touch-icon.png` | Mark centered, 16% padding. |
| 39 | Android adaptive icon | 432×432 (264 safe) | PNG layers | bg `#F4F5F7`, fg mark | `android-adaptive-fg.png`, `android-adaptive-bg.png` | Mark within 66% safe circle. |

---

# 9. Social Media Assets

| # | Asset / Purpose | Dimensions | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 40 | Open Graph image | 1200×630 | PNG/JPG | ink or cloud | `og-default.png` | Default link preview; stacked logo + tagline, 80 px safe margin. |
| 41 | Twitter/X card | 1200×628 | PNG/JPG | brand plate | `twitter-card.png` | `summary_large_image`. |
| 42 | LinkedIn share banner | 1200×627 | PNG/JPG | brand plate | `linkedin-share.png` | Link share. |
| 43 | Facebook cover | 851×315 (safe 820×312) | PNG/JPG | `#0B0B0C` | `facebook-cover.png` | Logo within safe center. |
| 44 | YouTube channel banner | 2560×1440 (safe 1546×423) | PNG/JPG | `#0B0B0C` | `youtube-banner.png` | TV-safe center governs. |
| 45 | GitHub profile banner | 1280×640 | PNG | brand plate | `github-banner.png` | README header. |
| 46 | Discord server icon | 512×512 (circle-safe) | PNG | `#F4F5F7` solid | `discord-icon.png` | Icon-only, centered. |
| 47 | Telegram profile image | 512×512 (circle-safe) | PNG | `#F4F5F7` solid | `telegram-icon.png` | Icon-only, circle-safe. |

---

# 10. Marketing Assets

| # | Asset / Purpose | Dimensions | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 48 | Email header logo | 600×140 (1200×280 @2x) | PNG | Transparent/white | `email-header.png` | Email blocks SVG → PNG; width ≤ 600 px. |
| 49 | Presentation logo | 1920×1080 safe; logo ~480 px | PNG + SVG | Transparent | `gaahex-presentation.png` | Slide master + title slide. |
| 50 | Watermark logo | 2000×2000, 8–12% opacity, grayscale | PNG | Transparent | `gaahex-watermark.png` | Document/photo overlay. |

---

# 11. Print Assets

| # | Asset / Purpose | Spec | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 51 | Print logo (CMYK) | 300 DPI ready | PDF + EPS (CMYK) | Transparent/white | `gaahex-print-cmyk.pdf` | Convert per Section 4.4; proof on press. |
| 52 | Large event/banner logo | Vector, any scale | PDF + EPS | Transparent/white | `gaahex-banner-large.pdf` | Booths, roll-ups; vector only, never upscale raster. |

---

# 12. Source Files

| # | Asset / Purpose | Format | Filename | Notes |
|---|---|---|---|---|
| 53 | SVG source | SVG | `gaahex-master.svg` | Layered, named groups, font outlined. Master of masters. |
| 54 | Illustrator source | AI | `gaahex-master.ai` | Layers per variant; global swatches; text outlined + live copy on hidden layer. |
| 55 | EPS source | EPS (CMYK + RGB) | `gaahex-master.eps` | Universal print-vendor format. |
| 56 | PDF source | PDF/X-1a | `gaahex-master.pdf` | Press-ready, fonts embedded/outlined. |

---

# 13. Export Assets

| # | Asset / Purpose | Spec | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 57 | Transparent PNG exports | @1x/@2x/@3x of each lockup | PNG-24 alpha | Transparent | `gaahex-{variant}-{mode}@2x.png` | General web/app. |
| 58 | High-resolution PNG | 4096 px longest edge | PNG-24 | Transparent | `gaahex-{variant}-{mode}-4096.png` | Print proofs, large displays. |
| 59 | JPG exports | 2400 px, q90 | JPG | solid cloud/ink | `gaahex-{variant}-{mode}.jpg` | Platforms rejecting transparency; never for transparent needs. |

---

# 14. Documentation Standards

| # | Deliverable | Format | Filename | Contents |
|---|---|---|---|---|
| 60 | Logo usage guide | PDF + MD | `gaahex-usage-guide.pdf` | Visual examples of every variant in context. |
| 61 | Minimum size rules | within guide | — | Section 3.3. |
| 62 | Clear-space rules | within guide | — | Section 3.2. |
| 63 | Palette + typography + do/don't | within guide | — | Sections 3.4, 4, 5. |

All documentation is versioned with this specification and carries the same version number.

---

# 15. Animated Logo System

| # | Asset / Purpose | Dimensions | Format | Background | Light/Dark | Filename | Notes |
|---|---|---|---|---|---|---|---|
| 64a | Animated SVG — hero | viewBox 865×320 | SVG + CSS | Transparent | Both | `gaahex-anim-hero.svg` | Hexagon cells fade-and-scale in sequence toward the tip; gold destination node scales-in last. No line drawing. |
| 64b | Animated SVG — loading | 320×340 | SVG + CSS | Transparent | Both | `gaahex-anim-loading-loop.svg`, `…-once.svg` | Hexagon cells fade/scale in sequence; gold node pulses (scale) as the focal beat; loop + non-loop twins. |
| 65 | Lottie package | scalable | JSON (Bodymovin) | Transparent | Both | `gaahex-lottie-hero.json`, `gaahex-lottie-loading.json` | Web `lottie-web`; iOS `lottie-ios`; Android `lottie-android`; < 60 KB. |
| 66a | Loading loop | 240×240 | Lottie + GIF | Transparent | Both | `gaahex-loading-loop.json` | 1.2 s loop, 30 fps. |
| 66b | App splash | 1242×2688 safe | Lottie + MP4 | `#0B0B0C` | Dark | `gaahex-splash.json` | 1.8 s play-once, mark assembles. |
| 66c | Dashboard loading | 160×160 | Lottie | Transparent | Both | `gaahex-loading-dashboard.json` | Panel skeleton state. |
| 67 | GIF package | 512×512 (+480×270) | GIF ≤256 colors | Transparent / `#0B0B0C` | Both | `gaahex-gif-transparent-512.gif`, `gaahex-gif-dark-512.gif`, `gaahex-gif-social-480.gif` | ≤ 2 MB, 24 fps, 2 s loop; matte alpha to target bg. |

---

# 16. Motion Guidelines

- **Duration:** 1.2–2.0 s for entrances; loops 1.2 s.
- **Easing:** `cubic-bezier(.2,.7,.2,1)`.
- **Choreography:** cells resolve along the chevron toward the tip; the gold tip is always the final, emphasized beat.
- **Never animate brand color values** — only opacity, position, and scale of the hexagon nodes.
- **No line-based, path-drawing, or network-connector animation.** Motion is hexagon appearance, scaling, fade-in, movement, and destination-node emphasis only.
- **Reduced motion:** every animation provides a static fallback equal to `gaahex-logo-*-color`, gated by `@media (prefers-reduced-motion: reduce)`.
- **Performance:** prefer SVG/CSS or Lottie over GIF/MP4; cap Lottie at 60 KB.

---

# 17. Email Signature System

| # | Asset / Purpose | Dimensions | Format | Background | Filename | Notes |
|---|---|---|---|---|---|---|
| 68 | Outlook signature | logo 180×42 (@2x 360×84) | HTML (tables) + PNG | white | `gaahex-signature-outlook.htm` | Word render engine: tables only, inline CSS, no SVG/flex/bg-image; PNG via absolute URL. Outlook Web uses same HTML. |
| 69 | Gmail signature | logo 180×42 | HTML (tables) + PNG | white | `gaahex-signature-gmail.htm` | Paste into Settings → Signature; mobile ≤ 320 px single column; text Arial fallback. |
| 70 | HTML signature template | responsive ≤ 600 px | HTML + assets | white | `gaahex-signature-template.html` | Clickable logo → site; social icon row; stacks < 480 px; copy/paste deploy steps for Outlook/Gmail/Apple Mail. |

**Email rules:** all CSS inline; all images absolute-hosted on a permanent CDN; `alt` on every image; no web fonts.

---

# 18. Figma Design System

| # | Asset / Purpose | Format | Filename | Notes |
|---|---|---|---|---|
| 71 | Logo component library | `.fig` (published) | `GAAhex-Logos.fig` | Components for horizontal/vertical/stacked/secondary; variant prop `mode={color,dark,white,black,grayscale,mono}`; auto-layout lockups; boolean `showWordmark`. |
| 72 | Icon component library | `.fig` | `GAAhex-Icons.fig` | Components: logomark, monogram, favicon-glyph (3-hex), app-icon (on-plate); export presets attached (SVG, PNG @1–3x, ICO). |

**Governance:** the published Figma library is the live design source of truth; product and marketing teams consume components, never copies.

---

# 19. Design Tokens

**Asset 73 — Brand token package.** Figma Variables + `gaahex-tokens.json` (W3C DTCG) + generated `gaahex-tokens.css` / SCSS / iOS / Android via Style Dictionary. Covers color (with light/dark modes), typography, spacing, and radius. CSS custom properties use the `--gx-` prefix.

```css
:root{
  --gx-color-cobalt:#1C3B68;
  --gx-color-cobalt-lift:#4E7FC4;
  --gx-color-gold:#C5A059;
  --gx-color-ink:#0B0B0C;
  --gx-color-cloud:#F4F5F7;
  --gx-color-border:#E2E5EA;
  --gx-color-silver:#D8DCE0;
  --gx-font-family:'Sora',system-ui,sans-serif;
  --gx-font-weight-body:400;
  --gx-font-weight-word:500;
  --gx-font-weight-heading:600;
  --gx-radius-md:8px;
  --gx-radius-lg:12px;
  --gx-radius-xl:28px;
  --gx-space-1:4px; --gx-space-2:8px; --gx-space-3:16px; --gx-space-4:24px;
}
@media (prefers-color-scheme:dark){
  :root{ --gx-color-cobalt:#4E7FC4; }
}
```

```json
{
  "color": {
    "cobalt": { "value": "#1C3B68" },
    "cobalt-lift": { "value": "#4E7FC4" },
    "gold": { "value": "#C5A059" },
    "ink": { "value": "#0B0B0C" },
    "cloud": { "value": "#F4F5F7" },
    "border": { "value": "#E2E5EA" }
  },
  "font": { "family": { "value": "Sora" }, "weight": { "word": { "value": 500 } } },
  "radius": { "lg": { "value": "12px" } }
}
```

---

# 20. Wallpaper System

| # | Asset / Purpose | Dimensions | Format | Background | Light/Dark | Filename | Notes |
|---|---|---|---|---|---|---|---|
| 74 | Desktop wallpapers | 1920×1080, 2560×1440, 3840×2160 | PNG/JPG | ink + cloud | Both | `gaahex-wallpaper-desktop-{WxH}-{mode}.png` | Mark off-center, subtle hexagon field; clear of taskbar/dock. |
| 75 | Laptop wallpapers | MacBook 2880×1800, 3024×1964; Windows 2256×1504 | PNG | ink + cloud | Both | `gaahex-wallpaper-laptop-{device}-{mode}.png` | Mac notch: mark below 120 px top margin. |
| 76 | Mobile wallpapers | iPhone 1290×2796, 1179×2556; Android 1440×3120 | PNG | ink + cloud | Both | `gaahex-wallpaper-mobile-{device}-{mode}.png` | Mark upper third, lock-screen safe. |

---

# 21. Video Meeting Background System

**Asset 77.** 1920×1080 (16:9), PNG/JPG, ink background, dark mode. Filenames `gaahex-vmbg-{zoom|meet|teams}-{mode}.png`. Logo lower-left to avoid face center and self-view. **Mirror-safe:** Zoom mirrors the self-view — keep the wordmark legible when flipped, or use the mark only.

---

# 22. Partner Branding

**Asset 78 — "Powered by GAAhex" lockup.** Horizontal 600×120 and vertical 300×180, SVG + PNG, transparent, light + dark (`gaahex-cobrand-poweredby-{horizontal|vertical}-{light|dark}.svg`). "Powered by" set in Sora 400 at 60% gray; minimum clear space 0.5×.

**Asset 79 — Partner lockup (equal weight).** SVG template `gaahex-cobrand-partner-template.svg`. Two logos at equal optical height separated by **clear space only** (gap = 2× the smaller logo's cap height); GAAhex left by default. **No divider line** — separation is spacing-based; the partner slot is a fill-only panel (no stroke), consistent with the no-line brand law.

---

# 23. Co-Branding Rules

- Never merge or fuse marks; always separate by **clear space** (no divider lines).
- At equal partnership tier, GAAhex is never rendered smaller than the partner.
- Maintain each logo's own clear space within the lockup.
- Co-brand templates are locked; teams fill the partner slot, they do not redraw the layout.

---

# 24. Sponsorship Branding

**Asset 80 — Sponsor lockup system.** SVG/PDF template `gaahex-cobrand-sponsor-template.svg`. Tiered grid with size ratios Platinum 1.0 / Gold 0.75 / Silver 0.55; equal optical weight within a row; GAAhex sized according to its own sponsor tier. Hierarchy top-to-bottom, highest tier largest.

---

# 25. Merchandise System

The mark is simplified for physical reproduction: details below minimum gauge eliminated; color count constrained to cobalt + gold (or single ink). Always digitize/prepare at final physical size. Sub-sections 26–29 give per-process standards.

| # | Asset | Format | Filename |
|---|---|---|---|
| 81 | Embroidery version | DST/PES/EMB + SVG ref | `gaahex-merch-embroidery-{standard\|hat\|polo}.dst` |
| 82 | Laser engraving version | SVG/DXF | `gaahex-merch-engraving-{mono\|metal}.dxf` |
| 83 | Vinyl cut version | SVG/EPS | `gaahex-merch-vinyl.svg` |
| 84 | Apparel print package | PNG (300 DPI) + SVG | `gaahex-merch-apparel-{frontchest\|fullfront\|back\|sleeve}-{light\|dark}.png` |

---

# 26. Embroidery Standards

Minimum mark width 50 mm (hat ≤ 60 mm; polo left-chest ≤ 90 mm). Fill columns ≥ 1.2 mm; no detail below that gauge. Maximum two thread colors (cobalt + gold). Digitize at final size; outline cells become satin/fill columns, not strokes.

---

# 27. Engraving Standards

Single color (engraving has no color — tonal only). Provide two twins: raster-engrave (filled shapes) and vector-cut (stroke paths). Metal-safe: minimum 0.3 mm line; outline-only paths. Files in SVG/DXF.

---

# 28. Vinyl Standards

No floating islands — bridge interior counters or convert to solid shapes; merge overlaps; one compound path per color; weed-friendly. Manufacturing-ready cut paths in SVG/EPS.

---

# 29. Apparel Standards

Placements: front-chest 90 mm, full-front 300 mm, back 320 mm, sleeve 70 mm. Provide light-garment (cobalt + gold) and dark-garment (cobalt-lift or white + gold) variants. Screen-print uses spot colors; DTG uses 300 DPI PNG.

---

# 30. Accessibility System

Every logo instance carries a text alternative (`alt="GAAhex"` or `aria-label="GAAhex"`). Decorative repeats are hidden from assistive tech (`aria-hidden="true"`). Meaning is never conveyed by color alone. Gold on light fails contrast for text — never place gold text or `hex` on a light background without the cobalt anchor.

| # | Asset | Format | Background | Filename |
|---|---|---|---|---|
| 85 | WCAG-compliant variants | SVG | per pairing | `gaahex-a11y-aa.svg`, `gaahex-a11y-aaa.svg` |
| 86 | Small-size optimized | SVG + PNG | transparent | `gaahex-a11y-{16\|24\|32\|48}.png` |
| 87 | High-contrast set | SVG + PNG | ink + white | `gaahex-a11y-highcontrast-{dark\|light}.svg` |
| 88 | Accessibility documentation | PDF + MD | — | `gaahex-accessibility.pdf` |

---

# 31. High Contrast Assets

**Asset 87.** For Windows High Contrast / `forced-colors` mode. Dark background: white mark + gold tip. Light background: ink mark. Honor `@media (forced-colors: active)`; apply `forced-color-adjust: none` only on the logo so its identity survives forced palettes.

---

# 32. WCAG Compliance

**Asset 85 / 88.** AA requires ≥ 4.5:1 for text-equivalent contrast; AAA ≥ 7:1.

| Foreground | Background | Ratio | Level |
|---|---|---|---|
| Cobalt `#1C3B68` | White `#FFFFFF` | 10.1:1 | AAA |
| Cobalt `#1C3B68` | Cloud `#F4F5F7` | 9.2:1 | AAA |
| Cobalt-lift `#4E7FC4` | Ink `#0B0B0C` | 5.6:1 | AA |
| Gold `#C5A059` | Ink `#0B0B0C` | 6.4:1 | AA (AAA large only) |
| White `#FFFFFF` | Ink `#0B0B0C` | 19.6:1 | AAA |

Pick the pairing that meets the required level for the context; for body-size text equivalents, AAA pairings are preferred.

---

# 33. Small Size Optimization Rules

- ≥ 96 px: full mark.
- 48 px: simplified full mark, thicker stroke.
- 32 px: simplified full mark.
- 16–24 px: compact 3-hex filled chevron (two cobalt cells + gold tip) — bold, solid, pixel-snapped.
- The seven-cell outline mark is never reproduced below 48 px.

---

# 34. Developer Integration Guide

This section is self-contained; a developer needs nothing else to integrate the brand.

**Logo delivery.** Serve SVG for all in-app logos; provide PNG @2x fallback for legacy email/clients. Always set `alt="GAAhex"`.

**Dark mode.** Swap to the `-dark` lockup (cobalt-lift) under `@media (prefers-color-scheme: dark)`:
```css
.logo-light{ display:block; } .logo-dark{ display:none; }
@media (prefers-color-scheme:dark){ .logo-light{display:none;} .logo-dark{display:block;} }
```

**Sticky/responsive header.** Collapse to icon-only below 640 px viewport.

**Animation.**
```html
<object data="/gaahex-anim-hero.svg" type="image/svg+xml" aria-label="GAAhex"></object>
```
```javascript
import lottie from 'lottie-web';
lottie.loadAnimation({
  container: document.getElementById('gx-loading'),
  path: '/gaahex-lottie-loading.json',
  renderer: 'svg', loop: true, autoplay: true
});
```
```css
@media (prefers-reduced-motion: reduce){ #gx-loading object, #gx-loading svg { animation:none !important; } }
```

**Token integration.** Import `gaahex-tokens.css` globally; consume `--gx-*` variables in components.

**Figma integration.** Link `GAAhex-Logos.fig` and `GAAhex-Icons.fig` as a team library; enable the `gaahex-tokens` variable collection.

**Accessibility.** `alt="GAAhex"` on informative logos; `aria-hidden="true"` on decorative repeats; high-contrast variant under `@media (forced-colors: active)`.

---

# 35. HTML Integration

```html
<!-- Favicons -->
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">

<!-- Apple / Safari -->
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#1C3B68">

<!-- PWA -->
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#1C3B68">
<meta name="apple-mobile-web-app-title" content="GAAhex">
```

---

# 36. PWA Manifest Integration

```json
{
  "name": "GAAhex",
  "short_name": "GAAhex",
  "theme_color": "#1C3B68",
  "background_color": "#F4F5F7",
  "display": "standalone",
  "icons": [
    { "src": "/pwa-72.png",  "sizes": "72x72",   "type": "image/png" },
    { "src": "/pwa-96.png",  "sizes": "96x96",   "type": "image/png" },
    { "src": "/pwa-128.png", "sizes": "128x128", "type": "image/png" },
    { "src": "/pwa-144.png", "sizes": "144x144", "type": "image/png" },
    { "src": "/pwa-152.png", "sizes": "152x152", "type": "image/png" },
    { "src": "/pwa-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/pwa-384.png", "sizes": "384x384", "type": "image/png" },
    { "src": "/pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/pwa-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

---

# 37. Open Graph Integration

```html
<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:title" content="GAAhex">
<meta property="og:description" content="GAAhex — your description here.">
<meta property="og:image" content="https://www.gaahex.com/og-default.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="https://www.gaahex.com/">

<!-- Twitter / X -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="GAAhex">
<meta name="twitter:description" content="GAAhex — your description here.">
<meta name="twitter:image" content="https://www.gaahex.com/twitter-card.png">
```

---

# 38. Versioning Strategy

- **SemVer** `vMAJOR.MINOR.PATCH`. MAJOR = mark/geometry change (rare, leadership sign-off). MINOR = new asset groups. PATCH = fixes/re-exports.
- This document is **v1.0** and governs the current asset set.
- Each release is date-stamped: `gaahex-brand-vX.Y.Z-YYYYMMDD.zip`.
- A root `CHANGELOG.md` records every change.

---

# 39. Maintenance Strategy

- **Frozen master.** `00-source` is the single source of truth; downstream assets are never hand-edited — they are re-exported from the master.
- **Version control.** Git + Git LFS for binaries; releases tagged. Figma library is the live design source.
- **Review cadence.** Quarterly audit (broken links, platform spec drift such as new PWA/social dimensions); annual full refresh.
- **Asset lifecycle.** Draft → Review → Approved → Published → Deprecated → Archived.
- **Deprecation policy.** Superseded assets move to `/_archive/vX` for one release cycle before removal.
- **Archive policy.** Every shipped release is archived in full and retained for at least five years.
- **Ownership model.** Brand owner approves MAJOR/MINOR; any team may request PATCH via the asset request workflow (Section 42).

---

# 40. Governance System

Brand governance ensures consistency, protects the trademark, and routes every request through a defined approval path. Three pillars: **Approval Workflow** (Section 41), **Asset Request Workflow** (Section 42), and **Agency Handoff** (Section 43). A single **Brand Owner** holds final authority; a **Brand Council** (design, marketing, product, legal leads) advises on MINOR/MAJOR changes.

---

# 41. Brand Approval Workflow

**(Governance deliverable 89.)**

**Request process.** Requester submits a brand request (Section 42 template) through the brand request channel with use case, audience, deadline, and target format.

**Review stages.**
1. Intake & triage (Brand Coordinator) — completeness check, routing.
2. Design review (Design Lead) — on-brand compliance against this specification.
3. Legal review (Legal, when external/partner/trademark-bearing) — usage and licensing.
4. Final approval (Brand Owner) — sign-off and release.

**Stakeholders.** Requester · Brand Coordinator · Design Lead · Legal · Brand Owner.

**Approval matrix.**

| Request type | Design Lead | Legal | Brand Owner |
|---|---|---|---|
| Internal reuse of existing approved asset | Notify | — | — |
| New internal asset (existing rules) | Approve | — | Notify |
| External/marketing public asset | Approve | Review | Approve |
| Partner/co-brand/sponsor lockup | Approve | Approve | Approve |
| Logo/geometry/color change (MAJOR) | Approve | Approve | Approve (required) |

**Emergency approval path.** For time-critical needs (live incident, press deadline), the Brand Owner or a designated deputy may grant provisional approval verbally/async; the standard review is completed retroactively within 48 hours, and the asset is flagged provisional until ratified.

---

# 42. Asset Request Workflow

**(Governance deliverable 90 — request templates.)**

Common fields for all templates: requester, team, date, deadline, use case, audience, channel, required formats/sizes, background (light/dark), and approval level needed.

**Marketing request template**
- Campaign / initiative name
- Channels (web, social, email, print, paid)
- Asset(s) needed (reference master inventory numbers)
- Localization needs (Section 46)
- Deadline and owner

**Product request template**
- Product surface (web app, mobile, PWA)
- Component / state (header, loading, empty, error, favicon, app icon)
- Theme (light/dark) and breakpoints
- Token dependencies
- Engineering contact

**Event request template**
- Event name, date, location, scale
- Banner/signage sizes and material
- Sponsor/partner lockups required (tier)
- Print vendor and color space
- On-site contact

**Partner request template**
- Partner name and relationship tier
- Lockup type (powered-by / equal-weight / sponsor)
- Placement and clear-space confirmation
- Both parties' approved logo sources
- Legal/licensing reference

**Agency request template**
- Scope of work and deliverables (inventory numbers)
- Source files required (Section 12)
- Brand constraints (this specification version)
- Review checkpoints and acceptance criteria
- Ownership/IP transfer terms (Section 43)

---

# 43. Agency Handoff Package

**(Governance deliverable 91.)**

**Required files.** Source masters (53–56); full SVG/PNG/JPG export sets (57–59); icon/favicon/PWA sets (23–39); token package (73); Figma libraries (71–72); this specification document.

**Required documentation.** This Brand Master Specification v1.0; usage guide (60); accessibility documentation (88); naming convention (Appendix B); folder structure (Appendix A).

**Deliverables checklist.**
- [ ] All commissioned assets delivered in specified formats and sizes
- [ ] Naming convention (Appendix B) applied exactly
- [ ] Folder structure (Appendix A) matched, no duplicates
- [ ] Light/dark and accessibility variants included where applicable
- [ ] Source/editable files provided, not only flattened exports

**Ownership transfer checklist.**
- [ ] Full IP and copyright assigned to GAAhex in writing
- [ ] Fonts properly licensed (Sora is OFL; confirm any others)
- [ ] Third-party/stock assets cleared or removed
- [ ] Editable source files and working files handed over
- [ ] Credentials/links (Figma, repos) transferred

**Quality assurance checklist.**
- [ ] Geometry matches Section 2.2 (no redrawn mark)
- [ ] Colors match exact hex values (Section 4)
- [ ] Contrast meets target WCAG level (Section 32)
- [ ] Renders correctly at minimum sizes (Sections 3.3, 33)
- [ ] No off-brand effects, gradients, or distortions

---

# 44. Trademark Usage Rules

**(Governance deliverable 92.)**

**Proper logo usage.** Use only supplied files; preserve geometry, proportions, color, and clear space; pair the correct color mode with the background; use the registered name as `GAAhex`.

**Improper logo usage.** Do not recolor, distort, rotate, skew, outline, add effects, place on low-contrast/busy backgrounds, recreate by hand, alter the wordmark typeface, or combine the mark with other graphics into a new mark.

**Third-party usage.** External parties (press, partners, integrators) may use the logo only per a written usage grant and only with unmodified supplied files; they must follow clear-space and minimum-size rules and may not imply endorsement beyond the agreed relationship.

**Licensing considerations.** Any commercial or co-branded use requires written permission and routes through Sections 41 and 45. Merchandise reproduction follows Sections 25–29.

**Protection standards.** Mark the wordmark/logo with ™ (or ® where registered) in first or prominent use per legal guidance; maintain a public brand-use page with downloadable approved assets and rules.

---

# 45. Legal Protection Guidelines

**(Governance deliverable 93.)**

**Asset ownership.** All brand assets, source files, and derivatives are the exclusive property of GAAhex. Agency/contractor work is work-for-hire with full assignment (Section 43).

**Copyright guidance.** The logo, wordmark, and documentation are protected by copyright on creation; retain dated source files and the changelog as authorship records.

**Trademark considerations.** Pursue registration of the wordmark and logomark in operating jurisdictions; track classes relevant to the business (e.g., telecommunications/software services); monitor for conflicting marks before expansion (Section 48).

**Brand misuse handling process.**
1. Detect (monitoring, reports).
2. Assess severity and intent (innocent vs. infringing vs. damaging).
3. First contact: notify and request correction/removal with the correct assets.
4. Escalate to formal legal notice if unresolved.
5. Enforce per counsel; document the outcome.

**Evidence collection process.** Capture dated screenshots/URLs, archive copies (with timestamps), record context and reach, and store in a dedicated case file; preserve originals unaltered for legal use.

---

# 46. International Usage & Localization Rules

**(Governance deliverable 94.)**

**RTL languages.** The mark is direction-neutral and is not mirrored. In right-to-left layouts (Arabic, Hebrew), the lockup may flip to wordmark-right/mark-left only using the approved **secondary** lockup (asset 4); the chevron's forward direction is never reversed.

**Non-Latin typography.** The `GAAhex` wordmark remains in Latin Sora as a fixed brand asset and is not transliterated. Surrounding UI/marketing copy uses an approved script-appropriate companion face (e.g., Noto family) at matching weight; the brand name stays `GAAhex`.

**Regional adaptations.** Color, geometry, and spacing are global constants. Only background choice and companion typography adapt regionally. Cultural-sensitivity review precedes any market launch.

**Country-specific considerations.** Verify trademark availability and meaning of the name/mark per market before entry (Section 48); confirm no color/symbol conflicts with local conventions.

**Translation governance.** Taglines and descriptions are translated by approved linguists and reviewed by the regional lead; the brand name and the wordmark are never translated. Localized strings are versioned alongside this specification.

---

# 47. Rebranding & Migration Framework

**(Governance deliverable 95.)**

**Partial rebrand process.** Scope the change (e.g., palette refresh or new lockup) without altering core geometry; bump MINOR version; regenerate affected assets from master; stage rollout behind the standard approval path.

**Full rebrand process.** Mark/geometry change requires leadership sign-off and a MAJOR version; commission new master; rebuild the entire inventory; full legal re-clearance and re-registration.

**Asset migration process.** Inventory current placements; map old→new asset for every surface; re-export from the new master; replace in priority order (Section 49 order); archive superseded assets to `/_archive`.

**Rollout strategy.** Phased — internal tools first, then web/app, then social/marketing, then print/merch; coordinate a single public switch-over date for outward-facing surfaces.

**Rollback strategy.** Retain the previous full release archive; keep prior assets deployable for one cycle; if a blocking issue appears, revert affected surfaces to the archived release and re-stage.

**Communication strategy.** Internal announcement and asset access first; partner/press notice with updated usage grant; public reveal aligned to the switch-over; update the brand-use page and all manifests/meta in the same release.

---

# 48. Enterprise Expansion Framework

As GAAhex adds products, regions, or sub-brands, the system extends without forking identity:
- **Sub-brands / product marks.** Reuse the cobalt/gold system and Sora; differentiate by product wordmark beside the shared mark, never by altering the mark.
- **Naming.** New product names follow the established casing and pair with the existing lockup grammar.
- **New regions.** Clear trademark and localization (Sections 44–46) before launch.
- **New surfaces/platforms.** Add asset groups via a MINOR version; specify them in this document; generate from master.
- **Scale of governance.** As teams grow, the Brand Council formalizes; the asset request workflow (Section 42) becomes the single intake.

---

# 49. Production Readiness Checklist

**Recommended asset generation order:** 1) source master (53–56) → 2) core lockups + modes (1–14) → 3) icon/favicon/PWA (23–39) → 4) web/app states (15–22) → 5) social (40–47) → 6) tokens + Figma (71–73) → 7) animated (64–67) → 8) email signatures (68–70) → 9) wallpapers + video bg (74–77) → 10) marketing/print + co-brand (48–52, 78–80) → 11) merchandise (81–84) → 12) accessibility + all documentation (85–88, 60–63) → 13) governance docs (89–95).

**Readiness checklist.**
- [ ] Frozen master produced; all lockups derive from it
- [ ] Sora outlined in all final exports (no live-font dependency)
- [ ] All color modes generated (color, black, white, grayscale, mono-cobalt, mono-gold, dark, light)
- [ ] Favicons ≤ 32 px use the simplified/compact glyph; full set + ICO produced
- [ ] PWA 72→512 + maskable + apple-touch + Android adaptive produced
- [ ] Social assets respect each platform's safe zone
- [ ] Print files in CMYK and proofed on target stock
- [ ] Animated assets include reduced-motion fallback; Lottie < 60 KB; loop/non-loop twins
- [ ] Email signatures: table-only, inline CSS, absolute-hosted images, Arial fallback
- [ ] Figma libraries published with variant props + export presets
- [ ] Tokens exported (JSON + CSS/SCSS/iOS/Android)
- [ ] Wallpapers + mirror-safe video backgrounds for all listed sizes
- [ ] Co-brand and merch templates enforce clear-space/equal-weight/gauge rules
- [ ] Accessibility: contrast documented; forced-colors handled; `alt`/`aria` standards applied
- [ ] All filenames follow Appendix B; folder tree matches Appendix A
- [ ] Governance docs (89–95) completed and circulated

**Dependencies requiring third-party tools/proofing:** native `.ai` (Illustrator); CMYK proofing (press); Lottie authoring (After Effects/Bodymovin); embroidery/vinyl/engraving files (vendor digitizing); `.fig` authoring (Figma); trademark registration (legal). Interim vector deliverables stand in until each is finalized.

---

# 50. Master Asset Inventory

Status legend: **Built** (produced) · **Spec** (specified, ready to generate) · **Vendor** (needs manufacturer files) · **Tool** (needs third-party authoring tool).

| # | Asset name | Category | Format | Dimensions | File name root | Status |
|---|---|---|---|---|---|---|
| 1 | Primary horizontal logo | Logo | SVG+PNG | 2400×740 | gaahex-logo-horizontal-color | Built |
| 2 | Primary vertical logo | Logo | SVG+PNG | 1200×1600 | gaahex-logo-vertical-color | Spec |
| 3 | Primary stacked logo | Logo | SVG+PNG | 1400×1500 | gaahex-logo-stacked-color | Spec |
| 4 | Secondary logo | Logo | SVG+PNG | 2400×740 | gaahex-logo-secondary-color | Spec |
| 5 | Icon-only logomark | Logo | SVG+PNG | 1024² | gaahex-icon-color | Built |
| 6 | Text-only wordmark | Logo | SVG+PNG | 1800×520 | gaahex-wordmark-color | Spec |
| 7 | Monogram | Logo | SVG+PNG | 1024² | gaahex-monogram-color | Spec |
| 8 | Full-color version | Color | SVG | master | gaahex-logo-horizontal-color | Built |
| 9 | Black version | Color | SVG+PNG | master | gaahex-logo-horizontal-black | Built |
| 10 | White version | Color | SVG+PNG | master | gaahex-logo-horizontal-white | Built |
| 11 | Grayscale version | Color | SVG+PNG | master | gaahex-logo-horizontal-grayscale | Spec |
| 12 | Single-color brand | Color | SVG+PNG | master | gaahex-logo-horizontal-mono-cobalt/-gold | Built (cobalt) |
| 13 | Dark-mode version | Mode | SVG+PNG | master | gaahex-logo-horizontal-dark | Built |
| 14 | Light-mode version | Mode | SVG+PNG | master | gaahex-logo-horizontal-light | Built |
| 15 | Website header logo | Web | SVG+PNG | 220×64 | gaahex-header | Spec |
| 16 | Sticky header logo | Web | SVG+PNG | 160×48 | gaahex-header-sticky | Spec |
| 17 | Mobile header logo | Web | SVG+PNG | 40×40 | gaahex-header-mobile | Spec |
| 18 | Footer logo | Web | SVG+PNG | 200×58 | gaahex-footer | Spec |
| 19 | Mobile menu logo | Web | SVG+PNG | 180×120 | gaahex-menu-mobile | Spec |
| 20 | Loading screen logo | Web | SVG+PNG | 320×340 | gaahex-loading | Spec |
| 21 | Empty-state logo | Web | SVG | 120² | gaahex-emptystate | Spec |
| 22 | Error-page logo | Web | SVG | 200² | gaahex-error | Spec |
| 23 | favicon.ico | Favicon | ICO | 16/32/48 | favicon | Built |
| 24 | Favicon 16 | Favicon | PNG | 16² | favicon-16 | Built |
| 25 | Favicon 32 | Favicon | PNG | 32² | favicon-32 | Built |
| 26 | Favicon 48 | Favicon | PNG | 48² | favicon-48 | Built |
| 27 | SVG favicon | Favicon | SVG | scalable | favicon | Built |
| 28 | Safari pinned tab | Favicon | SVG | scalable | safari-pinned-tab | Built |
| 29 | Mask icon | Favicon | SVG | scalable | mask-icon | Built |
| 30 | PWA 72 | PWA | PNG | 72² | pwa-72 | Built |
| 31 | PWA 96 | PWA | PNG | 96² | pwa-96 | Built |
| 32 | PWA 128 | PWA | PNG | 128² | pwa-128 | Built |
| 33 | PWA 144 | PWA | PNG | 144² | pwa-144 | Built |
| 34 | PWA 152 | PWA | PNG | 152² | pwa-152 | Built |
| 35 | PWA 192 | PWA | PNG | 192² | pwa-192 | Built |
| 36 | PWA 384 | PWA | PNG | 384² | pwa-384 | Built |
| 37 | PWA 512 (+maskable) | PWA | PNG | 512² | pwa-512, pwa-512-maskable | Built |
| 38 | Apple touch icon | PWA | PNG | 180² | apple-touch-icon | Built |
| 39 | Android adaptive icon | PWA | PNG layers | 432² | android-adaptive-fg/bg | Spec |
| 40 | Open Graph image | Social | PNG | 1200×630 | og-default | Built |
| 41 | Twitter/X card | Social | PNG | 1200×628 | twitter-card | Built |
| 42 | LinkedIn share banner | Social | PNG | 1200×627 | linkedin-share | Built |
| 43 | Facebook cover | Social | PNG | 851×315 | facebook-cover | Spec |
| 44 | YouTube banner | Social | PNG | 2560×1440 | youtube-banner | Spec |
| 45 | GitHub banner | Social | PNG | 1280×640 | github-banner | Spec |
| 46 | Discord icon | Social | PNG | 512² | discord-icon | Built |
| 47 | Telegram icon | Social | PNG | 512² | telegram-icon | Built |
| 48 | Email header logo | Marketing | PNG | 600×140 | email-header | Spec |
| 49 | Presentation logo | Marketing | PNG+SVG | 1920×1080 | gaahex-presentation | Spec |
| 50 | Watermark logo | Marketing | PNG | 2000² | gaahex-watermark | Spec |
| 51 | Print logo (CMYK) | Print | PDF+EPS | vector | gaahex-print-cmyk | Vendor |
| 52 | Large banner logo | Print | PDF+EPS | vector | gaahex-banner-large | Vendor |
| 53 | SVG source | Source | SVG | vector | gaahex-master | Built |
| 54 | Illustrator source | Source | AI | vector | gaahex-master | Tool |
| 55 | EPS source | Source | EPS | vector | gaahex-master | Tool |
| 56 | PDF source | Source | PDF/X | vector | gaahex-master | Tool |
| 57 | Transparent PNG exports | Export | PNG | @1–3x | per variant | Built (core) |
| 58 | High-res PNG exports | Export | PNG | 4096 | per variant | Spec |
| 59 | JPG exports | Export | JPG | 2400 | per variant | Spec |
| 60 | Logo usage guide | Docs | PDF+MD | — | gaahex-usage-guide | Built (in this doc) |
| 61 | Minimum size rules | Docs | in guide | — | — | Built |
| 62 | Clear-space rules | Docs | in guide | — | — | Built |
| 63 | Palette/type/do-don't | Docs | in guide | — | — | Built |
| 64 | Animated SVG logo | Animated | SVG | 865×320 / 320×340 | gaahex-anim-hero/loading | Spec |
| 65 | Lottie package | Animated | JSON | scalable | gaahex-lottie-hero/loading | Tool |
| 66 | Animated loading logo | Animated | Lottie+GIF | 160–1242 | gaahex-loading-*/splash | Tool |
| 67 | GIF package | Animated | GIF | 512²/480×270 | gaahex-gif-transparent/dark/social | Spec |
| 68 | Outlook signature | Email-sig | HTML+PNG | 360×84 | gaahex-signature-outlook | Spec |
| 69 | Gmail signature | Email-sig | HTML+PNG | 360×84 | gaahex-signature-gmail | Spec |
| 70 | HTML signature template | Email-sig | HTML | ≤600 | gaahex-signature-template | Spec |
| 71 | Figma logo library | Figma | FIG | — | GAAhex-Logos | Tool |
| 72 | Figma icon library | Figma | FIG | — | GAAhex-Icons | Tool |
| 73 | Brand token package | Tokens | JSON+CSS | — | gaahex-tokens | Built (CSS/JSON) |
| 74 | Desktop wallpapers | Wallpaper | PNG/JPG | 1080p/1440p/4K | gaahex-wallpaper-desktop | Spec |
| 75 | Laptop wallpapers | Wallpaper | PNG | retina | gaahex-wallpaper-laptop | Spec |
| 76 | Mobile wallpapers | Wallpaper | PNG | device | gaahex-wallpaper-mobile | Spec |
| 77 | Video meeting backgrounds | Wallpaper | PNG/JPG | 1920×1080 | gaahex-vmbg | Spec |
| 78 | Powered-by lockup | Co-brand | SVG+PNG | 600×120 | gaahex-cobrand-poweredby | Spec |
| 79 | Partner lockup | Co-brand | SVG | template | gaahex-cobrand-partner | Spec |
| 80 | Sponsor lockup | Co-brand | SVG/PDF | template | gaahex-cobrand-sponsor | Spec |
| 81 | Embroidery version | Merch | DST/PES+SVG | ≥50 mm | gaahex-merch-embroidery | Vendor |
| 82 | Laser engraving version | Merch | SVG/DXF | vector | gaahex-merch-engraving | Vendor |
| 83 | Vinyl cut version | Merch | SVG/EPS | vector | gaahex-merch-vinyl | Vendor |
| 84 | Apparel print package | Merch | PNG+SVG | 70–320 mm | gaahex-merch-apparel | Spec |
| 85 | WCAG-compliant variants | A11y | SVG | — | gaahex-a11y-aa/aaa | Spec |
| 86 | Small-size optimized | A11y | SVG+PNG | 16/24/32/48 | gaahex-a11y-{n} | Built (16–48) |
| 87 | High-contrast set | A11y | SVG+PNG | — | gaahex-a11y-highcontrast | Spec |
| 88 | Accessibility documentation | A11y | PDF+MD | — | gaahex-accessibility | Built (in this doc) |
| 89 | Brand Approval Workflow | Governance | MD/PDF | — | gaahex-gov-approval | Built (Section 41) |
| 90 | Asset Request Templates | Governance | MD/PDF | — | gaahex-gov-request-templates | Built (Section 42) |
| 91 | Agency Handoff Package | Governance | MD/PDF | — | gaahex-gov-agency-handoff | Built (Section 43) |
| 92 | Trademark Usage Guide | Governance | MD/PDF | — | gaahex-gov-trademark | Built (Section 44) |
| 93 | Legal Protection Package | Governance | MD/PDF | — | gaahex-gov-legal | Built (Section 45) |
| 94 | International Localization Rules | Governance | MD/PDF | — | gaahex-gov-localization | Built (Section 46) |
| 95 | Rebranding/Migration Playbook | Governance | MD/PDF | — | gaahex-gov-rebrand | Built (Section 47) |

**Total: 95 numbered deliverables** (88 production assets + 7 governance deliverables).

---

# Appendix A — Folder Structure

```
gaahex-brand/
├── 00-source/             (53–56: ai, eps, pdf, svg masters)
├── 01-logo/               (1–14)
│   ├── horizontal/  ├── vertical/  ├── stacked/  ├── secondary/
│   ├── icon/  ├── wordmark/  └── monogram/
├── 02-web-app/            (15–22)
├── 03-favicon/            (23–29 + head-snippet.html)
├── 04-pwa/                (30–39 + site.webmanifest)
├── 05-social/             (40–47)
├── 06-marketing-print/    (48–52)
├── 07-exports/            (57–59: png-transparent, png-highres, jpg)
├── 08-docs/               (60–63 usage guide, this specification)
├── 09-animated/           (64–67: svg, lottie, loading, gif)
├── 10-email-signature/    (68–70)
├── 11-figma/              (71–73: GAAhex-Logos.fig, GAAhex-Icons.fig, tokens/)
├── 12-wallpaper/          (74–77: desktop, laptop, mobile, video-bg)
├── 13-cobrand/            (78–80: powered-by, partner, sponsor)
├── 14-merch/              (81–84: embroidery, engraving, vinyl, apparel)
├── 15-accessibility/      (85–88)
├── 16-governance/         (89–95: approval, request-templates, agency-handoff,
│                            trademark, legal, localization, rebrand)
├── _archive/              (superseded releases by version)
├── CHANGELOG.md
└── README.md
```

---

# Appendix B — File Naming System

```
gaahex-{type}-{variant}-{mode}[-{size}][-{loop}][@{scale}].{ext}
```

| Field | Allowed values |
|---|---|
| `type` | logo · icon · wordmark · monogram · header · footer · favicon · pwa · social · print · anim · lottie · gif · loading · splash · signature · tokens · wallpaper · vmbg · cobrand · merch · a11y · gov |
| `variant` | horizontal · vertical · stacked · secondary · sticky · mobile · maskable · hero · loading · dashboard · poweredby · partner · sponsor · embroidery · engraving · vinyl · apparel · highcontrast · aa · aaa · request-templates · approval · trademark · legal · localization · rebrand · agency-handoff |
| `mode` | color · black · white · grayscale · mono-cobalt · mono-gold · dark · light · transparent |
| `size` | pixel longest edge or `WxH` (e.g. `512`, `3840x2160`) |
| `loop` | loop · once (animation only) |
| `scale` | 2x · 3x |
| `ext` | svg · png · jpg · ico · pdf · eps · ai · json · htm · html · gif · dst · pes · dxf · fig · md |

**Rules.** Lowercase; hyphens only (no spaces/underscores); size before loop before scale; omit fields that don't apply; Figma files use PascalCase (`GAAhex-Logos.fig`); platform-mandated names stay literal (`favicon.ico`, `apple-touch-icon.png`, `site.webmanifest`).

**Future assets.** New asset groups add a new `type` token here and a numbered range in Section 50 under a MINOR version; they must derive from the frozen master and follow all rules above.

---

*End of GAAhex Brand Master Specification v1.0 — the single, complete source of truth.*
