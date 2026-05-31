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

## Network & Operations polish (section 5 of 9) — appended 2026-05-31

### Deferred from Network & Operations sweep
- **`bill-meta` / `bill-actions` / `bill-section-head` undefined classes** — surveyed in `InvoicesView`, `WorkItemsView`, `MyTasksView`, `AccountsView`, `ServicesView` (pre-polish) and `ResourcePoolsView` (pre-polish). These classes are referenced from JSX but have NO CSS rules anywhere in `styles.css`/`primitives.css`/`gaaex-tokens.css`, so they render as plain divs. Both Netops custom views (Services + ResourcePools) were migrated to RecordDrawer in this commit and no longer use `bill-meta`. The 4 remaining consumers are out of Netops scope; cleanup is a billing/revenue polish concern.
- **Service-detail "Activity" tab inside RecordDrawer** — `RecordDrawer` exposes an `activity` prop (timeline pane) that we left unwired for Services because the backend `/api/services/{id}` payload doesn't currently include audit events. Wire when service-level audit history is exposed (today only the resources list is included).
- **Pool-detail "Related services" tab** — IPAM allocations link out to `service_id`, but resolving that into a clickable record-jump would mean coupling `ResourcePoolsView` to the service-routing layer. Linkout deferred until we have a generic record-jump helper.
- **Service lifecycle Activate confirmation** — `Activate` runs without a confirmDialog. `Terminate` and `Suspend` both confirm (Terminate explicitly via `confirmDialog`; Suspend implicitly via the §4.5 mandatory-approval gate). Activate is intentionally one-click for now — revisit if downstream provisioning side-effects make it destructive.
- **`assets` entity duplication** — both `net-asset-mgmt` (Network & Operations) and any future Enterprise asset register point at the same `/api/assets`. Resolution is governance, not visual polish; surfaced for the Enterprise sweep.
- **Stub modules** — Coverage & GIS, Network Topology, Provisioning, Scheduling, Dispatch Board, Stock Inventory in nav-config have `viewType: undefined` → render the module stub. No polish target until a real view lands.

### Done in this commit
- `ServicesView` rewrapped in `.view-inner.section-page.fade` (1320px cap) with `Network & Operations / Services` breadcrumb; `<ServerIcon>` replaces the old `<InboxIcon>` in `ViewHead` to match the section motif.
- `ServicesView` service-detail flow migrated from a full-page back-stacked panel (`ServiceDetail` component) to a `RecordDrawer` slide-over (`ServiceDrawer`). Lifecycle actions (Activate / Suspend / Terminate) live in the drawer footer; resources table renders in a card under the hero. Old `bill-meta` / `bill-section-head` / `bill-actions` divs deleted (per "DELETE old code, don't layer").
- `ServicesView` status pills + tab labels routed through `humanizeStatus()` so `SUSPENDED` → "Suspended", `TERMINATED` → "Terminated", etc. Tab `s.toLowerCase()` slicing removed in favor of the helper.
- `ServicesView` suspend lifecycle handler now inspects the response body for `detail.status === 'approval_required'` (SPEC §4.5 mandatory-approval gate returns HTTP 202 with that payload) and toasts "Suspension queued for approval" instead of the generic "Service suspended" success.
- `ServicesView` lifecycle handlers gated through `can(capabilities, 'service', 'edit')` (was `'update'` — `update` isn't a valid `Verb` enum; was caught by `tsc --noEmit`).
- `ResourcePoolsView` rewrapped in `.view-inner.section-page.fade` (1320px cap) with `Network & Operations / Resource Pools` breadcrumb (was `Inventory / Resource Pools`); `<PackageIcon>` replaces `<ServerIcon>` in `ViewHead` for the per-page icon (the section icon stays ServerIcon).
- `ResourcePoolsView` pool-detail flow migrated from `PoolDetail` full-page to `PoolDrawer` (RecordDrawer slide-over). Old `bill-meta` / `bill-actions` divs deleted. Allocation table renders inside a `.card` under the drawer hero — matches the Services drawer pattern.
- `ResourcePoolsView` pool-status labels surfaced with leading-cap ("Available", "Reserved", …) instead of lowercase. The Create-pool form now wraps in a `.card` for consistency with the rest of the section.
- `ResourcePoolsView` loading state replaced the bare `SkeletonRows` with a `.card`-wrapped variant so the skeleton matches the post-load table chrome and doesn't jump on hydration.
- 6 of 8 active Netops pages share `EntityView` (Alarms via Network Monitoring, Incidents & Outages, Asset Management, Work Orders, Warehouses, etc.) — already polished in CRM sweep — no fork.
- Verification: `verify_network_polish.js` captures 16 screenshots (8 pages × 2 themes) in `screenshots/net_*.png`. The 6 stub-only Netops items (Coverage & GIS, Network Topology, Provisioning, Scheduling, Dispatch Board, Stock Inventory) are skipped per the doctrine "hide-if-missing" — they render the module stub.

## (Append per section as the polish pass continues)

## 2026-05-31 audit: specialty modals re-classified

Re-audit of the 8 modals deferred during the RecordDrawer sweep (`24b2e11`):
- ProfileModal, SecurityModal, SupportModals (×4), AiAssistModal — all use base `Modal` with `size="sm"` (420px cap). Inherit the width fix.
- CommentsModal — `size="md"` (560px). Inherits.
- CustomerBillingModal — `size="lg"` (640px). Inherits.
- WorkItemDetailModal — `size="lg"` (640px). Inherits.
- ConfigureDrawer — already drawer-shaped (own pattern).

**Verdict:** the width problem Gev originally flagged ("full-bleed, cramped left, dead space")
is FIXED for every specialty modal via base-Modal inheritance. Migration to RecordDrawer
slide-over pattern is a pattern preference, NOT a bug. Demote from "deferred — broken"
to "future cosmetic enhancement when product owner asks."
