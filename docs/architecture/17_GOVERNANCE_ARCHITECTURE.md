# 17 — Governance Architecture

**Constitutional document.** Position in the hierarchy: under `PLATFORM_REFERENCE_MODEL.md` and `01_PLATFORM_CORE_ARCHITECTURE.md`. Defines how GAAhex's architecture law is enforced, amended, and evolved. Governance is the meta-layer: it is how the platform prevents itself from becoming lawless.

---

## 1. Purpose

Define what **Governance Core** owns, how the **standards registry** is maintained, how **exceptions** are filed and tracked, how the **Platform Reference Model and 22 architecture constitution documents** are amended, and how **drift enforcement** prevents codebase regression. Governance is normative (this is the rule); Policy Core is executable (this is the decision). Governance owns the rules themselves.

## 2. Scope

In scope:

- The Governance Core canonical entities (Standard, Exception, GovernanceBoard, ArchitectureLawRecord).
- The 70-standard registry lifecycle: naming, versioning, status (LOCKED / PROVISIONAL), dependencies, deprecation.
- The exception process: filing, approval, time-bounding, audit.
- The governance board structure for cross-core impact review.
- The 22 architecture constitution documents as governance artifacts.
- Amendment process for the Platform Reference Model and constitution documents.
- The drift-enforcement mechanism (`tools/check_drift.py`) — HARD rules and RATCHET rules.
- Per-PR governance metadata (core declaration, impact assessment).

Out of scope (handled by other constitution documents):

- *Operational policy decisions* — see `PLATFORM_REFERENCE_MODEL.md` § Policy Core.
- *Permission granting* — see `08_PERMISSION_ARCHITECTURE.md`.
- *Tenant configuration and branding overrides* — see `14_TENANT_ARCHITECTURE.md`.
- *Compliance evidence collection* — see Compliance Core in PRM.
- *Audit log storage* — see Audit Core in PRM.

## 3. Goals

- **G1** Every canonical introduced in Phases 1–6 is guarded by a drift rule; the codebase cannot regress without CI detection.
- **G2** Every standard has explicit ownership, version, and locked-ness status.
- **G3** Every deviation from a locked standard is filed as a named Exception record with time-bounds and governance approval.
- **G4** The 22 architecture documents (01–22) are themselves governance artifacts; amendments to them require explicit approval and are recorded.
- **G5** The governance board reviews all cross-core, multi-domain, and high-risk changes before merge.
- **G6** Standards registry is discoverable and versioned in `docs/standards/00-standards-index.md` and companion registry files (14, 15, RLS exemption, feature gating).
- **G7** The platform grows by *hardening* cores and *clarifying* standards, not by multiplying rules or adding exception-upon-exception.

## 4. Non-Goals

- **NG1** This document does NOT define the specific content of any of the 70 standards — that is their individual source files (01–70 and named standards).
- **NG2** This document does NOT replace the Platform Reference Model — it explains how to amend it.
- **NG3** This document does NOT enforce permission checks (who can file an exception) — that is Permission Core.
- **NG4** This document does NOT define brand, visual, or UX standards — brand is governed by the LOCKED brand package at `docs/branding/v3.0/`.

## 5. Architecture Principles

### P1 — Governance is normative; Policy is executable

Governance Core writes *rules* (you shall not hardcode enum values). Policy Core *evaluates* *decisions* (which ticket gets routed to which queue). A rule is violated immediately; a decision is wrong only in hindsight. Governance is preventive; Policy is reactive.

### P2 — Standards are immutable once LOCKED

A LOCKED standard is sealed by the platform owner. Changing it requires a constitution amendment. PROVISIONAL standards may evolve faster; they lock on consensus. No standard is "almost locked" — the gate between PROVISIONAL and LOCKED is explicit.

### P3 — Exceptions are named, time-bounded, and audited

When a team needs to deviate from a locked standard, they file an Exception record. The exception names itself, declares why, states its time-bound (target date for remediation), is approved by the governance board, and is audited. "Temporary" code without an exception record is a regression.

### P4 — The 22 documents are the constitution

The Platform Reference Model and 22 architecture constitution documents are governance artifacts. They are version-controlled, amendment-tracked, and sealed. No decision at the code level can override them; the opposite (amend the document to match the code) is the valid path.

### P5 — Drift rules are proactive gates

Every canonical introduced in Phases 1–6 is guarded by `check_drift.py`. HARD rules prevent *new* instances of the anti-pattern. RATCHET rules prevent *regression* — the count of violations must not increase. Both fail the PR immediately (exit 1 or exit 2).

### P6 — Cross-core and multi-domain changes require board review

Any change touching multiple cores, multiple domains, or affecting the Platform Reference Model goes before the governance board. The board meets async via the exception-filing and amendment process. Reviewers are named; decisions are recorded.

### P7 — Configuration over code (inherited from M0 thesis)

Governance rules themselves are enforced in code (via drift checks and backend permission gates); their *content* is configuration (the 70 standards registry, the exception registry). Rules do not change per-PR; their parameters do.

### P8 — Standards registry is the source of truth

The canonical, current, complete list of standards lives in `docs/standards/00-standards-index.md` and companion files (`14-enum-registry.md`, `15-permission-registry.md`, `RLS_EXEMPTION_REGISTRY.md`, `FEATURE_GATING_POLICY.md`). Any reference to "the standards" defaults to these files.

## 6. Architecture Laws

### L1 — No standard is unowned

Every standard has exactly one owner (a department or role). Owners are recorded in the standard's frontmatter. The platform owner (Gev / Ընգեր) approves LOCKED status.

### L2 — Standard names are immutable

Once a standard is LOCKED, its name is its canonical identity. The display number (1–70, or named) is for ordering; the *name* is the canonical key. Renaming a LOCKED standard requires a constitution amendment.

### L3 — Every exception has a governance record

Code that deviates from a locked standard without an Exception record is a defect. If reviewers find unapproved deviation, the PR is rejected. The exception must be filed first, approved, and then cited in the code comment.

### L4 — Amendments are constitution-level events

A change to the Platform Reference Model or any of the 22 constitution documents is a constitution amendment. It is committed with a suffix like `(amendment: <change description>)` and recorded in `docs/architecture/CONSTITUTION_AMENDMENT_LOG.md`. Amendments are rare — most changes happen within the document's scope, not by rewriting the document.

### L5 — Drift rules protect against regression

Every drift rule (HARD or RATCHET) is documented in `docs/standards/GOVERNANCE_STANDARD.md`. Adding a new rule requires:
1. The rule definition in `tools/check_drift.py`.
2. A reference in the related standard (e.g., "Token Migration Standard" for token rules).
3. The baseline established or updated via `check_drift_baseline.json`.

Breaking the rule in a future PR fails CI.

### L6 — The governance board is the court of appeals

The governance board reviews exceptions, amendments, and cross-cutting decisions. The board is *async* — decisions are recorded in issue/PR comments; meetings are ad-hoc. The platform owner (Gev) is the final authority; other board members are named in governance records.

### L7 — No standing contradiction between rule and code

If a rule in the standards conflicts with what the code does, one of them is wrong. The path is to either amend the rule or fix the code — not to live with the contradiction. This is D19 (Rule ↔ Implementation Parity) from the consistency-patch notes.

## 7. Core Concepts

### 7.1 Standard

A governance artifact that defines *how* the platform or a feature must behave. Standards are immutable, versioned, owned, and discoverable. The 70 numbered standards plus 7 named operational standards form the canonical registry.

**Attributes:**
- `name` — immutable identity (e.g., "Token Migration Standard").
- `number` — display order (1–70 for numbered; named standards have no number).
- `status` — LOCKED | PROVISIONAL.
- `owner` — department / role responsible for the standard.
- `source_file` — where the standard is documented.
- `version` — semantic version (major.minor) incremented on amendment.
- `last_amended` — date of last amendment.
- `dependencies` — which other standards this one depends on.
- `drift_rules` — which CI rules enforce this standard.

### 7.2 Exception

A formal deviation from a locked standard, time-bounded and governed.

**Attributes:**
- `id` — unique identifier (UUID or human-readable like `EXC-2026-001`).
- `standard_id` — which standard is being deviated from.
- `rationale` — why the exception is necessary.
- `scope` — which modules/entities/functions are affected.
- `approved_by` — governance board member(s) who approved.
- `time_bound` — target date for remediation (or "permanent" if approved as standing exception).
- `filed_date` — when the exception was created.
- `reviewed_date` — when it was approved.
- `audit_trail` — who approved, when, why.
- `status` — FILED | APPROVED | IN_REMEDIATION | RESOLVED | CLOSED.

### 7.3 Governance Board

A group of decision-makers who approve exceptions, amendments, and cross-cutting changes. Members include:
- **Platform Owner** — Gev (final authority).
- **Architecture Lead** — Ընգեր on Gev's behalf.
- **Core Owners** — one per major core (Identity, Audit, Workflow, etc.) once org grows.
- **Domain Leads** — one per domain (CRM, OSS, BSS, etc.) once org grows.

### 7.4 Architecture Law Record

A log entry that tracks every amendment, exception approval, and governance decision.

**Attributes:**
- `id` — unique identifier.
- `type` — AMENDMENT | EXCEPTION_APPROVAL | CONSTITUTION_AMENDMENT | DRIFT_RULE_ADDITION.
- `artifact_id` — which standard, exception, or document is affected.
- `decision` — approved | rejected | pending.
- `approved_by` — who approved.
- `date` — when the decision was made.
- `commit_hash` — git commit that recorded the decision (if code-level).
- `notes` — rationale and context.

### 7.5 Constitution Amendment

A change to the Platform Reference Model or any of the 22 architecture constitution documents (01–22). Amendments are rare and explicit.

**Example of what triggers an amendment:**
- Adding a 52nd core (new core proposal approved).
- Splitting a core into two (e.g., if Service Core becomes too large).
- Merging two cores (if they are discovered to be overlapping).
- Retiring a core (all artifacts migrated, final cleanup).
- Clarifying or tightening a hard boundary rule that affects multiple cores.

**What does NOT trigger an amendment:**
- Adding a new standard within the numbered 1–70 sequence (numbers are fixed; new standards are additions to the registry's operational-standards section).
- Updating a standard's version and content (version is within the standard's scope).
- Filing an exception (exceptional; not constitutional).

## 8. The 22 Architecture Constitution Documents

The Platform Reference Model and 22 constitution documents form the platform's architectural law:

| # | Document | Role | Amendment-Ready |
|---|----------|------|-----------------|
| — | `PLATFORM_REFERENCE_MODEL.md` | Master index of 51 cores, tiers, separation rules, implementation sequence. | Yes |
| 01 | `01_PLATFORM_CORE_ARCHITECTURE.md` | Operationalizes cores: ownership, boundaries, lifecycle, hard rules (L1–L8). | Yes |
| 02 | `02_DOMAIN_ARCHITECTURE.md` | Assembles cores into 12 domains (CRM, OSS, BSS, etc.); domain-to-implementation alignment. | Yes |
| 03 | `03_INFORMATION_ARCHITECTURE.md` | Entity relationships, ER diagrams, canonical entity-to-core mapping. | Yes |
| 04 | `04_NAVIGATION_ARCHITECTURE.md` | Left-nav tree, top-nav, navigation rules. Navigation is workflow-oriented, not core-mirrored. | Yes |
| 05 | `05_OPERATIONAL_ARCHITECTURE.md` | Runtime operational model: containers, processes, runtime configuration, multi-tenancy wiring. | Yes |
| 06 | `06_UI_EXPERIENCE_ARCHITECTURE.md` | UI surfaces, page types, component library, accessibility, device strategy. | Yes |
| 07 | `07_WORKFLOW_PROCESS_ARCHITECTURE.md` | Workflow Core operational details: state machines, transitions, gates, SLA coupling. | Yes |
| 08 | `08_PERMISSION_ARCHITECTURE.md` | RBAC, permission keys, scope evaluation, field-level security, audit. | Yes |
| 09 | `09_DATA_ARCHITECTURE.md` | Canonical entities, entity ownership, schema, tenant posture, data lifecycle. | Yes |
| 10 | `10_API_ARCHITECTURE.md` | REST API design, resource paths, naming, versioning, idempotency, error handling. | Yes |
| 11 | `11_EVENT_ARCHITECTURE.md` | Event naming, event ownership (core), event versioning, event store design. | Yes |
| 12 | `12_INTEGRATION_ARCHITECTURE.md` | Connectors, webhooks, sync jobs, credential handling, connector ownership (core). | Yes |
| 13 | `13_SECURITY_ARCHITECTURE.md` | Encryption, secrets, token security, rate limiting, threat controls, secure defaults. | Yes |
| 14 | `14_TENANT_ARCHITECTURE.md` | Multi-tenant model, tenant data isolation, RLS, tenant-scoped configuration. | Yes |
| 15 | `15_REPORTING_ARCHITECTURE.md` | Reporting Core design, report definitions, scheduling, exports, permissions. | Yes |
| 16 | `16_ANALYTICS_ARCHITECTURE.md` | Analytics Core design, KPI definitions, dashboard datasets, separation from Reporting. | Yes |
| 17 | `17_GOVERNANCE_ARCHITECTURE.md` | **This document.** Standards registry, exceptions, amendments, drift enforcement. | Yes |
| 18 | `18_OBSERVABILITY_ARCHITECTURE.md` | Observability Core: health checks, metrics, traces, logs, alerts. | Yes |
| 19 | `19_INFRASTRUCTURE_ARCHITECTURE.md` | Storage, Background Processing, container orchestration, database topology. | Yes |
| 20 | `20_MARKETPLACE_ARCHITECTURE.md` | Marketplace Core: apps, extensions, install lifecycle, app permissions (MISSING core). | Yes |
| 21 | `21_AI_ARCHITECTURE.md` | AI Core: AI assistants, prompts, actions, knowledge sources, approval gates (WEAK core). | Yes |
| 22 | `22_MOBILE_OFFLINE_ARCHITECTURE.md` | Mobile Core: mobile app, offline sync, device trust, field workflows (WEAK core). | Yes |

All 22 documents are constitutional. Changes to them require amendment review and are recorded in `docs/architecture/CONSTITUTION_AMENDMENT_LOG.md`.

## 9. The Standards Registry

The canonical registry of the 70 numbered standards plus 7 named operational standards lives in `docs/standards/00-standards-index.md` and companion files.

### 9.1 Registry structure

**Primary file:** `docs/standards/00-standards-index.md`
- Table listing all 70 numbered standards (name, status, source file, key dependencies).
- Status definitions (LOCKED | PROVISIONAL).
- Operational-standards section (7 named standards: API Client, Auth Context, Server State, UI Primitives, Token Migration, OpenAPI Codegen, Governance).

**Companion files:**
- `docs/standards/14-enum-registry.md` — every enum name, owner, UPPER_SNAKE_CASE values.
- `docs/standards/15-permission-registry.md` — all `object.action` permission keys (immutable once released).
- `docs/standards/RLS_EXEMPTION_REGISTRY.md` — append-only RLS exemption log (gated by RLS_EXEMPTION_POLICY).
- `docs/standards/FEATURE_GATING_POLICY.md` — dual distinction: deploy-shape gates (platform-wide) vs. tenant feature flags (per-tenant).
- `docs/standards/GOVERNANCE_STANDARD.md` — drift rules, ratchet philosophy, standard-doc lifecycle.
- `docs/standards/RLS_EXEMPTION_POLICY.md` — when an RLS gap surfaces, default is Fix Forward; exemption rare.

### 9.2 Standard attributes (in each standard's source file)

Every standard file begins with frontmatter:

```markdown
# <Standard Name>

**Status**: LOCKED | PROVISIONAL
**Owner**: <Department / Role>
**Last updated**: YYYY-MM-DD
**Version**: <major.minor>
**Dependencies**: <Other Standard>, <Core>, …
**Drift rules protecting this**: <Rule name(s)>
```

### 9.3 Standard lifecycle

```
        ┌──────────────────────────────────────┐
        ▼                                      │
PROPOSED ── register ──> PROVISIONAL ── lock ─┴─> LOCKED
                                          │
                                          └─── deprecate ──> DEPRECATED
```

- **PROPOSED:** Written but not yet registered.
- **PROVISIONAL:** Registered in the index; may evolve; not yet sealed.
- **LOCKED:** Sealed by platform owner; immutable name and core content; version changes only via amendment.
- **DEPRECATED:** Being phased out; no new usage; existing uses migrate to replacement(s).

### 9.4 Versioning

A LOCKED standard has semantic versioning:
- **Major** — constitutional amendment (rare; usually retires old standard and introduces new one).
- **Minor** — clarification, example addition, dependency update (within existing scope).

Example: "Token Migration Standard v1.2" means major version 1, minor version 2.

## 10. Exception Process

### 10.1 When to file an exception

An exception is filed when:
1. A feature or fix requires deviating from a locked standard.
2. The team believes the standard is correct and the deviation is temporary.
3. A standing exception is needed because the standard is right but the codebase is structured such that full compliance would require a large refactor.

**Exceptions are NOT filed for:**
- PROVISIONAL standards (which are still evolving).
- Standards that haven't been released yet.
- Cases where the standard is wrong (amend the standard instead).

### 10.2 Filing an exception

1. **Create an issue** (GitHub) or **Exception record** (future: Governance Core database) with:
   - `id` — auto-generated or human-readable (e.g., `EXC-2026-001`).
   - `standard_id` — which standard is being deviated from.
   - `rationale` — why the deviation is necessary (business reason, technical constraint, timeline pressure).
   - `scope` — specific modules, entities, or functions affected.
   - `time_bound` — target remediation date, or "standing exception" if permanent approval.
   - `proposed_remediation` — the plan to bring the code back into compliance (or "none" for standing exception).

2. **Label the issue** with `exception` and the standard name (e.g., `exception:token-migration`).

3. **Tag the governance board** — specifically the platform owner and relevant core owners.

4. **Link to the PR** that introduces the deviation.

### 10.3 Approval

The governance board reviews the exception:
- **Approve** — rationale is sound; time-bound is reasonable; remediation plan is credible. Exception is recorded.
- **Reject** — ask for amendments (shorter time-bound, different approach, or no exception at all).
- **Request remediation details** — if the plan is vague, ask for specifics before approving.

Decision is recorded in the exception record with approver name(s) and date.

### 10.4 Auditing and reporting

At each quarterly review, governance audits:
- **In-remediation exceptions** — are they on track? Do time-bounds need adjustment?
- **Standing exceptions** — are they still necessary? Can we close any?
- **Closed exceptions** — confirm the code is now compliant.

Report published in `docs/governance/EXCEPTION_AUDIT_<YYYY-QQ>.md`.

## 11. Amendment Process

### 11.1 What requires an amendment

- Adding a 52nd core (or later cores).
- Splitting or merging cores.
- Retiring a core.
- Clarifying or tightening a hard boundary rule (L1–L8 from `01_PLATFORM_CORE_ARCHITECTURE.md`).
- Restructuring the 22 documents (renumbering, renaming).
- Changing the fundamental meaning of a Governance Law (§6 of this document).

### 11.2 Amendment process

1. **Write a proposal** — 2–3 paragraphs explaining the change, why it is necessary, which artifact(s) it affects, and the plan to implement it.

2. **Open a governance issue** tagged `amendment` with the proposal.

3. **Get platform owner approval** — async via issue comments. Amendments require explicit sign-off from Gev / Ընգեր.

4. **Update the document(s)** — make the structural change.

5. **Commit with amendment suffix:**
   ```
   docs(amendment): <description>
   
   [Detailed description of the amendment.]
   
   Approved by: <Gev / board member>
   Amendment ID: <YYYY-MM-DD-<short-name>>
   ```

6. **Record in amendment log** — add an entry to `docs/architecture/CONSTITUTION_AMENDMENT_LOG.md`:
   ```
   | 2026-06-07 | Add 52nd core: Forecasting | docs(amendment): ... | gev | Approved |
   ```

### 11.3 Amendment log

File: `docs/architecture/CONSTITUTION_AMENDMENT_LOG.md`

```markdown
# Constitution Amendment Log

| Date | Amendment | Commit | Approved By | Status |
|------|-----------|--------|-------------|--------|
| 2026-06-07 | <Description> | <short-hash> | Gev | Approved |
```

## 12. Drift Enforcement: `tools/check_drift.py`

### 12.1 Two kinds of rules

**HARD rules** — pattern anywhere in scope → immediate CI fail (exit 1). Used for canonicals fully rolled out with zero exceptions.

Example (from Token Migration Standard):
```python
HardRule(
    name="phantom-token-usage",
    description="Use phantom tokens (import from frontend/src/lib/tokens.ts) — do not hardcode color values",
    pattern=r'className="[^"]*(?:text-cobalt|bg-gold|border-azure)"',
    paths=["frontend/src"],
    exclude=["frontend/src/lib/tokens.ts"],
)
```

**RATCHET rules** — count must not INCREASE vs. baseline stored in `tools/check_drift_baseline.json`. Used for migration-tail items still cleaning up.

Example (from Token Migration Standard, phase-tail cleanup):
```python
RatchetRule(
    name="legacy-color-classnames",
    description="Migrate away from legacy color className patterns — use tokens instead",
    pattern=r'className="[^"]*(?:text-blue|bg-yellow)"',
    paths=["frontend/src"],
    baseline_key="legacy_color_classnames",
)
```

When a count DECREASES, the script auto-updates the baseline. The ratchet only goes down.

### 12.2 How to add a rule

1. **Identify the pattern** — regex or literal string that uniquely matches the anti-pattern.
2. **Write the rule** — add `HardRule(...)` or `RatchetRule(...)` to `tools/check_drift.py`.
3. **Set parameters:**
   - `name` — short ID (no spaces; used as lookup key).
   - `description` — what the developer should do INSTEAD.
   - `pattern` — regex.
   - `paths` — root directories to scan.
   - `exclude` — files where the pattern is the canonical itself (e.g., exclude the canonical implementation from the rule).
4. **Run locally** — `python tools/check_drift.py`. Fix any pre-existing violations before landing the rule.
5. **If many pre-existing violations, use RATCHET instead of HARD** — establish baseline, commit alongside rule.
6. **Document the rule** in the related standard (e.g., "Token Migration Standard" for token rules).

### 12.3 Baseline management

File: `tools/check_drift_baseline.json`

```json
{
  "legacy_color_classnames": 428,
  "raw_fetch_calls": 60,
  "direct_httpx_client": 0,
  …
}
```

When a count DECREASES (code was migrated), the script auto-updates the baseline. Commit the new baseline in the same PR as the migration.

### 12.4 The escape hatch: `--update`

`python tools/check_drift.py --update` forces a baseline rewrite at current counts.

Use ONLY when:
- A new ratchet rule was added (first run establishes baseline automatically).
- A rule's regex was tightened/broadened and the baseline shape changed (PR must explain why).

A PR that calls `--update` without one of those reasons is a regression in disguise. Reviewers should reject it.

### 12.5 CI integration

`.github/workflows/ci.yml` runs `tools/check_drift.py` in the backend job. Failure modes:

- **Hard rule violation** → exit 1, CI red, PR blocked.
- **Ratchet regression** → exit 2, CI red, PR blocked.
- **Pass** → exit 0, auto-update baseline for lowered counters; commit the new `check_drift_baseline.json` alongside the migration.

## 13. Per-PR Governance Metadata

Every PR touching core logic, entities, APIs, or standards declares in its description:

```
## Governance Declaration

**Primary core**: <Core name>
**Supporting cores**: <Core, Core, …>
**Domain**: <Domain name>
**Governance impact**: <None | Low | Medium | High>
**Exceptions filed**: <EXC-YYYY-NNN if any>
**Amendment required**: <Yes | No>
**Drift rules affected**: <Rule name(s) if any>
```

CI checks that this block is present on PRs touching `backend/`, `frontend/`, `alembic/`, or `docs/architecture/`.

**Governance impact levels:**
- **None** — cosmetic, no architectural consequence.
- **Low** — within-core change; no boundary touched.
- **Medium** — touches multiple cores or a hard boundary rule (L1–L8).
- **High** — proposes a new core, amends constitution, or touches multiple domains.

PRs flagged **Medium** or **High** require governance board review before merge.

## 14. Governance Board Structure

The governance board is an async decision-making group. Members and their responsibilities:

### 14.1 Platform Owner
**Role:** Gev / Ընգեր (on Gev's behalf)
- Approves all constitution amendments (§11).
- Final authority on exception approval.
- Sets standards-registry policy (when to LOCK a standard, when to propose deprecation).
- Approves new cores, core splits/merges, core retirements.

### 14.2 Architecture Lead (Phase 0–1)
**Role:** Ընգեր (as Gev's delegate)
- Reviews exceptions and amendments on behalf of platform owner (pre-filters for Gev's attention).
- Maintains the 22 constitution documents.
- Keeps the Platform Reference Model up to date with core maturity.
- Chairs the quarterly governance audit (§10.4).

### 14.3 Core Owners (Future: M2+)
**Roles:** One per major core as org grows (Identity Lead, Audit Lead, Workflow Lead, etc.)
- Owns the hardening checklist for their core (PRM 8-item list).
- Reviews exceptions that touch their core.
- Proposes standards that affect their core.
- Reports core maturity at milestone boundaries.

### 14.4 Domain Leads (Future: M2+)
**Roles:** One per domain (CRM Lead, OSS Lead, BSS Lead, etc.)
- Reviews cross-core decisions that affect their domain.
- Ensures domain configuration is aligned with core governance.
- Proposes domain-level standards.

### 14.5 Decision Mechanism (Async)

1. **Exception filing** — author tags the board in the issue.
2. **Board review** — members comment async with approval / feedback.
3. **Decision recorded** — once consensus (or Gev's decision) is clear, it is recorded in the exception/amendment record with date and approver names.
4. **Quarterly audit** — governance audit confirms compliance and tracks standing exceptions.

## 15. Governance Core Entities

The Governance Core owns four canonical entities:

### 15.1 Standard

```sql
CREATE TABLE standard (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    name TEXT NOT NULL,                    -- Immutable identity (e.g., "Token Migration Standard")
    number INT,                             -- Display order (1–70 for numbered; NULL for named)
    status TEXT NOT NULL CHECK (status IN ('LOCKED', 'PROVISIONAL')),
    owner TEXT NOT NULL,                    -- Department / role
    version TEXT NOT NULL,                  -- Semantic version (major.minor)
    source_file TEXT,                       -- Path to source document (e.g., docs/standards/05.md)
    summary TEXT,                           -- One sentence
    dependencies JSONB,                     -- Array of other standard names this depends on
    drift_rules JSONB,                      -- Array of rule names protecting this standard
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_amended_at TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,                  -- When status became LOCKED
    audit_id UUID REFERENCES audit_log(id),
    UNIQUE (tenant_id, name)
);
```

### 15.2 Exception

```sql
CREATE TABLE exception (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    exception_id TEXT UNIQUE,               -- Human-readable ID (EXC-2026-001)
    standard_id UUID NOT NULL REFERENCES standard(id),
    rationale TEXT NOT NULL,
    scope TEXT NOT NULL,                    -- Which modules/functions affected
    status TEXT NOT NULL CHECK (status IN ('FILED', 'APPROVED', 'IN_REMEDIATION', 'RESOLVED', 'CLOSED')),
    time_bound DATE,                        -- Remediation target, or NULL for standing
    approved_by UUID REFERENCES user_identity(id),
    approved_at TIMESTAMPTZ,
    remediation_plan TEXT,
    filed_by UUID NOT NULL REFERENCES user_identity(id),
    filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    audit_id UUID REFERENCES audit_log(id),
    CONSTRAINT exception_time_bound_future CHECK (time_bound > filed_at::date)
);
```

### 15.3 GovernanceBoard

```sql
CREATE TABLE governance_board (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    name TEXT NOT NULL,                     -- E.g., "Architecture Board"
    member_ids JSONB NOT NULL,              -- Array of user_identity.id UUIDs
    responsibilities TEXT,                  -- Text description of charter
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    audit_id UUID REFERENCES audit_log(id),
    UNIQUE (tenant_id, name)
);
```

### 15.4 ArchitectureLawRecord

```sql
CREATE TABLE architecture_law_record (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    type TEXT NOT NULL CHECK (type IN ('AMENDMENT', 'EXCEPTION_APPROVAL', 'CONSTITUTION_AMENDMENT', 'DRIFT_RULE_ADDITION')),
    artifact_type TEXT,                     -- 'standard' | 'core' | 'constitution' | etc.
    artifact_id UUID,                       -- Ref to standard.id, exception.id, or NULL if document-level
    artifact_name TEXT,                     -- For searches; e.g., "Token Migration Standard"
    decision TEXT CHECK (decision IN ('APPROVED', 'REJECTED', 'PENDING')),
    decision_detail TEXT,                   -- Comments, rationale
    approved_by UUID REFERENCES user_identity(id),
    approved_at TIMESTAMPTZ,
    commit_hash TEXT,                       -- Git commit if code-level
    audit_id UUID REFERENCES audit_log(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

All Governance Core entities are tenant-scoped and audited.

## 16. Relationship to Other Cores

### 16.1 Governance ← Identity
- Governance boards reference users (approvers).
- Exception approval records track who approved.
- Amendment approval is recorded in ArchitectureLawRecord.

### 16.2 Governance ← Audit
- Every standard change, exception approval, and amendment is audited.
- Every drift rule violation creates an audit record (CI/CD audit).

### 16.3 Governance ← Policy
- Policy rules may reference standards (e.g., "follow the RBAC Standard").
- Policy does NOT override Governance; violations are flagged.

### 16.4 Governance ← Security
- Governance records are immutable once created (append-only ledgers).
- Access to amendment and exception approval is permission-gated (`governance.manage`).

### 16.5 Governance → All Cores
- Governance is a constitutional layer; every core must comply with its standards.
- A core's maturity is tracked in the Platform Reference Model via the Core Maturity Ledger.

## 17. Operational Standards Governance

The 70 numbered standards are locked in the numbered 1–70 sequence (established 2026-06-06 and sealed in `docs/standards/00-standards-index.md`). New operational standards land as *named* files (e.g., `API_CLIENT_STANDARD.md`) in `docs/standards/` without disturbing the fixed sequence.

Process for proposing a new operational standard:
1. Write the standard in isolation (draft).
2. File a governance issue with the proposal.
3. Get platform owner approval.
4. Commit to `docs/standards/<STANDARD_NAME>.md` with initial status PROVISIONAL.
5. Add to the operational-standards table in `00-standards-index.md`.
6. Lock when consensus is reached.

---

*End of 17 — Governance Architecture.*
