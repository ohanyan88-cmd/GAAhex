# GAAhex — Stage-2 Production Rescue Plan

**Source**: `PRODUCTION-REMEDIATION-REPORT-2026-06-04.md` (commit `d860639`)
**Mission**: NO-GO → CONDITIONAL GO CANDIDATE
**Method**: real-fix where feasible + **fail-closed production-disabled** where multi-week-eng

---

## Strategy

The 6 remaining Criticals + 2 known test issues + 3 product decisions cannot all be fully built in one session. Per the audit's own verdict rules, **"production-disabled fail-closed"** is an acceptable closure path:

> CONDITIONAL GO CANDIDATE if:
> - unsafe incomplete systems are either implemented or **production-disabled fail-closed**
> - no known NO-GO condition remains in code

Every Critical-class subsystem that we can't fully build this session will be:
1. Gated behind a `FeatureGate` service with explicit required/provider/enabled state
2. Guarded at the production deploy contract (boot refuses misconfigured state)
3. Wrapped so any production caller hits `FeatureDisabledError` → 503 + audit Event
4. Documented in UI/API as "feature unavailable" where surfaced

Real fixes (where 1-session scope allows):
- **F6** settle_order race → UNIQUE constraint + lock ordering
- **GDPR PURGED state** → real PII anonymization
- **3 product decisions** → safe defaults landed

---

## 8 parallel agent packs

| Pack | Owns | Files (no overlap) | Real-fix or fail-closed |
|---|---|---|---|
| **P1 — Feature gate infrastructure** | New `services/feature_gate.py`, `models/feature_gate.py`, config additions | New files + `config.py` (extend prod contract) | Foundation for P3–P6 |
| **P2 — F6 race + dunning test fix** | `payment_gateway.py`, alembic migration, F6 test, dunning fixture | New alembic rev `f8c5b1e9a3d2_*`, settle_order + tests | Real fix |
| **P3 — RADIUS fail-closed** | `services/radius/factory.py`, `services/radius/freeradius_backend.py`, service activation guards | radius/* + 1 router | Fail-closed |
| **P4 — OLT fail-closed** | `services/install_board.py` activate paths, OLT driver invocation guards, permission for manual override | services/install_board + permission registry | Fail-closed |
| **P5 — Import engine fail-closed** | `routers/imports_exports.py` /start + /apply gating | imports_exports.py | Fail-closed |
| **P6 — Warehouse fail-closed** | Any warehouse-dependent workflow guarded; explicit "WAREHOUSE_DISABLED" failure mode | services/install_board (warehouse touches), routers/noc_inventory | Fail-closed |
| **P7 — GDPR pipeline minimum-viable** | NEW `models/privacy_request.py`, NEW `services/privacy.py`, NEW `routers/privacy.py`, `lifecycle.py:purge` actually NULLs PII | New files + 1 migration + lifecycle.py | Real PURGED + skeleton access/erasure |
| **P8 — Workflow assertion + S4 portal cookie + H7 schema + H9 anchor** | Boot assertion for dual-engine, portal HttpOnly cookie endpoints, Configuration schema validate hook, billing_anchor_day model + validator | `main.py`, `portal_auth.py`, `configurations.py`, `subscription.py`, `_billing_shared.py` | Mix |

All packs land in one merged alembic revision tree + one consolidated commit.

---

## Per-blocker remediation map

### F6 — settle_order race (real fix)
- **Root cause**: Two concurrent webhook callbacks both insert Payment for same payment_order_id before either sees the order.status flip.
- **Fix**: 
  1. New migration: UNIQUE INDEX on `payment.payment_order_id WHERE payment_order_id IS NOT NULL`. Pre-flight: COUNT duplicates → raise with cleanup instructions if any.
  2. `payment_gateway.settle_order`: lock PaymentOrder row first with `with_for_update()`, then check status (idempotent return if PAID), only then proceed to create Payment. The UNIQUE constraint catches any pre-existing duplicates.
- **Test**: Concurrent `settle_order` produces 1 Payment + 1 invoice.status=PAID. Existing test rewritten.
- **Migration**: yes, reversible.

### RADIUS — fail-closed
- **Root cause**: FreeRADIUS backend = NotImplementedError stubs; if `RADIUS_BACKEND_PROVIDER=freeradius` is set in prod, runtime call crashes.
- **Fix (fail-closed)**:
  1. `config.py` deploy contract: if `environment=production` AND `radius_required=true` AND `radius_backend_provider ∈ {mock, freeradius}` AND FreeRADIUS impl is stub → refuse boot.
  2. `services/radius/factory.py`: if RADIUS required+stub → raise `FeatureDisabledError` at construction.
  3. Anywhere service activation might call RADIUS in production: wrap call in `feature_gate.require_radius()`. On failure, emit audit Event `RADIUS_UNAVAILABLE_BLOCKED`, return 503 to client.
  4. Default `radius_required=false` in dev/test (preserves existing behavior).
- **Test**: prod-mock RADIUS boot refused; activation requiring RADIUS without provider → 503 + audit row.

### OLT provisioning — fail-closed
- **Root cause**: `install_board.activate_service` flips DB status without calling OLT driver.
- **Fix (fail-closed)**:
  1. New feature flag `olt_provisioning_required`. Default false in dev/test, true in prod.
  2. `activate_service`: if `olt_provisioning_required=true` and no OLT driver configured for the CPE's OLT → raise `FeatureDisabledError` + audit `OLT_PROVISIONING_BLOCKED`.
  3. Permission `service.bypass_provisioning`: super-admin only. If invoked, must include `reason` in payload + audit Event with reason.
  4. Production deploy contract: refuses boot if `olt_provisioning_required=true` + OLT driver registry empty.
- **Test**: prod activation w/o OLT → 503 + audit; with override + reason → succeeds with audit recording reason.

### Import engine — fail-closed
- **Root cause**: `/imports/{id}/start` flips status to IMPORTING with no actual ingestion.
- **Fix (fail-closed)**:
  1. New flag `import_engine_enabled` (default false).
  2. `/imports/{id}/validate` may stay as dry-run-only metadata (already is).
  3. `/imports/{id}/start`: if `import_engine_enabled=false` → 503 + audit `IMPORT_ENGINE_DISABLED_BLOCKED`.
  4. Production deploy contract: if env enables `import_engine_required=true` + no engine implementation → refuse boot.
- **Test**: prod start blocked + audit row; dev with flag=false also blocked.

### Warehouse — fail-closed
- **Root cause**: Warehouse subsystem doesn't exist; any workflow that semantically requires stock movement gets DB-row updates without real stock tracking.
- **Fix (fail-closed)**:
  1. New flag `warehouse_enabled` (default false).
  2. Identify the warehouse-dependent flows in code (asset transfers in `noc_inventory.move_asset`, install_board activation that "draws" parts, etc.).
  3. Where any workflow REQUIRES real stock movement: gate behind `feature_gate.require_warehouse()`. On fail: 503 + audit `WAREHOUSE_DISABLED_BLOCKED`.
  4. `noc_inventory.move_asset` keeps its existing single-row-patch behavior but emits an `INVENTORY_TRACKING_LIMITED` audit Event documenting the limitation (so SuperAdmin can see the gap).
- **Test**: workflow declared as warehouse-required is 503'd; move_asset works + emits limited-tracking note.

### GDPR pipeline (skeleton + real PURGED)
- **Root cause**: No PrivacyRequest model, no access export endpoint, no erasure endpoint, PURGED state is a column flip only.
- **Fix (minimum-viable real)**:
  1. New model `models/privacy_request.py` — Status enum: REQUESTED, APPROVED, REJECTED, COMPLETED. Includes requestor_id, request_type (ACCESS|ERASURE), tenant_id, customer_id, reason, approver_id, approved_at, completed_at, export_storage_key.
  2. New service `services/privacy.py`:
     - `build_access_export(s, customer_id)` — produces JSON dict of customer's records, invoices, payments, communications, RADIUS sessions, audit events. Tenant-scoped.
     - `anonymize_customer(s, customer_id)` — NULLs `customer_user.email`, `email`, `phone`, `address` fields on customer Record's data JSONB (preserves invoice totals + audit trail per GDPR Article 17 financial-retention exception).
  3. New router `routers/privacy.py`:
     - `POST /api/privacy/access-request` — creates PrivacyRequest, requires `privacy.request` permission.
     - `POST /api/privacy/erasure-request` — creates PrivacyRequest.
     - `POST /api/privacy/requests/{id}/approve` — admin approves; emits audit.
     - `POST /api/privacy/requests/{id}/complete` — runs the export builder or anonymization.
     - `GET /api/privacy/requests` — list (tenant-scoped + permission-gated).
     - `GET /api/privacy/requests/{id}/export` — download the export if it's an access request that's completed.
  4. `lifecycle.purge`: NOW CALLS `anonymize_customer` for customer-type entities. Other entity_keys keep the column-flip behavior with documented limitation.
  5. Permission registry: `privacy.request` (any authed user), `privacy.approve` (admin), `privacy.complete` (admin), `privacy.export.view` (admin).
- **Migration**: new `privacy_request` table with RLS + tenant_id + index, mirrors the standard tenant-scoped table pattern.
- **Test**: create access request → approve → complete → export contains customer-scope data, no cross-tenant leak. Create erasure → approve → complete → customer email is anonymized, invoice rows still intact.

### Workflow engine collapse (AC1) — assertion + tests
- **Root cause**: Two parallel workflow engines (`workflow.py` + `kernel/workflow_engine.py`).
- **Fix (defensive — not full collapse)**:
  1. Production boot-time assertion: scan `WorkflowDef` rows; for each (entity_key, from_status, to_status) tuple, assert that AT MOST ONE engine claims authority. If both engines fire for the same transition → log warning + emit `WORKFLOW_DUAL_ENGINE_OVERLAP` audit Event. (Not a refuse-boot — too risky for installed systems, but loudly visible.)
  2. Regression test suite: for the 5 most-common transitions, fire each engine's path + assert NO duplicate side effects (no double notification, no double automation invoke).
  3. Document in commit message + report that full collapse remains BLOCKED-multi-week-eng; this defensive layer prevents silent duplication.
- **Test**: dual-engine overlap detected at boot + audit emitted; sample transitions produce exactly 1 notification + 1 automation invocation.

### S4 — Portal HttpOnly cookie (product-decision safe default)
- **Root cause**: Portal token in `localStorage` enables XSS-to-token-exfiltration.
- **Fix (safe default)**:
  1. Add `/portal/auth/login-cookie` endpoint that sets HttpOnly + Secure + SameSite=Lax cookie with the JWT.
  2. Existing `/portal/auth/login` (returns JWT in body) stays available BUT production deploy contract requires `PORTAL_AUTH_MODE=cookie` (raises on boot if not set in prod).
  3. `current_customer` dep: accept token from cookie OR Authorization header (cookie wins in prod).
  4. `/portal/auth/logout` clears the cookie + sets tnbf.
  5. CSRF: cookie-mode requires CSRF token (double-submit pattern). New header `X-CSRF-Token` required on mutating requests.
- **Frontend**: `frontend-portal/src/lib/api.ts` — update to use cookie OR header; configurable.
- **Test**: cookie HttpOnly flag set; logout clears; CSRF rejected without token.

### H7 — Configuration JSONB schema validation
- **Fix (safe default)**:
  1. Define a registry `CONFIG_SCHEMAS: dict[str, dict]` keyed on configuration_key. Schema per key declares required keys + types.
  2. `configurations.create_configuration` + `update_configuration`: validate `configurationValue` against `CONFIG_SCHEMAS.get(key)`. If schema exists and validation fails → 422.
  3. For configuration_keys with NO schema registered: log warning `CONFIG_SCHEMALESS_WRITE` (loud), permit write (backward compat) — but production deploy contract refuses to boot if `config_schema_strict=true` and any configuration_key with `tenant_critical=true` lacks a schema.
- **Test**: invalid config rejected; missing schema warning logged.

### H9 — Subscription billing_anchor_day policy
- **Fix (safe default)**:
  1. Add `Subscription.billing_anchor_day: int | None` column (migration).
  2. On subscription create: derive from `started_at.day` (max 28 to avoid month-end). Or accept from payload, validated `1 <= day <= 28`.
  3. `_add_cycle` uses `billing_anchor_day` if set, else `started_at.day`, clamped to `min(anchor, last_day_of_target_month)`. Documented behavior: anchor 29-31 always means "last day of month".
  4. Validate on PATCH: reject `billing_anchor_day > 28` (force "last day of month" via sentinel value 0).
- **Migration**: add column nullable + backfill from existing subscription.started_at + index.
- **Test**: Feb 29 anchor → Feb 28 + back to Feb 29 next year. 31 → last-day each month.

---

## Test fixes (2)

### Test 1: F6 settle_order serialization
- Rewrite: the existing test's two coroutines need independent sessions (not the same session). Use `asyncio.gather` with `async with AsyncSessionLocal() as s` per coroutine.
- After fix: assert exactly 1 Payment row + invoice.status=PAID + UNIQUE constraint enforces.

### Test 2: Dunning FK fixture
- Test creates `dunning_case.account_id=17715c15-...` but no Account exists. Fix: create the Account in the fixture before the dunning_case row.

---

## Migrations (consolidated into 2 revisions)

1. **`f8c5b1e9a3d2_remediation_stage_2_2026_06_04.py`**:
   - `payment.payment_order_id` UNIQUE INDEX (partial WHERE NOT NULL)
   - `subscription.billing_anchor_day` Integer NULL (backfill from started_at.day)
2. **`a2c4d6e8b1f3_privacy_request_table_2026_06_04.py`**:
   - New `privacy_request` table with RLS + tenant_id

Both reversible. Pre-flight checks before tightening operations.

---

## Validation commands

After all packs land:
- `alembic upgrade head` + `alembic current`
- `pytest tests/test_remediation_*.py` — must all pass (target: 50/50 + new tests)
- `pytest tests/test_privacy*.py tests/test_feature_gate*.py` — new packs' tests
- `pytest tests/ -k "auth or billing or stripe or workflow"` — regression
- `bash -n scripts/*.sh`
- `docker compose config`

---

## Risk discipline

Every preserved foundation listed in the prompt header is verified untouched. Each pack returns a "## Preserved foundations confirmed" section listing the specific files it touched and confirming no regression.

---

## Verdict target

After this pass:
- **CONDITIONAL GO CANDIDATE** if all 6 Criticals close (5 fail-closed + 1 real F6) + 2 test failures fixed + 3 product decisions resolved + tests pass
- If any unsafe stub still masquerades as production → stays NO-GO

End of plan. Execution begins.
