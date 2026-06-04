# Vercel / Geist — design system notes

Source: `vercel.com/geist/introduction` (WebFetch, 2026-06-04)

## Why Geist matters as a reference

Geist is what an opinionated, developer-targeted brand system looks like when
you control the type stack end-to-end (Vercel ships their own font). It's the
clearest public example of "two-font system: Sans + Mono" — which is what
GAAhex's `gaahex-tokens.css` already does (IBM Plex Sans + IBM Plex Mono +
Space Grotesk for display).

## Typography — two-typeface stack

- **Geist Sans** — general use
- **Geist Mono** — code and technical content

The system is *"specifically designed for developers and designers."*

Lesson for GAAhex: validate the existing three-font choice. We already have a
DISPLAY (Space Grotesk) + UI (IBM Plex Sans) + MONO (IBM Plex Mono) stack.
That's one more family than Geist. The question for the proposal: do we
**need** the display face, or is it brand cosplay?

Verdict for the proposal: KEEP Space Grotesk for display *only* if used
sparingly (page H1s, KPI numbers, brand moments). It's geometric and slightly
technical — it does echo the GAAhex logo. But if Plex Sans Semibold at large
sizes can carry the same job, we should consider dropping Space Grotesk to
save a font request and simplify the stack. Flag for orchestrator.

## Color philosophy — accessibility as foundation

*"A high contrast, accessible color system."* — contrast is treated as
foundational, not aesthetic.

Lesson for GAAhex: D18 already does this. Mirror Geist's framing in the brand
bible: contrast is not a finish-pass concern, it's a Tier-1 token decision.

## Tone (Vercel-wide)

*"Building blocks for React applications"* — direct, practical, no flourish.

Lesson for GAAhex: this is the developer-tool register. GAAhex's register is
adjacent but warmer (we're partner/family-driven, not pure tooling). We can
borrow the direct/practical shape without copying the cold of pure
infrastructure brands.

## Design priorities to mirror

1. Consistency — coherence across applications and interfaces.
2. Developer experience — the audience is a *user of the tool*, not a
   marketing target. GAAhex's audience is the same: ISP operators using the
   thing all day.
3. Accessibility — explicit, foundational.
4. Aesthetic cohesion — visual harmony.

GAAhex's design system standard (file 09) already covers 1, 3, 4. Priority 2
("developer experience" reframed as **operator experience**) is the lens
through which to read the whole brand: *every brand decision serves the
operator working an 8-hour NOC shift.*
