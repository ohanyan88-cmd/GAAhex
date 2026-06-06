# 00 — Architecture Index

**Constitutional index.** This file is the entry point to the GAAhex
Architecture Constitution. It binds the Platform Reference Model (PRM) to
the 22 Architecture Constitution documents and to the LOCKED Standards
beneath them.

---

## The Architecture Hierarchy

```
PLATFORM_REFERENCE_MODEL.md
        │
        ▼
22 Architecture Constitution Documents      (this directory, files 01–22)
        │
        ▼
Standards                                   (docs/standards/, 70 LOCKED + 7 named)
        │
        ▼
Domains                                     (12 canonical, defined in 02)
        │
        ▼
Modules                                     (backend packages, frontend routes)
        │
        ▼
Pages                                       (PageShell consumers)
        │
        ▼
Components                                  (UI primitives)
        │
        ▼
Implementation                              (the running code)
```

**No implementation document may contradict the Architecture Constitution. No
standard may contradict the Architecture Constitution. No module design may
contradict the Architecture Constitution.**

---

## Root: Platform Reference Model

| File | Role |
|---|---|
| [`PLATFORM_REFERENCE_MODEL.md`](PLATFORM_REFERENCE_MODEL.md) | Constitutional source of truth. 51 platform cores across 7 tiers (FOUNDATION / BUSINESS OBJECTS / BUSINESS COMMERCE / BUSINESS EXECUTION / PLATFORM SERVICES / INTELLIGENCE / EXPERIENCE). 12 non-negotiable separation rules. Implementation sequence. Immediate gap list. |

---

## The 22 Architecture Constitution Documents

Authoring conventions: every document follows the same 17-section template
(Purpose / Scope / Goals / Non-Goals / Architecture Principles / Architecture
Laws / Core Concepts / Canonical Entities / Ownership Boundaries / Relationships /
Responsibilities / Allowed Patterns / Forbidden Patterns / Cross-Architecture
Dependencies / Implementation Requirements / Future Expansion Rules). Principles
are labeled `P1`, `P2`, …; Laws `L1`, `L2`, …; Allowed Patterns `AP1+`;
Forbidden Patterns `FP1+`.

### Group I — Platform shape (01–04)

| # | Document | Governs |
|---|---|---|
| 01 | [`01_PLATFORM_CORE_ARCHITECTURE.md`](01_PLATFORM_CORE_ARCHITECTURE.md) | What a Platform Core is. The 51-core × 7-tier taxonomy. Ownership laws. Lifecycle. |
| 02 | [`02_DOMAIN_ARCHITECTURE.md`](02_DOMAIN_ARCHITECTURE.md) | The 12 canonical domains (CRM, OSS, BSS, Network, Inventory, Workforce, Billing, Portal, Studio, Automation, Reporting, Administration). Core × Domain composition matrix. |
| 03 | [`03_INFORMATION_ARCHITECTURE.md`](03_INFORMATION_ARCHITECTURE.md) | Canonical entity model. Identity (UUIDv7 + reference numbers). Information spine. Relationship Core. |
| 04 | [`04_NAVIGATION_ARCHITECTURE.md`](04_NAVIGATION_ARCHITECTURE.md) | Locked left-nav tree. URL contract. Command palette. Workflow-grouping rule (nav ≠ core taxonomy). |

### Group II — Runtime behavior (05–08)

| # | Document | Governs |
|---|---|---|
| 05 | [`05_OPERATIONAL_ARCHITECTURE.md`](05_OPERATIONAL_ARCHITECTURE.md) | Case → Work → Assignment → Execution → Verification. Queues, SLA, on-call, NOC dashboard. |
| 06 | [`06_UI_EXPERIENCE_ARCHITECTURE.md`](06_UI_EXPERIENCE_ARCHITECTURE.md) | Desktop-first / mobile-complete. Dense operational UI. PageShell + Spacing Law. Brand v3.0 integration. |
| 07 | [`07_WORKFLOW_PROCESS_ARCHITECTURE.md`](07_WORKFLOW_PROCESS_ARCHITECTURE.md) | Workflow / Automation / Approval / SLA. State machines. GXL guards. Versioning. |
| 08 | [`08_PERMISSION_ARCHITECTURE.md`](08_PERMISSION_ARCHITECTURE.md) | RBAC. `object.action` permission keys. Server-side authority. Field-level + record-level scope. |

### Group III — Data + integration substrate (09–14)

| # | Document | Governs |
|---|---|---|
| 09 | [`09_DATA_ARCHITECTURE.md`](09_DATA_ARCHITECTURE.md) | Source-of-truth ownership. Schema rules. Append-only audit. Retention. Migrations. |
| 10 | [`10_API_ARCHITECTURE.md`](10_API_ARCHITECTURE.md) | REST surface. URL prefix per domain. OpenAPI codegen. Idempotency. Pagination. Rate limit. |
| 11 | [`11_EVENT_ARCHITECTURE.md`](11_EVENT_ARCHITECTURE.md) | `workflow.emit` chokepoint. Event naming. Schema registry. Replay. Cross-core subscription. |
| 12 | [`12_INTEGRATION_ARCHITECTURE.md`](12_INTEGRATION_ARCHITECTURE.md) | Connectors. Webhooks. Sync jobs. Mapping rules. Credential references. |
| 13 | [`13_SECURITY_ARCHITECTURE.md`](13_SECURITY_ARCHITECTURE.md) | Deploy contract. RLS as foundation. Encryption. Secrets. Tokens. Rate limit. Threat model. |
| 14 | [`14_TENANT_ARCHITECTURE.md`](14_TENANT_ARCHITECTURE.md) | Multi-tenant isolation. Tenant lifecycle. White-label. Cross-tenant Super-Admin paths. |

### Group IV — Insight + operations posture (15–19)

| # | Document | Governs |
|---|---|---|
| 15 | [`15_REPORTING_ARCHITECTURE.md`](15_REPORTING_ARCHITECTURE.md) | Governed reports. Schedules. Exports. Permission-aware delivery. |
| 16 | [`16_ANALYTICS_ARCHITECTURE.md`](16_ANALYTICS_ARCHITECTURE.md) | KPI definitions. Metric models. Dashboard datasets. D17 / D18 visual standards. |
| 17 | [`17_GOVERNANCE_ARCHITECTURE.md`](17_GOVERNANCE_ARCHITECTURE.md) | Standards registry. Exception process. Constitution amendments. Drift enforcement. |
| 18 | [`18_OBSERVABILITY_ARCHITECTURE.md`](18_OBSERVABILITY_ARCHITECTURE.md) | Health / metrics / traces / logs / alerts / SLO. Universal core. |
| 19 | [`19_INFRASTRUCTURE_ARCHITECTURE.md`](19_INFRASTRUCTURE_ARCHITECTURE.md) | Compute / storage / network / deploy / scaling / DR. |

### Group V — Long-horizon expansion (20–22)

| # | Document | Governs |
|---|---|---|
| 20 | [`20_MARKETPLACE_ARCHITECTURE.md`](20_MARKETPLACE_ARCHITECTURE.md) | Apps / Extensions / install lifecycle / app review / entitlements. **MISSING / RESERVED for M2+.** |
| 21 | [`21_AI_ARCHITECTURE.md`](21_AI_ARCHITECTURE.md) | Assistants / prompts / tools / audit / human approval gates. Currently **WEAK**. |
| 22 | [`22_MOBILE_OFFLINE_ARCHITECTURE.md`](22_MOBILE_OFFLINE_ARCHITECTURE.md) | Mobile shell / offline sync / conflict resolution / device trust / field flows. Currently **WEAK**. |

---

## Auxiliary architecture artifacts (in this directory)

| File | Role |
|---|---|
| [`PRM-MIGRATION-AUDIT-2026-06-06.md`](PRM-MIGRATION-AUDIT-2026-06-06.md) | The classification audit that adopted PRM (2026-06-06). |
| [`CONSTITUTION_CONSISTENCY_AUDIT.md`](CONSTITUTION_CONSISTENCY_AUDIT.md) | Cross-doc consistency & normalization audit of the 22 constitution documents (2026-06-06). Documents structural variance without altering architectural decisions. |
| [`SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`](SEALED-ARCHITECTURE-BASELINE-2026-06-05.md) | Kernel-level engineering invariants (5 engines). Implementation contract under Foundation cores. |
| [`SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md`](SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md) | DRAFT-SHELL addendum for GXL business-condition workflow guards (M1 Phase 1.5). |
| [`Q1-Q5-Q8-DECISION-PACKAGE-2026-06-05.md`](Q1-Q5-Q8-DECISION-PACKAGE-2026-06-05.md) | Three open architecture Q's resolution package. |

---

## Reading order

For a new contributor or an architect coming to GAAhex for the first time,
the recommended reading order is:

1. **`PLATFORM_REFERENCE_MODEL.md`** — the constitutional anchor.
2. **`01_PLATFORM_CORE_ARCHITECTURE.md`** — how cores work.
3. **`02_DOMAIN_ARCHITECTURE.md`** — how cores assemble into product areas.
4. **`03_INFORMATION_ARCHITECTURE.md`** — the entity model.
5. **`04_NAVIGATION_ARCHITECTURE.md`** — what users see.
6. The remaining docs in numerical order.
7. **`docs/standards/00-standards-index.md`** — the LOCKED implementation standards under the constitution.

---

## Per-PR check

Every PR touching backend/, frontend/, or alembic/ MUST declare in its
description:

```
Primary core:      <core name>            (per PRM tier × core taxonomy)
Primary domain:    <domain name>          (per 02_DOMAIN_ARCHITECTURE.md §7.1)
Constitution refs: <doc, doc, …>          (which constitution docs were consulted)
```

CI enforces the presence of this block. The Governance Core
(`17_GOVERNANCE_ARCHITECTURE.md` §exception process) is the path for
deviations.

---

## Architecture Law

The Platform Reference Model plus the 22 Architecture Constitution documents
collectively form the authoritative architecture constitution of GAAhex.

- No alternative architecture source of truth may be introduced.
- All future platform evolution must derive from these documents.
- Amendments to either layer follow `17_GOVERNANCE_ARCHITECTURE.md`.

---

*Authored 2026-06-06 by Ընգեր for Gev as the canonical entry point to the
GAAhex Architecture Constitution.*
