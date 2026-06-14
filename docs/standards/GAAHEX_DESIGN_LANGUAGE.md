# GAAhex Design Language — v1 (final)
**Companion to `GAAHEX_SYSTEM_STANDARD.md` §2.** That doc is the structural law; this is the visual identity —
the mood Bro reproduces on every screen.
**Source of truth = Brand v3.0** (`docs/branding/v3.0/`): colours/logo/font from `11-figma/tokens/gaahex-tokens.css`
+ `11-figma/import/gaahex-icon-*.svg`. **Visual target = `docs/design/gaahex_design_sample.html`** (dark + light, the locked
look). Reference Brand v3.0 — never redefine it. Subordinate to the Project Constitution (LAW-ST1).

> Tuning fork, not rulebook: when a screen feels off, check it here. Structural pass/fail = System Standard §13.

---

## 1 · Identity / mood
An **ISP control-room** — precise, calm authority, in **two modes (dark + light)**. **Data is the hero, the
hexagon is the soul.** Gold is a rare signature; Azure is the live signal. Premium and engineered, never flashy.
North star per screen: hive not grid · one clear purpose · cells related by space/elevation/glow not lines ·
gold marks the human outcome · forward momentum. **Spend boldness once per view.**

## 2 · Logo (Brand v3.0)
The honeycomb icon — **4 Cobalt · 2 Azure (signal) · 1 Gold (apex)** (`11-figma/import/gaahex-icon-color.svg` /
`-dark.svg`). Used as the GAAhex **system** mark, page icon, loaders, empty states. Cobalt cells are **theme-aware**
(`--gx-logo-cobalt`: `#1C3B68` light / `#4E7FC4` dark); azure + gold fixed.
**GAAhex = the system** (its mark/wordmark). The **tenant company** is shown separately with its own name/brand —
**never lock "GAAhex · Company" together.**

## 3 · Colour soul (D18, theme-aware — exact values in Brand v3.0 `gaahex-tokens.css`)
- **Cobalt** = structural spine `#1C3B68` (dark-chrome `#4E7FC4`). **Gold** = signature, rare `#C5A059`
  (light-bg `#AC8847`) — logo apex + ambient only, never a workhorse. **Azure** = interactive `#0EA5E9`
  (hover `#0284C7`, active `#0369A1`). **Slate** = neutrals (text/border/divider).
- **Semantic = status only** (never decoration): success `#16A34A` · warning `#D97706` · danger `#DC2626` ·
  info `#2563EB`. Roles: green = healthy/positive · red = risk/overdue · azure = interactive.
- **Theme flip:** `--gx-bg` `--gx-surface` `--gx-surface-2` `--gx-text-*` `--gx-border` `--gx-glass`
  `--gx-logo-cobalt` flip dark↔light; brand hues + semantic colours stay. One token set, two value-maps;
  components never change.

## 4 · Aurora-Glass (signature surface treatment)
- **Background:** scattered **hexagons** — varied sizes, **random positions, unique per page** (each page renders
  its own layout, so no two screens feel identical) — faint, brand-hued (cobalt/azure/gold), plus a subtle
  ambient diagonal glow.
- **Surfaces are glass:** cards / search / chips are **~51% transparent + backdrop-blur** (`--gx-glass` /
  `--gx-glass-border` / `--gx-glass-blur`), so the hexagons + glow read softly through them. Hairline glass
  borders, restrained glow, card radius ~14px. Modals/overlays use the same glass.

## 5 · Typography
**Sora** (brand display/UI, `--gx-font-family`). **Tabular figures** for numbers/IDs/phone/money.
**Micro-labels UPPERCASE, letter-spaced** (PAYMENTS TODAY · INVOICE) — a signature tell.
**Script coverage (REQUIRED): AM + EN + RU** — fonts must cover **Armenian + Cyrillic + Latin**. Sora covers
Latin; pair with **Noto Sans Armenian + Noto Sans** (Cyrillic) fallbacks. A gap = broken Armenian/Russian.

## 6 · Element philosophy (→ System Standard §5)
Match element to data shape; **never monotone**. Stat for one number · card for a few attributes · table for
many rows · **definition list** for a few key–values · timeline/stepper for a sequence · chart for a trend ·
badge / RAG for status. Mix densities so the page breathes.

## 7 · Data-viz, pills, motion
Thin **azure** sparklines · rounded **semantic** progress · trend chips (arrow + semantic colour) · minimal,
honest charts in cobalt/azure. **Status pills** muted, **UPPERCASE** (`IN_PROGRESS` · `OPEN` · `ORG`). **Alert
chips** = icon + semantic tint. **Motion** restrained: hover lift, modal fade+scale, subtle live-pulse;
`prefers-reduced-motion` always respected.

## 8 · Voice (→ CONTENT_VOICE, System Standard §9/§10)
One calm, professional product serving Armenian ISPs. Active voice, sentence case. An action **keeps its name
through the flow** (button "Publish" → toast "Published"). Empty states **invite an action**; errors say **what
happened + how to fix** — never vague, never an apology. **Trilingual: AM + EN + RU.** Numbers, currency (֏),
dates, phones go through the formatter module — never baked into a string.

## 9 · The test (is this screen "GAAhex"?)
Calm · one clear purpose · glass on a control-room canvas with per-page hex scatter · a single gold focal · azure
the only live signal · varied by data · trilingual · Sora + tabular figures · and nothing on it is pure
decoration. **Match `docs/design/gaahex_design_sample.html`.** Spend boldness once; keep the rest quiet.

---

*ISP control-room. Data is the hero, the hexagon is the soul. Spend gold once. Speak three languages, calmly.*
