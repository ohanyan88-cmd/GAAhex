# GAAhex™ — Rebrand v1.1 Migration Report

**Change:** Removal of all connector / mesh / network / decorative line systems from the entire brand.
**Status:** Approved, final, executed. **Version:** 1.0 → 1.1 (treated as a controlled identity refresh; geometry unchanged).
**New brand law:** *The network is represented by the spatial relationship of the hexagonal nodes themselves. No explicit connector lines are used.*

---

## 1. What changed

The logomark previously rendered six cobalt hexagon outline cells **plus thin cobalt mesh polylines (35% opacity)** running from the gold tip back through each arm. Those polylines are deleted everywhere. The mark now contains **only**: hexagon outline cells, the gold destination hexagon, and the wordmark.

**Preserved exactly:** geometry, node coordinates, spacing, chevron direction, color palette (`#1C3B68` / `#C5A059` + neutrals), the gold destination node, and the Sora wordmark. Nothing moved; only the connector layer was removed.

**Result:** a cleaner, more premium, more enterprise, more minimal, more geometric, more scalable mark. The chevron reads from node placement alone.

---

## 2. Rationale

- **Visual strength.** Removing the faint mesh removes visual noise; the hexagon nodes and the gold destination carry the network meaning more confidently.
- **Scalability.** Thin 35%-opacity lines were the first thing to break at small sizes and in low-fidelity reproduction (embroidery, engraving, fax, favicons). Eliminating them makes every size and substrate cleaner.
- **Reproduction.** One fewer color/weight to manage across print, merch, and single-ink uses.
- **Brand semantics.** Implied connection (spatial proximity + shared geometry) is more sophisticated than literal wireframe lines.

---

## 3. Affected assets — regenerated (61)

### SVG vector (43) — mesh layer removed, geometry intact
- `01-logo/horizontal/gaahex-logo-horizontal-black.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-color.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-dark.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-grayscale.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-light.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-mono-cobalt.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-mono-gold.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-onplate.svg`
- `01-logo/horizontal/gaahex-logo-horizontal-white.svg`
- `01-logo/icon/gaahex-icon-black.svg`
- `01-logo/icon/gaahex-icon-color.svg`
- `01-logo/icon/gaahex-icon-dark.svg`
- `01-logo/icon/gaahex-icon-grayscale.svg`
- `01-logo/icon/gaahex-icon-light.svg`
- `01-logo/icon/gaahex-icon-mono-cobalt.svg`
- `01-logo/icon/gaahex-icon-mono-gold.svg`
- `01-logo/icon/gaahex-icon-white.svg`
- `01-logo/secondary/gaahex-logo-secondary-black.svg`
- `01-logo/secondary/gaahex-logo-secondary-color.svg`
- `01-logo/secondary/gaahex-logo-secondary-dark.svg`
- `01-logo/secondary/gaahex-logo-secondary-white.svg`
- `01-logo/stacked/gaahex-logo-stacked-black.svg`
- `01-logo/stacked/gaahex-logo-stacked-color.svg`
- `01-logo/stacked/gaahex-logo-stacked-dark.svg`
- `01-logo/stacked/gaahex-logo-stacked-white.svg`
- `01-logo/vertical/gaahex-logo-vertical-black.svg`
- `01-logo/vertical/gaahex-logo-vertical-color.svg`
- `01-logo/vertical/gaahex-logo-vertical-dark.svg`
- `01-logo/vertical/gaahex-logo-vertical-white.svg`
- `02-web-app/gaahex-emptystate.svg`
- `02-web-app/gaahex-error-color.svg`
- `02-web-app/gaahex-footer-color.svg`
- `02-web-app/gaahex-footer-white.svg`
- `02-web-app/gaahex-header-color.svg`
- `02-web-app/gaahex-header-dark.svg`
- `02-web-app/gaahex-header-mobile-color.svg`
- `02-web-app/gaahex-header-mobile-dark.svg`
- `02-web-app/gaahex-header-sticky-color.svg`
- `02-web-app/gaahex-header-sticky-dark.svg`
- `02-web-app/gaahex-loading-color.svg`
- `02-web-app/gaahex-loading-dark.svg`
- `02-web-app/gaahex-menu-mobile-color.svg`
- `02-web-app/gaahex-menu-mobile-dark.svg`

### Raster derived from the mark (18) — re-rendered from mesh-free sources
- `04-pwa/android-adaptive-fg.png`
- `04-pwa/apple-touch-icon.png`
- `04-pwa/pwa-128.png`
- `04-pwa/pwa-144.png`
- `04-pwa/pwa-152.png`
- `04-pwa/pwa-192.png`
- `04-pwa/pwa-384.png`
- `04-pwa/pwa-512-maskable.png`
- `04-pwa/pwa-512.png`
- `04-pwa/pwa-96.png`
- `05-social/discord-icon.png`
- `05-social/facebook-cover.png`
- `05-social/github-banner.png`
- `05-social/linkedin-share.png`
- `05-social/og-default.png`
- `05-social/telegram-icon.png`
- `05-social/twitter-card.png`
- `05-social/youtube-banner.png`

---

## 4. Files requiring regeneration

All 61 assets in Section 3 required regeneration and have been regenerated in this release. Source of truth (frozen master SVG) was updated first; every downstream asset was re-exported from it. No asset was hand-edited.

**Documentation requiring rewrite (done):**
- `GAAhex_Brand_Master_Specification` → **v1.1** (mark anatomy, construction, favicon, animation, motion, merch, small-size sections updated; brand-law banner + network-expression statement added)
- `GAAhex_Brand_Operations_Manual` → **v1.1** (universal usage rule added: no connector lines; non-compliant assets must be replaced)
- `GAAhex_Production_Roadmap` → **v1.1** (motion deliverables redesigned line-free; auto-batch noted as regenerated)
- `08-docs/` package spec replaced with the v1.1 master specification

---

## 5. Files unchanged (already line-free) (16)

These contained no connector lines and are visually identical across versions (repackaged for release integrity):
- `01-logo/wordmark/gaahex-wordmark-black.svg`
- `01-logo/wordmark/gaahex-wordmark-color.svg`
- `01-logo/wordmark/gaahex-wordmark-dark.svg`
- `01-logo/wordmark/gaahex-wordmark-white.svg`
- `03-favicon/favicon-16.png`
- `03-favicon/favicon-32.png`
- `03-favicon/favicon-48.png`
- `03-favicon/favicon.ico`
- `03-favicon/favicon.svg`
- `03-favicon/head-snippet.html`
- `03-favicon/mask-icon.svg`
- `03-favicon/safari-pinned-tab.svg`
- `04-pwa/android-adaptive-bg.png`
- `04-pwa/pwa-72.png`
- `README.txt`
- `site.webmanifest`

Plus deprecated/renamed: `01-logo/horizontal/gaahex-logo-horizontal-onplate.svg` is retired — the on-plate presentation is now `gaahex-logo-horizontal-light.svg` (true cobalt on cloud plate).

---

## 6. Regeneration order (as executed)

1. Update brand law + master specification (v1.1) — the rule precedes production
2. Update frozen master geometry (remove mesh polylines)
3. Icon-only marks (all 8 modes)
4. Lockups: horizontal (8 modes), secondary / stacked / vertical (4 modes each)
5. Wordmark variants (unchanged — verified line-free)
6. Web-app placements (header, sticky, mobile, footer, menu, loading, empty, error)
7. Favicon system (compact glyph — already line-free; rebuilt for parity)
8. PWA set + maskable + apple-touch + Android adaptive (re-rendered mesh-free)
9. Social set (re-composed from mesh-free lockup/icon)
10. Export spec + manifest + head snippet + README
11. Operations Manual v1.1 + Roadmap v1.1
12. Migration report + release ZIP

---

## 7. Estimated effort

| Workstream | Items | Effort | Method |
|---|---|---|---|
| Vector + raster regeneration | 61 | XS–S total (batch) | Scripted from master |
| Documentation v1.1 | 3 docs + package spec | S | Surgical edits |
| Motion redesign (concepts) | 64–67 | M (when produced) | Hexagon-based, re-authored |
| QA / visual verification | full set | S | Automated render + spot check |

Net: a single automated pass for all auto-producible assets; the only future manual work is re-authoring motion (Lottie/animated SVG) to the new hexagon choreography and the still-pending vendor/tool items from the roadmap.

---

## 8. Animation / motion redesign

**Deprecated:** lines drawing between nodes; network-path animations; `stroke-dashoffset` reveals; mesh pulses.

**New motion language:**
- Hexagon appearance (sequential fade-in)
- Hexagon scaling (scale-in toward the tip)
- Hexagon movement (cells settling into the chevron)
- Destination-node emphasis (gold hexagon scales/pulses as the final beat)

No line-based, path-drawing, or connector animation anywhere. Reduced-motion fallback remains the static mesh-free mark.

---

## 9. Implementation impact

- **Drop-in for web/app/PWA/social/favicons.** Filenames and dimensions are unchanged (except retired `-onplate`), so swapping the v1.1 files requires no markup changes; `site.webmanifest`, favicon links, and OG tags are identical.
- **Tokens unchanged.** Colors, typography, spacing tokens are not affected — no code token changes.
- **One filename retired:** `gaahex-logo-horizontal-onplate.svg` → use `…-light.svg`. Update any hardcoded reference (none expected in standard integration).
- **Motion code:** any existing line-draw animation must be replaced with the hexagon-based variants when those are produced.

---

## 10. Backward compatibility

- **Visual:** v1.1 marks are recognizably the same logo (same geometry/arrangement/colors); the change is subtractive and non-disruptive to brand recognition.
- **Technical:** identical filenames, sizes, and integration snippets → existing implementations continue to work after a file swap.
- **Versioning:** released as **v1.1**; v1.0 (with mesh) is archived to `_archive/v1.0/` and remains deployable for one cycle for rollback. Per governance, superseded assets are retained ≥ 5 years.
- **Rollback:** restore the archived v1.0 set if needed; no schema/markup dependencies block reversion.

---

*All connector-line removal is approved and final. The GAAhex brand system is now line-free at v1.1.*
