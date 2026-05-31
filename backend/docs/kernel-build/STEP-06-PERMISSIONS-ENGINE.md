# Step 6 — Default-Deny Permissions Engine (Role × Department × Region × Ownership)

**SPEC reference:** `GAAex_Cross_Module_Architecture_SPEC.md`
- §0 Invariant #2 — "Default deny. No access unless explicitly granted by Role × Department × Region × Ownership."
- §4.1 Layers
- §4.2 Action Types
- §4.3 Role Boundaries (cannot lists are enforced, not advisory)
- §4.4 Field-Level access (deferred — see "What's deferred")
- §4.5 Mandatory Approvals (deferred — see "What's deferred")

Step 6 turns the SPEC §0.2 default-deny invariant from a single-layer role check into the LOCKED
four-layer AND evaluator the SPEC describes, AND seeds the SPEC §4.3 role hard-denial table so
"Admin cannot delete the audit log", "Sales cannot touch audit", "Revenue Control cannot create
deals" etc. are enforced as rows, not as inline code.

Prior steps:
- Step 1 (`c21bd24`) — `stage_def` / `kpi_def` tables + `entity_def.owner_module` column.
- Step 2 (`8951521`) — DB triggers (financial + audit append-only) + `region_id` + kernel facade.
- Step 3 (`75cb96d`) — Ownership matrix seeded + MASTER_RECORD_KEYS guard.
- Step 4 (`fcc6a5a`) — 14 pipeline stages + 14 KPIs + Stage 8 Control Gate.
- Step 5 (`96a3535`) — SPEC §7 status sets (28 rows) seeded + `is_terminal` column.

---

## A — Schema change (additive)

Migration: **`a7b3c9d5e1f2_kernel_permissions_engine.py`** — `down_revision: 'd4f8a1c6b3e5'`.

```python
# app_user.department — the user's home department (SPEC §4.1 layer).
op.add_column('app_user', sa.Column('department', sa.String(80), nullable=True))

# assignment.department — optional per-assignment dept filter.
# assignment.region_scope — 'home_only' | 'subtree' | 'any' | NULL (read as 'home_only').
op.add_column('assignment', sa.Column('department',   sa.String(80), nullable=True))
op.add_column('assignment', sa.Column('region_scope', sa.String(20), nullable=True))

# org_node.region_code — stable region projection from the ltree path.
op.add_column('org_node', sa.Column('region_code', sa.String(80), nullable=True))

# role_def_deny — SPEC §4.3 hard-denial rows.
op.create_table('role_def_deny', ...)
# Unique key uses COALESCE(denied_entity_key, '__any__') so the NULL-entity branch dedupes too.
op.execute("CREATE UNIQUE INDEX uq_role_def_deny_key ...")
op.execute("ALTER TABLE role_def_deny ENABLE ROW LEVEL SECURITY;")
# tenant_isolation policy (standard NULLIF-guarded shape used across kernel tables).
```

All columns nullable so adoption is transitional — the kernel falls back gracefully when the
user/assignment/region context isn't filled in yet.

---

## B — The 4-layer AND model

**Module:** `backend/app/kernel/invariants.py::assert_can`

```python
await assert_can(
    s, user, *,
    action: str,                           # SPEC §4.2 verb
    entity_key: str,
    region_id: uuid.UUID | None = None,
    department: str | None = None,
    owner_user_id: uuid.UUID | None = None,
) -> None
```

Layers evaluated in order — the first one that denies raises `AccessDenied`:

| # | Layer                | Source                                             | Behavior                                                                                                              |
|---|----------------------|----------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| 1 | Role grant           | `access.load_grants` + `access.can`                | If the user has no positive grant matching `entity_key.action` (or wildcard), raise `AccessDenied('role: missing …')`. |
| 2 | Role hard-denial     | `role_def_deny` table (SPEC §4.3)                  | If a deny row matches the user's role × action × entity, raise `AccessDenied('role hard-denial …')`. Wildcards: `denied_action='*'` matches any verb; `denied_entity_key=NULL` matches any entity; the compound `'audit.*'` is parsed verbatim. |
| 3 | Department           | `assignment.department` + `app_user.department`    | If `department` arg is not None, require AT LEAST ONE of the user's assignments to be department-agnostic (NULL) or match the record's department; the user's `app_user.department` also counts as a match. |
| 4 | Region               | `assert_can_read_region` (still a forward-compat facade — full region-grant evaluator deferred) | If `region_id` is not None, delegate.                                                |
| 5 | Ownership (own-only) | `_OWN_ONLY_ACTIONS` set + `owner_user_id` arg      | If `action` is in the own-only set and `owner_user_id` is provided, require `user.id == owner_user_id`.               |

### Transitional fallback

When `region_id`, `department`, and `owner_user_id` are all None (the legacy Step 0-5 call shape),
the function executes layers #1 + #2 only and emits a WARNING log:

```
WARNING gaaex.kernel.invariants:assert_can called without region/department/owner context
        — kernel falling back to role-only check for action=… entity=… user=…
```

This is deliberate — it lets routers incrementally adopt the engine without a forced flag-day.
Step 7+ widens the call sites; the kernel doesn't change.

### Hard-deny match semantics (`_deny_matches`)

`role_def_deny` rows accept either the SPEC text shape (`'audit.*'`, `'invoice.edit'`,
`'payment.*'`) OR the structured `(action, entity_key)` shape. The kernel matcher resolves both:

- `denied_action='*'` + `denied_entity_key=NULL`  → matches any (entity, action) pair.
- `denied_action='*'` + `denied_entity_key='X'`   → matches every action on entity `X`.
- `denied_action='audit.*'` + `entity=NULL`       → matches every verb of entity `audit`.
- `denied_action='invoice.edit'` + `entity=NULL`  → matches exactly `entity='invoice' action='edit'`.
- `denied_action='network.config.*'`              → matches any verb on the dotted entity prefix
                                                    `network.config`.
- Bare `denied_action='delete'` + `denied_entity_key='audit_log'` → matches exact pair.

The compound form lets the seed file read identically to the SPEC §4.3 text.

---

## C — The SPEC §4.3 boundaries seeder

**Module:** `backend/app/seed_role_boundaries.py`
**Public API:** `seed_role_boundaries_if_empty() -> dict[str, int]`
**Call site:** `backend/app/main.py` lifespan, after `seed_ownership_matrix_if_empty()` (so RoleDef
rows exist before we insert denials referencing them).

Idempotent — uses a pre-check against the COALESCE-keyed unique index shape (`(tenant_id, role_id,
denied_action, COALESCE(denied_entity_key, '__any__'))`), then `s.add(...)` only if missing.
Re-runs insert zero new rows.

### SPEC §4.3 → seeded denials (the 10 roles)

| SPEC §4.3 role  | Mapped role key   | Deny rows (compound form)                                                                          | Notes                                                                                            |
|-----------------|-------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| Admin           | `super_admin`     | `audit.edit`, `audit.delete`, `audit_log.edit`, `audit_log.delete`                                 | SPEC §0.4 invariant — no role, including Admin, may mutate the audit log.                        |
| Executive       | `executive`       | `customer.edit`, `order.edit`, `invoice.edit`, `workitem.edit`                                     | "Edit operational records (unless granted)" — Studio can layer per-record exceptions later.      |
| Sales           | `sales_agent`     | `accounting.*`, `system.*`, `network.config.*`, `order_validation.*`, `audit.*`                    | The verbatim SPEC §4.3 hard denials for Sales.                                                   |
| Customer Care   | `customer_care`   | `invoice.edit`, `payment.*`, `network.config.*`                                                    |                                                                                                  |
| Billing         | `billing`         | `network.asset.edit`, `service.provision.*`, `pipeline.advance`, `stage.advance`                   |                                                                                                  |
| Revenue Control | `revenue_control` | `deal.create`, `contract.create`                                                                   | Separation of duties: validator cannot be creator.                                                |
| Network / NOC   | `network_noc`     | `finance.*`, `hr.*`, `legal.*`, `billing.sensitive.*`                                              |                                                                                                  |
| Field Tech      | `field_technician`| `customer.financial.*`, `workitem.view.others`, `system.settings.*`                                | "Other techs' work" encoded as the own-only marker `workitem.view.others`.                       |
| Finance         | `finance`         | `network.config.*`, `customer.comm.private`                                                        |                                                                                                  |
| HR              | `hr`              | `customer.billing.*`, `network.ops.*`, `pipeline.*`                                                |                                                                                                  |

Roles that don't exist as `role_def` rows for a tenant are SILENTLY SKIPPED — the next boot
picks them up automatically the moment they're seeded. In the M0 demo only `super_admin` and
`sales_agent` exist (per `seed.py::build_access_config`), so first-boot inserts:
- `super_admin`: 4 rows
- `sales_agent`: 5 rows
- **Total: 9 rows**

---

## D — Verification transcript (test DB, 2026-05-31)

Fresh ephemeral DB `gaaex_step6_test` on the existing `gaaex-db` container.

```
docker exec gaaex-db psql -U gaaex -d postgres -c "DROP DATABASE IF EXISTS gaaex_step6_test WITH (FORCE);"
docker exec gaaex-db psql -U gaaex -d postgres -c "CREATE DATABASE gaaex_step6_test;"
$env:DATABASE_URL="postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_step6_test"
$env:OWNER_DATABASE_URL="postgresql+asyncpg://gaaex:gaaex@localhost:5433/gaaex_step6_test"
cd backend
.venv/Scripts/python.exe -m alembic upgrade head
# … 40 migrations applied through a7b3c9d5e1f2 …
```

### Schema check

```sql
-- app_user.department exists, nullable
column_name  data_type             is_nullable
department   character varying     YES

-- assignment.department + region_scope exist, nullable
column_name   data_type             is_nullable
department    character varying     YES
region_scope  character varying     YES

-- org_node.region_code exists
column_name
region_code

-- role_def_deny table + unique index
"role_def_deny_pkey" PRIMARY KEY, btree (id)
"ix_role_def_deny_role_id" btree (role_id)
"ix_role_def_deny_tenant_id" btree (tenant_id)
"uq_role_def_deny_key" UNIQUE, btree (tenant_id, role_id, denied_action,
                                      COALESCE(denied_entity_key, '__any__'))
Foreign-key constraints:
    role_def_deny_role_id_fkey FOREIGN KEY (role_id) REFERENCES role_def(id) ON DELETE CASCADE
    role_def_deny_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id)
Policies:
    tenant_isolation USING ... NULLIF(current_setting('gaaex.tenant_id', true), '') ...
```

### Seeder output (first run vs second run)

```
seed_role_boundaries first run:  {'super_admin': 4, 'sales_agent': 5}  total: 9
seed_role_boundaries second run: {}                                    total: 0
```

Idempotency proven — zero rows inserted on re-run.

### Seeded rows

```
    role     |   denied_action    | denied_entity_key |                            reason
-------------+--------------------+-------------------+---------------------------------------------------------------
 sales_agent | accounting.*       |                   | SPEC §4.3 Sales — no accounting access
 sales_agent | audit.*            |                   | SPEC §4.3 Sales — no audit access
 sales_agent | network.config.*   |                   | SPEC §4.3 Sales — no network config
 sales_agent | order_validation.* |                   | SPEC §4.3 Sales — Order Validation belongs to Revenue Control
 sales_agent | system.*           |                   | SPEC §4.3 Sales — no system settings
 super_admin | audit.delete       |                   | SPEC §0.4 audit append-only — no role may delete audit log
 super_admin | audit.edit         |                   | SPEC §0.4 audit append-only — no role may edit audit log
 super_admin | audit_log.delete   |                   | SPEC §0.4 audit append-only (audit_log entity alias)
 super_admin | audit_log.edit     |                   | SPEC §0.4 audit append-only (audit_log entity alias)
(9 rows)
```

### `assert_can` manual cases

```
Test 1: admin.delete on audit_log (expected: AccessDenied)
→ AccessDenied as expected: role hard-denial: 'audit_log.delete' on '*' — SPEC §0.4 audit append-only (audit_log entity alias) — SPEC §4.3

Test 2: admin.view on customer (expected: pass)
→ Passed (super_admin wildcard)

Test 3: agent.view on audit (expected: AccessDenied)
→ AccessDenied as expected: role: missing audit.view — SPEC §0.2 default-deny
  (caught at layer 1 — sales_agent doesn't have audit.view positively;
   the layer-2 hard-deny on 'audit.*' would also catch it if layer 1 passed)

Test 4: agent.create on lead (expected: pass)
→ Passed (sales_agent grant)
```

The WARNING log fires for the passing legacy-shape calls:

```
WARNING gaaex.kernel.invariants: assert_can called without region/department/owner context
        — kernel falling back to role-only check for action='view' entity='customer' user=…
```

This is the documented transitional behavior — Step 7+ widens callers to pass region/department.

### Pytest baseline check

```
.venv/Scripts/python.exe -m pytest tests/test_api.py tests/test_auth.py tests/test_approvals.py \
                                   tests/test_rls.py tests/test_workflow.py tests/test_users.py \
                                   --tb=no
42 passed, 1 warning in 8.96s
```

The 2 pre-existing failures in `test_orders.py` (`test_lifecycle_and_provisioning`,
`test_illegal_transitions_409`) are inherited from Step 4 — they assume the SUBMITTED → PROVISIONING
advance succeeds without `control_pass=True`, which Step 4's Control Gate blocks. Same failures
reproduce on Step 5's `c28d153` HEAD. Out of scope for Step 6 (the test fixtures need a
control-gate-aware advance helper, separate from the permissions engine).

---

## E — The wired touchpoint (proof of life)

**File:** `backend/app/routers/orders.py::advance_order`

```python
# SPEC §4 default-deny — proof-of-life wire-up of the kernel permissions engine. The legacy
# role check above is preserved (Studio/M0 has roles to keep working); this kernel call
# additionally evaluates Role × Department × Region × Ownership and raises AccessDenied →
# 403 if any layer denies. Step 6 wires this ONE touchpoint; a full router sweep lands later.
try:
    await assert_can(
        s, user,
        action="edit",
        entity_key="order",
        region_id=getattr(order, "region_id", None),
        owner_user_id=order.control_pass_by,  # closest stand-in until order.created_by lands
    )
except AccessDenied as e:
    raise HTTPException(status_code=403, detail=str(e))
```

This is intentionally additive — it lives next to the existing `can(grants, "order", "edit", …)`
check, not in place of it. Reasoning: the M0 surface assumes the legacy check, and the kernel
call adds the hard-denial layer on top without flipping any router-level behavior.

`owner_user_id=order.control_pass_by` is the closest stand-in for "who owns this order" until a
proper `order.created_by` column lands in a follow-up migration. For now `control_pass_by` is
NULL on every fresh order (Step 4 fills it on Revenue Control verdict), so the ownership layer
never triggers — by design for now.

---

## F — What's deferred

These are explicitly out of Step 6 scope; they're tracked here so the gap is visible.

1. **Full router sweep wiring `assert_can` everywhere.** Step 6 wires ONE touchpoint
   (`orders.advance_order`) as proof of life. Every other writer (records, billing, services,
   workitems, helpdesk, …) still uses the legacy `can(grants, …)` shape. Widening is a
   mechanical pass — separate step.

2. **SPEC §4.4 field-level encryption.** The SPEC names secrets, bank details, API keys, audit
   log fields as requiring encryption-at-rest in addition to permission gating. Step 6 covers
   only the permission/deny half (already partially in `access.can_view_field` /
   `can_edit_field`). Encryption is a separate effort (pgcrypto, KMS plumbing).

3. **SPEC §4.5 mandatory approvals workflow.** "High discount · Refund · Credit note · Invoice
   cancellation · Service suspension · Contract change · …" need approval state machines.
   Approvals already have a `PendingApproval` table from earlier batches; turning the SPEC §4.5
   list into actual gated transitions is a separate workflow-engine step.

4. **The full region-grant evaluator.** Step 6 lands the SCHEMA (`org_node.region_code`,
   `assignment.region_scope`) and the kernel call shape — `assert_can_read_region` is still a
   forward-compat facade that's a no-op when a region_id is supplied. The real evaluator walks
   the user's assignments → resolves region_code via the assignment's node + region_scope →
   matches against the record's `region_id`. It needs a canonical region table; deferred to the
   step that introduces it.

5. **User department + region seeds (M0 demo set).** The schema columns are in place but no
   M0 seed populates `app_user.department` or `assignment.region_scope` for the demo `admin` /
   `agent` users. The transitional fallback handles this gracefully (WARNING + role-only check),
   so adoption is unblocked, but tightening to "no fallback in prod" requires the M0 demo to
   actually have departments and region scopes filled in.

6. **`order.created_by` column for ownership-layer accuracy.** Step 6 uses
   `order.control_pass_by` as the closest stand-in. A real `created_by uuid` on `"order"` (and
   on every operational table that lacks one) lands when the ownership layer goes from
   "facade" to "always-on".

7. **The `executive`, `customer_care`, `billing`, `revenue_control`, `network_noc`,
   `field_technician`, `finance`, `hr` RoleDefs themselves.** SPEC §4.3 names ten roles; the M0
   baseline seeds only three (`super_admin`, `manager`, `sales_agent`). The boundaries seed
   *will populate denials for the missing seven the moment they're seeded* — no code change
   needed. Seeding the missing roles is a separate step (it's part of the M0 demo set, not the
   kernel).

8. **Per-record / per-instance grants.** SPEC §4 references "Customer segment", "Assignment",
   and other layers below the four enforced here. They're deferred — the four enforced layers
   are the SPEC §4.1 first-tier, which is the M0 default-deny posture.

---

## File map

| File                                                                       | Role                                                                                  |
|----------------------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `backend/alembic/versions/a7b3c9d5e1f2_kernel_permissions_engine.py`       | Additive migration — dept/region columns + `role_def_deny` table.                     |
| `backend/app/models/user.py`                                               | `User.department`.                                                                    |
| `backend/app/models/orgnode.py`                                            | `OrgNode.region_code`.                                                                |
| `backend/app/models/access.py`                                             | `Assignment.department`, `Assignment.region_scope`, new `RoleDeny` model.             |
| `backend/app/models/__init__.py`                                           | Export `RoleDeny`.                                                                    |
| `backend/app/kernel/invariants.py`                                         | Real 4-layer `assert_can` + `_deny_matches` parser + transitional warning.            |
| `backend/app/seed_role_boundaries.py`                                      | The idempotent SPEC §4.3 seeder.                                                      |
| `backend/app/main.py`                                                      | Imports `RoleDeny`, calls the new seeder in lifespan.                                 |
| `backend/app/routers/orders.py`                                            | Proof-of-life `assert_can` wire-up on `advance_order`.                                |
| `backend/docs/kernel-build/STEP-06-PERMISSIONS-ENGINE.md`                  | This document.                                                                        |

---

## Commit

`5bbe7a4` — `feat(kernel): step 6 — default-deny permissions engine
(Role × Dept × Region × Ownership)`
