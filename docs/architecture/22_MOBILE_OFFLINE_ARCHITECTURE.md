# 22 — Mobile / Offline Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`, after `21_AI_ARCHITECTURE.md`. Defines the mobile app shell, offline sync, conflict resolution, device trust, field-technician workflows, and push actions. Mobile Core is currently WEAK and must be hardened to enable field execution across GAAhex's ISP operations.

---

## 1. Purpose

Codify how field technicians, dispatch operators, and field-based service agents use GAAhex's mobile and offline capabilities. This document defines:

- Mobile app shell architecture (navigation, auth, shell state).
- Offline-first data sync (OfflineSyncRecord, conflict detection, CRDT-safe merges).
- Device trust and revocation (DeviceTrustRecord, attestation, secure storage).
- Field-technician workflows (dispatch, on-site photo/signature capture, material consumption tracking).
- Actionable push notifications (PushAction Core integration).
- Mobile-specific permissions and data residency (encryption at rest, remote wipe).
- Battery and bandwidth budgits (backend respects mobile-aware pagination and compression).

## 2. Scope

In scope:

- Mobile app shell (native or cross-platform) and bootstrap lifecycle.
- Mobile navigation patterns (workflow-first short list; global search for discovery).
- Offline sync record model and CRDT-style conflict resolution.
- Device trust registry and revocation.
- Field technician workflows (arrive, photograph, sign, complete, capture consumption).
- Push notification routing and actionable push semantics.
- Mobile-specific permissions (location, camera, biometric, push).
- Encrypted local storage (AES-256 at rest on device).
- Remote wipe and device lifecycle.

Out of scope:

- Mobile UI layout / design tokens (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).
- Background Processing infrastructure (see `19_INFRASTRUCTURE_ARCHITECTURE.md`).
- Network protocol details (see `13_SECURITY_ARCHITECTURE.md` for TLS / certificate pinning).
- Field-technician workforce scheduling (see `05_OPERATIONAL_ARCHITECTURE.md`, Scheduling Core).
- Notification routing engine (see `10_API_ARCHITECTURE.md`, Notification Core).

## 3. Goals

- **G1** Every core workflow in GAAhex is usable offline; sync is automatic and transparent.
- **G2** Conflict resolution is deterministic and auditable; server is authoritative; mobile clients fetch resolution status on reconnect.
- **G3** Field technicians can work without network for ≥4 hours and maintain data integrity.
- **G4** Device compromise is detectable and actionable; revocation is immediate.
- **G5** Mobile users cannot bypass audit, permissions, or approval workflows (offline queuing enforced).
- **G6** Backend respects mobile bandwidth budgets (compression, pagination, delta sync).
- **G7** Push actions (e.g., "accept dispatch", "check task") are executed client-side without re-polling.

## 4. Non-Goals

- **NG1** Does NOT define specific UI frameworks (React Native, Flutter, etc.).
- **NG2** Does NOT define network infrastructure scaling (CDN, edge caching, etc.).
- **NG3** Does NOT replace Workflow Core state machines; offline writes queue for workflow validation on sync.
- **NG4** Does NOT bypass audit or approval gates — offline writes block approval-gated transitions.
- **NG5** Does NOT support unlimited offline operation; connectivity requirements are per-feature (e.g., payment must be online-only).

## 5. Architecture Principles

### P1 — Mobile ≠ Responsive Web

Mobile is not just a smaller screen. Field technicians work offline, on poor networks, and with gloved hands. Mobile navigation, interaction patterns, data sync, and permissions are separate from responsive-web concerns. The platform must have mobile-specific flows.

### P2 — Server is Authoritative

Offline writes are *provisional*. The server owns the truth on data, permissions, and state transitions. On reconnect, the mobile client fetches the server's canonical state and resolves conflicts. Last-write-wins is flagged for review.

### P3 — Audit is Universal

Every offline write is queued with full context (actor, timestamp, metadata, IP). On sync, the queue is replayed through the backend audit system. Offline writes that fail validation are surfaced to the user with explanations.

### P4 — Approval is Gating

Any transition gated by an Approval workflow cannot be written offline. Offline writes attempting approval-gated transitions are queued for sync and fail with guidance to reconnect.

### P5 — Device Trust is Identity

A mobile device is a first-class identity vector. Device compromise or theft is detectable via trust attestation. Revocation invalidates all offline data; the app refetches on next network contact.

### P6 — Mobile-Aware Backend

The backend publishes mobile-specific API contracts: compressed payloads, delta sync (only changes since last sync checkpoint), short TTLs on push actions, low-bandwidth pagination.

### P7 — Battery and Bandwidth Budgets

The backend respects mobile limitations: no polling loops, smart background sync, push-driven updates where possible, configurable sync intervals (hourly vs. real-time based on connectivity).

## 6. Architecture Laws

### L1 — Offline Sync Records are Immutable

Every offline write creates an OfflineSyncRecord with full context (action, entity type, payload, timestamp, userId, deviceId, status). Once a record is synced, it becomes read-only (immutable for audit). Conflict resolution updates the status; original payload is never mutated.

### L2 — Server Wins on Conflict

If mobile and server diverge on the same field:
- Safe-field merge (CRDT style): merge succeeds if fields do not overlap.
- Unsafe-field conflict (overlapping write): server state prevails; client is notified; user is prompted to reapply offline change if desired.
- Audit flag: every server-wins conflict is recorded as a ConflictRecord for Audit Core.

### L3 — Device Trust is Mandatory

Every mobile app instance registers a DeviceTrustRecord (deviceId, deviceModel, OS version, appVersion, last-seen timestamp, attestation status, revocationStatus). Without trust, the device cannot sync. Revocation is immediate; next network contact forces re-authentication and full cache clear.

### L4 — Push Actions are Ephemeral

A PushAction (e.g., "accept dispatch work", "confirm task completion") has a 30-minute TTL. If the client does not act, the action expires; the backend retains the right to time out and reassign. Actions are signed and verified before execution.

### L5 — Location is Permissioned

Mobile APIs exposing location (e.g., technician location on dispatch map, geofenced field sites) require explicit permission grant. Location data is not synced offline; it is streamed via encrypted WebSocket when available. Location data is never stored on device in plaintext.

### L6 — Field Workflows are Structured

Field technician workflows follow a fixed sequence: (1) Dispatch notification, (2) Accept/Decline, (3) Navigate to site, (4) Check in, (5) Perform work, (6) Photograph/document, (7) Capture signature, (8) Record consumption, (9) Submit. This sequence is enforced by the mobile app and Workflow Core.

### L7 — Offline Writes for Approval-Gated Transitions are Forbidden

If the current state transition requires Approval Core authorization, the mobile app queues the write with status PENDING_APPROVAL_OFFLINE. On sync, the backend validates the approval chain. If approval is denied, the write is rejected; the user is notified.

### L8 — Remote Wipe is Immediate

If DeviceTrustRecord.revocationStatus = REVOKED, the next sync attempt clears all local encrypted caches, forces re-authentication, and logs the wipe event. The device is locked out until IT re-provisioning.

## 7. Core Concepts

### 7.1 Mobile App Shell

The mobile app is a single entry point with:

- **Bootstrap:** Fetch user profile, organization, permissions, and schema on first launch.
- **Auth:** Support SSO (OAuth2), device certificate, and biometric unlock (after initial login).
- **Shell state:** Current user, current tenant, current offline sync status, last sync timestamp, network connectivity.
- **Navigator:** Workflow-first navigation (Dispatch, My Day, My Jobs, Customer Lookup, Settings, Offline Status).
- **Error handler:** Network errors, sync failures, permission errors all routed to user with guidance.
- **Background services:** Periodic sync, push notification listener, location updates (if permitted).

### 7.2 Offline Sync Record (OSR)

```
OfflineSyncRecord:
  id: UUID
  deviceId: string (DeviceTrustRecord.deviceId)
  userId: UUID (Identity Core)
  tenantId: UUID (Tenant Core)
  
  # What was written offline
  action: enum (CREATE | UPDATE | DELETE | STATE_TRANSITION)
  entityType: string (e.g., "WorkItem", "Document", "Approval")
  entityId: UUID
  payload: JSON (full entity state or delta)
  
  # Timeline
  createdAt: timestamp (local mobile time, UTC)
  syncedAt: timestamp (when server received it)
  
  # Conflict resolution
  status: enum (PENDING_SYNC | SYNCED | CONFLICT | SYNC_FAILED | PENDING_APPROVAL_OFFLINE)
  conflictRecord: ConflictRecord (if status = CONFLICT)
  serverCanonicalState: JSON (server's view after sync)
  
  # Audit
  auditContext: AuditContext (user agent, IP-at-sync, GPS-approx, WiFi-SSID-hash)
  signingHash: string (HMAC-SHA256 of payload + deviceTrustKey)
```

### 7.3 Conflict Record

```
ConflictRecord:
  id: UUID
  offlineSyncRecordId: UUID
  
  # The divergence
  field: string (which field conflicted; null if entity-level conflict)
  mobileValue: any
  serverValue: any
  resolutionStrategy: enum (SERVER_WINS | MERGE_SAFE | MANUAL_REVIEW)
  
  # Outcome
  appliedValue: any (which value was kept)
  userNotified: timestamp (when user was told)
  userApproved: timestamp (when user acknowledged)
  
  # Audit
  auditEvent: AuditLog reference (recorded in Audit Core)
```

### 7.4 Device Trust Record

```
DeviceTrustRecord:
  deviceId: string (UUID or IMEI/hardware-id hybrid)
  userId: UUID
  tenantId: UUID
  
  # Device info
  deviceModel: string (e.g., "iPhone 14 Pro")
  osVersion: string (e.g., "17.2")
  appVersion: string (e.g., "1.5.0")
  
  # Trust status
  attestationStatus: enum (VERIFIED | UNVERIFIED | COMPROMISED)
  attestationProof: string (signed challenge-response)
  attestationCheckedAt: timestamp
  
  # Lifecycle
  registeredAt: timestamp
  lastSeenAt: timestamp
  lastSyncAt: timestamp
  
  # Revocation
  revocationStatus: enum (ACTIVE | REVOKED | SUSPENDED)
  revokedAt: timestamp (if revoked)
  revokedBy: UUID (user who triggered revocation; "SYSTEM" for compromise-detected)
  revokedReason: enum (USER_LOGOUT | ADMIN_REVOKE | COMPROMISE_DETECTED | DEVICE_LOST)
```

### 7.5 Field Technician Workflow

```
┌─────────────────────────────────────────────────────────┐
│ Field Technician Workflow                               │
└─────────────────────────────────────────────────────────┘

(1) RECEIVE DISPATCH
    ├─ Mobile receives PushAction: "New job assigned"
    ├─ Notification shows: job ID, customer, address, priority
    └─ App opens Dispatch tab (if not already open)

(2) ACCEPT / DECLINE
    ├─ Technician taps "Accept" or "Decline"
    ├─ Offline write: WorkItem.state = ACCEPTED (or DECLINED)
    ├─ OSR queued (status = PENDING_SYNC if offline)
    └─ UI navigates to job detail

(3) NAVIGATE TO SITE
    ├─ Map shows site location + route (Google Maps / Apple Maps)
    ├─ Estimated arrival + address
    └─ No Location permission required until "Check In"

(4) CHECK IN (GEOFENCE + MANUAL)
    ├─ App detects proximity to site (geofence trigger OR manual button)
    ├─ App requests Location permission (first time)
    ├─ Capture: GPS coordinates, timestamp, WiFi SSID hash
    ├─ Offline write: WorkItem.checkedInAt + location
    └─ OSR created; status = PENDING_SYNC (or SYNCED if online)

(5) PERFORM WORK
    ├─ Follow on-screen instructions / runbook (Knowledge Core lookup)
    ├─ Track time in-app (stopwatch timer optional)
    ├─ Update WorkItem progress fields (if enabled)
    └─ All writes queued as OSRs

(6) PHOTOGRAPH / DOCUMENT
    ├─ Camera permission requested (one-time grant)
    ├─ Capture photo (stored in encrypted local cache)
    ├─ Attach to WorkItem: creates Document entity offline
    ├─ Photo is queued for upload on sync (not sent immediately)
    └─ App shows photo with optional caption

(7) CAPTURE SIGNATURE
    ├─ Signature pad UI (customer signs)
    ├─ Captured as image + base64 in Attachment
    ├─ Stored encrypted on device
    └─ OSR created with signature data

(8) RECORD MATERIAL CONSUMPTION
    ├─ Scan barcodes (Inventory Core) OR manual input
    ├─ Track: item ID, quantity consumed, location
    ├─ Offline write: Inventory entry + link to WorkItem
    └─ OSR queued

(9) SUBMIT COMPLETION
    ├─ User reviews: signature, photos, materials, notes
    ├─ Taps "Mark Complete"
    ├─ Offline write: WorkItem.state = COMPLETED + completedAt
    ├─ App queues all pending OSRs
    ├─ On reconnect: backend validates Approval chain
    │  (if verification required)
    └─ If approved: Work.state → VERIFIED; if denied: user notified

Timeline:
- Offline: 30 min to several hours (field coverage gaps)
- Sync: All OSRs uploaded in one batch when connectivity returns
- Approval: Server-side; user sees status when app syncs
```

### 7.6 Mobile Navigation (Workflow-First Short List)

Mobile left nav prioritizes field user workflows, not platform cores:

```
Mobile Navigation
├─ Dispatch (active job assignments; push-driven)
├─ My Day (today's scheduled jobs; time-anchored)
├─ My Jobs (past 30 days; full list)
├─ Customer Lookup (global search for customer by name / phone / ID)
├─ Offline Status (sync queue, conflicts, storage usage)
├─ Account (settings, biometric, device trust, logout)
└─ [No detailed "Workspace", "Cases", "Contracts", etc.]
```

Global search bar is always accessible; keyboard shortcut or voice for gloved-hand use.

### 7.7 Push Action Model

A PushAction is a time-bounded, signed instruction to the mobile client:

```
PushAction:
  id: UUID
  deviceId: string (target)
  userId: UUID
  tenantId: UUID
  
  # Payload
  actionType: enum (ACCEPT_WORK | DECLINE_WORK | CHECK_IN | 
                    SIGN_OFF | CONFIRM_COMPLETION | 
                    UPDATE_STATUS | FETCH_LATEST)
  targetEntityId: UUID (the Work / Case / etc. being acted on)
  targetEntityType: string
  metadata: JSON (context-specific; e.g., { "priority": "URGENT" })
  
  # Lifecycle
  createdAt: timestamp
  expiresAt: timestamp (30 min from creation)
  actionState: enum (PENDING | EXECUTED | EXPIRED | REJECTED)
  executedAt: timestamp
  executedValue: JSON (what the client reported back)
  
  # Signature
  signature: string (signed by Notification Core)
  signatureAlgorithm: "HMAC-SHA256"
```

When a PushAction expires without execution, the backend retains the right to cancel the associated Dispatch assignment or escalate.

### 7.8 Mobile-Specific Permissions

Mobile apps request OS permissions independently:

```
Permission (mobile)
├─ location: ALWAYS / WHEN_IN_USE / NEVER
│   └─ Used for geofencing, check-in, dispatch map
├─ camera: GRANTED / DENIED
│   └─ Used for photo capture during work
├─ microphone: GRANTED / DENIED
│   └─ Reserved for future voice notes
├─ biometric: GRANTED / DENIED
│   └─ Used for app unlock (after initial login)
├─ push_notification: GRANTED / DENIED
│   └─ Used for dispatch, task, approval notifications
└─ calendar: GRANTED / DENIED
    └─ Used for syncing scheduled jobs to device calendar
```

Each permission grant is recorded in DeviceTrustRecord.permissionsGranted (JSON). Permission revocation (OS-level) triggers a sync warning.

### 7.9 Encrypted Local Storage

Mobile device storage is organized into zones:

```
Encrypted Local Storage
├─ /app/cache (schema + metadata)
│   └─ Entity schemas, permission rules, tenant config
│   └─ Encrypted with device-scoped key (AES-256)
│   └─ TTL: 24 hours (refreshed on sync)
├─ /app/inbox (offline sync queue)
│   └─ OfflineSyncRecords (pending and resolved)
│   └─ Encrypted with device-scoped key
│   └─ Persists across app restart
├─ /app/workspace (current work context)
│   └─ Open jobs, customer details, work history (last 30 days)
│   └─ Encrypted with device-scoped key
│   └─ Cleared on logout or revocation
├─ /app/attachments (photos, signatures)
│   └─ Binary blobs (photo JPEGs, signature PNGs)
│   └─ Encrypted with device-scoped key
│   └─ Uploaded to Storage Core on sync
│   └─ Cleared after successful upload
└─ /app/auth (credentials)
    └─ OAuth tokens (access + refresh)
    └─ Device certificate (if mTLS used)
    └─ Encrypted with OS-level keychain (iOS) / Keystore (Android)
    └─ Never logged or dumped
```

Encryption key derivation: `PBKDF2(deviceId + userId + tenantId, salt, 100k iterations, SHA-256)` stored in secure enclave.

### 7.10 Remote Wipe

When DeviceTrustRecord.revocationStatus = REVOKED:

```
On Next Network Contact:
1. API request returns HTTP 403 + "DEVICE_REVOKED" code
2. Mobile app detects revocation
3. App clears all encrypted caches:
   └─ rm -rf /app/cache /app/inbox /app/workspace /app/attachments
4. App clears auth tokens from keychain
5. App logs AuditLog.RemoteWipeExecuted (Audit Core)
6. App returns to login screen
7. On re-login: full cache rebuild
```

## 8. Canonical Entities

Entities owned by Mobile Core:

| Entity                  | Type        | Purpose                                    |
|-------------------------|--------|---------------------------------------------|
| OfflineSyncRecord       | Record | Queued offline write with conflict tracking |
| ConflictRecord          | Record | Conflict resolution outcome + audit         |
| DeviceTrustRecord       | Record | Device identity + revocation status         |
| PushAction              | Record | Time-bounded actionable push notification   |
| MobileAppShell          | Config | App-level configuration (nav, features)     |
| MobileNavEntry          | Config | Navigation menu item (Dispatch, My Day)     |
| FieldTechnicianFlow     | Config | Sequence definition (arrive, sign, submit)  |

All are tenant-scoped. DeviceTrustRecord is user-scoped (a user may have multiple devices).

## 9. Ownership Boundaries

### 9.1 Mobile Core owns offline sync

Mobile Core owns OfflineSyncRecord, ConflictRecord, DeviceTrustRecord, PushAction, MobileAppShell, MobileNavEntry, FieldTechnicianFlow. No other core may create or mutate these entities.

### 9.2 Mobile Core owns mobile navigation

Mobile Core defines the mobile-specific navigation structure (short list of workflows). The Workspace Core navigation does not apply to mobile.

### 9.3 Mobile Core references Work, Case, Notification, Storage

Mobile clients consume Work Core APIs (job assignment, status updates), Case Core APIs (ticket lookup), Notification Core (push delivery), and Storage Core (attachment upload).

### 9.4 Mobile Core does NOT own field-technician workflows

The field-technician workflow sequence is Mobile Core configuration; the state machine transitions are owned by Workflow Core; the work execution (time, location, consumption) is owned by Work Core.

## 10. Relationships

### 10.1 Device ↔ User

```
DeviceTrustRecord ──> User (Identity Core)
                 ──> Tenant (Tenant Core)
```

A user may have multiple devices; each device is an independent trust relationship.

### 10.2 OfflineSyncRecord ↔ Entity

```
OfflineSyncRecord ──> Work / Case / Document / etc.
                 (references entityId + entityType)
```

An entity may have multiple pending OSRs (e.g., multiple property updates queued offline).

### 10.3 ConflictRecord ↔ Audit

```
ConflictRecord ──> AuditLog (every conflict is audited)
                ──> OfflineSyncRecord
```

### 10.4 PushAction ↔ Work

```
PushAction ──> WorkItem (targetEntityId)
            ──> DeviceTrustRecord (target device)
            ──> User (for override / escalation)
```

## 11. Responsibilities

### 11.1 Field Technicians

- Accept / decline work assignments.
- Check in at site.
- Capture photographs and signatures.
- Record material consumption.
- Submit completed work for verification.
- Maintain device trust (biometric unlock, physical security).

### 11.2 Mobile App (Client-Side)

- Bootstrap on login (fetch permissions, schema, config).
- Implement field-technician workflow sequence.
- Queue all writes as OfflineSyncRecords with full context.
- Detect and request OS permissions (location, camera, push).
- Manage encrypted local storage.
- Sync on network reconnect (with exponential backoff).
- Display conflicts to user and guide resolution.
- Respect push actions (execute within TTL).
- Log remote wipe on revocation.

### 11.3 Backend (Server-Side)

- Accept OSRs from mobile; queue for validation.
- Check permissions, audit, approval gating.
- Detect conflicts (overlapping writes to same field).
- Assign conflict resolution strategy (server-wins, merge-safe, manual).
- Publish conflict outcome via event.
- Issue PushActions (signed, TTL-bounded).
- Manage DeviceTrustRecord lifecycle (register, attest, revoke).
- Expose mobile-optimized APIs (compressed, delta, paginated).
- Support remote wipe on revocation.

### 11.4 Dispatch (Operations Core)

- Assign work to technicians via WorkItem.
- Monitor work status and SLA (online or offline-queued).
- Escalate if technician does not accept within timeout.
- Verify completed work before closing.

## 12. Allowed Patterns

### AP1 — Multi-Device Sync

A user logs in from phone and tablet. Both devices register separate DeviceTrustRecords. Offline writes on both devices are queued independently; on sync, conflicts are resolved per L2.

### AP2 — Conflict Resolution + User Notification

Mobile writes `WorkItem.notes` offline; server simultaneously receives `WorkItem.notes` update from a supervisor. Conflict is detected (same field, different value). Server-wins strategy applies; mobile app is notified; user sees conflict banner in Offline Status page with option to reapply their notes.

### AP3 — Queued Approval-Gated Transition

Technician completes work and taps "Mark Complete" offline. The transition requires Approval Core verification. OSR status = PENDING_APPROVAL_OFFLINE. On sync, backend validates approval chain; if approved, Approval.granted event is published; if denied, OSR.status = SYNC_FAILED with reason.

### AP4 — Push-Driven Dispatch Accept

Dispatch issues PushAction (ACCEPT_WORK) to a technician's device with 5-minute TTL. Technician taps "Accept" in notification or in app. Mobile creates OSR.action = STATE_TRANSITION (WorkItem.state = ACCEPTED). On sync, backend validates and updates Work Core.

### AP5 — Geofence Check-In

Mobile app has location permission. Technician arrives at site; device detects geofence (Site boundary from Location Core). App prompts "Check in?" Technician confirms. App creates OSR with checkedInAt + GPS. On sync, backend records check-in event; SLA Core clock is notified (e.g., response-time SLA may stop if present).

### AP6 — Offline Photo Upload

Technician photographs installation on device (camera permission granted). Photo stored encrypted locally. On sync, photo is uploaded to Storage Core in batch; Document entity is created linking photo to WorkItem. Mobile clears local photo after successful upload.

### AP7 — Battery-Friendly Sync

Backend publishes mobile config with syncInterval = 60 minutes (low-traffic periods). During active work (Dispatch tab open), interval = 5 minutes. User can force manual sync. App respects Do Not Disturb; sync scheduled for quiet times.

## 13. Forbidden Patterns

### FP1 — Offline Writes Bypass Audit

An offline write that does not create an OfflineSyncRecord with full context (userId, deviceId, timestamp, payload). All offline writes must be auditable.

### FP2 — Offline State-Transition Without Gating

A technician offline-writes WorkItem.state = COMPLETED without passing through Approval Core validation. Forbidden. Approval-gated transitions must queue (OSR.status = PENDING_APPROVAL_OFFLINE) and fail on sync if denied.

### FP3 — Server-Side Decision in Mobile Conflict

Mobile app deciding "server is probably wrong, let me overwrite it" without user interaction. Forbidden. Server wins by default (L2); user is notified and can reapply if desired (must be online).

### FP4 — Device Trust Ignored

A mobile client syncing without a valid DeviceTrustRecord. Forbidden. Backend requires device attestation before accepting OSRs.

### FP5 — Location Tracked Without Permission

Mobile app sending location to backend without user having granted location permission. Forbidden. Location permission is explicit OS-level grant. Violation results in app suspension.

### FP6 — Business Logic Only in Mobile

A field-technician workflow step that is enforced only in mobile app UI and not in backend state machine. Forbidden. Workflows are Workflow Core authority; mobile enforces UX only.

### FP7 — Push Action Ignored After Expiry

Mobile app executing a PushAction after its expiresAt timestamp. Forbidden. App must validate TTL; expired actions are discarded.

### FP8 — Unencrypted Sensitive Data on Device

Storing passwords, OAuth tokens, or PII in plaintext files. Forbidden. All sensitive data is encrypted with device-scoped keys or OS keychain.

### FP9 — Remote Wipe Not Executed

A revoked device continuing to sync as if still trusted. Forbidden. Next API contact must result in immediate wipe.

### FP10 — Approval-Gated Transitions Written Offline

No approval-gated transitions can be written offline. If a mobile write requires approval, the OSR status must be PENDING_APPROVAL_OFFLINE; on sync, the approval chain is evaluated by the backend. Attempting to transition without backend approval validation is forbidden.

### FP11 — Silent Offline Writes

All offline writes must be queued and visible to the user. Every OSR must appear in Offline Status; user must see what is pending and what failed. Silent or invisible sync operations are forbidden.

### FP12 — Mobile Client Overwrites Server State

Mobile client cannot force-overwrite server state without explicit user instruction on the next online session. Server is authoritative on conflicts; client accepts server win by default.

### FP13 — Delayed Device Revocation

A revoked device continuing to sync as if still trusted is forbidden. On next network contact, a revoked device must be immediately wiped and locked out without exception.

### FP14 — Incomplete Offline Write Audit

Every OSR must carry userId, deviceId, timestamp, payload, and context for audit. On sync, the full trail must be recorded in Audit Core. Offline writes without complete audit context are forbidden.

### FP15 — Mobile Users Bypass Permissions

Mobile users cannot fake OS-level permissions. Location, camera, biometric, and push permissions are explicit grants; app cannot simulate consent or work around OS denial.

### FP16 — Polling Loops in Mobile App

Backend publishing APIs with polling requirements violates battery and bandwidth budgets. Mobile app must not implement polling loops; sync must be push-driven or interval-based with respect for device state (connectivity, battery, Do Not Disturb).

## 14. Cross-Architecture Dependencies

| Upstream (required reading)                              |
|---------------------------------------------------------|
| `PLATFORM_REFERENCE_MODEL.md` (Mobile Core definition) |
| `01_PLATFORM_CORE_ARCHITECTURE.md` (core ownership)     |
| `05_OPERATIONAL_ARCHITECTURE.md` (field execution)      |
| `01-strategic-product-direction.md` (mobile-complete)   |

| Downstream (depend on this document)                    |
|---------------------------------------------------------|
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (mobile UI layout)   |
| `08_PERMISSION_ARCHITECTURE.md` (mobile OS permissions) |
| `10_API_ARCHITECTURE.md` (mobile API contracts)         |
| `11_EVENT_ARCHITECTURE.md` (sync / conflict events)     |
| `13_SECURITY_ARCHITECTURE.md` (device trust, encryption)|
| `14_TENANT_ARCHITECTURE.md` (multi-device per tenant)   |
| `18_OBSERVABILITY_ARCHITECTURE.md` (sync metrics)       |

## 15. Implementation Requirements

### 15.1 Mobile app package

`frontend/mobile/` (or `mobile/app/` if standalone):
- Bootstrap, auth, shell navigation.
- Sync engine (OfflineSyncRecord CRUD, queue, retry).
- Conflict resolution UI (display, user guidance).
- Device trust registration (on first launch).
- Field technician workflow screens.

### 15.2 Backend Mobile API

`backend/app/cores/mobile/` (or `backend/app/services/mobile.py`):
- OfflineSyncRecord accept, validate, conflict detection.
- DeviceTrustRecord registry, attestation, revocation.
- PushAction issuance and expiry.
- Mobile-optimized endpoints (compressed, delta, paginated).

### 15.3 Database schema

Tables:
- `offline_sync_records` (OSR store)
- `conflict_records` (conflict audit trail)
- `device_trust_records` (device registry + revocation status)
- `push_actions` (PushAction ledger)

All tenant-scoped. All audit-logged.

### 15.4 Migration: Add mobile-specific columns

Work Core: `WorkItem.checkedInAt`, `WorkItem.checkInLocation`, `WorkItem.mobileCompletedAt`.
Document Core: `Document.capturedOn` (mobile device timestamp), `Document.mobileUploadedAt`.
Audit Core: `AuditLog.offlineSyncRecordId` (linkage for offline writes).

### 15.5 Background job: Sync cleanup

Daily job: Archive old OfflineSyncRecords (synced > 30 days ago). Retain ConflictRecords indefinitely for audit.

### 15.6 Observability

Mobile metrics (Observability Core):
- Sync latency (time from OSR creation to synced).
- Conflict rate (% of OSRs with conflicts).
- Offline session duration (longest gap without sync).
- Device revocation rate.
- Push action execution rate.

### 15.7 Drift check

`tools/check_drift.py` adds:
- No business logic in mobile app UI that is not reflected in backend state machine.
- All OSRs must have userId + deviceId + tenantId.
- All DeviceTrustRecords must have revocationStatus before sync is accepted.

### 15.8 Quality gate: Approval-Gated Transitions

Backend validation pipeline must reject any OfflineSyncRecord with action = STATE_TRANSITION for approval-gated workflows unless OSR.status = PENDING_APPROVAL_OFFLINE. The approval chain must be evaluated server-side; denied approvals must surface to user with explanation.

### 15.9 Quality gate: Offline Write Visibility

Every OfflineSyncRecord must be queryable and displayable in the Offline Status UI. Mobile app must provide status query endpoint returning all pending, synced, conflicted, and failed OSRs. User must have visibility into sync queue at all times.

### 15.10 Quality gate: Server Authoritative Conflict Resolution

Backend must implement deterministic conflict resolution: safe-field merges (CRDT-style) succeed silently; unsafe-field conflicts result in server-wins with ConflictRecord audit and user notification. Mobile app must not override server decisions without explicit online-session user action.

### 15.11 Quality gate: Immediate Device Revocation

Any DeviceTrustRecord with revocationStatus = REVOKED must trigger immediate cache clear and app lockout on next API contact. Backend must return HTTP 403 + "DEVICE_REVOKED" code; mobile must interpret and execute remote wipe without delay or prompting.

### 15.12 Quality gate: Complete Audit Context

Every OfflineSyncRecord must be created with userId, deviceId, tenantId, timestamp (UTC), payload, and auditContext (user agent, IP-at-sync, GPS-approx, WiFi-SSID-hash). Signing hash (HMAC-SHA256 of payload + deviceTrustKey) must be computed and stored. OSRs missing any required context are rejected at creation.

### 15.13 Quality gate: OS Permission Enforcement

Mobile app must honor OS-level permission grants at all times. Location data must not be sent if location permission is NEVER or DENIED. Camera capture must fail if camera permission is DENIED. App cannot simulate permission consent or work around OS denial. Permission violation results in app suspension.

### 15.14 Quality gate: Battery and Bandwidth Budgets

Backend must publish mobile-aware API contracts: no polling endpoints; sync intervals configurable per network state; payloads compressed; delta sync (changes since checkpoint); paginated responses. Mobile app must not implement polling loops. Violation results in platform rejection.

## 16. Future Expansion Rules

### 16.1 Multi-App Instances Per Device

Future: a device may run multiple instances (e.g., technician logs out / logs in as different user). Each instance is a separate DeviceTrustRecord; on logout, only that instance is cleared; on login, new instance registers.

### 16.2 Predictive Sync Scheduling

Future: ML model learns offline-session patterns. Backend predicts when mobile user will be in field and initiates preemptive sync (push initial data to device before technician asks).

### 16.3 Voice-Driven Workflows

Future: voice commands for gloved-hand operation. "Complete this job", "Check in", "Capture signature" via voice recognition and NLP.

### 16.4 Offline Video Capture

Future: short video clips (< 1 min) captured on device, stored encrypted, streamed on sync (not batch).

### 16.5 Multi-Tenant Mobile App

Future: single mobile app instance switching between tenants (for partner technicians working across multiple ISP brands). Each tenant context is separate DeviceTrustRecord; RLS rules prevent cross-tenant data leakage.

### 16.6 Integration with Inventory Core

Current: mobile app reports consumption via manual input or barcode scan. Future: real-time inventory sync (warehouse updates push to device), auto-deduction on submission.

---

*End of 22 — Mobile / Offline Architecture.*
