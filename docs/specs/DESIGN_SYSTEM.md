# GAAhex Design System — Complete Specification
### Transfer Document for Claude Design · Full UI Rebuild & Component Library Generation
**Version**: Batch 28 · 2026-05-27 · Author: Ընգեր (coordinator window)

---

## CRITICAL CONTEXT — Read This First

GAAhex is the only place of work for an entire ISP. Every department, every role, one system.
Multi-tenant. Configuration-driven at its core: entities, fields, statuses, workflows, dashboards
are all defined inside the product via a Studio UI — there is **zero hardcoding** in the product
itself. The UI must express that configurability everywhere.

**Product thesis**: the system renders and behaves entirely from configuration, enforced by
5 fixed kernel engines (WorkItem movement · auth/authz · database · audit/log · security).
A new entity can be stood up with config only — no code changes. The design must make this
obvious and feel powerful.

**Design north star**: dark-first, Cobalt + Gold identity. Professional, trustworthy, and built
for long daily use by ISP operators. Never playful, never casual. Clean and precise.

---

## TABLE OF CONTENTS

1. [Brand Identity & Logo](#1-brand-identity--logo)
2. [Design Tokens — Complete CSS Variable Inventory](#2-design-tokens)
3. [Color Themes](#3-color-themes)
4. [Typography System](#4-typography-system)
5. [Spacing, Sizing & Grid](#5-spacing-sizing--grid)
6. [Border & Radius System](#6-border--radius-system)
7. [Shadow & Elevation](#7-shadow--elevation)
8. [Motion & Animation](#8-motion--animation)
9. [Z-Index Stack](#9-z-index-stack)
10. [Icon Library — All 46 SVGs](#10-icon-library)
11. [Component Library — All CSS Classes](#11-component-library)
12. [Shell Layout & Navigation Architecture](#12-shell-layout--navigation)
13. [Auth & Login Page](#13-auth--login-page)
14. [All Product Pages (22 pages)](#14-all-product-pages)
15. [All Overlay Components](#15-all-overlay-components)
16. [Configuration-Driven Architecture — Design Implications](#16-configuration-driven-architecture)
17. [New Design Requirements (Palette / Backgrounds / Upload / Calendar)](#17-new-design-requirements)
18. [Accessibility Standards](#18-accessibility-standards)
19. [Responsive Design](#19-responsive-design)
20. [ISP Domain Model & Data Flows](#20-isp-domain-model--data-flows)
21. [Horizon & Future Work](#21-horizon--future-work)

---

## 1. Brand Identity & Logo

### Identity Statement
GAAhex = "GAA" (the business initials) + "ex" suffix suggesting excellence/exchange.
Visual personality: structured, disciplined, modern without being trendy.
The product must feel like a serious professional tool — not a SaaS demo.

### Color Rationale
- **Deep Cobalt** (`#1C3B68`): structural authority, the "backbone" — used for navigation,
  headers, structural elements. Cobalt signals trust and precision (aviation, finance, telecom).
- **Matte Gold** (`#C5A059`): the signature accent — used sparingly on KPIs, active states,
  focus rings, call-to-action accents. Gold = value, premium, the thing that matters.
- **Obsidian / Charcoal**: the dark canvas is not black — it has warmth to reduce eye strain
  during 8-hour ISP operator shifts.

### Logo Specifications
- File: `frontend/public/icon-light.png` — white/light variant (used on dark sidebar)
- File: `frontend/public/icon-dark.png` — dark variant (used on light backgrounds / login card)
- The sidebar always shows `icon-light.png` regardless of theme — sidebar is intentionally kept
  dark in both light and dark mode so the logo reads consistently.
- Login card uses `icon-dark.png` (or `icon-light.png` depending on card background).
- `.logo-lg` class: full-width display on login card (`width: 100%; height: auto`)
- `.logo-sm` class: compact display on sidebar header (`height: 88px; width: auto`)
- **Logo color configuration**: The system must allow tenant admins to upload their own logo
  and configure a brand color — this overrides `--brand` and `--primary` tokens for their
  tenant. The logo should be viewable and its colors should be adjustable in Studio > Appearance.

### Wordmark / Brand Text
- Font: `system-ui` (inherits OS font)
- Weight: 700 (bold)
- Size: 18px in sidebar
- Color: `var(--sidebar-strong)` = `#F4F6F9` on the dark sidebar

---

## 2. Design Tokens

All tokens live in `frontend/src/styles.css` as CSS custom properties on `:root`.
The light theme is a `[data-theme="light"]` attribute override on `<html>`.
The sidebar tokens (`--sidebar-*`) are intentionally NOT overridden in light theme — the sidebar
stays dark in both modes so the light logo reads correctly.

### 2.1 Surface Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--bg` | `#0D0F12` (Deep Obsidian) | `#F8F9FA` (Alabaster Canvas) | App root background |
| `--surface` | `#1F242C` (Stealth Charcoal) | `#FFFFFF` (Elevated White) | Cards, table headers, panels |
| `--surface-2` | `#262D37` | `#F1F3F5` | Raised/hover surface, alternating rows |
| `--border` | `#2A313B` | `#E2E8F0` (Platinum Border) | Hairline structural borders |
| `--border-soft` | `rgba(244,246,249,0.08)` | `rgba(17,24,39,0.06)` | Faint row dividers |

### 2.2 Text Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--text` | `#F4F6F9` (Ice White) | `#111827` (Ink Obsidian) | Primary body text |
| `--text-2` | `#AEB7C2` | `#4B5563` | Secondary / supporting text |
| `--text-3` | `#7C8794` | `#6B7280` | Labels, helpers, muted / placeholder |
| `--text-inv` | `#0D0F12` | `#FFFFFF` | Text on solid gold or cobalt fill |

### 2.3 Brand Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--brand` | `#1C3B68` (Deep Cobalt) | `#1C3B68` | Structural brand color (same both) |
| `--primary` | `#3A6FB5` (brightened cobalt) | `#1C3B68` | Buttons, links (brightened on dark) |
| `--primary-hover` | `#4A82CC` | `#16314F` | Button hover |
| `--primary-soft` | `rgba(58,111,181,0.16)` | `rgba(28,59,104,0.10)` | Active nav tint, unread notif bg |
| `--accent` | `#C5A059` (Matte Gold) | `#C5A059` | KPIs, active states, focus, icons |
| `--accent-hover` | `#D4B26C` | `#B68F47` | Gold hover |
| `--accent-soft` | `rgba(197,160,89,0.16)` | `rgba(197,160,89,0.14)` | Gold tint backgrounds |
| `--accent-text` | `#0D0F12` | `#111827` | Text on solid gold fill |

### 2.4 Signal / Functional Tokens

| Token | Dark Value | Light Value | Usage |
|-------|-----------|-------------|-------|
| `--success` | `#2ECC71` | `#10B981` (Forest Mint) | Success states, positive metrics |
| `--success-soft` | `rgba(46,204,113,0.16)` | `rgba(16,185,129,0.12)` | Success background tint |
| `--warning` | `#F5A623` | `#E65F00` (Ochre Flare) | Warning states |
| `--warning-soft` | `rgba(245,166,35,0.16)` | `rgba(230,95,0,0.12)` | Warning tint |
| `--danger` | `#E63946` | `#D90429` (Crimson Anchor) | Errors, destructive actions |
| `--danger-soft` | `rgba(230,57,70,0.16)` | `rgba(217,4,41,0.10)` | Error tint |

### 2.5 Focus Ring

| Token | Dark Value | Light Value |
|-------|-----------|-------------|
| `--focus-ring` | `rgba(197,160,89,0.55)` | `rgba(28,59,104,0.45)` |

Dark mode: gold focus ring (the GAAhex signature).
Light mode: cobalt focus ring (gold washes out on bright canvas).
Rule: `:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }`

### 2.6 Sidebar Tokens (Never Overridden — Always Dark)

| Token | Value | Usage |
|-------|-------|-------|
| `--sidebar-bg` | `#1F242C` | Sidebar background |
| `--sidebar-hover` | `#262D37` | Nav item hover |
| `--sidebar-border` | `#2A313B` | Sidebar right border |
| `--sidebar-text` | `#AEB7C2` | Nav item text (inactive) |
| `--sidebar-strong` | `#F4F6F9` | Active item text, brand name |
| `--sidebar-label` | `#7C8794` | Section label text |
| `--sidebar-on` | `rgba(58,111,181,0.22)` | Active nav item cobalt tint |

---

## 3. Color Themes

### 3.1 Current Themes

**Dark** (default): `color-scheme: dark` on `:root`. Obsidian canvas. Gold focus. Brightened cobalt primary.
**Light**: `[data-theme="light"]` on `<html>`. Alabaster canvas. Cobalt focus. Direct cobalt primary.

Theme is toggled via the sun/moon icon in the header. Stored in `localStorage("theme")`.
The `SunIcon` and `MoonIcon` SVGs are used for the toggle button.

### 3.2 New Requirement — User-Selectable Color Palettes

Beyond dark and light, users should be able to choose custom color palette themes.
Suggested approach: additional `[data-theme="..."]` attribute values with full token overrides.

**Proposed palette options**:
- `dark` — current default (Cobalt + Gold on Obsidian)
- `light` — current light (Cobalt + Gold on Alabaster)
- `midnight` — deeper black (`#060809`), electric blue accent (`#4FADF7`), cyan highlights
- `forest` — dark green canvas (`#0B1610`), emerald primary (`#22C55E`), gold accent kept
- `slate` — neutral slate base (`#111827`), cobalt kept, silver accent (`#94A3B8`)
- `sepia` — warm cream canvas (`#FAF7F0`), dark brown text, gold accent (warm desktop feel)
- `high-contrast` — pure black/white + gold, WCAG AAA contrast ratios

**Implementation model**: Each palette is a full `:root` override (same token names, new values).
Users can select in Settings > Appearance. Stored in `localStorage("color-palette")`.
The sidebar always remains dark regardless of palette (same rule as light/dark switch).

**Color palette picker UI**: 
- Circular swatch buttons (40px diameter) in Settings > Appearance
- Active palette: gold ring border (`2px solid var(--accent)`)
- Hover: scale 1.08, transition 120ms
- Label below each swatch
- Future: allow custom hex input for power users / tenant branding

### 3.3 Custom Backgrounds Per Section (New Requirement)

Users can set custom backgrounds on specific UI sections. This is distinct from theme selection
(which changes the entire color palette) — background customization changes the texture/image
of specific regions while the palette tokens still apply to text and controls.

**Customizable regions**:
1. **Sidebar**: background image or solid color behind nav items
2. **Header bar**: subtle texture or gradient behind the top bar
3. **Main content canvas**: page-level background (subtle texture behind cards)
4. **Modal overlays**: custom backdrop blur intensity

**Background options per region**:
- Solid color (color picker, constrained to accessible dark range)
- Built-in textures: "Dots", "Grid", "Noise", "Carbon", "Linen"
- Custom image upload (PNG/JPG/WebP, max 2MB, stored as tenant asset)
- Gradient presets (diagonal cobalt, gold fade, dark nebula)

**CSS approach**: `--sidebar-bg-image`, `--header-bg-image`, `--content-bg-image` tokens
set to `none` by default, overlaid with `background-image` on the relevant region.
The texture/image is overlaid at low opacity (10–25%) so tokens still control colors.

---

## 4. Typography System

### Font Stack
```
system-ui, -apple-system, "Segoe UI", sans-serif  (body, UI)
ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace  (--font-mono, code/numbers)
```

No external font imports. Monospace is used for: IDs, usage meters, tabular numbers, code fields.

### Type Scale

| Token | Size | Weight Token | Usage |
|-------|------|-------------|-------|
| `--fs-h1` | 28px | `--fw-bold` (700) | Page titles |
| `--fs-h2` | 22px | `--fw-semibold` (600) | Section headers, card titles |
| `--fs-h3` | 17px | `--fw-semibold` (600) | Sub-section headers |
| `--fs-body` | 14px | `--fw-regular` (400) | Default body text |
| `--fs-sm` | 13px | varies | Secondary text, table content, labels |
| `--fs-caption` | 11px | `--fw-medium` (500) | Uppercase labels, timestamps, badges |

### Font Weight Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--fw-regular` | 400 | Body text, secondary content |
| `--fw-medium` | 500 | Buttons, nav items, pills |
| `--fw-semibold` | 600 | Card titles, column headers, emphasis |
| `--fw-bold` | 700 | Page h1, KPI numbers, brand name |

### Line Height Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--lh-tight` | 1.2 | Headings (h1, h2, h3) |
| `--lh-base` | 1.5 | Default body, table cells |
| `--lh-relaxed` | 1.65 | Long-form text, comments, descriptions |

### Typographic Conventions
- Table column headers: 11px uppercase, 0.06em letter-spacing, `--text-3` color
- Section labels in sidebar: 11px uppercase, 0.08em letter-spacing, `--sidebar-label` color
- KPI numbers: 38px, `--fw-bold` (700), `--accent` (gold) color, `--font-mono`
- Timestamps / IDs: `--font-mono`, `--fs-caption`
- Error messages: `--danger` color, 13px
- Hint/help text: `--text-3` color, 12px

---

## 5. Spacing, Sizing & Grid

### Core Spacing Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--gap` | 12px | Default flex/grid gap in forms, toolbars |
| `--pad` | 16px | Default panel padding |
| `--row-pad-y` | 10px (compact: 5px) | Table row vertical padding |
| `--row-pad-x` | 12px (compact: 8px) | Table row horizontal padding |
| `--control-pad-y` | 8px (compact: 5px) | Form control vertical padding |

### Density Axis
`[data-density="compact"]` tightens row and control padding.
Default density = "comfortable" (no attribute).
Toggle in Settings > Preferences > Display density.

### Layout Grid
```
.shell: grid-template-columns: 220px 1fr
        min-height: 100vh

.content: display: flex; flex-direction: column (header + main stacked)
.content main: padding: 20px 24px

.widgets: grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px
.rec-form: grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px
.messages: grid-template-columns: 260px 1fr
.bar-row: grid-template-columns: 90px 1fr 52px
```

### Control Heights (Component Sizes)

| Size | Height | Font | Padding | Radius |
|------|--------|------|---------|--------|
| sm | 28px | 12px | 0 10px | 6px |
| md | 36px | 13px | 0 14px | 8px |
| lg | 44px | 14px | 0 18px | 10px |

---

## 6. Border & Radius System

### Radius Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` / `--r-sm` | 5px / 6px | Small UI elements, tags |
| `--radius` / `--r-md` | 7px / 8px | Default controls, input fields |
| `--radius-lg` / `--r-lg` | 10px | Cards, panels, modals |
| `--r-xl` | 12px | Large panels, command palette |
| `--pill` / `--r-pill` | 999px | Pill badges, tab chips, search chips |

Note: Two parallel sets exist (`--radius-*` legacy, `--r-*` component lib). Both are in active use.

### Border Width Tokens

| Token | Value |
|-------|-------|
| `--bw-1` | 1px |
| `--bw-2` | 2px |

### Border Usage Patterns
- Structural borders (cards, panels, tables): `1px solid var(--border)`
- Faint row dividers: `1px solid var(--border-soft)`
- Active nav item left edge: `box-shadow: inset 2px 0 0 var(--accent)` (gold bar, 2px)
- Modal/toast left accent: `border-left: 3px solid <signal-color>`
- Input focus: `border-color: var(--accent)` + gold glow shadow
- Error inputs: `border-color: var(--danger)` + red glow shadow

---

## 7. Shadow & Elevation

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow` | dark: `0 1px 3px rgba(0,0,0,.35)` / light: `0 1px 3px rgba(17,24,39,.08)` | Default card elevation |
| `--shadow-card` | dark: `0 8px 28px rgba(0,0,0,.5)` / light: `0 6px 24px rgba(17,24,39,.10)` | Raised cards, modals |
| `--shadow-pop` | dark: `0 12px 34px rgba(0,0,0,.6)` / light: `0 12px 34px rgba(17,24,39,.16)` | Popovers, dropdowns, toasts |

Elevation hierarchy: flat content → `.shadow` (cards) → `.shadow-card` (modals) → `.shadow-pop` (dropdowns/tooltips)

---

## 8. Motion & Animation

### Duration Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--dur-instant` | 0ms | No animation |
| `--dur-fast` | 120ms | Hover states, button transitions, input border changes |
| `--dur-base` | 200ms | Overlay/modal enter, panel transitions |
| `--dur-slow` | 320ms | Page transitions, complex reveals |

### Easing Tokens

| Token | Curve | Usage |
|-------|-------|-------|
| `--ease-standard` | `cubic-bezier(.2, 0, 0, 1)` | Default (most transitions) |
| `--ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Elements entering (overlay fade-in, modal rise) |
| `--ease-accelerate` | `cubic-bezier(.3, 0, 1, 1)` | Elements leaving |

### Keyframe Animations

```
@keyframes overlay-fade  { from { opacity: 0 } to { opacity: 1 } }
@keyframes overlay-rise  { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes toast-in      { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes spin-icon     { to { transform: rotate(360deg) } }   /* on .spin-icon class */
@keyframes skeleton-shimmer (implicit via linear-gradient animation on skeleton rows)
```

### SpinnerIcon
The `SpinnerIcon` component adds `.spin-icon` class which triggers CSS `animation: spin-icon 0.75s linear infinite`.
Used on loading states, form submission buttons.

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```
All animations are nullified. No motion-only information conveyance.

---

## 9. Z-Index Stack

| Token | Value | Layer |
|-------|-------|-------|
| `--z-base` | 0 | Normal document flow |
| `--z-dropdown` | 1000 | Notification popover, search dropdowns |
| `--z-sticky` | 1100 | Sticky headers (reserved) |
| `--z-modal` | 1300 | Modal backdrop + panel |
| `--z-toast` | 1400 | Toast region, emoji picker (must exceed modal) |

The emoji picker sits at `--z-toast` level so it renders above modals when used inside CommentsModal.

---

## 10. Icon Library

All icons are inline SVG via `frontend/src/icons.tsx`.
Zero emoji in the product UI — every icon is an SVG.
All icons use: `stroke="currentColor"`, `fill="none"`, `strokeWidth={2}`,
`strokeLinecap="round"`, `strokeLinejoin="round"`, `viewBox="0 0 24 24"`.
Default size: 18px. Configurable via `size` prop.
Color: always inherits `currentColor` — icons theme automatically.
`aria-hidden="true"` and `focusable="false"` on all icons.

### Complete Icon Inventory

| Export Name | Visual Description | Primary Usage |
|-------------|-------------------|---------------|
| `BellIcon` | Bell silhouette + clapper dot | Notifications trigger button |
| `SunIcon` | Circle with 8 radial lines | Theme toggle (light mode active) |
| `MoonIcon` | Crescent moon path | Theme toggle (dark mode active) |
| `GearIcon` | Cogwheel with center circle | Settings, Studio, config menus |
| `WarningIcon` | Triangle with exclamation | Warning toasts, alert states |
| `CheckIcon` | Checkmark polyline | Success states, completed items |
| `CloseIcon` | X (two diagonal lines) | Dismiss modals, clear inputs, close tags |
| `ArrowRightIcon` | Horizontal arrow with arrowhead | Navigation, row actions, links |
| `SearchIcon` | Magnifying glass | Search inputs, command palette trigger |
| `ChevronDownIcon` | V-shape pointing down | Dropdown indicators, accordions |
| `ChevronLeftIcon` | < shape | Sidebar collapse, back navigation |
| `ChevronRightIcon` | > shape | Expand, breadcrumb separator |
| `MenuIcon` | Three horizontal lines (hamburger) | Mobile menu toggle |
| `PhoneIcon` | Telephone handset | Phone interaction type, phone fields |
| `MailIcon` | Envelope with V fold | Email outbound, compose, email fields |
| `PrinterIcon` | Printer with paper tray | Print invoice, export to PDF |
| `ChartIcon` | Bar chart (3 ascending bars) | Analytics, reports, dashboard widgets |
| `SparkleIcon` | Two-star sparkle | AI / Ask GAAhex feature |
| `ArrowUpIcon` | Upward arrow | Sort ascending, positive trend |
| `ArrowDownIcon` | Downward arrow | Sort descending, negative trend |
| `UsersIcon` | Two person silhouettes | Team, users list, accounts |
| `BuildingIcon` | Office building | Tenants, organizations, companies |
| `InfoIcon` | Circle with 'i' | Informational tooltips, help |
| `RowsIcon` | Three horizontal rectangles | Table/rows view toggle |
| `MessageIcon` | Chat bubble | Internal messages, conversations |
| `SmileIcon` | Smiley face circle | Emoji picker trigger |
| `PlusIcon` | Plus cross (+) | Create/add actions, "New" buttons |
| `EditIcon` | Pencil over square | Edit/update record actions |
| `TrashIcon` | Trash can | Delete/remove actions |
| `ClockIcon` | Clock face | Timestamps, activity timeline, schedules |
| `LockIcon` | Padlock | Auth, permissions, locked fields |
| `InboxIcon` | Inbox tray with items | Inbox view, messages landing |
| `ReceiptIcon` | Zigzag receipt paper | Invoices, billing records |
| `CreditCardIcon` | Payment card with stripe | Payments, billing methods |
| `SpinnerIcon` | Quarter-arc rotating | Loading state (CSS spin animation) |
| `ServerIcon` | Two server rack rectangles | Infrastructure, network, resource pools |
| `CalendarIcon` | Calendar grid with header bar | Date pickers, calendar views, schedules |
| `DownloadIcon` | Down arrow into tray | Export, download file |
| `PauseIcon` | Two vertical bars | Pause workflow, suspended state |
| `PlayIcon` | Right-pointing triangle | Resume, start workflow |
| `SnoozeIcon` | Clock with z | Snoozed notifications, deferred items |
| `ArchiveIcon` | Box with lid | Archive records, soft delete |
| `MuteIcon` | Bell with X strike-through | Mute notification channel |
| `BookmarkIcon` | Ribbon bookmark | Save/pin items |
| `PinIcon` | Pushpin | Pinned search results, pinned items |

### Icon Size Guidelines
- Navigation icons: 16px (inside `.nav` items)
- Button icons: 14–16px (inside `.btn-sm` or `.btn-md`)
- Header utility icons: 18px (BellIcon, SunIcon, GearIcon in header)
- Empty state icons: 40–48px, `color: var(--text-3)`
- KPI / widget accent icons: 24px, `color: var(--accent)`

---

## 11. Component Library

### 11.1 Buttons

**Base class**: `.btn`
Inline-flex, centered, gap 6px (icon + label), medium font weight, 1px transparent border,
transitions: background + border-color + box-shadow at `var(--dur-fast)`.

**Size variants**:
```
.btn-sm  { height: 28px; font-size: 12px; padding: 0 10px; border-radius: 6px }
.btn-md  { height: 36px; font-size: 13px; padding: 0 14px; border-radius: 8px }
.btn-lg  { height: 44px; font-size: 14px; padding: 0 18px; border-radius: 10px }
```

**Color variants** (dark mode values):

| Class | Background | Text | Hover | Disabled |
|-------|-----------|------|-------|---------|
| `.btn-primary` | `#1C3B68` | `#F4F6F9` | `#244879` | bg `#1F242C`, text 30% opacity |
| `.btn-accent` | `#C5A059` | `#0D0F12` | `#D2AE6A` | bg `#3A3527`, text 40% opacity |
| `.btn-ghost` | transparent | `#F4F6F9` | bg 6% white | opacity 25% |
| `.btn-danger` | `#E63946` | `#FFFFFF` | `#EF4D58` | bg `#3D1B1F`, text 40% opacity |

Focus ring on all: `box-shadow: 0 0 0 3px var(--focus-ring)` (gold in dark, cobalt in light).
All buttons: `cursor: not-allowed` when disabled.

**Usage patterns**:
- Primary CTAs: `.btn.btn-primary.btn-md` (most common in view headers)
- Compact header actions: `.btn.btn-primary.btn-sm`
- Destructive: `.btn.btn-danger.btn-md` (in confirm modals)
- Secondary / outline: `.btn.btn-ghost.btn-md`
- Gold CTA (billing, upgrade): `.btn.btn-accent.btn-md`
- Icon-only buttons: `.iconbtn` (transparent, no label, 6px padding all sides)

### 11.2 Text Inputs

**Base class**: `.inp`
Width 100%, box-sizing border-box, no outline (custom focus ring), transitions: border-color + box-shadow.

**Size variants**:
```
.inp-sm  { height: 28px; font-size: 12px; padding: 0 10px; border-radius: 6px }
.inp-md  { height: 36px; font-size: 13px; padding: 0 12px; border-radius: 8px }
.inp-lg  { height: 44px; font-size: 14px; padding: 0 14px; border-radius: 10px }
```

**Modifier classes**:
- `.inp-numeric`: right-aligned, tabular numerals
- `.inp-area`: textarea; auto height, vertical resize, 10px 12px padding
- `.inp-area.inp-sm / .inp-lg`: adjusted padding

**States** (dark mode):
```
default:  bg #1F242C, border rgba(F4F6F9, 10%)
hover:    bg #242A33, border rgba(C5A059, 40%)   — gold border on hover
focus:    bg #242A33, border #C5A059, shadow 0 0 0 3px rgba(C5A059, 18%)
error:    border #E63946, shadow 0 0 0 3px rgba(E63946, 18%)
disabled: bg #15191F, text 30% opacity, not-allowed cursor
```

**Helper text classes**:
- `.inp-help`: 11px, `rgba(F4F6F9, 45%)` — shown below field
- `.inp-err`: 11px, `#E63946` with inline WarningIcon — shown below field on error

### 11.3 Search

**Wrapper**: `.search.search-{sm|md|lg}` (position: relative)
**Input**: `.search-input` (full width with left padding for icon, right padding for clear/kbd)

Size variants:
```
.search-sm .search-input { height: 28px; padding: 0 32px 0 30px; border-radius: 6px }
.search-md .search-input { height: 36px; padding: 0 38px 0 38px; border-radius: 8px }
.search-lg .search-input { height: 44px; padding: 0 46px 0 44px; border-radius: 10px }
```

**Positioned elements** (absolute inside wrapper):
- `.search-icon`: left side, `SearchIcon` (16px), `color: rgba(F4F6F9, 50%)`
- `.search-clear`: right side, `CloseIcon` (12px), appears when query non-empty
- `.search-filter`: right side, gold filter button (used in reports/entity list)
- `.search-kbd`: right side, "⌘K" kbd hint (used in command palette trigger)

**States same as `.inp`**: gold border on hover/focus, red on error.

### 11.4 Pills & Badges

```
.pill   { display: inline-block; font-size: 11px; background: var(--primary-soft); 
          color: var(--primary-hover); padding: 2px 9px; border-radius: var(--pill); 
          font-weight: 600; }

.badge  { display: inline-block; font-size: 11px; background: var(--surface-2); 
          color: var(--text-2); padding: 2px 8px; border-radius: var(--pill); }
```

Pills are used for status tags, entity type labels, workflow stage badges.
Status colors: override `.pill` background with signal colors using inline style or a `data-status` approach.

### 11.5 Data Tables

**Container**: `.grid` (width 100%, border-collapse collapse, surface bg, border, radius, overflow hidden, `--shadow`)

```
.grid th  { 11px uppercase, 0.06em tracking, --text-3, border-bottom, --surface-2 bg }
.grid td  { --row-pad-y/x padding, border-bottom --border-soft, --text }
.grid tr:last-child td { no border-bottom }
```

Row actions: `.row-actions { white-space: nowrap; display: flex; gap: 6px }`

Studio tables use compact variant: `.studio .grid td { padding: 5px 6px; vertical-align: middle }`

### 11.6 Record Form

```
.rec-form { background: --surface; border: 1px solid --border; border-radius: --radius; 
            padding: --pad; margin-bottom: --pad;
            display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); 
            gap: --gap; align-items: end; box-shadow: --shadow; }

.field    { display: flex; flex-direction: column; gap: 5px; font-size: 13px; }
.field span { color: --text-3; }  /* field label */

.rec-form-actions { display: flex; align-items: center; grid-column: 1 / -1; }
```

### 11.7 Navigation Components

**Shell**:
```
.shell   { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.sidebar { --sidebar-bg bg; padding: 14px 12px; flex column; gap: 4px; border-right 1px --sidebar-border }
.content { flex column }
.content header { flex, align-center, gap 14px, padding 12px 20px, --surface bg, border-bottom }
.content main { padding: 20px 24px }
```

**Nav items**:
```
.nav       { background: transparent; color: --sidebar-text; text-align: left; padding: 8px 10px; border-radius: --radius }
.nav:hover { background: --sidebar-hover; color: --sidebar-strong }
.nav.on    { background: --sidebar-on; color: --sidebar-strong; box-shadow: inset 2px 0 0 var(--accent) }
```

Active state: cobalt tint background + **2px inset gold bar** on left edge.

**Section label**:
```
.nav-label { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; 
             color: --sidebar-label; padding: 12px 8px 4px; }
```

**Tabs** (within views):
```
.tabs  { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.tab   { --surface bg; --text color; 1px --border; --pill border-radius; 7px 16px padding; 13px }
.tab.on { --primary bg; --text color; border-color --primary }
```

**View header**:
```
.view-head   { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
.view-head h2 { margin: 0 }
.view-head button { margin-left: auto }  /* pushes CTA to far right */
```

### 11.8 Notification Badge

```
.notif-badge { position: absolute; top: -2px; right: -4px; 
               min-width: 17px; height: 17px; padding: 0 4px;
               background: var(--danger); color: #fff; font-size: 10px; 
               font-weight: 700; line-height: 17px; border-radius: var(--pill); }
```

### 11.9 List Toolbar

```
.list-toolbar  { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap }
.list-toolbar .search { flex: 1 1 240px; max-width: 380px }
.saved-views   { display: flex; align-items: center; gap: 8px; margin-left: auto }
```

### 11.10 Dashboard Widgets

**Grid**: `repeat(auto-fill, minmax(280px, 1fr)); gap: 16px`

```
.widget       { --surface bg; 1px --border; --radius-lg; --pad padding; --shadow }
.widget-label { 11px uppercase, 0.06em tracking, --text-3, margin-bottom 12px }
.kpi          { font-size: 38px; font-weight: 700; line-height: 1; color: var(--accent) }
```

**Widget types**:
- **KPI**: large gold number (`38px`, `--accent`, `--fw-bold`) + `.widget-label` above
- **Bar chart**: `.bars` column flex, `.bar-row` 3-col grid (90px label | flex track | 52px value)
  - `.bar-track`: `--surface-2` bg, `--pill` radius, 10px height
  - `.bar-fill`: `--primary` bg fill, width = percentage inline style
- **Donut chart**: SVG circle path, 120×120, total in center (`16px`, bold, `fill: var(--text)`)
  - `.donut-wrap`: flex, gap 16px (donut + legend side by side)
  - `.legend-row`: color dot (10px, radius 3px) + name + value
- **Timeline / Activity**: chronological list of events with icons

### 11.11 Activity Timeline

Vertical list. Each item:
- Left: icon or colored dot in `--accent` or signal color
- Right: event description (13px) + timestamp (11px, `--text-3`)
- Connector: 1px left border on the container, offset with padding

### 11.12 System Status Chip

Small inline component for status indicators:
```
{ background: <signal-soft>; color: <signal>; padding: 2px 8px; border-radius: --pill;
  font-size: 11px; font-weight: 600; }
```
Used in pipeline cards, customer status, invoice state, subscription status.

---

## 12. Shell Layout & Navigation

### Overall Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ 220px sidebar │ flex: 1 content area                           │
│               │ ┌─────────────────────────────────────────────┐ │
│               │ │ header (48px, --surface, border-bottom)     │ │
│               │ ├─────────────────────────────────────────────┤ │
│               │ │ <main> padding 20px 24px                    │ │
│               │ │                                             │ │
│               │ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Header Contents (left to right)
1. Collapse/expand sidebar button (ChevronLeftIcon, `iconbtn`)
2. Breadcrumb / page title (if applicable)
3. **Command Palette trigger** (`⌘K` keyboard shortcut chip)
4. RIGHT SIDE (`.header-right`, margin-left auto):
   - Theme toggle (`SunIcon` / `MoonIcon`, `iconbtn`)
   - `NotificationCenter` (`BellIcon` + danger badge)
   - User avatar / name (click → dropdown with profile + logout)

### Sidebar Structure

```
[Brand logo: icon-light.png .logo-sm 88px height]
[Brand name text, 700 weight]

SECTION LABEL: CORE
  Dashboard        (ChartIcon)
  Customers        (UsersIcon)
  Leads            (ArrowRightIcon)
  Services         (ServerIcon)
  Subscriptions    (ReceiptIcon)

SECTION LABEL: BILLING
  Invoices         (ReceiptIcon)
  Payments         (CreditCardIcon)
  Products         (BuildingIcon)
  Usage            (ChartIcon)

SECTION LABEL: COMMS
  Messages         (MessageIcon)
  Outbound         (MailIcon)

SECTION LABEL: WORK
  WorkItems        (RowsIcon)
  Interactions     (PhoneIcon)
  Resource Pools   (ServerIcon)

SECTION LABEL: INSIGHTS
  Analytics        (ChartIcon)
  Reports          (DownloadIcon)

SECTION LABEL: PLATFORM
  Studio           (GearIcon)
  Settings         (GearIcon)
  Webhooks         (ArrowRightIcon)
  Parties          (UsersIcon)

SECTION LABEL: AI
  Ask GAAhex        (SparkleIcon)
```

Active nav item: `.nav.on` = cobalt tint bg + 2px inset gold left bar.
Section labels: 11px uppercase, `--sidebar-label`, not interactive.

### Navigation Interaction Patterns
- Single-click to navigate, no double-click required
- Route change closes any open overlay (modal, palette, notification pop)
- Active route persists until navigation changes it
- Browser back/forward supported (React Router)

### Auth Flow (Pre-Login)
```
/ (root) → if no token → /login → authenticate → /
           if has token but no tenant → /create-tenant (wizard)
           if has token + tenant → /dashboard (default)
```

---

## 13. Auth & Login Page

### Login Page Layout
`.center { min-height: 100vh; display: grid; place-items: center }` — perfect vertical/horizontal center.

```
┌─────────────────────────────────┐
│                                 │
│      [GAAhex logo, full width]   │
│                                 │
│      GAAhex                      │  (h1, 24px)
│                                 │
│  [Email/username input .inp-md] │
│  [Password input .inp-md]       │
│                                 │
│  [Sign in   .btn.btn-primary    │
│              .btn-lg  w-full]   │
│                                 │
│  error message (if any)         │
│                                 │
└─────────────────────────────────┘
```

**Card**: `.card { width: 420px; background: --surface; padding: 28px; border-radius: --radius-lg; box-shadow: --shadow-card; border: 1px solid --border; display: flex; flex-direction: column; gap: 10px }`

Logo: `.logo-lg { width: 100%; height: auto; margin: 6px 0 10px }` (full-width on card)

**New Requirement — Login Page Customization**:
- Tenant branding: admin can upload a background image for the login page (the `.center` area behind the card)
- The card itself retains the design system styling
- Tenant logo replaces the default GAAhex logo on the card (via `tenant.logo_url`)
- Tenant name shown below logo if different from "GAAhex"
- Option for the login page background: solid color (default `--bg`), gradient, or uploaded image

### Create Tenant Wizard (3-step)
Shown after first login when no tenant exists.
Steps rendered inline in a wide card or full-page centered layout:

**Step 1 — Company Info**:
- Organization name (required) `.inp.inp-md`
- Slug/subdomain preview (auto-derived, editable) `.inp.inp-md`
- Industry dropdown `.inp.inp-md select`

**Step 2 — Admin User**:
- Full name `.inp.inp-md`
- Email `.inp.inp-md`
- Password `.inp.inp-md` (type=password)
- Confirm password `.inp.inp-md`

**Step 3 — Appearance**:
- Logo upload (drag & drop or file picker)
- Brand color picker
- Theme preference (dark/light/auto)

Progress indicator: numbered steps at top, current step highlighted in `--accent`.
Navigation: "Back" (`.btn.btn-ghost`) + "Next" / "Create" (`.btn.btn-primary`) in footer.

---

## 14. All Product Pages

### 14.1 Dashboard

**Route**: `/dashboard`
**Component**: `DashboardView.tsx`

**Layout**:
1. Tab bar (`.tabs`) — one tab per configured dashboard (e.g., "Operations", "Billing", "Support")
2. Widget grid (`.widgets`) — auto-fill, minmax(280px, 1fr)

**Widget types in use**:
- **KPI** (single metric): `38px gold number` + label. Examples: "Active Customers", "MRR (֏)", "Open Invoices"
- **Bar chart**: lead stage distribution, revenue by plan
- **Donut chart**: customer status breakdown (active/suspended/churned)
- **Timeline**: recent activity feed (last 10 events across all modules)

**Configuration-driven**: dashboard tabs and widget sets are defined in Studio > Dashboards.
Operators can add/remove/reorder widgets and create new dashboard tabs without code changes.
Widget data sources are configured per-widget (entity type + aggregation + time window).

**Empty state**: `EmptyState` component (centered icon + text + optional CTA).

### 14.2 Entity View (Generic — used for most list pages)

**Component**: `EntityView.tsx`
**Routes**: driven by entity config in Studio

**Layout**:
```
[View header: entity title + "+ Create" btn .btn.btn-primary.btn-sm]
[List toolbar: .search-md | saved views dropdown | filter chips]
[Record form (conditional — when creating or editing inline)]
[.grid table: configured columns | row actions (Edit, Delete)]
```

**Columns**: defined per entity type in Studio. Each column has a display name, field key, and render type (text / pill / date / link / number).

**Inline edit**: clicking Edit opens the record form above the table (same page, no modal).
Full create/edit modal option available via config.

**Saved views**: stored search + filter + column combinations. Dropdown in toolbar.
"Save current view" button opens a small name input inline.

**Workflow integration**: if the entity has workflow stages, a stage pill column is shown.
Clicking the pill opens a dropdown to move the record to the next stage.

### 14.3 Customer View (360-Degree Record)

**Route**: `/customers/:id`
**Component**: `CustomerView.tsx`

**Layout** (single-page scroll, sections stacked):
```
[Customer header: name, status pill, action buttons (Edit, Archive, Log Interaction)]
[Basic info section: plan, account manager, created date, contact]
[Related records: linked services, subscriptions (clickable links)]
[Interactions section (embedded InteractionsView, filtered by this customer)]
[Activity timeline (all system events for this customer)]
[Billing section: invoice list + balance summary]
[Comments section: threaded comments with composer]
```

**Interactions section** (E28 addition):
- Heading: "Interactions"
- Reuses `InteractionsView` with `customerId` prop + `embedded={true}` mode
- Filters: `record_id=<customerId>`, `entity_key="customer"`
- Shows: type (call/visit/note), date, summary, logged-by user
- "Log Interaction" button opens create form/modal

### 14.4 Lead Pipeline (Kanban)

**Route**: `/leads`
**Component**: `LeadPipelineView.tsx`

**Layout**: horizontal Kanban board — one column per workflow stage.

```
[Stage 1] [Stage 2] [Stage 3] ... [Stage N]
  card       card      card
  card       card
  card
```

**Stage column**:
- Header: stage name + card count badge
- Background: `--surface`
- Cards scroll vertically

**Lead card**:
- Company/contact name (semibold)
- Value (gold, `--font-mono`)
- Status pill
- Assigned user avatar/initials
- Age badge (days in stage)

**Interactions**: drag card from one column to another = workflow stage transition.
Drag: native HTML5 drag or library (react-beautiful-dnd). Visual feedback: column highlights on drag-over.

**Quick create**: "+ Lead" button at top opens a minimal create form (not full modal).

**Configured by**: Studio > Entities > Leads > Workflow Stages. Stage names, colors, and rules are configurable.

### 14.5 Accounts View

**Route**: `/accounts`
**Component**: `AccountsView.tsx`

Standard EntityView pattern but for the accounts/users management page.
Lists system users: name, email, role, tenant, active status.
Admin actions: activate/deactivate, reset password, change role.
Role pills: `--primary-soft` background.

### 14.6 Analytics View

**Route**: `/analytics`
**Component**: `AnalyticsView.tsx`

**Layout**:
```
[Time range picker: Last 7 / 30 / 90 / 365 days | custom date range]
[Metrics grid (same .widgets as dashboard)]
[Trend charts: SVG or canvas line charts over time]
[Table breakdown: top customers by revenue, etc.]
```

All charts drawn with SVG or an approved library.
No chart library is hardcoded — the data layer is the same widget config system as Dashboard.

### 14.7 Interactions View

**Route**: `/interactions`
**Component**: `InteractionsView.tsx`

**Modes**:
1. **Full page** (`/interactions`): shows all interactions across all customers, filterable
2. **Embedded** (inside CustomerView, `embedded={true}` prop): filtered to one customer

**Columns**: type (pill), customer link, date, summary, logged by.
**Type pills**: Call (phone icon + label), Visit (calendar icon + label), Note (generic), Email (mail icon + label).
**Create form**: type dropdown, customer picker (RefPicker), date, notes textarea.

### 14.8 Reports

**Route**: `/reports`
**Component**: `ReportsView.tsx` (or similar)

**Layout**:
```
[Header: "Reports" + "+ New Report" btn]
[Saved reports list: name, schedule indicator, last run, actions]
[Results panel (when a report is selected/run): table or chart output]
```

**Report types**: tabular (`.grid`), bar chart, donut, KPI summary.
**Scheduled reports**: clock icon indicator, next run time.
**Export**: DownloadIcon button → CSV or PDF.
**Print**: PrinterIcon button → `window.print()` or PDF export.

### 14.9 Report Builder

**Route**: `/reports/new` or modal
**Component**: `ReportBuilder.tsx`

**Layout** (3-column or stepped):
```
[1. Data source selector: entity type dropdown]
[2. Field picker: multi-select of available fields/columns]
[3. Filter builder: GXL filter expression editor]
[4. Grouping / aggregation: group by field + aggregate function]
[5. Chart type selector: table | bar | donut | KPI]
[Preview panel: live preview of first N rows]
[Save / Run buttons]
```

**GXL filter editor**: inline expression builder with field + operator + value rows.
"Add condition" button, AND/OR logic toggle.
Conditions render as chips that can be removed.

**Schedule panel** (`ReportSchedulePanel`): frequency (daily/weekly/monthly), time, recipients.

### 14.10 Studio

**Route**: `/studio`
**Component**: `StudioView.tsx`

**The Configuration Engine UI** — where everything about the product is defined.

**Layout**: sidebar sub-navigation within studio + main content panel.

**Studio sections**:
1. **Entities**: define custom entity types (name, slug, icon, fields list)
2. **Fields**: per-entity field builder (name, type: text/number/date/select/ref/bool, required, default)
3. **Statuses / Workflows**: stage name, color, allowed transitions, entry/exit rules
4. **Dashboards**: dashboard tab builder, widget placement, widget config
5. **Views**: configure list columns, default sort, filter presets per entity
6. **Reports**: saved report definitions
7. **Automations** (Workflow engine): trigger → condition → action rules
8. **Appearance**: tenant logo, brand color, theme default, custom backgrounds
9. **Roles & Permissions**: OrgNode-based permission matrix

**Entity editor UI**:
```
[Entity name input] [slug (auto)] [icon picker]
[Field list table: .grid in studio compact mode]
  | Field name | Type | Required | Default | Actions |
[+ Add Field button]
```

**Field type picker**: dropdown with icons for each type.
**Icon picker** (for entities): emoji picker + SVG upload + built-in icon library.

**Important**: Studio changes apply immediately without restart. The system re-renders from the
updated configuration on next page load (or live-reload via WebSocket if implemented).

### 14.11 Settings

**Route**: `/settings`
**Component**: `SettingsView.tsx`

**Sections** (tab or sidebar sub-nav):
- **Account**: name, email, avatar upload, password change
- **Appearance**: theme (dark/light/palette), density (comfortable/compact), custom backgrounds
- **Notifications**: per-channel notification preferences, email/in-app toggles
- **API Keys**: generate/revoke API keys for integrations
- **Webhooks**: (also at `/webhooks`) configure outbound webhook endpoints
- **Security**: session list, 2FA setup

### 14.12 Messages

**Route**: `/messages`
**Component**: `MessagesView.tsx`

**Layout**: two-pane (`.messages { grid-template-columns: 260px 1fr }`)
```
LEFT (thread list):               RIGHT (thread detail):
┌────────────────────────┐        ┌────────────────────────────────┐
│ [thread item .on]      │        │ [msg-scroll: conversation]     │
│  thread title (semibold)│       │   [.msg][.msg][.msg]           │
│  preview text (caption) │       │ ├──────────────────────────────┤
│ [thread item]          │        │ [.msg-compose: Composer + Send]│
│ [thread item]          │        └────────────────────────────────┘
└────────────────────────┘
```

Message bubble: `.msg-bubble { --surface-2; --r-md; 8px 11px; 13px; pre-wrap }`
Own messages: aligned right (`.msg` with `margin-left: auto`)
Thread active: `.thread-item.on { --primary-soft bg }`

### 14.13 Outbound Messaging

**Route**: `/outbound`
**Component**: `OutboundView.tsx`

**Layout**:
```
[Header: "Outbound Messages" + "New Message" btn (PlusIcon + .btn.btn-primary.btn-sm)]
[Filters: channel select, status select, date range]
[Delivery log table: to | channel | subject | status pill | sent_at | actions]
[ComposeModal (conditional, when "New Message" pressed)]
```

**ComposeModal fields**:
- Channel: `<select>` (email / sms) → drives conditional fields
- To: `<input type="text">` (email or phone)
- Subject: `<input type="text">` — shown only when channel === "email"
- Body: `<textarea rows={4}>`
- Send button (MailIcon + "Send"): disabled while sending, shows SpinnerIcon when loading
- Cancel button: closes modal
- Inline error below body field (not toast — keeps modal open for correction)

**On success**: modal closes, toast "Message sent (LOG|SENT)", table refreshes.

**Channel adapters** (backend, not UI — for documentation):
- Dev: `LogEmailAdapter` / `LogSmsAdapter` — writes to stdout, status = "LOG"
- Prod: SMTP (email) / real SMS gateway — status = "SENT"

### 14.14 Ask GAAhex (AI Assistant)

**Route**: `/ask` or sidebar
**Component**: `AskGaaexView.tsx`

**Layout**:
```
[SparkleIcon header + "Ask GAAhex" title]
[Conversation history: scrollable flex column]
  [.msg-bubble user queries (right-aligned)]
  [.msg-bubble AI responses (left, with SparkleIcon)]
[Input area: text input + Send button]
[Suggestion chips: "What's our MRR?", "Show overdue invoices", etc.]
```

**AI engine**: Google Gemini Flash (gemini-flash-latest) via backend proxy.
Free tier / usage-lean. API key in `.env` as `GEMINI_API_KEY`.
The model has access to the tenant's data context via backend tool calls.

**AiAssistModal**: compact version of Ask GAAhex that can be opened in-context from any view
(e.g., "Explain this invoice" button opens a small modal with pre-filled context).

### 14.15 Invoices

**Route**: `/invoices`
**Component**: `InvoicesView.tsx`

Standard entity list + detail. 
**List columns**: invoice #, customer, amount (֏, tabular-nums), status pill, due date, actions.
**Status pills**: Draft (ghost), Sent (primary), Paid (success), Overdue (danger), Void (muted).
**Detail view**: CustomerBillingModal or inline expansion showing line items.
**Actions**: Print (PrinterIcon), Download PDF (DownloadIcon), Send (MailIcon), Void (danger).

**Currency**: AMD (֏) by default — production defaults, not demo.
Numbers: always `--font-mono`, tabular-nums.

### 14.16 Services

**Route**: `/services`
**Component**: `ServicesView.tsx`

EntityView for service definitions (e.g., "100 Mbps Fiber", "Business 500").
Columns: name, category, monthly price, status, subscriber count.
Used as the product catalog source for subscriptions.

### 14.17 Products

**Route**: `/products`
**Component**: `ProductsView.tsx`

EntityView for product catalog. Similar to Services but more generic.
Used by billing to link line items.

### 14.18 Subscriptions

**Route**: `/subscriptions`
**Component**: `SubscriptionsView.tsx`

Links customer to service. 
**Columns**: customer, service, plan, start date, status, MRR.
**Status**: Active (success), Suspended (warning), Cancelled (danger).
**Actions**: Suspend, Resume (PlayIcon/PauseIcon), Cancel, Renew.

### 14.19 Usage

**Route**: `/usage`
**Component**: `UsageView.tsx`

Shows usage records (bandwidth, sessions, etc.) linked to subscriptions.
**Columns**: customer, period, upload, download, total (tabular-nums, monospace).
**Aggregate bar**: shows usage vs. plan limit as a bar track.

### 14.20 Resource Pools

**Route**: `/resource-pools`
**Component**: `ResourcePoolsView.tsx`

Manages IP pools, equipment pools, etc.
**Columns**: pool name, type, total, used, free, status.
**Visual capacity bar**: `.bar-track` with `.bar-fill` colored by utilization
(green under 70%, yellow 70–90%, red above 90%).

### 14.21 Webhooks

**Route**: `/webhooks`
**Component**: `WebhooksView.tsx`

Outbound webhook endpoint management.
**Columns**: URL, events subscribed, status (active/paused), last delivery, actions.
**Events**: multiselect checkboxes for event types (entity.created, entity.updated, etc.)
**Test button**: sends a test ping, shows delivery result inline.

### 14.22 Parties (Organizations/People)

**Route**: `/parties`
**Component**: `PartiesView.tsx`

The generic contacts/organizations entity (suppliers, partners, third parties not tracked as customers).
**Columns**: name, type (org/person), email, phone, notes.
Standard EntityView with create/edit modal.

---

## 15. All Overlay Components

### 15.1 Overlay System

**Base pattern**: `Overlay.tsx` provides the backdrop + focus-trap primitive.
All modals, command palette, notification pop use this.

```
.overlay-backdrop { position: fixed; inset: 0; z-index: --z-modal;
  background: rgba(0,0,0,.55); display: flex; align-items: center; 
  justify-content: center; padding: 24px;
  animation: overlay-fade 200ms ease-decelerate }
.overlay-panel { animation: overlay-rise 200ms ease-decelerate }
```

Close triggers: Esc key, clicking backdrop (for dismissible modals).
Focus trap: Tab key cycles within the open overlay.
Stack: multiple overlays stack correctly via z-index (emoji picker at toast level to render above modal).

### 15.2 Modal

**Component**: `Modal.tsx`
**Sizes**:
```
.modal-sm        { max-width: 380px }
.modal-md        { max-width: 520px }
.modal-lg        { max-width: 780px }
.modal-fullscreen { width: calc(100vw - 48px); height: calc(100vh - 48px) }
```

**Anatomy**:
```
.modal-head { align-center; gap 12px; padding 15px 18px; border-bottom }
  [CloseIcon .iconbtn at margin-left: auto]
.modal-body { padding 18px; overflow-y: auto }
.modal-foot { justify-end; gap 8px; padding 14px 18px; border-top }
  [Cancel btn .btn-ghost] [Confirm btn .btn-primary or .btn-danger]
```

**Usage across pages**:
- Create/edit records: `modal-md`
- Confirm destructive: `modal-sm`
- Customer billing detail: `modal-lg`
- Report builder: `modal-fullscreen`
- Compose outbound: `modal-md`
- AI Assist: `modal-md`

### 15.3 Toast

**Component**: `Toast.tsx` (uses a ToastContext, portal to body)
**Region**: `.toast-region { position: fixed; right: 18px; bottom: 18px; z-index: --z-toast; flex column; gap 10px; max-width: 360px }`

**Anatomy**:
```
.toast { --surface bg; 1px --border; border-left 3px solid <signal>; --r-md; --shadow-pop; 
         padding 11px 12px; animation toast-in 200ms }
```

**Variants** (border-left color):
- `.toast-success` → `--success` (CheckIcon in success color)
- `.toast-error` → `--danger` (WarningIcon in danger color)
- `.toast-warning` → `--warning` (WarningIcon in warning color)
- `.toast-info` → `--primary` (InfoIcon in primary color)

**Auto-dismiss**: 4000ms default, 6000ms for errors.
**Manual dismiss**: CloseIcon button (`.toast-close`) at right edge.

### 15.4 Command Palette

**Component**: `CommandPalette.tsx`
**Trigger**: Ctrl+K / ⌘K keyboard shortcut, or click the `cmdk-trigger` button in header.
**Z-level**: `--z-modal` (1300) — appears above all content, below toast.

**Panel**: `.overlay-panel.cmdk { width: 640px; max-width: calc(100vw - 32px); max-height: 60vh; flex column }`

**Anatomy**:
```
.cmdk-search    { flex; align-center; gap 10px; padding 12px 14px; border-bottom }
  [SearchIcon .cmdk-icon]
  [.cmdk-input text 15px, no border]
  [.cmdk-clear (CloseIcon) when query non-empty]
  [⌘K .search-kbd hint]

.cmdk-suggest   { flex; wrap; gap 4px; padding 6px 10px; --surface-2 bg; border-bottom }
  [.cmdk-suggest-item chips: saved searches and recent queries]

.cmdk-facets    { flex column; gap 4px; padding 8px 10px; --surface-2 bg; border-bottom }
  [.cmdk-facet-group: label (min-width 44px) + .cmdk-facet-chip chips]
  Chip states: default border, .on = --accent-soft bg + --accent border + gold text

.cmdk-list      { overflow-y: auto; padding: 6px }
  [.cmdk-group: .cmdk-group-label (icon + text) + .cmdk-item rows]
  .cmdk-item { flex column; gap 2px; border-radius --r-sm; padding 8px 10px; text-left }
  .cmdk-item.on { --primary-soft bg }
  .cmdk-item-label (13px) + .cmdk-item-sub (11px, --text-3, ellipsis)
  .cmdk-mark { --accent-soft bg; --accent-hover text; radius 2px } — match highlight

.cmdk-footer    { flex; align-center; gap 8px; padding 8px 12px; border-top; --surface-2 bg }
  [.cmdk-save-btn: save this search]
  [.cmdk-save-form: inline name input when saving]
  [.cmdk-save-msg: green success message]
```

**Sections in the list**:
1. Pinned results (`PinIcon` group label)
2. Recent searches (`ClockIcon` group label)
3. Saved searches (`BookmarkIcon` group label)
4. Live results (by entity type — customers, leads, invoices, etc.)

### 15.5 Notification Center

**Component**: `NotificationCenter.tsx`
**Trigger**: `BellIcon` button with `.notif-badge` (red count) in header.
**Popover**: `.notif-pop { position: absolute; top: calc(100% + 8px); right: 0; z-index: --z-dropdown; width: 360px; max-height: 460px }`

**Anatomy**:
```
.notif-head { flex; align-center; gap 10px; padding 10px 12px; border-bottom }
  [Notifications (semibold 14px)]
  [.notif-toggle: "Show unread only" toggle with small label (12px)]
.notif-list { overflow-y: auto }
  [.notif-item: full-width button; .unread = --primary-soft bg]
    .notif-item-title { 13px; semibold; flex; align-center; gap 6px }
      [.notif-dot 7px circle --primary-hover] (only if unread)
    .notif-item-body { 12px; --text-2; margin-top 2px }
    .notif-item-time { 11px; --text-3; margin-top 4px }
.notif-empty { centered, 22px 14px padding }
```

Click notification: mark read + navigate to linked record.
"Show unread only" toggle: filters list in place.
Backdrop (`.notif-backdrop`): fixed inset, z-index --z-dropdown — click to close.

### 15.6 AI Assist Modal

**Component**: `AiAssistModal.tsx`
Compact Ask GAAhex modal, opened in-context (from record pages, dashboard).
Pre-populates context: "You are viewing [Customer / Invoice / etc.] #123. What do you want to know?"
Same conversation UI as full Ask GAAhex page, constrained to `modal-md`.

### 15.7 Comments Modal

**Component**: `CommentsModal.tsx`
Opens from any record that supports comments (`.btn.btn-ghost`, "Comments (N)").
`modal-md`, header "Comments", body = comment list + composer, no footer buttons.

**Comment list**: `.comments { flex column; gap 10px; max-height: 46vh; overflow-y: auto; margin-bottom 14px }`
```
.comment { --surface-2; --r-md; 9px 11px }
.comment-head { flex; align-baseline; gap 8px; margin-bottom 3px }
  [username strong 13px] [timestamp 11px --text-3]
.comment-body { 13px; lh 1.5; pre-wrap; word-break: break-word }
```

**Composer**: `Composer.tsx` — textarea + SmileIcon (emoji picker trigger) + Send btn.

### 15.8 Composer

**Component**: `Composer.tsx`
Reusable rich-text-lite input for messages, comments, internal notes.
```
.composer        { flex column; gap 8px }
.composer-actions { flex; align-center; gap 8px }
  [SmileIcon .iconbtn — opens EmojiPicker]
  [.btn.btn-primary.btn-sm "Send" — margin-left: auto]
```
Textarea: `.inp.inp-area.inp-md`
Emoji insertion: inserts emoji at cursor position.

### 15.9 Emoji Picker

**Component**: `EmojiPicker.tsx`
Portaled to `<body>`, position: fixed off the SmileIcon trigger.
Z-index: `--z-toast` (above modals).

```
.emoji-pop { fixed; z-index --z-toast; width 320px; height 340px; flex column; 
             --surface bg; 1px --border; --r-lg; --shadow-pop; overflow hidden }
.emoji-search { padding 8px; border-bottom }
.emoji-tabs   { flex; gap 2px; padding 6px 8px; border-bottom; overflow-x: auto }
  .emoji-tab  { transparent; --text-3; 11px; padding 4px 7px; --r-sm; cursor pointer }
  .emoji-tab.on { --primary-soft; --text }
.emoji-grid   { flex 1; overflow-y auto; padding 8px;
                display grid; grid-template-columns: repeat(8, 1fr); gap 2px }
  .emoji-cell { transparent; no border; 20px emoji; padding 4px; --r-sm }
  .emoji-cell:hover { --surface-2 bg }
.emoji-empty  { grid-column 1/-1; padding 20px; center }
```

Tab categories: Smileys, People, Nature, Food, Travel, Objects, Symbols, Flags.

### 15.10 Select / MultiSelect

**Component**: `Select.tsx` / `MultiSelect.tsx`
Custom select dropdowns with keyboard navigation (not native `<select>`).

**Select**:
- Trigger: `.inp` styled button with ChevronDownIcon
- Dropdown: absolute positioned, --surface bg, --border border, --r-md, --shadow-pop
- Options: 36px height, hover = `--surface-2`
- Selected: `--primary-soft` bg + CheckIcon

**MultiSelect**:
- Trigger: shows selected pills inside the trigger area
- Pills in trigger: small removable chips (CloseIcon ×)
- Dropdown: same as Select, checkboxes on each option

### 15.11 Reference Picker (RefPicker)

**Component**: `RefPicker.tsx`
Used for FK / relation fields (e.g., pick a customer, pick a user, pick a service).

- Trigger: `.inp` styled, shows selected record name or placeholder
- Dropdown: search input + filtered list of records
- Selected: shows record name + small CloseIcon to clear

### 15.12 State Components

**LoadingState**: centered `SpinnerIcon` (size 32, `--text-3` color) + optional label.
**SkeletonRows**: animated shimmer placeholder rows for table loading.
  Each row: `--surface-2` bg, gold shimmer animation (linear-gradient sweep, 1.5s infinite).
**EmptyState**: centered layout — large icon (40–48px, `--text-3`), heading, sub-text, optional CTA button.
**PermissionDenied**: `LockIcon` (48px) + "You don't have access to this" + contact admin hint.
**NotFound**: 404 illustration + "Page not found" + "Go home" link.
**ErrorBanner**: inline banner with WarningIcon + error message + optional "Retry" button.
  Uses `--danger-soft` bg, `--danger` border-left, `--danger` text.

### 15.13 Create Tenant Wizard

**Component**: `CreateTenantWizard.tsx`
3-step wizard shown on first login (no tenant yet).
Wide card centered on screen (similar to login card but wider: ~600px).
Step indicators at top: numbered circles, current = `--accent` gold fill, done = `--success` fill.
Step content changes inline (no separate routes).

### 15.14 Customer Billing Modal

**Component**: `CustomerBillingModal.tsx`
`modal-lg` — shows full billing history for a customer.
Sections: account balance, invoice list (`.grid`), payment history, plan summary.
Print button: `PrinterIcon` in modal header.

### 15.15 Report Schedule Panel

**Component**: `ReportSchedulePanel.tsx`
Slide-in panel or modal section for configuring automated report delivery.
Fields: frequency (daily/weekly/monthly), day of week/month, time, recipient emails, format (CSV/PDF).

### 15.16 NoAccess

**Component**: `NoAccess.tsx`
Shown when a user navigates to a route their role cannot access.
`LockIcon` (large, centered) + message + back button.

---

## 16. Configuration-Driven Architecture — Design Implications

### The Core Principle
GAAhex has **zero hardcoded business rules** in the UI or backend business logic.
Everything the product does at the data level — entity shapes, workflow stages, field definitions,
dashboard layouts, report definitions — is controlled by configuration stored in the database
and edited via Studio.

### The 5 Fixed Kernel Engines (Never Configured — Always Present)
1. **WorkItem movement engine** — transitions records through workflow stages with rules
2. **Auth/authz engine** — OrgNode tree-based permission checking on every request
3. **Database engine** — multi-tenant isolation (tenant_id on every row, enforced at query)
4. **Audit/log engine** — immutable event log of every state change
5. **Security engine** — rate limiting, CSRF, SQL injection prevention, session management

### OrgNode Tree (Permission Model)
Every tenant has an OrgNode tree (Company → Division → Department → Team → User).
Every data record has `owner_node_id` pointing to a node in this tree.
Permission checks walk up the tree: a manager sees everything in their subtree.
The UI must reflect node-level permissions: hide records the user cannot see.

### Design Implications for Configuration
1. **Entity pages are generated from config** — no hardcoded column definitions in source.
   Column names, types, order, and visibility come from Studio-configured entity definitions.
2. **Status pills use configured colors** — Studio defines stage names and colors (hex or semantic).
   The pill component receives `{ label, color }` from the config, not hardcoded classes.
3. **Dashboards are blank by default** — widgets are added and arranged by operators in Studio.
4. **Navigation reflects installed entities** — sidebar links appear based on which entities
   are enabled for the tenant. Tenants can hide/show nav sections.
5. **Workflow triggers are visual** — Studio > Automations shows trigger→condition→action flows
   with a visual editor (node-graph or form-based, not code).

### Studio Visual Design Requirements
Studio is the most important internal tool in the product. It must look:
- **Powerful without being intimidating**: clear sections, good empty states
- **Live**: changes should be visible immediately (preview panel, live reload)
- **Safe**: destructive actions (delete field, delete entity) require confirmation with impact summary

---

## 17. New Design Requirements

### 17.1 User-Selectable Color Palettes

Beyond dark/light, users can select from a set of named color palettes.
See Section 3.2 for full palette specifications.

**Palette Picker Component** (in Settings > Appearance):
```
[Section: "Color Palette"]
[6–8 circular swatches, 40px diameter]
[Active: 2px gold ring border]
[Hover: scale(1.08) transform 120ms]
[Label below each swatch]
[Optional: "Custom" button → hex color input for brand color]
```

**Persistence**: `localStorage("gaahex-palette")`, applied via `data-palette="forest"` etc. on `<html>`.

### 17.2 Custom Backgrounds Per Section

Users can set background textures/images on: sidebar, header, main canvas.
See Section 3.3 for full specification.

**Background Settings UI** (in Settings > Appearance > Backgrounds):
```
[Three region cards: "Sidebar" | "Header" | "Content"]
[Each card: preview thumbnail + options]
  [None (current solid color)]
  [Texture picker: Dots | Grid | Noise | Carbon | Linen — small swatches]
  [Gradient: 4–6 preset gradient chips]
  [Upload: drag-drop zone or "Choose file" button]
[Opacity slider: 10%–30% (controls texture overlay intensity)]
[Reset to default link]
```

Textures are inline SVG patterns (no external images for built-ins, zero load cost).
Custom uploads: stored as tenant assets, max 2MB, PNG/JPG/WebP accepted.

### 17.3 Picture Upload (Avatars, Customer Photos, Tenant Logos)

**User Avatar** (in Settings > Account):
- Current: initials fallback (`JD` in 32px circle, `--primary` bg)
- New: upload photo (PNG/JPG, max 1MB)
- Crop: circular crop UI with drag/scale
- Upload triggers PUT `/api/users/me/avatar`
- Avatar displayed: header user button, activity timeline entries, comment authors, assigned user chips

**Customer Photo** (on CustomerView):
- Optional customer portrait or company logo
- 80px circle at top of Customer header
- Fallback: customer initials in `--accent` (gold) bg
- Upload via drag-drop or click on the avatar area
- Stored as: `customer.photo_url`

**Tenant Logo** (in Studio > Appearance):
- Shown on login page, sidebar header, email templates
- Upload: PNG/SVG, recommended min 200×200px
- Preview shown inline after upload
- Replaces default GAAhex logo for tenant-branded instances

**Logo Color Configuration** (in Studio > Appearance):
- Tenant admin can view the current logo and adjust brand colors
- Primary brand color: color picker (`#1C3B68` default)
- Changes `--brand` and `--primary` CSS tokens for the tenant
- Preview panel shows how the color looks on buttons, nav active state, focus rings

### 17.4 Icon Upload for Entities, Projects, Tasks

Entities, projects, and task types can have custom icons. Three sources:

**Source 1 — Emoji Picker**:
The same `EmojiPicker` component used for reactions.
Selected emoji displayed as the entity/project icon (20–24px, centered in 32px icon box).

**Source 2 — SVG/PNG Upload**:
Upload a custom icon file (SVG preferred, PNG fallback, max 256×256).
Rendered at 20px with `object-fit: contain`.
Stored as: `entity.icon_url`.

**Source 3 — Built-in Icon Library**:
The 46 icons from `icons.tsx` are available as selectable options.
Icon picker grid: 8 columns, same grid layout as emoji picker, renders SVG previews.
Active icon: `--accent-soft` bg + `--accent` border.

**Icon Picker Component** (new — required):
```
.icon-picker-pop { same dimensions as emoji-pop: 320×340px }
  [.icon-picker-tabs: "Icons" | "Emoji" | "Upload" tabs]
  [Icon grid (icons.tsx): 8 columns, 36px cells, SVG at 20px]
  [Emoji grid (EmojiPicker content): 8 columns, 20px emoji]
  [Upload tab: drag-drop zone + file input]
  [Selected preview: 48px display at top with change button]
```

### 17.5 Beautiful Custom Calendar System

The calendar is NOT a standard datepicker. It is a first-class view within the product —
a full calendar application embedded in GAAhex, with multiple views and SAML-like team sharing.

**Calendar Views**:
1. **Month view**: 7-column grid (Mon–Sun), each cell = a day with event chips
2. **Week view**: 7-column time grid (00:00–24:00), hourly slots, event blocks
3. **Day view**: single-column time grid, detailed event blocks with full descriptions
4. **Agenda view**: chronological list of upcoming events (compact, searchable)

**Design Aesthetic** — Glass + Cobalt + Gold:
- Calendar chrome: `--surface` bg, `--border` borders (clean, minimal)
- Current day: cell bg = `--accent-soft` (gold tint), date number = `--accent` color, bold
- Today's header: subtle gold underline
- Selected day: `--primary-soft` bg, cobalt border
- Weekend columns: very slightly tinted background (`rgba(--surface-2, 0.5)`)
- Navigation arrows: `ChevronLeftIcon` / `ChevronRightIcon`
- "Today" button: `.btn.btn-ghost.btn-sm`

**Event Chips** (Month view):
- Height: 22px
- Rounded: `--r-sm` (6px)
- Color: configured per calendar / event type
- Text: 11px, semibold, single line, ellipsis overflow
- Max 3 chips per day cell + "+N more" overflow chip in `--text-3`

**Event Blocks** (Week/Day view):
- Positioned by start time + duration (time grid overlay)
- Min height: 22px (15-minute slot)
- Color: calendar color with 80% opacity bg, solid left border (3px, full opacity)
- Time label: 11px top-left
- Title: 12px, semibold, truncated
- Resize handle: bottom edge drag → extend duration
- Move: drag entire block → change time/day

**Event Detail** (click on event → popover or modal):
```
[Event title (h3, 17px)]
[Calendar tag (colored pill)]
[Date + time range]
[Description / notes]
[Participants / attendees]
[Edit | Delete | RSVP buttons]
```

**SAML / Team Calendars**:
- Multiple calendars per user: "My Calendar", "Team Calendar", "On-call", "ISP Events"
- Each calendar: unique color, owned by a user or a team (OrgNode)
- Shared team calendars: visible to all members of an OrgNode (team/department)
- Subscribe: members can subscribe to other teams' calendars (read-only overlay)
- Permissions: "View only" vs "Add events" per calendar subscriber

**Calendar Sidebar** (within Calendar page):
```
LEFT:
  [Mini month navigator: 3-column calendar, clickable days]
  [My Calendars: checkbox list, colored dot per calendar]
    ☑ My Calendar  (cobalt dot)
    ☑ Team         (gold dot)
    ☐ On-call      (warning dot)
  [Other Calendars: subscribed external/team cals]
  [+ New Calendar button]

RIGHT:
  [View switcher: Month | Week | Day | Agenda tabs]
  [Navigation: < [Month/Week Title] > + Today]
  [Main calendar grid]
  [+ New Event FAB (floating action button, bottom-right, gold)]
```

**Calendars Embedded Inside Tasks**:
When a task record has a due date or scheduled time, the task shows a mini calendar widget:
```
.task-calendar-embed {
  background: rgba(--surface-2, 0.8);   /* glass-like */
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  padding: 12px;
}
```
Shows: selected date highlighted in `--accent` (gold), surrounding days visible for context.
Click: opens full calendar popover to change date.
The mini calendar has the same design language as the full calendar but at 240px width.

**New Event Form** (modal-md):
```
[Title input .inp.inp-md]
[Calendar picker (colored dot + name)]
[Date: mini calendar (click to select)]
[Start time / End time: time inputs]
[All day: toggle switch]
[Repeat: None | Daily | Weekly | Monthly | Custom]
[Attendees: RefPicker (users / OrgNode)]
[Location: .inp.inp-md]
[Description: .inp.inp-area.inp-md]
[Color: 8 color swatches for this event]
[Save (.btn-primary) | Cancel (.btn-ghost)]
```

**Toggle Switch** (for "All day" and similar):
```
.toggle { width: 40px; height: 22px; border-radius: 11px; 
          background: --border; transition: background 200ms }
.toggle.on { background: --primary }
.toggle-thumb { width: 18px; height: 18px; border-radius: 50%; 
                background: white; transition: transform 200ms }
.toggle.on .toggle-thumb { transform: translateX(18px) }
```

---

## 18. Accessibility Standards

### Core Rules
- **Focus**: every interactive element has `:focus-visible` ring. Gold ring (dark), cobalt (light).
- **Keyboard navigation**: full keyboard support for all modals, dropdowns, command palette.
  - Tab: move focus. Shift+Tab: reverse. Escape: close overlay. Enter/Space: activate.
  - Arrow keys: navigate dropdown items, calendar days, command palette list.
- **Screen readers**: all icons have `aria-hidden="true"`. Meaningful text labels on all buttons.
  `.sr-only` class provides invisible text labels for icon-only buttons.
- **Skip link**: `.skip-link` at top of page → "Skip to main content" (focusable, appears on Tab).
- **Reduced motion**: full `prefers-reduced-motion` support (all durations → 0ms).
- **Color contrast**: all text/background combinations meet WCAG AA (4.5:1 normal text, 3:1 large text).
  Gold `#C5A059` on `#0D0F12` = ~7:1. White `#F4F6F9` on `#1C3B68` = ~5.9:1.
- **Form labels**: every `.field` has a visible label (`<span>` or `<label>`).
- **Error messages**: use both color AND icon (WarningIcon) — not color alone.
- **Touch targets**: minimum 44×44px for all interactive elements on touch devices.

---

## 19. Responsive Design

### Breakpoints
- **Default** (≥860px): full two-column shell (220px sidebar + content)
- **Tablet** (<860px): sidebar collapses to icon-only or off-canvas drawer
- **Mobile** (<600px): single-column, sidebar becomes bottom sheet or full-screen drawer

### Responsive Patterns
At <860px:
- `.shell` changes to single-column (`grid-template-columns: 1fr`)
- Sidebar hides, replaced by a hamburger button (`MenuIcon`) in header
- Sidebar slides in as an overlay with a backdrop on hamburger tap

At <600px:
- `.card` (login): `width: calc(100vw - 32px)` (fills viewport minus padding)
- `.rec-form`: single column (`grid-template-columns: 1fr`)
- `.messages`: stacked (`grid-template-columns: 1fr`), thread list above thread pane
- `.widgets`: single column (`minmax(280px, 1fr)` already handles this via auto-fill)
- Modal widths: `width: calc(100vw - 32px)` (minus side padding)
- Command palette: `max-width: calc(100vw - 32px)`

---

## 20. ISP Domain Model & Data Flows

### Core Entity Hierarchy

```
Tenant (ISP company)
└── OrgNode tree (Company → Division → Department → Team → User)
    └── Lead → Customer
               ├── Service (product catalog item)
               ├── Subscription (customer × service × plan)
               │   └── UsageRecord (bandwidth/sessions)
               ├── Invoice
               │   └── InvoiceLineItem
               └── Payment

Customer
├── Interaction (call / visit / note / email)
├── WorkItem (task / ticket)
└── Comment

Platform:
  OutboundMessage (email/SMS delivery records)
  Notification (in-app alerts)
  Webhook (outbound event delivery)
  AuditLog (immutable event trail)
```

### Currency & Locale
- Default currency: AMD (֏)
- Numbers: `--font-mono`, `font-variant-numeric: tabular-nums`
- Date format: ISO 8601 display (`YYYY-MM-DD`) or locale-formatted
- All financial amounts: right-aligned in tables (`.inp-numeric` pattern)

### Key Status Sets (Configurable in Studio)

**Customer status**: Active (success) | Suspended (warning) | Prospect | Churned (danger)
**Subscription**: Active | Suspended | Cancelled | Pending
**Invoice**: Draft | Sent | Paid (success) | Overdue (danger) | Void
**Lead stage**: Defined by workflow config (S1..Sn, operator-named)
**WorkItem**: Open | In Progress | Blocked (warning) | Done (success) | Cancelled

All status colors are configurable in Studio. The design system provides semantic tokens
(`--success`, `--warning`, `--danger`, `--primary`) that map to common status meanings,
but any status can use any color via configuration.

---

## 21. Horizon & Future Work

These features are defined as future work and should be designed with extensibility in mind,
but not implemented in the current phase:

1. **Real-time collaboration**: live cursors, presence indicators (who's viewing a record)
2. **Offline mode**: service worker caching, sync queue for offline edits
3. **Email templates**: configurable templates for outbound system emails
4. **Scheduled message delivery**: compose and schedule outbound messages
5. **Delivery receipts**: tracking pixel + webhook for email open/click tracking
6. **Network equipment integration**: SNMP/TR-069 adapters for real network data
7. **Billing automation**: auto-generate invoices, auto-apply payments
8. **Customer portal**: white-labeled self-service portal for ISP subscribers
9. **Mobile app**: React Native app sharing the same API
10. **Advanced RBAC**: field-level permissions, row-level security beyond OrgNode
11. **AI-powered insights**: anomaly detection, churn prediction, usage forecasting
12. **Chart library**: dedicated chart components beyond SVG primitives (time-series, gauge)
13. **Map view**: customer geographic distribution (for field ISPs)
14. **Voice integration**: click-to-call from PhoneIcon, call recording, transcription
15. **GXL query language**: full visual query builder with autocomplete and saved queries

---

## Appendix A — Complete CSS Class Reference

```
/* Shell */
.shell .sidebar .content .header-right

/* Typography helpers */
.muted .hint .err .ok-msg

/* Login */
.center .card .logo-lg .logo-sm

/* A11y */
.sr-only .skip-link

/* View structure */
.view-head .list-toolbar .saved-views .rec-form .field .rec-form-actions .row-actions

/* Table */
.grid (+ th, td, tr styles)

/* Status */
.pill .badge

/* Navigation */
.nav .nav.on .nav-label .nav-icon .iconbtn

/* Tabs */
.tabs .tab .tab.on

/* Dashboard */
.widgets .widget .widget-label .widget-kpi .widget-err
.kpi .bars .bar-row .bar-label .bar-track .bar-fill .bar-val
.donut-wrap .donut .donut-total .legend .legend-row .legend-dot .legend-name .legend-val

/* Notification */
.notif .notif-badge .notif-backdrop .notif-pop .notif-head .notif-toggle
.notif-list .notif-empty .notif-item .notif-item.unread .notif-dot
.notif-item-title .notif-item-body .notif-item-time

/* Overlay */
.overlay-backdrop .overlay-panel

/* Modal */
.modal .modal-sm .modal-md .modal-lg .modal-fullscreen
.modal-head .modal-title .modal-body .modal-foot

/* Toast */
.toast-region .toast .toast-success .toast-error .toast-warning .toast-info
.toast-icon .toast-msg .toast-close

/* Composer / Comments / Messages */
.composer .composer-actions
.comments .comment .comment-head .comment-body
.messages .thread-list .thread-item .thread-item.on .thread-title .thread-sub
.thread-pane .msg-scroll .msg .msg-head .msg-bubble .msg-compose .msg-placeholder

/* Emoji picker */
.emoji-anchor .emoji-backdrop .emoji-pop .emoji-search .emoji-tabs .emoji-tab .emoji-tab.on
.emoji-grid .emoji-cell .emoji-empty

/* Command palette */
.cmdk-trigger .overlay-panel.cmdk .cmdk-search .cmdk-icon .cmdk-input .cmdk-clear
.cmdk-suggest .cmdk-suggest-item
.cmdk-facets .cmdk-facet-group .cmdk-facet-label .cmdk-facet-chip .cmdk-facet-chip.on .cmdk-facet-count
.cmdk-list .cmdk-empty .cmdk-group .cmdk-group-label .cmdk-item .cmdk-item.on
.cmdk-item-label .cmdk-item-sub .cmdk-mark
.cmdk-footer .cmdk-save-btn .cmdk-save-form .cmdk-save-input .cmdk-save-msg

/* Buttons */
.btn .btn-primary .btn-accent .btn-ghost .btn-danger .btn-sm .btn-md .btn-lg

/* Inputs */
.inp .inp-sm .inp-md .inp-lg .inp-numeric .inp-area .inp-help .inp-err

/* Search */
.search .search-sm .search-md .search-lg .search-input .search-icon .search-clear
.search-filter .search-kbd

/* Studio */
.studio .studio h3 .studio .grid td

/* Density */
[data-density="compact"]

/* Theme */
[data-theme="light"]
```

---

## Appendix B — Keyframe Animations

```
@keyframes overlay-fade    { from { opacity: 0 } to { opacity: 1 } }
@keyframes overlay-rise    { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes toast-in        { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes spin-icon       { to { transform: rotate(360deg) } }   /* applied to .spin-icon */
@keyframes skeleton-shimmer (background-position sweep, 1.5s linear infinite)
```

---

## Appendix C — API Endpoint Summary (for Design Context)

The UI communicates exclusively with the FastAPI backend at `http://localhost:8099`.
All authenticated routes require `Authorization: Bearer <token>` header.

| Endpoint | Method | Page / Component |
|----------|--------|-----------------|
| `/api/auth/token` | POST | Login |
| `/api/auth/me` | GET | App init |
| `/api/tenants` | GET/POST | Tenant setup |
| `/api/entities` | GET | Studio, nav |
| `/api/records/{entity}` | GET/POST/PATCH/DELETE | EntityView |
| `/api/customers` | GET/POST | CustomerView |
| `/api/leads` | GET/POST | LeadPipelineView |
| `/api/interactions` | GET/POST | InteractionsView |
| `/api/invoices` | GET/POST | InvoicesView |
| `/api/subscriptions` | GET/POST | SubscriptionsView |
| `/api/notifications` | GET/PATCH | NotificationCenter |
| `/api/outbound` | GET | OutboundView |
| `/api/outbound/compose` | POST | ComposeModal |
| `/api/messages` | GET/POST | MessagesView |
| `/api/search` | GET | CommandPalette |
| `/api/recent-searches` | GET/POST/PATCH/DELETE | CommandPalette |
| `/api/ai/ask` | POST | AskGaaexView |
| `/api/webhooks` | GET/POST/DELETE | WebhooksView |
| `/api/workflow` | GET/POST | WorkflowEngine |
| `/api/analytics` | GET | AnalyticsView |
| `/api/reports` | GET/POST/DELETE | ReportsView |

---

---

## Appendix D — Universal Page Structure (All Pages Must Follow This)

**Design requirement**: every page in GAAhex must use the same structural template.
Consistency is a core UX value — operators should know exactly where to look on every page.

### Standard Page Template

```
┌─────────────────────────────────────────────────────────────┐
│  SHELL HEADER (48px, always visible)                        │
│  [< collapse] [breadcrumb] [⌘K] ─────── [sun] [🔔] [user] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PAGE HEADER (.view-head)                                   │
│  [PageIcon] [Page Title h2]  ──────── [+ Primary Action]   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TOOLBAR (.list-toolbar)  [optional]                        │
│  [Search] [Filter chips] ──────── [Saved views dropdown]   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TABS (.tabs)  [optional — for multi-section pages]         │
│  [ Tab 1 ]  [ Tab 2 ]  [ Tab 3 ]                           │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  MAIN CONTENT AREA                                          │
│  (table / kanban / grid / detail / two-pane / chat)        │
│                                                             │
│  Empty state centered if no data                           │
│  Loading state: skeleton rows while fetching               │
│  Error state: ErrorBanner at top of content area           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Mandatory Page Rules
1. **Page header always present**: icon + title (h2, margin 0) + primary action button pushed right.
2. **Primary action always top-right**: `.btn.btn-primary.btn-sm` or `.btn-md` with a PlusIcon or relevant icon.
3. **Search/filter always below header, above content**: never inside the content area.
4. **Loading state**: show SkeletonRows while data loads — never a blank page.
5. **Empty state**: EmptyState component when there is zero data — never a blank table.
6. **Error state**: ErrorBanner at top of content, content below still visible if partial data.
7. **Padding**: always `20px 24px` on `.content main`.
8. **Spacing**: `margin-bottom: 14px` after page header, same after toolbar, same after tabs.
9. **Responsive**: at <860px the sidebar collapses — content takes full width. Same inner structure.
10. **Detail pages** (Customer, Invoice, etc.): sections are clearly labelled (`h3` or section heading), 
    separated by `margin-bottom: 24px`, sections with borders use `.widget` card wrapper.

### Section Heading Convention (Detail Pages)
```
.section-head {
  display: flex; align-items: center; gap: 10px;
  margin: 24px 0 12px;
  font-size: 15px; font-weight: 600; color: var(--text);
}
.section-head .section-icon { color: var(--accent); }
.section-divider { height: 1px; background: var(--border); margin: 20px 0; }
```

---

## Appendix E — Code Structure (For Claude Design Reference)

This section describes the technical structure of the codebase so Claude Design can understand
what files to create/modify and how the system is organized.

### Tech Stack
```
Frontend:  React + TypeScript (TSX), Vite dev server (no build step in dev)
           No component library (custom design system in styles.css)
           No router library confirmed (basic hash or React Router)

Backend:   FastAPI (Python 3.11+), SQLAlchemy async ORM
           PostgreSQL (Neon cloud, shared DB across tenants)
           Alembic for migrations
           Python-jose (JWT auth), Pydantic v2 (validation)

AI:        Google Gemini Flash (gemini-flash-latest) via generativelanguage API

Dev env:   Docker Compose (Postgres:5433, Redis:6380)
           Backend at http://localhost:8099
           Frontend at http://localhost:5173 (Vite default)
           Swagger UI at http://localhost:8099/docs
```

### Frontend File Structure
```
frontend/
  src/
    main.tsx              — React entry point, renders <App>
    App.tsx               — routing, auth gate, tenant gate, theme/theme context
    styles.css            — ALL design tokens + component classes (single file)
    icons.tsx             — ALL SVG icons (46 icons, inline SVG components)

    api.ts                — ALL API calls (one file, all fetch functions)

    # Shell / Layout
    Shell.tsx             — sidebar + header wrapper
    Sidebar.tsx           — nav items, logo, section labels
    Header.tsx            — breadcrumb, cmd palette trigger, theme toggle, notif, user
    NotificationCenter.tsx

    # Auth
    LoginView.tsx
    CreateTenantWizard.tsx

    # Core views (one file per page)
    DashboardView.tsx
    EntityView.tsx        — generic entity CRUD (reused for many pages)
    CustomerView.tsx      — 360-degree customer detail
    LeadPipelineView.tsx  — kanban board
    AccountsView.tsx
    AnalyticsView.tsx
    InteractionsView.tsx
    MessagesView.tsx
    OutboundView.tsx
    InvoicesView.tsx
    ServicesView.tsx
    ProductsView.tsx
    SubscriptionsView.tsx
    UsageView.tsx
    ResourcePoolsView.tsx
    WebhooksView.tsx
    PartiesView.tsx
    ReportsView.tsx
    ReportBuilder.tsx
    StudioView.tsx
    SettingsView.tsx
    AskGaaexView.tsx

    # Shared / overlay components
    Modal.tsx             — modal overlay with sizes (sm/md/lg/fullscreen)
    Toast.tsx             — toast notification system (context + region)
    Overlay.tsx           — backdrop + focus-trap primitive
    CommandPalette.tsx    — ⌘K global search
    Composer.tsx          — message/comment input with emoji support
    EmojiPicker.tsx       — emoji grid (portaled to body)
    CommentsModal.tsx     — comments thread in a modal
    AiAssistModal.tsx     — compact Ask GAAhex in a modal
    Select.tsx            — custom select dropdown
    MultiSelect.tsx       — multi-select with chips
    RefPicker.tsx         — FK relation field picker
    ActivityTimeline.tsx  — chronological event list
    SystemStatusChip.tsx  — colored status badge
    NoAccess.tsx          — permission denied page
    CustomerBillingModal.tsx
    ReportSchedulePanel.tsx

  public/
    icon-light.png        — logo for dark backgrounds (sidebar)
    icon-dark.png         — logo for light backgrounds (login)
    favicon.ico

  index.html
  vite.config.ts
  tsconfig.json
```

### Backend File Structure
```
backend/
  app/
    main.py               — FastAPI app, CORS, router includes, startup
    database.py           — async SQLAlchemy engine, session factory
    auth.py               — JWT creation/verification, get_current_user dependency

    models/               — SQLAlchemy ORM models (one file per domain area)
      base.py             — Base, tenant_id mixin, audit mixin
      customer.py
      lead.py
      interaction.py
      invoice.py
      subscription.py
      usage.py
      outbound.py
      notification.py
      webhook.py
      ...

    routers/              — FastAPI routers (one file per domain area, mounted at /api/*)
      auth.py             — /api/auth/token, /api/auth/me
      customers.py        — /api/customers
      leads.py            — /api/leads
      interactions.py     — /api/interactions
      invoices.py         — /api/invoices
      subscriptions.py    — /api/subscriptions
      notifications.py    — /api/notifications + /api/outbound + /api/outbound/compose
      messages.py         — /api/messages
      search_assist.py    — /api/search + /api/recent-searches + /api/saved-searches
      analytics.py        — /api/analytics
      reports.py          — /api/reports
      studio.py           — /api/studio (entity/field config)
      webhooks.py         — /api/webhooks
      ai.py               — /api/ai/ask (Gemini proxy)
      ...

    adapters/             — Channel adapters (email, SMS, dev log)
      base.py             — Adapter ABC + registry
      email.py            — SMTP adapter + LogEmailAdapter (dev)
      sms.py              — SMS gateway adapter + LogSmsAdapter (dev)

    workflow.py           — Declarative state-machine engine
    dependencies.py       — Shared FastAPI dependencies (auth, db session, tenant)

  tests/
    conftest.py           — Fixtures (client, auth_headers, tenant setup)
    test_*.py             — Test files per domain

  alembic/               — DB migrations
  .env                   — DB URL, secret key, Gemini API key (never committed)
  requirements.txt
```

### Key Architectural Patterns
- **Multi-tenancy**: every DB table has `tenant_id UUID`. Every query is filtered by `tenant_id`
  extracted from the JWT. No cross-tenant data leakage by design.
- **OrgNode tree**: `org_nodes` table is a self-referential tree. `owner_node_id` on records.
  Permission checks use recursive CTE or path-based queries.
- **Configuration storage**: entity/field/workflow configs are JSON blobs in `studio_config` table,
  keyed by `(tenant_id, config_type, config_key)`.
- **Async everywhere**: SQLAlchemy async sessions, FastAPI async route handlers.
- **Adapter pattern**: `adapters/base.py` defines `BaseAdapter` ABC. `registry` dict maps
  channel names to adapter instances. In dev: `LogEmailAdapter` / `LogSmsAdapter`.
  In prod: SMTP / real SMS. Config switches via `EMAIL_BACKEND` env var.

---

*End of GAAhex Design System Specification — Batch 28 — 2026-05-27*
*Generated by Ընգեր (coordinator window) from full codebase audit (R1–R5 agents)*
*Transfer target: Claude Design for full UI rebuild and component library generation*
