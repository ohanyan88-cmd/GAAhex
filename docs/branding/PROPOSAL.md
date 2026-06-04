# GAAhex Brand Proposal — Ոսկերիչ, 2026-06-04

> Operating doc. The other crew members (Լոջ, Կյաժ, Կայծ) will work from the
> Execution Plan at the end of this document. The orchestrator approves and
> dispatches; this file is the contract between brand intent and code.
>
> Audit findings that drive these proposals live in `AUDIT.md`.
> Research notes live in `_research/`. Both are part of this proposal.

---

## 1. Brand position

**GAAhex is an operator-grade platform for running an Internet Service Provider — the only place of work for every department in an ISP, from NOC to billing to dispatch.** It is dark-first, dense, config-driven, multi-tenant, and built to be lived in by the same person for an 8-hour shift. The name carries a family (G+A+A = Gev + Anna + ) and a partnership (GAA + HEX). The brand is the family, expressed as a serious operations console.

**GAAhex is NOT:** consumer software, a marketing CRM, a luxury or premium-tier lifestyle product, a casino or web3 surface, a generic enterprise template, or a Bloomberg-terminal cosplay. It does not perform seriousness with metallic gradients or trophy aesthetics. It earns seriousness by being clear, fast, and honest at 11px.

The taste anchors are Linear, Tailscale, Notion, Vercel — flat vector, restrained color, generous space, type that carries the brand more than chrome does. The anti-references are luxury watches, casino UI, mobile-game brand systems, gradient-heavy fintech, "enterprise" stock photography.

Voice has a floor (per `.md` honesty floor): no performed warmth, no manufactured personality, no jokes during incidents. The platform speaks like a steady operator: present, honest, calm under load.

---

## 2. Visual identity proposal

### 2.1 Logo system

This proposal **does not replace the current logo in this pass.** It specifies the rules for using what exists today, and it documents the recommended refresh direction. The actual redraw is a designer task captured in `LOGO_BRIEF.md` for orchestrator handoff.

**Logo system tiers (modeled on Linear's hierarchy):**

| Tier | Asset | When |
|---|---|---|
| **Primary** | Wordmark (`GAAhex-logo-cobalt-gold.svg`) | Default everywhere space allows — login, marketing, headers, social header images |
| **Secondary** | Wordmark reversed (`GAAhex-logo-reversed.svg`) | Dark-on-light contexts |
| **Mark** | Standalone mark (`GAAhex-mark.svg`) | Favicons, app icons, social avatars, partner-card lockups, chips, in-product brand moments where the wordmark would dwarf the surface |

**Color variants (modeled on Stripe's three-color rule):**

| Variant | Use case |
|---|---|
| Full color (cobalt + gold) | Default. Use anywhere with a brand-cobalt or neutral-dark background. |
| Mono cobalt | Light backgrounds where the gold would wash out (`docs/BRAND.md` light theme; partner light docs) |
| Mono platinum / white | Quiet dark surfaces; cases where a non-full-color mark is more dignified than the gradient (small-scale, single-color print) |

**No other color variants are permitted.** Match Stripe's rule: *"Do not use any other color for the wordmark."*

**Construction grid + clear space:**

- **Unit:** the cap-height of the "G" in the wordmark = 1 *gx*
- **Clear space:** minimum 1 *gx* on every side of the lockup. No text, no graphics, no decorative element inside the exclusion zone.
- **Minimum size (digital):** wordmark = 120px wide. Mark = 16px square (the favicon floor).
- **Minimum size (print):** wordmark = 25mm wide. Mark = 8mm square.

**Misuse — DON'T (irreducible):**
- Don't alter the file.
- Don't recolor the wordmark outside the three approved variants.
- Don't stretch, rotate, skew, or shear.
- Don't replace the typeface inside the wordmark.
- Don't place on insufficient-contrast backgrounds.
- Don't combine with other marks without an explicit lockup spec.
- Don't crop, shadow, outline, or apply effects.
- Don't use as a decorative pattern.

**Lockup with partner logos (deferred):** Stripe Elements will render inside GAAhex Pay views in M1-C; this creates the first co-brand moment. Spec a one-line rule in the brand bible: *"GAAhex and partner marks appear in adjacent regions with a clear-space gutter between them. They are not visually combined into a single lockup."* Full co-brand rules can wait for M2+.

**Logo refresh recommendation (not in this pass):** see `LOGO_BRIEF.md`. Brief addresses three current defects flagged in `AUDIT.md` §3.3:
1. Arial inside the "EX" cell — needs Space Grotesk or outlined paths.
2. Multi-stop gradients — recommend flat fills, Linear/Tailscale register.
3. Mark complexity at favicon size — recommend a single, geometric, decode-at-16px mark.

### 2.2 Typography

**Locked stack (already in `gaahex-tokens.css` — proposal is to formalize, not change):**

| Role | Family | Why |
|---|---|---|
| Display (H1, KPI numbers, brand moments) | **Space Grotesk** (variable 400–700) | Geometric, slightly technical; echoes the triangular A in the mark; carries the "premium operations console" register without ornament |
| UI / body (everything else) | **IBM Plex Sans** (variable 400–700) | Designed for "interfaces where data accuracy matters" — clear glyph differentiation (1/l/I, O/0). Less ubiquitous than Inter in 2026 — small but real brand differentiator. Strong CJK roadmap for M2+ global SaaS |
| Mono (IPs, MACs, IDs, code, tabular numerics) | **IBM Plex Mono** (400/500/600) | Same voice as Plex Sans; designed by the same team — coherent system |
| Armenian fallback | **Noto Sans Armenian** | Already declared as `--gx-font-am`. Locked. |

**Why we keep three families (not two, not four):** Space Grotesk is on the edge. Recommendation: **keep it for M1**, with an explicit rule that limits Space Grotesk usage to display tier (H1, H2, KPI numbers, page hero). Body and UI are Plex Sans only. Mono is Plex Mono only. If Space Grotesk usage drifts into H3/H4/body during sweeps, drop it in M2.

**Scale (already locked in tokens):**

```
--gx-text-xs   11px   captions, labels
--gx-text-sm   12px   secondary, small body
--gx-text-base 13px   primary dense-UI body
--gx-text-md   14px   default body in lighter views
--gx-text-lg   16px
--gx-text-xl   18px
--gx-text-2xl  22px   section title
--gx-text-3xl  28px   page title
--gx-text-4xl  36px   KPI number, display
--gx-text-5xl  48px
--gx-text-6xl  64px   page hero only
```

**Weight scale (locked):** 400 regular / 500 medium / 600 semibold / 700 bold.

**Tracking:** see `gaahex-tokens.css` — already defined as `--gx-tracking-tighter` through `--gx-tracking-widest`. Eyebrow / overline use widest tracking; everything else baseline.

**Brand bible additions (Łoջ to draft):**
- Hierarchy patterns: page title (display 28) → section title (display 22) → subsection (sans 18 semibold) → body (sans 13) → caption (sans 11).
- Anti-pattern: don't use display face below 18px. Don't bold body. Don't mix tracking inside a paragraph.

### 2.3 Color

**Reference D18 directly.** D18 is the constitution; this brand bible does not restate it, it points to it.

For brand-context (presentation, marketing, partner materials) outside the product UI, the same family rules apply with one carve-out: **gradient is permitted in the logo lockup and in hero brand moments only.** Everything in the product UI is flat — no gradients in chrome, no gradients in data viz unless the gradient itself encodes meaning (per D18 chart rules).

**Light theme parity:** every brand surface (logo, voice, type) must render correctly in light theme. The brand is not "dark-only with light bolted on." Both themes are first-class per the existing `[data-theme="light"]` token tier in `gaahex-tokens.css`.

**The "≤2% gold" budget (lifted from `design-system/README.md` §3):** a useful, measurable discipline. On any visible screen, gold should occupy roughly 2% or less of the chromatic budget — interactive azure ~8%, the rest (~90%) is slate + cobalt structure. The bible should state this as a target, not a hard rule.

**Tenant white-label rule (deferred but planned):** tenants override `--brand` and `--primary` for their own tenants (per `docs/specs/DESIGN_SYSTEM.md` §1). Spec the constraints in the brand bible:
- Tenant brand color must pass WCAG AA contrast against `--gx-bg` and `--gx-surface`.
- Tenant logo must be SVG, square (favicon) and horizontal (header) variants, with mono fallback.
- The GAAhex chrome around the tenant brand remains GAAhex. The mark in the sidebar, the favicon for the platform itself, the login page background — these never tenant-override.

### 2.4 Iconography

**Locked library:** `lucide-react ^1.17.0` (already in `frontend/package.json`).

| Rule | Value |
|---|---|
| Wrapper | `frontend/src/components/icons.tsx` re-exports under canonical GAAhex names |
| Stroke | `currentColor`, width 2, round caps, round joins |
| Fill | `none` |
| viewBox | `0 0 24 24` |
| Default size | 18px |
| Inline / dense table | 14px |
| Nav | 16–18px |
| Empty state | 40–48px |
| Color | always `currentColor` — never hardcoded |
| Filled exceptions | only ▶ play and explicit status dots |
| Emoji as icon | **never** (already locked in `docs/BRAND.md` §4) |

**ISP-domain icon mapping (already specified in `design-system/README.md` §4):**

| Concept | Lucide icon |
|---|---|
| Router / OLT / network device | `router`, `server` |
| Radio / wireless | `radio`, `wifi`, `satellite-dish` |
| Bandwidth, latency, throughput | `activity`, `gauge` |
| Topology | `network`, `cable` |
| Ticket, NOC alarm | `ticket` (Lucide) or custom if needed |

Where Lucide doesn't have an exact ISP-domain glyph and we need one, spec a `gx-isp-icons/` folder of hand-rolled SVGs in the **exact same construction** (24×24, 2px, round caps, currentColor, fill:none). Do not mix Phosphor or Heroicons.

### 2.5 Motion

**Already token-locked in `gaahex-tokens.css` lines 241–254** (`--gx-dur-*` durations and `--gx-ease-*` easings). Proposal is to formalize *when* each is used:

| Surface | Duration | Easing |
|---|---|---|
| Hover state on interactive elements | 100ms (`--gx-dur-fast`) | `--gx-ease-standard` |
| Overlay / modal enter | 200ms (`--gx-dur-base`) | `--gx-ease-out` |
| Overlay / modal exit | 150ms (`--gx-dur-quick`) | `--gx-ease-in` |
| Drawer slide | 200ms (`--gx-dur-base`) | `--gx-ease-emphasis` |
| Toast in | 200ms | `--gx-ease-out` |
| KPI tile tooltip | per D17 — fade + tiny scale, no slide | `--gx-ease-standard` |
| Page transitions | 300ms (`--gx-dur-moderate`) | `--gx-ease-standard` |
| Spring / bouncy | **forbidden in brand UI** (per D17 P3 removal) | — |

**Reduced-motion:** all durations collapse per the existing `@media (prefers-reduced-motion: reduce)` block. No motion-only information conveyance, ever.

**Motion voice:** "fast and purposeful." Per `design-system/README.md` §3 — adopted verbatim. Motion serves the operator's attention, never decorates.

### 2.6 Imagery & illustration

**Brand is graphic, not photographic.** The mark, the network topology view, the data-viz palette are the imagery. This is the established position from `design-system/README.md` §3.

**Where photos appear:**
- Technician avatars → cool-toned, real faces, not stock.
- Partner case studies (future) → real environments, no over-processing.
- Marketing hero (future) → topology / map renderings preferred to people.

**Illustration system (deferred):** GAAhex does not have one. When the first need arises (a richer empty-state, an onboarding wizard with hero illustration), spec a single illustration direction — recommended: flat geometric line + fill, two-color (cobalt + gold) on slate background, in the same vector register as the logo. Until then, empty states are `Lucide icon at 40–48px in --gx-text-3`. Adequate.

---

## 3. Brand voice proposal

**See `VOICE_GUIDE.md` for the full doc with do/don't pairs.** Summary here:

### Voice principles (4, locked)

1. **Plainspoken.** No hyperbole, no marketing register inside the product. State exactly what's true.
2. **Genuine.** Warm without sweetening. Honest about what works and what doesn't. Acknowledges that the user is an expert.
3. **Translator.** Demystifies. When the system uses a technical term (PPPoE, RADIUS, OLT, ONU), the UI defines it briefly the first time and trusts the operator after.
4. **Steady.** Calm under load. No panic. No jokes. The platform speaks the same way whether everything is fine or a transit link just dropped.

### Tone matrix

| Surface | Tone |
|---|---|
| Default operations (lists, details) | Neutral, terse, present |
| Successful action toast | Quiet confirmation, factual |
| Warning toast (degraded, suspended) | Direct, specific, what happened + what to do |
| Critical alarm | Terse. State the severity. Don't soften. |
| Empty states | Patient and instructive. "Nothing here yet — here's how to start." |
| Errors (validation, server) | Specific. State the field/cause. Do not blame the user. |
| Configuration & Studio | Light teaching register, like documentation in-place |
| Login / first-run | Welcoming but not warm. Honest about what's about to happen. |
| Armenian register | Same principles. Casual register OK in chat surfaces (per `portal-rules.md`); operations chrome stays neutral. |

### Naming + casing (lifted from `design-system/README.md` §2)

- **Brand name:** **GAAhex** — one word, always. Never "Gaahex," "GAAHex," "gaahex," "GAAhex app." Capitalization is load-bearing — it carries the GAA family meaning.
- **Sentence case** for buttons, menu items, field labels, headings (`New entity`, not `New Entity`).
- **UPPERCASE** only for status keys (`OPEN`, `IN_PROGRESS`), eyebrows/overlines, and table micro-labels.
- **snake_case** for entity keys, **kebab-case** for route slugs, **camelCase** for wire fields (per `portal-spec-decisions-2026-06-02.md`).
- "My" for the operator's own scope (`My Tasks`, `My Approvals`).
- Avoid "we." Avoid "please."

### Honesty floor (non-negotiable)

Direct from `.md`:
- **No performed feelings.** The platform is a tool. The operator-facing copy speaks like a steady professional, not a friendly assistant trying to be liked.
- **No embellishment.** State what's true; don't add context that isn't.
- **Don't soften severity.** A critical alarm is critical. A data leak is a data leak. A failure is a failure. Saying it nicely doesn't help the operator do their job.

---

## 4. Brand bible — proposed structure

Future file: `docs/branding/BRAND_BIBLE.md`. Filled in over time by Լոջ on orchestrator approval.

**Table of contents:**

```
1. Brand foundation
   1.1 Origin (G+A+A = Gev + Anna + )
   1.2 Mission
   1.3 Values (3-5)
   1.4 Positioning
   1.5 Audience — who GAAhex is for
   1.6 Audience — who GAAhex is NOT for (the negative space)

2. Verbal identity (extracted from VOICE_GUIDE.md)
   2.1 Voice principles (4)
   2.2 Tone matrix
   2.3 Naming, capitalization, casing
   2.4 Vocabulary — words we use / words we avoid
   2.5 Do/don't pairs
   2.6 Armenian register notes

3. Visual identity — logo
   3.1 System (wordmark, mark)
   3.2 Color variants (3)
   3.3 Construction grid + clear space
   3.4 Minimum sizes (digital, print)
   3.5 Approved backgrounds + contrast pairings
   3.6 Misuse — DON'T gallery

4. Visual identity — color
   4.1 D18 reference (Cobalt / Gold / Azure / Slate / Semantic)
   4.2 The 90/8/2 budget rule
   4.3 Light + dark parity
   4.4 Tenant white-label constraints

5. Visual identity — typography
   5.1 Display / UI / Mono / Armenian
   5.2 Type scale
   5.3 Weight scale
   5.4 Tracking
   5.5 Hierarchy patterns

6. Visual identity — iconography
   6.1 Lucide-react (locked)
   6.2 Sizes
   6.3 ISP-domain mapping
   6.4 Custom icon rules (gx-isp-icons)
   6.5 Emoji rule (ban)

7. Visual identity — motion
   7.1 Motion voice
   7.2 Duration + easing by surface
   7.3 Forbidden motion
   7.4 Reduced motion

8. Visual identity — imagery
   8.1 Graphic, not photographic
   8.2 Photo direction (when used)
   8.3 Illustration system (deferred)

9. Applications
   9.1 Product UI (cross-references design system standards 09)
   9.2 Documentation
   9.3 Email signatures
   9.4 Social profiles
   9.5 Partner / co-brand
   9.6 Login + marketing surfaces

10. Tenant white-label
    10.1 Overridable surfaces
    10.2 Locked surfaces
    10.3 Tenant brand constraints (contrast, format, fallback)

11. Misuse / DON'T gallery
    Visual + verbal anti-examples, called out across all sections

12. Legal
    12.1 Marks usage (deferred — Stripe-style "Marks Usage Agreement")
    12.2 Trademark notation
    12.3 Co-branding rules
```

---

## 5. Execution Plan — worklist for the orchestrator to dispatch

> The next agent runs in plain `docs/branding/` proposal mode are done. This
> section is the **worklist** the orchestrator will hand to other crew members
> in subsequent sessions. Each item has a target file, change shape, estimated
> risk, and a recommended owner.

### 5.1 Doc rewrites (Լոջ)

| # | File | Change shape | Risk | Why |
|---|---|---|---|---|
| 1 | `docs/BRAND.md` | **Rewrite end-to-end** against `gaahex-tokens.css` + D18 + this proposal §2. Drop "gold focus ring is the signature" line. Move from 2-family (Cobalt+Gold) to 5-family (D18). Update font stack from `system-ui` to Space Grotesk + Plex Sans + Plex Mono. Update icon path from `frontend/src/icons.tsx` to `frontend/src/components/icons.tsx`. | Medium | The doc currently teaches new agents to write wrong code. D19 violation. |
| 2 | `docs/specs/DESIGN_SYSTEM.md` | **Sweep for D18 conformance.** Specifically: §2.3 `--primary` description (cobalt is structural, not interactive — buttons/links use `--gx-interactive` / azure). §2.5 Focus Ring (dark = azure, not gold; gold reserved for brand moments). §11.1 Buttons (azure-500 bg, not cobalt). §11.2 Inputs (azure hover for interactive controls; gold hover is for containers per D17). §10 Icon Library (declare Lucide as locked; drop the 46-SVG hand-rolled framing). §3.2 Palette options (recommend pruning to dark + light + high-contrast for M1). | High | This file is 2,000+ lines; sweep is mechanical but extensive. Splitting by section into multiple Լոջ runs is fine. |
| 3 | `design-system/README.md` | **Remove the "this is a proposed reskin" caveat (§6).** The reskin shipped; this IS the design. Add Semantic family explicitly to §3. Lift the 90/8/2 budget rule into the bible. | Low | Minor edits. |
| 4 | `docs/branding/BRAND_BIBLE.md` | **NEW.** Create per the structure in §4 of this proposal. Section 11 (Misuse gallery) requires designer-grade illustrations — leave placeholder until the logo refresh. | Medium | Big doc but well-scaffolded. Can be authored in 2-3 sweeps. |
| 5 | `docs/branding/VOICE_GUIDE.md` | **NEW** — drafted by Ոսկերիչ in this pass. Լոջ to extend with the Armenian register section + 10 more do/don't pairs harvested from the existing views. | Low | Starter doc is in place. |

### 5.2 Token + code cleanups (Կայծ + Կյաժ)

| # | File | Change shape | Risk | Why |
|---|---|---|---|---|
| 6 | `frontend/src/styles/gaahex-tokens.css` | Audit the dark-theme `--gx-link` and `--gx-link-hover` — currently `#5293F2` (cobalt-azure). Per D18 link is interactive → should route through `--gx-interactive` (azure-500). Currently a legacy decoupling. Re-evaluate. | Low | One token routing change. Verify before sweep. |
| 7 | `frontend/public/fonts/` | **Verify** `space-grotesk-var.woff2`, `ibm-plex-sans-var.woff2`, `ibm-plex-mono-{400,500,600}.woff2` exist. If missing, the brand silently falls back to system-ui and nobody notices. | Medium | Silent fallback is a real brand bug. Ոսկերիչ did not touch fonts in this pass. |
| 8 | `frontend/src/views/**/*.tsx` | **Audit color-token usage for D18 conformance.** Specifically: search for `--gx-primary` used in button bg / link / hover / focus contexts and migrate to `--gx-interactive`. Search for `--gx-accent-gold` used as default hover and move to interactive contexts. Same pass that Կյաժ already did for `NocDashboardView` per D19 audit — extend to all views. | High | Cross-cuts every view. Big sweep. Recommend per-module batches. |
| 9 | `frontend/src/components/icons.tsx` | Verify the wrapper exports are complete vs. the icon list in `docs/specs/DESIGN_SYSTEM.md` §10. If any of the 46 documented icons are missing from the lucide-react wrapper, add or drop them. | Low | Spec-vs-code parity check. |

### 5.3 Brand surface additions (Ոսկերիչ in a future pass; Գեվ + orchestrator first)

| # | File | Change shape | Risk | Why |
|---|---|---|---|---|
| 10 | `docs/branding/LOGO_BRIEF.md` | **NEW** — drafted by Ոսկերիչ in this pass. The brief Gev can hand to an external designer or feed into an AI image tool when ready to commission the logo refresh. | Low | Starter doc is in place. |
| 11 | `frontend/public/logo/GAAhex-logo-cobalt-gold.svg` | **Defer.** Designer-grade redraw to address the Arial-EX + gradient + favicon-complexity defects in `AUDIT.md` §3.3. Do not edit in this pass; wait for Gev's call. | High if rushed | Touching the logo without designer input would be a downgrade. |
| 12 | `docs/branding/MARKS_USAGE.md` | **Deferred** to M2 — a one-page partner-facing usage policy (Stripe-style "Marks Usage Agreement"). Not needed until first partner-facing brand usage. | Low | Defer with intent. |

### 5.4 Recommended sequence

1. (Łoջ, single session) Item 5 — finalize `VOICE_GUIDE.md` Armenian section + 10 more pairs.
2. (Łoջ, single session) Item 3 — patch `design-system/README.md` (low risk, get it crisp).
3. (Łoջ, two sessions) Item 1 + 4 — rewrite `BRAND.md` and stand up `BRAND_BIBLE.md` in parallel using the new scaffolding.
4. (Łoջ, multiple sessions, can fan out) Item 2 — sweep `DESIGN_SYSTEM.md` for D18 conformance.
5. (Կայծ, single session) Items 6 + 7 — token routing + font file presence.
6. (Կյաժ, multi-session per-module) Item 8 — code D18 sweep, batch by module (Billing → CRM → Network → etc.).
7. (Orchestrator + Gev) Item 10 — review `LOGO_BRIEF.md`, decide whether to commission the redraw now or defer to M2.
8. (Deferred) Items 11 + 12.

### 5.5 Out of scope for this brand pass

- No git operations performed.
- No code edits performed outside `docs/branding/`.
- No tests run, no build run, no dev server started.
- No `.env` touched.
- No package added.
- No agent dispatched.

Items requiring those actions are queued in the Execution Plan above and remain at the orchestrator's discretion.

---

End of proposal.
