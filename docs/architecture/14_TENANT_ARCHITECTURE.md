# 14 — Tenant Architecture

**Primary core:** Tenant (Foundation tier — universal)

**Constitutional document.** Position in the hierarchy: directly under `01_PLATFORM_CORE_ARCHITECTURE.md`. Governs multi-tenant isolation, tenant lifecycle, tenant hierarchy, white-label support, RLS posture, cross-tenant operations, and tenant-scoped configuration. All implementations must conform to this document.

---

## 1. Purpose

Define what a **Tenant** is, the tenant lifecycle, tenant entity model, multi-tenant isolation boundaries, RLS enforcement, white-label support without schema or code forks, cross-tenant operations (Super Admin only), and tenant configuration defaults.

Tenant is a Foundation-tier core — every business-scoped entity depends on it. The thesis: single shared database, every tenant-scoped row carries `tenantId`, RLS policy `tenant_isolation` enforces isolation at the database layer, and the application never bypasses RLS except through registered exemptions.

---

## 2. Scope

**In scope:**

- Tenant entity model (Tenant, TenantProfile, TenantHierarchy, TenantBrandingLink).
- Tenant lifecycle states (CREATING → PROVISIONING → ACTIVE → SUSPENDED → ARCHIVED → PURGED).
- Multi-tenant isolation principle: single database, no schema forks, no code forks.
- RLS policy `tenant_isolation` and the gaahex_app / gaahex role split.
- Tenant identifiers (subdomain, custom domain, API key tenant scope).
- Tenant hierarchy (parent/child for white-label resellers).
- White-label support (branding, themes, domains, communications, configuration).
- Tenant-scoped configuration (TenantSetting, ModuleSetting, feature flags).
- Tenant lifecycle events and audit.
- Data export (compliance / portability).
- Data purge (GDPR right-to-be-forgotten).
- Cross-tenant operations (Super Admin, explicit, audited, RLS-exempt via registry).

**Out of scope (handled by other cores):**

- Identity lifecycle (User, service accounts, SSO) — see Identity Core.
- Permission grants and RBAC — see Permission Architecture.
- Feature gates and entitlements — see Entitlement Core, Configuration Core.
- Data schemas for tenant-scoped entities — see Information Architecture.
- Audit records themselves — see Audit Core.
- Event publication — see Event Core.
- Compliance / retention / consent — see Compliance Core.

---

## 3. Goals

- **G1** Every tenant-scoped entity carries `tenantId` and is governed by RLS policy `tenant_isolation` at the database layer.
- **G2** The gaahex_app role is NOSUPERUSER NOBYPASSRLS; RLS engages in production and gates every query.
- **G3** Tenant lifecycle is explicit and auditable: CREATING → PROVISIONING → ACTIVE → SUSPENDED → ARCHIVED → PURGED (state independent per D14).
- **G4** Tenant hierarchy supports white-label resellers (parent/child relationships, inherited permissions, scoped branding).
- **G5** White-label is configuration-driven: branding (logo, colors, domain, theme), communications (email sender, signature), navigation (overrides) — never tenant-specific code or schema.
- **G6** Cross-tenant access is forbidden for normal users; Super Admin cross-tenant operations are explicit, permission-gated, time-limited, and audited.
- **G7** Tenant data can be exported for compliance (portability) and purged for GDPR (right-to-be-forgotten).
- **G8** Tenant configuration is centralized (TenantSetting, ModuleSetting); no arbitrary tenant-specific logic.
- **G9** Tenant is not Organization. Tenant is SaaS isolation; Organization is business structure inside the tenant (per PRM).

---

## 4. Non-Goals

- **NG1** This document does NOT define tenant-specific business logic or custom workflows per tenant. (Workflow definitions are global; configuration and feature flags express tenant variance.)
- **NG2** This document does NOT manage subscriptions, licensing, or feature entitlements. (See Entitlement Core.)
- **NG3** This document does NOT govern UI/UX beyond white-label configuration boundaries (branding, nav visibility, field toggles). (See UI Experience Architecture.)
- **NG4** This document does NOT define Identity lifecycle or SSO tenancy modeling. (See Identity Core.)

---

## 5. Architecture Principles

### P1 — Single database, row-level isolation

GAAhex uses a **single shared Postgres database** for all tenants. There is no database-per-tenant, no schema-per-tenant, and no tenant-specific schema migrations. The isolation boundary is **row-level**: every tenant-scoped business row carries a `tenantId` column and is governed by Postgres RLS policy `tenant_isolation`.

### P2 — Tenant provenance is server-assigned, never user-supplied

Tenant context flows from the authenticated JWT `tenant` claim, server-validated against `User.tenant_id`. Tenant id is **never** accepted from frontend, query params, import files, integration payloads, local storage, or browser state. Frontend input always carries the risk of tenant-context manipulation; server assignment is the only secure path.

### P3 — White-label is configuration-driven, never code-driven

White-label support (branding overrides, navigation customizations, communications preferences, display settings) is entirely **configuration-driven** through TenantBrandingLink and ModuleSetting. No tenant-specific code branches (e.g., `if tenant.id == X`), schema forks, or hidden workflows. Every tenant sees the same application, shaped by configuration.

### P4 — Tenant hierarchy enables reseller/delegation patterns without data exposure

Parent/child tenant relationships support white-label resellers and managed accounts. Child tenants inherit parent branding and navigation unless overridden. **Critically**: child data remains **isolated** from parent data via RLS. Parent cannot see child rows unless an explicit Super Admin cross-tenant operation reads them (registered in RLS_EXEMPTION_REGISTRY).

### P5 — Cross-tenant operations are explicit, audited, and gated by platform permissions

Normal users are **completely isolated** by RLS. Cross-tenant access is **only** available to platform Super Admins via explicit operations (querying another tenant's data, migrating data, bulk platform updates), permission-gated (`platform.*` permissions, never `tenant.super_admin`), audited, and registered in an exemption ledger.

---

## 6. Architecture Laws

### L1 — RLS enforcement is mandatory at the database layer

Every tenant-scoped table has the `tenant_isolation` policy installed by migration:

```sql
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (tenant_id = current_setting('gaahex.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('gaahex.tenant_id')::uuid);
```

The `gaahex.tenant_id` GUC (Global User Config) is set **per request** by the backend, validated from the JWT `tenant` claim and cross-checked against `User.tenant_id` server-side. This policy is **not** a hint; it is a hard gate enforced at the database layer.

### L2 — Role split: gaahex_app vs gaahex (NOSUPERUSER / BYPASSRLS boundary)

- **gaahex_app:** the application role, NOSUPERUSER NOBYPASSRLS. Every production query runs as this role. RLS engages.
- **gaahex:** the owner/admin role, has table ownership and BYPASSRLS. Used only by migrations and pre-auth code paths (e.g., login email lookup before tenant context).

The production deploy contract refuses to boot if both roles resolve to the same Postgres role. (See `app/config.py:_assert_production_deploy_contract`.)

### L3 — Tenant lifecycle states are independent of deletion

A tenant's ability to be **deleted** is independent of its **lifecycle state**. A tenant in any state (CREATING, PROVISIONING, ACTIVE, SUSPENDED, ARCHIVED) can transition to PURGED via an explicit, audited deletion request (compliance / right-to-be-forgotten). The deletion is not automatic on state change; it is an explicit operation.

### L4 — Tenant ≠ Organization; Organization ≠ Identity

Three orthogonal axes:
- **Tenant:** SaaS isolation boundary (who sees what data). Defined by RLS at the database layer.
- **Organization:** Business structure inside the tenant (who reports to whom, who can create tasks). Defined by RBAC at the application layer (Tenant Core does not own Organization; see Organization Core).
- **Identity:** The actor (User, service account, SSO principal). Authentication layer. (See Identity Core.)

A user is authenticated (has an Identity) within a Tenant scope, assigned to Organizations within that Tenant.

### L5 — Tenant configuration is centralized and immutable once referenced

Tenant-level configuration (TenantSetting, ModuleSetting) is the **only** method for tenant-specific variance. No custom fields, metadata blobs, or convention-based settings. Once a configuration key is published (referenced by running code), the key name is immutable; new keys replace deprecated ones, never rename.

---

## 7. Core Concepts

### 7.1 Tenant as SaaS isolation boundary

A **Tenant** is the top-level SaaS isolation boundary. One tenant = one customer, one org, one isolated data scope. Every tenant-scoped business row carries `tenantId` and is fenced by RLS at the database layer. Tenants are independent; cross-tenant data access is forbidden for normal users.

### 7.2 Tenant lifecycle: six states plus soft-deletion discipline

| State | Meaning | Allowed transitions |
|---|---|---|
| **CREATING** | Tenant is being provisioned (schema prep, initial config seeding). | → PROVISIONING |
| **PROVISIONING** | Tenant setup in progress (user invites, org structure, initial data load). | → ACTIVE |
| **ACTIVE** | Tenant is live and operational. | → SUSPENDED, ARCHIVED |
| **SUSPENDED** | Tenant access is blocked (non-payment, compliance hold, operator action). Data is intact. | → ACTIVE |
| **ARCHIVED** | Tenant is no longer operational but data is preserved for compliance. | (no further transitions; data is read-only in some views) |
| **PURGED** | Tenant and all its data (except append-only audit) have been deleted per GDPR request. | (terminal) |

Every lifecycle transition emits an event (Tenant.Created, Tenant.Provisioning, Tenant.Activated, Tenant.Suspended, Tenant.Archived, Tenant.Purged), audit-logged with actor, timestamp, previous state, new state.

### 7.3 Tenant identifiers: three paths to a single tenant

| Method | Use case | Format |
|---|---|---|
| **Subdomain** | Default public URL. | `{subdomain}.gaahex.com` (must be unique across platform). |
| **Custom domain** | Tenant's own CNAME. | `{customDomain}` (optional, must be unique). |
| **API key tenant scope** | Service account / integration. | API key carries `tenant_id` in its JWT payload. |

Once a user authenticates, their JWT carries the `tenant` claim (their tenant id). The backend validates this against `User.tenant_id` and sets the RLS GUC for every request. Tenant id is **never** accepted from URL path, query params, or headers — it is derived from the authenticated session.

### 7.4 Tenant hierarchy: parent/child for resellers and managed accounts

A tenant can have a `parentTenantId`, making it a **child tenant** (reseller) of the parent. This enables white-label patterns:
- **Branding:** Child inherits parent's TenantBrandingLink unless child has its own override.
- **Navigation:** Child inherits parent's ModuleSetting navigation overrides unless overridden.
- **Permissions:** Child has its own Role/Permission grants. There is no automatic permission inheritance (RBAC is tenant-scoped, not hierarchy-scoped).
- **Data scope:** Child's data is **isolated** from parent's data (RLS enforces). Parent cannot see child's rows unless an explicit Super Admin cross-tenant operation reads them (registered in RLS_EXEMPTION_REGISTRY).

### 7.5 White-label is configuration-driven: branding, theme, navigation, communications

**Permitted customizations (from TenantBrandingLink and ModuleSetting):**
- **Branding:** Logo (pointer to asset; Logo geometry / spacing immutable per Brand v3.0 LOCKED), Colors (only D18 Color Architecture overrides; no new color families), Domain (custom CNAME or tenant subdomain), Sender email / name (for notifications).
- **Theme:** Light / dark / print palette selection from `gaahex-tokens.css`. No new theme design, no new token families.
- **Navigation (via ModuleSetting):** Hide/show sections (e.g., hide "Marketplace" if not enabled), Reorder nav items, Field visibility toggles (which fields appear in forms, which in tables), Workflow status display names (translated labels only, never canonical values).
- **Communications:** Notification preferences (which events send email, SMS, in-app), Escalation chains (which users get notified), Approved notification content customizations (tenant can provide email template overrides, within Brand v3.0 constraints).

**Forbidden customizations:**
- **Tenant-specific code branches.** No `if tenant.id == X` in application code.
- **Schema forks.** No `ALTER TABLE foo ADD COLUMN bar` for tenant Y only.
- **Custom enum/status meanings.** `ACTIVE` means the same for every tenant.
- **Hidden workflows.** All statuses and transitions are defined in the same WorkflowDef, visible to all tenants.
- **Validation bypass.** Permissions and data validation apply uniformly.
- **Logo redesign.** Logo geometry is LOCKED per Brand v3.0 (2026-06-06 canonical package).

### 7.6 Tenant configuration: TenantSetting and ModuleSetting

**TenantSetting (Tenant-level configuration):**

Fields: id (UUIDv7), tenantId (FK → Tenant.id), configurationKey, configurationValue, status (ACTIVE, INACTIVE, DEPRECATED), createdBy, createdAt, updatedBy, updatedAt.

Approved keys: `display_language`, `timezone_default`, `notification_email_enabled`, `feature_flag_X` (scoped to tenant), `archive_retention_days`.

Forbidden keys: Anything that redefines ACTIVE, SUSPENDED, or other canonical statuses. Anything that changes validation rules. Anything that creates a hidden workflow fork.

**ModuleSetting (Module-level configuration per tenant):**

Fields: id (UUIDv7), tenantId (FK → Tenant.id), moduleKey (e.g., "admin", "portal", "noc"), settingKey, settingValue, createdAt, updatedAt.

Examples: `admin.sidebar.visible_sections` = `["customers", "services", "billing"]` (hide "Marketplace"), `portal.field_visibility.service` = `["id", "name", "status", "billingCycle"]` (what fields customers see), `noc.workflow_labels.ticket_status_OPEN` = custom translated label (canonical value stays `OPEN`).

---

## 8. Canonical Entities

| Entity | Owner | Purpose | Status |
|---|---|---|---|
| **Tenant** | Tenant Core | The top-level SaaS isolation boundary. One tenant = one customer, one org, one isolated data scope. | STRONG |
| **TenantProfile** | Tenant Core | Tenant metadata (display name, industry, region, contact email, language, timezone). | STRONG |
| **TenantHierarchy** | Tenant Core | Parent/child relationships for white-label resellers (child tenant inherits parent's branding, permissions if not overridden). | STRONG |
| **TenantBrandingLink** | Tenant Core | Tenant's branding overrides (logo, domain, color scheme, sender email). Derives from Brand v3.0 LOCKED package. | STRONG |
| **TenantSetting** | Configuration Core | Tenant-level config key/value pairs (feature flags scoped to this tenant, display prefs, notification settings). | STRONG |
| **ModuleSetting** | Configuration Core | Module-level config scoped to a tenant (what sections appear in navigation, field visibility, workflow overrides). | STRONG |

### 8.1 Tenant table schema (camelCase — D2)

```
id (UUIDv7)
referenceNumber (TEN-…) — S5 prefix
name
subdomain (used in URL; must be unique)
customDomain (optional; customer's own domain)
status (ENUM: CREATING, PROVISIONING, ACTIVE, SUSPENDED, ARCHIVED, PURGED)
tenantProfileId (FK → TenantProfile.id)
parentTenantId (FK → Tenant.id, nullable for root tenants)
createdBy (userId)
createdAt
updatedBy (userId)
updatedAt
archivedAt (soft-archive timestamp, not a deletion)
purgedAt (hard-purge timestamp; audit trail stays)
region (deployment region)
indexName (elasticsearch tenant index, if applicable)
```

### 8.2 TenantProfile schema

```
id (UUIDv7)
tenantId (FK → Tenant.id)
displayName
industry
region
contactEmail
language
timezone
logoUrl (pointer to stored asset, not the asset itself)
createdAt, updatedAt
```

### 8.3 TenantBrandingLink schema

```
id (UUIDv7)
tenantId (FK → Tenant.id)
brandingTheme (reference to Brand v3.0 theme — see docs/branding/v3.0/)
customDomain
customLogoAssetId (FK → attachment or storage)
colorOverrides (JSON object with D18 Color Architecture tokens)
senderEmail (for notifications)
senderName
createdAt, updatedAt
```

---

## 9. Ownership Boundaries

Tenant Core owns Tenant, TenantProfile, TenantHierarchy, and TenantBrandingLink entities. Configuration Core owns TenantSetting and ModuleSetting. All business-scoped entities in other cores carry `tenantId` as a foreign-key reference to Tenant but do not transfer ownership. (See `09_DATA_ARCHITECTURE.md` for the full canonical-entity matrix.)

---

## 10. Relationships

### 10.1 Tenant Core dependencies

- **Identity Core:** Tenant users are authenticated identities; JWT tenant claim validated against User.tenant_id.
- **Security Core:** RLS enforcement, role split, deploy contract.
- **Audit Core:** Every tenant lifecycle transition emits an audit event.
- **Configuration Core:** TenantSetting, ModuleSetting, feature flags scoped to tenant.
- **Compliance Core:** Data purge (GDPR), retention policies, consent management.

### 10.2 Cores that depend on Tenant Core

- **All business-scoped cores** (Party, Organization, Location, Resource, Product, Service, Contract, Work, Knowledge, Financial, Case, Workflow, Automation, Approval, SLA, Scheduling, Communication, Notification, Document, etc.). Every business row carries `tenantId`.
- **All platform-service cores** (Data, Metadata, Relationship, Search, Event, Integration, Developer Platform, Background Processing, Import/Export, Template, Storage). Multi-tenant awareness is universal.
- **All intelligence cores** (Analytics, Reporting, AI, Forecasting, Decision Support). Query results are tenant-scoped.
- **All experience cores** (Workspace, Portal, Mobile, Marketplace, Localization). UI is tenant-scoped.

Tier discipline (L2 — no reverse dependencies): Tenant Core is in the FOUNDATION tier. No core above FOUNDATION may define what Tenant means or how it behaves. Higher tiers **consume** tenant context; they do not **create** or **redefine** it.

---

## 11. Responsibilities

### 11.1 Tenant Core owner (Platform Engineering / Ընգեր on behalf)

- Maintains Tenant Core documentation (this document, PRM entry).
- Owns the Tenant entity schema and lifecycle machinery.
- Ensures every tenant-scoped table has the `tenant_isolation` RLS policy installed and enforced in CI.
- Maintains the static analyzer (`backend/scripts/check_tenant_filter.py`) and runtime audit listener (`backend/app/tenant_query_audit.py`).
- Maintains the RLS_EXEMPTION_REGISTRY and approves new exemptions per `RLS_EXEMPTION_POLICY.md`.
- Ensures the production deploy contract (`app/config.py:_assert_production_deploy_contract`) is enforced on boot.

### 11.2 Supporting cores (all business-scoped cores)

- Add `tenantId` to every entity schema.
- Install the `tenant_isolation` RLS policy on every tenant-scoped table.
- Ensure all queries include explicit `WHERE tenant_id = ...` filters; static analyzer catches violations at CI.
- Never accept `tenantId` from untrusted input; server-assign from JWT.

### 11.3 PR reviewer on Tenant Core changes

- Confirms every tenant-scoped table addition has the RLS policy.
- Confirms no code branches on `tenant.id` are introduced.
- Confirms configuration-driven variance is used instead of code forks.
- Confirms white-label customizations derive from Brand v3.0 LOCKED package.

---

## 12. Allowed Patterns

### AP1 — Tenant-scoped references from any business core

A Service Core entity may carry `tenantId` (to Tenant). A Case Core entity may carry `tenantId` and reference ServiceInstance via `serviceInstanceId`. Cross-core references use canonical IDs; tenant-scoped isolation is enforced via RLS on each table independently.

### AP2 — Tenant inheritance in the hierarchy

A child tenant inherits branding and navigation from its parent unless overridden. This is implemented via conditional reads in the ModuleSetting and TenantBrandingLink layers, never by data duplication or code branches.

### AP3 — Feature flags scoped to tenants

A TenantSetting with key `feature_flag_X` gates a feature for that tenant only. The code checks the tenant's feature-flag value at runtime; no code branches on tenant id, only on the flag value itself.

### AP4 — White-label customizations within Brand v3.0 constraints

A tenant's TenantBrandingLink may override colors (D18 Color Architecture tokens only), domain (custom CNAME), sender email, or navigation visibility (ModuleSetting). The branding asset is derived from Brand v3.0 LOCKED package; geometry, spacing, and token families are never customized per tenant.

### AP5 — Super Admin cross-tenant operations with explicit permission gates

A platform Super Admin holding `platform.metrics.read` permission may query another tenant's data via an explicit API endpoint. The query is RLS-exempt (registered), audited, and immutable.

---

## 13. Forbidden Patterns

### FP1 — Accepting tenantId from untrusted input

No URL path `/tenants/{tenantId}` path parameters, no query `?tenantId=...`, no frontend local storage, no import file fields. Tenant context flows from authenticated JWT only.

### FP2 — Tenant-specific code branches

No `if tenant.id == "abc-def"` in production code. No tenant-specific validation logic, no hidden enum values, no conditional API responses based on tenant. All logic is tenant-generic; variance is configuration-driven.

### FP3 — Schema forks for tenant customization

No `ALTER TABLE foo ADD COLUMN bar` that applies to one tenant only. No tenant-specific indexes, partitions, or table extensions. Single schema for all tenants.

### FP4 — RLS policy bypass outside the registry

RLS exemption is granted **only** to operations explicitly registered in RLS_EXEMPTION_REGISTRY. No ad-hoc `SET ROLE gaahex` in migrations, no middleware that resets `gaahex.tenant_id`, no "trust the caller" patterns.

### FP5 — Cross-tenant data leakage via reporting / analytics / search

A user from Tenant A querying for "all invoices" must not see counts, aggregates, or filtered results from Tenant B. Search indexes, analytics datasets, and reporting queries are tenant-scoped at query time via RLS, not via application-layer filtering.

### FP6 — Tenant hierarchy with automatic permission inheritance

Parent and child tenants have separate permission grants. A user in the parent does **not** automatically have permissions in the child; the parent's data is not visible to the child. Hierarchy is only for branding and navigation inheritance.

### FP7 — Configuration keys that redefine canonical statuses

No TenantSetting with key `status_ACTIVE_label` that redefines what ACTIVE means. Display labels are ModuleSetting translations, never overrides of canonical enum meanings.

### FP8 — Tenant-scoped custom fields in place of configuration

No `tenant.customMetadata` JSON blob for "flexible" tenant variance. All tenant-specific variance is declared in TenantSetting or ModuleSetting with immutable key names and governed status values.

---

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Authoritative definition of Tenant Core, separation rules (L3), and tenant/org/identity distinctions. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership laws (L1), tier discipline (L2), audit universality (L4), tenant universality (L5). |
| `03_INFORMATION_ARCHITECTURE.md` | Entity schemas and canonical entities owned by each core. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys for cross-tenant operations (`platform.*` vs. `tenant.super_admin`). |
| `09_DATA_ARCHITECTURE.md` | RLS enforcement, foreign-key constraints, tenant-scoped references. |
| `11_EVENT_ARCHITECTURE.md` | Tenant lifecycle events and event ownership. |
| `13_SECURITY_ARCHITECTURE.md` | RLS policy syntax, role split, deploy contract, NOSUPERUSER / NOBYPASSRLS boundary. |
| `docs/branding/v3.0/` | Brand v3.0 LOCKED package (D18 Color Architecture, token families, logo constraints). |

| Documents that depend on this one |
|---|
| Every core document (all 50 other cores reference Tenant Core for tenant-scoped isolation). |
| `15_REPORTING_ARCHITECTURE.md` (tenant-scoped report definitions and results). |
| `16_ANALYTICS_ARCHITECTURE.md` (tenant-scoped analytics datasets and aggregations). |
| `21_AI_ARCHITECTURE.md` (tenant-scoped AI models and knowledge sources). |

---

## 15. Implementation Requirements

### 15.1 RLS enforcement machinery

Every tenant-scoped table:
1. Has the `tenant_isolation` policy installed at migration time.
2. Is checked by the static analyzer (`backend/scripts/check_tenant_filter.py`) at CI; any query without explicit `tenant_id` filter is flagged.
3. Is audited at runtime by `backend/app/tenant_query_audit.py`; violations emit warnings.

Failure to add the RLS policy to a new tenant-scoped table is a blocker for PR merge.

### 15.2 Role split enforcement

The production deploy contract (in `app/config.py:_assert_production_deploy_contract`) enforces:
- `DATABASE_URL` ≠ `OWNER_DATABASE_URL` (different Postgres users).
- App role ≠ owner role (NOSUPERUSER NOBYPASSRLS vs BYPASSRLS).
- If checks fail, the backend refuses to start.

### 15.3 Tenant context propagation

Every request:
1. Authenticates via JWT (Identity Core).
2. Extracts `tenant` claim from JWT.
3. Validates `tenant` claim against `User.tenant_id` server-side.
4. Sets `gaahex.tenant_id` GUC before executing queries.
5. Fails with 403 Forbidden if tenant context is missing or mismatched.

No default tenant, no fallback, no "skip RLS" mode.

### 15.4 Tenant-scoped configuration

TenantSetting and ModuleSetting are the **only** method for tenant-specific variance:
- Keys are immutable once published (referenced by running code).
- Replaced with new keys, never renamed.
- Status values (ACTIVE, INACTIVE, DEPRECATED) control lifecycle.
- No custom-field metadata blobs.

### 15.5 RLS exemption registry

Every cross-tenant query is registered in `docs/standards/RLS_EXEMPTION_REGISTRY.md`:
- Exact query or call site.
- Justification (why tenant-scoped equivalent is impossible).
- Regression test proving the exemption is still needed.
- Migration path to retire the exemption.
- Owner and expiration shape (structural / date-bound / trigger-bound).

See `RLS_EXEMPTION_POLICY.md` for full approval process.

### 15.6 Tenant data export (compliance / portability)

**ExportJob schema (camelCase — D2):**

```
id (UUIDv7)
referenceNumber (EXP-…)
exportType (FULL, SELECTIVE)
tenantId (FK → Tenant.id)
requestedBy (userId)
requestedAt, startedAt, finishedAt
status (REQUESTED, RUNNING, COMPLETED, FAILED, CANCELLED, EXPIRED)
objectType (CUSTOMERS, INVOICES, TICKETS, etc.)
filtersApplied (JSON of active search/report filters)
rowCount
fileAttachmentId (FK → attachment)
correlationId, eventId
```

**Export constraints:**
- Tenant scope: export is always tenant-scoped; user must have export permission on that object type.
- Filters preserved: export respects the same active filters (status, date range, custom filters) that generated the view.
- Permission-filtered: a user may not export records they cannot read; aggregate leakage is forbidden (no counts of hidden rows).
- Sensitive data: PII / payment tokens are masked or excluded unless the user has unrestricted access.
- Canonical values: export uses canonical enum values (ACTIVE, not translated labels).
- File retention: export files have controlled retention and expire; never permanently public.

**Export events:** Export.Requested, Export.Completed, Export.Failed.

### 15.7 Tenant data purge (GDPR right-to-be-forgotten)

**Purge request:**

```
DELETE /api/v1/tenants/{tenantId}
Body: { reason: "GDPR_REQUEST", consent: true, confirmDeleteAllData: true }
```

**Purge process:**
1. **Soft-delete:** tenant.status transitions to PURGED; tenant.purgedAt is set to now.
2. **Data deletion:** all rows (except audit) with `tenant_id = <purgedTenantId>` are deleted (cascade where defined, explicit deletes otherwise).
3. **Audit trail remains:** the `event` and `audit_log` tables retain all records (FK to tenant.id is **not** ON DELETE CASCADE per SPEC §0.4).
4. **Read-only:** the purged tenant becomes read-only; any attempt to write raises an error.
5. **Compliance audit:** purge operation itself is an auditable, immutable event (`Tenant.Purged`).

**Right-to-be-forgotten exceptions:** Compliance Core may **exempt** certain data from purge if law requires retention (e.g., tax records, SLA evidence). These exemptions are **explicit** and **time-bounded** (with a retention deadline per Compliance Core). Audit trail always stays.

---

## 16. Future Expansion Rules

### 16.1 Tenant Core scope changes

Tenant Core's responsibility is **tenant isolation and lifecycle** only. Features like entitlements (which features a tenant can use) belong to Entitlement Core. Organization structures belong to Organization Core. Identity lifecycle belongs to Identity Core.

If a feature touching "tenants" seems to belong in Tenant Core but is really about subscriptions, features, or business structure, it belongs in another core. Propose the re-assignment; do not expand Tenant Core.

### 16.2 Adding a new tenant-scoped entity

Any new entity that should be isolated per tenant:
1. Add `tenantId (FK → Tenant.id)` to its schema.
2. Install the `tenant_isolation` RLS policy.
3. Ensure every query has explicit `tenant_id` filter.
4. Declare the entity in the owning core's documentation.

### 16.3 Tenant hierarchy extensions

The parent/child relationship is reserved for **reseller / managed account patterns**. Do not extend it for:
- Permission inheritance (use RBAC instead).
- Data visibility (use RLS instead).
- Pricing / subscriptions (use Entitlement Core instead).

---

*End of 14 — Tenant Architecture.*
