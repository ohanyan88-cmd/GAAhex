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

## 4. Tenant Core Definition (from PRM)

| Aspect | Statement |
|---|---|
| **Purpose** | Provides multi-tenant isolation, tenant lifecycle, white-label boundaries, and tenant-scoped defaults. |
| **Owns** | Tenants, tenant profiles, tenant status, tenant hierarchy, tenant branding links, tenant data boundaries. |
| **Does not own** | Identity credentials, subscriptions, application feature logic, domain-specific ownership. |
| **Governed by** | Tenant / White-label, Security, Data, Experience HOW viewpoints. |
| **Hard boundary rule** | All business data must be tenant-scoped unless explicitly global reference data. |

---

## 5. Tenant Entity Model

### 5.1 Canonical entities

| Entity | Owner | Purpose |
|---|---|---|
| **Tenant** | Tenant Core | The top-level SaaS isolation boundary. One tenant = one customer, one org, one isolated data scope. |
| **TenantProfile** | Tenant Core | Tenant metadata (display name, industry, region, contact email, language, timezone). |
| **TenantHierarchy** | Tenant Core | Parent/child relationships for white-label resellers (child tenant inherits parent's branding, permissions if not overridden). |
| **TenantBrandingLink** | Tenant Core | Tenant's branding overrides (logo, domain, color scheme, sender email). Derives from Brand v3.0 LOCKED package. |
| **TenantSetting** | Configuration Core | Tenant-level config key/value pairs (feature flags scoped to this tenant, display prefs, notification settings). |
| **ModuleSetting** | Configuration Core | Module-level config scoped to a tenant (what sections appear in navigation, field visibility, workflow overrides). |

### 5.2 Tenant entity schema (summary)

**Tenant table fields (camelCase — D2):**

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

**TenantProfile fields:**

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

**TenantBrandingLink fields:**

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

## 6. Multi-Tenant Isolation — The Core Principle

### 6.1 Single database, no schema forks

GAAhex uses a **single shared Postgres database** for all tenants. There is no database-per-tenant, no schema-per-tenant, and no tenant-specific schema migrations.

The isolation boundary is **row-level**: every tenant-scoped business row carries a `tenantId` column and is governed by Postgres RLS policy `tenant_isolation`.

### 6.2 The RLS policy: tenant_isolation

Every tenant-scoped table has this policy (installed by migration, enforced at the DB layer):

```sql
CREATE POLICY tenant_isolation ON <table>
  FOR ALL
  USING (tenant_id = current_setting('gaahex.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('gaahex.tenant_id')::uuid);
```

The `gaahex.tenant_id` GUC (Global User Config) is set **per request** by the backend, validated from the JWT `tenant` claim and cross-checked against `User.tenant_id` server-side.

### 6.3 Role split: gaahex_app vs gaahex

- **gaahex_app:** the application role, NOSUPERUSER NOBYPASSRLS. Every production query runs as this role. RLS engages.
- **gaahex:** the owner/admin role, has table ownership and BYPASSRLS. Used only by migrations and pre-auth code paths (e.g., login email lookup before tenant context).

The production deploy contract refuses to boot if both roles resolve to the same Postgres role. (See `app/config.py:_assert_production_deploy_contract`.)

### 6.4 Tenant provenance: who can set tenantId?

- **Trusted server context:** tenantId is **server-assigned** from the JWT `tenant` claim, validated against `User.tenant_id`.
- **Frontend input:** tenantId is **never** accepted from frontend, query params, import files, integration payloads, local storage, or browser state.
- **RLS + audit listener:** The static analyzer (`backend/scripts/check_tenant_filter.py`) flags any SQLAlchemy query on a tenant-scoped table that lacks an explicit `WHERE tenant_id = ...` filter. Runtime audit listener (`backend/app/tenant_query_audit.py`) warns on detected violations.

---

## 7. Tenant Lifecycle

### 7.1 States (per Standard D14 — deletion state independent)

| State | Meaning | Allowed transitions |
|---|---|---|
| **CREATING** | Tenant is being provisioned (schema prep, initial config seeding). | → PROVISIONING |
| **PROVISIONING** | Tenant setup in progress (user invites, org structure, initial data load). | → ACTIVE |
| **ACTIVE** | Tenant is live and operational. | → SUSPENDED, ARCHIVED |
| **SUSPENDED** | Tenant access is blocked (non-payment, compliance hold, operator action). Data is intact. | → ACTIVE |
| **ARCHIVED** | Tenant is no longer operational but data is preserved for compliance. | (no further transitions; data is read-only in some views) |
| **PURGED** | Tenant and all its data (except append-only audit) have been deleted per GDPR request. | (terminal) |

### 7.2 Deletion state independent (D14)

A tenant's ability to be **deleted** is independent of its **lifecycle state**. A tenant in any state can transition to PURGED via an explicit, audited deletion request (compliance / right-to-be-forgotten). The deletion is not automatic on state change; it is an explicit operation.

### 7.3 Audit and events

Every lifecycle transition emits an event:

- `Tenant.Created` (CREATING)
- `Tenant.Provisioning` (PROVISIONING)
- `Tenant.Activated` (ACTIVE)
- `Tenant.Suspended` (SUSPENDED)
- `Tenant.Archived` (ARCHIVED)
- `Tenant.Purged` (PURGED)

Each event is audit-logged and includes: event type, tenant id, actor user id, timestamp, previous state, new state.

---

## 8. Tenant Hierarchy — White-Label Resellers

### 8.1 Parent/child relationships

A tenant can have a `parentTenantId`, making it a **child tenant** (reseller) of the parent. This enables white-label patterns: a parent tenant (the ISP) can have child tenants (regional resellers or managed accounts) that inherit the parent's branding unless overridden.

### 8.2 Inheritance rules

- **Branding:** Child inherits parent's TenantBrandingLink unless child has its own override.
- **Permissions:** Child has its own Role/Permission grants. There is no automatic permission inheritance (RBAC is tenant-scoped, not hierarchy-scoped).
- **Navigation:** Child inherits parent's ModuleSetting navigation overrides unless overridden.
- **Data scope:** Child's data is **isolated** from parent's data (RLS enforces). Parent cannot see child's rows unless an explicit Super Admin cross-tenant operation reads them (registered in RLS_EXEMPTION_REGISTRY).

### 8.3 Flatten on export

When a child tenant's data is exported or a parent queries a child's data, the export/query respects the child's RLS isolation. There is no "view as parent" mode that bypasses the child's data fence.

---

## 9. White-Label Support (Configuration-Driven)

White-label is entirely **configuration-driven** — never code-driven or schema-driven.

### 9.1 Permitted white-label customizations

**Branding (from TenantBrandingLink):**
- Logo (pointer to asset; Logo geometry / spacing immutable per Brand v3.0 LOCKED).
- Colors (only D18 Color Architecture overrides; no new color families).
- Domain (custom CNAME or tenant subdomain).
- Sender email / name (for notifications).

**Theme:**
- Light / dark / print palette selection from `gaahex-tokens.css`.
- No new theme design, no new token families.

**Navigation (via ModuleSetting):**
- Hide/show sections (e.g., hide "Marketplace" if not enabled).
- Reorder nav items.
- Field visibility toggles (which fields appear in forms, which in tables).
- Workflow status display names (translated labels only, never canonical values).

**Communications:**
- Notification preferences (which events send email, SMS, in-app).
- Escalation chains (which users get notified).
- Approved notification content customizations (tenant can provide email template overrides, within Brand v3.0 constraints).

### 9.2 Forbidden white-label customizations

- **Tenant-specific code branches.** No `if tenant.id == X` in application code.
- **Schema forks.** No `ALTER TABLE foo ADD COLUMN bar` for tenant Y only.
- **Custom enum/status meanings.** `ACTIVE` means the same for every tenant.
- **Hidden workflows.** All statuses and transitions are defined in the same WorkflowDef, visible to all tenants.
- **Validation bypass.** Permissions and data validation apply uniformly.
- **Logo redesign.** Logo geometry is LOCKED per Brand v3.0 (2026-06-06 canonical package).

---

## 10. Tenant Identifiers

### 10.1 Three identification paths

| Method | Use case | Format |
|---|---|---|
| **Subdomain** | Default public URL. | `{subdomain}.gaahex.com` (must be unique across platform). |
| **Custom domain** | Tenant's own CNAME. | `{customDomain}` (optional, must be unique). |
| **API key tenant scope** | Service account / integration. | API key carries `tenant_id` in its JWT payload. |

### 10.2 Session tenant binding

Once a user authenticates, their JWT carries the `tenant` claim (their tenant id). The backend validates this against `User.tenant_id` and sets the RLS GUC for every request. Tenant id is **never** accepted from URL path, query params, or headers — it is derived from the authenticated session.

---

## 11. Tenant Configuration — TenantSetting and ModuleSetting

### 11.1 TenantSetting (Tenant-level configuration)

Fields (camelCase — D2):

```
id (UUIDv7)
tenantId (FK → Tenant.id)
configurationKey
configurationValue
status (ACTIVE, INACTIVE, DEPRECATED)
createdBy, createdAt, updatedBy, updatedAt
```

**Approved TenantSetting keys:**
- `display_language` (locale override)
- `timezone_default` (for all users in tenant unless overridden per-user)
- `notification_email_enabled` (true/false)
- `feature_flag_X` (scoped to tenant; see Feature Flag Standard)
- `archive_retention_days` (how long to keep archived records)

**Forbidden TenantSetting keys:**
- Anything that redefines `ACTIVE`, `SUSPENDED`, or other canonical statuses.
- Anything that changes validation rules.
- Anything that creates a hidden workflow fork.

### 11.2 ModuleSetting (Module-level configuration per tenant)

Fields:

```
id (UUIDv7)
tenantId (FK → Tenant.id)
moduleKey (e.g., "admin", "portal", "noc")
settingKey
settingValue
createdAt, updatedAt
```

**Examples:**
- `admin.sidebar.visible_sections` = `["customers", "services", "billing"]` (hide "Marketplace")
- `portal.field_visibility.service` = `["id", "name", "status", "billingCycle"]` (what fields customers see on their services)
- `noc.workflow_labels.ticket_status_OPEN` = custom translated label for display (canonical value stays `OPEN`)

---

## 12. Cross-Tenant Operations (Super Admin Only)

### 12.1 Policy: explicit, audited, time-limited, RLS-registered

Normal users are **completely isolated** by RLS. Cross-tenant access is **only** available to platform Super Admins via explicit operations:

- **Querying another tenant's data** (platform metrics, health checks, compliance audits).
- **Migrating data** between tenants (rare; requires consent + audit trail).
- **Bulk updates** across tenants (e.g., version a platform-wide feature).

### 12.2 Permission gates

Cross-tenant operations require `platform.*` permissions (e.g., `platform.metrics.read`, `platform.tenant.migrate`), granted only to platform operators, never to any tenant's super_admin.

### 12.3 RLS exemption registry

Every cross-tenant query is **registered** in `docs/standards/RLS_EXEMPTION_REGISTRY.md`. The exemption includes:

- The exact query or call site.
- Justification (why tenant-scoped equivalent is impossible).
- Regression test proving the exemption is still needed.
- Migration path to retire the exemption.
- Owner and expiration shape (structural / date-bound / trigger-bound).

See `RLS_EXEMPTION_POLICY.md` for full approval process and criteria.

### 12.4 Audit trail

Every cross-tenant operation emits an event:
- `SuperAdmin.CrossTenantRead`
- `SuperAdmin.CrossTenantWrite`
- `SuperAdmin.TenantMigration`

These events are immutable (append-only at DB layer) and include actor, timestamp, scope, and result summary.

---

## 13. Tenant Data Export (Compliance / Portability)

### 13.1 Export job (per Standard 08 — Import/Export Standard)

Fields (camelCase — D2):

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

### 13.2 Export constraints

- **Tenant scope:** export is always tenant-scoped; user must have export permission on that object type.
- **Filters preserved:** export respects the same active filters (status, date range, custom filters) that generated the view.
- **Permission-filtered:** a user may not export records they cannot read; aggregate leakage is forbidden (no counts of hidden rows).
- **Sensitive data:** PII / payment tokens are masked or excluded unless the user has unrestricted access.
- **Canonical values:** export uses canonical enum values (ACTIVE, not translated labels).
- **File retention:** export files have controlled retention and expire; never permanently public.

### 13.3 Export events

- `Export.Requested`
- `Export.Completed`
- `Export.Failed`

---

## 14. Tenant Data Purge (GDPR Right-to-Be-Forgotten)

### 14.1 Purge request

A tenant (or its Compliance Officer) requests purge via:

```
DELETE /api/v1/tenants/{tenantId}
Body: { reason: "GDPR_REQUEST", consent: true, confirmDeleteAllData: true }
```

### 14.2 Purge process

1. **Soft-delete:** tenant.status transitions to PURGED; tenant.purgedAt is set to now.
2. **Data deletion:** all rows (except audit) with `tenant_id = <purgedTenantId>` are deleted (cascade where defined, explicit deletes otherwise).
3. **Audit trail remains:** the `event` and `audit_log` tables retain all records (FK to tenant.id is **not** ON DELETE CASCADE per SPEC §0.4).
4. **Read-only:** the purged tenant becomes read-only; any attempt to write raises an error.
5. **Compliance audit:** purge operation itself is an auditable, immutable event (`Tenant.Purged`).

### 14.3 Right-to-be-forgotten exceptions

Compliance Core may **exempt** certain data from purge if law requires retention (e.g., tax records, SLA evidence). These exemptions are **explicit** and **time-bounded** (with a retention deadline per Compliance Core). Audit trail always stays.

---

## 15. Tenant ≠ Organization (PRM Separation Rule)

**Tenant** and **Organization** are distinct concepts:

| Aspect | Tenant | Organization |
|---|---|---|
| **What it is** | SaaS isolation boundary. | Business structure inside the tenant. |
| **Scope** | Platform-level. | Customer-level. |
| **Multiple per...** | Multiple tenants per platform. | Multiple orgs per tenant. |
| **Data fence** | RLS policy `tenant_isolation` at DB. | RBAC permission checks at app layer. |
| **Ownership** | Platform owner. | Tenant admin. |
| **Example** | Company A (one tenant), Company B (another tenant). | Within Company A: Sales Dept, Support Dept, Operations Dept. |

Organization is modeled in the Organization Core (BUSINESS OBJECTS tier), not Tenant Core. Tenant Core does not own Organization; it only defines the isolation boundary within which Organizations live.

---

## 16. Tenant ≠ Identity (PRM Separation Rule)

**Identity** and **Tenant** are orthogonal:

- **Identity** is the actor (User, service account, API client, SSO identity). The question is: *who is authenticating?*
- **Tenant** is the scope (which data is accessible). The question is: *which data does this actor have access to?*

A User is authenticated (has an Identity) within a Tenant scope. A service account authenticates into one Tenant. An actor with cross-tenant capability carries a different set of permissions in each tenant.

---

## 17. Security, Compliance, and Enforcement

### 17.1 Tenant isolation is mandatory

Every access path respects tenant isolation:
- List/detail queries, create/update/delete.
- Search, filters, autocomplete, counts.
- Reports, dashboards, exports, imports.
- APIs, automations, integrations, notifications.
- Attachments, comments, timelines, audit logs.
- Background jobs.
- AI-readable views.

### 17.2 RLS + static analyzer + runtime audit

Three layers enforce isolation:

1. **RLS policy:** database-layer gate on every tenant-scoped table.
2. **Static analyzer** (`backend/scripts/check_tenant_filter.py`): CI job catches SQLAlchemy queries without explicit `tenant_id` filter.
3. **Runtime audit listener** (`backend/app/tenant_query_audit.py`): emits warnings on runtime violations.

### 17.3 Fail-closed tenant context

If a request arrives without valid tenant context (JWT missing `tenant` claim, claim doesn't match `User.tenant_id`), the request **fails with 403 Forbidden**. There is no default tenant, no fallback, no "skip RLS" mode.

### 17.4 Production deploy contract

The production deploy contract (§ I8 in SEALED-ARCHITECTURE-BASELINE-2026-06-05.md) enforces:

- `DATABASE_URL` ≠ `OWNER_DATABASE_URL` (different Postgres users)
- App role ≠ owner role (NOSUPERUSER NOBYPASSRLS vs BYPASSRLS)
- No wildcard CORS

If these checks fail, the backend **refuses to start**. This contract is in `app/config.py:_assert_production_deploy_contract`.

---

## 18. Tenant Architecture Dependencies and Relationships

### 18.1 What Tenant Core depends on

- **Identity Core:** tenant users are authenticated identities; JWT tenant claim validated against User.tenant_id.
- **Security Core:** RLS enforcement, role split, deploy contract.
- **Audit Core:** every tenant lifecycle transition emits an audit event.
- **Configuration Core:** TenantSetting, ModuleSetting, feature flags scoped to tenant.
- **Compliance Core:** data purge (GDPR), retention policies, consent management.

### 18.2 What depends on Tenant Core

- **All business-scoped cores** (Party, Organization, Location, Resource, Product, Service, Contract, Work, Knowledge, Financial, Case, Workflow, Automation, Approval, SLA, Scheduling, Communication, Notification, Document, etc.). Every business row carries `tenantId`.
- **All platform-service cores** (Data, Metadata, Relationship, Search, Event, Integration, Developer Platform, Background Processing, Import/Export, Template, Storage). Multi-tenant awareness is universal.
- **All intelligence cores** (Analytics, Reporting, AI, Forecasting, Decision Support). Query results are tenant-scoped.
- **All experience cores** (Workspace, Portal, Mobile, Marketplace, Localization). UI is tenant-scoped.

### 18.3 Tier discipline (L2 — no reverse dependencies)

Tenant Core is in the FOUNDATION tier. No core above FOUNDATION may define what Tenant means or how it behaves. Higher tiers **consume** tenant context; they do not **create** or **redefine** it.

---

*End of 14 — Tenant Architecture.*
