# 06 — UI / Experience Architecture

**Constitutional document.** Position in the hierarchy: sits at the tier-2 level under `PLATFORM_REFERENCE_MODEL.md`. Governs the Workspace Core (EXPERIENCE tier) and formalizes the user-facing experience layer of GAAhex for internal employee/admin use.

---

## 1. Purpose

Define the architecture, patterns, principles, and laws governing the user-facing experience layer of GAAhex: the desktop and mobile web interfaces, page framework, component standards, navigation structure, and interaction model. This document is the authoritative source for how the platform *presents* to users while remaining consistent with the 51-core model, the 70-standards, and the LOCKED brand identity.

The scope is operational and dense, not marketing-facing. GAAhex is an ISP platform (Linear / Jira / Datadog / Grafana family of tools), not a spacious CRM.

## 2. Scope

In scope:

- The PageShell framework — the universal page wrapper with six zones that every page consumes.
- Page types, layouts, and zone visibility rules.
- Object editing surface selection (drawers ≈70%, dedicated pages for complex workspaces, modals for confirmations only).
- Object detail tab set (canonical, reusable across every detail page).
- Navigation structure (left nav tree, header, breadcrumbs, action menus).
- Device strategy (desktop-first, mobile-complete).
- Interface density (operational, not spacious).
- Component standards (button, form, table, modal, drawer, badge, chip, card, tab, loading/skeleton states).
- Color, spacing, typography token governance (design-system-only; component code forbidden from raw hex/rgba).
- Accessibility rules (WCAG 2.1 AA target, keyboard-first operations, focus management).
- Design system integration (single canonical token registry `gaahex-tokens.css` with `--gx-*` prefix).
- Brand v3.0 LOCKED authority (no redesign; logo, typography, color sealed).

Out of scope (handled by other architecture documents):

- How pages are *assembled* by cores — that is core-level; ownership belongs in `03_INFORMATION_ARCHITECTURE.md`.
- Navigation placement details and workflow grouping — see `04_NAVIGATION_ARCHITECTURE.md`.
- API contract surface — see `10_API_ARCHITECTURE.md`.
- Event and audit semantics — see `11_EVENT_ARCHITECTURE.md` and Audit Core.
- Specific tenant/white-label theming (brand source is sealed; theming is configuration-driven at the frontend only, never architecture-driven).

## 3. Goals

- **G1** Every GAAhex page is built from the PageShell framework. No page invents its own layout.
- **G2** Desktop is the primary optimization target; mobile is mandatory and first-class. Every core workflow remains usable on mobile.
- **G3** The interface is dense and operational. Information is visible without excessive scrolling. Whitespace is controlled; density never harms readability or accessibility.
- **G4** Object editing defaults to side drawers (~70% of edits). Complex workspaces use dedicated pages. Modals are limited to confirmations and lightweight actions only.
- **G5** Every object detail page/drawer shows the same nine canonical tabs before any object-specific tabs.
- **G6** Navigation is unified (one left-nav tree, one header, consistent breadcrumbs, one action menu ordering). Navigation grouping follows user workflows, not platform core names.
- **G7** All color, spacing, and typography comes from a single canonical token registry (`gaahex-tokens.css`). Component code never hardcodes hex values, raw rgba, or non-standard token names.
- **G8** Brand v3.0 is LOCKED. No logo geometry changes. No typography redesign. No color family reinterpretation. No new brand assets without consulting the brand canonical.
- **G9** The platform is accessible by default (WCAG 2.1 AA, keyboard-first operations, proper aria attributes, contrast). Accessibility is not a layer; it is a core constraint.
- **G10** Every business rule is owned by a backend core (via API). The UI is the presentation layer, never the authority.

## 4. Non-Goals

- **NG1** This document does NOT define entity schemas or data models. (See `03_INFORMATION_ARCHITECTURE.md`.)
- **NG2** This document does NOT define which core owns which page. (See `04_NAVIGATION_ARCHITECTURE.md` for placement; see `PLATFORM_REFERENCE_MODEL.md` for core ownership.)
- **NG3** This document does NOT define tenant-specific customization behaviors. (Theming is configuration-driven; schema customization is in Metadata Core.)
- **NG4** This document does NOT replace Brand v3.0 authority. (Brand governance is in `docs/branding/v3.0/`.)
- **NG5** This document does NOT govern mobile-only applications (see `22_MOBILE_OFFLINE_ARCHITECTURE.md` for the Mobile Core).

## 5. Architecture Principles

### P1 — The PageShell is the single page framework.

Every page in GAAhex renders inside a PageShell component. The shell provides:
- Zone A: PageHeader (breadcrumb, icon, title, subtitle, status summary)
- Zone B: KPIBar (3–5 compact KPI cards when meaningful; never invent data)
- Zone C: ActionBar (view switcher, primary action far right, secondary actions)
- Zone D: FilterBar (search, quick/advanced filters, saved views)
- Zone E: Workspace (page-type-specific content)
- Zone F: ContextPanel (optional; selected record summary, status, owner, related objects, quick actions)

No page replicates this structure locally. Reuse is mandatory.

### P2 — One page type, one default layout.

The `PageType` enum (`WORKSPACE, REGISTRY, PIPELINE, OPERATIONS, ANALYTICS, COMMUNICATION, CONFIGURATION, PLACEHOLDER`) controls zone visibility and layout defaults. A page declares its type; the PageShell renders accordingly.

### P3 — Desktop-first, Mobile-complete.

Desktop is the primary optimization target (dense layouts, multi-column comparison, rapid record switching, tables, dashboards, monitoring, NOC consoles). Mobile is mandatory and first-class — every core workflow accessible and usable on mobile. Mobile may use different patterns (full-screen drawer instead of side drawer, responsive list instead of table, stacked instead of multi-column). No business capability is desktop-only.

### P4 — Interface density is operational discipline.

GAAhex is not a spacious marketing CRM. Density maximizes information visibility, speed, comparison, and situational awareness. Dense ≠ cramped. Readability, accessibility, scanability, and hierarchy are preserved. Spacing comes from the token scale; density is never a per-page hack.

### P5 — Objects are edited primarily in side drawers.

Approximately 70% of object edits (field changes, status updates, ownership changes, simple form submissions) happen in side drawers. Drawers preserve context, avoid full page navigation, and are quick to close. Complex workspaces (Customer 360, Ticket Workspace, Project Workspace, Reporting Builder) use dedicated pages. Modals are reserved for confirmations, destructive actions, and simple prompts.

### P6 — Component reuse is enforced; page-specific UI is forbidden.

Buttons, forms, tables, modals, drawers, badges, chips, cards, tabs, and empty states have canonical implementations in the design system. Pages consume shared components, never invent local versions. A component that does not fit the standard is a signal that the standard is wrong, not that the component should be page-specific.

### P7 — All color, spacing, and typography is token-based.

The canonical token registry (`frontend/src/styles/gaahex-tokens.css`) is the single source of truth. Component code references only Tier-1 semantic tokens (`--gx-interactive`, `--gx-text-1`, `--gx-bg`, etc.). Raw hex literals, inline rgba, and non-standard token names are forbidden in TSX. Tier-0 raw scales (`--cobalt-500`, `--azure-700`) exist for the design system to remap and are forbidden in component code.

### P8 — Design families have exclusive roles.

Color families (Cobalt, Gold, Azure, Slate, Semantic) have non-overlapping roles. Cobalt = brand spine / structural chrome. Gold = signature / peak moments only. Azure = interactive / every clickable affordance. Slate = neutrals (text, borders, dividers). Semantic = status only (success/warning/danger/info). No family is used outside its role. No color is the only meaning indicator; status is always labeled.

### P9 — Brand v3.0 is sealed.

Logo geometry, spacing, typography, and color assignment are unchangeable. No reinterpretation, no improvement, no redesign. Runtime brand assets (`frontend/public/logo/`, `frontend/public/favicon/`, `frontend/public/app-icons/`, `frontend/public/social/`) are v3.0 derivatives as of 2026-06-06. Pre-v3.0 originals are archived at `frontend/public/_archive-pre-v3.0/` for emergency rollback only. Any brand change requires consultation with the canonical brand authority at `docs/branding/v3.0/`.

### P10 — The UI is the presentation layer, not the authority.

Every business rule is owned by a backend core and enforced via the API. Frontend permission checks are UX only; backend always enforces. Frontend validation is UX only; server-side validation is mandatory. A rule that only exists in the UI is an architecture violation (see `01_PLATFORM_CORE_ARCHITECTURE.md` §13 FP8).

### P11 — Accessibility is a design constraint, not a feature.

WCAG 2.1 AA is the minimum target. Keyboard-first operations (tab, enter, escape, arrow keys). Focus management (visible focus rings, focus restoration on close). Proper aria attributes (role, aria-label, aria-describedby, aria-expanded, aria-disabled). Color is never the only meaning indicator. Long labels are supported. Localization is baked in. Disabled buttons explain why. Icon-only actions have accessible labels. Every component supports loading, empty, and error states visually and semantically.

## 6. Architecture Laws

These are the hard rules. Violation is grounds to reject a PR.

### L1 — PageShell uniformity

Every page consumes PageShell. No page implements a local header, filter bar, action bar, or pagination. Deviation requires a standard amendment, not a PR.

### L2 — One page type per page

A page declares exactly one type from the `PageType` enum. The type controls zone visibility and layout defaults. A page cannot switch types dynamically.

### L3 — PageShell Spacing Law (locked 2026-06-06)

Horizontal content edge = `var(--gx-space-12)` = 24px on all 10 zones (4 chrome + 6 body variants). Vertical spacing is zone-specific per the PageShell layout rules. No 32px default. No new spacing tokens. No per-page exceptions. The spacing is the architecture. Exceptions require a constitution amendment.

### L4 — Canonical object-detail tabs

Every object detail page/drawer shows these tabs in order before any object-specific tabs:
`Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit`.

No separate `Activity` tab (Timeline is the activity history). No separate `Documents` tab (documents are Attachments filtered by category). Adding object-specific tabs after this set is permitted; reordering or skipping is not.

### L5 — Modal discipline

Modals are used for:
- Confirmations (destructive confirmation, permission confirmation, system notice)
- Quick-create (simple, short form only)
- Simple assignments (quick status change, single-field update, simple action)
- Destructive confirmation (delete, disable, revoke, permanently change)

Complex or multi-section forms use drawers or dedicated pages. Modals never hold more than 3–4 logical action groups. No nested modals unless unavoidable. When avoidable, prefer replacing drawer/page content or navigating to a new page.

### L6 — Drawer as the primary edit surface

Side drawers are the default for normal object edits. Drawers open from the right on desktop; full or near-full screen on mobile. Edit drawers show clear save/cancel buttons, prevent duplicate submission, keep the drawer open on failed submit with an error message, and warn on dirty state before close.

Complex workspaces (analytics builders, workflow designers, infrastructure mapping, Customer 360 multi-panel views, Ticket Workspace) use dedicated pages, not oversized drawers.

### L7 — Token-only color and spacing in component code

Forbidden in TSX:
- Hardcoded hex literals (e.g., `#0EA5E9`, `#1C3B68`)
- Inline rgba (e.g., `rgba(0, 165, 233, 0.5)`)
- Raw scale token references (e.g., `--azure-500`, `--cobalt-700`)
- Per-page custom style variables outside the token registry

Required in TSX:
- Semantic token references only (e.g., `var(--gx-interactive)`, `var(--gx-text-1)`)
- All spacing via the token scale (e.g., `var(--gx-space-4)`, `var(--gx-space-12)`)
- All typography via role tokens (e.g., `var(--gx-font-sans)`, role applied via shared typography classes)

The canonical token file is `frontend/src/styles/gaahex-tokens.css`. Breaking this rule is an L7 violation.

### L8 — No frontend-only business logic

Every permission, validation rule, status transition, and business constraint is owned by a backend core and enforced via the API. Frontend checks (disabled buttons, hidden fields, readonly form inputs, disabled actions) are UX courtesy only. The backend enforces, always.

### L9 — One navigation tree

The left navigation tree is locked and defined in `10_UI_STRUCTURE_PAGE_SHELL_STANDARDS.md`. Navigation grouping (Workspace, CRM, Billing & Revenue, Tech & NOC, etc.) follows user workflows, not platform core names. The navigation tree is stable; no random reordering, no tenant-specific forks. Respecting permissions (hide inaccessible items, never leak restricted data in counts) is required; permissions are enforced backend, not frontend security.

### L10 — Brand v3.0 is immutable

Logo geometry, spacing, font stack, and color assignment are sealed. No new brand assets without consulting `docs/branding/v3.0/`. No color reinterpretation. No typography redesign. No gradient/overlay experimentation. Brand changes are architectural decisions, not CSS experiments.

### L11 — Mobile is not a shrunk desktop

Mobile and desktop may use different patterns for the same workflow. Drawers on desktop may become full-screen on mobile. Tables may become responsive card lists. Multi-column layouts may stack. But every core workflow is present on mobile with no essential capabilities hidden or degraded. No hover-only interactions. No keyboard-only workflows without a mobile equivalent. The patterns are intentional, not responsive shrinking.

### L12 — Accessibility is non-negotiable

Every component must support:
- Keyboard navigation (tab order, enter, escape, arrow keys where applicable)
- Visible focus (focus ring always visible; focused element never hidden)
- Proper aria (role, aria-label, aria-describedby, aria-disabled, aria-expanded, aria-live where appropriate)
- Color + icon + label (status is never color-only; icons never replace text meaning)
- Loading / empty / error states (semantic + visual feedback, never spin forever)
- Contrast (WCAG AA minimum; semantic status colors are Semantic family only)
- Long labels (fields wrap; labels never truncate silently)
- Localization (placeholder text is never English-only; translated labels never used as logic keys)

## 7. Core Concepts

### 7.1 PageShell

The universal page wrapper. Every page renders inside PageShell. The shell provides six zones: PageHeader (A), KPIBar (B), ActionBar (C), FilterBar (D), Workspace (E), and ContextPanel (F). Page type and supplied props control which zones render. The PageShell component lives in `frontend/src/page-shell/PageShell.tsx`.

### 7.2 Zone

A named region in the PageShell layout. Each zone has consistent spacing, typography, and behavior across all pages. Zone E (Workspace) is page-type-specific; the others are chrome.

### 7.3 Page Type

The `PageType` enum classifies the page and controls default layout and zone behavior:
- `WORKSPACE`: collaborative multi-panel workspace (Customer 360, Ticket Workspace, Project Workspace)
- `REGISTRY`: list/table view of objects (Customers, Tickets, Tasks, Products, Invoices) with bulk actions and pagination
- `PIPELINE`: tabbed pipeline/board views (Sales Pipeline, Customer Lifecycle, Service Delivery Pipeline)
- `OPERATIONS`: real-time operational surfaces (maps, calendars, live boards, status panels, queues)
- `ANALYTICS`: charts, KPI cards, dashboards, reports
- `COMMUNICATION`: conversation threads, message lists, channel filters
- `CONFIGURATION`: config navigation, builders, properties panels
- `PLACEHOLDER`: professional coming-soon empty state

### 7.4 Object Detail Tab Set

Nine canonical tabs rendered in order before any object-specific tabs. These tabs appear on every object detail page (Customers, Tickets, Tasks, Invoices, Services, Contracts, etc.) with no variation:
1. **Overview** — key fields, summary information, status, owner
2. **Timeline** — activity history (events, status changes, comments, assignments, approvals)
3. **Tasks** — linked and unlinked tasks
4. **Comments** — internal and external comments/notes
5. **Attachments** — uploaded files (documents, images, evidence); filtered by category (document, photo, network diagram, invoice, contract, identity document, etc.)
6. **Approvals** — approval requests, decisions, chains, signoffs
7. **Related** — linked objects (parent, child, depends-on, duplicates, serves, located-at, etc.)
8. **Communications** — inbound/outbound messages (email, SMS, WhatsApp, calls, internal chat)
9. **Audit** — immutable audit log (who changed what, when, why)

Object-specific tabs (e.g., for Customers: Services, Billing, Subscriptions; for Invoices: Line Items, Payments, Adjustments) come after these nine.

### 7.5 Design System Token Registry

The canonical source of truth for color, spacing, and typography. Located at `frontend/src/styles/gaahex-tokens.css`. All tokens use the `--gx-*` prefix. Tier-1 semantic tokens (e.g., `--gx-interactive`, `--gx-text-1`, `--gx-space-4`, `--gx-font-sans`) are used in component code. Tier-0 raw scales (e.g., `--cobalt-700`, `--azure-500`) are for the design system to remap and are forbidden in component code.

### 7.6 Color Family

Five families with exclusive roles:
- **Cobalt** (`#1C3B68`) — brand spine / structural chrome (sidebar, top bar, primary chrome backgrounds)
- **Gold** (`#C5A059`) — brand signature / peak moments (KPI highlights, featured cards, signature UI moments)
- **Azure** (`#0EA5E9`) — interactive / every clickable affordance (buttons, links, active states, interactive controls)
- **Slate** — neutrals (text hierarchy, borders, dividers, passive data viz)
- **Semantic** — status only (success, warning, danger, info on value text; never on backgrounds or chrome)

No family is used outside its role. Hover affordance: interactive controls (buttons, links, chips) hover Azure; container elements (KPI tiles, cards) hover Gold.

### 7.7 Drawer

A context-preserving editing or review surface that slides in from the right (desktop) or covers the full/near-full screen (mobile). Sizes: Small, Medium, Large, FullHeight. Edit drawers include save/cancel buttons, show loading, prevent duplicate submission, warn on dirty state, and keep open on error. Drawers may contain forms, metadata, comments, activity preview, and short flows. Complex workspaces use dedicated pages.

### 7.8 Modal

A modal interrupts the workflow and requires a decision before closing. Types: Confirmation, Form (quick-create / simple short form only), Detail Preview (lightweight read-only preview), Destructive Confirmation, System Notice. Modals have predictable close behavior, focus trapping, focus restoration, and unsaved form warnings. Modals are not used for every small action.

### 7.9 Object Editing Strategy

- **Side Drawer (~70%)**: Quick field edits, status changes, simple form submissions, ownership changes, context-preserving edits
- **Dedicated Page**: Complex workspaces (Customer 360, Ticket Workspace, Reporting Builder), large multi-section forms, multi-panel analysis, infrastructure mapping, workflow designers
- **Modal**: Confirmations, destructive confirmations, quick assignments, simple status changes, simple prompts

Selection criterion: complexity and the need to preserve context.

## 8. Canonical Entities

Workspace Core owns the following canonical entities:

| Entity | Owner Responsibility |
|--------|---------------------|
| PageRegistry | Registry of all pages, their types, routes, titles, permissions, and metadata |
| LeftNavEntry | Left navigation structure (tree node, label, icon, route, permission, visibility) |
| TopNavEntry | Top navigation items (global search, notifications, user menu, tenant switcher) |
| DashboardLayout | Dashboard grid layout, KPI card placement, chart placement, metadata |
| BoardLayout | Pipeline board layout (stage columns, card height, KPI visualization) |
| TableLayout | Table column visibility, sort, filter saved states |
| DetailPageLayout | Object detail page zone layout, tab ordering, field placement |
| DrawerSpec | Drawer configuration (size, title, buttons, content shape) |
| CommandPaletteEntry | Command palette registered commands and shortcuts |
| PageShellSpec | PageShell component configuration per page type (zone defaults, spacing, responsive rules) |

These entities are referenced by but not owned by other cores. For example, Service Core owns a Service object; Workspace Core owns the mapping of Service detail pages to the object detail tab set and zone layout.

## 9. Ownership Boundaries

**Workspace Core owns:**
- Page types, page registry, routes
- PageShell framework and zone definitions
- Left nav tree structure (behavior rules, not content ownership; content placement is driven by core ownership)
- Top nav (global search, notifications, user menu, tenant switcher)
- Object detail tab set (canonical nine tabs before object-specific tabs)
- Component design system (buttons, forms, tables, modals, drawers, badges, chips, cards, tabs, empty states, loading states)
- Design tokens (color, spacing, typography)
- Breadcrumb structure and rendering
- Action menu ordering and behavior
- Layout grid and responsive breakpoints
- Accessibility defaults and aria templates

**Workspace Core does NOT own:**
- Business logic (owned by the core responsible for the business object — Service Core owns Service logic, Financial Core owns Invoice logic)
- Data models (owned by business cores; see `03_INFORMATION_ARCHITECTURE.md`)
- Permission enforcement (owned by Security Core; frontend hides/disables as UX courtesy)
- Navigation placement decisions (owned by the core responsible for the object; see `04_NAVIGATION_ARCHITECTURE.md`)
- Brand identity (owned by Brand v3.0 at `docs/branding/v3.0/`)

## 10. Relationships

**Workspace Core depends on:**
- Identity Core (who is acting; used to check permissions)
- Tenant Core (which tenant; used to scope navigation, features, branding)
- Security Core (permission enforcement; frontend respects backend decisions)
- Configuration Core (feature flags, runtime config affecting page visibility and zone behavior)
- Audit Core (logging UI interactions if audit-grade semantics apply; mostly a one-way dependency)

**Cores depend on Workspace Core:**
- Every business core that owns a detail page / list page / dashboard / workspace depends on Workspace Core to render those views via PageShell and the object detail tab set.

**Supporting cores reference Workspace:**
- Navigation Core (see `04_NAVIGATION_ARCHITECTURE.md`) assembles nav entries from Workspace and core-owned pages.
- Metadata Core (see `03_INFORMATION_ARCHITECTURE.md`) provides custom field rendering inside Workspace pages, but does not own the page structure.
- Event Core publishes page-navigation events; Workspace may subscribe to them for analytics or breadcrumb updates.

## 11. Responsibilities

### 11.1 Workspace Core team

- Owns and maintains the PageShell component and all six zones
- Maintains the object detail tab set (adding, reordering, or removing tabs requires a constitution amendment)
- Owns the design system (component implementations, token registry, accessibility templates)
- Maintains the left nav tree structure and rendering behavior
- Owns page types, page registry, and default layouts
- Ensures every page consumes PageShell and uses canonical components
- Maintains responsive behavior in `frontend/src/styles/_responsive.css` (cascade-last, one place)
- Enforces token-only color and spacing in component code
- Defaults to "Platform Engineering" until org expansion (per `01_PLATFORM_CORE_ARCHITECTURE.md` L6)

### 11.2 Other core teams (on their pages)

- Declare their page type, route, title, and icon to Workspace Core / PageShell
- Declare their object-specific tabs (after the canonical nine)
- Declare object editing surfaces (drawer vs. dedicated page vs. modal)
- Consume PageShell and shared components; never invent local versions
- Delegate styling to the design system; no per-page CSS exceptions
- Respect the spacing law (24px horizontal, zone-specific vertical)
- Enforce all business logic and permissions at the API (backend ownership)

### 11.3 Reviewers of UI PRs

- Confirm PageShell is consumed, not reimplemented
- Confirm shared components are reused, not duplicated
- Confirm no hardcoded color, spacing, or typography outside the token registry
- Confirm brand assets are unchanged
- Confirm object detail pages follow the canonical nine-tab pattern
- Confirm drawer vs. dedicated page vs. modal selection is intentional
- Confirm accessibility (keyboard nav, focus, aria, color + label, loading states)
- Confirm mobile usability and no desktop-only capabilities
- Reject L1–L12 violations

## 12. Allowed Patterns

### AP1 — PageShell customization via props

Pages configure the PageShell by supplying props: `type`, `breadcrumb`, `icon`, `title`, `subtitle`, `statusSummary`, `kpis`, `views`, `primaryAction`, `secondaryActions`, `filters`, `children`, `workspaceClassName`, `contextPanel`. The PageShell resolves zone visibility based on these props and the page type. This is the only customization path for pages.

### AP2 — Object-specific tabs after the canonical nine

After the nine canonical tabs, a page may add object-specific tabs (e.g., Customer Services, Ticket KnowledgeBase, Invoice Adjustments). The ordering is: canonical first, then object-specific. The Tabs Standard and Object Detail Standard govern this.

### AP3 — Page-type-specific workspace content

Zone E (Workspace) renders different content based on page type. A `REGISTRY` page renders a table. A `PIPELINE` page renders tabbed boards. A `WORKSPACE` page renders multi-panel layout. An `OPERATIONS` page renders a map or calendar. An `ANALYTICS` page renders charts. These are all permitted; the page type controls the default behavior.

### AP4 — Responsive patterns per device

Mobile may use different patterns for the same workflow. Full-screen drawers instead of side drawers. Card lists instead of dense tables. Stacked sections instead of multi-column layouts. These are intentional responsive patterns, not shrunk desktop UI.

### AP5 — Custom fields via Metadata Core

Custom fields are rendered inside Workspace pages (typically in the Overview tab or a dedicated Custom section). Metadata Core provides field definitions; Workspace renders them according to the field type and validation metadata. The custom field rendering is part of Workspace, not a separate system.

### AP6 — Permission-aware navigation and actions

Navigation entries and action buttons are hidden or disabled if the user lacks permission. These are UX courtesy. Backend always enforces permission. Frontend respecting backend decisions is not backend security.

### AP7 — Feature flag gating of pages and zones

A page or zone may be hidden or shown based on feature flags. Feature flags are evaluated frontend-side; backend still enforces. A feature-flagged page that is hidden is not accessible via URL direct navigation or API (backend enforces).

## 13. Forbidden Patterns

### FP1 — Page-specific layout components

No page implements its own header, filter bar, action bar, pagination, or zone layout. Every page consumes PageShell and the shared components.

### FP2 — Hardcoded color and spacing in component code

Forbidden in TSX:
- `style={{ backgroundColor: '#0EA5E9' }}`
- `style={{ padding: '16px' }}`
- `className="bg-blue-500"`
- Per-page CSS with custom colors or spacing

Every color and spacing value comes from a token. Raw hex, inline rgba, and non-standard token names are violations.

### FP3 — Page-specific component variants

No page invents a custom button, form input, table column type, or badge variant. All components come from the design system. If the design system component does not fit, the standard is wrong, not the component.

### FP4 — Business logic in the UI

No permission checks that are not also enforced backend. No status transitions that are not also API-driven. No validation that is not also server-side. The UI is the presentation layer; the backend is the authority. Breaking this rule (see `01_PLATFORM_CORE_ARCHITECTURE.md` FP8) is an architecture violation.

### FP5 — Separate object detail tab sets

Every object detail page uses the same nine-tab canonical set before object-specific tabs. No page invents a different set. Reordering, skipping, or substituting these tabs without a constitution amendment is forbidden.

### FP6 — Modal for complex forms or multi-step workflows

Modals are for confirmations, quick-create (simple short form), and simple prompts. Complex forms, multi-section forms, and workspaces use drawers or dedicated pages. Oversized modals are forbidden.

### FP7 — Nested drawers or modals

A drawer may not open another drawer. A modal may not open another modal. If nesting is unavoidable, replace content or navigate to a page instead. Keep the nesting depth ≤1 and document the exception.

### FP8 — Tenant-specific navigation forks

Navigation is stable and unified. No tenant-specific nav trees, no per-role reordering, no hiding sections differently per tenant. Hiding individual items based on permissions or feature flags is permitted; reordering or restructuring the tree per tenant is not.

### FP9 — Brand asset redesign or reinterpretation

Logo geometry, spacing, font stack, and color assignment are sealed. No experimentation. No "modern" update. No gradient-overlay moment. No new brand assets without consulting `docs/branding/v3.0/`. Any color change that affects brand identity requires a constitution amendment.

### FP10 — Desktop-only business capabilities

Every core workflow must be usable on mobile. A business capability that only works on desktop is a violation. Mobile may use different UI patterns; mobile may not have missing features.

### FP11 — Hover-only interactions on mobile

No critical action is available only on hover. Mobile does not have hover. Hover is for secondary affordances (tooltips, subtle feedback). Primary actions have click/tap handlers and are accessible from non-hover interactions.

### FP12 — Accessibility ignorance

No color-only status indicators. No icon-only buttons without labels. No missing focus rings. No aria-label-less icon buttons. No disabled state without explanation. No loading state that spins forever. No form that submits invalid data. No contrast violation. Accessibility is not optional.

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Core definitions, Workspace Core purpose, EXPERIENCE tier |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership model, cross-core integration rules, FP8 (UI is not authority) |
| `02_DOMAIN_ARCHITECTURE.md` | Domain-to-core mapping; pages are assembled from cores |
| `03_INFORMATION_ARCHITECTURE.md` | Entity ownership by core; what data pages display |
| `04_NAVIGATION_ARCHITECTURE.md` | Navigation tree, workflow grouping, placement of pages in nav |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys, enforcement, frontend vs. backend |
| `09_DATA_ARCHITECTURE.md` | Schema for canonical entities (Task, Comment, Attachment, etc.) |
| `10_API_ARCHITECTURE.md` | API surface; pages call these APIs |
| `11_EVENT_ARCHITECTURE.md` | Event topics; pages subscribe for real-time updates |
| `docs/standards/01-strategic-product-direction.md` | Device strategy, interface density, object editing strategy |
| `docs/standards/09-design-system-standards.md` | Component standards (button, form, table, modal, drawer, etc.) |
| `docs/standards/10-ui-structure-page-shell-standards.md` | PageShell standard, universal page zones, page types, object detail tabs |
| `docs/standards/11-pipeline-lifecycle-page-behavior-standards.md` | Pipeline page tabs, lifecycle stages, stage ownership |
| `docs/standards/14-enum-registry.md` | Enum definitions (PageType, AuditEventType, etc.) |
| `docs/branding/v3.0/README.md` | Brand source of truth; logo, typography, color sealed |
| `frontend/src/page-shell/PageShell.tsx` | PageShell implementation (zone definitions, CSS grid, zone visibility) |
| `frontend/src/styles/gaahex-tokens.css` | Canonical token registry (all color, spacing, typography) |

| Documents that depend on this one |
|---|
| `04_NAVIGATION_ARCHITECTURE.md` (pages are rendered via Workspace) |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` (workflow UI surfaces are pages) |
| Any core's UI placement documentation |
| All UI/frontend PRs and reviews |

## 15. Implementation Requirements

### 15.1 PageShell adoption

Every page in the codebase must consume the PageShell component. Migration order:
1. Build PageShell component (✓ deployed in `frontend/src/page-shell/PageShell.tsx`)
2. Build shared primitives (PageHeader, KPIBar, ActionBar, FilterBar, ContextPanel) (✓ deployed)
3. Validate architecture via a test page
4. Migrate existing pages page-by-page (preserve routes, permissions, data behavior; update layout structure)
5. Remove legacy page wrapper/header/footer components once all pages are migrated

During migration, preserve:
- Routes and route parameters
- Permissions (enforcement happens backend; frontend respects decisions)
- API calls and data behavior
- Audit and event emission (business logic unchanged)
- Loading, empty, error states

### 15.2 Design tokens governance

The canonical token file is `frontend/src/styles/gaahex-tokens.css`. All color, spacing, and typography tokens are defined here. Component code references only Tier-1 semantic tokens. Tier-0 raw scales are for the design system to remap.

Token naming follows:
- Semantic: `--gx-interactive`, `--gx-text-1`, `--gx-success-fg`, `--gx-bg`, `--gx-space-4`, `--gx-font-sans`
- Raw scales: `--cobalt-500`, `--azure-700`, `--slate-300` (forbidden in component code; design-system-only)

No new tokens are added to component code without updating the canonical registry. Tokens are immutable once released (per `01_PLATFORM_CORE_ARCHITECTURE.md` and Versioning rules).

### 15.3 Component standards enforcement

Every component (Button, Form, Table, Modal, Drawer, Badge, Chip, Card, Tabs, Empty State, Loading Skeleton) has a locked standard in `docs/standards/09-design-system-standards.md`. Component code must comply. Deviations are reviewed before merge. New component types require a standard amendment.

### 15.4 Accessibility checklist per PR

UI PRs include:
- [ ] Keyboard navigation (tab order, enter, escape, arrow keys where applicable)
- [ ] Focus management (visible focus ring, focus restoration on close)
- [ ] Aria attributes (role, aria-label, aria-describedby, aria-disabled, aria-expanded)
- [ ] Color + label (status is never color-only; icons never replace text)
- [ ] Loading/empty/error states (semantic feedback, never spin forever)
- [ ] Long-label support (no text truncation in the critical path)
- [ ] Mobile usability (responsive patterns are intentional, not shrunk)

Failure to include this checklist is grounds for a blocking review comment.

### 15.5 Object detail tab compliance

Every object detail page (Customers, Tickets, Tasks, Invoices, Services, Contracts, etc.) implements the nine canonical tabs in order:
`Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit`

Object-specific tabs come after these. A page that skips or reorders a canonical tab requires a constitution amendment and explicit approval.

### 15.6 Brand asset verification

Every PR that introduces a new visual asset (logo, icon, color, typography, spacing) must reference:
1. The locked brand standard at `docs/branding/v3.0/`
2. The canonical token registry (`frontend/src/styles/gaahex-tokens.css`)
3. The brand manifest (`frontend/public/`) or brand archive (`_archive-pre-v3.0/`)

PRs that redesign, reinterpret, or change brand assets are blocked until approved by the brand authority (see `docs/branding/v3.0/README.md`).

### 15.7 Responsive CSS centralization

All responsive behavior is defined in `frontend/src/styles/_responsive.css` (cascade-last). No page has its own media queries or responsive CSS. The centralized file governs all breakpoints and responsive patterns. A page-specific media query is a code review violation.

### 15.8 Design system token drift guard

A CI check (`tools/check_drift_design_tokens.py` or equivalent) scans component code for:
- Hardcoded hex literals (e.g., `#0EA5E9`, `#1C3B68`)
- Inline rgba (e.g., `rgba(0, 165, 233, 0.5)`)
- Non-`--gx-*` token references (e.g., `var(--blue-500)`, `var(--nms-primary)`)
- Hardcoded spacing values (e.g., `padding: 16px`, `margin: 24px`)

Violation causes the check to fail. The fix is to use the canonical token registry.

### 15.9 Brand asset inventory

The canonical brand inventory is:
- Logo: `docs/branding/v3.0/01-logo/` (hexagon chevron, Cobalt + Gold, no connector lines)
- Favicon: `docs/branding/v3.0/03-favicon/`
- PWA icons: `docs/branding/v3.0/04-pwa/`
- Social preview: `docs/branding/v3.0/05-social/`
- Runtime assets: `frontend/public/logo/`, `frontend/public/favicon/`, `frontend/public/app-icons/`, `frontend/public/social/` (v3.0 derivatives as of 2026-06-06)
- Pre-v3.0 archive: `frontend/public/_archive-pre-v3.0/` (rollback only)

Any change to runtime brand assets requires reconciliation with the source at `docs/branding/v3.0/`.

### 15.10 Quality bar and PR gates

UI features are considered complete when:
- PageShell is consumed (not reimplemented)
- Shared components are reused (not duplicated)
- All color and spacing comes from tokens (no hardcoding)
- Object detail page follows the canonical nine-tab pattern (if applicable)
- Drawer vs. dedicated page vs. modal selection is intentional and justified
- Mobile is usable and intentional (responsive patterns documented, not shrunk)
- Accessibility passes checklist (keyboard, focus, aria, color + label, loading states)
- Permission checks are frontend-only (backend enforces)
- The PR description names the core(s) responsible (primary and supporting)

A UI PR is blocked until:
- [ ] Consumed PageShell or justified local layout
- [ ] Reused design system components or justified exception
- [ ] All color/spacing from tokens or identified drift violations
- [ ] Object detail tabs follow canonical pattern or amendment approved
- [ ] Mobile patterns are intentional (responsive, not shrunk)
- [ ] Accessibility checklist is complete
- [ ] Backend permission enforcement is verified (frontend is courtesy)
- [ ] Brand authority has reviewed if brand assets changed

## 16. Future Expansion Rules

### 16.1 Adding a new page type

A new `PageType` value requires:
1. Clear use case (e.g., a Gantt chart view for Scheduling Core; a network topology view for NOC)
2. Zone visibility specification (which zones A–F are shown for this type?)
3. Layout rules (responsive behavior, spacing, multi-column strategy)
4. Default component set (what tables, cards, panels are typical?)
5. Constitution amendment adding the type to the `PageType` enum and this document
6. PageShell code updated to handle the new type (e.g., CSS grid layout, zone visibility logic)

### 16.2 Adding a canonical object-detail tab

The nine canonical tabs are locked per L4. Adding a 10th tab requires:
1. Justification: why is this tab present on every object detail page (not just one specific object)?
2. Data model: what entity does this tab display? (It must be canonical, not metadata-specific.)
3. Permissions: does viewing this tab have separate permission grants from the object itself?
4. A proposal document and constitution amendment
5. Approval by platform leadership

Adding an object-specific tab (after the canonical nine) requires no amendment.

### 16.3 Changing the spacing law

The PageShell Spacing Law (L3: horizontal edge = 24px, `var(--gx-space-12)`) is locked 2026-06-06. Changing it requires:
1. A detailed rationale (what problem does the new spacing solve? what pages benefit?)
2. Responsive impact analysis (does the new spacing break mobile or small screens?)
3. Accessibility impact (does new spacing affect users with low vision or dyslexia?)
4. Token registry update (new spacing scale tokens if needed)
5. Comprehensive PageShell CSS update (all six zones, all page types)
6. Migration plan for existing pages
7. Constitution amendment

Changing spacing without this process is forbidden.

### 16.4 Adding a new color family or changing color roles

Color families and roles are locked per P8 and L7. Adding a 6th family or reassigning a role requires:
1. Design system analysis (what new role is needed that the five families do not cover?)
2. Existing pattern audit (how many components would need updating?)
3. Brand impact (does this change the brand's visual identity?)
4. Token registry update with the new Tier-1 semantic tokens
5. Component code migration (every component that uses color must be updated)
6. Accessibility review (contrast, colorblind-safe, semantic clarity)
7. Constitution amendment
8. Brand authority approval

---

*End of 06 — UI / Experience Architecture.*
