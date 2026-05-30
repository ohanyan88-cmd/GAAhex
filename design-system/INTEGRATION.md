# Applying the GAAex Design System to your `ohanyan88-cmd/Portal` repo

This design system is **standalone** (tokens + CSS + reference UI kit). Your Portal app is
**React + TypeScript + Vite** (`frontend/`). You don't replace your app — you **swap its visual
foundation** and lift components/patterns from the kit. Here's the practical path.

---

## TL;DR (the 15-minute version)
1. Copy **`colors_and_type.css`** → `frontend/src/styles/gaaex-tokens.css`.
2. Import it once at the top of `frontend/src/main.tsx` and set `data-theme="dark"` on `<html>`.
3. Point your existing `frontend/src/styles/color-tokens.css` variables at the new `--gx-*` tokens
   (or delete it and find/replace old token names → new ones).
4. Copy the **logos** in `assets/logo/` → `frontend/public/logo/` (overwrite).
5. Re-skin components by referencing `ui_kits/portal/*.jsx` — same class patterns, your TSX.

---

## Step 1 — Drop in the tokens
Copy `colors_and_type.css` from this project into your repo:
```
frontend/src/styles/gaaex-tokens.css
```
It defines every `--gx-*` variable (colors, type, spacing, radius, shadow, motion) for **both
themes**, plus the `@import` for the three Google fonts.

## Step 2 — Load it once, globally
In `frontend/src/main.tsx` (or wherever you import global CSS), add it **first** so its variables are
available everywhere:
```ts
import './styles/gaaex-tokens.css'
import './styles/styles.css' // your existing global sheet, now free to use var(--gx-*)
```
Set the default theme on the document (in `index.html` or a `useEffect`):
```html
<html lang="en" data-theme="dark">
```
Theme switching = set `document.documentElement.dataset.theme = 'light' | 'dark'`.

## Step 3 — Reconcile with your current tokens
Your repo already ships `frontend/src/styles/color-tokens.css` (the old GLASS palette). Two options:

**A. Clean swap (recommended).** Delete `color-tokens.css` and update references. Most names map
directly; the new system is richer. Typical replacements:
| Old (yours) | New (`--gx-*`) |
|---|---|
| brand blue / primary | `var(--gx-primary)` (azure) |
| page background | `var(--gx-bg)` |
| card / panel | `var(--gx-surface)` |
| border | `var(--gx-border)` |
| text / muted | `var(--gx-text-1)` / `--gx-text-2` / `--gx-text-3` |
| success/warn/error | `var(--gx-success)` / `--gx-warning` / `--gx-danger` |
| network online/offline | `var(--gx-online)` / `--gx-offline` / `--gx-degraded` |

**B. Alias bridge (zero churn).** Keep your old variable names but re-point them:
```css
:root {
  --color-primary: var(--gx-primary);
  --color-bg:      var(--gx-bg);
  --color-surface: var(--gx-surface);
  /* …map the rest… */
}
```
Your components keep their old class names; only the values change. Fastest, least risky.

## Step 4 — Brand assets
Copy from this project's `assets/logo/` into `frontend/public/logo/` (overwrite):
- `GAAex-logo-reversed.svg` (dark UIs), `GAAex-logo-cobalt-gold.svg` (light), `GAAex-mark.svg`
  (favicon/avatars). Point `frontend/public/favicon/` at `GAAex-mark.svg`.

## Step 5 — Re-skin components from the kit
The kit in `ui_kits/portal/` is the **visual spec** for your real components. It's plain React+CSS,
but the class system maps 1:1 to what you'll put in your TSX:

| Your component | Lift from |
|---|---|
| Sidebar / module nav | `Shell.jsx` → `.sb`, `.sb-item`, gold active rail |
| Top bar / command palette | `Shell.jsx`, `Login.jsx` (`CommandPalette`) |
| Tables / list views | `renderers.jsx` (`EntityPage`) → `table.grid`, sort, bulk bar, pagination |
| Record detail | `renderers.jsx` (`RecordDrawer`) → `.gx-drawer`, tabs |
| Kanban | `renderers.jsx` (`KanbanGeneric`) → `.board-grid`, `.board-card` |
| Dashboards | `renderers.jsx` (`ModuleDashboard`, `Donut`, `LineChart`) |
| Studio | `Studio.jsx` (`EntityBuilder`, `AppearancePane`) |
| Messenger / Email | `comms.jsx` |
| Buttons/inputs/pills/toasts/modals | `app.css` (`.btn`, `.inp`, `.pill`, `.gx-toast`, `.gx-dialog`) |

Copy the relevant blocks from `ui_kits/portal/app.css` into your stylesheet (they only use `--gx-*`
tokens, so they theme automatically). Then apply the classes in your existing TSX components — you do
**not** need to copy the kit's `.jsx` logic; your app already has the real data wiring.

## Step 6 — Icons & fonts
- **Icons:** the kit uses **Lucide**. In your app: `npm i lucide-react` and replace your
  `icons.tsx` glyphs with `<RouterIcon size={16} />` etc. They're stroke-identical, so visuals match.
- **Fonts:** Space Grotesk · IBM Plex Sans · IBM Plex Mono load via the `@import` in the token file.
  For production, self-host them (download from Google Fonts, add `@font-face`) and drop the import.

---

## Getting these files out of this project
Use the **download** card I'll provide (or in the project menu, export the whole project as a zip).
The pieces you need for the repo:
```
colors_and_type.css        → frontend/src/styles/gaaex-tokens.css
assets/logo/*              → frontend/public/logo/
ui_kits/portal/app.css     → copy the class blocks you use
ui_kits/portal/*.jsx       → reference while re-skinning your TSX
README.md / SKILL.md       → keep as design docs
```

## Working with an AI agent in the repo
This folder doubles as an **Agent Skill** (`SKILL.md` + `README.md`). Drop the whole design-system
folder into your repo (e.g. `design-system/`) and, in Claude Code, point the agent at it:
> "Read `design-system/README.md` and `SKILL.md`, then re-skin `frontend/src/views/BillingView.tsx`
> using the GAAex tokens and the patterns in `design-system/ui_kits/portal/`."
The agent will have the full token reference, voice/visual rules, and component patterns to apply your
brand consistently across all 18 modules.

---

### Caveats
- Fonts & Lucide are choices, not extracted from your repo — self-host fonts for production.
- The kit's data is illustrative; your app keeps its real `studio_config`-driven wiring.
- Test both themes after the swap (`data-theme="light"` keeps a brand-dark sidebar by design).
