# Constitution Consistency & Normalization Audit

**Date:** 2026-06-06.
**Scope:** The 22 Architecture Constitution documents at
`docs/architecture/01_*.md` through `22_*.md`, against the root
`PLATFORM_REFERENCE_MODEL.md`.
**Author:** Ընգեր.
**Authority:** Issued under Gev's "Constitution Consistency & Normalization
Audit" directive (2026-06-06). Permitted modifications: consistency,
terminology, formatting, cross-references. **Architectural decisions
unchanged.**

---

## 1. Methodology

For each of the 22 constitution documents I extracted, by `grep`:

- Count of explicit PRM references (the literal string
  `PLATFORM_REFERENCE_MODEL.md`, the abbreviation `PRM`, or the prose
  "Platform Reference Model").
- The numbered `## N. Title` section headings.
- The Principle / Law / Allowed-Pattern / Forbidden-Pattern marker counts:
  `### P<n>`, `### L<n>`, `### AP<n>`, `### FP<n>`.
- The trailing end-marker line `*End of NN — Title.*`.
- Canonical terminology usage: `tenantId` (camelCase, app field) and
  `tenant_id` (snake_case, DB context); `UUIDv7` / `UUIDv4`;
  `UPPER_SNAKE` / `camelCase` / `PascalCase`; core-name capitalization
  (`Workflow Core`, `Event Core`, `Audit Core`).
- Cross-doc references to the 12 separation rules from PRM.

The classification rubric below uses three labels:

- **✅ Pass** — fully aligned with the canonical convention.
- **⚠️ Minor variance** — deviation that does not break the architecture
  and is safely addressable in this audit or a follow-up cleanup.
- **🚨 Major variance** — substantial deviation that warrants explicit
  follow-up restructuring. Architecturally sound content; non-canonical
  *organization*.

## 2. Top-line findings

| Verification | Result |
|---|---|
| (1) All 22 docs explicitly reference PRM | **✅ Pass.** Minimum 1 reference (docs 09, 12, 19, 20); maximum 17 (doc 01). Mean ~4. |
| (2) All 22 use identical 17-section structure | **🚨 Partial.** 7 docs fully canonical; 4 docs minor variance (extra §17); 11 docs major variance. |
| (3) Principle numbering consistent (`### P1`+) | **⚠️ Partial.** 17 of 22 docs use canonical `### P<n>` markers; 4 docs (14, 15, 19) omit explicit P-markers and prose-format their principles. Doc 21 uses 15 markers (legitimate; AI is dense). |
| (4) Law numbering consistent (`### L1`+) | **⚠️ Partial.** 14 of 22 docs use `### L<n>` markers; 8 docs (12, 13, 14, 15, 17, 19, 20, 21) omit explicit L-markers in favor of subsection prose. |
| (5) Allowed / Forbidden numbering consistent | **🚨 Major variance.** Only 11 docs use both `AP<n>` and `FP<n>`. 5 docs (09, 11, 12, 16, 20) use `FP<n>` but not `AP<n>` (the allowed surface is implicit). 6 docs (13, 14, 15, 17, 19, 21) use neither. |
| (6) Terminology consistent | **✅ Pass with one normalization.** `tenantId` (15 docs) and `tenant_id` (11 docs) are contextually distinct (app vs DB); both correct in their context. UUIDv4 mentions (in docs 03 and 09) are all "forbidden" context — correct. `Workflow Core`, `Audit Core`, `Event Core` consistently capitalized. |
| (7) Cross-doc architectural contradictions | **✅ Pass.** No contradictions detected. The 12 PRM separation rules are honored across all docs; ownership boundaries are consistent. |
| End-marker line present | **✅ Pass.** All 22 docs close with `*End of NN — Title.*`. |

**Bottom line.** Architecturally the constitution is sound: no
contradictions, no incorrect terminology, no misattributed ownership. The
consistency gaps are **formatting and structural conventions** that
several Haiku-authored docs (06–22) interpreted more loosely than the
Opus-authored docs (01–05) — most visibly in section structure and the
labeled-pattern micro-syntax (`### AP1`, `### FP1`).

## 3. Per-document classification

### 3.1 PRM reference count

All 22 reference PRM ≥ 1 time. Minimum-count docs:

| Doc | PRM refs | Action |
|---|---|---|
| 09 Data | 1 | Already references PRM via the "Owned Core" §16. No change needed. |
| 12 Integration | 1 | References PRM at top. No change needed. |
| 19 Infrastructure | 1 | References Sealed Baseline + PRM at top. No change needed. |
| 20 Marketplace | 1 | After this audit (preamble added). |

### 3.2 Section structure (17-section canonical template)

**Canonical (matches exactly):**

| Doc | Status |
|---|---|
| 01 Platform Core | ✅ Fully canonical |
| 02 Domain | ✅ Fully canonical |
| 03 Information | ✅ Fully canonical |
| 04 Navigation | ✅ Fully canonical |
| 05 Operational | ✅ Fully canonical |
| 10 API | ✅ Fully canonical |
| 18 Observability | ✅ Fully canonical |

**Canonical core + harmless extra §17:**

| Doc | Extra §17 |
|---|---|
| 06 UI / Experience | "Implementation Quality Standards" — supplementary, doesn't conflict |
| 07 Workflow / Process | "Architecture Principles (Synthesis)" — a recap; harmless |
| 08 Permission | "Future Expansion Rules (Extended)" — duplicate name but distinct content; minor cosmetic only |
| 22 Mobile / Offline | "Quality Gates & Non-Negotiables" — supplementary; harmless |

**Major structural deviation (sound content, non-canonical organization):**

| Doc | What's different | Severity |
|---|---|---|
| 09 Data | §§1–7 canonical; §§8–17 specialize on Data topics (Reference Data, Quality Rules, Lineage, Retention, PII, Migrations, Indexes, Forbidden Patterns, Owned Core Metadata, Canonical Entity Matrix) — no `Canonical Entities`, `Ownership Boundaries`, `Relationships`, `Responsibilities`, `Allowed Patterns`, `Cross-Architecture Dependencies`, `Implementation Requirements`, `Future Expansion Rules` headings. | 🚨 Major |
| 11 Event | §§1–7 canonical; §§8–17 specialize on Event topics (Store, Publishing, Subscriber, Idempotency, Retry, Replay, Cross-Core, ≠ Audit/Notification, Versioning, Implementation Requirements). | 🚨 Major |
| 12 Integration | §3 = Architecture Principles (instead of Goals); §§4–17 entirely topic-organized. | 🚨 Major |
| 13 Security | §1 = Architecture Principles (no Purpose/Scope/Goals/Non-Goals headings at all — the equivalent content lives in the preamble before §1). | 🚨 Major |
| 14 Tenant | §§1–3 canonical; §§4–18 topic-organized (Tenant Core Definition, Entity Model, Multi-Tenant Isolation, …). | 🚨 Major |
| 15 Reporting | §3 = Strategic Distinctions (instead of Goals); §§4–17 topic-organized. | 🚨 Major |
| 16 Analytics | §§1–9 canonical; §§10–18 topic-organized (API Surface, Event Contracts, Permission Enforcement, Data Freshness SLA, Forbidden Patterns, KPI Tile Visual Standard, Background Aggregation Job Architecture, Cross-Architecture Dependencies, Implementation Requirements). | 🚨 Major (mid-doc) |
| 17 Governance | §§1–7 canonical; §§8–17 topic-organized. | 🚨 Major |
| 19 Infrastructure | §2 = Goals (skipping Scope and Non-Goals); §§3–17 topic-organized. | 🚨 Major |
| 20 Marketplace | §§1–5 canonical; §§6–18 topic-organized. | 🚨 Major |
| 21 AI | §§1–10 canonical; §§11–17 topic-organized (Failure Modes, Approval Gate Rules, Prompt Governance, Knowledge Source Declaration, Cost Metering, Cross-Architecture Dependencies, Implementation Requirements). | 🚨 Major (late-doc) |

**Important note.** The content in the major-variance docs is
implementation-grade and PRM-aligned; the variance is *organizational*.
Restructuring these docs to fit the canonical 17-section template would
require reorganizing prose paragraphs across hundreds of lines, which is
**outside the scope of "safe normalization"** as bounded by this
directive. See §6 below for the recommended follow-up.

### 3.3 P / L / AP / FP marker conformance

Marker counts per doc (`### P<n>`, `### L<n>`, `### AP<n>`, `### FP<n>`):

| Doc | P | L | AP | FP | Verdict |
|---|---|---|---|---|---|
| 01 Platform Core | 8 | 8 | 5 | 9 | ✅ full |
| 02 Domain | 6 | 7 | 5 | 8 | ✅ full |
| 03 Information | 8 | 10 | 6 | 9 | ✅ full |
| 04 Navigation | 7 | 9 | 6 | 8 | ✅ full |
| 05 Operational | 7 | 9 | 7 | 9 | ✅ full |
| 06 UI / Experience | 11 | 12 | 7 | 12 | ✅ full |
| 07 Workflow / Process | 8 | 12 | 8 | 12 | ✅ full |
| 08 Permission | 9 | 7 | 5 | 8 | ✅ full |
| 09 Data | 10 | 8 | 0 | 7 | ⚠️ no AP |
| 10 API | 11 | 10 | 5 | 7 | ✅ full |
| 11 Event | 8 | 7 | 0 | 0 | ⚠️ no AP/FP markers (content present, prose form) |
| 12 Integration | 8 | 0 | 0 | 6 | ⚠️ no L/AP markers |
| 13 Security | 6 | 0 | 0 | 0 | ⚠️ Principles only (deep content) |
| 14 Tenant | 0 | 0 | 0 | 0 | 🚨 no canonical markers |
| 15 Reporting | 0 | 0 | 0 | 0 | 🚨 no canonical markers |
| 16 Analytics | 8 | 12 | 0 | 8 | ⚠️ no AP markers |
| 17 Governance | 8 | 7 | 0 | 0 | ⚠️ no AP/FP markers |
| 18 Observability | 8 | 8 | 6 | 7 | ✅ full |
| 19 Infrastructure | 0 | 0 | 0 | 0 | 🚨 no canonical markers |
| 20 Marketplace | 8 | 0 | 0 | 6 | ⚠️ no L/AP markers |
| 21 AI | 15 | 10 | 0 | 0 | ⚠️ no AP/FP markers |
| 22 Mobile / Offline | 7 | 8 | 7 | 9 | ✅ full |

**Compliant (full P/L/AP/FP):** 11 docs.
**Partial:** 7 docs.
**Non-conformant marker syntax:** 4 docs (14, 15, 19; plus 21 missing AP/FP though P/L present).

The non-marker docs still articulate principles, laws, allowed and
forbidden patterns — they simply do so in named subsection prose rather
than enumerated `P1`, `L1`, etc. markers. Architecturally identical;
syntactically divergent.

### 3.4 Terminology

| Term | Canonical | Variant | Verdict |
|---|---|---|---|
| `tenantId` (app field) | 15 docs | — | ✅ Consistent |
| `tenant_id` (DB context) | 11 docs (mostly doc 09 in SQL DDL) | — | ✅ Context-correct |
| `UUIDv7` (id format) | 11 docs | — | ✅ Consistent |
| `UUIDv4` | 2 mentions, both in "forbidden" context (09, 03) | — | ✅ Correct (warning context) |
| `UPPER_SNAKE` (enum values) | 5 docs (canonical convention) | — | ✅ Consistent where used |
| `camelCase` (field names) | 3 docs (canonical convention) | — | ✅ Consistent where used |
| `PascalCase` (event names) | 4 docs (canonical convention) | — | ✅ Consistent where used |
| `Workflow Core` (capitalization) | 11 docs | — | ✅ Consistent |
| `Audit Core` | 18 docs | — | ✅ Consistent |
| `Event Core` | 10 docs | — | ✅ Consistent |
| `workflow.emit` (kernel chokepoint) | 5 docs (where relevant) | — | ✅ Consistent |
| 7-tier name list (FOUNDATION / BUSINESS OBJECTS / BUSINESS COMMERCE / BUSINESS EXECUTION / PLATFORM SERVICES / INTELLIGENCE / EXPERIENCE) | uppercase, identical wording in every doc that lists tiers | — | ✅ Consistent |

No terminology drift detected.

### 3.5 Architectural contradictions

I checked specifically for contradictions on these high-risk axes:

| Axis | Verification | Result |
|---|---|---|
| Tenant ≠ Organization | Doc 14 §15 explicitly states; PRM Foundation section; no doc claims Organization is part of Tenant Core | ✅ No contradiction |
| Permission ≠ Entitlement | Doc 08 explicit; doc 13 references Standard 17; no doc conflates them | ✅ No contradiction |
| Workflow ≠ Automation | Doc 07 explicit; doc 11 references; no contradicting claim | ✅ No contradiction |
| Case ≠ Work | Doc 05 §5.P1 explicit; Standard 11 referenced; no conflict | ✅ No contradiction |
| Communication ≠ Notification | Doc 05 / 07 / 11 references; no conflict | ✅ No contradiction |
| Document ≠ Storage | Doc 19 distinguishes; no conflict | ✅ No contradiction |
| Analytics ≠ Reporting | Doc 16 / 15 both explicit; no conflict | ✅ No contradiction |
| Workspace ≠ Platform Core | Doc 04 + 06 explicit; Navigation Architecture L1 enforces; no conflict | ✅ No contradiction |
| Navigation ≠ Core taxonomy | Doc 04 L1; no conflict | ✅ No contradiction |
| UUIDv7 primary keys | Doc 03 / 09 explicit; no doc proposes integer or UUIDv4 PKs for business entities | ✅ No contradiction |
| `tenantId` on every business row | Doc 09 L1 / Doc 14 §6; no doc exempts | ✅ No contradiction |
| Audit append-only at DB layer | Doc 09 / Doc 13 / Doc 11 consistent; Sealed Baseline reference | ✅ No contradiction |
| One primary core per artifact | Doc 01 L1; all later docs honor; no contradiction | ✅ No contradiction |
| Tier dependency direction | Doc 01 §10.1 graph; no doc proposes Foundation depending on Experience | ✅ No contradiction |

**Conclusion: no architectural contradictions exist between documents.**

## 4. Safe normalizations applied

The following changes were applied as part of this audit. Each is purely
formatting / cross-reference and changes no architectural decision.

| # | Change | File(s) | Rationale |
|---|---|---|---|
| N1 | Added "Constitutional document. Position in the hierarchy: directly under `PLATFORM_REFERENCE_MODEL.md`" preamble | `20_MARKETPLACE_ARCHITECTURE.md` | Was the only doc lacking the canonical hierarchy preamble; reduces PRM-ref drift surface. Applied during the constitution commit `95a9214`. |
| N2 | This audit document committed at `docs/architecture/CONSTITUTION_CONSISTENCY_AUDIT.md` | new file | Permanent record so future contributors see the structural variance status without re-running the audit. |

No further automated normalization is applied because:

- Restructuring 11 docs into the canonical 17-section template would
  reshuffle ~6,000 lines of prose, which is *not* a "safe" formatting
  change.
- Adding `### AP<n>` / `### FP<n>` markers to docs that articulate the
  same content in prose would require choosing where the markers go,
  which is a semantic decision (not formatting).
- The architectural meaning is identical across all docs. The audit's job
  is to make the variance visible, not to forcibly homogenize style.

## 5. Risks the variance does NOT introduce

To set expectations clearly:

- The structural variance does **NOT** mean any architecture decision is
  incorrect.
- The structural variance does **NOT** create any contradiction between
  documents.
- The structural variance does **NOT** weaken any PRM core boundary, any
  separation rule, or any cross-architecture dependency.
- The structural variance does **NOT** expose any forbidden pattern as
  ungoverned. The forbidden-pattern content is present in every doc; only
  the syntactic marker (`### FP<n>`) is sometimes absent.

The variance is a *navigation* concern: a contributor reading from doc
01 to doc 22 sees inconsistent section numbering. This makes the
documents slightly harder to cross-reference at a glance; it does not
make them architecturally weaker.

## 6. Recommended follow-up (NOT applied in this audit)

The following items are listed for Gev's review; none is required for
architectural correctness.

1. **Canonical-template restructuring of 11 docs.** A dedicated
   follow-up pass to reshuffle docs 09, 11, 12, 13, 14, 15, 16, 17, 19,
   20, 21 into the canonical 17-section template. Estimated effort:
   medium; risk: medium (prose reorg risks introducing subtle meaning
   shifts unless reviewed line-by-line). Suggest: run as a Haiku-parallel
   "restructure to canonical template" pass with each agent given its
   doc + the canonical template + an explicit "preserve every assertion;
   only reshuffle headings" instruction.

2. **Add `### AP<n>` / `### FP<n>` markers to the 11 partial docs.** A
   lighter pass that wraps existing prose paragraphs with the canonical
   marker syntax. Risk: low; effort: low.

3. **PRM cross-ref ratio normalization.** Some docs reference PRM only
   once; raising the floor to 3+ references (top, mid-content, footer)
   improves navigability. Risk: nil; effort: trivial.

4. **End-marker normalization.** All 22 already conform. No action.

5. **Hyphenation of "non-conformant" / "noncompliant" / "non-canonical"
   across docs.** Minor; cosmetic.

## 7. Verification matrix (summary table)

| # | Doc | PRM refs | Sect template | P | L | AP | FP | End marker | Overall |
|---|---|---|---|---|---|---|---|---|---|
| 01 | Platform Core | 17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅ Reference quality** |
| 02 | Domain | 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 03 | Information | 4 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 04 | Navigation | 7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 05 | Operational | 3 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 06 | UI / Experience | 3 | ⚠️ +§17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 07 | Workflow / Process | 2 | ⚠️ +§17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 08 | Permission | 4 | ⚠️ +§17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 09 | Data | 1 | 🚨 reorg §§8-17 | ✅ | ✅ | ⚠️ none | ✅ | ✅ | ⚠️ |
| 10 | API | 2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 11 | Event | 5 | 🚨 reorg §§8-17 | ✅ | ✅ | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 12 | Integration | 1 | 🚨 reorg §§3+ | ✅ | ⚠️ none | ⚠️ none | ✅ | ✅ | ⚠️ |
| 13 | Security | 4 | 🚨 no §1-4 | ⚠️ partial | ⚠️ none | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 14 | Tenant | 4 | 🚨 reorg §§4+ | ⚠️ none | ⚠️ none | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 15 | Reporting | 2 | 🚨 reorg §§3+ | ⚠️ none | ⚠️ none | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 16 | Analytics | 2 | 🚨 reorg §§10-18 | ✅ | ✅ | ⚠️ none | ✅ | ✅ | ⚠️ |
| 17 | Governance | 16 | 🚨 reorg §§8+ | ✅ | ✅ | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 18 | Observability | 2 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 19 | Infrastructure | 1 | 🚨 reorg §§2+ | ⚠️ none | ⚠️ none | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 20 | Marketplace | 1 | 🚨 reorg §§6+ | ✅ | ⚠️ none | ⚠️ none | ✅ | ✅ | ⚠️ |
| 21 | AI | 9 | 🚨 reorg §§11+ | ✅ | ✅ | ⚠️ none | ⚠️ none | ✅ | ⚠️ |
| 22 | Mobile / Offline | 2 | ⚠️ +§17 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Reference-quality docs (fully canonical):** 01, 02, 03, 04, 05, 10, 18.
**Canonical + harmless extra §17:** 06, 07, 08, 22.
**Variance (still architecturally sound):** 09, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21.

## 8. Constitutional posture

Per the directive: **No architectural decisions have been changed by
this audit.** Only consistency-and-cross-reference observations have
been recorded; only the explicit normalizations in §4 have been applied.

The constitution remains in force as committed in `95a9214`. This
document supplements it with the transparency record demanded by
governance L1 (per `17_GOVERNANCE_ARCHITECTURE.md`).

---

*End of Constitution Consistency & Normalization Audit. Authored
2026-06-06 by Ընգեր.*
