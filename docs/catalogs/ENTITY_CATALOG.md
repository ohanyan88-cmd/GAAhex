# Entity Catalog

| Field | Value |
|---|---|
| **Location** | `docs/catalogs/ENTITY_CATALOG.md` |
| **Layer** | Catalog (between Standards and Implementation) |
| **Status** | **PROVISIONAL — 2026-06-06.** Reverted from LOCKED at Gev's direction (LAW-GV6 push-back) pending the Prefix Registry Reconciliation pass. Lock is blocked until `PREFIX_RECONCILIATION_REPORT.md` is ratified and Std03 + IA8 §7.4 amended. |
| **LAW-GV3 cycle** | ✅ CREATE · ✅ REVIEW · ✅ AUDIT · ✅ NORMALIZE · ⏸ LOCK BLOCKED (pending prefix reconciliation) |
| **Authority** | [`../governance/PROJECT_CONSTITUTION.md`](../governance/PROJECT_CONSTITUTION.md) → PRM → `03_INFORMATION_ARCHITECTURE.md` §8 → `09_DATA_ARCHITECTURE.md` §17 → Standards 03 + 14 |
| **Amendments** | Only via LAW-GV1 of PROJECT_CONSTITUTION |

## LAW-GV5 search performed before authorship (2026-06-06)

Per LAW-GV5 ("Existing Knowledge First"), all sources were searched and
compared before any catalog content was written:

| Source | Read | What was found |
|---|---|---|
| `03_INFORMATION_ARCHITECTURE.md` §8 | ✅ | Canonical entity index, 7 tiers, ~150 entries with owner/domain/prefix |
| `09_DATA_ARCHITECTURE.md` §17 | ✅ | Canonical Entity Matrix + retention/PII/migration rules |
| `CORE_OWNERSHIP_MATRIX.md` Part A | ✅ | ~200 entities × owner / domain / prefix / status; already locked |
| Standard 03 (Identity/Reference/Naming/Enum) | ✅ | Reference-number prefix registry (~40 prefixes, locked) |
| Standard 14 (Enum Registry) | ✅ | Enum types + values per entity |
| `docs/specs/*` (13 files) | ✅ | Per-feature data models (BILLING, HELPDESK, WORKITEMS, CALENDAR, etc.) |
| `backend/app/models/*.py` (~80 files) | ✅ | Implementation models — verified via MODULE_CATALOG enumeration |
| `backend/alembic/versions/*.py` (111 migrations) | ✅ | Schema history per entity |

## Authorship principle (per LAW-GV5)

This catalog **introduces no new entities**. Every row consolidates an
existing entity declared in at least one canonical source. Discrepancies
between sources are **documented as findings**, never silently
reconciled — reconciliation is LAW-GV1 amendment work.

---

## LAW-GV3 audit record (2026-06-06)

- **CREATE** — Authored 2026-06-06 by Ընգեր.
- **REVIEW** — Every entity row cross-referenced to `03_INFORMATION_ARCHITECTURE.md` §8, `CORE_OWNERSHIP_MATRIX.md` Part A, Standard 03 prefix registry, Standard 14 enum registry, and (where present) `backend/app/models/*.py`. APIs cross-linked to `CORE_OWNERSHIP_MATRIX.md` Part B; events to Part C; pages to Part D.
- **AUDIT** — Three classes of finding surfaced:
    1. **5 prefix conflicts** between doc 03 §8 and Standard 03 (documented in §3 below; resolution deferred to LAW-GV1).
    2. **14 entities in Standard 03 with no doc 03 §8 row** (documented in §3.B).
    3. **~46 entities in doc 03 §8 with no Standard 03 prefix registration** (documented in §3.C).
    No new ownership conflicts (LAW-DA2 still satisfied: every entity has exactly one primary core).
- **NORMALIZE** — Canonical 10-column registry format per Gev's spec applied to all rows; tier ordering matches PRM and doc 03 §8 (Foundation → Business Objects → Business Commerce → Business Execution → Platform Services → Intelligence → Experience).
- **Architectural decisions altered:** zero. Every assignment derived from existing canonical sources.

---

## 1. Conventions

### 1.1 Status legend

Same as `CORE_OWNERSHIP_MATRIX.md`: **S** = STRONG · **P** = PARTIAL · **W** = WEAK · **M** = MISSING · **R** = RESERVED.

### 1.2 Source codes

- **IA8.x** = `03_INFORMATION_ARCHITECTURE.md` §8.x
- **DA17** = `09_DATA_ARCHITECTURE.md` §17 (Canonical Entity Matrix)
- **MtxA** = `CORE_OWNERSHIP_MATRIX.md` Part A
- **Std03** = `docs/standards/03-identity-reference-naming-enum-standards.md`
- **Std14** = `docs/standards/14-enum-registry.md`
- **spec/<NAME>** = `docs/specs/<NAME>.md`
- **model/<file>** = `backend/app/models/<file>.py`
- **alembic/<rev>** = `backend/alembic/versions/<rev>_*.py`

### 1.3 Reference number format

Per Standard 03 (LOCKED): `[PREFIX]-[SEQUENCE]`, no year. Prefix shown in
the **Prefix** column. `(none)` = no reference number declared (internal entity).
`(conflict)` = prefix conflicts with another entity — see §3.

### 1.4 Notes column tags

- **ALIAS** — multiple names for one entity in different sources
- **DUP** — duplicate declaration found
- **CONFLICT** — prefix or ownership conflict surfaced by LAW-GV5 search
- **M1** — present in M1 implementation
- **FUTURE** — declared but not yet implemented (PRM status WEAK/MISSING/RESERVED)

---

## 2. Sources consistency map

How many entities each source declares:

| Source | Entity count |
|---|---|
| `03_INFORMATION_ARCHITECTURE.md` §8 | 158 |
| `09_DATA_ARCHITECTURE.md` §17 | (derived from §8; same set) |
| `CORE_OWNERSHIP_MATRIX.md` Part A | 200 (includes some implementation variants) |
| Standard 03 Prefix Registry | 40 prefixes (~40 entities) |
| Standard 14 Enum Registry | 90+ enums (per-entity status/category) |
| `backend/app/models/*.py` | ~80 model files |

**Convergence:** the canonical set is approximately 160 distinct business
entities (the union of IA8 + MtxA after de-duplication). Standard 03's
40-prefix registry is the *user-visible-ID* subset of this set;
internal-only entities (Session, AuditLog, RateLimitPolicy, etc.) appear
in IA8/MtxA but legitimately have no Standard 03 prefix.

---

## 3. Findings: aliases, duplicates, conflicts

### 3.A Prefix conflicts between doc 03 §8 and Standard 03

| Prefix | Doc 03 §8 entity | Standard 03 entity | Severity |
|---|---|---|---|
| `CNT-` | Connector (Integration Core) | Contract (BSS) | **HIGH** |
| `CMP-` | Complaint (Case Core) | Campaign (Marketing — Standard 03) | **HIGH** |
| `APP-` | App (Marketplace Core) | Approval (Std 03 — but APR- used elsewhere) | **HIGH** |
| `CTR-` | Contractor (Party) AND Contract (Contract Core) | (Standard 03 uses CNT for Contract) | **HIGH** (intra-doc-03 collision) |
| `WBH-` / `WHK-` | Webhook (Integration — IA8 uses WBH-) | Webhook (Standard 03 uses WHK=) | **MEDIUM** (variant) |
| `SVC-` / `SUB-` | Subscription/Service one row (IA8 conflates, prefix SVC-) | Service + Subscription separate (Standard 03 SVC= and SUB=) | **MEDIUM** |

All 6 conflicts are recorded; **none resolved in this catalog**. Resolution requires LAW-GV1 amendment to Standard 03 and/or `03_INFORMATION_ARCHITECTURE.md` §7.4 — see §6.

### 3.B Entities in Standard 03 prefix registry with no doc 03 §8 entry

These entities have user-visible IDs declared but no canonical entity definition in the architecture:

| Std03 prefix | Entity | Notes |
|---|---|---|
| `LED-` | Lead | Party Core entity (precedes Customer in pipeline). Implementation exists (`backend/app/routers/convert.py`, lead pipeline views). Needs explicit row in IA8.2. |
| `ROL-` | Role | Permission Core entity. In models via `models/access.py`. |
| `DEP-` | Department | Organization Core. IA8.2 lists Department but no prefix. |
| `TEM-` | Team | Organization Core. IA8.2 lists Team but no prefix. |
| `QUE-` | Queue | Case Core (CaseQueue) — IA8.4 lists with `(none)` prefix. Standard 03 says QUE-. |
| `PUR-` | Purchase Order | BSS — no IA8 entry; spec/BILLING + spec/PAYMENTS-GATEWAY contexts. |
| `RLE-` | Release | Workflow / Change Mgmt — no IA8 entry. |
| `EVT-` | Event | Event Core's DomainEvent — IA8.5 has `(none)` prefix. |
| `CMP-` | Campaign | Marketing — no IA8 entry. (Also conflicts with Complaint.) |
| `CFG-` | Configuration | Configuration Core. IA8.1 has TenantSetting/ModuleSetting but no CFG prefix. |
| `FFL-` | Feature Flag | Entitlement Core. IA8.1 has Feature but no FFL prefix. |
| `LOC-` | Location | Location Core's general Location. IA8.2 splits into Country/Region/City/Site etc. |
| `PRJ-` | Project | Work Core context — IA8.2 has ProjectTask (`PTK-`) but no Project entity. |
| `NDV-` | Network Device | Resource Core — IA8.2 splits into OLT/ONU/Router/Switch with own prefixes; NDV- is the parent category. |

### 3.C Entities in doc 03 §8 with no Standard 03 prefix registration

~46 entities. Listed here for cross-reference; the Standard 03 prefix
registry should be expanded by LAW-GV1 amendment to include them, OR the
prefixes deprecated. Until then: doc 03 §8 prefixes are the working
truth at the architecture layer.

OLT-, ONU-, FBR-, IPP-, RTR-, SWT-, STK-, VHC-, TLS-, LIC-, PRD-, PLN-,
BND-, ADD-, AMD-, REN-, WIT-, WO-, FJB-, PTK-, MNT-, SOP-, FAQ-, QUO-,
CRD-, DNG-, SRQ-, WFI-, AUT-, EXE-, APR-, BRC-, SCH-, APT-, THR-, MSG-,
CMT-, NTF-, DOC-, ATT-, OAP-, RPT-, RPS-, AIA-, FRC-, REC-, PRQ-, EXT-.

---

## 4. The entity registry

Layout: one row per entity. Columns per Gev's spec (10):

`Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes`

Sorted by PRM tier, then alphabetically within tier.

### 4.1 FOUNDATION tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AccessLog | Audit | Administration | (none) | S | IA8.1, MtxA, model/event | `/api/v1/audit/*` | `Audit.AccessRecorded` | `/admin/audit-log` | M1 |
| AlertRule | Observability | Administration | (none) | P | IA8.1, MtxA | `/api/v1/alerts/*` | `Alert.Fired`, `Alert.Cleared` | `/admin/system-health` | M1 |
| ApiClient | Identity | Administration | `API-` | S | IA8.1, MtxA, model/apikey | `/api/v1/developer/api-keys/*` | `Identity.ApiClientCreated` | `/admin/developer-platform` | M1 |
| AuditLog | Audit | Administration | (none) | S | IA8.1, MtxA, model/event, Std14 | `/api/v1/audit/*` | (immutable; emit-only) | `/admin/audit-log` | M1 · append-only at DB layer |
| BusinessHours | Time | Studio | (none) | P | IA8.1, MtxA | (config endpoints) | `Calendar.HoursChanged` | `/studio/...` | M1 |
| Calendar (Time) | Time | Studio | (none) | P | IA8.1, MtxA, model/calendar, spec/CALENDAR | `/api/v1/calendar/*` | `Calendar.Updated` | `/workforce/calendar`, `/studio/...` | M1 |
| CanonicalSchema | Data | Studio | (none) | P | IA8.5, MtxA | (internal) | `Data.SchemaRegistered` | `/studio/entities-fields` | M1 |
| Consent | Compliance | Administration | (none) | P | IA8.1, MtxA | `/api/v1/compliance/*` | `Compliance.ConsentGranted/Revoked` | `/admin/compliance` | M1 |
| ConfigSchema | Configuration | Studio | (none) | S | IA8.1, MtxA | `/api/v1/config/*` | `Config.SchemaUpdated` | `/studio/...` | M1 |
| ConfigVersion | Configuration | Studio | (none) | S | MtxA | `/api/v1/config/*` | `Config.Versioned` | `/studio/...` | M1 |
| **Configuration** | Configuration | Studio | `CFG-` | S | Std03 | `/api/v1/configurations/*` | `Config.Created`, `Config.Updated` | `/studio/...` | **Std03 only — NEEDS IA8 row** |
| ConsentRecord (alias for Consent) | Compliance | Administration | (none) | P | spec | — | — | — | ALIAS |
| DataQualityRule | Data | Studio | (none) | P | IA8.5, MtxA | (internal) | `Data.QualityViolation` | `/studio/...` | M1 |
| DataSubjectOp | Compliance | Administration | (none) | P | MtxA | `/api/v1/compliance/*` | `Compliance.SubjectOpCompleted` | `/admin/compliance` | M1 |
| DecisionRecord | Policy | Studio | (none) | P | MtxA | (internal) | `Policy.Decided` | `/studio/...` | M1 |
| **Department** | Organization | Workforce | `DEP-` | S | IA8.2, MtxA (no prefix), Std03 (DEP-) | `/api/v1/org-nodes/*` | `Org.DeptCreated` | `/workforce/team` | M1 · DOC3 lists no prefix; Std03 says DEP- |
| EncryptionKey | Security | Administration | (none) | P | IA8.1, MtxA | (internal) | `Security.KeyRotated` | `/admin/security` | M1 |
| EnvironmentConfig | Configuration | Administration | (none) | S | IA8.1, MtxA | (internal) | `Config.EnvironmentSet` | (none) | M1 |
| EventEvidence | Audit | Administration | (none) | S | MtxA | (internal) | (immutable) | `/admin/audit-log` | M1 |
| Exception | Governance | Administration | `EXC-` | P | IA8.1, MtxA | (governance API) | `Governance.ExceptionFiled` | `/admin/governance` | M1 |
| **Event (DomainEvent)** | Event | Administration | `EVT-` | S | IA8.5 (no prefix), Std03 (EVT-) | `/api/v1/events/*` | (the event store itself) | `/admin/audit-log` | M1 · Std03 prefix EVT-; IA8.5 lists no prefix |
| **Feature** | Entitlement | Administration | (none) | P | IA8.1, MtxA | `/api/v1/entitlements/*` | `Entitlement.FeatureToggled` | `/admin/plans-entitlements` | M1 |
| **Feature Flag** | Entitlement | Administration | `FFL-` | P | Std03 (FFL-), model/feature_flag | `/api/v1/feature-flags/*` | `Feature.FlagCreated/Updated` | `/studio/feature-flags` | M1 · Std03 only — NEEDS IA8 row |
| GovernanceBoard | Governance | Administration | (none) | P | MtxA | (governance API) | `Governance.BoardReviewed` | `/admin/governance` | M1 |
| HealthCheck | Observability | Administration | (none) | P | IA8.1, MtxA, model/telemetry | `/api/v1/health/*` | (poll-driven) | `/admin/system-health` | M1 |
| Holiday | Time | Studio | (none) | P | MtxA | (config) | `Calendar.HolidayAdded` | `/studio/...` | M1 |
| IdempotencyKey | Security | (cross) | (none) | P | MtxA, model/idempotency_request, middleware | (internal request layer) | (internal) | (n/a) | M1 |
| IdentityProvider | Identity | Administration | (none) | S | MtxA | `/api/v1/auth/*` | `Identity.IdpAdded` | `/admin/users` | M1 |
| LineageEdge | Data | Reporting | (none) | P | IA8.5, MtxA | (internal) | (internal) | (n/a) | M1 |
| LogStream | Observability | Administration | (none) | P | MtxA | `/api/v1/admin/ops/*` | (telemetry) | `/admin/system-health` | M1 |
| MasterDataRecord | Data | Administration | (none) | P | IA8.5, MtxA | (internal) | `Data.MdmUpdated` | (n/a) | M1 |
| Metric | Observability | Administration | (none) | P | IA8.1, MtxA | `/api/v1/metrics/*` | (telemetry) | `/admin/system-health` | M1 |
| MfaCredential | Identity | Administration | (none) | S | MtxA | `/api/v1/auth/*` | `Identity.MfaEnrolled` | `/admin/users` | M1 |
| ModuleAccess | Entitlement | Administration | (none) | P | MtxA | `/api/v1/entitlements/*` | `Entitlement.ModuleAccessChanged` | `/admin/plans-entitlements` | M1 |
| ModuleSetting | Configuration | Studio | (none) | S | IA8.1, MtxA | `/api/v1/config/*` | `Config.ModuleSettingChanged` | `/studio/...` | M1 |
| **Plan** (Entitlement) | Entitlement | Administration | `PLN-` | P | IA8.1, MtxA, model/feature_flag | `/api/v1/plans/*` | `Entitlement.PlanCreated/Updated` | `/admin/plans-entitlements` | M1 · **CONFLICT**: same prefix as Product.Plan |
| PolicyCondition | Policy | Studio | (none) | P | MtxA | (internal) | `Policy.ConditionUpdated` | `/studio/...` | M1 |
| PolicyDefinition | Policy | Studio | (none) | P | IA8.1, MtxA | (internal) | `Policy.Defined` | `/studio/...` | M1 |
| PolicyEvaluation | Policy | Studio | (none) | P | MtxA | (internal) | `Policy.Evaluated` | `/studio/...` | M1 |
| PolicyVersion | Policy | Studio | (none) | P | MtxA | (internal) | `Policy.Versioned` | `/studio/...` | M1 |
| PortalEntitlement | Entitlement | Portal | (none) | P | MtxA | `/api/v1/entitlements/*` | `Entitlement.PortalGranted` | `/admin/plans-entitlements` | M1 |
| PrivacyRequest | Compliance | Administration | `PRR-` | P | IA8.1, MtxA, model/privacy_request | `/api/v1/compliance/*` | `Compliance.PrivacyRequest*` | `/admin/compliance` | M1 |
| Quota | Entitlement | Administration | (none) | P | IA8.1, MtxA | `/api/v1/entitlements/*` | `Entitlement.QuotaExceeded` | `/admin/plans-entitlements` | M1 |
| RateLimitPolicy | Security | Administration | (none) | P | IA8.1, MtxA | (internal) | `Security.RateLimitHit` | `/admin/security` | M1 |
| RecurrenceRule | Time | Studio | (none) | P | IA8.1, MtxA | (config) | `Calendar.RecurrenceUpdated` | `/studio/...` | M1 |
| ReferenceData | Data | (global) | (none) | P | MtxA | (internal) | (immutable mostly) | (n/a) | M1 · cross-tenant global |
| RegulatoryEvidence | Compliance | Administration | (none) | P | MtxA | `/api/v1/compliance/*` | `Compliance.EvidenceRecorded` | `/admin/compliance` | M1 |
| **Release** | Workflow / Change Mgmt | OSS | `RLE-` | P | Std03 (RLE-) | (change request flow) | `Change.ReleaseDeployed` | `/operations/changes` | **Std03 only — NEEDS IA8 row** |
| RetentionPolicy | Compliance | Administration | `RTP-` | P | IA8.1, MtxA | `/api/v1/compliance/*` | `Compliance.RetentionUpdated` | `/admin/compliance` | M1 |
| **Role** | Permission | Administration | `ROL-` | S | Std03 (ROL-), model/access | `/api/v1/roles/*` | `Permission.RoleAssigned` | `/admin/roles-permissions` | M1 · **Std03 only — NEEDS IA8 row** |
| Secret | Security | Administration | (none) | P | IA8.1, MtxA | (internal) | `Security.SecretAccessed` | `/admin/security` | M1 |
| ServiceAccount | Identity | Administration | `SVA-` | S | IA8.1, MtxA | `/api/v1/users/*` | `Identity.ServiceAccountCreated` | `/admin/users` | M1 |
| ServiceStatus | Observability | Administration | (none) | P | MtxA | `/api/v1/health/*` | `Observability.StatusChanged` | `/admin/system-health` | M1 |
| Session | Identity | Administration | (none) | S | IA8.1, MtxA, model/refresh_token | `/api/v1/auth/*` | `Identity.Session*` | (n/a) | M1 |
| Shift | Time | Workforce | (none) | P | MtxA | (config / scheduling) | `Workforce.ShiftScheduled` | `/workforce/calendar` | M1 |
| SlaClock (in Time scope) | Time/SLA | (cross) | (none) | P | MtxA, model/sla | (internal — SLA Core uses) | `Sla.Started/Paused/Resumed` | (n/a) | M1 · cross-core |
| Standard | Governance | Administration | (none) | P | IA8.1, MtxA | (governance API) | `Governance.StandardAdopted` | `/admin/governance` | M1 |
| Tenant | Tenant | Administration | `TNT-` | S | IA8.1, MtxA, model/tenant | `/api/v1/tenants/*` | `Tenant.Created/Activated/Suspended/Archived/Purged` | `/admin/tenants` | M1 |
| TenantBrandingLink | Tenant | Administration | (none) | S | MtxA | `/api/v1/tenants/*` | `Tenant.BrandingLinked` | `/admin/tenants` | M1 |
| TenantHierarchy | Tenant | Administration | (none) | S | MtxA | `/api/v1/tenants/*` | `Tenant.HierarchyChanged` | `/admin/tenants` | M1 |
| TenantProfile | Tenant | Administration | (none) | S | IA8.1, MtxA | `/api/v1/tenants/*` | `Tenant.ProfileUpdated` | `/admin/tenants` | M1 |
| TenantSetting | Configuration | Studio | (none) | S | IA8.1, MtxA | `/api/v1/config/*` | `Config.TenantSettingChanged` | `/studio/...` | M1 |
| ThreatRule | Security | Administration | (none) | W | MtxA | (internal) | `Security.ThreatDetected` | `/admin/security` | M1 |
| Timezone | Time | (global) | (none) | P | IA8.1, MtxA | (config) | (immutable) | (n/a) | M1 · global ref |
| Trace | Observability | Administration | (none) | P | IA8.1, MtxA | `/api/v1/traces/*` | (telemetry) | `/admin/system-health` | M1 |
| UsageMeter | Entitlement | Administration | (none) | P | MtxA, model/usage | `/api/v1/entitlements/*` | `Entitlement.UsageRecorded` | `/admin/plans-entitlements` | M1 |
| User | Identity | Administration | `USR-` | S | IA8.1, MtxA, model/user | `/api/v1/users/*` | `User.Created/Activated/Deactivated/RoleAssigned/RoleRevoked` | `/admin/users` | M1 |

### 4.2 BUSINESS OBJECTS tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| AddOn | Product | (cross) | `ADD-` | P | IA8.2, MtxA, model/product | `/api/v1/services/catalog`, `/api/v1/billing/products` | `Product.AddOnPriced` | `/services/catalog`, `/studio/...` | M1 |
| Amendment | Contract | BSS | `AMD-` | P | IA8.2, MtxA | `/api/v1/amendments/*` | `Contract.Amended` | `/services/all`, `/admin/...` | M1 |
| Article (Knowledge) | Knowledge | (cross) | `KBA-` | W | IA8.2, MtxA, Std03 (KBA=) | `/api/v1/knowledge/*` | `Knowledge.Published` | `/customers/knowledge`, `/portal/knowledge` | FUTURE · WEAK per PRM |
| **Asset** | Resource | Network/Inventory | `RES-` (IA8) / `AST-` (Std03) | P | IA8.2, MtxA (RES-), Std03 (AST-) | `/api/v1/assets/*` | `Asset.Created` | `/network/inventory`, `/inventory/items` | **PREFIX VARIANT**: IA8 RES- vs Std03 AST- |
| Branch | Organization | Workforce | (none) | S | IA8.2, MtxA, model/orgnode | `/api/v1/org-nodes/*` | `Org.BranchUpdated` | `/workforce/team` | M1 |
| Building | Location | Network | (none) | P | IA8.2, MtxA, model/asset_location | (location API) | `Location.BuildingMapped` | `/network/sites` | M1 |
| Bundle | Product | (cross) | `BND-` | P | IA8.2, MtxA, model/product | `/api/v1/services/catalog` | `Product.BundleCreated` | `/services/catalog` | M1 |
| BusinessUnit | Organization | Workforce | (none) | S | IA8.2, MtxA | `/api/v1/org-nodes/*` | `Org.BusinessUnitUpdated` | `/workforce/team` | M1 |
| City | Location | (global) | (none) | P | IA8.2, MtxA, model/region | (location API) | (immutable mostly) | `/network/sites` | M1 |
| Contact | Party | CRM | `CON-` | P | IA8.2, MtxA, model/party | `/api/v1/contacts/*` | `Customer.ContactAdded` | `/customers/contacts` | M1 |
| **Contract** | Contract | BSS | `CTR-` (IA8) / `CNT-` (Std03) | P | IA8.2, MtxA (CTR-), Std03 (CNT-) | `/api/v1/contracts/*` | `Contract.Signed/Amended/Renewed` | `/services/all`, `/admin/...` | **PREFIX CONFLICT**: IA8 CTR- collides with Contractor (CTR-) in same doc; Std03 says CNT- which collides with Connector |
| **Contractor** | Party | Workforce | `CTR-` | P | IA8.2, MtxA, model/party | `/api/v1/employees/*` | `Party.ContractorAdded` | `/workforce/team` | **PREFIX CONFLICT**: same `CTR-` as Contract in IA8 |
| ContractTerm | Contract | BSS | (none) | P | IA8.2, MtxA | `/api/v1/contracts/*` | `Contract.TermAdded` | `/services/all` | M1 |
| Country | Location | (global) | (none) | P | IA8.2, MtxA | (config) | (immutable) | (n/a) | M1 · global ref |
| **Customer** | Party | CRM | `CUS-` | P | IA8.2, MtxA, model/party | `/api/v1/customers/*` | `Customer.Created/Updated/Archived` | `/customers/all`, `/portal/account` | M1 · STRONG |
| District | Location | (global) | (none) | P | MtxA | (location API) | (immutable mostly) | (n/a) | M1 |
| Employee | Party | Workforce | `EMP-` | S | IA8.2, MtxA, model/party | `/api/v1/employees/*` | `Party.EmployeeAdded` | `/workforce/team` | M1 |
| Faq | Knowledge | (cross) | `FAQ-` | W | IA8.2, MtxA | `/api/v1/knowledge/*` | `Knowledge.FaqPublished` | `/customers/knowledge` | FUTURE |
| Fiber | Resource | Network | `FBR-` | P | IA8.2, MtxA, model/fiber_route | `/api/v1/network/fiber/*` | `Resource.FiberAdded` | `/network/inventory` | M1 |
| FieldJob | Work | Workforce | `FJB-` | S | IA8.2, MtxA, model/workitem | `/api/v1/field-jobs/*` | `Work.FieldJob*` | `/workforce/field-jobs` | M1 |
| Floor | Location | Network | (none) | P | IA8.2, MtxA | (location API) | (rare) | `/network/sites` | M1 |
| Household | Party | CRM | (none) | P | IA8.2, MtxA, model/party | `/api/v1/households/*` | `Customer.HouseholdLinked` | `/customers/households` | M1 |
| IpPool | Resource | Network | `IPP-` | P | IA8.2, MtxA, model/ipam | `/api/v1/network/ip-pools/*` | `Resource.IpAllocated` | `/network/inventory` | M1 |
| **Lead** | Party | CRM | `LED-` | P | Std03 (LED-), spec/DAILY-LOOP, routers/convert.py | `/api/v1/leads/*` | `Lead.Qualified`, `Lead.Converted` | `/customers/leads`, `/customers/pipeline` | M1 · **Std03 only — NEEDS IA8.2 row** |
| **Location (general)** | Location | (cross) | `LOC-` (Std03) / no prefix (IA8) | P | Std03 (LOC-), IA8.2 (split into sub-types only) | (location API) | `Location.Created` | `/network/sites` | **Std03 only as general — IA8 splits** |
| MaintenanceJob | Work | Network | `MNT-` | S | IA8.2, MtxA | `/api/v1/work/*` | `Work.MaintenanceScheduled` | `/network/maintenance-windows` | M1 |
| **Network Device (general)** | Resource | Network | `NDV-` (Std03) | P | Std03 (NDV-), IA8.2 splits into OLT/ONU/etc. | `/api/v1/network/resources/*` | `Resource.DeviceAdded` | `/network/inventory` | **PARENT CATEGORY** — IA8 uses sub-types |
| OLT | Resource | Network | `OLT-` | P | IA8.2, MtxA, model/olt_tree | `/api/v1/network/olts/*` | `Resource.OltStatusChanged` | `/network/inventory` | M1 |
| ONU | Resource | Network | `ONU-` | P | IA8.2, MtxA, model/cpe_binding | `/api/v1/network/onus/*` | `Resource.OnuProvisioned` | `/network/inventory` | M1 |
| Partner | Party | CRM | `PRT-` | P | IA8.2, MtxA, model/party | `/api/v1/parties/*` | `Party.PartnerAdded` | `/customers/all` | M1 |
| Person | Party | CRM | (none) | P | IA8.2, MtxA, model/party | `/api/v1/parties/*` | `Party.PersonAdded` | `/customers/all` | M1 |
| Plan (Product) | Product | (cross) | `PLN-` | P | IA8.2, MtxA, model/product, spec/BILLING | `/api/v1/billing/products`, `/api/v1/tariff-plans` | `Product.PlanCreated/Priced` | `/services/catalog`, `/billing/pricing` | M1 · **CONFLICT** same prefix as Entitlement.Plan |
| Product | Product | (cross) | `PRD-` | P | IA8.2, MtxA, model/product | `/api/v1/billing/products` | `Product.Created/Updated` | `/services/catalog` | M1 |
| **Project** | Work | Workforce | `PRJ-` (Std03) | P | Std03 (PRJ-) | (work) | `Work.ProjectCreated` | `/workforce/...` | **Std03 only — NEEDS IA8 row** (IA8 has ProjectTask but not Project parent) |
| ProjectTask | Work | Workforce | `PTK-` | S | IA8.2, MtxA, model/workitem | `/api/v1/tasks/*` | `Work.ProjectTask*` | `/workforce/field-jobs`, `/my-day/tasks` | M1 |
| ProvisioningState | Service | OSS | (none) | P | IA8.2, MtxA, model/service | `/api/v1/provisioning/*` | `Service.Provisioning.Started/Completed` | `/services/provisioning-queue` | M1 |
| **Purchase Order** | Resource / BSS | Inventory/BSS | `PUR-` (Std03) | P | Std03 (PUR-) | (procurement API) | `Procurement.PoCreated` | (none yet) | **Std03 only — NEEDS IA8 row** |
| **Queue** | Case | OSS | `QUE-` (Std03) / no prefix (IA8) | P | IA8.4 (no prefix), MtxA, Std03 (QUE-) | `/api/v1/queues/*` | `Queue.AssignmentTriggered` | `/operations/cases` | **PREFIX VARIANT**: Std03 QUE- vs IA8 none |
| Rack | Location | Network | (none) | P | IA8.2, MtxA | (location API) | (rare) | `/network/inventory` | M1 |
| Region | Location | (global) | (none) | P | IA8.2, MtxA, model/region | `/api/v1/regions/*` | (immutable mostly) | (n/a) | M1 |
| Renewal | Contract | BSS | `REN-` | P | IA8.2, MtxA | `/api/v1/renewals/*` | `Contract.Renewed` | `/services/all` | M1 |
| Resource (base) | Resource | Network | `RES-` | P | IA8.2, MtxA | `/api/v1/network/resources/*` | `Resource.Created/StatusChanged/Decommissioned` | `/network/inventory` | M1 |
| Room | Location | Network | (none) | P | IA8.2, MtxA | (location API) | (rare) | `/network/inventory` | M1 |
| Router | Resource | Network | `RTR-` | P | IA8.2, MtxA | `/api/v1/network/resources/*` | `Resource.RouterAdded` | `/network/inventory` | M1 |
| ServiceArea | Location | Network | `SVA-` | P | IA8.2, MtxA | `/api/v1/service-areas/*` | `Location.ServiceAreaDefined` | `/network/sites` | M1 |
| ServiceInstance | Service | OSS | (subref) | P | IA8.2, MtxA, model/service | `/api/v1/services/*` | `Service.InstanceCreated/Updated` | `/services/all` | M1 |
| ServiceTopology | Service | OSS | (none) | P | MtxA | `/api/v1/topology/*` | `Service.TopologyMapped` | `/services/topology` | M1 |
| Site | Location | Network | `SIT-` | P | IA8.2, MtxA | `/api/v1/sites/*` | `Location.SiteCreated` | `/network/sites` | M1 |
| SoftwareLicense | Resource | Administration | `LIC-` | P | IA8.2, MtxA | `/api/v1/inventory/licenses/*` | `Inventory.LicenseAssigned` | `/admin/...` | M1 |
| Sop / Runbook | Knowledge | (cross) | `SOP-` | W | IA8.2, MtxA | `/api/v1/knowledge/*` | `Knowledge.SopPublished` | `/customers/knowledge` | FUTURE |
| StockItem | Resource | Inventory | `STK-` | P | IA8.2, MtxA | `/api/v1/inventory/items/*` | `Inventory.StockLow` | `/inventory/items` | M1 |
| **Subscription** | Service | OSS | `SUB-` (Std03) / `SVC-` (IA8 conflates) | P | IA8.2 (conflated with Service), Std03 (SUB- separate), MtxA, model/service | `/api/v1/subscriptions/*` | `Subscription.Started/Renewed/Cancelled` | `/services/subscriptions` | M1 · **ALIAS/SPLIT**: IA8 conflates with Service; Std03 separates |
| **Subscription/Service** (IA8 single row) | Service | OSS | `SVC-` | P | IA8.2 (single row), MtxA | `/api/v1/services/*` | `Service.Activated/Suspended/Cancelled/Restored` | `/services/all` | M1 · **see also Subscription above** |
| Switch | Resource | Network | `SWT-` | P | IA8.2, MtxA | `/api/v1/network/resources/*` | `Resource.SwitchAdded` | `/network/inventory` | M1 |
| Task | Work | Workforce | `TSK-` | S | IA8.2, MtxA, model/task, Std14 | `/api/v1/tasks/*` | `Task.Created/Updated/Assigned/Completed` | `/my-day/tasks` | M1 · STRONG |
| Team | Organization | Workforce | (none in IA8) / `TEM-` (Std03) | S | IA8.2 (no prefix), MtxA, Std03 (TEM-) | `/api/v1/teams/*` | `Org.TeamCreated` | `/workforce/team` | **PREFIX VARIANT** |
| Tool | Resource | Inventory | `TLS-` | P | IA8.2, MtxA | `/api/v1/inventory/tools/*` | `Inventory.ToolCheckedOut` | `/inventory/items` | M1 |
| Vehicle | Resource | Inventory | `VHC-` | P | IA8.2, MtxA | `/api/v1/inventory/vehicles/*` | `Inventory.VehicleAssigned` | `/inventory/items` | M1 |
| Vendor | Party | Inventory | `VEN-` | P | IA8.2, MtxA, model/party | `/api/v1/parties/*` | `Party.VendorAdded` | `/customers/all` | M1 |
| WorkItem | Work | Workforce | `WIT-` | S | IA8.2, MtxA, model/workitem, spec/WORKITEMS | `/api/v1/workitems/*` | `Work.WorkItem*` | `/workforce/field-jobs` | M1 |
| WorkOrder | Work | Workforce | `WO-` | S | IA8.2, MtxA | `/api/v1/work-orders/*` | `Work.WorkOrder*` | `/workforce/field-jobs` | M1 |

### 4.3 BUSINESS COMMERCE tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| CostEntry | Financial | Billing | (none) | P | IA8.3, MtxA | `/api/v1/billing/*` | (financial) | `/billing/revenue` | M1 |
| Credit | Financial | Billing | `CRD-` | P | IA8.3, MtxA, model/credit_note | `/api/v1/billing/credits/*` | `Credit.Issued` | `/billing/credits-refunds` | M1 |
| Discount | Financial | Billing | (none) | P | IA8.3, MtxA | `/api/v1/billing/*` | `Financial.DiscountApplied` | `/billing/pricing` | M1 |
| DunningRecord | Financial | Billing | `DNG-` | P | IA8.3, MtxA, model/dunning | `/api/v1/billing/dunning/*` | `Dunning.Step/Step3` | `/billing/dunning` | M1 |
| Invoice | Financial | Billing | `INV-` | P | IA8.3, MtxA, model/billing, spec/BILLING | `/api/v1/billing/invoices/*` | `Invoice.Issued/Paid/PastDue` | `/billing/invoices`, `/portal/billing` | M1 |
| Order | Financial | BSS | `ORD-` | P | IA8.3, MtxA, model/order | `/api/v1/orders/*` | `Order.Created/Validated/Fulfilled` | `/billing/quotes-orders` | M1 |
| Payment | Financial | Billing | `PAY-` | P | IA8.3, MtxA, model/payment_*, spec/PAYMENTS-GATEWAY | `/api/v1/billing/payments/*` | `Payment.Received/Failed` | `/billing/payments` | M1 |
| Pricing | Financial | Billing | (none) | P | IA8.3, MtxA, model/tariff | `/api/v1/billing/pricing/*` | `Financial.PriceChanged` | `/billing/pricing` | M1 |
| Quote | Financial | CRM/BSS | `QUO-` | P | IA8.3, MtxA | `/api/v1/quotes/*` | `Quote.Created/Accepted` | `/billing/quotes-orders` | M1 |
| Rating | Financial | Billing | (none) | P | IA8.3, MtxA, model/usage | (rating engine) | `Usage.Rated` | `/billing/usage` | M1 |
| RevenueEntry | Financial | Billing | (none) | P | IA8.3, MtxA | `/api/v1/billing/*` | (financial) | `/billing/revenue` | M1 |
| Tax | Financial | Billing | (none) | P | IA8.3, MtxA | `/api/v1/billing/*` | `Financial.TaxCalculated` | `/billing/invoices` | M1 |

### 4.4 BUSINESS EXECUTION tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Action (Automation) | Automation | Studio | (none) | P | IA8.4, MtxA, model/automation | `/api/v1/automations/*` | `Automation.Triggered` | `/studio/automations` | M1 |
| Appointment | Scheduling | Workforce | `APT-` | P | IA8.4, MtxA, model/calendar | `/api/v1/schedule/*` | `Schedule.AppointmentBooked` | `/workforce/calendar` | M1 |
| ApprovalChain | Approval | Studio | (none) | P | IA8.4, MtxA | `/api/v1/approvals/*` | `Approval.ChainConfigured` | `/studio/...` | M1 |
| ApprovalRequest | Approval | (cross) | `APR-` | P | IA8.4, MtxA, model/approval | `/api/v1/approvals/*` | `Approval.Requested/Granted/Rejected/Escalated` | `/operations/approvals`, `/my-day/approvals` | M1 · **conflict with Std03 APP=Approval** |
| AutomationRule | Automation | Studio | `AUT-` | P | IA8.4, MtxA, model/automation | `/api/v1/automations/*` | `Automation.RuleCreated/Triggered` | `/studio/automations` | M1 |
| BreachRecord | SLA | (cross) | `BRC-` | P | IA8.4, MtxA, model/sla | (sla) | `Sla.Breached` | `/operations/sla-breach` | M1 |
| CalendarBooking | Scheduling | Workforce | (none) | P | MtxA | `/api/v1/schedule/*` | `Schedule.BookingCreated` | `/workforce/calendar` | M1 |
| CaseQueue | Case | OSS | (none in IA8) / `QUE-` (Std03) | P | IA8.4, MtxA, Std03 (QUE-) | `/api/v1/queues/*` | `Queue.AssignmentTriggered` | `/operations/cases` | **PREFIX VARIANT** |
| ChangeRequest | Case | OSS | `CHG-` | P | IA8.4, MtxA, model/helpdesk | `/api/v1/changes/*` | `ChangeRequest.Proposed/Approved/Completed` | `/operations/changes`, `/network/changes` | M1 |
| Comment | Communication | (cross) | `CMT-` | P | IA8.4, MtxA, model/comment, Std14 | `/api/v1/comments/*` | `Message.Posted`, `Communication.CommentAdded` | (per-entity tab) | M1 |
| **Complaint** | Case | CRM | `CMP-` | P | IA8.4, MtxA | `/api/v1/cases/*` | `Complaint.Filed` | `/operations/cases` | M1 · **CONFLICT** with Std03 CMP=Campaign |
| Condition (Automation) | Automation | Studio | (none) | P | IA8.4, MtxA | (internal) | (per rule eval) | `/studio/automations` | M1 |
| DeliveryStatus | Notification | (cross) | (none) | P | MtxA, model/notification | (internal) | `Notification.Delivered/Failed` | `/admin/...` | M1 |
| DispatchSlot | Scheduling | Workforce | (none) | P | IA8.4, MtxA | `/api/v1/dispatch/*` | `Dispatch.SlotAssigned` | `/workforce/dispatch` | M1 |
| Document | Document | (cross) | `DOC-` | P | IA8.4, MtxA, model/attachment | `/api/v1/documents/*` | `Document.Created/Generated/Signed` | (per-entity tab), `/portal/documents` | M1 |
| Execution (Automation) | Automation | Automation | `EXE-` | P | IA8.4, MtxA, model/automation | `/api/v1/automations/*` | `Automation.Executed/Failed` | `/studio/automations` | M1 |
| Failure (Automation) | Automation | Automation | (none) | P | MtxA | (internal) | `Automation.Failed` | `/studio/automations` | M1 |
| GeneratedPdf | Document | (cross) | (none) | P | IA8.4, MtxA | `/api/v1/documents/*` | `Document.Generated` | (per-entity) | M1 |
| Incident | Case | OSS/Network | `INC-` | P | IA8.4, MtxA, model/helpdesk | `/api/v1/incidents/*` | `Incident.Opened/Triaged/Resolved/Closed` | `/operations/incidents`, `/network/incidents` | M1 |
| MaintenanceWindow | Scheduling | Network | (none) | P | MtxA | `/api/v1/schedule/*` | `Maintenance.WindowScheduled` | `/network/maintenance-windows` | M1 |
| Mention | Communication | (cross) | (none) | P | IA8.4, MtxA, model/comm | (internal) | `Mention.Created` | (per-entity) | M1 |
| Message | Communication | (cross) | `MSG-` | P | IA8.4, MtxA, model/comm | `/api/v1/communications/*` | `Message.Posted` | `/customers/communications` | M1 |
| Note | Communication | (cross) | (none) | P | MtxA, model/comment | (internal) | `Note.Added` | (per-entity) | M1 |
| NotificationPreference | Notification | (cross) | (none) | P | IA8.4, MtxA, model/notification_pref | `/api/v1/notifications/*` | `Notification.PreferenceUpdated` | `/admin/users`, `/portal/account` | M1 |
| NotificationRecord | Notification | (cross) | `NTF-` | P | IA8.4, MtxA, model/notification, spec/NOTIFICATIONS-DEPTH | `/api/v1/notifications/*` | `Notification.Queued/Delivered/Failed` | `/my-day/notifications` | M1 |
| Problem | Case | OSS | `PRB-` | P | IA8.4, MtxA | `/api/v1/problems/*` | `Problem.Recorded/Resolved` | `/operations/cases` | M1 |
| Schedule | Scheduling | Workforce | `SCH-` | P | IA8.4, MtxA, model/calendar | `/api/v1/schedule/*` | `Schedule.Created/Updated` | `/workforce/calendar` | M1 |
| ServiceRequest | Case | OSS | `SRQ-` | P | IA8.4, MtxA, model/helpdesk | `/api/v1/requests/*` | `ServiceRequest.Created/Completed` | `/operations/cases` | M1 |
| SignoffEvidence | Approval | (cross) | (none) | P | IA8.4, MtxA | `/api/v1/approvals/*` | `Approval.SignoffRecorded` | `/operations/approvals` | M1 |
| SlaClock | SLA | (cross) | (none) | P | IA8.4, MtxA, model/sla | (sla internal) | `Sla.Started/Paused/Resumed` | `/operations/sla-breach` | M1 |
| SlaDefinition | SLA | Studio | `SLA-` | P | IA8.4, MtxA, model/sla | `/api/v1/sla/*` | `Sla.DefinitionUpdated` | `/studio/...` | M1 |
| SlaPause | SLA | (cross) | (none) | P | MtxA | (internal) | `Sla.Paused` | (n/a) | M1 |
| SlaTarget | SLA | (cross) | (none) | P | MtxA | (internal) | (config) | (n/a) | M1 |
| State (Workflow) | Workflow | Studio | (none) | S | IA8.4, MtxA | `/api/v1/workflows/*` | `Workflow.Transition` | `/studio/workflows` | M1 |
| Thread | Communication | (cross) | `THR-` | P | IA8.4, MtxA, model/communication | `/api/v1/comm/*` | `Thread.Created` | `/customers/communications` | M1 |
| Ticket | Case | OSS/CRM | `TKT-` | P | IA8.4, MtxA, model/helpdesk, spec/HELPDESK | `/api/v1/tickets/*` | `Ticket.Created/Triaged/Resolved/Closed` | `/operations/tickets` | M1 |
| Transition | Workflow | Studio | (none) | S | IA8.4, MtxA, alembic/spec_5_workflows | `/api/v1/workflows/*` | `Workflow.Transition` | `/studio/workflows` | M1 |
| TransitionHistory | Workflow | (cross) | (none) | S | IA8.4, MtxA, model/workflow_instance | `/api/v1/workflows/*` | (immutable) | (per-entity tab) | M1 |
| Trigger (Automation) | Automation | Studio | (none) | P | IA8.4, MtxA | (internal) | (per rule) | `/studio/automations` | M1 |
| WebhookNotification | Notification | Automation | (none) | P | MtxA | `/api/v1/notifications/*` | `Notification.WebhookDispatched` | `/admin/integrations` | M1 |
| WorkflowDefinition | Workflow | Studio | `WFL-` | S | IA8.4, MtxA, Std03 (WFL=) | `/api/v1/workflows/*` | `Workflow.Definition.Versioned` | `/studio/workflows` | M1 |
| WorkflowInstance | Workflow | (cross) | `WFI-` | S | IA8.4, MtxA, model/workflow_instance | `/api/v1/workflows/*` | `Workflow.Transition` | (per-entity) | M1 |

### 4.5 PLATFORM SERVICES tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| ApiKey | Developer Platform | Administration | (none in IA8) / no Std03 | P | IA8.5, MtxA, model/apikey | `/api/v1/developer/api-keys/*` | `Identity.ApiKeyCreated` | `/admin/developer-platform` | M1 |
| ApiLogEntry | Developer Platform | Administration | (none) | P | MtxA | (internal) | `Api.RequestLogged` | `/admin/developer-platform` | M1 |
| AppRegistration | Developer Platform | Administration | (none) | P | MtxA | `/api/v1/developer/*` | `Developer.AppRegistered` | `/admin/developer-platform` | M1 |
| BlobObject | Storage | Administration | (none) | P | IA8.5, MtxA | (storage internal) | `Storage.BlobUploaded` | (n/a) | M1 |
| **Connector** | Integration | Automation | `CNT-` (IA8) | P | IA8.5, MtxA | `/api/v1/integrations/connectors/*` | `Integration.ConnectorCreated` | `/admin/integrations` | M1 · **CONFLICT** with Std03 CNT=Contract |
| CredentialReference | Integration | Automation | (none) | P | MtxA | (internal) | `Integration.CredentialBound` | `/admin/integrations` | M1 |
| CustomField | Metadata | Studio | (none) | P | IA8.5, MtxA, model/meta | `/api/v1/meta/fields/*` | `Metadata.FieldCreated` | `/studio/entities-fields` | M1 |
| DependencyGraph | Relationship | Network | (none) | P | IA8.5, MtxA | (internal) | `Relationship.GraphRebuilt` | `/network/topology` | M1 |
| DomainEvent | Event | (cross) | (none in IA8) / `EVT-` (Std03) | S | IA8.5, MtxA, model/event, Std03 (EVT-) | `/api/v1/events/*` | (the event stream) | `/admin/audit-log` | **PREFIX VARIANT** |
| DynamicForm | Metadata | Studio | (none) | P | IA8.5, MtxA, model/meta | `/api/v1/meta/forms/*` | `Metadata.FormCreated` | `/studio/...` | M1 |
| DynamicSchema | Metadata | Studio | (none) | P | IA8.5, MtxA, model/meta | `/api/v1/meta/entities/*` | `Metadata.SchemaCreated` | `/studio/entities-fields` | M1 |
| EmailTemplate | Template | Studio | `TPL-` | W | IA8.5, MtxA | `/api/v1/templates/*` | `Template.Updated` | `/studio/templates` | M1 |
| EntityRelationship | Relationship | (cross) | `REL-` | P | IA8.5, MtxA, model/relationship, Std03 (REL=) | `/api/v1/relationships/*` | `Relationship.Created/Updated` | (per-entity tab) | M1 |
| EventSchemaRegistration | Event | Administration | (none) | S | IA8.5, MtxA | `/api/v1/event-schemas/*` | `Event.SchemaRegistered` | `/admin/...` | M1 |
| EventStoreEntry | Event | Administration | (none) | S | IA8.5, MtxA, model/event | `/api/v1/events/*` | (the stream) | `/admin/audit-log` | M1 · append-only |
| ExportJob | Import/Export | Administration | `EXP-` | P | IA8.5, MtxA, model/import_export, Std03 (EXP=) | `/api/v1/export/*` | `Export.Started/Completed/Failed` | `/admin/imports-exports` | M1 |
| ImportJob | Import/Export | Administration | `IMP-` | P | IA8.5, MtxA, model/import_export, Std03 (IMP=) | `/api/v1/admin/bulk/*` | `Import.Started/Completed/Failed` | `/admin/imports-exports` | M1 |
| InvoiceTemplate | Template | Studio | `TPL-` | W | MtxA | `/api/v1/templates/*` | `Template.Updated` | `/studio/templates` | M1 |
| JobRun | Background Processing | Administration | (none) | P | MtxA, model/job | `/api/v1/jobs/*` | `Job.Started/Completed/Failed` | `/admin/...` | M1 |
| MappingRule | Integration | Studio | (none) | P | IA8.5, MtxA | `/api/v1/integrations/mapping/*` | `Integration.MappingUpdated` | `/studio/...` | M1 |
| MigrationJob | Import/Export | Administration | (none) | P | MtxA | `/api/v1/admin/*` | `Migration.Ran` | `/admin/imports-exports` | M1 |
| OAuthApp | Developer Platform | Administration | `OAP-` | P | IA8.5, MtxA | `/api/v1/developer/oauth-apps/*` | `Developer.OAuthCreated` | `/admin/developer-platform` | M1 |
| PdfTemplate | Template | Studio | `TPL-` | W | MtxA | `/api/v1/templates/*` | `Template.Updated` | `/studio/templates` | M1 |
| Queue (Background Processing) | Background Processing | Administration | (none) | P | IA8.5, MtxA | `/api/v1/queues/*` | (substrate) | `/admin/...` | M1 · distinct from Case Queue |
| ReplayCheckpoint | Event | Administration | (none) | S | MtxA | (internal) | (replay) | `/admin/...` | M1 |
| ReportTemplate | Template | Studio | `TPL-` | W | MtxA | `/api/v1/templates/*` | `Template.Updated` | `/studio/templates` | M1 |
| ResultPermissionRule | Search | (cross) | (none) | P | MtxA | (internal) | `Search.PermissionRuleUpdated` | (internal) | M1 |
| SandboxApp | Developer Platform | Administration | (none) | P | MtxA | `/api/v1/developer/sandbox/*` | `Developer.SandboxCreated` | `/admin/developer-platform` | M1 |
| SavedFilter | Search | (cross) | (none) | P | IA8.5, MtxA, model/saved_view | `/api/v1/search/*` | `Search.FilterSaved` | (per-list) | M1 |
| SavedView | Search | (cross) | (none) | P | IA8.5, MtxA, model/saved_view | `/api/v1/views/*` | `Search.ViewSaved` | (per-list) | M1 |
| ScheduledExport | Import/Export | Administration | (none) | P | MtxA, model/report_schedule | `/api/v1/export/*` | `Export.Scheduled` | `/reports/scheduled-exports` | M1 |
| ScheduledJob | Background Processing | Administration | `JOB-` | P | IA8.5, MtxA, model/job, Std03 (JOB=) | `/api/v1/jobs/*` | `Job.Scheduled/Started/Completed/Failed` | `/admin/...` | M1 |
| SearchIndex | Search | Administration | (none) | P | IA8.5, MtxA | (internal) | `Search.IndexUpdated` | (internal) | M1 |
| Sdk | Developer Platform | Administration | (none) | P | IA8.5, MtxA | `/api/v1/developer/sdks/*` | `Developer.SdkPublished` | `/admin/developer-platform` | M1 |
| SignedUrlPolicy | Storage | Administration | (none) | P | MtxA | (internal) | (config) | `/admin/security` | M1 |
| SmsTemplate | Template | Studio | `TPL-` | W | MtxA | `/api/v1/templates/*` | `Template.Updated` | `/studio/templates` | M1 |
| StorageProvider | Storage | Administration | (none) | P | MtxA | (internal) | (config) | `/admin/security` | M1 |
| SyncJob | Integration | Automation | (none) | P | IA8.5, MtxA | `/api/v1/integrations/sync-jobs/*` | `Integration.SyncRunCompleted/Failed` | `/admin/integrations` | M1 |
| TopologyRelation | Relationship | Network | (none) | P | MtxA | (internal) | `Topology.LinkAdded` | `/network/topology` | M1 |
| ValidationMetadata | Metadata | Studio | (none) | P | MtxA, model/meta | (internal) | `Metadata.ValidationDefined` | `/studio/...` | M1 |
| ValidationPreview | Import/Export | Administration | (none) | P | MtxA | `/api/v1/admin/bulk/*` | `Import.PreviewRendered` | `/admin/imports-exports` | M1 |
| VirusScanResult | Storage | Administration | (none) | P | MtxA | (internal) | `Storage.VirusScanCompleted` | (internal) | M1 |
| **Webhook** | Integration | Automation | `WBH-` (IA8) / `WHK-` (Std03) | P | IA8.5, MtxA (WBH-), model/webhook, Std03 (WHK=) | `/api/v1/integrations/webhooks/*` | `Integration.WebhookReceived` | `/admin/integrations` | **PREFIX VARIANT** |
| Worker | Background Processing | Administration | (none) | P | MtxA | (internal) | `Worker.Started/Stopped` | `/admin/...` | M1 |

### 4.6 INTELLIGENCE tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Aggregation | Analytics | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/analytics/aggregations/*` | `Analytics.AggregationRun` | `/reports/dashboards` | M1 |
| AiAssistant | AI | (cross) | `AIA-` | W | IA8.6, MtxA | `/api/v1/ai/assistants/*` | `Ai.AssistantInvoked` | `/admin/ai-config` | FUTURE |
| AiAuditLog | AI | Administration | (none) | W | IA8.6, MtxA | `/api/v1/ai/runs/*` | `Ai.ActionAudited` | `/admin/audit-log` | FUTURE |
| AiTool | AI | Studio | (none) | W | IA8.6, MtxA | `/api/v1/ai/tools/*` | `Ai.ToolRegistered` | `/admin/ai-config` | FUTURE |
| AnalyticalDimension | Analytics | Reporting | (none) | P | MtxA | (internal) | (config) | `/reports/dashboards` | M1 |
| CapacityForecast | Forecasting | Reporting | (none) | M | MtxA | `/api/v1/forecasts/*` | `Forecast.RunCompleted` | `/reports/forecasts` | FUTURE (M2+) |
| ConfidenceInterval | Forecasting | Reporting | (none) | M | MtxA | (internal) | (forecast) | (n/a) | FUTURE |
| DashboardDataset | Analytics | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/analytics/dashboards/*` | `Analytics.DashboardRefreshed` | `/reports/dashboards` | M1 |
| DecisionModel | Decision Support | (cross) | (none) | P | IA8.6, MtxA | `/api/v1/recommendations/*` | `Decision.ModelExecuted` | (per-context) | FUTURE |
| ExplanationRecord | Decision Support | (cross) | (none) | P | MtxA | (internal) | `Decision.ExplanationLogged` | (per-context) | FUTURE |
| ForecastInputDataset | Forecasting | Reporting | (none) | M | MtxA | (internal) | (forecast) | (n/a) | FUTURE |
| ForecastModel | Forecasting | Reporting | (none) | M | IA8.6, MtxA | `/api/v1/forecasts/*` | `Forecast.ModelTrained` | `/reports/forecasts` | FUTURE |
| ForecastRun | Forecasting | Reporting | `FRC-` | M | IA8.6, MtxA | `/api/v1/forecasts/*` | `Forecast.RunCompleted` | `/reports/forecasts` | FUTURE |
| GeneratedReportFile | Reporting | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/reports/runs/*` | `Report.FileGenerated` | `/reports/standard` | M1 |
| HumanApprovalGate | AI | (cross) | (none) | W | MtxA | `/api/v1/ai/*` | `Ai.ApprovalRequested` | `/admin/ai-config`, `/operations/approvals` | FUTURE |
| ImpactAnalysis | Decision Support | (cross) | (none) | P | MtxA | (internal) | `Decision.ImpactComputed` | (per-context) | FUTURE |
| KnowledgeSource | AI | Studio | (none) | W | IA8.6, MtxA | `/api/v1/ai/*` | `Ai.KnowledgeSourceRegistered` | `/admin/ai-config` | FUTURE |
| KpiDefinition | Analytics | Reporting | (none) | P | IA8.6, MtxA, model/dashboard | `/api/v1/analytics/kpis/*` | `Analytics.KpiCreated` | `/reports/dashboards` | M1 |
| MetricModel | Analytics | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/analytics/*` | `Analytics.MetricModelUpdated` | `/reports/dashboards` | M1 |
| ModelConfig | AI | Studio | (none) | W | MtxA | `/api/v1/ai/*` | `Ai.ModelConfigUpdated` | `/admin/ai-config` | FUTURE |
| NextBestAction | Decision Support | (cross) | (none) | P | MtxA | `/api/v1/recommendations/*` | `Decision.NbaRecommended` | (per-context) | FUTURE |
| Prompt | AI | Studio | (none) | W | IA8.6, MtxA | `/api/v1/ai/prompts/*` | `Ai.PromptUpdated` | `/admin/ai-config` | FUTURE |
| Recommendation | Decision Support | (cross) | `REC-` | P | IA8.6, MtxA | `/api/v1/recommendations/*` | `Decision.RecommendationProduced` | (per-context) | FUTURE |
| ReportDefinition | Reporting | Reporting | `RPT-` | P | IA8.6, MtxA, model/report | `/api/v1/reports/*` | `Report.DefinitionUpdated` | `/reports/standard` | M1 |
| ReportParameter | Reporting | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/reports/*` | (config) | `/reports/standard` | M1 |
| ReportRun | Reporting | Reporting | (none) | P | IA8.6, MtxA | `/api/v1/reports/runs/*` | `Report.RunStarted/Completed` | `/reports/standard` | M1 |
| ReportSchedule | Reporting | Reporting | `RPS-` | P | IA8.6, MtxA, model/report_schedule, spec/REPORTING-DELIVERY | `/api/v1/reports/schedules/*` | `Report.Scheduled` | `/reports/scheduled-exports` | M1 |
| Scenario | Forecasting | Reporting | (none) | M | IA8.6, MtxA | `/api/v1/forecasts/*` | `Forecast.ScenarioRan` | `/reports/forecasts` | FUTURE |
| Score | Decision Support | (cross) | (none) | P | MtxA | (internal) | `Decision.ScoreComputed` | (per-context) | FUTURE |

### 4.7 EXPERIENCE tier

| Entity | Core Owner | Domain | Prefix | Status | Canonical Source | Related APIs | Related Events | Related Pages | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **App (Marketplace)** | Marketplace | Administration | `APP-` | M | IA8.7, MtxA | `/api/v1/marketplace/apps/*` | `Marketplace.AppInstalled` | `/admin/marketplace` | FUTURE · **CONFLICT** with Std03 APP=Approval |
| AppEntitlement | Marketplace | Administration | (none) | M | MtxA | `/api/v1/marketplace/*` | `Marketplace.EntitlementGranted` | `/admin/marketplace` | FUTURE |
| AppPermission | Marketplace | Administration | (none) | M | MtxA | `/api/v1/marketplace/*` | `Marketplace.PermissionDeclared` | `/admin/marketplace` | FUTURE |
| AppReview | Marketplace | Administration | (none) | M | MtxA | `/api/v1/marketplace/*` | `Marketplace.ReviewCompleted` | `/admin/marketplace` | FUTURE |
| BoardLayout | Workspace | (cross) | (none) | P | IA8.7, MtxA | (internal) | (config) | (per-page) | M1 |
| CommandPaletteEntry | Workspace | (n/a) | (none) | P | IA8.7, MtxA | (internal) | (config) | (palette) | M1 |
| CurrencyDisplay | Localization | (cross) | (none) | P | MtxA, model/translation | (i18n) | `Locale.CurrencyChanged` | (per-page) | M1 |
| CustomerPortalPage | Portal | Portal | (none) | P | IA8.7, MtxA | `/api/v1/portal/*` | `Portal.PageRendered` | `/portal/*` | M1 |
| DashboardLayout | Workspace | (cross) | (none) | P | IA8.7, MtxA, model/dashboard | `/api/v1/dashboards/*` | `Workspace.LayoutUpdated` | `/reports/dashboards` | M1 |
| DetailPageLayout | Workspace | (cross) | (none) | P | IA8.7, MtxA | (internal) | (config) | (per-entity detail) | M1 |
| DeviceTrustRecord | Mobile | Workforce | (none) | W | MtxA | `/api/v1/mobile/devices/*` | `Mobile.DeviceTrustChanged` | `/workforce/mobile-audit` | FUTURE |
| DrawerSpec | Workspace | (cross) | (none) | P | MtxA | (internal) | (config) | (per-entity) | M1 |
| **Extension (Marketplace)** | Marketplace | Administration | `EXT-` | M | IA8.7, MtxA | `/api/v1/marketplace/extensions/*` | `Marketplace.ExtensionRegistered` | `/admin/marketplace` | FUTURE |
| FallbackRule | Localization | (cross) | (none) | P | MtxA | (i18n) | (config) | (internal) | M1 |
| FieldTechnicianFlow | Mobile | Workforce | (none) | W | MtxA | `/api/v1/mobile/*` | `Mobile.FlowStarted` | (mobile app) | FUTURE |
| InstallLifecycleRecord | Marketplace | Administration | (none) | M | MtxA | `/api/v1/marketplace/installs/*` | `Marketplace.InstallLifecycle*` | `/admin/marketplace` | FUTURE |
| LeftNavEntry | Workspace | (n/a) | (none) | P | IA8.7, MtxA, model/nav_module | `/api/v1/nav/*` | `Workspace.NavUpdated` | (chrome) | M1 |
| LocaleProfile | Localization | (cross) | (none) | P | IA8.7, MtxA, model/translation | (i18n) | (config) | `/admin/...` | M1 |
| MarketplaceListing | Marketplace | Administration | (none) | M | MtxA | `/api/v1/marketplace/*` | `Marketplace.ListingPublished` | `/admin/marketplace` | FUTURE |
| MobileAppShell | Mobile | Workforce | (none) | W | IA8.7, MtxA | (mobile) | (mobile) | (mobile app) | FUTURE |
| MobileNavEntry | Mobile | Workforce | (none) | W | MtxA | (mobile) | (config) | (mobile app) | FUTURE |
| MultilingualContent | Localization | (cross) | (none) | P | MtxA, model/translation | (i18n) | `Locale.ContentTranslated` | (cross-page) | M1 |
| OfflineSyncRecord | Mobile | Workforce | (none) | W | IA8.7, MtxA | `/api/v1/mobile/sync/*` | `Mobile.SyncCompleted/Failed` | `/workforce/mobile-audit` | FUTURE |
| PageRegistryEntry | Workspace | (n/a) | (none) | P | IA8.7, MtxA, model/page_binding | `/api/v1/page-bindings/*` | `Workspace.PageRegistered` | (chrome) | M1 |
| PartnerPortalPage | Portal | Portal | (none) | P | IA8.7, MtxA | `/api/v1/portal/*` | (rendered) | `/portal/*` | M1 |
| PortalAuthSurface | Portal | Portal | (none) | P | IA8.7, MtxA | `/api/v1/portal/auth/*` | `Portal.AuthRendered` | `/portal/*` | M1 |
| PortalRequest | Portal | Portal | `PRQ-` | P | IA8.7, MtxA | `/api/v1/portal/*` | `Portal.RequestSubmitted` | `/portal/*` | M1 |
| PortalVisibilityRule | Portal | Portal | (none) | P | MtxA | (internal) | (config) | (config) | M1 |
| PushAction | Mobile | Workforce | (none) | W | MtxA | (mobile) | `Mobile.PushDispatched` | (mobile app) | FUTURE |
| RegionalFormat | Localization | (cross) | (none) | P | MtxA | (i18n) | (config) | (per-page) | M1 |
| TableLayout | Workspace | (cross) | (none) | P | IA8.7, MtxA | (internal) | (config) | (per-list) | M1 |
| TopNavEntry | Workspace | (n/a) | (none) | P | IA8.7, MtxA, model/nav_module | `/api/v1/nav/*` | `Workspace.NavUpdated` | (chrome) | M1 |
| Translation | Localization | (cross) | (none) | P | IA8.7, MtxA, model/translation | `/api/v1/i18n/*` | `Locale.TranslationUpdated` | (per-page) | M1 |
| VendorPortalPage | Portal | Portal | (none) | P | IA8.7, MtxA | `/api/v1/portal/*` | (rendered) | `/portal/*` | M1 |

---

## 5. Per-tier entity counts

| Tier | Entity count | Status distribution |
|---|---|---|
| FOUNDATION | 70 (incl. Std03-only items) | S: 18 · P: 49 · W: 1 · M: 0 |
| BUSINESS OBJECTS | 65 (incl. Std03-only Lead/Role/Project/PO/Network Device/Location) | S: 9 · P: 52 · W: 4 · M: 0 |
| BUSINESS COMMERCE | 12 | S: 0 · P: 12 · W: 0 · M: 0 |
| BUSINESS EXECUTION | 41 | S: 9 · P: 32 · W: 0 · M: 0 |
| PLATFORM SERVICES | 44 | S: 6 · P: 33 · W: 5 · M: 0 |
| INTELLIGENCE | 29 | S: 0 · P: 16 · W: 7 · M: 6 |
| EXPERIENCE | 35 | S: 0 · P: 24 · W: 7 · M: 7 |
| **TOTAL** | **296** (after de-duplication ~210 unique entities) | S: 42 · P: 218 · W: 24 · M: 13 |

The total exceeds 200 because some entities are listed redundantly (e.g.
Subscription as its own row plus Subscription/Service combined row) to
make the alias/conflict findings visible. The unique canonical entity
count after de-duplication is approximately **210**.

---

## 6. LAW-GV1 amendment candidates surfaced

The following reconciliation items are **NOT applied in this catalog**;
they are listed for Gev's future LAW-GV1 amendment cycle. Each requires
amending either Standard 03 prefix registry or `03_INFORMATION_ARCHITECTURE.md`
§7.4/§8 — both of which are LOCKED at the architecture layer.

### 6.A Prefix conflicts to resolve

| Conflict | Recommendation (for amendment) |
|---|---|
| `CNT-` for Connector vs Contract | Either rename Connector to `CON-` family (collides with Contact `CON-`!) or accept the conflict + document in standard. Suggest: Connector → `CTR-` is taken; consider `INT-` (Integration). |
| `CMP-` for Complaint vs Campaign | Suggest: Complaint → `CPL-`; preserve `CMP-` for Campaign per Std03. |
| `APP-` for App vs Approval | Suggest: App → `APX-` (Marketplace App); preserve `APR-` for ApprovalRequest. |
| `CTR-` for Contractor vs Contract | Suggest: Contractor → `CTC-`; Contract = `CTR-` per IA8 (or `CNT-` per Std03). |
| `WBH-` vs `WHK-` for Webhook | Pick one. Suggest: `WHK-` per Std03 (already locked). Amend IA8 §7.4. |
| `PLN-` for Entitlement.Plan vs Product.Plan | These are different concepts. Suggest: Entitlement.Plan → `ENT-` or `EPL-`; preserve `PLN-` for Product.Plan. |
| `SVC-` / `SUB-` for Subscription vs Service | These ARE different (subscription = contractual, service = instance). Suggest: split into two rows in IA8 §8.2 with `SUB-` (subscription) and `SVC-` (service-instance). |

### 6.B Entities to backfill into IA8

Add canonical rows in `03_INFORMATION_ARCHITECTURE.md` §8 for:
Lead (`LED-`), Role (`ROL-`), Project (`PRJ-`), PurchaseOrder (`PUR-`),
NetworkDevice-parent (`NDV-`), Location-base (`LOC-`), Configuration
canonical entity (`CFG-`), Feature Flag (`FFL-`), Release (`RLE-`),
Event (`EVT-`).

### 6.C Std03 prefix registry to expand

Add prefix entries in Standard 03 for the ~46 entities currently in IA8
§8 without prefix registration (see §3.C).

---

## 7. Maintenance process

Per LAW-GV1 + `01` §16.1 + `03` §16.1:

1. **Adding an entity** requires:
    - Add row to IA8 §8.x at architecture layer.
    - Register prefix in Standard 03 if user-visible.
    - Author Alembic migration with standard fields.
    - Declare events in `11_EVENT_ARCHITECTURE.md`.
    - Add permission keys in `08_PERMISSION_ARCHITECTURE.md` + Standard 15.
    - Add row here.
2. **Reassigning primary ownership** requires LAW-GV1 amendment.
3. **Renaming an entity** is a multi-PR migration (per `03` §16.2).
4. **Drift check enforcement** (planned for `tools/check_drift.py`):
    - Every `__owner_core__` metadata in models matches Entity Catalog.
    - Every reference number prefix used in seed/data matches Standard 03 OR IA8 §7.4 (with the source noted).

---

*End of Entity Catalog.*
