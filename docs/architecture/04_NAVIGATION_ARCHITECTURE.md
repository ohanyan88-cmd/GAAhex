# 04 — Navigation Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`,
after `01_PLATFORM_CORE_ARCHITECTURE.md`, `02_DOMAIN_ARCHITECTURE.md`, and
`03_INFORMATION_ARCHITECTURE.md`. Governs how users find, traverse, and
return to work surfaces in GAAhex.

---

## 1. Purpose

Define the canonical navigation model: the left navigation tree, top bar,
command palette, breadcrumb, deep-link contract, page registry, and the
rule that navigation reflects **user workflows**, not platform-core taxonomy.

## 2. Scope

In scope:

- Workspace navigation chrome: left nav, top bar, breadcrumb, page tabs,
  command palette, contextual back/forward.
- The locked GAAhex navigation tree for M1.
- Deep-link URL contract.
- Navigation visibility rules (permission / entitlement / tenant /
  feature-flag gating).
- Portal navigation (separate surface; consumes the same model).
- Navigation behavior on mobile (delegated to `22_MOBILE_OFFLINE_ARCHITECTURE.md`).

Out of scope:

- Page-internal layout (PageShell zones) — see `06_UI_EXPERIENCE_ARCHITECTURE.md`.
- Permission key semantics — see `08_PERMISSION_ARCHITECTURE.md`.
- API URL design — see `10_API_ARCHITECTURE.md` (different naming surface
  entirely from the user-facing URL).
- Marketing or public site navigation (external concern).

## 3. Goals

- **G1** A user finds any record in ≤ 3 clicks from any starting state via
  left-nav, palette, or breadcrumb.
- **G2** The left nav is grouped by **user workflow**, not core taxonomy
  (PRM § "Non-Negotiable Separation Rule" #12).
- **G3** Navigation is **configurable** at tenant level — entries appear/
  disappear based on Entitlement, Permission, Feature Flag, and Tenant
  Settings.
- **G4** Every page has a stable deep-link URL.
- **G5** Navigation respects the dense-operations UX target (Linear / Jira /
  Datadog / Grafana density) — no marketing-CRM spaciousness.
- **G6** Internal Workspace and external Portal navigation share the model
  but maintain distinct surfaces.
- **G7** Navigation behavior on Mobile is workflow-first: short paths to
  field-tech surfaces (work orders, dispatch, signature capture).

## 4. Non-Goals

- **NG1** This document does NOT mirror PRM core taxonomy in nav labels
  (forbidden by PRM § "Non-Negotiable" rule 12).
- **NG2** This document does NOT design page bodies — see `06`.
- **NG3** This document does NOT define API URLs — different namespace.
- **NG4** This document does NOT define visual styling — see Brand v3.0
  and Standards 09 (LOCKED design system).
- **NG5** This document does NOT define mobile-specific gestures — see `22`.

## 5. Architecture Principles

### P1 — Workflow-first labeling

Left-nav labels are **user-mental-model** terms: "My Day", "Customers",
"Network", "Billing" — not core names like "Party Core" or "Resource Core".

### P2 — Single locked tree

There is exactly one canonical left-nav tree (§7.1). Tenants may **hide**
nodes via Entitlement / Permission / Feature Flag, but they may not **rename**
or **reorder** the canonical structure (renaming is an Experience customization
addressed in §16). The tree is stable at the constitution level.

### P3 — Three navigation modes coexist

- **Left nav** — primary discovery, persistent.
- **Top bar** — global utilities (search palette, tenant switcher, user menu,
  notifications, help).
- **Command palette** — keyboard-first deep navigation (Ctrl/Cmd-K).

All three resolve to the same page registry.

### P4 — Deep links are first-class

Every page exposes a deep-link URL that survives copy/paste, browser
history, and link-sharing. URLs encode the meaningful context (entity ID,
tab, filter state).

### P5 — Navigation is permission-aware

A nav entry the user cannot access is HIDDEN, not shown disabled. This
matches Standard 22 (Navigation Standard, LOCKED).

### P6 — Two navigation surfaces — Workspace + Portal

The Workspace surface (internal users) and Portal surface (external users)
share the page registry but project different subtrees with different
defaults and different visibility rules.

### P7 — Density and predictability

Dense operational UI: tight padding, terse labels, keyboard-driven
shortcuts. Predictable: the same action lives in the same place across
pages.

## 6. Architecture Laws

### L1 — Workflow-grouping rule

> Left-nav top-level groups MUST reflect user workflows. They MUST NOT
> reproduce PRM tier / core names.

Valid top-level groups: "My Day", "Customers", "Services", "Network",
"Workforce", "Billing", "Operations", "Reports", "Studio", "Admin".
Invalid: "Foundation", "Business Objects", "Platform Services".

### L2 — Locked nav tree

> The canonical M1 left-nav tree (§7.1) is constitutional. Adding /
> removing top-level groups is a constitution amendment.

### L3 — Hidden-not-disabled

> Navigation entries the user cannot access (permission / entitlement /
> feature-flag) MUST be hidden, not rendered disabled.

### L4 — Deep-link URL contract

> Every page has a stable URL. The URL pattern is documented in §7.3.
> URLs MUST encode the meaningful state (entity ID, tab, filter) so they
> can be shared and bookmarked.

### L5 — Tenant-scoped tenant switcher

> If a user belongs to multiple tenants, the tenant switcher is in the top
> bar. Tenant context is encoded in the session, never in the URL.

### L6 — Command palette parity

> Every navigation target reachable from left-nav MUST be reachable from
> the command palette.

### L7 — Breadcrumb integrity

> Every detail page renders a breadcrumb that traces back to a top-level
> nav group. Orphan pages without breadcrumb anchorage are forbidden.

### L8 — Portal isolation

> Portal navigation cannot expose Workspace-only pages. Portal nav entries
> are explicit, declared in the page registry as `surface: PORTAL`.

### L9 — One canonical URL per page

> No page is reachable through two equally-canonical URLs. Aliases redirect
> to canonical.

## 7. Core Concepts

### 7.1 The locked M1 navigation tree

```
┌─────────────────────────────────────────────────────────┐
│  Left Nav (locked tree)                                 │
└─────────────────────────────────────────────────────────┘

WORKSPACE SURFACE (internal users)
│
├── My Day                                  (Workspace Core)
│   ├── Home                                (welcome, role-aware widgets)
│   ├── My Tasks                            (Work Core, filtered by assignee)
│   ├── My Cases                            (Case Core, filtered by assignee)
│   ├── My Approvals                        (Approval Core, filtered by approver)
│   ├── Notifications                       (Notification Core, my inbox)
│   └── Recent
│
├── Customers                               (Domain: CRM)
│   ├── All Customers                       (Party.Customer)
│   ├── Leads & Prospects                   (Party.Customer where status=LEAD)
│   ├── Households                          (Party.Household)
│   ├── Contacts                            (Party.Contact)
│   ├── Communications                      (Communication Core inbox)
│   └── Knowledge                           (Knowledge Core — CRM-tagged)
│
├── Services                                (Domain: OSS)
│   ├── All Services                        (Service Core)
│   ├── Subscriptions                       (Service.Subscription)
│   ├── Catalog                             (Product Core: read-only here)
│   ├── Provisioning Queue                  (Service in PROVISIONING)
│   ├── Service Health                      (SLA + Observability roll-up)
│   └── Topology                            (Relationship Core graph view)
│
├── Network                                 (Domain: Network)
│   ├── Network Inventory                   (Resource Core: OLT/ONU/Fiber/IP)
│   ├── Sites                               (Location Core)
│   ├── Topology                            (network-side topology graph)
│   ├── Incidents                           (Case.Incident filtered to network)
│   ├── Changes (RFC)                       (Case.ChangeRequest)
│   ├── Maintenance Windows                 (Scheduling.MaintenanceWindow)
│   └── NOC Dashboard                       (Observability roll-up)
│
├── Workforce                               (Domain: Workforce)
│   ├── Dispatch Board                      (Scheduling + Work)
│   ├── My Team                             (Organization.Team for current user)
│   ├── Field Jobs                          (Work.FieldJob)
│   ├── Calendar                            (Scheduling)
│   ├── Mobile Audit                        (Mobile.OfflineSyncRecord)
│   └── Skills & Certifications             (Party.Employee meta)
│
├── Billing                                 (Domain: Billing)
│   ├── Invoices                            (Financial.Invoice)
│   ├── Payments                            (Financial.Payment)
│   ├── Quotes & Orders                     (Financial.Quote + Order)
│   ├── Pricing                             (Financial.Pricing)
│   ├── Dunning                             (Financial.DunningRecord)
│   ├── Credits & Refunds                   (Financial.Credit)
│   └── Revenue Dashboard                   (Analytics roll-up)
│
├── Operations                              (cross-domain)
│   ├── Cases                               (Case Core, full view)
│   ├── Tickets                             (Case.Ticket)
│   ├── Incidents                           (Case.Incident, all domains)
│   ├── Change Requests                     (Case.ChangeRequest)
│   ├── SLA Breach Board                    (SLA Core)
│   └── Approvals                           (Approval Core, full view)
│
├── Reports                                 (Domain: Reporting)
│   ├── Dashboards                          (Analytics Core)
│   ├── Standard Reports                    (Reporting Core)
│   ├── Scheduled Exports                   (Import/Export Core)
│   └── Forecasts                           (Forecasting Core)
│
├── Studio                                  (Domain: Studio, admin-by-default)
│   ├── Entities & Fields                   (Metadata Core)
│   ├── Workflows                           (Workflow Core authoring)
│   ├── Automations                         (Automation Core authoring)
│   ├── Templates                           (Template Core)
│   ├── Pages & Layouts                     (Workspace Core authoring)
│   ├── Permissions                         (Permission catalog)
│   └── Brand & Theme                       (Tenant branding)
│
└── Admin                                   (Domain: Administration)
    ├── Tenants                             (Tenant Core)
    ├── Users                               (Identity.User)
    ├── Roles & Permissions                 (Permission)
    ├── Plans & Entitlements                (Entitlement Core)
    ├── Audit Log                           (Audit Core)
    ├── Compliance                          (Compliance Core)
    ├── Integrations                        (Integration Core)
    ├── Developer Platform                  (Developer Platform Core)
    ├── Marketplace                         (Marketplace Core; M2+)
    ├── AI Configuration                    (AI Core)
    ├── Security                            (Security Core)
    └── System Health                       (Observability Core)

PORTAL SURFACE (external users, condensed)
│
├── Dashboard                               (Portal-curated home)
├── My Services                             (subset of Service Core)
├── Billing                                 (subset: invoices, payments, autopay)
├── Support                                 (subset: tickets I opened)
├── Knowledge                               (subset: customer-visible articles)
├── Documents                               (subset: my documents)
└── Account                                 (profile, preferences, security)
```

### 7.2 Top bar (workspace surface)

Left → right:

- **Brand mark** (link to "My Day → Home")
- **Tenant switcher** (visible when user has >1 tenant; per L5)
- **Global Search palette trigger** (Ctrl/Cmd-K)
- **Notifications dropdown**
- **Help menu** (knowledge, what's new, support)
- **User menu** (profile, preferences, sign out)

### 7.3 Deep-link URL contract

The canonical URL patterns:

| Page kind                  | URL pattern                                |
|----------------------------|--------------------------------------------|
| Top-level group            | `/<group>` (e.g. `/customers`)             |
| List / registry            | `/<group>/<entity-slug>` (e.g. `/customers/all`) |
| Detail                     | `/<group>/<entity-slug>/<id>` (e.g. `/customers/all/CUS-2026-000417`) |
| Detail tab                 | `/<group>/<entity-slug>/<id>/<tab>` (e.g. `/customers/all/CUS-2026-000417/timeline`) |
| Saved view                 | `/<group>/<entity-slug>?view=<savedViewId>` |
| Drawer (modal-like)        | `/<group>/<entity-slug>/<id>#drawer=<drawerKey>` |
| Studio                     | `/studio/<artifact-slug>/<id?>`            |
| Admin                      | `/admin/<artifact-slug>/<id?>`             |
| Portal                     | `/portal/<page>` (e.g. `/portal/billing`)  |

Rules:

- The path identifies the page; the query string identifies state (filters,
  view, scroll).
- The hash fragment identifies UI overlays that should NOT consume browser
  history (drawer open state).
- Reference number `CUS-2026-000417` is the canonical user-facing ID; the
  page resolves it to UUIDv7 internally.
- An ID-only fallback URL exists for sharing in environments that lose
  reference-number context: `/r/<id>` redirects to the canonical URL.

### 7.4 Command palette

Triggered by Ctrl/Cmd-K. Modes:

- **Navigate** — start typing nav-entry name or page label.
- **Find** — start typing entity name / reference number; results group by
  ObjectType.
- **Action** — prefix `>` to run actions (Create customer, Open new ticket,
  Switch tenant, …).

The palette consults the Page Registry (Workspace Core) and Search Core in
parallel.

### 7.5 Breadcrumb

Always present on detail pages. Structure:

```
<group> › <entity-list> › <entity-name (ref)> › <tab>
```

Example: `Customers › All Customers › Acme Corp (CUS-2026-000417) › Timeline`.

### 7.6 Page tabs

Per Standard 10 (PageShell), detail pages expose the common tab set
*before* object-specific tabs:

```
Overview · Timeline · Tasks · Comments · Attachments · Approvals · Related ·
Communications · Audit
```

Object-specific tabs follow. Tabs are URL-addressable per §7.3.

### 7.7 Mobile navigation

Delegated to `22_MOBILE_OFFLINE_ARCHITECTURE.md`. The mobile surface
condenses the left nav to a workflow-first short list (Dispatch, My Jobs,
My Day, Customer lookup) with the rest accessible via global search.

## 8. Canonical Entities

Navigation owns these entities (Workspace Core):

| Entity                | Purpose                                  |
|-----------------------|------------------------------------------|
| LeftNavEntry          | Node in the locked tree                  |
| TopNavEntry           | Top-bar utility                          |
| PageRegistryEntry     | Page record: route, title, breadcrumb anchor |
| BreadcrumbAnchor      | Where a page slots in the tree           |
| SavedView             | (Search Core) saved filters per list     |
| CommandPaletteEntry   | Cached registry entry for palette        |

Permissions on these entities live in Workspace Core's permission scope
(see `08_PERMISSION_ARCHITECTURE.md`).

## 9. Ownership Boundaries

### 9.1 Workspace Core owns the chrome

The left nav, top bar, palette, breadcrumbs, and page registry are owned by
Workspace Core. Business domains do not implement their own nav.

### 9.2 Domains contribute nav entries

A new feature in Domain X adds a `PageRegistryEntry` (or a
`LeftNavEntry`) declaring the page's group and slot. The page itself lives
in its core; the registration lives in Workspace Core's tables.

### 9.3 Tenant configuration controls visibility

`TenantSetting.navOverrides` may hide / pin nav entries per tenant. Renaming
is governed by §16 (Custom Labels).

## 10. Relationships

### 10.1 Nav entry → Page registry → Page implementation

```
LeftNavEntry  ──> PageRegistryEntry  ──> implementation route/view
```

### 10.2 Permission → Nav visibility

```
PermissionKey  ──> required-for ──> PageRegistryEntry  ──> hides LeftNavEntry
```

### 10.3 Entitlement → Nav visibility

```
EntitlementFeature  ──> gates ──> PageRegistryEntry  ──> hides LeftNavEntry
```

### 10.4 Feature flag → Nav visibility

```
FeatureFlag  ──> gates ──> PageRegistryEntry  ──> hides LeftNavEntry
```

### 10.5 Search ↔ Palette

```
Search Core (indexes entities)  ←→  Command Palette (resolves typed text to entities)
```

## 11. Responsibilities

### 11.1 Workspace Core team

- Maintains the locked nav tree.
- Owns the page registry.
- Owns top-bar utilities.
- Owns the palette implementation.

### 11.2 Domain teams

- Register their pages in the page registry.
- Declare required permissions / entitlements / feature flags per entry.
- Provide page implementations.

### 11.3 Tenant admin (operating role)

- Configures `TenantSetting.navOverrides` for per-tenant hide/pin.
- Configures custom labels (per §16) where permitted by plan.

## 12. Allowed Patterns

### AP1 — Hide nav entry on missing permission

A user lacking `service.view` does not see "Services" in the left nav and
cannot deep-link to a Service page.

### AP2 — Entitlement-gated nav

A tenant without the "Marketplace" entitlement does not see the Marketplace
entry under Admin.

### AP3 — Tenant pin / hide

A tenant pins "Cases" to the top of the left nav for their NOC team; another
tenant hides "Marketplace" entirely.

### AP4 — Saved view as deep-link

A user saves a filter ("Customers with overdue invoices > 30 days") and
shares the URL — recipients see the same filter applied.

### AP5 — Palette deep navigation

A user presses Ctrl-K, types "CUS-2026-000417", and lands on the customer
detail without traversing the left nav.

### AP6 — Breadcrumb back-traversal

A user clicks "All Customers" in the breadcrumb on a customer detail page
to return to the list with their previous filters intact.

## 13. Forbidden Patterns

### FP1 — Mirroring core taxonomy in nav

Top-level group "Party" or "Resource" or "Workflow Core" — forbidden.

### FP2 — Disabling nav entries the user can't access

Greyed-out "Billing" with a tooltip "Requires plan upgrade" — forbidden. The
entry MUST be hidden. (Upsell prompts live in their own surfaces, not in
nav.)

### FP3 — Unstable URLs

Generating session-temporary URLs for detail pages or encoding internal
state in the URL path. URLs are content-addressable.

### FP4 — Orphan pages

A page reachable only via direct link with no breadcrumb anchor and no nav
entry — forbidden. Every page is registered.

### FP5 — Tenant in URL path

`/t/<tenantId>/customers/...` — forbidden. Tenant is in session, not URL.
(Exception: signed cross-tenant Super-Admin links, governed by `14`.)

### FP6 — Two equally-canonical URLs

`/customers/all/CUS-2026-000417` AND `/customers/by-id/<uuid>` both
identifying the same canonical page — forbidden. There is one canonical
path; the other redirects.

### FP7 — Renaming the constitutional tree

Tenants do not rename "Workforce" to "FieldOps" via free text; renaming is
governed by §16. Free-text rename would break documentation, training, and
audit trails.

### FP8 — Direct nav implementation in pages

A page implementing its own sidebar — forbidden. The chrome is centralized.

## 14. Cross-Architecture Dependencies

| Upstream                                   | Reason                            |
|--------------------------------------------|-----------------------------------|
| `PLATFORM_REFERENCE_MODEL.md`              | Defines Workspace Core.           |
| `01_PLATFORM_CORE_ARCHITECTURE.md`         | Workspace Core boundaries.        |
| `02_DOMAIN_ARCHITECTURE.md`                | Defines the 12 domains exposed.   |
| `03_INFORMATION_ARCHITECTURE.md`           | Entity refs in URL contract.      |

| Downstream                                 | Reason                            |
|--------------------------------------------|-----------------------------------|
| `06_UI_EXPERIENCE_ARCHITECTURE.md`         | PageShell ↔ nav binding.          |
| `08_PERMISSION_ARCHITECTURE.md`            | Permission-gated visibility.      |
| `14_TENANT_ARCHITECTURE.md`                | Tenant context in session, not URL.|
| `22_MOBILE_OFFLINE_ARCHITECTURE.md`        | Mobile navigation surface.        |

| External implementation references | Reason |
|------------------------------------|--------|
| `../specs/SEARCH.md` | Search Core subsystem design — global cross-entity search + saved/recent/pinned + command palette + RLS scoping. Referenced from §7.4 (Command palette). |

## 15. Implementation Requirements

### 15.1 Page registry

`backend/app/cores/workspace/page_registry.py` is the canonical list of
PageRegistryEntries: route pattern, title, breadcrumb anchor, required
permissions, gating feature flag, surface (`WORKSPACE` or `PORTAL`).

### 15.2 Frontend nav rendering

`frontend/src/page-shell/SideNav.tsx` consumes the page registry and renders
the tree, applying:

1. Permission check (hides if missing).
2. Entitlement check.
3. Feature-flag check.
4. Tenant override check.

### 15.3 URL routing

Frontend route definitions match §7.3 URL patterns. Routes resolve reference
numbers to entity IDs server-side before rendering the detail page.

### 15.4 Command palette index

A background-built index (Search Core) keeps palette latency under 80ms for
typical tenants (< 100k entities). Re-indexed on entity create / update /
delete via events.

### 15.5 Deep-link redirects

The `/r/<id>` short-form redirect resolves UUIDv7 to canonical URL.
Implemented by Workspace Core, consults the entity's owner core for path
construction.

### 15.6 Tenant nav overrides

`TenantSetting.navOverrides` is a JSON document:

```json
{
  "hidden": ["studio.permissions", "admin.marketplace"],
  "pinned": ["operations.sla-breach", "customers.households"],
  "customLabels": {
    "workforce": "Field Operations"
  }
}
```

Stored in Configuration Core; consumed by SideNav at render time.

### 15.7 Drift check

`tools/check_drift.py` adds rules:

- Every backend route under `/api/v1` has a domain mapping (per `02`).
- Every frontend route in the router declares its PageRegistryEntry.
- No nav entry references a core/tier label (regex check against PRM
  terminology in nav labels).

## 16. Future Expansion Rules

### 16.1 Adding a top-level nav group

Constitution amendment. Update §7.1 tree. Update PageRegistryEntry
contributions across domains.

### 16.2 Adding a sub-entry

Domain teams add a PageRegistryEntry. No constitution amendment required.

### 16.3 Custom labels per tenant

Tenants may override visible labels via `navOverrides.customLabels`. The
underlying entry slug / route / permission key are immutable; only display
text changes. Default labels live in Localization Core.

### 16.4 Reordering

Default order is constitutional. Tenants may pin entries to top; full
reordering is reserved for future plan tiers.

### 16.5 Per-role nav variants

Future expansion (M2+): per-role default `navOverrides` (e.g. NOC users see
Network and Operations expanded; Sales users see Customers + Reports).
Implemented as Role-scoped overrides; canonical tree unchanged.

### 16.6 Portal navigation

Portal navigation entries (§7.1 PORTAL SURFACE) are governed separately;
additions require Portal Core ownership and Entitlement Core gating.

---

*End of 04 — Navigation Architecture.*
