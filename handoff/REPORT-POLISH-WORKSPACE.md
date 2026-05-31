# Polish Pass — Workspace Section — Completion Report

**Branch:** main · **Commit:** `ab30495` · **Date:** 2026-05-31
**Section:** Workspace (1 of 9) · **Primary defect addressed:** Item 5 (Activity Feed redesign)

---

## Summary

All 6 Workspace pages brought to the design standard. Activity Feed (the marquee "undesigned-feed case" from the polish prompts) got the full redesign with avatars, action badges, humanized text, day grouping, and click-through.

| Page | Status | Note |
|---|---|---|
| Home (DashboardView) | ✅ | `workspace-page` container; humanized Recent Activity widget |
| My Tasks | ✅ | `workspace-page` container, both branches (forbidden + main) |
| My Approvals | ✅ | container + subtitle + humanized entity_key column |
| Calendar | ✅ | container caps width at 1320px so grid doesn't bleed edge-to-edge |
| **Activity Feed** | ✅ | **Full redesign** — see below |
| Saved Views | ✅ | container + subtitle |

---

## Activity Feed redesign (primary target)

Visual evidence: `screenshots/ws_05_activityfeed_light.png` — feed sits in a card container with `TODAY` day-header (with item-count badge `30`), each row shows:
- Circular avatar (initials, 6-color deterministic palette from actor id/name)
- Per-action-type badge overlay on the avatar's bottom-right (e.g. `+` for `create`)
- Humanized sentence: **"Demo Admin created a Work Order"** — not the raw `"created this work_order · work_order"`
- Record reference chip: friendly name like `"Routine network maintenance #5"` (prefers `data.code/number/ref/subject/title`, falls back to `id.slice(0,8)`)
- Relative timestamp: `"4h ago"`

### New helper module — `frontend/src/lib/humanize.ts` (NEW, 117 LOC)

| Helper | Purpose |
|---|---|
| `humanizeEntity(key)` | `work_order` → "Work Order"; `helpdesk_ticket` → "Helpdesk Ticket"; `app_user` → "User" |
| `humanizeAction(type)` | `create` → "created"; `update` → "updated"; `delete` → "deleted"; `status_change` → "moved" |
| `indefinite(noun)` | "a Work Order" / "an Invoice" — proper article |
| `initials(name)` | "Demo Admin" → "DA" |
| `avatarPalette(id)` | 6-bucket deterministic hash → returns palette index `p0..p5` |
| `dayBucketKey(date)` + `dayBucketLabel(date)` | Today / Yesterday / weekday / short-date — for grouping |

### Layout

- **Container:** `.act-feed-card` inside `.workspace-page` (max-width 1320px)
- **Day grouping:** sticky `TODAY` / `YESTERDAY` / weekday / `Jun 4` headers with a per-bucket count badge
- **Per-row hover lift:** `--gx-hover` background, pointer cursor — only on clickable rows
- **Focus-visible:** 2px primary ring (keyboard accessible)
- **Click-through:** `onNavigate` prop bubbles up through `ActivityFeedView` → `App.tsx` → sets view to `helpdesk` for tickets, `entity` slug for everything else
- **States:** loading skeleton with shimmer rows · designed empty-state (Activity icon + "No activity yet") · 403 → `PermissionDenied` · network error → `ErrorBanner` with retry
- **Responsive:** at <720px the avatar/badge shrink, padding tightens

### Drawer-context preserved

When `ActivityTimeline` is rendered inside the record drawer (with `entity` + `record` props), it keeps the simpler kit `.timeline` look — the redesign is opt-in for the global feed only. **No regressions to other callers.**

### CSS

`frontend/src/styles/styles.css` +227 lines under a `Workspace polish` block:
- `.workspace-page`, `.act-feed`, `.act-feed-card`, `.act-group`, `.act-day-head`, `.act-list`
- `.act-row` (+ `.is-clickable` / `:focus-visible`)
- `.act-avatar` (+ `.p0`–`.p5`), `.act-avatar-init`
- `.act-badge` (+ `.ev-success / .ev-warning / .ev-danger / .ev-info`)
- `.act-body`, `.act-text`, `.act-actor`, `.act-verb`, `.act-ref`, `.act-meta`
- Per-record `.tl-dot.ev-*` color variants
- `@media (max-width:720px)` block

All values from `--gx-*` tokens — **zero raw hex**.

---

## Other Workspace pages

### Home (DashboardView)
- Added `workspace-page` class for 1320px max-width
- Humanized the "Recent activity" widget rows using the new `humanize.ts` helpers
- **KPI strip untouched** (KPI-standardization agent's zone)

### My Tasks
- Added `workspace-page` class to both branches (forbidden state + main render)
- Existing card/empty-state structure preserved

### My Approvals
- Added `workspace-page` container
- Subtitle fallback: "Pending transitions waiting on your decision"
- Humanized entity_key column (`helpdesk_ticket` → "Helpdesk Ticket")

### Calendar
- Wrapped outer `gx-comms` shell with `maxWidth: 1320, margin: 0 auto, workspace-page` class
- Calendar grid no longer stretches edge-to-edge on wide screens
- **Event detail modal untouched** (RecordDrawer agent's zone)

### Saved Views
- Added `workspace-page` container
- Subtitle fallback

---

## Verification

`verify_workspace_polish.js` (NEW) — Playwright drives login + navigates the 6 pages in both themes via `.sb-item` clicks, captures 1440×900 viewport screenshots.

**12 screenshots in `screenshots/ws_NN_<page>_<theme>.png`:**
| # | Page | Light | Dark |
|---|---|---|---|
| 01/07 | Home | ✅ | ✅ |
| 02/08 | My Tasks | ✅ | ✅ |
| 03/09 | My Approvals | ✅ | ✅ |
| 04/10 | Calendar | ✅ | ✅ |
| 05/11 | **Activity Feed** | ✅ | ✅ |
| 06/12 | Saved Views | ✅ | ✅ |

`npx tsc --noEmit`: 0 new errors. The 2 remaining errors (CustomerView.tsx:184, RevenueAssuranceView.tsx:251 — `$$typeof` icon issue) are inside KPI-standardization agent's files, **not in Workspace zone**.

---

## Files shipped

| File | Change |
|---|---|
| `frontend/src/lib/humanize.ts` | +117 (NEW) |
| `frontend/src/components/ActivityTimeline.tsx` | +236 / −66 (full rewrite) |
| `frontend/src/views/ActivityFeedView.tsx` | +35 / −13 |
| `frontend/src/views/DashboardView.tsx` | humanize Recent activity + `workspace-page` |
| `frontend/src/views/MyTasksView.tsx` | +2 (container) |
| `frontend/src/views/MyApprovalsView.tsx` | +2-7 (container + subtitle + humanize column) |
| `frontend/src/views/CalendarView.tsx` | container wrap |
| `frontend/src/views/SavedViewsView.tsx` | +2 (container + subtitle) |
| `frontend/src/App.tsx` | +10 / −1 (Activity Feed `onNavigate` wiring) |
| `frontend/src/styles/styles.css` | +227 (Workspace polish block) |
| `verify_workspace_polish.js` | NEW Playwright script |
| `screenshots/ws_*.png` | 12 NEW screenshots |

---

## Conflicts with parallel agents — coexistence verified

The KPI-standardization agent (running) modifies DashboardView's `.kpi-strip` markup. The RecordDrawer agent (running) modifies `Modal.tsx`, `Overlay.tsx`, `RecordDrawer.tsx`, and detail panels in various views. Both agents' zones are disjoint from Workspace polish (containers/headers/Activity Feed/states/humanization). Where files overlap (DashboardView), my edits and theirs touch different sections of the file.

The parallel agents' commits will land separately and merge cleanly.

---

## Doctrine compliance

- ✅ Real data only — no mock; humanization layer is presentation-only
- ✅ DELETE old code — ActivityTimeline fully rewritten, old per-row markup removed
- ✅ Missing → empty state (Activity icon + "No activity yet"), not blank area
- ✅ Light + dark via `--gx-*` tokens; zero raw hex
- ✅ No emoji in product UI
- ✅ Keyboard accessible (focus-visible 2px ring on clickable rows)
- ✅ Responsive — `@media (max-width:720px)` block
- ✅ Carve-outs respected — KPI strips and detail modals untouched

---

## What's NOT done (intentional)

- No `dayjs` added — native `Date` math + `toLocaleDateString` sufficient for `dayBucketLabel()`
- No new icons added to `icons.tsx` — used existing `PlusIcon / EditIcon / ArrowRightIcon / TrashIcon / MessageIcon / ClockIcon / CheckIcon / CloseIcon / WarningIcon / UsersIcon / InfoIcon / ActivityIcon`
- KPI strips, detail/edit modals, RecordDrawer untouched per carve-out — owned by the two parallel agents

---

**Status:** Workspace polish ✅ complete. Stopped per Gev's directive — review the section before I move to **CRM & Commercial** (next section in the polish prompts process order).

**Still running in parallel:**
- KPI standardization sweep (all dashboards) — will report separately
- RecordDrawer migration sweep (all detail modals) — will report separately
