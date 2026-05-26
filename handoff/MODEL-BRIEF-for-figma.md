# GAAex — Model Brief (for designing UI in our real model)

Hand this to a UI tool so screens reflect GAAex's ACTUAL data model, not a generic ISP mockup.

## What GAAex is
A **multi-tenant, metadata-driven** back-office that aims to be the only place of work for an entire
ISP. The system renders & behaves from **configuration** — entities, fields, statuses, and
transitions are data, not hardcoded screens. Everything is scoped to an **org tree** and a tenant.

## Brand / design model (use exactly)
- **Dark-first.** Dark is the default theme; light is secondary. **Sidebar stays dark in BOTH themes.**
- **Palette:** Cobalt `#1C3B68` (primary) · Gold `#C5A059` (accent) · success `#2ECC71` · warning
  `#F5A623` · danger `#E63946`. Dark bg `#0D0F12`, dark card `#1F242C`. Light bg `#F8F9FA`, card `#FFF`.
- **Money:** Armenian Dram, symbol **֏**. Stored as integer "luma" (minor units) → display = value/100,
  e.g. `2458000000` luma → `֏24,580,000`. Tabular numerals.
- **Logo:** "GA" in cobalt + "ex" in gold. Radius ~8px. Clean, dense, enterprise.

## Identity & structure (every screen is scoped by these)
- **Tenant** — the ISP company (multi-tenant isolation).
- **OrgNode** — a tree (company → group → team → …). Every record has an `owner_node_id`; visibility
  follows the tree.
- **User** — belongs to a tenant + a primary node; has Roles.
- **RBAC** — Role has permissions like `lead.view`/`invoice.create` and a **scope**: `tenant` (all) /
  `subtree` (node + descendants) / `node` (just theirs). Drives what each screen shows.

## CRM entities (CONFIG-driven "Records" — list + detail + form + a status pipeline)
Each has fields + a lifecycle (statuses drive status pills / kanban columns; transitions are the
allowed moves):
- **Lead** — fields: Name*, Phone, Email, Source (Website/Referral/Cold Call/Ad), Status.
  Lifecycle: **NEW → CONTACTED → QUALIFIED → CONVERTED**, or **→ LOST**.
- **Customer** — fields: Name*, Email, Phone, Plan (Basic/Pro/Enterprise), Status.
  Lifecycle: **PROSPECT → ACTIVE ⇄ SUSPENDED → CHURNED**.
- **Contact** — Name*, Email, Phone, Title, Customer(ref). (belongs to a Customer)
- **Deal** — Title*, Value (money ֏), Customer(ref), Status: **OPEN → WON / LOST**.
- **Ticket** — Subject*, Priority (Low/Normal/High/Urgent), Status: **OPEN → IN_PROGRESS → RESOLVED**.
> NOTE: these stages are the DEFAULT example — they're meant to be reconfigurable per ISP.

## BSS / billing (first-class tables)
- **Subscription** — a recurring plan for a customer/account. `amount` (luma per cycle), `product_id`,
  Status: **ACTIVE | SUSPENDED | CANCELLED**.
- **Invoice** — `total` (luma), `due_at`, Status: **DRAFT → ISSUED → PAID**, plus **OVERDUE / VOID**.
  Has **InvoiceLines** (description, qty, unit_amount, line_total — all luma).
- **Payment** — `amount` (luma), `paid_at`, method.
- **Product / Plan** — the catalog a subscription is created from.
- **Order** — `OrderItem`s; lifecycle **DRAFT → SUBMITTED → PROVISIONING → COMPLETED / CANCELLED**;
  on COMPLETED it provisions Subscriptions → Services.

## Service & network
- **Service** — the provisioned thing a subscription delivers (with ServiceResources); lifecycle
  pending → active → suspended → terminated.
- **ResourcePool / PoolAllocation** — IPAM: pools of resources (e.g. IP ranges) allocated/released.
- **UsageRecord** — metered usage that gets rated into invoice lines.

## Party / Account (the billing-relationship layer, new — additive)
- **Party** — WHO: type `individual | organization | carrier`; can have a parent (B2B hierarchy).
- **Account** — THE MONEY: type `residential | business | wholesale`; currency (AMD), billing_cycle,
  optional parent account (HQ → per-site).

## Contact center & comms
- **Interaction** — a contact-center touch (call/chat/email) tied to a customer.
- **Thread / Message** — internal conversations + comments on records.
- **Notification** — in-app inbox (category, priority, read/unread) + per-user preferences.
- **OutboundMessage** — log of every email/SMS/webhook sent (channel, status SENT/FAILED).

## Platform / admin
- **Studio** — configure entities/fields/statuses/transitions (the metadata editor).
- **Dashboards** — configurable widget dashboards. **Report builder** — saved aggregations.
- **Analytics** — fixed exec KPIs: MRR, active subs, AR outstanding, overdue, collected-this-month,
  new leads; revenue trend; subscription mix; AR aging.
- **AI assist** — lead scoring (hot/warm/cold) + record summarize.
- **Webhooks**, **API keys**, **Audit log (Events)**, **i18n** (English + Հայերեն), global **search (⌘K)**.

## Screens that matter most (priority for design)
1. **Dashboard / Analytics** — KPI cards (֏), revenue trend chart, subscription-mix donut, AR-aging.
2. **Customer 360** — one customer: profile + subscriptions + invoices + orders + interactions + accounts.
3. **List + detail + create/edit form** pattern for every CRM entity (with status pills / pipeline).
4. **Invoice detail** (branded, ֏, lines, pay action) + **Billing** views.
5. **Lead pipeline** (kanban by status). **Login**. **Empty / loading / 403** states.

## Layout convention
Dark sidebar (logo + nav groups: Dashboard, Customers, Leads, Invoices, Orders, Services & IP,
Settings) · top bar (global ⌘K search, notifications bell, theme toggle, user) · content with a page
header (breadcrumb + title + actions) then KPIs/table/form.
