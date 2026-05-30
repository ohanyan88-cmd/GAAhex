# Prompt 0: GAAex Studio — Architectural Plan

## 1. Studio Tree — Full Data Structure

**15 Top-Level Groups (in order):**
Experience, Data, Logic, Security, Intelligence, Quality, Release, Governance, System Control, Marketplace, Developer, Notifications, Search, Import / Export, Documentation

### Tree Structure

**Experience** (5 modules, 62 leaves)
- Pages: Page Registry, Page Builder, Routing, Navigation, Breadcrumbs, Meta Tags, SEO, Redirects, Dynamic Pages, Page States, Access Mapping, Visibility Rules, Page Versioning, Page Analytics
- Components: Component Registry, Component Builder, Component Categories, Variants, Slots, Properties, Events, Behaviors, State Management, Component Permissions, Component Versioning, Component Marketplace
- Layouts: Grid System, Containers, Sections, Responsive Rules, Breakpoints, Layout Templates, Layout Library, Layout Conditions, Layout Inheritance
- Templates: CRM, ERP, HRM, LMS, E-Commerce, Portals, Dashboards, Landing Pages, Websites, Custom Templates
- Themes: Brand Identity, Logos, Colors, Typography, Icons, Shadows, Border Radius, Spacing Scale, Animations, Light Mode, Dark Mode, Design Tokens, Theme Inheritance

**Data** (5 modules, 54 leaves)
- Models: Entities, Fields, Relationships, Constraints, Validation, Enumerations, Calculated Fields, Virtual Fields, Audit Fields, Schema Versioning
- Data Sources: PostgreSQL, MySQL, MongoDB, SQL Server, Oracle, Firebase, External APIs, CSV, Excel, Data Warehouses
- APIs: REST, GraphQL, gRPC, Webhooks, API Gateway, API Policies, API Security, Rate Limits, API Monitoring, API Documentation
- Integrations: Payments, Messaging, Email, AI Providers, CRM Systems, ERP Systems, Identity Providers, Cloud Services, Analytics Tools, Custom Connectors
- Assets: Images, Videos, Documents, Fonts, Icons, Audio, Media Optimization, CDN, Asset Versioning

**Logic** (4 modules, 38 leaves)
- Workflows: Workflow Designer, Process Maps, Approval Chains, State Machines, Workflow Variables, Workflow Templates, Workflow Versions, Workflow Logs, Workflow Metrics
- Automations: Triggers, Conditions, Actions, Schedules, Jobs, Queues, Retries, Notifications, Automation History
- Rules Engine: Business Rules, Validation Rules, Decision Trees, Formula Builder, Rule Testing, Rule Versions, Rule Audit
- Events: Event Registry, Event Bus, Event Consumers, Event Producers, Event Replay, Event Logs, Event Monitoring, Dead Letter Queue

**Security** (flat, 17 leaves)
Roles, Permissions, Policies, Authentication, Authorization, MFA, SSO, OAuth, Session Policies, Password Policies, Secrets Vault, Encryption, Certificates, IP Restrictions, Geo Restrictions, Device Trust, Threat Detection

**Intelligence** (3 modules, 23 leaves)
- AI: Models, Providers, Agents, Prompts, Knowledge Bases, RAG, Embeddings, Tool Registry, AI Workflows, Usage Tracking, Cost Monitoring
- Analytics: Dashboards, Reports, KPIs, Funnels, Cohorts, Usage Metrics, Revenue Metrics, Custom Metrics
- Monitoring: Health Checks, Logs, Errors, Traces, Performance, Alerts, Incidents, SLA Tracking

**Quality** (flat, 10 leaves)
Testing, Accessibility, Preview, Versioning, QA Pipelines, Test Data, Regression Testing, Load Testing, Security Testing, Release Validation

**Release** (flat, 9 leaves)
Deployment, Environments, Feature Flags, Release Channels, Blue-Green Deployment, Canary Deployment, Rollbacks, Deployment Pipelines, Release Approvals

**Governance** (flat, 10 leaves)
Audit Logs, Activity History, Compliance, Policies, Data Retention, Legal Documents, Change Management, Risk Management, Data Classification, Governance Reports

**System Control** (flat, 21 leaves)
Platform Settings, Global Configuration, Tenant Management, Multi-Tenancy, Subscription Plans, Billing Engine, Usage Limits, Quotas, Backup Center, Disaster Recovery, Infrastructure, Services, Storage, Cache, Queues, Cron Jobs, Environment Variables, License Management, Maintenance Mode, System Health, Emergency Controls, Danger Zone

**Marketplace** (flat, 4 leaves)
Plugins, Extensions, App Templates, Connector Store

**Developer** (flat, 5 leaves)
Custom Code, SDK, CLI, Webhooks, API Docs

**Notifications** (flat, 5 leaves)
Email Templates, SMS Templates, Push Notifications, In-App Notifications, Notification Rules

**Search** (flat, 4 leaves)
Global Search, Search Indexes, Search Ranking, Search Permissions

**Import / Export** (flat, 4 leaves)
Data Import, Data Export, Template Export, Migration Tools

**Documentation** (flat, 4 leaves)
System Docs, User Guides, API Docs, Changelog

**Summary:** 15 groups, 14 modules (Experience 5, Data 5, Logic 4, Intelligence 3), 7 flat groups, **~276 total leaves**


---

## 2. Pane Archetypes

Five generic archetypes route non-rich leaves based on keyword matching in `archetypeFor(leaf)`:

### table - Registry, catalog, provider list
- When: Leaf matches /registry|categories|library|marketplace|sources|providers.../i
- Renders: Searchable table with New, Edit, Duplicate, Delete, Status toggle
- Leaves: ~140 leaves (most common pattern)

### tokens - Design system, typography, spacing, colors
- When: Leaf matches /typography|shadow|radius|spacing|icons|animation|logos/i
- Renders: Visual token display (swatches, spacing bars, radius demos, typography samples)
- Leaves: ~15 (Colors, Typography, Icons, Shadows, Border Radius, Spacing Scale, Animations)

### monitor - Live observability, logs, metrics, analytics
- When: Leaf matches /logs|monitoring|metrics|traces|errors|health|performance|alerts.../i
- Renders: KPI strip + live log stream with syntax highlighting
- Leaves: ~60 (Activity History, Audit Logs, Health Checks, Logs, Errors, Traces, Performance, etc.)

### canvas - Workflow, process, decision, visual builder
- When: Leaf matches /designer|process maps|decision trees|formula|state machines.../i
- Renders: Left palette (Trigger, Condition, Action, Branch, Delay) + center canvas with linked nodes
- Leaves: ~20 (Workflow Designer, Process Maps, Decision Trees, Formula Builder, Grid System, Layout Builder)

### form - Configuration, settings, policy (default fallback)
- When: No other keyword match
- Renders: Labeled form fields (toggle, select, text, textarea) + Save/Reset buttons
- Leaves: ~40 (Validation, Constraints, Policies, Rules, Configuration, Settings)

Tally: table ~140, monitor ~60, canvas ~20, tokens ~15, form ~40 = ~275 leaves covered

---

## 3. Rich Builders

13 unique components (PageManager, LayoutBuilder, ComponentsLibrary, ContentEditor, DataBinding, ActionsLogic, Permissions, PreviewMode, VersionHistory, Templates, PublishSettings, AppearancePane, EntityBuilder)

---

## 4. The 9-Layer Overview Model

Experience (monitor) "What users see" uses
  Data (database) "What users store" controlled by
  Logic (zap) "What the system does" protected by
  Security (shield) "Who can do it" enhanced by
  Intelligence (sparkles) "How system thinks" verified by
  Quality (check) "How changes tested" published by
  Release (rocket) "How changes go live" tracked by
  Governance (gavel) "How changes tracked" managed by
  System Control (settings) "How platform runs"

Module counts: Experience 5, Data 5, Logic 4, Intelligence 3, others flat
Support groups: 6 (Marketplace, Developer, Notifications, Search, Import/Export, Documentation)

---

## 5. File/Route Plan

### Folder Structure
frontend/src/studio/ with StudioView.tsx, StudioTree.tsx, StudioOverview.tsx, tree.ts, archetypes/, builders/

### Routing
Sub-router pattern: App -> {type:'studio'} -> StudioView (/:group?/:module?/:leaf?)
Deep-linkable: /studio, /studio/experience, /studio/experience/pages/page-registry

### CSS Migration
~350-400 lines from handoff/studio-kit-app.css to frontend/src/styles/ (new studio.css or main styles.css)

### SuperAdmin Gating
Backend: require_studio_access decorator on future Studio endpoints using can(grants, "config", "manage")
Frontend: Studio nav item already adminOnly:true in nav-config.ts line 241

### Existing nav-config Conflict
21-leaf "studio" section (lines 218-241) should be replaced with single "Studio" entry pointing to /studio
New tree-driven model supersedes all 21 items

---

## 6. Open Questions for Gev

1. SuperAdmin role clarity: Is can_configure the SuperAdmin tier, or new role above admin?
2. Existing StudioView.tsx: Delete entirely or keep as legacy entity builder?
3. The 21-leaf Studio nav section: Collapse to single entry, delete, or keep as is?
4. Legacy studio components: Integrate into new Studio or keep as bespoke views?
5. Rich builder registration: Registry/lookup table or keep window global approach?
6. CSS organization: Single styles.css or new separate studio.css?
7. Legacy builder porting: Reuse current TS StudioView implementations or port from kit?

---

## Summary

15 groups | 14 modules | 7 flat groups | 276+ leaves | 13 rich builders | 5 archetypes
350-400 CSS lines | 7+ new TS files | 9-layer overview | 6 support groups
Ready for Gev approval before Prompt 1 coding begins.

