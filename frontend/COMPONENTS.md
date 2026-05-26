# GAAex Component Library — Buttons · Inputs · Search

The canonical spec for GAAex's core form components. **4 types each · 3 sizes each (sm/md/lg) ·
dark + light.** Builds on the design tokens + rules in `../BRAND.md`. The live CSS implementation is
in `src/styles.css` (section "Component library"); this file is the design source of truth.

## GAAex integration notes (read first)
- **Dual theme via one mechanism.** Dark is the default (`:root`); light is the
  `[data-theme="light"]` override (toggled in the header). The per-theme values below are applied
  exactly that way in `styles.css` — dark rules are default, light rules are scoped under
  `[data-theme="light"]`. Do not hardcode a single theme in a component.
- **Icons are SVG, never emoji / icon-fonts** (BRAND.md §4). Where this spec sketches `ti ti-search`,
  `ti ti-x`, `ti ti-alert-circle`, or a `▾`/`×` glyph, use the SVG components from `src/icons.tsx`:
  `SearchIcon`, `CloseIcon` (clear), `ChevronDownIcon` (filter), `WarningIcon` (error). They inherit
  `currentColor`, so the icon-color rules below just set `color`.
- **`⌘K`** in the command search is a real keyboard-shortcut label (typography), not an emoji — keep it.

---

## Design tokens (per theme)

| Token | Dark | Light |
|-------|------|-------|
| bg / canvas | `#0D0F12` | `#F8F9FA` |
| surface | `#1F242C` | `#FFFFFF` |
| surface-2 | `#242A33` | — |
| border-subtle | `rgba(244,246,249,.10)` | `#E2E8F0` |
| border-strong | `rgba(244,246,249,.18)` | `#1C3B68` |
| text-primary | `#F4F6F9` | `#111827` |
| text-muted | `rgba(244,246,249,.55)` | `#6B7280` |
| text-faint | `rgba(244,246,249,.40)` | `#9CA3AF` |
| brand-primary / hover | `#1C3B68` / `#244879` | `#1C3B68` / `#142C50` |
| accent / hover | `#C5A059` / `#D2AE6A` | `#C5A059` / `#B68F47` |
| danger / hover | `#E63946` / `#EF4D58` | `#D90429` / `#B30322` |
| warning | `#F5A623` | `#E65F00` |
| success | `#2ECC71` | `#10B981` |

**Size scale (all components):**
| Size | Height | Font | Padding | Radius |
|------|--------|------|---------|--------|
| sm | 28px | 12px | 0 10px | 6px |
| md *(default)* | 36px | 13px | 0 14px (inp 0 12px) | 8px |
| lg | 44px | 14px | 0 18px (inp 0 14px) | 10px |

---

## 1. Buttons — `btn btn-{type} btn-{size}`
**Types:** `primary` (Cobalt fill — main action) · `accent` (Gold fill — confirm / signature CTA) ·
`ghost` (outline — secondary / cancel) · `danger` (Crimson fill — destructive).
**States:** default · hover · `:focus-visible` (3px ring — gold for primary/accent/ghost-dark,
brand for light; crimson tint for danger) · `:disabled` (muted fill, `not-allowed`).
Structure: `<button class="btn btn-primary btn-md">Label</button>`. Icon + label via inline-flex, gap 6px.

## 2. Text inputs — `inp inp-{size}` (+ variant)
**Types:** Standard (`type=text`) · Numeric (`inp-numeric`, digits, right-aligned, tabular) ·
Password (`type=password` + visibility toggle) · Textarea (`inp-area`, multi-line, vertical resize).
**States:** default · hover (gold border dark / cobalt border light) · focus (accent border + 3px
ring) · `is-error` (crimson border + ring) · `:disabled`.
Helpers: `.inp-help` (muted, 11px) · `.inp-err` (danger, 11px, with `WarningIcon`).
Structure: `<input class="inp inp-md" />`, `<textarea class="inp inp-md inp-area" rows="4">`.

## 3. Search — `search search-{size}` wrapper
**Types:** Simple (icon + input) · With clear (+ `CloseIcon` button) · With filter (+ `.search-filter`
chip, `ChevronDownIcon`) · Command-style (+ `.search-kbd` `⌘K` hint). Input has left padding for the
search icon and right padding for the type-specific right slot.
**Parts:** `.search-icon` (left, `SearchIcon`, non-interactive) · `.search-input` · `.search-clear`
(right) · `.search-filter` (right chip) · `.search-kbd` (right shortcut). Same focus/error states as inputs.
Structure:
```
<div class="search search-md">
  <SearchIcon class="search-icon" />
  <input class="search-input" placeholder="Search records…" />
  {/* right slot: <CloseIcon class="search-clear"/> | <button class="search-filter">All <ChevronDownIcon/></button> | <kbd class="search-kbd">⌘K</kbd> */}
</div>
```

---

## Exact CSS
The full per-state, per-theme CSS (faithful to this spec, with light blocks under
`[data-theme="light"]`) lives in **`src/styles.css` → "Component library (BRAND.md / COMPONENTS.md)"**.
Keep that implementation and this spec in sync; this document is the design intent of record.
