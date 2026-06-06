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

These are NOT tenant-scoped; they are created by Super-Admin and visible to all tenants. They must be explicitly listed in §8 (Canonical Entities) below.

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
    __owner_core__ = "Service"  # BUSINESS OBJECTS tier
    # ... columns ...
```

Ownership is immutable. When an entity's owner changes, a core-split/merge amendment is required (see `01` §16.2–16.3).

### 7.2 Canonical schema structure

Every business entity table carries:

| Field | Type | Nullable | Default | Notes |
|-------|------|----------|---------|-------|
| `id` | UUID | NO | `uuid7()` | UUIDv7 primary key. |
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

All indexes are unconditional; WHERE clauses in queries are evaluated after index lookup.

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

## 8. Canonical Entities

The platform's data model is organized into tiers by ownership core. This section lists all canonical entities (tables) by tier, declaring their owner, visibility scope, and standard fields.

### 8.1 Global reference data (exempt from RLS)

These entities are **global** (cross-tenant, not RLS-fenced):

| Entity | Owner Core | Example Values | Scope |
|--------|-----------|-----------------|-------|
| Country | Location | `US`, `ARM`, `RU`, `DE` | Global |
| Region | Location | `CA`, `TX`, `NY` (per country) | Global |
| City | Location | `Yerevan`, `Los Angeles`, `Berlin` | Global |
| Currency | Financial | `USD`, `AMD`, `EUR` | Global |
| Locale | Localization | `en-US`, `hy-AM`, `ru-RU` | Global |
| Timezone | Time | `America/Los_Angeles`, `Asia/Yerevan`, `Europe/Berlin` | Global |
| Calendar | Time | Holidays, business hours (e.g. ISP maintenance windows). | Global |
| BusinessHours | Time | Operating hours per location / timezone. | Global |

These tables have **no** `tenant_id` column; they are created by Super-Admin; all tenants can reference them. The `tenant_isolation` RLS policy exempts these tables explicitly via a FALSE trigger.

### 8.2 Master data (tenant-scoped)

Master data are core reference entities that a tenant configures once and reference extensively:

| Entity | Owner Core | Scope | Usage |
|--------|-----------|-------|-------|
| DepartmentCatalog | Organization | Tenant | Tenant's internal departments (e.g. Sales, Support, Ops). |
| ServiceArea | Location | Tenant | Geographical areas the tenant serves. |
| Product | Product | Tenant | ISP's service offerings (Internet, IPTV, Combo). |
| Plan | Product | Tenant | Pricing plans (1Mbps, 10Mbps, etc.). |
| Tariff | Financial | Tenant | Rating / billing rules. |
| Queue | Case | Tenant | Support queues (L1, L2, Escalations). |
| Role | Security | Tenant | Permission role (Admin, Agent, Manager). |
| SlaDefinition | SLA | Tenant | Response / resolution time commitments. |

Master data are **tenant-scoped** (carry `tenantId`); they are **read-heavy** (rarely updated), so they are often cached. Updates emit events that invalidate caches.

### 8.3 Foundation tier canonical entities

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

### 8.4 Business Objects tier canonical entities

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

### 8.5 Business Commerce tier canonical entities

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `invoice` | Financial | INV | id, tenant_id, customer_id, service_id, amount, status, deletion_state, created_at | YES |
| `payment` | Financial | PAY | id, tenant_id, customer_id, invoice_id, amount, status, created_at | YES |
| `quote` | Financial | QUO | id, tenant_id, customer_id, plan_id, amount, status, created_at | YES |

### 8.6 Business Execution tier canonical entities

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `ticket` | Case | TKT | id, tenant_id, customer_id, service_id, title, status, deletion_state, created_at | YES |
| `task` | Work | TSK | id, tenant_id, ticket_id, assignee_id, status, deletion_state, created_at | YES |
| `workflow_def` | Workflow | WFL | id, tenant_id, entity_def_id, key, label, config, created_at | YES |
| `comment` | Communication | CMT | id, tenant_id, owner_entity_type, owner_entity_id, body, status, created_at | YES |
| `notification` | Notification | NTF | id, tenant_id, recipient_id, owner_entity_type, owner_entity_id, channel, status, created_at | YES |
| `document` | Document | DOC | id, tenant_id, owner_entity_type, owner_entity_id, title, status, created_at | YES |

### 8.7 Platform Services tier canonical entities

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `data_quality_rule` | Data | — | id, tenant_id, entity_type, field_name, rule_key, rule_logic, severity, status, created_at | YES |
| `lineage_edge` | Data | — | id, tenant_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, transformation_type, created_at | YES |
| `entity_relationship` | Relationship | REL | id, tenant_id, source_entity_type, source_entity_id, target_entity_type, target_entity_id, relationship_type, status, created_at | YES |
| `search_index` | Search | — | id, tenant_id, entity_type, entity_id, searchable_text, created_at | YES |

### 8.8 Intelligence tier canonical entities

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `kpi_definition` | Analytics | — | id, tenant_id, name, metric_expression, status, created_at | YES |
| `report_definition` | Reporting | RPT | id, tenant_id, name, query, status, created_at | YES |

### 8.9 Experience tier canonical entities

| Table | Owner Core | Reference Prefix | Fields | Tenant-Scoped |
|-------|-----------|-----------------|--------|----------------|
| `nav_entry` | Workspace | — | id, tenant_id, label, route, icon, order, status, created_at | YES |

## 9. Ownership Boundaries

Every table in the database declares its owning core in schema metadata. Example:

```python
class Service(Base):
    __tablename__ = "service"
    __owner_core__ = "Service"  # BUSINESS OBJECTS tier, primary owner.
    __supported_cores__ = ["Location", "Product", "Contract", "Communication", "Financial"]
```

This metadata is:
- Documented in §8 canonical entity matrix above.
- Enforced by drift check CI (tool: `tools/check_drift.py`).
- Queryable for dependency analysis via core ownership registry.

## 10. Relationships

Cross-table foreign keys reference canonical entities via their `id` field (UUIDv7). The following relationship patterns are standard:

- **Parent–child relationships** use direct `parent_id` foreign keys within the same tenant scope.
- **Cross-core relationships** use direct `entity_id` foreign keys (e.g., `service` table carries `customer_id` referencing `customer`).
- **Polymorphic relationships** (Comments, Notifications, Attachments) use `(owner_entity_type, owner_entity_id)` pairs to reference any entity type.
- **Data lineage relationships** are tracked in `lineage_edge` table (not direct FKs) to enable queryable impact analysis.

All relationships stay within a single tenant scope except for global reference data, which all tenants can reference.

## 11. Responsibilities

Core ownership determines responsibility for:
- Creating and mutating canonical entities via APIs.
- Publishing domain events on state change.
- Writing audit records for compliance.
- Defining data quality rules.
- Managing retention and purge policies.
- Declaring lineage edges when deriving data.
- Handling PII classification and redaction.

The owning core is accountable for schema correctness, backward compatibility in migrations, and conformance to the standard field set (§7.2).

## 12. Allowed Patterns

### AP1 — Use UUIDv7 for all business entity PKs

Every canonical entity's primary key is a UUIDv7 generated at insertion time. UUIDv7 is time-ordered, lexicographically sortable, and distributed-safe. Use `from app.utils.ids import uuid7` as the default factory.

### AP2 — Use append-only audit triggers with RAISE EXCEPTION

Postgres BEFORE UPDATE / BEFORE DELETE triggers on business tables enforce immutability:

```sql
CREATE TRIGGER service_append_only BEFORE UPDATE ON service
  FOR EACH ROW EXECUTE FUNCTION raise_append_only_exception();
```

This is the approved mechanism for enforcing L3 (Append-only audit).

### AP3 — Use UUIDv7-lex cursor pagination

For large result sets, paginate using UUIDv7 lexicographic ordering:

```sql
SELECT * FROM service WHERE tenant_id = $1 AND id > $2 ORDER BY id LIMIT 50
```

This avoids OFFSET (which re-scans rows) and uses the index naturally.

### AP4 — Use tenant_isolation RLS policy

Every tenant-scoped table has the RLS policy enabled:

```sql
ALTER TABLE service ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON service 
  FOR ALL TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

This is enforced at the database level; no application-layer filtering is necessary.

### AP5 — Use monotonic reference-number counters with tenant scope

Reference numbers are generated via atomic counter increments (in Redis or a counter table):

```python
counter = increment_counter(f"refnum:{prefix}:{tenant_id}:{year}")
reference_number = f"{prefix}-{year}{counter:06d}"
```

Counters are tenant-scoped and immutable once issued; they never wrap or repeat.

## 13. Forbidden Patterns

### FP1 — Sequential integer PKs

Sequential integer primary keys leak temporal order and are unsuitable for multi-tenant systems. Forbidden across all business entities.

```python
# FORBIDDEN
id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

# REQUIRED
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid7)
```

### FP2 — gen_random_uuid() (UUIDv4)

UUIDv4 is non-sortable, lexicographically unsafe, and leaks randomness. Use UUIDv7 exclusively.

```python
# FORBIDDEN
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid.uuid4)

# REQUIRED
from app.utils.ids import uuid7
id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), default=uuid7)
```

### FP3 — Reference numbers as PKs or FKs

Reference numbers are display-only identifiers. Joins, primary keys, and foreign keys use UUIDs exclusively.

```python
# FORBIDDEN
PRIMARY KEY (reference_number)
FOREIGN KEY (service_reference) REFERENCES service(reference_number)

# REQUIRED
PRIMARY KEY (id)
FOREIGN KEY (service_id) REFERENCES service(id)
```

### FP4 — Cross-tenant joins (outside Super-Admin)

No query may join rows from different tenants except in explicit Super-Admin audit paths.

```python
# FORBIDDEN
SELECT s.* FROM service s
WHERE s.tenant_id = 'tenant-A' AND s.related_service_id IN (
  SELECT id FROM service WHERE tenant_id = 'tenant-B'
)

# REQUIRED
-- Single tenant at a time
SELECT s.* FROM service s WHERE s.tenant_id = 'tenant-A'
```

### FP5 — Business logic in database (UDFs, stored procedures)

Business rules live in the application layer, not in the database. Exception: Postgres BEFORE triggers that enforce append-only audit (L3) are acceptable.

```python
# FORBIDDEN
CREATE FUNCTION calculate_overage() AS ...  -- in migration

# REQUIRED
# backend/app/services/billing.py
def calculate_overage(subscription: Subscription) -> Money:
    ...
```

### FP6 — Denormalized / derived fields on business entities

Business entities are normalized. Derived data (counts, aggregates) belongs in Analytics shadow tables, not on the canonical entity.

```python
# FORBIDDEN
CREATE TABLE service (
    id UUID,
    customer_name VARCHAR(200),  -- denormalized
    service_count INT,           -- derived
    ...
)

# REQUIRED
CREATE TABLE service (
    id UUID,
    customer_id UUID REFERENCES customer(id),
    ...
)
```

### FP7 — Arbitrary JSON fields for business logic

Unstructured JSON blobs bypass data governance. Use the Metadata Core (Dynamic Schema) for experimental fields; migrate to proper columns in canonical entities once validated.

```python
# FORBIDDEN
data JSONB  -- used to store unstructured business attributes

# REQUIRED
-- Temporary: use metadata Core
-- Production: add proper columns via Alembic migration
```

## 14. Cross-Architecture Dependencies

| This document depends on | For |
|---|---|
| `01_PLATFORM_CORE_ARCHITECTURE.md` | Core ownership and tier discipline. |
| `03_INFORMATION_ARCHITECTURE.md` | Entity definitions and relationships. |
| `11_EVENT_ARCHITECTURE.md` | Event schema and publish/subscribe patterns. |
| `14_TENANT_ARCHITECTURE.md` | RLS policy enforcement and tenant scoping. |
| Standards 12, 14, 20 | Data quality, PII, validation rules. |

| Documents that depend on this one |
|---|
| `02_DOMAIN_ARCHITECTURE.md` (maps cores to implementation domains) |
| `10_API_ARCHITECTURE.md` (REST surface for canonical entities) |
| `08_PERMISSION_ARCHITECTURE.md` (permission keys per entity) |
| `15_REPORTING_ARCHITECTURE.md` (read-only canonical data) |
| `16_ANALYTICS_ARCHITECTURE.md` (shadow tables derived from canonical) |

## 15. Implementation Requirements

### 15.1 Standard fields on all business entities

All canonical entities must include the standard field set per §7.2: `id`, `tenant_id`, `status`, `deletion_state`, `created_at`, `created_by`, `updated_at`, `updated_by`, and (optionally) archive/delete/restore timestamps.

### 15.2 Indexes on all business entities

All canonical entities must have the standard index set per §7.3: PRIMARY KEY on `id`; a covering index on `(tenant_id, status, deletion_state)`; a timeline index on `(tenant_id, created_at DESC)`; and actor indexes on `created_by` / `updated_by`.

### 15.3 RLS policy enforcement

All tenant-scoped tables must have the `tenant_isolation` RLS policy enabled in production. The policy is enforced at the database level via Postgres RLS, not at the application layer.

### 15.4 Append-only audit triggers

All business entity tables must have BEFORE UPDATE / BEFORE DELETE triggers that RAISE EXCEPTION to prevent direct SQL mutation. Mutations go through the application layer via events and audit records.

### 15.5 Data quality rule registration

For entities with data validation rules, register `DataQualityRule` records at tenant setup time. Violations are logged to `audit_log` with action_type `DATA_QUALITY_VIOLATION`.

### 15.6 Retention policy configuration

Every entity type must have a configurable retention policy (per tenant) defining archive, soft-delete, and purge windows. Compliance holds can extend retention indefinitely.

### 15.7 PII tagging and redaction

Every column that contains PII must be tagged with its PII class (§13 in the current doc on PII). Egress redaction is enforced by the Compliance Core at export / API response / report time.

## 16. Future Expansion Rules

### 16.1 Adding a new business entity

When a new canonical entity is proposed:

1. Declare the owning core (per `01_PLATFORM_CORE_ARCHITECTURE.md`).
2. Add the entity to the canonical matrix in §8.
3. Author an Alembic migration per §13 to create the table with standard fields.
4. Declare events and APIs in `11_EVENT_ARCHITECTURE.md` and `10_API_ARCHITECTURE.md`.
5. Add permission keys in `08_PERMISSION_ARCHITECTURE.md`.
6. Register data quality rules if validation is required.

### 16.2 Modifying entity schema

Schema modifications are done via reversible Alembic migrations, never by direct SQL. Migrations are committed separately before feature PRs.

### 16.3 Retiring an entity

When an entity is no longer used:

1. Deprecate it in schema metadata.
2. Migrate existing records to successor entity(ies) via a data migration.
3. Update all references (FKs, events, APIs) to point to the successor.
4. Remove the entity from the canonical matrix after all data is migrated.

---

*End of 09 — Data Architecture.*
