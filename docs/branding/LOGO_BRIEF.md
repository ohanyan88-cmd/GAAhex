# GAAhex Logo Refresh — Designer Brief

> Paste-ready brief for an external designer OR for Gev to feed into an AI
> image-generation tool (Midjourney, DALL·E, Stable Diffusion, Adobe Firefly).
>
> **NOTE TO ORCHESTRATOR:** this is a brief, not an instruction. Do NOT
> commission the redraw without Gev's explicit "go." Decision point flagged
> in `PROPOSAL.md` §5.3 item 11.
>
> The brief addresses three specific defects in the current logo (per
> `AUDIT.md` §3.3): the Arial-in-wordmark issue, the gradient-heavy register
> that drifts toward "luxury" (rejected by Gev), and the favicon-size
> complexity. The brief does not assume a particular direction is correct —
> it specifies the constraints and the taste anchors, and asks the designer
> to propose two or three directions.

---

## 1. The brand in one sentence

GAAhex is the only place of work for an entire ISP — a dark-first, dense,
operator-grade operations platform built to be lived in for eight hours
straight by people running fiber, billing customers, and answering NOC
alarms. The brand name is the family that owns the platform — **G**ev,
,  — fused with a partner mark (**hex**) into a single
camelCase word.

---

## 2. What the logo has to do

In order of priority:

1. **Read clearly at 16×16 px** (favicon). This is the strictest constraint.
2. **Carry "serious operations console" register** at 32–80 px sidebar size.
3. **Hold up at 80–400 px** in marketing / login surfaces.
4. **Survive single-color reproduction** (cobalt-only, white-only).
5. **Echo the GAA family meaning** without literalizing it. The family
   meaning lives in the books and the partnership memory; the logo doesn't
   need to spell it out.
6. **Sit comfortably next to Stripe Elements** inside the product
   (M1-C shipping). The logo can't make Stripe look better than GAAhex.

---

## 3. Taste anchors (in priority order)

- **Linear** (`linear.app/brand`) — flat ink wordmark, restrained, monochrome-
  first, generous clear space, mark is geometric without being decorative
- **Tailscale** — flat vector, plain, no luxury cues
- **Notion** — sentence-case wordmark, monochrome-default, mark survives at
  favicon size
- **Vercel** — black-ink wordmark, triangular mark, geometric

The GAAhex logo should feel like it belongs in this peer group, not like a
fintech challenger or a telecom incumbent.

## 4. Anti-references (explicit, do NOT go here)

- **Luxury watch brands** (Rolex, Patek, etc.) — gold-on-cobalt, gradients,
  serif typography. Gev explicitly rejected this register.
- **Casino / gaming brands** — sparkle, baroque-metallic, trophy aesthetics.
- **Mobile-game UI** — playful, rounded, mascot-led.
- **Web3 / crypto maximalism** — neon gradients, holographic, glitch.
- **Generic enterprise SaaS templates** — abstract swooshes, generic globes,
  meaningless geometric shapes that say "we are a software company."
- **Stock telecom imagery** — fiber-optic glamour shots, glowing data
  streams.

---

## 5. The three defects to fix

### 5.1 The "EX" cell uses Arial
The current `frontend/public/logo/GAAhex-logo-cobalt-gold.svg` line 31
hardcodes `font-family="Arial, Helvetica, sans-serif"` for the "EX" text.
This means the wordmark is built on a typeface that appears nowhere else in
the platform — a real coherence failure.

**Fix direction:** rebuild the wordmark in either (a) GAAhex's brand display
face **Space Grotesk** (used for page titles + KPI numbers throughout the
platform), with the EX outlined to paths so there's no runtime font
dependency, OR (b) a custom-drawn wordmark where each letter is a unique
vector, no font at all. Designer's call.

### 5.2 Multi-stop gradients in the cobalt + gold paths
The current logo uses 3-stop linear gradients on every cobalt and gold path.
Gradients in logos can work, but the taste anchors (Linear / Tailscale /
Notion / Vercel) all use **flat fills**, and Gev's stated direction is anti-
luxury / anti-gradient / anti-metallic.

**Fix direction:** explore a flat-fill version. Cobalt is `#1C3B68`. Gold is
`#C5A059`. Two flat colors. The mark + wordmark hold the brand on geometry,
not on the gloss of a gradient.

Optional: a single very subtle gradient on the mark only (top to bottom,
~10% value shift) is acceptable IF the designer can prove it reads as
"matte" not "metallic." Default position is flat.

### 5.3 Mark complexity at favicon size
The current `GAAhex-mark.svg` has 7 stroke + fill paths inside a 512×512
viewBox. At 16×16 favicon size, it'll collapse to mush. Faviconability is
non-negotiable — the mark lives in 50 browser tabs at a time.

**Fix direction:** a simpler standalone mark that reads at 16px. Could be:
- A single letter (the "G," the merged "G-A")
- A single geometric figure (the pyramid / triangle that's already a motif
  in the current logo, simplified to one decisive shape)
- A wordmark abbreviation outlined to a single path (e.g., just "GA" as a
  monogram)

Designer to propose 2–3 directions.

---

## 6. Constraints (hard)

| Constraint | Value |
|---|---|
| Primary colors | Cobalt `#1C3B68` + Gold `#C5A059` (with `#142C4E` darker cobalt and `#9C7C3C` darker gold reserved for accents only) |
| Color variants required | (1) full color cobalt + gold, (2) mono cobalt (for light backgrounds), (3) mono platinum/white (for dark quiet contexts) |
| File formats required | SVG (primary), PNG @ 1x/2x/3x (favicon, app icons, social), ICO (favicon), PDF (print) |
| Asset set required | Primary wordmark (horizontal), standalone mark (square), favicon (16/32/48), app icon (192/512, maskable), Apple touch icon, OG social card (1200×630) |
| Construction grid | Unit = cap-height of the "G" in the wordmark. Clear space = 1 unit on every side. |
| Minimum size — digital | Wordmark 120px wide; mark 16px square |
| Minimum size — print | Wordmark 25mm wide; mark 8mm square |
| Typography in wordmark | Space Grotesk (brand display face) OR custom-drawn vector; NEVER Arial / Helvetica / generic system fallback |
| Background contrast | Must pass WCAG AA against `#0A1322` (dark theme bg) AND `#F4F7FB` (light theme bg) |
| Animation | The mark may have a single subtle opacity/scale enter animation if desired (200ms, ease-standard). No spin, no shimmer, no perpetual motion. |
| File size | Each SVG ≤ 4 KB minified. Each PNG ≤ what favicon spec demands. |

---

## 7. Constraints (soft — taste)

| Soft constraint | Note |
|---|---|
| Wordmark vibe | "Flat ink." If you imagine printing it in a single ink color on uncoated paper, it should feel right. |
| Mark vibe | "Decisive shape." It should read as one figure, not as a composition. |
| The "GAA" thing | If the mark can geometrically suggest "three" without literally being three things, that's gold. (Three stops, three sides, three weights — designer's choice.) Not required. |
| The "hex" thing | The partnership mark (the HEX side of GAA+HEX). If a six-sided motif naturally emerges from the geometry, that's a happy alignment. Not required. |
| Wordmark length | Hex-end is lowercase; "GAA" is uppercase. The eye should read "GAA·hex" as one beat, not two halves. |
| Personality | Closer to "instrument" than "logo." Closer to "tool maker's mark" than "consumer brand." |

---

## 8. Deliverables expected from the designer

1. **2–3 direction sketches** — pencil/sketch fidelity, just enough to evaluate the geometric idea.
2. **One direction refined** — vector, flat, all three color variants.
3. **Full asset set** for the refined direction (per the file formats / asset set rows in §6).
4. **A one-page proof sheet** showing the mark at 16/32/64/128/256 px next to the wordmark at four sizes, in both dark and light theme.
5. **A misuse gallery** — 6–8 explicit "do not do this" examples (recolor, stretch, low-contrast, etc.).
6. **Source files** in their native format (Figma, Illustrator, Affinity — whichever the designer uses) plus exported SVG/PNG/ICO/PDF.

---

## 9. For AI image-tool use (if Gev fronts this himself)

If feeding this brief into Midjourney / DALL·E / Firefly, the most useful
prompt skeleton:

```
Flat vector logo design for "GAAhex," an operator-grade operations console
for Internet Service Providers. Two-color: deep cobalt #1C3B68 and matte
gold #C5A059. Minimalist, geometric, restrained — in the visual register of
Linear, Tailscale, Notion, Vercel. Flat ink, no gradients, no luxury cues,
no metallic finishes. The wordmark "GAAhex" is one word (capital G-A-A,
lowercase h-e-x). Generous clear space. Reads at favicon size. Single ink
color version must also work. Dark navy background. Reference: clean
geometric B2B SaaS brand marks circa 2024-2026. Anti-reference: casino
brands, luxury watches, web3 maximalism, generic SaaS swooshes.
```

Iterate on the prompt. Generate multiple, narrow to two, refine one.
Hand to a vector designer for the final clean-up — AI tools generate
raster; the production assets must be true vector.

---

## 10. Out of scope for this brief

- Animated lockups (defer; brand is graphic, not motion-led at M1).
- Sound / audio brand (no).
- Brand video / hero film (no — M1 is on-prem at one ISP).
- Tenant white-label logo system (separate brief — that's about HOW tenants
  override GAAhex's brand for their own).
- Co-brand lockups with partners (defer to M2+).
- Merchandise (defer).

---

End of brief.
