# 18 — Observability Architecture

**Constitutional document.** Position in the hierarchy: foundational HOW viewpoint (alongside Security, Tenant, Event, Data). Governs how GAAhex exposes operational health, metrics, traces, logs, alerts, SLO tracking, and operational dashboards to keep the platform running.

---

## 1. Purpose

Codify how every API, worker, job, integration, AI action, and critical workflow exposes health, metrics, traces, logs, and alerts. Distinguish **Observability** (operational signal for operators) from **Audit** (immutable evidence for compliance) and from **Analytics** (business insight for stakeholders). Make the platform transparent to the NOC, on-call engineers, and platform SREs without reimplementing operational intelligence across each core.

## 2. Scope

In scope:

- HealthCheck primitives (liveness, readiness per service).
- Prometheus-style metrics (counters, gauges, histograms, summaries).
- OpenTelemetry traces (distributed tracing, spans, baggage, correlation IDs).
- Structured logs (JSON, tenant-tagged, PII-redacted).
- AlertRule definitions and severity levels.
- SLO definitions, burn-rate tracking, and alert policies.
- Observability on critical-path APIs, async jobs, integrations, AI actions, and workflows.
- NOC operational dashboards (incident feed, SLA risk, service health, on-call status).
- Alert routing (PagerDuty / on-call via Notification Core).
- Tenant-scoped vs. system-wide observability boundaries.

Out of scope (handled by other documents):

- Audit event generation and storage (Audit Core) — see `11_EVENT_ARCHITECTURE.md`.
- Analytics KPI models and dashboards (Analytics Core) — see `16_ANALYTICS_ARCHITECTURE.md`.
- Infrastructure provisioning and monitoring tools (Kubernetes, Docker, TF) — see `19_INFRASTRUCTURE_ARCHITECTURE.md`.
- UI theme or brand (see `docs/branding/v3.0/`).

## 3. Goals

- **G1** Every API endpoint, background job, integration, and AI action exposes a canonical set of metrics: latency, traffic, errors, saturation per critical service.
- **G2** Distributed tracing is mandatory on cross-core async calls; `correlationId` propagates from request entry to completion.
- **G3** Logs are structured (JSON), tenant-tagged by default, and PII is redacted before shipping.
- **G4** SLO burn-rate alerts prevent flapping; alerts route to NOC for customer-impact events and to engineering on-call for system events.
- **G5** NOC dashboards are tenant-scoped by default; super-admins can aggregate across tenants.
- **G6** Observability is configured, not coded; a new core or workflow exposes signals via declarative health / metrics / log definitions, not custom instrumentation.
- **G7** No ungoverned `print()`, `console.log()`, or unmasked PII in production logs.

## 4. Non-Goals

- **NG1** This document does NOT design UI layouts (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).
- **NG2** This document does NOT replace Audit Core (see Audit in PLATFORM_REFERENCE_MODEL.md).
- **NG3** This document does NOT define business KPIs (that is Analytics Core; see `16_ANALYTICS_ARCHITECTURE.md`).
- **NG4** This document does NOT cover vendor lock-in to specific monitoring stacks (Datadog, New Relic, etc.). The architecture is vendor-neutral and extensible.

## 5. Architecture Principles

### P1 — Observability ≠ Audit ≠ Analytics

- **Observability** answers "Is the system working right now?" — operational signal, time-bound (seconds to hours).
- **Audit** answers "Who did what and when?" — immutable evidence, kept forever, compliance-driven.
- **Analytics** answers "How did we perform?" — business insight, aggregated, KPI-driven.

A single event (e.g., `Service.Activated`) may feed all three: Observability tracks success/failure rate, Audit records who activated it, Analytics counts new services per month. Each consumes independently.

### P2 — Four golden signals per critical service

Every critical service (API, job, integration) emits four signals:

1. **Latency** — p50, p95, p99 response time (milliseconds).
2. **Traffic** — requests/second, throughput (bytes/second).
3. **Errors** — error rate (%) and error count, grouped by code.
4. **Saturation** — resource utilization (CPU, memory, queue depth, DB connections).

These four are sufficient to diagnose most operational issues; anything beyond is domain-specific instrumentation, not foundational.

### P3 — Distributed tracing for async and cross-core boundaries

When a request spans multiple services (API → background job → integration → notification), a single `correlationId` (UUID) carries context. Every log line, span, and metric carries the `correlationId` so operators can reconstruct the entire transaction without joins.

### P4 — Structured logs with tenant isolation

Logs are JSON, not free text. Every log line carries:

- Timestamp (ISO 8601 UTC).
- Service name (`gaahex`, `worker-billing`, etc.).
- Span trace ID (from OpenTelemetry).
- Tenant ID (for single-tenant log filtering).
- Severity level (DEBUG, INFO, WARN, ERROR, CRITICAL).
- Message + structured fields (no raw `str(exception)`).
- **PII is redacted** before shipping (email addresses, phone numbers, SSN redacted to `*****`).

### P5 — SLO burn-rate alerts, not threshold alerts

Instead of "alert when latency > 100ms", define an SLO: "99% of requests answer in < 100ms." Track burn rate (how fast the error budget is consumed). Alert only when burn rate exceeds a threshold (e.g., "losing 1% of monthly budget per hour"). This prevents alert fatigue and focuses on real customer impact.

### P6 — Health checks are executable contracts

A `/health` endpoint is not a "status page." It is an executable contract: given zero external input, the service guarantees to respond with healthy/unhealthy in <1 second. Health checks are *liveness* (is the process alive?) and *readiness* (is the service ready to handle traffic?).

### P7 — Observability is universal; no core is exempt

Every core's APIs, events, jobs, and integrations must expose health, metrics, traces, and logs. Observability is not optional for "expensive" or "critical" services — it is Foundation tier. Missing observability is a hard design flaw.

### P8 — Configuration governs observability expressions

A new core registers its health status, critical paths, and SLOs in configuration, not in code. A monitoring stack watches configuration and wires alerts automatically.

## 6. Architecture Laws

### L1 — Every critical-path API emits 4 golden signals

> Any endpoint serving >100 requests/minute, or any endpoint whose failure impacts customers directly, MUST emit latency, traffic, error rate, and saturation metrics.

Co-owned with Operational Core (§05).

### L2 — Cross-core async calls carry correlationId

> Every `emit(event)` call, background job trigger, or integration dispatch carries a unique `correlationId` (UUID v4) in its context. That ID propagates to all downstream logs, spans, and metrics.

Prevents trace fragmentation.

### L3 — Logs are immutable JSON + PII-redacted

> All logs shipped to a central store are valid JSON. Every log entry is immutable (no modification after creation). Sensitive fields (PII, secrets, tokens) are redacted before shipping. Violations are audit-logged.

### L4 — SLO burn-rate gates alerts

> Alerts on SLO metrics (e.g., "error budget exceeded") are gated by burn-rate thresholds, not raw threshold crossings. An alert fires only if burn rate in the last 1h exceeds 10% of monthly budget per hour.

Prevents alert storm during brief spikes.

### L5 — HealthCheck timeout ≤ 1 second

> Every HealthCheck endpoint responds in <1 second with a deterministic pass/fail. If a health check would block (e.g., waiting for a database query that might hang), it fails immediately.

Liveness probes must be fast and unblockable.

### L6 — NOC sees only tenant-scoped data by default

> Operational dashboards (NOC, billing health, integration health) surface only the logged-in user's tenant's data by default. Super-Admin role is required to see cross-tenant views. Enforcement is via `tenantId` in alert routing and log filtering.

### L7 — Customer-impact alerts → NOC; System alerts → Engineering

> An alert that directly impacts customer SLA (e.g., "service latency > SLO") routes to the NOC on-call (via Notification Core → PagerDuty). An alert about internal system health (e.g., "background job queue depth > threshold") routes to engineering on-call. Assignment is declarative per AlertRule.

### L8 — No ungoverned logs in production

> `print()`, `console.log()`, and raw exception string representations are forbidden in production code. All operational signal must flow through Observability Core (structured logging, metrics, traces). Code review and linting rules enforce this.

## 7. Core Concepts

### 7.1 HealthCheck

A service declares its health in three parts:

```python
# Pseudo-code
@router.get("/health")
async def liveness() -> HealthStatus:
    # Do NOT call external services. Just confirm the process is alive.
    return HealthStatus(status="ALIVE", service="gaahex")

@router.get("/health/ready")
async def readiness() -> HealthStatus:
    # Check readiness: DB connection, cache, critical dependencies.
    # Timeout at 1 second.
    db_ok = await db.check_connection(timeout=500ms)
    cache_ok = redis.ping(timeout=200ms)
    return HealthStatus(
        status="READY" if (db_ok and cache_ok) else "NOT_READY",
        dependencies={"db": db_ok, "cache": cache_ok}
    )
```

- **Liveness** (`/health`) — is the process alive? No external calls.
- **Readiness** (`/health/ready`) — is the service ready to handle traffic? Check critical dependencies with timeouts.
- **Depth** (optional, internal) — detailed per-component status; not exposed to LBs.

Kubernetes (or the orchestration layer) periodically calls these endpoints and removes unhealthy pods from traffic.

### 7.2 Metrics

Four categories, aligned with Prometheus:

#### Counters (monotonic; only increase)

```
# Example: request count by method and status
http_requests_total{method="GET", status="200", service="api"} 1234567
http_requests_total{method="POST", status="201", service="api"} 234
http_requests_total{method="POST", status="400", service="api"} 12
```

**When to use:** counts of completed events (requests, jobs, errors, billable actions).

#### Gauges (can increase or decrease)

```
# Example: active connections, queue depth
http_connections_active{service="api"} 45
job_queue_depth{queue="billing"} 1200
memory_usage_bytes{service="api"} 524288000
```

**When to use:** snapshots of current state (memory, connections, queue depth).

#### Histograms (distributions of values)

```
# Example: response time distribution
http_request_duration_seconds_bucket{le="0.01", endpoint="/api/leads"} 450
http_request_duration_seconds_bucket{le="0.1", endpoint="/api/leads"} 4950
http_request_duration_seconds_bucket{le="1", endpoint="/api/leads"} 5000
http_request_duration_seconds_bucket{le="+Inf", endpoint="/api/leads"} 5012
http_request_duration_seconds_count{endpoint="/api/leads"} 5012
http_request_duration_seconds_sum{endpoint="/api/leads"} 3456.78
```

**When to use:** latency, response size, processing duration. Histograms auto-compute p50, p95, p99 percentiles.

#### Summaries (like histograms but with rolling quantiles)

```
# Example: database query duration
db_query_duration_seconds{quantile="0.5", query_type="SELECT"} 0.012
db_query_duration_seconds{quantile="0.95", query_type="SELECT"} 0.045
db_query_duration_seconds_count{query_type="SELECT"} 8934
db_query_duration_seconds_sum{query_type="SELECT"} 123.45
```

**When to use:** Summaries are less common than histograms; use histograms unless you specifically need rolling quantiles across a long time window.

### 7.3 Traces (Distributed Tracing)

An OpenTelemetry span represents a unit of work. Spans have:

- **Trace ID** (UUID, the entire transaction).
- **Span ID** (UUID, this step).
- **Parent Span ID** (the span that called this one).
- **Name** (e.g., "http.get /api/services").
- **Status** (OK, ERROR).
- **Duration** (start + end time).
- **Attributes** (key-value metadata: tenant ID, user ID, method, status code).
- **Events** (milestones within the span: "query_start", "query_end", "error").

**Example transaction across three services:**

```
Trace ID: uuid-12345

├─ Span: http_request (root)
│  ├─ Attribute: path=/api/services/{id}
│  ├─ Attribute: method=GET
│  ├─ Attribute: tenant_id=tenant-abc
│  ├─ Attribute: user_id=user-xyz
│  ├─ Duration: 234ms
│  │
│  └─ Child Span: db_query
│     ├─ Attribute: query="SELECT * FROM services WHERE id = ?"
│     ├─ Event: query_start (time: 10ms)
│     ├─ Event: query_end (time: 45ms)
│     ├─ Duration: 35ms
│
└─ Span: event_emit (published by API)
   ├─ Attribute: event_type=Service.Activated
   ├─ Attribute: tenant_id=tenant-abc
   ├─ Duration: 5ms
```

All three spans carry the same **Trace ID**. An operator can query "show me all spans with trace_id=uuid-12345" and reconstruct the entire flow, including which database query ran, how long it took, and whether events published.

### 7.4 Logs (Structured, JSON)

Every log line is JSON:

```json
{
  "timestamp": "2026-06-06T14:32:15.123456+00:00",
  "service": "api",
  "level": "ERROR",
  "message": "Service activation failed",
  "trace_id": "uuid-12345",
  "span_id": "uuid-5678",
  "tenant_id": "tenant-abc",
  "user_id": "user-xyz",
  "exception_type": "DatabaseError",
  "exception_message": "[REDACTED: database connection timeout]",
  "context": {
    "service_id": "svc-123",
    "status_before": "PROVISIONING",
    "status_after": "FAILED"
  }
}
```

**No free-text logs.** No `print(f"Service {service_id} failed: {e}")`. Use structured fields instead.

**PII redaction happens before shipping:** email addresses, phone numbers, IP addresses, SSNs, and credit card numbers are detected and replaced with `[REDACTED: field_type]`.

### 7.5 AlertRule

An alert definition specifies when and where to notify:

```python
AlertRule(
    name="Service Latency SLO Breach",
    metric="http_request_duration_seconds",
    condition='histogram_quantile(0.95, rate(http_request_duration_seconds[5m])) > 0.1',
    duration="5m",
    severity="CRITICAL",
    burn_rate_gate=True,  # Only alert if burn rate > threshold
    route_to="NOC",
    escalation_after="15m",
    notification_channels=[
        NotificationChannel(type="PagerDuty", on_call_rotation="NOC_Tier1"),
        NotificationChannel(type="Slack", channel="#noc-incidents"),
    ]
)
```

Rules can reference:

- **Prometheus metrics** (PromQL expressions).
- **SLO definitions** (error budget, burn rate).
- **Business thresholds** (from Configuration or Entitlement Core).

### 7.6 SLO (Service Level Objective)

An SLO specifies a target and error budget:

```python
SLO(
    name="Service API 99% Availability",
    service="Service Core",
    objective=0.99,  # 99% of requests successful
    window="30d",     # Monthly window
    error_budget=0.01,  # 1% = 7.2 hours per month
    target_metric='rate(http_requests_total{status=~"[45]..", service="service-api"}[5m])',
    burn_rate_threshold=0.1,  # Alert if burn rate > 10% of monthly budget per hour
)
```

**Burn rate** = how fast the error budget is consumed. If the SLO is "99% over 30 days" and the current error rate is 2%, the burn rate is 2x (consuming the monthly budget in 15 days).

**Burn-rate alerts** avoid false positives: a brief 10-minute spike in errors does not trigger an alert (burn rate is low). A sustained 2% error rate over an hour triggers an alert (burn rate is high).

### 7.7 Observability per Core

Each core declares:

1. **Health:** What constitutes "healthy" for this core? Is the database connection OK? Is the event bus responding?
2. **Metrics:** Which four golden signals are critical? (E.g., Service Core tracks API latency, service activation throughput, activation errors, database query backlog.)
3. **Critical paths:** Which APIs / jobs must never fail silently? (E.g., Service.Activated event emission is critical; subscription confirmation email is best-effort.)
4. **SLOs:** What commitments does this core make? (E.g., "99.9% of service activation APIs respond in < 100ms.")
5. **Logs:** What events need operational visibility? (E.g., all state transitions, all permission denials, all third-party API calls.)

### 7.8 Operational Dashboards

#### NOC Dashboard (Operations + Workflow + SLA)

Assembled from multiple cores (§05):

| Tile                          | Source                | Metric / Log                          |
|-------------------------------|-----------------------|---------------------------------------|
| Open Incidents                | Case Core             | count(case.type='INCIDENT' AND status != 'CLOSED') |
| Sev1 / Sev2 counts            | Case Core             | count(case.severity IN ('SEV1', 'SEV2')) |
| SLA Breach Risk (>75%)         | SLA Core              | count(sla_clock.percent_elapsed > 0.75) |
| Active Breaches (>100%)        | SLA Core              | count(sla_clock.percent_elapsed >= 1.0) |
| Customers Impacted (last 1h)   | Relationship Core     | count(distinct(service.customer_id) WHERE incident CREATED > now()-1h) |
| MRR at Risk                    | Financial Core        | sum(service.mrr WHERE incident.severity='SEV1' AND incident.status != 'CLOSED') |
| Top Affected Services          | Service Core + Case   | group_by(service.name) count(incident) ORDER BY count DESC LIMIT 5 |
| On-Call: Tier 1 / Tier 2       | Scheduling Core       | current_on_call(rotation_id='NOC_Tier1/2') |
| Recent Changes (last 24h)      | Case Core             | case.type='CHANGE_REQUEST' AND created > now()-24h ORDER BY created DESC |
| Recent Alerts                  | Observability Core    | alert[CRITICAL,ERROR] LAST 24h LIMIT 10 |

Each tile is **real-time** or **5-minute latency** and fetches from the canonical API, not from a separate analytics warehouse.

#### Billing Health Dashboard

| Tile                          | Source                       |
|-------------------------------|------------------------------|
| Cycle Run Status              | Background Processing Core   |
| Invoices Generated (last 24h)  | Financial Core               |
| Failed Invoices               | Financial Core (status=ERROR)|
| Revenue (MTD)                 | Financial Core (sum invoice.total) |
| Dunning Events (last 7d)       | Notification Core            |
| Payment Reconciliation (lag)   | Financial Core (max(created_at - received_at)) |

#### Integration Health Dashboard

Per integration (Stripe, CRM, etc.):

| Tile                          | Meaning                                |
|-------------------------------|----------------------------------------|
| Last Sync Time                | Integration Core (last webhook received or scheduled job run) |
| Sync Lag (seconds)            | now() - last_sync_time                 |
| Failed Syncs (last 7d)         | count(sync_job.status='FAILED' LAST 7d) |
| Error Rate                    | error_count / total_count (last hour)   |
| Queue Depth                   | count(pending sync jobs)                |
| Latest Error                  | Most recent integration error message   |

#### Ingest Health Dashboard (for ISP field data)

| Tile                          | Meaning                                |
|-------------------------------|----------------------------------------|
| Network Element Telemetry (last 1h) | count(telemetry event) from Resource Core |
| ONU Heartbeats Missed (last 1h)    | count(onu.heartbeat_expected - heartbeat_received) |
| Last Known State of Critical ONUs   | from Resource Core, filtered to mission-critical sites |
| Fiber Link Status (last 1h)        | gauge(fiber_link.status) from Resource Core |
| Gateway Health                     | /health status of each gateway instance |

### 7.9 Alert Routing

An alert fires and is routed based on **severity** and **route_to**:

```
Alert: "Service Latency SLO Breach"
├─ Severity: CRITICAL
├─ route_to: NOC
├─ Resolves to on-call: Scheduling.current_on_call("NOC_Tier1")
│  └─ Send via: Notification Core
│     ├─ PagerDuty: trigger incident for on-call user
│     ├─ SMS / Push: page the person immediately
│     └─ Slack: post to #noc-incidents

Alert: "Background Job Queue Depth High"
├─ Severity: WARNING
├─ route_to: Engineering
├─ Resolves to on-call: Scheduling.current_on_call("Engineering_OnCall")
│  └─ Send via: Notification Core
│     ├─ Slack: post to #engineering-oncall
│     └─ Email: engineering-oncall@gaahex.com
```

## 8. Canonical Entities (Observability Core)

| Entity                | Purpose                                  |
|-----------------------|------------------------------------------|
| HealthCheck           | Service health status (liveness + readiness) |
| Metric                | Prometheus-style metric definition + recent values |
| MetricPoint           | Single metric observation (timestamp + value) |
| Trace                 | OpenTelemetry trace (collection of spans) |
| Span                  | OpenTelemetry span (one unit of work) |
| LogStream             | Named log stream (per service, per tenant) |
| LogEntry              | Single structured log line (JSON) |
| AlertRule             | Alert definition (metric, condition, severity, routing) |
| AlertIncident         | Firing alert instance (when, why, who's on-call) |
| SloDefinition         | SLO target, error budget, window, burn-rate thresholds |
| SloWindow             | Rolling window (30-day or 7-day) for burn-rate tracking |
| ServiceStatus         | Roll-up: is a named service healthy right now? |
| OnCallScheduleSnapshot | Current on-call at this moment (cached for fast lookup) |

## 9. Ownership Boundaries

### 9.1 Observability Core owns signal infrastructure

Observability Core owns:

- HealthCheck endpoints (via health-check registry).
- Metric collection, storage, and querying (Prometheus or equivalent).
- Trace collection and storage (OpenTelemetry collector).
- Structured log ingestion, storage, and shipping (ELK, Datadog, etc.).
- AlertRule definitions and firing logic.
- SLO definitions and burn-rate calculation.
- On-call schedule snapshot and alert routing.

### 9.2 Each core owns its health + metrics + logs

Each business core (Service, Case, Financial, etc.) defines:

- What "healthy" means for that core (via HealthCheck registration).
- Which four golden signals matter (via Metric registration).
- Which events must be logged (via LogStream definition).
- Which SLOs it commits to (via SloDefinition registration).

Example: Service Core registers:

```python
HealthCheck(
    name="service-api",
    liveness_check=lambda: process.alive(),
    readiness_check=lambda: db.connection_ok(timeout=500ms),
)

Metric(name="service_activations_total", type="counter", labels=["status", "tenant_id"])
Metric(name="service_activation_latency_seconds", type="histogram", labels=["percentile"])

SloDefinition(
    name="Service API 99% Availability",
    metric="http_requests_total",
    objective=0.99,
    window="30d",
)

LogStream(
    name="service-core",
    fields=["service_id", "tenant_id", "event_type", "status_before", "status_after"],
    sample_rate=1.0,  # Log 100% of events
)
```

### 9.3 Operations Core (NOC, Dispatch) owns dashboards and escalation

Operations Core (defined in §05) consumes observability signals and assembles them into:

- NOC dashboard (above).
- Dispatch board (work queue + technician capacity).
- Escalation policies (who to page when an alert fires).

### 9.4 Integration Core owns connector observability

Each integration (Stripe, SNMP, etc.) registers health + metrics with Observability Core:

```python
Metric(
    name="stripe_webhook_latency_seconds",
    integration="stripe",
    type="histogram",
)

AlertRule(
    name="Stripe Sync Lag > 5min",
    metric="stripe_webhook_latency_seconds",
    condition="rate(stripe_webhook_latency_seconds[5m]) > 300",
    route_to="Engineering",
)
```

## 10. Relationships

### 10.1 Alert → Notification

When an AlertRule fires:

```
AlertRule fires
  ↓
Alert incident created (AlertIncident)
  ↓
Resolve route_to → on-call user (via Scheduling Core)
  ↓
Emit Notification.Send event
  ↓
Notification Core sends PagerDuty / SMS / Slack / Email
```

### 10.2 SLO → Burn-rate → Alert

```
SloDefinition defines target (99% over 30d, 1% error budget)
  ↓
SloWindow tracks rolling 30-day consumption
  ↓
Burn-rate calculator: (cumulative errors / error budget) / (elapsed time / window duration)
  ↓
If burn_rate > threshold (e.g., 10% of monthly budget per hour):
   emit AlertRule trigger
```

### 10.3 Trace → Log correlation

Every log entry carries `trace_id` and `span_id` from the active OpenTelemetry context. An operator can query logs with `trace_id=X` and reconstruct the entire transaction without separate trace storage queries.

### 10.4 Health + Metric aggregation → ServiceStatus

A `ServiceStatus` roll-up combines:

- Health checks from all instances of a service.
- Recent metric trends (latency, error rate).
- SLO burn-rate.

If 1+ instance is unhealthy OR latency p95 > SLO OR burn rate > threshold, `ServiceStatus = UNHEALTHY`.

## 11. Responsibilities

### 11.1 Platform owner (Gev / Ընգեր)

- Approves new AlertRule definitions that route to NOC or Engineering.
- Sets SLO targets (% availability, latency thresholds) in consultation with teams.
- Reviews alert storms and adjusts burn-rate thresholds.

### 11.2 Core owners

- Register health checks, metrics, logs, and SLOs for their core.
- Ensure every critical API and job emits the four golden signals.
- Test that observability signals are accurate under load.

### 11.3 NOC

- Owns the NOC dashboard and incident-response runbooks.
- Configures on-call rotations (via Scheduling Core).
- Tunes alerting rules to reduce flapping and improve signal quality.

### 11.4 SRE / Platform Engineering

- Owns the observability stack (Prometheus, OpenTelemetry collector, log shipping, PagerDuty integration).
- Ensures all health checks, metrics, and logs reach the central store.
- Monitors observability system itself (is the monitoring system healthy?).

## 12. Allowed Patterns

### AP1 — Health check per service instance

Each running instance of a service (API pod, worker pod, cron job) exposes `/health` and `/health/ready`. The orchestration layer (Kubernetes) periodically polls and removes unhealthy instances.

### AP2 — Metric labels for multi-tenancy

```
http_requests_total{tenant_id="tenant-abc", service="api", method="GET", status="200"}
http_requests_total{tenant_id="tenant-xyz", service="api", method="GET", status="200"}
```

Dashboards filter by tenant_id so each tenant sees only its own metrics (unless Super-Admin).

### AP3 — Trace sampling for high-volume services

For services with >10k requests/second, sample traces (e.g., 1 in 1000 requests gets a full trace; 999 carry a sampled-out flag). This reduces trace storage cost while preserving visibility into slow / error transactions (which are always sampled).

### AP4 — PII redaction before shipping

```python
def redact_pii(log_entry: dict) -> dict:
    """Replace sensitive fields with [REDACTED: field_type]"""
    for key in ["email", "phone", "ssn", "credit_card"]:
        if key in log_entry:
            log_entry[key] = f"[REDACTED: {key}]"
    return log_entry
```

Redaction happens in the logging library (e.g., custom handler in Python logging), not in application code.

### AP5 — Customer-impact alerts route to NOC

```python
AlertRule(
    name="Service Latency Breach",
    # This impacts customers directly
    route_to="NOC",
    escalation_after="5m",  # Page Tier 2 if Tier 1 doesn't ack
)

AlertRule(
    name="Background Job Queue Backlog",
    # This impacts internal operations, not customers (yet)
    route_to="Engineering",
)
```

### AP6 — SLO burn-rate gates alert firing

```
SLO: 99% availability over 30 days = 7.2 hours error budget per month
Error rate today: 0.5% (consuming budget fast)
Burn rate: 0.5% / 1% * 30 = 15x (would consume monthly budget in 2 days)
→ ALERT FIRES

Error rate today: 0.01% (consuming budget slowly)
Burn rate: 0.01% / 1% * 30 = 0.3x (would consume monthly budget in 100 days)
→ No alert (acceptable blip)
```

## 13. Forbidden Patterns

### FP1 — print() or console.log() in production code

Forbidden. All operational signal must be structured logs:

```python
# ❌ Forbidden
print(f"Service {service_id} activation failed: {exception}")

# ✅ Correct
logger.error(
    "Service activation failed",
    extra={
        "service_id": service_id,
        "exception_type": type(exception).__name__,
        "exception_message": str(exception),
    }
)
```

Linting rules reject unstructured logging in backend code.

### FP2 — Alert on raw threshold without burn-rate gating

Forbidden:

```python
# ❌ Forbidden
if error_rate > 0.5%:
    alert("Error rate high")

# ✅ Correct
if burn_rate > 0.1:  # 10% of monthly budget per hour
    alert("SLO Breach")
```

Threshold alerts cause alert fatigue. Always gate on burn rate for SLO metrics.

### FP3 — Unmasked PII in logs

Forbidden:

```json
{
  "email": "alice@example.com",
  "phone": "+1-555-1234",
  "message": "Payment failed for card 4111111111111111"
}
```

Correct:

```json
{
  "email": "[REDACTED: email]",
  "phone": "[REDACTED: phone]",
  "message": "Payment failed for card [REDACTED: credit_card]"
}
```

### FP4 — Synchronous health checks

Forbidden:

```python
# ❌ Forbidden
@router.get("/health/ready")
async def readiness() -> HealthStatus:
    # This blocks until the query completes; could hang forever
    result = await db.query("SELECT COUNT(*) FROM huge_table")
    return HealthStatus(status="READY" if result > 0 else "NOT_READY")
```

Correct:

```python
# ✅ Correct
@router.get("/health/ready")
async def readiness() -> HealthStatus:
    # Fast connection check with timeout
    try:
        await asyncio.wait_for(db.ping(), timeout=0.5)
        cache_ok = redis.ping(timeout=0.2)
        return HealthStatus(status="READY" if cache_ok else "NOT_READY")
    except asyncio.TimeoutError:
        return HealthStatus(status="NOT_READY")
```

### FP5 — Observability as afterthought

Forbidden: building an API first, then "adding observability later."

Correct: the HealthCheck, Metric, SLO, and Log definitions are part of the design; they ship with the code.

### FP6 — Cross-tenant observability dashboards (non-Super-Admin)

Forbidden for non-Super-Admin users:

```
NOC for tenant-abc should NOT see metrics from tenant-xyz
```

All queries must filter by `tenant_id` at the source. Super-Admin can override.

### FP7 — Ungoverned alert escalation

Forbidden: hard-coding who to page in an alert.

Correct: alert routing is declarative:

```python
AlertRule(
    name="SLO Breach",
    route_to="NOC",
    on_call_rotation="NOC_Tier1",  # From Scheduling Core
    escalation_after="15m",
    escalation_rotation="NOC_Tier2",
)
```

## 14. Cross-Architecture Dependencies

| Upstream                                  | For                                        |
|-------------------------------------------|--------------------------------------------|
| `PLATFORM_REFERENCE_MODEL.md`             | Observability Core definition               |
| `01_PLATFORM_CORE_ARCHITECTURE.md`        | Core ownership; universal observability rule|
| `05_OPERATIONAL_ARCHITECTURE.md`          | NOC dashboard; alert routing to on-call     |
| `08_PERMISSION_ARCHITECTURE.md`           | Dashboard access control per role           |
| `09_DATA_ARCHITECTURE.md`                 | Entity audit / mutation events              |
| `11_EVENT_ARCHITECTURE.md`                | Event emission (audit → observability)     |
| `13_SECURITY_ARCHITECTURE.md`             | Secrets in observability (token redaction) |
| `14_TENANT_ARCHITECTURE.md`               | Tenant isolation in dashboards and logs     |

| Downstream                                | For                                        |
|-------------------------------------------|--------------------------------------------|
| `06_UI_EXPERIENCE_ARCHITECTURE.md`        | NOC, Billing, Integration dashboards       |
| `19_INFRASTRUCTURE_ARCHITECTURE.md`       | Prometheus, OpenTelemetry, log shipping    |
| `21_AI_ARCHITECTURE.md`                   | AI action observability + audit logging     |
| `22_MOBILE_OFFLINE_ARCHITECTURE.md`       | Mobile field execution traces and logs     |

## 15. Implementation Requirements

### 15.1 Health check infrastructure

- Central health check registry (`backend/app/observability/health.py`).
- Every core service registers liveness + readiness checks at startup.
- `/health` and `/health/ready` endpoints on every service (API, worker, etc.).
- Orchestration layer (Kubernetes or Docker Compose for local dev) polls these endpoints.

### 15.2 Metrics infrastructure (Prometheus)

- Prometheus scrape config pointing to each service's `/metrics` endpoint.
- Application metrics library (e.g., `prometheus_client` for Python, `prom-client` for Node).
- Every critical-path API and job emits four golden signals via decorators / middleware.
- Grafana dashboards for NOC, Billing, Integration health (§7.8).

### 15.3 Tracing infrastructure (OpenTelemetry)

- OpenTelemetry SDK integrated into backend and frontend.
- `correlationId` injected into every request context at the API boundary.
- Trace exporter (e.g., OTLP to Jaeger or DataDog).
- Span creation at critical boundaries: API call, database query, external API call, event emission.

### 15.4 Logging infrastructure

- Centralized structured logging library (`python-json-logger` for Python, `pino` for Node).
- Log shipper (Filebeat or equivalent) or direct CloudWatch / DataDog integration.
- PII redaction filter configured in the logging pipeline.
- `/logs/{trace_id}` query endpoint to fetch all logs for a given transaction.

### 15.5 Alerting infrastructure

- AlertRule repository (database table or YAML files) with Prometheus rule evaluation.
- Alert manager (Prometheus AlertManager or Datadog / PagerDuty rules).
- Integration with Notification Core for alert routing.
- Incident tracker (Ops issue in Case Core or PagerDuty integration).

### 15.6 SLO tracking

- SloDefinition table (Observability Core).
- Background job that calculates burn-rate for each SLO every 5 minutes.
- Metric emission: `slo_error_budget_remaining`, `slo_burn_rate`.
- Grafana dashboard showing SLO burn-rate trends per service.

### 15.7 NOC dashboard implementation

`frontend/src/pages/noc/Dashboard.tsx` — assembles tiles from multiple cores via canonical APIs:

```typescript
export async function NOCDashboard({ tenantId }: Props) {
  const [incidents, slaRisk, customers, mrrAtRisk, services, oncall, ...] = await Promise.all([
    fetchCases({ type: "INCIDENT", status: ["NEW", "TRIAGED", "IN_PROGRESS"], tenantId }),
    fetchSLABreachRisk({ tenantId }),
    fetchCustomersImpacted({ hours: 1, tenantId }),
    fetchMRRAtRisk({ tenantId }),
    fetchTopServices({ tenantId }),
    fetchCurrentOncall({ rotation: "NOC_Tier1", tenantId }),
    // ...
  ]);

  return (
    <PageShell>
      <Grid columns={3} gap="md">
        <Tile icon="alert" title="Open Incidents" value={incidents.length} />
        <Tile icon="clock" title="SLA Breach Risk" value={slaRisk} />
        <Tile icon="users" title="Customers Impacted (1h)" value={customers} />
        <Tile icon="dollar" title="MRR at Risk" value={mrrAtRisk} format="currency" />
        <Tile icon="service" title="Top Affected Services" value={services} format="list" />
        <Tile icon="person" title="On-Call: Tier 1" value={oncall.name} />
        {/* ... more tiles ... */}
      </Grid>
    </PageShell>
  );
}
```

### 15.8 Drift check

`tools/check_drift.py` adds rules:

- Every critical-path API or background job must emit a HealthCheck registration.
- No `print()` or unstructured logging in production code (linting rule).
- Every AlertRule routes to a known on-call rotation (Scheduling Core).
- No metric defined without `service`, `tenant_id` labels.

### 15.9 Testing

- `tests/test_health_checks.py` — verify each service's `/health` and `/health/ready` endpoints respond < 1 second.
- `tests/test_metrics.py` — verify four golden signals are emitted correctly.
- `tests/test_traces.py` — verify correlation IDs propagate across service boundaries.
- `tests/test_logs.py` — verify logs are valid JSON and PII is redacted.
- `tests/test_slo.py` — verify burn-rate calculation and alert firing.

## 16. Future Expansion Rules

### 16.1 Custom metrics per domain

As new domains harden (Network, Billing, CRM), they register domain-specific metrics:

```python
# Network domain
Metric(name="fiber_link_latency_ms", type="histogram")
Metric(name="onu_heartbeat_loss_pct", type="gauge")

# Billing domain
Metric(name="billing_cycle_runtime_seconds", type="histogram")
Metric(name="invoice_generation_lag_seconds", type="gauge")
```

### 16.2 AI action observability

When AI Core integration matures, every AI action (e.g., auto-triage of a Case) emits:

- Trace: input prompt → model call → output.
- Metric: AI action count, latency, approval rate.
- Log: user, action type, prompt token count, response token count.
- Alert: AI action approval rate drops below threshold.

### 16.3 Predictive alerting (via Forecasting Core)

Future: instead of threshold/burn-rate alerts, Forecasting Core predicts SLO breach 1 hour ahead and proactively pages on-call.

### 16.4 Noisy neighbor detection

Automated: if one customer's workload is causing latency spikes for others, emit an alert and suggest rate-limiting or resource isolation.

---

*End of 18 — Observability Architecture.*
