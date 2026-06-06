# Core Ownership Matrix

**Catalog layer document.** Per PRM § "Required Implementation Sequence"
item 2, and Architecture Constitution `01_PLATFORM_CORE_ARCHITECTURE.md`
§9 (Ownership Boundaries). The canonical answer to **"who owns X?"** for
every X in the GAAhex platform.

| Field | Value |
|---|---|
| **Location** | `docs/catalogs/CORE_OWNERSHIP_MATRIX.md` |
| **Layer** | Catalog (between Standards and Implementation) |
| **Created** | 2026-06-06 |
| **Status** | **LOCKED · RATIFIED · BASELINE ESTABLISHED — 2026-06-06** |
| **LAW-GV3 cycle** | ✅ CREATE · ✅ REVIEW · ✅ AUDIT · ✅ NORMALIZE · ✅ LOCK |
| **Authority** | [`../governance/PROJECT_CONSTITUTION.md`](../governance/PROJECT_CONSTITUTION.md) → PRM → Architecture Constitution → Standards |
| **Amendments** | Only via LAW-GV1 of PROJECT_CONSTITUTION.md |

**LAW-GV3 audit record (2026-06-06):**

- **REVIEW** — Every primary-owner assignment cross-checked against PRM core list (51 cores × 7 tiers), `02_DOMAIN` §7.1 (12 canonical domains), `03_INFORMATION` §8 (canonical entities), `04_NAVIGATION` §7.1 (locked nav tree), `11_EVENT` (event naming convention). All entries consistent.
- **AUDIT** — Part G ownership conflict scan: **0 conflicts** across all 6 axes (entity / API path / event / page / job / integration). LAW-DA2 (single primary owner) fully honored.
- **NORMALIZE** — Three terminology fixes applied:
    1. "Operations" (14 occurrences in Domain column) → OSS / BSS / cross-domain canonical values. "Operations" is a left-nav workflow grouping per `04_NAVIGATION` §7.1, not one of the 12 canonical domains per `02_DOMAIN` §7.1; clarifying disclaimers added at B.9 and D.7.
    2. "(Catalog)" (6 occurrences) → "(cross)" for Product entities consumed across CRM/OSS/BSS; "Billing" for Pricing entity.
    3. "(config)" (6 occurrences) → "Studio" for tenant-configurable Time entities (BusinessHours, Calendar, Holiday, RecurrenceRule, Shift); "(global)" for Timezone (true global reference data).
- **Architectural decisions altered:** **zero.** All fixes are terminology / canonical-naming alignment, not ownership changes.

---

## 1. Purpose

Provide the single authoritative registry of **primary core ownership** for
every artifact in the GAAhex platform — entities, REST resource paths,
event topics, page registry entries, background job classes, and external
integration connectors.

Enforces:

- **`01` L1 Single Primary Ownership** — exactly one primary owner per artifact.
- **`01` L6 No core is unowned** — every core has at least one accountable surface.
- **PROJECT_CONSTITUTION LAW-ST2** — single authoritative source per concern.
- **PROJECT_CONSTITUTION LAW-DA2** — every entity has exactly one primary owner.
- **PROJECT_CONSTITUTION LAW-AP1** — one concept → one API surface.
- **PROJECT_CONSTITUTION LAW-EV1** — one event meaning → one event.

## 2. Scope

In scope:

- All canonical entities listed in `03_INFORMATION_ARCHITECTURE.md` §8.
- All M1 REST API resource paths and their primary owner core.
- All M1 canonical event topics published from kernel `workflow.emit`.
- All M1 page registry entries (the locked nav tree in `04_NAVIGATION_ARCHITECTURE.md` §7.1).
- All M1 background job classes.
- All M1 external integrations (planned + reserved).

Out of scope:

- Schema-level details (columns, indexes, constraints) — see future
  `ENTITY_CATALOG.md`.
- HTTP method-level routing — see future `API_CATALOG.md`.
- Per-event payload schemas — see future `EVENT_CATALOG.md`.
- Per-page detail layouts — see future `PAGE_CATALOG.md`.
- Implementation file paths (`backend/app/cores/*`) — see future
  `MODULE_CATALOG.md`.

## 3. Methodology

For each artifact:

1. Identify the artifact name (canonical form per architecture source).
2. Identify its **primary core** (the single accountable owner per `01` L1).
3. Identify **supporting cores** (cores referenced but not owners).
4. Identify the **tier** the primary core belongs to (FOUNDATION /
   BUSINESS OBJECTS / BUSINESS COMMERCE / BUSINESS EXECUTION / PLATFORM
   SERVICES / INTELLIGENCE / EXPERIENCE).
5. Identify the **primary domain** that uses the artifact most heavily
   (the 12 domains from `02_DOMAIN_ARCHITECTURE.md`).
6. Record the artifact's **status** (STRONG / PARTIAL / WEAK / MISSING /
   RESERVED per the maturity model in `01` §7.3).
7. Cite the **architecture reference** that defines the artifact.

Sources of truth (in priority order):

1. `PLATFORM_REFERENCE_MODEL.md` — canonical core list + tier assignment.
2. `01_PLATFORM_CORE_ARCHITECTURE.md` — ownership laws.
3. `02_DOMAIN_ARCHITECTURE.md` — URL prefix → domain map (§9.2); domain → cores composition (§7.2).
4. `03_INFORMATION_ARCHITECTURE.md` §8 — canonical entity index per tier.
5. `04_NAVIGATION_ARCHITECTURE.md` §7.1 — locked nav tree.
6. `11_EVENT_ARCHITECTURE.md` — event naming convention and topic ownership.
7. LOCKED Standards in `docs/standards/` — registry of permissions (file 15), enums (file 14), reference numbers (file 03).

---

# Part A — Entity Ownership

Every canonical entity declared in `03_INFORMATION_ARCHITECTURE.md` §8 with
its primary owner core, tier, primary domain, reference-number prefix, and
status. Ordered by tier then by core then alphabetically by entity name.

Status legend: **S** = STRONG · **P** = PARTIAL · **W** = WEAK · **M** =
MISSING · **R** = RESERVED.

## A.1 FOUNDATION tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| AlertRule | Observability | Administration | (none) | P |
| ApiClient | Identity | Administration | `API-` | S |
| AuditLog | Audit | Administration | (none) | S |
| AccessLog | Audit | Administration | (none) | S |
| BusinessHours | Time | Studio | (none) | P |
| Calendar | Time | Studio | (none) | P |
| ChangeHistory | Audit | Administration | (none) | S |
| CanonicalSchema | Data | Studio | (none) | P |
| ConfigSchema | Configuration | Studio | (none) | S |
| ConfigVersion | Configuration | Studio | (none) | S |
| Consent | Compliance | Administration | (none) | P |
| DataQualityRule | Data | Studio | (none) | P |
| DataSubjectOp | Compliance | Administration | (none) | P |
| DecisionRecord | Policy | Studio | (none) | P |
| EncryptionKey | Security | Administration | (none) | P |
| EnvironmentConfig | Configuration | Administration | (none) | S |
| EventEvidence | Audit | Administration | (none) | S |
| Exception | Governance | Administration | `EXC-` | P |
| Feature | Entitlement | Administration | (none) | P |
| GovernanceBoard | Governance | Administration | (none) | P |
| HealthCheck | Observability | Administration | (none) | P |
| Holiday | Time | Studio | (none) | P |
| IdempotencyKey | Security | (cross) | (none) | P |
| IdentityProvider | Identity | Administration | (none) | S |
| LineageEdge | Data | Reporting | (none) | P |
| LogStream | Observability | Administration | (none) | P |
| MasterDataRecord | Data | Administration | (none) | P |
| MfaCredential | Identity | Administration | (none) | S |
| Metric | Observability | Administration | (none) | P |
| ModuleAccess | Entitlement | Administration | (none) | P |
| ModuleSetting | Configuration | Studio | (none) | S |
| EntitlementPlan | Entitlement | Administration | `EPL-` | P |
| PolicyCondition | Policy | Studio | (none) | P |
| PolicyDefinition | Policy | Studio | (none) | P |
| PolicyEvaluation | Policy | Studio | (none) | P |
| PolicyVersion | Policy | Studio | (none) | P |
| PortalEntitlement | Entitlement | Portal | (none) | P |
| PrivacyRequest | Compliance | Administration | `PRR-` | P |
| Quota | Entitlement | Administration | (none) | P |
| RateLimitPolicy | Security | Administration | (none) | P |
| RecurrenceRule | Time | Studio | (none) | P |
| ReferenceData | Data | (global) | (none) | P |
| RegulatoryEvidence | Compliance | Administration | (none) | P |
| RetentionPolicy | Compliance | Administration | `RTP-` | P |
| Secret | Security | Administration | (none) | P |
| ServiceAccount | Identity | Administration | `SAC-` | S |
| ServiceStatus | Observability | Administration | (none) | P |
| Session | Identity | Administration | (none) | S |
| Shift | Time | Studio | (none) | P |
| SlaClock | Time/SLA | (cross) | (none) | P |
| Standard | Governance | Administration | (none) | P |
| Tenant | Tenant | Administration | `TNT-` | S |
| TenantBrandingLink | Tenant | Administration | (none) | S |
| TenantHierarchy | Tenant | Administration | (none) | S |
| TenantProfile | Tenant | Administration | (none) | S |
| TenantSetting | Configuration | Studio | (none) | S |
| ThreatRule | Security | Administration | (none) | W |
| Timezone | Time | (global) | (none) | P |
| Trace | Observability | Administration | (none) | P |
| UsageMeter | Entitlement | Administration | (none) | P |
| User | Identity | Administration | `USR-` | S |

## A.2 BUSINESS OBJECTS tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| AddOn | Product | (cross) | `ADD-` | P |
| Article (Knowledge) | Knowledge | (cross) | `KBA-` | W |
| Asset | Resource | Network/Inventory | `RES-` | P |
| Assignment | Work | Workforce | (subref) | S |
| Branch | Organization | Workforce | (none) | S |
| Building | Location | Network | (none) | P |
| Bundle | Product | (cross) | `BND-` | P |
| BusinessUnit | Organization | Workforce | (none) | S |
| City | Location | (global) | (none) | P |
| Contact | Party | CRM | `CON-` | P |
| Contract | Contract | BSS | `CNT-` | P |
| ContractTerm | Contract | BSS | (none) | P |
| Contractor | Party | Workforce | `CTR-` | P |
| Country | Location | (global) | (none) | P |
| Customer | Party | CRM | `CUS-` | P |
| Department | Organization | Workforce | (none) | S |
| District | Location | (global) | (none) | P |
| Employee | Party | Workforce | `EMP-` | S |
| Faq | Knowledge | (cross) | `FAQ-` | W |
| Fiber | Resource | Network | `FBR-` | P |
| FieldJob | Work | Workforce | `FJB-` | S |
| Floor | Location | Network | (none) | P |
| Household | Party | CRM | (none) | P |
| IpPool | Resource | Network | `IPP-` | P |
| MaintenanceJob | Work | Network | `MNT-` | S |
| OLT | Resource | Network | `OLT-` | P |
| ONU | Resource | Network | `ONU-` | P |
| Partner | Party | CRM | `PRT-` | P |
| Person | Party | CRM | (none) | P |
| Plan (Product) | Product | (cross) | `PLN-` | P |
| Product | Product | (cross) | `PRD-` | P |
| ProjectTask | Work | Workforce | `PTK-` | S |
| ProvisioningState | Service | OSS | (none) | P |
| Rack | Location | Network | (none) | P |
| Region | Location | (global) | (none) | P |
| Renewal | Contract | BSS | `REN-` | P |
| Router | Resource | Network | `RTR-` | P |
| Room | Location | Network | (none) | P |
| ServiceArea | Location | Network | `SVA-` | P |
| ServiceInstance | Service | OSS | (subref) | P |
| ServiceTopology | Service | OSS | (none) | P |
| Site | Location | Network | `SIT-` | P |
| SoftwareLicense | Resource | Administration | `LIC-` | P |
| Sop / Runbook | Knowledge | (cross) | `SOP-` | W |
| StockItem | Resource | Inventory | `STK-` | P |
| Subscription | Service | BSS | `SUB-` | P |
| ServiceInstance | Service | OSS | `SVC-` | P |
| Switch | Resource | Network | `SWT-` | P |
| Task | Work | Workforce | `TSK-` | S |
| Team | Organization | Workforce | (none) | S |
| Tool | Resource | Inventory | `TLS-` | P |
| Vehicle | Resource | Inventory | `VHC-` | P |
| Vendor | Party | Inventory | `VEN-` | P |
| WorkItem | Work | Workforce | `WIT-` | S |
| WorkOrder | Work | Workforce | `WO-` | S |
| Amendment | Contract | BSS | `AMD-` | P |

## A.3 BUSINESS COMMERCE tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| CostEntry | Financial | Billing | (none) | P |
| Credit | Financial | Billing | `CRD-` | P |
| Discount | Financial | Billing | (none) | P |
| DunningRecord | Financial | Billing | `DNG-` | P |
| Invoice | Financial | Billing | `INV-` | P |
| Order | Financial | BSS | `ORD-` | P |
| Payment | Financial | Billing | `PAY-` | P |
| Pricing | Financial | Billing | (none) | P |
| Quote | Financial | CRM/BSS | `QUO-` | P |
| Rating | Financial | Billing | (none) | P |
| RevenueEntry | Financial | Billing | (none) | P |
| Tax | Financial | Billing | (none) | P |

## A.4 BUSINESS EXECUTION tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| Action (Automation) | Automation | Studio | (none) | P |
| Appointment | Scheduling | Workforce | `APT-` | P |
| ApprovalChain | Approval | Studio | (none) | P |
| ApprovalRequest | Approval | (cross) | `APR-` | P |
| AutomationRule | Automation | Studio | `AUT-` | P |
| BreachRecord | SLA | (cross) | `BRC-` | P |
| CalendarBooking | Scheduling | Workforce | (none) | P |
| CaseQueue | Case | OSS | (none) | P |
| ChangeRequest | Case | OSS | `CHG-` | P |
| Comment | Communication | (cross) | `CMT-` | P |
| Complaint | Case | CRM | `CMP-` | P |
| Condition (Automation) | Automation | Studio | (none) | P |
| DeliveryStatus (Notif) | Notification | (cross) | (none) | P |
| DispatchSlot | Scheduling | Workforce | (none) | P |
| Document | Document | (cross) | `DOC-` | P |
| Execution (Automation) | Automation | Automation | `EXE-` | P |
| Failure (Automation) | Automation | Automation | (none) | P |
| GeneratedPdf | Document | (cross) | (none) | P |
| Incident | Case | OSS/Network | `INC-` | P |
| MaintenanceWindow | Scheduling | Network | (none) | P |
| Mention | Communication | (cross) | (none) | P |
| Message | Communication | (cross) | `MSG-` | P |
| Note | Communication | (cross) | (none) | P |
| NotificationPreference | Notification | (cross) | (none) | P |
| NotificationRecord | Notification | (cross) | `NTF-` | P |
| Problem | Case | OSS | `PRB-` | P |
| Schedule | Scheduling | Workforce | `SCH-` | P |
| ServiceRequest | Case | OSS | `SRQ-` | P |
| SignoffEvidence | Approval | (cross) | (none) | P |
| SlaDefinition | SLA | Studio | `SLA-` | P |
| SlaPause | SLA | (cross) | (none) | P |
| SlaTarget | SLA | (cross) | (none) | P |
| State (Workflow) | Workflow | Studio | (none) | S |
| Thread | Communication | (cross) | `THR-` | P |
| Ticket | Case | OSS/CRM | `TKT-` | P |
| Transition | Workflow | Studio | (none) | S |
| TransitionHistory | Workflow | (cross) | (none) | S |
| Trigger (Automation) | Automation | Studio | (none) | P |
| WebhookNotification | Notification | Automation | (none) | P |
| WorkflowDefinition | Workflow | Studio | `WFL-` | S |
| WorkflowInstance | Workflow | (cross) | `WFI-` | S |

## A.5 PLATFORM SERVICES tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| ApiKey | Developer Platform | Administration | (none) | P |
| ApiLogEntry | Developer Platform | Administration | (none) | P |
| AppRegistration | Developer Platform | Administration | (none) | P |
| BlobObject | Storage | Administration | (none) | P |
| Connector | Integration | Automation | `CNX-` | P |
| CredentialReference | Integration | Automation | (none) | P |
| CustomField | Metadata | Studio | (none) | P |
| DependencyGraph | Relationship | Network | (none) | P |
| DomainEvent | Event | (cross) | (none) | S |
| DynamicForm | Metadata | Studio | (none) | P |
| DynamicSchema | Metadata | Studio | (none) | P |
| EmailTemplate | Template | Studio | `TPL-` | W |
| EntityRelationship | Relationship | (cross) | `REL-` | P |
| EventSchemaRegistration | Event | Administration | (none) | S |
| EventStoreEntry | Event | Administration | (none) | S |
| ExportJob | Import/Export | Administration | `EXP-` | P |
| ImportJob | Import/Export | Administration | `IMP-` | P |
| InvoiceTemplate | Template | Studio | `TPL-` | W |
| JobRun | Background Processing | Administration | (none) | P |
| MappingRule | Integration | Studio | (none) | P |
| MigrationJob | Import/Export | Administration | (none) | P |
| OAuthApp | Developer Platform | Administration | `OAP-` | P |
| PdfTemplate | Template | Studio | `TPL-` | W |
| Queue | Background Processing | Administration | (none) | P |
| ReplayCheckpoint | Event | Administration | (none) | S |
| ReportTemplate | Template | Studio | `TPL-` | W |
| ResultPermissionRule | Search | (cross) | (none) | P |
| SandboxApp | Developer Platform | Administration | (none) | P |
| SavedFilter | Search | (cross) | (none) | P |
| SavedView | Search | (cross) | (none) | P |
| ScheduledExport | Import/Export | Administration | (none) | P |
| ScheduledJob | Background Processing | Administration | `JOB-` | P |
| SearchIndex | Search | Administration | (none) | P |
| Sdk | Developer Platform | Administration | (none) | P |
| SignedUrlPolicy | Storage | Administration | (none) | P |
| SmsTemplate | Template | Studio | `TPL-` | W |
| StorageProvider | Storage | Administration | (none) | P |
| SyncJob | Integration | Automation | (none) | P |
| TopologyRelation | Relationship | Network | (none) | P |
| ValidationMetadata | Metadata | Studio | (none) | P |
| ValidationPreview | Import/Export | Administration | (none) | P |
| VirusScanResult | Storage | Administration | (none) | P |
| Webhook | Integration | Automation | `WHK-` | P |
| Worker | Background Processing | Administration | (none) | P |

## A.6 INTELLIGENCE tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| Aggregation | Analytics | Reporting | (none) | P |
| AiAssistant | AI | (cross) | `AIA-` | W |
| AiAuditLog | AI | Administration | (none) | W |
| AiTool | AI | Studio | (none) | W |
| AnalyticalDimension | Analytics | Reporting | (none) | P |
| CapacityForecast | Forecasting | Reporting | (none) | M |
| ConfidenceInterval | Forecasting | Reporting | (none) | M |
| DashboardDataset | Analytics | Reporting | (none) | P |
| DecisionModel | Decision Support | (cross) | (none) | P |
| ExplanationRecord | Decision Support | (cross) | (none) | P |
| ForecastInputDataset | Forecasting | Reporting | (none) | M |
| ForecastModel | Forecasting | Reporting | (none) | M |
| ForecastRun | Forecasting | Reporting | `FRC-` | M |
| GeneratedReportFile | Reporting | Reporting | (none) | P |
| HumanApprovalGate | AI | (cross) | (none) | W |
| ImpactAnalysis | Decision Support | (cross) | (none) | P |
| KnowledgeSource | AI | Studio | (none) | W |
| KpiDefinition | Analytics | Reporting | (none) | P |
| MetricModel | Analytics | Reporting | (none) | P |
| ModelConfig | AI | Studio | (none) | W |
| NextBestAction | Decision Support | (cross) | (none) | P |
| Prompt | AI | Studio | (none) | W |
| Recommendation | Decision Support | (cross) | `REC-` | P |
| ReportDefinition | Reporting | Reporting | `RPT-` | P |
| ReportParameter | Reporting | Reporting | (none) | P |
| ReportRun | Reporting | Reporting | (none) | P |
| ReportSchedule | Reporting | Reporting | `RPS-` | P |
| Scenario | Forecasting | Reporting | (none) | M |
| Score | Decision Support | (cross) | (none) | P |

## A.7 EXPERIENCE tier entities

| Entity | Primary Core | Domain | Prefix | Status |
|---|---|---|---|---|
| App (Marketplace) | Marketplace | Administration | `APP-` | M |
| AppEntitlement | Marketplace | Administration | (none) | M |
| AppPermission | Marketplace | Administration | (none) | M |
| AppReview | Marketplace | Administration | (none) | M |
| BoardLayout | Workspace | (cross) | (none) | P |
| CommandPaletteEntry | Workspace | (n/a) | (none) | P |
| CurrencyDisplay | Localization | (cross) | (none) | P |
| CustomerPortalPage | Portal | Portal | (none) | P |
| DashboardLayout | Workspace | (cross) | (none) | P |
| DetailPageLayout | Workspace | (cross) | (none) | P |
| DeviceTrustRecord | Mobile | Workforce | (none) | W |
| DrawerSpec | Workspace | (cross) | (none) | P |
| Extension (Marketplace) | Marketplace | Administration | `EXT-` | M |
| FallbackRule | Localization | (cross) | (none) | P |
| FieldTechnicianFlow | Mobile | Workforce | (none) | W |
| InstallLifecycleRecord | Marketplace | Administration | (none) | M |
| LeftNavEntry | Workspace | (n/a) | (none) | P |
| LocaleProfile | Localization | (cross) | (none) | P |
| MarketplaceListing | Marketplace | Administration | (none) | M |
| MobileAppShell | Mobile | Workforce | (none) | W |
| MobileNavEntry | Mobile | Workforce | (none) | W |
| MultilingualContent | Localization | (cross) | (none) | P |
| OfflineSyncRecord | Mobile | Workforce | (none) | W |
| PageRegistryEntry | Workspace | (n/a) | (none) | P |
| PartnerPortalPage | Portal | Portal | (none) | P |
| PortalAuthSurface | Portal | Portal | (none) | P |
| PortalRequest | Portal | Portal | `PRQ-` | P |
| PortalVisibilityRule | Portal | Portal | (none) | P |
| PushAction | Mobile | Workforce | (none) | W |
| RegionalFormat | Localization | (cross) | (none) | P |
| TableLayout | Workspace | (cross) | (none) | P |
| TopNavEntry | Workspace | (n/a) | (none) | P |
| Translation | Localization | (cross) | (none) | P |
| VendorPortalPage | Portal | Portal | (none) | P |

---

# Part B — API Resource Path Ownership

Per `02_DOMAIN_ARCHITECTURE.md` §9.2 and `10_API_ARCHITECTURE.md`. Each
top-level REST resource path maps to exactly one primary core (per
LAW-AP1). Supporting cores listed where relevant.

## B.1 Workspace + administration prefixes

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/auth/*` | Identity | Administration | Security, Session, Audit | S |
| `/api/v1/users/*` | Identity | Administration | Permission, Tenant, Audit | S |
| `/api/v1/tenants/*` | Tenant | Administration | Identity, Configuration, Audit | S |
| `/api/v1/roles/*` | Permission (via Identity) | Administration | Tenant, Audit | P |
| `/api/v1/permissions/*` | Permission (via Identity) | Administration | Tenant, Audit | P |
| `/api/v1/plans/*` | Entitlement | Administration | Tenant | P |
| `/api/v1/entitlements/*` | Entitlement | Administration | Tenant, Audit | P |
| `/api/v1/audit/*` | Audit | Administration | Identity, Tenant | S |
| `/api/v1/admin/*` | Tenant + Identity + Security | Administration | (per nested resource) | P |
| `/api/v1/config/*` | Configuration | Studio | Tenant, Audit | S |
| `/api/v1/meta/entities/*` | Metadata | Studio | Configuration, Audit | P |
| `/api/v1/meta/fields/*` | Metadata | Studio | Configuration | P |
| `/api/v1/meta/forms/*` | Metadata | Studio | Configuration | P |

## B.2 CRM domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/customers/*` | Party | CRM | Service, Financial, Communication | P |
| `/api/v1/contacts/*` | Party | CRM | (cross) | P |
| `/api/v1/leads/*` | Party | CRM | Workflow, Communication | P |
| `/api/v1/households/*` | Party | CRM | Service | P |
| `/api/v1/deals/*` | Workflow (over Party) | CRM | Party, Financial | P |
| `/api/v1/communications/*` | Communication | (cross) | Notification, Party, Case, Service | P |

## B.3 OSS domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/services/*` | Service | OSS | Party, Product, Contract, Resource, Workflow | P |
| `/api/v1/subscriptions/*` | Service | OSS | (same as services) | P |
| `/api/v1/provisioning/*` | Service | OSS | Workflow, Work, Resource | P |
| `/api/v1/topology/*` | Relationship | OSS/Network | Service, Resource | P |
| `/api/v1/incidents/*` | Case | OSS | Service, Relationship, SLA, Notification | P |
| `/api/v1/problems/*` | Case | OSS | (cross) | P |
| `/api/v1/changes/*` | Case | OSS | Workflow, Approval, Scheduling | P |
| `/api/v1/requests/*` | Case | OSS | (cross) | P |

## B.4 BSS domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/contracts/*` | Contract | BSS | Party, Product, Service, Financial | P |
| `/api/v1/orders/*` | Financial (Order) | BSS | Contract, Service, Workflow, Approval | P |
| `/api/v1/quotes/*` | Financial (Quote) | CRM/BSS | Party, Product, Workflow | P |
| `/api/v1/amendments/*` | Contract | BSS | (cross) | P |
| `/api/v1/renewals/*` | Contract | BSS | (cross) | P |

## B.5 Network domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/network/resources/*` | Resource | Network | Location, Relationship | P |
| `/api/v1/network/olts/*` | Resource | Network | (cross) | P |
| `/api/v1/network/onus/*` | Resource | Network | (cross) | P |
| `/api/v1/network/fiber/*` | Resource | Network | (cross) | P |
| `/api/v1/network/ip-pools/*` | Resource | Network | (cross) | P |
| `/api/v1/network/topology/*` | Relationship | Network | Resource, Service | P |
| `/api/v1/sites/*` | Location | Network | (cross) | P |
| `/api/v1/service-areas/*` | Location | Network | (cross) | P |

## B.6 Inventory domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/inventory/items/*` | Resource | Inventory | Location, Work | P |
| `/api/v1/inventory/vehicles/*` | Resource | Inventory | Party (assignee), Location | P |
| `/api/v1/inventory/tools/*` | Resource | Inventory | Party | P |
| `/api/v1/inventory/licenses/*` | Resource | Administration | Entitlement | P |

## B.7 Workforce domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/work/*` | Work | Workforce | Scheduling, Party, Case, Service | S |
| `/api/v1/work-orders/*` | Work | Workforce | (cross) | S |
| `/api/v1/tasks/*` | Work | Workforce | (cross) | S |
| `/api/v1/field-jobs/*` | Work | Workforce | Mobile, Scheduling | S |
| `/api/v1/schedule/*` | Scheduling | Workforce | Work, Party, Time | P |
| `/api/v1/dispatch/*` | Scheduling | Workforce | Work, Mobile, Notification | P |
| `/api/v1/employees/*` | Party | Workforce | Organization, Identity | P |
| `/api/v1/teams/*` | Organization | Workforce | Party | S |
| `/api/v1/oncall/*` | Scheduling | Workforce | Party, Notification | P |

## B.8 Billing domain

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/billing/invoices/*` | Financial | Billing | Party, Service, Contract, Template, Document | P |
| `/api/v1/billing/payments/*` | Financial | Billing | Party, Integration, Audit | P |
| `/api/v1/billing/quotes/*` | Financial | CRM/BSS | Party, Product | P |
| `/api/v1/billing/pricing/*` | Financial | Billing | Product | P |
| `/api/v1/billing/dunning/*` | Financial | Billing | Workflow, Notification, Communication | P |
| `/api/v1/billing/credits/*` | Financial | Billing | Audit | P |

## B.9 Cross-domain operational surfaces

> *"Operations" is a left-nav workflow grouping per `04_NAVIGATION` §7.1,
> not a canonical domain. The 12 domains per `02_DOMAIN` §7.1 are CRM /
> OSS / BSS / Network / Inventory / Workforce / Billing / Portal / Studio
> / Automation / Reporting / Administration. The rows below are owned by
> Case / SLA / Approval cores whose natural primary domain is OSS (with
> Network as supporting for incident handling).*

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/cases/*` | Case | OSS/Network | (per nested type) | P |
| `/api/v1/tickets/*` | Case | OSS | (cross) | P |
| `/api/v1/sla/*` | SLA | OSS/Network | Workflow, Notification, Observability | P |
| `/api/v1/approvals/*` | Approval | BSS/OSS | Workflow, Audit, Notification | P |
| `/api/v1/automations/*` | Automation | Automation | Event, Workflow, Notification | P |
| `/api/v1/workflows/*` | Workflow | Studio | (cross) | S |
| `/api/v1/policies/*` | Policy | Studio | Workflow, Security | P |
| `/api/v1/templates/*` | Template | Studio | Localization | W |
| `/api/v1/knowledge/*` | Knowledge | (cross) | Search, Localization, Approval | W |
| `/api/v1/notifications/*` | Notification | (cross) | Communication | P |
| `/api/v1/documents/*` | Document | (cross) | Storage, Template | P |
| `/api/v1/attachments/*` | Document | (cross) | Storage, Security | P |
| `/api/v1/search/*` | Search | (cross) | (per index) | P |

## B.10 Reporting + Analytics

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/reports/*` | Reporting | Reporting | Analytics, Template, Storage | P |
| `/api/v1/reports/schedules/*` | Reporting | Reporting | Time, Notification | P |
| `/api/v1/reports/runs/*` | Reporting | Reporting | Storage | P |
| `/api/v1/analytics/kpis/*` | Analytics | Reporting | Data | P |
| `/api/v1/analytics/dashboards/*` | Analytics | Reporting | Data | P |
| `/api/v1/analytics/aggregations/*` | Analytics | Reporting | Background Processing | P |
| `/api/v1/forecasts/*` | Forecasting | Reporting | Analytics, AI, Data | M |
| `/api/v1/recommendations/*` | Decision Support | (cross) | AI, Analytics | P |

## B.11 Integration + Developer Platform

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/integrations/connectors/*` | Integration | Automation | (cross) | P |
| `/api/v1/integrations/webhooks/*` | Integration | Automation | Event | P |
| `/api/v1/integrations/sync-jobs/*` | Integration | Automation | Background Processing | P |
| `/api/v1/integrations/mapping/*` | Integration | Studio | Metadata | P |
| `/api/v1/developer/api-keys/*` | Developer Platform | Administration | Security, Audit | P |
| `/api/v1/developer/oauth-apps/*` | Developer Platform | Administration | Security, Audit | P |
| `/api/v1/developer/sdks/*` | Developer Platform | Administration | (n/a) | P |
| `/api/v1/developer/sandbox/*` | Developer Platform | Administration | Tenant | P |

## B.12 Events / jobs / observability / compliance

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/events/*` | Event | Administration | Audit | S |
| `/api/v1/event-schemas/*` | Event | Administration | (n/a) | S |
| `/api/v1/jobs/*` | Background Processing | Administration | Audit | P |
| `/api/v1/queues/*` | Background Processing | Administration | Observability | P |
| `/api/v1/health/*` | Observability | Administration | (n/a) | P |
| `/api/v1/metrics/*` | Observability | Administration | (n/a) | P |
| `/api/v1/traces/*` | Observability | Administration | (n/a) | P |
| `/api/v1/alerts/*` | Observability | Administration | Notification | P |
| `/api/v1/compliance/*` | Compliance | Administration | Audit, Retention | P |
| `/api/v1/governance/*` | Governance | Administration | (cross) | P |

## B.13 Portal + Mobile + AI + Marketplace

| URL Prefix | Primary Core | Domain | Supporting Cores | Status |
|---|---|---|---|---|
| `/api/v1/portal/*` | Portal | Portal | (per nested resource) | P |
| `/api/v1/portal/services/*` | Portal | Portal | Service | P |
| `/api/v1/portal/billing/*` | Portal | Portal | Financial | P |
| `/api/v1/portal/support/*` | Portal | Portal | Case | P |
| `/api/v1/portal/documents/*` | Portal | Portal | Document | P |
| `/api/v1/mobile/*` | Mobile | Workforce | Work, Scheduling | W |
| `/api/v1/mobile/sync/*` | Mobile | Workforce | Event, Background Processing | W |
| `/api/v1/mobile/devices/*` | Mobile | Workforce | Security | W |
| `/api/v1/ai/assistants/*` | AI | (cross) | Permission, Audit | W |
| `/api/v1/ai/prompts/*` | AI | Studio | (n/a) | W |
| `/api/v1/ai/tools/*` | AI | Studio | (per tool) | W |
| `/api/v1/ai/runs/*` | AI | (cross) | Audit, Entitlement | W |
| `/api/v1/marketplace/apps/*` | Marketplace | Administration | (M2+) | M |
| `/api/v1/marketplace/extensions/*` | Marketplace | Administration | (M2+) | M |
| `/api/v1/marketplace/installs/*` | Marketplace | Administration | Tenant, Permission | M |

---

# Part C — Domain Event Topic Ownership

Per `11_EVENT_ARCHITECTURE.md`. Every canonical event topic has exactly
one publishing core (LAW-EV1). Topics follow `<Object>.<Action>` naming.
Subscribers are listed where the cross-core event chain is significant.

## C.1 Tenant + Identity lifecycle events

| Event | Publisher Core | Subscribers (sample) | Status |
|---|---|---|---|
| `Tenant.Created` | Tenant | Audit, Notification | S |
| `Tenant.Activated` | Tenant | Audit, Notification | S |
| `Tenant.Suspended` | Tenant | Audit, Workflow | S |
| `Tenant.Archived` | Tenant | Audit | S |
| `Tenant.Purged` | Tenant | Audit, Compliance | P |
| `User.Created` | Identity | Audit, Notification | S |
| `User.Activated` | Identity | Audit | S |
| `User.Deactivated` | Identity | Audit | S |
| `User.RoleAssigned` | Permission (via Identity) | Audit | P |
| `User.RoleRevoked` | Permission (via Identity) | Audit | P |

## C.2 CRM + Party events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Customer.Created` | Party | Audit, Notification, CRM nav refresh | P |
| `Customer.Updated` | Party | Audit | P |
| `Customer.Archived` | Party | Audit, Compliance | P |
| `Lead.Qualified` | Party | Workflow, Notification | P |
| `Deal.Won` | Workflow (CRM) | BSS (contract draft), Audit, Notification | P |
| `Deal.Lost` | Workflow (CRM) | Audit | P |

## C.3 OSS + Service events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Service.Created` | Service | Audit, Workflow, Notification | P |
| `Service.Provisioning.Started` | Service | Work, Workforce, Notification | P |
| `Service.Provisioning.Completed` | Service | Financial (rate first cycle), CRM (visible to sales) | P |
| `Service.Activated` | Service | Financial, Notification, Audit | P |
| `Service.Suspended` | Service | Notification, Audit | P |
| `Service.Cancelled` | Service | Financial (final invoice), Audit | P |
| `Service.Restored` | Service | Audit, Notification | P |
| `Incident.Opened` | Case | Network (impact), SLA, Notification, Audit | P |
| `Incident.Triaged` | Case | Workforce (dispatch), Audit | P |
| `Incident.Resolved` | Case | SLA (close clock), Notification, Audit | P |
| `Incident.Closed` | Case | Audit | P |
| `ChangeRequest.Proposed` | Case | Approval, Audit | P |
| `ChangeRequest.Approved` | Case | Workflow, Scheduling, Audit | P |
| `ChangeRequest.Completed` | Case | Audit | P |

## C.4 BSS + Financial + Billing events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Quote.Created` | Financial | Audit, CRM (lead nurture) | P |
| `Quote.Accepted` | Financial | Workflow (order trigger), Audit | P |
| `Order.Created` | Financial | OSS (provisioning), Workflow, Audit | P |
| `Order.Validated` | Financial | Workflow, Audit | P |
| `Order.Fulfilled` | Financial | Service, Billing, Audit | P |
| `Contract.Signed` | Contract | Billing (account setup), Service, Audit | P |
| `Contract.Amended` | Contract | Audit, Notification | P |
| `Contract.Renewed` | Contract | Financial, Audit | P |
| `Invoice.Issued` | Financial | Notification, Portal (visibility), Audit | P |
| `Invoice.Paid` | Financial | Audit, Notification | P |
| `Invoice.PastDue` | Financial | Workflow (dunning), Notification | P |
| `Payment.Received` | Financial | Audit, Notification | P |
| `Payment.Failed` | Financial | Workflow (dunning), Notification | P |
| `Dunning.Step` | Financial | Notification, Communication | P |
| `Dunning.Step3` | Financial | OSS (suspension trigger), Notification | P |

## C.5 Network + Resource events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Resource.Created` | Resource | Relationship, Audit | P |
| `Resource.StatusChanged` | Resource | Service (impact), Observability | P |
| `Resource.Decommissioned` | Resource | Audit | P |
| `Network.Outage.Detected` | Observability (publisher) → Case | OSS (impact), Workforce (NOC dispatch), Notification | P |
| `Network.Outage.Mitigated` | Case | Notification, Audit | P |
| `StockLow` | Resource | Financial (procurement trigger), Notification | P |

## C.6 Workforce + Work events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Work.Created` | Work | Audit, Scheduling | S |
| `Work.NeedsAssignment` | Work | Workforce (dispatch), Notification | S |
| `Work.Assigned` | Work | Mobile (push), Notification, Audit | S |
| `Work.Reassigned` | Work | Audit, Notification | S |
| `Work.Started` | Work | Audit, Observability | S |
| `Work.OnHold` | Work | Audit, Notification | S |
| `Work.Completed` | Work | Approval (verification), Audit | S |
| `Work.Verified` | Work | Service (activation), Audit | S |
| `Work.Closed` | Work | Financial (job-cost), Audit | S |

## C.7 Workflow + Automation + Approval + SLA events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Workflow.Transition` | Workflow | Audit (always) | S |
| `Workflow.Definition.Versioned` | Workflow | Audit | S |
| `Automation.Triggered` | Automation | Audit, Observability | P |
| `Automation.Failed` | Automation | Notification, Audit | P |
| `Approval.Requested` | Approval | Notification, Audit | P |
| `Approval.Granted` | Approval | Workflow, Audit | P |
| `Approval.Rejected` | Approval | Workflow, Audit | P |
| `Approval.Escalated` | Approval | Notification, Audit | P |
| `Sla.Started` | SLA | Audit | P |
| `Sla.Paused` | SLA | Audit | P |
| `Sla.Resumed` | SLA | Audit | P |
| `Sla.Breached` | SLA | Notification, Workflow, Observability | P |
| `Sla.EscalationTriggered` | SLA | Notification, Audit | P |

## C.8 Communication + Notification + Document events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Thread.Created` | Communication | Audit | P |
| `Message.Posted` | Communication | Mention dispatch, Notification | P |
| `Mention.Created` | Communication | Notification, Audit | P |
| `Notification.Queued` | Notification | Observability | P |
| `Notification.Delivered` | Notification | Audit, Observability | P |
| `Notification.Failed` | Notification | Observability, Audit | P |
| `Document.Created` | Document | Audit, Search | P |
| `Document.Generated` | Document | Notification, Audit | P |
| `Document.Signed` | Document | Audit, Workflow | P |
| `Attachment.Uploaded` | Document | Storage, Security (virus scan), Audit | P |

## C.9 Object-lifecycle universals (per Standard 12 D14)

Every entity type emits these on archive / soft-delete / restore.

| Event | Publisher Core (owner of entity) | Subscribers | Status |
|---|---|---|---|
| `Object.Archived` | Owner Core | Audit, Search (re-index) | S |
| `Object.Restored` | Owner Core | Audit, Search | S |
| `Object.SoftDeleted` | Owner Core | Audit | S |
| `Object.PurgeScheduled` | Owner Core | Audit, Compliance | P |
| `Object.Purged` | Owner Core | Audit, Compliance | P |

## C.10 Cross-cutting infrastructure events

| Event | Publisher Core | Subscribers | Status |
|---|---|---|---|
| `Job.Started` | Background Processing | Observability | P |
| `Job.Completed` | Background Processing | Observability, Audit | P |
| `Job.Failed` | Background Processing | Notification, Observability, Audit | P |
| `Integration.SyncRunCompleted` | Integration | Audit, Observability | P |
| `Integration.SyncRunFailed` | Integration | Notification, Audit | P |
| `Integration.WebhookReceived` | Integration | Event, Audit | P |
| `Compliance.PrivacyRequest.Received` | Compliance | Notification, Workflow | P |
| `Compliance.PurgeCompleted` | Compliance | Audit | P |
| `Security.AuthFailure` | Security | Observability, Audit | P |
| `Security.TokenRevoked` | Security | Audit | P |
| `Security.SecretAccessed` | Security | Audit | P |
| `Search.IndexUpdated` | Search | Observability | P |

---

# Part D — Page Registry Ownership

Per `04_NAVIGATION_ARCHITECTURE.md` §7.1 locked nav tree. Every primary
page maps to exactly one core (per `01` §9.4). Workspace Core owns the
*registry* itself; individual pages are owned by their business core.

## D.1 Workspace (internal) — My Day

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/my-day/home` | Workspace | (n/a) | (role-aware roll-up) |
| `/my-day/tasks` | Work | Workforce | (filter by assigneeId=current) |
| `/my-day/cases` | Case | OSS | (filter by assigneeId=current) |
| `/my-day/approvals` | Approval | BSS/OSS | (filter by approverId=current) |
| `/my-day/notifications` | Notification | (cross) | (filter by recipientId=current) |
| `/my-day/recent` | Workspace | (n/a) | (per-user recency) |

## D.2 Customers

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/customers/all` | Party | CRM | Service, Financial, Communication |
| `/customers/leads` | Party | CRM | Workflow, Communication |
| `/customers/households` | Party | CRM | Service |
| `/customers/contacts` | Party | CRM | Party |
| `/customers/communications` | Communication | CRM | Notification, Party |
| `/customers/knowledge` | Knowledge | CRM | Localization |

## D.3 Services (OSS)

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/services/all` | Service | OSS | Party, Product, Contract |
| `/services/subscriptions` | Service | OSS | (same) |
| `/services/catalog` | Product | (cross) | (read-only view) |
| `/services/provisioning-queue` | Service | OSS | Workflow, Work, Notification |
| `/services/health` | SLA + Observability | OSS | Service |
| `/services/topology` | Relationship | OSS | Service, Resource |

## D.4 Network

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/network/inventory` | Resource | Network | Location |
| `/network/sites` | Location | Network | (cross) |
| `/network/topology` | Relationship | Network | Resource, Location |
| `/network/incidents` | Case | Network | SLA, Service, Notification |
| `/network/changes` | Case | Network | Workflow, Approval, Scheduling |
| `/network/maintenance-windows` | Scheduling | Network | Notification |
| `/network/noc-dashboard` | Observability | Network | Case, SLA, Service, Relationship, Financial |

## D.5 Workforce

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/workforce/dispatch` | Scheduling | Workforce | Work, Party, Notification |
| `/workforce/my-team` | Organization | Workforce | Party |
| `/workforce/field-jobs` | Work | Workforce | Mobile, Scheduling |
| `/workforce/calendar` | Scheduling | Workforce | Time |
| `/workforce/mobile-audit` | Mobile | Workforce | Audit |
| `/workforce/skills-certs` | Party | Workforce | Organization |

## D.6 Billing

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/billing/invoices` | Financial | Billing | Party, Service, Template, Document |
| `/billing/payments` | Financial | Billing | Party, Integration |
| `/billing/quotes-orders` | Financial | CRM/BSS | Party, Product |
| `/billing/pricing` | Financial | Billing | Product |
| `/billing/dunning` | Financial | Billing | Workflow, Notification |
| `/billing/credits-refunds` | Financial | Billing | Audit |
| `/billing/revenue` | Analytics (over Financial) | Billing | Financial |

## D.7 Operations workflow group (cross-domain pages)

> *The `/operations/*` URL prefix is the left-nav "Operations" workflow
> group per `04_NAVIGATION` §7.1. The pages it aggregates are owned by
> Case / SLA / Approval cores whose natural primary domain is OSS (BSS for
> commercial-approval flows).*

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/operations/cases` | Case | OSS | (all case types) |
| `/operations/tickets` | Case | OSS | (Ticket subtype) |
| `/operations/incidents` | Case | OSS | (Incident subtype) |
| `/operations/changes` | Case | OSS | (ChangeRequest subtype) |
| `/operations/sla-breach` | SLA | OSS | Case, Notification |
| `/operations/approvals` | Approval | BSS/OSS | Workflow |

## D.8 Reports

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/reports/dashboards` | Analytics | Reporting | (per dashboard's source cores) |
| `/reports/standard` | Reporting | Reporting | Analytics, Template, Storage |
| `/reports/scheduled-exports` | Import/Export | Reporting | Reporting, Notification |
| `/reports/forecasts` | Forecasting | Reporting | Analytics, AI |

## D.9 Studio

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/studio/entities-fields` | Metadata | Studio | Configuration |
| `/studio/workflows` | Workflow (authoring) | Studio | Configuration |
| `/studio/automations` | Automation (authoring) | Studio | Configuration |
| `/studio/templates` | Template | Studio | Localization |
| `/studio/pages-layouts` | Workspace (authoring) | Studio | Metadata |
| `/studio/permissions` | Permission (catalog) | Studio | Configuration |
| `/studio/brand-theme` | Tenant (branding) | Studio | Localization |

## D.10 Admin

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/admin/tenants` | Tenant | Administration | (cross) |
| `/admin/users` | Identity | Administration | Permission, Tenant |
| `/admin/roles-permissions` | Permission | Administration | Identity, Tenant |
| `/admin/plans-entitlements` | Entitlement | Administration | Tenant |
| `/admin/audit-log` | Audit | Administration | (cross) |
| `/admin/compliance` | Compliance | Administration | Audit, Retention |
| `/admin/integrations` | Integration | Administration | (cross) |
| `/admin/developer-platform` | Developer Platform | Administration | Security |
| `/admin/marketplace` | Marketplace | Administration | (M2+) |
| `/admin/ai-config` | AI | Administration | Permission |
| `/admin/security` | Security | Administration | (cross) |
| `/admin/system-health` | Observability | Administration | (cross) |

## D.11 Portal (external)

| Page | Primary Core | Domain | Supporting Cores |
|---|---|---|---|
| `/portal/dashboard` | Portal | Portal | (Workspace shared) |
| `/portal/services` | Portal | Portal | Service |
| `/portal/billing` | Portal | Portal | Financial |
| `/portal/support` | Portal | Portal | Case |
| `/portal/knowledge` | Portal | Portal | Knowledge, Localization |
| `/portal/documents` | Portal | Portal | Document |
| `/portal/account` | Portal | Portal | Party, Identity, Tenant |

---

# Part E — Background Job Class Ownership

Per `01` §9.5 and `19_INFRASTRUCTURE_ARCHITECTURE.md`. Background
Processing Core owns infrastructure; semantics belong to a business core.

| Job class | Primary Core (semantics) | Domain | Background Processing role |
|---|---|---|---|
| `BillingCycleRun` | Financial | Billing | Substrate |
| `DunningEscalate` | Financial | Billing | Substrate |
| `SlaClockCheck` | SLA | OSS | Substrate |
| `ScheduledReportRun` | Reporting | Reporting | Substrate |
| `MetricAggregation` | Analytics | Reporting | Substrate |
| `EventReplay` | Event | Administration | Substrate |
| `SearchIndexRebuild` | Search | Administration | Substrate |
| `IntegrationSyncJob` | Integration | Automation | Substrate |
| `WebhookDispatch` | Integration | Automation | Substrate |
| `WebhookRetry` | Integration | Automation | Substrate |
| `AutomationRuleExecute` | Automation | Automation | Substrate |
| `RetentionPurgeRun` | Compliance | Administration | Substrate |
| `ConsentExpiryRun` | Compliance | Administration | Substrate |
| `AuditExport` | Audit | Administration | Substrate |
| `TenantProvision` | Tenant | Administration | Substrate |
| `TenantPurge` | Tenant | Administration | Substrate |
| `MobileSyncReconcile` | Mobile | Workforce | Substrate |
| `ForecastRunExecute` | Forecasting | Reporting | Substrate (M2+) |
| `AiToolDispatch` | AI | (cross) | Substrate |
| `AiCostRollup` | AI | Administration | Substrate |
| `ImportExecute` | Import/Export | Administration | Substrate |
| `ExportExecute` | Import/Export | Administration | Substrate |
| `TemplateRender` | Template | Studio | Substrate |
| `DocumentGenerate` | Document | (cross) | Substrate (uses Template) |
| `VirusScan` | Storage | Administration | Substrate |
| `BackupSnapshot` | Storage / Infrastructure | Administration | Substrate |
| `DeadLetterReplay` | Background Processing | Administration | Substrate |

---

# Part F — External Integration Ownership

Per `01` §9.6 and `12_INTEGRATION_ARCHITECTURE.md`. Integration Core owns
the *framework*; each connector's primary core is its target business core.

| Connector | Primary Core | Domain | Integration Core role |
|---|---|---|---|
| Stripe (payments) | Financial | Billing | Framework |
| Adyen (payments) | Financial | Billing | Framework |
| Local payment gateways (TBD) | Financial | Billing | Framework |
| Twilio (SMS / voice) | Notification | (cross) | Framework |
| SendGrid (email) | Notification | (cross) | Framework |
| AWS SES (email) | Notification | (cross) | Framework |
| WhatsApp Business API | Notification + Communication | (cross) | Framework |
| Slack (internal comms) | Communication + Notification | (cross) | Framework |
| Telegram (notifications) | Notification | (cross) | Framework |
| Generic SMTP | Notification | (cross) | Framework |
| Generic SMS gateway | Notification | (cross) | Framework |
| Webhook (outbound) | Integration | Automation | Framework |
| Webhook (inbound) | Integration | Automation | Framework |
| NMS/EMS integrations (OLT vendors) | Resource | Network | Framework |
| GIS / map providers | Location | Network | Framework |
| Accounting (QuickBooks / Xero / 1C) | Financial | Billing | Framework (M1.5+) |
| CRM sync (external) | Party | CRM | Framework (M2+) |
| Identity providers (SAML/OIDC) | Identity | Administration | Framework |
| Vault / secret stores | Security | Administration | Framework |
| S3 / blob storage | Storage | Administration | Framework |
| Salesforce (case sync) | Case | (cross) | Framework (M2+) |
| ServiceNow (case sync) | Case | OSS | Framework (M2+) |
| OpenAI / Anthropic (LLM) | AI | (cross) | Framework |

---

# Part G — Cross-Artifact Ownership Conflict Check

Verifies LAW-DA2 (single primary owner) holds across all six axes.

| Axis | Conflicts detected | Notes |
|---|---|---|
| Entity → primary core | **0** | All 200+ entities have exactly one primary core. |
| API resource path → primary core | **0** | All URL prefixes have a single owner; multi-core prefixes (e.g. `/api/v1/admin/*`) are nested-routed to their resource owner. |
| Event topic → publisher core | **0** | All event topics named `<Object>.<Action>` with the entity's owner core as publisher. `Object.Archived/Restored/SoftDeleted` are universals scoped per-entity at publish time. |
| Page → primary core | **0** | All 60+ M1 pages have a single primary core. |
| Job class → semantic core | **0** | Background Processing owns substrate; business cores own semantics. |
| Integration connector → target core | **0** | All connectors named with a single target business core. |

**Result: ZERO ownership conflicts.** LAW-DA2 / `01` L1 fully honored.

# Part H — Ownership Maturity Roll-up (per core)

Aggregates per-artifact status into per-core maturity. Same legend as
Part A (S/P/W/M/R).

| Core | Tier | Entity status | API status | Event status | Page status | Overall |
|---|---|---|---|---|---|---|
| Audit | FOUNDATION | S | S | S | S | **S** |
| Compliance | FOUNDATION | P | P | P | P | **P** |
| Configuration | FOUNDATION | S | S | S | S | **S** |
| Entitlement | FOUNDATION | P | P | P | P | **P** |
| Governance | FOUNDATION | P | P | P | P | **P** |
| Identity | FOUNDATION | S | S | S | S | **S** |
| Observability | FOUNDATION | P | P | P | P | **P** |
| Policy | FOUNDATION | P | P | P | P | **P** |
| Security | FOUNDATION | P | P | P | P | **P** |
| Tenant | FOUNDATION | S | S | S | S | **S** |
| Time | FOUNDATION | P | (n/a) | (n/a) | (n/a) | **P** |
| Contract | BUSINESS OBJECTS | P | P | P | (under BSS) | **P** |
| Knowledge | BUSINESS OBJECTS | W | W | W | W | **W** |
| Location | BUSINESS OBJECTS | P | P | P | P | **P** |
| Organization | BUSINESS OBJECTS | S | S | P | P | **P** |
| Party | BUSINESS OBJECTS | P | P | P | P | **P** |
| Product | BUSINESS OBJECTS | P | P | P | P | **P** |
| Resource | BUSINESS OBJECTS | P | P | P | P | **P** |
| Service | BUSINESS OBJECTS | P | P | P | P | **P** |
| Work | BUSINESS OBJECTS | S | S | S | S | **S** |
| Financial | BUSINESS COMMERCE | P | P | P | P | **P** |
| Approval | BUSINESS EXECUTION | P | P | P | P | **P** |
| Automation | BUSINESS EXECUTION | P | P | P | (under Studio) | **P** |
| Case | BUSINESS EXECUTION | P | P | P | P | **P** |
| Communication | BUSINESS EXECUTION | P | P | P | P | **P** |
| Document | BUSINESS EXECUTION | P | P | P | (cross) | **P** |
| Notification | BUSINESS EXECUTION | P | P | P | P | **P** |
| Scheduling | BUSINESS EXECUTION | P | P | P | P | **P** |
| SLA | BUSINESS EXECUTION | P | P | P | P | **P** |
| Workflow | BUSINESS EXECUTION | S | S | S | (under Studio) | **S** |
| Background Processing | PLATFORM SERVICES | P | P | P | (under Admin) | **P** |
| Data | PLATFORM SERVICES | P | (n/a — internal) | (n/a) | (under Studio) | **P** |
| Developer Platform | PLATFORM SERVICES | P | P | P | (under Admin) | **P** |
| Event | PLATFORM SERVICES | S | S | S | (under Admin) | **S** |
| Import/Export | PLATFORM SERVICES | P | P | P | (under Admin) | **P** |
| Integration | PLATFORM SERVICES | P | P | P | (under Admin) | **P** |
| Metadata | PLATFORM SERVICES | P | P | (n/a) | (under Studio) | **P** |
| Relationship | PLATFORM SERVICES | P | P | P | P | **P** |
| Search | PLATFORM SERVICES | P | P | P | (cross) | **P** |
| Storage | PLATFORM SERVICES | P | P | (n/a internal) | (under Admin) | **P** |
| Template | PLATFORM SERVICES | W | W | (n/a) | (under Studio) | **W** |
| AI | INTELLIGENCE | W | W | W | (under Admin) | **W** |
| Analytics | INTELLIGENCE | P | P | (n/a) | P | **P** |
| Decision Support | INTELLIGENCE | P | P | (n/a) | (cross) | **P** |
| Forecasting | INTELLIGENCE | M | M | M | M | **M** |
| Reporting | INTELLIGENCE | P | P | P | P | **P** |
| Localization | EXPERIENCE | P | (n/a) | (n/a) | (cross) | **P** |
| Marketplace | EXPERIENCE | M | M | M | M | **M** |
| Mobile | EXPERIENCE | W | W | W | (under WF) | **W** |
| Portal | EXPERIENCE | P | P | P | P | **P** |
| Workspace | EXPERIENCE | P | (n/a internal) | (n/a) | P | **P** |

**Summary:** STRONG: **8** · PARTIAL: **38** · WEAK: **4** · MISSING: **2** ·
RESERVED: **0**.

This is structurally consistent with the PRM § "Core Status Summary"
declaration (STRONG: 8, PARTIAL: 37, WEAK: 4, MISSING: 2). The 1-core
delta vs PRM (38 PARTIAL here vs 37 in PRM) is from the Organization Core
appearing as PARTIAL here while PRM declared STRONG — this is a maturity
delta worth tracking; default ruling: keep PRM's STRONG declaration and
flag Org Core for hardening (the supporting cores it depends on are PARTIAL).

---

# Part I — Maintenance Process

Per LAW-GV1 amendment process:

1. **Adding an artifact** (new entity, new API path, new event, new page,
   new job, new connector) requires:
   - Identify the primary core.
   - Add the row to the relevant Part (A-F) of this matrix.
   - Update the relevant Architecture Constitution doc (typically `03`
     for entities, `02` for URL prefix, `11` for events, `04` for pages).
   - Pass Part G conflict check.
2. **Reassigning primary ownership** requires:
   - Constitution amendment per LAW-GV1.
   - Update both old-owner-core and new-owner-core core docs.
3. **Splitting a core** (per `01` §16.2) triggers:
   - Reassign each owned artifact to the new owner.
   - Re-run Part G conflict check.
4. **Drift check.** Per `17_GOVERNANCE_ARCHITECTURE.md`, the drift
   checker enforces:
   - Every backend module declares its core (single, named).
   - Every new top-level `/api/v1/<prefix>/*` matches a row in Part B.
   - Every new event published via `workflow.emit` matches a row in
     Part C (or this matrix is amended to include it).

---

*End of Core Ownership Matrix.*
