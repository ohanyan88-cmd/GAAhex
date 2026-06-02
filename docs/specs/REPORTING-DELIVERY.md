# Reporting & Delivery — Scheduled Reports + Export Formats

This document describes the reporting layer landing in this batch: scheduled reports (A24), record export formats (E24), and the delivery chain that brings them together. Both systems rely on the channel adapter layer (MOTION-AND-ADAPTERS.md, E23) to route outbound messages.

---

## 1. Scheduled Reports (A24)

A **ReportSchedule** is a saved report turned into a recurring, auto-delivered job. It lives in the database (ReportSchedule table) and is managed via REST endpoints. When due, a batch job renders the report, sends it to configured recipients, advances the schedule, and logs the run.

### ReportSchedule Model

Located: \ackend/app/models/report_schedule.py\

\\\
id (UUID)               — primary key, unique schedule ID
tenant_id (UUID)        — which tenant owns this schedule (RLS gated)
owner_node_id (UUID|null) — optional org-node scope tag (who owns it, for visibility)
report_id (UUID)        — foreign key to report_def; on delete → cascade
cadence (string)        — 'daily' | 'weekly' | 'monthly' — how often to run
channel (string)        — 'email' | 'sms' | 'console' | 'webhook' | ... delivery method
recipients (JSON list)  — channel-specific addresses (emails, phones, webhook URLs, etc.)
next_run_at (timestamp) — when the schedule next becomes due (indexed for fast queries)
last_run_at (timestamp|null) — when run-due last successfully fired it
status (string)         — 'ACTIVE' | 'PAUSED'; defaults to ACTIVE
created_at (timestamp)  — when the schedule was created
\\\

**Key design:**
- Tenant-scoped with RLS policy (NULLIF-guarded, like report_def and job_run).
- \owner_node_id\ is optional — allows tagging schedules to an org node without requiring it.
- Cascades on report_id deletion (if the underlying report is removed, the schedule is removed).
- All timestamps are timezone-aware (UTC server default).

### CRUD Endpoints

Registered at \GET|POST|PATCH /api/report-schedules\ (fixed path, registered before the generic records router).

**Authentication:** All endpoints require \current_user\ (authenticated).

**Authorization:** Reads require tenant scope only (these are operational config rows, not customer data). Writes and the \un-due\ batch job require \config.manage\ — treating schedules as a tenant-wide automation asset like config changes.

#### GET /api/report-schedules
List all active schedules for the tenant.

**Query parameters:**
- \status\ (optional) — filter by 'ACTIVE' or 'PAUSED'
- \limit\ (optional, default 200)
- \offset\ (optional, default 0)

**Response:** Array of schedule objects (serialized as JSON with ISO-8601 timestamps, UUIDs as strings).

#### GET /api/report-schedules/{schedule_id}
Fetch a single schedule by ID.

**Response:** Schedule object or 404 if not found / not owned by this tenant.

#### POST /api/report-schedules
Create a new schedule.

**Required fields:**
- \eport_id\ (UUID) — must reference a real report in this tenant (validated; 422 if not found)
- \cadence\ (string) — 'daily' | 'weekly' | 'monthly' (422 if invalid)
- \channel\ (string) — non-empty channel name (422 if empty)
- \ecipients\ (array) — list of channel-specific addresses (422 if not a list)

**Optional fields:**
- \
ext_run_at\ (ISO-8601 timestamp) — when to run first; defaults to now (due immediately next run-due)
- \owner_node_id\ (UUID) — attach to an org node; must be a valid UUID or null

**Response:** Created schedule object (201).

**Gates:** Requires \config.manage\.

#### PATCH /api/report-schedules/{schedule_id}
Edit an existing schedule.

**Patchable fields:** \cadence\, \channel\, \ecipients\, \
ext_run_at\, \status\, \owner_node_id\.

**Validation:** Same rules as POST (e.g., cadence must be valid, recipients must be a list).

**Response:** Updated schedule object or 404 / 403.

**Gates:** Requires \config.manage\.

### The \un-due\ Batch Job

Located: \ackend/app/routers/report_schedules.py\, endpoint \POST /api/report-schedules/run-due\

**Purpose:** Find all ACTIVE schedules due at a cutoff time, render each report, dispatch to recipients, advance the schedule, and log the batch run.

**Query parameters:**
- \s_of\ (optional, ISO-8601 datetime) — cutoff for "due"; defaults to now. Enables idempotent re-runs.

**Authentication:** Requires \current_user\.

**Authorization:** Requires \config.manage\ (a tenant automation job, like billing's \un-cycle\ and \un-dunning\).

#### Execution Flow (Idempotent, Fail-Soft)

1. **Select due schedules:** Query for all rows where:
   - \	enant_id == user.tenant_id\
   - \status == "ACTIVE"\
   - \
ext_run_at <= as_of\ (the cutoff time)
   - Order by \
ext_run_at\ (FIFO).

2. **For each due schedule:**

   a. **Render the report:** Call \un_report(schedule.report_id, user, session)\ from the report_builder module.
      - Returns a dict: \{id, key, name, matched, result}\ on success, or \{..., error: str}\ on failure.
      - Fail-soft: a report that failed to render still delivers a body noting the error.
      - The render is org-scoped (exact same filtering as the interactive report run).

   b. **Render the delivery body:** Convert the report result to a \(subject, body)\ pair.
      - Subject: \"Report: {name}"\ (or \"Report: {name} (error)"\ if render failed).
      - Body: \"Report '{name}' — matched N record(s):\n{result}"\ (or error detail).

   c. **Dispatch to recipients:** For each recipient in \schedule.recipients\:
      - Call \channels.dispatch(s, tenant_id, channel, to=recipient, subject, body, def_key="report.scheduled", user_id)\.
      - \dispatch()\ routes through the channel adapter layer (email, SMS, webhook, etc.).
      - It logs an \OutboundMessage\ row (status=SENT or FAILED) and never raises.
      - If no recipients are configured, send once with \	o=None\ (channel-level delivery).

   d. **Advance the schedule:** Calculate the next run time using \_advance()\:
      - **daily:** add 1 day.
      - **weekly:** add 7 days.
      - **monthly:** add 1 calendar month, clamping the day of month (e.g., Jan 31 + 1 month = Feb 28/29, never Mar 3).
      - Loop: keep advancing until \
ext_run_at > as_of\ (ensures idempotency — re-running with the same \s_of\ will not re-select the schedule).

   e. **Stamp \last_run_at\:** Set to the batch job start time (so all schedules in one run share a timestamp).

3. **If an exception occurs for a single schedule:** Catch it, increment the error counter, and leave \
ext_run_at\ untouched so the schedule is retried on the next \un-due\ (fail-soft per schedule — one bad render/delivery does not abort the rest).

4. **Record a JobRun:** After processing all due schedules, call \_record_job_run()\ to log a single JobRun row with status SUCCESS or ERROR and a summary dict:
   \\\json
   {
     "rendered": <count of successfully rendered reports>,
     "delivered": <count of successfully delivered messages>,
     "errors": <count of renders or deliveries that failed>,
     "due": <total number of schedules that were due>
   }
   \\\

5. **Commit:** If all goes well, commit the session (all schedule advances + the JobRun row).
   If an exception occurs during the batch, rollback, record a JobRun with status=ERROR, and re-raise.

#### Idempotency Guarantee

A schedule is idempotent per \s_of\: once \
ext_run_at > as_of\, a re-run with the same \s_of\ will not select the schedule again. This allows safe replay of the job without delivering duplicate reports.

#### Integration with Jobs + Adapters

The \un-due\ job **does not reinvent delivery**:
- **Render:** Reuses \eport_builder.run_report()\ — the exact same aggregation engine and org-scope filtering as interactive runs.
- **Deliver:** Reuses \channels.dispatch()\ — the same adapter-based routing that notifications use.
- **Log:** Reuses \_record_job_run()\ from the billing module — consistent JobRun schema across all batch jobs.

This tight coupling ensures that scheduled reports and interactive reports behave identically, and delivery is audited the same way (OutboundMessage log).

---

## 2. Record Export Formats (E24)

Located: \ackend/app/routers/export.py\ + \ackend/app/export_formats.py\

A record export downloads the records visible to the caller for an entity in multiple formats. The export uses the **exact same access control and filtering as the list view** — so an export never leaks data outside the caller's view gate.

### Endpoint

\GET /api/{slug}/export?format=csv|json|xlsx|pdf&q=<search>&filter=<gxl>&sort=<field>\

**Slug:** Entity key (e.g., "customers", "subscriptions").

**Query parameters:**
- \ormat\ (optional, default "csv") — one of: \csv\, \json\, \xlsx\, \pdf\
- \q\ (optional) — free-text search needle (same as list view)
- \ilter\ (optional) — GXL expression (same as list view)
- \sort\ (optional) — field name (prefix with \-\ for descending; same as list view)

**Authentication:** Requires \current_user\.

**Authorization:** Gated on \{entity}.view\ + org-node scope filter (identical to list endpoint).

#### Access Control Pipeline

Before export, the caller's viewable records are filtered:

1. **Org-scope gating:** Only records the caller has \{entity}.view\ permission for (considering org-node hierarchy).
2. **Free-text search:** If \q\ is provided, match on common fields (name, email, etc.).
3. **GXL filter:** If \ilter\ is provided, evaluate the expression against each record's data dict.
4. **Sort:** If \sort\ is provided, order by the field (ascending or descending).

This is **the exact same pipeline as the list view** — enforced by reusing the records router's filter helpers (\_matches_q\, \_sort_value\, etc.).

#### Format: CSV (Default)

**Content-Type:** \	ext/csv\

**Filename:** \{slug}-YYYYMMDD.csv\

**Format:**
- Row 1: Header (field labels + "Status", "ID", "Created At")
- Rows 2+: Data rows (values are plain strings; lists are semicolon-separated)

**Implementation:** Streaming response; each row is yielded one at a time (minimal memory footprint).

**Non-breaking default:** If no \ormat\ is specified, CSV is returned (existing callers are unaffected).

#### Format: JSON

**Content-Type:** \pplication/json\

**Filename:** \{slug}-YYYYMMDD.json\

**Format:** Array of objects, each with fields + \status\, \id\, \created_at\.

#### Format: XLSX

**Content-Type:** \pplication/vnd.openxmlformats-officedocument.spreadsheetml.sheet\

**Filename:** \{slug}-YYYYMMDD.xlsx\

**Format:** Single sheet named 'Export' with:
- Row 1: Bold header
- Rows 2+: Data rows

**Implementation:** Stdlib-only (no openpyxl or xlsxwriter dependency). Built by \xport_formats.build_xlsx()\, which assembles OOXML as ZIP + XML parts.

#### Format: PDF

**Content-Type:** \pplication/pdf\

**Filename:** \{slug}-YYYYMMDD.pdf\

**Format:**
- **Header band (first page only):** Light grey background with:
  - Left: Tenant logo_text (large, cobalt color)
  - Center: Report title (entity label or slug + " Export")
  - Right: Generated date (YYYY-MM-DD)
  - Horizontal rule below header
- **Column header row:** Dark blue background, white bold text
- **Data rows:** Alternating white/light grey background; data cells in regular font
- **Pagination:** Multiple pages if data exceeds one page

**Implementation:** Stdlib-only raw PDF 1.4 byte stream. Built by \xport_formats.build_pdf()\, which writes PDF objects and cross-reference table directly (no reportlab or weasyprint).

### Branding (XLSX & PDF)

Both XLSX and PDF respect tenant branding:

**Source:** \Tenant\ model fields:
- \logo_text\ — displayed in PDF header (left) and workbook title (XLSX); defaults to tenant name or "GAAhex"
- \currency\ — used to format money values in export
- \
ame\ — fallback for logo_text if not set

**Example:** A tenant with \logo_text = "ComTel"\ and \currency = "AMD"\ exports will show "ComTel" in the PDF header and format money as \15,000.00 AMD\ (luma ÷ 100, grouped).

### Money Formatting

All money values in exports are **integer luma** (minor units, stored as-is in records). Exported values are displayed via \ormat_money(luma, currency)\:

\\\
format_money(1_500_000, "AMD")  →  "15,000.00 AMD"
format_money(None, "AMD")       →  ""
\\\

Luma are converted to the major unit (÷100) and formatted with 2 decimals and thousands grouping.

---

## 3. Full Delivery Chain

This diagram shows how a scheduled report flows from creation through delivery:

\\\
┌─ Schedule created ──────────────────────────────────────────┐
│ POST /api/report-schedules                                  │
│ Input: report_id, cadence, channel, recipients              │
│ → Stored in ReportSchedule table (next_run_at = now)       │
└──────────────────────────────────────────────────────────────┘
                              ↓
┌─ Batch job: run-due (on-demand endpoint) ───────────────────┐
│ POST /api/report-schedules/run-due?as_of=<cutoff>           │
│ → SELECT schedules WHERE next_run_at <= as_of               │
└──────────────────────────────────────────────────────────────┘
                              ↓
                    ┌─ For each schedule ─┐
                    │                      │
                    ↓                      ↓
            ┌─ Render ─┐          ┌─ Deliver ─┐
            │           │          │            │
            │ run_report│          │ dispatch   │
            │ (A24)     │          │ (E23)      │
            │           │          │            │
            │ Report    │          │ Channel    │
            │ builder   │          │ adapter    │
            │ engine    │          │ (email/sms)│
            │ ORG-scope │          │ → OutboundM│
            │ filtering │          │   essage   │
            └─────┬─────┘          └────┬───────┘
                  │                     │
                  └─────────┬───────────┘
                            ↓
            ┌─ Advance schedule ─────┐
            │ next_run_at > as_of    │
            │ (idempotency ensured)  │
            └────────┬────────────────┘
                     ↓
            ┌─ Record JobRun ────────┐
            │ summary: rendered,     │
            │ delivered, errors, due │
            └────────────────────────┘
\\\

### Automatic vs On-Demand

- **On-demand:** The \un-due\ endpoint is called manually (or by an external cron/scheduler). This batch is the **on-demand path** — a caller hits the endpoint to trigger all due reports.
- **Future (spec-only):** A real scheduler (cron, APScheduler, or AWS Lambda) will call \un-due\ on a fixed schedule (e.g., every 5 minutes). This moves reporting to **automatic** without any kernel change.

---

## 4. Code-to-Doc Verification

| Area | Code Location | Status |
|------|---------------|--------|
| ReportSchedule model | backend/app/models/report_schedule.py | Implemented |
| CRUD endpoints | backend/app/routers/report_schedules.py lines 106–232 | Implemented |
| run-due batch job | backend/app/routers/report_schedules.py lines 248–327 | Implemented |
| Cadence advance logic | backend/app/routers/report_schedules.py lines 68–80 | Implemented |
| _render_body() | backend/app/routers/report_schedules.py lines 237–245 | Implemented |
| Report rendering (reuse) | backend/app/routers/report_builder.py lines 119–146 | Reused |
| channels.dispatch() (reuse) | backend/app/channels.py lines 80–143 | Reused |
| _record_job_run() (reuse) | backend/app/routers/billing.py lines 71–78 | Reused |
| Export endpoint | backend/app/routers/export.py lines 99–215 | Implemented |
| CSV format | backend/app/routers/export.py lines 153–171 | Implemented |
| JSON format | backend/app/routers/export.py lines 136–148 | Implemented |
| XLSX format | backend/app/routers/export.py lines 190–196 | Implemented |
| PDF format | backend/app/routers/export.py lines 201–215 | Implemented |
| build_xlsx() | backend/app/export_formats.py lines 55–160 | Implemented |
| build_pdf() | backend/app/export_formats.py lines 190–451 | Implemented |
| format_money() | backend/app/export_formats.py lines 33–38 | Implemented |
| Tenant branding | backend/app/routers/export.py lines 176–178 | Implemented |

**Code-to-doc alignment:** All documented features are implemented; no gaps or mismatches.

---

## 5. Horizon: Next Steps (Spec-Only)

### Real Scheduler → Automatic Runs (F24)

Today, \un-due\ is an on-demand endpoint. A real task scheduler (cron, APScheduler, or AWS Lambda) will call it on a fixed interval (e.g., every 5 minutes). This moves reporting from pull-based to push-based without any kernel change.

**Seam:** \ackend/app/jobs/\ — new scheduler module that wraps \un-due\ and calls it on a cadence. No changes to the ReportSchedule model or dispatch layer.

### Drill-Down Reports (H77)

A click-through from a row in a scheduled report to the full record detail. Requires the report result to include record IDs so the frontend can generate a deep link.

**Seam:** \eport_builder.run_report()\ — already returns record IDs in the result; the frontend wires the navigation.

### Period Comparison (H79)

Side-by-side tables of the same report metric from different periods (e.g., "this month vs last month" or "this year vs last year"). Requires the report query to support a \period\ parameter and the aggregation engine to compute multiple time windows.

**Seam:** \dashboards._compute()\ — extend to accept period grouping; \eport_builder\ passes through. No breaking changes to the ReportSchedule or dispatch layer.

### Interactive Report Export (F25)

Allow exporting a report run (not just records). Export the report table itself as CSV/XLSX/PDF, with the report title and filters embedded.

**Seam:** \xport.py\ — new endpoint \/api/reports/{report_id}/export?format=csv|xlsx|pdf\. Reuses \uild_xlsx()\ and \uild_pdf()\ but changes the header (report title instead of entity title).

---

## Summary

**Scheduled reports** (A24) turn any saved report into a recurring delivery job. The batch endpoint \un-due\ finds all due schedules, renders each report using the existing aggregation engine, sends via the channel adapter layer (reusing the notification dispatch path), advances the schedule, and logs the run. The system is idempotent, fail-soft, and stitches jobs + adapters into the report layer.

**Record export** (E24) downloads an entity's records in four formats (CSV, JSON, XLSX, PDF). The export uses the exact same access control and filtering as the list view, so no data leaks. XLSX and PDF are branded with tenant logo_text and currency, both built stdlib-only (no third-party PDF/spreadsheet deps). Money is stored as integer luma and displayed via format_money().

Together, these systems complete the reporting & delivery loop: define a metric, save it, schedule it, and deliver it — all without hardcoding, all auditable, all configurable.
