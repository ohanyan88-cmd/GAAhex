# 10 — UI Structure & PageShell Standards

Covers: PageShell, Universal Page, Page Type, Object Detail, Device Strategy, Interface Density,
Object Editing, Layout Grid, Left Navigation, Header/Top Bar, Drawer, Action Menu, Pagination,
Loading/Skeleton. These are the **implementable** UI standards (S3 — Strategic Product Direction
points here and does not redefine them).

---

## PageShell Standard — LOCKED
One platform-wide page framework every page consumes. Build shared primitives first; no
page-specific layouts; no duplicated layout logic.
Primitives: `PageShell, PageHeader, KPIBar, ActionBar, FilterBar, ContextPanel, EmptyState`.
If equivalents exist: extend/refactor/standardize/reuse — never duplicate.
PageShell supports: `breadcrumb, icon, title, subtitle, status, kpis, views, actions, filters,
workspace, contextPanel`. Pages configure the shell; pages never reimplement it.
Architecture: `PageShell → PageHeader, KPIBar, ActionBar, FilterBar, Workspace, ContextPanel`.

## Universal Page Standard — LOCKED
Every page follows the same zones:
- Zone 0 — Global Shell (top bar, left nav, notifications, user menu)
- Zone A — Page Identity (`PageHeader`: breadcrumb, icon, title, subtitle, status summary)
- Zone B — KPI Strip (`KPIBar`: 3–5 compact KPI cards when meaningful; neutral placeholders
  when no real data; never invent business data)
- Zone C — Actions & Views (`ActionBar`: view switcher, primary action far right, secondary
  actions; no duplicate actions in body)
- Zone D — Filters (`FilterBar`: search first, quick/advanced filters, saved views)
- Zone E — Workspace (by page type)
- Zone F — Context Panel (`ContextPanel`: optional; selected record summary, status, owner,
  related objects, recent activity, quick actions; same width/styling everywhere)
Same spacing/typography/breadcrumb/title/icon/subtitle treatment on every page. Consume shared
components; never create page-specific versions. Migration order: build PageShell + primitives →
page type system → validate architecture → only then convert pages. Preserve routes, permissions,
API calls, data behavior. Frontend-focused.

## Page Type Standard — LOCKED (S4 applied)
Every page belongs to exactly one type. Canonical `PageType` enum (UPPER_SNAKE — E19):
`WORKSPACE, REGISTRY, PIPELINE, OPERATIONS, ANALYTICS, COMMUNICATION, CONFIGURATION, PLACEHOLDER`.
The type controls layout and default zone behavior.
- Registry: table, bulk actions, pagination, row actions.
- **Pipeline (S4): supports multiple tabbed pipeline views, not a single board.** Required views:
  `Sales Pipeline, Customer Lifecycle, Service Delivery Pipeline` (see file 11). Each view renders
  a board (stage columns, card drawer, stage KPIs) via the Tabs Standard.
- Operations: map, calendar, live board, status panels, operational queues.
- Analytics: charts, KPI cards, insight panels, report tables, AI insight panel.
- Communication: conversation list, message thread, context panel, channel filters.
- Configuration: config navigation, builder/config workspace, properties panel, config metadata.
- Placeholder: professional coming-soon empty state, page purpose, future module description,
  no fake data.

## Object Detail Standard — LOCKED (D4/D13 — authoritative tab set)
Consistent tab model on every record detail page/drawer. **This is the single canonical
common-tab set; the Tabs Standard (file 09) references it and must not define a different set.**
Canonical common tabs (in order): `Overview, Timeline, Tasks, Comments, Attachments, Approvals,
Related, Communications, Audit`. Object-specific tabs come after the common tabs.
**E11:** there is no separate `Documents` tab — "documents" are Attachments filtered by document
categories (`DOCUMENT, CONTRACT, IDENTITY_DOCUMENT, LEGAL_DOCUMENT, FINANCIAL_DOCUMENT`) within
the Attachments tab; the Attachment Standard governs all files.
**D13:** the `Timeline` tab is the activity history (Activity Timeline Standard); there is no
separate `Activity` tab. Examples — Customer adds object-specific tabs after the common set:
`… Services, Billing, Subscriptions`. Apply gradually without breaking existing detail pages;
create the reusable structure now.

---

## Device Strategy Standard — LOCKED
**Desktop-first, Mobile-complete.** Desktop is the primary target (dense workflows, multi-column,
comparison, tables, drawers, detail views, dashboards, monitoring, rapid switching). Mobile is
first-class and mandatory: every core workflow accessible and usable; mobile may use different
patterns (drawer → full-screen, table → responsive list/card, multi-column → stacked, left nav →
mobile drawer). No desktop-only business capabilities. Responsive behavior is designed
intentionally, not a shrunk desktop UI.
Forbidden: desktop-only core workflows, mobile as afterthought, broken mobile tables, hidden
critical mobile actions, unreadable dense small-screen layouts, hover-only interactions,
keyboard-only workflows without mobile alternative, business logic only via desktop UI.

## Interface Density Standard — LOCKED
**Dense Operational UI** (Linear / Jira / Datadog / Grafana / NMS / ops consoles), not spacious
marketing CRM. Maximize information visibility, speed, comparison, situational awareness; minimize
whitespace, oversized components, deep navigation, unnecessary modals. Dense ≠ cramped — preserve
readability, accessibility, scanability, hierarchy, localization safety, mobile usability.
Components support density (compact tables/headers/forms/filters/action bars/drawers/badges/chips).
Spacing via tokens; no manual compression. Critical operational data (status, owner, assignee,
department, priority, SLA, last activity, next action, reference, timestamps) visible without
excessive scrolling.

## Object Editing Standard — LOCKED (M2 aligned)
Hybrid model. **Side Drawers primary (~70%)** for normal object edits (customer, ticket, lead,
task, contact, invoice adjustments, service, equipment, assignment, ownership, common field
edits, short forms, context-preserving edits). **Dedicated Pages** for complex workspaces
(Customer 360, Ticket Workspace, Project Workspace, Network Device, Fiber Infrastructure,
Reporting Builder, Automation Builder, Workflow Configuration, complex billing, large multi-
section forms, multi-panel analysis). **Modals** limited to confirmations, destructive
confirmations, quick create, simple assignments, status changes, simple approvals, short prompts.
Selection order: complex workspace → Dedicated Page; normal edit preserving context → Side Drawer;
small confirmation/simple action → Modal. Choose by complexity, not developer convenience. Every
surface respects permissions, TenantID, visibility, validation, audit, events, field restrictions.

## Layout Grid Standard — LOCKED
Layouts are system-driven, not page-invented. Types: `Single Column, Two Column, Master Detail,
List + Drawer, Dashboard Grid, Workspace Layout, Split Panel, Responsive Stack`. Desktop optimizes
density (fixed left nav, compact top bar, content area, right drawer/panel, multi-column detail,
dense lists, dashboard grids). Mobile collapses safely (stack columns, full-screen drawers,
responsive lists, mobile nav, reachable actions, visible critical data). Page width intentional:
full-width for tables/dashboards/monitoring/reporting/network/workspaces; constrained for
forms/settings/focused/config. Sections have clear hierarchy (title, optional description, body,
actions). Spacing tokens only; standardized breakpoints.

## Navigation Standard (base) — LOCKED (written: file 22)
→ See **22-navigation-standard.md** (code-accurate). The locked tree below remains authoritative content. Was SOURCE NOT PROVIDED; now resolved.
Referenced as a base standard by Left Navigation, Header, PageShell, Feature Flag, and Security.
**Source text was not provided (E18).** The locked navigation **tree** below is authoritative;
the base Navigation Standard's behavior rules are pending. No rules invented.

## Left Navigation Standard — LOCKED (S2 applied)
**S2 — Single source of truth for navigation is the locked navigation tree below.** This standard
describes navigation *behavior* only and must not introduce a different tree.

Locked navigation tree (authoritative):
```
Workspace
├── Home
├── My Work
├── Team Workspace
├── Communications
└── Calendar
CRM
├── Leads
├── Pipeline
├── Customers
├── Customer Tasks
└── Campaigns
Billing & Revenue
├── Product Catalog
├── Tariff Plans
├── Orders & Validation
├── Billing Accounts
├── Invoices
├── Payments
├── Collections
└── Revenue Assurance
Tech & NOC
├── Tech & NOC Dashboard
├── Service Qualification
├── Installation Board
├── Support Tickets
├── Support Dispatch Board
├── Provisioning
├── Incidents & Outages
├── Infrastructure Projects
└── Network & Stock Inventory
Analytics & AI
├── Operational Dashboards
└── Reports & AI Insights
Enterprise
├── Back-Office Finance
├── Human Resources
├── Procurement & Vendors
└── Legal & Security Audit
Admin Panel
├── Records
├── System
├── Dev Internals
└── Studio
```
Behavior: desktop persistent (collapsible, preserving icons/labels/active state/permission
filtering); mobile drawer/menu navigation without hiding core workflows. Permission-aware (hide
or explain inaccessible items; backend still enforces; hiding is not security). Respects TenantID,
feature flags, role, configuration, module availability. Clear/consistent active states. Stable
groups (no random reorder, no tenant-specific nav forks). Scales to CRM/ERP/OSS-BSS/portal/WFM/
comms/automation/ecosystem without redesign. Nav labels are never permission/route keys;
translated labels never used as route keys.

## Header / Top Bar Standard — LOCKED
Compact and operational; never a marketing hero. Types: `Global Top Bar, Page Header, Object
Header, Workspace Header`. Global top bar: global search, notifications, user/account menu,
authorized tenant/brand switcher, environment indicator, approved quick create, system alerts.
Page header: title, short description, primary + secondary actions, breadcrumbs, filter summary.
Object header: name/title, reference number, status badge, owner/assignee, key metadata, primary
action, action menu. Mobile header preserves location, nav access, primary action, search,
user/system access. Header actions follow Button + Action Menu standards; only the most important
action is visually primary; actions respect permissions (hiding is not backend security).

## Drawer Standard — LOCKED
Primary context-preserving editing/review surface. Types: `Edit, Create, Detail Preview,
Assignment, Status Change, Filter, Activity, Related Object`. Desktop opens from the right; mobile
full/near-full-screen. Sizes `Small, Medium, Large, FullHeight`; very complex workflows use
dedicated pages, not oversized drawers. May contain forms, key metadata, related preview,
comments, activity preview, assignment/status controls, short flows; never a full workspace
replacement. Edit drawers: clear save/cancel, loading on submit, failed submit keeps drawer open
with error, dirty-state warns before close. Avoid nested drawers (limited/predictable if
unavoidable; prefer replacing content or navigating to a page). Drawer edits create the same
events/audit as page edits; the editing surface never changes business rules.

## Action Menu Standard — LOCKED
Types: `Row Action, Object Action, Header Action, Bulk Action, Context`. Consistent ordering:
View/Open → Edit → Assign/Change Owner → Status Actions → Duplicate/Copy → Export/Share → Archive
→ Delete/Destructive (destructive visually separated). Permission-aware (hide or disable with
explanation; backend enforces). Destructive actions: destructive styling, confirmation,
audit/event records, separated from safe actions. Bulk actions require explicit permission, show
selected count, report success/failure, never silently skip unauthorized records. Touch-safe (no
hover-only critical actions). Labels localizable; logic never depends on translated labels.

## Pagination Standard — LOCKED
Server-side pagination default for large lists; client-side only for small already-loaded sets.
Paginated responses support page/cursor, page size, total count where safe, has-next, has-prev,
sort field, sort direction, filters applied. Cursor preferred for very large/fast-changing data.
Standard page sizes `25, 50, 100`. Counts respect permissions (no unauthorized records; approximate
or omitted counts allowed when unsafe/expensive). Preserve filters/search; changing filters resets
pagination appropriately. Server-side sorting on approved fields for large data. Mobile may use
load-more/infinite-scroll where safe; infinite scroll not used for audit-critical or comparison
lists unless approved.

## Loading / Skeleton Standard — LOCKED
Users always know whether the system is loading/saving/refreshing/failed. Patterns: `Page
Skeleton, Table Skeleton, Card Skeleton, Inline Spinner, Button Loading, Drawer Loading, Modal
Loading, Background Refresh Indicator, Full Page Blocking Loader (limited)`. Skeletons preferred
for structural loading (approximate final layout); avoid generic full-page spinners where
skeletons fit. Submit/action buttons show loading and prevent duplicate submission. Tables show
initial/refresh/empty/error states; don't clear data during background refresh unless necessary.
Drawers/modals show loading when fetching; failed submit keeps surface open with error. Background
refresh is subtle. Long-running jobs (imports, exports, reports, automation, integration syncs)
show progress/status and never appear frozen. Loading failures transition to clear error states —
never spin forever, never fail silently. Loading must not briefly show unauthorized data before
permission checks complete.

## Remove Legacy Page Standards — LOCKED
The PageShell architecture is the single source of truth. Audit and remove obsolete page
standardization systems, duplicate wrappers, unused layout abstractions, deprecated scaffolding,
dead layout code, and duplicate header/filter/action implementations — **after** PageShell and the
shared primitives exist and pages are migrated. Preserve functionality, routes, permissions,
business logic, and existing content. A legacy component retained temporarily must be documented
with the reason. Target: one PageShell, one PageHeader, one KPIBar, one ActionBar, one FilterBar,
one ContextPanel, one layout architecture.

## Locked Decision
Desktop-first/mobile-complete, dense, drawer-primary, single navigation tree, compact headers,
server-side pagination, skeleton-first loading, one page framework. No page-specific random UI.
