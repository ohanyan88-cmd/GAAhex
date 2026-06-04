# GAAhex Design System — "Cobalt & Gold"

> A premium, dense, config-first design language for **GAAhex** — the platform that aims to be
> *the only place of work for an entire ISP*. Every department, every role, one system.

This design system is a **fresh visual language** proposed for GAAhex. It deliberately replaces the
prior "glass / generic-blue" tokens and centers the real brand identity — **cobalt navy + gold**,
with the triangular pyramid mark — into a coherent, accessible, dark-first system that scales across
GAAhex's **18 modules and ~190 pages**.

---

## 1 · What GAAhex is

GAAhex is a **multi-tenant, configuration-driven operations platform** for Internet Service Providers.
The thesis: the system *renders and behaves from configuration*, enforced by a small fixed kernel
(WorkItem movement · auth/authz · database · audit · security) — **no hardcoded screens or business
rules**. New entities, fields, workflows, dashboards and views are stood up from **Studio** with
config only.

**The 18 modules** (real, shipped navigation — nothing here is invented):

| | | | |
|---|---|---|---|
| Home | CRM | Orders | Support |
| Billing | Network | Field Operations | Inventory |
| Finance | HR | Analytics | AI |
| Communications | Documents | Projects | Legal & Compliance |
| Administration | Platform Ops | | |

Every module follows the same skeleton: a left **module sidebar**, a **top bar** (search / command
palette / notifications / tenant + user), and a **view** — usually a dense data table, a dashboard of
KPI tiles + charts, a record detail, or a board.

### Studio is the heart
Because GAAhex is config-driven, **Studio** is where the platform is *built and designed*, not just
configured. Studio panes:
- **Schema** → Entities · Fields · Statuses / Workflows (with GXL transition guards)
- **UI** → Dashboards · Views · Reports (the *design* surface — layouts, columns, KPI cards)
- **Logic** → Automations
- **Tenant** → Appearance · Roles & Permissions

Field types available in Studio: `text · textarea · number · money · boolean · date · datetime ·
email · phone · select · ref · status`. A page's **"Configure page"** button jumps straight into
Studio scoped to that entity. The design system must therefore make *every* component look good both
as a built screen **and** as something assembled live inside Studio.

### Sources
- **GitHub:** `ohanyan88-cmd/GAAhex` (private) — the build. Explore further to design with higher
  fidelity: real views live in `frontend/src/views/`, primitives in `frontend/src/primitives/`,
  navigation in `frontend/src/lib/nav-config.ts`, Studio in `frontend/src/views/StudioView.tsx`.
- Architecture blueprint referenced by the repo: `../GAAhex-Vision/` (not provided here).
- Brand marks: `frontend/public/logo/` (imported into `assets/logo/`).

---

## 2 · Content fundamentals (voice & copy)

GAAhex is an **operator's tool** — written for ISP staff who live in it all day. The product copy is
**terse, precise, and lowercase-leaning in metadata, sentence-case in UI**.

- **Tone:** confident, calm, operational. No marketing fluff inside the app. Labels are nouns
  (`Invoices`, `Work Items`, `Tariff Plans`), actions are verbs (`Create entity`, `Suspend`,
  `Resume`, `Dispatch`).
- **Person:** the UI addresses the operator's *own* scope with **"My"** (`My Tasks`, `My Requests`,
  `My Approvals`). System-authored guidance uses plain imperative ("Add statuses to enable a
  workflow"). Avoid "we".
- **Casing:** **Sentence case** for buttons, menu items, field labels, headings
  (`New entity`, not `New Entity`). **UPPERCASE** only for: status keys (`OPEN`, `IN_PROGRESS`),
  eyebrows/overlines, and table micro-labels. snake_case for entity keys, kebab-case for route slugs.
- **Microcopy is explanatory, not cute:** sub-headers state what a screen does —
  *"Configuration engine · zero-code entity, workflow & UI builder"*, *"This page's settings — fields
  & workflow"*. Hints clarify optionality — *"Optional. Add statuses to enable a workflow."*
- **Confirmations are reassuring + specific:** *"Created 'Opportunities' — it's now in the sidebar
  and fully working."* Destructive actions state impact and require confirmation.
- **Numbers & units:** technical and exact — IPs, MACs, VLAN IDs, bandwidth (Mbps/Gbps), latency
  (ms), money with currency. Render these in **mono, tabular**.
- **Emoji:** **never in the product UI.** (The codebase rule is explicit: "the product UI uses NO
  emoji — every icon is an inline SVG.") Emoji are tolerated only in human channels (chat/mail).
- **Vibe:** Bloomberg-terminal seriousness softened by a premium, trustworthy brand — *"a bank for
  your network operations."*

---

## 3 · Visual foundations

**The big idea:** *cobalt is structure, azure is action, gold is prestige, slate is everything else.*

### Color
- **Cobalt** (`#1C3B68` core, gradient `#2A5187→#142C4E`) — brand & structural surfaces: the sidebar,
  logo, brand moments. Never a button fill (too dark to be interactive on dark).
- **Azure** (`#3B7BE0`) — the single **interactive primary**: buttons, links, focus, selection,
  active nav. Brightened from cobalt so it's accessible on the dark canvas.
- **Gold** (`#C5A059`, gradient `#E2C589→#9C7C3C`) — **premium accent, used sparingly**: the active
  nav indicator rail, "Pro"/premium badges, eyebrows, KPI highlights, focus glints on brand moments.
  Roughly a 90/8/2 split of slate / azure / gold across any screen.
- **Slate** — cool neutral scale for backgrounds, surfaces, borders, and text.
- **Surfaces are layered, not glassy:** opaque `--gx-bg` → `--gx-surface` → `--gx-elevated`. Blur is
  reserved for the sticky top bar and modal scrims only.

### Typography
- **Display / headings → Space Grotesk** — geometric, slightly technical; echoes the triangular
  A-mark of the logo. Used for page titles, KPI numbers, big stats.
- **UI / body → IBM Plex Sans** — humanist, exceptional legibility at 12–14px (essential for dense
  tables and forms).
- **Mono → IBM Plex Mono** — IPs, MACs, VLAN tags, entity keys, IDs, code, and *all tabular numerics*.
- Base UI size is **13px** (dense by design). Minimum size 11px (micro-labels). Tabular figures
  everywhere numbers align in columns.

### Spacing, radius, shape
- **4px base unit**; scale 2 → 80px. Density is "comfortable-compact" — generous enough to feel
  premium, tight enough to show real operational data.
- **Radius:** inputs/buttons `8px`, cards `12px`, modals `16px`, pills `full`. Sharp-ish, modern —
  not pill-soft, not brutalist-square.
- **Borders** are low-contrast hairlines (`1px`, slate at 9–16% alpha on dark) — the system separates
  by **elevation and spacing first, borders second.**

### Elevation & shadow
- Six-step elevation. On **dark**, shadows are deep + low-lift (`rgba(0,0,0,.30→.58)`) plus a faint
  top inset highlight. On **light**, soft cobalt-tinted shadows. Two **glows** (azure, gold) mark
  focus/premium moments.

### Motion
- **Fast and purposeful.** Durations 100–300ms for UI; standard ease `cubic-bezier(.2,0,0,1)`.
  Fades + small slides (8–12px) + scale-in for popovers (0.96→1). A single `spring` curve for
  toggles/switches. Skeleton shimmer for loads. Fully honors `prefers-reduced-motion`.

### States
- **Hover:** subtle surface overlay (slate 6% on dark) — never a color jump.
- **Pressed:** slightly stronger overlay + 1px nudge or `scale(.98)` on buttons.
- **Selected:** azure-soft background + a 2px azure (rows) or gold (nav) left/indicator rail.
- **Focus-visible:** 2px azure ring with a theme-matched offset — always visible, never removed.
- **Disabled:** 50% text, no shadow, `not-allowed` cursor.

### Cards
Opaque `--gx-surface`, `12px` radius, hairline border, `--gx-shadow-sm` at rest → `--gx-shadow-md`
on hover for interactive cards. No colored left-border-only cards. No gradients as decoration —
gradients appear *only* in the logo and in data-viz fills.

### Imagery
The brand is **graphic, not photographic** — the pyramid mark, cobalt/gold gradients, and the network
topology itself are the imagery. Where photos appear (e.g. technician avatars), keep them cool-toned.
Maps and topology graphs use the data-viz palette on a dark canvas.

---

## 4 · Iconography

- **Style:** Feather / Lucide-grade line icons — **24×24 grid, 2px stroke, round caps & joins,
  `currentColor`, `fill:none`.** The GAAhex codebase ships a hand-rolled set in this exact style
  (`frontend/src/components/icons.tsx`), so this system standardizes on **[Lucide](https://lucide.dev)**
  as the icon library — it is a pixel-compatible superset of the in-repo set. Loaded from CDN in the
  previews/UI kit (`lucide@latest`).
  > **Substitution flag:** the repo's icons are custom but stroke-identical to Lucide; I use Lucide
  > rather than re-importing dozens of one-off SVGs. If you want the exact in-repo glyphs, copy
  > `frontend/src/components/icons.tsx`.
- **Sizes:** 14px (inline / dense table), 16px (default UI), 18px (nav), 20–24px (headers/empty
  states). Icon color follows text color; status icons take the status color.
- **ISP-specific icons** (router, switch, OLT/ONT, fiber, antenna, signal, bandwidth, latency, VLAN,
  NAS/RADIUS, ticket, NOC): mapped to the closest Lucide glyph (`router`, `server`, `radio`,
  `wifi`, `activity`, `gauge`, `network`, `cable`, `satellite-dish`). Documented in the UI kit.
- **Filled exceptions:** play/▶, and a few solid status dots. Everything else is outline.
- **Emoji / unicode as icons:** **never.**
- **Logo marks** live in `assets/logo/`: full lockup (`cobalt-gold`), reversed (for dark), mono
  (cobalt / platinum), and the standalone pyramid **mark** (`GAAhex-mark.svg`) for favicons/avatars.

---

## 5 · Index / manifest

```
README.md                  ← you are here (context · voice · visual foundations · iconography)
SKILL.md                   ← Agent-Skill front-matter so this folder is usable in Claude Code
colors_and_type.css        ← MASTER token file (primitives → semantic → component, light + dark)
assets/
  logo/                    ← GAAhex logos: full, reversed, mono, standalone mark, app icons
preview/                   ← Design System tab cards (colors, type, spacing, components, ISP status…)
ui_kits/
  portal/                  ← the GAAhex operations console UI kit (the only product surface)
    README.md              ← what's covered, how to compose screens
    index.html             ← interactive click-through: login → dashboard → work items → studio
    *.jsx                  ← Sidebar, TopBar, KPI tiles, DataTable, StatusPill, Studio, etc.
```

### How to use
1. Link `colors_and_type.css` and set `data-theme="dark"` (or `"light"`) on `<html>`.
2. Pull components from `ui_kits/portal/`.
3. Use semantic tokens (`var(--gx-primary)`, `var(--gx-surface)`…) — never raw primitives — so both
   themes work automatically.
4. Reserve **gold** for prestige; reach for **azure** for anything interactive.

> **Want higher fidelity?** Browse `ohanyan88-cmd/GAAhex` — `frontend/src/views/` has all ~190
> pages' real logic, and `StudioView.tsx` shows how config becomes UI.

---

## 6 · Caveats & font substitution
- **Fonts are Google-hosted** (Space Grotesk · IBM Plex Sans · IBM Plex Mono) via `@import`. The repo
  shipped no font files, so these are *chosen*, not extracted. Swap in licensed/self-hosted files if
  you prefer; the token names won't change.
- **Icons** use Lucide (CDN) as a stand-in for the repo's stroke-identical custom set — see §4.
- **D18-aligned, palette locked 2026-06-04. See `docs/standards/09-design-system-standards.md` D18 family table for canonical token names; this workspace mirrors that.**
