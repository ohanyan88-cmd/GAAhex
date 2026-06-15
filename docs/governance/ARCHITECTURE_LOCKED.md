# CRM — LOCKED SPEC (owner, to discuss later)

## CRM = 3 items only
Pipeline · Leads · Customers
NOT included: Opportunities (Deal = Lead stage) · Accounts (in Customer 360) ·
Contacts (in Customer 360) · Activities (in Customer 360 Timeline) · Customer Tasks (in Workspace task engine)

---

## 1 · Pipeline  — Business Process Engine (SST = Single Source of Truth for lifecycles)
Not just a visual kanban — the lifecycle engine of the whole system.

### Pipelines (lifecycles)
- Lead to Customer Lifecycle   (first / primary)
- Customer Lifecycle
- Installation Lifecycle
- Ticket Lifecycle
- Collections Lifecycle
- Retention Lifecycle

### Inside each lifecycle
Stages / Statuses · Transitions · Field Rules · Approvals · SLA · Automations ·
Notifications · Task Creation · Webhook Triggers · Permissions · Audit History

### Permissions
View: business / admin users.  Edit: Admin / Process Owner / Super Admin ONLY.

### Lead → Customer Conversion Pipeline (13 stages — owner · gate)
1  Lead              — Sales            · Commercial
2  Validated Lead    — Sales            · Commercial
3  Assigned          — Sales            · Commercial
4  Deal              — Sales            · Commercial
5  Contract Signed   — Sales            · Commercial
6  Order Created     — Back Office      · Commercial / Operations
7  Order Validated   — Validation       · Technical
8  Scheduling        — Dispatch Team    · Technical
9  Config            — NOC              · Technical
10 Installation      — Technical Dept   · Technical
11 Connection Test   — NOC              · Technical
12 Payment Confirmed — Billing          · Billing
13 Activation        — Billing / System · Activation

CRITICAL: Customer is NOT created in stages #1–#12.
- #13 Activation → Customer Created
- (or, if legal/billing requires: #6 Order Created → Account Created · #13 Activation → Customer Activated)

Entity distinctions:
- Lead    = possible customer
- Order   = confirmed commercial order
- Account = billing / contractual registration
- Customer= customer with an active service

---

## 2 · Leads  — Lead Intake Center (NOT a CRM entity list)
RULE #001: Every prospect enters as a Lead. No Customer created directly. Customer only via Lead Conversion.

### Sources (all land here)
Website Forms · Landing Pages · Facebook · Instagram · Google Ads · Call Center ·
Walk-in · D2D Agent · Tele Sales Agent · Retail Shop · Partner · Referral ·
Import CSV · API · Webhook · Manual Create

### Views
All Leads · My Leads · Unassigned · Qualified · In Progress · Won · Lost · Archived

### Lead Card
Lead ID · Name · Phone · Email · Address · Source · Campaign · Assigned To ·
Created At · Current Stage · Score · Priority · Tags

### Timeline
Calls · SMS · Emails · Notes · Tasks · Meetings · Status Changes · Assignments

Leads page shows the leads moving through the Lead-to-Customer pipeline.

---

## 3 · Customers  — Active Customer Base
### Views
All Customers · Active · Suspended · Inactive · Corporate · Residential

### Customer 360
- NOT a left-nav item — it is the Customer Record's default workspace.
- Path: Customers → Customer → Customer 360
- Holds: Accounts · Contacts · Activities (Timeline) + everything connected to the customer
  (Services · Subscriptions · Invoices · Payments · Usage · Tasks · Tickets · Documents · Approvals · Audit …)

---

## Final shape
CRM
├─ Pipeline   (SST Lifecycle Engine)
├─ Leads      (Intake + Qualification + Conversion)
└─ Customers  (Active base)
      └─ Customer 360  (record workspace)

---

# PLATFORM ARCHITECTURE LAWS + NAVIGATION — LOCKED

## 5 Rules

**Rule #1**
Workspace = Where I Work
Left Nav = Where Data Lives
Login → always opens Workspace. Every role sees their KPIs, queues, approvals, alerts, team status.

**Rule #2**
Left Nav = System Map (not workflow, not navigation by task — by data domain)

**Rule #3**
Left Nav contains ONLY Business Domains or Root Business Objects.
❌ Views · Filters · Teams · Channels · Resources · Statuses

**Rule #4**
Single Source of Truth must have Single Point of Creation.
- Lead → created only in Leads
- Customer → created only by Lead Conversion
- Order → created only by Pipeline Transition (SYSTEM ACTION, never by user)
- Invoice → created only by Billing Engine
- Work Order → created only by Order Workflow

**Rule #5**
Dashboards live in Workspace by default.
Exception: Left Nav allowed ONLY if real-time monitoring / observability / always-on status surface.
✅ NOC Dashboard → Left Nav
✅ System Health → Admin Panel
❌ Operations / Billing / Sales / Executive Dashboard → Workspace

---

## Final Navigation

### Header
ASK ME (Platform AI, not Search) · 📅 Calendar · 💬 Messages · 📧 Mail · 🔔 Notifications · 👤 User Menu

ASK ME > Search:
- Search = find data
- ASK ME = work with data (Platform Copilot / Operating System AI)
- "Show customers with debt > 20,000" / "Create work order" / "Open customer 100245"

Calendar = Company Calendar (Meetings · PTO · Events · Install Appointments · Personal Tasks · Approvals Due)
NOT Operations Schedule Calendar (that lives in Operations → Orders → Schedule View)

### Left Nav
```
Workspace

CRM
├─ Pipeline
├─ Campaigns
├── Leads
└─ Customers

Operations
├─ Orders
└─ Work Orders

Billing
├─ Invoices
├─ Payments
├─ Collections
└─ Adjustments

Network Operations
├─ NOC Dashboard
├─ Incidents
├─ Monitoring
├─ RADIUS Sessions
├─ IPAM
└─ Fiber Network

Inventory
├─ Equipment
└─ Warehouses

Reports
├─ Executive Reports
├─ Sales Reports
├─ Customer Reports
├─ Technical Reports
└─ Financial Reports

Organization
├─ Departments
├─ Employees
└─ Roles

Admin Panel
├─ Settings
├─ Payment Gateways
├─ Audit Logs
├─ System Health
├─ Webhooks
├─ Feature Flags
└─ Studio
```

---

## Key Decisions / What Moved Where

| Item | Was | Now |
|---|---|---|
| Customer 360 | Left Nav item | Customer Record workspace (Customers→Customer→360) |
| D2D / Tele / Retail / B2B | Modules | Campaigns/Leads Channels (filter/view) |
| Communications | Left Nav module | Header (Messages · Mail · Notifications) |
| Calendar | Left Nav | Header (Company Calendar) |
| Finance module | Left Nav | ❌ Removed (Revenue/Expenses → Reports/Financial · Payment Gateways → Admin Panel) |
| Customer Equipment | Inventory | Customer 360 → Equipment |
| Stock Movements | Left Nav | Equipment/Warehouse inner view |
| Network Inventory | Left Nav | Equipment inner view |
| Revenue Assurance | Left Nav | Billing Analytics / Reports |
| Dunning | Left Nav | Collections inner workflow |
| Payment Methods | Left Nav | Customer 360 → Billing |
| Dispatch / Field Teams | Left Nav | Operations → Orders inner (Dispatch View / Resources) |
| Scheduling | Left Nav | Operations → Orders inner (Schedule View) |
| Notifications | Left Nav | Header 🔔 |
| Templates | Left Nav | ❌ Removed (Campaigns inner or deleted) |
| Operations Dashboard | Left Nav | Workspace → Operations Manager role view |
| Campaigns | Marketing/standalone | CRM (Campaign→Lead→Customer chain) |

**Core insight:** Nothing was wrong. Everything was in the wrong drawer.

---

## Workspace Philosophy

Login → Workspace (always)
3-Level Architecture:
- Level 1: Workspace (Where users live)
- Level 2: Modules (CRM, Billing, NOC…)
- Level 3: Records (Customer, Ticket, Order…)

Role-based Workspace views:
- Sales Agent: My Leads · Today's Calls · Deals Waiting · Pipeline Tasks · Team Performance
- Dispatcher: Today's Installs · Scheduling Queue · Field Teams · Delayed Jobs
- NOC: Active Incidents · Monitoring Alerts · Devices Down · SLA Risk
- Billing: Payments Today · Overdue Invoices · Collections Queue · Revenue Alerts
- CEO: Revenue · Growth · Churn · Network Health · Collections
- Operations Manager: Orders Waiting Validation · Scheduling · Installations Today · Overdue Orders · Technician Utilization · Failed Installs · Activation Queue · SLA Risk

Workspace internals (role-dynamic): My Work · My Team · Approvals · Tasks · Alerts · KPIs · Queues · WBR/MBR Views
Notification-driven nav: "3 leads need assignment" → click → CRM→Leads filtered view

---

## Pipeline SST — Lead to Customer Lifecycle

Pipeline = Business Process Engine (SST for all lifecycles), NOT visual kanban.

6 Lifecycles:
1. Lead to Customer (primary)
2. Customer Lifecycle
3. Installation Lifecycle
4. Ticket Lifecycle
5. Collections Lifecycle
6. Retention Lifecycle

Each lifecycle contains:
Stages/Statuses · Transitions · Field Rules · Approvals · SLA · Automations · Notifications · Task Creation · Webhook Triggers · Permissions · Audit History

Permissions: View = business/admin · Edit = Lifecycle Owner only (NOT role title — ownership model)
Lifecycle Ownership examples:
- Lead Lifecycle → Commercial Director
- Customer Lifecycle → Customer Care Director
- Installation Lifecycle → Operations Director
- Collections Lifecycle → Finance Director

Lead → Customer Conversion (13 stages):
#1 Lead (Sales/Commercial) → #2 Validated → #3 Assigned → #4 Deal → #5 Contract Signed →
#6 Order Created (Back Office / SYSTEM ACTION — Order record auto-created by pipeline transition, never by user) →
#7 Order Validated (Technical) → #8 Scheduling → #9 Config → #10 Installation →
#11 Connection Test (NOC) → #12 Payment Confirmed (Billing) → #13 Activation (Billing/System)

CRITICAL:
- Customer NOT created in #1–#12
- #13 Activation → Customer Created
- (or: #6 → Account Created · #13 → Customer Activated)

Entity distinctions:
- Lead = possible customer
- Order = confirmed commercial order
- Account = billing/contractual registration
- Customer = customer with active service

RULE #001: Every prospect enters as Lead. No Customer created directly. Customer = Lead Conversion only.
DB enforcement: customer.lead_id UUID NOT NULL REFERENCES leads(id)
Migration path: System Lead / Imported Lead auto-created for legacy data.

---

## CRM Detail

```
CRM
├─ Pipeline   (SST Lifecycle Engine)
├─ Campaigns  (Campaign→Lead→Customer)
├─ Leads      (Intake + Qualification + Conversion)
└─ Customers  (Active base)
      └─ Customer 360 (record workspace — NOT left nav item)
```

Campaigns belong to CRM (not Marketing) because:
- KPI = Generated Leads · Qualified Leads · Conversion Rate · Revenue · CAC · ROI
- NOT Brand Awareness / Impressions / Likes
- Campaign inner: Audience · Leads Generated · Conversion · Revenue · ROI · Channels

Leads = Lead Intake Center
Sources: Website Forms · Landing Pages · Facebook · Instagram · Google Ads · Call Center · Walk-in · D2D Agent · Tele Sales · Retail Shop · Partner · Referral · Import CSV · API · Webhook · Manual Create
Views: All · My · Unassigned · Qualified · In Progress · Won · Lost · Archived
Lead Card: ID · Name · Phone · Email · Address · Source · Campaign · Assigned To · Created At · Current Stage · Score · Priority · Tags
Timeline: Calls · SMS · Emails · Notes · Tasks · Meetings · Status Changes · Assignments

Customer 360 path: Customers → Customer → Customer 360
Contains: Accounts · Contacts · Activities (Timeline) + Services · Subscriptions · Invoices · Payments · Usage · Tasks · Tickets · Documents · Approvals · Audit

---

## Operations Detail

Root entity = Order (only real business object that exits CRM and starts operational life)
Operations Manager daily view = Workspace (not a Left Nav dashboard)

```
Operations
├─ Orders       (New · Pending Validation · Awaiting Schedule · In Progress · Completed · Blocked · Cancelled)
└─ Work Orders  (Install · Repair · Replace Equipment · Survey · Disconnect · Maintenance)
```

Orders inner views: List · Kanban · Calendar · Dispatch · Map
Schedule Board = Orders inner view (NOT Left Nav item)
Dispatch / Field Teams / Scheduling = resources/views, NOT Left Nav items

---

## Reports + Studio

Reports = Runtime (users consume)
Studio → Report Builder = Builder (Business Analyst builds)

```
Reports
├─ Executive Reports
├─ Sales Reports
├─ Customer Reports
├─ Technical Reports
└─ Financial Reports   ← Revenue / Expenses / Profitability live here
```

---

## gx-Component Grammar (Phase 1)

gx-AppShell: Header · LeftNav · ContentArea · RightPanel (optional)
gx-PageHeader: Title · Breadcrumb · Actions
gx-CommandBar: Create · Import · Export · Bulk Actions
gx-KpiStrip, gx-DataTable, gx-FilterBar, gx-StatusBadge
gx-StageStepper, gx-Timeline
gx-Drawer: 70% editing strategy (View → Edit in Drawer)
gx-Modal: Confirm / Delete / Quick Action ONLY
gx-EmptyState, gx-LoadingState, gx-ErrorState
gx-CommandBar

Drawer vs Modal rule:
- Drawer = editing, viewing detail, side context (70% of cases)
- Modal = confirm / delete / quick action only

---

## Phase Plan

Phase 1 · Shell + gx-components  (UI Law — grammar first)
Phase 2 · Workspace               (Where I Work — role-based)
Phase 3 · CRM → Leads             (Platform Behavior — RULE #001, conversion, attribution)
