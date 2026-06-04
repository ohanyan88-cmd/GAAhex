# Step 1 — Kernel `_def` Meta-Tables

Step 1 lays the **schema foundation** for the kernel: `stage_def`, `kpi_def`, and the
`owner_module` column on `entity_def`. Seeds (the 14 canonical pipeline rows per SPEC §3, the
KPI catalog per §9, the §2.2 ownership backfill) come in later steps. Kernel invariant
enforcement (single-owner write lock, control-gate `advance_to_scheduling`, one-KPI-one-owner
check) comes in Step 2.

---

## What was built

### Files

| File | Change |
|---|---|
| `backend/app/models/kernel_defs.py` | **NEW** — `StageDef`, `KpiDef` ORM models |
| `backend/app/models/meta.py` | **EDIT** — added `EntityDef.owner_module` (nullable `String(80)`) |
| `backend/app/models/__init__.py` | **EDIT** — re-exports `StageDef`, `KpiDef` |
| `backend/alembic/versions/c5e9a3b1d7f4_kernel_stage_kpi_def_tables.py` | **NEW** — additive migration |

### Naming decision (Gev locked)

Kept the existing `entity_def` table name. Semantically `entity_def` == SPEC's `record_def`;
the literal rename is deferred to a later pass and tracked in this step's parent brief. The
`owner_module` column SPEC §10.1 calls for on `record_def` is added to `entity_def` directly.

### Table definitions (verbatim, as applied)

**`stage_def`** — canonical pipeline stage per SPEC §3.

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | uuid | not null | (uuid4 from app) |
| `tenant_id` | uuid | not null | — |
| `key` | varchar(80) | not null | snake_case, e.g. `lead`, `order_validation` |
| `name` | varchar(120) | not null | display label |
| `owner_module` | varchar(80) | not null | e.g. `Marketing`, `Revenue Control` |
| `sequence` | integer | not null | 1..14 |
| `exit_gate` | varchar(255) | nullable | e.g. `Mandatory fields complete` |
| `kpi_def_key` | varchar(80) | nullable | by-key link into `kpi_def` |
| `is_control_gate` | boolean | not null | `false` (server_default) |
| `created_at` | timestamptz | not null | `now()` |

Constraints: `UNIQUE(tenant_id, key)` as `uq_stage_def_key`,
`UNIQUE(tenant_id, sequence)` as `uq_stage_def_sequence`, `FK tenant_id → tenant.id`,
index `ix_stage_def_tenant_id`.

**`kpi_def`** — KPI definition per SPEC §3 / §5.4 / §9. Invariant
(SPEC §0 rule 7): one KPI = one owner = one formula = one valid denominator.

| Column | Type | Nullable |
|---|---|---|
| `id` | uuid | not null |
| `tenant_id` | uuid | not null |
| `key` | varchar(80) | not null |
| `name` | varchar(120) | not null |
| `owner_module` | varchar(80) | not null |
| `formula` | varchar(500) | nullable — GXL/CEL expression text |
| `denominator` | varchar(255) | nullable — human-readable denominator |
| `bound_stage_key` | varchar(80) | nullable — links to `stage_def.key` |
| `bound_workflow_key` | varchar(80) | nullable — links to `workflow_def.key` |
| `created_at` | timestamptz | not null, default `now()` |

Constraints: `UNIQUE(tenant_id, key)` as `uq_kpi_def_key`, `FK tenant_id → tenant.id`,
index `ix_kpi_def_tenant_id`.

**`entity_def`** — additive column:

```sql
ALTER TABLE entity_def ADD COLUMN owner_module VARCHAR(80) NULL;
```

Nullable now; Step 3 backfills from the §2.2 ownership matrix and a later pass tightens to
NOT NULL.

### RLS

Both new tables enable the standard NULLIF-guarded `tenant_isolation` policy used by every
other post-`3a9203795d07` table — `tenant_id` must match the `gaahex.tenant_id` GUC for both
USING and WITH CHECK. Default-deny is preserved (SPEC §0 rule 2).

### Migration revision

- **Revision:** `c5e9a3b1d7f4`
- **down_revision:** `a3d7e9f1b2c4` (prior head, `page_field_value_table`)
- **Filename:** `backend/alembic/versions/c5e9a3b1d7f4_kernel_stage_kpi_def_tables.py`

---

## Verification — fresh test DB

The migration was **not** applied to the live dev DB (see "Why we skipped dev DB" below).
Instead it was verified end-to-end against a temporary DB.

```bash
docker exec gaahex-db psql -U gaahex -d gaahex -c "CREATE DATABASE gaahex_kernel_test;"

DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_kernel_test" \
OWNER_DATABASE_URL="postgresql+asyncpg://gaahex:gaahex@localhost:5433/gaahex_kernel_test" \
./.venv/Scripts/python.exe -m alembic upgrade head
```

**Result:** all 39 migrations applied cleanly from initial schema through `c5e9a3b1d7f4`. Head
landed at `c5e9a3b1d7f4`. Verified:

- `stage_def` table present with all 10 columns, both unique constraints, FK to `tenant.id`,
  `ix_stage_def_tenant_id` index, RLS enabled, `tenant_isolation` policy bound.
- `kpi_def` table present with all 10 columns, unique constraint, FK to `tenant.id`,
  `ix_kpi_def_tenant_id` index, RLS enabled, `tenant_isolation` policy bound.
- `entity_def.owner_module` column present, `character varying`, nullable.
- `alembic_version.version_num = 'c5e9a3b1d7f4'`.

**Downgrade tested:** `alembic downgrade -1` cleanly removes both tables, removes the column,
returns `version_num` to `a3d7e9f1b2c4`. Reversible.

Test DB then dropped:

```bash
docker exec gaahex-db psql -U gaahex -d gaahex -c "DROP DATABASE gaahex_kernel_test;"
```

### Note on env-var override

The first `upgrade head` attempt set only `DATABASE_URL` on the command line, but `.env`
exports `OWNER_DATABASE_URL` (which `alembic/env.py` reads first via
`settings.owner_database_url or settings.database_url`). That sent alembic at the live dev DB,
which sits at `d3e4f5a6b7c8` (unknown to GAAhex's revision graph) and failed with `Can't
locate revision identified by 'd3e4f5a6b7c8'`. Setting **both** env vars on the CLI redirected
both the migration target and the owner connection to the test DB and succeeded. Worth noting
for future kernel-build steps that touch the schema.

---

## Why we skipped applying to the live dev DB

The live dev database (`localhost:5433/gaahex`) currently has alembic head
**`d3e4f5a6b7c8`** — a sandbox migration applied during the earlier shared-DB phase.
GAAhex's revision graph doesn't contain `d3e4f5a6b7c8`, so running
`alembic upgrade head` against the live DB would fail with the exact error captured above.

Resolving that needs a deliberate cleanup (either stamp the live DB to a known-good GAAhex
revision and re-run the missing legacy-sourced migration into GAAhex's history, or rebuild the
dev DB from scratch). That cleanup is **out of scope for Step 1**. Verifying the migration
against a freshly-created temp DB proves the SQL/ORM are correct without touching the dev DB.

---

## What's left for Step 2

- **Kernel invariant enforcement:** the SPEC §0 invariants codified in application/kernel layer:
  1. Single owner write lock (only the `owner_module` may write a record).
  2. Default-deny permission evaluation (AND across Role × Dept × Region × Ownership).
  3. Financial immutability (Invoice, Payment — no DELETE).
  4. Append-only audit (no UPDATE or DELETE on audit log).
  5. References-not-copies enforcement.
  6. Region/Branch partition guard.
  7. **One KPI = one owner = one formula = one valid denominator** check at `kpi_def` write time.
- Stage-8 Control Gate write lock: `advance_to_scheduling` impossible while
  `control_pass != TRUE` (SPEC §3 control rule, §10.1 point 4).
- Then Step 3: backfill `entity_def.owner_module` from the §2.2 ownership matrix.
- Then Step 4: seed the 14 `stage_def` rows + KPI catalog.

---

## Non-negotiables honored

- Additive migration only — no DROP, no ALTER of existing columns. The single `entity_def`
  change is an `ADD COLUMN ... NULL`.
- Live dev DB untouched.
- Style reuses prior migration patterns (`page_field_value_table`, `search_history_table`,
  `enable_rls_tenant_isolation`) — same RLS policy idiom, same import shape, same revision
  header layout.
