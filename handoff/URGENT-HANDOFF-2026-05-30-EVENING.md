# URGENT HANDOFF — 2026-05-30 evening (account switch)

> Gev hit usage limit mid-session. EVERYTHING IS PUSHED. Pick up here after `/login`.

## ✅ Pushed to origin (github.com/ohanyan88-cmd/Portal)

| Branch | HEAD | What's on it |
|---|---|---|
| `main` | `79300a7` | multi→single tenant + topbar consolidation + ~700 lines CSS cleanup + calendar fix |
| `studio/superadmin-builder` | `418a97c` | Studio P1 shell + P2 15-group tree + P3 9-layer Overview + kit reference files |
| `topbar/redesign` | `585be39` | Topbar P1-P6 (search/Create/theme/help gone, OrgIdentity wired to `/api/tenant/settings + logo_url`, NotificationBell rebuild, UserMenu with theme+lang+profile sub-view) + Shell.jsx kit ref |
| `home/wire-real-data` | `2021006` | Home P1 (real data wired) + P2 (buttons real). **P3 verify was still in flight when push happened — re-run if needed.** |
| `mytasks/redesign` | `0394f3f` | MyTasks agent was MID-WORK at push time (HEAD = topbar's P6). **WORK IN WORKTREE IS UNCOMMITTED + NOT PUSHED. Check `.claude/worktrees/agent-adc38d1ee476b46eb/` when resuming.** |

## ⚠️ 3 agents were IN FLIGHT at push time

| Agent | Task ID | Branch | State |
|---|---|---|---|
| Seed-fix + Topbar P6 verify | `#18` | `topbar/redesign` (main checkout) | unknown — wasn't done at push |
| Home P1-P3 | `#16` | `home/wire-real-data` (worktree) | P1+P2 committed; P3 in flight |
| MyTasks P1-P4 | `#17` | `mytasks/redesign` (worktree) | no commits yet — likely still extracting shared components |

When resuming: run `TaskList` + `git fetch --all` + check each branch with `git log --oneline -10` to see if any new commits landed AFTER this handoff push. If yes, push them.

## Locked decisions to preserve across `/login`

The memory file `feedback-prompts-workflow.md` was saved earlier this session — should still load. Plus these:

- **Multi → single tenant Option A**: kept tenant_id columns, hardcoded resolution via env→cache→DB. NO UUID literal anywhere.
- **Studio**: SuperAdmin = `can_configure`; old 21-leaf nav collapsed; old StudioView deleted; only P1-P3 done. P4-P7 NOT started (rich builders + ~256 archetype leaves + wiring + QA).
- **Topbar**: language INTO user menu; Configure button INTO each view's `view-head` (20 views have the gear; CalendarView + OutboundView accept the prop but have no `.view-head` yet — flagged in `handoff/TOPBAR-PROMPT-6-VERIFY.md`).
- **Home**: build `/api/metrics/revenue` endpoint; delete Uptime tile; perm-scope MRR + chart; remove Export + View-all.
- **MyTasks**: fork MyTasksView + extract `WorkItemsTable`/`WorkItemsBoard` presentational components that BOTH MyTasks AND WorkItems consume. SLA OUT — use `due_at` as "overdue" not "SLA".

## Pending issues to address (in priority order)

1. **Seed crash** — backend boot fails on `uq_permission_def_key` duplicate `request.view`. Seed-fix agent #18 was assigned but state at push time is unknown. Required: root-cause de-dupe + `ON CONFLICT (key) DO NOTHING` defense. Gev's exact words: *"don't just paper over a real double-insert"*.

2. **Topbar P6 live verification** — deferred because of seed crash. After seed fix: verify RBAC gate + sign-out flow in running app. Update `handoff/TOPBAR-PROMPT-6-VERIFY.md`.

3. **DashboardView + WorkItemsView reconciliation** — three branches have their own versions:
   - `topbar/redesign`: has `onConfigure` prop wired
   - `home/wire-real-data`: has full data wiring + perm scope
   - `mytasks/redesign`: WorkItemsView refactored to use new shared components (when MyTasks agent completes)

   When merging back to main: take Home's DashboardView (incorporates topbar's `onConfigure`); take MyTasks' refactored WorkItemsView (which should already have topbar's `onConfigure` from the brief). Verify nothing's lost.

4. **CalendarView + OutboundView need a `.view-head`** to surface the Configure-page gear. Currently they accept the prop but have no header surface.

5. **Going forward (Gev's directive)** — ONE page agent at a time. No more parallel page work. Each on own branch, merged sequentially.

## Resume protocol when Gev returns

1. He'll say something brief like "back", "continue", "resumed".
2. Run `TaskList` to see in-flight + completed work.
3. Run `git fetch --all && git branch -av` to confirm origin state.
4. Run `git log --oneline -5` on each feature branch to see if anything committed AFTER this handoff.
5. If any agent's worktree has uncommitted progress, decide whether to recover it (may be partial).
6. **Resume with the seed crash fix as first priority** — nothing else can be verified until backend boots.
7. Per Gev's directive: NO more parallel page agents going forward.

## Bottom line

EVERYTHING IS PUSHED. Worst case: lose the in-worktree-only uncommitted MyTasks progress (which agent #17 was building when push happened). The Studio (P1-P3), Topbar (P1-P6), and Home (P1-P2) work is FULLY on origin.

— Ընգեր
