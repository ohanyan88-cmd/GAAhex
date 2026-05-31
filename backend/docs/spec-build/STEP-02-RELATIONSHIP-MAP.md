# Step 2 PREPARE — SPEC §6 Relationship Map

**SPEC reference:** `C:\Users\Admin\Desktop\GAAex_Cross_Module_Architecture_SPEC.md`
- §6 Data Relationships (reference-only links)
- §6.1 Asset vs Resource boundary
- §0.5 References, not copies (Invariant #5)
- §0.6 Region/Branch partition (Invariant #6 — touches the relationship surface)

**⛔ This document is the MAP ONLY. No model edits, no migrations. Gev's explicit approval is
required before the activate step (FK + CHECK constraint migration) is generated.**

This is the audit of what SPEC §6 says GAAex's data relationships should look like, vs. what's
actually wired in `backend/app/models/` today, with the gaps, risks, and a proposed sequencing for
the additive migration that will close them.

---

## 0. Inventory and modeling shape (orientation)

Before the per-entity audit, the kernel's modeling shape matters because most of SPEC §6's "entity"
nouns don't map to one row each — they map to one of TWO shapes:

### Shape A — `record` polymorphic table (config-driven CRM)
`backend/app/models/record.py` holds **all** of the config-driven CRM entities in a single
polymorphic table keyed by `entity_key`. SPEC §6 nouns living here today: **Customer, Contact,
Lead, Pipeline Item (`deal`/`opportunity`), Contract, Asset, Project, Employee, Vendor, Document,
Task, Coverage Check, Communication (config form), Knowledge Article, Campaign, Purchase Order,
Stock Item, Incident, Alarm, Tariff Plan, Credit Note, SLA Policy.** Plus the secondary form of
Ticket and Work Order (the config-driven `ticket` / `work_order` `entity_def` keys that exist
alongside the first-class typed tables).

`record` has system columns (`tenant_id`, `entity_key`, `owner_node_id`, `status`, timestamps) +
a JSONB `data` bag for the config-defined fields. **There are NO FK columns from `record` to
`record`.** Every relationship between two CRM entities (e.g. Contact→Customer, Document→Customer,
Task→Project) is encoded only inside the JSONB bag if at all — no database referential integrity.

### Shape B — First-class typed tables (BSS / depth)
SPEC §6 nouns that have their own dedicated table: **Subscription, Invoice, InvoiceLine, Payment,
PaymentOrder, Order, OrderItem, Service, ServiceResource, ResourcePool, PoolAllocation,
HelpdeskTicket, HelpdeskQueue, WorkItem (the primary form of Work Order), Interaction (the primary
form of Communication), UsageRecord, Party, Account, Product, Thread, Message, Notification,
CustomerUser, PortalTicketReply, CalendarEvent.**

Cross-shape FKs **do** exist where useful (`invoice.customer_id → record.id`,
`helpdesk_ticket.customer_id → record.id`, etc. — these target the Customer Record).

### What this means for the audit
For Shape-A entities (Customer, Lead, Pipeline Item, Contact, Asset, Project, Employee, Vendor,
Document, Task, Contract), almost every SPEC §6 reference is **architecturally** "in the JSONB" or
"by `entity_key` string lookup," not a typed FK. The audit calls these `📋 JSONB-only (no DB FK)`
to distinguish them from a true `❌ missing` (a slot the model has explicitly carved out but not
wired). Both ultimately need closure for SPEC §6 referential integrity, but they're different
problems: JSONB-only needs the kernel to be taught a typed reference (Studio field type `ref`
already supports this in `field_def`, but it's runtime-resolved, not a DB FK).

---

## 1. Per-entity reference graph

### 1.1 Customer (`record` row, `entity_key='customer'`)

**SPEC §6 says it references:** Contacts, Billing Accounts, Services, Pipeline Items, Orders,
Contracts, Invoices, Payments, Tickets, Tasks, Communications, Work Orders, Documents, Timeline,
Churn Risk (AI view), Loyalty (AI view), Campaigns.

**Current model state:** `record` has no FKs to other records (polymorphic). The relationships
listed below all point AT Customer (1:N from Customer) — they live as FK columns ON the OTHER
table pointing back to `record.id`.

| Reference (1:N from Customer) | Current FK | Status |
|---|---|---|
| Contacts | `record(entity_key='contact')` → no `customer_id` column | 📋 JSONB-only |
| Billing Accounts | `account.holder_party_id → party.id`; Customer ↔ Party link is `party.customer_record_id → record.id` (back-link, exists) | ✅ via party indirection |
| Services | `service.customer_id → record.id` | ✅ already there |
| Pipeline Items | `record(entity_key='deal'/'opportunity')` → no `customer_id` column | 📋 JSONB-only |
| Orders | `order.customer_id → record.id` | ✅ already there |
| Contracts | `record(entity_key='contract')` → no `customer_id` column | 📋 JSONB-only |
| Invoices | `invoice.customer_id → record.id` | ✅ already there |
| Payments | `payment.customer_id` — **does not exist** (payment → invoice → customer is the only path today) | ❌ missing |
| Tickets (first-class) | `helpdesk_ticket.customer_id → record.id` | ✅ already there |
| Tickets (config) | `record(entity_key='ticket')` → no `customer_id` column | 📋 JSONB-only |
| Tasks | `record(entity_key='task')` → no `customer_id` column | 📋 JSONB-only |
| Communications (first-class) | `interaction.customer_id → record.id` | ✅ already there |
| Communications (config) | `record(entity_key='communication')` → no `customer_id` column | 📋 JSONB-only |
| Work Orders (first-class) | `workitem.customer_id → record.id` | ✅ already there |
| Work Orders (config) | `record(entity_key='work_order')` → no `customer_id` column | 📋 JSONB-only |
| Documents | `record(entity_key='document')` → no `customer_id` column | 📋 JSONB-only |
| Timeline | `event.record_id` (intentionally unconstrained — polymorphic, like `event.entity_key`); rows for entity_key='customer' filter by `record_id=customer.id` | ✅ already there (by convention) |
| Churn Risk (AI view) | AI view, not a table — no FK needed | n/a |
| Loyalty (AI view) | AI view, not a table — no FK needed | n/a |
| Campaigns | `record(entity_key='campaign')` ↔ Customer is M:N — needs link table | ❌ missing |

### 1.2 Pipeline Item (`record` row, `entity_key='deal'` or `'opportunity'`)

**SPEC §6 says it references:** Lead, Customer, Contact, Sales person, Channel, Product, Address,
Coverage Check, Contract, Order, Installation, Payment requirement, Activation, Timeline.

| Reference | Current FK | Status |
|---|---|---|
| Lead | JSONB only | 📋 JSONB-only |
| Customer | JSONB only | 📋 JSONB-only |
| Contact | JSONB only | 📋 JSONB-only |
| Sales person | `record.owner_node_id` covers org-node ownership; **direct assigned-user FK** is not on the `record` table | ⚠️ partial (org node yes; user no) |
| Channel | JSONB only (no `channel` def yet) | 📋 JSONB-only |
| Product | JSONB only | 📋 JSONB-only — BUT `product` is first-class; a typed FK is possible |
| Address | JSONB only (no `address` entity yet) | 📋 JSONB-only |
| Coverage Check | JSONB only (no `coverage_check` entity yet — per STEP-03 it's "unmapped") | ❌ missing (entity def first) |
| Contract | JSONB only | 📋 JSONB-only |
| Order | `order.customer_id` exists but no direct `order.pipeline_item_id` | ❌ missing |
| Installation | A WorkItem with kind='install' — no `pipeline_item_id` on `workitem` today | ❌ missing |
| Payment requirement | A SPEC §3 Stage-8 gate field — encoded as `order.control_pass` (✅) but no link FROM pipeline item TO an order is wired | ⚠️ partial |
| Activation | Service status transitions to ACTIVE; no `pipeline_item_id` on `service` today | ❌ missing |
| Timeline | `event.record_id` (polymorphic, by convention) | ✅ already there |

### 1.3 Billing Account (`account` table — first-class, doc 17a)

**SPEC §6 says it references:** Customer, Billing cycle, Payment method, Tax profile, Invoices,
Payments, Credit status, Collections, Services.

| Reference | Current FK | Status |
|---|---|---|
| Customer | `account.holder_party_id → party.id`; `party.customer_record_id → record.id` | ✅ via party indirection (intentional 4-layer Party→Account→Sub→Service model) |
| Billing cycle | `account.billing_cycle` (inline `String(20)`) | ✅ inline column |
| Payment method | **not on `account` today** — `payment.method` is per-payment; no `default_payment_method_id` on account | ❌ missing |
| Tax profile | **not on `account` today** | ❌ missing (tax profile entity doesn't exist) |
| Invoices | `invoice.account_id → account.id` (nullable; back-resolved via customer_id when null) | ✅ already there |
| Payments | `payment.account_id` — **does not exist** (payment is only linked to invoice, not directly to account) | ❌ missing |
| Credit status | `account.credit_terms` is inline `String(80)` — no credit_status enum column | ⚠️ partial |
| Collections | No `collection_case` entity yet (STEP-03 lists it as "unmapped") | ❌ missing |
| Services | `service.account_id → account.id` (nullable; back-resolved via customer_id when null) | ✅ already there |

### 1.4 Invoice (`invoice` table — first-class)

**SPEC §6 says it references:** Customer, Billing Account, Services, Invoice lines, Taxes,
Discounts, Payments, Credit Notes, Collections.

| Reference | Current FK | Status |
|---|---|---|
| Customer | `invoice.customer_id → record.id` | ✅ already there |
| Billing Account | `invoice.account_id → account.id` (nullable) | ✅ already there |
| Services | **no FK** — `invoice_line` has no `service_id` column; the link is by description/lineage only | ❌ missing |
| Invoice lines | `invoice_line.invoice_id → invoice.id` | ✅ already there |
| Taxes | `invoice_line.kind='tax'` row pattern (single-table) | ✅ inline by convention |
| Discounts | `invoice_line.kind='discount'` row pattern | ✅ inline by convention |
| Payments | `payment.invoice_id → invoice.id` | ✅ already there |
| Credit Notes | `record(entity_key='credit_note')` — config entity; no FK from invoice to credit_note today | ❌ missing |
| Collections | No `collection_case` entity yet | ❌ missing |

### 1.5 Payment (`payment` table — first-class)

**SPEC §6 says it references:** Customer, Billing Account, Invoice, Payment method, Gateway txn,
Receipt, Refund.

| Reference | Current FK | Status |
|---|---|---|
| Customer | **no `customer_id`** — must be reached via invoice | ❌ missing |
| Billing Account | **no `account_id`** — must be reached via invoice → account | ❌ missing |
| Invoice | `payment.invoice_id → invoice.id` | ✅ already there |
| Payment method | `payment.method` is inline `String(20)` (cash/card/transfer) — no FK to a method def table | ⚠️ partial (inline; no def table) |
| Gateway txn | `payment_order.payment_id → payment.id` (back-link from the gateway side) | ✅ already there (reverse direction) |
| Receipt | Not modeled today (Phase-2 deferred) | ❌ missing |
| Refund | No `refund` entity/table; status transitions only (`Refunded`/`Partially Refunded` in §7) | ⚠️ partial (status only) |

### 1.6 Service (`service` table — first-class)

**SPEC §6 says it references:** Customer, Service address, Tariff, Product, Billing Account,
Resource, Asset/Device, Provisioning request, Work Order, Tickets, SLA, Status, Activation date,
Suspension status.

| Reference | Current FK | Status |
|---|---|---|
| Customer | `service.customer_id → record.id` | ✅ already there |
| Service address | No `address_id` column; address is JSONB on customer record today | ❌ missing |
| Tariff | No `tariff_plan_id` (tariff_plan entity_def is unmapped per STEP-03) | ❌ missing |
| Product | **no `product_id` on `service`** — only on `subscription.product_id`; service inherits via subscription | ⚠️ partial (1-hop indirect) |
| Billing Account | `service.account_id → account.id` (nullable) | ✅ already there |
| Resource | `pool_allocation.service_id → service.id` (back-link); `service_resource` is freeform (NO FK) | ⚠️ partial (typed via pool_allocation; freeform via service_resource) |
| Asset/Device | No `asset_id` column on service (Asset is a config entity in `record`); no FK | ❌ missing |
| Provisioning request | Tied to `order` via subscription; no direct FK | ⚠️ partial |
| Work Order | No `workitem.service_id` column | ❌ missing |
| Tickets | No `helpdesk_ticket.service_id` column | ❌ missing |
| SLA | No `sla_policy_id`; `helpdesk_queue.default_sla_minutes` is inline | ❌ missing |
| Status | `service.status` inline String — `status_def` table holds the canonical values per entity_key; no FK | ⚠️ partial (inline string; no FK to status_def) |
| Activation date | `service.activated_at` inline | ✅ inline column |
| Suspension status | Encoded in `service.status` ('SUSPENDED') — no separate column | ✅ inline (by status) |

### 1.7 Asset (`record` row, `entity_key='asset'`)

**SPEC §6 says it references:** Site, Node, Device, Service, Customer impact, Incident,
Maintenance, Work Order, Serial.

| Reference | Current FK | Status |
|---|---|---|
| Site | JSONB only (no `site` entity yet) | 📋 JSONB-only |
| Node | JSONB only (no `network_node` entity yet) | 📋 JSONB-only |
| Device | Asset IS the device; self-reference may be needed for chassis→card | 📋 JSONB-only |
| Service | M:N — no link table | ❌ missing |
| Customer impact | Computed view (asset → service → customer); no direct FK | n/a (derived) |
| Incident | `record(entity_key='incident')` ↔ Asset is M:N — no link table | ❌ missing |
| Maintenance | No `maintenance_event` entity yet | ❌ missing |
| Work Order | No `workitem.asset_id` column | ❌ missing |
| Serial | JSONB only — **this is the §6.1 boundary marker; see Section 2 below** | 📋 JSONB-only |

### 1.8 Resource (logical — `resource_pool` + `pool_allocation`)

**SPEC §6 says it references:** Ports, IPs, VLANs, Fiber strands, Splitters, Capacity, Availability,
Assigned service, Assigned customer.

| Reference | Current FK | Status |
|---|---|---|
| Ports / IPs / VLANs / Fiber strands | `resource_pool.kind` enumerates these; `pool_allocation.value` carries the identifier | ✅ already there |
| Splitters | A splitter is a **strand pool** (logical) backed by a physical asset (Asset record). No FK from `resource_pool` to `record(asset)` exists today | ❌ missing (the §6.1 link) |
| Capacity | Computed (pool size − allocated count); no column | n/a (derived) |
| Availability | Computed (allocated vs released); no column | n/a (derived) |
| Assigned service | `pool_allocation.service_id → service.id` | ✅ already there |
| Assigned customer | Reached via service.customer_id; no direct FK on pool_allocation | ⚠️ partial (1-hop) |

### 1.9 Task (`record` row, `entity_key='task'`)

**SPEC §6 says it references:** Assignee, Department, Customer, Ticket, Project, Pipeline Item,
Invoice, Work Order, Approval, Due date.

| Reference | Current FK | Status |
|---|---|---|
| Assignee | `record.owner_node_id` is org-node, not user; no `assigned_user_id` column on `record` | ❌ missing |
| Department | Covered via `user.department` of the assignee, transitively | n/a (derived) |
| Customer | JSONB only | 📋 JSONB-only |
| Ticket | JSONB only | 📋 JSONB-only |
| Project | JSONB only | 📋 JSONB-only |
| Pipeline Item | JSONB only | 📋 JSONB-only |
| Invoice | JSONB only | 📋 JSONB-only |
| Work Order | JSONB only | 📋 JSONB-only |
| Approval | `approval.target_entity_key='task' + target_record_id=task.id` (polymorphic back-link) | ✅ already there (reverse direction) |
| Due date | JSONB only | 📋 JSONB-only |

### 1.10 Ticket — first-class form (`helpdesk_ticket`)

**SPEC §6 says it references:** Customer, Service, Invoice, Payment, Network asset, Queue, SLA,
Assignee, Department, Communications, Tasks, Work Orders, Timeline.

| Reference | Current FK | Status |
|---|---|---|
| Customer | `helpdesk_ticket.customer_id → record.id` | ✅ already there |
| Service | **no `service_id`** | ❌ missing |
| Invoice | **no `invoice_id`** | ❌ missing |
| Payment | **no `payment_id`** | ❌ missing |
| Network asset | **no `asset_id`** (would target `record(entity_key='asset')`) | ❌ missing |
| Queue | `helpdesk_ticket.queue_id → helpdesk_queue.id` | ✅ already there |
| SLA | `helpdesk_ticket.sla_due_at` + `sla_breached` (computed from queue default); no FK to a sla_policy table | ⚠️ partial |
| Assignee | `helpdesk_ticket.assigned_agent_id → app_user.id` | ✅ already there |
| Department | `app_user.department` (transitive via assignee) | n/a (derived) |
| Communications | `interaction.ticket_id → record.id` — note this targets `record`, NOT `helpdesk_ticket`; a config-form ticket; the first-class `helpdesk_ticket` has **no inbound interaction link** | ⚠️ partial (config-form only) |
| Tasks | No `task` typed table; tasks live in `record` with no `ticket_id` | ❌ missing |
| Work Orders | `workitem` has no `ticket_id` | ❌ missing |
| Timeline | `event.record_id` (polymorphic) | ✅ already there (by convention) |

### 1.11 Project (`record` row, `entity_key='project'`)

**SPEC §6 says it references:** Owner, Team, Tasks, Milestones, Resources, Budget, Documents,
Risks, Timeline.

| Reference | Current FK | Status |
|---|---|---|
| Owner | `record.owner_node_id` covers org-node owner; no `owner_user_id` column | ⚠️ partial (org node only) |
| Team | JSONB only (no project_team M:N link table) | 📋 JSONB-only |
| Tasks | JSONB only | 📋 JSONB-only |
| Milestones | No `milestone` entity | ❌ missing |
| Resources | Ambiguous — staff resources (Employee) or pool resources? JSONB only either way | 📋 JSONB-only |
| Budget | JSONB only (financial column) | 📋 JSONB-only |
| Documents | JSONB only | 📋 JSONB-only |
| Risks | No `project_risk` entity | ❌ missing |
| Timeline | `event.record_id` (polymorphic) | ✅ already there (by convention) |

### 1.12 Employee (`record` row, `entity_key='employee'`)

**SPEC §6 says it references:** User account, Department, Team, Role, Attendance, Leave,
Performance, Assigned tasks/tickets/work orders, Approvals.

| Reference | Current FK | Status |
|---|---|---|
| User account | JSONB only — should be `user_id → app_user.id` typed FK on the employee record | ❌ missing |
| Department | `app_user.department` (after employee→user link); no FK to `org_node` for "department node" | ⚠️ partial |
| Team | `app_user.primary_node_id → org_node.id` (after employee→user link) | ⚠️ partial (1-hop) |
| Role | `assignment.user_id → app_user.id`, `assignment.role_id → role_def.id` | ✅ already there |
| Attendance / Leave / Performance | No entities/tables yet | ❌ missing |
| Assigned tasks | JSONB only | 📋 JSONB-only |
| Assigned tickets | `helpdesk_ticket.assigned_agent_id → app_user.id` (after employee→user link) | ⚠️ partial (1-hop) |
| Assigned work orders | `workitem.assigned_user_id → app_user.id` (after employee→user link) | ⚠️ partial (1-hop) |
| Approvals | `approval.requested_by → app_user.id`, `approval.decided_by → app_user.id` | ✅ already there (via user) |

### 1.13 Vendor (`record` row, `entity_key='vendor'` or `'supplier'`)

**SPEC §6 says it references:** Procurement, POs, Contracts, Goods received, Payments, Documents.

| Reference | Current FK | Status |
|---|---|---|
| Procurement | The procurement record itself is a Vendor activity — JSONB only | 📋 JSONB-only |
| POs | `record(entity_key='purchase_order')` → no `vendor_id` typed FK | 📋 JSONB-only |
| Contracts | JSONB only (contract.vendor_id would be on the contract record) | 📋 JSONB-only |
| Goods received | No `goods_receipt` entity yet | ❌ missing |
| Payments | Vendor payments are a different flow (AP vs AR) — `payment.invoice_id` is AR-only today; no AP payment table | ❌ missing |
| Documents | JSONB only | 📋 JSONB-only |

### 1.14 Document (`record` row, `entity_key='document'`)

**SPEC §6 says it references:** Customer, Ticket, Project, Invoice, Contract, Employee, Legal case,
Approval flow, E-signature.

| Reference | Current FK | Status |
|---|---|---|
| Customer / Ticket / Project / Invoice / Contract / Employee | JSONB only — all six should be polymorphic FKs (a document attaches to ONE owner, plus secondary refs) | 📋 JSONB-only |
| Legal case | No `legal_case` entity yet | ❌ missing |
| Approval flow | `approval.target_entity_key='document' + target_record_id=document.id` works polymorphically | ✅ already there |
| E-signature | No `signature` table / field | ❌ missing |

---

## 2. Asset vs Resource boundary (§6.1) — enforcement plan

**SPEC §6.1 says:**
- Asset = physical item with serial. Owner: Asset Management.
- Resource = logical allocatable (IP, VLAN, port, fiber strand, capacity slot). Owner: Resource Inventory.
- A physical splitter is an Asset; its strand allocations are Resources. **No record lives in both.**

### Current state

| Layer | Where it lives | Carries a serial? | Is allocatable? |
|---|---|---|---|
| Asset | `record` with `entity_key='asset'` | JSONB — by convention | No |
| Resource pool | `resource_pool` (typed table) | No | No (the pool itself is a definition) |
| Resource allocation | `pool_allocation` (typed table) | No | Yes — value-level allocation |
| Service resource (freeform) | `service_resource` (typed, but kind+value freeform) | No (kind 'device' could store one) | Sort of — ALLOCATED/RELEASED states only |

### Boundary findings

1. **Pool side is clean.** `resource_pool` and `pool_allocation` have no `serial` column and no path
   to a physical-asset row. The logical/physical separation holds at the typed-table layer.
2. **Asset side is JSONB-soft.** Because Asset is a `record` row, its "serial" is a JSONB field
   (`data.serial`) — there is no DB-level check that a row with `entity_key='asset'` MUST have a
   non-null serial, and no check that a row with `entity_key='resource'` (if one existed) MUST NOT
   carry one.
3. **`service_resource` is the leak risk.** It has `kind` (free string: "ip|mac|port|device|circuit|other")
   and `value` (free string). If someone writes a row with `kind='device'` and `value='SN12345'`,
   they've put a physical asset's serial in the resource-allocation table — that's the boundary
   violation §6.1 forbids. There's no constraint to stop this today.
4. **No splitter linkage.** A physical splitter IS an asset (Asset record with kind='splitter'); its
   strand allocations ARE resources (`pool_allocation` rows). The bridge — "this strand pool was
   carved from THAT splitter asset" — does not exist. `resource_pool` has no `physical_asset_id`
   column.

### Enforcement options (ranked, my recommendation marked)

| Option | Type | Strength | Cost | My take |
|---|---|---|---|---|
| A. DB CHECK constraint on `service_resource.kind`: forbid `kind IN ('device','asset','serial')` | DB constraint | strong (database-layer) | low (additive constraint, may reject existing data) | ✅ **recommended** — names the boundary at the DB layer |
| B. Application-level guard in `service_resource` writer to refuse asset-shaped values | App-level | medium (any direct SQL bypasses it) | low | ⚠️ defense-in-depth, not the primary mechanism |
| C. Move Asset to a first-class `asset` table with mandatory `serial NOT NULL` | DB shape | strongest (table identity = role) | high (data migration from `record`) | 🔜 right answer long-term; out of scope for Step 2 |
| D. Documentation-only | Doctrine | weak | zero | ❌ what we have today; insufficient |
| E. Add `resource_pool.physical_asset_id` (nullable FK → record.id, filtered to entity_key='asset') | Bridge | adds the missing link | low | ✅ **recommended** in parallel — makes the splitter/strand relationship typed |

**Proposed Step 2 ACTIVATE outcome for §6.1:**
- (A) Add the CHECK on `service_resource.kind` (additive, low risk; dry-run on temp DB first).
- (E) Add `resource_pool.physical_asset_id UUID NULL REFERENCES record(id)` for the splitter bridge.
- (B) Add the same guard in the writer for belt-and-braces.
- (C) Stays deferred to a future first-class-Asset extraction round.

---

## 3. Missing FKs proposed for ADD (the ⛔ list)

Listed in the order I recommend applying. Only typed-table → typed-table or typed-table → record
FKs are listed — JSONB-only references in `record` are addressed separately (Section 4) because the
shape-change there is a kernel-wide motion, not a single FK addition.

| # | Source table | Source column | Target table | Target column | Cascade | SPEC ref (§6 line) | Risk if added |
|---|---|---|---|---|---|---|---|
| 1 | payment | customer_id (NEW) | record | id | RESTRICT | Payment → Customer | Existing payments have no customer_id; backfill via `payment → invoice.customer_id`. Risk: invoices missing customer_id leave orphans (rare; nullable). |
| 2 | payment | account_id (NEW) | account | id | RESTRICT | Payment → Billing Account | Same backfill chain via invoice.account_id; nullable mirrors invoice. |
| 3 | helpdesk_ticket | service_id (NEW) | service | id | RESTRICT | Ticket → Service | No existing data; pure additive. |
| 4 | helpdesk_ticket | invoice_id (NEW) | invoice | id | RESTRICT | Ticket → Invoice | No existing data; pure additive. |
| 5 | helpdesk_ticket | payment_id (NEW) | payment | id | RESTRICT | Ticket → Payment | No existing data; pure additive. |
| 6 | helpdesk_ticket | asset_record_id (NEW) | record | id | RESTRICT | Ticket → Network asset | Polymorphic target (filtered to entity_key='asset' — enforced at app layer or via a CHECK on a denormalized entity_key column). Risk: PG cannot conditionally FK on a column of the target table; the FK is permissive at DB layer. |
| 7 | workitem | ticket_id (NEW) | helpdesk_ticket | id | RESTRICT | Work Order ← Ticket (Ticket → Work Orders inverse) | No existing data; pure additive. |
| 8 | workitem | service_id (NEW) | service | id | RESTRICT | Service → Work Order inverse | No existing data; pure additive. |
| 9 | workitem | asset_record_id (NEW) | record | id | RESTRICT | Asset → Work Order inverse | Same polymorphic caveat as #6. |
| 10 | workitem | project_record_id (NEW) | record | id | RESTRICT | Project → Tasks inverse (work_order ~ task) | Same polymorphic caveat. |
| 11 | workitem | invoice_id (NEW) | invoice | id | RESTRICT | Task → Invoice (work_order ~ task) | No existing data; pure additive. |
| 12 | usage_record | service_id (CONVERT — already a column, currently "loose ref" with no FK) | service | id | RESTRICT | Service → Resource (usage as service consumption) | Existing rows may have a stale service_id; require dry-run + orphan-check before NOT NULL. Nullable is safe. |
| 13 | invoice_line | subscription_id (NEW) | subscription | id | RESTRICT | Invoice → Services (via subscription) | Backfill from invoice.customer_id + subscription.customer_id where unambiguous. Nullable. |
| 14 | invoice_line | service_id (NEW) | service | id | RESTRICT | Invoice → Services | Backfill from invoice_line.subscription_id → subscription → service. Nullable. |
| 15 | invoice_line | usage_record_id (NEW) | usage_record | id | RESTRICT | Invoice ← Usage rating | Backfill from `usage_record.invoice_id` reverse direction where rated=true. Nullable. |
| 16 | order | pipeline_item_record_id (NEW) | record | id | RESTRICT | Pipeline Item → Order | No existing data (pipeline_item entity_def may be unmapped per STEP-03); pure additive. |
| 17 | order | subscription_id (NEW) | subscription | id | RESTRICT | Order → Subscription bridge (commented in order.py) | Order spawns subscription on COMPLETED; today the link is uni-directional from subscription side. Adding the reverse is fine. Nullable. |
| 18 | service | product_id (NEW) | product | id | RESTRICT | Service → Product | Backfill via service.subscription_id → subscription.product_id. Nullable. |
| 19 | service | tariff_record_id (NEW) | record | id | RESTRICT | Service → Tariff | Polymorphic; tariff_plan entity_def is unmapped (STEP-03). DEFER until entity exists. |
| 20 | service | activation_workitem_id (NEW) | workitem | id | SET NULL | Service → Work Order (activation) | Pure additive. |
| 21 | resource_pool | physical_asset_record_id (NEW) | record | id | SET NULL | §6.1 splitter bridge | Polymorphic; filter to entity_key='asset' at app layer. |
| 22 | interaction | ticket_id (REVIEW) | helpdesk_ticket | id | RESTRICT | Ticket → Communications, first-class form | **CURRENTLY** FKs to `record`, the config-form ticket. Decision needed: add a SECOND column `helpdesk_ticket_id` or change the existing one. Recommend adding a new nullable column to avoid breaking config-form tickets. |
| 23 | portal_ticket_reply | tenant scope mismatch | helpdesk_ticket | id | already there | already linked | ✅ no action — already FKed |
| 24 | approval | requested_by | record | id (if employee record) | n/a | Employee → Approvals | Approval already FKs to `app_user`; the SPEC says employee → approvals, which is satisfied transitively via user. No new FK needed. |
| 25 | customer_user | tenant_id consistency | (existing) | (existing) | (existing) | Customer → Portal logins (implicit) | Already correct. |
| 26 | calendar_event | customer_record_id (NEW) | record | id | SET NULL | Customer Timeline ← calendar events | Pure additive (nullable). |
| 27 | calendar_event | helpdesk_ticket_id (NEW) | helpdesk_ticket | id | SET NULL | Ticket → Timeline | Pure additive. |

**Polymorphic-target caveat:** rows 6, 9, 10, 16, 19, 21, 26 target `record.id` and conceptually
should be filtered to a specific `entity_key`. Postgres does not support a conditional FK on a
column of the target. Three patterns are available:
- (a) **App-level guard only** — quick, but bypassed by direct SQL.
- (b) **Denormalized `target_entity_key` column on source + DB CHECK that it equals the expected
  literal** — strong, costs one column per polymorphic FK.
- (c) **Trigger on insert/update** — strong, more moving parts.

I recommend (b) for the four high-traffic ones (helpdesk_ticket.asset_record_id,
workitem.asset_record_id, workitem.project_record_id, resource_pool.physical_asset_record_id), (a)
for the rest, and revisit when those entities get extracted to first-class tables.

---

## 4. Reference-only-not-copies audit (Invariant #5)

SPEC §0.5: "Master data referenced, never copied." I scanned every typed model for inline copies of
master-data fields that should be reached by join.

### Confirmed copy violations (recommend later, NOT in this round)

| Source | Column | What it copies | Severity | Fix |
|---|---|---|---|---|
| subscription | plan_name | product.name | LOW (intentional — plan name may diverge from product name over time, especially after grandfather rates) | **Keep**, document the divergence rule; this is a snapshot, not a copy. |

### Borderline / intentional snapshots (NOT violations)

| Source | Column | What it could be a copy of | Decision |
|---|---|---|---|
| subscription | amount, cycle | product.default_amount, product.cycle | Intentional — these are the per-subscription rate (often differs from product default). Documented in model. |
| notification | title, body | notification_def.title_template / body_template | Intentional — rendered-at-emit-time, then immutable. Documented in model. |
| notification | category, priority | notification_def.category, notification_def.priority | Same — documented "copied from the def at emit" in model. |
| invoice | number | n/a | Human reference, not a master-data copy. |
| order | number | n/a | Same. |

### Conspicuous absences (proof the codebase is clean here)

I specifically grepped for `customer_name`, `product_name`, `account_number`, `invoice_number` as
inline columns on tables that already FK to the source. **None found.** The team has been
disciplined about this — Invariant #5 is honored at the typed-table layer.

### JSONB caveat

For `record`, this audit cannot reach: any JSONB `data` bag CAN hold copies (e.g. a contact record
that bakes `customer_name` into its JSONB). The kernel has no way to detect this without a Studio
field-type policy ("no plain-text copies of join-reachable fields"). Out of scope for Step 2; flag
for a future Studio-level lint.

**Summary: 0 hard copy violations in the typed model layer. 0 fixes in this round.**

---

## 5. Migration sequencing proposal

The activate step is purely additive — no DROPs, no NOT NULLs in the first wave. The sequence
below is the safe order to apply the 22 actionable FKs from Section 3 (rows 24/25 are no-ops,
row 22 is a decision point, rows 19/20 are deferred until prerequisite entities exist).

### Wave 1 — Pure-additive columns + indexes (no constraints)
For each FK in the list:
1. `ALTER TABLE <source> ADD COLUMN <new_col> UUID NULL;`
2. `CREATE INDEX ix_<source>_<new_col> ON <source>(<new_col>);`

**Risk:** zero. Adding nullable columns and indexes is online and reversible.

### Wave 2 — Backfill data
Per-FK backfill SQL (run inside a transaction per tenant, audited):

| FK | Backfill SQL (sketch) |
|---|---|
| #1 payment.customer_id | `UPDATE payment p SET customer_id = i.customer_id FROM invoice i WHERE p.invoice_id = i.id AND i.customer_id IS NOT NULL;` |
| #2 payment.account_id | `UPDATE payment p SET account_id = i.account_id FROM invoice i WHERE p.invoice_id = i.id AND i.account_id IS NOT NULL;` |
| #12 usage_record.service_id | Verify each existing value resolves to a `service.id` row; null-out orphans before adding the FK. |
| #13 invoice_line.subscription_id | `UPDATE invoice_line il SET subscription_id = s.id FROM subscription s JOIN invoice i ON i.customer_id = s.customer_id WHERE il.invoice_id = i.id AND ...` (requires per-tenant validation that subscription is unambiguous within the invoice period). |
| #14 invoice_line.service_id | After #13: `UPDATE invoice_line il SET service_id = svc.id FROM service svc JOIN subscription sub ON svc.subscription_id = sub.id WHERE il.subscription_id = sub.id;` |
| #15 invoice_line.usage_record_id | `UPDATE invoice_line il SET usage_record_id = u.id FROM usage_record u WHERE u.invoice_id = il.invoice_id AND u.rated = true AND ...` (must match line by description/period). |
| #17 order.subscription_id | `UPDATE "order" o SET subscription_id = s.id FROM subscription s WHERE s.customer_id = o.customer_id AND s.started_at >= o.created_at AND o.status='COMPLETED' AND ...` (best-effort; may leave rows unbackfilled). |
| #18 service.product_id | `UPDATE service svc SET product_id = sub.product_id FROM subscription sub WHERE svc.subscription_id = sub.id AND sub.product_id IS NOT NULL;` |
| #3-#11, #16, #20, #21, #26, #27 | No backfill needed — new relationships, no existing data. |

**Risk per backfill:** medium for #13/#14/#15/#17 (ambiguity when multiple subscriptions/services
exist per customer per period); low for the rest. Each backfill should be **dry-run in COUNT mode**
to report (a) rows that resolve to exactly one target, (b) rows that resolve to multiple, (c) rows
that resolve to zero. Multi-match rows stay NULL and surface as a manual-review queue.

### Wave 3 — Add FK constraints
Per FK in Section 3:
```sql
ALTER TABLE <source>
  ADD CONSTRAINT fk_<source>_<col>
  FOREIGN KEY (<col>) REFERENCES <target>(id)
  ON DELETE RESTRICT
  NOT VALID;          -- skip the back-check; existing nulls are fine
ALTER TABLE <source> VALIDATE CONSTRAINT fk_<source>_<col>;
```

**Risk:** low. `NOT VALID` + `VALIDATE` is the standard "non-blocking on big tables" pattern.
RESTRICT is the default cascade; the SPEC's immutability invariants (invoice, payment, event) are
already DB-trigger-enforced so cascade choice can't violate them.

### Wave 4 — DEFERRED — NOT NULL tightening
Do NOT promote any column to NOT NULL in this round. The shape of the data is too sparse today (a
lot of CRM rows pre-date the FK plan). NOT NULL becomes its own gated round after a tenancy of live
data confirms backfill completeness.

### Wave 5 — DEFERRED — Polymorphic guards
The `target_entity_key` denormalized-column + DB CHECK pattern (Section 3 polymorphic-caveat option
b) lands in a separate round after Section 1's missing entity_defs (`tariff_plan`, `address`,
`site`, `network_node`, `coverage_check`, `collection_case`, etc.) get seeded — otherwise the CHECK
would reference entity_keys that don't exist yet.

### Wave 6 — DEFERRED — §6.1 boundary CHECK
The `service_resource.kind` CHECK from Section 2 (option A) is its own gated round. Existing data
must be audited first: any row with `kind='device'` becomes a candidate violator. Dry-run on a
prod-shape temp DB and surface offenders before the constraint goes live.

---

## 6. Final summary table

### ⛔ Gates needing Gev approval before activation

| # | Item | Type | Risk | My recommendation |
|---|---|---|---|---|
| 1 | Add 22 nullable FK columns + indexes (Section 3 actionable rows) | additive migration | low (additive, no drops, no NOT NULLs) | **safe to apply** as Wave 1 |
| 2 | Backfill data per Wave 2 SQL sketches | data migration | medium for invoice_line/order chains (multi-match ambiguity); low elsewhere | **dry-run first**; surface multi-match rows as manual-review queue; apply for unambiguous rows only |
| 3 | Add FK constraints with NOT VALID + VALIDATE | constraint migration | low (RESTRICT, doesn't fight immutability triggers) | **safe to apply** after Wave 2 settles |
| 4 | Asset vs Resource boundary CHECK on `service_resource.kind` | DB CHECK constraint | medium (may reject existing 'device'-kind rows) | **dry-run on temp DB first**; gate behind Wave 6 |
| 5 | Add `resource_pool.physical_asset_record_id` (§6.1 splitter bridge) | additive FK | low | safe to apply alongside Wave 1 |
| 6 | NOT NULL tightening on any new FK | destructive | HIGH (any sparse row rejected) | **defer**; not in this round |
| 7 | Drop any column to remove inline copy | destructive | HIGH (data loss) | **defer**; the audit found zero hard copy violations in the typed layer (Section 4), so this gate may never need to fire |
| 8 | Polymorphic-target CHECK on denormalized entity_key columns | DB CHECK | medium (needs prerequisite entity_defs to exist first) | **defer to Wave 5** |

---

## 7. Coverage report (what I couldn't analyze and why)

- **JSONB-encoded relationships inside `record.data`.** I cannot tell from the model files which
  CRM entities currently have a `data.customer_id` JSONB key etc. — that requires inspecting field
  defs (`field_def` rows with `type='ref'`) at runtime per tenant. Recommendation: a follow-up
  scan of seeded `field_def` rows will reveal the runtime ref topology and let us harden the high-
  traffic ones into typed FKs in a later round.
- **Region partition (§0 invariant #6) interaction with §6.** The `region_id` columns on the seven
  operational tables (`record`, `invoice`, `payment`, `order`, `service`, `helpdesk_ticket`,
  `workitem`) are currently free-floating UUIDs (see `region.py` docstring); the FK to `region.id`
  is itself a deferred migration. I noted it but did not include it in Section 3 — it's already
  tracked separately.
- **Catalog vs first-class duplication.** Several SPEC §2.2 records exist BOTH as a config entity
  AND a first-class table (Ticket, Work Order, Order, Communication, Invoice, Payment, Service).
  STEP-03 already notes this. For the §6 relationship audit, I treated the first-class table as
  the canonical target and the config-form as a parallel duplicate. If Gev's plan is to retire one
  of the two forms per pair, the FK targets in Section 3 should be re-validated.
- **Vendor / AP flow.** SPEC §6 says Vendor → Payments, but the `payment` table is AR-only (it
  references `invoice` which references customer Record). An AP payment table doesn't exist. I
  flagged the gap (Section 1.13 row 5) but did not propose a Section 3 FK — adding a column to a
  table that doesn't exist isn't actionable yet.
- **AI views (Churn Risk, Loyalty).** Treated as derived, not tables; not in scope for FKs.

---

## 8. Headline numbers

- **14** SPEC §6 entities audited (Customer, Pipeline Item, Billing Account, Invoice, Payment,
  Service, Asset, Resource, Task, Ticket, Project, Employee, Vendor, Document).
- **27** reference relationships proposed in Section 3, of which:
  - **22** actionable typed-table FKs to add (Wave 1–3).
  - **2** no-ops (already wired).
  - **2** decision-points (interaction.ticket_id form; service.tariff awaiting entity_def).
  - **1** deferred (vendor AP payments — no table).
- **~50** SPEC §6 references marked `📋 JSONB-only` — these are kernel-shape problems, not
  single-FK fixes; flagged for a future runtime-ref-to-typed-FK promotion round.
- **2** §6.1 Asset/Resource boundary enforcement actions (CHECK on `service_resource.kind` +
  bridge FK `resource_pool.physical_asset_record_id`).
- **0** hard copy violations found in the typed model layer (Invariant #5 honored).
- **6** Wave migration sequence proposed; **Waves 4-6 deferred** (NOT NULL tightening, polymorphic
  CHECKs, §6.1 CHECK) until prerequisites land.

---

## 9. What changes when Gev approves

The activate step (separate task) will generate one Alembic migration that:
1. Adds the 22 nullable FK columns + their indexes (Wave 1).
2. Runs the Wave-2 backfill scripts inside the migration (with `--dry-run` flag honored).
3. Adds the FK constraints with `NOT VALID` + `VALIDATE` (Wave 3).
4. Adds the `resource_pool.physical_asset_record_id` bridge FK (gate item 5).

It will NOT:
- Tighten any column to NOT NULL.
- Drop any existing column.
- Add the §6.1 `service_resource.kind` CHECK (separate gated migration after a dry-run audit).
- Add the polymorphic denormalized-entity_key CHECKs (separate round after prerequisite entity_defs).

Awaiting Gev's ⛔ approval to proceed to the activate step.
