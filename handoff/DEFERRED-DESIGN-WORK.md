# Deferred Design Work — Running List

Tracks specialty modals, edge-case panes, and polish items that were intentionally deferred during the design-system + polish sweeps so we circle back later.

## Specialty modals (from RecordDrawer sweep `24b2e11`)
- `WorkItemsView` / `MyTasksView` WorkItemDetailModal — edit-first, not view-first. Needs EditDrawer pattern or tabbed View/Edit toggle on RecordDrawer.
- `CustomerBillingModal`, `WebhooksView` deliveries modal — multi-section list modals (not single-record detail). Inherit base Modal width cap.
- `EntityView` activity Modal, `ConfigureDrawer`, the 7 `modals/` files (AiAssistModal, CommentsModal, CustomerBillingModal, ProfileModal, SecurityModal, SupportModals × 4) — inherit base Modal cap, full RecordDrawer migration deferred.
- Module 2 `EntitiesPane` detail drawer, Module 3 `NotificationsPane` detail drawer — Studio-shell-shaped panes, need their own migration plan.

## Polish items
- `KPITile.stories.tsx` — Storybook stories not updated to demo the new `onClick`/`premium`/`danger` variants. Low priority.
- Per-status filter UX in views that wire KPI click to `setQuery(<status>)` (Subscriptions, Parties, Products, Webhooks) — works but a dedicated per-status tab would be cleaner.
- `CustomerView.tsx:355` — leftover `<div className="widget">` wrapping ActivityTimeline. Out of original carve-out zones.

## CRM polish (section 2 of 9) — appended 2026-05-31

### Deferred from CRM sweep
- **EntityView edit modal** — still uses the base `Modal` with width cap, NOT the `RecordDrawer` slide-over. EntityView's flow is edit-first (the "row link" opens the form pre-populated), so a straight RecordDrawer swap would regress the UX. Needs either:
  - an `EditDrawer` primitive (same hero/footer chrome, but the body is an editable form), OR
  - a tabbed View/Edit toggle inside `RecordDrawer`.
  Same pattern as the deferred `WorkItemsView` / `MyTasksView` work above — solve once, apply to both.
- **EntityView activity Modal** (`<Modal title="Activity · …" size="md">`) — already inside the base Modal cap, but a per-record activity stream is a better fit for the RecordDrawer's right-rail. Bundled with the EntityView RecordDrawer migration.
- **LeadPipelineView inline kanban-column "empty" placeholder** (`No leads in this stage`) — still uses an inline dashed-border block with raw px values. The page-level empty state was upgraded to `<EmptyState>` with icon + CTA; the per-column placeholder is intentionally lighter so it doesn't compete with the cards. Revisit if/when we add column-level "+ New" affordances.
- **AccountsView detail panel** (`AccountDetail`) — renders subscriptions + invoices as two stacked `.card` tables. Already inherits `.section-page` chrome via the wrapper, but the subscription / invoice tables don't have search / sort / KPI strips. Out of CRM-polish scope (would touch Billing visuals); kept as-is.
- **ProductsView edit affordance** — clicking "Edit" reveals the same inline `.rec-form` used for create. Works, matches the kit, but the row-level edit could move into a RecordDrawer eventually. Bundled with the EntityView edit migration.

### Class generalization (done in this commit, noted for traceability)
- `.workspace-page` → `.section-page` in `styles.css` and across the 6 Workspace views (`DashboardView`, `MyTasksView`, `MyApprovalsView`, `CalendarView`, `ActivityFeedView`, `SavedViewsView`). The 5 custom CRM views (`EntityView`, `LeadPipelineView`, `AccountsView`, `ProductsView`) now use the same class. Per doctrine — no layering — there is no `.workspace-page` rule remaining; the old class is gone, not aliased.

## Care polish (section 4 of 9) — appended 2026-05-31

### Deferred from Care sweep
- **HelpdeskView ticket-detail comments thread** — RecordDrawer has the ticket fields but no in-drawer comments thread (which would be the natural place for the customer/agent back-and-forth). Today comments live in a separate `CommentsModal` reachable per-record. Bundle with the deferred CommentsModal RecordDrawer migration noted in the §RecordDrawer sweep.
- **HelpdeskView AI Assist modal** — `AiAssistModal` (one of the 7 specialty modals listed above) inherits the base Modal cap but hasn't been migrated to a RecordDrawer side panel. The "summarize / suggest reply" flow is a better fit for an in-drawer pane than a centered modal — but tied to the wider AiAssist redesign, not Care-specific.
- **HelpdeskView assign-agent 500 (backend bug)** — Per S4 audit `REPORT-S4-CARE.md` Action Items: `POST /api/helpdesk/tickets/{id}/assign` returns HTTP 500 when given an invalid agent_id (should return 404 or 422). Frontend already handles gracefully via `toast.error((e as Error).message)` in `handleAssign()`. Backend fix is owned by the backend agent — not polishable here.
- **Tickets entity 0 transitions** — `/meta/entities/tickets` returns 3 statuses but 0 transitions, so the Move-to column is correctly absent. Config gap (backend seed), not a code bug. Surface in entity-config Studio when that pane lands.
- **MessagesView attach affordance** — `showAttach` state and the `pop-scrim` are wired but there's no actual attach UI populated (no backend file-upload endpoint for thread messages yet). The button is gated to a no-op for now; revisit when file attachment lands on `/api/threads/{id}/messages`.
- **OutboundView Archive button** — Already documented in-source (`OutboundView.tsx` lines 449-451): the `OutboundMessage` model has no archive flag and no backend archive endpoint. Restore when backend exposes one.
- **OutboundView Campaigns folder** — Same as above: removed from the FOLDERS array because there's no campaign linkage on `OutboundMessage`. Re-add once campaigns join the model.

### Done in this commit
- HelpdeskView wrapped in `.view-inner.section-page.fade` with `Customer Care / Helpdesk` breadcrumb; queue rail extracted to a `.card` and ticket list to a second `.card` inside a 2-column `.hd-shell` grid (responsive collapses to 1 column < 880 px).
- HelpdeskView status / priority pills routed through `humanizeStatus()` so `in_progress` → "In Progress", `urgent` → "Urgent", etc. Same applied to the RecordDrawer hero status and Create-ticket priority dropdown.
- Inline `<h1 style={{ fontFamily, fontSize, ... }}>` and `<div style={{ color: var(--gx-text-3), ... }}>` on `MessagesView` / `OutboundView` `comms-head` replaced with new `.comms-title` / `.comms-sub` classes (tokenized; light/dark via `--gx-*` only).
- 6 of 9 Care pages share `EntityView`, which was already polished in the CRM sweep — no fork.

## (Append per section as the polish pass continues)
