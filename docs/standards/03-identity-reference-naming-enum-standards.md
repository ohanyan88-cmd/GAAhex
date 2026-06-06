# 03 — Identity, Reference, Naming & Enum Standards

Covers: ID, Reference Number, Naming, Enum.
S5 patch: prefix registry expanded; every business object states UUIDv7 `id`.
M1 patch: CorrelationID / CausationID declared internal trace keys, exempt here.

---

## ID Standard — LOCKED

1. Every object has one primary `id`. IDs are system identifiers, never for human comms.
2. IDs are globally unique and never reused (deleted records do not release IDs).
3. IDs are immutable — cannot be edited, regenerated, imported over, or changed via API.
4. IDs are system-generated; users never enter them.
5. IDs are internal: used by DB, API, relations, audit, automation, integrations, permissions.
6. Preferred format: **UUIDv7** (globally unique, sortable, distributed-safe, future-proof).
   Example: `01975b6c-19a0-7f2f-b84e-c7c3e54c89af`.
7. Relationships always use IDs (`ticket.customerId`), never names or reference numbers.
8. Every audit event stores the entity ID.

**S5 application:** every object that declares an `XxxID` field (Event, Import, Export,
Workflow, SLA, Communication, Relationship, Webhook, Configuration, Feature Flag,
Background Job, etc.) has a primary `id = UUIDv7`. Internal-only technical records may be
UUID-only when not business-visible; this is stated explicitly per object.

---

## Reference Number Standard — LOCKED

Core principle: `ID ≠ Reference Number`. IDs are for systems; reference numbers are for humans.

1. Every major business object has a reference number.
2. Human-friendly (`TKT-000001`), never the UUID.
3. Unique within object type (prefixes differ, so `TKT-000123` and `INV-000123` coexist).
4. Locked format: `[PREFIX]-[SEQUENCE]`. **No year** (`TKT-2026-000001` is wrong).
5. Central prefix registry; no duplicate prefixes.
6. Reference numbers are immutable; never reused after deletion.
7. Storage: `referencePrefix`, `referenceSequence`, `referenceNumber` (displayed value derived).
8. Global search supports full reference (`TKT-000123`) and numeric-only (`123` → matches
   across object types, grouped/labeled by type).
9. Smart normalization: `TKT-000123`, `TKT000123`, `TKT-123`, `000123`, `123` all resolve.
10. Detail pages display Object Name + Reference Number.

### Prefix Registry (S5 + D8 — complete, no duplicates)

**Amended 2026-06-06 per LAW-GV1 amendment #3** (Prefix Registry Reconciliation;
see `docs/catalogs/PREFIX_RECONCILIATION_REPORT.md`). The registry below is
the **single authoritative source of truth** for reference-number prefixes.
`03_INFORMATION_ARCHITECTURE.md` §7.4 mirrors this table; the catalogs derive
from it.

| Prefix | Entity | Owner Core | IA8 § |
|---|---|---|---|
| `ADD-` | AddOn | Product | §8.2 |
| `AIA-` | AiAssistant | AI | §8.6 |
| `AMD-` | Amendment | Contract | §8.2 |
| `API-` | ApiClient | Identity | §8.1 |
| `APP-` | App (Marketplace) | Marketplace | §8.7 |
| `APR-` | ApprovalRequest | Approval | §8.4 |
| `APT-` | Appointment | Scheduling | §8.4 |
| `ATT-` | Attachment | Document | §8.4 |
| `AUT-` | AutomationRule | Automation | §8.4 |
| `BND-` | Bundle | Product | §8.2 |
| `BRC-` | BreachRecord | SLA | §8.4 |
| `CAM-` | Campaign | Party (Marketing — CRM) | §8.2 |
| `CFG-` | Configuration | Configuration | §8.1 |
| `CHG-` | ChangeRequest | Case | §8.4 |
| `CMP-` | Complaint | Case | §8.4 |
| `CMT-` | Comment | Communication | §8.4 |
| `CNT-` | Contract | Contract | §8.2 |
| `CNX-` | Connector | Integration | §8.5 |
| `CON-` | Contact | Party | §8.2 |
| `CRD-` | Credit | Financial | §8.3 |
| `CTR-` | Contractor | Party | §8.2 |
| `CUS-` | Customer | Party | §8.2 |
| `DEP-` | Department | Organization | §8.2 |
| `DNG-` | DunningRecord | Financial | §8.3 |
| `DOC-` | Document | Document | §8.4 |
| `EMP-` | Employee | Party | §8.2 |
| `EPL-` | EntitlementPlan | Entitlement | §8.1 |
| `EVT-` | DomainEvent | Event | §8.5 |
| `EXC-` | Exception | Governance | §8.1 |
| `EXE-` | Execution (Automation) | Automation | §8.4 |
| `EXP-` | ExportJob | Import/Export | §8.5 |
| `EXT-` | Extension | Marketplace | §8.7 |
| `FAQ-` | Faq | Knowledge | §8.2 |
| `FBR-` | Fiber | Resource | §8.2 |
| `FFL-` | FeatureFlag | Entitlement | §8.1 |
| `FJB-` | FieldJob | Work | §8.2 |
| `FRC-` | ForecastRun | Forecasting | §8.6 |
| `IMP-` | ImportJob | Import/Export | §8.5 |
| `INC-` | Incident | Case | §8.4 |
| `INV-` | Invoice | Financial | §8.3 |
| `IPP-` | IpPool | Resource | §8.2 |
| `JOB-` | ScheduledJob | Background Processing | §8.5 |
| `KBA-` | Article (Knowledge) | Knowledge | §8.2 |
| `LED-` | Lead | Party | §8.2 |
| `LIC-` | SoftwareLicense | Resource | §8.2 |
| `LOC-` | Location (parent) | Location | §8.2 |
| `MNT-` | MaintenanceJob | Work | §8.2 |
| `MSG-` | Message | Communication | §8.4 |
| `NDV-` | NetworkDevice (parent) | Resource | §8.2 |
| `NTF-` | NotificationRecord | Notification | §8.4 |
| `OAP-` | OAuthApp | Developer Platform | §8.5 |
| `OLT-` | OLT | Resource | §8.2 |
| `ONU-` | ONU | Resource | §8.2 |
| `ORD-` | Order | Financial | §8.3 |
| `PAY-` | Payment | Financial | §8.3 |
| `PLN-` | Plan (Product / Tariff) | Product | §8.2 |
| `PRB-` | Problem | Case | §8.4 |
| `PRD-` | Product | Product | §8.2 |
| `PRJ-` | Project | Work | §8.2 |
| `PRQ-` | PortalRequest | Portal | §8.7 |
| `PRR-` | PrivacyRequest | Compliance | §8.1 |
| `PRT-` | Partner | Party | §8.2 |
| `PTK-` | ProjectTask | Work | §8.2 |
| `PUR-` | PurchaseOrder | Resource / BSS | §8.2 |
| `QUE-` | Queue (CaseQueue) | Case | §8.4 |
| `QUO-` | Quote | Financial | §8.3 |
| `REC-` | Recommendation | Decision Support | §8.6 |
| `REL-` | EntityRelationship | Relationship | §8.5 |
| `REN-` | Renewal | Contract | §8.2 |
| `RES-` | Resource (base) | Resource | §8.2 |
| `RLE-` | Release | Workflow / Change Mgmt | §8.4 |
| `ROL-` | Role | Permission | §8.1 |
| `RPS-` | ReportSchedule | Reporting | §8.6 |
| `RPT-` | ReportDefinition | Reporting | §8.6 |
| `RTP-` | RetentionPolicy | Compliance | §8.1 |
| `RTR-` | Router | Resource | §8.2 |
| `SAC-` | ServiceAccount | Identity | §8.1 |
| `SCH-` | Schedule | Scheduling | §8.4 |
| `SIT-` | Site | Location | §8.2 |
| `SLA-` | SlaDefinition | SLA | §8.4 |
| `SOP-` | Sop / Runbook | Knowledge | §8.2 |
| `SRQ-` | ServiceRequest | Case | §8.4 |
| `STK-` | StockItem | Resource | §8.2 |
| `SUB-` | Subscription (commercial) | Service (BSS) | §8.2 |
| `SVA-` | ServiceArea | Location | §8.2 |
| `SVC-` | ServiceInstance (operational) | Service (OSS) | §8.2 |
| `SWT-` | Switch | Resource | §8.2 |
| `TEM-` | Team | Organization | §8.2 |
| `THR-` | Thread | Communication | §8.4 |
| `TKT-` | Ticket | Case | §8.4 |
| `TLS-` | Tool | Resource | §8.2 |
| `TNT-` | Tenant | Tenant | §8.1 |
| `TPL-` | Template | Template | §8.5 |
| `TSK-` | Task | Work | §8.2 |
| `USR-` | User | Identity | §8.1 |
| `VEN-` | Vendor | Party | §8.2 |
| `VHC-` | Vehicle | Resource | §8.2 |
| `WFI-` | WorkflowInstance | Workflow | §8.4 |
| `WFL-` | WorkflowDefinition | Workflow | §8.4 |
| `WHK-` | Webhook | Integration | §8.5 |
| `WIT-` | WorkItem | Work | §8.2 |
| `WO-`  | WorkOrder | Work | §8.2 |

**Total: 99 active canonical prefixes.**

#### Deprecated aliases (do not use for new entities)

| Deprecated alias | Replaced by | Reason |
|---|---|---|
| `WBH-` | `WHK-` | Webhook prefix variant unified per amendment #3. Reference numbers already issued with `WBH-` (if any) remain immutable per Standard 03 rule 6; new issuance uses `WHK-`. |
| `APP-` (was Approval) | `APR-` (Approval) + `APP-` (App/Marketplace) | Amendment #3 reassigned `APP-` to App (Marketplace per IA8 §8.7); Approval uses `APR-`. |
| `CMP-` (was Campaign in Std03) | `CMP-` (Complaint) + `CAM-` (Campaign) | Amendment #3 reassigned `CMP-` to Complaint (IA8 §8.4); Campaign uses new `CAM-`. |
| `CNT-` (was Connector in IA8 §8.5) | `CNT-` (Contract) + `CNX-` (Connector) | Amendment #3 reassigned `CNT-` to Contract (matches Std03); Connector uses new `CNX-`. |
| `CTR-` (was Contract in IA8 §8.2) | `CNT-` (Contract) | Amendment #3 disambiguated intra-IA8 collision; Contractor keeps `CTR-`. |
| `SVA-` (was ServiceAccount in IA8 §8.1) | `SAC-` (ServiceAccount) + `SVA-` (ServiceArea) | Amendment #3 disambiguated intra-IA8 collision; ServiceArea (user-facing) keeps `SVA-`; ServiceAccount uses new `SAC-`. |
| `SVC-` (was Subscription/Service combined) | `SUB-` (Subscription, BSS) + `SVC-` (ServiceInstance, OSS) | Amendment #3 split per domain boundary. |
| `PLN-` (was both Entitlement.Plan and Product.Plan) | `EPL-` (EntitlementPlan) + `PLN-` (Product Plan) | Amendment #3 disambiguated business concepts. |

D8 note: `REL=Relationship` and `RLE=Release` are distinct; no prefix collision. Internal-only
technical records (e.g. webhook delivery attempts, trace keys) may be UUID-only when not
business-visible, stated explicitly per object.

### Internal trace keys (M1)
`CorrelationID` and `CausationID` are **internal trace keys**, not human business reference
numbers. They are **exempt** from this standard. The Event System format
`COR-YYYYMMDD-XXXXXX` is permitted as an internal trace key and the no-year rule does not
apply to it. They must never be displayed as an object's business reference number.

---

## Naming Standard — LOCKED

1. Entity names: PascalCase, singular (`Customer`, not `customers`/`tbl_customer`).
2. Field names: camelCase (`firstName`, `createdAt`, `assignedUserId`).
3. Boolean fields read like a question (`isActive`, `isDeleted`, `hasAttachment`, `canEscalate`).
4. Primary key field name: `id`.
5. Foreign keys: `entityId` (`customerId`, `ticketId`).
6. Timestamps: `createdAt`, `updatedAt`, `deletedAt`, `approvedAt`, `closedAt`, `assignedAt`.
7. User references: `createdBy`, `updatedBy`, `assignedTo`, `approvedBy`, `closedBy`.
8. API collection routes: plural (`/customers`, `/tickets`).
9. Entity names stay singular even when the collection route is plural.
10. Database tables: singular (`customer`, `ticket`).
11. Enum type names: PascalCase (`TicketStatus`, `ApprovalDecision`).
12. Enum values: `UPPER_SNAKE_CASE` (`OPEN`, `IN_PROGRESS`, `WAITING_CUSTOMER`, `CLOSED`).

---

## Enum Standard — LOCKED

Definition: enums are finite, known, controlled business values (status, priority, type,
decision, category).

1. No free text when an enum exists.
2. Enum values are immutable — never rename (`OPEN → ACTIVE` is forbidden; it breaks reports,
   API, automation, audit, integrations).
3. Store internal value, display label separately (store `WAITING_CUSTOMER`, display
   "Waiting for Customer"). Never store display text as the value.
4. Enum type naming: PascalCase.
5. **Enum value naming: `UPPER_SNAKE_CASE` (governs ALL standards — B1).**
6. Enum ownership required: every enum has an owner department; changes require governance.
7. Lifecycle: `ACTIVE`, `DEPRECATED`. `DELETED` not allowed — historical records stay valid.
8. Central enum registry: name, owner department, values, description, lifecycle status,
   created date.
9. Localization: store stable value (`WAITING_CUSTOMER`); translate display only
   (EN "Waiting for Customer", HY "Սպասում է հաճախորդին", RU "Ожидание клиента"). The
   internal value never changes for translation.

**B1 enforcement:** all status/enum values across every standard in this set are
`UPPER_SNAKE_CASE`. See patch notes (file 13) for the full normalization list.

---

## Canonical Cross-Cutting Enums — LOCKED

These three enums are platform-wide and referenced by many standards. They are defined once here
and never redefined elsewhere.

### ObjectType / EntityType (D3)
One canonical enum used by Audit (`entityType`), Activity Timeline, Watcher, Relationship,
Attachment owner, Communication (`relatedEntityType`), Export, and any object reference. Audit
must be able to reference every object that has a timeline, so this is the superset:
```
CUSTOMER, LEAD, EMPLOYEE, ROLE, DEPARTMENT, TEAM, QUEUE, TICKET, TASK, INVOICE, PAYMENT,
CONTRACT, ORDER, APPROVAL, PROJECT, ASSET, SERVICE, SUBSCRIPTION, NETWORK_DEVICE, SITE,
LOCATION, VENDOR, PURCHASE_ORDER, KNOWLEDGE_ARTICLE, CHANGE_REQUEST, INCIDENT, PROBLEM,
RELEASE, CAMPAIGN, COMMUNICATION, RELATIONSHIP, EVENT, IMPORT, EXPORT, WORKFLOW, SLA,
WEBHOOK, CONFIGURATION, FEATURE_FLAG, BACKGROUND_JOB
```
`EntityType` is an alias of `ObjectType`; Audit's former 13-value subset is replaced by this set.

### ActorType (D5 — performer axis)
Who *performed* an action. Used by Audit, Event System, Automation, Integration, API, Webhook,
Background Job:
```
USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER
```
`USER` = the authenticated internal principal performing the action.

### PrincipalType (D5 / D12 — referenced-principal axis)
Who *owns / is assigned / watches / receives / is mentioned*. Superset:
```
EMPLOYEE, ROLE, DEPARTMENT, TEAM, QUEUE
```
Per-context allowed subsets (each context allows only what it can meaningfully hold):

| Context | Allowed PrincipalType values | Excluded (reason) |
|---------|------------------------------|-------------------|
| Task owner / assignee | EMPLOYEE, ROLE, DEPARTMENT, QUEUE | TEAM (use a role/department) |
| Watcher | EMPLOYEE, ROLE, DEPARTMENT, TEAM | QUEUE (queues don't "watch") |
| Notification recipient | EMPLOYEE, ROLE, DEPARTMENT, TEAM | QUEUE |
| Comment mention | EMPLOYEE, ROLE, DEPARTMENT, TEAM | QUEUE |
| Queue ownership | DEPARTMENT, EMPLOYEE | — |

`ActorType` (performed) and `PrincipalType` (referenced) are distinct axes; `USER` (ActorType)
and `EMPLOYEE` (PrincipalType) are not interchangeable tokens.

### RecipientType / ParticipantType (E5 — referenced principal incl. external party)
For contexts that may address an external party (notifications, communications), the canonical
recipient/participant enum is `PrincipalType ∪ {CUSTOMER}`:
```
EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER
```
Used by Notification (`recipientType`) and Customer Communication (`participantType`). `CUSTOMER`
here is the external portal principal (same token as `ActorType.CUSTOMER`). `QUEUE` is excluded
(queues neither receive notifications nor participate in conversations).

## Locked Decision
ID = system identity (UUIDv7). Reference Number = human reference (PREFIX-SEQUENCE, no year).
Naming = code/API/DB consistency (PascalCase entities/enums-types, camelCase fields, UPPER_SNAKE
enum values, PascalCase event names). Enum = canonical `UPPER_SNAKE_CASE` controlled values.
Three cross-cutting enums (ObjectType, ActorType, PrincipalType) are defined here only.
