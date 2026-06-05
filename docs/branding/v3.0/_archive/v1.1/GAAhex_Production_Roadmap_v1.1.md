# GAAhex™ — Production Roadmap v1.1

Source of truth: `GAAhex_Brand_Master_Specification_v1.1.md` (95 deliverables). This roadmap groups every deliverable by readiness, then sequences them by business value across three phases.

> **v1.1 note — connector lines removed.** The mark is now hexagon cells + gold destination node + wordmark, no connector/mesh lines. All auto-generatable assets (Group A/B) have been regenerated mesh-free. Motion deliverables (64–67) are redesigned to hexagon appearance/scale/fade/movement + destination emphasis — no line-drawing animation.

**Effort scale:** XS ≤ 0.5 h (script/auto) · S 0.5–2 h · M 2–6 h · L 1–3 days · XL 3+ days or external lead time.

---

## 1. Readiness Grouping (all 95)

### A. Already completed (Built)
Foundation shipped from the master.

`1, 5, 8, 9, 10, 12(cobalt), 13, 14` (core lockup + color/mode set) · `23–38` (full favicon + PWA + apple-touch) · `40, 41, 42, 46, 47` (OG/Twitter/LinkedIn/Discord/Telegram) · `53` (SVG master) · `57(core)` · `60–63` (usage/min-size/clear-space/palette docs, embedded in spec) · `73(CSS/JSON tokens)` · `86(16–48)` · `88` (a11y docs) · `89–95` (all governance docs written).

### B. Can be automatically generated (script from master — no human design)
Pure transforms, recolors, re-exports, or templated composition.

`2` vertical · `3` stacked · `4` secondary · `6` wordmark · `11` grayscale · `12(gold)` mono-gold · `15–20` header/sticky/mobile/footer/menu/loading · `21, 22` empty/error · `39` Android adaptive (layered PNG) · `43` FB cover · `44` YouTube banner · `45` GitHub banner · `48` email header · `49` presentation logo · `50` watermark · `58` high-res PNG · `59` JPG · `64` animated SVG (CSS) · `67` GIF (rasterized from animated SVG) · `74–76` wallpapers · `77` video-meeting bg · `78` powered-by lockup · `84` apparel print PNGs · `85` WCAG recolor variants · `87` high-contrast set.

### C. Requires design work (human judgment)
`7` monogram (letterform decision) · `79` partner lockup system (pairing/divider logic) · `80` sponsor lockup system (tier grid) · `68–70` email signatures (HTML build + social-icon set) · `49` presentation master layout (template, beyond the logo mark).

### D. Requires external software
`54` `.ai` (Illustrator) · `55` `.eps` · `56` `.pdf/X` source · `65` Lottie hero/loading (After Effects + Bodymovin) · `66` Lottie loading/splash/dashboard · `71` Figma logo library · `72` Figma icon library.

### E. Requires vendor / manufacturer
`51` print CMYK (proof on press) · `52` large banner print · `81` embroidery DST/PES · `82` engraving DXF · `83` vinyl cut.

### F. Requires legal review
`92` trademark registration action · `93` legal protection enactment (ownership/registration filings) · plus sign-off gate on any public/partner asset (`43–45, 78–80`) per the approval matrix.

*Items may appear in more than one group (e.g., email signatures = design + auto-export; Figma = external tool + design). Primary owner listed; secondary noted in the phase plan.*

---

## 2. Phase 1 — Launch-Critical

Everything required to ship the website / web app / SaaS looking complete and professional. Highest business value: nothing public-facing is missing.

| Order | # | Deliverable | Group | Effort | Status |
|---|---|---|---|---|---|
| 1 | 53 | SVG master | A | — | Built |
| 2 | 1,8,13,14 | Horizontal color/dark/light | A | — | Built |
| 3 | 9,10,11,12 | Black / white / grayscale / mono | A/B | S (gray, mono-gold) | Partial |
| 4 | 2,3,4 | Vertical / stacked / secondary lockups | B | S each | Generate |
| 5 | 6 | Wordmark | B | XS | Generate |
| 6 | 23–29 | Favicon system | A | — | Built |
| 7 | 30–38 | PWA + apple-touch | A | — | Built |
| 8 | 39 | Android adaptive icon | B | S | Generate |
| 9 | 15–17 | Header / sticky / mobile header | B | S | Generate |
| 10 | 18,19 | Footer / mobile menu | B | S | Generate |
| 11 | 20,21,22 | Loading / empty / error states | B | S | Generate |
| 12 | 40,41,42 | OG / Twitter / LinkedIn | A | — | Built |
| 13 | 73 | Design tokens (CSS/JSON) | A | — | Built |
| 14 | 57,58,59 | PNG (transparent/high-res) + JPG export sweep | B | M | Generate |
| 15 | 86,85,87,88 | Accessibility set + WCAG + high-contrast | A/B | S | Mostly built |
| 16 | 48 | Email header logo | B | XS | Generate |
| 17 | 60–63 | Core brand docs | A | — | Built (in spec) |

**Phase 1 net new effort:** ~M–L total (most is XS/S scripting; foundation already built). Launch blocker count after Phase 1: zero.

---

## 3. Phase 2 — Growth

Marketing reach, social presence, motion, and the design-system backbone that lets teams self-serve.

| Order | # | Deliverable | Group | Effort | Notes |
|---|---|---|---|---|---|
| 18 | 71,72 | Figma logo + icon libraries | D | L | Unlocks team self-service; do early in Phase 2. |
| 19 | 73 | Token export to SCSS/iOS/Android | D | S | Style Dictionary from existing JSON. |
| 20 | 43,44,45 | Facebook / YouTube / GitHub banners | B | S each | Channel expansion. |
| 21 | 49 | Presentation template + logo | B/C | M | Slide master design. |
| 22 | 50 | Watermark | B | XS | Document/photo protection. |
| 23 | 64 | Animated SVG (hero + loading) | B | M | CSS/SMIL; reduced-motion fallback. |
| 24 | 67 | GIF package | B | S | Raster from animated SVG. |
| 25 | 65,66 | Lottie package (hero/loading/splash/dashboard) | D | L | After Effects + Bodymovin; < 60 KB. |
| 26 | 68,69,70 | Email signatures (Outlook/Gmail/HTML) | C | M | Table HTML + hosted images + deploy docs. |
| 27 | 7 | Monogram | C | S | Letterform/bare-tip decision. |
| 28 | 74,75,76 | Wallpapers (desktop/laptop/mobile) | B | M | Multi-resolution sweep. |
| 29 | 77 | Video-meeting backgrounds | B | S | Mirror-safe; Zoom/Meet/Teams. |
| 30 | 78 | Powered-by lockup | B | S | Embed/integration marketing. |

**Phase 2 effort:** ~2–3 L items (Figma, Lottie, signatures) drive the bulk; rest is S/M scripting.

---

## 4. Phase 3 — Enterprise

Partnerships, physical production, native source masters, legal protection, and full governance operation.

| Order | # | Deliverable | Group | Effort | Notes |
|---|---|---|---|---|---|
| 31 | 54,55,56 | Native AI / EPS / PDF-X source | D | L | Illustrator; print-vendor universal. |
| 32 | 79,80 | Partner + sponsor lockup systems | C/F | M | Design templates + legal sign-off. |
| 33 | 51,52 | Print CMYK + large banner | E | XL | Press proofing lead time. |
| 34 | 84 | Apparel print package | B/E | M | Light/dark garment variants. |
| 35 | 81 | Embroidery (standard/hat/polo) | E | XL | Vendor digitizing; ≤ 2 threads. |
| 36 | 82 | Laser engraving | E | L | Vendor DXF; raster + vector twins. |
| 37 | 83 | Vinyl cut | E | M | No floating islands; weed-ready. |
| 38 | 92,93 | Trademark registration + legal filings | F | XL | Counsel; per-jurisdiction lead time. |
| 39 | 94 | Localization rollout (RTL / non-Latin) | C/F | L | Per-market review. |
| 40 | 89,90,91,95 | Governance operationalization + agency handoff + rebrand readiness | A→ops | M | Docs exist; stand up workflows. |

**Phase 3 effort:** dominated by external lead times (print proofing, embroidery digitizing, trademark filing) rather than internal hours.

---

## 5. Effort Summary by Group

| Group | Items (count) | Typical effort | Bottleneck |
|---|---|---|---|
| A — Completed | 40+ | done | none |
| B — Auto-generate | ~28 | XS–M (scriptable in batches) | internal time only |
| C — Design work | 5 | S–M | designer availability |
| D — External software | 7 | L | Illustrator/AE/Figma skills |
| E — Vendor | 5 | L–XL | manufacturer lead time |
| F — Legal | 2 + gates | XL | counsel + filing timelines |

---

## 6. Recommended Generation Order (consolidated)

Single sequence across phases — derive each from the frozen master, never hand-edit downstream:

1. Confirm SVG master frozen (53)
2. Complete color/mode set: grayscale (11), mono-gold (12)
3. Lockup orientations: vertical (2), stacked (3), secondary (4), wordmark (6)
4. Web/app states: header/sticky/mobile (15–17), footer/menu (18–19), loading/empty/error (20–22)
5. Android adaptive (39); export sweep PNG/JPG (57–59)
6. Email header (48); finalize accessibility/WCAG/high-contrast (85–88)
7. **Launch gate** — Phase 1 complete
8. Figma libraries (71–72) + token export (73)
9. Social banners (43–45); presentation (49); watermark (50)
10. Animated SVG (64) + GIF (67); then Lottie (65–66)
11. Email signatures (68–70); monogram (7)
12. Wallpapers (74–76); video bg (77); powered-by (78)
13. **Growth gate** — Phase 2 complete
14. Native source masters (54–56)
15. Partner/sponsor systems (79–80) with legal sign-off
16. Apparel (84); print CMYK + banner (51–52)
17. Embroidery (81), engraving (82), vinyl (83) via vendors
18. Trademark registration + legal (92–93); localization (94)
19. Operationalize governance + agency handoff + rebrand readiness (89–91, 95)
20. **Enterprise gate** — Phase 3 complete

---

## 7. Priority Rationale (highest → lowest business value)

1. **Public product surface** (web/app/PWA/favicons/social previews) — every visitor sees it; mostly already built, finish the gaps first.
2. **Design system + tokens + Figma** — multiplies team velocity; prevents off-brand drift.
3. **Marketing + motion** — extends reach and polish once the product looks complete.
4. **Partnerships + physical + legal** — high value but gated by external timelines; start the long-lead items (trademark, embroidery, print) as soon as Phase 2 stabilizes.
