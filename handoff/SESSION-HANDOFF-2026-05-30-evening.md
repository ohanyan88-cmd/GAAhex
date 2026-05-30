# Session handoff — 2026-05-30 evening

> Account switch in progress. Memory will be wiped by `/login`. Repo is source of truth.
> Read this → check agent status → push when Gev says go.

## The job

Gev wants every uncommitted branch **pushed to `ohanyan88-cmd/Portal` origin** once all in-flight agents complete AND after he's done the account switch. **Do NOT push before he confirms he's back.**

## Branches in play

| Branch | Off | What's on it | Agents | Push target |
|---|---|---|---|---|
| `main` | origin/main | 40 commits ahead (multi→single tenant, topbar consolidation, calendar fix, ~700 lines layered CSS cleanup) | done | origin/main |
| `studio/superadmin-builder` | main | Studio P1+P2+P3 (shell + 15-group tree + 9-layer Overview) + kit reference files | done | new origin branch |
| `topbar/redesign` | main | Topbar P1-P6 (delete old, new layout, OrgIdentity + logo_url, NotificationBell rebuild, UserMenu with theme+lang inside, verify) | **in flight** | new origin branch |
| `home/wire-real-data` (worktree) | main | Home P1-P3 (wire real data; build /api/metrics/revenue; delete uptime; perm-scope; every button real; verify) | **in flight** | new origin branch |
| `mytasks/redesign` (worktree) | main | MyTasks P1-P4 (extract WorkItemsTable/Board components; fork MyTasksView; "N open · M overdue" using due_at not SLA; verify) | **in flight** | new origin branch |

## In-flight agents (background)

When resuming, run `TaskList` to see status. Agent IDs (for SendMessage if needed):
- Topbar P1-P6: was `topbar/redesign` branch, dispatched ~16:25 local
- Home P1-P3: in worktree, branch `home/wire-real-data`
- MyTasks P1-P4: in worktree, branch `mytasks/redesign`

The harness auto-notifies when each completes (you'll see `<task-notification>` blocks). **Do NOT poll** — wait.

## Push plan

Once all 3 agents complete AND Gev says go:

```bash
cd C:/Users/Admin/Desktop/Portal
git push origin main                              # 40 commits → already-tracked branch
git push -u origin studio/superadmin-builder      # new branch
git push -u origin topbar/redesign                # new branch
git push -u origin home/wire-real-data            # new branch
git push -u origin mytasks/redesign               # new branch
```

Verify each push with the returned PR-creation URL. Optionally `gh pr create` each branch as a draft PR for Gev's review (ask before doing).

**Do NOT push --force, --no-verify, or bypass hooks.** Don't push main to a non-existent branch — it tracks origin/main already.

## Locked decisions made this session (don't re-ask)

- **Multi → single tenant: Option A** (kept tenant_id columns, hardcoded resolution via env→cache→DB). Already on `main`.
- **Studio**: SuperAdmin = `can_configure`; old 21-leaf nav collapsed to single entry; old StudioView deleted; scope P1+P2+P3.
- **Topbar**: language switcher INTO user menu; Configure button INTO each view's `view-head`; OrgIdentity wired to `/api/tenant/settings` + new `logo_url` column; inline popover; rebuild NotificationBell using existing NotificationCenter API helpers.
- **Home**: build `/api/metrics/revenue` endpoint in P1; delete Uptime tile (no source); perm-scope MRR + chart on `billing.view`/`invoice.view`; remove Export + View-all (inert).
- **MyTasks**: fork MyTasksView + extract shared WorkItemsTable/WorkItemsBoard presentational components (no copy-paste); SLA out of scope, use `due_at` as "overdue" (NOT "SLA"); delete tabs; delete inert buttons.

## Outstanding tasks (post-push)

- Task #4 — **full deep audit (front+back, visual+non-visual)**. Gev's "100000000000 times" ask. Still pending.
- Studio prompts file has P4 (rich builders), P5 (archetype panes ~256 leaves), P6 (wire to platform), P7 (QA). Multi-day work. Not started.
- Topbar P6 verify writes `handoff/TOPBAR-PROMPT-6-VERIFY.md` — read that report when triaging.
- Home P3 verify writes `handoff/HOME-PROMPT-3-VERIFY.md`.
- MyTasks P4 verify writes `handoff/MYTASKS-PROMPT-4-VERIFY.md`.

## Resume protocol when Gev returns

1. He'll say something brief like "back" or "continue".
2. Run `TaskList` + `git status` + `git branch` to confirm state.
3. If any of the 3 agents are still in flight, **wait** (you'll get auto-notifications).
4. If all done, propose the push plan above and wait for explicit "push" / "go".
5. Push, then surface the verify reports + PR URLs.

## Memory notes

- The prompts-file workflow pattern is now saved as a memory (created today): `feedback-prompts-workflow.md`. Should auto-load when the next CLAUDE_CODE_*_PROMPTS.md drops.
- All Gev's core memories are in `C:\Users\Admin\.claude\projects\C--Users-Admin\memory\` — `/login` wipes them. The repo is the source of truth.

— Ընգեր
