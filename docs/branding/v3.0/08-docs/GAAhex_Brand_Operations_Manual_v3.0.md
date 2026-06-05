# GAAhex™ — Brand Operations Manual v3.0

*Current brand version: **v3.0** (logo updated; geometry/spacing/typography unchanged). Supersedes the v2.0 predecessor.*

> **v3.0 logo (approved).** The canonical mark is now: the mark is the hexagon chevron with **filled cells** — four Cobalt structural hexagons, **two Azure signal hexagons** (the inner pair nearest the apex), and a **full-size Gold destination hexagon** at the apex. Wordmark: GAA Cobalt + hex Gold. Geometry, spacing, and typography are unchanged; only color assignment and the gold-node size changed. v3.0 mark archived at `_archive/v3.0/`.


> **D18 Color Architecture (authoritative).** Color is governed by `08-docs/GAAhex_D18_Color_Architecture_v3.0.md`: **Cobalt**=spine · **Gold**=signature · **Azure** `#0EA5E9`=interactive · **Slate**=neutrals · **Semantic**=status. One family, one role; roles never overlap. Any earlier color guidance is superseded.


The operational handbook for managing the GAAhex brand. It governs how every team **uses, requests, approves, versions, maintains, and governs** brand assets. It is the companion to `GAAhex_Brand_Master_Specification_v1.0.md` — the spec defines *what* the assets are; this manual defines *how the organization operates them*.

| | |
|---|---|
| Document | GAAhex Brand Operations Manual |
| Version | 2.0 |
| Source of truth (assets/standards) | GAAhex_Brand_Master_Specification_v3.0.md |
| Audience | Marketing · Product · Engineering · Design · Partnerships · Legal |
| Authority | Brand Owner (final) · Brand Council (advisory) |

---

## Table of Contents

1. Purpose & Scope
2. Operating Principles
3. Roles & Decision Rights (RACI)
4. The Brand Library — Access & Source of Truth
5. Universal Usage Rules
6. Team Playbooks
   6.1 Marketing · 6.2 Product · 6.3 Engineering · 6.4 Design · 6.5 Partnerships · 6.6 Legal
7. Requesting Assets — Intake, Templates, SLAs
8. Approval Workflow
9. Versioning Model
10. Maintenance & Lifecycle
11. Governance & Change Control
12. Compliance, Trademark & Misuse
13. Onboarding & Training
14. Brand Operations Metrics
15. Quick Reference & Checklists

---

# 1. Purpose & Scope

**Purpose.** Keep the brand consistent, protected, and fast to use as the company scales. Everyone gets the right asset, through the right path, at the right quality, without bottlenecks.

**Scope.** All logo, icon, color, typography, motion, web/app, social, marketing, print, merchandise, accessibility, and co-branding assets defined in the master specification — across digital, print, physical, and partner surfaces.

**Out of scope.** Product UI patterns beyond brand elements (owned by Design System), and copywriting/voice (separate content guidelines), except where they touch the logo, name, or color.

---

# 2. Operating Principles

1. **One source of truth.** The frozen master (`00-source`) and the Figma library are authoritative. No team hand-edits a logo — assets are re-exported from the master.
2. **Use first, request second, create last.** Reach for an existing approved asset before requesting a new one; only commission new work when nothing fits.
3. **The mark is locked.** Geometry, proportions, and the cobalt/gold relationship never change outside a MAJOR version with leadership sign-off.
4. **Right path for risk.** Internal reuse is frictionless; public, partner, and trademark-bearing uses require review.
5. **Accessible by default.** Every public logo meets the contrast and `alt`-text standard.
6. **Speed with control.** SLAs keep teams unblocked; the approval matrix keeps the brand safe.

---

# 3. Roles & Decision Rights (RACI)

| Activity | Brand Owner | Brand Council | Brand Coordinator | Design | Eng | Marketing | Product | Partnerships | Legal |
|---|---|---|---|---|---|---|---|---|---|
| Approve mark/geometry change (MAJOR) | A | C | I | R | I | I | I | I | C |
| Approve new asset group (MINOR) | A | C | I | R | I | C | C | I | I |
| Approve public/marketing asset | A | I | R | C | I | R | I | I | C |
| Approve partner/co-brand lockup | A | I | R | C | I | I | I | R | C |
| Reuse existing approved asset | I | — | I | — | R | R | R | R | — |
| Produce/export assets from master | I | — | C | R | C | — | — | — | — |
| Implement assets in product/web | I | — | — | C | R | — | R | — | — |
| Maintain library + versioning | A | I | R | C | C | — | — | — | — |
| Trademark/legal enforcement | A | C | I | I | — | I | — | I | R |

R = Responsible · A = Accountable · C = Consulted · I = Informed.

**Key roles.**
- **Brand Owner** — final authority on all brand decisions; accountable for the system.
- **Brand Council** — design, marketing, product, legal leads; advise on MINOR/MAJOR changes.
- **Brand Coordinator** — runs intake, triage, routing, and the asset library day-to-day.

---

# 4. The Brand Library — Access & Source of Truth

**Where assets live.**
- **Frozen vector masters:** `00-source` (version-controlled, restricted write).
- **Production assets:** the `gaahex-brand/` tree (folders `01`–`16`), read access for all teams.
- **Live design source:** the published Figma libraries `GAAhex-Logos.fig` and `GAAhex-Icons.fig`.
- **Tokens:** `gaahex-tokens` (JSON/CSS/SCSS/iOS/Android), consumed by Engineering.
- **Releases:** versioned ZIPs `gaahex-brand-vX.Y.Z-YYYYMMDD.zip`; superseded sets in `_archive/`.

**Access model.** All teams have read access to production assets and the Figma library. Write access to `00-source`, master files, and Figma library publishing is restricted to Design + Brand Coordinator. Token changes flow through Design → Engineering review.

**Golden rule.** If an asset isn't in the library, it isn't approved. Never circulate a logo pulled from a slide, a website screenshot, or a personal file.

---

# 5. Universal Usage Rules

Applies to every team, every surface.

- **No connector lines (brand law, v2.0).** The mark is hexagon outline cells + the gold destination hexagon + the wordmark only. No mesh, network, decorative, or connector lines anywhere. The network is expressed by node spacing alone. Any asset still showing connector lines is non-compliant and must be replaced with its v2.0 version.
- Use only library files; never recreate, redraw, or trace the mark.
- Preserve geometry, proportions, color, clear space (1× cell height), and minimum size.
- Match the color mode to the background: true cobalt on light, cobalt-lift on dark, white/black for single-ink, gold tip never recolored.
- Below 48 px use the simplified/compact favicon glyph — never the 7-cell outline.
- Every public logo carries `alt="GAAhex"`; decorative repeats are hidden from assistive tech.
- Do not stretch, skew, rotate, add effects, or place the full-color logo on busy/low-contrast backgrounds.
- The brand name is always written `GAAhex` and is never translated.

When in doubt, stop and ask the Brand Coordinator before publishing.

---

# 6. Team Playbooks

## 6.1 Marketing

**Owns:** campaigns, social, email, web marketing pages, paid media, events, presentations.

**Default assets:** horizontal/stacked lockups (color/dark/white), social set (OG/Twitter/LinkedIn/Facebook/YouTube/GitHub), email header, presentation logo, watermark, wallpapers.

**Do:** pick the platform-correct social asset and respect each safe zone; use the on-plate or white lockup on photography; keep clear space on every banner; localize copy via approved linguists while keeping the wordmark fixed.

**Guardrails:** any **public** or **paid** asset requires Design compliance check + Brand Owner approval; claims/disclaimers and any partner mention require Legal. Never typeset the wordmark by hand — use the wordmark asset.

**Request level:** public assets → full approval path (Section 8).

## 6.2 Product

**Owns:** in-app brand surfaces — app icon, splash, loading/empty/error states, PWA install, in-product header/footer.

**Default assets:** icon-only mark (modes), PWA set, apple-touch, Android adaptive, loading/empty/error SVGs, header/sticky/mobile logos, design tokens.

**Do:** consume tokens (`--gx-*`) rather than hardcoding color; switch lockups by theme via `prefers-color-scheme`; use the simplified glyph at small sizes; wire reduced-motion fallbacks for animated logos.

**Guardrails:** product surfaces using existing approved assets need only Design notify; a new in-product brand treatment is a Design request. Don't invent new logo states — request them.

**Request level:** existing assets → reuse (no approval); new states → Design review.

## 6.3 Engineering

**Owns:** implementation — favicon/manifest/meta wiring, token integration, animation embedding, accessibility attributes, performance.

**Default assets:** favicon system, `site.webmanifest`, OG/Twitter meta, tokens, animated SVG/Lottie, high-contrast variants.

**Do:** follow the master spec's integration code (favicon links, manifest entries, OG tags, dark-mode swap, Lottie init, forced-colors handling); serve SVG with PNG @2x fallback; set `alt`/`aria` correctly; cap Lottie < 60 KB; gate motion behind `prefers-reduced-motion`.

**Guardrails:** never alter color values in code outside tokens; never substitute a non-library asset; flag any rendering issue to the Brand Coordinator rather than editing the artwork.

**Request level:** implementation of approved assets → no approval; re-export/new size → PATCH request to Design.

## 6.4 Design

**Owns:** the master, the Figma libraries, tokens, all asset production, and brand compliance review.

**Default assets:** everything — Design is the producer.

**Do:** generate all assets from the frozen master; keep Sora outlined in final exports; publish Figma library updates; run compliance checks on others' requests; maintain naming convention and folder structure exactly.

**Guardrails:** geometry/color are locked — Design implements MINOR/PATCH freely but escalates any MAJOR (mark change) to the Brand Owner + Council. No off-brand effects, ever.

**Request level:** Design is Responsible for production; Accountable to the Brand Owner for fidelity.

## 6.5 Partnerships

**Owns:** co-branding, partner lockups, sponsor arrangements, integration "powered by" placements.

**Default assets:** powered-by lockup, partner lockup template, sponsor lockup template.

**Do:** use the locked templates; keep GAAhex never smaller than the partner at equal tier; maintain each logo's clear space; obtain the partner's official logo from the partner (never trace).

**Guardrails:** every co-brand/sponsor asset requires Design + Partnerships + Legal + Brand Owner approval. Never merge marks into a new combined symbol. Usage by the external party requires a written usage grant (Legal).

**Request level:** full approval path including Legal.

## 6.6 Legal

**Owns:** trademark, copyright, usage grants, third-party permissions, misuse enforcement.

**Default assets:** trademark usage guide, legal protection package, usage-grant templates.

**Do:** review all public/partner/trademark-bearing assets; manage ™/® usage and registration; issue and track third-party usage grants; run the misuse handling and evidence processes.

**Guardrails:** Legal is Consulted on public/partner assets and Responsible for enforcement and registration. Legal can halt any external use pending review.

**Request level:** Legal is a gate, not a requester, for most flows; initiates registration and enforcement.

---

# 7. Requesting Assets — Intake, Templates, SLAs

**Single intake.** All new-asset and modification requests go through the Brand Coordinator via the brand request channel. No side-channel logo edits.

**Use the right template** (full templates in master spec §42): Marketing, Product, Event, Partner, Agency. Every request states: requester, team, use case, audience, channel, formats/sizes, background (light/dark), deadline, approval level.

**Triage SLAs** (business days):

| Request type | Acknowledge | Deliver / route |
|---|---|---|
| Reuse existing approved asset | same day | same day (link provided) |
| New export/size from master (PATCH) | 1 day | 1–2 days |
| New internal asset (existing rules) | 1 day | 2–4 days |
| New public/marketing asset | 1 day | 3–5 days + approval |
| Partner/co-brand/sponsor lockup | 1 day | 5–8 days + legal |
| New asset group (MINOR) | 2 days | scoped per release |

**Emergency requests** (live incident, press deadline): flag as urgent; the Brand Owner or deputy grants provisional approval within hours; standard review completes within 48 hours; asset stays flagged provisional until ratified.

---

# 8. Approval Workflow

**Stages.** Intake & triage (Coordinator) → Design compliance review → Legal review (public/partner/trademark) → Final approval (Brand Owner) → Release to library.

**Approval matrix.**

| Request type | Design | Legal | Brand Owner |
|---|---|---|---|
| Reuse approved asset | — | — | — |
| New internal asset (existing rules) | Approve | — | Notify |
| Public/marketing asset | Approve | Review | Approve |
| Partner/co-brand/sponsor | Approve | Approve | Approve |
| Mark/geometry/color change (MAJOR) | Approve | Approve | Approve (required) |

**Outputs of approval.** Approved assets are named per convention, filed in the correct folder, added to the inventory with status, and announced in the release note. Provisional assets are tagged and tracked to ratification.

---

# 9. Versioning Model

**Semantic versioning** `vMAJOR.MINOR.PATCH`:
- **MAJOR** — mark/geometry/core-color change. Rare. Requires Brand Owner + Council sign-off and full re-clearance.
- **MINOR** — new asset groups or surfaces. Backward compatible.
- **PATCH** — fixes, re-exports, new sizes. No identity change.

**How teams consume versions.**
- Engineering pins to a released version; upgrades are deliberate, not automatic.
- Each release ships as `gaahex-brand-vX.Y.Z-YYYYMMDD.zip` with a `CHANGELOG.md` entry.
- The Figma library is versioned; teams pull the current published library.
- Breaking changes (MAJOR) are announced ahead of time with a migration window (Section 10 + master spec §47).

---

# 10. Maintenance & Lifecycle

**Asset lifecycle:** Draft → Review → Approved → Published → Deprecated → Archived.

**Cadence.**
- **Quarterly audit:** broken links, platform spec drift (new PWA/social dimensions), stale assets in the wild.
- **Annual refresh:** full review of the inventory and documentation against current platforms.

**Policies.**
- **Frozen master:** downstream assets are never hand-edited; always re-export.
- **Deprecation:** superseded assets move to `_archive/vX` for one release cycle before removal; teams are notified with the replacement mapping.
- **Archive:** every shipped release is archived in full and retained at least five years.
- **Ownership:** Brand Owner approves MAJOR/MINOR; any team requests PATCH via intake.

**Migration (when a version breaks usage):** inventory placements → map old→new per surface → re-export → replace in priority order (internal → web/app → social/marketing → print/merch) → archive old → keep rollback set for one cycle.

---

# 11. Governance & Change Control

**Decision rights.** Brand Owner is accountable; Brand Council advises on MINOR/MAJOR; Coordinator executes operations.

**Change control.**
- Any change enters through intake and is classified PATCH / MINOR / MAJOR.
- PATCH: Design executes, logs in changelog.
- MINOR: Council consulted, Brand Owner approves, new range added to inventory.
- MAJOR: Council + Legal + Brand Owner; triggers re-clearance and migration plan.

**Exceptions.** Time-critical needs use the emergency path (Section 7). Any exception is documented, time-boxed, and ratified or rolled back within 48 hours. Repeated exceptions for the same gap signal a missing standard asset — log it as a MINOR request.

**Escalation path.** Requester → Brand Coordinator → Design Lead → Brand Owner (+ Legal where external). Disagreements on brand fidelity are resolved by the Brand Owner.

---

# 12. Compliance, Trademark & Misuse

**Proper usage** (all teams): approved files only; preserve geometry/proportions/color/clear space; correct mode per background; name as `GAAhex` with ™/® per Legal guidance in prominent use.

**Improper usage** (never): recolor, distort, rotate, skew, outline, add effects, busy backgrounds, hand-recreation, altered wordmark typeface, mark combined with other graphics.

**Third-party usage.** External parties use the logo only under a written usage grant from Legal, with unmodified files, following clear-space/min-size rules, and may not imply endorsement beyond the agreed relationship.

**Misuse handling.** Detect → assess severity/intent → first contact (notify + supply correct assets) → escalate to formal notice → enforce per counsel → document outcome. Evidence: dated screenshots/URLs, timestamped archives, context/reach, stored unaltered in a case file.

---

# 13. Onboarding & Training

**New hire (all teams):** read this manual + the master spec; get library + Figma access; complete a 20-minute brand basics walkthrough.

**Role-specific:**
- Marketing/Partnerships: usage rules, approval path, request templates.
- Product/Engineering: token integration, theming, accessibility, animation embedding.
- Design: production from master, naming/folder discipline, compliance review.
- Legal: trademark, grants, misuse process.

**Refresh:** brief at each MINOR/MAJOR release; annual brand-ops refresher.

---

# 14. Brand Operations Metrics

Each metric has one owner and ties to consistency, speed, or protection.

| Metric | Definition | Owner | Target |
|---|---|---|---|
| Request turnaround | Median business days from intake to delivery | Brand Coordinator | Within SLA (Section 7) |
| Reuse rate | Approved-asset reuse ÷ total brand uses | Brand Coordinator | ≥ 80% |
| Compliance pass rate | Assets passing first Design review ÷ submitted | Design Lead | ≥ 90% |
| Off-brand incidents | Published non-compliant brand uses per quarter | Brand Owner | Trend to zero |
| Trademark coverage | Registered jurisdictions ÷ active markets | Legal | 100% of active markets |
| Library freshness | Assets matching current platform specs ÷ total | Brand Coordinator | ≥ 95% post-audit |

---

# 15. Quick Reference & Checklists

**Pre-publish checklist (any team)**
- [ ] Asset pulled from the library (not a screenshot/personal file)
- [ ] Correct color mode for the background
- [ ] Clear space (1×) and minimum size respected
- [ ] `alt="GAAhex"` set; decorative repeats hidden
- [ ] Contrast meets the required WCAG level
- [ ] Required approval obtained (Section 8)
- [ ] Filename follows the convention; filed correctly

**Do / Don't (pin this)**
- **Do:** use library files · match mode to background · keep clear space · request what's missing.
- **Don't:** recreate/trace the mark · recolor or distort · typeset the wordmark by hand · circulate non-library files · merge marks in co-branding.

**Who to contact**
- Need an existing asset → Brand Coordinator (intake).
- New/modified asset → intake with the right request template.
- Implementation question → Design (assets) / Engineering lead (code).
- External/partner/legal question → Legal.
- Dispute on brand fidelity → Brand Owner.

**Glossary**
- *Frozen master* — the authoritative vector source; never edited downstream.
- *Lockup* — a fixed arrangement of mark + wordmark.
- *Mode* — color treatment (color, dark, light, white, black, grayscale, mono).
- *Token* — a named brand variable (`--gx-*`) consumed in code.
- *PATCH/MINOR/MAJOR* — versioning tiers (Section 9).
- *Provisional asset* — emergency-approved, pending ratification.

---

*End of GAAhex Brand Operations Manual v1.0 — paired with the Brand Master Specification as the brand's operating system.*
