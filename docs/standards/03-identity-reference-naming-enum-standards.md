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
```
CUS=Customer        LED=Lead            EMP=Employee        ROL=Role
DEP=Department      TEM=Team            QUE=Queue           TKT=Ticket
TSK=Task            INV=Invoice         PAY=Payment         CNT=Contract
ORD=Order           APP=Approval        PRJ=Project         AST=Asset
SVC=Service         SUB=Subscription    NDV=Network Device  SIT=Site
LOC=Location        VEN=Vendor          PUR=Purchase Order  KBA=Knowledge Article
CHG=Change Request  INC=Incident        PRB=Problem         RLE=Release
CMP=Campaign        COM=Communication   REL=Relationship    EVT=Event
IMP=Import          EXP=Export          WFL=Workflow        SLA=SLA
WHK=Webhook         CFG=Configuration   FFL=Feature Flag    JOB=Background Job
```
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
