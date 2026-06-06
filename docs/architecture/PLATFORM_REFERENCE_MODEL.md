# GAAhex Full Platform Reference Model

This is the full WHAT model for GAAhex. It defines the platform cores, their ownership boundaries, what each core owns, what it must not own, and which HOW architecture viewpoints govern it.

## Architecture Law

> Every feature, page, table, endpoint, job, integration, automation, report, AI action, and portal capability must map to exactly one primary Platform Core and may reference multiple supporting cores. No feature is approved until its core ownership, permissions, tenant posture, audit/event posture, API posture, and navigation placement are known.

## Locked Platform Core Tree
```text
FOUNDATION
├─ Governance
├─ Identity
├─ Tenant
├─ Security
├─ Compliance
├─ Audit
├─ Configuration
├─ Policy
├─ Entitlement
├─ Observability
└─ Time

BUSINESS OBJECTS
├─ Party
├─ Organization
├─ Location
├─ Resource
├─ Product
├─ Service
├─ Contract
├─ Work
└─ Knowledge

BUSINESS COMMERCE
└─ Financial

BUSINESS EXECUTION
├─ Case
├─ Workflow
├─ Automation
├─ Approval
├─ SLA
├─ Scheduling
├─ Communication
├─ Notification
└─ Document

PLATFORM SERVICES
├─ Data
├─ Metadata
├─ Relationship
├─ Search
├─ Event
├─ Integration
├─ Developer Platform
├─ Background Processing
├─ Import/Export
├─ Template
└─ Storage

INTELLIGENCE
├─ Analytics
├─ Reporting
├─ AI
├─ Forecasting
└─ Decision Support

EXPERIENCE
├─ Workspace
├─ Portal
├─ Mobile
├─ Marketplace
└─ Localization

```

## Core Status Summary for Current Repo

- **STRONG:** 8 cores
- **PARTIAL:** 37 cores
- **WEAK:** 4 cores
- **MISSING:** 2 cores

Interpretation: GAAhex is already structurally mature, but most cores need hardening into explicit ownership, APIs, events, permissions, and UI placement. The main missing reserved cores are **Forecasting** and **Marketplace**.

# FOUNDATION

## Governance Core

**Current GAAhex status:** PARTIAL

**Purpose:** Defines platform-level rules, standards, decision ownership, lifecycle controls, and architecture law.

**Owns:** Platform standards, design approval rules, lifecycle states, governance boards, exception process, standards registry.

**Does not own:** Executable policy decisions, user permissions, billing entitlements, audit evidence storage.

**Governed by HOW viewpoints:** Governance, Security, Tenant, Observability

**Hard boundary rule:** Every core must register standards and exceptions here; Governance cannot become a dumping ground for settings.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Identity Core

**Current GAAhex status:** STRONG

**Purpose:** Manages human and non-human actors that authenticate into the platform.

**Owns:** Users, service accounts, API clients, sessions, SSO identities, MFA state, identity lifecycle.

**Does not own:** Tenant commercial plans, business roles hidden in modules, record-level business ownership.

**Governed by HOW viewpoints:** Permission, Security, Tenant, API

**Hard boundary rule:** Identity authenticates actors; Permission authorizes actions; Tenant scopes access.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Tenant Core

**Current GAAhex status:** STRONG

**Purpose:** Provides multi-tenant isolation, tenant lifecycle, white-label boundaries, and tenant-scoped defaults.

**Owns:** Tenants, tenant profiles, tenant status, tenant hierarchy, tenant branding links, tenant data boundaries.

**Does not own:** Identity credentials, subscriptions, application feature logic, domain-specific ownership.

**Governed by HOW viewpoints:** Tenant / White-label, Security, Data, Experience

**Hard boundary rule:** All business data must be tenant-scoped unless explicitly global reference data.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Security Core

**Current GAAhex status:** PARTIAL

**Purpose:** Protects the platform from unauthorized access, abuse, leakage, tampering, and unsafe execution.

**Owns:** Encryption posture, secrets, token security, rate limiting, idempotency, threat controls, secure defaults.

**Does not own:** Compliance workflows, audit history, business permissions, entitlement plans.

**Governed by HOW viewpoints:** Security, API, Infrastructure, Observability

**Hard boundary rule:** Security is mandatory across every API, job, integration, AI action, and marketplace extension.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Compliance Core

**Current GAAhex status:** PARTIAL

**Purpose:** Manages regulatory, privacy, retention, export/delete, and evidence obligations.

**Owns:** Privacy requests, retention policies, consent controls, regulatory evidence, data subject operations.

**Does not own:** Raw audit log generation, general security controls, business approvals unless compliance-specific.

**Governed by HOW viewpoints:** Governance, Security, Data, Reporting

**Hard boundary rule:** Compliance consumes Audit; Compliance does not replace Audit.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Audit Core

**Current GAAhex status:** STRONG

**Purpose:** Records immutable evidence of meaningful system, data, security, and business changes.

**Owns:** Audit logs, access logs, change history, event evidence, actor/context/IP/source metadata.

**Does not own:** Operational metrics, analytics facts, notification history unless evidence-grade.

**Governed by HOW viewpoints:** Event, Data, Compliance, Observability

**Hard boundary rule:** Every mutation must produce auditable context; no silent administrative changes.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Configuration Core

**Current GAAhex status:** STRONG

**Purpose:** Stores controlled runtime, tenant, module, and environment configuration.

**Owns:** Tenant settings, module settings, environment config, runtime config, config schemas, config versioning.

**Does not own:** Entitlements, policies, arbitrary custom fields, user preferences unless defined as config.

**Governed by HOW viewpoints:** Governance, Tenant, Security, Experience

**Hard boundary rule:** Configuration changes must be audited, permissioned, and rollback-safe.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Policy Core

**Current GAAhex status:** PARTIAL

**Purpose:** Executes decision logic used by security, business rules, routing, approvals, retention, and automation.

**Owns:** Policy definitions, conditions, policy evaluation, decision records, policy versions.

**Does not own:** Governance documentation, role assignment, plan entitlements, workflow state machine definitions.

**Governed by HOW viewpoints:** Permission, Workflow, Security, Governance

**Hard boundary rule:** Policy is executable. Governance is normative. Permission is access. Entitlement is availability.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Entitlement Core

**Current GAAhex status:** PARTIAL

**Purpose:** Determines which tenant, plan, user, customer, API client, or module can use which capability.

**Owns:** Plans, features, quotas, limits, usage meters, module access, API limits, portal entitlements.

**Does not own:** RBAC permissions, raw billing invoices, tenant identity, feature implementation.

**Governed by HOW viewpoints:** Tenant, Governance, API, Marketplace

**Hard boundary rule:** Every paid/plan/limit-gated capability must route through Entitlement, not ad-hoc flags.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Observability Core

**Current GAAhex status:** PARTIAL

**Purpose:** Makes the platform operable through health, metrics, logs, traces, alerts, and runtime diagnostics.

**Owns:** Health checks, metrics, traces, logs, alert rules, service status, operational dashboards.

**Does not own:** Audit evidence, business reporting, analytics KPIs unless derived for ops monitoring.

**Governed by HOW viewpoints:** Observability, Infrastructure, Event, Security

**Hard boundary rule:** Every API, worker, job, integration, and critical workflow must expose observability signals.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Time Core

**Current GAAhex status:** PARTIAL

**Purpose:** Provides canonical time rules across tenant, SLA, scheduling, billing, maintenance, shifts, and recurrence.

**Owns:** Timezones, business hours, holidays, calendars, shifts, recurrence rules, availability windows, SLA clocks.

**Does not own:** Work scheduling itself, financial amounts, workflow state transitions.

**Governed by HOW viewpoints:** Workflow, Operational, Data, Tenant

**Hard boundary rule:** No module may implement its own timezone, business-hours, or recurrence logic.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# BUSINESS OBJECTS

## Party Core

**Current GAAhex status:** PARTIAL

**Purpose:** Represents people and organizations that participate in business relationships.

**Owns:** Persons, customers, contacts, employees, partners, vendors, contractors, household/company parties.

**Does not own:** Auth users, tenant records, org chart nodes unless modeled as party relationships.

**Governed by HOW viewpoints:** Domain, Information, Data, API, Permission

**Hard boundary rule:** Customer, vendor, partner, employee must not become isolated duplicate tables without Party linkage.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Organization Core

**Current GAAhex status:** STRONG

**Purpose:** Models internal and external organizational structure used for operations and reporting.

**Owns:** Business units, departments, teams, branches, org nodes, reporting hierarchy, ownership hierarchy.

**Does not own:** Tenant boundary, party identity, RBAC alone.

**Governed by HOW viewpoints:** Domain, Information, Permission, Reporting

**Hard boundary rule:** Organization is a business structure; Tenant is SaaS isolation; Party is real-world actor.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Location Core

**Current GAAhex status:** PARTIAL

**Purpose:** Models geographic, service, operational, and physical places.

**Owns:** Countries, regions, cities, districts, sites, buildings, floors, rooms, racks, service areas, GPS references.

**Does not own:** Network resources themselves, tenant region policy, address validation service unless separate.

**Governed by HOW viewpoints:** Information, Data, Operational, Analytics

**Hard boundary rule:** All address/site/service-area logic must use Location Core.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Resource Core

**Current GAAhex status:** PARTIAL

**Purpose:** Represents assets, devices, inventory, network elements, tools, licenses, vehicles, and physical/digital resources.

**Owns:** Assets, OLTs, ONUs, routers, switches, fiber, IP pools, stock items, vehicles, tools, software licenses.

**Does not own:** Products sold, customer service instances, work orders.

**Governed by HOW viewpoints:** Domain, Information, Operational, Data

**Hard boundary rule:** Resource is what exists physically/digitally; Service is what is delivered; Product is what is sold.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Product Core

**Current GAAhex status:** PARTIAL

**Purpose:** Defines catalog offerings that can be sold, ordered, bundled, rated, or provisioned.

**Owns:** Product catalog, plans, bundles, add-ons, technical product definitions, price model links.

**Does not own:** Active customer services, invoices, contracts, inventory devices.

**Governed by HOW viewpoints:** Domain, Data, API, Financial

**Hard boundary rule:** Product is catalog truth; Service is active/customer-specific realization.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Service Core

**Current GAAhex status:** PARTIAL

**Purpose:** Represents active or planned service instances delivered to customers or internal parties.

**Owns:** Subscriptions, service instances, service lifecycle, provisioning state, dependencies, service topology.

**Does not own:** Product catalog, contract text, network resource inventory, invoices.

**Governed by HOW viewpoints:** Domain, Information, Workflow, Event

**Hard boundary rule:** Service is the operational bridge between Customer, Product, Resource, Location, Contract, and Financial.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Contract Core

**Current GAAhex status:** PARTIAL

**Purpose:** Controls formal agreements, terms, obligations, renewals, amendments, and commitments.

**Owns:** Contracts, terms, amendments, renewals, signatures, obligations, contract-service/customer links.

**Does not own:** Invoices, product definitions, general documents unless contract-specific.

**Governed by HOW viewpoints:** Domain, Document, Financial, Compliance

**Hard boundary rule:** Contracts govern services and financial commitments but do not replace billing or document storage.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Work Core

**Current GAAhex status:** STRONG

**Purpose:** Represents planned work units independent of case/ticket semantics.

**Owns:** Tasks, work items, work orders, field jobs, project tasks, maintenance jobs, assignments.

**Does not own:** Incidents/complaints as case records, workflow definitions, employee identity.

**Governed by HOW viewpoints:** Operational, Workflow, Permission, Analytics

**Hard boundary rule:** Work is execution. Case is issue/request management. Workflow controls lifecycle.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Knowledge Core

**Current GAAhex status:** WEAK

**Purpose:** Stores operational and customer-facing knowledge used to resolve work, cases, and self-service.

**Owns:** Articles, SOPs, runbooks, troubleshooting trees, FAQs, internal guides, public help articles.

**Does not own:** Documents as files, comments, AI answers without sources.

**Governed by HOW viewpoints:** Experience, AI, Search, Governance

**Hard boundary rule:** Knowledge must support visibility, approval, versioning, localization, and source trust.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# BUSINESS COMMERCE

## Financial Core

**Current GAAhex status:** PARTIAL

**Purpose:** Owns commercial money flows across pricing, ordering, billing, payments, revenue, cost, and accounting integration.

**Owns:** Quotes, orders, pricing, rating, invoices, payments, taxes, discounts, credits, dunning, revenue/cost tracking.

**Does not own:** Product catalog, service lifecycle, contract legal terms, payment gateway secrets.

**Governed by HOW viewpoints:** Financial/Commerce, Data, API, Compliance, Reporting

**Hard boundary rule:** Financial cannot be buried under Product or Contract; it is its own commerce domain.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# BUSINESS EXECUTION

## Case Core

**Current GAAhex status:** PARTIAL

**Purpose:** Handles requests, tickets, incidents, problems, complaints, changes, and escalations.

**Owns:** Tickets, incidents, service requests, complaints, problem records, change requests, case queues.

**Does not own:** Work orders, workflow engine definitions, communication messages themselves.

**Governed by HOW viewpoints:** Operational, Workflow, SLA, Experience

**Hard boundary rule:** Case is customer/operations issue container; Work is execution; SLA measures commitments.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Workflow Core

**Current GAAhex status:** STRONG

**Purpose:** Controls state machines, transitions, lifecycle definitions, gates, and allowed movements.

**Owns:** Workflow definitions, states, transitions, lifecycle rules, workflow instances, transition history.

**Does not own:** Automation triggers/actions, approvals as evidence/signoff, SLA timing rules.

**Governed by HOW viewpoints:** Workflow, Event, Permission, Governance

**Hard boundary rule:** Do not hardcode statuses in modules; all lifecycle movement must use Workflow Core.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Automation Core

**Current GAAhex status:** PARTIAL

**Purpose:** Runs trigger-condition-action rules and low/no-code operational automations.

**Owns:** Automation rules, triggers, conditions, actions, executions, failures, retry policy links.

**Does not own:** Workflow state model, background job infrastructure, security policy decisions.

**Governed by HOW viewpoints:** Workflow, Event, Security, Observability

**Hard boundary rule:** Automation may act only through approved APIs/events and must be audited.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Approval Core

**Current GAAhex status:** PARTIAL

**Purpose:** Manages formal human/system signoff, delegation, evidence, escalation, and approval chains.

**Owns:** Approval requests, chains, approvers, delegation, voting, signoff evidence, approval outcomes.

**Does not own:** Workflow state model, policy engine, compliance evidence store unless approval-specific.

**Governed by HOW viewpoints:** Workflow, Permission, Compliance, Audit

**Hard boundary rule:** Approvals can be invoked by workflows, policy, financial actions, documents, and governance exceptions.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## SLA Core

**Current GAAhex status:** PARTIAL

**Purpose:** Measures time-based commitments for response, resolution, availability, escalation, and breach handling.

**Owns:** SLA definitions, clocks, pauses, targets, breach records, escalation triggers, service availability targets.

**Does not own:** Scheduling, generic time calendars, workflow state definitions.

**Governed by HOW viewpoints:** Operational, Time, Analytics, Notification

**Hard boundary rule:** SLA must depend on Time Core, not each module’s local date math.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Scheduling Core

**Current GAAhex status:** PARTIAL

**Purpose:** Plans people, jobs, resources, appointments, maintenance windows, and recurring operational activities.

**Owns:** Schedules, appointments, dispatch slots, maintenance windows, capacity slots, calendar bookings.

**Does not own:** Canonical time rules, background cron execution, workflow lifecycle.

**Governed by HOW viewpoints:** Operational, Time, Mobile, Workforce

**Hard boundary rule:** Scheduling uses Time Core for business hours/timezones and Work Core for assigned work.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Communication Core

**Current GAAhex status:** PARTIAL

**Purpose:** Provides conversation primitives across modules.

**Owns:** Threads, messages, comments, notes, mentions, channels, internal/external conversation links.

**Does not own:** Notification delivery, document files, knowledge articles.

**Governed by HOW viewpoints:** Experience, Permission, Audit, Search

**Hard boundary rule:** Comments, notes, and messages must not be reimplemented per module.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Notification Core

**Current GAAhex status:** PARTIAL

**Purpose:** Delivers messages through channels and tracks delivery outcomes.

**Owns:** Email, SMS, push, in-app notifications, webhook notifications, preferences, delivery status.

**Does not own:** Communication threads, template content ownership, integration connectors.

**Governed by HOW viewpoints:** Integration, Template, Preference, Observability

**Hard boundary rule:** Notification sends; Communication stores conversation; Template renders content.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Document Core

**Current GAAhex status:** PARTIAL

**Purpose:** Manages business documents and file-attached document records.

**Owns:** Documents, attachments, generated PDFs, versions, signatures, document metadata, document lifecycle.

**Does not own:** Raw blob storage infrastructure, knowledge articles, templates themselves.

**Governed by HOW viewpoints:** Data, Storage, Compliance, Experience

**Hard boundary rule:** Document is the business object; Storage stores bytes; Template generates content.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# PLATFORM SERVICES

## Data Core

**Current GAAhex status:** PARTIAL

**Purpose:** Defines source-of-truth data ownership, reference data, quality, retention, lineage, and lifecycle.

**Owns:** Master data, reference data, data quality rules, canonical schemas, ownership, lineage.

**Does not own:** Metadata custom fields, analytics warehouse models, database infrastructure alone.

**Governed by HOW viewpoints:** Data, Security, Tenant, Governance

**Hard boundary rule:** Every entity must have an owner core and data lifecycle rules.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Metadata Core

**Current GAAhex status:** PARTIAL

**Purpose:** Enables controlled extensibility of fields, forms, schemas, labels, layouts, and tenant/module customization.

**Owns:** Custom fields, dynamic schemas, dynamic forms, page field definitions, validation metadata.

**Does not own:** Core database schema for canonical fields, arbitrary ungoverned JSON blobs.

**Governed by HOW viewpoints:** Data, Experience, Tenant, API

**Hard boundary rule:** Metadata can extend core models but must not hide missing canonical entities.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Relationship Core

**Current GAAhex status:** PARTIAL

**Purpose:** Manages cross-entity links, dependency graphs, hierarchies, and impact paths.

**Owns:** Entity relationships, dependency graphs, customer-service-resource-location links, topology relations.

**Does not own:** Foreign keys owned by one bounded context only, search index, navigation grouping.

**Governed by HOW viewpoints:** Information, Data, Search, Analytics

**Hard boundary rule:** ISP impact analysis depends on Relationship Core: Customer -> Service -> ONU -> Fiber -> OLT -> Site.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Search Core

**Current GAAhex status:** PARTIAL

**Purpose:** Provides global and scoped retrieval, filtering, indexing, saved views, and discovery.

**Owns:** Search indexes, global search, saved filters, saved views, query history, result permissions.

**Does not own:** Reporting datasets, analytics facts, relationship graph storage.

**Governed by HOW viewpoints:** Data, Permission, Experience, AI

**Hard boundary rule:** Search results must enforce permissions, tenant isolation, and visibility.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Event Core

**Current GAAhex status:** STRONG

**Purpose:** Publishes and stores domain events used for integration, automation, audit, analytics, and async processing.

**Owns:** Domain events, event bus, event store, event schema registry, replay policy, idempotency keys.

**Does not own:** Audit logs as evidence, webhook delivery implementation, background job queues.

**Governed by HOW viewpoints:** Event, Integration, Observability, Audit

**Hard boundary rule:** All significant domain changes should emit stable versioned events.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Integration Core

**Current GAAhex status:** PARTIAL

**Purpose:** Connects the platform to external systems and partner systems.

**Owns:** Connectors, webhooks, inbound/outbound integrations, sync jobs, credentials references, mapping rules.

**Does not own:** Developer portal UX, event store, API platform itself.

**Governed by HOW viewpoints:** Integration, API, Security, Event

**Hard boundary rule:** Integrations must use API/Event/Background Processing and be observable and auditable.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Developer Platform Core

**Current GAAhex status:** PARTIAL

**Purpose:** Exposes the platform safely to developers and partners.

**Owns:** API keys, OAuth apps, developer docs, SDKs, sandbox apps, API logs, app registration.

**Does not own:** Internal integrations, marketplace commercial listing, end-user portal features.

**Governed by HOW viewpoints:** API, Marketplace, Security, Governance

**Hard boundary rule:** API-first platform requires Developer Platform as a first-class core, not just API keys.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Background Processing Core

**Current GAAhex status:** PARTIAL

**Purpose:** Runs asynchronous and long-running work reliably.

**Owns:** Queues, workers, scheduled jobs, retries, dead-letter queues, job runs, job ownership.

**Does not own:** Business scheduling, automation rules, integration semantics.

**Governed by HOW viewpoints:** Infrastructure, Observability, Event, Security

**Hard boundary rule:** Every async job must have ownership, retries, idempotency, observability, and audit context.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Import/Export Core

**Current GAAhex status:** PARTIAL

**Purpose:** Controls bulk data movement in and out of the platform.

**Owns:** CSV/Excel imports, exports, migrations, validation previews, batch jobs, scheduled exports.

**Does not own:** Integrations, reporting, storage blobs.

**Governed by HOW viewpoints:** Data, Security, Compliance, Background Processing

**Hard boundary rule:** Bulk operations must be permissioned, tenant-scoped, auditable, resumable, and rollback-aware.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Template Core

**Current GAAhex status:** WEAK

**Purpose:** Renders reusable content across communication, documents, reports, invoices, and portals.

**Owns:** Email templates, SMS templates, PDF templates, contract templates, invoice templates, report templates.

**Does not own:** Generated documents, notification delivery, localization dictionary itself.

**Governed by HOW viewpoints:** Experience, Localization, Document, Notification

**Hard boundary rule:** Templates require versioning, localization, preview, approval, and tenant override rules.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Storage Core

**Current GAAhex status:** PARTIAL

**Purpose:** Provides file/blob storage infrastructure and lifecycle controls.

**Owns:** Blob storage, object keys, storage providers, virus scan status, retention, signed URL policy.

**Does not own:** Business documents, knowledge articles, metadata schemas.

**Governed by HOW viewpoints:** Infrastructure, Security, Compliance, Document

**Hard boundary rule:** Storage stores bytes; Document owns business meaning.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# INTELLIGENCE

## Analytics Core

**Current GAAhex status:** PARTIAL

**Purpose:** Turns operational data into KPIs, dashboards, trends, and management insight.

**Owns:** KPI definitions, metric models, dashboard datasets, aggregations, analytical dimensions.

**Does not own:** Operational reports, audit logs, raw event bus, forecasting models.

**Governed by HOW viewpoints:** Analytics, Data, Reporting, Governance

**Hard boundary rule:** Analytics is for insight; Reporting is for formatted extractable output.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Reporting Core

**Current GAAhex status:** PARTIAL

**Purpose:** Produces governed reports, scheduled reports, exports, and printable operational/commercial outputs.

**Owns:** Report definitions, report schedules, report parameters, report permissions, generated report files.

**Does not own:** KPI logic, AI insights, raw search saved views unless promoted.

**Governed by HOW viewpoints:** Reporting, Data, Permission, Localization

**Hard boundary rule:** Reporting must have permission, tenant, localization, export, and audit rules.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## AI Core

**Current GAAhex status:** WEAK

**Purpose:** Adds AI-assisted search, summarization, recommendations, agents, and controlled AI actions.

**Owns:** AI assistants, prompts, tools/actions, knowledge sources, model configs, AI audit logs, human approval gates.

**Does not own:** Automation engine, analytics engine, raw knowledge base content.

**Governed by HOW viewpoints:** AI, Security, Permission, Governance

**Hard boundary rule:** AI must never bypass permissions, tenant isolation, audit, policy, or approval.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Forecasting Core

**Current GAAhex status:** MISSING

**Purpose:** Predicts future demand, workload, revenue, churn, capacity, network growth, and operational risk.

**Owns:** Forecast models, input datasets, forecast runs, confidence, scenarios, capacity/revenue/demand forecasts.

**Does not own:** Analytics dashboards, generic AI suggestions, reports.

**Governed by HOW viewpoints:** Analytics, AI, Data, Operational

**Hard boundary rule:** Forecasting must be first-class, especially for ISP capacity, workforce, revenue, and churn planning.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Decision Support Core

**Current GAAhex status:** PARTIAL

**Purpose:** Helps users choose actions through recommendations, scoring, rules, and explainable decision aids.

**Owns:** Decision models, scores, recommendations, next-best-action, impact analysis, explanation records.

**Does not own:** Final approval authority, autonomous AI execution, analytics dashboards alone.

**Governed by HOW viewpoints:** Analytics, AI, Workflow, Governance

**Hard boundary rule:** Decision Support recommends; users/policies/workflows approve and execute.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# EXPERIENCE

## Workspace Core

**Current GAAhex status:** PARTIAL

**Purpose:** Defines the internal employee/admin application shell and work surfaces.

**Owns:** Left nav, top nav, dashboards, boards, tables, detail pages, drawers, command palette, page registry.

**Does not own:** Core domain ownership, tenant branding, customer portal UX.

**Governed by HOW viewpoints:** Navigation, Experience, Permission, Tenant

**Hard boundary rule:** Workspace navigation must follow user workflows, not platform core names.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Portal Core

**Current GAAhex status:** PARTIAL

**Purpose:** Provides external self-service experiences for customers, partners, vendors, and other external users.

**Owns:** Customer portal, partner portal, vendor portal, portal auth surfaces, portal requests, portal visibility rules.

**Does not own:** Internal workspace pages, tenant admin configuration, public marketing site.

**Governed by HOW viewpoints:** Experience, Tenant, Security, Localization

**Hard boundary rule:** Portal must be permissioned, tenant-branded, localized, and bounded from internal workspace data.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Mobile Core

**Current GAAhex status:** WEAK

**Purpose:** Provides mobile and offline-capable operational experiences.

**Owns:** Mobile app shell, mobile navigation, offline sync, device trust, field technician flows, push actions.

**Does not own:** Responsive web only, generic portal UI, desktop workspace.

**Governed by HOW viewpoints:** Mobile / Offline, Experience, Security, Operational

**Hard boundary rule:** Mobile is not just small desktop; field/service workflows need offline-first rules.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Marketplace Core

**Current GAAhex status:** MISSING

**Purpose:** Enables extensions, plugins, apps, connectors, and partner ecosystem packaging.

**Owns:** Apps, extensions, plugin permissions, install lifecycle, app review, app entitlements, marketplace listings.

**Does not own:** Developer API itself, internal integrations, feature flags.

**Governed by HOW viewpoints:** Marketplace, Developer Platform, Security, Entitlement

**Hard boundary rule:** Marketplace must be reserved now even if implemented later, to prevent closed architecture.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

## Localization Core

**Current GAAhex status:** PARTIAL

**Purpose:** Supports language, currency, time, formatting, translations, regional rules, and tenant/customer locale.

**Owns:** Translations, locale profiles, currency display, regional formats, multilingual content, fallback rules.

**Does not own:** Business time calculations, pricing rules, tax laws unless financial/compliance-specific.

**Governed by HOW viewpoints:** Experience, Template, Tenant, Reporting

**Hard boundary rule:** Every user-facing string and template must be localization-ready.

**Minimum hardening artifacts required:**
- Canonical entities and state model
- Ownership and anti-overlap rules
- API surface and service boundary
- Event contracts and audit records
- Permission, policy, entitlement, and tenant rules
- UI/navigation placement rules
- Reporting/analytics exposure rules
- Test and migration requirements

# Required Implementation Sequence

Do not implement all cores randomly. Harden them in this order:

- 1. Freeze Platform Reference Model as architecture law.
- 2. Create Core Ownership Matrix: one primary owner per entity, API, page, event, and job.
- 3. Create Domain Map: CRM, OSS, BSS, Network, Inventory, Workforce, Billing, Portal, Studio, Automation, Reporting, Administration.
- 4. Create Information Model: Customer -> Service -> Contract -> Financial -> Case/Work -> Resource -> Location relationships.
- 5. Create Navigation Architecture: left nav grouped by user workflows, not core names.
- 6. Harden Permission/Policy/Entitlement separation.
- 7. Harden Event/Audit/Observability rules for every mutation and background job.
- 8. Harden Template, Knowledge, AI, Forecasting, Mobile, and Marketplace before expanding feature depth.

# Non-Negotiable Separation Rules

- Governance is not Policy. Governance defines standards; Policy executes decisions.
- Permission is not Entitlement. Permission controls access; Entitlement controls availability/limits by plan, tenant, feature, or usage.
- Tenant is not Organization. Tenant is SaaS isolation; Organization is business structure.
- Product is not Service. Product is catalog; Service is active customer/internal delivery.
- Resource is not Service. Resource is asset/inventory/network; Service is customer/business outcome.
- Case is not Work. Case captures issue/request context; Work executes tasks/jobs/orders.
- Workflow is not Automation. Workflow controls lifecycle; Automation reacts and performs actions.
- Communication is not Notification. Communication stores conversation; Notification delivers messages.
- Document is not Storage. Document owns business meaning; Storage stores bytes.
- Analytics is not Reporting. Analytics explains performance; Reporting produces governed outputs.
- Workspace is not Platform Core. Workspace is user experience; cores are ownership boundaries.
- Navigation must never mirror Platform Core taxonomy directly.

# Immediate Gap List

- **Forecasting:** Create first-class forecast definitions, forecast runs, inputs, confidence, scenario support, and capacity/revenue/workload/churn/network-demand models.
- **Marketplace:** Reserve extension/app model, install lifecycle, app permissions, tenant entitlements, app review, plugin security, and partner packaging.
- **Knowledge:** Promote helpdesk knowledge to first-class SOP/runbook/article/troubleshooting model with approval, versioning, visibility, and localization.
- **Template:** Create unified template engine for email, SMS, PDF, contract, invoice, report, and portal templates with versioning and preview.
- **AI:** Define AI permissions, audit, action boundaries, prompt/model/version registry, knowledge source controls, tenant isolation, and approval gates.
- **Mobile:** Define offline sync, conflict resolution, device trust, technician workflow, push action model, and mobile-specific navigation.
- **Policy/Entitlement:** Separate executable policy, commercial/platform entitlement, RBAC permission, and governance standards.
- **Time:** Centralize business hours, holidays, timezone, shifts, recurrence, maintenance windows, SLA clocks, and billing cycles.

# Final Rule

> After this document is accepted, new modules must not be added directly to the left nav, database, API, or workflow engine without first mapping them to this reference model. The platform must evolve by strengthening cores and domains, not by creating disconnected features.