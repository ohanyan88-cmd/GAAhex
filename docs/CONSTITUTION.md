# GAAhex Project Constitution v1.0

**Effective:** 2026-06-06. **Status:** LOCKED.
**Adopted by:** Gev (Gevorg), owner of GAAhex.
**Position:** Meta-law of the project. Sits **above** all other governance
layers, including the Platform Reference Model and the 22 Architecture
Constitution documents.

## Constitutional Status

This document defines the **governing laws of the GAAhex project**.

These laws apply to:

* Architecture
* Standards
* Domains
* Modules
* APIs
* Events
* Data Models
* Workflows
* Permissions
* Navigation
* UI/UX
* Infrastructure
* Documentation
* AI
* Marketplace
* Mobile
* Future Platform Expansion

Violation of constitutional laws requires a formal amendment process
(see LAW-GV1).

---

# SECTION I — SOURCE OF TRUTH LAWS

## LAW-ST1 — Source of Truth Hierarchy

Authoritative hierarchy:

```text
docs/CONSTITUTION.md (this document)
        ↓
PLATFORM_REFERENCE_MODEL.md
        ↓
Architecture Constitution (01-22)
        ↓
Standards
        ↓
Domain Catalogs
        ↓
Module Catalogs
        ↓
Page Catalogs
        ↓
Entity Catalogs
        ↓
API/Event Catalogs
        ↓
Implementation
```

Lower layers may not contradict higher layers.

---

## LAW-ST2 — Single Authority Rule

Each architectural concern must have exactly one authoritative source.

Competing sources of truth are forbidden.

---

## LAW-ST3 — Documentation Authority Rule

Code never overrides architecture.

If implementation conflicts with constitutional documents:

```text
Document conflict
Review conflict
Fix implementation
or
Amend constitution
```

---

# SECTION II — ARCHITECTURE LAWS

## LAW-AR1 — Constitution First

No implementation may bypass:

```text
PRM
Architecture Constitution
Standards
```

---

## LAW-AR2 — Architecture Boundary Rule

Architecture defines:

```text
Ownership
Responsibilities
Boundaries
Relationships
```

Architecture is not optional guidance.

---

## LAW-AR3 — No Architecture Bypass

No new:

```text
Domain
Core
Entity
Workflow
Permission Model
Navigation Pattern
```

may be introduced without constitutional review.

---

## LAW-AR4 — Separation of Concerns

The following are permanently distinct:

```text
Permission ≠ Entitlement

Policy ≠ Governance

Workflow ≠ Automation

Approval ≠ Workflow

SLA ≠ Scheduling

Audit ≠ Observability

Reporting ≠ Analytics

Architecture ≠ Navigation

Branding ≠ Tenanting
```

---

# SECTION III — PLATFORM LAWS

## LAW-PL1 — Multi-Tenant First

All design assumes:

```text
Multi-tenant
White-label capable
Tenant configurable
Tenant isolated
```

Single-tenant assumptions are forbidden.

---

## LAW-PL2 — API First

Every core capability must be API-addressable.

Future support must be possible for:

```text
REST
Webhooks
API Keys
OAuth
Marketplace
AI
```

---

## LAW-PL3 — Extensibility First

Design must assume future:

```text
Automation
Marketplace
AI
Partner Ecosystem
External Integrations
```

---

## LAW-PL4 — Enterprise Readiness

Every major decision must be evaluated against:

```text
Security
Scale
Auditability
Reporting
Automation
Multi-tenancy
White-labeling
Future Growth
```

---

# SECTION IV — DATA LAWS

## LAW-DA1 — Canonical Entity Rule

Every business concept has exactly one canonical entity.

Forbidden:

```text
Customer
Client
Subscriber
AccountHolder
```

representing the same thing.

---

## LAW-DA2 — Canonical Ownership Rule

Every entity must have exactly one primary owner.

Shared ownership is forbidden.

---

## LAW-DA3 — Data Lifecycle Rule

Every entity must define:

```text
Creation
Modification
Archival
Deletion
Retention
```

---

# SECTION V — API & EVENT LAWS

## LAW-AP1 — Canonical API Rule

One concept → one API surface.

Competing APIs are forbidden.

---

## LAW-EV1 — Canonical Event Rule

One event meaning → one event.

Duplicate semantics are forbidden.

---

## LAW-EV2 — Event Contract Rule

Published events are contracts.

Breaking changes require governance review.

---

# SECTION VI — UI & EXPERIENCE LAWS

## LAW-UX1 — Desktop First

Desktop is primary.

---

## LAW-UX2 — Mobile Complete

Every critical workflow must be available on mobile.

---

## LAW-UX3 — Operational Density

UI follows:

```text
Linear
Jira
Datadog
Grafana
Enterprise NMS
```

style density.

CRM-style whitespace-heavy layouts are forbidden.

---

## LAW-UX4 — Editing Model

Default:

```text
Drawer
```

Complex:

```text
Dedicated Workspace
```

Simple:

```text
Modal
```

---

## LAW-UX5 — Navigation Rule

Navigation follows user workflows.

Never platform cores.

---

# SECTION VII — SECURITY LAWS

## LAW-SE1 — Least Privilege

Default access is denied.

---

## LAW-SE2 — Auditability

Every critical action must be auditable.

---

## LAW-SE3 — Security By Default

Security controls must be enabled by default.

---

# SECTION VIII — ENGINEERING LAWS

## LAW-EN1 — Technical Debt Rule

Temporary solutions require:

```text
Owner
Reason
Removal Plan
Target Milestone
```

---

## LAW-EN2 — Feature Gate Rule

Major functionality must support:

```text
Enable
Disable
Tenant Enablement
Future Entitlements
```

---

## LAW-EN3 — Naming Rule

Naming must be:

```text
Consistent
Predictable
Documented
```

---

# SECTION IX — DOCUMENTATION LAWS

## LAW-DO1 — Documentation Completeness

Work is not complete until:

```text
Code Updated
Documentation Updated
Standards Updated
Architecture Updated (if needed)
Memory Updated (if needed)
```

---

## LAW-DO2 — Memory Preservation

Major decisions must be persisted.

Future sessions must be able to continue without rediscovery.

---

# SECTION X — GOVERNANCE LAWS

## LAW-GV1 — Amendment Rule

Constitutional changes require:

```text
Proposal
Impact Analysis
Review
Approval
Documentation Update
Memory Update
```

---

## LAW-GV2 — Backward Compatibility

Breaking changes require explicit approval.

---

## LAW-GV3 — Cleanup Before Progress

Mandatory sequence:

```text
CREATE
→ REVIEW
→ AUDIT
→ NORMALIZE
→ GAP ANALYSIS
→ LOCK
→ PROCEED
```

---

## LAW-GV4 — Lock Before Next Layer

No project layer may advance until the current layer is:

```text
Complete
Audited
Normalized
Locked
```

---

# Constitutional Principle

GAAhex is designed as a long-lived enterprise platform.

Every decision must optimize for:

```text
Clarity
Ownership
Scalability
Security
Maintainability
Auditability
Extensibility
Enterprise Readiness
```

Short-term convenience must never override long-term platform integrity.

---

# Authoritative cross-references (as of v1.0 adoption)

The layers governed by this Constitution at adoption:

| Layer | Location | Status |
|---|---|---|
| Platform Reference Model (PRM) | [`architecture/PLATFORM_REFERENCE_MODEL.md`](architecture/PLATFORM_REFERENCE_MODEL.md) | LOCKED 2026-06-06 |
| Architecture Constitution (22 docs) | [`architecture/00_ARCHITECTURE_INDEX.md`](architecture/00_ARCHITECTURE_INDEX.md) → `01_*.md` … `22_*.md` | LOCKED 2026-06-06 |
| Architecture consistency audit | [`architecture/CONSTITUTION_CONSISTENCY_AUDIT.md`](architecture/CONSTITUTION_CONSISTENCY_AUDIT.md) | 2026-06-06 |
| Standards (70 LOCKED + 7 named) | [`standards/00-standards-index.md`](standards/00-standards-index.md) | LOCKED |
| Brand v3.0 | [`branding/v3.0/`](branding/v3.0/) | LOCKED 2026-06-06 |
| Sealed engineering baselines | [`architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`](architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md) | SEALED 2026-06-05 |

Any document, code path, or decision conflicting with the above is in
violation of LAW-ST1.

---

*GAAhex Project Constitution v1.0. Authored 2026-06-06 by Gev and committed
to the repository as the meta-law of the project.*
