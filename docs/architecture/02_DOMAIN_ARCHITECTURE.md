# 02 — Domain Architecture

**Constitutional document.** Position in the hierarchy: under `PLATFORM_REFERENCE_MODEL.md`,
following `01_PLATFORM_CORE_ARCHITECTURE.md`. Assembles cores into domains —
the product-shaped areas of GAAhex (CRM, OSS, BSS, Network, Inventory,
Workforce, Billing, Portal, Studio, Automation, Reporting, Administration).
All standards, modules, and pages must declare their domain.

---

## 1. Purpose

Define what a **Domain** is, enumerate the 12 canonical GAAhex domains, and
codify how cores assemble into domains, how domains relate to each other, and
how implementation modules align with domains.

The PRM names the cores; `01_PLATFORM_CORE_ARCHITECTURE.md` formalizes the
core lattice. This document is the *product-shape* layer: it explains how the
51 ownership surfaces compose into the 12 product areas an operator (CRM
manager, NOC engineer, billing clerk) recognizes as their workspace.

## 2. Scope

In scope:

- The definition of "Domain" as an assembly of cores around a coherent
  business mission.
- The 12 canonical GAAhex domains: CRM, OSS, BSS, Network, Inventory,
  Workforce, Billing, Portal, Studio, Automation, Reporting, Administration.
- The Core × Domain matrix: which cores contribute to which domains.
- Domain-to-implementation alignment: how `backend/app/`, `frontend/src/`
  packages and routes map to domains.
- Cross-domain interaction rules.

Out of scope:

- Core definitions and ownership rules — `01_PLATFORM_CORE_ARCHITECTURE.md`.
- Navigation (left-nav grouping) — `04_NAVIGATION_ARCHITECTURE.md`. Domains
  are NOT navigation groups; navigation is workflow-oriented.
- Entity relationships and ER diagrams — `03_INFORMATION_ARCHITECTURE.md`.
- Page-level UI design — `06_UI_EXPERIENCE_ARCHITECTURE.md`.

## 3. Goals

- **G1** Every backend module and frontend route declares its primary domain.
- **G2** Every domain has a clear mission statement and observable boundary.
- **G3** Domain composition is *additive* over cores: a domain is a curated
  selection of core capabilities, not a renaming of them.
- **G4** Domains are stable: the 12 domains are GAAhex's long-term product
  shape. Adding a 13th is a constitution amendment (per §16).
- **G5** Cross-domain interactions are documented contracts (events, APIs,
  shared cores), not ad-hoc imports.
- **G6** A new ISP tenant can be configured to enable only the domains it
  needs (e.g. a wholesale-only ISP may disable Portal and BSS-retail flows)
  without code change.

## 4. Non-Goals

- **NG1** This document does NOT define entity schemas — see
  `03_INFORMATION_ARCHITECTURE.md` and `09_DATA_ARCHITECTURE.md`.
- **NG2** This document does NOT define UI layout — see `04` and `06`.
- **NG3** This document does NOT redefine cores — see `01`.
- **NG4** Domains are NOT cores. A domain has no canonical entities of its own;
  it draws entirely from cores.
- **NG5** Domains are NOT user roles. A user with a Sales role may operate
  across CRM, Billing, and Reporting domains; a NOC engineer may operate
  across Network, OSS, and Workforce.

## 5. Architecture Principles

### P1 — A domain is a mission, not a folder.

A domain answers the question "what is this part of GAAhex *for*?". CRM is
*for managing customer relationships*. OSS is *for delivering and operating
services*. The implementation may be spread across many packages; the mission
is what defines the domain.

### P2 — Domains assemble cores; they do not own entities.

A domain is a *view* over a curated selection of cores. The canonical home of
an entity remains its core. CRM displays `Party.Customer` and `Service.Subscription`
and `Communication.Thread`, but does not own any of them. Ownership is
constitutional (per `01_PLATFORM_CORE_ARCHITECTURE.md` §9).

### P3 — Domains are configurable at tenant level.

A tenant may enable / disable / restrict a domain via Entitlement Core. The
configuration is data; the implementation is unchanged.

### P4 — Cross-domain integration is event-driven by default.

When CRM's Sales pipeline closes a deal, it publishes an event
(`Deal.Won`); BSS subscribes to provision billing; OSS subscribes to
provision the service; Workforce subscribes to schedule the installer. No
domain directly calls another.

### P5 — Domains respect tier discipline.

Domains assemble cores; the cores' tier discipline (per `01` L2) holds
transitively. CRM may *depend on* OSS (CRM consumers see service status) but
must not *call back into* a CRM-internal lower-level dependency cycle.

### P6 — The 12 domains are the long-term shape.

Adding a 13th domain is a constitution amendment, not a feature. Most "new
product areas" turn out to be either (a) a new workflow grouping within an
existing domain (handled in `04_NAVIGATION_ARCHITECTURE.md`) or (b) a new
*core* (handled in `01`). True new domains are rare.

## 6. Architecture Laws

### L1 — Single Primary Domain per artifact

> Every backend module, frontend route, database migration, integration
> connector, and feature flag declares exactly one primary domain.

Multi-domain artifacts are forbidden. If an artifact appears multi-domain,
that is the signal it should be split or that it actually belongs to a
shared core consumed by multiple domains.

### L2 — Domain Composition Manifest

> Every domain has a Composition Manifest: the explicit list of cores it
> draws from. The manifest is normative — a domain may not silently absorb
> cores not in its manifest.

Manifests live in §7 of this document.

### L3 — No domain owns canonical entities.

> Canonical entities belong to cores (per `01` L1). A domain may not declare
> its own ownership of a database table.

### L4 — Cross-domain reads via canonical APIs only.

> A domain reading data from another domain MUST go through the source
> core's canonical API (per `10_API_ARCHITECTURE.md`). Direct cross-domain
> table joins in application code are forbidden except via Reporting Core's
> read-only analytical models.

### L5 — Cross-domain writes via events only.

> A domain mutating state observed by another domain MUST publish a domain
> event; the other domain subscribes. Direct cross-domain function calls in
> the request path are forbidden except via the explicit cross-core API
> contracts documented in `10`.

### L6 — Domain enablement is tenant-scoped.

> Whether a tenant has access to a domain is governed by Entitlement Core
> (see `01` §7.4, Entitlement Core). Disabling a domain hides it from
> navigation, API responses, and search; existing data is preserved.

### L7 — Domain deprecation requires migration.

> Deprecating a domain requires migrating its surface (pages, APIs,
> permissions) to its replacement(s); existing tenant data persists.

## 7. Core Concepts

### 7.1 The 12 Canonical Domains

#### 7.1.1 CRM — Customer Relationship Management

**Mission.** Acquire, qualify, sell, retain, and grow customer relationships.

**Composition Manifest (primary cores):**

- Party (Lead, Prospect, Customer, Contact, Household)
- Communication (sales conversations, customer emails, calls)
- Workflow (sales pipeline state machines)
- Case (sales-side issues — lost-deal post-mortems, churn-risk cases)
- Notification (sales follow-ups, customer touchpoints)
- Analytics (sales KPIs, pipeline velocity, win rate)

**Composition Manifest (supporting cores):**

- Product (catalog visibility during quoting)
- Service (existing service visibility for upsell)
- Financial (quotes, account balance for credit checks)
- Knowledge (sales playbooks, objection-handling SOPs)

**Hard boundary.** CRM owns the *customer relationship*, not the *service*.
The moment a deal closes, ownership of the active subscription shifts to OSS
(via the `Deal.Won` → `Service.Provisioning.Started` event chain).

#### 7.1.2 OSS — Operations Support Systems

**Mission.** Design, provision, activate, monitor, and assure customer
services on the underlying network.

**Composition Manifest (primary cores):**

- Service (subscriptions, instances, provisioning state, topology)
- Workflow (provisioning state machines)
- Case (service-affecting incidents, technical problems, RFC change requests)
- Work (provisioning tasks, design tasks, change tasks)
- SLA (service-availability targets, incident clocks)
- Approval (change approvals, design approvals)
- Communication (technical conversations)

**Composition Manifest (supporting cores):**

- Resource (network elements consumed by services — see Network domain)
- Location (sites where services live)
- Party (the customer the service belongs to)
- Contract (the contract the service implements)
- Event (service events for downstream subscribers)
- Notification (customer service notifications)

**Hard boundary.** OSS owns the *service*, not the *network resource*. A
service consumes resources (OLT port, fiber pair, IP) but does not own them
— Network domain does.

#### 7.1.3 BSS — Business Support Systems

**Mission.** Run the business side of services: orders, contracts,
fulfillment-handoff, customer accounts.

**Composition Manifest (primary cores):**

- Contract (commercial agreements, terms, amendments)
- Workflow (order management state machines)
- Approval (commercial approvals, exception approvals)
- Document (contracts, agreements, fulfillment documents)
- Communication (account communications)
- Knowledge (commercial-process SOPs)

**Composition Manifest (supporting cores):**

- Party (Customer, Account contacts)
- Product (the catalog being sold)
- Service (the service being provisioned)
- Financial (the commercial outcome — billing is its own domain but BSS
  triggers it)
- Notification (order status notifications)

**Hard boundary.** BSS owns the *order and contract*, not the *invoice*
(Billing) nor the *service instance* (OSS). BSS hands off to both at clear
transition points.

#### 7.1.4 Network

**Mission.** Inventory, plan, monitor, and operate the physical and logical
network.

**Composition Manifest (primary cores):**

- Resource (network elements — OLT, ONU, router, switch, fiber, IP pool)
- Location (sites, racks, building references)
- Relationship (network topology, dependency graphs)
- Observability (network health, link state, alerts)
- Case (NOC tickets, incidents)
- Work (network change tasks, fiber installations)
- SLA (network-level availability targets)

**Composition Manifest (supporting cores):**

- Service (services consuming the resources — for impact analysis)
- Workflow (lifecycle of resources)
- Event (resource events for downstream)
- Notification (NOC alerts, escalations)

**Hard boundary.** Network owns *the network*. It does not own customer
services (OSS) or commercial agreements (BSS). It owns availability and
performance from a network-resource perspective; customer-service
availability is OSS.

#### 7.1.5 Inventory

**Mission.** Track non-network physical and digital assets (stock items,
vehicles, tools, licenses, spare parts).

**Composition Manifest (primary cores):**

- Resource (StockItem, Vehicle, Tool, SoftwareLicense)
- Location (warehouse, depot, vehicle assignment)
- Work (stock-pick tasks, vehicle-prep tasks)
- Workflow (inventory lifecycle, condition states)

**Composition Manifest (supporting cores):**

- Party (assigned technician)
- Financial (asset value, depreciation triggers)
- Event (stock events for procurement automation)
- Reporting (inventory reports)

**Hard boundary.** Inventory is *non-network* assets. Network resources
(OLT, fiber) live in the Network domain even though they are technically
"assets". The split is by usage: network gear consumed by services →
Network; field tools, vehicles, spare parts → Inventory.

#### 7.1.6 Workforce

**Mission.** Manage the people who do work: dispatch, scheduling, skills,
mobile field operations.

**Composition Manifest (primary cores):**

- Party (Employee, Contractor)
- Organization (Team, Department, Branch)
- Scheduling (dispatch slots, shift schedules)
- Work (work orders assigned to technicians)
- Mobile (field technician experience)
- Communication (dispatch-tech back-and-forth)

**Composition Manifest (supporting cores):**

- Location (job site addressing)
- Time (business hours, shifts, on-call)
- Service (the service being worked on)
- Case (the case being resolved)
- Notification (dispatch notifications, ETA updates)

**Hard boundary.** Workforce owns the *human + scheduling* side of operations.
It does not own the *what* (Work Core defines the task; Workforce dispatches
it).

#### 7.1.7 Billing

**Mission.** Charge customers correctly and collect on time.

**Composition Manifest (primary cores):**

- Financial (Quote, Order pricing, Invoice, Payment, Tax, Discount, Credit,
  Dunning)
- Workflow (billing-cycle state machines, dunning workflows)
- Notification (invoice, payment, dunning notifications)
- Document (invoices, statements, receipts)
- Template (invoice templates, statement templates, dunning templates)
- Communication (billing inquiries)

**Composition Manifest (supporting cores):**

- Party (Customer, billing contact)
- Contract (the commercial basis)
- Service (the metering source)
- Integration (payment gateway connectors)
- Compliance (tax compliance, audit evidence)

**Hard boundary.** Billing owns the *money flow*. It does not own the
*contract* (BSS) or the *service definition* (OSS / Product). It owns the
charge, the invoice, the payment, the dunning, the credit.

#### 7.1.8 Portal

**Mission.** Provide self-service experiences to customers, partners, and
vendors.

**Composition Manifest (primary cores):**

- Portal (customer/partner/vendor portal pages, auth surfaces, visibility
  rules)
- Workspace (shared with internal app — but Portal Core layers the
  external-user variant)
- Localization (portal is locale-sensitive)
- Notification (portal-driven notifications)
- Communication (portal messaging, tickets opened from portal)

**Composition Manifest (supporting cores):**

- Identity (portal users)
- Tenant (portal branding)
- Security (portal auth, rate limit)
- Service / Financial / Case / Document (everything portal users can see)
- Knowledge (self-service articles)

**Hard boundary.** Portal is *external*; Workspace is *internal*. They
share a model and they share cores, but the surface, permissions, and
defaults are distinct.

#### 7.1.9 Studio

**Mission.** Configure the platform: entities, fields, workflows, automations,
templates, layouts, navigation, branding.

**Composition Manifest (primary cores):**

- Configuration (tenant settings, module settings, env config)
- Metadata (custom fields, dynamic schemas, dynamic forms)
- Workflow (workflow-definition design — not execution)
- Template (template authoring — not delivery)
- Automation (automation-rule authoring — not execution)
- Workspace (page-layout authoring)

**Composition Manifest (supporting cores):**

- Permission (config edits are permissioned)
- Audit (config changes are audited)
- Governance (config edits respect standards)
- Entitlement (some config is plan-gated)

**Hard boundary.** Studio is the *authoring surface* for platform
configuration. It does not *execute* configuration; it authors it.
Execution belongs to the runtime cores (Workflow Core executes workflows,
Automation Core executes automations, Template Core renders templates).

#### 7.1.10 Automation

**Mission.** Define and run trigger-condition-action rules that connect cores
without code.

**Composition Manifest (primary cores):**

- Automation (rules, triggers, conditions, actions, executions)
- Event (the upstream signal)
- Background Processing (the execution substrate)
- Workflow (a common downstream target)
- Notification (a common downstream target)
- Integration (cross-system targets)

**Composition Manifest (supporting cores):**

- Audit (every automation run is audited)
- Permission (automations run with declared identity)
- Observability (automation health is monitored)
- Configuration (automation rules are config artifacts)

**Hard boundary.** Automation domain owns the *rule engine*. It does not
own *workflows* (Workflow Core; lifecycle is structural, not event-reactive)
or *integrations* (Integration Core; connectors are stable surfaces, not
ad-hoc reactions).

#### 7.1.11 Reporting

**Mission.** Produce governed reports, KPI dashboards, scheduled exports,
operational/commercial outputs.

**Composition Manifest (primary cores):**

- Reporting (report definitions, schedules, runs, files)
- Analytics (KPI definitions, dashboard datasets)
- Data (canonical schemas, lineage)
- Search (saved views promoted to reports)

**Composition Manifest (supporting cores):**

- Permission (report-level visibility)
- Tenant (tenant-scoped reports)
- Localization (localized report output)
- Storage (generated report files)
- Notification (scheduled-report delivery)

**Hard boundary.** Reporting domain owns *governed outputs* and *insight*.
It does NOT own the source data (each core retains ownership) and does NOT
own the dashboards as application code (Workspace Core renders them).

#### 7.1.12 Administration

**Mission.** Operate the platform: tenants, users, security posture,
compliance evidence, audit trail, system health.

**Composition Manifest (primary cores):**

- Tenant (tenant management)
- Identity (user management)
- Security (security configuration)
- Compliance (compliance evidence)
- Audit (audit-log browsing)
- Governance (standards, exceptions)
- Observability (operational dashboards)
- Configuration (cross-tenant config)
- Entitlement (plan management)

**Composition Manifest (supporting cores):**

- Permission (admin permissions)
- Event (system events)
- Background Processing (system jobs)
- Storage (admin storage policies)

**Hard boundary.** Administration is for *platform operators* (Super Admin,
Tenant Admin). Other domains are for *business users*.

### 7.2 Domain × Core Composition Matrix

A high-level summary. Read column-wise: which domains draw from each core.
A check mark means the domain includes that core in its primary or supporting
composition manifest.

| Core \\ Domain         | CRM | OSS | BSS | Net | Inv | WF  | Bill| Port| Stud| Auto| Rep | Adm |
|------------------------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| Governance             |     |     |     |     |     |     |     |     |  ✓  |     |     |  P  |
| Identity               |  S  |  S  |  S  |  S  |  S  |  P  |  S  |  S  |     |     |     |  P  |
| Tenant                 |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  P  |  S  |     |  S  |  P  |
| Security               |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  P  |  S  |  S  |     |  P  |
| Compliance             |     |     |  S  |     |     |     |  S  |  S  |     |     |     |  P  |
| Audit                  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  P  |     |  P  |
| Configuration          |     |     |     |     |     |     |     |     |  P  |  S  |     |  P  |
| Policy                 |     |     |     |     |     |     |     |     |  S  |  S  |     |  S  |
| Entitlement            |  S  |     |  S  |     |     |     |  S  |  S  |  S  |     |     |  P  |
| Observability          |     |     |     |  P  |     |     |     |     |     |  S  |     |  P  |
| Time                   |     |     |     |     |     |  S  |  S  |     |     |     |     |     |
| Party                  |  P  |  S  |  S  |     |     |  P  |  S  |  S  |     |     |     |     |
| Organization           |     |     |     |     |     |  P  |     |     |     |     |     |     |
| Location               |     |  S  |     |  P  |  P  |  S  |     |     |     |     |     |     |
| Resource               |     |  S  |     |  P  |  P  |     |     |     |     |     |     |     |
| Product                |  S  |     |  S  |     |     |     |     |     |     |     |     |     |
| Service                |  S  |  P  |  S  |  S  |     |  S  |  S  |  S  |     |     |     |     |
| Contract               |     |  S  |  P  |     |     |     |  S  |  S  |     |     |     |     |
| Work                   |     |  P  |     |  P  |  P  |  P  |     |     |     |     |     |     |
| Knowledge              |  S  |     |  S  |     |     |     |     |  S  |     |     |     |     |
| Financial              |  S  |     |     |     |  S  |     |  P  |  S  |     |     |     |     |
| Case                   |  P  |  P  |     |  P  |     |     |     |  S  |     |     |     |     |
| Workflow               |  P  |  P  |  P  |     |  P  |     |  P  |     |  P  |  P  |     |     |
| Automation             |     |     |     |     |     |     |     |     |  P  |  P  |     |     |
| Approval               |     |  P  |  P  |     |     |     |     |     |  S  |     |     |     |
| SLA                    |     |  P  |     |  P  |     |     |     |     |     |     |     |     |
| Scheduling             |     |     |     |     |     |  P  |     |     |     |     |     |     |
| Communication          |  P  |  P  |  P  |     |     |  P  |  P  |  P  |     |     |     |     |
| Notification           |  P  |  S  |  S  |  S  |     |  S  |  P  |  P  |     |  P  |  S  |     |
| Document               |     |     |  P  |     |     |     |  P  |  S  |     |     |     |     |
| Data                   |     |     |     |     |     |     |     |     |  S  |     |  P  |     |
| Metadata               |     |     |     |     |     |     |     |     |  P  |     |     |     |
| Relationship           |     |  S  |     |  P  |     |     |     |     |     |     |     |     |
| Search                 |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |     |  P  |  S  |
| Event                  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  S  |  P  |  S  |  S  |
| Integration            |     |     |     |     |     |     |  S  |     |     |  S  |     |     |
| Developer Platform     |     |     |     |     |     |     |     |     |     |     |     |  P  |
| Background Processing  |     |     |     |     |     |     |     |     |     |  P  |     |  S  |
| Import/Export          |     |     |     |  S  |  S  |     |  S  |     |  S  |     |  S  |  S  |
| Template               |     |     |  S  |     |     |     |  P  |     |  P  |     |  S  |     |
| Storage                |     |     |  S  |     |     |     |  S  |  S  |     |     |  S  |     |
| Analytics              |  S  |     |     |     |     |     |  S  |     |     |     |  P  |     |
| Reporting              |     |     |     |     |  S  |     |  S  |     |     |     |  P  |     |
| AI                     |  S  |  S  |     |  S  |     |     |     |  S  |     |  S  |  S  |     |
| Forecasting            |     |     |     |  S  |  S  |  S  |  S  |     |     |     |  S  |     |
| Decision Support       |  S  |  S  |     |  S  |     |  S  |     |     |     |  S  |     |     |
| Workspace              |  S  |  S  |  S  |  S  |  S  |  S  |  S  |     |  S  |     |  S  |  S  |
| Portal                 |     |     |     |     |     |     |     |  P  |     |     |     |     |
| Mobile                 |     |     |     |  S  |     |  P  |     |     |     |     |     |     |
| Marketplace            |     |     |     |     |     |     |     |     |     |     |     |  S  |
| Localization           |     |     |  S  |     |     |     |  S  |  P  |     |     |  S  |     |

Legend: **P** = primary; **S** = supporting; blank = not in manifest.

## 8. Canonical Entities

Domains do not have canonical entities of their own (L3). For each domain,
the canonical entities are the union of canonical entities of its primary
and supporting cores, scoped by the domain's mission. See
`03_INFORMATION_ARCHITECTURE.md` for the entity-relationship model.

## 9. Ownership Boundaries

### 9.1 Module ownership

Every backend Python module and frontend TS/TSX module declares its domain
in its top-of-file comment:

```python
# Domain: OSS
# Primary cores: Service, Workflow, Case, Work
# Supporting cores: Resource, Location, Party, Contract, Event
```

### 9.2 Route ownership

Every frontend route declares its domain in the route registry. Every
backend route prefix is owned by a domain:

| URL prefix                 | Domain          | Primary cores                |
|----------------------------|-----------------|------------------------------|
| `/api/v1/customers/*`      | CRM             | Party, Communication         |
| `/api/v1/services/*`       | OSS             | Service, Workflow            |
| `/api/v1/orders/*`         | BSS             | Workflow, Contract           |
| `/api/v1/network/*`        | Network         | Resource, Relationship       |
| `/api/v1/inventory/*`      | Inventory       | Resource, Location           |
| `/api/v1/work/*`           | Workforce       | Work, Scheduling             |
| `/api/v1/billing/*`        | Billing         | Financial                    |
| `/api/v1/portal/*`         | Portal          | Portal                       |
| `/api/v1/studio/*`         | Studio          | Configuration, Metadata      |
| `/api/v1/automations/*`    | Automation      | Automation                   |
| `/api/v1/reports/*`        | Reporting       | Reporting, Analytics         |
| `/api/v1/admin/*`          | Administration  | Tenant, Identity, Security   |
| `/api/v1/meta/*`           | Administration  | Metadata, Configuration      |

### 9.3 Migration ownership

Every Alembic migration tags its domain in the leading comment. Multi-domain
migrations are forbidden (split them).

## 10. Relationships

### 10.1 Domain → Domain interaction map

```
CRM ──── Deal.Won ─────> BSS
                          ├── Order.Created ──> OSS (provisioning)
                          └── Contract.Signed ─> Billing (account setup)

OSS ──── Service.Activated ──> Billing (rate first cycle)
OSS ──── Service.Activated ──> CRM (visible to sales)
OSS ──── Incident.Opened  ──> Network (impact assessment)
OSS ──── Work.Assigned    ──> Workforce (dispatch)

Network ─ Outage.Detected ──> OSS (impact)
Network ─ Outage.Detected ──> Workforce (NOC dispatch)
Network ─ ChangeRFC.Approved ──> OSS (window scheduling)

Workforce ── Job.Complete ──> OSS / Network / Inventory
Inventory ── StockLow ─────> BSS (procurement) / Workforce (dispatch impact)

Billing ── Invoice.Issued ──> Portal (customer visibility)
Billing ── Dunning.Step3 ──> OSS (service suspension trigger)

Portal ── Ticket.Created ──> OSS (customer-facing case)
Portal ── Service.RequestUpgrade ──> CRM (upsell opportunity)

Studio ── Config.Published ──> all domains (consume new config)
Automation ── Rule.Triggered ──> any domain (declared action target)
Reporting ── Report.Run ──> reads any domain

Administration ── all admin acts ──> Audit
```

### 10.2 Shared core consumption

The cores in §7.2's matrix marked S (supporting) for a domain represent
*read* or *event-subscriber* relationships. The cores marked P (primary)
represent *write* relationships — but the writes still go through the core's
canonical API.

### 10.3 Domain layer in the dependency graph

Domains sit between Cores and Modules:

```
PRM (cores defined)
  └── Cores (51, owned)
        └── Domains (12, assembling cores per mission)
              └── Modules (backend packages, frontend routes)
                    └── Pages / Endpoints / Jobs / Connectors
```

## 11. Responsibilities

### 11.1 Per domain (long term, when org grows)

Each domain has an accountable owner role. Until then, default to Platform
Engineering.

| Domain         | Default owner role (M1)         |
|----------------|---------------------------------|
| CRM            | Platform Eng + CRM PM (TBD)     |
| OSS            | Platform Eng + OSS Lead (TBD)   |
| BSS            | Platform Eng                    |
| Network        | Platform Eng + Net Eng Lead     |
| Inventory      | Platform Eng                    |
| Workforce      | Platform Eng                    |
| Billing        | Platform Eng + Finance Liaison  |
| Portal         | Platform Eng                    |
| Studio        | Platform Eng (Gev)              |
| Automation     | Platform Eng                    |
| Reporting      | Platform Eng                    |
| Administration | Platform Eng (Gev)              |

### 11.2 Per-PR check

Every PR declares its primary domain in metadata (along with primary core
per `01` §15.3). CI enforces presence on PRs touching backend, frontend,
or migrations.

## 12. Allowed Patterns

### AP1 — Domain enables / disables via Entitlement

A tenant config sets `entitlement.domains.portal = false`; Portal pages
disappear from navigation; Portal API returns 403; Portal data persists
untouched.

### AP2 — Cross-domain event subscription

A BSS module subscribes to `Deal.Won` (published by CRM) and creates a
contract draft. The CRM module does not know BSS exists.

### AP3 — Read another domain's data via canonical API

A CRM page fetches active services for a customer via
`GET /api/v1/services?customerId=...` (OSS). The CRM module does not join
OSS tables directly.

### AP4 — Domain-shared core

Multiple domains primary-own different shards of the same core. Communication
Core's threads are used by CRM (sales conversations), OSS (technical
conversations), BSS (account communications), Billing (billing inquiries),
Portal (portal messages), Workforce (dispatch chats). Each domain owns its
own thread filter; the core owns the storage.

### AP5 — Studio configures another domain

Studio publishes a new field for `Service`; OSS displays it via metadata
without code change. The cross-domain interaction is mediated by Metadata
Core.

## 13. Forbidden Patterns

### FP1 — Domain owns canonical entity

A domain declaring a database table its own. Forbidden — cores own
entities. Domains assemble cores. (L3.)

### FP2 — Direct cross-domain DB join

A CRM page running `SELECT … FROM crm.customer JOIN billing.invoice …`. The
correct path is the canonical billing API or a Reporting Core view.

### FP3 — Direct cross-domain function call in request path

`crm/service.py:on_deal_close()` directly calling `billing/invoice.py:create_invoice()`.
The correct path is publishing `Deal.Won` and letting Billing subscribe.

### FP4 — Inventing a new domain in a PR

Adding `backend/app/api/v1/foo/` without declaring its domain or proposing
the domain via constitution amendment.

### FP5 — Domain bleed via shared module

Putting a function in `backend/app/services/shared/` that does
CRM-specific work and also Billing-specific work in one body. Split into
two functions, each owned by its domain.

### FP6 — Domain emulating core ownership

A CRM module declaring "we own Customer". No — Party Core owns Customer;
CRM is the domain that *primarily uses* Customer.

### FP7 — Domain-private cores

Domains may not have "private" cores invisible to the rest of the platform.
Every core is either in the public 51 or it does not exist.

### FP8 — Skipping the Composition Manifest

A new domain artifact without declaring its core composition. The composition
is normative; absence is rejected at review.

## 14. Cross-Architecture Dependencies

| Dependency                            | Direction      | Reason                          |
|---------------------------------------|----------------|---------------------------------|
| `PLATFORM_REFERENCE_MODEL.md`         | this ← root    | Defines cores.                  |
| `01_PLATFORM_CORE_ARCHITECTURE.md`    | this ← upstream | Defines core ownership rules.   |
| `03_INFORMATION_ARCHITECTURE.md`      | downstream     | Entities → domain visibility.   |
| `04_NAVIGATION_ARCHITECTURE.md`       | downstream     | Workflow groupings ≠ domains.   |
| `06_UI_EXPERIENCE_ARCHITECTURE.md`    | downstream     | Pages assembled per domain.     |
| `08_PERMISSION_ARCHITECTURE.md`       | downstream     | Permissions are domain-scoped.  |
| `10_API_ARCHITECTURE.md`              | downstream     | URL prefixes per domain.        |
| `11_EVENT_ARCHITECTURE.md`            | downstream     | Cross-domain events.            |
| `17_GOVERNANCE_ARCHITECTURE.md`       | downstream     | Amendments to add/retire domain.|

## 15. Implementation Requirements

### 15.1 Module-level domain declaration

Every backend package and frontend route registry entry declares its domain.
Example (Python):

```python
# backend/app/api/v1/services/router.py
# Domain: OSS
# Primary cores: Service, Workflow, Case, Work
# Supporting cores: Party, Product, Contract, Resource, Location
```

Example (TypeScript):

```ts
// frontend/src/views/ServicesView.tsx
// Domain: OSS
// Primary cores: Service, Workflow
// Supporting cores: Party, Product, Contract
```

### 15.2 Domain registry

`backend/app/cores/_domain_registry.py` (or equivalent) is the canonical
machine-readable domain list, with each domain's enabled status (default ON
for M1) and entitlement key.

### 15.3 URL prefix discipline

Every REST URL prefix maps 1:1 to a domain per §9.2. New top-level prefixes
without a domain mapping are rejected.

### 15.4 Tenant-level enablement

`Entitlement.Plan.domains` is a tenant-scoped set of enabled domains. The
default plan enables all 12. Wholesale plans may disable Portal. Studio is
typically Admin-only regardless of plan.

### 15.5 Cross-domain event contracts

Cross-domain event interactions per §10.1 are formalized in
`11_EVENT_ARCHITECTURE.md`. Every arrow in §10.1 has an event topic, a
schema version, and a subscriber registry.

### 15.6 Drift check

`tools/check_drift.py` adds a HARD rule that scans backend top-level
packages and asserts each declares its domain. Unmapped packages fail.

## 16. Future Expansion Rules

### 16.1 Adding a domain

- Document the mission and observable boundary.
- Author Composition Manifest (primary + supporting cores).
- Update §9.2 URL-prefix map; add the new prefix.
- Constitution amendment per `17_GOVERNANCE_ARCHITECTURE.md`.

### 16.2 Splitting a domain

- Identify the mission split (CRM might one day split into Sales and
  Marketing — distinct missions).
- Migrate URL prefixes, permission keys, and Composition Manifests.
- Preserve event-topic continuity (CRM's `Deal.Won` continues; downstream
  subscribers do not see the split).

### 16.3 Retiring a domain

- Migrate all artifacts to replacement domain.
- Disable via Entitlement; existing tenants migrate.
- Remove URL prefix after release.

### 16.4 Domains are stable

Most apparent "new domain" requests are actually:

- (a) a new **workflow grouping** in navigation (handled by `04`), or
- (b) a new **core** (handled by `01`), or
- (c) a **module** within an existing domain (handled by implementation
  conventions).

A genuine 13th domain is rare and goes through a full amendment.

---

*End of 02 — Domain Architecture.*
