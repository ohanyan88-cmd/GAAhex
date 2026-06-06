# 05 — Operational Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`,
after `01`–`04`. Defines how the operational tier (case + work + dispatch +
SLA + on-call) runs at runtime — the doctrine for keeping an ISP operating.

---

## 1. Purpose

Codify the operational runtime: how Cases are opened, triaged, escalated,
resolved; how Work is generated, queued, assigned, dispatched, executed,
verified; how SLA clocks run; how on-call works; how the NOC and Field
Operations layer over the data graph.

## 2. Scope

In scope:

- The Operations runtime: Case → Work → Assignment → Execution → Verification.
- Queue mechanics: per-team queues, escalation paths, hand-off rules.
- SLA mechanics: clock start, pause, resume, breach, escalation.
- On-call and dispatch.
- The NOC dashboard composition.
- Incident management lifecycle.
- Change management lifecycle.

Out of scope:

- Workflow state-machine semantics (Workflow Core internals) — see
  `07_WORKFLOW_PROCESS_ARCHITECTURE.md`.
- API surface — see `10`.
- Event payload contracts — see `11`.
- Mobile execution UX — see `22`.

## 3. Goals

- **G1** Every operational record has a deterministic queue and a named
  accountable owner department at every stage (B5 / Standard 02).
- **G2** SLA clocks are accurate, governed by Time Core (no module-local
  date math).
- **G3** Escalation is automatic when breach is imminent.
- **G4** On-call rotations are tenant-scoped, observable, and overridable.
- **G5** Hand-off between teams (Dispatch → Field Tech → NOC → Provisioning)
  is event-driven, audited, and reversible.
- **G6** The NOC dashboard surfaces the operational truth (open incidents,
  SLA risk, breach count, top customer impact) within 60 seconds of any
  change.
- **G7** Field execution works offline (Mobile Core) and reconciles on
  reconnect.

## 4. Non-Goals

- **NG1** Does NOT define what statuses an Incident transitions through —
  that's Workflow Core via Standard 12.
- **NG2** Does NOT define network-element semantics — that's Network domain.
- **NG3** Does NOT specify infrastructure (job runners, queues) — see
  `19_INFRASTRUCTURE_ARCHITECTURE.md`.
- **NG4** Does NOT define design tokens or page layout — see `06`.

## 5. Architecture Principles

### P1 — Case is issue context; Work is execution

(PRM separation rule.) An incident may exist without ever spawning work
(observed and closed without action); work may exist without a case (planned
maintenance). They are separate ledgers that frequently cross-reference.

### P2 — One accountable owner per stage

(B5 / Standard 02.) Every lifecycle stage names exactly one *Owner Department*
accountable for outcomes; other departments are supporting.

### P3 — Time-bound commitments are SLA Core

SLA clocks are tracked by SLA Core using calendars / hours / holidays from
Time Core. Modules do not implement their own clocks.

### P4 — Hand-off is event-driven

When dispatch assigns a job, that hand-off is an event (`Work.Assigned`),
not a synchronous call. The assignee's queue learns of it via subscription.

### P5 — Operations cannot mutate cores asynchronously without audit

Every operational action emits an audit record (L4 from `01`).

### P6 — Backup paths for everything

Every operational role has a backup. Dispatch out → Dispatch backup picks
up. NOC engineer out → on-call covers. Approval chain has fallback per
SLA timeout.

### P7 — Customer-impact visibility

Operational dashboards prioritize *customer impact* metrics (services
affected, customers affected, MRR at risk) over component counts.

## 6. Architecture Laws

### L1 — Accountable-Owner-per-Stage

> Each lifecycle stage of any Case or Work entity has exactly one
> Owner Department (B5 / Standard 02). Co-ownership is forbidden.

### L2 — SLA via SLA Core

> Time-bound commitments (response time, resolution time, MTTR,
> availability) are tracked exclusively via SLA Core, with clocks
> driven by Time Core calendars. Module-local date arithmetic is
> forbidden for commitments.

### L3 — Queue scoping

> Every queue is tenant-scoped, named, and explicitly registered in
> the Case / Work core. Ad-hoc queues are forbidden.

### L4 — Hand-off via event

> When ownership of an operational record passes between teams /
> users / queues, the transition emits an event
> (`Case.Assigned`, `Work.Assigned`, `Case.Escalated`, etc.).

### L5 — On-call has identity

> The current on-call resolves to a specific user (or service account)
> at any moment, registered in Scheduling Core.

### L6 — Breach is observable

> SLA breach emits a high-priority event subscribed by Notification
> Core (page on-call), Workflow Core (escalation transition), and
> Observability Core (alert).

### L7 — Audit on every transition

> Every Case state transition, Work state transition, Assignment,
> Escalation, Approval, and Resolution emits an audit record (L4 in `01`).

### L8 — Reversal trail

> Hand-offs are reversible: an erroneous assignment can be revoked,
> with a documented audit trail. Hard-deleting an erroneous record
> is forbidden; archive / restore is the path (Standard 12, D14).

### L9 — Customer-impact roll-up

> NOC dashboards roll up customer-impact metrics via Relationship Core
> traversal (Service → Customer); not via stored counts.

## 7. Core Concepts

### 7.1 The Operations runtime

```
       ┌────────────────────────────────────────────────────────┐
       │                                                        │
   Trigger source ──> Case opened (Case Core)                    │
   (incident,                │                                   │
    customer call,            ▼                                  │
    NOC alert,           Triage (Owner Dept: NOC | Support |     │
    sensor, …)                Dispatch | OSS lead)               │
                              │                                  │
                              ▼                                  │
                         Required action?                        │
                              │                                  │
              ┌────── yes ────┴──── no ─────┐                    │
              ▼                              ▼                    │
       Work created                    Resolve in place          │
       (Work Core)                          │                    │
              │                              ▼                    │
              ▼                         Verification + close      │
       Assignment (Owner Dept)               │                    │
              │                              ▼                    │
              ▼                         Audit + SLA close         │
       Dispatch (Workforce)                                       │
              │                                                  │
              ▼                                                  │
       Field execution (Mobile Core)                             │
              │                                                  │
              ▼                                                  │
       Verification + sign-off (Approval Core)                   │
              │                                                  │
              ▼                                                  │
       Close + invoice trigger (Financial Core)                  │
       │                                                        │
       └────────────────────────────────────────────────────────┘
```

### 7.2 Case lifecycle (canonical states from Standard 11)

```
NEW ──> TRIAGED ──> IN_PROGRESS ──> PENDING_CUSTOMER ──> IN_PROGRESS
                          │
                          ├──> ESCALATED ──> IN_PROGRESS
                          │
                          ├──> RESOLVED ──> CLOSED
                          │
                          └──> CANCELLED
```

Stage-level Owner Departments (default; per-tenant configurable):

| Stage              | Owner Dept default   |
|--------------------|----------------------|
| NEW                | Support / NOC        |
| TRIAGED            | Support / NOC        |
| IN_PROGRESS        | Owner team (variable)|
| PENDING_CUSTOMER   | Support              |
| ESCALATED          | NOC Lead / Tier 2    |
| RESOLVED           | Support              |
| CLOSED             | Support              |

### 7.3 Work lifecycle

```
PLANNED ──> SCHEDULED ──> ASSIGNED ──> IN_PROGRESS ──> COMPLETED ──> VERIFIED ──> CLOSED
                                              │
                                              ├──> ON_HOLD ──> IN_PROGRESS
                                              └──> CANCELLED
```

Owner-department per stage (default):

| Stage         | Owner Dept default      |
|---------------|-------------------------|
| PLANNED       | Service Delivery        |
| SCHEDULED     | Dispatch                |
| ASSIGNED      | Field Tech              |
| IN_PROGRESS   | Field Tech              |
| COMPLETED     | Field Tech              |
| VERIFIED      | Provisioning / NOC      |
| CLOSED        | Service Delivery        |

### 7.4 SLA mechanics

An SLA Definition specifies:

- **Target metric**: response time, resolution time, MTTR, availability %.
- **Target value**: e.g. response < 15 min, resolution < 4h, availability > 99.9%.
- **Calendar**: business hours, follow-the-sun, 24/7 — from Time Core.
- **Pause conditions**: PENDING_CUSTOMER pauses the clock; weekends pause
  if calendar = business hours.
- **Escalation triggers**: at 50%, 75%, 100% of target.
- **Breach action**: emit `Sla.Breached` event.

### 7.5 On-call

Scheduling Core maintains on-call rotations:

- A **Rotation** (e.g. NOC On-Call Tier 1) is a named entity tied to a Team
  (Organization Core).
- A **Schedule** assigns Employees / Contractors to rotation slots over
  time, respecting business hours, holidays, time-off.
- A **Current On-Call** lookup resolves "who is the NOC Tier 1 on-call
  right now?" to a User (Identity Core), with override.
- **Page** action notifies on-call via Notification Core (push, SMS, email).

### 7.6 Dispatch board

A Dispatch Board (Workforce domain) shows:

- Open Work items by region / service area / queue.
- Available technicians with skills + capacity.
- Assignment latency and SLA risk.
- Drag-to-assign with conflict detection (no double-booking, shift
  compliance via Time Core).

### 7.7 NOC dashboard

The NOC dashboard composition (assembled from cores):

| Tile                                  | Source core                  |
|---------------------------------------|------------------------------|
| Open Incidents                        | Case (filter: type=INCIDENT, status≠CLOSED) |
| Sev1 / Sev2 counts                    | Case (by severity)           |
| SLA Breach Risk                       | SLA Core (clocks > 75%)      |
| Active Breaches                       | SLA Core (clocks > 100%)     |
| Customers Impacted (last 1h / 24h)    | Relationship Core (Service ↔ Customer roll-up) |
| MRR at Risk                           | Financial Core               |
| Top Affected Services                 | Service Core (joined with Case) |
| On-Call: Tier 1 / Tier 2              | Scheduling Core              |
| Recent Changes (last 24h)             | Case.ChangeRequest           |
| Recent Alerts                         | Observability Core           |

### 7.8 Incident management lifecycle (NOC-specific)

```
DETECT ──> TRIAGE ──> CONTAIN ──> MITIGATE ──> RESOLVE ──> POST-MORTEM
```

- `DETECT` — sourced from Observability Core (alert), Portal (customer
  report), Notification (sensor).
- `TRIAGE` — assign severity, owner team, customer-impact estimate.
- `CONTAIN` — limit further impact (e.g. failover, quarantine).
- `MITIGATE` — workaround to restore service.
- `RESOLVE` — root cause addressed; service restored fully.
- `POST-MORTEM` — write-up via Knowledge Core; PROBLEM record (Case Core)
  if Problem Management applies.

### 7.9 Change management lifecycle

```
PROPOSED ──> REVIEW ──> APPROVED ──> SCHEDULED ──> IN_PROGRESS ──> VERIFIED ──> CLOSED
                                                          │
                                                          ├──> ROLLED_BACK
                                                          └──> FAILED
```

Approval Core gates `APPROVED`; SLA Core defines window adherence; Workflow
Core executes the state machine.

## 8. Canonical Entities

Inherited from earlier docs (operationally significant):

| Entity              | Owner Core   | Operational role           |
|---------------------|--------------|----------------------------|
| Ticket              | Case         | Customer-facing issue      |
| Incident            | Case         | NOC-facing issue           |
| ServiceRequest      | Case         | Standard request           |
| Problem             | Case         | Persistent underlying cause|
| ChangeRequest       | Case         | Planned change             |
| Task                | Work         | Unit of work               |
| WorkOrder           | Work         | Customer-facing work bundle|
| FieldJob            | Work         | Field execution unit       |
| Assignment          | Work         | Owner of a unit            |
| Schedule            | Scheduling   | Time slot                  |
| Appointment         | Scheduling   | Booked engagement          |
| DispatchSlot        | Scheduling   | Available capacity slot    |
| SlaDefinition       | SLA          | Commitment template        |
| SlaClock            | SLA          | Running clock              |
| BreachRecord        | SLA          | Breach evidence            |
| OnCallRotation      | Scheduling   | Rotation                   |
| OnCallOverride      | Scheduling   | Ad-hoc cover               |

## 9. Ownership Boundaries

### 9.1 Case Core owns Cases

Case Core owns Ticket / Incident / ServiceRequest / Problem / ChangeRequest /
Complaint / CaseQueue. Other cores reference them by `caseId`.

### 9.2 Work Core owns Work units

Work Core owns Task / WorkOrder / FieldJob / Assignment / ProjectTask /
MaintenanceJob.

### 9.3 SLA Core owns clocks

SLA Core owns SlaDefinition / SlaClock / BreachRecord. Other cores subscribe
to SLA events.

### 9.4 Scheduling Core owns rotations + slots

Scheduling Core owns OnCallRotation / Schedule / Appointment / DispatchSlot /
MaintenanceWindow.

### 9.5 Workflow Core owns transitions

Workflow Core executes the state machines; the *current state* is on the
entity, the *transition history* is in TransitionHistory (Workflow Core).

## 10. Relationships

### 10.1 Case → Work

A Case may spawn Work; Work may close back into a Case for verification.
FK direction: `Work.caseId → Case.id` (Work references its originating
Case; Case does not back-reference Work, traversal is via query).

### 10.2 Work → Assignment → User

```
Work  ──>  Assignment  ──>  Party.Employee / Contractor (assigneeId)
                                 │
                                 └──> Organization.Team (teamId)
```

### 10.3 Case ↔ SLA

```
Case ──> SlaClock(s)  (1 case may have N clocks: response + resolution + escalation)
```

### 10.4 OnCallRotation ↔ Schedule ↔ Employee

```
OnCallRotation ──> Schedule (slots)  ──> Employee  ──> User
                          │
                          └──> OnCallOverride (ad-hoc cover)
```

### 10.5 Incident ↔ Network resource

```
Incident.affectedResourceIds  ←  via EntityRelationship rows (type: AFFECTS)
                                    Resource ── AFFECTED_BY → Incident
                                          ↓
                                    Service ── CONNECTED_TO → Resource
                                          ↓
                                    Customer ── BILLED_TO → Service
```

This is the impact graph (Relationship Core).

## 11. Responsibilities

### 11.1 NOC

- Triage incoming Incidents.
- Run on-call rotation.
- Drive resolution.
- Update customer-impact statement.

### 11.2 Dispatch

- Assign Field Jobs to technicians.
- Manage shift schedules.
- Resolve over-bookings.
- Trigger backup dispatch.

### 11.3 Support

- Triage customer-opened Tickets.
- Communicate with customers.
- Escalate to NOC / Field as needed.

### 11.4 Service Delivery

- Plan provisioning work.
- Verify completed work.
- Close service-delivery cases.

### 11.5 Owner department per stage (per L1)

Configured in Workflow Definition (Workflow Core); defaults from Standard 02.

## 12. Allowed Patterns

### AP1 — Case → Work fan-out

A single Incident spawns multiple Work items (NOC investigation +
Field replacement + customer comms task). Each has its own assignment and SLA.

### AP2 — Work without Case

Planned maintenance: a Work item exists with no originating Case. Its
SLA is based on maintenance-window commitments.

### AP3 — Cross-team escalation

A Case escalates from Support → NOC → Vendor (via Integration Core ticket
sync). Each transition is audited; the SLA clock pauses where defined.

### AP4 — On-call override

A scheduled on-call employee is sick; the rotation owner inserts an
OnCallOverride. The page action resolves to the override; audit captures
who and why.

### AP5 — Reversible assignment

A Work item assigned in error is revoked via "Reassign"; the original
assignee's audit shows the brief assignment + revocation.

### AP6 — Time-of-day SLA

A response-time SLA for tier-1 paid customers is 15 min during 24/7
business calendar; for free tier it's 4h during 9-5 business calendar.
Both clocks are tracked, both clocks pause appropriately.

### AP7 — Customer-impact-aware prioritization

Sort the NOC dashboard by `customersImpacted` descending; the SLA Core
clock weighting is multiplied by `customersImpacted * mrrAtRisk` for
priority queue ordering.

## 13. Forbidden Patterns

### FP1 — Module-local SLA math

`if (datetime.utcnow() - case.created_at).total_seconds() > 3600 * 4:` —
forbidden. The 4h commitment lives in SLA Core; the clock respects calendar.

### FP2 — Co-owned stages

A stage declaring "NOC and Dispatch are both accountable" — forbidden.
One is Owner Dept; others are supporting (B5).

### FP3 — Synchronous cross-team call

Support code synchronously calling `dispatch.assign(workorder)` — forbidden.
Emit `Work.NeedsAssignment` event; Dispatch domain subscribes.

### FP4 — Ad-hoc queues

A code-side `if customer.tier == "GOLD": queue = "gold-support"` — forbidden.
Queues are first-class entities; assignment logic uses queue references.

### FP5 — Hard-coded escalation thresholds

`if elapsed > 0.75 * sla_target: escalate()` — forbidden. SLA Core's
EscalationTrigger defines thresholds; subscribers act on the event.

### FP6 — Untracked on-call

A "we'll figure it out" cover that isn't recorded as OnCallOverride. The
page action will fail; audit will not reconcile.

### FP7 — Hard delete on operational records

Deleting a Case or Work item to "clean up". Forbidden by D14 (archive
preferred). Compliance audit requires the trail.

### FP8 — UI-only escalation

An escalation button that updates a UI state but doesn't transition Workflow.
Forbidden — operations are backend-authoritative.

### FP9 — Cross-tenant operational view

A NOC dashboard showing incidents across tenants. Forbidden except in
explicit Super-Admin context.

## 14. Cross-Architecture Dependencies

| Upstream                                  |
|-------------------------------------------|
| `PLATFORM_REFERENCE_MODEL.md`             |
| `01_PLATFORM_CORE_ARCHITECTURE.md`        |
| `02_DOMAIN_ARCHITECTURE.md` (OSS, WF, Network domains) |
| `03_INFORMATION_ARCHITECTURE.md` (entity model) |
| `04_NAVIGATION_ARCHITECTURE.md` (Operations + Workforce groups) |

| Downstream                                |
|-------------------------------------------|
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (Dispatch Board, NOC Dashboard layouts) |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` (state machine + transitions) |
| `08_PERMISSION_ARCHITECTURE.md` (operational permissions) |
| `11_EVENT_ARCHITECTURE.md` (event names + payloads for Case/Work/SLA) |
| `18_OBSERVABILITY_ARCHITECTURE.md` (NOC dashboards, alerts → incidents) |
| `22_MOBILE_OFFLINE_ARCHITECTURE.md` (field execution) |

## 15. Implementation Requirements

### 15.1 Case Core implementation

`backend/app/cores/case/` (or service equivalent) owns Ticket / Incident /
ServiceRequest / Problem / ChangeRequest / Complaint / CaseQueue tables,
APIs, events.

### 15.2 Work Core implementation

`backend/app/cores/work/` owns Task / WorkOrder / FieldJob / Assignment /
ProjectTask / MaintenanceJob tables, APIs, events.

### 15.3 SLA Core implementation

`backend/app/cores/sla/` owns SlaDefinition / SlaClock / BreachRecord
tables, the clock engine (calendar-aware), event publishers.

### 15.4 Scheduling Core implementation

`backend/app/cores/scheduling/` owns Schedule / Appointment / DispatchSlot /
OnCallRotation / OnCallOverride / MaintenanceWindow.

### 15.5 Background jobs

The SLA clock engine runs as scheduled jobs (Background Processing Core):
checks at 50%, 75%, 100% of each open clock; emits Escalation / Breach
events.

### 15.6 NOC dashboard composition

Frontend Workspace page assembles tiles from §7.7 sources; each tile fetches
via canonical API (no direct table joins from Workspace).

### 15.7 Dispatch board implementation

Frontend Workforce page; reads Schedule + Work + Party.Employee via canonical
APIs; assignment is a POST to Work Core API emitting `Work.Assigned`.

### 15.8 Mobile field execution

See `22_MOBILE_OFFLINE_ARCHITECTURE.md`. Field execution emits `Work.Updated`,
`Work.Completed` events at sync time.

### 15.9 Drift check

`tools/check_drift.py` adds rules:

- No date arithmetic in Case/Work modules outside SLA Core helpers.
- No `queue` string literals outside the queue registry.
- No hard-delete on operational tables.

## 16. Future Expansion Rules

### 16.1 New Case type

A new case type (e.g. `BillingDispute`) adds:

- ObjectType enum value (Standard 14).
- Reference-number prefix (§7.4 of `03`).
- Workflow definition.
- Owner Department defaults.
- Permissions per `08`.

### 16.2 Multi-vendor coordination

When Case escalation reaches an external vendor, Integration Core's ticket-
sync connector mirrors the case; the SLA Core clock pauses (vendor SLA
covers the gap).

### 16.3 Predictive dispatch

Future Forecasting Core integration: predict dispatch demand by region by
hour; pre-stage capacity. Inputs: historical Work data + Service density
+ weather + events.

### 16.4 AI-assisted triage

Future AI Core integration: AI-assist on incoming Case classification (set
severity, suggest owner team). Per AI Core boundary rules: AI suggests;
human approves; full audit (Standard 17 / `21_AI_ARCHITECTURE.md`).

### 16.5 On-call follow-the-sun

Multi-region on-call rotations: as a region's business hours close, the
clock hands off to the next region's on-call. Configured in
OnCallRotation calendars.

### 16.6 Customer-impact-aware SLA

Future: SLA targets vary by `customersImpacted` or `mrrAtRisk` thresholds.
Implementation extends SLA Core's TargetExpression.

---

*End of 05 — Operational Architecture.*
