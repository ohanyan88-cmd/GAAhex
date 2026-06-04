# Typography choice — IBM Plex Sans vs. Inter for the GAAhex UI

Source: WebSearch summary 2026-06-04 (fontfyi.com, fullstop360.com, fontalternatives.com)

## Current state in GAAhex

`frontend/src/styles/gaahex-tokens.css` (lines 51–80) already declares
**IBM Plex Sans** as the UI/body face (with Plex Mono for monospace and
Space Grotesk for display). The fonts are self-hosted from `/public/fonts/`.

`docs/BRAND.md` §6, by contrast, declares the font stack as `system-ui,
-apple-system, "Segoe UI", sans-serif` for body. **This is a contradiction —
flagged in AUDIT.md §D18-delta and §Typography.**

## The two contenders for the UI face

| | Inter | IBM Plex Sans |
|---|---|---|
| Designed for | UI at small sizes — Rasmus Andersson explicitly | "Brand voice of IBM" — corporate but legible |
| 11–14px legibility | dominates this range | excellent, slightly less optimized than Inter |
| Enterprise perception | now-ubiquitous (Google Fonts 414B requests/yr to May 2025, +57% YoY) | distinct, "carries institutional weight" |
| Global / CJK | OK fallbacks | purpose-designed CJK variants in the same voice |
| Differentiation in 2026 | low — every dashboard uses Inter | higher — slightly differentiated B2B feel |

## The 2025 trend — "Inter is becoming invisible"

> "Inter was accessed 414 billion times on Google Fonts in the year ending
> May 2025 with a 57% increase year over year, but that growth is also
> creating an identity problem where typography stops being a differentiator
> and starts being invisible."

This is the strongest argument *for* sticking with IBM Plex Sans.

## Decision for GAAhex — KEEP IBM Plex Sans

Reasons:

1. **Differentiation.** Inter has become the default-dashboard typeface.
   Choosing Plex Sans is a small but real brand differentiator without
   being precious about it.
2. **Operator audience.** Plex was designed specifically for "interfaces
   where data accuracy matters" (per fontfyi). The clear glyph
   differentiation (1/l, O/0) is critical for IPs, MACs, ONU serial
   numbers — the very strings ISP operators stare at.
3. **CJK pipeline.** GAAhex is M1-Armenian, but the M2+ ambition is global
   SaaS (per `portal-m1-strategy.md`). Plex's CJK family-voice matters when
   the platform expands to Asian markets — Inter's CJK fallback story is
   weaker.
4. **It's already in the tokens.** No migration cost.

## What needs to happen

1. **Resolve the contradiction.** `docs/BRAND.md` §6 must be rewritten to
   match `gaahex-tokens.css` (Plex Sans, not system-ui). Worklist item for
   Լոջ.
2. **Verify font files are present.** `/public/fonts/ibm-plex-sans-var.woff2`
   etc. — check existence. (Not done in this audit — flag for Կայծ to
   verify; we did not modify or touch font files.)
3. **Document fallback chain explicitly** in the brand bible (already in the
   tokens — Plex Sans → Segoe UI → system-ui → -apple-system → sans-serif).

## On Space Grotesk (display)

The third font is Space Grotesk for display (page H1s, KPI numbers, brand
moments). Three families is borderline-heavy. Two arguments:

- **Keep it** — it's geometric and slightly technical, it echoes the
  triangular A-mark of the logo (per `gaahex-tokens.css` header comment),
  and the visual differentiation between display and body is part of the
  premium feel.
- **Drop it** — Plex Sans Semibold at 28+px is perfectly serviceable; one
  less font load is one less request; the brand could survive with one Sans
  family.

Recommendation in PROPOSAL.md: **KEEP Space Grotesk for now**, but flag for
Gev's call. Three fonts is on the edge of "too many" but the display family
genuinely helps brand moments breathe.
