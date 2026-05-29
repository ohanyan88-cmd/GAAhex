# SESSION HANDOFF — resume point

> Owner = Gev (calls me Ընգեր). Mode = ORCHESTRATOR: delegate ALL building to in-window agents.
> Read this → `git pull` → `git status` → continue.
> Repo: `ohanyan88-cmd/GAA`. Demo login: `admin@demo.isp` / `admin123`.
> Run: `docker compose up -d` → `cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099` → `cd frontend && npm run dev`

## ✅ All 5 handoff tasks DONE (2026-05-29, HEAD 3f0f2cf)
1. Storybook stories — all 7 primitives + Colors/Spacing/Typography galleries (commit 352e9a6)
2. Sidebar nav section-header color fix (commit fc28421)
3. Org structure-editing UI — kebab + Add/Rename/Move/Delete modals on org-nodes CRUD (commit 6160a63)
4. Org node-card polish — StatusPill + Span/Headcount KPI chips (commit 8eeb268)
5. Org analytical views — Network (force-directed), Heatmap, Timeline, RACI; hand-rolled SVG, no new deps (commit 3f0f2cf)

Org module now has **13 view modes**. RACI uses an honest empty state until a "RACI" custom field is configured.
**Next big arc:** continue the DESIGN reskin (adopt primitives/tokens across the rest of the app — see `../DESIGN` prototype).

---
## (Original handoff — completed, kept for reference)

## State at handoff

- Branch `main`, everything committed + pushed. Working tree is CLEAN.
- **Appearance/palette system fully deleted**: GX_PALETTES, gxPalette state, data-gx-palette/theme setters, Appearance section from profile menu, all palette CSS, all 10-palette color-token blocks — gone.
- **Token system extended** in `frontend/src/color-tokens.css`: spacing (--gx-space-*), radius (--gx-radius-*), typography (--gx-text-*, --gx-tracking-*, --gx-leading-*, --gx-weight-*), shadow (--gx-shadow-*), motion (--gx-duration-*, --gx-ease-*), z-index, component tokens (--gx-btn-height-*, --gx-input-height-*, --gx-btn-px-*)
- **Tailwind extended** in `frontend/tailwind.config.js` with gx-* spacing, radius, fontSize, boxShadow, transitionDuration
- **Primitives built** in `frontend/src/primitives/`: Button, StatusPill, Input, FormField, KPITile, DataTableCell, DataTableRow + index.ts barrel
- **Storybook installed** (packages in package.json, .storybook/ config exists) — stories NOT yet written
- **Org module**: 9 view modes in OrgView.tsx. Backend CRUD for org nodes done. Structure-editing UI (Task #47 frontend) NOT committed this session.

## TASKS — do in order, one agent per task

### TASK 1 — Write Storybook stories
Stories go in `frontend/src/primitives/stories/`. The .storybook/preview.tsx already loads color-tokens.css + styles.css and has dark/light theme toggle.

Write these files:
- `Button.stories.tsx` — stories: Primary, Secondary, Ghost, Danger, Link, WithIcon (leftIcon=Plus), Loading, Disabled, Sizes (sm/md/lg side by side)
- `StatusPill.stories.tsx` — AllVariants grid (active/degraded/critical/neutral/info × sm/md)
- `Input.stories.tsx` — Default, Search variant, Password (with show/hide), Numeric, WithError, Disabled, Sizes (sm/md/lg)
- `FormField.stories.tsx` — Default, WithHint, WithError, Required
- `KPITile.stories.tsx` — Default (Users icon, value 14287, delta +2.4%), Loading, WithError, Sizes (sm/md/lg)
- `DataTableRow.stories.tsx` — Default, Selected, Density sm vs md
- `stories/Colors.stories.tsx` — color swatches for every --gx-* token grouped by category
- `stories/Spacing.stories.tsx` — bars showing each --gx-space-* value with px label
- `stories/Typography.stories.tsx` — sample text at each --gx-text-* size

Each story uses `import type { Meta, StoryObj }` from `@storybook/react`. After writing, run `npm run storybook` to verify no errors.

### TASK 2 — Fix sidebar nav section header text color
In `frontend/src/styles.css`, find `.nav-section-header` and ensure `color: var(--sidebar-text)` — same as `.nav` items. Currently section headers may inherit body color instead. Also check `.nav-section-icon` — opacity should not make icons dimmer than text. Fix and verify in browser.

### TASK 3 — Org module: Task #47 (structure-editing UI)
The backend is done (`backend/app/routers/org_nodes.py` — POST/PATCH/DELETE /api/org/nodes).
Build the frontend structure-editing UI in `frontend/src/OrgView.tsx`:
- Replace the no-op NodeKebab with a real dropdown: Rename / Add child / Move / Delete
- Add "Add node" button in the view header
- Four modals: AddNode (type+name+code), Rename, Move (searchable select, blocks cycles), Delete (409 handling)
- Add `onRefresh: () => Promise<void>` prop, wire in App.tsx: `onRefresh={async () => setOrgNodes((await orgTree()).nodes)}`
- All CSS goes in `frontend/src/styles.css`
- TypeScript clean, build passes

### TASK 4 — Org module: Task #48 (node-card polish)
In `frontend/src/OrgView.tsx`:
- Kebab dropdown should be real (from Task 3 above — verify)
- Add status pills to node cards using the StatusPill primitive from `src/primitives/`
- Add KPI chips (headcount from custom field, span of control count) to node cards in Hierarchy and Cards layouts

### TASK 5 — Org module: Task #46 (remaining analytical views)
Add to `frontend/src/OrgView.tsx`:
- Network graph (force-directed, React-18-compatible lib — pick one that works with Vite)
- Heatmap (color nodes by metric: descendant count or headcount custom field)
- Timeline (v1 — horizontal, nodes sorted by depth, placeholder for live data)
- RACI Matrix — ASK Gev before building this one

### After each task: build passes → commit → push. ONE agent per task.

## Working rules
- Delegate every build to an in-window agent. Brief it fully. Verify (tsc + browser) before commit.
- OrgView.tsx is the frontend bottleneck — ONE agent at a time touching it.
- No "Co-Authored-By" in commits.
- Don't surface the HDD-backup rule (project-scoped, not this repo).
