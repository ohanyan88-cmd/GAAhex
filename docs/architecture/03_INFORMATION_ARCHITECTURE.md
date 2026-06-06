# 03 — Information Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`,
after `01_PLATFORM_CORE_ARCHITECTURE.md` and `02_DOMAIN_ARCHITECTURE.md`.
Defines the canonical entities, their identity, their relationships, and how
information flows across cores and domains. All Standards, Modules, Pages,
and Implementation files must remain consistent with this document.

---

## 1. Purpose

Define the canonical **information model** of GAAhex: the entities, their
identity contract, their relationships, the central spine (Customer → Service
→ Contract → Financial → Case/Work → Resource → Location), and how information
is referenced versus owned across the 51 cores.

This document is the entity-relationship layer of the architecture. The PRM
names cores; `01` operationalizes core ownership; `02` assembles cores into
domains; this document populates each core with named entities and binds
them into the platform information graph.

## 2. Scope

In scope:

- Canonical entity model — every entity owned by a core, with its identity,
  reference number prefix, owner core, primary domain.
- The central information spine (Customer / Service / Contract / Financial /
  Case / Work / Resource / Location).
- Cross-entity relationships and the rules that govern them.
- Identity, naming, reference-number, and enum conventions (rolled up from
  the LOCKED standards files 03 and 14).
- Information visibility across tenants, organizations, parties, and portals.

Out of scope:

- Schema details — table columns, indexes, constraints — see `09_DATA_ARCHITECTURE.md`.
- API surface (URL paths and methods) — see `10_API_ARCHITECTURE.md`.
- Events and event payloads — see `11_EVENT_ARCHITECTURE.md`.
- Visualization, ER diagrams as page widgets — see `06_UI_EXPERIENCE_ARCHITECTURE.md`.
- Search and filter mechanics — see standard 21 + `09`.

## 3. Goals

- **G1** Every entity has exactly one owning core and exactly one canonical
  identity.
- **G2** Every entity has a stable reference-number prefix; reference numbers
  are user-visible identifiers and never used as primary keys.
- **G3** The information spine connects Customer → Service → Contract →
  Financial → Case/Work → Resource → Location with documented FK paths.
- **G4** Cross-tenant information leakage is impossible by construction
  (RLS + tenantId on every business row).
- **G5** Cross-entity relationships are first-class (via Relationship Core)
  with directionality, type, and tenant scoping.
- **G6** Every entity declares its event posture, audit posture, retention
  posture, and visibility posture in this document or its core's
  hardening artifacts.

## 4. Non-Goals

- **NG1** This document does NOT prescribe physical table layout.
- **NG2** This document does NOT design indexes, partitioning, or query plans.
- **NG3** This document does NOT define UI rendering of entities.
- **NG4** This document does NOT redefine cores or domains.
- **NG5** This document does NOT define implementation classes — it defines
  the information *contract*; implementation may use SQLModel, dataclasses,
  Pydantic, or any compatible representation, declared in `09`.

## 5. Architecture Principles

### P1 — Identity is UUIDv7

Every entity primary key is a **UUIDv7** (S5 / D8 per standards 03/13). UUIDv7
gives time-ordered, lexicographically sortable IDs without leaking strict
sequence ordering across tenants. Internal references between entities use
UUIDv7 IDs exclusively.

### P2 — Reference numbers are display-only

Every entity exposes a `referenceNumber` with a core-specific prefix
(e.g. `CUS-…`, `SVC-…`, `INV-…`). Reference numbers are user-visible
identifiers and may appear in URLs, search, and printed documents.
**Reference numbers are NEVER used as primary keys or foreign keys.**

### P3 — One owner core per entity

Every entity belongs to exactly one core (per `01` §9.1). Other cores
reference it by canonical ID but never store a private copy.

### P4 — Tenant-scoped by default

Every business entity carries `tenantId` (D1 per standards) and is fenced by
the RLS policy `tenant_isolation`. Cross-tenant references are forbidden
except for explicit global reference data registered in
`09_DATA_ARCHITECTURE.md`.

### P5 — Relationships are entities

Cross-entity links are first-class entities owned by Relationship Core (per
PRM). A foreign key inside an entity expresses a *contained* or
*dependency* relationship; cross-cutting connections (e.g. "this resource
serves these customers") are stored as `EntityRelationship` rows.

### P6 — Information spine is sacred

The central spine (§7.1) is the load-bearing path of the platform's data
graph. Every customer-facing artifact must connect to the spine. Orphan
records that cannot be traced to a Customer are rejected at design review.

### P7 — Camel case for fields, UPPER_SNAKE for enums, PascalCase for events

(Inherited from standards 03, 13, 14.) `firstName`, `tenantId`, `referenceNumber`
for fields. `ACTIVE`, `SUSPENDED`, `CANCELLED` for enum values. `Service.Activated`
for event names.

### P8 — Names are not relationship keys

A Customer's name may change; a Service's name may change. Cross-entity
references must use IDs (or reference numbers for display). Joining or
matching by name is forbidden in production code.

## 6. Architecture Laws

### L1 — UUIDv7 primary key

> Every entity's primary key is a UUIDv7. Sequential integer PKs are forbidden
> for business entities.

### L2 — Tenant scoping

> Every business entity row carries a non-null `tenantId` (UUIDv7) and is
> fenced by the `tenant_isolation` RLS policy. The only entities exempt are
> explicit global reference data (Country, Currency, Locale, etc.) listed in
> `09_DATA_ARCHITECTURE.md`.

### L3 — Reference-number stability

> Once issued, a reference number is immutable for the lifetime of the entity,
> including across archive / soft-delete / restore.

### L4 — One owner core

> Every entity declares its owner core in `09_DATA_ARCHITECTURE.md`. Two cores
> may NOT both own the same entity (per `01` L1).

### L5 — Cross-entity reference by ID

> Cross-entity foreign keys use UUIDv7 IDs, never reference numbers or names.
> Display layers may render reference numbers; persistence and computation use IDs.

### L6 — Relationship Core for many-to-many topology

> Many-to-many or directional cross-cutting links (e.g. customer-to-resource
> impact graphs) use `EntityRelationship` rows. Embedding such structure as a
> column on the entity is forbidden.

### L7 — Deletion state is independent of lifecycle status

> Per D14 / standard 12: `deletionState` (ACTIVE / ARCHIVED / SOFT_DELETED /
> PENDING_PURGE / PURGED) is a separate field from `status` (the entity's
> lifecycle). Both may legitimately hold value `ACTIVE`.

### L8 — Audit context on every mutation

> Every entity write produces an audit record with actor, context, before /
> after, source, and timestamp. Silent mutations are forbidden (inherited from
> `01` L4 and Audit Core).

### L9 — Information spine connectivity

> Every customer-facing entity (Service, Contract, Invoice, Ticket, Order,
> Document, Notification) must reference a Customer either directly via
> `customerId` or transitively via a documented path. Orphan customer-facing
> rows are forbidden.

### L10 — Camel case fields, UPPER_SNAKE enums, PascalCase events

> Inherited from standards 03 and 14. Enforced at code review.

## 7. Core Concepts

### 7.1 The Information Spine

The central data graph of GAAhex:

```
                          ┌──────────────────────┐
                          │       Tenant         │
                          └──────────┬───────────┘
                                     │
                                     │ (tenant scopes all below)
                                     │
   ┌──────────────────────────────────────────────────────────────────┐
   │                                                                  │
   │   Party                                                          │
   │     │                                                            │
   │     ├── Customer ── Contact ── Household                         │
   │     ├── Employee                                                 │
   │     ├── Partner / Vendor / Contractor                            │
   │                                                                  │
   └────┬─────────────────────────────────────────────────────────────┘
        │
        │ customerId
        ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │   Contract ─── ContractTerm ── Amendment ── Renewal               │
   │       │                                                           │
   │       └─── Quote ── Order                                         │
   │                                                                   │
   └────┬──────────────────────────────────────────────────────────────┘
        │
        │ contractId
        ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │   Product ── Plan ── Bundle ── AddOn                              │
   │       │                                                           │
   │       └─── price links                                            │
   │                                                                   │
   │   Service ── Subscription ── ProvisioningState ── ServiceTopology │
   │       │   (planId, customerId, contractId, siteId, resourceLinks) │
   │                                                                   │
   └────┬──────────────────────────────────────────────────────────────┘
        │
        │ serviceId
        ├────────────────────────────────┐
        ▼                                ▼
   ┌──────────────────┐         ┌─────────────────────────────────┐
   │                  │         │                                 │
   │   Resource       │         │   Case ──── Ticket ── Incident  │
   │   (OLT, ONU,     │         │       │                         │
   │    fiber, IP)    │         │       └── ServiceRequest        │
   │       │          │         │                                 │
   │   Location       │         │   Work ──── Task ── WorkOrder   │
   │   (Site, Rack)   │         │       └── FieldJob ── Assignment│
   │                  │         │                                 │
   └──────────────────┘         └─────────────────────────────────┘
        │                                ▲
        │                                │
        └────── consumed-by, serves ─────┘
        (Relationship Core: customer-service-resource-location graph)

   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │   Financial:                                                      │
   │   Quote ── Order ── Pricing ── Rating ── Invoice ── Payment       │
   │   (customerId, contractId, serviceId references throughout)       │
   │                                                                   │
   └───────────────────────────────────────────────────────────────────┘

   ┌───────────────────────────────────────────────────────────────────┐
   │                                                                   │
   │   Communication / Notification / Document / Attachment            │
   │   (target via tenantId + ownerEntityType + ownerEntityId)         │
   │                                                                   │
   └───────────────────────────────────────────────────────────────────┘
```

### 7.2 Entity identity

Every entity exposes:

- `id: UUIDv7` — primary key, generated at insert.
- `referenceNumber: string` — prefix per §7.4.
- `tenantId: UUIDv7` — scope.
- `status: enum` — lifecycle (UPPER_SNAKE, per Workflow Core).
- `deletionState: enum` — ACTIVE / ARCHIVED / SOFT_DELETED / PENDING_PURGE / PURGED.
- `createdAt: timestamptz`, `createdBy: UUIDv7` — actor + time.
- `updatedAt: timestamptz`, `updatedBy: UUIDv7` — actor + time.

Optional standard fields (per standards 04, 12):

- `archivedAt`, `archivedBy`, `archiveReason`.
- `deletedAt`, `deletedBy`, `deleteReason`.
- `restoredAt`, `restoredBy`, `restoreReason`.
- `purgeScheduledAt`, `purgedAt`, `purgedBy`.

### 7.3 Lifecycle status vs deletion state

Per D14 (LOCKED in standard 12):

- `status` enumerates the entity's *business lifecycle* — e.g. `DRAFT`,
  `ACTIVE`, `SUSPENDED`, `CANCELLED`, `COMPLETED`.
- `deletionState` enumerates the entity's *deletion posture* — `ACTIVE` (not
  archived/deleted), `ARCHIVED`, `SOFT_DELETED`, `PENDING_PURGE`, `PURGED`.

The two enums share the value `ACTIVE` but mean different things and never
collapse into one field.

### 7.4 Reference-number prefixes

Canonical prefixes (extracted from standards 13 and 14 — extend in PRs that
add cores):

| Entity                | Prefix  |
|-----------------------|---------|
| Tenant                | `TNT-`  |
| User                  | `USR-`  |
| Employee              | `EMP-`  |
| Customer              | `CUS-`  |
| Contact               | `CON-`  |
| Vendor                | `VEN-`  |
| Partner               | `PRT-`  |
| Site                  | `SIT-`  |
| ServiceArea           | `SVA-`  |
| Resource              | `RES-`  |
| OLT                   | `OLT-`  |
| ONU                   | `ONU-`  |
| Fiber                 | `FBR-`  |
| IpPool                | `IPP-`  |
| Vehicle               | `VHC-`  |
| StockItem             | `STK-`  |
| Product               | `PRD-`  |
| Plan                  | `PLN-`  |
| Service / Subscription| `SVC-`  |
| Contract              | `CTR-`  |
| Quote                 | `QUO-`  |
| Order                 | `ORD-`  |
| Invoice               | `INV-`  |
| Payment               | `PAY-`  |
| Credit                | `CRD-`  |
| Ticket                | `TKT-`  |
| Incident              | `INC-`  |
| Problem               | `PRB-`  |
| ChangeRequest         | `CHG-`  |
| ServiceRequest        | `SRQ-`  |
| Task                  | `TSK-`  |
| WorkOrder             | `WO-`   |
| FieldJob              | `FJB-`  |
| Workflow Definition   | `WFL-`  |
| Workflow Instance     | `WFI-`  |
| Relationship          | `REL-`  |
| Document              | `DOC-`  |
| Attachment            | `ATT-`  |
| AutomationRule        | `AUT-`  |
| ApprovalRequest       | `APR-`  |
| Notification          | `NTF-`  |
| Report                | `RPT-`  |
| ScheduledJob          | `JOB-`  |
| Webhook               | `WBH-`  |
| Article (Knowledge)   | `KBA-`  |
| Template              | `TPL-`  |
| App (Marketplace)     | `APP-`  |
| Forecast              | `FRC-`  |

Adding an entity is a constitution-amendment-light: it adds a row here and a
row in `09_DATA_ARCHITECTURE.md`.

### 7.5 Cross-cutting enums

(Rolled up from standards 03 LOCKED.)

- **ObjectType / EntityType (D3)** — 40-value superset used by Audit,
  Timeline, Watcher, Relationship, Attachment owner, Communication, Export.
- **ActorType (B3 / D5)** — `USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER`.
- **PrincipalType (D5 / D12)** — `EMPLOYEE, ROLE, DEPARTMENT, TEAM, QUEUE`.
- **DeletionState (D14)** — `ACTIVE, ARCHIVED, SOFT_DELETED, PENDING_PURGE, PURGED`.
- **RelationshipType (file 12)** — `RELATED_TO, PARENT_OF, CHILD_OF,
  DEPENDS_ON, BLOCKED_BY, DUPLICATES, DUPLICATED_BY, OWNS, USED_BY,
  ASSOCIATED_WITH, REPLACES, REPLACED_BY, CONNECTED_TO, BILLED_TO, SERVES,
  LOCATED_AT, ASSIGNED_TO`.
- **RelationshipDirection** — `DIRECTED, BIDIRECTIONAL`.

## 8. Canonical Entities

Per-core canonical entity index (this is the binding entry; the physical
schema lives in `09_DATA_ARCHITECTURE.md`).

### 8.1 Foundation tier

| Entity              | Owner Core    | Domain  | Prefix |
|---------------------|---------------|---------|--------|
| Standard            | Governance    | Admin   | (none) |
| Exception           | Governance    | Admin   | `EXC-` |
| Tenant              | Tenant        | Admin   | `TNT-` |
| TenantProfile       | Tenant        | Admin   | (none) |
| User                | Identity      | Admin   | `USR-` |
| ServiceAccount      | Identity      | Admin   | `SVA-` |
| ApiClient           | Identity      | Admin   | `API-` |
| Session             | Identity      | Admin   | (none) |
| Secret              | Security      | Admin   | (none) |
| EncryptionKey       | Security      | Admin   | (none) |
| RateLimitPolicy     | Security      | Admin   | (none) |
| PrivacyRequest      | Compliance    | Admin   | `PRR-` |
| RetentionPolicy     | Compliance    | Admin   | `RTP-` |
| Consent             | Compliance    | Admin   | (none) |
| AuditLog            | Audit         | Admin   | (none) |
| AccessLog           | Audit         | Admin   | (none) |
| TenantSetting       | Configuration | Studio  | (none) |
| ModuleSetting       | Configuration | Studio  | (none) |
| EnvironmentConfig   | Configuration | Admin   | (none) |
| PolicyDefinition    | Policy        | Studio  | (none) |
| Plan                | Entitlement   | Admin   | `PLN-` |
| Feature             | Entitlement   | Admin   | (none) |
| Quota               | Entitlement   | Admin   | (none) |
| HealthCheck         | Observability | Admin   | (none) |
| Metric              | Observability | Admin   | (none) |
| Trace               | Observability | Admin   | (none) |
| AlertRule           | Observability | Admin   | (none) |
| Timezone            | Time          | (config)| (none) |
| BusinessHours       | Time          | (config)| (none) |
| Calendar            | Time          | (config)| (none) |
| RecurrenceRule      | Time          | (config)| (none) |

### 8.2 Business Objects tier

| Entity              | Owner Core    | Domain  | Prefix |
|---------------------|---------------|---------|--------|
| Customer            | Party         | CRM     | `CUS-` |
| Person              | Party         | CRM     | (none) |
| Contact             | Party         | CRM     | `CON-` |
| Employee            | Party         | WF      | `EMP-` |
| Partner             | Party         | CRM     | `PRT-` |
| Vendor              | Party         | (Inv)   | `VEN-` |
| Contractor          | Party         | WF      | `CTR-` |
| BusinessUnit        | Organization  | WF      | (none) |
| Department          | Organization  | WF      | (none) |
| Team                | Organization  | WF      | (none) |
| Branch              | Organization  | WF      | (none) |
| Country             | Location      | global  | (none) |
| Region              | Location      | global  | (none) |
| City                | Location      | global  | (none) |
| Site                | Location      | Network | `SIT-` |
| Building            | Location      | Network | (none) |
| Floor               | Location      | Network | (none) |
| Room                | Location      | Network | (none) |
| Rack                | Location      | Network | (none) |
| ServiceArea         | Location      | Network | `SVA-` |
| Resource (base)     | Resource      | Network | `RES-` |
| OLT                 | Resource      | Network | `OLT-` |
| ONU                 | Resource      | Network | `ONU-` |
| Router              | Resource      | Network | `RTR-` |
| Switch              | Resource      | Network | `SWT-` |
| Fiber               | Resource      | Network | `FBR-` |
| IpPool              | Resource      | Network | `IPP-` |
| StockItem           | Resource      | Inv     | `STK-` |
| Vehicle             | Resource      | Inv     | `VHC-` |
| Tool                | Resource      | Inv     | `TLS-` |
| SoftwareLicense     | Resource      | Admin   | `LIC-` |
| Product             | Product       | (catalog)| `PRD-`|
| Plan                | Product       | (catalog)| `PLN-`|
| Bundle              | Product       | (catalog)| `BND-`|
| AddOn               | Product       | (catalog)| `ADD-`|
| Subscription/Service| Service       | OSS     | `SVC-` |
| ServiceInstance     | Service       | OSS     | (subref) |
| ProvisioningState   | Service       | OSS     | (none) |
| Contract            | Contract      | BSS     | `CTR-` |
| ContractTerm        | Contract      | BSS     | (none) |
| Amendment           | Contract      | BSS     | `AMD-` |
| Renewal             | Contract      | BSS     | `REN-` |
| Task                | Work          | WF      | `TSK-` |
| WorkItem            | Work          | WF      | `WIT-` |
| WorkOrder           | Work          | WF      | `WO-`  |
| FieldJob            | Work          | WF      | `FJB-` |
| ProjectTask         | Work          | WF      | `PTK-` |
| MaintenanceJob      | Work          | Network | `MNT-` |
| Article             | Knowledge     | (any)   | `KBA-` |
| Sop / Runbook       | Knowledge     | (any)   | `SOP-` |
| Faq                 | Knowledge     | (any)   | `FAQ-` |

### 8.3 Business Commerce tier

| Entity            | Owner Core | Domain  | Prefix |
|-------------------|------------|---------|--------|
| Quote             | Financial  | CRM/BSS | `QUO-` |
| Order             | Financial  | BSS     | `ORD-` |
| Pricing           | Financial  | (catalog)| (none)|
| Rating            | Financial  | Billing | (none) |
| Invoice           | Financial  | Billing | `INV-` |
| Payment           | Financial  | Billing | `PAY-` |
| Tax               | Financial  | Billing | (none) |
| Discount          | Financial  | Billing | (none) |
| Credit            | Financial  | Billing | `CRD-` |
| DunningRecord     | Financial  | Billing | `DNG-` |
| RevenueEntry      | Financial  | Billing | (none) |
| CostEntry         | Financial  | Billing | (none) |

### 8.4 Business Execution tier

| Entity            | Owner Core   | Domain   | Prefix |
|-------------------|--------------|----------|--------|
| Ticket            | Case         | OSS/CRM  | `TKT-` |
| Incident          | Case         | OSS/Net  | `INC-` |
| ServiceRequest    | Case         | OSS      | `SRQ-` |
| Complaint         | Case         | CRM      | `CMP-` |
| Problem           | Case         | OSS      | `PRB-` |
| ChangeRequest     | Case         | OSS      | `CHG-` |
| CaseQueue         | Case         | OSS      | (none) |
| WorkflowDefinition| Workflow     | Studio   | `WFL-` |
| WorkflowInstance  | Workflow     | (any)    | `WFI-` |
| State             | Workflow     | Studio   | (none) |
| Transition        | Workflow     | Studio   | (none) |
| TransitionHistory | Workflow     | (any)    | (none) |
| AutomationRule    | Automation   | Studio   | `AUT-` |
| Trigger           | Automation   | Studio   | (none) |
| Condition         | Automation   | Studio   | (none) |
| Action            | Automation   | Studio   | (none) |
| Execution         | Automation   | Auto     | `EXE-` |
| ApprovalRequest   | Approval     | (any)    | `APR-` |
| ApprovalChain     | Approval     | Studio   | (none) |
| SignoffEvidence   | Approval     | (any)    | (none) |
| SlaDefinition     | SLA          | Studio   | `SLA-` |
| SlaClock          | SLA          | (any)    | (none) |
| BreachRecord      | SLA          | (any)    | `BRC-` |
| Schedule          | Scheduling   | WF       | `SCH-` |
| Appointment       | Scheduling   | WF       | `APT-` |
| DispatchSlot      | Scheduling   | WF       | (none) |
| Thread            | Communication| (any)    | `THR-` |
| Message           | Communication| (any)    | `MSG-` |
| Comment           | Communication| (any)    | `CMT-` |
| Mention           | Communication| (any)    | (none) |
| NotificationRecord| Notification | (any)    | `NTF-` |
| NotificationPreference| Notification| (any) | (none) |
| Document          | Document     | (any)    | `DOC-` |
| Attachment        | Document     | (any)    | `ATT-` |
| GeneratedPdf      | Document     | (any)    | (none) |

### 8.5 Platform Services tier

| Entity                  | Owner Core           | Domain  | Prefix |
|-------------------------|----------------------|---------|--------|
| MasterDataRecord        | Data                 | Admin   | (none) |
| ReferenceData           | Data                 | global  | (none) |
| DataQualityRule         | Data                 | Studio  | (none) |
| CanonicalSchema         | Data                 | Studio  | (none) |
| LineageEdge             | Data                 | Reports | (none) |
| CustomField             | Metadata             | Studio  | (none) |
| DynamicSchema           | Metadata             | Studio  | (none) |
| DynamicForm             | Metadata             | Studio  | (none) |
| EntityRelationship      | Relationship         | (any)   | `REL-` |
| DependencyGraph         | Relationship         | Network | (none) |
| SearchIndex             | Search               | Admin   | (none) |
| SavedFilter             | Search               | (any)   | (none) |
| SavedView               | Search               | (any)   | (none) |
| DomainEvent             | Event                | (any)   | (none) |
| EventStoreEntry         | Event                | Admin   | (none) |
| EventSchemaRegistration | Event                | Admin   | (none) |
| Connector               | Integration          | Auto    | `CNT-` |
| Webhook                 | Integration          | Auto    | `WBH-` |
| SyncJob                 | Integration          | Auto    | (none) |
| MappingRule             | Integration          | Studio  | (none) |
| ApiKey                  | Developer Platform   | Admin   | (none) |
| OAuthApp                | Developer Platform   | Admin   | `OAP-` |
| Sdk                     | Developer Platform   | Admin   | (none) |
| Queue                   | Background Proc      | Admin   | (none) |
| Worker                  | Background Proc      | Admin   | (none) |
| ScheduledJob            | Background Proc      | Admin   | `JOB-` |
| JobRun                  | Background Proc      | Admin   | (none) |
| ImportJob               | Import/Export        | Admin   | `IMP-` |
| ExportJob               | Import/Export        | Admin   | `EXP-` |
| Template (Email/SMS/Pdf)| Template             | Studio  | `TPL-` |
| BlobObject              | Storage              | Admin   | (none) |

### 8.6 Intelligence tier

| Entity              | Owner Core        | Domain  | Prefix |
|---------------------|-------------------|---------|--------|
| KpiDefinition       | Analytics         | Reports | (none) |
| MetricModel         | Analytics         | Reports | (none) |
| DashboardDataset    | Analytics         | Reports | (none) |
| Aggregation         | Analytics         | Reports | (none) |
| ReportDefinition    | Reporting         | Reports | `RPT-` |
| ReportSchedule      | Reporting         | Reports | `RPS-` |
| ReportRun           | Reporting         | Reports | (none) |
| GeneratedReportFile | Reporting         | Reports | (none) |
| AiAssistant         | AI                | (any)   | `AIA-` |
| Prompt              | AI                | Studio  | (none) |
| AiTool              | AI                | Studio  | (none) |
| KnowledgeSource     | AI                | Studio  | (none) |
| AiAuditLog          | AI                | Admin   | (none) |
| ForecastModel       | Forecasting       | Reports | (none) |
| ForecastRun         | Forecasting       | Reports | `FRC-` |
| Scenario            | Forecasting       | Reports | (none) |
| DecisionModel       | Decision Support  | (any)   | (none) |
| Recommendation      | Decision Support  | (any)   | `REC-` |

### 8.7 Experience tier

| Entity                | Owner Core    | Domain  | Prefix |
|-----------------------|---------------|---------|--------|
| LeftNavEntry          | Workspace     | (n/a)   | (none) |
| TopNavEntry           | Workspace     | (n/a)   | (none) |
| DashboardLayout       | Workspace     | (n/a)   | (none) |
| BoardLayout           | Workspace     | (n/a)   | (none) |
| TableLayout           | Workspace     | (n/a)   | (none) |
| DetailPageLayout      | Workspace     | (n/a)   | (none) |
| CommandPaletteEntry   | Workspace     | (n/a)   | (none) |
| PageRegistryEntry     | Workspace     | (n/a)   | (none) |
| CustomerPortalPage    | Portal        | Portal  | (none) |
| PartnerPortalPage     | Portal        | Portal  | (none) |
| PortalAuthSurface     | Portal        | Portal  | (none) |
| PortalRequest         | Portal        | Portal  | `PRQ-` |
| MobileAppShell        | Mobile        | WF      | (none) |
| OfflineSyncRecord     | Mobile        | WF      | (none) |
| App                   | Marketplace   | Admin   | `APP-` |
| Extension             | Marketplace   | Admin   | `EXT-` |
| Translation           | Localization  | (any)   | (none) |
| LocaleProfile         | Localization  | (any)   | (none) |

## 9. Ownership Boundaries

### 9.1 Single-owner rule

Every entity belongs to one core. The `09_DATA_ARCHITECTURE.md` schema
declaration carries `__owner_core__` metadata so this is machine-checkable.

### 9.2 Cross-entity reference rules

| Allowed reference                              | Notes                          |
|------------------------------------------------|--------------------------------|
| `Service.customerId → Party.Customer.id`        | Direct FK on owner.            |
| `Service.contractId → Contract.id`              | Direct FK on owner.            |
| `Service.siteId → Location.Site.id`             | Direct FK on owner.            |
| `Service.resourceIds → (via Relationship Core)` | Many-to-many; rel rows.        |
| `Invoice.serviceId → Service.id` (line items)   | Direct FK on owner.            |
| `Ticket.customerId → Party.Customer.id`         | Direct FK on owner.            |
| `Ticket.serviceId → Service.id`                 | Direct FK (issue against svc). |
| `WorkOrder.serviceId → Service.id`              | Direct FK (work targets svc).  |
| `WorkOrder.assigneeId → Party.Employee.id`      | Direct FK.                     |
| `Notification.ownerEntityType + ownerEntityId`  | Polymorphic; type-narrowed.    |
| `Comment.ownerEntityType + ownerEntityId`       | Polymorphic.                   |
| `Attachment.ownerEntityType + ownerEntityId`    | Polymorphic.                   |
| `AuditLog.ownerEntityType + ownerEntityId`      | Polymorphic.                   |

| Forbidden reference                            | Why                            |
|------------------------------------------------|--------------------------------|
| `Customer.firstActiveServiceId` (back-ref FK)   | Inverts ownership; query Svc.  |
| `Tenant.customerCount`                          | Derived; do not denormalize.   |
| Cross-tenant FK                                 | RLS-bypassing.                 |
| Reference by `referenceNumber` instead of `id`  | Display fields not for joins.  |

### 9.3 Polymorphic owners

Where `ownerEntityType + ownerEntityId` is used (Notification, Comment,
Attachment, AuditLog, Watcher), the `ownerEntityType` uses the canonical
ObjectType enum (D3, standard 03). The pair `(ownerEntityType, ownerEntityId)`
is indexed for read paths.

## 10. Relationships

### 10.1 Customer-centric path

The platform's load-bearing path from every artifact to a Customer:

| From                | Path to Customer                                                  |
|---------------------|-------------------------------------------------------------------|
| Service             | `Service.customerId → Party.Customer.id`                          |
| Contract            | `Contract.customerId → Party.Customer.id`                         |
| Quote / Order       | `Quote.customerId → Party.Customer.id`                            |
| Invoice             | `Invoice.customerId → Party.Customer.id`                          |
| Payment             | `Payment.customerId → Party.Customer.id`                          |
| Ticket / Incident   | `Ticket.customerId → Party.Customer.id`                           |
| WorkOrder           | `WorkOrder.serviceId → Service.customerId`                        |
| Notification        | `Notification.recipientId → Party.Contact.partyId → Customer.id`  |
| Document / Attachment | Via polymorphic owner pointing to one of the above              |
| Comment             | Via polymorphic owner pointing to one of the above                |

### 10.2 Service-centric path (the impact graph)

```
Customer ──> Service ──> ServiceInstance ──> Resource Topology
                              │
                              ├── OLT  ──> Port
                              ├── ONU
                              └── Fiber pair ──> Splice ──> Fiber span
                              └── IP allocation ──> IpPool
                              └── Site ──> Building ──> Rack
```

The impact graph is computed via Relationship Core: when an OLT goes down,
which services and which customers are impacted? The path traverses
`EntityRelationship` rows of type `CONNECTED_TO`, `SERVES`, `LOCATED_AT`.

### 10.3 Contract-centric path

```
Contract ── covers ──> Service(s)
        ── for ──> Customer
        ── billed via ──> Account (Financial Core)
        ── amended by ──> Amendment
        ── superseded by ──> Renewal
```

### 10.4 Work / Case path

```
Customer ──> Ticket / Incident / ServiceRequest ── opens ──> Case
                                                  │
                                                  └── escalates ──> Approval
                                                  └── spawns ──> WorkOrder ──> FieldJob ──> Assignment
                                                  └── breaches ──> SlaBreach
                                                  └── communicated via ──> Thread / Message
```

### 10.5 Relationship Core usage

Many-to-many or directional cross-cutting links use `EntityRelationship`:

```
EntityRelationship {
  id: UUIDv7
  referenceNumber: REL-…
  tenantId
  sourceEntityType: ObjectType  (e.g. SERVICE)
  sourceEntityId: UUIDv7
  targetEntityType: ObjectType  (e.g. RESOURCE)
  targetEntityId: UUIDv7
  relationshipType: enum        (e.g. CONNECTED_TO, SERVES, LOCATED_AT)
  direction: enum               (DIRECTED, BIDIRECTIONAL)
  validFrom, validUntil         (optional time-bounded relationships)
  status, deletionState, audit fields
}
```

Examples:

- `(SERVICE, svc-123) — SERVES → (CUSTOMER, cus-456)` (direction: DIRECTED).
- `(SERVICE, svc-123) — CONNECTED_TO → (OLT, olt-789)` (direction: DIRECTED).
- `(OLT, olt-789) — LOCATED_AT → (SITE, sit-001)` (direction: DIRECTED).
- `(CUSTOMER, cus-456) — DUPLICATES → (CUSTOMER, cus-321)` (direction: DIRECTED).

### 10.6 No cross-tenant relationships

A `Relationship` row's `tenantId` must equal both source and target tenants
(when both are tenant-scoped). Cross-tenant relationships are forbidden
except for explicit Super-Admin operations governed by a documented
`14_TENANT_ARCHITECTURE.md` rule.

## 11. Responsibilities

### 11.1 Core teams

Each core's accountable team (or Platform Engineering as default) owns:

- The entity schemas in `09_DATA_ARCHITECTURE.md`.
- The reference-number prefix registry entry in §7.4.
- The audit/event/deletion posture per L7-L8.

### 11.2 Cross-entity reviewers

PRs that add cross-entity references are reviewed for:

- Ownership of source AND target.
- FK direction (no inverted ownership).
- Tenant scoping consistency.
- Relationship Core usage where appropriate.

### 11.3 Studio (Metadata Core) responsibility

When tenants extend entities with custom fields, Metadata Core stores the
schema and renders forms; the *canonical* entity schema is unchanged. Custom
fields may not become canonical without an explicit `09_DATA_ARCHITECTURE.md`
amendment.

## 12. Allowed Patterns

### AP1 — Polymorphic owner on attachment-like entities

Notification, Comment, Attachment, AuditLog, Watcher use
`ownerEntityType + ownerEntityId` because they attach to many entity types.
Use the canonical ObjectType enum.

### AP2 — Direct FK on owner-of relationships

Service has `customerId`, `contractId`, `siteId` as direct FKs because each
is a 1-to-N owner-of relationship.

### AP3 — Relationship Core for cross-cutting many-to-many

A service may reference multiple resources via `EntityRelationship` rows of
type `CONNECTED_TO`. This is the impact-graph pattern.

### AP4 — Soft-link by reference number for display

UI shows "INV-2025-00417" as a clickable link. The hyperlink resolves the
reference number to an ID then navigates to the canonical detail page.
Persistence uses ID; presentation uses reference number.

### AP5 — Time-bounded relationships

`Relationship.validFrom + validUntil` captures historical structure:
"this resource was located at this site between dates X and Y".

### AP6 — Workflow state on the entity

The entity's `status` field holds its current lifecycle stage; transitions
are recorded in `TransitionHistory` (Workflow Core). The entity does not
store a transition log.

## 13. Forbidden Patterns

### FP1 — Hardcoded enum strings outside the registry

`status = "active"` (lowercase) is forbidden; the canonical value is `ACTIVE`
(UPPER_SNAKE). Hardcoded strings outside the enum registry break Localization
and parity with file 14.

### FP2 — Two entities for the "same" concept

Forbidden: a separate `BillingCustomer` table that duplicates Party.Customer.
Use Party Core's Customer; Billing adds the `Account` (in Financial Core)
for billing-specific attributes.

### FP3 — Reference number as primary key

`PRIMARY KEY (reference_number)` is forbidden; use UUIDv7 `id`. Reference
numbers may change format over time; IDs must never change.

### FP4 — Cross-tenant join

A query that selects rows from two tenants' data into a single result set is
forbidden in business code paths. Cross-tenant operations live exclusively
in explicit Super-Admin paths governed by `14_TENANT_ARCHITECTURE.md`.

### FP5 — Inverted ownership FK

A foreign key from a parent to its child (e.g. `Customer.firstServiceId`)
inverts the natural ownership direction and creates maintenance debt. The
correct path is to query Service for the customer's services.

### FP6 — Embedding many-to-many as JSON array

`Service.resource_ids: jsonb` containing an array of UUIDs is forbidden.
Use `EntityRelationship` rows so the topology is queryable, indexable, and
auditable.

### FP7 — Polymorphic-without-type-narrowing

Polymorphic owner fields (`ownerEntityType + ownerEntityId`) MUST narrow
type at read time. A handler that processes `Comment` rows MUST validate
the owner type before dispatching.

### FP8 — Field rename without migration

Renaming a field in code without an Alembic migration breaks production data.
Renames are migrations; deprecations are migrations + dual-write windows.

### FP9 — Display values as relationship keys

Matching "Customer A" by name against "Customer A" elsewhere is forbidden.
Names are mutable; use IDs.

## 14. Cross-Architecture Dependencies

| Upstream | Reason |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Defines the cores that own entities. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Defines ownership rules. |
| `02_DOMAIN_ARCHITECTURE.md` | Defines domain assemblies that consume entities. |

| Downstream | Reason |
|---|---|
| `04_NAVIGATION_ARCHITECTURE.md` | UI exposes entity detail pages. |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` | Renders entities. |
| `08_PERMISSION_ARCHITECTURE.md` | `object.action` keys derive from entity type. |
| `09_DATA_ARCHITECTURE.md` | Physical schema for these entities. |
| `10_API_ARCHITECTURE.md` | REST surface per entity. |
| `11_EVENT_ARCHITECTURE.md` | Event topics named per entity. |
| `13_SECURITY_ARCHITECTURE.md` | Encryption + retention per entity class. |
| `14_TENANT_ARCHITECTURE.md` | `tenantId` is universal. |
| `15_REPORTING_ARCHITECTURE.md` | Reports query entities. |
| `16_ANALYTICS_ARCHITECTURE.md` | KPIs derived from entity events. |

## 15. Implementation Requirements

### 15.1 Identity / reference / enum standards

The LOCKED standards 03 (Identity / Reference / Naming / Enum) and 14 (Enum
Registry) are the binding source for field names and enum values. This
document references them; implementation enforces them.

### 15.2 Reference-number generation

A central service generates reference numbers from (prefix, tenant scope,
year, monotonic counter). The format is `PFX-YYYY-NNNNNN` (e.g.
`SVC-2026-000417`). Counters are tenant-scoped.

### 15.3 UUIDv7 generation

All `id` fields use UUIDv7 via the canonical helper. Migrations enforce
column type `uuid` (or text in databases without native UUID) and
`gen_random_uuid()` is forbidden (it generates UUIDv4).

### 15.4 Polymorphic owner fields

Polymorphic `(ownerEntityType, ownerEntityId)` pairs are indexed together.
Backend code validates the type before dispatch.

### 15.5 Relationship Core CRUD

A single Relationship Core API creates / queries / removes `EntityRelationship`
rows. Direct table writes outside the Relationship Core API are forbidden.

### 15.6 Lifecycle status enums

Each entity declares its lifecycle status enum in `09_DATA_ARCHITECTURE.md`
and registers in standard 14. UI rendering uses the localized label;
persistence uses the UPPER_SNAKE canonical value.

### 15.7 Deletion / archive / restore audit

Per standard 12 (D14): archive / soft-delete / restore each emit events
`Object.Archived`, `Object.SoftDeleted`, `Object.Restored`, `Object.PurgeScheduled`,
`Object.Purged`. Required even in batch operations.

### 15.8 Drift check

`tools/check_drift.py` adds rules:

- No table without `tenantId` except registered global reference data.
- No primary key not `id uuid`.
- No FK by `reference_number`.
- No enum value not UPPER_SNAKE.

## 16. Future Expansion Rules

### 16.1 Adding an entity

1. Confirm owner core.
2. Add row to canonical entity index in §8.
3. Add reference-number prefix to §7.4 (if user-visible).
4. Add schema declaration to `09_DATA_ARCHITECTURE.md`.
5. Define lifecycle status enum in standard 14.
6. Declare events in `11_EVENT_ARCHITECTURE.md`.
7. Declare permissions in `08_PERMISSION_ARCHITECTURE.md`.

### 16.2 Renaming an entity

Renaming an entity is a multi-PR migration: deprecate the old name, dual-write
to both, migrate references, then remove the old. The `referenceNumber` prefix
may NOT be renamed once issued; the new name uses a new prefix.

### 16.3 Splitting an entity

When an entity grows two distinct identity-bearing roles (e.g. a future
`Service` split into `SubscriberService` and `WholesaleService`):

- Author the split as two new entities under their cores.
- Migrate data row-by-row.
- The Workflow Core handles the lifecycle of the split.

### 16.4 Cross-tenant reference data

New cross-tenant reference data (Currency, Locale, Country) must be
explicitly registered as global in `09_DATA_ARCHITECTURE.md` and exempt from
RLS. Default is tenant-scoped; the exception requires constitution amendment.

### 16.5 Polymorphic owner extension

Adding a new polymorphic-owner type (e.g. allowing comments on a new entity
class) requires adding the new ObjectType value (standard 14) and updating
the polymorphic dispatch table.

---

*End of 03 — Information Architecture.*
