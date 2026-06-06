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

## 3. Strategic Distinctions

### 3.1 Reporting ≠ Analytics

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

### 3.2 Report ≠ Search Saved View

- **Saved View** (Search Core): a filter+column set over a table, re-executed on open.
- **Report** (Reporting Core): a snapshot-or-scheduled render of filtered data into a document format (PDF, Excel, CSV) with title, headers, footer, branding, and optional delivery schedule.
- A Saved View may be **promoted** to a Report if it acquires a schedule, delivery, or formal export requirement.

---

## 4. Core Concepts

### 4.1 ReportDefinition

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

### 4.2 ReportParameter

A named, typed input to a ReportDefinition, with validation rules:
- Name (camelCase, e.g., `startDate`, `tenantId`, `departmentId`).
- Type (string, date, UUID, enum, multi-select).
- Required flag.
- Default value (if optional).
- Validation: range, enum values, format (e.g., date format), dependency rules.
- Tenant scope: parameter must respect tenantId if it filters cross-tenant data.

**Invariant:** Parameters must never bypass tenant isolation. A parameter like `?customerId=...` is server-validated against the user's tenant scope.

### 4.3 ReportSchedule

A cron or calendar rule (via Time Core) that defines when a report is generated and delivered:
- Cron expression (e.g., `0 9 * * MON` = every Monday at 9 AM).
- Timezone (from tenant or user preference).
- Active flag (may be paused).
- Delivery destinations (email addresses, webhook URLs, file drops).
- Recipient notification rules (on success, on failure, on change in row count).
- Retention policy (how long to keep generated files).

**Invariant:** Schedules are tenant-scoped. A user may create a schedule only within their tenant.

### 4.4 ReportRun

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

### 4.5 GeneratedReportFile

A **blob** in Storage Core:
- Content type (application/pdf, application/vnd.ms-excel, text/csv).
- Size in bytes.
- Virus scan status.
- Signed URL (expires, usually 7 days).
- Retention expiry date (for legal hold, compliance, archival).
- Access log: who downloaded it, when.

**Invariant:** Files are stored in a tenant-scoped folder. Access is always checked against the user's tenant and the report's permission gate.

---

## 5. Permission Model

Reporting enforces **three-layer permission checking**:

1. **Report permission** (`report.<report_id>.view`, `report.<report_id>.schedule`, `report.<report_id>.export`).
2. **Data permission** (user must have permission to view the underlying objects in the report).
3. **Field permission** (fields marked `restricted: true` in the report definition are hidden unless the user has explicit permission).

### 5.1 Row-Level Redaction

If a report source includes records that the user is not permitted to view:
- The record is **filtered out** (never included in the result set).
- The **row count** reflects only permitted records (no hidden-count leakage).
- Aggregates (SUM, COUNT, AVG) are recalculated over permitted records only.

**Example:** A report of "All Cases by Status" for a user with `case.view` permission only on cases assigned to their department will show only those cases in the OPEN count, never a total that includes hidden cases.

### 5.2 Field Masking

Report columns may be marked `sensitive: true`. If marked, the field is:
- Hidden from the report UI unless the user has explicit permission (e.g., `case.view_sensitive_fields`).
- Omitted from CSV/Excel export unless permitted.
- Redacted in email delivery (subject to tenant configuration).

**Example:** A "Customer Contact Report" may mark `phone_number` and `email` as sensitive; only users with explicit permission see them.

### 5.3 Tenant Isolation in Reports

- **Single-tenant report:** visible only to users in that tenant.
- **Multi-tenant report** (Super Admin only): Super Admins may view aggregated data across all tenants; a parameter forces tenantId selection, and the query filters to that tenant only.
- A normal user may **never** see data from another tenant, even in a "multi-tenant report."

---

## 6. Report Rendering via Template Core

Reports are rendered using Template Core:

1. **Template selection** by report type and format (PDF, Excel, CSV).
2. **Data binding** from the query result into template placeholders.
3. **Localization** of labels, headers, and computed text.
4. **Pagination** for PDF/Excel (headers/footers on each page).
5. **Branding** (tenant logo, color scheme, from Localization Core).

### 6.1 PDF Rendering

- Headers: report title, tenant name, run date.
- Footers: page number, retention notice (e.g., "Confidential — Retain 7 Years").
- Watermark: tenant branding or classification (optional).
- Table formatting: borders, striping, condensed font for dense data.
- Rotation to landscape if needed for wide columns.

### 6.2 Excel Rendering

- Worksheets: one per grouped result set (if report is grouped).
- Column headers with freeze-panes.
- Data types: dates as date cells (not text), numbers unformatted (allow user formatting).
- Conditional formatting: optional highlighting by row status (e.g., red for FAILED, green for COMPLETED).
- No images or complex objects (only cell data).

### 6.3 CSV Rendering

- UTF-8 encoding.
- RFC 4180 compliant (quoted fields with embedded commas).
- No header styling or merge cells.
- First row: column names (localized label or canonical name per report config).
- One row per record; no grouping or subtotals in CSV (users import into Excel for analysis).

---

## 7. Data Source Rules

Reports may only read from:

1. **Approved business tables** (entities owned by Business Object / Execution / Commerce cores).
2. **Standardized read models** (Analytics Core; pre-aggregated, permission-safe).
3. **Timeline views** (approved, permission-safe time-series views of audit + event history).
4. **Audit tables** (Audit Core; for compliance/forensics reports).

**Forbidden:**
- Raw SQL queries typed into the UI (ad-hoc SQL is forbidden).
- Deprecated field names.
- Ungoverned custom fields (use Metadata Core for context, not raw JSON blobs).
- Frontend caches or local storage.
- Translated labels as values (canonical enum values only).

### 7.1 Source Traceability

Every report result row must be traceable:
- Row → canonical source entity (e.g., case ID).
- Entity → source event or audit record (timestamp, actor, change).
- Change → business reason (via audit context).

**Audit Log Comment Example:**
```
Report run: RPT-20260606-001 | Report: "Cases by Status" | Row: case_123 | Source: case.status_changed_event @ 2026-06-05T14:22:00Z | Event ID: evt-7f8a9...
```

---

## 8. Report Scheduling via Time Core

Report schedules use Time Core for timezone-aware, business-hours-aware scheduling:

### 8.1 Schedule Definition

- **Cron expression:** canonical, timezone-aware.
- **Business hours:** reports may be scheduled only during tenant's business hours (configurable).
- **Holidays:** reports skip holidays per tenant's holiday calendar (Time Core).
- **Backoff:** if a run fails, the next execution is the next scheduled slot, not immediately.

### 8.2 Execution

1. Background Processing Core spawns a job at the scheduled time.
2. Job loads the ReportDefinition (specific version).
3. Job applies default parameters (from schedule definition).
4. Job queries the data source with permission filtering.
5. Job renders to all formats (PDF, Excel, CSV).
6. Job stores files in Storage Core (tenant-scoped folder).
7. Job triggers delivery (next section).
8. Job records the ReportRun (status: COMPLETED or FAILED).
9. Job emits audit event + domain event (Report.Generated).

### 8.3 SLA for Scheduled Reports

- **Target:** 95% of reports generated within 30 seconds of schedule time (within tenant's business hours).
- **Timeout:** if generation exceeds 5 minutes, mark as FAILED and alert.
- **Retry:** up to 3 retries on transient errors, then escalate.

---

## 9. Delivery via Integration Core

Generated reports are delivered to:

### 9.1 Email

- Recipients from ReportSchedule (manager's email, team email list).
- Subject line: `{ReportName} — {Date} — {TenantName}`.
- Body: summary stats (row count, filters applied), download link, expiry notice.
- Attachment: PDF or Excel file (configurable per schedule).
- Reply-to: support email (no bounce-back replies).

### 9.2 Webhook

- POST to registered webhook URL.
- Body: JSON with report metadata + signed download URL.
- Retry: up to 5 retries with exponential backoff (up to 24 hours).
- Signature: HMAC-SHA256 for verification (Integration Core standard).

### 9.3 File Drop

- SFTP, S3, or mounted file system (configured by Super Admin).
- Directory: `/reports/{tenant_id}/{year}/{month}/`.
- Filename: `{report_name}_{date}_{run_id}.{ext}` (e.g., `monthly_invoices_2026-06-06_RPT-123.xlsx`).
- Metadata file (JSON sidecar) with row count, filter summary, permission scope.

### 9.4 Delivery Audit

Every delivery attempt is audited:
- Timestamp, destination (email / webhook URL / file path).
- Success or failure (reason if failed).
- Recipient confirmation (if applicable).

---

## 10. Report File Lifecycle & Retention

### 10.1 Retention Policy

- **Default:** 7 years (configurable per tenant).
- **Super Admin override:** Legal hold extends retention indefinitely.
- **Automatic deletion:** files older than retention date are purged; deletion is audited.

### 10.2 Legal Hold

- Explicit flag set via Compliance Core.
- Prevents deletion of matching reports (by date range, definition, tenant).
- Audit log records hold reason and duration.
- Hold release requires compliance officer sign-off.

### 10.3 Storage Layout

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

### 10.4 Access Control on Files

- User may download a file only if they have permission to view the report.
- Signed URL (7-day expiry) prevents unauthenticated downloads.
- Download is logged (access audit).
- If user's permission is revoked, existing links become invalid.

---

## 11. Self-Service Reporting (Studio)

Tenants may author their own ReportDefinitions via Studio:

### 11.1 Studio Controls

- **Data source selector:** UI presents only permitted tables (based on user's data permission).
- **Filter builder:** drag-and-drop parameters (validated via Data Validation Standard).
- **Column picker:** select, order, rename (tenant-specific label; canonical name immutable).
- **Preview:** live 100-row preview (respects user's permission filters).
- **Publish:** creates ReportDefinition in DRAFT; tenant admin approves to make it live.
- **Schedule creation:** UI to set cron + delivery destinations.

### 11.2 Studio Guardrails

- **Permission gate:** only users with `report.author` permission may use Studio.
- **Data source restriction:** author may only select tables their department/role has `view` permission on.
- **No raw SQL:** filter builder produces safe, parameterized queries only.
- **Validation:** report definition is validated before save (required columns, parameter types, etc.).
- **Audit:** every save, publish, schedule change is audited.

### 11.3 Studio Metadata

Each tenant-authored ReportDefinition carries:
- `createdBy` (user ID).
- `createdAt`.
- `lastModifiedBy`.
- `lastModifiedAt`.
- `version` (incremented on each change).
- `approvedBy` (admin who published it, if in DRAFT).
- `status` (DRAFT, ACTIVE, DEPRECATED, RETIRED).

---

## 12. Search-Saved-View Promotion to Report

A Search Core "Saved View" may be promoted to a Report:

1. User saves a filter+column set in Search (standard Save View flow).
2. User clicks "Promote to Report" → UI opens Studio with the saved view pre-loaded.
3. User names the report, sets a schedule (optional), configures delivery.
4. Promotion creates a ReportDefinition + optionally a ReportSchedule.
5. Original Saved View remains; Report becomes the scheduled, deliverable version.

**Invariant:** Promotion is idempotent; promoting the same Saved View twice updates the Report rather than creating duplicates.

---

## 13. Forbidden Patterns

- **Ad-hoc SQL:** users may not write raw SQL. Reports use structured filters only.
- **Reports that bypass permissions:** a report must enforce the same permission rules as the UI. If a user cannot view a case, the case cannot appear in a Case report.
- **Cross-tenant joins in normal mode:** a normal user's report may not join Customer data from Tenant A with Case data from Tenant B. (Super Admin reports may, with explicit tenant parameter + audit trail.)
- **Hardcoded translated labels as values:** never store or filter on `"Active"` (English label) or `"Ակտիվ"` (Armenian label) in the report logic; always use canonical `ACTIVE`.
- **Silent failures:** if a scheduled report fails to generate or deliver, the user is notified (email, in-app alert).
- **Untraced aggregates:** a SUM or COUNT in a report must be traceable to source rows, not calculated outside the report engine.

---

## 14. Audit & Events

Every report action is audited:

### 14.1 Audit Events

- **ReportDefinition created/updated/published/deprecated:** who, when, what changed.
- **ReportSchedule created/paused/resumed/deleted:** who, when, schedule details.
- **ReportRun started/completed/failed:** timestamp, status, row count, error detail.
- **Report file downloaded:** user, timestamp, file format, IP address.
- **Report delivered:** destination, success/failure, timestamp.
- **Legal hold applied/released:** reason, who, when.

### 14.2 Domain Events

- `Report.DefinitionCreated` → `{reportDefinitionId, tenantId, createdBy}`.
- `Report.ScheduleCreated` → `{reportScheduleId, reportDefinitionId, tenantId}`.
- `Report.RunStarted` → `{reportRunId, reportDefinitionId, tenantId, parametersHash}`.
- `Report.RunCompleted` → `{reportRunId, rowCount, generatedFiles, duration}`.
- `Report.RunFailed` → `{reportRunId, errorMessage, retryCount}`.
- `Report.Delivered` → `{reportRunId, destination, status}`.
- `Report.FileAccessed` → `{reportRunId, userId, format, timestamp}`.

**Invariant:** Every domain event carries `tenantId` and `occurredAt` (UTC timestamp).

---

## 15. Localization Rules for Reports

Reports respect Localization Core:

1. **Report name and description:** translatable labels (via Localization Core).
2. **Column headers:** translatable (canonical name immutable in the schema).
3. **Status/enum values:** always canonical (e.g., `ACTIVE`), display label is translated (e.g., "Active" / "Ակտիվ").
4. **Date/time formatting:** respects tenant's locale (e.g., DD/MM/YYYY vs. MM/DD/YYYY).
5. **Currency:** displays with tenant's currency symbol and precision (via Localization Core).
6. **Numbers:** formatted per locale (e.g., 1,000.50 vs. 1.000,50).

**Fallback:** if a translation is missing, the report uses the default language (usually English) and logs a warning.

---

## 16. On-Demand vs. Scheduled Reports

### 16.1 On-Demand Report

- User clicks "Generate Report" → form to enter parameters.
- Backend validates parameters (type, range, tenant scope).
- Report is generated synchronously (if < 10 seconds) or queued.
- User is redirected to the report view or notified when ready (if queued).
- File is available for download (7-day expiry).

### 16.2 Scheduled Report

- ReportSchedule defines cron, recipients, delivery format.
- Background job generates the report at the scheduled time.
- Files are auto-delivered to email, webhook, or file drop.
- User may manually trigger a run via "Generate Now" button.
- Historical runs are visible in a "Report Runs" table (searchable, filterable).

---

## 17. Integration with Other Cores

### 17.1 Relationship Matrix

| Core | How Reporting Depends | How Other Core Depends |
|------|----------------------|----------------------|
| **Identity** | User context for audit, permission check. | None. |
| **Tenant** | Tenant scoping, row filtering, delivery address. | None. |
| **Audit** | Immutable audit log; reports trace back to audit. | Reporting activity (runs, deliveries) is audited. |
| **Security** | Enforce field-level masking, signed URLs. | None. |
| **Compliance** | Legal hold, retention policy enforcement. | Reports may be audited for compliance. |
| **Template** | Render PDF, Excel headers/footers. | None. |
| **Time** | Schedule cron expressions, timezone rules, business hours. | None. |
| **Localization** | Translate labels, format date/currency per locale. | None. |
| **Search** | Promote Saved Views to Reports. | None. |
| **Integration** | Email, webhook, file drop delivery. | Integrations may trigger report generation. |
| **Analytics** | Reference official KPI definitions. | None. |
| **Storage** | Store generated PDF/Excel/CSV files. | None. |
| **Background Processing** | Execute scheduled reports. | None. |
| **Event** | Publish domain events (Report.RunCompleted, etc.). | None. |
| **Workflow** | Reports may show state transitions (via audit). | None. |

---

## Architecture Laws for Reporting

1. **L1 — Single Source of Truth:** A report sources data only from canonical entities, approved read models, or audit tables. It never invents or recalculates business truth.

2. **L2 — Permission Enforcement:** Every report row and field is subject to the same permission rules as the source object. If a user cannot view a Case, they cannot report on it.

3. **L3 — Tenant Isolation:** Report data is tenant-scoped. Cross-tenant reports are Super Admin only, require explicit tenantId parameter, and are audited.

4. **L4 — Immutable Scheduled Reports:** Once a ReportSchedule is active, its definition is immutable. Changes create a new schedule, not modify the running one.

5. **L5 — Traceability:** Every aggregate (count, sum, average) in a report is traceable to source rows, which are traceable to source events or audit records.

6. **L6 — No Hidden Counts:** Report counts never include records the user is not authorized to view. Aggregate leakage is forbidden.

7. **L7 — Audit Universality:** Every report run, delivery attempt, and file access is audited. Silent failures are forbidden.

---

## Cross-Architecture Dependencies

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

| Documents that depend on this one |
|---|
| `16_ANALYTICS_ARCHITECTURE.md` (clarifies separation from Reporting) |
| `Implementation roadmap` (report scheduling, delivery, Studio features) |

---

*End of 15 — Reporting Architecture.*
