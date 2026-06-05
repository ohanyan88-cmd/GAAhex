# GAAhex Brand — Changelog

## v3.0 — Added: dark/light transparent lockup set (10 SVG + 18+12 PNG) — 2026-06-05
- Added plate-free transparent lockups for runtime use (e.g. app dark header #0A1322 with no baked plate).
- SVG (10): horizontal/stacked/vertical/icon/secondary × dark+light, in `01-logo/<type>/...-transparent.svg`. Each = the existing glyph set with the demo plate `<rect>` removed; geometry/spacing/typography/colors unchanged. stacked/vertical/secondary -light derived from -dark via the established dark→light delta (#4E7FC4→#1C3B68), proven byte-equal to the horizontal dark→light delta.
- PNG (30): all five types × dark+light at 256/512/1024 in `07-exports/png-transparent/`, RGBA, alpha=0 background, square.
- Existing deliverables untouched; `_archive/` untouched; wallpapers/merch/social/apple-touch/PWA-maskable remain opaque by design.
- Manifest supplement: `MANIFEST.dark-transparent.sha256` (original `MANIFEST.sha256` preserved).


## v3.0 — Permanent-freeze remediation (D-1…D-7) — 2026-06-05
- D-1: genuine print-ready CMYK PDF (DeviceCMYK) replacing the RGB-duplicate gaahex-print-cmyk.pdf.
- D-2: email signatures differentiated — Gmail (inline), Outlook (MSO/VML-safe), generic template (variables); no byte-identical copies.
- D-3: distinct looping hero SVG animation (separate purpose from loading-once).
- D-4: distinct hero Lottie (multi-layer assemble; nm GAAhex-hero) vs loading Lottie.
- D-5: genuine dark-specific GIF (dark variant on ink) distinct from social GIF.
- D-6: archived the redundant historical QA copy (Pre_v2.0_Final_QA) to _archive/v2.0/; single active release record retained.
- D-7: dev-package/INTEGRATION.md fully v3.0 (0 active v2.0 guidance).
- Regenerated MANIFEST.sha256 (verifies). Added Brand_v3.0_Permanent_Freeze_Audit.md.


## v3.0 — Final remediation (audit D-1…D-7 resolved) — 2026-06-05
- D-1: dark composites (wallpapers, merch, PWA maskable/adaptive) regenerated with v3.0 color identity (Azure+Gold visible) via the dark color variant; mono-white substitutions removed.
- D-2: duplicate-content eliminated — wallpapers and merch placements now byte-unique and placement/device-correct.
- D-3: all wallpapers regenerated at correct native resolutions (dims verified against filenames).
- D-4: active standard docs re-versioned to v3.0 (Master Specification, Operations Manual, Production Roadmap renamed, titles bumped, references updated); historical v2.0 process docs retained.
- D-5: accessibility high-contrast-dark is true single-ink WHITE on dark plate; added 15-accessibility/README.
- D-6: added 00-source/README (gaahex-master.ai = PDF-container compatibility master).
- D-7: added 03-favicon/README (intentional Azure+Gold compact glyph).
- Old-tip: 0 active old-tip files (all in _archive/v1.0 + _archive/v2.0); archived _d18-candidates marked legacy.
- Regenerated MANIFEST.sha256 (verifies). Added Brand_v3.0_Final_Certification_Audit.md.


## v3.0 — Approved logo color update — 2026-06-05
- Official brand identity change: adopted the approved canonical mark — filled cells, **two Azure signal hexagons** (inner pair), **full-size Gold destination hexagon**, four Cobalt structural hexagons. Wordmark unchanged (GAA cobalt + hex gold).
- Geometry, spacing, typography, D18 architecture, governance, trademark policy, documentation/folder structure: UNCHANGED.
- Migrated every logo-bearing asset across all folders (01-logo, 02-web-app, 03-favicon, 04-pwa, 05-social, 06-marketing-print, 07-exports, 09-animated, 11-figma, 12-wallpaper, 13-cobrand, 14-merch, 15-accessibility, dev-package) and regenerated source masters (svg/pdf/eps/ai).
- Favicon compact glyph updated to azure signal cells -> gold tip; favicons/ICO/PWA/social/wallpaper/merch rasters regenerated.
- Archived the v2.0 mark (and obsolete _d18-candidates) to `_archive/v2.0/`.
- Regenerated MANIFEST.sha256. Added Brand_v3.0_Migration_Report.md, Brand_v3.0_QA_Report.md, Brand_v3.0_Certification_Audit.md.


## v2.0 — D18 Color Architecture + final cleanup — 2026-06-05
- Added authoritative D18 color system (08-docs/GAAhex_D18_Color_Architecture_v2.0.md): Cobalt spine, Gold signature (dark #C5A059 / light #AC8847), Azure #0EA5E9 interactive, Slate neutrals, Semantic status.
- Migrated all 7 token files to D18 token names (kept pre-D18 deprecated aliases). Interaction is now Azure (was cobalt-lift).
- Archived v1.1 docs to _archive/v1.1/; consolidated READMEs into README.md (old → _archive/readme-old/).
- Restored 3 trademark clearance reports into 16-governance/trademark/; updated Trademark_README.
- Added optional D18 UI-glyph candidates (01-logo/_d18-candidates/); canonical logo unchanged.
- Added D18_Brand_Migration_Audit.md and Brand_Final_D18_QA_Report.md. Regenerated MANIFEST.sha256.


## v2.0 — Trademark notation applied
- Added GAAhex first-mention trademark notation (GAAhex then plain thereafter) to documentation, README/release notes, governance, operations manual, specification, developer docs, and email-signature templates.
- Added 16-governance/trademark/Trademark_Usage_Policy.md (TM allowed now; (R) only after registration).
- No logo artwork, icons, favicons, source masters, tokens, or configs were modified.
- Regenerated MANIFEST.sha256.


## v2.0 — 2026-06-05 — MAJOR visual identity change (connector lines removed)
- Reclassified the connector/mesh removal as MAJOR; released as v2.0.
- Mark is now hexagon outline cells + gold destination hexagon + wordmark only. No connector/mesh/network lines.
- All active marks, web, favicon, PWA, social regenerated mesh-free; 0 `polyline` in active assets; 0 references to the deprecated platform name.
- Canonical name GAAhex; canonical domain www.gaahex.com (100% consistent).
- Removed placeholder `.txt` notes (ai/lottie/merch). Email signatures documented with user-editable variables.
- Deferred (non-blocking) external/tool/vendor/legal items: .ai, .eps, full Lottie, .fig, CMYK/Pantone, .dst/.pes/.dxf, trademark.
- Prior mesh version archived at `_archive/v1.0/` (rollback).
