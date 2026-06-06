# GAAhex Frontend Styling LAW — token discipline

**Status: LAW. Non-negotiable. Applies to every component, view, and CSS file under `frontend/src`.**
Violating any rule below is a build-quality defect, not a style preference. Every agent —
and the orchestrator — consults this before writing or reviewing frontend code.

> The platform renders from a tokenized design system. Hardcoded values are trash: they
> drift, they break consistency, and they defeat the single-source-of-truth. There is no
> "small exception just here."

---

## The rules

1. **No static inline styles.** Padding, margin, gap, color, width/height, font-size,
   radius, border, shadow — none of these appear as literal values in a `style={{ }}`
   prop. They live in CSS, keyed off `--gx-*` tokens.

2. **No hardcoded hex colors.** `#rrggbb` / `#rgb` must not appear anywhere except
   `frontend/src/styles/gaahex-tokens.css` (the one registry). Use a `--gx-*` color token.

3. **No raw px / magic numbers** in inline styles or in component CSS. Use the spacing,
   text, and radius tokens (map below). If a needed value has no token, add the token to
   `gaahex-tokens.css` first, then reference it — never inline the number.

4. **The only permitted inline style is a genuinely-dynamic runtime value** — a live
   percentage, a computed grid coordinate, a measured offset — and even then it is passed
   as a **CSS custom property** (`style={{ ['--x']: value }}`), with all real styling in a
   CSS class. A static value is never "dynamic."

5. **Components set `className`.** Visual values live in CSS + tokens. A component file
   should be almost free of `style={{ }}`.

6. **Comments are minimal, factual, professional.** No personal names. No chatty
   justifications or apologies in code — they go stale and become noise. State what the
   code does, not the conversation that produced it.

---

## Token map (use these — do not inline the raw value)

**Spacing** (`--gx-space-N`): 1=2px · 2=4px · 3=6px · 4=8px · 5=10px · 6=12px · 7=14px ·
8=16px · 18=18px · 20=20px · 12=24px · 16=32px · 9=40px.

**Radius** (`--gx-radius-*`): none=0 · xs=3 · sm=5 · md=8 · lg=12 · xl=16 · 2xl=22 · full=9999.

**Text size** (`--gx-text-*`): 10=10 · 11/xs=11 · sm=12 · base/13=13 · md=14 · lg=16 ·
xl=18 · 2xl=22 · 3xl=28 · 4xl=36 · 5xl=48 · 6xl=64.

**Color** (`--gx-*`): text-1 (primary) · text-2 (secondary) · text-3 (muted) ·
bg · bg-subtle · surface · surface-2 · elevated · border · border-subtle · border-strong ·
gold (signature) · interactive (azure) · success-fg / warning-fg / danger-fg and their
`*-soft` fills. Map each hex to the nearest semantic token by ROLE, not just by value.

---

## Converting an existing hardcode (the cleanup procedure)

- A literal px → the spacing/text/radius token with that value. If it's an odd number with
  no token, round to the nearest token; if it's load-bearing and truly off-scale, add a
  named token to `gaahex-tokens.css` and reference it.
- A hex → the semantic color token that matches its role.
- A whole `style={{ }}` of static values → move it into a CSS class on the element.
- A `style={{ }}` mixing static + one dynamic value → keep only the dynamic value, as a CSS
  var; move the rest to a class.
- After each file: `npx tsc --noEmit` and a visual screenshot check. Never ship a layout you
  haven't looked at.
