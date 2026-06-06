# 09 — Data Architecture

**Constitutional document.** Position: under `PLATFORM_REFERENCE_MODEL.md`, after `01`, `02`, `03`, `04`, `05`, `06`, `07`, and `08`. Governs data ownership, physical schema rules, entity lineage, reference data, master data, retention, and data quality.

---

## 1. Purpose

Define the **physical data layer** of GAAhex: how canonical entities are stored, owned, referenced across cores, governed by data quality rules, retained, and purged. This document is the schema and lifecycle layer; it operationalizes the entity contract from `03_INFORMATION_ARCHITECTURE.md` into SQL/Alembic deployments and runtime data management.

## 2. Scope

In scope:

- Source-of-truth ownership per entity (`__owner_core__` metadata).
- Primary key strategy (UUIDv7 for all business entities; no sequential integer PKs).
- `tenantId` on every business row; RLS policy `tenant_isolation` enforcement.
- Append-only audit via Postgres triggers (SPEC §0.4): `event` and `audit_log` tables; RAISE EXCEPTION on UPDATE/DELETE to non-append-only tables.
- Alembic migration structure: one domain per migration, reversible, tested.
- Reference data (global: Country, Currency, Locale, Timezone — exempt from RLS).
- Master data (tenant-scoped: DepartmentCatalog, ServiceArea, Product).
- Data quality rules (DataQualityRule entities; severity; remediation).
- Data lineage edges (how data derives across cores).
- Retention (soft delete, archive, purge per Standard 12 D14).
- PII classification and redaction at egress.
- Standard indexes: `(tenant_id, id)` primary; `(tenant_id, status, deletion_state)` covering.
- Polymorphic owner index: `(tenant_id, owner_entity_type, owner_entity_id)`.
- Reference-number generation: `{PREFIX}-YYYY-NNNNNN`, tenant-scoped monotonic counter.
- Forbidden patterns: `gen_random_uuid()` (UUIDv4), reference numbers as PKs, cross-tenant joins outside Super-Admin.

Out of scope:

- Data warehouse / BI / analytics models (see `16_ANALYTICS_ARCHITECTURE.md`).
- Query optimization / execution plans (see `19_INFRASTRUCTURE_ARCHITECTURE.md`).
- Sharding / replication strategy (infrastructure).
- API surface (see `10_API_ARCHITECTURE.md`).
- UI rendering (see `06_UI_EXPERIENCE_ARCHITECTURE.md`).

## 3. Goals

- **G1** Every business entity declares its owner core (immutable, first-class metadata).
- **G2** UUIDv7 primary keys; reference numbers are display-only, never used for joins.
- **G3** Tenant isolation is *by construction*: every business row carries `tenantId`; RLS `tenant_isolation` policy gates all reads/writes.
- **G4** Append-only audit is enforced: attempts to UPDATE or DELETE core business tables raise exceptions; all mutations go through `event` → `audit_log` flow.
- **G5** Migrations are reversible, domain-scoped, and tested before deploy.
- **G6** Data quality is first-class: `DataQualityRule` entities define severity, remediation, and audit trail.
- **G7** Data lineage is queryable: `LineageEdge` records track how data derives across cores.
- **G8** Retention is configurable per entity type; soft-delete and purge are observable.

## 4. Non-Goals

- **NG1** This document does NOT design UI schemas or custom field implementations (see Metadata Core in `03` and `06`).
- **NG2** This document does NOT define analytical aggregations or data-warehouse transforms.
- **NG3** This document does NOT prescribe ORM mapping strategies (implementers may use SQLModel, Pydantic, plain SQLAlchemy).
- **NG4** This document does NOT govern operational metrics or observability telemetry.

## 5. Architecture Principles

### P1 — UUIDv7 for all business entity PKs

Every business entity's primary key is a UUIDv7 (S5 per standards 03/13). UUIDv7 is time-ordered, lexicographically sortable, and distributed-safe. Sequential integer PKs are forbidden; they leak temporal structure and are unsuitable for multi-tenant isolation.

### P2 — One owner core, always declared

Every entity belongs to exactly one core (per `01` §9.1). The core is declared in schema metadata (`__owner_core__ = 'core_name'`). Ownership is immutable; reassigning an entity to a different core is a core-split/merge amendment per `01` §16.2–16.3.

### P3 — Tenant scoping by construction

Every business entity row carries a non-null `tenantId` (UUIDv7). The `tenant_isolation` RLS policy gates all SELECT/INSERT/UPDATE/DELETE on tenant-scoped tables. Cross-tenant references are forbidden except for explicit global reference data.

### P4 — Append-only audit is mandatory

Per SPEC §0.4: core business tables are append-only. Postgres BEFORE UPDATE / BEFORE DELETE triggers RAISE EXCEPTION to prevent direct modification. All mutations go through:
1. Publish a `DomainEvent` to `event` table.
2. A handler (or synchronous trigger) writes to `audit_log` with full context (actor, IP, timestamp, before/after).

Silent mutations are forbidden; every state change is auditable.

### P5 — Reference numbers are immutable, display-only

Reference numbers (`referenceNumber` field) follow the format `PREFIX-YYYY-NNNNNN` (e.g. `SVC-2026-000417`). They are generated by a tenant-scoped monotonic counter, immutable once issued, and user-visible (in URLs, search, printed documents). **Primary keys and foreign keys use UUIDs exclusively; reference numbers are never used for relational joins.**

### P6 — Deletion state is independent of lifecycle status

Per D14 (LOCKED in standard 12): every entity has two independent enums:
- `status` — the entity's business lifecycle (e.g. `DRAFT`, `ACTIVE`, `SUSPENDED`, `CANCELLED`).
- `deletionState` — the entity's retention posture (`ACTIVE`, `ARCHIVED`, `SOFT_DELETED`, `PENDING_PURGE`, `PURGED`).

Both can validly hold value `ACTIVE`; they mean different things and are never collapsed.

### P7 — Standard fields on every business entity

Every business entity exposes:
- `id: UUIDv7` — primary key.
- `tenantId: UUIDv7` — scope (foreign key to `tenant`).
- `status: string` — lifecycle (UPPER_SNAKE enum).
- `deletionState: string` — retention posture (UPPER_SNAKE enum, default `ACTIVE`).
- `createdAt, createdBy` — actor + timestamp.
- `updatedAt, updatedBy` — actor + timestamp.
- Optional: `archivedAt, archivedBy, deletedAt, deletedBy, restoredAt, restoredBy`.

Reference-number fields (if user-visible):
- `referencePrefix: string` — e.g. `SVC`, `INV`.
- `referenceSequence: integer` — e.g. `2026000417`.
- `referenceNumber: string` — derived display value, e.g. `SVC-2026-000417`.

### P8 — Migrations are domain-scoped and reversible

Every Alembic migration:
- Is scoped to one domain or core (e.g. one migration adds all Party Core entities; another adds all Financial Core entities).
- Has a clear upgrade() and downgrade() that is tested locally before merge.
- Uses `op.execute(sql)` for complex operations; documents raw SQL.
- Never silently drops tables or irreversible changes; all operations are reversible.
- Is committed separately from application code changes (migration PRs are first, then application PRs).

### P9 — Data quality rules are first-class entities

`DataQualityRule` records define:
- Which entity type and field(s) are governed.
- The rule logic (e.g. "phone must match regex", "age must be > 0").
- Severity (WARNING, ERROR, CRITICAL).
- Auto-remediation action (if any).
- Audit trail of all violations and remediation.

Rules are versioned and tenant-configurable; compliance is observable.

### P10 — Lineage edges are queryable

`LineageEdge` records track data derivation:
- From one entity (source).
- To another entity (target).
- Via a transformation (core, formula, or integration).
- With a dependency type (DIRECT, COMPUTED, IMPORTED).

Lineage enables impact analysis: "which services are affected if we delete this customer?"

## 6. Architecture Laws

### L1 — UUIDv7 primary key, no exceptions

> Every business entity's primary key is a UUIDv7. No sequential integers, no application-generated sequences, no composite PKs using business attributes.

Exception: internal technical records (webhook delivery attempts, trace spans) may be UUID-only if explicitly documented as non-business-visible.

### L2 — Tenant scoping is universal

> Every business entity row carries a non-null `tenantId` and is fenced by the `tenant_isolation` RLS policy.

Exceptions (explicit global reference data):
- `country`, `region`, `city`, `currency`, `locale`, `timezone`, `calendar`, `business_hours`.

These are NOT tenant-scoped; they are created by Super-Admin and visible to all tenants. They must be explicitly listed in §8.2 (Global Reference Data) below.

### L3 — Append-only audit is enforced

> Every state-changing artifact (per `01` L4) MUST produce an auditable event and an audit record. Postgres BEFORE UPDATE / BEFORE DELETE triggers on core business tables raise exceptions to prevent direct SQL mutation.

All mutations go through:
1. Application code publishes `DomainEvent` to `event` table.
2. A handler or trigger writes `AuditLog` with context.

Silent administrative changes are forbidden. Audit context includes: actor, source, timestamp, before/after values, change reason, IP address.

### L4 — Deletion state is independent

> The `deletionState` field is separate from `status`. A record can be `status=ACTIVE, deletionState=SOFT_DELETED` (soft-deleted but not yet purged); or `status=COMPLETED, deletionState=ACTIVE` (lifecycle complete, but retained).

Both fields are UPPER_SNAKE enum; both are tracked in audit.

### L5 — Reference numbers are immutable display-only

> A `referenceNumber` is immutable once issued. It is never used as a primary key, foreign key, or identifier for joins. Cross-tenant search may normalize input to match reference numbers (e.g. user enters `INV-123` or `INV123` or `123`), but queries use `id` internally.

### L6 — One owner core per entity, always

> Every entity declares `__owner_core__` in schema metadata. No entity is co-owned. If two cores both have legitimate claims, split the entity (per `01` §16.2–16.3) rather than create shared ownership.

### L7 — Cross-tenant references are forbidden

> No foreign key from one tenant's row to another tenant's row, except:
>  - Explicit Super-Admin paths governed by `14_TENANT_ARCHITECTURE.md`.
>  - Global reference-data tables (Country, Currency, etc.), which all tenants can reference.

### L8 — Migrations are reversible

> Every Alembic migration has a working downgrade() that undoes the upgrade(). Irreversible migrations (data-loss, destructive schema changes) are explicitly documented, approved, and logged.

## 7. Core Concepts

### 7.1 Entity ownership

Every entity is owned by exactly one core. Ownership is declared in schema metadata:

```python
class Service(Base):
    __tablename__ = "service"
    __owner_core__ = "Service"  # Platform Services tier
    # ... columns ...
```

Ownership is immutable. When an entity's owner changes, a core-split/merge amendment is required (see `01` §16.2–16.3).

### 7.2 Canonical schema structure

Every business entity table carries:

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | UUID | NO | `gen_random_uuid()` | UUIDv7 primary key. |
| `tenant_id` | UUID | NO | — | Foreign key to `tenant`. Indexed. |
| `reference_prefix` | String(10) | YES | — | e.g. `SVC`, `INV`. |
| `reference_sequence` | Integer | YES | — | e.g. `2026000417`. Tenant-scoped. |
| `reference_number` | String(30) | YES | — | Derived display value, e.g. `SVC-2026-000417`. |
| `status` | String(60) | — | depends | Business lifecycle (UPPER_SNAKE enum). |
| `deletion_state` | String(20) | NO | `'ACTIVE'` | `ACTIVE \| ARCHIVED \| SOFT_DELETED \| PENDING_PURGE \| PURGED`. |
| `created_at` | DateTime | NO | `now()` | Timestamptz. |
| `created_by` | UUID | YES | — | Foreign key to `app_user`. |
| `updated_at` | DateTime | NO | `now()` | Timestamptz. |
| `updated_by` | UUID | YES | — | Foreign key to `app_user`. |
| `archived_at` | DateTime | YES | — | Populated on archive. |
| `archived_by` | UUID | YES | — | Foreign key to `app_user`. |
| `deleted_at` | DateTime | YES | — | Populated on soft-delete. |
| `deleted_by` | UUID | YES | — | Foreign key to `app_user`. |
| `restored_at` | DateTime | YES | — | Populated on restore. |
| `restored_by` | UUID | YES | — | Foreign key to `app_user`. |

Additional domain-specific fields follow. Foreign keys use `entity_id` naming convention.

### 7.3 Indexes: standard coverage

Every business entity table has:

| Index | Purpose |
|-------|---------|
| PRIMARY KEY (`id`) | Entity identity. |
| UNIQUE (`tenant_id`, `reference_number`) | When reference numbers are user-visible (optional for internal tables). |
| INDEX (`tenant_id`, `status`, `deletion_state`) | List operations. |
| INDEX (`tenant_id`, `created_at` DESC) | Audit trail / timeline. |
| INDEX (`created_by`) | "records I created". |

Polymorphic owner tables (Notification, Comment, Attachment, AuditLog) also have:

| Index | Purpose |
|-------|---------|
| INDEX (`tenant_id`, `owner_entity_type`, `owner_entity_id`) | Polymorphic owner lookups. |

**No partial/conditional indexes.** All indexes are unconditional; WHERE clauses in queries are evaluated after index lookup.

### 7.4 Reference-number generation

Reference numbers are generated by a central service:

```python
def issue_reference_number(
    prefix: str,           # e.g. "SVC"
    tenant_id: UUID,
    year: int = None       # default current year
) -> str:
    """Generate reference number SVC-2026-000417 (tenant-scoped monotonic counter)."""
    counter = increment_counter(f"refnum:{prefix}:{tenant_id}:{year}")  # Atomic in Redis/DB
    sequence = f"{year}{counter:06d}"
    return f"{prefix}-{sequence}"
```

Counters are tenant-scoped; tenant A and tenant B each have their own counter for `SVC-`. A year rolls over on January 1. Counters never repeat for a tenant; deleted records never release their numbers.

### 7.5 Audit log structure

Every state change produces an `AuditLog` record:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenant_id` | UUID | Scope. |
| `entity_type` | String | `UPPER_SNAKE` enum (ObjectType per standard 14). |
| `entity_id` | UUID | The entity that changed. |
| `entity_reference_number` | String | The entity's reference number (for display in audit trail). |
| `actor_id` | UUID | Foreign key to `app_user`. |
| `actor_type` | String | `USER \| SYSTEM \| AUTOMATION \| INTEGRATION \| API \| CUSTOMER` (standard 14). |
| `action_type` | String | `CREATED \| UPDATED \| DELETED \| ARCHIVED \| APPROVED \| REJECTED \| ESCALATED` etc. |
| `changed_fields` | JSONB | `{field_name: {before: old, after: new}, ...}`. Omit fields that didn't change. |
| `change_reason` | Text | Why the change was made (optional). |
| `source` | String | `WEB \| MOBILE \| API \| AUTOMATION \| INTEGRATION \| SYSTEM` (standard 14). |
| `ip_address` | String | Request IP (optional). |
| `correlation_id` | String | Internal trace key (for distributed tracing). |
| `created_at` | DateTime | Timestamptz, server-default. |

Append-only: once created, never modified.

### 7.6 Event table structure

The `event` table (Event Core) stores all domain events:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenant_id` | UUID | Scope. |
| `aggregate_type` | String | e.g. `SERVICE`, `TICKET`, `INVOICE`. |
| `aggregate_id` | UUID | The entity's ID. |
| `event_type` | String | `Service.Activated`, `Ticket.Created`, etc. (PascalCase.PascalCase). |
| `event_version` | Integer | Version of the event schema (for forward/backward compatibility). |
| `payload` | JSONB | Event data (schema per `11_EVENT_ARCHITECTURE.md`). |
| `metadata` | JSONB | `{correlationId, causationId, actor, timestamp, ...}`. |
| `published_at` | DateTime | When the event was published (server-default). |
| `idempotency_key` | String | Optional; deduplicates retried publishes. |

Append-only: once created, never modified. Handlers subscribe and process asynchronously.

## 8. Reference Data and Master Data

### 8.1 Global reference data (exempt from RLS)

These entities are **global** (cross-tenant, not RLS-fenced):

| Entity | Prefix | Owner Core | Example Values |
|--------|--------|-----------|-----------------|
| Country | — | Location | `US`, `ARM`, `RU`, `DE` |
| Region | — | Location | `CA`, `TX`, `NY` (per country) |
| City | — | Location | `Yerevan`, `Los Angeles`, `Berlin` |
| Currency | — | Financial | `USD`, `AMD`, `EUR` |
| Locale | — | Localization | `en-US`, `hy-AM`, `ru-RU` |
| Timezone | — | Time | `America/Los_Angeles`, `Asia/Yerevan`, `Europe/Berlin` |
| Calendar | — | Time | Holidays, business hours (e.g. ISP maintenance windows). |
| BusinessHours | — | Time | Operating hours per location / timezone. |

These tables have **no** `tenant_id` column; they are created by Super-Admin; all tenants can reference them.

**RLS rule:** `tenant_isolation` policy exempts these tables explicitly (via a FALSE trigger that always allows the read).

### 8.2 Master data (tenant-scoped)

Master data are core reference entities that a tenant configures once and reference extensively:

| Entity | Owner Core | Notes |
|--------|-----------|-------|
| DepartmentCatalog | Organization | Tenant's internal departments (e.g. Sales, Support, Ops). |
| ServiceArea | Location | Geographical areas the tenant serves. |
| Product | Product | ISP's service offerings (Internet, IPTV, Combo). |
| Plan | Product | Pricing plans (1Mbps, 10Mbps, etc.). |
| Tariff | Financial | Rating / billing rules. |
| Queue | Case | Support queues (L1, L2, Escalations). |
| Role | Security | Permission role (Admin, Agent, Manager). |
| SlaDefinition | SLA | Response / resolution time commitments. |

Master data are **tenant-scoped** (carry `tenantId`); they are **read-heavy** (rarely updated), so they are often cached. Updates emit events that invalidate caches.

## 9. Data Quality Rules

Every entity type can have associated `DataQualityRule` records:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenant_id` | UUID | Scope. |
| `entity_type` | String | Which entity this rule governs (ObjectType enum, standard 14). |
| `field_name` | String | Specific field (or NULL for entity-level rules). |
| `rule_key` | String | Identifier (e.g. `phone_valid_format`, `age_positive`). |
| `rule_logic` | String | The rule (regex, SQL expression, custom function). |
| `severity` | String | `WARNING \| ERROR \| CRITICAL`. |
| `auto_remediation_action` | String | Optional (e.g. `TRIM_WHITESPACE`, `NULLIFY`, `ESCALATE_TO_QUEUE`). |
| `last_violation_count` | Integer | Running tally. |
| `status` | String | `ACTIVE \| DEPRECATED`. |
| `created_at` | DateTime | — |

Validation happens at write time (see standard 20); violations are logged to `audit_log` with `action_type=DATA_QUALITY_VIOLATION`. Auto-remediation actions (if enabled) run on insert/update before the record is persisted.

## 10. Data Lineage

`LineageEdge` records track how data derives across cores:

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Primary key. |
| `tenant_id` | UUID | Scope. |
| `source_entity_type` | String | ObjectType enum (standard 14). |
| `source_entity_id` | UUID | Source entity's ID. |
| `target_entity_type` | String | ObjectType enum. |
| `target_entity_id` | UUID | Target entity's ID. |
| `transformation_type` | String | `DIRECT \| COMPUTED \| IMPORTED \| DERIVED`. |
| `transformation_core` | String | Which core performed the transformation (e.g. `Financial`, `Analytics`). |
| `transformation_formula` | String | The formula or logic (if any). |
| `dependency_type` | String | `HARD \| SOFT \| OPTIONAL` (if the target's integrity depends on the source). |
| `created_at` | DateTime | — |

Lineage enables impact analysis: "if I delete this customer, which invoices / services are affected?" Queries join lineage edges to traverse the graph.

## 11. Retention and Purging (Standard 12 D14)

Every business entity has a `deletionState` field with 5 values:

| State | Meaning | Retention | Audit Trail |
|-------|---------|-----------|------------|
| `ACTIVE` | Live, normal usage. | Forever. | Logged. |
| `ARCHIVED` | Logically hidden, retained for compliance. | Configurable (default 7 years). | Logged. |
| `SOFT_DELETED` | Marked for deletion; not searchable. | Configurable (default 90 days before purge). | Logged. |
| `PENDING_PURGE` | Scheduled for purge; awaiting compliance hold clearance. | Until purge_scheduled_at + hold_period. | Logged. |
| `PURGED` | Hard-deleted; only metadata stub remains (for audit continuity). | 0 days (physically removed). | Audit record preserved. |

**Retention policy per entity type** (configurable by tenant):

| Entity | Archived | Soft-Deleted | Purge Eligible |
|--------|----------|--------------|----------------|
| Customer | 7 years | 90 days | After purge period. |
| Invoice | Permanent | 7 years | Never (financial). |
| Ticket | 2 years | 30 days | After purge period. |
| Log (non-audit) | 90 days | 7 days | Automatically. |

**Compliance holds** (Compliance Core): a retention policy or compliance hold can prevent purge even after the soft-delete window.

**Purge workflow:**
1. User soft-deletes entity → `deletionState=SOFT_DELETED`, emit `Entity.SoftDeleted` event.
2. After retention window → `deletionState=PENDING_PURGE`, `purgeScheduledAt=now()`.
3. If no compliance hold → run purge job → hard-delete row, `deletionState=PURGED`, emit `Entity.Purged` event.
4. Audit log is **preserved forever** (immutable).

## 12. PII Classification and Redaction

Every field that contains personally identifiable information (PII) is tagged:

| PII Class | Examples | Redaction Rule |
|-----------|----------|----------------|
| `PII_NAME` | firstName, lastName, fullName | Replace with `[REDACTED]`. |
| `PII_EMAIL` | email, secondaryEmail | Mask: `****@domain.com`. |
| `PII_PHONE` | phone, mobilePhone | Mask: `+1-***-****`. |
| `PII_ADDRESS` | address, city, zipcode | Replace with `[REDACTED]`. |
| `PII_ID` | taxId, ssn, passportNumber | Replace with `[REDACTED]`. |
| `PII_FINANCIAL` | bankAccount, creditCard | Replace with `[REDACTED]`. |
| `SENSITIVE_AUTH` | passwordHash, mfaSecret, apiKey | Never exposed in any output (logs, exports, audit trails). |

**Egress redaction** (Compliance Core): when data leaves the system (export, API response, report), PII fields are redacted according to the caller's permissions and the entity's confidentiality rules.

**Audit trail:** audit logs preserve actual values (for compliance); they are themselves considered sensitive and only viewable by authorized roles (Audit, Compliance).

## 13. Migrations

### 13.1 Alembic structure

Migrations live in `backend/alembic/versions/`. Each migration is named:
```
NNNNNNNNNNNN_clear_description.py
```

Example: `1278af39f621_initial_schema.py`.

### 13.2 One domain per migration (or closely related set)

- Migration 1: Foundation tables (Tenant, User, Session, Identity).
- Migration 2: Party Core tables (Customer, Contact, Employee, Vendor).
- Migration 3: Organization Core tables (Department, Team, OrgNode).
- Migration 4: Location Core tables (Site, Building, ServiceArea).
- … and so on.

Large migrations that add 10+ tables are acceptable if they belong to a single core or tightly coupled cores.

### 13.3 Reversibility is mandatory

Every migration has a working `downgrade()`:

```python
def upgrade() -> None:
    """Create tenant and related tables."""
    op.create_table('tenant', ...)
    op.create_index(...)

def downgrade() -> None:
    """Drop tenant and related tables."""
    op.drop_index(...)
    op.drop_table('tenant')
```

**Irreversible operations** (data loss, destructive renames) must be explicitly approved and documented:
```python
def downgrade() -> None:
    raise NotImplementedError(
        "Irreversible data transformation. Downgrade requires manual intervention. "
        "Approved by: <approval ref>. Reason: <reason>."
    )
```

### 13.4 No code generation artifacts in migrations

Migrations are authored manually. Auto-generated Alembic migrations (via `alembic revision --autogenerate`) are reviewed and edited before commit to ensure clarity and reversibility.

### 13.5 Migration testing

Every migration is tested:
1. Upgrade on a fresh database → schema is correct.
2. Downgrade → schema reverts cleanly.
3. Upgrade again → idempotent (no errors on re-run).

Tests live in `backend/tests/test_migrations.py` or similar; CI enforces them before PR merge.

## 14. Standard Indexes

Every business entity table includes these indexes:

### Primary key (implicit)
```sql
PRIMARY KEY (id)
```

### Tenant scope (mandatory for list operations)
```sql
INDEX (tenant_id, status, deletion_state)
```

This covering index enables fast:
- "fetch all ACTIVE, non-deleted records for this tenant"
- Pagination (with LIMIT/OFFSET).

### Audit / timeline (mandatory)
```sql
INDEX (tenant_id, created_at DESC)
```

Enables "activity for this tenant" queries in reverse chronological order.

### Actor references (recommended)
```sql
INDEX (created_by)
INDEX (updated_by)
```

For "records I created" / "records I modified" queries.

### Polymorphic owner (for polymorphic tables)
```sql
INDEX (tenant_id, owner_entity_type, owner_entity_id)
```

For Notification, Comment, Attachment, AuditLog: fast "all comments on this ticket" lookups.

### Foreign keys (implicit)
```sql
FOREIGN KEY (tenant_id) REFERENCES tenant(id)
FOREIGN KEY (created_by) REFERENCES app_user(id)
```

Indexes are created implicitly on referenced columns in most databases.

### No partial / conditional indexes

All indexes are unconditional. Queries with WHERE clauses leverage the unconditional indexes; the WHERE is evaluated after the index lookup.

## 15. Forbidden Patterns

### FP1 — Sequential integer PKs

```python
# FORBIDDEN
id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

# REQUIRED
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
```

### FP2 — gen_random_uuid() (UUIDv4)

UUIDv4 is non-sortable and leaks randomness. Use UUIDv7:

```python
# FORBIDDEN
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4)

# REQUIRED
from app.utils.ids import uuid7
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid7)
```

### FP3 — Reference numbers as PKs or FKs

```python
# FORBIDDEN
PRIMARY KEY (reference_number)
FOREIGN KEY (service_reference) REFERENCES service(reference_number)

# REQUIRED
PRIMARY KEY (id)
FOREIGN KEY (service_id) REFERENCES service(id)
-- Display reference_number separately; resolve via ID in queries.
```

### FP4 — Cross-tenant joins (outside Super-Admin)

```python
# FORBIDDEN
SELECT s.* FROM service s
JOIN service s2 ON s.id = s2.related_service_id
WHERE s.tenant_id = 'tenant-A' AND s2.tenant_id = 'tenant-B'

# REQUIRED (if needed)
-- Single tenant at a time
SELECT s.* FROM service s
WHERE s.tenant_id = 'tenant-A'
-- Cross-tenant only in Super-Admin paths with explicit audit
```

### FP5 — Business logic in database (UDFs, stored procedures)

Business logic lives in the application layer:

```python
# FORBIDDEN
CREATE FUNCTION calculate_overage() AS ...  -- in migration

# REQUIRED
# app/services/billing.py
def calculate_overage(subscription: Subscription) -> Money:
    ...
```

Exception: Postgres BEFORE triggers that enforce append-only audit (raising exceptions on UPDATE/DELETE) are acceptable.

### FP6 — Denormalized / derived fields on business entities

```python
# FORBIDDEN
CREATE TABLE service (
    id UUID,
    customer_name VARCHAR(200),  -- denormalized from customer table
    service_count INT,           -- derived; breaks on updates
    ...
)

# REQUIRED
-- Use joins in queries; maintain derived data in Analytics shadow tables
CREATE TABLE service (
    id UUID,
    customer_id UUID REFERENCES customer(id),
    ...
)
```

### FP7 — Arbitrary JSON fields for business logic

```python
# FORBIDDEN
data JSONB  -- used to store unstructured business attributes

# REQUIRED
-- If temporary or experimental: use metadata Core (Dynamic Schema).
-- If canonical: author a migration and add proper columns.
```

## 16. Owned Core Metadata

Every table in the database declares its owning core in comments or a schema registry. Example:

```python
class Service(Base):
    __tablename__ = "service"
    __owner_core__ = "Service"  # BUSINESS OBJECTS tier, primary core.
    __supported_cores__ = ["Location", "Product", "Contract", "Communication", "Financial"]
    # ^ List of cores that reference this entity.
```

This metadata is:
- Documented in `09_DATA_ARCHITECTURE.md` canonical entity matrix (§8 below).
- Enforced by drift check CI (tool: `tools/check_drift.py`).
- Queryable for dependency analysis.

## 17. Canonical Entity Matrix

### FOUNDATION tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `tenant` | Tenant | TNT | id, name, status, created_at | NO (global) |
| `app_user` | Identity | USR | id, tenant_id, email, name, password_hash, status, created_at | YES |
| `session` | Identity | — | id, user_id, token, expires_at, created_at | YES |
| `secret` | Security | — | id, tenant_id, key, encrypted_value, created_at | YES |
| `audit_log` | Audit | — | id, tenant_id, entity_type, entity_id, actor_id, action_type, changed_fields, created_at | YES |
| `event` | Event | — | id, tenant_id, aggregate_type, aggregate_id, event_type, payload, published_at | YES |
| `pending_approval` | Approval | — | id, tenant_id, entity_key, record_id, from_status, to_status, status, created_at | YES |
| `approval` | Approval | APR | id, tenant_id, action_type, target_entity_key, target_record_id, status, requested_at | YES |

### BUSINESS OBJECTS tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `customer` | Party | CUS | id, tenant_id, name, email, phone, status, deletion_state, created_at | YES |
| `contact` | Party | CON | id, tenant_id, customer_id, name, email, phone, status, created_at | YES |
| `employee` | Party | EMP | id, tenant_id, name, email, phone, org_node_id, status, created_at | YES |
| `org_node` | Organization | — | id, tenant_id, parent_id, type, name, path (ltree), created_at | YES |
| `site` | Location | SIT | id, tenant_id, name, address, city, region, country_id, status, created_at | YES |
| `service_area` | Location | SVA | id, tenant_id, name, region_id, boundary (geom), status, created_at | YES |
| `resource` | Resource | RES | id, tenant_id, type, name, location_id, status, created_at | YES |
| `product` | Product | PRD | id, tenant_id, name, category, status, created_at | YES |
| `plan` | Product | PLN | id, tenant_id, product_id, name, price, status, created_at | YES |
| `service` | Service | SVC | id, tenant_id, customer_id, plan_id, site_id, status, deletion_state, created_at | YES |
| `contract` | Contract | CTR | id, tenant_id, customer_id, status, deletion_state, created_at | YES |
| `article` | Knowledge | KBA | id, tenant_id, title, body, status, created_at | YES |

### BUSINESS COMMERCE tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `invoice` | Financial | INV | id, tenant_id, customer_id, service_id, amount, status, deletion_state, created_at | YES |
| `payment` | Financial | PAY | id, tenant_id, customer_id, invoice_id, amount, status, created_at | YES |
| `quote` | Financial | QUO | id, tenant_id, customer_id, plan_id, amount, status, created_at | YES |

### BUSINESS EXECUTION tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `ticket` | Case | TKT | id, tenant_id, customer_id, service_id, title, status, deletion_state, created_at | YES |
| `task` | Work | TSK | id, tenant_id, ticket_id, assignee_id, status, deletion_state, created_at | YES |
| `workflow_def` | Workflow | WFL | id, tenant_id, entity_def_id, key, label, config, created_at | YES |
| `comment` | Communication | CMT | id, tenant_id, owner_entity_type, owner_entity_id, body, status, created_at | YES |
| `notification` | Notification | NTF | id, tenant_id, recipient_id, owner_entity_type, owner_entity_id, channel, status, created_at | YES |
| `document` | Document | DOC | id, tenant_id, owner_entity_type, owner_entity_id, title, status, created_at | YES |

### PLATFORM SERVICES tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `data_quality_rule` | Data | — | id, tenant_id, entity_type, field_name, rule_key, rule_logic, severity, status, created_at | YES |
| `lineage_edge` | Data | — | id, tenant_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, transformation_type, created_at | YES |
| `entity_relationship` | Relationship | REL | id, tenant_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type, status, created_at | YES |
| `search_index` | Search | — | id, tenant_id, entity_type, entity_id, searchable_text, created_at | YES |

### INTELLIGENCE tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `kpi_definition` | Analytics | — | id, tenant_id, name, metric_expression, status, created_at | YES |
| `report_definition` | Reporting | RPT | id, tenant_id, name, query, status, created_at | YES |

### EXPERIENCE tier

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `nav_entry` | Workspace | — | id, tenant_id, label, route, icon, order, status, created_at | YES |

### Global reference data (NOT tenant-scoped)

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `country` | Location | — | code, name, region | NO |
| `currency` | Financial | — | code, name, symbol | NO |
| `locale` | Localization | — | code, language, region | NO |
| `timezone` | Time | — | code, name, offset | NO |

---

*End of 09 — Data Architecture.*
