# 10 — API Architecture

**Constitutional document.** Position in the hierarchy: under `PLATFORM_REFERENCE_MODEL.md` and `01_PLATFORM_CORE_ARCHITECTURE.md`; dependent on `02_DOMAIN_ARCHITECTURE.md` for URL prefixes. Formalizes the REST API contract — surface design, versioning, authentication, authorization, idempotency, pagination, rate limiting, error handling, webhooks, and audit. The single source of truth for how external and internal clients talk to GAAhex.

---

## 1. Purpose

Define the REST API surface that exposes GAAhex's business logic and events to authenticated clients (UI, integrations, external APIs, service accounts). Establish a versioning and deprecation policy, standardize request/response patterns, and ensure every API call is secure, auditable, and consistent with the 51 Platform Cores.

The thesis: **API-first architecture means business logic lives in the backend and is exposed via a single, canonical REST surface. The UI does not contain business rules; it consumes APIs.**

## 2. Scope

In scope:

- REST API design principles (URL structure, HTTP verbs, response codes).
- URL versioning strategy (`/api/v1`, `/api/v2`) and deprecation policy.
- Authentication (JWT bearer, API keys, OAuth, service accounts).
- Authorization (Permission Core check on every endpoint).
- Request/response contracts (Pydantic models, OpenAPI schema).
- Idempotency (Idempotency-Key header, deduplication window).
- Pagination (cursor-based UUIDv7 lex-ordering).
- Filtering, sorting, field selection.
- Rate limiting (per-tenant, per-key, sliding window).
- Error model (RFC 7807 problem+json).
- Webhooks (signature, retry, dead-letter).
- Audit logging (every write endpoint).
- OpenAPI spec generation and codegen to frontend client types.
- Cross-core orchestration rules (synchronous vs. asynchronous).

Out of scope:

- GraphQL (not in GAAhex scope; REST is the canonical surface).
- gRPC (internal service-to-service is async via events).
- WebSocket (not in Phase 0–M1; may be added for real-time events later).
- Third-party API gateway (nginx reverse proxy is assumed; we do not govern upstream).

## 3. Goals

- **G1** Every business capability is exposed as a REST endpoint, with a canonical core owner.
- **G2** The API contract is immutable once released (versioned in URL; breaking changes require `/v2`).
- **G3** Authorization checks are enforced server-side; the UI is not a security boundary.
- **G4** Every write is idempotent and auditable.
- **G5** The OpenAPI spec is the source of truth for the API (no shadow documentation).
- **G6** Frontend code imports auto-generated TypeScript types from OpenAPI codegen; no hand-mirrored types.
- **G7** Rate limiting, pagination, and error handling are consistent across all endpoints.
- **G8** Webhooks allow external systems to consume platform events reliably.
- **G9** Cross-core dependencies are documented and either synchronous (with timeouts) or event-driven (async).

## 4. Non-Goals

- **NG1** This document does NOT define endpoint implementations (those live in routers and services).
- **NG2** This document does NOT govern internal Python-to-Python function calls (inter-core communication is event-driven by default).
- **NG3** This document does NOT replace `02_DOMAIN_ARCHITECTURE.md` or `08_PERMISSION_ARCHITECTURE.md` (they define URL prefixes and permission keys).

## 5. Architecture Principles

### P1 — API-first, not UI-first

Every business rule has a backend API owner. UI pages are presentations of API state; they do not execute business logic independently. This ensures consistency across all client surfaces (web, mobile, integrations).

### P2 — REST as the canonical surface

One URL per resource; one HTTP method per intent. `GET /api/v1/services/{id}` is owned by Service Core; `POST /api/v1/services/{id}/approve` is a transition (still Service Core). No custom RPC-style endpoints unless explicitly documented as exceptions.

### P3 — Versioning is in the URL path

Breaking changes introduce a new version (`/api/v2`). Clients pin their URL version; the backend maintains multiple versions concurrently. Minor backwards-compatible additions (new optional fields, new enum values) do NOT require a version bump.

### P4 — Authentication is separate from authorization

Authentication answers "who are you?" (via JWT bearer, API key, OAuth). Authorization answers "what can you do?" (via Permission Core checks). Both are mandatory.

### P5 — Idempotency is default

A `POST` to create or `PATCH` to update with an `Idempotency-Key` header will never create duplicate effects if the request is retried. The window is 24 hours.

### P6 — Pagination is cursor-based, not offset-based

UUIDv7 lex-ordering ensures cursor stability across concurrent mutations. Offset-based pagination breaks when rows are added/deleted between pages.

### P7 — Errors are RFC 7807 `problem+json`

Every error response has `type`, `title`, `status`, `detail`, `instance` (request ID). Stack traces are never leaked to clients.

### P8 — Rate limiting is configurable, per-tenant + per-key

The same API key may have different limits depending on the tenant's plan. Rate-limit headers are echoed so clients know their quota.

### P9 — Audit is not optional

Every `POST`, `PATCH`, `PUT`, `DELETE` creates an audit record with actor, context, time, mutation details, and correlation ID.

### P10 — OpenAPI is the contract

The backend's `response_model` (Pydantic) is the source of truth for what the frontend expects. Frontend types are auto-generated; they never drift from the backend.

### P11 — Cross-core orchestration is event-driven by default

When Service Core transitions trigger Billing Core to create an invoice, the interaction is asynchronous (Service publishes `Service.Activated`; Billing subscribes). Synchronous calls across cores are forbidden unless documented in §10 (Cross-Core Synchronous Contracts).

## 6. Architecture Laws

### L1 — Every endpoint has a primary core owner

No endpoint is unowned. The route's URL prefix declares the domain; the endpoint's POST/PATCH/DELETE logic declares its primary core (in code comments and route registration).

### L2 — Authentication is required on every endpoint except health checks

Public endpoints (health, health/ready, `/health/db`) are allowed. Everything else requires a valid JWT bearer token, API key, or service account.

### L3 — Authorization is enforced server-side

Checks happen after authentication. The request carries `user.tenant_id`, `user.role`, and explicit permissions; the endpoint validates permission and returns 403 Forbidden if access is denied. The frontend cannot bypass server-side checks.

### L4 — Version immutability

Once an API endpoint is released under a version (e.g., `POST /api/v1/services` with a particular request/response shape), that shape is immutable. New optional fields may be added (backwards-compatible). Removing or changing field meaning requires a new version (`/api/v2`).

### L5 — Write operations are idempotent

A `POST /api/v1/orders` with `Idempotency-Key: abc-123` is deduplicated over 24 hours. The second identical request returns the cached response; no duplicate order is created. `GET` and `DELETE` are naturally idempotent; `PATCH` and `PUT` are idempotent by contract (same id, same state).

### L6 — Pagination defaults to cursor-based, limit to 100

No offset-based pagination (clients use cursors). Default `limit=100`; max configurable per-endpoint up to 1000. The response includes `next_cursor` (null at end).

### L7 — Rate limiting is per-tenant and per-API-key

A tenant's plan determines the base limit (e.g., 1000 req/min for Standard, 5000 for Enterprise). An individual API key may have a lower limit if explicitly set. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset-At` are echoed.

### L8 — All error responses are RFC 7807

Format:
```json
{
  "type": "https://api.gaahex.example/problem/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "Field 'email' is invalid.",
  "instance": "req-uuid-12345"
}
```

No stack traces, no internals. `instance` is the request ID for tracing.

### L9 — Webhooks are not notifications

Webhooks deliver domain events (Service.Activated, Order.Created). They are not user-facing messages; they are system-to-system contracts. The payload is the event; retry/dead-letter is automatic.

### L10 — Tenant isolation is enforced

Every query filters by `tenant_id`. Cross-tenant data leakage is a critical bug. The RLS policy and query-audit layer are the defense; the endpoint logic is the second line.

## 7. Core Concepts

### 7.1 Endpoint

A (method, path) pair. Example: `POST /api/v1/services`. Every endpoint has:

- **Method**: GET (retrieve), POST (create), PATCH (update), PUT (replace), DELETE (remove).
- **Path**: `/api/v{major}/{resource}[/{id}][/{sub-resource}][/{action}]`.
- **Primary core**: declared in code (comment + router tag).
- **Permission key**: `object.action` format (e.g., `service.create`, `invoice.export`).
- **Request model**: Pydantic schema (validation happens here).
- **Response model**: Pydantic schema (codegen target).
- **Auth**: required (except health).
- **Audit**: YES for write; NO for read.

### 7.2 URL structure

```
/api/v{major}/{domain-resource}/{id}/{sub-resource}/{action}?query_params
```

Examples:
- `GET /api/v1/services` — list services (Service Core).
- `POST /api/v1/services` — create service (Service Core).
- `GET /api/v1/services/{id}` — get one service.
- `PATCH /api/v1/services/{id}` — update service.
- `POST /api/v1/services/{id}/approve` — invoke an action (Approval Core).
- `GET /api/v1/services/{id}/timeline` — read-only related data (Service Core + Communication Core).

Query parameters for read:
- `limit` (default 100, max 1000).
- `cursor` (opaque base64 string; UUIDv7 lex-encoded).
- `sort_by` (e.g., `created_at`, `-created_at` for reverse).
- `filter` (JSON query; see Filtering).
- Field selection: `fields=id,name,status`.

No endpoint is `/api/random-name`. All endpoints fit the pattern above.

### 7.3 Domain prefixes

Per `02_DOMAIN_ARCHITECTURE.md` §9.2:

| Domain         | Prefix            | Primary cores |
|---|---|---|
| CRM            | `/api/v1/customers` | Party, Communication |
| OSS            | `/api/v1/services` | Service, Workflow |
| BSS            | `/api/v1/orders` | Workflow, Contract |
| Network        | `/api/v1/network` | Resource, Relationship |
| Inventory      | `/api/v1/inventory` | Resource, Location |
| Workforce      | `/api/v1/work` | Work, Scheduling |
| Billing        | `/api/v1/billing` | Financial |
| Portal         | `/api/v1/portal` | Portal |
| Studio         | `/api/v1/studio` | Configuration, Metadata |
| Automation     | `/api/v1/automations` | Automation |
| Reporting      | `/api/v1/reports` | Reporting, Analytics |
| Administration | `/api/v1/admin` | Tenant, Identity, Security |

Every top-level prefix is reserved and immutable. New endpoints live under these prefixes; they do not create new top-level roots.

### 7.4 Authentication: who are you?

Four methods:

| Method | Use case | Storage | Refresh |
|---|---|---|---|
| **JWT Bearer** | User sessions (UI, portal) | React state (admin), localStorage (portal) | Expires at `exp`; portal can refresh. Admin re-auth on session loss. |
| **API Key** | Service accounts, integrations | Vault, SecureString, environment variable. | Rotatable by key owner; no expiration. |
| **OAuth** | External apps, partners | Authorization Code flow; `code` exchanged for `access_token` + `refresh_token`. | `access_token` expires; `refresh_token` refreshes it. |
| **Service Account** | Backend-to-backend, automations | Signed JWT with `sub = service-account-id`, `iss = gaahex`, issued by Identity Core. | Rotatable; keys pinned in config. |

The request header: `Authorization: Bearer <token>` or `Authorization: ApiKey <key>`. The backend's `auth.current_user` or `auth.current_service_account` dependency extracts and validates it.

### 7.5 Authorization: what can you do?

Every endpoint checks `can(grants, object, action)` where `grants` come from Permission Core. The key is `{object}.{action}` (lowercase, dot-separated). Example: `service.create`, `invoice.view`, `configuration.manage`.

If the check fails, return `403 Forbidden` with RFC 7807 detail.

### 7.6 Idempotency key

Header: `Idempotency-Key: <UUID or string>`.

Behavior:

- `POST /api/v1/orders` with `Idempotency-Key: order-abc-123` creates an order.
- Same `Idempotency-Key` on retry returns the cached response (no duplicate order).
- Window: 24 hours. After 24 hours, the key is forgotten and a new request creates a new resource.
- Stored in the `idempotency_key` table (keyed by tenant_id + key; returns cached response_body, status).

### 7.7 Pagination

Cursor-based, using UUIDv7 lex-ordering:

Request:
```
GET /api/v1/services?limit=50&cursor=eyJpZCI6IjAxNjY2ZGM2LTQ0MzktNDAwYy04ZmJjLWJkN2RiOWRlZjU0YiIsImRpcmVjdGlvbiI6ImZvcndhcmQifQ==
```

Response:
```json
{
  "items": [
    { "id": "01666de6-...", "name": "Service A", ... },
    { "id": "01666df1-...", "name": "Service B", ... }
  ],
  "limit": 50,
  "cursor": "eyJpZCI6IjAxNjY2ZGY1LTAwMDAtNDAwMC04MDAwLWYwMDAw...",
  "next_cursor": "eyJpZCI6IjAxNjY2ZjAwLTAwMDAtNDAwMC04MDAwLWYwMDAw...",
  "has_more": true
}
```

Internals (opaque to client):
- Cursor is base64(JSON): `{ "id": "<UUIDv7>", "direction": "forward" }`.
- Query filters `id > cursor_id` (or `<` for reverse); limit+1 to detect `has_more`.
- The client never decodes the cursor.

### 7.8 Filtering and search

Simple filters: `?status=ACTIVE&owner_id=xyz`

Complex filters: `POST /api/v1/services/search` with a body:
```json
{
  "filter": {
    "and": [
      { "field": "status", "op": "eq", "value": "ACTIVE" },
      { "field": "created_at", "op": "gte", "value": "2026-01-01T00:00:00Z" }
    ]
  },
  "sort_by": "created_at",
  "limit": 100
}
```

The exact filter syntax is defined per entity in the Search Core API. No SQL injection; filters are validated server-side.

### 7.9 Rate limiting

Sliding window counter. Headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset-At: 2026-06-06T15:30:00Z
```

Behavior:

- Tenant's base limit: read from Entitlement Core (plan-based).
- API key override: if set, use the lower of (tenant limit, key limit).
- Window: rolling 1-minute or configurable per-tier.
- On limit hit: return `429 Too Many Requests` with RFC 7807 error.

### 7.10 Error responses

All errors are `Content-Type: application/problem+json`:

```json
{
  "type": "https://api.gaahex.example/problem/resource-not-found",
  "title": "Not found",
  "status": 404,
  "detail": "Service with id 'abc-123' not found in tenant 'xyz'.",
  "instance": "req-a1b2c3d4e5f6"
}
```

Status codes:

| Code | Meaning |
|---|---|
| 200 | OK. |
| 201 | Created. |
| 202 | Accepted (async job started). |
| 204 | No Content. |
| 400 | Bad Request (client error in format/structure). |
| 401 | Unauthorized (auth failed or missing). |
| 403 | Forbidden (auth succeeded but permission denied). |
| 404 | Not Found. |
| 409 | Conflict (state change invalid; use detail to explain). |
| 422 | Unprocessable Entity (validation failed on a field). |
| 429 | Too Many Requests (rate limit). |
| 500 | Internal Server Error (log the correlation ID and report to support). |

Never return stack traces or internal error names to the client. The `instance` field is the request ID; the client can report it to support for investigation.

### 7.11 Webhooks

A webhook is a subscription to events:

Request to register:
```
POST /api/v1/admin/webhooks
{
  "name": "Order Created Handler",
  "target_url": "https://partner.example/webhook/orders",
  "subscribed_events": ["Order.Created", "Order.Updated"],
  "secret": "whk-secret-abc-xyz"
}
```

Delivery:
```
POST https://partner.example/webhook/orders
X-Gaahex-Signature: sha256=<hmac(secret, payload)>
X-Gaahex-Event-ID: evt-12345
X-Gaahex-Event-Name: Order.Created
X-Gaahex-Timestamp: 2026-06-06T12:00:00Z

{
  "eventId": "evt-12345",
  "eventName": "Order.Created",
  "occurredAt": "2026-06-06T12:00:00Z",
  "correlationId": "corr-xyz",
  "causationId": "cause-xyz",
  "schemaVersion": "1.0",
  "objectType": "Order",
  "objectId": "ord-5678",
  "payload": { "status": "PENDING", "total": "1234.56" }
}
```

Retry: automatic exponential backoff (5 retries over 24 hours). After 5 failures, the delivery is dead-lettered and a Super Admin can inspect it.

## 8. Canonical Entities

Endpoints expose entities owned by cores. The canonical entity definitions live in `09_DATA_ARCHITECTURE.md`. Each core's primary entities are accessible via its domain's URL prefix.

Example: Service Core entities (Subscription, ServiceInstance, ProvisioningState) are accessible at `/api/v1/services/*`.

## 9. Ownership Boundaries

### 9.1 Core declares ownership via router metadata

Every FastAPI router declares its primary core in a module-level comment:

```python
# Domain: OSS
# Primary cores: Service, Workflow, Case, Work
# Supporting cores: Party, Product, Contract, Resource, Location
```

### 9.2 Permission checks use `can(grants, object, action)`

All permission keys are defined in `08_PERMISSION_ARCHITECTURE.md` and listed in the central Permission Registry. Example keys:

- `service.view`
- `service.create`
- `service.update`
- `invoice.export`
- `configuration.manage`

The endpoint calls `can(grants, "service", "create")` and 403s if false.

### 9.3 Every write emits an audit event

When a `POST /api/v1/services` succeeds, an audit record is created:

```json
{
  "id": "aud-abc123",
  "tenant_id": "tenant-xyz",
  "actor_id": "user-123",
  "actor_type": "EMPLOYEE",
  "action": "CREATE",
  "resource_type": "Service",
  "resource_id": "svc-456",
  "change_summary": "Created service 'Internet 100M' for customer 'ACME Corp'",
  "change_details": { "status": "PENDING", "plan_id": "plan-789" },
  "correlation_id": "corr-req-id",
  "timestamp": "2026-06-06T12:00:00Z"
}
```

## 10. Relationships

### 10.1 Cross-core synchronous contracts

Synchronous calls are forbidden between non-Foundation cores, except:

1. **Service Core calling Permission Core** to check if a user can perform an action (synchronous, timeout 5s).
2. **Any core reading from Search Core** to retrieve indexed entities (synchronous, timeout 10s).
3. **Workflow Core calling Policy Core** to evaluate transition gates (synchronous, timeout 5s).

All other inter-core dependencies are event-driven (asynchronous).

### 10.2 Asynchronous workflows

When a user closes a CRM deal:
1. Frontend calls `PATCH /api/v1/customers/{id}/opportunity` (CRM domain).
2. CRM emits `Deal.Won` event.
3. Billing subscribes; creates an invoice via its own API (no synchronous call back to CRM).
4. Notification subscribes; sends a customer welcome email via Notification API.

This ensures CRM transitions complete immediately; downstream work is queued.

### 10.3 Shared core consumption

Multiple domains read the same core's data. Example: Communication Core's threads are read by CRM, OSS, BSS, Billing, and Portal. Each domain calls `GET /api/v1/communications?relatedEntityType=Service&relatedEntityId=svc-456` independently; the Communication API enforces permissions.

## 11. Responsibilities

### 11.1 Platform owner (Gev)

- Approves breaking API changes (new major versions).
- Reviews API versioning strategy at milestone boundaries.
- Adjudicates conflicts where two cores both expose the same resource.

### 11.2 Core owner (per-core team)

- Authors and maintains the core's REST endpoints.
- Updates OpenAPI `response_model` on every change.
- Enforces permission keys and audit logging.
- Documents deprecation policy for endpoints being retired.

### 11.3 API reviewer (per-PR)

- Confirms endpoints have a primary core owner.
- Confirms permission checks are in place and use canonical keys.
- Confirms audit logging is present on write endpoints.
- Confirms response_model is set (for OpenAPI codegen).
- Rejects endpoints that bypass the URL structure pattern.

## 12. Allowed Patterns

### AP1 — Endpoint with fixed path before records router

Endpoints like `/api/v1/services`, `/api/v1/orders` are registered BEFORE `records.router` in `main.py`. This ensures they are matched before the generic record-by-slug fallback.

### AP2 — Polymorphic response model

An endpoint like `GET /api/v1/lifecycle/{id}` may return different shapes depending on the object type:

```python
from pydantic import Union
from .models import ServiceLifecycle, OrderLifecycle

class LifecycleResponse(BaseModel):
    object: Union[ServiceLifecycle, OrderLifecycle]
```

The OpenAPI codegen produces a discriminated union in TypeScript.

### AP3 — Idempotent PATCH

`PATCH /api/v1/services/{id}` with `Idempotency-Key: upd-xyz` is deduplicated. The second identical request returns the cached (unchanged) response.

### AP4 — 202 Accepted for async jobs

`POST /api/v1/reports/generate` returns 202 + a job ID. The client polls `GET /api/v1/jobs/{id}` to check progress.

### AP5 — Read-only sub-resources

`GET /api/v1/services/{id}/timeline` reads Service timeline events (owned by Service Core, backed by Event and Audit Cores). It is read-only; no mutation.

## 13. Forbidden Patterns

### FP1 — Bypassing the URL structure

Creating a custom RPC-style endpoint like `POST /api/v1/do-complex-thing` without declaring its core owner and fitting it into the domain/resource hierarchy. Rejected.

### FP2 — Synchronous call across BUSINESS EXECUTION+ to INTELLIGENCE

A Workflow Core transition endpoint synchronously calling an AI Core scoring function. Forbidden; use an async automation or poll a pre-computed score.

### FP3 — Hand-mirrored TypeScript types for response_model endpoints

If an endpoint has `response_model: MyModel` set, the frontend type is auto-generated from OpenAPI. No manual `type MyModel = { ... }` in `.ts` files. (Exception: endpoints with no response_model yet.)

### FP4 — 500 errors leaking stack traces

A backend error in production is logged server-side; the client response is `{"status": 500, "detail": "Internal server error", "instance": "req-id-..."}`.

### FP5 — Cross-tenant endpoint

An endpoint like `GET /api/v1/admin/tenants/{id}` that returns details of other tenants to a non-Super-Admin. Every query must filter by the requesting user's `tenant_id`.

### FP6 — Unaudited write

A `POST /api/v1/assets/{id}/deprecate` that mutates state without creating an audit record. Forbidden (L9).

### FP7 — Missing permission check

An endpoint that reads from Billing without checking `can(grants, "invoice", "view")`. Forbidden (L3).

## 14. Cross-Architecture Dependencies

| Dependency | Direction | Reason |
|---|---|---|
| `PLATFORM_REFERENCE_MODEL.md` | upstream | Defines cores. |
| `01_PLATFORM_CORE_ARCHITECTURE.md` | upstream | Defines core ownership and boundaries. |
| `02_DOMAIN_ARCHITECTURE.md` | upstream | Defines URL prefixes per domain. |
| `08_PERMISSION_ARCHITECTURE.md` | upstream | Defines permission keys. |
| `09_DATA_ARCHITECTURE.md` | upstream | Defines canonical entities. |
| `11_EVENT_ARCHITECTURE.md` | upstream | Defines event topics and contracts. |
| `12_INTEGRATION_ARCHITECTURE.md` | downstream | Integrations consume the API surface. |
| `13_SECURITY_ARCHITECTURE.md` | upstream | Defines authentication and secrets. |
| `14_TENANT_ARCHITECTURE.md` | upstream | Defines multi-tenancy and RLS. |
| Standards files (14-22) | cross-layer | Each core's API respects standards (enums, IDs, status values, etc.). |

## 15. Implementation Requirements

### 15.1 OpenAPI spec generation

`POST /api/openapi.json` (or the default FastAPI path) exposes the OpenAPI 3.0 schema. Every endpoint with `response_model` set produces an entry in the schema.

The backend's `app/main.py` initializes FastAPI with `title`, `version`, and `lifespan`. The spec is auto-generated.

### 15.2 Frontend codegen

```bash
# In frontend/
npm install --save-dev openapi-typescript
npm run gen:api-types  # generates frontend/src/generated/api.ts
```

This creates a single file with all types extracted from the OpenAPI schema. Commit this file; CI guards that it's never out of sync (regen on every backend change).

Frontend views import types: `import type { components } from '@/generated/api'`.

### 15.3 Router registration

Every new router is registered in `app/main.py` with a comment explaining its domain and primary cores:

```python
# OSS domain — Service, Workflow, Case, Work
app.include_router(services.router)
```

Fixed-path routers (those with their own prefix like `/api/v1/services`) are registered BEFORE the generic `records.router` so they take precedence.

### 15.4 Pydantic models

Every endpoint that returns a non-trivial body must declare `response_model`:

```python
@router.get("/services/{id}", response_model=ServiceDetail)
async def get_service(id: str, user: User = Depends(current_user), s: AsyncSession = Depends(get_session)):
    ...
```

Response models are Pydantic classes with clear field types. Optional fields use `Optional[Type] = None`. Decimal values for financial data use `Decimal` and are serialized as strings in JSON.

### 15.5 Audit logging

Every write endpoint calls:

```python
from ..audit import audit_log

await audit_log(
    s, user.tenant_id, user.id, "CREATE",
    "Service", service.id,
    f"Created service '{service.name}'",
    {"status": service.status, "plan_id": str(service.plan_id)},
    correlation_id=request.state.request_id,
)
```

Fields:
- `tenant_id`: from authenticated user.
- `actor_id`: from authenticated user.
- `action`: CREATE, UPDATE, DELETE, APPROVE, REJECT, TRANSITION, etc.
- `resource_type`: entity name (Service, Invoice, Order).
- `resource_id`: entity UUID.
- `change_summary`: human-readable description.
- `change_details`: dict of fields changed.
- `correlation_id`: X-Request-ID from the request.

### 15.6 Permission checks

```python
from ..access import can, load_grants

async def create_service(..., user: User, s: AsyncSession):
    grants = await load_grants(s, user)
    if not can(grants, "service", "create"):
        raise HTTPException(403, "Permission denied: service.create")
    # ... create service ...
```

Every endpoint checks relevant permissions. The `grants` object is cached for the request lifetime.

### 15.7 Request ID stamping

The `RequestIDMiddleware` in `main.py` adds an `X-Request-ID` header to every request/response. Use it for correlation:

```python
@router.post("/services")
async def create_service(req: CreateServiceRequest, request: Request, ...):
    correlation_id = request.state.request_id
    # ... use correlation_id in audit, events, logging ...
```

### 15.8 Error handling

Use `HTTPException` for known errors:

```python
from fastapi import HTTPException

if not service:
    raise HTTPException(404, detail=f"Service {id} not found")
```

For validation errors, Pydantic auto-converts them to 422 with field details. For unhandled exceptions, the global exception handler in `main.py` logs and returns a generic 500.

### 15.9 Rate-limiting headers

The `RateLimitMiddleware` in `main.py` adds headers automatically:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 742
X-RateLimit-Reset-At: 2026-06-06T15:30:00Z
```

No code changes needed per endpoint; the middleware handles it globally.

### 15.10 Idempotency

The `IdempotencyMiddleware` caches responses for POST/PATCH/DELETE with `Idempotency-Key`. No code changes needed; register the middleware in `main.py` and it works globally.

The cache lives in Redis (if available) or a simple in-memory dict. Tenure is 24 hours.

## 16. Future Expansion Rules

### 16.1 Adding an endpoint

1. **Declare the core**: comment the router with domain and primary cores.
2. **Set response_model**: Pydantic shape (for OpenAPI codegen).
3. **Check permission**: `can(grants, object, action)` on protected endpoints.
4. **Audit write**: `await audit_log(...)` on mutation endpoints.
5. **Test**: unit tests (happy path, errors, permissions).
6. **Register**: add to `main.py` with appropriate ordering.

### 16.2 Deprecating an endpoint

1. Mark the endpoint `@deprecated` in the OpenAPI schema (via `deprecated=True` in Pydantic or a docstring note).
2. Document the replacement endpoint.
3. Give clients 6 months' notice.
4. Monitor usage via audit logs and analytics.
5. Remove in a major version bump (`/api/v2`).

### 16.3 Introducing a new major version

1. Analyze breaking changes (removed fields, changed types, removed endpoints).
2. Implement `/api/v2` routes in parallel with `/api/v1`.
3. Update OpenAPI spec to list both versions.
4. Document migration path for clients.
5. After 6 months, deprecate `/api/v1`.

### 16.4 Adding a new domain prefix

This is a constitution amendment (per `02_DOMAIN_ARCHITECTURE.md` §16.1). The new prefix must fit the pattern and be added to §9.2 of this document.

---

*End of 10 — API Architecture.*
