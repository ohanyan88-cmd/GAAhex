# GAAhex™ — Enterprise Brand Review v2.0

Independent review of the GAAhex brand system (specification, operations manual, roadmap, and asset package) from an enterprise branding standpoint. Findings are rated **High / Medium / Low** by business risk, each with a recommended fix. The system is strong and unusually complete; these are the gaps that separate "very good" from "audit-proof at enterprise scale."

---

## A. Governance & process risks

**A1 — Versioning of the connector-line removal (RESOLVED in v2.0).** The mesh removal altered the mark's visual composition, yet it shipped as **v2.0 (MAJOR)**. The specification's own rule states geometry changes are **MAJOR** with leadership sign-off and re-clearance. Resolved: reclassified as **MAJOR** and released as **v2.0**. The spec now defines "geometry = node coordinates & proportions (unchanged); decorative layers are not geometry," making the classification internally consistent.

**A2 — Single-person dependency (Medium).** "Brand Owner" is the accountable role for nearly everything, with only an emergency deputy. *Fix:* name a standing deputy and a coverage matrix; define quorum for the Brand Council so decisions don't stall when the Owner is unavailable.

**A3 — Metrics without instrumentation (Medium).** Brand-ops KPIs are defined with targets but no capture mechanism or reporting cadence owner. *Fix:* assign each metric a data source and a monthly report; otherwise they are aspirational.

**A4 — No build reproducibility in the package (Medium).** Assets are script-generated, but the generation scripts are not committed with the release. If the master changes, re-deriving the 85 built assets depends on undocumented tooling. *Fix:* commit the generation scripts + a `Makefile`/CI job to `00-source/` so the package is reproducible and auditable.

**A5 — Source-of-truth duplication (Low).** The master spec exists at the repo root and copied into `08-docs/`; copies drift. *Fix:* keep one canonical file and generate the `08-docs` copy in CI from the canonical source.

---

## B. Trademark & legal risks

**B1 — Registrability of the name/mark (High).** "hex" is descriptive and "GAAhex" may face a crowded field; the package documents trademark *process* but not *status*. *Fix:* commission a clearance search and file in active markets before further public rollout; record status in the legal package.

**B2 — Font licensing not bundled (Medium).** Sora is OFL (safe), but no license file or attribution travels with the package, and any future companion/non-Latin face is unspecified. *Fix:* include `OFL.txt` in `00-source/` and name the approved non-Latin companion (e.g., Noto) with weights.

**B3 — Email signature hosts images from an unverified domain (Medium).** Signatures hard-link `https://www.gaahex.com/email-header.png`; if the domain/path isn't live, every signature shows a broken image, and many clients block remote images by default. *Fix:* confirm the asset URL is permanent and CDN-served; provide a text-only fallback signature.

---

## C. Design-system consistency

**C1 — Favicon ≠ logo silhouette (Medium).** The favicon/app small-size glyph is a **3-hex** compact chevron while the logo is a **7-hex** chevron. This is a deliberate legibility decision, but at enterprise scale it reads as two different marks if undocumented. *Fix:* elevate the existing note to an explicit "brand mark vs. app glyph" diagram so teams never "correct" it.

**C2 — "light" mode vs. "on-plate" naming (Low).** `-onplate` was retired in favor of `-light`, but "light" also denotes the *theme* (true cobalt). One token now means both "light theme" and "on cloud plate." *Fix:* separate the concepts — `mode=light|dark` for ink color, `plate=none|cloud|ink` for background — and name files accordingly.

**C3 — Motion not tokenized (Low).** Duration/easing are described in prose but absent from the token system, so motion can drift across implementations. *Fix:* add `--gx-motion-duration` and `--gx-motion-ease` tokens and reference them in animation assets.

**C4 — Animated SVG has an invisible initial frame (Medium).** Cells start at `opacity:0`; in any context where CSS animation doesn't run (some email/preview/screenshot pipelines), the logo renders blank. The reduced-motion query covers accessibility but not non-animating renderers. *Fix:* ship a poster fallback (static mark) or set a non-zero initial state with JS-gated animation.

---

## D. Accessibility

**D1 — Gold on light fails text-contrast (Medium).** `gold #C5A059` on light backgrounds is below AA for text-equivalent contrast; as a logo (non-text) it's exempt, but if the gold node ever becomes the sole carrier of meaning at small size it weakens. *Fix:* the filled-vs-outline shape difference already provides a non-color cue — document it explicitly as the CVD / forced-colors safeguard so the brand never relies on the gold hue alone.

**D2 — Dark-mode wordmark contrast (Low).** `cobalt-lift` on ink is 5.6:1 (AA, not AAA). Acceptable for display-size wordmarks; flag that it must not be used for small body-size text equivalents.

**D3 — No public brand accessibility statement (Low).** Internal a11y docs exist but there's no public-facing statement template. *Fix:* add a short template to `15-accessibility/`.

---

## E. Production & color management

**E1 — CMYK values are estimates, no Pantone (High for print).** Print/merch color will drift without spot definitions and a proofed profile. *Fix:* define Pantone equivalents for cobalt and gold and proof CMYK on target stock before any printed run; record in the spec.

**E2 — Minimum sizes mix px and mm without a stated DPI assumption (Low).** *Fix:* state the reference DPI (e.g., 300 DPI print, 96 DPI screen) alongside the min-size table.

**E3 — Merch interim files only (Medium for merch).** Embroidery/engraving final files depend on a vendor; the package provides prep SVGs only. *Fix:* engage a digitizer early; lock thread/Pantone matches.

---

## F. Missing standards (enterprise scope)

The package is a logo/identity system. A full enterprise brand system typically also defines:

- **Iconography system** (UI icon set, grid, stroke) — absent.
- **Photography / illustration style** — absent.
- **Data-visualization palette** (charts/dashboards using brand color) — absent; relevant for a SaaS product.
- **Voice & tone / messaging** — referenced but a sibling document, not included.
- **Email dark-mode behavior** — signatures/templates don't specify dark-client handling.
- **Localization specimens** — RTL secondary lockup exists, but no rendered non-Latin companion specimen.
- **Signage / environmental** specs and **audio/sonic** logo (if the product uses sound) — absent.

*Fix:* scope these as MINOR additions on the roadmap; none block launch, but a 5–10-year enterprise system will need them.

---

## G. Priority remediation (recommended order)

1. **A1** — define geometry vs decoration; reconcile the version classification (High, fast).
2. **B1 / E1** — trademark clearance + Pantone/CMYK proofing; longest external lead times, start now (High).
3. **C4** — animated-SVG poster fallback (Medium, fast).
4. **A4** — commit generation scripts/CI for reproducibility (Medium).
5. **C1 / C2** — publish the mark-vs-glyph diagram and split mode/plate naming (Medium).
6. **B2 / D-series** — bundle font license, document the CVD shape-cue safeguard, add the a11y statement (Medium/Low).
7. **F** — schedule iconography, dataviz palette, and localization specimens as MINOR roadmap items.

---

## H. Overall assessment

The GAAhex system is **well above typical early-stage brand maturity**: a locked, reproducible mark; a complete asset matrix; governance, legal, localization, and rebranding frameworks; and a clean, executed v2.0 line-removal with archive and rollback. The residual risks are the ones every enterprise brand must close before scale — **trademark status, print color management, version-rule consistency, and a few system gaps (iconography, dataviz, motion tokens)** — none of which block the current digital launch. Closing the Section G items would make the system genuinely audit-proof for a 5–10-year horizon.
