# 13 — Consistency Patch Notes

Patch date: 2026-06-02. Scope: cross-standard consistency only. No new standards created except
placeholders required to expose existing gaps. Strictest already-locked rule wins on conflict.

## Blockers fixed

### B1 — Enum casing normalized to UPPER_SNAKE_CASE
Enum Standard wins. PascalCase status/enum values rewritten across files 08 and 12. Display labels
unchanged. Representative conversions:
```
ReadyToImport        → READY_TO_IMPORT
ValidationFailed     → VALIDATION_FAILED
CompletedWithErrors  → COMPLETED_WITH_ERRORS
OnTrack              → ON_TRACK
AtRisk               → AT_RISK
SoftDeleted          → SOFT_DELETED
PendingPurge         → PENDING_PURGE
DeadLettered         → DEAD_LETTERED
PendingReview        → PENDING_REVIEW
NotApplicable        → NOT_APPLICABLE
WaitingCustomer      → WAITING_CUSTOMER
```
Affected enums: Import status, Export status, Configuration status/scope, Feature Flag status/
scope/environment, Workflow status, SLA status + pause reasons, Communication direction/status,
Background Job status, Deletion state, Relationship direction, Data Retention categories,
lifecycle/pipeline stages. Already-compliant enums (Task, Comment, Watcher, Notification,
Relationship types, Audit) left unchanged.

### B2 — Event primary ID
Event System: primary `id = UUIDv7`; `EVT-000001` reclassified as `referenceNumber`; `EVT`
registered in the prefix registry. (file 06, file 03)

### B3 — Canonical ActorType
One enum `USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER`. Audit (added API/CUSTOMER, dropped
PascalCase), Event System (added API), API (`API`), Webhook/Background Job/Integration/Automation
all reference it. (files 00, 04, 06, 12)

### B4 — Timeline projection
"Exactly one timeline" replaced with: Event System is canonical source; timeline entries are
projections; one event may appear on multiple object timelines. Task events project onto Task
Timeline and Parent Object Timeline. (files 04, 05, 06)

### B5 — Single accountable stage owner
Each lifecycle/service-delivery stage has exactly one accountable Owner Department; the second
department is reclassified as supporting. Dual-owner strings (`Sales / Back Office`, etc.)
removed and tabulated. (files 02, 11)

## Structural fixes

- **S1** — One canonical index (file 00), names immutable, numbers display-only, no duplicates.
  `17/17` collision resolved (Notification 18, Event System 19). `22 vs 28` resolved into a single
  1–70 sequence.
- **S2** — Locked navigation tree is the sole navigation source of truth; Left Navigation Standard
  describes behavior only and no longer introduces a different example tree. (file 10)
- **S3** — Strategic Product Direction references the implementable UI standards (Device,
  Interface Density, Object Editing, API, etc.) instead of redefining them. (files 01, 10)
- **S4** — `pipeline` page type supports multiple tabbed views (Sales Pipeline, Customer
  Lifecycle, Service Delivery Pipeline) via the Tabs Standard. (files 10, 11)
- **S5** — Every business-visible object declares UUIDv7 `id` + a registered reference prefix;
  prefixes added: `EVT, IMP, EXP, WFL, SLA, COM, REL, WHK, CFG, FFL, JOB`. Internal-only technical
  records may be UUID-only, stated explicitly. (files 00, 03, 06, 08, 12)

## Minor fixes

- **M1** — `CorrelationID` / `CausationID` declared internal trace keys, exempt from the Reference
  Number Standard; `COR-YYYYMMDD-XXXXXX` permitted as a trace key (no-year rule not applied).
  (files 03, 06)
- **M2** — Modal scope clarified: `FORM` modal = quick-create/short only; `DETAIL_PREVIEW` normally
  a Drawer; large/complex editing uses Drawer or Dedicated Page. (files 09, 10)

## Remaining unresolved — SOURCE NOT PROVIDED
Seven referenced standards were never supplied to this patch and cannot be verified or completed
without their source text:
1. Global Status Standard
2. Automation Standard
3. Integration Standard
4. Security & Permission Standard
5. Data Validation Standard
6. Search & Filter Standard
7. Navigation Standard (base behavior — the locked navigation **tree** is provided)

They are present as placeholders (files 06, 07, 10) carrying only the constraints other locked
standards impose. No rules were invented for them. Supply their source text to close the set.

---

# Second patch — deep-audit fixes (D1–D16)

Applied 2026-06-02 after a deep re-audit of the assembled set.

## Critical
- **D1** `tenantId` added to Event and Audit required-field lists (Multi-Tenant Standard now
  satisfied for tenant-owned events/audit). Files 04, 06, 08.
- **D2** All field identifiers normalized to camelCase per the Naming Standard (`tenantId,
  createdBy, objectId, actorId, eventId, workflowKey, featureFlagKey, targetUrl`, etc.). Enum
  values stay UPPER_SNAKE; event names stay PascalCase. Files 04, 06, 08, 12.
- **D3** One canonical `ObjectType`/`EntityType` enum (40-value superset) defined in file 03;
  Audit's former 13-value subset replaced; Timeline/Relationship/Communication/Export reference it.
- **D4 / D13** One authoritative common object-detail tab set in the Object Detail Standard
  (`Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Documents,
  Communications, Audit`); Tabs Standard now references it; the redundant `Activity` tab removed
  (Timeline is the activity history). Files 09, 10.
- **D5** Two distinct principal axes defined in file 03: `ActorType` (performer) and
  `PrincipalType` (referenced principal). `USER` ≠ `EMPLOYEE`. Files 03, 04, 06, 12.

## High
- **D6** Central Enum Registry created (file 14): every enum with owner department + values.
- **D7** Central Permission Registry created (file 15): all `Object.Action` keys.
- **D8** Prefix registry completed (added LED, EMP, ROL, DEP, TEM, QUE, PAY, SVC, SUB, NDV, SIT,
  LOC, VEN, PUR, KBA, CHG, INC, PRB, RLE, CMP); `REL`/`RLE` collision avoided. Files 00, 03.

## Medium
- **D9** `WEBHOOK` removed from notification channels; outbound webhooks deliver events only
  (one outbound-webhook path). Files 05, 12.
- **D10** One canonical `CommunicationChannel` enum (8 values, file 12); the Communications page
  displays a subset (file 11), no separate enum.
- **D11** Escalation to a queue is a move (reassignment), not a second membership — preserves the
  one-queue-membership rule. File 02.
- **D12** One `PrincipalType` superset with documented per-context subsets (Task: no TEAM;
  Watcher/Notification/Mention: no QUEUE). Files 03, 05.
- **D13** Folded into D4 (Activity/Timeline duplication removed).
- **D14** `deletionState` is a separate field/enum from lifecycle `status`; both may hold
  `ACTIVE` as different enum types; flagged for reconciliation with the Global Status Standard.
  File 12.

## Low
- **D15** Comment mention targets normalized to UPPER_SNAKE (`EMPLOYEE, ROLE, DEPARTMENT, TEAM`).
  File 04.
- **D16** Notification stores the triggering `eventId` (Event → Notification trace). File 05.

## Still open (unchanged)
The 7 `SOURCE NOT PROVIDED` standards remain the only blocker to a fully self-contained set.
The Global Status Standard is load-bearing for D14 and every per-object status enum; supply it
to finalize status semantics.

---

# Third patch — deep-audit fixes (E5–E22)

Applied 2026-06-02 after a third deep re-audit of the twice-patched set.

## Critical
- **E5** Canonical `RecipientType`/`ParticipantType` = `EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER`
  defined in file 03; Notification `recipientType` and Communication `participantType` now address
  the external portal principal (Customer Portal strategy satisfied). Files 03, 05, 12.
- **E7** Completed D9: `WEBHOOK` removed from the notification channel-priority order (the enum had
  been fixed but the priority line still listed it). File 05.

## High
- **E13** Event field renamed `eventType` → `eventName` (`<Object>.<Action>`); Audit keeps
  `eventType` as the coarse `AuditEventType` enum; webhook payload/delivery use `eventName`.
  Files 04, 06, 12, 14.
- **E14** Timeline uses the canonical `EventCategory` enum (timeline is a projection); the separate
  10-value timeline-category enum removed; registry `TimelineCategory` now aliases `EventCategory`.
  Files 04, 06, 14.
- **E21** `EventCategory` normalized to UPPER_SNAKE (dropped Title-Case " Event" suffix). File 06, 14.

## Medium
- **E11** `Documents` dropped as a separate object-detail tab; documents are Attachments filtered by
  document categories. Files 09, 10.
- **E15** Auto-watch resolves a non-watchable owner (e.g. `QUEUE`) to a watchable principal (owning
  department) before creating a watcher. File 05.
- **E19** `PageType` enum normalized to UPPER_SNAKE (`WORKSPACE, REGISTRY, …`). Files 10, 14.
- **E20** Design tokens (color tokens, spacing scale, typography roles) declared design identifiers,
  not business enums — exempt from UPPER_SNAKE; registry claim corrected. Files 09, 14.

## Low
- **E18** Base `Navigation Standard` `SOURCE NOT PROVIDED` placeholder added (locked tree remains
  authoritative). File 10.
- **E22** `AuditEventType` extended with `OWNER_CHANGED, DEPARTMENT_CHANGED`. Files 04, 14.

## Category model after E14/E21 (one enum, 16 values)
`LIFECYCLE, STATUS, ASSIGNMENT, OWNERSHIP, APPROVAL, FINANCIAL, COMMENT, ATTACHMENT, COMMUNICATION,
TASK, ESCALATION, NOTIFICATION, AUTOMATION, INTEGRATION, SECURITY, SYSTEM` — used by both Event
System and Activity Timeline.

## Still open (unchanged)
The 7 `SOURCE NOT PROVIDED` standards remain the only blocker to full closure; Global Status is
load-bearing for status semantics and the E13/E14 category/eventName alignment.

---

# Fourth patch — batched standards revision after UUIDv7 cutover (D1, D2)

Applied 2026-06-02 after the Portal UUIDv7 cutover verified green on all 4 gates.

## D1 — Audit ≡ Event: one append-only store, projections
Audit and Activity Timeline are governed **projections** over a single append-only event store
(the physical source of truth), not separate tables. Audit = compliance-relevant slice + audit
fields + before/after; Timeline = chronological view. Immutability enforced at the store
(append-only; deletes rejected for all roles). Matches the deployed design (event table is
append-only by DB trigger, SPEC §0.4). Files 04, 06.

## D2 — Permission keys: lowercase `object.action`
Key format changed from `Object.Action` (PascalCase) to lowercase `object.action`, dot-separated,
object first; multi-word actions use snake_case (`view_internal`, `manage_others`). Matches the
codebase's seeded keys. Case is not load-bearing; shape (object.action, canonical, immutable,
never localized) is. All keys rewritten across the RBAC Standard and Permission Registry.
Files 04, 05, 12, 15.

## Already locked (no spec change — Portal-conformance only)
PageType → UPPER_SNAKE (E19), CommunicationChannel +PORTAL_MESSAGE/SYSTEM_MESSAGE (D10/E),
Lifecycle B5 owner+supporting split (B5) were already in the locked spec. These are Portal-side
conformance items, not spec edits.

## Still open (unchanged)
The 7 SOURCE NOT PROVIDED standards remain the only blocker to full closure.
