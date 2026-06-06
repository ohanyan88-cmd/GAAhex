# 15 — Reporting Architecture

**Constitutional document.** Position in the hierarchy: governed by `PLATFORM_REFERENCE_MODEL.md` and `01_PLATFORM_CORE_ARCHITECTURE.md`. Reporting is a first-class Intelligence Tier core, distinct from Analytics. Hard boundary: Reporting produces **governed, scheduled, extractable outputs**; Analytics **explains performance via insights**.

---

## 1. Purpose

Define the architecture of the Reporting Core — how reports are defined, scheduled, executed, rendered, permissioned, localized, audited, delivered, and retained. Establish the rules that make reports trustworthy operational and commercial documents.

---

## 2. Scope

**In scope:**
- Report definitions (templates, parameters, permissions).
- Report scheduling and Time Core integration.
- Report execution and rendering (PDF, Excel, CSV).
- Permission-aware row-level redaction and field masking.
- Tenant-scoped and multi-tenant (Super Admin) reporting.
- Localization of report content and formatting.
- Scheduled delivery (email, webhook, file drop via Integration Core).
- Report file lifecycle, retention, and legal hold.
- Self-service reporting (Studio): tenant-authored ReportDefinitions.
- Audit on every run and export.

**Out of scope (handled by other cores):**
- KPI definitions (Analytics Core; Reporting references them).
- Ad-hoc query builders or SQL editors (forbidden).
- Dashboard datasets (Analytics Core).
- Raw event store (Event Core).
- Search-saved-view logic (Search Core; promoted views become Reports).

---

## 3. Goals

1. **Enable governed, reproducible reporting** — reports are scheduled, version-controlled, and produce identical results when re-run with the same parameters.
2. **Enforce permission transparency** — users see only rows and fields they are authorized to view; no silent filtering or aggregate leakage.
3. **Support operational and compliance use cases** — reports serve audit trails, billing, regulatory submissions, and team dashboards.
4. **Enable tenant self-service reporting** — tenants author and schedule their own reports via Studio without coding.
5. **Ensure traceability from output to source** — every report row is traceable to its source entity, event, or audit record.
6. **Integrate with enterprise delivery workflows** — reports are deliverable via email, webhook, file drop, and archival systems.

---

## 4. Non-Goals

1. **Ad-hoc SQL query builders** — Reporting is declarative, not programmatic. Users select tables, filters, and columns; they do not write SQL.
2. **Real-time streaming reports** — Reporting is batch/scheduled. Real-time analytics are handled by Analytics Core.
3. **Hardcoded custom reports** — all reports are defined via ReportDefinition; custom reports must follow the same framework.
4. **Cross-tenant data fusion (for normal users)** — normal users cannot join data across tenants. Super Admins may, with explicit audit.
5. **Report designer UI complexity beyond Studio** — advanced transforms (pivot tables, UDF formulas) are out of scope for Studio; such reports are authored by platform engineers.

---

## 5. Architecture Principles

### P1 — Reporting ≠ Analytics

Reporting produces governed, reproducible, extractable outputs for operational and regulatory use. Analytics explains performance via KPIs, trends, and dashboards. They have different owners (Reporting Core vs. Analytics Core), audiences, and enforcement boundaries.

| Aspect | Reporting | Analytics |
|--------|-----------|-----------|
| **Purpose** | Produce governed, reproducible, extractable outputs | Explain performance via KPIs, trends, dashboards |
| **Audience** | Operational teams, auditors, regulators, customers | Managers, executives, strategic planners |
| **Format** | PDF, Excel, CSV, email, file drop | Dashboard widgets, embedded charts, KPI tiles |
| **Frequency** | Scheduled, on-demand, batch | Real-time, streaming, interactive |
| **Ownership** | Reporting Core | Analytics Core |
| **Traceability** | Row-level: row → source object → event/audit | Aggregate-level: KPI definition → formula → data sources |
| **Permission** | Enforced at row and field level | Enforced at dataset / dimension level |
| **Export** | Preserves filters, restrictions, masking | Preserves aggregations, dimensions, time granularity |

### P2 — Report ≠ Search Saved View

A Saved View (Search Core) is a re-executable filter + column set over a table. A Report (Reporting Core) is a snapshot-or-scheduled render of filtered data into a document format (PDF, Excel, CSV) with title, headers, footer, branding, and optional delivery schedule. A Saved View may be **promoted** to a Report if it acquires a schedule, delivery, or formal export requirement.

### P3 — Three-Layer Permission Checking

Reporting enforces three independent permission layers: (1) report permission (`report.<report_id>.view`, `.schedule`, `.export`), (2) data permission (user must have permission to view the underlying objects), and (3) field permission (restricted fields are hidden unless explicitly permitted).

### P4 — Immutability & Versioning

A ReportDefinition is immutable after release; changes create a new version. Scheduled reports reference a specific version, not a mutable definition. This ensures reproducibility: a report scheduled at 9 AM Monday always runs against the version that was active when the schedule was created.

### P5 — Single Source of Truth

A report sources data only from canonical entities, approved read models (Analytics Core), audit tables (Audit Core), or Timeline views. It never invents, recalculates, or derives business truth outside these sources.

### P6 — Tenant Isolation by Default

Report data is tenant-scoped. Single-tenant reports are visible only to users in that tenant. Multi-tenant reports (Super Admin only) require an explicit tenantId parameter; the query filters to that tenant. Normal users never see data from another tenant, even in a "multi-tenant report."

---

## 6. Architecture Laws

### L1 — Single Source of Truth

A report sources data only from canonical entities, approved read models, or audit tables. It never invents or recalculates business truth.

### L2 — Permission Enforcement

Every report row and field is subject to the same permission rules as the source object. If a user cannot view a Case, they cannot report on it. No exceptions for Super Admins reporting on their own tenant's data (audit logs apply).

### L3 — Tenant Isolation

Report data is tenant-scoped. Cross-tenant reports are Super Admin only, require explicit tenantId parameter, and are audited.

### L4 — Immutable Scheduled Reports

Once a ReportSchedule is active, its definition reference is immutable. Changes to the report schedule itself (e.g., recipients, delivery frequency) create a new schedule entry, not modify the running one.

### L5 — Traceability

Every aggregate (count, sum, average) in a report is traceable to source rows, which are traceable to source events or audit records. Untraced aggregates are forbidden.

### L6 — No Hidden Counts

Report counts never include records the user is not authorized to view. When a user filters a Case report and rows are excluded due to permission, the row count reflects only permitted records. Aggregate leakage is forbidden.

### L7 — Audit Universality

Every report run, delivery attempt, and file access is audited. Silent failures are forbidden; users are notified of generation or delivery failures via email or in-app alert.

### L8 — Localization Consistency

Status and enum values in reports are always canonical (e.g., `ACTIVE`), never translated labels. Display labels and report metadata are translated via Localization Core. Date, currency, and number formatting respect tenant locale.

### L9 — Field Masking Integrity

Fields marked `sensitive: true` are omitted from CSV/Excel export and email delivery unless the user has explicit permission. No partial redaction (e.g., showing first letter only); fields are either visible or hidden.

---

## 7. Core Concepts

### 7.1 ReportDefinition

A **template** that defines:
- Name, description, report type (operational/commercial/compliance/custom).
- Primary data source (table / view / approved aggregate).
- Filters (mandatory + optional parameters).
- Column selection and display rules (order, labels, alignment, masking).
- Sorting and grouping rules.
- Permission gate: who may view, schedule, export this report.
- Tenant scope: single-tenant or multi-tenant (Super Admin only).
- Localization: which fields are translatable.
- Schedule template (if scheduled by platform or users).

**Invariant:** A ReportDefinition is immutable after release; changes create a new version. Scheduled reports reference a version, not a mutable definition.

### 7.2 ReportParameter

A named, typed input to a ReportDefinition, with validation rules:
- Name (camelCase, e.g., `startDate`, `tenantId`, `departmentId`).
- Type (string, date, UUID, enum, multi-select).
- Required flag.
- Default value (if optional).
- Validation: range, enum values, format (e.g., date format), dependency rules.
- Tenant scope: parameter must respect tenantId if it filters cross-tenant data.

**Invariant:** Parameters must never bypass tenant isolation. A parameter like `?customerId=...` is server-validated against the user's tenant scope.

### 7.3 ReportSchedule

A cron or calendar rule (via Time Core) that defines when a report is generated and delivered:
- Cron expression (e.g., `0 9 * * MON` = every Monday at 9 AM).
- Timezone (from tenant or user preference).
- Active flag (may be paused).
- Delivery destinations (email addresses, webhook URLs, file drops).
- Recipient notification rules (on success, on failure, on change in row count).
- Retention policy (how long to keep generated files).

**Invariant:** Schedules are tenant-scoped. A user may create a schedule only within their tenant.

### 7.4 ReportRun

An **execution record** of a ReportDefinition at a point in time:
- Unique ID (UUIDv7) + reference number (`RPT-...`).
- Tenant ID (mandatory; server-assigned).
- Definition version (immutable reference).
- Parameters used (for reproducibility).
- Status: `QUEUED, GENERATING, COMPLETED, FAILED, EXPIRED`.
- Row count (actual records returned; auditable against definition).
- Generated file IDs (one per format: PDF, Excel, CSV).
- Executed by (user ID or system job).
- Started/finished timestamps.
- Error detail (if failed).

**Invariant:** A ReportRun is immutable once completed. Logs are never deleted; they are archived and retained per the tenant's retention policy.

### 7.5 GeneratedReportFile

A **blob** in Storage Core:
- Content type (application/pdf, application/vnd.ms-excel, text/csv).
- Size in bytes.
- Virus scan status.
- Signed URL (expires, usually 7 days).
- Retention expiry date (for legal hold, compliance, archival).
- Access log: who downloaded it, when.

**Invariant:** Files are stored in a tenant-scoped folder. Access is always checked against the user's tenant and the report's permission gate.

### 7.6 Report Rendering via Template Core

Reports are rendered using Template Core:
1. **Template selection** by report type and format (PDF, Excel, CSV).
2. **Data binding** from the query result into template placeholders.
3. **Localization** of labels, headers, and computed text.
4. **Pagination** for PDF/Excel (headers/footers on each page).
5. **Branding** (tenant logo, color scheme, from Localization Core).

**PDF Rendering:**
- Headers: report title, tenant name, run date.
- Footers: page number, retention notice (e.g., "Confidential — Retain 7 Years").
- Watermark: tenant branding or classification (optional).
- Table formatting: borders, striping, condensed font for dense data.
- Rotation to landscape if needed for wide columns.

**Excel Rendering:**
- Worksheets: one per grouped result set (if report is grouped).
- Column headers with freeze-panes.
- Data types: dates as date cells (not text), numbers unformatted (allow user formatting).
- Conditional formatting: optional highlighting by row status (e.g., red for FAILED, green for COMPLETED).
- No images or complex objects (only cell data).

**CSV Rendering:**
- UTF-8 encoding.
- RFC 4180 compliant (quoted fields with embedded commas).
- No header styling or merge cells.
- First row: column names (localized label or canonical name per report config).
- One row per record; no grouping or subtotals in CSV (users import into Excel for analysis).

### 7.7 Report Scheduling via Time Core

Report schedules use Time Core for timezone-aware, business-hours-aware scheduling:
- **Cron expression:** canonical, timezone-aware.
- **Business hours:** reports may be scheduled only during tenant's business hours (configurable).
- **Holidays:** reports skip holidays per tenant's holiday calendar (Time Core).
- **Backoff:** if a run fails, the next execution is the next scheduled slot, not immediately.

---

## 8. Canonical Entities

The Reporting Core owns these entities:

1. **ReportDefinition** — describes a report template (name, source, filters, columns, permissions).
2. **ReportParameter** — a typed input to a ReportDefinition (e.g., `startDate`, `customerId`).
3. **ReportSchedule** — a cron rule + delivery destinations for recurring report execution.
4. **ReportRun** — an execution record (timestamp, status, row count, file references).
5. **GeneratedReportFile** — a blob entry (PDF, Excel, CSV) in Storage Core with metadata.
6. **ReportAccess** — audit log of file downloads and access.

---

## 9. Ownership Boundaries

**Reporting Core owns:**
- Report definitions and versions.
- Report scheduling (cron, delivery rules).
- Report execution and parameter validation.
- Report rendering (PDF, Excel, CSV via Template Core).
- Report file storage metadata and lifecycle.
- Report audit events.

**Reporting Core borrows from:**
- **Data from:** Business Object, Execution, Commerce cores (canonical entities); Analytics Core (read models); Audit Core (audit tables); Timeline views.
- **Services:** Template Core (rendering), Time Core (scheduling), Integration Core (email/webhook/SFTP), Storage Core (blob storage), Localization Core (translations, formatting), Audit Core (immutable logs), Event Core (domain events), Compliance Core (legal hold).

**Reporting Core does NOT own:**
- Analytics definitions or KPIs (Analytics Core).
- Search Saved Views (Search Core; Reporting promotes them).
- Raw events or audit records (Event Core, Audit Core).

---

## 10. Relationships

### 10.1 Data Source Rules

Reports may only read from:

1. **Approved business tables** (entities owned by Business Object / Execution / Commerce cores).
2. **Standardized read models** (Analytics Core; pre-aggregated, permission-safe).
3. **Timeline views** (approved, permission-safe time-series views of audit + event history).
4. **Audit tables** (Audit Core; for compliance/forensics reports).

Every report result row must be **traceable:**
- Row → canonical source entity (e.g., case ID).
- Entity → source event or audit record (timestamp, actor, change).
- Change → business reason (via audit context).

**Audit Log Comment Example:**
```
Report run: RPT-20260606-001 | Report: "Cases by Status" | Row: case_123 | Source: case.status_changed_event @ 2026-06-05T14:22:00Z | Event ID: evt-7f8a9...
```

### 10.2 Delivery via Integration Core

Generated reports are delivered to:

**Email:**
- Recipients from ReportSchedule (manager's email, team email list).
- Subject line: `{ReportName} — {Date} — {TenantName}`.
- Body: summary stats (row count, filters applied), download link, expiry notice.
- Attachment: PDF or Excel file (configurable per schedule).
- Reply-to: support email (no bounce-back replies).

**Webhook:**
- POST to registered webhook URL.
- Body: JSON with report metadata + signed download URL.
- Retry: up to 5 retries with exponential backoff (up to 24 hours).
- Signature: HMAC-SHA256 for verification (Integration Core standard).

**File Drop:**
- SFTP, S3, or mounted file system (configured by Super Admin).
- Directory: `/reports/{tenant_id}/{year}/{month}/`.
- Filename: `{report_name}_{date}_{run_id}.{ext}` (e.g., `monthly_invoices_2026-06-06_RPT-123.xlsx`).
- Metadata file (JSON sidecar) with row count, filter summary, permission scope.

**Delivery Audit:**
Every delivery attempt is audited:
- Timestamp, destination (email / webhook URL / file path).
- Success or failure (reason if failed).
- Recipient confirmation (if applicable).

### 10.3 Report Scheduling Execution

1. Background Processing Core spawns a job at the scheduled time.
2. Job loads the ReportDefinition (specific version).
3. Job applies default parameters (from schedule definition).
4. Job queries the data source with permission filtering.
5. Job renders to all formats (PDF, Excel, CSV).
6. Job stores files in Storage Core (tenant-scoped folder).
7. Job triggers delivery.
8. Job records the ReportRun (status: COMPLETED or FAILED).
9. Job emits audit event + domain event (Report.Generated).

**SLA for Scheduled Reports:**
- **Target:** 95% of reports generated within 30 seconds of schedule time (within tenant's business hours).
- **Timeout:** if generation exceeds 5 minutes, mark as FAILED and alert.
- **Retry:** up to 3 retries on transient errors, then escalate.

### 10.4 Report File Lifecycle & Retention

**Retention Policy:**
- **Default:** 7 years (configurable per tenant).
- **Super Admin override:** Legal hold extends retention indefinitely.
- **Automatic deletion:** files older than retention date are purged; deletion is audited.

**Legal Hold:**
- Explicit flag set via Compliance Core.
- Prevents deletion of matching reports (by date range, definition, tenant).
- Audit log records hold reason and duration.
- Hold release requires compliance officer sign-off.

**Storage Layout:**
```
blob_storage/
  reports/
    {tenant_id}/
      {year}/
        {month}/
          {report_run_id}/
            {report_run_id}.pdf
            {report_run_id}.xlsx
            {report_run_id}.csv
            metadata.json
```

**Access Control on Files:**
- User may download a file only if they have permission to view the report.
- Signed URL (7-day expiry) prevents unauthenticated downloads.
- Download is logged (access audit).
- If user's permission is revoked, existing links become invalid.

---

## 11. Responsibilities

### 11.1 Permission Model

Reporting enforces **three-layer permission checking**:

1. **Report permission** (`report.<report_id>.view`, `report.<report_id>.schedule`, `report.<report_id>.export`).
2. **Data permission** (user must have permission to view the underlying objects in the report).
3. **Field permission** (fields marked `restricted: true` in the report definition are hidden unless the user has explicit permission).

**Row-Level Redaction:**
If a report source includes records that the user is not permitted to view:
- The record is **filtered out** (never included in the result set).
- The **row count** reflects only permitted records (no hidden-count leakage).
- Aggregates (SUM, COUNT, AVG) are recalculated over permitted records only.

**Example:** A report of "All Cases by Status" for a user with `case.view` permission only on cases assigned to their department will show only those cases in the OPEN count, never a total that includes hidden cases.

**Field Masking:**
Report columns may be marked `sensitive: true`. If marked, the field is:
- Hidden from the report UI unless the user has explicit permission (e.g., `case.view_sensitive_fields`).
- Omitted from CSV/Excel export unless permitted.
- Redacted in email delivery (subject to tenant configuration).

**Example:** A "Customer Contact Report" may mark `phone_number` and `email` as sensitive; only users with explicit permission see them.

**Tenant Isolation in Reports:**
- **Single-tenant report:** visible only to users in that tenant.
- **Multi-tenant report** (Super Admin only): Super Admins may view aggregated data across all tenants; a parameter forces tenantId selection, and the query filters to that tenant only.
- A normal user may **never** see data from another tenant, even in a "multi-tenant report."

### 11.2 Self-Service Reporting (Studio)

Tenants may author their own ReportDefinitions via Studio:

**Studio Controls:**
- **Data source selector:** UI presents only permitted tables (based on user's data permission).
- **Filter builder:** drag-and-drop parameters (validated via Data Validation Standard).
- **Column picker:** select, order, rename (tenant-specific label; canonical name immutable).
- **Preview:** live 100-row preview (respects user's permission filters).
- **Publish:** creates ReportDefinition in DRAFT; tenant admin approves to make it live.
- **Schedule creation:** UI to set cron + delivery destinations.

**Studio Guardrails:**
- **Permission gate:** only users with `report.author` permission may use Studio.
- **Data source restriction:** author may only select tables their department/role has `view` permission on.
- **No raw SQL:** filter builder produces safe, parameterized queries only.
- **Validation:** report definition is validated before save (required columns, parameter types, etc.).
- **Audit:** every save, publish, schedule change is audited.

**Studio Metadata:**
Each tenant-authored ReportDefinition carries:
- `createdBy` (user ID).
- `createdAt`.
- `lastModifiedBy`.
- `lastModifiedAt`.
- `version` (incremented on each change).
- `approvedBy` (admin who published it, if in DRAFT).
- `status` (DRAFT, ACTIVE, DEPRECATED, RETIRED).

### 11.3 Audit & Events

Every report action is audited:

**Audit Events:**
- **ReportDefinition created/updated/published/deprecated:** who, when, what changed.
- **ReportSchedule created/paused/resumed/deleted:** who, when, schedule details.
- **ReportRun started/completed/failed:** timestamp, status, row count, error detail.
- **Report file downloaded:** user, timestamp, file format, IP address.
- **Report delivered:** destination, success/failure, timestamp.
- **Legal hold applied/released:** reason, who, when.

**Domain Events:**
- `Report.DefinitionCreated` → `{reportDefinitionId, tenantId, createdBy}`.
- `Report.ScheduleCreated` → `{reportScheduleId, reportDefinitionId, tenantId}`.
- `Report.RunStarted` → `{reportRunId, reportDefinitionId, tenantId, parametersHash}`.
- `Report.RunCompleted` → `{reportRunId, rowCount, generatedFiles, duration}`.
- `Report.RunFailed` → `{reportRunId, errorMessage, retryCount}`.
- `Report.Delivered` → `{reportRunId, destination, status}`.
- `Report.FileAccessed` → `{reportRunId, userId, format, timestamp}`.

**Invariant:** Every domain event carries `tenantId` and `occurredAt` (UTC timestamp).

---

## 12. Allowed Patterns

### AP1 — Report Version Chaining

When a ReportDefinition changes, create a new version and reassign all active schedules to it. Old versions remain in the archive for historical run recovery. A ReportRun always references its definition version, making re-execution of a historical report possible.

### AP2 — Saved View Promotion

A Search Core "Saved View" may be promoted to a Report:
1. User saves a filter+column set in Search (standard Save View flow).
2. User clicks "Promote to Report" → UI opens Studio with the saved view pre-loaded.
3. User names the report, sets a schedule (optional), configures delivery.
4. Promotion creates a ReportDefinition + optionally a ReportSchedule.
5. Original Saved View remains; Report becomes the scheduled, deliverable version.

**Invariant:** Promotion is idempotent; promoting the same Saved View twice updates the Report rather than creating duplicates.

### AP3 — On-Demand vs. Scheduled Duality

A single ReportDefinition may be executed on-demand (user-triggered, synchronous or queued) or scheduled (cron-triggered, background job). Both flows use the same execution engine, permission rules, and audit trail. The only difference is trigger source (user vs. time).

**On-Demand Report:**
- User clicks "Generate Report" → form to enter parameters.
- Backend validates parameters (type, range, tenant scope).
- Report is generated synchronously (if < 10 seconds) or queued.
- User is redirected to the report view or notified when ready (if queued).
- File is available for download (7-day expiry).

**Scheduled Report:**
- ReportSchedule defines cron, recipients, delivery format.
- Background job generates the report at the scheduled time.
- Files are auto-delivered to email, webhook, or file drop.
- User may manually trigger a run via "Generate Now" button.
- Historical runs are visible in a "Report Runs" table (searchable, filterable).

### AP4 — Multi-Format Output

A single ReportRun generates PDF, Excel, and CSV output simultaneously. Each format uses the same data query and permission filtering but applies format-specific rendering rules (pagination for PDF, worksheets for Excel, RFC 4180 for CSV). Users select which format(s) to download.

### AP5 — Parameter-Driven Filtering

ReportDefinition filters are **declarative parameters**, not raw SQL predicates. The filter builder generates parameterized queries with type validation, enum restriction, and date range bounds. Parameters are server-validated and audit-logged before execution.

### AP6 — Localization-Aware Rendering

Reports render with locale-aware formatting:
- Status/enum values are always canonical (`ACTIVE`); display labels are translated.
- Date format respects tenant locale (DD/MM/YYYY vs. MM/DD/YYYY).
- Currency and number formatting use tenant locale and precision.
- Column headers and report names are translated via Localization Core.
- Missing translations fall back to default language with a warning log.

### AP7 — Permission-Respecting Aggregates

Aggregates (SUM, COUNT, AVG) in a report are calculated **post-permission filtering**. If a user cannot view 50 of 100 records, the COUNT is 50, not 100. Aggregates are never cached or pre-computed; they reflect the user's permitted view of data at execution time.

---

## 13. Forbidden Patterns

### FP1 — Ad-Hoc SQL

Users may not write raw SQL. Reports use structured filters only (parameter-driven declarative queries).

### FP2 — Reports that Bypass Permissions

A report must enforce the same permission rules as the source object. If a user cannot view a Case, they cannot report on it. No exceptions, no audit-trail workarounds.

### FP3 — Cross-Tenant Data Fusion (Normal Users)

A normal user's report may not join Customer data from Tenant A with Case data from Tenant B. (Super Admin reports may, with explicit tenant parameter + audit trail.)

### FP4 — Hardcoded Translated Labels as Values

Never store or filter on `"Active"` (English label) or `"Ակտիվ"` (Armenian label) in the report logic; always use canonical `ACTIVE`. Translations are applied only at render time.

### FP5 — Silent Failures

If a scheduled report fails to generate or deliver, the user is notified (email, in-app alert). No silent failures; every error is logged and surfaced.

### FP6 — Untraced Aggregates

A SUM or COUNT in a report must be traceable to source rows, not calculated outside the report engine. Pre-computed aggregates (cached KPIs) are Analytics Core territory, not Reporting.

### FP7 — Deprecated Field Names

Reports may not read from deprecated column names. Schema migrations must map old columns to new ones; reports always use canonical names.

### FP8 — Ungoverned Custom Fields

Reports may not read raw JSON blobs or unstructured "custom fields." Use Metadata Core for contextual data; all report fields must be formally defined in the ReportDefinition.

### FP9 — Frontend Caches as Sources

Reports may not source data from frontend caches or local storage. All data is server-fetched, permission-filtered, and audit-logged.

### FP10 — Mutable Scheduled Definitions

Once a ReportSchedule references a ReportDefinition version, that version is immutable. Changes to the report definition require creating a new version and updating the schedule to reference it (not in-place mutation).

---

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Reporting Core definition, status. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership, tier discipline. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys (`report.view`, `report.schedule`, etc.). |
| `09_DATA_ARCHITECTURE.md` | Canonical entities, cross-core FK rules. |
| `10_API_ARCHITECTURE.md` | REST surface for report CRUD, scheduling, runs. |
| `11_EVENT_ARCHITECTURE.md` | Event topics: `Report.*` events. |
| `13_SECURITY_ARCHITECTURE.md` | Field masking, signed URLs, encryption. |
| `14_TENANT_ARCHITECTURE.md` | Tenant scoping, multi-tenant boundaries. |
| `standards/08-reporting-import-export-...md` | LOCKED: Reporting & Analytics, Localization, Multi-Tenant, Configuration. |
| `../specs/REPORTING-DELIVERY.md` | Scheduled reports + record export formats + delivery chain implementation contract. |
| `../specs/BILLING.md` | Invoice template rendering (Template Core integration). |
| `../specs/NOTIFICATIONS-DEPTH.md` | Notification templates + delivery (Template Core integration). |

| Documents that depend on this one |
|---|
| `16_ANALYTICS_ARCHITECTURE.md` (clarifies separation from Reporting) |
| `Implementation roadmap` (report scheduling, delivery, Studio features) |

---

## 15. Implementation Requirements

### 15.1 API Surface

The Reporting Core exposes REST endpoints for:
- **CRUD on ReportDefinition:** POST (create), GET (list, detail), PATCH (update, publish, deprecate).
- **CRUD on ReportSchedule:** POST, GET, PATCH (pause, resume, update recipients).
- **ReportRun execution:** POST (on-demand trigger), GET (list runs for a definition), GET (detail).
- **File download:** GET with signed URL (7-day expiry).

All endpoints enforce three-layer permission checking (report + data + field).

### 15.2 Localization Requirements

1. **Report name and description:** translatable labels (via Localization Core).
2. **Column headers:** translatable (canonical name immutable in the schema).
3. **Status/enum values:** always canonical (e.g., `ACTIVE`), display label is translated (e.g., "Active" / "Ակտիվ").
4. **Date/time formatting:** respects tenant's locale (e.g., DD/MM/YYYY vs. MM/DD/YYYY).
5. **Currency:** displays with tenant's currency symbol and precision (via Localization Core).
6. **Numbers:** formatted per locale (e.g., 1,000.50 vs. 1.000,50).

**Fallback:** if a translation is missing, the report uses the default language (usually English) and logs a warning.

### 15.3 Storage & Lifecycle

Reports are stored in tenant-scoped blob folders following the structure:
```
blob_storage/reports/{tenant_id}/{year}/{month}/{report_run_id}/
  {report_run_id}.pdf
  {report_run_id}.xlsx
  {report_run_id}.csv
  metadata.json
```

Files are signed at generation; signed URLs expire in 7 days. Retention policy is enforced via background jobs (7 years default, configurable per tenant, overrideable by legal hold).

### 15.4 Scheduling via Time Core

Reports are scheduled using Time Core's cron engine with timezone awareness:
- Cron expressions (e.g., `0 9 * * MON` = every Monday at 9 AM).
- Timezone from tenant or user preference.
- Business-hours awareness (reports skip outside working hours if configured).
- Holiday awareness (reports skip configured holidays).
- Active flag (schedules may be paused without deletion).

### 15.5 Error Handling & Resilience

- **Generation failure:** marked FAILED, user notified, retried up to 3 times, then escalated.
- **Delivery failure:** up to 5 retries with exponential backoff (up to 24 hours).
- **Timeout:** if generation exceeds 5 minutes, marked FAILED.
- **Dependency failure:** if data source is unavailable, marked FAILED (no partial reports).

### 15.6 Permission Validation

All report reads enforce three-layer checking:
1. User has `report.view` (or `.schedule`, `.export`) on the report.
2. User has permission to view all source objects (no row leakage).
3. User has permission to view unrestricted fields (field masking applied).

Permission failures are audited but not returned to the user (standard security redaction).

---

## 16. Future Expansion Rules

1. **Report Templates:** Future: platform-managed report templates (compliance, regulatory, industry-standard) may be published by Super Admin and used as read-only base definitions.
2. **Advanced Transforms:** Future: Studio may support pivot tables, custom aggregations, or UDF formulas if wrapped in a governance layer (approval workflow, audit, version control).
3. **Real-Time Dashboarding:** Future: a report may be **streamed** to a real-time dashboard (separate from scheduled batches) if the data source supports it and permission rules are enforced per-frame.
4. **Cross-Core Report Composition:** Future: a report may compose data from multiple cores (e.g., Cases + Activities + Financials) if each core exposes a standardized read model and permission rules are harmonized.
5. **Bulk Report Generation:** Future: tenants may trigger bulk report generation (e.g., "generate for all customers") if guarded by a quota system and audit trail.
6. **Dynamic Localization:** Future: reports may infer locale from user preference or browser context rather than tenant default, if the Localization Core supports dynamic translation selection.
7. **Report Marketplace:** Future: a registry of reusable, shareable report templates (e.g., "Industry Standard: ISP Invoice Report") may be published and adopted across tenants.

---

*End of 15 — Reporting Architecture.*
