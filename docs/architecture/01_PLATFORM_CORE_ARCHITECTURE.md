# 01 — Platform Core Architecture

**Constitutional document.** Position in the hierarchy: directly under
`PLATFORM_REFERENCE_MODEL.md`; the first of the 22 Architecture Constitution
documents. All later constitution docs and every Standard, Domain, Module, Page,
Component, and implementation file must remain consistent with this document.

---

## 1. Purpose

Define what a **Platform Core** is, enumerate the complete set of 51 cores
(grouped into 7 tiers), and codify the ownership laws that govern how cores
relate to entities, APIs, events, pages, jobs, and integrations.

The PRM names the cores. This document operationalizes them: how to *recognize*
a core, *assign* ownership, *prove* no-overlap, *audit* compliance, and *retire*
a core safely.

## 2. Scope

In scope:

- The definition of "Platform Core" as a first-class architectural concept.
- The canonical 7-tier × 51-core taxonomy.
- The Core Ownership Matrix — one primary owner per artifact.
- Cross-core hard boundaries (the 12 non-negotiable separation rules + the
  tier-level rules added here).
- The lifecycle of a core: proposed → reserved → partial → strong → deprecated → retired.
- The mechanics of adding, splitting, merging, deprecating, or retiring a core.

Out of scope (handled by other constitution documents):

- *What domains assemble cores into* — see `02_DOMAIN_ARCHITECTURE.md`.
- *What entities a core owns and how they relate* — see `03_INFORMATION_ARCHITECTURE.md`
  and `09_DATA_ARCHITECTURE.md`.
- *How cores surface in navigation* — see `04_NAVIGATION_ARCHITECTURE.md`.
- *How cores expose APIs / events / permissions* — see `08`, `10`, `11`.

## 3. Goals

- **G1** Every feature, page, table, endpoint, job, integration, automation,
  report, AI action, and portal capability maps to exactly one primary core.
- **G2** Every core has explicit boundaries (what it owns; what it does NOT own).
- **G3** Every core has a maturity status (STRONG / PARTIAL / WEAK / MISSING /
  RESERVED), updated as artifacts harden.
- **G4** No two cores legitimately own the same canonical entity, primary API,
  primary event topic, or primary nav placement.
- **G5** Adding, splitting, merging, deprecating, or retiring a core is a
  governed, auditable act — not an ad-hoc PR.
- **G6** The core lattice is *stable*: the 51 cores are the long-term shape of
  the platform. Growth happens by *hardening* cores, not by inventing new ones.

## 4. Non-Goals

- **NG1** This document does NOT define entity schemas. (See `09_DATA_ARCHITECTURE.md`.)
- **NG2** This document does NOT define UI placement. (See `04_NAVIGATION_ARCHITECTURE.md`
  and `06_UI_EXPERIENCE_ARCHITECTURE.md`.)
- **NG3** This document does NOT define implementation files / modules. (See
  `02_DOMAIN_ARCHITECTURE.md` for domain → module mapping.)
- **NG4** This document does NOT govern brand or visual identity. (Brand is
  governed by the LOCKED brand source at `docs/branding/v3.0/`.)
- **NG5** This document does NOT replace the PRM. The PRM defines *what each
  core means*; this document defines *how cores behave architecturally*.

## 5. Architecture Principles

### P1 — Cores are ownership boundaries, not implementation packages.

A core is a *responsibility surface*. A module, microservice, or backend
package may implement parts of multiple cores; conversely a single core may be
implemented across multiple packages. The core is the *contract*, not the file
layout. (Implementation layout is governed by `02_DOMAIN_ARCHITECTURE.md`.)

### P2 — One primary core, multiple supporting cores.

Every artifact (entity, API, page, event topic, job, integration, automation,
report, AI action, portal capability) names *exactly one* primary core. It MAY
reference supporting cores. The primary core is accountable for the artifact's
lifecycle; supporting cores are contributors.

### P3 — The 51 cores are the long-term shape.

Adding a 52nd core is a thesis change, not a feature. The PRM § "Required
Implementation Sequence" anchors the platform's growth on *hardening existing
cores*, not on proliferating new ones. (See §16 for the lifecycle that governs
exceptions.)

### P4 — Tier discipline.

Cores live in exactly one tier:
`FOUNDATION / BUSINESS OBJECTS / BUSINESS COMMERCE / BUSINESS EXECUTION /
PLATFORM SERVICES / INTELLIGENCE / EXPERIENCE`.
Tier ordering implies dependency direction: a core in a higher tier may depend
on cores in lower tiers but not vice versa.

### P5 — Anti-overlap is a design constraint, not an aspiration.

The 12 PRM separation rules + the additional tier rules in §6 are checked at
design review time. A PR that introduces overlap is rejected; it must be
re-shaped before it merges.

### P6 — Configuration over code (inherited from M0 thesis).

A core's behavior is configurable from the outside; what is *not* configurable
is the core's boundary itself. Boundaries are constitutional; configuration is
operational.

### P7 — Audit, tenant, security are universal cores.

Every other core depends transitively on Audit, Tenant, Security, and Identity.
A new core proposal that does not address its posture relative to these four is
incomplete.

### P8 — Cores publish; cores do not call.

Cross-core integration is event-driven by default. A core SHOULD emit events on
state change; downstream cores subscribe. Direct synchronous calls across cores
are permitted only where the contract is documented in `10_API_ARCHITECTURE.md`
and the call is idempotent + observable.

## 6. Architecture Laws

These are the hard rules. Violation is grounds to reject a PR.

### L1 — Single Primary Ownership

> No two cores may both claim primary ownership of the same canonical entity,
> primary API resource path, primary event topic, primary navigation entry, or
> background job class.

Co-ownership is forbidden. Where two cores both touch an artifact, exactly one
is *primary* (named) and the others are *supporting* (referenced).

### L2 — Tier Direction

> A core in tier T may depend on cores in tiers ≤ T. Reverse dependencies are
> forbidden.

Foundation never depends on Experience. Business Objects never depend on
Intelligence. Tier discipline is the platform's dependency invariant.

### L3 — The 12 Separation Rules (inherited from PRM § "Non-Negotiable
Separation Rules")

- Governance is not Policy. Governance defines standards; Policy executes decisions.
- Permission is not Entitlement. Permission controls access; Entitlement controls availability/limits by plan, tenant, feature, or usage.
- Tenant is not Organization. Tenant is SaaS isolation; Organization is business structure.
- Product is not Service. Product is catalog; Service is active customer/internal delivery.
- Resource is not Service. Resource is asset/inventory/network; Service is customer/business outcome.
- Case is not Work. Case captures issue/request context; Work executes tasks/jobs/orders.
- Workflow is not Automation. Workflow controls lifecycle; Automation reacts and performs actions.
- Communication is not Notification. Communication stores conversation; Notification delivers messages.
- Document is not Storage. Document owns business meaning; Storage stores bytes.
- Analytics is not Reporting. Analytics explains performance; Reporting produces governed outputs.
- Workspace is not Platform Core. Workspace is user experience; cores are ownership boundaries.
- Navigation must never mirror Platform Core taxonomy directly.

### L4 — Audit Universality

> Every state-changing artifact under any core MUST produce an auditable event
> (see `11_EVENT_ARCHITECTURE.md`) and an audit record (see Audit Core).
> Silent mutations are forbidden across the entire platform.

### L5 — Tenant Universality

> Every business artifact under any core except explicit global reference data
> MUST be tenant-scoped, with `tenantId` on the row and the RLS policy
> `tenant_isolation` engaged on the table.

### L6 — No core is unowned.

> Every core has exactly one accountable team or role. (For M0 / M1, that role
> defaults to "Platform Engineering" until the org grows. The role MUST be
> recorded in §10 of this document going forward.)

### L7 — No core hides another.

> A core MUST NOT take on the responsibilities of an absent core via custom
> fields, metadata blobs, or local convention. If Knowledge is WEAK, articles
> may not be smuggled into Case as "context"; they go to Knowledge or wait.

### L8 — Reserved cores are non-empty placeholders.

> Even MISSING cores (Forecasting, Marketplace) are reserved in the registry,
> with §10 ownership recorded, so feature development cannot route around them.

## 7. Core Concepts

### 7.1 Tier

A horizontal slice of the platform. The 7 tiers, in dependency-friendly order:

1. **FOUNDATION** — what the platform *is made of* (Governance, Identity,
   Tenant, Security, Compliance, Audit, Configuration, Policy, Entitlement,
   Observability, Time). Universal preconditions.
2. **BUSINESS OBJECTS** — what the platform *talks about* (Party, Organization,
   Location, Resource, Product, Service, Contract, Work, Knowledge). The
   real-world nouns.
3. **BUSINESS COMMERCE** — what the platform *charges for* (Financial). The
   commerce verb tier; intentionally small in M1.
4. **BUSINESS EXECUTION** — what the platform *does* (Case, Workflow,
   Automation, Approval, SLA, Scheduling, Communication, Notification,
   Document). The active, time-bound verbs.
5. **PLATFORM SERVICES** — what the platform *runs on* (Data, Metadata,
   Relationship, Search, Event, Integration, Developer Platform, Background
   Processing, Import/Export, Template, Storage). Internal infrastructure.
6. **INTELLIGENCE** — what the platform *thinks with* (Analytics, Reporting,
   AI, Forecasting, Decision Support). Insight tier.
7. **EXPERIENCE** — what the platform *shows* (Workspace, Portal, Mobile,
   Marketplace, Localization). The presentation tier.

### 7.2 Core

A bounded ownership surface within a tier. Every core has:

- **Name** (immutable identity).
- **Tier** (assigned at reservation; never changes).
- **Status** (STRONG / PARTIAL / WEAK / MISSING / RESERVED / DEPRECATED /
  RETIRED).
- **Purpose** (one sentence — see PRM).
- **Owns** (positive surface — entities, APIs, events, pages, jobs).
- **Does not own** (negative surface — the anti-overlap rule).
- **Governed by HOW viewpoints** (which of the 22 constitution docs apply).
- **Hard boundary rule** (one operational invariant the core must enforce).
- **Minimum hardening artifacts** (the 8-item checklist from PRM).

### 7.3 Maturity status

- **STRONG** — entity, API, events, audit, permissions, UI all implemented and tested.
- **PARTIAL** — at least one major artifact present; others incomplete.
- **WEAK** — token implementation only; core not yet recognizable.
- **MISSING** — no implementation, but the core is reserved (cannot be routed around).
- **RESERVED** — core is named for the future; no implementation expected in current milestone.
- **DEPRECATED** — core is being wound down; new artifacts forbidden; existing
  artifacts migrating to replacement.
- **RETIRED** — core is removed from the registry. Requires explicit
  constitution amendment.

### 7.4 Core lifecycle

```
        ┌──────────────────────────────────────────────┐
        ▼                                              │
PROPOSED ── reserve ──> RESERVED ── implement ──> WEAK │
                                          │            │
                                          ▼            │
                                     PARTIAL ────────> STRONG
                                          │
                                          └─── deprecate ──> DEPRECATED ──> RETIRED
```

Transitions are governed acts. PROPOSED → RESERVED requires a constitution
amendment (see §16). RESERVED → WEAK / PARTIAL / STRONG is a maturity update;
recorded in the Core Maturity Ledger. DEPRECATED → RETIRED requires explicit
amendment with documented replacement.

## 8. Canonical Entities

Each core declares a small set of canonical entities. Canonical entities are
the table-level nouns owned by that core. *Other* cores may reference these
entities, but only the owning core may create / mutate / delete them.

The full canonical-entity matrix is authored in `09_DATA_ARCHITECTURE.md`. The
following is the *summary index* by core:

### FOUNDATION

| Core | Canonical entities (summary) |
|---|---|
| Governance | Standard, Exception, GovernanceBoard, ArchitectureLawRecord |
| Identity | User, ServiceAccount, ApiClient, Session, MfaCredential, IdentityProvider |
| Tenant | Tenant, TenantProfile, TenantHierarchy, TenantBrandingLink |
| Security | Secret, EncryptionKey, RateLimitPolicy, IdempotencyKey, ThreatRule |
| Compliance | PrivacyRequest, RetentionPolicy, Consent, RegulatoryEvidence, DataSubjectOp |
| Audit | AuditLog, AccessLog, ChangeHistory, EventEvidence |
| Configuration | TenantSetting, ModuleSetting, EnvironmentConfig, ConfigSchema, ConfigVersion |
| Policy | PolicyDefinition, PolicyCondition, PolicyEvaluation, DecisionRecord, PolicyVersion |
| Entitlement | Plan, Feature, Quota, Limit, UsageMeter, ModuleAccess, PortalEntitlement |
| Observability | HealthCheck, Metric, Trace, LogStream, AlertRule, ServiceStatus |
| Time | Timezone, BusinessHours, Holiday, Calendar, Shift, RecurrenceRule, AvailabilityWindow, SlaClock |

### BUSINESS OBJECTS

| Core | Canonical entities (summary) |
|---|---|
| Party | Person, Customer, Contact, Employee, Partner, Vendor, Contractor, Household |
| Organization | BusinessUnit, Department, Team, Branch, OrgNode, ReportingHierarchy |
| Location | Country, Region, City, District, Site, Building, Floor, Room, Rack, ServiceArea |
| Resource | Asset, NetworkElement (OLT/ONU/Router/Switch), Fiber, IpPool, StockItem, Vehicle, Tool, SoftwareLicense |
| Product | ProductCatalogEntry, Plan, Bundle, AddOn, TechnicalProductDefinition |
| Service | Subscription, ServiceInstance, ProvisioningState, ServiceTopology |
| Contract | Contract, Term, Amendment, Renewal, Signature, Obligation |
| Work | Task, WorkItem, WorkOrder, FieldJob, ProjectTask, MaintenanceJob, Assignment |
| Knowledge | Article, Sop, Runbook, TroubleshootingTree, Faq, HelpArticle |

### BUSINESS COMMERCE

| Core | Canonical entities (summary) |
|---|---|
| Financial | Quote, Order, Pricing, Rating, Invoice, Payment, Tax, Discount, Credit, Dunning |

### BUSINESS EXECUTION

| Core | Canonical entities (summary) |
|---|---|
| Case | Ticket, Incident, ServiceRequest, Complaint, ProblemRecord, ChangeRequest, CaseQueue |
| Workflow | WorkflowDefinition, State, Transition, WorkflowInstance, TransitionHistory |
| Automation | AutomationRule, Trigger, Condition, Action, Execution, Failure |
| Approval | ApprovalRequest, ApprovalChain, Approver, Delegation, Vote, SignoffEvidence |
| SLA | SlaDefinition, SlaClock, SlaPause, SlaTarget, BreachRecord, EscalationTrigger |
| Scheduling | Schedule, Appointment, DispatchSlot, MaintenanceWindow, CapacitySlot, CalendarBooking |
| Communication | Thread, Message, Comment, Note, Mention, Channel |
| Notification | NotificationRecord, NotificationPreference, DeliveryStatus, WebhookNotification |
| Document | Document, Attachment, GeneratedPdf, DocumentVersion, DocumentSignature |

### PLATFORM SERVICES

| Core | Canonical entities (summary) |
|---|---|
| Data | MasterDataRecord, ReferenceData, DataQualityRule, CanonicalSchema, LineageEdge |
| Metadata | CustomField, DynamicSchema, DynamicForm, PageFieldDefinition, ValidationMetadata |
| Relationship | EntityRelationship, DependencyGraph, TopologyRelation |
| Search | SearchIndex, SavedFilter, SavedView, QueryHistory, ResultPermissionRule |
| Event | DomainEvent, EventStoreEntry, EventSchemaRegistration, ReplayCheckpoint, IdempotencyKey |
| Integration | Connector, Webhook, SyncJob, MappingRule, CredentialReference |
| Developer Platform | ApiKey, OAuthApp, Sdk, SandboxApp, ApiLogEntry, AppRegistration |
| Background Processing | Queue, Worker, ScheduledJob, JobRun, DeadLetter |
| Import/Export | ImportJob, ExportJob, MigrationJob, ValidationPreview, ScheduledExport |
| Template | EmailTemplate, SmsTemplate, PdfTemplate, ContractTemplate, InvoiceTemplate, ReportTemplate |
| Storage | BlobObject, StorageProvider, VirusScanResult, SignedUrlPolicy |

### INTELLIGENCE

| Core | Canonical entities (summary) |
|---|---|
| Analytics | KpiDefinition, MetricModel, DashboardDataset, Aggregation, AnalyticalDimension |
| Reporting | ReportDefinition, ReportSchedule, ReportParameter, ReportRun, GeneratedReportFile |
| AI | AiAssistant, Prompt, AiTool, KnowledgeSource, ModelConfig, AiAuditLog, HumanApprovalGate |
| Forecasting | ForecastModel, ForecastInputDataset, ForecastRun, ConfidenceInterval, Scenario, CapacityForecast |
| Decision Support | DecisionModel, Score, Recommendation, NextBestAction, ImpactAnalysis, ExplanationRecord |

### EXPERIENCE

| Core | Canonical entities (summary) |
|---|---|
| Workspace | LeftNavEntry, TopNavEntry, DashboardLayout, BoardLayout, TableLayout, DetailPageLayout, DrawerSpec, CommandPaletteEntry, PageRegistryEntry |
| Portal | CustomerPortalPage, PartnerPortalPage, VendorPortalPage, PortalAuthSurface, PortalRequest, PortalVisibilityRule |
| Mobile | MobileAppShell, MobileNavEntry, OfflineSyncRecord, DeviceTrustRecord, FieldTechnicianFlow, PushAction |
| Marketplace | App, Extension, AppPermission, InstallLifecycleRecord, AppReview, AppEntitlement, MarketplaceListing |
| Localization | Translation, LocaleProfile, CurrencyDisplay, RegionalFormat, MultilingualContent, FallbackRule |

## 9. Ownership Boundaries

The **Core Ownership Matrix** is the operational artifact for L1. Each row is
an artifact; each column is a core; exactly one cell is marked PRIMARY for each
row. Maintained as a separate file (`docs/architecture/CORE_OWNERSHIP_MATRIX.md`,
seed shape provided in `02_DOMAIN_ARCHITECTURE.md`).

For this constitution document, the boundary rules are:

### 9.1 Entity ownership

Every database table maps to exactly one core (its *home*). Foreign keys
*reference* other cores' entities but do not transfer ownership. Cross-core
FKs are first-class in `09_DATA_ARCHITECTURE.md`.

### 9.2 API ownership

Every REST resource path maps to exactly one core. URL design follows
`10_API_ARCHITECTURE.md`. A resource path like `/api/v1/services/{id}` is owned
by Service Core; a path like `/api/v1/billing/invoices/{id}` is owned by
Financial Core.

### 9.3 Event ownership

Every event topic maps to exactly one publishing core. Event naming follows
`11_EVENT_ARCHITECTURE.md`. `Service.Activated` is published by Service Core,
even though Financial, Notification, and Audit may subscribe.

### 9.4 Page ownership

Every primary page maps to exactly one core. (A page may surface data from
several cores; ownership refers to the page's *purpose*.) Workspace Core owns
the page registry itself; individual pages are owned by their business core.

### 9.5 Job ownership

Every background job class maps to exactly one core. Background Processing
Core owns *infrastructure*; the job's *semantics* belong to a business core.

### 9.6 Integration ownership

Every external connector maps to exactly one core (its *target domain*).
Integration Core owns the *connector framework*; individual connectors are
owned by their target business core (a Stripe connector is owned by Financial;
a Salesforce connector is owned by Party / Service depending on use).

## 10. Relationships

### 10.1 Dependency direction (per L2)

```
EXPERIENCE          ─────────────────────────────────────┐
                                                        │
INTELLIGENCE        ──────────────────────────────┐     │
                                                  │     │
PLATFORM SERVICES   ────────────────────────┐     │     │
                                            │     │     │
BUSINESS EXECUTION  ──────────────────┐     │     │     │
                                      │     │     │     │
BUSINESS COMMERCE   ────────────┐     │     │     │     │
                                │     │     │     │     │
BUSINESS OBJECTS    ──────┐     │     │     │     │     │
                          │     │     │     │     │     │
FOUNDATION          ┌─────┴─────┴─────┴─────┴─────┴─────┴── always at the bottom
```

A core in tier T MAY depend on any core in tier ≤ T. Reverse dependencies are
forbidden.

### 10.2 The four universal dependencies

Every core depends on:

- **Identity** (who is acting)
- **Tenant** (which scope)
- **Audit** (recording the act)
- **Security** (validating the act)

These four are universal preconditions. A core proposal that does not address
these is incomplete.

### 10.3 The two universal observers

Every state-changing action is observed by:

- **Event Core** (subscribed via published event)
- **Observability Core** (subscribed via metric / trace / log)

Failure to publish an event or expose an observability signal is an L4 violation.

### 10.4 Supporting-core declaration

When an artifact references a supporting core, the reference is declarative,
not extensional. Example: a `Service` entity references `Customer` (Party
Core), `Plan` (Product Core), `Site` (Location Core), `Contract` (Contract
Core), and `InvoiceLine` (Financial Core). Service Core *owns* the service
instance; it does not *own* any of those referenced entities.

## 11. Responsibilities

### 11.1 The platform owner (Gev / Ընգեր on Gev's behalf)

- Approves additions / splits / merges / deprecations / retirements of cores
  (constitution amendment per §16).
- Owns the Core Maturity Ledger updates at milestone boundaries.
- Adjudicates ownership disputes where two cores both claim primary ownership.

### 11.2 The accountable team per core

- Maintains the core's documentation in PRM.
- Owns the 8-item hardening checklist for the core.
- Ensures the core's events, APIs, audit posture, and permissions exist before
  features depend on them.
- Defaults to "Platform Engineering" until org expansion (per L6).

### 11.3 The reviewer of cross-core PRs

- Confirms primary ownership is named.
- Confirms supporting cores are referenced.
- Confirms no separation rule (L3) is violated.
- Rejects co-ownership.

## 12. Allowed Patterns

### AP1 — Reference across cores via canonical IDs

A Service Core entity may carry `customerId` (referencing Party Core), `planId`
(Product Core), `siteId` (Location Core), `contractId` (Contract Core). The
reference is by canonical ID; the referenced entity remains owned by its
canonical core.

### AP2 — Subscribe to another core's events

A Notification Core handler may subscribe to `Service.Activated` (published by
Service Core) and deliver a customer welcome notification. The subscription is
declarative; the publisher does not know about the subscriber.

### AP3 — Use another core's APIs for read

A reporting query may read from Service, Financial, and Case Cores via their
canonical APIs. Reads do not require ownership transfer.

### AP4 — Promote a core's maturity by milestone

A PARTIAL core may be promoted to STRONG when the 8-item hardening checklist
passes review. The promotion is recorded in the Core Maturity Ledger.

### AP5 — Shadow tables for analytics

Analytics Core may maintain shadow / aggregate tables derived from a business
core's canonical data. Ownership of derivation belongs to Analytics; ownership
of source data remains with the originating core.

## 13. Forbidden Patterns

### FP1 — Co-ownership

Two cores both naming themselves PRIMARY for the same entity / API / event /
page / job. Rejected at review.

### FP2 — Hidden ownership

An entity owned by a core that is not declared anywhere. Every entity declares
its owning core in `09_DATA_ARCHITECTURE.md`.

### FP3 — Tier inversion

A FOUNDATION core depending on an EXPERIENCE core. (Example: Audit Core
calling Workspace Core for a UI string.) Rejected.

### FP4 — Smuggling a missing core into another

A WEAK / MISSING core's responsibilities being absorbed by an unrelated core
via custom fields, metadata, or convention. Example: stashing forecast outputs
in a Case custom field because Forecasting is MISSING. (See L7.)

### FP5 — Direct cross-tenant cross-core write

A core directly writing to another core's tables. Even within FOUNDATION,
writes go through the owning core's API or via a published event handler the
owning core publishes.

### FP6 — Synchronous critical-path call to non-Foundation core

A Workflow Core transition synchronously calling an AI Core scoring endpoint
on the request path. AI Core is INTELLIGENCE tier; Workflow is BUSINESS
EXECUTION. The dependency is allowed in direction (T_Workflow < T_AI, no — both
sit above FOUNDATION; this case actually crosses *tiers*, and AI Core is
strictly above BUSINESS EXECUTION). The call must be async or governed by an
explicit timeout + fallback + idempotency contract documented in
`10_API_ARCHITECTURE.md`.

### FP7 — Adding a 52nd core via PR

Inventing a new core within a feature PR. Core additions are constitution
amendments per §16.

### FP8 — UI-only business logic

Implementing a business rule only in a Workspace Core page. Every business
rule has a backend owner core; the UI is its presentation layer, never its
authority. (See `06_UI_EXPERIENCE_ARCHITECTURE.md` for the LOCKED rule
inherited from `standards/01-strategic-product-direction.md`.)

### FP9 — Conflating Workspace with Platform Core

Treating "Sales", "Support", "Billing", "Operations" as platform cores
because they appear in the left nav. They are *workflow groupings*
(see `04_NAVIGATION_ARCHITECTURE.md`), assembled from real cores. The
"Sales" left-nav grouping draws from Party + Product + Service + Workflow +
Communication + Notification + Workspace cores; it is not a core itself.

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Authoritative core definitions, status, separation rules. |

| Documents that depend on this one |
|---|
| `02_DOMAIN_ARCHITECTURE.md` (assembles cores into domains) |
| `03_INFORMATION_ARCHITECTURE.md` (entities owned by cores) |
| `04_NAVIGATION_ARCHITECTURE.md` (UI workflow grouping ≠ cores) |
| `05_OPERATIONAL_ARCHITECTURE.md` (operational cores assembled into runtime) |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (UI surfaces map to cores) |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` (Workflow Core is foundational) |
| `08_PERMISSION_ARCHITECTURE.md` (permission keys = `coreEntity.action`) |
| `09_DATA_ARCHITECTURE.md` (canonical entity matrix lives here) |
| `10_API_ARCHITECTURE.md` (REST surface mapped to cores) |
| `11_EVENT_ARCHITECTURE.md` (event ownership = core ownership) |
| `12_INTEGRATION_ARCHITECTURE.md` (connectors owned by target core) |
| `13_SECURITY_ARCHITECTURE.md` (Security is a universal core) |
| `14_TENANT_ARCHITECTURE.md` (Tenant is a universal core) |
| `15_REPORTING_ARCHITECTURE.md` (Reporting Core) |
| `16_ANALYTICS_ARCHITECTURE.md` (Analytics Core; clarifies separation from Reporting) |
| `17_GOVERNANCE_ARCHITECTURE.md` (constitutional amendments per §16 below) |
| `18_OBSERVABILITY_ARCHITECTURE.md` (Observability Core; universal) |
| `19_INFRASTRUCTURE_ARCHITECTURE.md` (Storage, Background Processing) |
| `20_MARKETPLACE_ARCHITECTURE.md` (Marketplace Core; reserved MISSING) |
| `21_AI_ARCHITECTURE.md` (AI Core; WEAK) |
| `22_MOBILE_OFFLINE_ARCHITECTURE.md` (Mobile Core; WEAK) |

## 15. Implementation Requirements

### 15.1 Core registration

The 51 cores are registered in PRM. This document operationalizes them by:

1. Adding the **Core Maturity Ledger** (§15.2) as a separate file, updated at
   milestone boundaries.
2. Adding the **Core Ownership Matrix** (§9) as a separate file, updated each
   time an entity / API / event / page / job is added.
3. Tagging every PR with the affected core(s) in commit metadata; reviewers
   confirm L1 and L3 hold.

### 15.2 Core Maturity Ledger

`docs/architecture/CORE_MATURITY_LEDGER.md` (to be authored after the
constitution lands) records, per core:

- Current status (one of the values in §7.3).
- Date of last status change.
- Outstanding hardening artifacts (subset of the PRM 8-item list).
- Target milestone for next promotion.

### 15.3 Per-PR check

Every PR touching a backend module, frontend route, migration, or integration
declares in its description:

```
Primary core:      <core name>
Supporting cores:  <core, core, …>
```

CI enforces presence of this block on PRs that touch `backend/`, `frontend/`,
or `alembic/`.

### 15.4 Drift check

`tools/check_drift.py` adds a HARD rule that scans for new top-level packages
under `backend/app/` and asserts each one maps to a known core in PRM.
Unmapped packages fail the check.

### 15.5 Naming conventions

- Backend module per core: `backend/app/cores/<core_slug>/` for cores whose
  implementation is large enough to warrant its own package.
- For thin cores, implementation may live in shared packages
  (e.g. `backend/app/kernel/`, `backend/app/services/`), with the core
  declared in module docstrings.
- Frontend has *no* per-core directory; presentation is governed by
  `06_UI_EXPERIENCE_ARCHITECTURE.md` and assembled from cores.

### 15.6 Required documentation per core

Each core's PRM entry is the *summary*. The hardening artifacts (per PRM
8-item list) live in domain documents (see `02_DOMAIN_ARCHITECTURE.md`) and
the core-specific constitution documents listed in §14. A core's documentation
is *complete* when:

- Canonical entities listed (`09_DATA_ARCHITECTURE.md`).
- API surface declared (`10_API_ARCHITECTURE.md`).
- Events declared (`11_EVENT_ARCHITECTURE.md`).
- Permissions declared (`08_PERMISSION_ARCHITECTURE.md`).
- Tenant posture declared (`14_TENANT_ARCHITECTURE.md`).
- UI placement declared (`04_NAVIGATION_ARCHITECTURE.md`, `06_UI_EXPERIENCE_ARCHITECTURE.md`).
- Reporting/analytics surface declared (`15_REPORTING_ARCHITECTURE.md`, `16_ANALYTICS_ARCHITECTURE.md`).
- Tests & migrations declared (per core-implementation runbook).

## 16. Future Expansion Rules

### 16.1 Adding a core

A new core requires:

1. **Proposal.** A written rationale: what entities / APIs / events would it
   own? What existing core would otherwise absorb them, and why is that
   wrong? Why is no existing core adequate?
2. **Constitution amendment.** Update PRM and this document. Add canonical
   entity row in `09_DATA_ARCHITECTURE.md`. Register tier.
3. **Approval.** Platform owner approves; the change is committed as a
   constitution amendment with the suffix `(amendment: +<Core> Core)`.
4. **Status.** New cores start as RESERVED, PROPOSED, or WEAK depending on
   implementation maturity.

### 16.2 Splitting a core

When a core's surface grows large enough that two distinct ownership
boundaries are visible inside it:

1. Document the split candidate in a proposal.
2. Identify which entities / APIs / events / jobs move to which side.
3. Migrate them in a single amendment, preserving event-name continuity (via
   `11_EVENT_ARCHITECTURE.md`'s rename rules) and FK continuity.

### 16.3 Merging cores

When two cores discover they share boundaries:

1. Document the merge candidate.
2. Identify which side absorbs which entities.
3. Deprecate the absorbed core (DEPRECATED), migrate artifacts, then RETIRE
   after a release.

### 16.4 Deprecating a core

A DEPRECATED core:

- May not receive new artifacts.
- Existing artifacts migrate to replacement(s) on a documented timeline.
- The deprecation MUST name its replacement(s) in the amendment.

### 16.5 Retiring a core

A RETIRED core is removed from the registry (deleted from PRM tier listing,
kept in git history). Requires:

- All artifacts migrated to replacement(s).
- All references (FK, event topics, permission keys, nav entries) cleaned.
- Final amendment.

### 16.6 Tier reassignment

A core may NOT move tiers post-reservation. If a core's purpose changes such
that its tier is wrong, the correct path is to retire the original core and
reserve a new core in the correct tier, migrating artifacts.

### 16.7 Long-horizon expansion

The PRM's "Immediate Gap List" (Forecasting, Marketplace, Knowledge, Template,
AI, Mobile, Policy/Entitlement, Time) is the M1-M3 expansion target. New cores
beyond that list require a fresh constitution amendment and should be rare —
the platform grows by *hardening*, not *expanding*.

---

*End of 01 — Platform Core Architecture.*
