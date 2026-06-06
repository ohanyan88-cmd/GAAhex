# 20 — Marketplace Architecture

**Constitutional document.** Position in the hierarchy: directly under `PLATFORM_REFERENCE_MODEL.md`; the 20th of the 22 Architecture Constitution documents. Governs Marketplace Core (EXPERIENCE tier per PRM; status MISSING / RESERVED in M1).

**Status: RESERVED (MISSING in M1).** This is an architecture blueprint for Marketplace Core, locked now to prevent future implementation from routing around open-platform constraints. No implementation is expected in M0–M1. The architecture reserves the entire extensibility envelope: apps, extensions, plugins, permissions, entitlements, install lifecycle, app review, and sandbox isolation.

---

## 1. Purpose

Define the Marketplace Core architecture: how packaged applications (Apps), runtime contributions (Extensions), install lifecycle, app review, permissions delegation, entitlements, sandboxing, and discoverability form a governable, open-platform extensibility model. The thesis: **GAAhex must not become closed to third-party code.** This document reserves the architecture now, in M0, to prove that M2+ implementation will not require a rewrite.

## 2. Scope

In scope:
- App: a packaged unit published to Marketplace, installable by tenant admins.
- Extension: a runtime contribution (UI tab, automation action, integration connector, report template, AI tool) authored by an App.
- AppPermission: install-time permission review and tenant approval.
- AppEntitlement: quota, rate limit, feature flags linked to Entitlement Core plan.
- MarketplaceListing: discoverability, publisher profile, ratings, screenshots, version history.
- Install lifecycle: state machine from REQUESTED → REVIEWED → APPROVED → INSTALLED → ACTIVE → SUSPENDED → UNINSTALLED.
- App review: security, policy, branding compliance gates before publish.
- Sandbox / isolation: apps run under declared permissions, rate-limited API calls, auditable access.
- Cross-architecture dependencies: Permission, Entitlement, Tenant, Developer Platform, Security, Governance.

Out of scope (handled by other cores):
- Developer Platform: API keys, OAuth, SDK docs, sandbox environment (Marketplace Core *consumes* Developer Platform).
- Integration Core: built-in connectors (not installed via Marketplace; Marketplace may wrap them as Extensions).
- AI Core: AI assistant ownership; Marketplace may *provide* AI Tools as Extensions.
- Storage / Document: file hosting; Apps use platform Storage/Document Cores.
- Entitlement Core: plan definition, quota engine; Marketplace Core *references* entitlements.

## 3. Goals

- **G1** Apps are first-class, discoverable, installable, reviewable, revocable, and sandboxed.
- **G2** Extensions declare their type, required permissions, entitlements, and runtime behavior.
- **G3** Tenant admins approve app installs; end-users cannot bypass review.
- **G4** App review gates security, policy, branding compliance before publish.
- **G5** Apps run under declared permissions; permission scope creep requires re-review.
- **G6** Silent install is forbidden; every install is logged, auditable, and reversible.
- **G7** App and Integration and Extension are distinct concepts (see §7).
- **G8** Sandbox: APIs rate-limited, audit enabled, tenant-scoped, secrets not exposed.
- **G9** Cross-tenant app data is forbidden unless explicitly tenant-approved.
- **G10** Entitlements link Apps to plan features, quotas, and usage limits.

## 4. Non-Goals

- **NG1** This document does not define how individual extension types (UI, automation, AI) implement their runtime. (See `21_AI_ARCHITECTURE.md`, `07_WORKFLOW_PROCESS_ARCHITECTURE.md` for those details.)
- **NG2** This document does not design the Marketplace UI / portal. (See `06_UI_EXPERIENCE_ARCHITECTURE.md`.)
- **NG3** This document does not define the review workflow or staff organization. (See `17_GOVERNANCE_ARCHITECTURE.md`.)
- **NG4** This document does not govern built-in platform features. (Apps are third-party or partner code; built-in features are part of the Platform Core itself.)
- **NG5** This document does not manage feature flags or A/B testing (see `18_OBSERVABILITY_ARCHITECTURE.md`).

## 5. Architecture Principles

### P1 — Apps are not Integrations; Integrations are not Extensions.

**App:** A packaged, versioned, reviewable unit containing one or more Extensions, published to Marketplace, installed and managed by tenant admins. Example: "Zendesk Support Hub" — an app providing sync, tickets, and automation extensions.

**Integration:** A built-in connector (Stripe, Salesforce, AWS) that is part of the platform. Integrations are not installed via Marketplace; they are available to all tenants subject to Entitlement Core plan rules.

**Extension:** A runtime contribution (UI tab, automation action, integration *connector as an extension*, report template, AI tool) authored by an App. Example: within the "Zendesk Support Hub" app, a "Sync Tickets" automation extension.

This distinction prevents marketplace pollution: the platform is not "all integrations" bundled into apps; it is "marketplace apps" that may *use* or *wrap* integrations via Extensions.

### P2 — Install-time review, not silent escalation.

Every app install goes through Marketplace review → tenant approval → install. Admins cannot be bypassed; end-users cannot trigger installs. Backwards: if review finds a security issue, the install is rejected, not suspended post-hoc.

### P3 — Permissions are declared, not discovered.

Apps declare in their manifest: `permissions.requested = [case.read, case.update, automation.create]`. At install, tenant admins see the full list. If the app later requests new permissions, review and re-approval happen before the permission is granted.

### P4 — Entitlements are plan-linked, not silent.

Apps declare entitlements: `entitlements.required = { quota.apiCalls: 100k/month, feature.advancedReporting: true }`. If the tenant's plan does not include `feature.advancedReporting`, the app cannot be installed. No hidden upsells; no silent API fails because quota was exceeded.

### P5 — Sandbox: every API call is rate-limited, auditable, and tenant-scoped.

Apps run under a token that:
- Can only call APIs for the installing tenant (no cross-tenant data read).
- Is rate-limited per the app's declared quota.
- Is logged in Audit Core (every app API call produces an audit record).
- Cannot access secrets, encryption keys, or other tenant's data.

### P6 — Configuration, not code.

Apps declare their Extensions, Permissions, Entitlements, and Sandbox rules in a YAML manifest. The platform reads the manifest and enforces rules without custom code per app.

### P7 — Audit is the audit trail.

Every app action — install, update, permission change, suspension, uninstall, extension invocation, API call — produces an audit record. App review, approval, and enforcement decisions are audited as governance evidence.

### P8 — Apps must be reversible.

An uninstall removes all Extensions, revokes all permissions, and cleans up state (configuration, data, tokens) within the tenant's data boundary. (Data created *by* the app, e.g., synced tickets, is handled per integration semantics, typically via a data retention policy.)

## 6. Architecture Laws

### L1 — Sandbox enforcement is mandatory.

App code runs under OAuth token with limited scopes (approved permissions only), rate-limit middleware (quota per plan), timeout enforcement (long operations killed after N seconds), and no direct DB access; all data via public APIs.

### L2 — App permissions must be reviewable and approvable.

At install time, tenant admins see the full list of requested permissions and explicitly approve each. Permission scope creep requires re-review and re-approval before new permissions are granted.

### L3 — Tenant isolation is inviolable.

An app token is always scoped to a single tenant. API calls from app code can only access resources within that tenant (enforced via RLS policy `tenant_isolation`). Cross-tenant app data access is forbidden.

### L4 — Install requires explicit tenant approval.

Every app install goes through Marketplace review → tenant admin approval → platform activation. Silent installs are forbidden; every install is logged, auditable, and reversible.

### L5 — Secrets are never embedded in apps.

Apps do not ship API keys, encryption keys, or other secrets. External credentials are managed via Developer Platform's Secret Store. Any hardcoded secrets in code or manifest are grounds for rejection at review.

### L6 — Audit trail is mandatory for all app actions.

Every app API call, extension invocation, install state change, permission grant, suspension, and uninstall is logged in Audit Core and linked to the acting user and reason. Silent mutations are forbidden.

## 7. Core Concepts

### 7.1 App

A package containing:
- **Manifest** (app.yaml): name, version, publisher, description, Extensions, Permissions, Entitlements, icon, screenshots, terms of service, privacy policy.
- **Extensions**: list of runtime contributions (type, entry point, configuration).
- **Permissions**: list of platform permission keys requested (e.g., `case.read`, `work.create`).
- **Entitlements**: list of Entitlement Core features and quotas required (e.g., `quota.apiCalls: 100k`, `feature.advancedReporting: true`).
- **Code**: (if applicable) backend or webhook handlers for Extensions. Published as a versioned artifact (npm package, container image, or zip).
- **Security**: signed manifest, no embedded secrets, external secrets managed via Developer Platform.

### 7.2 Extension

A runtime contribution provided by an App. Types (not exhaustive):
- **UI Tab**: appears on an entity (Case, Service, Contact) detail page. Configuration: entity type, tab label, entry point URL, icon.
- **Automation Action**: invoked by Automation Core (trigger → condition → action). Configuration: category, action name, input parameters, output, webhook URL.
- **Integration Connector**: (optional) an Extension that wraps or extends Integration Core. Connects to a 3rd-party system. Example: "Zendesk Sync" extension connects to Zendesk API.
- **Report Template**: provides a report format for Reporting Core. Configuration: name, parameters, template language, output (PDF, Excel).
- **AI Tool**: a tool callable by AI Core (see `21_AI_ARCHITECTURE.md`). Configuration: name, description, input schema, output schema, rate limit, execution timeout.
- **Webhook Listener**: listens to platform events (Event Core) and performs actions (fire external webhook, transform, log).

### 7.3 Install Lifecycle

**State machine:**

```
REQUESTED
   ↓ (app review gates: security, policy, branding)
REVIEWED
   ↓ (tenant admin decision: approve/deny)
APPROVED
   ↓ (platform installs extensions, grants permissions, creates tokens)
INSTALLED
   ↓ (optionally: app initialization, webhook calls)
ACTIVE
   ├─ (admin: suspend app, e.g., due to abuse) → SUSPENDED
   ├─ (admin: uninstall) → UNINSTALLED
   └─ (app update: upgrade to new version) → INSTALLED (with new version)

REVIEWED
   ├─ (deny) → REJECTED
   ↓
REJECTED (app not installed; reason recorded)

SUSPENDED
   ├─ (admin: resume) → ACTIVE
   └─ (admin: uninstall) → UNINSTALLED

UNINSTALLED (final; app data subject to retention policy)
```

**Key invariants:**
- No silent transitions. Every state change is audited.
- REQUESTED → REJECTED is final for that install request; admin can request again.
- SUSPENDED → ACTIVE requires admin action; no auto-resume.
- UNINSTALLED is final; reinstall creates a new install record (not a revert).

### 7.4 App Review

Apps must pass review before publish. Review gates:

**Security:**
- No embedded secrets (API keys, tokens) in code or manifest.
- No hardcoded tenant data or credentials.
- Manifest signature valid and matches published code.
- No ability to escape sandbox (no exec, eval, or direct DB access).
- External API calls only via declared Extension entry points.

**Policy:**
- Privacy policy: what tenant data does the app access? How is it retained? Is it shared?
- Data retention: when the app is uninstalled, what happens to data? (Delete, archive, export.)
- Support SLA: does the publisher commit to response times?
- Terms of service: clear about liability, uptime, SLA gaps.

**Branding compliance:**
- Logo, screenshots do not impersonate platform or misrepresent functionality.
- Marketplace listing copy is clear and honest.
- No dark patterns (misleading buttons, hidden upsells).
- Localization: supported languages are declared.

### 7.5 Sandbox & API Rate Limiting

Apps execute within a sandbox:
- **Token isolation:** each app has one or more OAuth tokens scoped to the app and tenant.
- **Rate limits:** each app is rate-limited based on its declared quota (e.g., 1000 API calls/min for 100k/month plan).
- **Audit trail:** every API call is logged with app ID, tenant ID, resource, action, result.
- **Tenant boundary:** API calls can only reach resources within the installing tenant; cross-tenant access is forbidden.
- **Timeout:** long-running operations (Extensions, webhooks) have execution timeouts; runaway code is killed.
- **Logging:** all Extension invocations are logged with duration, error, result status.

## 8. Canonical Entities

Marketplace Core owns the following canonical entities:

- **App**: name, publisherId, currentVersion, status, createdAt, publishedAt, retiredAt.
- **AppVersion**: appId, semanticVersion, manifest (YAML), codeUrl, signatureHash, status, createdAt.
- **AppPublisher**: name, email, verifiedAt, suspendedAt, policies (e.g., data retention, support SLA).
- **Extension**: appVersionId, type, name, status, configuration (JSON), entryPointUrl, sandbox (true/false, if API calls required).
- **ExtensionInstance**: extensionId, tenantId, configuration (tenant-specific overrides), status (enabled, disabled, suspendedByReview).
- **ExtensionInvocation**: extensionInstanceId, invokedAt, invokedBy, duration, resultStatus, auditLogId.
- **AppPermission**: appVersionId, permissionKey, requestedAt, approvedAt, approvedBy, status (requested, approved, denied, revoked).
- **AppPermissionChange**: appVersionId, addedPermissions[], removedPermissions[], reviewedAt, reviewedBy, decision (approved, denied).
- **AppEntitlement**: appVersionId, entitlementKey (e.g., `quota.apiCalls`, `feature.advancedReporting`), minimumValue, status.
- **AppEntitlementGrant**: appInstallId, entitlementKey, grantedValue, remainingValue, resetAt (for quotas with reset windows).
- **AppInstall**: appId, tenantId, status (state machine per §7.3), requestedAt, requestedBy, reviewedAt, reviewedBy, installedAt, suspendedAt, uninstalledAt.
- **AppReview**: appVersionId, submittedAt, submittedBy, status (inReview, approved, rejected, appealed).
- **AppReviewGate**: appReviewId, gateType (security, policy, branding), gateStatus (passed, failed, review), comment, reviewedAt, reviewedBy.
- **AppReviewAppeal**: appReviewId, appealedAt, appealedBy, reason, decision.
- **MarketplaceListing**: appId, publisherName, title, description, longDescription, icon, bannerImage, category (category_enum), tags[], status (published, draft, archived, discontinued).
- **MarketplaceVersion**: appVersionId, listing summary, releaseNotes, compatibility (minPlatformVersion, maxPlatformVersion).
- **MarketplaceRating**: appId, ratedBy, tenantId, rating (1–5), comment, installedVersionId, ratedAt.
- **MarketplaceInstall**: appInstallId, tenantId, appId, installRequestedAt, installedAt, installs (counter), uninstalls (counter), activeUsers (counter).
- **AppToken**: appId, tenantId, tokenHash, createdAt, expiresAt, revokedAt, scopes (permission list).
- **AppApiCall**: appId, tenantId, timestamp, method, resourcePath, statusCode, durationMs, quotaUsed, auditLogId.
- **AppQuotaReset**: appInstallId, quotaKey, resetAt, currentUsage, limit.

## 9. Ownership Boundaries

### 9.1 Entities owned by Marketplace Core

- `App`, `AppVersion`, `AppPublisher`
- `Extension`, `ExtensionInstance`, `ExtensionInvocation`
- `AppPermission`, `AppPermissionChange`
- `AppEntitlement`, `AppEntitlementGrant`
- `AppInstall`
- `AppReview`, `AppReviewGate`, `AppReviewAppeal`
- `MarketplaceListing`, `MarketplaceVersion`, `MarketplaceRating`, `MarketplaceInstall`
- `AppToken`, `AppApiCall`, `AppQuotaReset`

### 9.2 Entities referenced but NOT owned

- `Permission` (from Permission Core; listed in `08_PERMISSION_ARCHITECTURE.md`).
- `Entitlement`, `Plan`, `Feature`, `Quota` (from Entitlement Core).
- `Tenant` (from Tenant Core).
- `User` (from Identity Core, for Publisher profile and install approver).
- `AuditLog` (from Audit Core; Marketplace logs to it, does not own it).

### 9.3 Cross-core references

- **AppPermission.permissionKey** → Permission Core's canonical keys (immutable, registered in `08_PERMISSION_ARCHITECTURE.md`).
- **AppEntitlement.entitlementKey** → Entitlement Core's quotas and features.
- **AppInstall.tenantId** → Tenant Core.
- **AppPublisher.publisherId** → Identity Core (service account or user).
- **AppReview.reviewedBy** → Identity Core (admin user).
- **AppToken scopes** → Permission Core's canonical keys.

## 10. Relationships

### 10.1 Dependency direction

Marketplace Core (EXPERIENCE tier) depends on:
- **Permission Core** (FOUNDATION): apps request permission keys; tenant admins approve; app tokens are scoped to approved permissions.
- **Entitlement Core** (FOUNDATION): apps declare required plan features and quotas; install is blocked if tenant plan lacks entitlements.
- **Tenant Core** (FOUNDATION): apps are installed per-tenant; app data and tokens are tenant-scoped.
- **Identity Core** (FOUNDATION): publishers and reviewers are Identity Core users; app tokens are OAuth credentials.
- **Security Core** (FOUNDATION): app tokens use OAuth; secrets stored in Secret Store; sandbox enforces isolation.
- **Audit Core** (FOUNDATION): every install, permission change, API call, suspension is audited.
- **Developer Platform Core** (PLATFORM SERVICES): publishers use Developer Platform to register apps, manage OAuth, access Secret Store.
- **Event Core** (PLATFORM SERVICES): Marketplace publishes events on install, review, suspension, uninstall.
- **AI Core** (INTELLIGENCE, future): apps may provide AI Tools as Extensions.
- **Automation Core** (BUSINESS EXECUTION, future): apps may provide Automation Actions as Extensions.
- **Integration Core** (PLATFORM SERVICES): apps may wrap or extend built-in integrations via Connector Extensions.

### 10.2 Events published by Marketplace Core

(Owned by Marketplace Core; published to Event Core topic namespace `marketplace.*`.)

- `Marketplace.AppPublished` (appId, version, publisher).
- `Marketplace.AppReviewRequested` (appId, version, submittedAt, submittedBy).
- `Marketplace.AppReviewCompleted` (appId, version, status: approved | rejected, reason).
- `Marketplace.AppInstallRequested` (appId, tenantId, requestedAt, requestedBy).
- `Marketplace.AppInstallApproved` (appId, tenantId, installId, approvedAt, approvedBy).
- `Marketplace.AppInstallRejected` (appId, tenantId, reason, rejectedAt, rejectedBy).
- `Marketplace.AppInstalled` (appInstallId, tenantId, appId, installedAt, extensionsActivated[]).
- `Marketplace.AppUpdated` (appInstallId, previousVersion, newVersion, updatedAt).
- `Marketplace.AppSuspended` (appInstallId, suspendedAt, reason).
- `Marketplace.AppUninstalled` (appInstallId, tenantId, uninstalledAt, dataRetentionPolicy).
- `Marketplace.ExtensionInvoked` (extensionInstanceId, invokedAt, invokedBy, resultStatus).
- `Marketplace.AppTokenCreated` (appId, tenantId, tokenHash, createdAt).
- `Marketplace.AppTokenRevoked` (appId, tenantId, revokedAt).

## 11. Responsibilities

### 11.1 Marketplace Core responsibilities

- Manage the complete lifecycle of Apps: publish, review, install, suspend, uninstall.
- Enforce install-time review gates (security, policy, branding compliance).
- Manage AppPermission records and tenant approval workflows.
- Enforce permission scope creep detection and re-review requirements.
- Manage AppEntitlement checks at install time; block install if tenant plan lacks required features.
- Create and revoke AppTokens; enforce rate limits on API calls.
- Log all app actions to Audit Core.
- Publish marketplace lifecycle events to Event Core.
- Manage sandbox enforcement: token isolation, rate limiting, timeout, RLS tenant boundary.

### 11.2 App publisher responsibilities

- Declare Extensions, Permissions, and Entitlements in a valid app.yaml manifest.
- Ensure app code does not embed secrets; use Developer Platform Secret Store.
- Respond to app review findings; appeal rejections if appropriate.
- Monitor app health, quota usage, and ratings via Marketplace dashboards.
- Provide support and data retention policies per publisher profile.

### 11.3 Tenant admin responsibilities

- Request app installs via Marketplace browsing.
- Review and approve app permissions at install time; reject if permissions are excessive.
- Check entitlement requirements; ensure plan supports required features (or arrange upgrade).
- Monitor installed app health, quota usage, and API call patterns.
- Suspend or uninstall apps if abuse or quota overrun is detected.

## 12. Allowed Patterns

### AP1 — Reference across cores via canonical IDs

An `AppInstall` entity carries `tenantId` (Tenant Core), `appId` (App entity), and references Permission and Entitlement keys. The reference is by canonical ID; the referenced entities remain owned by their canonical cores.

### AP2 — Subscribe to another core's events

Event Core handlers may subscribe to `Marketplace.AppInstalled` and trigger downstream workflows (e.g., send welcome email, auto-enable related extensions). The subscription is declarative; Marketplace does not know about downstream subscribers.

### AP3 — Use another core's APIs for read and permission validation

Marketplace API endpoints read from Permission Core and Entitlement Core APIs to validate requested permissions and plan features. Reads do not require ownership transfer.

### AP4 — Publish events to Event Core topic namespace

Marketplace Core publishes all lifecycle events (install, review, suspend, uninstall) to the `marketplace.*` Event Core namespace. Event Core broker forwards these to all subscribed consumers.

### AP5 — Log to Audit Core

Every app API call, extension invocation, install state change, and permission change is logged via Audit Core API. Audit Core owns the `AuditLog` entity; Marketplace supplies the event payload.

## 13. Forbidden Patterns

### FP1 — Silent install

An app is installed without tenant admin approval. Rejected. Every install requires explicit APPROVED → INSTALLED transition, audited and notifiable.

### FP2 — Permission scope creep

An app's new version requests additional permissions (e.g., `contract.delete`), but the new permissions are automatically granted without tenant re-approval. Rejected. New permissions require `AppPermissionChange` review and explicit approval.

### FP3 — Cross-tenant app data

App A installed in Tenant X accesses data from Tenant Y. Forbidden. AppToken is always scoped to a single tenant; cross-tenant API calls fail at the RLS layer.

### FP4 — Embedded secrets

App manifest or code includes API keys, encryption keys, credentials. Rejected at review. Secrets are managed via Developer Platform Secret Store.

### FP5 — Unaudited API calls

App makes API calls that are not logged in AppApiCall and AuditLog. Rejected. Every app API call is intercepted, logged, and charged against quota.

### FP6 — No escape from sandbox

App code executes eval(), exec(), or direct SQL. Forbidden. App code runs via public APIs only; no runtime code execution.

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Authoritative Marketplace Core definition and status. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission key registry (`object.action` keys). |
| `09_ENTITLEMENT_ARCHITECTURE.md` | Plan, Feature, Quota, Limit canonical entities and semantics. |
| `10_API_ARCHITECTURE.md` | API surface design for Marketplace publishers and admins. |
| `11_EVENT_ARCHITECTURE.md` | Event topic naming and contracts for `marketplace.*` namespace. |
| `13_SECURITY_ARCHITECTURE.md` | OAuth, Secret Store, RLS enforcement. |
| `14_TENANT_ARCHITECTURE.md` | Tenant isolation and `tenant_isolation` RLS policy. |
| `17_GOVERNANCE_ARCHITECTURE.md` | App review standards and governance gates. |
| `21_AI_ARCHITECTURE.md` | AI Tool extension contract (future). |
| `07_WORKFLOW_PROCESS_ARCHITECTURE.md` | Automation Action extension contract. |

| Documents that depend on this one |
|---|
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (Marketplace UI surface, admin install flow, publisher portal). |
| `15_REPORTING_ARCHITECTURE.md` (Marketplace app admin dashboards, rating rollups). |
| `16_ANALYTICS_ARCHITECTURE.md` (App usage, install, quota telemetry). |

## 15. Implementation Requirements

### 15.1 Canonical entities and schema

All 22 canonical entities (§8) are registered in `09_DATA_ARCHITECTURE.md` with:
- Table name (e.g., `marketplace_app`, `marketplace_app_install`).
- Column schema (id, timestamps, foreign keys, status enums).
- Tenant scoping: all business entities carry `tenantId` and are subject to `tenant_isolation` RLS.
- Audit linkage: state-changing entities link to `AuditLog` via `auditLogId`.

### 15.2 API surface

Marketplace Core exposes APIs in three categories (details in `10_API_ARCHITECTURE.md`):

**Publisher APIs:**
- `POST /api/v1/marketplace/apps` — create app (draft).
- `PUT /api/v1/marketplace/apps/{appId}` — update app manifest (before publish).
- `POST /api/v1/marketplace/apps/{appId}/publish` — submit for review.
- `GET /api/v1/marketplace/apps/{appId}/review-status` — check review progress.
- `GET /api/v1/marketplace/publishers/{publisherId}/apps` — list my apps.

**Admin/Install APIs:**
- `GET /api/v1/marketplace/listings` — list published apps (public).
- `GET /api/v1/marketplace/listings/{appId}` — get app details.
- `POST /api/v1/marketplace/tenants/{tenantId}/installs` — request install.
- `GET /api/v1/marketplace/tenants/{tenantId}/installs` — list installs.
- `GET /api/v1/marketplace/tenants/{tenantId}/installs/{installId}` — get install status.
- `PATCH /api/v1/marketplace/tenants/{tenantId}/installs/{installId}/approve` — approve install.
- `PATCH /api/v1/marketplace/tenants/{tenantId}/installs/{installId}/suspend` — suspend app.
- `DELETE /api/v1/marketplace/tenants/{tenantId}/installs/{installId}` — uninstall.

**Token APIs:**
- `POST /api/v1/marketplace/tokens/{appId}/tenant/{tenantId}/refresh` — renew app token (OAuth).

### 15.3 Permission registry entries

All Marketplace-specific permissions (defined in `08_PERMISSION_ARCHITECTURE.md`):
- `marketplace.app.publish` — create and submit apps for review (Publisher role).
- `marketplace.app.review.approve` — approve/reject app reviews (Admin role, Marketplace review team).
- `marketplace.app.install.request` — request app install (Tenant Admin).
- `marketplace.app.install.approve` — approve/deny install requests (Tenant Admin).
- `marketplace.app.install.suspend` — suspend or uninstall apps (Tenant Admin).
- `marketplace.app.list` — list public marketplace (all authenticated users).
- `marketplace.extension.view` — view installed extensions (Tenant Admin, end-users per extension-specific rules).

### 15.4 Entitlement rules

Apps declare required entitlements in manifest; Entitlement Core defines feature and quota semantics:

```yaml
entitlements:
  required:
    - quota.apiCalls: 100000  # 100k API calls per month
    - feature.advancedReporting: true
    - feature.customExtensions: true
```

At install time, Marketplace Core checks tenant's plan against required entitlements. If tenant lacks required features, install is blocked.

### 15.5 Event contracts

All lifecycle events are published to Event Core `marketplace.*` namespace with:
- Full audit trail (actor, timestamp, reason).
- Tenant-scoped records (event includes `tenantId` where applicable).
- Idempotency keys to support replay safety.

### 15.6 Audit trail integration

Every state-changing action in Marketplace Core produces:
1. State change in canonical entity (e.g., `AppInstall.status` = ACTIVE).
2. AuditLog record via Audit Core API (who, what, when, why).
3. Domain event published to Event Core (for downstream subscribers).

Examples:
- Install request: log to `AuditLog` with action="install_requested", actor=adminUserId, appId, tenantId.
- Permission approval: log to `AuditLog` with action="permission_approved", actor=adminUserId, permissionKey[].
- Sandbox violation detected: log to `AuditLog` with action="app_suspended", reason="quota_overrun", appId, tenantId.

### 15.7 Sandbox enforcement implementation

- **Token scoping:** Each app gets one or more OAuth tokens scoped to the app + tenant. Token validation happens before every API call.
- **Rate limit middleware:** Every app API call is intercepted by rate-limit middleware. If quota exceeded, call is rejected with 429; quota usage is logged to `AppApiCall`.
- **Timeout enforcement:** App webhook handlers and extension invocations have configurable timeout (e.g., 30s). Runaway operations are killed; failure logged.
- **RLS policy:** All business queries from app tokens apply `WHERE tenant_id = :appTenant AND ...`. Cross-tenant query attempts are blocked at the DB layer.
- **API logging:** Every app API call creates an `AppApiCall` record: resource, method, statusCode, durationMs, quotaUsed. Linked to AuditLog via `auditLogId`.

### 15.8 Review gate implementation

App review before publish validates:

**Security gate:**
- Manifest is signed; signature valid.
- No hardcoded secrets (API keys, tokens) in code or manifest.
- No direct DB access; all platform access via public APIs.
- No code escape vectors (eval, exec, SQL injection).

**Policy gate:**
- Publisher provides privacy policy, data retention policy, support SLA, terms of service.
- Policies are clear and verifiable.
- Data retention policy specifies action on uninstall (delete, archive, export).

**Branding compliance gate:**
- App icon and screenshots do not impersonate platform or misrepresent functionality.
- Marketplace listing copy is clear and honest.
- No dark patterns (misleading buttons, hidden upsells, forced upgrades).

### 15.9 Install lifecycle state transitions

All transitions are logged and require explicit actions:

| From | To | Actor | Prerequisite | Event |
|---|---|---|---|---|
| REQUESTED | REVIEWED | System | App review gates passed or failed. | `AppReviewCompleted` |
| REVIEWED | APPROVED | System | Review passed & tenant plan supports entitlements & tenant in good standing. | N/A (state not yet visible to admin) |
| APPROVED | INSTALLED | Tenant Admin | Admin clicks "Confirm Install" | `AppInstalled` |
| INSTALLED | ACTIVE | System | App init completed (if any). | N/A |
| ACTIVE | SUSPENDED | Tenant Admin | Admin clicks "Suspend App". | `AppSuspended` |
| SUSPENDED | ACTIVE | Tenant Admin | Admin clicks "Resume App". | N/A |
| SUSPENDED or ACTIVE | UNINSTALLED | Tenant Admin | Admin clicks "Uninstall App". | `AppUninstalled` |

### 15.10 Test and migration requirements

(Deferred to Phase M2+ implementation runbook; documented at implementation time.)

## 16. Future Expansion Rules

### 16.1 M2/M3 implementation checklist

At implementation time, the following must hold:

- [ ] Apps can be published, reviewed, installed, suspended, and uninstalled without hardcoding.
- [ ] Extensions are declared in YAML manifest; platform reads them and activates (no code per extension type).
- [ ] Permission scope creep is impossible: new permissions require re-review.
- [ ] Entitlements are enforced: app install fails if tenant plan lacks required features.
- [ ] Sandbox is complete: app API calls are rate-limited, audited, tenant-scoped.
- [ ] Install lifecycle is fully audited: every state transition is logged with actor and reason.
- [ ] Two tenants can both install the same app without data leakage.
- [ ] A second ISP (white-label tenant) can have a different set of Marketplace apps.
- [ ] Ratings and reviews are tenant-scoped: Tenant A cannot see Tenant B's feedback.
- [ ] App publisher receives telemetry: installs, uninstalls, errors, quota usage.

### 16.2 Beyond M3 expansion points

- **App monetization:** Marketplace takes a percentage; publishers set pricing.
- **Private Marketplace:** tenant admins hide public apps, curate internal-only apps.
- **Entitlement override:** admins can override plan entitlements on a per-app basis (e.g., grant a free trial).
- **Extension auto-discovery:** UI discovers installed Extensions at runtime; schema-driven rendering.
- **Dependency management:** App A depends on App B; install order is enforced.
- **Version compatibility matrix:** app version X is compatible with platform version Y.
- **Staged rollout:** publish app to 1% of tenants first; ramp up if stable.

---

*End of 20 — Marketplace Architecture.*
