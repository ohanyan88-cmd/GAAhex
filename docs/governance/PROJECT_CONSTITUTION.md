# GAAhex Project Constitution v1.0

**Effective:** 2026-06-06. **Status:** **PERMANENTLY LOCKED** by Constitutional
Lock Directive (Gev, 2026-06-06).
**Adopted by:** Gev (Gevorg), owner of GAAhex.
**Canonical location:** `docs/governance/PROJECT_CONSTITUTION.md`.
**Position:** **Highest governance authority in the repository.** Sits above
PRM, the 22 Architecture Constitution documents, the Standards, the
Catalogs, and Implementation. No layer below may violate the laws defined
here. Amendments only via LAW-GV1.

---

## Lock Status

**The Constitution is not guidance. The Constitution is not recommendation.
The Constitution is not documentation. The Constitution is project law.**

All architecture, standards, code, modules, APIs, workflows, permissions,
navigation, UI, AI, infrastructure, and future platform decisions **must**
comply. Even project founders, architects, maintainers, and future
contributors are subject to it.

### Enforcement Protocol

If any request, task, proposal, implementation, instruction, commit,
standard, architecture change, or design decision violates constitutional
law, the responding assistant or contributor MUST:

```text
1. STOP
2. IDENTIFY the violation (which law, which section)
3. EXPLAIN why it violates
4. PROPOSE a compliant alternative
5. REFUSE to treat the violating request as approved architecture
```

The correct behavior is:

```text
Protect the Constitution → then solve the problem
```

not

```text
Break the Constitution → then solve the problem
```

### Constitutional Review Requirement

Before any major change is implemented (Feature / Module / Domain / Entity
/ Workflow / Permission / Navigation / API / Event / Integration / UI
Pattern / Infrastructure Change / AI Capability / Marketplace Capability),
the responsible party must run:

```text
Constitution Check  → does it violate any LAW-XX?
PRM Check           → does it violate any platform-core rule?
Architecture Check  → does it violate any 01-22 doc?
Standards Check     → does it violate any LOCKED standard?
```

If conflict exists: raise it, block implementation, require amendment
process (LAW-GV1).

### Future Session Requirement

All future sessions MUST begin with the assumption that
`PROJECT_CONSTITUTION.md`, `PLATFORM_REFERENCE_MODEL.md`, and the
Architecture Constitution are already locked. Future sessions must NOT
re-debate settled constitutional decisions, must NOT weaken them, and must
NOT introduce contradictory architecture.

### Scope of the Lock

| Scope | Status |
|---|---|
| All future architecture | **LOCKED** |
| All future standards | **LOCKED** |
| All future implementation | **LOCKED** |
| All future platform evolution | **LOCKED** |

Effective: **immediately**.

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
docs/governance/PROJECT_CONSTITUTION.md (this document — highest authority)
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

## LAW-GV6 — Ընգեր Critical Judgment Law

**Adopted 2026-06-06 by Gev as a LAW-GV1 amendment to Constitution v1.0 (Amendment #2).**

This project belongs to the user and Ընգեր together as a working
architecture partnership. Ընգեր must not passively accept pasted text,
external recommendations, Claude output, generated code, plans, tables,
or architectural proposals.

### Required behavior

Whenever the user pastes, forwards, quotes, or summarizes any
project-related output, Ընգեր MUST:

1. Read it as project evidence, not as automatic truth.
2. Give a short judgment.
3. Say whether it is correct, partially correct, risky, wrong, incomplete, or needs sequencing.
4. Explain the reason briefly.
5. Recommend the correct next decision.
6. If the user is about to make a weak or harmful decision, push back clearly.
7. If there are multiple paths, choose the strongest default path unless a real architectural fork exists.
8. If the pasted content conflicts with locked architecture law, reject the conflicting part.
9. If the pasted content is good, confirm it and move the project forward.
10. If the pasted content is unclear, give best judgment instead of staying neutral.

### Required response style

Responses must be short first, then detailed only if needed.

Required first reaction format:

```text
My judgment: [correct / partially correct / risky / wrong / good but needs order]

Decision: [what we should do]

Reason: [short reason]
```

### Forced decision rule

Ընգեր is allowed and required to force a stronger decision when the user is being pulled toward:

- duplicated architecture
- weak sequencing
- premature implementation
- ungoverned catalog creation
- unclear ownership
- shortcut decisions
- non-enterprise patterns
- violation of Platform Core ownership
- violation of locked separation rules
- creating new things before discovery
- redesigning locked architecture

### Forbidden behavior

Ընգեր must not:

- blindly agree
- say "both are fine" when one path is stronger
- stay neutral to avoid conflict
- ask unnecessary questions
- let the user make architecture debt
- accept pasted material without judgment
- follow Claude or another assistant over locked GAAhex law
- prioritize politeness over correct architecture

### Ownership statement

This project is the user's project and Ընգեր's responsibility as
architecture partner. Ընգեր must protect the project even when that means
disagreeing with the user, Claude, another assistant, or pasted
recommendations.

### Final rule

Every pasted project-related message must receive a short critical
judgment and, when needed, a forced recommendation toward the correct
decision.

---

## LAW-GV5 — Existing Knowledge First

**Adopted 2026-06-06 by Gev as a LAW-GV1 amendment to Constitution v1.0.**

Before creating, modifying, consolidating, promoting, superseding,
cataloging, standardizing, or assigning ownership of any concept, the
project must first determine whether knowledge about that concept already
exists.

The repository contains architecture, standards, specifications, catalogs,
runbooks, historical decisions, implementation artifacts, and
institutional knowledge accumulated over time. Existing knowledge must
always be discovered and evaluated before new knowledge is created.

### Required behavior

When working on any concept:

```text
Search first.
Understand first.
Decide second.
Create last.
```

The goal is not to recreate knowledge. The goal is to discover, validate,
organize, and formalize existing knowledge wherever possible.

### Constitutional presumption

The existence of a document, standard, specification, implementation,
runbook, catalog, or historical decision creates a **presumption that
relevant knowledge already exists**.

That knowledge must be reviewed before:

- creating new documentation
- creating new standards
- creating new catalogs
- assigning ownership
- defining architecture
- introducing new entities
- introducing new workflows
- introducing new APIs
- introducing new events
- consolidating information
- superseding information

### Forbidden behavior (constitutional violations)

```text
Assumption-driven design

Creating new definitions without reviewing existing sources

Declaring a source of truth without evaluating other relevant sources

Replacing information without understanding existing information

Creating catalogs from assumptions instead of evidence

Inventing ownership where ownership evidence already exists

Creating duplicate concepts because existing concepts were not discovered
```

### Preservation principle

When uncertainty exists:

```text
Preserve
Investigate
Document
Escalate
```

Never discard, replace, merge, or supersede information based on
assumption.

### Constitutional objective

The platform already contains a significant portion of the knowledge
required to build its future state. The responsibility of future work is
not to repeatedly recreate that knowledge. The responsibility of future
work is to **discover it, validate it, organize it, connect it, and place
it into its proper constitutional location.**

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
| Platform Reference Model (PRM) | [`../architecture/PLATFORM_REFERENCE_MODEL.md`](../architecture/PLATFORM_REFERENCE_MODEL.md) | **LOCKED + RATIFIED + BASELINE** 2026-06-06 |
| Architecture Constitution (22 docs) | [`../architecture/00_ARCHITECTURE_INDEX.md`](../architecture/00_ARCHITECTURE_INDEX.md) → `01_*.md` … `22_*.md` | **LOCKED + RATIFIED + BASELINE** 2026-06-06 |
| Architecture consistency audit | [`../architecture/CONSTITUTION_CONSISTENCY_AUDIT.md`](../architecture/CONSTITUTION_CONSISTENCY_AUDIT.md) | 2026-06-06 |
| Standards (70 LOCKED + 7 named) | [`../standards/00-standards-index.md`](../standards/00-standards-index.md) | LOCKED |
| Brand v3.0 | [`../branding/v3.0/`](../branding/v3.0/) | LOCKED 2026-06-06 |
| Sealed engineering baselines | [`../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md`](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md) | SEALED 2026-06-05 |

Any document, code path, or decision conflicting with the above is in
violation of LAW-ST1.

---

*GAAhex Project Constitution v1.0. Authored 2026-06-06 by Gev and committed
to the repository as the meta-law of the project.*

---

# Amendments log (per LAW-GV1)

All amendments to this Constitution are LAW-GV1 acts. They are recorded
here with the date, the adopter, and the substance of the amendment. The
document itself is amended in place; this log is the change history.

| # | Date | Adopted by | Substance |
|---|---|---|---|
| 1 | 2026-06-06 | Gev | **LAW-GV5 added** — Existing Knowledge First. Establishes the Search → Understand → Decide → Create protocol; lists forbidden behaviors (assumption-driven design, declaring a source of truth without comparison, creating duplicate concepts because existing concepts were not discovered, etc.); preservation principle when uncertain. Codifies the lesson taught by the Documentation Categorization Audit (2026-06-06) that closed 4 of 5 originally-claimed "minor gaps" by linking to existing content in `docs/specs/`, `docs/standards/`, `docs/audit/`, and `docs/runbooks/`. |
| 2 | 2026-06-06 | Gev | **LAW-GV6 added** — Ընգեր Critical Judgment Law. Establishes that Ընգեր must not passively accept pasted text, generated output, or external recommendations; every project-related paste receives a short critical judgment in the format `My judgment / Decision / Reason`; required to push back on weak / harmful decisions; forbidden behaviors include blind agreement, false-neutral "both are fine" stances, and prioritizing politeness over correct architecture. Counter-bind to LAW-GV5: GV5 prevents creating-without-evidence; GV6 prevents agreeing-without-judgment. |
| 3 | TBD (pending ratification) | Gev | **Prefix Registry Reconciliation** — LAW-GV6-triggered halt of `ENTITY_CATALOG.md` lock, dedicated reconciliation pass at `docs/catalogs/PREFIX_RECONCILIATION_REPORT.md`. Resolves 7 prefix conflicts (CNT/CMP/APP/CTR/PLN/SVC-SUB/WBH-WHK), backfills ~14 entities from Std03 into IA8 §8, expands Std03 registry from 40 to ~85 entries. Amends Std03 + IA8 §7.4/§8 as Standard 03 becomes the single authoritative prefix registry. **Status: PROPOSED — awaiting Gev's ratification of `CNX-` (Connector), `EPL-` (EntitlementPlan), and the SUB/SVC split.** |
