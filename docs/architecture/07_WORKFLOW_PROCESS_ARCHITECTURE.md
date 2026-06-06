# 07 — Workflow / Process Architecture

**Constitutional document.** The architecture of workflow orchestration, process automation, approval chains, and SLA management in GAAhex.

The Workflow Core governs *how business objects move through their lifecycles*. The Automation Core reacts to those movements and executes configured actions. The Approval Core manages formal signoff. The SLA Core measures time-based commitments. Together, these four cores form the **Business Execution** tier's primary skeleton.

This document is **implementation-grade** — every pattern, gate type, event contract, and transition rule is code-verifiable against the backend. It sits downstream of the constitutional cores (`01_PLATFORM_CORE_ARCHITECTURE.md`) and upstream of the standards library (`docs/standards/12-final-architecture-standards.md`).

---

## 1. Purpose

Define the architecture of state machines, transitions, guards, gates, automations, approvals, and SLA clocks that control business object lifecycle and trigger operational actions.

Specifically:

- **Workflow Core** owns the state machine definition (WorkflowDefinition), the running instance (WorkflowInstance), transitions, and the rules for allowed movement.
- **Automation Core** owns trigger-condition-action rules that react to workflow events and emit secondary actions.
- **Approval Core** owns approval chains, voting logic, delegation, and signoff evidence.
- **SLA Core** owns time-based commitments, clocks, pause/resume, breach detection, and escalation.

The four cores are deeply coupled in behavior but strictly separated in ownership: a workflow transition may require an approval; an approval may emit an event that triggers an automation; an automation may violate an SLA clock. Each core's responsibility is locked; cross-core integration is explicit.

---

## 2. Scope

In scope:

- WorkflowDefinition entity, status enum, version model, lifecycle.
- State and Transition semantics; gates and their types.
- Transition guards via GXL (Guard eXpression Language); local-field guards now, single-hop cross-record guards in M1 Phase 1.5.
- WorkflowInstance entity and execution semantics.
- TransitionHistory and audit.
- All six gate types and their business meanings.
- Automation rules: Trigger, Condition, Action, idempotency, retry, observability.
- Approval chains: single approver, quorum, unanimous, delegated; SLA on approval; signoff evidence.
- SLA clocks: calendar-aware, pause/resume, breach events, escalation.
- Workflow versioning — instances keep their definition version; switching versions is explicit.
- Stage Owner Department (per Standard 02, B5 rule) — exactly one accountable owner per stage.
- Event emission: all transitions emit `<Object>.<Action>` events with correlationId + causationId.
- Server-side authority: UI, API, automation, import, integration, job cannot bypass.
- Interaction with Time Core for business-hours, holiday, timezone, recurrence rules.

Out of scope:

- Page-level workflow UI implementation (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).
- Notification content and delivery (see `Communication` / `Notification` cores).
- Policy-engine business-rule evaluation (see `08_PERMISSION_ARCHITECTURE.md`, `Policy` core).
- Financial / commerce rules (see `Financial` core).
- Specific domain workflows (Lead, Service, Ticket, etc.) — this document is the kernel; domain workflows are configured instances.

---

## 3. Goals

- **G1** Every business object lifecycle is governed by an explicit, configuration-driven Workflow definition; no lifecycle is hardcoded in UI or service code.
- **G2** A Workflow definition is versionable, reusable across tenants (via configuration), and can be updated without silently altering running instances.
- **G3** All transitions are guarded (via GXL), audited, and emit domain events that trigger automations, notifications, and SLA events.
- **G4** Workflow and Automation are strictly separate: Workflow controls what moves; Automation reacts and acts.
- **G5** Approvals are first-class, composable (single / quorum / unanimous), delegable, and time-bounded by SLA.
- **G6** SLA clocks are calendar-aware, pausable, and emit breach events for escalation.
- **G7** Transition guards can depend on the record's own fields and, via M1 Phase 1.5, a single hop to a linked record (e.g., `account.balance_due == 0`).
- **G8** Every transition is audited and attributed to an actor (USER, SYSTEM, AUTOMATION, INTEGRATION, API); no silent state changes.
- **G9** The Workflow kernel stays small; configuration and events do the heavy lifting.

---

## 4. Non-Goals

- **NG1** This document does NOT implement domain-specific workflows. Workflows are configured in WorkflowDefinition rows; the engine is generic.
- **NG2** This document does NOT define the Entitlement or Financial models (those are separate cores).
- **NG3** This document does NOT replace backend validation; guards supplement validation, not replace it.
- **NG4** This document does NOT handle workflow deployment / version rollout strategies (that's an operational concern).
- **NG5** This document does NOT define notification templates or delivery channels (see Notification Core).

---

## 5. Architecture Principles

### P1 — Workflow is configuration, not code.

A new entity's lifecycle is declared in WorkflowDefinition, not hardcoded in a service class. The killer test is that a second entity can use a wholly configuration-only workflow definition and achieve end-to-end lifecycle movement.

### P2 — Workflow and Automation are separate.

Workflow controls what state changes are allowed (the state machine). Automation reacts to state changes (the event consumer). A transition does not call an automation; instead, the transition emits an event, and the Automation Core subscribes. This decoupling lets workflows stay stable while automations evolve.

### P3 — Transitions are atomic and gated.

A transition from one state to another is a single operation. It either succeeds fully (the state changes, an event is emitted, audit is recorded) or fails completely (the state does not change). Gates enforce pre-conditions (a COMMERCIAL_GATE, TECHNICAL_GATE, etc.). A gate is not a suggestion; it's a guard enforced by the engine.

### P4 — All transitions are audited.

Every state change produces an Event row with correlationId, causationId, actor, and the state change itself. The Event is permanent; the state is mutable. Together they form the truth: the state table is "current state"; the event table is "history of how we got here."

### P5 — Guards are pure functions of state.

A transition guard is a boolean expression (GXL) evaluated against the record's fields and, optionally, one linked record's fields. Guards have no side effects, no external calls, no non-determinism. Guards are fail-closed: a broken or missing guard is treated as "not satisfied."

### P6 — Actors are explicit.

Every transition attributes itself to an actor: USER (authenticated human), SYSTEM (internal process), AUTOMATION (configured rule), INTEGRATION (external system), API (first-party API). The actor determines which field-level restrictions apply and what audit context is recorded.

### P7 — Stage ownership is explicit.

Every stage in a workflow has exactly one accountable Owner Department (per Standard 02, B5 rule). Supporting departments contribute; only one owns. The stage owner appears in the timeline and SLA records.

### P8 — Approvals are time-bounded.

An Approval created by a workflow has an SLA (via Approval Core + SLA Core). A breach emits an escalation event. Approval SLA is tracked separately from the main object's SLA (a ticket may have a 24h resolution SLA; its approval may have a 2h approval SLA).

---

## 6. Architecture Laws

These are non-negotiable. Violation is grounds for design rejection.

### L1 — One state machine per workflow definition

A WorkflowDefinition owns exactly one state machine (the graph of states and transitions). You may not define multiple conflicting state machines for the same entity. (You *may* define different workflows for different object types or different tenants.)

### L2 — Transitions are the only way to move state

No UPDATE statement on the base table bypasses the workflow engine. All state changes route through a Workflow transition handler or an explicit workflow API. The engine is the gatekeeper.

### L3 — No hardcoded status values outside Workflow Core

A Service object does not have `status` values scattered across three different service modules. All status enums are registered in WorkflowDefinition.stages and are owned by Workflow Core. A status value is a machine-readable string (`ACTIVE`, `SUSPENDED`, etc.); localized labels are UI-only.

### L4 — Gates are never bypassed

A COMMERCIAL_GATE, TECHNICAL_GATE, SERVICE_GATE, OPERATIONAL_GATE, APPROVAL_GATE, COMPLIANCE_GATE, or MANUAL_REVIEW_GATE on a transition is enforced server-side. No UI-only gate. No automation-only gate. The engine checks the gate; if the gate refuses, the transition does not move.

### L5 — Approval gates are Approval Core events, not inline workflows

When a transition requires an approval, the transition itself does not perform the approval. Instead, the transition moves the object to a "pending approval" stage, emits an ApprovalRequested event, and the Approval Core creates an ApprovalRequest. Only when the ApprovalRequest is resolved (approved/rejected) does a subsequent transition fire to move to the next stage.

### L6 — Every transition is audited via an Event

A successful transition emits a `<Object>.<Action>` event (e.g., `Service.Activated`). A failed transition emits a `<Object>.TransitionRejected` event with the guard failure reason. An automation-triggered transition emits the same event shape as a user-triggered one. The actor field distinguishes them.

### L7 — Workflow definitions are immutable after version seal

A WorkflowDefinition is created in DRAFT status, tested, and moved to ACTIVE. Once ACTIVE, the definition row is immutable; changes create a new version. Existing running instances keep their definition version. A schema migration explicitly moves instances to a new version if required.

### L8 — Guards are synchronous and cached

A guard expression is evaluated at transition time, synchronously. If the guard references a linked record (e.g., `account.balance_due == 0`), the resolver pre-fetches the linked record once per evaluation and caches it in memory (no N+1 queries). The pre-fetch respects tenant isolation (RLS).

### L9 — SLA clocks are time-authoritative via Time Core

An SLA clock's "dueAt" is calculated by Time Core. All business-hours, holiday, timezone, and recurrence logic is delegated to Time Core. An SLA Core instance never does its own date math.

### L10 — Idempotency is per-action

An Automation Action is idempotent: if the action runs twice with the same inputs, the side effects occur only once (deduplicated by idempotencyKey). The engine enforces idempotency at the action level; the action handler must be designed to accept this contract.

### L11 — Workflow events are permanent

Once an Event is written, it is never edited, deleted, or reordered. Corrections are new events (e.g., `Invoice.PaymentReversed`). The event stream is the immutable record of what happened; the state table is the current snapshot. Together they tell the story.

### L12 — All cross-core invocations are event-driven

Workflow Core does not synchronously call Approval Core, Notification Core, or Analytics Core. Instead, transitions emit events; downstream cores subscribe. The exception is Time Core, which is synchronously consulted for calendar rules (and is a FOUNDATION tier core — always OK to depend on).

---

## 7. Core Concepts

### 7.1 Workflow Definition

A row in the `workflow_def` table. Immutable after ACTIVE status. Fields:

- `id` (UUIDv7, reference prefix `WFL`)
- `referenceNumber` (e.g., `WFL-20260604-001`)
- `workflowKey` (e.g., `service_lifecycle` — tenant-scoped, unique)
- `workflowName` (e.g., "Service Lifecycle" — localized label)
- `objectType` (enum — which entity this workflow governs: `Service`, `Ticket`, `Lead`, etc.)
- `tenantId` (which tenant owns this definition)
- `version` (integer, auto-incremented on state change)
- `status` (enum: `DRAFT`, `ACTIVE`, `DEPRECATED`, `RETIRED`)
- `stages` (list of state identifiers, e.g., `["PENDING", "PROVISIONING", "ACTIVE"]`)
- `transitions` (list of from/to pairs, each with guard, gates, required actions, approval rules)
- `gates` (list of gate definitions: type, condition, failure message)
- `entryConditions` (optional guard for workflow instantiation)
- `exitConditions` (optional: conditions that terminate the workflow)
- `allowedActors` (enum list: which ActorType values can trigger transitions)
- `requiredPermissions` (permission keys required to trigger transitions)
- `slaRules` (list of SLA definitions keyed to stages or transitions)
- `automationHooks` (list of events that trigger Automation rules)
- `approvalHooks` (list of transitions that require approvals)
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`

Status enum: `DRAFT` (editable, not live) → `ACTIVE` (live, immutable) → `DEPRECATED` (not accepting new instances) → `RETIRED` (removed from registry).

### 7.2 Workflow Instance

A row in the `workflow_instance` table. The runtime execution of a workflow. Fields:

- `id` (UUIDv7)
- `workflowKey` (references the definition)
- `objectType`, `objectId` (what entity this instance is running on)
- `tenantId`
- `version` (the version of the definition it was instantiated from)
- `status` (enum: `RUNNING`, `COMPLETED`, `FAILED`, `ESCALATED`, `CANCELLED`)
- `currentStage` (the current state; e.g., `PROVISIONING`)
- `previousStage` (the prior state before the last transition)
- `triggeredAt`, `completedAt`, `failedAt`
- `triggeredBy` (the record that fired the workflow, e.g., a lead id)
- `actorUserId`, `actorType` (who triggered it — USER, SYSTEM, AUTOMATION, etc.)
- `context` (JSONB snapshot of inputs and accumulated action results)
- `currentActionIndex` (when running, which action in the definition's actions_spec list is executing)
- `failureReason` (if FAILED or ESCALATED, why)

Status enum:
- `RUNNING`: instance is in motion.
- `COMPLETED`: workflow reached a terminal state successfully (all transitions done, no more state changes).
- `FAILED`: a transition action failed and the definition's failure_action was not `audit_only`.
- `ESCALATED`: an action failure triggered escalation (failure_action was `escalate`).
- `CANCELLED`: the workflow was explicitly cancelled by a user or system process.

### 7.3 State and Transition

A **State** is a named value representing where an object stands in its lifecycle (e.g., `PENDING`, `ACTIVE`, `SUSPENDED`). A **Transition** is a directed edge from one state to another, with optional guards, gates, required approval, and side-effect actions.

Transition structure (per WorkflowDefinition.transitions list):

```
{
  "from": "PENDING",
  "to": "PROVISIONING",
  "name": "Begin provisioning",
  "guard": "service.type != 'TEMPORARY'",  // GXL expression
  "gates": ["TECHNICAL_GATE", "SERVICE_GATE"],
  "requiredPermission": "service.activate",
  "requiredApproval": {
    "type": "SINGLE_APPROVER",  // or QUORUM, UNANIMOUS, DELEGATED
    "approvers": ["role:provisioning_manager"],
    "slaHours": 2
  },
  "actions": [
    {"type": "emit_notification", "template": "provision_start"},
    {"type": "set_field", "field": "provisioningStartedAt", "value": "now()"},
    {"type": "create_task", "template": "dispatch_technician"}
  ],
  "failureAction": "escalate",  // or audit_only, retry, rollback
  "slaSeconds": 86400,  // 1 day, optional per-transition SLA override
  "ownerDepartment": "TECHNICAL_DEPARTMENT",  // B5 rule: exactly one owner
  "emitEvent": true,  // always true; explicit for clarity
  "eventName": "Service.ProvisioningStarted",  // auto-generated if not supplied
  "category": "STATUS"  // EventCategory enum
}
```

### 7.4 Gate Types

A **Gate** is a pre-condition enforcement point. Six types are canonical:

1. **COMMERCIAL_GATE**: financial, pricing, compliance, budget, approval prerequisites. Example: "May not activate a Service without a signed Contract."
2. **TECHNICAL_GATE**: feasibility, capacity, infrastructure readiness, network availability. Example: "OLT must have available capacity."
3. **SERVICE_GATE**: installation completion, billing readiness, activation prerequisites. Example: "May not move to MONITORING until payment confirmed."
4. **OPERATIONAL_GATE**: SLA, quality, incidents, audits, satisfaction checks. Example: "May not archive a Ticket with open related Tasks."
5. **APPROVAL_GATE**: formal signoff is required. Example: "Manager approval required before escalation."
6. **COMPLIANCE_GATE**: regulatory, retention, consent, data-subject rights. Example: "Privacy consent required before sending communications."
7. **MANUAL_REVIEW_GATE**: a human must explicitly review and approve before moving. Example: "High-value orders require manual ops review."

Gates are evaluated in order; if any gate fails, the transition is rejected with a 409 Conflict response. The gate failure reason is logged as a `<Object>.TransitionRejected` event.

### 7.5 Guard (GXL)

A **Guard** is a boolean expression (Guard eXpression Language) that gates whether a transition is allowed. Today's guards resolve against:

- Local fields on the record being transitioned (`status`, `priority`, custom fields).
- Transition context (`from`, `to`, `at`, `actorType`, `actorId`).
- Boolean operators: `==`, `!=`, `>`, `<`, `>=`, `<=`, `&&`, `||`, `!`.
- Literals: strings, numbers, booleans, null.

**M1 Phase 1.5 addition:** single-hop cross-record field resolution via `<ref_field>.<linked_field>` syntax (e.g., `account.balance_due == 0`). The resolver pre-fetches the linked record once per evaluation and caches it in memory. Multi-hop (e.g., `account.holder.name`) is forbidden. Aggregates are forbidden. Side-effect functions are forbidden.

Guards are fail-closed: a broken guard is treated as "not satisfied." Missing fields resolve to null.

Authorship: local-field guards require the entity's `config.manage` permission. Cross-record guards (M1 Phase 1.5) require `super_admin` scope.

### 7.6 Automation Rule

An **Automation Rule** is a trigger-condition-action rule that reacts to workflow events. Structure:

```
{
  "id": "aut-...",
  "tenantId": "...",
  "name": "Notify provisioning on service activation",
  "trigger": {
    "eventName": "Service.Activated",  // which event fires this rule
    "eventCategory": "STATUS"
  },
  "condition": {
    "expression": "service.type == 'BROADBAND'"  // optional filter
  },
  "actions": [
    {
      "type": "send_notification",
      "template": "activation_notification",
      "recipients": "role:provisioning_manager"
    },
    {
      "type": "create_task",
      "name": "Begin monitoring",
      "assignedTo": "department:noc"
    }
  ],
  "retryPolicy": {
    "maxRetries": 3,
    "backoffSeconds": 60
  },
  "idempotencyKey": "{{ event.id }}",  // dedup across retries
  "status": "ACTIVE"
}
```

Automation rules are evaluated asynchronously (via Background Processing Core's queue). A failed action is logged and retried per retryPolicy. Exhausted retries produce a `AutomationExecution.Failed` event.

Automation actions are constrained to:
- Send notifications (via Notification Core).
- Create/update tasks (via Work Core).
- Update fields on the same object (via generic PATCH).
- Call integration webhooks (via Integration Core).
- Emit secondary events (via Event Core).

**Forbidden:** automation actions may NOT trigger other automations (prevent cascading loops) or bypass workflow gates.

### 7.7 Approval Request and Chain

An **Approval Request** is created when a transition has a `requiredApproval` rule. Structure:

```
{
  "id": "apr-...",
  "tenantId": "...",
  "objectType": "Ticket",
  "objectId": "tick-...",
  "status": "PENDING",  // PENDING, APPROVED, REJECTED, WITHDRAWN, DELEGATED, EXPIRED
  "type": "SINGLE_APPROVER",  // SINGLE_APPROVER, QUORUM, UNANIMOUS, DELEGATED
  "approvers": [
    {"principalId": "role:manager", "status": "PENDING", "respondedAt": null},
    {"principalId": "user:...", "status": "PENDING", "respondedAt": null}
  ],
  "quorumSize": 1,  // for QUORUM type: how many must approve
  "requiredVotes": "UNANIMOUS",  // for UNANIMOUS: all must approve
  "requestedAt": "2026-06-06T10:00:00Z",
  "dueAt": "2026-06-06T12:00:00Z",  // 2-hour SLA
  "respondedAt": null,
  "approvedAt": null,
  "rejectedAt": null,
  "rejectionReason": null,
  "signoffEvidence": [
    {
      "approver": "user:alice",
      "decision": "APPROVED",
      "timestamp": "2026-06-06T10:15:00Z",
      "comment": "Looks good"
    }
  ],
  "slaClock": {
    "id": "sla-...",
    "status": "ON_TRACK",  // ON_TRACK, AT_RISK, BREACHED
    "breachedAt": null
  }
}
```

Approval types:

- **SINGLE_APPROVER**: one specified approver must approve. Rejection blocks the transition.
- **QUORUM**: at least N approvers must approve (quorumSize). Rejection blocks the transition.
- **UNANIMOUS**: all specified approvers must approve. Single rejection blocks the transition.
- **DELEGATED**: an approver may delegate to another; the delegate's decision counts.

Approval SLA: an ApprovalRequest has its own SLA clock (via SLA Core). A breach emits an `Approval.SLABreached` event, which may trigger an escalation automation. An expired approval is withdrawn; the transition remains blocked.

Signoff Evidence: every approval decision (approve/reject/delegate) is recorded with timestamp, approver, and optional comment. This evidence is permanent and auditable.

### 7.8 SLA Clock

An **SLA Clock** measures time against a commitment. Structure:

```
{
  "id": "sla-...",
  "slaPolicyId": "...",  // references the SLA policy definition
  "objectType": "Ticket",
  "objectId": "tick-...",
  "tenantId": "...",
  "status": "ON_TRACK",  // ON_TRACK, AT_RISK, PAUSED, BREACHED, COMPLETED, CANCELLED
  "startedAt": "2026-06-06T09:00:00Z",
  "dueAt": "2026-06-07T09:00:00Z",  // 24h business hours
  "pausedAt": null,
  "pauseReason": null,  // enum: WAITING_CUSTOMER, WAITING_EXTERNAL_PARTY, WAITING_APPROVAL, WAITING_PARTS, SCHEDULED_APPOINTMENT, DEPENDENCY_BLOCKED
  "resumedAt": null,
  "breachedAt": null,
  "completedAt": null,
  "ownerDepartment": "SUPPORT",  // B5 rule: one accountable owner
  "primaryAssignee": "user:bob",
  "priority": "HIGH",
  "calendarId": "calendar-business-hours",  // via Time Core
  "timezone": "Asia/Yerevan",  // via Time Core
  "correlationId": "cor-...",
  "pauseHistory": [
    {"pausedAt": "...", "resumedAt": "...", "reason": "WAITING_CUSTOMER", "durationSeconds": 3600}
  ]
}
```

SLA Status:

- `ON_TRACK`: dueAt is in the future and no pause is active.
- `AT_RISK`: less than 10% of the SLA window remains before dueAt.
- `PAUSED`: dueAt is frozen; no time elapses until resumed.
- `BREACHED`: dueAt has passed and status has not reached a terminal state.
- `COMPLETED`: the object reached a terminal state before dueAt.
- `CANCELLED`: the SLA was explicitly cancelled.

Pause reasons are canonical and must be one of the enum values; free-text pause reasons are forbidden. Pause/resume create events + audit entries.

Time calculation is delegated to Time Core. The SLA clock specifies a `calendarId` (business-hours calendar) and `timezone`; Time Core computes dueAt by adding the SLA duration to the start, respecting the calendar's business hours and holidays.

Breach detection runs periodically (via Background Processing Core). On breach, an `SLA.Breached` event is emitted, which may trigger an escalation automation.

### 7.9 Event Contract

Every workflow transition (successful or failed) emits an Event. Standard shape:

```
{
  "id": "evt-...",  // UUIDv7
  "referenceNumber": "EVT-000001",
  "tenantId": "...",
  "eventName": "Service.Activated",  // <Object>.<Action>, PascalCase
  "category": "STATUS",  // EventCategory enum
  "schemaVersion": "1.0",
  "occurredAt": "2026-06-06T10:00:00Z",  // UTC, millisecond precision
  "objectType": "Service",
  "objectId": "svc-...",
  "actorType": "USER",  // USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER
  "actorId": "user-...",
  "department": "NOC",
  "visibility": "INTERNAL",  // PUBLIC, INTERNAL, RESTRICTED, SYSTEM
  "correlationId": "cor-...",  // all events in one business process share this
  "causationId": "evt-previous",  // the event that triggered this one
  "payload": {
    "from": "PROVISIONING",
    "to": "ACTIVE",
    "guardExpression": "service.type != 'TEMPORARY'",
    "guardResult": true,
    "appliedGates": ["TECHNICAL_GATE", "SERVICE_GATE"],
    "gateResults": {"TECHNICAL_GATE": true, "SERVICE_GATE": true},
    "approvalRequired": true,
    "approvalId": "apr-...",
    "transitionDurationMs": 245,
    "actionsExecuted": [
      {"action": "emit_notification", "result": "SUCCESS"},
      {"action": "set_field", "result": "SUCCESS"},
      {"action": "create_task", "result": "SUCCESS"}
    ]
  }
}
```

If a transition is **rejected** (guard fails or gate fails), the event is named `<Object>.TransitionRejected` with the failure reason in the payload.

If a transition is **escalated** (action fails and failure_action='escalate'), the event is `<Object>.Escalated` with the action failure reason.

Events are immutable once written. Corrections are new events.

---

## 8. Canonical Entities

Per the Platform Reference Model and Standard 12:

### Workflow Tier

- **WorkflowDefinition** — the state machine definition (immutable after ACTIVE)
- **WorkflowInstance** — a running instance of a workflow
- **TransitionHistory** — audit trail of all transitions on all instances (derived from Event table)
- **State** — logical concept, not a separate table (values in WorkflowDefinition.stages)
- **Transition** — logical concept, not a separate table (values in WorkflowDefinition.transitions)

### Automation Tier

- **AutomationRule** — the trigger-condition-action rule
- **AutomationExecution** — one run of an automation rule (success or failure)
- **AutomationAction** — a single action within an execution

### Approval Tier

- **ApprovalRequest** — a formal signoff request
- **ApprovalChain** — the list of approvers for one request
- **ApprovalDecision** — one approver's decision (approved/rejected/delegated)
- **ApprovalSignoffEvidence** — immutable record of signoff (timestamp, approver, decision, comment)

### SLA Tier

- **SLADefinition** — the policy (response time, resolution time, etc.)
- **SlaClock** — a running instance of an SLA
- **SLAPause** — a pause/resume event on an SLA clock
- **SLABreach** — a record that the SLA was breached
- **EscalationTrigger** — automated action when an SLA is breached

---

## 9. Ownership Boundaries

### Workflow Core owns:

- WorkflowDefinition (the state machine).
- WorkflowInstance (the running lifecycle).
- State and Transition semantics.
- GXL guards (parsing and evaluation).
- Gate enforcement.
- TransitionHistory (the audit projection over Events).
- Event emission on all transitions.

### Automation Core owns:

- AutomationRule (trigger-condition-action).
- AutomationExecution (the run).
- Condition evaluation and action dispatch.
- Idempotency deduplication.
- Retry policy.

### Approval Core owns:

- ApprovalRequest (the signoff record).
- ApprovalChain (the list of approvers).
- ApprovalDecision (voting and outcomes).
- Delegation logic.
- Signoff evidence (immutable audit trail).

### SLA Core owns:

- SLADefinition (the policy).
- SlaClock (the running instance).
- Pause/resume logic (with reason enum enforcement).
- Breach detection.
- Escalation trigger creation.

### Workflow Core does NOT own:

- Automation execution (owned by Automation Core).
- Approval decisions (owned by Approval Core).
- SLA calculation or breach detection (owned by SLA Core).
- Notification content or delivery (owned by Communication / Notification cores).
- Time and calendar rules (owned by Time Core).

### Supporting-core dependencies:

- Workflow Core depends on **Time Core** for calendar-aware SLA calculations.
- Automation Core depends on **Event Core** for triggering and **Background Processing Core** for async execution.
- Approval Core depends on **SLA Core** for approval SLAs.
- SLA Core depends on **Time Core** for business-hours and holiday calendars.
- All four depend on **Audit Core** for immutable event storage.
- All four depend on **Permission Core** for authorization.
- All four depend on **Tenant Core** for isolation.

---

## 10. Relationships

### 10.1 Within the Workflow tier

```
WorkflowDefinition
  ├─ version (auto-incremented)
  ├─ status (DRAFT → ACTIVE → DEPRECATED → RETIRED)
  ├─ stages (list of state identifiers)
  ├─ transitions (list of Transition objects)
  └─ WorkflowInstance
       ├─ currentStage (which state now)
       ├─ previousStage (where it came from)
       └─ Event (one Event per state change, linked by causationId)
```

### 10.2 Automation → Workflow

```
Event (emitted by Workflow transition)
  └─ triggers
       └─ AutomationRule (via eventName matching)
             └─ AutomationExecution (one run)
                  └─ AutomationAction (side effects)
                       └─ may emit secondary Event (but cannot trigger automations — prevent loops)
```

### 10.3 Approval ↔ Workflow

```
WorkflowDefinition.transitions[].requiredApproval
  └─ ApprovalRequest (created when transition is attempted)
       └─ ApprovalChain (list of approvers)
             └─ ApprovalDecision (per approver)
                  └─ ApprovalSignoffEvidence (immutable)
                       └─ Event (Approval.Approved or Approval.Rejected)
```

A transition with a required approval:
1. Moves the object to a "pending approval" stage (e.g., `PENDING_MANAGER_APPROVAL`).
2. Emits an `ApprovalRequested` event.
3. Approval Core creates an ApprovalRequest.
4. Once approved, a subsequent transition (e.g., `PENDING_MANAGER_APPROVAL → ACTIVE`) is unblocked.
5. If rejected, the object may revert to a prior stage or stay pending (per definition).

### 10.4 SLA ↔ Workflow

```
WorkflowInstance
  └─ SlaClock (multiple possible — one per SLA policy)
       ├─ triggered on entry to certain stages
       └─ completed / breached on transition to terminal states

Approval
  └─ SlaClock (approval-specific SLA, separate from main SLA)
```

An SLA definition specifies which stages trigger a clock. Example: entering `PROVISIONING` starts a 24-hour SLA; entering `ACTIVE` completes it.

### 10.5 Escalation

```
SlaClock (breached)
  └─ Event: SLA.Breached
       └─ triggers
            └─ AutomationRule (escalation automation)
                 └─ AutomationAction (e.g., escalate Ticket to manager, send alert)
```

---

## 11. Responsibilities

### Workflow Core

- Enforce state machines: only allow transitions defined in WorkflowDefinition.
- Evaluate guards synchronously at transition time; reject transitions if guards fail.
- Check gates; reject if any gate fails.
- Emit events on transition (success or failure).
- Version workflow definitions; preserve instance versions on updates.
- Provide the generic `/api/v1/{entitySlug}/{id}/transition` endpoint.
- Audit all transitions via Event rows.
- Delegate SLA calculation to Time Core.
- Delegate approval creation to Approval Core.
- Delegate automation triggering to Event Core subscribers.

### Automation Core

- Subscribe to events (via Event Core).
- Evaluate conditions against the event payload and object context.
- Execute actions (async, via Background Processing Core).
- Implement idempotency per action (deduplicate by idempotencyKey).
- Retry failed actions per retryPolicy.
- Emit AutomationExecution events.
- Emit secondary events (but NOT trigger other automations — prevent loops).

### Approval Core

- Create ApprovalRequest on workflow transition that requires approval.
- Manage the approver list (single, quorum, unanimous, delegated).
- Track approver decisions and voting logic.
- Implement delegation: an approver can delegate to another; the delegate's vote counts.
- Record signoff evidence (immutable).
- Create ApprovalSLA clocks and monitor SLA breaches.
- Emit ApprovalApproved, ApprovalRejected, ApprovalDelegated, Approval.SLABreached events.
- Provide UI and API for approvers to respond.

### SLA Core

- Define SLA policies (by object type and stage).
- Create SlaClock instances at stage transitions.
- Compute dueAt via Time Core (respecting calendar, timezone, SLA duration).
- Track pause/resume with reason enum enforcement.
- Detect breaches and emit SLA.Breached events.
- Expose SLA metrics for reporting and dashboards.
- Handle legal hold and retention blocking on purge-eligible records.

### Time Core (supporting)

- Provide calendar definitions (business hours, holidays).
- Compute adjusted durations (skipping non-business hours, holidays).
- Provide timezone management.
- Provide recurrence rules (for automation scheduling).

### Event Core (supporting)

- Store all workflow, automation, approval, and SLA events as immutable Event rows.
- Provide event subscriptions (for automation triggering).
- Emit domain events (via the app.workflow.emit helper).
- Guarantee causationId chaining across a business process.

---

## 12. Allowed Patterns

### AP1 — Multi-stage workflows with optional stages

A workflow may define branches: a transition from one state may go to one of several next states based on guard evaluation. Example:

```
PENDING → ACTIVATED (if approved)
PENDING → REJECTED (if not approved)
```

Both transitions are valid; guard evaluation determines which branch the instance takes.

### AP2 — Nested automations via events

An automation action emits a secondary event (e.g., `create_task` emits a `Task.Created` event). That event may be subscribed to by another automation rule, creating a chain. The chain is explicit in the rule definitions; looping is prevented by disallowing automation-triggered automations. (An automation may trigger a workflow transition, but that transition must be explicit and guard-checked.)

### AP3 — Approval chains with mixed types

An approval may be QUORUM(2 of 3 managers) where one manager delegates to another. The delegate's vote counts toward the quorum. Delegation is transparent to the chain logic.

### AP4 — SLA pauses for external wait

When an object is waiting for a customer to respond (or external party, or parts), the SLA is paused with reason `WAITING_CUSTOMER` (or `WAITING_EXTERNAL_PARTY`, etc.). The pause is explicit; time does not elapse. Once the wait is resolved, the SLA is resumed and time resumes.

### AP5 — Workflow versioning without instance migration

A WorkflowDefinition is updated to `DRAFT`, modified, and moved to a new version (ACTIVE). Existing running WorkflowInstance rows keep their original version. They run to completion on the old definition. New instances use the new definition. Explicit migration (moving an instance to a new version) is a separate, audited operation.

### AP6 — Cross-record guards with caching

A guard expression like `account.balance_due == 0 && account.status == 'ACTIVE'` references two fields on the same linked account. The resolver fetches the account once and reuses it for both field resolutions (no N+1).

### AP7 — Escalation automations

A workflow defines an SLA. When the SLA breaches, an `SLA.Breached` event is emitted. An escalation automation subscribes to that event and creates a task, escalates to a manager, or sends an alert. The escalation is configured outside the workflow; the workflow only needs to define the SLA.

### AP8 — Theater approval (multi-stage approval)

A workflow defines multiple transitions with approval gates:
- Stage 1: PENDING → UNDER_REVIEW (single manager approval)
- Stage 2: UNDER_REVIEW → APPROVED (director approval)

Each transition has its own ApprovalRequest. Voting is sequential (stage 1 must complete before stage 2 begins). The workflow engine orchestrates the stages; Approval Core handles the voting.

---

## 13. Forbidden Patterns

### FP1 — Hardcoded status values

No service module defines `Service.status` enum values locally. All status values are registered in WorkflowDefinition.stages.

### FP2 — UI-only gates

A transition may not be blocked only in the UI. If a gate is required, it is enforced in the engine. The UI may show the gate status; the backend enforces it.

### FP3 — Automation-triggered automation

An automation action may NOT trigger another automation rule. Automation → Event → (optional second automation), but no direct call from one rule to another. Prevents runaway loop scenarios.

### FP4 — Guard with side effects

A guard expression may NOT call `now()`, `random()`, `http_get()`, or any side-effect function. Guards are pure functions of state; evaluated at transition time; fail-closed if broken.

### FP5 — Multi-hop cross-record guards

A guard may reference at most one linked record via one dot. `account.balance_due` is OK; `account.holder.name` (two hops) is forbidden.

### FP6 — Aggregate guards

A guard may NOT use `count(services)`, `sum(invoices)`, or any collection aggregate. Guards read exactly one record (the main object) and optionally one linked record (single-hop).

### FP7 — Bypassing gates via automation

An automation action may NOT re-trigger the same transition to bypass a gate. If a transition is gated, the gate applies whether a user or an automation triggers it.

### FP8 — Mutable workflow definitions

A WorkflowDefinition in ACTIVE status is immutable. Changes create a new version. No in-place edits to an active definition.

### FP9 — Approval without approval request

A transition may not mark an object "approved" in the object's state; instead, it moves to a "pending approval" stage and an ApprovalRequest is created. The transition is complete once the approval is resolved.

### FP10 — SLA without Time Core

SLA dueAt is never computed locally. Every SLA delegates its calendar and time calculation to Time Core.

### FP11 — Silent state changes

No state change occurs without an Event being emitted. State = mutable; Event = immutable history.

### FP12 — Cross-tenant state changes

A workflow instance may only transition objects in its own tenant. RLS enforces this; no cross-tenant transition is possible.

---

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership definitions; Workflow, Automation, Approval, SLA cores. |
| `PLATFORM_REFERENCE_MODEL.md` | Core definitions and status. |
| `11_EVENT_ARCHITECTURE.md` | Event contract, causationId chaining, immutability. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys for transitions; actor types. |
| `14_TENANT_ARCHITECTURE.md` | Tenant isolation on workflow instances and events. |
| `standards/12-final-architecture-standards.md` | Workflow Engine Standard (LOCKED), SLA Standard (LOCKED). |
| `standards/06-event-automation-integration-standards.md` | Event System Standard (LOCKED), Automation Standard (LOCKED). |
| Backend: `app/kernel/workflow_engine.py` | Workflow execution engine. |
| Backend: `app/gxl.py` | Guard expression language parser and evaluator. |
| Backend: `app/models.py` | WorkflowDef, WorkflowInstance, Event, ApprovalRequest, SlaClock entities. |

| Documents that depend on this one |
|---|
| `02_DOMAIN_ARCHITECTURE.md` (domains assemble workflow-driven entities) |
| `03_INFORMATION_ARCHITECTURE.md` (entities owned by Workflow Core) |
| `04_NAVIGATION_ARCHITECTURE.md` (navigation reflects workflow stages) |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (UI surfaces workflow transitions) |
| `09_DATA_ARCHITECTURE.md` (workflow entity schema) |
| `10_API_ARCHITECTURE.md` (transition endpoint API) |
| `15_REPORTING_ARCHITECTURE.md` (SLA reporting, workflow metrics) |
| `16_ANALYTICS_ARCHITECTURE.md` (workflow analytics, stage duration KPIs) |
| `18_OBSERVABILITY_ARCHITECTURE.md` (workflow observability, transition latency) |

---

## 15. Implementation Requirements

### 15.1 Workflow engine registration

The `WorkflowEngine` is registered as a singleton in the backend's DI container and is the sole handler for:

- WorkflowDefinition creation, update, and status transitions.
- WorkflowInstance creation and state progression.
- Transition evaluation (guard, gate, action execution).
- Event emission via `app.workflow.emit` helper.

### 15.2 Guard language (GXL) specification

The `app.gxl.py` module provides `evaluate(expr: str, context: dict) -> bool`. Implementation:

- Parser rejects identifiers with more than one dot (multi-hop guards forbidden).
- Parser rejects aggregate functions (count, sum, any, all).
- Parser rejects side-effect functions (now, random, uuid, http_get, etc.).
- Parser rejects SQL-injectable identifier names (allowed: alphanumeric + underscore).
- Evaluator resolves local fields from the record being transitioned.
- Evaluator resolves cross-record fields via one pre-fetch query per linked record (cached in memory).
- Evaluator is fail-closed: a broken guard is treated as "not satisfied."

### 15.3 Event emission contract

Every workflow transition (success or failure) emits at least one Event row via `app.workflow.emit(...)`:

- Successful transition: `<Object>.<Action>` event with `category=STATUS` and full payload.
- Guard rejection: `<Object>.TransitionRejected` event with rejection reason.
- Gate rejection: `<Object>.TransitionRejected` event with gate name and reason.
- Action failure (escalate): `<Object>.Escalated` event with action failure reason.

Events are written to the immutable Event table; correlation and causation IDs are threaded through the entire process.

### 15.4 Automation rule execution

The `AutomationEngine` (part of Background Processing Core) subscribes to all events:

- When an event is published, matching AutomationRule(s) are fetched from the database.
- Each rule's condition is evaluated (GXL, same fail-closed semantics).
- If condition passes, actions are queued for async execution.
- Each action is idempotent (deduplicated by idempotencyKey).
- Failed actions are retried per retryPolicy; exhausted retries produce an AutomationExecution.Failed event.

### 15.5 Approval API and workflow integration

The Approval Core provides:

- `POST /api/v1/approvals` — create an approval request (called by Workflow Core on transition).
- `PATCH /api/v1/approvals/{id}/approve` — approver votes approve.
- `PATCH /api/v1/approvals/{id}/reject` — approver votes reject.
- `PATCH /api/v1/approvals/{id}/delegate` — approver delegates to another.
- Webhook or event subscription for completed approvals (when voting is complete, an event is emitted that unblocks the waiting workflow transition).

### 15.6 SLA execution and monitoring

The SLA Core provides:

- `POST /api/v1/slas` — create an SLA clock (called on stage entry).
- `PATCH /api/v1/slas/{id}/pause` — pause with reason enum.
- `PATCH /api/v1/slas/{id}/resume` — resume (verifies pause_reason before allowing).
- Scheduled job (via Background Processing Core) to detect breaches and emit SLA.Breached events.
- SLA metrics available via `GET /api/v1/slas/metrics` for dashboards.

### 15.7 Test requirements

- Unit tests for GXL parser (valid expressions, rejection of forbidden patterns).
- Unit tests for guard evaluation (local fields, linked fields, null handling, caching).
- Unit tests for Workflow engine (transition success, guard failure, gate failure, action failure modes).
- Integration tests for full workflow (lead → validation → deal → contract → order → provisioning → activation).
- Integration tests for approvals (single approver, quorum, unanimous, delegation, SLA breach).
- Integration tests for automations (event subscription, condition evaluation, action execution, idempotency, retry).
- Integration tests for SLA (clock creation, pause/resume, breach detection, escalation).
- RLS tests for automation and SLA (ensure tenant isolation on cross-record guard pre-fetch).

### 15.8 Migration requirements

- Schema: add `workflow_def`, `workflow_instance`, `automation_rule`, `approval_request`, `approval_chain`, `approval_decision`, `sla_definition`, `sla_clock` tables (per `09_DATA_ARCHITECTURE.md`).
- Data: seed workflow definitions for canonical entities (Service, Ticket, Lead, etc.) in DRAFT status.
- Legacy entity-lifecycle transitions (if any pre-exist) are mapped to WorkflowDefinition rows in a migration script.
- Existing state values on objects are grandfathered in (no forced migration).

### 15.9 Studio configuration interface

The Studio Workflows pane allows users to:

- Create/edit WorkflowDefinition (DRAFT).
- Define stages (list of state identifiers).
- Define transitions (from/to, guard expression, gates, approval rules, actions).
- Write guard expressions (via GXL parser validation server-side).
- Define automations (trigger events, conditions, actions).
- Define SLA policies (by stage, duration, calendar).
- Move workflow to ACTIVE status (immutable from then on).
- View running instances (status, current stage, SLA status, approval status).

Cross-record guard authorship (via M1 Phase 1.5) is restricted to super_admin scope; the UI shows a permission-denied message to non-admins attempting to save a guard with a dot.

---

## 16. Future Expansion Rules

### 16.1 New gate types

If a new gate type is needed (e.g., FINANCIAL_GATE, CUSTOMER_GATE), a new sealed baseline amendment adds it to the canonical list and updates the engine's gate-evaluation logic. The new gate name is registered and documented as a constant in the code.

### 16.2 Workflow sub-processes

If a transition needs to spawn a sub-workflow (a complex action decomposed into its own workflow), that's a new workflow definition with a separate WorkflowInstance. The parent transition may emit an event that triggers the sub-workflow as an automation. Chaining is explicit via events; no direct nesting.

### 16.3 Conditional branching

If a transition should choose its target state based on a condition (not just guard-accept/reject), that's handled via multiple transitions from the same source state, each with a guard that evaluates the condition. Guard evaluation is ordered; the first guard that passes determines the branch.

### 16.4 Workflow-to-workflow handoff

If object X transitions through states and then "hands off" to object Y (e.g., a Service hands off to a Ticket on incident), that's two separate workflows linked via an Event (Service.EscalatedToTicket event). Ticket's workflow is independent.

### 16.5 Dynamic SLA durations

If SLA durations should vary based on object state (e.g., premium vs. standard customer), that's stored in the SLA definition as a field mapping (premium: 4h, standard: 24h). At clock creation, the definition's rule is applied to compute dueAt.

### 16.6 Bulk workflow operations

If you need to transition many objects at once (e.g., bulk approval of 100 Leads), that's a Background Processing Core job that calls the transition endpoint for each object in a controlled batch. No special bulk-workflow engine.

---

## 17. Architecture Principles (Synthesis)

The Workflow / Process Architecture rests on these principles, inherited from the platform thesis:

1. **Configuration over Code**: Workflows are data (WorkflowDefinition rows), not code. The killer test is that a second entity can use a configuration-only workflow and achieve end-to-end lifecycle.

2. **Event-Driven Integration**: Workflow Core does not call Automation, Approval, or SLA cores directly. Instead, transitions emit events; downstream cores subscribe. Decoupling allows independent evolution.

3. **Server-Side Authority**: All gates, guards, and transitions are enforced server-side. The UI is a presentation layer; the engine is the source of truth.

4. **Immutable History**: State is mutable; Events are immutable. The state table holds the current snapshot; the Event table holds the permanent history.

5. **Audit Everything**: Every transition, approval decision, SLA pause, and automation action is recorded as an immutable Event and is auditable.

6. **Tenant Isolation**: All workflow, automation, approval, and SLA operations are tenant-scoped. Cross-tenant workflows are impossible; RLS engages on all cross-record reads.

7. **One Accountable Owner**: Every stage has exactly one owning Department (per B5 rule). Supporting departments contribute; only one is accountable. This clarity flows through SLA, assignments, and escalations.

8. **Time Authoritatively**: No module does its own date math. All SLA clocks, business-hours calculations, and recurrence rules are delegated to Time Core.

---

*End of 07 — Workflow / Process Architecture.*
