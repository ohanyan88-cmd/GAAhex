# SPEC §0.6 — Canonical Region/Branch Table

This step creates the canonical `region` table that the SPEC §0.6 partition key needs to
point at. Step 2 (`b70ef3b98e27`) added a `region_id UUID NULL` column to seven operational
tables (`record`, `invoice`, `payment`, `order`, `service`, `helpdesk_ticket`, `workitem`),
but with no canonical region table to FK against, that column has been a free-floating UUID
with no referential integrity. THIS step gives it a home.

It does NOT yet wire FKs from those columns into `region.id`, and it does NOT install the
cross-region read guard into routers — those are separate follow-up steps. See "What's
deferred" below for the full roadmap.

Prior steps:
- Step 2 (`b70ef3b98e27`) — `region_id UUID NULL` added to seven operational tables.
- Step 6 (`a7b3c9d5e1f2`) — kernel permissions engine (Dept/Region columns + `role_def_deny`).
- §4.5 (`b5e8f1c2d3a4`) — SPEC §4.5 mandatory approvals scaffolding.

---

## A — Model

`backend/app/models/region.py`:

```python
class Region(Base):
    __tablename__ = "region"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_region_code"),
        Index("ix_region_tenant_status", "tenant_id", "status"),
        Index("ix_region_parent", "parent_id"),
    )

    id:           uuid PK
    tenant_id:    uuid FK tenant.id          NOT NULL
    code:         str(40)                    NOT NULL    # e.g. 'YER', 'GYU'
    name:         str(120)                   NOT NULL    # e.g. 'Yerevan', 'Gyumri'
    parent_id:    uuid FK region.id          NULL        # hierarchy: NULL = top-level
    region_type:  str(20) default 'region'   NOT NULL    # country | region | city | branch
    status:       str(20) default 'active'   NOT NULL    # active | inactive | archived
    timezone:     str(40)                    NULL        # IANA, e.g. 'Asia/Yerevan'
    locale:       str(20)                    NULL        # e.g. 'hy-AM'
    metadata_:    JSONB column 'metadata'    NULL        # arbitrary config (GIS, contact, ...)
    created_at:   timestamptz default now()  NOT NULL
    updated_at:   timestamptz default now()  NOT NULL    # auto on update
```

Exported from `backend/app/models/__init__.py` as `Region`.

### Hierarchy semantics

Self-referential `parent_id` projects the SPEC's four-level org topology:

```
    country  ──►  region  ──►  city  ──►  branch
```

`region_type` is a string discriminator over those four levels — left open as a string
(not an enum) so a tenant can add intermediate levels (e.g. `district`) without a schema
change. Top-level rows (no parent) carry `parent_id = NULL`. The `ix_region_parent` index
keeps "all children of region X" cheap.

### Tenant scoping

`tenant_id` FK + a standard NULLIF-guarded `tenant_isolation` RLS policy (mirrors the shape
used by every post-RLS-flip table — see `approval`, `portal_ticket_reply`, etc.):

```sql
ALTER TABLE region ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON region
  USING (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('gaahex.tenant_id', true), '')::uuid);
```

`uq_region_code` (`tenant_id, code`) makes the short code unique per tenant — tenant A's
`YER` is independent from tenant B's `YER`.

### `metadata_` attribute name

SQLAlchemy's Declarative reserves the bare `metadata` attribute name for the registry, so
the Python attribute is `metadata_` while the DB column is the unprefixed `metadata`:

```python
metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
```

Wire-facing payloads call the field `metadata` (the router serializes `r.metadata_` as
`"metadata"`); the trailing underscore is an internal Python convention only.

---

## B — Migration

`backend/alembic/versions/c6f3a92e7b81_spec_0_6_canonical_region_table.py`

- **Revision:** `c6f3a92e7b81`
- **down_revision:** `b5e8f1c2d3a4` (the SPEC §4.5 mandatory-approvals migration that was
  the head at the time this step landed).
- **Additive + reversible** — no data migration, no touched columns on other tables, no FK
  additions to the existing `region_id` columns on the seven operational tables.

`upgrade()` creates the `region` table with all twelve columns, the two FKs (`tenant.id`,
self-ref to `region.id`), the primary key, the `uq_region_code` unique constraint, three
indexes (`ix_region_tenant_id`, `ix_region_tenant_status`, `ix_region_parent`), a table
comment quoting SPEC §0.6, and the tenant_isolation RLS policy.

`downgrade()` drops the policy, the indexes, and the table.

---

## C — Seed

`backend/app/seed_regions.py::seed_demo_regions_if_empty`

For every tenant whose region row-count is 0, inserts the single default Yerevan starter
row matching the existing `dev_bulk` / `seed_if_empty` demo data context:

```python
{
  "code": "YER",
  "name": "Yerevan",
  "region_type": "region",
  "status": "active",
  "timezone": "Asia/Yerevan",
  "locale": "hy-AM",
}
```

Idempotent via two complementary guards:
1. Per-tenant `SELECT COUNT(*) FROM region WHERE tenant_id = :t` check before the insert.
2. `pg_insert(...).on_conflict_do_nothing(index_elements=['tenant_id', 'code'])` as a
   belt-and-braces second layer (covers the rare concurrent-boot race).

Returns the count of rows inserted this run (0 on a fully-seeded re-run — proven by
`test_seed_demo_regions_is_idempotent`).

**Call site:** `backend/app/main.py` lifespan — AFTER `seed_if_empty()` (tenant must exist
first) and BEFORE the SPEC-driven seeders (`seed_canonical_pipeline_if_empty`,
`seed_status_standardization_if_empty`, `seed_default_records_run`, etc.) so any future
SPEC seeder that wants to reference a default region finds one already present.

---

## D — Router

`backend/app/routers/regions.py`, mounted at `/api/regions`. Read-only this round:

| Method | Path                       | Purpose                             |
| ------ | -------------------------- | ----------------------------------- |
| GET    | `/api/regions`             | List the caller's tenant's regions  |
| GET    | `/api/regions/{region_id}` | Detail; 404 if not in tenant        |

Tenant scoping is RLS-driven — the router runs a plain `SELECT * FROM region` and the
policy filters by `gaahex.tenant_id` (set by the auth dependency). No manual `tenant_id ==`
filter in the WHERE clause; the policy is the source of truth, and a manual filter would
mask an RLS misconfiguration.

Mounted in `main.py` AFTER `org_nodes.router` and BEFORE `records.router` so the catch-all
`/api/{slug}` records route doesn't swallow `/api/regions`.

CRUD (POST/PATCH/DELETE) is intentionally NOT in this round — see "What's deferred".

---

## E — Smoke test

`backend/tests/test_regions.py` — four tests, all green:

```
tests/test_regions.py::test_list_regions_returns_seeded_yerevan PASSED
tests/test_regions.py::test_get_region_by_id_returns_matching_row PASSED
tests/test_regions.py::test_get_region_unknown_uuid_404 PASSED
tests/test_regions.py::test_seed_demo_regions_is_idempotent PASSED

============================== 4 passed in 4.98s ==============================
```

Coverage:
1. `GET /api/regions` as admin returns ≥1 row including the seeded `YER`, and the response
   shape carries every documented field (`id`, `tenant_id`, `code`, `name`, `parent_id`,
   `region_type`, `status`, `timezone`, `locale`, `metadata`, `created_at`, `updated_at`).
2. `GET /api/regions/{id}` on the YER row returns the same payload.
3. `GET /api/regions/{random-uuid}` → 404 (NOT 500, NOT 401 — confirms the not-found path).
4. Seeder is idempotent — a second invocation inserts 0 rows.

The test uses a module-scoped autouse fixture (`_seed_regions`) to call
`seed_demo_regions_if_empty()` once before the suite. This matches the pattern other tests
use to bring in a SPEC-driven seeder, since `tests/conftest.py` does NOT auto-fire the
FastAPI lifespan (httpx's `ASGITransport` does not trigger startup events).

---

## F — Verification on a fresh test DB

```
$ docker exec -i gaahex-db psql -U gaahex -c "CREATE DATABASE gaahex_region_test;"
CREATE DATABASE

$ $env:DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_region_test"
$ $env:OWNER_DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_region_test"
$ cd backend && .venv\Scripts\python.exe -m alembic upgrade head
...
INFO  [alembic.runtime.migration] Running upgrade b5e8f1c2d3a4 -> c6f3a92e7b81,
      SPEC §0.6 canonical region/branch table

$ docker exec -i gaahex-db psql -U gaahex -d gaahex_region_test -c "\d region"
                                    Table "public.region"
   Column    |           Type           | Collation | Nullable |           Default
-------------+--------------------------+-----------+----------+-----------------------------
 id          | uuid                     |           | not null |
 tenant_id   | uuid                     |           | not null |
 code        | character varying(40)    |           | not null |
 name        | character varying(120)   |           | not null |
 parent_id   | uuid                     |           |          |
 region_type | character varying(20)    |           | not null | 'region'::character varying
 status      | character varying(20)    |           | not null | 'active'::character varying
 timezone    | character varying(40)    |           |          |
 locale      | character varying(20)    |           |          |
 metadata    | jsonb                    |           |          |
 created_at  | timestamp with time zone |           | not null | now()
 updated_at  | timestamp with time zone |           | not null | now()
Indexes:
    "region_pkey" PRIMARY KEY, btree (id)
    "ix_region_parent" btree (parent_id)
    "ix_region_tenant_id" btree (tenant_id)
    "ix_region_tenant_status" btree (tenant_id, status)
    "uq_region_code" UNIQUE CONSTRAINT, btree (tenant_id, code)
Foreign-key constraints:
    "region_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES region(id)
    "region_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenant(id)
Referenced by:
    TABLE "region" CONSTRAINT "region_parent_id_fkey" FOREIGN KEY (parent_id) REFERENCES region(id)
Policies:
    POLICY "tenant_isolation"
      USING ((tenant_id = (NULLIF(current_setting('gaahex.tenant_id'::text, true), ''::text))::uuid))
      WITH CHECK ((tenant_id = (NULLIF(current_setting('gaahex.tenant_id'::text, true), ''::text))::uuid))

$ docker exec -i gaahex-db psql -U gaahex -c "DROP DATABASE gaahex_region_test;"
DROP DATABASE
```

Smoke test (against the standard `gaahex_test` DB):

```
$ .venv\Scripts\python.exe -m pytest tests/test_regions.py -v
...
tests/test_regions.py::test_list_regions_returns_seeded_yerevan PASSED   [ 25%]
tests/test_regions.py::test_get_region_by_id_returns_matching_row PASSED [ 50%]
tests/test_regions.py::test_get_region_unknown_uuid_404 PASSED           [ 75%]
tests/test_regions.py::test_seed_demo_regions_is_idempotent PASSED       [100%]
============================== 4 passed in 4.98s ==============================
```

---

## G — What's deferred

Each of these is its own follow-up step (small, focused, additive):

1. **FK additions from existing `region_id` columns into `region.id`.** The seven Step 2
   operational tables (`record`, `invoice`, `payment`, `order`, `service`,
   `helpdesk_ticket`, `workitem`) all carry a `region_id UUID NULL` column with no FK
   constraint. A follow-up migration adds the FK once a backfill pass has guaranteed every
   non-NULL value matches a seeded region row.
2. **`region_id` NOT NULL tightening.** Once the backfill is complete and the application
   side always populates region_id on insert, a later migration tightens the column to
   NOT NULL with a default.
3. **Multi-region demo seed expansion.** Today's seeder inserts one row per tenant (`YER`).
   A richer follow-up seed adds the rest of the demo coverage map — `GYU` (Gyumri),
   `VAN` (Vanadzor), with sample branches under each.
4. **Region CRUD endpoints.** `POST /api/regions`, `PATCH /api/regions/{id}`,
   `POST /api/regions/{id}/archive`, and a hierarchy-editing endpoint. Permissioned via
   the kernel `assert_can(s, user, action='manage', entity_key='region')` gate.
5. **Cross-region read guard wired into routers.** SPEC §0.6 second clause: "Cross-region
   read requires explicit grant." A kernel helper
   `assert_can_read_region(s, user, region_id)` already lives in
   `app/kernel/invariants.py`; the follow-up step is the router sweep that calls it on
   every list / detail endpoint that exposes operational records.
6. **Region picker in the UI.** Studio Configure-page support for the region field on
   every operational entity, plus a default-region preference per user.
