# 01 — Strategic Product Direction

## Strategic Product Direction Standard — LOCKED

This standard sits above all UI, workflow, navigation, platform, API, tenant, and
architecture standards. No other standard may contradict it.

S3 patch: the strategic decisions below are **direction**. The enforceable detail lives in
the implementable standards named in each section. This file points to them and does not
restate their full definitions.

### Device Strategy
Locked direction: **Desktop-first, Mobile-complete.** Desktop is the primary optimization
target (Support, NOC, Dispatch, Sales, Billing, Administration, Management — dense, multi-
dataset, rapid record switching). Mobile is mandatory and first-class; every core workflow
must remain usable on mobile. No desktop-only business capabilities.
→ Enforced by: **Device Strategy Standard** (file 10).

### Interface Density
Locked direction: **Dense Operational UI**, in the family of Linear / Jira / Datadog /
Grafana / enterprise operations consoles. Not spacious marketing-CRM patterns.
→ Enforced by: **Interface Density Standard** (file 10).

### Object Editing
Locked direction: **Hybrid editing.** Side drawers ≈70% of edits; dedicated pages for
complex workspaces; modals only for confirmations and lightweight actions.
→ Enforced by: **Object Editing Standard**, **Drawer Standard**, **Modal Standard** (file 10, 09).

### Multi-Brand / White-Label
Supported by architecture from the start, even if not initially enabled: multiple brands,
organizations, themes, domains, communications, configuration — without redesign.
White-label must be configuration-driven, never fork-driven. Forbidden: customer-specific
code branches, tenant-specific codebases, tenant-specific schemas.
→ Enforced by: **Multi-Tenant Standard**, **Configuration Standard**, **Feature Flag Standard** (file 08).

### Customer Portal
A core platform capability, not a separate product or future bolt-on. Future scope:
auth, service management, billing, payments, invoice history, ticket create/track,
communications, knowledge base, network status, contract and document access. The portal
shares object model, permissions, events, audit, notifications, APIs, and automation with
the operational platform. No parallel systems, no separate customer portal data models.

### API
Locked direction: **API-first.** Every major business capability is API-accessible. No
business logic that exists only in UI workflows. Architecture supports REST, webhooks,
API keys, OAuth, and event-driven integrations from the start.
→ Enforced by: **API Standard**, **Webhook Standard**, **Integration Standard** (file 12, 06).

### Future Developer Ecosystem
Architecture must allow future developer portal, API marketplace, integration catalog,
third-party apps, and partner ecosystem without major redesign.

### Strategic Platform Direction
The platform must be able to evolve into CRM, ERP, ISP OSS/BSS, Customer Portal, Workforce
Management, Communications Platform, Automation Platform, and Partner Ecosystem without
major architectural redesign.

### Architecture Implications
All standards assume: multi-tenant, event-driven, audit-first, API-first, automation-first,
enterprise scale, white-label ready, customer-portal ready, ecosystem ready.

### Hard MUST
Optimize primarily for desktop; fully support mobile; dense operational UI; drawers primary;
dedicated pages for complex workspaces; limit modals; support white-label, customer portal,
API-first, ecosystem, and enterprise scale.

### Hard MUST NOT
Become mobile-first; adopt spacious CRM patterns; force complex workflows into modals;
require rewrites for white-label / customer portal / APIs; create separate portal data
models; create tenant-specific code or schema forks; create UI-only business logic.

### Locked Decision
This strategic direction is final. No future standard may contradict it.
