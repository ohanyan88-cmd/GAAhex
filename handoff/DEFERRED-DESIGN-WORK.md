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

## (Append per section as the polish pass continues)
