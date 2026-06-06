# Prefix Registry Reconciliation Report

| Field | Value |
|---|---|
| **Location** | `docs/catalogs/PREFIX_RECONCILIATION_REPORT.md` |
| **Layer** | Catalog (reconciliation working document) |
| **Status** | **PROPOSED — 2026-06-06.** Awaiting Gev's ratification of canonical prefixes per LAW-GV6 protocol. After ratification, amendments to `docs/standards/03-identity-reference-naming-enum-standards.md` and `docs/architecture/03_INFORMATION_ARCHITECTURE.md` §7.4 / §8 follow as LAW-GV1 amendment #3. |
| **Authority chain** | `../governance/PROJECT_CONSTITUTION.md` → PRM → Std03 (LOCKED) + `03_INFORMATION_ARCHITECTURE.md` (LOCKED) |
| **Trigger** | Conflicts surfaced during LAW-GV5 search for `ENTITY_CATALOG.md` (commit `5453651`). Gev directed (LAW-GV6) to halt Entity Catalog lock and run dedicated reconciliation before any downstream catalog work. |
| **Blocks** | `ENTITY_CATALOG.md` final lock until this report is ratified and source docs amended. |

## 1. LAW-GV5 search evidence

Sources searched and compared:

| Source | Read | Conflict signals found |
|---|---|---|
| `03_INFORMATION_ARCHITECTURE.md` §8.1–§8.7 (LOCKED) | ✅ | 5 prefix conflicts + 6 variants vs Std03 |
| `09_DATA_ARCHITECTURE.md` §17 (LOCKED) | ✅ | Inherits §8 prefixes; no separate registry |
| `docs/standards/03-identity-reference-naming-enum-standards.md` (LOCKED) | ✅ | 40-prefix Std03 registry; conflicts with §8 in 5 cases |
| `CORE_OWNERSHIP_MATRIX.md` Part A (LOCKED) | ✅ | Matches §8 prefixes |
| `docs/specs/*` (13 files) | ✅ | No additional prefix declarations |
| `backend/app/models/*.py` (~80 models) | ✅ | Only `webhook.py` references prefix literal (`WHK-`) |
| `backend/app/utils/refnum.py` (the central generator) | ✅ | No prefix registry in code — prefixes are plain strings passed by callers |
| `backend/app/routers/*.py` (grep `prefix=`) | ✅ | Only 8 distinct prefixes used in production code: `COM, IMP, EXP, ORD, SLA, TSK, INV, REL` |
| `backend/alembic/versions/*.py` (111 migrations) | ✅ | Only `WHK-` referenced in migration docstrings |

## 2. Production-impact summary (critical finding)

**The conflicts have near-zero production impact.** Of the 8 conflict-prone
prefixes (CNT, CON, CMP, CAM, APP, APR, CTR, WBH/WHK), only `WHK-` has any
existing implementation reference (3 docstrings in `webhook.py` + migration).
None has reference-number sequences generated yet (no `next_reference_number(prefix="CNT")`
calls in code, no production data with these prefixes).

This means **the reconciliation window is open with low cost**. Renaming
later — after production data exists — would be far more expensive.

## 3. Direct prefix conflicts

Format per Gev's spec: Conflict / Source A / Source B / Existing usage count / Recommended canonical / Deprecated alias / Impact assessment.

### Conflict 3.1 — `CNT-`

| Field | Value |
|---|---|
| Conflict | `CNT-` used for two distinct entities |
| Source A | `Std03` prefix registry: `CNT=Contract` |
| Source B | `IA8 §8.5`: `Connector (Integration Core) — CNT-` |
| Existing usage in code | **0** (`grep CNT- backend/` → 0 matches) |
| Existing usage in docs | 7 references |
| Recommended canonical | `CNT-` = **Contract** (matches Std03, matches user-visible business term) |
| Connector resolution | `CNX-` = **Connector** (3-letter distinctive; collides with nothing) |
| Deprecated alias | None (Connector never used `CNT-` in code) |
| Impact assessment | Resolves IA8 §8.2 same-doc duplicate (`CTR-` was assigned to both Contract and Contractor). Frees Contract = `CNT-`, frees Contractor = `CTR-`. Adds new `CNX-` to Std03. |

### Conflict 3.2 — `CMP-`

| Field | Value |
|---|---|
| Conflict | `CMP-` used for two distinct entities |
| Source A | `IA8 §8.4`: `Complaint (Case Core) — CMP-` |
| Source B | `Std03`: `CMP=Campaign` |
| Existing usage in code | 0 |
| Existing usage in docs | 6 references |
| Recommended canonical | `CMP-` = **Complaint** (matches IA8, matches Case Core naming) |
| Campaign resolution | `CAM-` = **Campaign** (per Gev's proposal — distinct, no conflict) |
| Deprecated alias | None |
| Impact assessment | Amends Std03 to replace `CMP=Campaign` with `CMP=Complaint` and add `CAM=Campaign`. IA8 unchanged. |

### Conflict 3.3 — `APP-`

| Field | Value |
|---|---|
| Conflict | `APP-` used for two distinct entities |
| Source A | `IA8 §8.7`: `App (Marketplace) — APP-` |
| Source B | `Std03`: `APP=Approval` |
| Existing usage in code | 0 (Marketplace not implemented; Approval entity uses model/approval but no prefix in seed code) |
| Existing usage in docs | 6 references |
| Recommended canonical | `APP-` = **App (Marketplace)** (matches IA8, matches Marketplace Core) |
| Approval resolution | `APR-` = **Approval** (already in IA8 §8.4 as `ApprovalRequest — APR-`; preserves) |
| Deprecated alias | None |
| Impact assessment | Amends Std03 to replace `APP=Approval` with `APP=App` and `APR=Approval`. IA8 unchanged. |

### Conflict 3.4 — `CTR-` (intra-IA8 same-doc duplicate)

| Field | Value |
|---|---|
| Conflict | `CTR-` used for BOTH `Contract` and `Contractor` in same IA8 §8.2 |
| Source A | `IA8 §8.2`: `Contract — CTR-` |
| Source B | `IA8 §8.2`: `Contractor — CTR-` |
| Existing usage in code | 0 |
| Existing usage in docs | 10 references (mix) |
| Recommended canonical | `CTR-` = **Contractor** (Party Core entity) |
| Contract resolution | `CNT-` = **Contract** (per Conflict 3.1) |
| Deprecated alias | None |
| Impact assessment | Resolves intra-IA8 duplicate. Amends IA8 §8.2: Contract prefix from `CTR-` to `CNT-`. Amends Std03 accordingly. |

### Conflict 3.5 — `WBH-` / `WHK-` variant inconsistency

| Field | Value |
|---|---|
| Conflict | Webhook entity has two prefix variants across sources |
| Source A | `IA8 §8.5`: `Webhook — WBH-` |
| Source B | `Std03`: `WHK=Webhook` |
| Existing usage in code | **3 references** (`backend/app/models/webhook.py` docstrings + 1 migration uses `WHK-000001`) |
| Existing usage in docs | `WBH-` 6 docs / `WHK-` 4 docs |
| Recommended canonical | `WHK-` = **Webhook** (matches Std03 registry AND implementation in `webhook.py`) |
| Deprecated alias | `WBH-` flagged DEPRECATED in Std03 with redirect note to `WHK-` |
| Impact assessment | Amends IA8 §8.5 to change `WBH-` to `WHK-` (matches code reality). No data migration needed (no `WBH-` reference numbers ever generated). Doc-only cleanup. |

## 4. Conflict from my LAW-GV6 push-back — `CON-`

Gev's original prefix paste proposed `CON-` = Connector. LAW-GV5 search revealed this is a NEW conflict.

| Field | Value |
|---|---|
| Conflict | Gev's proposed `CON-` = Connector would collide with locked IA8 §8.2 |
| Source A | `IA8 §8.2`: `Contact (Party Core) — CON-` (LOCKED) |
| Source B | Gev's paste: `CON-` = Connector (proposal) |
| Existing usage in code | 0 for either |
| Existing usage in docs | 5 references (currently all referring to Contact) |
| Recommended canonical | `CON-` = **Contact** (preserve LOCKED IA8 §8.2; do NOT reassign) |
| Connector resolution | `CNX-` = **Connector** (3-letter distinctive; ConneCtor eXternal mnemonic; matches `backend/app/adapters/` naming pattern) |
| Deprecated alias | None |
| Impact assessment | Gev's proposal silently breaks Contact (Party Core, locked entity, real CRM business term). LAW-GV6 push-back triggered; pending Gev's ratification of `CNX-` alternative. |

## 5. Entities in Std03 but absent from IA8 §8 (need backfill rows)

| Std03 entry | Recommended IA8 §8.x landing | Notes |
|---|---|---|
| `LED=Lead` | §8.2 (Party Core) | Implemented via `routers/convert.py`; lead-pipeline views exist. Should be canonical Party Core entity. |
| `ROL=Role` | §8.1 (Permission Core) | Permission Core entity, implemented in `models/access.py`. |
| `DEP=Department` | §8.2 (Organization Core) | Already in IA8 §8.2 but no prefix; backfill `DEP-`. |
| `TEM=Team` | §8.2 (Organization Core) | Already in IA8 §8.2 but no prefix; backfill `TEM-`. |
| `QUE=Queue` | §8.4 (Case Core) | IA8 already has `CaseQueue (none)`; backfill `QUE-` per Std03. |
| `PUR=Purchase Order` | §8.2 (Resource / BSS) | No IA8 row; backfill as canonical entity. |
| `RLE=Release` | §8.4 (Case / Change Mgmt) | No IA8 row; backfill. |
| `EVT=Event` | §8.5 (Event Core) | IA8 has `DomainEvent (none)`; backfill `EVT-`. |
| `CMP=Campaign` — REASSIGNED to `CAM-` | n/a | Resolves Conflict 3.2. |
| `CFG=Configuration` | §8.1 (Configuration Core) | IA8 has TenantSetting/ModuleSetting but no general Configuration entity; backfill. |
| `FFL=Feature Flag` | §8.1 (Entitlement Core) | IA8 has `Feature (none)`; backfill `FFL-` as the runtime flag entity. |
| `LOC=Location` (general) | §8.2 (Location Core) | IA8 splits into Country/Region/City/Site; backfill `LOC-` as parent category. |
| `PRJ=Project` | §8.2 (Work Core) | IA8 has `ProjectTask (PTK-)` but no Project parent; backfill. |
| `NDV=Network Device` | §8.2 (Resource Core) | IA8 splits into OLT/ONU/Router/Switch; backfill `NDV-` as parent category. |
| `AST=Asset` | §8.2 (Resource Core) | IA8 has `Resource (base) — RES-` already; flag as ALIAS or amend. |

## 6. Entities in IA8 §8 absent from Std03 (need Std03 prefix backfill)

~46 entities listed in IA8 §8.2/4/5/6/7 with prefixes that aren't in Std03's 40-prefix registry. Recommended action: expand Std03 to include them all (Std03 becomes the single authoritative prefix registry after this reconciliation).

Prefixes to add to Std03:
`OLT-, ONU-, FBR-, IPP-, RTR-, SWT-, STK-, VHC-, TLS-, LIC-, PRD-, PLN-(Product), BND-, ADD-, AMD-, REN-, WIT-, WO-, FJB-, PTK-, MNT-, SOP-, FAQ-, QUO-, CRD-, DNG-, SRQ-, WFI-, AUT-, EXE-, APR-, BRC-, SCH-, APT-, THR-, MSG-, CMT-, NTF-, DOC-, ATT-, OAP-, RPT-, RPS-, AIA-, FRC-, REC-, PRQ-, EXT-, CNX- (new), CAM- (new)`

Plus the resolved-conflict prefixes:
`CNT- (Contract), CMP- (Complaint reassigned), APP- (App reassigned)`

Total Std03 registry after reconciliation: ~85 prefixes.

## 7. Additional collisions discovered during deeper search

### 7.1 `PLN-` used for two distinct entities

| Field | Value |
|---|---|
| Conflict | `PLN-` for both Entitlement.Plan AND Product.Plan |
| Source A | `IA8 §8.1`: `Plan (Entitlement) — PLN-` |
| Source B | `IA8 §8.2`: `Plan (Product) — PLN-` |
| Existing usage in code | 0 |
| Existing usage in docs | 4 (both contexts) |
| Recommended canonical | `PLN-` = **Plan (Product / Tariff)** — the more user-visible business term |
| Entitlement Plan resolution | `EPL-` = **EntitlementPlan** (SaaS subscription tier — Free/Pro/Enterprise) |
| Deprecated alias | None |
| Impact assessment | Entitlement Plan is internal admin concern; Product Plan is customer-facing. Renaming Entitlement to `EPL-` aligns prefix visibility with user mental model. |

### 7.2 `SVC-` / `SUB-` Subscription vs Service

| Field | Value |
|---|---|
| Conflict | IA8 conflates Subscription and Service into single row with `SVC-`; Std03 separates `SVC=Service` and `SUB=Subscription` |
| Source A | `IA8 §8.2`: `Subscription/Service — SVC-` (single row) |
| Source B | `Std03`: `SVC=Service` AND `SUB=Subscription` (two prefixes) |
| Existing usage in code | 0 for either; models/service.py exists |
| Existing usage in docs | 7 references |
| Recommended canonical | **SPLIT**: `SUB-` = Subscription (commercial agreement); `SVC-` = ServiceInstance (operational delivery) |
| Deprecated alias | None |
| Impact assessment | These are architecturally distinct concepts per `02_DOMAIN` §7.1.2 (OSS domain): Subscription belongs to BSS / Contract; ServiceInstance belongs to OSS. Splitting them aligns the prefix with the domain boundary. |

## 8. Proposed canonical prefix registry (post-reconciliation)

After all resolutions, the single authoritative Standard 03 prefix registry should contain ~85 prefixes. Sample of the changed / new entries:

| Prefix | Entity | Change |
|---|---|---|
| `CNT-` | **Contract** | Was Connector (IA8 §8.5) — reassigned |
| `CON-` | **Contact** | Preserved (IA8 §8.2, LOCKED) |
| `CNX-` | **Connector** | NEW — assigned for Integration Core |
| `CMP-` | **Complaint** | Preserved (IA8 §8.4) |
| `CAM-` | **Campaign** | NEW — moved from Std03 `CMP=Campaign` |
| `APP-` | **App (Marketplace)** | Preserved (IA8 §8.7) |
| `APR-` | **Approval** | Preserved (IA8 §8.4 ApprovalRequest) — replaces Std03 `APP=Approval` |
| `CTR-` | **Contractor** | Preserved for Contractor only |
| `WHK-` | **Webhook** | Canonical (matches code) |
| `WBH-` | (DEPRECATED alias) | Flagged in Std03 with redirect to `WHK-` |
| `PLN-` | **Plan (Product/Tariff)** | Customer-facing service plan |
| `EPL-` | **EntitlementPlan** | NEW — SaaS subscription tier |
| `SUB-` | **Subscription** | NEW — commercial subscription (per Std03 SUB=) |
| `SVC-` | **ServiceInstance** | Refined from Subscription/Service conflation |
| `LED-` | **Lead** | Backfilled into IA8 §8.2 |
| `ROL-` | **Role** | Backfilled into IA8 §8.1 |
| `DEP-` | **Department** | Backfilled prefix in IA8 §8.2 |
| `TEM-` | **Team** | Backfilled prefix in IA8 §8.2 |
| `QUE-` | **Queue (CaseQueue)** | Backfilled prefix in IA8 §8.4 |
| `PUR-` | **PurchaseOrder** | Backfilled into IA8 §8.2 |
| `RLE-` | **Release** | Backfilled into IA8 §8.4 |
| `EVT-` | **DomainEvent** | Backfilled prefix in IA8 §8.5 |
| `CFG-` | **Configuration** | Backfilled into IA8 §8.1 |
| `FFL-` | **Feature Flag** | Backfilled into IA8 §8.1 |
| `LOC-` | **Location (parent)** | Backfilled into IA8 §8.2 |
| `PRJ-` | **Project** | Backfilled into IA8 §8.2 |
| `NDV-` | **Network Device (parent)** | Backfilled prefix in IA8 §8.2 |
| `AST-` | **Asset** | Flagged as ALIAS of `RES-` OR refined |

## 9. Required amendments (LAW-GV1 amendment #3)

If Gev ratifies §8 above:

1. **Amend `docs/standards/03-identity-reference-naming-enum-standards.md`:**
    - Replace existing 40-prefix registry with the full ~85-prefix registry from §8.
    - Add deprecated-alias section noting `WBH- → WHK-`.
2. **Amend `docs/architecture/03_INFORMATION_ARCHITECTURE.md` §7.4 + §8:**
    - Update §7.4 prefix registry to match the new Std03 (single source of truth).
    - Update §8 entity rows for the changed prefixes (Contract `CTR- → CNT-`, Webhook `WBH- → WHK-`, etc.).
    - Backfill rows for Lead / Role / Project / PO / Release / etc.
    - Split Subscription/Service row in §8.2.
3. **Update `docs/catalogs/ENTITY_CATALOG.md`:**
    - Apply reconciled prefixes throughout §4 registry.
    - Move §3 conflict findings into §3 audit record marked RESOLVED.
    - Re-run AUDIT (Part D conflict scan) — expect zero conflicts.
    - Move status from PROVISIONAL → LOCKED + RATIFIED + BASELINE.
4. **Update `docs/catalogs/CORE_OWNERSHIP_MATRIX.md` Part A:**
    - Apply reconciled prefixes.
    - Add a LAW-GV1 amendment note.
5. **Update memory** (project_constitution_v1.md, MEMORY.md) to reflect amendment #3.

## 10. Impact summary

| Surface | Files affected | Code changes | Data changes |
|---|---|---|---|
| Architecture (Std03 + IA8) | 2 docs | none | none |
| Catalogs | ENTITY_CATALOG, CORE_OWNERSHIP_MATRIX | none | none |
| Backend code (refnum call sites) | 0 immediate (no conflict-prone prefixes in production code) | 0 | 0 |
| `backend/app/models/webhook.py` | 0 (already uses WHK-) | 0 | 0 |
| Migrations | 0 (no reference-number data in conflict-prone prefixes) | 0 | 0 |
| Test suite | 0 (only INV/TSK/REL used in tests) | 0 | 0 |
| Total commit footprint | ~5 docs | 0 | 0 |

**This reconciliation has near-zero implementation cost.** The work is
pure documentation-layer normalization done at the right time — before
production data exists in the conflict-prone prefixes.

## 11. Pending decisions

Before LAW-GV1 amendment #3 can be applied, Gev must ratify:

1. **`CNX-` for Connector** (resolves the Connector vs Contact CON- conflict)
2. **`EPL-` for EntitlementPlan** (resolves the Plan ambiguity)
3. **`SUB-` / `SVC-` split for Subscription/ServiceInstance** (resolves IA8 conflation)
4. **All entries in §8 canonical registry** as the new Std03

Or override any of the above with alternatives.

## 12. Maintenance after lock

Post-amendment, the rule per LAW-EN3 + LAW-DA1 + LAW-DA2:

- **Std03 is the single authoritative prefix registry.** IA8 §7.4 mirrors it.
- New prefixes require LAW-GV1 amendment.
- `tools/check_drift.py` adds a HARD rule scanning seed/migration code for `prefix=` literals and asserting each matches a registered prefix.

---

*End of Prefix Registry Reconciliation Report. Authored 2026-06-06 by Ընգեր. Awaits Gev's ratification per LAW-GV6.*
