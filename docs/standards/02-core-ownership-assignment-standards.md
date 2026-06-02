# 02 — Core Ownership & Assignment Standards

Covers: Department Ownership, Assignment, Queue Ownership, Escalation, Approval Ownership.
B5 patch applied: every lifecycle/pipeline stage has **exactly one accountable Owner
Department**; any others are **supporting departments** (contributors), never co-owners.

---

## Department Ownership Standard — LOCKED

### ISP Department Catalog
The system supports a broad ISP/Telco department catalog. Tenants enable only what they need.

```
Executive Management
Marketing
Sales
Telesales
D2D Sales
B2B Sales
Partner Sales
Customer Service
Customer Success
Support
Back Office
Order Management
Service Delivery
Dispatch
Field Operations
Field Technicians
Installation Teams
NOC
Network Engineering
Infrastructure Engineering
Network Planning
Provisioning
Finance
Billing
Collections
Revenue Assurance
Procurement
Warehouse
Inventory Management
Projects
PMO
HR
Legal
Compliance
Security
IT
System Administration
Quality Assurance
Business Process Management
```

### Default Lifecycle Ownership Template (configurable)
System-suggested only. Each stage names exactly one accountable owner (B5).

```
Lead              = Marketing
Validated Lead    = Sales
Assigned          = Sales Manager
Deal              = Sales
Contract Signed   = Sales
Order Created     = Back Office
Order Validated   = Back Office
Scheduling        = Service Delivery
Installation      = Field Technician
Provisioning      = NOC
Connection Test   = NOC
Payment Confirmed = Finance
Activation        = NOC
Monitoring        = NOC
```

Companies may change owners, add/remove/split/merge stages, delete the default lifecycle,
or create new templates. Lifecycle ownership is configurable; the default is a template only.

---

## Assignment Standard — LOCKED

### Ownership Model
Every assignable record supports:

```
Owner Department      optional (when present, exactly ONE accountable department — B5)
Primary Assignee      required for actionable records
Followers / Watchers  optional, unlimited (awareness only — see Watcher Standard)
```

Supported forms: Department only, User only, Department + User.

Department-only queue records are allowed before individual assignment. Enforce required
Primary Assignee at the actionable stage, not necessarily at queue intake.

### Reassignment
When Owner Department or Primary Assignee changes (auto or manual), the system creates an
Activity Log and Audit Log and stores: previous/new department, previous/new assignee,
timestamp, optional reason.

---

## Queue Ownership Standard — LOCKED

Allowed queue ownership: `Department + User`.
Queue membership: a record belongs to **exactly one** queue. Multi-queue assignment is not
allowed.
Assignment strategies: `MANUAL, ROUND_ROBIN, LEAST_LOADED, SKILL_BASED, PRIORITY_BASED,
CONFIGURABLE`. Default: `LEAST_LOADED`. Queue owner may override the strategy.
Visibility modes: `QUEUE_MEMBERS, DEPARTMENT, MANAGEMENT, EVERYONE_WITH_PERMISSION`.
Configurable per queue.

---

## Escalation Standard — LOCKED

Triggers (multiple may fire simultaneously): `SLA_BREACH, STATUS_STUCK_TOO_LONG,
MANUAL_ESCALATION, PRIORITY_INCREASE, CUSTOMER_COMPLAINT, REVENUE_IMPACT, VIP_CUSTOMER,
CONFIGURABLE_RULES`.
Targets: `NEXT_MANAGER, DEPARTMENT_MANAGER, SPECIFIC_USER, ESCALATION_QUEUE`. Users may
manually select the target from a dropdown.
Levels: `LEVEL_1..LEVEL_4`. Companies may configure 0–4 levels or a custom hierarchy.
Default maximum = 4.
**D11 — Escalation to an `ESCALATION_QUEUE` is a queue *move* (reassignment), never a second
membership. A record belongs to exactly one queue at all times (Queue Ownership Standard); the
escalation reassigns it from its current queue to the escalation queue and audits the move.**

---

## Approval Ownership Standard — LOCKED

Requester options: `RECORD_OWNER_ONLY, ASSIGNED_USER, DEPARTMENT, MANAGER,
ANYONE_WITH_PERMISSION, CONFIGURABLE`.
Approver options: `DIRECT_MANAGER, DEPARTMENT_MANAGER, SPECIFIC_USER, ROLE,
APPROVAL_COMMITTEE, CONFIGURABLE`.
Outcomes: `APPROVE, REJECT, REQUEST_CHANGES, DELEGATE, CANCEL_REQUEST`.
Multiple-approval rule: configurable; default `ALL must approve`; type may override to
any-one or another configured rule.

### Approval Audit Fields
Required on every approval (non-manipulable integrity fields):
`Approver, Decision, Timestamp (system-set, UTC), Reason (structured)`.
Supported, requiredness configurable per approval type:
`Comments, Attachment, Digital Signature`.
Digital Signature: build data model + engine capability now; enable per high-stakes
approval type (contract change, customer delete, large refund) only when needed.

---

## Integration With Other Standards
Audit, Event System, Activity Timeline, Notification, SLA, Workflow Engine, RBAC.

## Locked Decision
Ownership = accountability (one owner). Assignment = responsibility (one primary assignee).
Watching = awareness only. These three never merge.
