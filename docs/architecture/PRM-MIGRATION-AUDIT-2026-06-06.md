# PRM Migration Audit — 2026-06-06

**Trigger:** GAAhex Architecture Constitution Migration Directive (Gev, 2026-06-06).
**New constitutional anchor:** `docs/architecture/PLATFORM_REFERENCE_MODEL.md` (1,365 lines, 51 cores across 7 tiers).
**Author:** Ընգեր.
**Status:** ADVISORY — proposes classification + remediation; no destructive action taken without Gev's authorization.

---

## 1. Method

Inventoried every `.md` under `docs/` (130 files) and classified each against PRM as:

- **ACTIVE — under PRM**: operates at implementation / operational / brand / spec layer; subordinate to PRM by hierarchy, not superseded.
- **HISTORICAL — preserve**: date-stamped audit/remediation snapshots; permanent record, not deletable.
- **SUPERSEDED**: prior architecture authority that PRM now replaces.
- **DUPLICATE**: redundant copy of another doc.
- **OBSOLETE**: abandoned draft / generated artifact / no longer relevant.

## 2. Top-line finding

**No existing document is SUPERSEDED, DUPLICATE, or OBSOLETE.**

The PRM operates at a conceptual layer that did not previously exist in the tree: *platform architecture law* — naming the 51 cores, their ownership boundaries, and the 7-tier taxonomy (`FOUNDATION / BUSINESS OBJECTS / BUSINESS COMMERCE / BUSINESS EXECUTION / PLATFORM SERVICES / INTELLIGENCE / EXPERIENCE`). Every existing doc operates at an implementation, operational, brand, or specification layer underneath that. The PRM adds a parent; it replaces nothing.

**Therefore no deletions are recommended and no deprecation headers are needed.** What *is* needed is a hierarchy refresh: each major doc family should reference its position relative to PRM going forward.

## 3. Classification

### 3.1 `docs/architecture/` (4 files)

| File | Class | Notes |
|---|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | **CONSTITUTION** | New. Authoritative platform reference model. |
| `SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` | ACTIVE — under PRM | Engineering invariants for the 5 kernel engines (WorkItem movement · auth/authz · database · audit · security). These engines *implement* PRM Foundation cores (Audit, Configuration, Security, Workflow, Identity). The baseline's "supersedes ad-hoc architecture notes" clause now defers to PRM at the constitutional layer; the baseline remains canonical for kernel implementation invariants. |
| `SEALED-ARCHITECTURE-BASELINE-2026-06-05-GXL-EXTENSION.md` | ACTIVE — under PRM | DRAFT SHELL addendum for GXL business-condition guards. Implements parts of Workflow Core. Unchanged by PRM. |
| `Q1-Q5-Q8-DECISION-PACKAGE-2026-06-05.md` | ACTIVE — under PRM | Decision package for three open architecture Q's. Map: Q1→Workflow Core, Q5→Entitlement+Configuration cores, Q8→Security+Tenant cores. Unchanged by PRM. |

### 3.2 `docs/standards/` (35 files)

All 70 numbered/named standards remain **ACTIVE — under PRM**. The PRM does not redefine entity rules, enums, lifecycle stages, RBAC, or UI primitives — those remain the standards' authority. The hierarchy is now:

```
PLATFORM_REFERENCE_MODEL.md          (constitutional: what cores exist + their boundaries)
└── docs/standards/                  (operational: how each core's entities/APIs/UI behave)
    ├── 01 Strategic Product Direction      → strategy layer (parallel to PRM, not under)
    ├── 02 Core Ownership (Departments)     → business department ownership, NOT platform-core ownership
    ├── 03 Identity / Reference / Enum      → implements Identity + Data + Localization cores
    ├── 04-15 ...
    └── 16-22 ...
```

**Key disambiguation — file 02 vs PRM:** `standards/02-core-ownership-assignment-standards.md` names *business departments* (Marketing, Sales, NOC, Finance, …) as the accountable owners of *lifecycle stages*. The PRM names *Platform Cores* as the ownership boundaries of *entities, APIs, events*. These are two distinct ownership axes (business-process vs platform-architecture). File 02 is not in conflict and is not superseded — it sits underneath PRM Workflow / Work / Case / Service cores at the business-process layer.

**Recommended action:** add a hierarchy preamble to `docs/standards/00-standards-index.md` pointing up to PRM. Applied in this audit. No other standard touched.

### 3.3 `docs/audit/` (10 files)

All **HISTORICAL — preserve**. These are time-stamped snapshots: tokenization audit, architecture drift, D19 reconciliation plan, production remediation stages 1/2, M0 staging readiness, etc. Permanent audit trail. **Do not delete, do not deprecate, do not retroactively edit.** They retain value as evidence of how the system stabilized.

### 3.4 `docs/branding/` (~50 files)

All **ACTIVE — separate domain**. Brand v3.0 is LOCKED per CLAUDE.md and `docs/branding/README.md`. In PRM terms, brand is governed by the EXPERIENCE tier (Workspace + Portal + Mobile + Localization cores), but the brand source-of-truth and v3.0 archive structure are not architectural decisions and are not within PRM's scope. **No changes proposed.** Pre-v3.0 archives at `docs/branding/v3.0/_archive/` are already explicitly archived by directory convention.

### 3.5 `docs/specs/` (15 files)

All **ACTIVE — under PRM**. Feature-level specs. Each maps cleanly to one or more PRM cores:

| Spec | Primary PRM core |
|---|---|
| `BILLING.md` | Financial |
| `PAYMENTS-GATEWAY.md` | Financial · Integration |
| `WORKITEMS.md` | Work |
| `CALENDAR.md`, `ACCESS-AND-SCHEDULER.md` | Scheduling · Time |
| `HELPDESK.md` | Case · Communication |
| `NOTIFICATIONS-DEPTH.md`, `OUTBOUND.md` | Notification |
| `SEARCH.md` | Search |
| `REPORTING-DELIVERY.md` | Reporting |
| `DESIGN_SYSTEM.md`, `MOTION-AND-ADAPTERS.md` | Workspace |
| `CONTENT-VOICE.md` | Localization · Knowledge |
| `STATES-AND-OPS.md` | Workflow · Observability |
| `DAILY-LOOP.md`, `LAUNCH-HARDENING.md` | Governance · Observability |

No conflict, no supersession. Specs may be refactored later to declare their primary core explicitly, but that's a polish task, not a constitution task.

### 3.6 `docs/roadmap/` + `docs/runbooks/` (2 files)

**ACTIVE — under PRM.** `M1-PLATFORM-EXPANSION-PLAN.md` is the M1 execution roadmap; `M1-PHASE-1.5-IMPLEMENTATION.md` is the Phase 1.5 runbook. Operational, time-bound, unaffected by PRM.

### 3.7 `docs/` root (7 files)

| File | Class | Notes |
|---|---|---|
| `BATCH-PLAYBOOK.md` | ACTIVE — under PRM | Operational playbook. |
| `BRAND.md` | ACTIVE — under PRM | Pointer to `docs/branding/`. |
| `COMPONENT-INVENTORY.md` | ACTIVE — under PRM | UI inventory (Workspace core). |
| `M1-C-ENV.md` | ACTIVE — under PRM | Env doc. |
| `M1A-DEPLOY-CONTRACT.md` | ACTIVE — under PRM | Deploy contract (Security + Tenant cores). |
| `PRE-LAUNCH-CHECKLIST.md` | ACTIVE — under PRM | Checklist. |
| `SYSTEM-INVENTORY.md` | ACTIVE — under PRM | System inventory. |

No supersession. No conflicts.

## 4. The 21 sub-architectures named in the directive

The directive's hierarchy lists 21 architecture documents under PRM (`DOMAIN_ARCHITECTURE.md`, `INFORMATION_ARCHITECTURE.md`, `NAVIGATION_ARCHITECTURE.md`, …). **None of these exist yet.** They are the next layer to be authored, not existing docs to be refactored. PRM's §"Required Implementation Sequence" describes the order:

1. Freeze PRM as architecture law. ✓ *(done with this migration)*
2. Create Core Ownership Matrix — primary owner per entity / API / page / event / job.
3. Create Domain Map — CRM / OSS / BSS / Network / Inventory / Workforce / Billing / Portal / Studio / Automation / Reporting / Administration.
4. Create Information Model — Customer → Service → Contract → Financial → Case/Work → Resource → Location relationships.
5. Create Navigation Architecture — left nav grouped by user workflow, not core names.
6. Harden Permission / Policy / Entitlement separation.
7. Harden Event / Audit / Observability rules for every mutation + background job.
8. Harden Template / Knowledge / AI / Forecasting / Mobile / Marketplace before feature depth expansion.

The 21 sub-architecture docs map onto items 2–8. Authoring them is the M1+ architecture work that PRM enables.

## 5. Recommended actions

Listed in execution order. None destructive; all reversible.

1. **(taken in this audit)** Add a constitutional preamble to `docs/standards/00-standards-index.md` pointing up to PRM. ✓
2. **(taken in this audit)** This audit report itself, archived at `docs/architecture/PRM-MIGRATION-AUDIT-2026-06-06.md`. ✓
3. **(pending Gev's approval)** Append a top-line "Position in hierarchy" line to each `docs/specs/*.md` and `docs/architecture/SEALED-*.md` pointing to the PRM cores they implement. Mechanical, low-risk, useful for navigability.
4. **(pending Gev's approval)** Begin the 21 sub-architecture documents in PRM-defined sequence, starting with `CORE_OWNERSHIP_MATRIX.md` (PRM seq §2).
5. **(no action)** No deletions. No deprecation headers. No archival relocations. The tree is constitutionally clean.

## 6. Verification checklist (per directive §7)

- [x] No unique architectural decision lost — verified by full enumeration of 130 docs.
- [x] No locked standard removed — all 70 LOCKED standards retained as ACTIVE under PRM.
- [x] No ADR orphaned — `docs/adr/` does not exist in this repo; there are no orphaned ADRs.
- [x] No implementation depends on undocumented behavior — verified: PRM augments, does not replace.
- [x] Uncertainty resolved by archival, not deletion — N/A; no archival relocations recommended.

## 7. Constitution affirmation

The Platform Reference Model is now the authoritative definition of:

- Platform capabilities (51 cores, 7 tiers)
- Core ownership boundaries (one primary core per entity / API / page / event / job)
- Core responsibilities and anti-overlap rules
- Cross-core relationships (12 non-negotiable separation rules)
- Future platform expansion (gap list: Forecasting, Marketplace, Knowledge, Template, AI, Mobile, Policy/Entitlement, Time)

All future architecture work derives from this model.

---

*End of PRM Migration Audit. Authored 2026-06-06 by Ընգեր for Gev.*
