# 16 — Analytics Architecture

**Constitutional document.** Position in the hierarchy: directly under `PLATFORM_REFERENCE_MODEL.md`; the sixteenth of the 22 Architecture Constitution documents. All Standards, Domains, Modules, Pages, Components, and implementation files must remain consistent with this document.

---

## 1. Purpose

Define the **Analytics Core** as a first-class ownership boundary for KPI definitions, metric models, dashboard datasets, aggregations, and analytical dimensions. Establish the hard separation between Analytics (explains past/present performance via insight) and Reporting (produces governed structured outputs), between Analytics and Forecasting (predicts future states), and between Analytics and AI (generative/agentic actions).

Analytics is intelligence-tier insight machinery: KPIs, metric aggregations, dimensional views, and decision-support data preparation — all governed by canonical business definitions and permission-safe access.

---

## 2. Scope

In scope:

- The definition of **Analytics Core** and its ownership boundaries.
- **KPI Definition** as the source of truth for every metric on the platform.
- **Metric Models** — time-series aggregations with refresh cadence and computation rules.
- **Dashboard Datasets** — pre-computed aggregates for fast dashboard renders.
- **Aggregation Jobs** — background processing that refreshes metrics and dimensions.
- **Analytical Dimensions** — permitted slices (by org, location, status, time, region, tenant).
- **KPI Tile visual standard** — D17 (no premium highlight, colored value text + tooltip, color families per D18).
- **Permission-aware metrics** — row-level filtering applied to every aggregation.
- **Tenant scoping** — all KPIs tenant-scoped; cross-tenant aggregation only for Super-Admin.
- **Data freshness SLA** — per-KPI refresh targets and latency commitments.
- **Forbidden patterns** — KPI hardcoded in application code, ad-hoc aggregations outside KpiDefinition, cross-tenant data leakage, unaudited metric changes.

Out of scope (handled by other constitution documents):

- *Reporting definitions and export rules* — see `15_REPORTING_ARCHITECTURE.md`.
- *Forecasting models and scenarios* — see `20_MARKETPLACE_ARCHITECTURE.md` or Forecasting Core constitution (not yet authored).
- *AI-assisted insights and recommendations* — see `21_AI_ARCHITECTURE.md`.
- *Dashboard page layouts and navigation* — see `04_NAVIGATION_ARCHITECTURE.md` and `06_UI_EXPERIENCE_ARCHITECTURE.md`.
- *Permission keys and RBAC rules* — see `08_PERMISSION_ARCHITECTURE.md` and `17_SECURITY_AND_PERMISSION_STANDARD.md`.

---

## 3. Goals

- **G1** Every KPI has exactly one canonical definition in `KpiDefinition` entity; no KPI is hardcoded or duplicated in application code.
- **G2** Every KPI declares its formula, dimensions, refresh cadence, owner, data source (business core + event topic or table), and permission-filtering rule.
- **G3** Every KPI respects tenant isolation: tenants see only their data; Super-Admin may request cross-tenant aggregates via explicit permissions.
- **G4** Every aggregation job is auditable, observable, resumable on failure, and recorded with success/failure events.
- **G5** Dashboard datasets are pre-computed slices (materialized views or aggregate tables) refreshed on a known schedule; no ad-hoc queries on raw data.
- **G6** KPI visuals conform to D17 (no premium tiles) and D18 (color families: Cobalt = spine, Gold = signature, Azure = interactive, Slate = neutrals, Semantic = status).
- **G7** Analytics Core ≠ Reporting Core, ≠ Forecasting Core, ≠ AI Core; boundaries are hard.
- **G8** Permission enforcement happens at the KPI definition level and again at aggregation time; a user cannot see aggregates they have no permission to view.

---

## 4. Non-Goals

- **NG1** This document does NOT define UI page shapes. (See `06_UI_EXPERIENCE_ARCHITECTURE.md`.)
- **NG2** This document does NOT define chart implementations. (See UI components and design-system.)
- **NG3** This document does NOT define business intelligence features beyond core KPI/metric/dashboard machinery.
- **NG4** This document does NOT define data warehouse ETL. (Analytics aggregates from operational database; warehouse is infrastructure, see `19_INFRASTRUCTURE_ARCHITECTURE.md`.)
- **NG5** This document does NOT replace Reporting; Reporting is for extracted/scheduled/approved output; Analytics is for interactive insight.

---

## 5. Architecture Principles

### P1 — Every KPI has one definition.

KPI logic is not spread across dashboards, reports, automations, and integration code. The canonical definition lives in `KpiDefinition` entity; all other surfaces read from it.

### P2 — KPIs are permission-safe.

A KPI aggregation respects the same row-level filters as the underlying business objects. If a user cannot see a customer record, they cannot see that customer in the KPI aggregation.

### P3 — Tenant boundaries are non-negotiable.

Every KPI is tenant-scoped. Cross-tenant aggregation is forbidden for normal users and only enabled for Super-Admin via explicit permission and full audit trail.

### P4 — Analytical Dimensions are declared, not ad-hoc.

A KPI may be sliced by Department, Location, Status, Time Bucket, Owner, Region, or other declared dimensions. Ad-hoc new dimensions require a KPI definition amendment.

### P5 — Refresh cadence is SLA'd.

Every KPI declares its expected freshness: real-time (< 1 min), near-real-time (1–5 min), hourly, daily, weekly. The refresh job enforces the SLA and alerts on miss.

### P6 — Aggregation is asynchronous infrastructure.

KPI computation happens in background jobs (Background Processing Core) coordinated by Analytics Core. Request-path dashboards read pre-computed datasets, not live aggregations.

### P7 — Dashboard datasets are materialized.

Dashboards render from pre-computed `DashboardDataset` tables/views, not ad-hoc queries. This ensures low latency and consistent permission enforcement.

### P8 — Events are the primary data source.

KPIs derive from domain events (published by business cores) and operational tables. Analytics Core does NOT reach back into raw operational tables except where business core publishes no event.

---

## 6. Architecture Laws

These are hard rules. Violation is grounds to reject a PR.

### L1 — KPI Definition is mandatory for all metrics.

> No KPI appears in a dashboard, report, AI prompt, or decision-support view without a corresponding `KpiDefinition` entity and a documented formula.

Hardcoding metric logic in application code is forbidden.

### L2 — Permission enforcement at KPI definition and aggregation.

> Every `KpiDefinition` declares a `permissionFilter` rule. At aggregation time, the computed dataset applies both the KPI's own filter (e.g., "include only ACTIVE customers") and the user's permission scope (e.g., "this user can only see department X"). The result is AND'd; a user sees only rows they have permission to view AND that match the KPI criteria.

No bypassing permission checks to show "full universe" numbers.

### L3 — Tenant isolation is enforced.

> Every KPI aggregate includes `tenantId`. A user query must pass their own `tenantId`; cross-tenant queries are rejected unless the user holds `analytics.view_cross_tenant` permission (Super-Admin only, audit-logged, event-recorded). No query parameter, local storage value, or integration payload overrides this.

### L4 — One data source per KPI.

> A KPI declares one canonical source: a business core entity, an event topic, or an audit/compliance table. If a KPI must combine data from multiple sources, the sources are modeled as a single aggregate table in Analytics Core, not as a union of ad-hoc reads.

### L5 — Dimensions are declared in KpiDefinition.

> A KPI's supported dimensions (slices by department, location, status, region, etc.) are declared in `KpiDefinition.dimensions: AnalyticalDimension[]`. At runtime, only declared dimensions are available for drill-down or filtering. Adding a new dimension to a KPI requires updating `KpiDefinition.dimensions` and potentially recomputing historical aggregate tables.

### L6 — Refresh cadence is SLA'd and monitored.

> Every `KpiDefinition` declares `refreshCadence` (enum: REAL_TIME, NEAR_REAL_TIME_1MIN, NEAR_REAL_TIME_5MIN, HOURLY, DAILY, WEEKLY). A background job enforces the SLA: if a refresh misses its window, an alert fires and the previous snapshot is retained (stale but not silent). The refresh job is observable (logs, traces, events) and resumable on transient failure.

### L7 — Dashboard datasets are pre-computed.

> A dashboard page's data comes from a materialized `DashboardDataset` or pre-computed view, never from a request-path aggregation query. Dashboard render time is O(1) network fetch, not O(n) aggregation computation. The `DashboardDataset` is refreshed on the same cadence as its constituent KPIs.

### L8 — Analytics ≠ Reporting.

> Analytics Core computes KPIs, dimensions, and insight datasets. Reporting Core produces scheduled, formatted, approved, audit-logged exports and PDFs. A report may consume a KPI definition, but a report's output (PDF, Excel, email) is owned by Reporting Core. Analytics Core does not schedule or export reports.

### L9 — Analytics ≠ Forecasting.

> Analytics explains the past and present: what happened, what is happening, how things compare. Forecasting predicts the future: what will happen, capacity projections, demand scenarios. A KPI is not a forecast. If a page needs both (e.g., "current churn vs. predicted churn"), the KPI and forecast are separate entities, computed separately, and presented together by the UI.

### L10 — Analytics ≠ AI.

> Analytics is statistical aggregation and comparison. AI is generative, agentic, and conversational. A dashboard may include a natural-language summary powered by AI (e.g., "highlight anomalies"), but the anomaly detection algorithm is either a KPI rule or a Forecasting model, not an AI feature. AI Core may read KPI definitions for context in a prompt, but does not compute KPIs.

### L11 — Forbidden: hardcoded KPI logic in application code.

> Application code must NOT contain logic like:
> - `if (status == ACTIVE && createdAt > startOfMonth()) { count++ }`  (hardcoded in a view controller)
> - `SELECT COUNT(*) WHERE status = 'ACTIVE'` (ad-hoc in a utility function)
> - `const churnRate = departures / totalCustomers` (formula in a component)
>
> All such logic moves to `KpiDefinition.formula` and `KpiDefinition.computedFrom` (table/event reference).

### L12 — Forbidden: ad-hoc cross-tenant aggregation.

> A query like `SELECT SUM(revenue) FROM invoices` (no tenantId filter) is forbidden. Every aggregation scopes to the request actor's tenantId. If a Super-Admin needs cross-tenant aggregation, they use an explicit endpoint (`/api/v1/analytics/kpi/{id}?scope=CROSS_TENANT`) that logs the request, checks the permission, emits a `AnalyticsQuery.CrossTenantRequested` event, and returns audited results.

---

## 7. Core Concepts

### 7.1 KpiDefinition

A canonical metric definition. Fields (camelCase, D2):

```
id                      UUIDv7
referenceNumber         KPI-…
tenantId                UUIDv7 (required; this KPI belongs to a specific tenant)
name                    string (e.g., "Active Subscribers")
description             string (business meaning + computation note)
formula                 string (e.g., "COUNT(*) WHERE status = ACTIVE AND deletionState IS NULL")
computedFrom            enum { TABLE, EVENT_STREAM } (source data origin)
sourceEntity            string (e.g., "Subscription" if TABLE; or event topic name if EVENT_STREAM)
eventTopic              string | null (e.g., "Service.Activated", "Service.Cancelled")
aggregationType         enum { COUNT, SUM, AVG, MIN, MAX, PERCENTILE, DISTINCT_COUNT, CUSTOM }
aggregationField        string | null (the field being summed/averaged; null if aggregationType = COUNT)
owner                   string (department or user ID; accountable for definition)
ownerDepartment         string (e.g., "Operations", "Finance")
permissionFilter        string | null (e.g., "user.departments CONTAINS self.ownedDepartment"; encoded rule)
dimensions              AnalyticalDimension[] (permitted slices: DEPARTMENT, LOCATION, STATUS, TIME_BUCKET, REGION, OWNER, CUSTOM)
refreshCadence          enum { REAL_TIME, NEAR_REAL_TIME_1MIN, NEAR_REAL_TIME_5MIN, HOURLY, DAILY, WEEKLY }
refreshWindowMinutes    integer (grace window before SLA miss alert)
excludedStatuses        string[] (statuses to exclude; e.g., ["CANCELLED", "ARCHIVED"])
includedStatuses        string[] (statuses to include; if set, overrides default logic)
dataFreshnessSlaMinutes integer (target latency; SLA alert fires if actual > this)
timeAttributionKey      enum { CREATED_AT, UPDATED_AT, OCCURRED_AT, COMPLETED_AT, STARTED_AT } (which timestamp)
createdBy               UUIDv7 (user)
createdAt               timestamp
updatedBy               UUIDv7 (user)
updatedAt               timestamp
status                  enum { DRAFT, ACTIVE, ARCHIVED, DEPRECATED } (D16 style)
tags                    string[] (e.g., ["operational", "finance", "noc"])
notes                   string (audit trail / change log)
```

### 7.2 MetricModel

A time-series aggregation rule applied periodically. Fields (camelCase, D2):

```
id                      UUIDv7
referenceNumber         MET-…
tenantId                UUIDv7
kpiDefinitionId         UUIDv7 (fk to KpiDefinition)
timeResolution          enum { MINUTE_5, MINUTE_15, HOUR_1, DAY_1, WEEK_1, MONTH_1 }
aggregationWindow       interval (e.g., "5 minutes", "1 day")
retentionDays           integer (how long to keep raw metric points)
lastComputedAt          timestamp
nextScheduledAt         timestamp
computationStatus       enum { PENDING, RUNNING, SUCCEEDED, FAILED, STALE }
lastErrorMessage        string | null
createdAt               timestamp
updatedAt               timestamp
```

When `MetricModel` aggregates, it computes KPI values at each time bucket, stores them in `MetricTimeSeries` table, and publishes `Analytics.MetricComputed` event.

### 7.3 MetricTimeSeries

Raw time-series data points. Fields (camelCase, D2):

```
id                      UUIDv7
tenantId                UUIDv7
metricModelId           UUIDv7 (fk to MetricModel)
kpiDefinitionId         UUIDv7 (denormalized; for query optimization)
timeAt                  timestamp (the bucket's start time)
value                   numeric (the aggregated value)
computedAt              timestamp (when this point was computed)
dimensionSlice          jsonb (optional; if this point is a drill-down on a dimension, e.g., {"department": "OPS", "status": "ACTIVE"})
```

Indexed by `(tenantId, metricModelId, timeAt)` for fast queries.

### 7.4 DashboardDataset

A pre-computed materialized view for fast dashboard rendering. Fields (camelCase, D2):

```
id                      UUIDv7
referenceNumber         DSD-…
tenantId                UUIDv7
dashboardPageId         UUIDv7 (fk to Workspace Core page registry)
name                    string (e.g., "NMS Operations Dashboard — All KPIs")
kpiIds                  UUIDv7[] (KPIs included in this dataset)
dimensions              string[] (dimensions supported in this dataset)
refreshCadence          enum { REAL_TIME, NEAR_REAL_TIME_5MIN, HOURLY, DAILY }
refreshWindowMinutes    integer
lastRefreshedAt         timestamp
nextRefreshAt           timestamp
computationStatus       enum { PENDING, RUNNING, SUCCEEDED, FAILED, STALE }
dataStorageLocation     string (table name, S3 path, or materialized view name; opaque to platform)
rowCount                integer (cardinality of the dataset)
estimatedSizeBytes      integer
createdAt               timestamp
updatedAt               timestamp
```

When a request lands on a dashboard page, it fetches rows from `DashboardDataset` by `(tenantId, dashboardPageId, [optional dimension filters])` — O(1) call, no aggregation.

### 7.5 AnalyticalDimension

A named slice axis. Fields (camelCase, D2):

```
id                      UUIDv7
tenantId                UUIDv7
kpiDefinitionId         UUIDv7 (fk to KpiDefinition)
dimensionKey            string (e.g., "DEPARTMENT", "LOCATION", "STATUS", custom identifiers like "VENDOR_OUI")
dimensionName           string (display label; e.g., "Department", "Service Status")
dimensionTable          string | null (e.g., "Organization" for DEPARTMENT; "Location" for LOCATION; null for computed/custom)
dimensionField          string | null (e.g., "name" or "departmentId"; null if computed)
hierarchyType           enum { FLAT, TREE, CUSTOM } (DEPARTMENT is TREE; LOCATION is TREE; STATUS is FLAT)
cardinality             integer (hint: ~10 departments, ~100+ locations, ~5 statuses)
permissionScope         string | null (e.g., "user can only slice by departments they belong to")
createdAt               timestamp
```

When a KPI is queried with a dimension filter (e.g., "show me churn by department"), the dimension rule is applied, and the aggregation is recomputed scoped to that dimension.

### 7.6 Aggregation Job

Executed by Background Processing Core. Fields (camelCase, D2):

```
id                      UUIDv7
referenceNumber         JOB-…
tenantId                UUIDv7
jobType                 enum { COMPUTE_KPI, REFRESH_METRIC_MODEL, REFRESH_DASHBOARD_DATASET, RECOMPUTE_HISTORICAL }
targetKpiId             UUIDv7 | null
targetMetricModelId     UUIDv7 | null
targetDashboardDatasetId UUIDv7 | null
status                  enum { QUEUED, RUNNING, SUCCEEDED, FAILED, RETRYING, DEAD_LETTERED }
startedAt               timestamp | null
finishedAt              timestamp | null
errorMessage            string | null
rowsProcessed           integer
rowsAggregated          integer
computationTimeMs       integer
retryCount              integer (auto-incremented; max 3)
createdAt               timestamp
eventId                 UUIDv7 | null (correlate to Analytics.JobCompleted event)
```

On success, emits `Analytics.AggregationCompleted` event.
On failure, emits `Analytics.AggregationFailed` event; if retries exhausted, moves to dead-letter queue and emits `Analytics.AggregationDeadLettered` event.

---

## 8. Canonical Entities

### Analytics Core canonical entities

| Entity | Purpose |
|---|---|
| `KpiDefinition` | Source of truth for every metric on the platform. |
| `MetricModel` | Time-series aggregation rule and schedule. |
| `MetricTimeSeries` | Raw time-series data points (queryable history). |
| `DashboardDataset` | Pre-computed materialized view for dashboard rendering. |
| `AnalyticalDimension` | Named drill-down slice (Department, Location, Status, etc.). |
| `AggregationJob` | Background job that computes KPIs and refreshes datasets. |

All entities are `tenantId`-scoped. All mutations emit audit records (`Audit.EntityCreated`, `Audit.EntityUpdated`) and analytics events (`Analytics.KpiDefinitionCreated`, `Analytics.MetricComputed`, `Analytics.AggregationCompleted`).

---

## 9. Ownership Boundaries

### 9.1 What Analytics Core owns

- **KPI definitions**: the formula, source, dimensions, refresh cadence, permissions.
- **Metric aggregation**: computation rules, time-series storage, refresh schedules.
- **Dashboard dataset pre-computation**: materialized views, refresh machinery.
- **Analytical dimensions**: declared drill-down axes (department, location, status, custom).
- **KPI visual standard**: D17 (no premium tiles, colored value text, tooltip) + D18 (color families: Cobalt/Gold/Azure/Slate/Semantic).
- **Data freshness SLA**: refresh targets, latency commitments, miss alerting.

### 9.2 What Analytics Core does NOT own

- **Business core data**: Customer, Service, Invoice, Task, etc. — owned by their respective cores.
- **Reporting and exports**: scheduled reports, PDFs, email exports — owned by Reporting Core.
- **Forecasting**: capacity projections, demand scenarios, churn predictions — owned by Forecasting Core (MISSING, reserved).
- **AI insights**: LLM summaries, generative insights, agentic actions — owned by AI Core.
- **Dashboard page layout**: UI shells, widget placement, navigation — owned by Workspace Core.
- **Background processing infrastructure**: queues, workers, retries, dead-letter — owned by Background Processing Core. (Analytics *uses* Background Processing; BPC owns the infra.)
- **Event bus**: event storage, schema registry — owned by Event Core. (Analytics *subscribes* to events; Event Core owns the bus.)

### 9.3 Supporting core references

Analytics Core references:

- **Identity Core**: who owns the KPI, who triggered a refresh, who requested a cross-tenant aggregation.
- **Tenant Core**: every metric is tenant-scoped.
- **Audit Core**: every KPI change is audited.
- **Event Core**: subscribes to business core events (e.g., Service.Activated) as the data source for aggregations.
- **Background Processing Core**: schedules and runs aggregation jobs.
- **Permission/Security**: row-level filters applied at aggregation time.
- **Business cores** (Service, Financial, Work, Case, etc.): sources of KPI data via events and tables.

---

## 10. API Surface

### 10.1 KPI Definition CRUD

```
POST /api/v1/analytics/kpi-definitions
  Create a new KPI definition. Requires analytics.define_kpi permission.
  Payload: name, description, formula, computedFrom, sourceEntity, aggregationType, 
           aggregationField, owner, ownerDepartment, permissionFilter, dimensions, 
           refreshCadence, refreshWindowMinutes, dataFreshnessSlaMinutes, timeAttributionKey,
           excludedStatuses, includedStatuses.
  Response: KpiDefinition (full entity).
  Events: Analytics.KpiDefinitionCreated.

GET /api/v1/analytics/kpi-definitions
  List all KPI definitions (tenant-scoped). Pagination, filtering by status/tags.

GET /api/v1/analytics/kpi-definitions/{id}
  Fetch one KPI definition by ID.

PUT /api/v1/analytics/kpi-definitions/{id}
  Update a KPI definition. Requires analytics.manage_kpi permission.
  Only the definition itself (name, formula, permissions, dimensions) may be changed.
  Changing computedFrom or sourceEntity is a "breaking change" — requires explicit approval.
  Events: Analytics.KpiDefinitionUpdated (includes before/after snapshot).

DELETE /api/v1/analytics/kpi-definitions/{id}
  Soft-delete (set status = ARCHIVED). Hard delete forbidden (audit trail must be preserved).
  Events: Analytics.KpiDefinitionArchived.
```

### 10.2 Metric Model CRUD

```
POST /api/v1/analytics/metric-models
  Define a time-series aggregation rule. Requires analytics.configure_metrics permission.
  Payload: kpiDefinitionId, timeResolution, aggregationWindow, retentionDays.
  Response: MetricModel.
  Events: Analytics.MetricModelCreated.

GET /api/v1/analytics/metric-models?kpiDefinitionId={id}
  List metric models for a KPI.

PUT /api/v1/analytics/metric-models/{id}
  Update timeResolution, retentionDays. Does NOT recompute history.
  Events: Analytics.MetricModelUpdated.

POST /api/v1/analytics/metric-models/{id}:trigger-refresh
  Manually trigger a refresh of a MetricModel. Requires analytics.trigger_refresh permission.
  Response: AggregationJob (the triggered job).
  Events: Analytics.RefreshTriggered.
```

### 10.3 Metric Query

```
GET /api/v1/analytics/metrics/{kpiDefinitionId}/time-series
  Fetch time-series data points for a KPI.
  Query params: timeResolution, fromTime, toTime, dimension (optional), dimensionValue (optional).
  Response: MetricTimeSeries[].
  Applies permission filter and tenant isolation automatically.
  Example: /api/v1/analytics/metrics/{id}/time-series?fromTime=2026-06-01&toTime=2026-06-06&dimension=DEPARTMENT&dimensionValue=OPS
```

### 10.4 Dashboard Dataset Refresh

```
POST /api/v1/analytics/dashboard-datasets/{id}:refresh
  Manually trigger a refresh of a DashboardDataset. Requires analytics.refresh_dashboards permission.
  Response: AggregationJob.
  Events: Analytics.DashboardRefreshTriggered.

GET /api/v1/analytics/dashboard-datasets/{id}/data
  Fetch the current data for a dashboard dataset.
  Query params: dimensionFilters (optional JSON; e.g., {"department": "OPS", "status": "ACTIVE"}).
  Response: rows array (low-latency, O(1) lookup).
  Applies permission filters automatically.
```

### 10.5 Cross-Tenant Query (Super-Admin only)

```
GET /api/v1/analytics/kpi/{id}?scope=CROSS_TENANT
  Fetch aggregation across all tenants. Requires analytics.view_cross_tenant permission.
  Logged and event-recorded as Analytics.CrossTenantQueryRequested.
  Response: aggregated data (all tenants, labeled with tenantId).
  NEVER returns unlabeled cross-tenant data.
```

### 10.6 Aggregation Job Status

```
GET /api/v1/analytics/jobs/{jobId}
  Poll the status of an aggregation job (QUEUED, RUNNING, SUCCEEDED, FAILED, etc.).
  Response: AggregationJob.
```

All endpoints enforce tenant isolation and permission checks. Responses include audit context (who requested, when, correlationId).

---

## 11. Event Contracts

### 11.1 Events published by Analytics Core

```
Analytics.KpiDefinitionCreated
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    kpiDefinitionId: UUIDv7,
    kpiName: string,
    actorId: UUIDv7,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.KpiDefinitionUpdated
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    kpiDefinitionId: UUIDv7,
    changes: { field: string, oldValue: any, newValue: any }[],
    actorId: UUIDv7,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.MetricComputed
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    metricModelId: UUIDv7,
    kpiDefinitionId: UUIDv7,
    timeResolution: string,
    timeBucket: ISO8601,
    value: numeric,
    rowsProcessed: integer,
    computationTimeMs: integer,
    timestamp: ISO8601
  }

Analytics.AggregationCompleted
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    jobId: UUIDv7,
    jobType: string (COMPUTE_KPI, REFRESH_METRIC_MODEL, REFRESH_DASHBOARD_DATASET),
    targetId: UUIDv7,
    rowsProcessed: integer,
    rowsAggregated: integer,
    computationTimeMs: integer,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.AggregationFailed
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    jobId: UUIDv7,
    errorMessage: string,
    retryCount: integer,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.AggregationDeadLettered
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    jobId: UUIDv7,
    errorMessage: string,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.RefreshTriggered
  {
    id: UUIDv7,
    tenantId: UUIDv7,
    targetId: UUIDv7 (KPI, MetricModel, or DashboardDataset ID),
    actorId: UUIDv7 (who triggered),
    timestamp: ISO8601,
    correlationId: UUIDv7
  }

Analytics.CrossTenantQueryRequested
  {
    id: UUIDv7,
    actorId: UUIDv7 (Super-Admin),
    kpiDefinitionId: UUIDv7 | null,
    filterCriteria: jsonb (what was queried),
    rowsReturned: integer,
    timestamp: ISO8601,
    correlationId: UUIDv7
  }
```

All Analytics events include `tenantId` (except cross-tenant queries, which include all tenant IDs in the result set) and are appended to the event store (audit-logged immutably).

### 11.2 Events Analytics Core subscribes to

Analytics Core subscribes to business core events to populate KPI data:

- **Service.Activated**, **Service.Cancelled**, **Service.Suspended** → triggers KPI recomputation if a KPI consumes `Service.Activated` event.
- **Financial.InvoiceCreated**, **Financial.PaymentProcessed** → for revenue/payment KPIs.
- **Work.Created**, **Work.Completed** → for task completion KPIs.
- **Case.Escalated**, **Case.Resolved** → for case-resolution KPIs.
- Any domain event listed in a `KpiDefinition.eventTopic` field.

Analytics Core handlers are idempotent: receiving the same event twice (or via replay) produces the same aggregation result.

---

## 12. Permission Enforcement

### 12.1 KPI definition and ownership

- **Create KPI**: requires `analytics.define_kpi` permission (Super-Admin, dedicated Analytics team).
- **Update KPI**: requires `analytics.manage_kpi` permission + the user must be the KPI owner or a Super-Admin.
- **View KPI definition**: any user with `analytics.view_kpi` permission. Definition includes the formula, so access is gated by permission.
- **Trigger refresh**: requires `analytics.trigger_refresh` permission.

### 12.2 Row-level filtering at aggregation time

When a KPI is queried, the aggregation applies both:

1. **KPI-level filter** (from `KpiDefinition.permissionFilter`): e.g., "exclude CANCELLED statuses".
2. **User-level filter** (from the requesting actor's permission scope): e.g., "this user can only see department X".

The final result is AND'd: a user sees only rows that match BOTH the KPI definition AND their permission scope.

Example:
- KPI: "Active Subscribers" (formula: `status = ACTIVE`).
- User: has `subscription.view` permission scoped to department "Northeast".
- Query result: count of subscriptions where `status = ACTIVE` AND `owningDepartment = Northeast`.

### 12.3 Cross-tenant visibility

- Normal users: see only their tenant's data. A query for KPI data without matching tenantId in the token is rejected (403 Forbidden).
- Super-Admin: may request `?scope=CROSS_TENANT` to see all tenants' data. This requires `analytics.view_cross_tenant` permission and is audit-logged as a separate event (`Analytics.CrossTenantQueryRequested`).

### 12.4 Dimension-scoped viewing

If a KPI declares a dimension (e.g., "sliced by Department"), the user's permission scope may restrict which dimension values are visible:

- KPI: "Churn Rate by Department".
- User: has `analytics.view_metric` permission scoped to departments ["Northeast", "Southeast"].
- Query: `GET /api/v1/analytics/metrics/{kpiId}/time-series?dimension=DEPARTMENT&dimensionValue=Southwest` → 403 Forbidden (user not permitted to see Southwest).

---

## 13. Data Freshness SLA

### 13.1 SLA definition

Every `KpiDefinition` declares:

- **`refreshCadence`**: enum { REAL_TIME, NEAR_REAL_TIME_1MIN, NEAR_REAL_TIME_5MIN, HOURLY, DAILY, WEEKLY }.
- **`dataFreshnessSlaMinutes`**: target latency (e.g., 5 for NEAR_REAL_TIME_5MIN).
- **`refreshWindowMinutes`**: grace window before alert (e.g., 2 for a 5-minute cadence, so alert fires at 7 minutes).

### 13.2 SLA monitoring and alerting

A background job monitors each KPI's refresh schedule:

- If a refresh completes before the SLA target, the metric is marked FRESH.
- If a refresh misses the target but completes within the grace window, the metric is marked STALE (but the previous snapshot is retained for display).
- If a refresh exceeds the grace window, an alert fires to the KPI owner: "KPI {name} refresh SLA missed".

The refresh job status is observable via `/api/v1/analytics/jobs/{jobId}` and events are emitted on miss.

### 13.3 Stale data display

If a KPI is STALE (refresh missed SLA but data exists), the dashboard displays:

- The last known value.
- A visual indicator: border tint or muted color (per D18 Semantic family).
- A tooltip: "Data last updated X minutes ago. Refresh in progress." (per D17 tooltip rule).

**Never silently show stale data without indication.**

---

## 14. Forbidden Patterns

### FP1 — Hardcoded KPI logic in application code

```python
# FORBIDDEN
def get_active_customers_count():
    return Customer.query.filter_by(status='ACTIVE').count()

# FORBIDDEN (in a view template)
const activeCount = customers.filter(c => c.status === 'ACTIVE').length;

# FORBIDDEN (in a report generation script)
SELECT COUNT(*) FROM customers WHERE status = 'ACTIVE' AND created_at >= NOW() - INTERVAL '30 days'
```

**REQUIRED:** define a `KpiDefinition` with `name = "Active Customers"`, `formula = "COUNT(*) WHERE status = ACTIVE"`, and consume it via the Analytics API.

### FP2 — Ad-hoc aggregation queries on the request path

```python
# FORBIDDEN
@app.get("/dashboard/operations")
def operations_dashboard():
    churn_rate = db.session.query(func.count(Customer.id)) \
        .filter(Customer.churn_date >= now - timedelta(days=30)) \
        .scalar() / total_customers
    return {"churnRate": churn_rate}
```

**REQUIRED:** define a `MetricModel` for churn rate, pre-compute it in a background job, store the result in `MetricTimeSeries`, and fetch from `DashboardDataset` on request.

### FP3 — Cross-tenant aggregation for normal users

```python
# FORBIDDEN (no tenantId filter)
SELECT SUM(revenue) FROM invoices  -- shows total across ALL tenants

# FORBIDDEN (accepts tenantId from untrusted input)
GET /api/v1/analytics/revenue?tenantId={req.query.tenantId}
```

**REQUIRED:** all queries include `tenantId` from the request token. Cross-tenant queries rejected unless user holds `analytics.view_cross_tenant` permission.

### FP4 — KPI without declared dimensions

```python
# FORBIDDEN
kpi = KpiDefinition(
    name="Service Installations",
    formula="...",
    dimensions=[]  # or dimensions not declared
)
# then later, a dashboard tries to slice by department
```

**REQUIRED:** `KpiDefinition.dimensions` explicitly lists all supported drill-down axes before the KPI is deployed.

### FP5 — Bypassing permission filters in aggregation

```python
# FORBIDDEN
def compute_kpi_without_user_filter(kpi_id):
    kpi = KpiDefinition.get(kpi_id)
    # compute kpi.formula directly, ignoring the requesting user's permissions
    return aggregate_without_permission_scope(kpi)
```

**REQUIRED:** every aggregation applies both `KpiDefinition.permissionFilter` AND the requesting actor's permission scope.

### FP6 — Real-time aggregation in dashboard render

```python
# FORBIDDEN
@app.get("/dashboard/nms")
def nms_dashboard():
    kpis = []
    for kpi_id in dashboard_kpi_ids:
        kpi = aggregate_from_scratch(kpi_id)  # O(n) computation on every page load
        kpis.append(kpi)
    return {"kpis": kpis}
```

**REQUIRED:** dashboards read from pre-computed `DashboardDataset` (O(1) query), never aggregate on demand.

### FP7 — Analytics-owned forecasting logic

```python
# FORBIDDEN
kpi = KpiDefinition(
    name="Revenue Forecast",
    formula="...",  # trying to predict future revenue
)
```

**REQUIRED:** forecasts are owned by Forecasting Core. KPIs explain the past/present only. If a page needs both KPI and forecast, define both separately and combine in the UI.

### FP8 — Analytics as AI prompt source without permission check

```python
# FORBIDDEN
def summarize_kpi(kpi_id):
    kpi = KpiDefinition.get(kpi_id)
    prompt = f"Summarize this KPI: {kpi.formula} with value {last_metric_value}"
    return ai_model.generate(prompt)  # no permission check that user can view this KPI
```

**REQUIRED:** AI Core reads KPI definitions only after checking `analytics.view_kpi` permission. AI-generated summaries inherit the KPI's permission scope.

---

## 15. KPI Tile Visual Standard (D17 + D18)

### 15.1 D17 — KPI Tile Standard

All KPI tiles on the platform render identically — no "premium", "headline", or "spotlight" variants.

#### 1. Uniform tile chrome

- All tiles use the same border, shadow, padding, and background.
- No tile is visually distinguished by gold rimming, accent backgrounds, or elevation.

**Implementation:**
```css
.kpi-tile {
  border: 1px solid var(--gx-border);
  border-radius: 8px;
  padding: 16px;
  background: var(--gx-surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
}
```

#### 2. State communicated by colored value text only

- `danger: true` → value rendered in `--gx-danger-fg` (red).
- `warning: true` → value in `--gx-warning-fg` (amber).
- `muted: true` → value in `--gx-text-3` (gray).
- (no flag) → value in `--gx-text-1` (black).

**Example:**
```jsx
<div className="kpi-tile">
  <label>{kpi.label}</label>
  <div className={`kpi-value ${kpi.danger ? 'text-danger' : ''}`}>
    {kpi.value}
  </div>
</div>
```

#### 3. Hover reveals tooltip (optional, every tile)

- If `KPISpec.tooltip` is provided, a popover appears above the tile on hover or focus.
- Motion: **fade-in + subtle scale only** (no slide, no element transform).
- Border tint (for containers, per D18): **gold border** (not blue).

**CSS:**
```css
.kpi-tile:hover {
  border-color: var(--gx-accent-gold);
  box-shadow: 0 0 8px rgba(194, 146, 55, 0.2);  /* soft gold glow */
}

.kpi-tile-tooltip {
  opacity: 0;
  transform: scale(0.95);
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
}

.kpi-tile:hover .kpi-tile-tooltip {
  opacity: 1;
  transform: scale(1);
}
```

**Tooltip content (1–2 short sentences):**
- What the metric counts.
- How it's computed (data source, exclusions).
- If clickable: what clicking does (e.g., "Filter customers to ACTIVE").
- Reference real data sources where not obvious (e.g., "last sweep, 60s old").

### 15.2 D18 — Color Token Families

KPI tiles use D18 color tokens for hover affordance:

| Family | Role | Tokens |
|---|---|---|
| **Cobalt** | Brand spine — structural chrome | `--gx-primary`, `--gx-surface`, `--gx-bg` |
| **Gold** | Brand signature — peak/featured, container hover | `--gx-accent-gold`, `--gx-accent-gold-soft` |
| **Azure** | Interactive — clickable affordances, control hover | `--gx-interactive`, `--gx-interactive-hover`, `--gx-interactive-soft` |
| **Slate** | Neutrals — data viz, text hierarchy, surfaces | `--gx-text-1/2/3`, `--gx-border`, `--gx-divider` |
| **Semantic** | Status — value text only | `--gx-success-fg`, `--gx-warning-fg`, `--gx-danger-fg`, `--gx-muted-fg` |

**KPI tile specific:**
- Tile chrome: Cobalt (brand spine).
- Value text: default (`--gx-text-1`) or Semantic (danger/warning/muted).
- Hover border: Gold (`--gx-accent-gold`) — containers use gold on hover, not blue.
- Tooltip background: Slate (neutral surface).

---

## 16. Background Aggregation Job Architecture

### 16.1 Job orchestration

Analytics Core coordinates with Background Processing Core to schedule and execute aggregation jobs:

1. **Schedule definition**: stored in `MetricModel.nextScheduledAt` and `DashboardDataset.nextRefreshAt`.
2. **Job enqueue**: at the scheduled time (or manually triggered), Analytics Core enqueues an `AggregationJob` to the BPC queue.
3. **Job execution**: BPC worker pulls the job, executes the aggregation SQL/query, and updates `MetricTimeSeries` and `DashboardDataset` with results.
4. **Job completion**: on success or failure, the job status is updated and an event is emitted (`Analytics.AggregationCompleted` or `Analytics.AggregationFailed`).

### 16.2 Idempotency and replay

Every aggregation job includes an `idempotencyKey` derived from `(kpiDefinitionId, timeResolution, timeBucket)`. If the same job is enqueued twice (e.g., via retry or requeue), the second run produces the same result without duplication:

- Deletes the previous metric point for the time bucket (if it exists).
- Recomputes the aggregation.
- Inserts the new result.

Result: no duplicate data in `MetricTimeSeries`.

### 16.3 Failure handling

On aggregation failure:

1. **Retry**: the job is requeued (retry count incremented). Max 3 retries with exponential backoff (1 min, 5 min, 10 min).
2. **Max retries exceeded**: the job is moved to dead-letter queue and `Analytics.AggregationDeadLettered` event is emitted.
3. **Manual intervention**: a Super-Admin may inspect the dead-lettered job, resolve the underlying issue, and replay it.

The last known good metric value remains available for dashboard display (marked STALE) until the refresh succeeds.

---

## 17. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | Analytics Core definition, purpose, and boundaries. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership law, permission framework. |
| `09_DATA_ARCHITECTURE.md` | Data schemas, canonical entity definitions. |
| `08_PERMISSION_ARCHITECTURE.md` | Permission keys and enforcement rules. |
| `15_REPORTING_ARCHITECTURE.md` | Separation between Analytics and Reporting; Reporting consumes KPI definitions. |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` | Dashboard page composition, KPI tile rendering, color tokens (D17, D18). |
| `13_CONSISTENCY_PATCH_NOTES.md` | D17 KPI Tile Standard, D18 Color Token Families, D19 Rule ↔ Implementation Parity. |

| Documents that depend on this one |
|---|
| `04_NAVIGATION_ARCHITECTURE.md` (Analytics pages and their placement). |
| `10_API_ARCHITECTURE.md` (Analytics Core API contracts). |
| `11_EVENT_ARCHITECTURE.md` (Analytics events and subscriptions). |
| `15_REPORTING_ARCHITECTURE.md` (Reporting consumes KPI definitions). |
| `06_UI_EXPERIENCE_ARCHITECTURE.md` (Dashboard and KPI tile visuals). |
| `19_BACKGROUND_PROCESSING_ARCHITECTURE.md` (aggregation job execution). |

---

## 18. Implementation Requirements

### 18.1 KPI definition registry

`docs/analytics/kpi-registry.md` catalogs all live KPIs (one row per KPI definition):

| KPI Name | Owner | Cadence | Dimensions | Source |
|---|---|---|---|---|
| Active Subscribers | Operations | HOURLY | DEPARTMENT, LOCATION | `Service.Activated` event |
| Service Cancellations (30d) | Finance | DAILY | DEPARTMENT, REASON | Service table, status = CANCELLED |
| Revenue (MTD) | Finance | HOURLY | DEPARTMENT, PRODUCT | Invoice table, createdAt >= start of month |

Updated whenever a KPI definition is created or archived.

### 18.2 Per-KPI checklist before deployment

Before a new KPI goes live:

- [ ] `KpiDefinition` entity created in database.
- [ ] Formula tested against production data (SQL validated, results spot-checked).
- [ ] Dimensions declared and tested (drill-down works correctly).
- [ ] Permission filter defined and tested (user sees only permitted rows).
- [ ] Refresh cadence and SLA targets agreed (refreshes on schedule, latency monitored).
- [ ] Aggregation job runs successfully (first 3 jobs audited).
- [ ] Dashboard dataset pre-computed and dashboard page linked.
- [ ] Tooltip written (1–2 sentences, references data source).
- [ ] KPI tile visual tested (matches D17 + D18 colors).
- [ ] Audit and event emission verified (KPI changes logged, refresh events emitted).
- [ ] KPI registered in kpi-registry.md.
- [ ] Owner assigned (accountable for ongoing maintenance).

### 18.3 Monitoring and observability

Every aggregation job exposes metrics and logs:

- **Latency**: from job start to completion (per KPI, per time resolution).
- **Success rate**: % of jobs completing without error.
- **Data freshness**: time since last successful refresh (per KPI).
- **SLA compliance**: % of KPIs meeting their refresh SLA target.

Alerts fire on:

- **SLA miss**: refresh exceeds grace window.
- **Job failure**: aggregation job dead-lettered after max retries.
- **Dimension misconfiguration**: drill-down request for undeclared dimension.

---

*End of 16 — Analytics Architecture.*
