# Documentation Categorization Audit

**Date:** 2026-06-06.
**Authority:** Gev's directive: *"we have so much done already we just need to put all into correct box, BUT IN A CLEAN WAY, NOT LIKE 3 STANDARDS 1 FROM EACH, OTHERS DELETE."*
**Author:** Ընգեր.
**Status:** **EXECUTED 2026-06-06** — all 10 moves applied via `git mv`, all 5 cross-links added, CONTENT-VOICE promoted to named standard. See §14 for execution record.
**Principle:** *Categorize existing content first; invent new content only when nothing exists.*

---

## 1. Canonical boxes (the layers we have)

```
docs/governance/    ← PROJECT_CONSTITUTION (LOCKED)
docs/architecture/  ← PRM + 22 docs + indexes + audits + sealed baselines (LOCKED)
docs/standards/     ← 70 LOCKED + 7 named (LOCKED)
docs/catalogs/      ← Catalog Layer (building now)
docs/specs/         ← Feature/subsystem implementation specs (M1 contracts)
docs/runbooks/      ← Operational procedures (how to run the system / build features)
docs/audit/         ← Point-in-time historical snapshots (immutable record)
docs/roadmap/       ← Time-bound forward planning
docs/branding/      ← Brand v3.0 LOCKED + archives
```

A file belongs in exactly one box. Files currently mis-boxed need to MOVE
(via `git mv` so history is preserved). No deletes except for true exact
duplicates or pre-v3.0 deprecated marker files (with explicit rationale).

## 2. Inventory summary

| Box | Files | Status |
|---|---|---|
| `governance/` | 1 | ✅ Canonical |
| `architecture/` | 33 | ✅ Canonical (LOCKED) |
| `standards/` | 35 | ✅ Canonical (LOCKED) |
| `catalogs/` | 1 | 🟡 Building (Matrix draft only) |
| `specs/` | 16 | 🟡 Mostly canonical, some need promotion or move |
| `runbooks/` | 1 | 🟡 Need more from root + specs |
| `audit/` | 11 | ✅ Canonical (historical, immutable) |
| `roadmap/` | 1 | ✅ Canonical |
| `branding/` | 50+ | ✅ Canonical (LOCKED v3.0; pre-v3.0 archived) |
| `docs/` root | 7 | 🚨 **ALL 7 NEED MOVING** |
| **Total** | **~156 .md files** | |

## 3. Root-level files — proposed moves

All 7 root-level `.md` files need to leave the root. Each has a clear canonical home.

| File | Verdict | Move to | Why |
|---|---|---|---|
| `BATCH-PLAYBOOK.md` | **MOVE** | `docs/runbooks/BATCH-PLAYBOOK.md` | "Canonical working method for batches" — pure runbook content (coordinator window, lane agents, model tiering). |
| `BRAND.md` | **MOVE + flag as DEPRECATED** | `docs/branding/_archive/pre-D18/BRAND_pre-D18.md` | Self-declares DEPRECATED 2026-06-04 on line 1. Pre-D18 palette + system-ui font; superseded by Standard 09 + Brand v3.0. Move into the existing `_archive/` tree alongside v1.1 / v2.0 archives. |
| `COMPONENT-INVENTORY.md` | **MOVE** | `docs/catalogs/COMPONENT_CATALOG.md` | Already a catalog by content: tier-ordered list of ~80 UI components with build status. Fits the catalog layer perfectly. |
| `M1-C-ENV.md` | **MOVE** | `docs/runbooks/M1-C-ENV.md` | `.env` shape for vendor integrations — operational config doc, not architecture. |
| `M1A-DEPLOY-CONTRACT.md` | **MOVE** | `docs/runbooks/M1A-DEPLOY-CONTRACT.md` | Production deploy contract (role split, RLS engagement). It's an operational hardening contract; ratified architecture lives in `13_SECURITY_ARCHITECTURE.md` (which already references this). |
| `PRE-LAUNCH-CHECKLIST.md` | **MOVE** | `docs/runbooks/PRE-LAUNCH-CHECKLIST.md` | Pre-prod checklist with status legend. Operational. |
| `SYSTEM-INVENTORY.md` | **MOVE** | `docs/catalogs/SYSTEM_CAPABILITY_CATALOG.md` | ~110 non-UI capabilities, tiered with build status. It's a system capability catalog. Also where browser-support + a11y + i18n + motion notes live — addresses several of the "gaps" I previously flagged. |

**Net effect:** root has zero `.md` files; `docs/runbooks/` grows from 1 → 5 entries; `docs/catalogs/` grows from 1 → 3 entries; `docs/branding/_archive/` gains one pre-D18 artifact.

## 4. `docs/specs/` — proposed moves (small)

15 of 16 specs are correctly placed. 2 files belong elsewhere by content type.

| File | Verdict | Move to | Why |
|---|---|---|---|
| `DAILY-LOOP.md` | **MOVE** | `docs/runbooks/DAILY-LOOP.md` | Self-titled "ISP Daily Loop **Runbook**" on line 1; describes how to run the back-office chain. Pure runbook. |
| `LAUNCH-HARDENING.md` | **MOVE** | `docs/runbooks/LAUNCH-HARDENING.md` | "Production Deployment Hardening Guide" — a runbook for operators. |
| `CONTENT-VOICE.md` | **HOLD** but flag for promotion to a Standard (e.g. file 23 "Content & Voice Standard") since it's normative for all UI copy. Future LAW-GV1 amendment opportunity. | (no move now) | Voice & tone is normative project-wide, but no Content & Voice Standard exists yet. Today it sits adequately in specs/. |
| The other 13 specs | **STAY** | (no move) | Each is a feature-implementation spec correctly in specs/. |

Files staying in `specs/` (13):
- `ACCESS-AND-SCHEDULER.md`, `BILLING.md`, `CALENDAR.md`, `CONTENT-VOICE.md`,
  `DESIGN_SYSTEM.md`, `HELPDESK.md`, `MOTION-AND-ADAPTERS.md`,
  `NOTIFICATIONS-DEPTH.md`, `OUTBOUND.md`, `PAYMENTS-GATEWAY.md`,
  `REPORTING-DELIVERY.md`, `SEARCH.md`, `STATES-AND-OPS.md`, `WORKITEMS.md`

## 5. The 5 architecture "gaps" — how categorization closes them

This is where my Gap Analysis went wrong: I called Knowledge / Search / Developer Platform / etc. "gaps needing new arch docs" without first checking what's already in `docs/specs/` and `docs/standards/`. Reframing:

| Original "gap" | Actually closed by | Action |
|---|---|---|
| **Search Core** — thin treatment | `docs/specs/SEARCH.md` is a complete subsystem design (global cross-entity search + saved/recent/pinned + command palette + RLS scoping). | Add cross-link from `04_NAVIGATION_ARCHITECTURE.md` §7.4 (Command palette) and `10_API_ARCHITECTURE.md` (search resource path) → `docs/specs/SEARCH.md`. Gap closes. |
| **Developer Platform Core** — thin treatment | Existing standards: `OPENAPI_CODEGEN_STANDARD.md`, `API_CLIENT_STANDARD.md`, `AUTH_CONTEXT_STANDARD.md`. Plus `10_API_ARCHITECTURE.md` already references them. | Add explicit cross-links from `10_API` + `20_MARKETPLACE` to the three named standards. Gap closes. |
| **Import/Export Core** — thin treatment | Standard 08 (Reporting/Import/Export/Tenant/Localization/Config/Feature) explicitly covers Import/Export. `docs/specs/REPORTING-DELIVERY.md` covers scheduled exports. | Add cross-links from `09_DATA_ARCHITECTURE.md` to Standard 08 and the spec. Gap closes. |
| **Template Core** — thin treatment | Standard 08 covers it; `docs/specs/REPORTING-DELIVERY.md` + `docs/specs/BILLING.md` reference invoice templates; `docs/specs/NOTIFICATIONS-DEPTH.md` references notification templates. | Add cross-links from `15_REPORTING_ARCHITECTURE.md` to the standard + specs. Gap closes. |
| **Browser support / OSS licensing / AI ethics** | `docs/SYSTEM-INVENTORY.md` (once moved to `docs/catalogs/SYSTEM_CAPABILITY_CATALOG.md`) is the inventory of these concerns. WCAG, motion, browser-support, i18n already enumerated there with status. | Cross-link from `19_INFRASTRUCTURE_ARCHITECTURE.md` to the moved catalog. Gap closes (browser support + a11y); OSS licensing + AI ethics remain truly thin. |

## 6. True residual content gaps (not closed by categorization)

| Concern | Why truly thin | Disposition |
|---|---|---|
| **Knowledge Core** | PRM marks WEAK. No spec exists for SOP / Runbook / Article / KB entity model. M1 doesn't require it. | **Record as future M2+ amendment** per LAW-GV1; not blocking. Acceptable per PRM's own status declaration. |
| **Decision Support Core** | No spec, no standard. Cross-doc references only in 16/21. | **Record as future amendment.** Decision Support is downstream of AI Core (also WEAK); maturing together is fine. |
| **OSS licensing policy** | No explicit posture document. | **Record as future amendment.** Recommend adding to `docs/runbooks/PRE-LAUNCH-CHECKLIST.md` as an item before first paying customer. |
| **AI acceptable-use / ethics policy** | `21_AI_ARCHITECTURE.md` covers boundaries (no PII leak, tenant isolation, approval gates) but no explicit "acceptable use" policy doc. | **Record as future amendment.** Reasonable for M1 since AI Core is WEAK. |

These are **non-blocking** for ratifying the Architecture Layer. They're legitimate future-amendment work — not lazy deferrals, not "skip" requests. Each has a concrete amendment path through LAW-GV1.

## 7. Other layers — verify-and-leave

| Box | Action | Notes |
|---|---|---|
| `docs/governance/` | LEAVE | PROJECT_CONSTITUTION.md permanently locked. |
| `docs/architecture/` | LEAVE | 22 docs + indexes LOCKED. 5 audit/sealed/Q-package files all correctly anchored here. |
| `docs/standards/` | LEAVE | 70 LOCKED + 7 named; index already references the constitution + PRM. |
| `docs/audit/` | LEAVE | 11 date-stamped historical snapshots; immutable record. |
| `docs/roadmap/` | LEAVE | M1 expansion plan. |
| `docs/runbooks/` | GROW (per §3 + §4 moves) | From 1 → ~7 entries; becomes the proper operational doc box. |
| `docs/branding/` | LEAVE Brand v3.0 LOCKED tree; accept the one pre-D18 archive addition per §3. | v3.0 is permanent. |
| `docs/specs/` | LEAVE most; 2 moves per §4 | 14 specs remaining; clean home for feature specs. |
| `docs/catalogs/` | GROW (per §3 moves + future catalogs) | From 1 → 3 entries now; future catalogs continue to populate. |

## 8. Files I am NOT touching (and why)

- **Brand v3.0 LOCKED tree** (`docs/branding/v3.0/**`): permanent. Trademarks, certifications, archive. Even if a file inside seems redundant, it's locked.
- **All `docs/audit/*` files**: each is a date-stamped historical snapshot — moving or consolidating them would corrupt the audit trail.
- **All `docs/standards/*` files**: LOCKED; the standards-index preamble already anchors them under the Constitution.
- **All `docs/architecture/*` files**: ratification in progress; structural moves would violate LAW-AR3 (no architecture bypass).
- **`docs/branding/_research/*`**: research notes; correctly archived.

## 9. Cleanups deliberately NOT proposed (and why)

I considered three other moves and rejected them:

1. **Merging `BRAND.md` and `docs/branding/README.md`.** Rejected: `BRAND.md` is genuinely deprecated content from the pre-D18 era; merging would pollute the canonical readme. Archiving is cleaner.

2. **Consolidating multiple Brand v3.0 audits** (`Brand_v3.0_Certification_Audit.md`, `Brand_v3.0_Final_Certification_Audit.md`, `Brand_v3.0_Permanent_Freeze_Audit.md`, `Brand_Final_Certification_Audit_v2.md`, etc.). Rejected: each is a date-stamped certification artifact; consolidating would erase the trail. Brand v3.0 LOCKED is permanent.

3. **Deleting any of the production-remediation audit files.** Rejected: they're the production-stabilization record. Historical.

## 10. Proposed execution plan

**Phase A — root cleanup (7 moves):**

```bash
git mv docs/BATCH-PLAYBOOK.md            docs/runbooks/BATCH-PLAYBOOK.md
git mv docs/M1-C-ENV.md                  docs/runbooks/M1-C-ENV.md
git mv docs/M1A-DEPLOY-CONTRACT.md       docs/runbooks/M1A-DEPLOY-CONTRACT.md
git mv docs/PRE-LAUNCH-CHECKLIST.md      docs/runbooks/PRE-LAUNCH-CHECKLIST.md
git mv docs/COMPONENT-INVENTORY.md       docs/catalogs/COMPONENT_CATALOG.md
git mv docs/SYSTEM-INVENTORY.md          docs/catalogs/SYSTEM_CAPABILITY_CATALOG.md
git mv docs/BRAND.md                     docs/branding/_archive/pre-D18/BRAND_pre-D18.md
```

**Phase B — specs cleanup (2 moves):**

```bash
git mv docs/specs/DAILY-LOOP.md          docs/runbooks/DAILY-LOOP.md
git mv docs/specs/LAUNCH-HARDENING.md    docs/runbooks/LAUNCH-HARDENING.md
```

**Phase C — close the 4 categorization-curable architecture gaps** (5 cross-link edits to existing docs):

- `04_NAVIGATION_ARCHITECTURE.md` §7.4 → add link to `docs/specs/SEARCH.md`.
- `10_API_ARCHITECTURE.md` → add link to `OPENAPI_CODEGEN_STANDARD.md`, `API_CLIENT_STANDARD.md`, `AUTH_CONTEXT_STANDARD.md`.
- `09_DATA_ARCHITECTURE.md` → add link to Standard 08 + `docs/specs/REPORTING-DELIVERY.md`.
- `15_REPORTING_ARCHITECTURE.md` → add link to Standard 08 + relevant specs.
- `19_INFRASTRUCTURE_ARCHITECTURE.md` → add link to `docs/catalogs/SYSTEM_CAPABILITY_CATALOG.md` (the moved SYSTEM-INVENTORY).

These edits are content-additions within the Cross-Architecture Dependencies / Implementation Requirements sections — they don't alter architectural decisions, they just resolve the "thin treatment" verdict.

**Phase D — record true residual gaps as LAW-GV1 amendment candidates:**

Update `docs/architecture/ARCHITECTURE_GAP_ANALYSIS.md` to reflect:
- 5 of the 5 original "minor gaps" now triaged:
  - 3 closed by linking to existing content (Search, Developer Platform, Import/Export + Template).
  - 1 closed by linking to moved catalog (Browser support / a11y / motion via SYSTEM_CAPABILITY_CATALOG).
  - 2 confirmed as genuine future-amendment candidates: **Knowledge Core, Decision Support Core**.
  - Plus 2 new clarified residuals: **OSS licensing policy, AI acceptable-use policy**.

**Phase E — re-issue Ratification Report:**

`docs/architecture/ARCHITECTURE_LAYER_RATIFICATION.md` updates to:
- Show 0 critical gaps (unchanged).
- Show 4 residual minor gaps (down from 5 unspecified) with concrete amendment paths.
- Confirm Architecture Layer ready to LOCK.

## 11. Decision points for Gev

Three things I want you to weigh in on before I execute:

1. **`CONTENT-VOICE.md` — promote to a Standard?**
   Stays in specs/ today; it's actually normative across UI copy / errors / empty states / i18n. Would become e.g. `docs/standards/23-content-voice-standard.md`. This is a new standard — needs LAW-GV1 amendment. Worth doing now or defer?

2. **`BRAND.md` archive vs delete?**
   Move-to-archive preserves the historical pre-D18 snapshot. Delete drops the legacy noise. Either is defensible. Archive is safer (matches your no-deletes-of-historical-record stance).

3. **Catalogs to build next** (after the Matrix):
   - `COMPONENT_CATALOG.md` (incoming from `COMPONENT-INVENTORY.md` move)
   - `SYSTEM_CAPABILITY_CATALOG.md` (incoming from `SYSTEM-INVENTORY.md` move)
   - Plus per PRM implementation sequence: Entity / API / Event / Page / Module / Integration / Permission / Enum

   Two of these literally already exist as inventory docs and just need re-homing. The rest get authored during the Catalog Layer LAW-GV3 cycle.

## 12. What this audit does NOT do

- **Does not create any new architecture docs.** (Honors your earlier directive.)
- **Does not delete any historical record.** (Honors your archive-don't-delete preference.)
- **Does not pick 3 representative items and ignore the rest.** Every doc is classified; every move is named; every "gap" gets a specific close action.
- **Does not invent content.** Where the architecture docs are "thin" it's because the deep content lives in specs/ or standards/ — the gap closes by linking, not by writing more.

---

## 13. Summary

| Action | Count |
|---|---|
| Files moved (root → boxes) | 7 |
| Files moved (specs → runbooks) | 2 |
| Files staying put (verified canonical) | ~140 |
| Architecture docs gaining cross-links | 5 |
| "Gaps" closed by categorization | 4 of 5 originally claimed |
| True residual amendment candidates | 4 (Knowledge, Decision Support, OSS licensing, AI ethics) |
| Files deleted | **0** |

Total moves: **9 git mv commands**. Total edits: **5 cross-link additions** to existing arch docs. Zero deletes. Zero new architecture docs created.

**This is the clean categorization pass, axper. No 3-pick. No throwaway. Every doc has a home.**

Say go and I execute Phases A–E in a single commit batch, then re-issue the Ratification Report.

---

## 14. Execution record

**Executed 2026-06-06 by Ընգեր on Gev's "go till the end" directive.**

Decisions made on the 3 open questions:

1. **CONTENT-VOICE.md** → promoted to named standard `docs/standards/CONTENT_VOICE_STANDARD.md`. Added to the standards index under "Named operational standards" section.
2. **BRAND.md** → archived (not deleted) to `docs/branding/_archive/pre-D18/BRAND_pre-D18.md`.
3. **Next-catalog order after Matrix** → Entity → API → Event → Page → Module → Integration (dependency-ordered). Permission + Enum already have authoritative registries; will be linked, not duplicated.

Phase A executed (7 moves):
- `BATCH-PLAYBOOK.md` → `runbooks/BATCH-PLAYBOOK.md` ✅
- `M1-C-ENV.md` → `runbooks/M1-C-ENV.md` ✅
- `M1A-DEPLOY-CONTRACT.md` → `runbooks/M1A-DEPLOY-CONTRACT.md` ✅
- `PRE-LAUNCH-CHECKLIST.md` → `runbooks/PRE-LAUNCH-CHECKLIST.md` ✅
- `COMPONENT-INVENTORY.md` → `catalogs/COMPONENT_CATALOG.md` ✅
- `SYSTEM-INVENTORY.md` → `catalogs/SYSTEM_CAPABILITY_CATALOG.md` ✅
- `BRAND.md` → `branding/_archive/pre-D18/BRAND_pre-D18.md` ✅

Phase B executed (3 moves — added CONTENT-VOICE promotion):
- `specs/DAILY-LOOP.md` → `runbooks/DAILY-LOOP.md` ✅
- `specs/LAUNCH-HARDENING.md` → `runbooks/LAUNCH-HARDENING.md` ✅
- `specs/CONTENT-VOICE.md` → `standards/CONTENT_VOICE_STANDARD.md` ✅

Phase C executed (5 cross-link additions):
- `04_NAVIGATION_ARCHITECTURE.md` §14 → External-impl-references row to `specs/SEARCH.md` ✅
- `10_API_ARCHITECTURE.md` §14 → 3 rows to named standards (OPENAPI_CODEGEN, API_CLIENT, AUTH_CONTEXT) ✅
- `09_DATA_ARCHITECTURE.md` §14 → 2 rows to Standard 08 + specs/REPORTING-DELIVERY.md ✅
- `15_REPORTING_ARCHITECTURE.md` §14 → 3 rows to specs (REPORTING-DELIVERY, BILLING, NOTIFICATIONS-DEPTH) ✅
- `19_INFRASTRUCTURE_ARCHITECTURE.md` §14 → External-impl-references block to catalog + 4 runbooks ✅

Phase D executed:
- `ARCHITECTURE_GAP_ANALYSIS.md` updated — 4 of 5 original "minor gaps" now closed by linking; 4 true residuals named with LAW-GV1 amendment candidacy.

Phase E executed:
- `ARCHITECTURE_LAYER_RATIFICATION.md` updated — minor-gap line reflects closure-by-categorization vs true residuals.

Net effect:
- `docs/` root: **zero `.md` files** (this audit moved to `docs/audit/` after execution).
- `docs/runbooks/`: grew 1 → 7 entries.
- `docs/catalogs/`: grew 1 → 3 entries.
- `docs/specs/`: shrunk 16 → 13 entries.
- `docs/standards/`: grew by 1 named standard (CONTENT_VOICE_STANDARD).
- `docs/branding/_archive/`: gained `pre-D18/BRAND_pre-D18.md`.
- 0 files deleted.

---

*End of Documentation Categorization Audit. Authored + executed 2026-06-06 by Ընգեր.*
