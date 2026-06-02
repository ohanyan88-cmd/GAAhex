# Using Claude Code to apply the GAAhex Design System to `ohanyan88-cmd/Portal`

A start-to-finish workflow. You'll (A) get these design files into your repo, (B) open Claude Code,
(C) run a sequence of copy-paste prompts that reskin the app module by module.

---

## A · Get the design system into your repo

1. **Download this project** (the download card in chat, or the project menu → export zip).
2. Unzip it and copy the whole folder into your repo as **`design-system/`**:
   ```
   Portal/
     design-system/         ← paste here
       README.md
       SKILL.md
       INTEGRATION.md
       colors_and_type.css
       assets/logo/…
       ui_kits/portal/…
     frontend/
     …
   ```
3. Commit it on a new branch so everything is reversible:
   ```bash
   git checkout -b feat/gaahex-reskin
   git add design-system && git commit -m "Add GAAhex design system reference"
   ```

> Why a folder in the repo? Claude Code can only read files it can see. With `design-system/` in the
> tree, every prompt below can point at the real tokens, rules, and component patterns.

---

## B · Open Claude Code

```bash
cd Portal
claude            # or: npm i -g @anthropic-ai/claude-code  then  claude
```
(If you use the Claude Code VS Code extension, just open the `Portal` folder.)

First, let it read the system so it has full context:

> **Prompt 0 — orient**
> Read `design-system/README.md`, `design-system/SKILL.md`, and `design-system/INTEGRATION.md`.
> Then read `design-system/colors_and_type.css` and `design-system/ui_kits/portal/app.css`.
> Summarize the token system and the plan to reskin this app, then wait for my go-ahead.

---

## C · Run the reskin, step by step

Do these **in order**, committing after each. Review the diff before moving on.

### 1 — Install the tokens globally
> **Prompt 1**
> Copy `design-system/colors_and_type.css` to `frontend/src/styles/gaahex-tokens.css`.
> Import it FIRST in `frontend/src/main.tsx`. Set `data-theme="dark"` on the `<html>` element in
> `frontend/index.html`. Don't change anything else yet. Show me the diff.

### 2 — Bridge the old tokens (low-risk reskin)
> **Prompt 2**
> Read `frontend/src/styles/color-tokens.css` (my current GLASS palette). Create an alias bridge:
> keep every existing variable name but re-point its value to the matching `--gx-*` token from
> `gaahex-tokens.css` (e.g. my primary → `var(--gx-primary)`, my background → `var(--gx-bg)`,
> surfaces → `var(--gx-surface)`, borders → `var(--gx-border)`, text → `var(--gx-text-1/2/3)`,
> success/warn/error and network online/offline/degraded accordingly). Where I have no equivalent,
> leave it. Output the new `color-tokens.css`. The app should now look reskinned with zero component
> edits — confirm it builds and screenshot a couple of views.

### 3 — Swap brand assets
> **Prompt 3**
> Copy `design-system/assets/logo/*` into `frontend/public/logo/` (overwrite). Point the app's logo
> usages at `GAAhex-logo-reversed.svg` (dark UI) and the favicon at `GAAhex-mark.svg`. Show diff.

### 4 — Adopt the component classes (per area)
Reskin one surface at a time, using the kit as the visual spec. Repeat this prompt for each:

> **Prompt 4 (repeat per component/view)**
> Reskin `frontend/src/components/Sidebar.tsx` to match `design-system/ui_kits/portal/Shell.jsx`
> and the `.sb*` rules in `design-system/ui_kits/portal/app.css`: collapsible sections, 18 modules,
> gold active-item rail, the mark when collapsed. Copy the needed CSS rules into our stylesheet
> (they only use `--gx-*` tokens). Keep my existing data/routing wiring — only change markup/classes
> and styles. Build and screenshot.

Good order to repeat Prompt 4 for:
1. `Sidebar` + `TopBar` (shell) → `Shell.jsx`
2. Buttons / inputs / pills / badges (shared primitives) → `app.css` `.btn/.inp/.pill`
3. Data tables / list views → `renderers.jsx` `EntityPage` (`table.grid`, sort, bulk bar, pagination)
4. Record detail → `RecordDrawer` (`.gx-drawer`)
5. Dashboards → `ModuleDashboard`, `Donut`, `LineChart`
6. Studio → `Studio.jsx` (`EntityBuilder`, `AppearancePane`)
7. Messenger / Email / Calendar → `comms.jsx`, `renderers.jsx`
8. Toasts / modals / menus (global) → `app.css` `.gx-toast/.gx-dialog/.menu`

### 5 — Icons
> **Prompt 5**
> Install `lucide-react`. Replace the hand-rolled glyphs in `frontend/src/components/icons.tsx` with
> Lucide equivalents (router, server, radio, wifi, activity, gauge, network, cable, satellite-dish,
> etc. — they're stroke-identical). Keep the same export names so call sites don't change.

### 6 — Fonts for production
> **Prompt 6**
> Self-host Space Grotesk, IBM Plex Sans, IBM Plex Mono: add the font files under
> `frontend/public/fonts/`, add `@font-face` rules, and remove the Google Fonts `@import` from
> `gaahex-tokens.css`. Confirm the families still resolve.

### 7 — Verify both themes
> **Prompt 7**
> Run the app. Click through Home, CRM, Support→Work Items, Billing→Invoices, Network→Topology,
> Communications→Messages, and Studio in BOTH `data-theme="dark"` and `"light"`. Fix any contrast or
> spacing regressions against the design-system tokens. List anything you changed.

---

## D · Wrap up
```bash
git add -A && git commit -m "GAAhex Cobalt & Gold reskin"
git push -u origin feat/gaahex-reskin
```
Open a PR, review screenshots, merge.

---

## Tips
- **Go module by module**, commit often — easy to review and revert.
- If a screen looks off, tell Claude Code: *"compare against `design-system/ui_kits/portal/…` and
  match spacing/colors exactly."* The kit is the source of truth.
- Keep `design-system/` in the repo permanently — it's also an **Agent Skill** (`SKILL.md`), so any
  future Claude Code session can design new screens on-brand.
- You don't ship the kit's `.jsx` — it's the **reference**. Your TSX keeps its real
  `studio_config`-driven data wiring; only markup/classes/styles change.
