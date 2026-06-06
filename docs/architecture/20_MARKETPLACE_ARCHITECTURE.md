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
- **G7** App and Integration and Extension are distinct concepts (see §6).
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

## 6. Core Concepts

### 6.1 App

A package containing:
- **Manifest** (app.yaml): name, version, publisher, description, Extensions, Permissions, Entitlements, icon, screenshots, terms of service, privacy policy.
- **Extensions**: list of runtime contributions (type, entry point, configuration).
- **Permissions**: list of platform permission keys requested (e.g., `case.read`, `work.create`).
- **Entitlements**: list of Entitlement Core features and quotas required (e.g., `quota.apiCalls: 100k`, `feature.advancedReporting: true`).
- **Code**: (if applicable) backend or webhook handlers for Extensions. Published as a versioned artifact (npm package, container image, or zip).
- **Security**: signed manifest, no embedded secrets, external secrets managed via Developer Platform.

**Canonical entities:**
- `App`: name, publisherId, currentVersion, status, createdAt, publishedAt, retiredAt.
- `AppVersion`: appId, semanticVersion, manifest (YAML), codeUrl, signatureHash, status, createdAt.
- `AppPublisher`: name, email, verifiedAt, suspendedAt, policies (e.g., data retention, support SLA).

### 6.2 Extension

A runtime contribution provided by an App. Types (not exhaustive):
- **UI Tab**: appears on an entity (Case, Service, Contact) detail page. Configuration: entity type, tab label, entry point URL, icon.
- **Automation Action**: invoked by Automation Core (trigger → condition → action). Configuration: category, action name, input parameters, output, webhook URL.
- **Integration Connector**: (optional) an Extension that wraps or extends Integration Core. Connects to a 3rd-party system. Example: "Zendesk Sync" extension connects to Zendesk API.
- **Report Template**: provides a report format for Reporting Core. Configuration: name, parameters, template language, output (PDF, Excel).
- **AI Tool**: a tool callable by AI Core (see `21_AI_ARCHITECTURE.md`). Configuration: name, description, input schema, output schema, rate limit, execution timeout.
- **Webhook Listener**: listens to platform events (Event Core) and performs actions (fire external webhook, transform, log).

**Canonical entities:**
- `Extension`: appVersionId, type, name, status, configuration (JSON), entryPointUrl, sandbox (true/false, if API calls required).
- `ExtensionInstance`: extensionId, tenantId, configuration (tenant-specific overrides), status (enabled, disabled, suspendedByReview).
- `ExtensionInvocation`: extensionInstanceId, invokedAt, invokedBy, duration, resultStatus, auditLogId.

### 6.3 AppPermission

A permission record for what an app is allowed to do. At install time, the app's manifest lists permissions; tenant admins review and approve. Each permission is a `coreEntity.action` key from `08_PERMISSION_ARCHITECTURE.md`.

**Key property: install-time approval.** If an app later requests new permissions (new version), the permission is not automatically granted; it requires re-review and tenant re-approval.

**Canonical entities:**
- `AppPermission`: appVersionId, permissionKey, requestedAt, approvedAt, approvedBy, status (requested, approved, denied, revoked).
- `AppPermissionChange`: appVersionId, addedPermissions[], removedPermissions[], reviewedAt, reviewedBy, decision (approved, denied).

### 6.4 AppEntitlement

Links an App to Entitlement Core quotas, features, and limits. If a tenant's plan does not include the required entitlement, the app cannot be installed.

**Canonical entities:**
- `AppEntitlement`: appVersionId, entitlementKey (e.g., `quota.apiCalls`, `feature.advancedReporting`), minimumValue, status.
- `AppEntitlementGrant`: appInstallId, entitlementKey, grantedValue, remainingValue, resetAt (for quotas with reset windows).

### 6.5 Install Lifecycle

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

### 6.6 App Review

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

**Canonical entities:**
- `AppReview`: appVersionId, submittedAt, submittedBy, status (inReview, approved, rejected, appealed).
- `AppReviewGate`: appReviewId, gateType (security, policy, branding), gateStatus (passed, failed, review), comment, reviewedAt, reviewedBy.
- `AppReviewAppeal`: appReviewId, appealedAt, appealedBy, reason, decision.

### 6.7 MarketplaceListing

Discoverability, ratings, metadata, version history.

**Canonical entities:**
- `MarketplaceListing`: appId, publisherName, title, description, longDescription, icon, bannerImage, category (category_enum), tags[], status (published, draft, archived, discontinued).
- `MarketplaceVersion`: appVersionId, listing summary, releaseNotes, compatibility (minPlatformVersion, maxPlatformVersion).
- `MarketplaceRating`: appId, ratedBy, tenantId, rating (1–5), comment, installedVersionId, ratedAt.
- `MarketplaceInstall`: appInstallId, tenantId, appId, installRequestedAt, installedAt, installs (counter), uninstalls (counter), activeUsers (counter).

### 6.8 Sandbox & API Rate Limiting

Apps execute within a sandbox:
- **Token isolation:** each app has one or more OAuth tokens scoped to the app and tenant.
- **Rate limits:** each app is rate-limited based on its declared quota (e.g., 1000 API calls/min for 100k/month plan).
- **Audit trail:** every API call is logged with app ID, tenant ID, resource, action, result.
- **Tenant boundary:** API calls can only reach resources within the installing tenant; cross-tenant access is forbidden.
- **Timeout:** long-running operations (Extensions, webhooks) have execution timeouts; runaway code is killed.
- **Logging:** all Extension invocations are logged with duration, error, result status.

**Canonical entities:**
- `AppToken`: appId, tenantId, tokenHash, createdAt, expiresAt, revokedAt, scopes (permission list).
- `AppApiCall`: appId, tenantId, timestamp, method, resourcePath, statusCode, durationMs, quotaUsed, auditLogId.
- `AppQuotaReset`: appInstallId, quotaKey, resetAt, currentUsage, limit.

## 7. Ownership Boundaries

### 7.1 Entities owned by Marketplace Core

- `App`, `AppVersion`, `AppPublisher`
- `Extension`, `ExtensionInstance`, `ExtensionInvocation`
- `AppPermission`, `AppPermissionChange`
- `AppEntitlement`, `AppEntitlementGrant`
- `AppReview`, `AppReviewGate`, `AppReviewAppeal`
- `MarketplaceListing`, `MarketplaceVersion`, `MarketplaceRating`, `MarketplaceInstall`
- `AppToken`, `AppApiCall`, `AppQuotaReset`
- `AppInstall` (see §6.5 lifecycle)

### 7.2 Entities referenced but NOT owned

- `Permission` (from Permission Core; listed in `08_PERMISSION_ARCHITECTURE.md`).
- `Entitlement`, `Plan`, `Feature`, `Quota` (from Entitlement Core).
- `Tenant` (from Tenant Core).
- `User` (from Identity Core, for Publisher profile and install approver).
- `AuditLog` (from Audit Core; Marketplace logs to it, does not own it).

### 7.3 Cross-core references

- **AppPermission.permissionKey** → Permission Core's canonical keys (immutable, registered in `08_PERMISSION_ARCHITECTURE.md`).
- **AppEntitlement.entitlementKey** → Entitlement Core's quotas and features.
- **AppInstall.tenantId** → Tenant Core.
- **AppPublisher.publisherId** → Identity Core (service account or user).
- **AppReview.reviewedBy** → Identity Core (admin user).
- **AppToken scopes** → Permission Core's canonical keys.

## 8. APIs

(Summary; full detail in `10_API_ARCHITECTURE.md`.)

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

## 9. Events

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

## 10. Permissions

(Defined in `08_PERMISSION_ARCHITECTURE.md`; summary here.)

**Marketplace-specific permissions:**
- `marketplace.app.publish` — create and submit apps for review (Publisher role).
- `marketplace.app.review.approve` — approve/reject app reviews (Admin role, Marketplace review team).
- `marketplace.app.install.request` — request app install (Tenant Admin).
- `marketplace.app.install.approve` — approve/deny install requests (Tenant Admin).
- `marketplace.app.install.suspend` — suspend or uninstall apps (Tenant Admin).
- `marketplace.app.list` — list public marketplace (all authenticated users).
- `marketplace.extension.view` — view installed extensions (Tenant Admin, end-users per extension-specific rules).

**Delegated permissions:**
- Apps request permissions in manifest (e.g., `case.read`, `automation.create`).
- At install time, tenant admins *approve* which permissions the app gets.
- App tokens are scoped to those approved permissions only.

## 11. Entitlements

(Defined in `09_ENTITLEMENT_ARCHITECTURE.md` § Marketplace; summary here.)

Apps declare required entitlements in their manifest:

```yaml
entitlements:
  required:
    - quota.apiCalls: 100000  # 100k API calls per month
    - feature.advancedReporting: true
    - feature.customExtensions: true
```

At install time:
- Platform checks tenant's plan against required entitlements.
- If tenant's plan lacks `feature.advancedReporting`, app cannot be installed.
- Tenant admins see which plan upgrades are needed.
- No silent failures; no hidden upsells.

**Quota reset window:** Entitlement Core defines whether quotas reset daily, monthly, or at custom windows. Marketplace consumes those rules via AppQuotaReset entity.

## 12. Tenant Isolation & Data Security

### 12.1 Cross-tenant data access is forbidden.

An app token is always scoped to a single tenant. API calls from app code can only access resources within that tenant (enforced via RLS policy `tenant_isolation`).

### 12.2 Secrets are never embedded.

Apps do not ship API keys, encryption keys, or other secrets. External credentials are managed via Developer Platform's Secret Store (see `10_API_ARCHITECTURE.md` § Developer Platform).

### 12.3 Audit trail is mandatory.

Every app API call, extension invocation, and install action is logged:
- `AppApiCall` table: appId, tenantId, timestamp, resource, result, durationMs.
- Linked to `AuditLog` via `auditLogId`.
- Searchable by tenant admin, platform operator.

### 12.4 Sandbox enforcement.

App code runs under:
- OAuth token with limited scopes (approved permissions only).
- Rate-limit middleware (quota per plan).
- Timeout enforcement (long operations killed after N seconds).
- No direct DB access; all data via public APIs.

## 13. Install Lifecycle Deep Dive

### 13.1 REQUESTED state

Tenant admin visits Marketplace, finds "Zendesk Support Hub" app, clicks "Request Install".

**Action:** Create `AppInstall` record with status = REQUESTED.
- Stores appId, tenantId, requestedAt, requestedBy (admin user).
- Creates `AppPermissionChange` for the app's manifest permissions.
- Sends event: `Marketplace.AppInstallRequested`.

**Audit:** Record in AuditLog: "Zendesk Support Hub install requested by john@tenant.example.com".

### 13.2 REVIEWED state

Marketplace Core review team (or automation) inspects the `AppInstall`:
- Checks `AppPermission` entries: does the app request only sensible permissions?
- Checks `AppEntitlement`: does the tenant's plan support required features?
- Checks compliance: has the app's `AppReview` been approved?
- Checks tenant: is the tenant in good standing (not suspended)?

If all pass: transition to APPROVED. If any fail: transition to REJECTED.

**Audit:** Record in AuditLog: "Zendesk Support Hub install reviewed by marketplace-reviewer@gaahex.io; result: approved".

### 13.3 APPROVED state

Tenant admin sees: "Install approved! Click below to confirm."

Tenant admin clicks "Confirm Install".

**Action:** Platform transitions `AppInstall.status` to INSTALLED and:
1. Creates `AppToken` (OAuth token for the app).
2. Creates `ExtensionInstance` records for each Extension in the app.
3. Sets each ExtensionInstance.status = enabled.
4. Sets AppInstall.status = ACTIVE.
5. Sends event: `Marketplace.AppInstalled` with extensionsActivated list.

**Audit:** Record in AuditLog: "Zendesk Support Hub installed; extensions activated: [sync_tickets, automation_handler]".

### 13.4 ACTIVE state

App is running. Tenant users interact with Extensions:
- Open a Case detail page; the "Zendesk History" tab appears (UI Extension).
- Create an automation rule with a "Sync to Zendesk" action (Automation Extension).

Every invocation logs:
- `ExtensionInvocation`: extensionInstanceId, invokedAt, invokedBy, duration, resultStatus.
- `AppApiCall`: appId, tenantId, resource, statusCode, duration, quotaUsed.
- Both linked to `AuditLog`.

**Audit:** "app=Zendesk, tenantId=abc123, resource=/api/v1/cases/xyz, statusCode=200, quotaUsed=1, timestamp=2026-06-06T14:32:15Z".

### 13.5 SUSPENDED state

Tenant admin discovers app is making excessive API calls (quota overrun) or sending data outside tenant scope.

**Action:** Admin clicks "Suspend App".
1. Transition AppInstall.status to SUSPENDED.
2. Revoke AppToken (mark as revoked).
3. Disable all ExtensionInstance records (status = disabled).
4. Send event: `Marketplace.AppSuspended`.
5. Notify app publisher: "Your app in tenant XYZ has been suspended due to quota overrun."

**Audit:** "Zendesk Support Hub suspended by john@tenant.example.com; reason: quota overrun; resume: manual only".

**Resume:** Admin clicks "Resume". Transition back to ACTIVE, recreate AppToken, re-enable Extensions.

### 13.6 UNINSTALLED state

Tenant admin clicks "Uninstall App".

**Action:**
1. Transition AppInstall.status to UNINSTALLED.
2. Revoke AppToken.
3. Disable and mark for cleanup all ExtensionInstance records.
4. Follow AppPublisher.dataRetentionPolicy (e.g., delete synced data after 30 days, or export to CSV).
5. Send event: `Marketplace.AppUninstalled` with dataRetentionPolicy.
6. Record uninstallAt timestamp.

**Audit:** "Zendesk Support Hub uninstalled by john@tenant.example.com; data retention policy: delete-after-30-days".

**Final:** AppInstall record is archived (not deleted); history is preserved for compliance.

## 14. Hardening Artifacts (8-item checklist per Platform Core definition)

1. **Canonical entities and state model** ✓ (§6, §7, §13).
2. **Ownership and anti-overlap rules** ✓ (§7).
3. **API surface and service boundary** ✓ (§8, `10_API_ARCHITECTURE.md`).
4. **Event contracts and audit records** ✓ (§9, Audit Core).
5. **Permission, policy, entitlement, and tenant rules** ✓ (§10, §11, §12).
6. **UI / navigation placement rules** → Deferred to `06_UI_EXPERIENCE_ARCHITECTURE.md` (Marketplace is Experience tier; specific page layouts are experience concerns).
7. **Reporting / analytics exposure rules** → Deferred to `15_REPORTING_ARCHITECTURE.md`, `16_ANALYTICS_ARCHITECTURE.md` (Marketplace admin dashboards report on app usage, ratings, review queue).
8. **Test and migration requirements** → Deferred to Phase M2+ implementation runbook (TBD).

## 15. Forbidden Patterns

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

## 16. Integration with Other Cores

| Core | How Marketplace depends on it |
|---|---|
| **Permission Core** | Marketplace apps request permission keys; tenant admins approve; app tokens are scoped to approved permissions. |
| **Entitlement Core** | Apps declare required plan features and quotas; install is blocked if tenant plan lacks entitlements. |
| **Tenant Core** | Apps are installed per-tenant; app data and tokens are tenant-scoped. |
| **Identity Core** | Publishers and reviewers are Identity Core users; app tokens are OAuth credentials. |
| **Security Core** | App tokens use OAuth; secrets stored in Secret Store; sandbox enforces isolation. |
| **Audit Core** | Every install, permission change, API call, suspension is audited. |
| **Developer Platform Core** | Publishers use Developer Platform to register apps, manage OAuth, access Secret Store. |
| **Event Core** | Marketplace publishes events on install, review, suspension, uninstall. |
| **AI Core** (future) | Apps may provide AI Tools as Extensions. |
| **Automation Core** (future) | Apps may provide Automation Actions as Extensions. |
| **Integration Core** | Apps may wrap or extend built-in integrations via Connector Extensions. |

## 17. Success Criteria (Reserved for M2+ Implementation)

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

## 18. Future Extension Points

**M2/M3 Implementation:**
- [ ] App monetization: Marketplace takes a percentage; publishers set pricing.
- [ ] Private Marketplace: tenant admins hide public apps, curate internal-only apps.
- [ ] Entitlement override: admins can override plan entitlements on a per-app basis (e.g., grant a free trial).
- [ ] Extension auto-discovery: UI discovers installed Extensions at runtime; schema-driven rendering.
- [ ] Dependency management: App A depends on App B; install order is enforced.
- [ ] Version compatibility matrix: app version X is compatible with platform version Y.
- [ ] Staged rollout: publish app to 1% of tenants first; ramp up if stable.

---

*End of 20 — Marketplace Architecture.*
