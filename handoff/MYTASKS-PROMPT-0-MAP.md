# MyTasks P0 — Current page + real sources

**Current file:** `frontend/src/views/WorkItemsView.tsx` (1059 lines). Mounted at `App.tsx:554-555` for `view.type === 'workitems'`. Nav: `ws-my-tasks` (line 45 of `nav-config.ts`).

## 1. Current behavior vs new spec

WorkItemsView today renders ALL workitems (server-side fetch loads everything; "Mine" tab is client-side filter). The new spec demands ONLY current user's tasks. The backend `GET /api/workitems?mine=true` already exists and correctly filters server-side at `routers/workitems.py:118` (`assigned_user_id == user.id` after tenant + grants check).

**Patch in place** is feasible: WorkItemsView stays as the file; default `mine: true`, drop the tabs, simplify header. OR **fork** to a new `MyTasksView.tsx` since WorkItemsView is also used for `net-workorders` and other "all workitems" views.

## 2. Widget → real source

| Widget | Source | Permission |
|---|---|---|
| Title "My Tasks" | static label | — |
| Subtitle "N open" | `GET /api/workitems?mine=true&status__in=TODO,IN_PROGRESS,BLOCKED` | per-user |
| Subtitle "M breaching SLA" | **NO SOURCE** — WorkItem has no `sla_due_at` (helpdesk-only field). DECISION NEEDED. |
| Table rows | `GET /api/workitems?mine=true` (real, server-scoped) | per-user (`workitem.view`) |
| Board (grouped by status) | same data, client-side `.status` grouping | per-user |
| Toolbar search | client-side filter on fetched rows | — |
| Kind filter | `?kind=<value>` | — |
| New button | `POST /api/workitems` → modal | `workitem.create` |
| Inline status (Start/Done/Block/Reopen) | `POST /api/workitems/{id}/start|complete|block|reopen` | `workitem.edit` |
| Row click | drawer `GET /api/workitems/{id}` + PATCH on save | `workitem.view+edit` |

## 3. Inert buttons (REMOVE in P3)

3 buttons with no real backing:
- **Workflow** (ViewHead line 279) — `console.log`
- **Filter** button (Toolbar line 383) — toasts "configure in Studio", no real engine
- **Row Menu** 3-dot (line 606) — `console.log`

Plus possibly:
- **Bulk Export** (line 365) — toast success, no real export

## 4. Permission scope — backend is secure

Backend route at `routers/workitems.py:108` enforces `can(grants, "workitem", "view")` + `tenant_id` filter + `mine=true` adds `assigned_user_id == user.id`. **Security is GOOD server-side.** Frontend just must always pass `mine=true` (currently defaults to `'active'` tab → ALL items leak to client even if hidden — this IS a small leak fix).

## 5. Decisions for Gev (5)

1. **WorkItemsView fork vs scope prop?** WorkItemsView is reused (`net-workorders` etc.). Either add `scope?: 'me' | 'all'` prop OR fork to new `MyTasksView.tsx`. Recommend fork (cleaner separation).
2. **SLA field — in or out of scope for My Tasks?** Recommend OUT (SLA is helpdesk-specific; work orders/tasks don't have it). Subtitle becomes "N open" only.
3. **"View All" button** — does it link to a separate admin "All Work Items" page or omit?
4. **Board view drag-drop** — wire it (drop = status change mutation) or read-only grouped view only?
5. **Bulk actions** (checkboxes already in UI) — keep + wire (delete/assign/priority) or strip the checkboxes for now?

## Conclusion

Backend's already solid for per-user task scoping. Work is frontend-only: simplify the view, default to `mine`, remove inert buttons, swap to kit ViewHead. Optional: a small backend change ONLY if Q2 (SLA) goes "in scope".
