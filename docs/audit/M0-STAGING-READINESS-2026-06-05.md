# M0 Staging Readiness — Go/No-Go Report

**Date:** 2026-06-05
**Branch:** `main` (head: `b977db8` test-suite-green commit)
**Scope:** Phase 0 / M0 ship — the platform's killer-test thesis: *stand up a 2nd entity from configuration alone*.

---

## VERDICT: GO (with one watch-item)

The platform is in a state where a 2nd entity can be stood up from configuration alone, every kernel engine behaves correctly, and the regression net (pytest + drift checker + killer test) is green. One watch-item — manual frontend verification — needs eyes during the actual staging smoke; it can't be fully proven from CI alone.

| Gate | Status | Evidence |
|---|---|---|
| Pytest full suite | ✅ green | 1768/0/0 (0 failed, 0 errors) — 6 min |
| Drift checker | ✅ green | 11 HARD + 8 RATCHET pass |
| M0 killer test | ✅ in CI | `test_api.py::test_m0_killer_2nd_entity_config_only` — passes; collected by `pytest --tb=short -q` |
| Deploy contract | ✅ enforced | `_assert_production_deploy_contract()` runs in `lifespan` (`main.py:66`) |
| Backend tsc | ✅ clean | frontend `tsc --noEmit` exit 0 |

---

## 1. Remaining architecture findings

Two of 107 senior-architect findings remain open. Both are **non-blocking for M0 staging**.

### T-P3-9 — Layout one-offs → Stack/Inline/Grid

**Why open:** ~1,100 inline `style={{ display: 'flex', gap: N, … }}` blocks could be replaced by `<Stack>/<Inline>/<Grid>`, but the Stack gap scale (xs/sm/md/lg/xl = 4/8/16/24/32px) doesn't align to common inline gap values (6/10/12/14/20px). Mass migration would either change visual rhythm or require Stack to grow a numeric `gap` prop — both need design input.

**M0 impact:** None. Inline styles render identically to primitives; this is pure consolidation. Drift checker prevents new instances.

**Classification:** **NON-BLOCKING.** Per-PR migration as files are touched.

### T-P2-4 — `<ConversationRow>` primitive

**Why open:** Audit asked for a conversation-row primitive harvested from 3 views, but on inspection only `MessagesView` and `HelpdeskView` match the shape (n=2), and they render rows differently (compact inbox vs. wide thread). Building a primitive over n=2 sites with different requirements is over-engineering.

**M0 impact:** None. Both views render correctly today.

**Classification:** **NON-BLOCKING — scope-flagged.** Revisit when a 3rd conversation surface lands.

---

## 2. Staging deployment checklist

### Database migrations
- ✅ **111 Alembic migrations** in `backend/alembic/versions/`. Run `alembic upgrade head` before app boot.
- ✅ **RLS policies** present on every tenant-scoped table — 209 `CREATE POLICY tenant_isolation` lines across migration history.
- ✅ **Append-only audit triggers** installed by migration `b70ef3b98e27_kernel_invariants_db_triggers_region_id.py` (Event UPDATE + DELETE both `RAISE EXCEPTION`). Verified empirically — the cross-tenant teardown helper had to skip the `event` / `audit_log` tables because the trigger fires regardless of role (including owner).

### Environment variables (production)
Required for the deploy contract to pass (`backend/app/config.py:_assert_production_deploy_contract`):

```bash
ENVIRONMENT=production
DATABASE_URL=postgresql+asyncpg://gaahex_app:<pwd>@<host>:5432/gaahex
OWNER_DATABASE_URL=postgresql+asyncpg://gaahex:<pwd>@<host>:5432/gaahex
CORS_ORIGINS=https://app.example.com[,https://second.example.com]
PORTAL_AUTH_MODE=cookie    # or 'both' during migration window
REQUIRE_STRONG_SECRETS=true
JWT_SECRET=<32+ byte random string>
PAYMENT_GATEWAY_PROVIDER=stripe       # or 'logging'; NOT 'mock'
EMAIL_GATEWAY_PROVIDER=sendgrid       # NOT 'mock'
SMS_GATEWAY_PROVIDER=twilio           # NOT 'mock'
RADIUS_BACKEND_PROVIDER=freeradius    # NOT 'mock'
GAAHEX_FIELD_KEY=<32 byte base64 key> # field-level encryption
```

Optional (feature flags — keep OFF for M0):
- `FEATURE_RADIUS_REQUIRED=false`  (M0 demo doesn't drive a BNG)
- `FEATURE_OLT_PROVISIONING_REQUIRED=false`
- `FEATURE_IMPORT_ENGINE_ENABLED=false`  (engine not shipped)
- `FEATURE_WAREHOUSE_ENABLED=false`

### Production contract gates
The contract refuses to boot when ANY of these is violated (`config.py:162-346`):

| Gate | Rule | Status |
|---|---|---|
| Role split | `DATABASE_URL` ≠ `OWNER_DATABASE_URL` AND username differs | ✅ enforced |
| CORS | No wildcard `*` in `CORS_ORIGINS` | ✅ enforced |
| Mock providers | None of payment/email/sms/radius `= 'mock'` | ✅ enforced |
| Portal auth | `PORTAL_AUTH_MODE ∈ {cookie, both}` (not `header`) | ✅ enforced |
| Feature consistency | If feature flag ON, real backend must construct | ✅ enforced |

### Portal auth mode
- ✅ Cookie + CSRF wiring landed (`frontend-portal/src/lib/api.ts` sends `credentials: 'include'` + echoes `X-CSRF-Token` on mutations).
- ✅ Backend supports `cookie`, `both`, and dev-only `header`.
- ⚠️ **Set `PORTAL_AUTH_MODE=cookie` in staging.** `both` is for the customer-migration window only.

### CORS settings
- ✅ Production contract refuses `*`.
- ⚠️ **Set explicit comma-separated origins** in staging — staging gets its own URL, never reuse dev's `*`.

### Mock-provider posture
- ✅ Default (`mock`) is correct for dev/test/CI.
- ⚠️ **Staging must set real providers** — even if they're staging-tier (Stripe test key, SendGrid sandbox, Twilio test number). Mock in staging would silently mark every charge "successful" and drop every email, which makes staging worse than a fake.

### RBAC seed integrity
- ✅ `apply_test_seeds()` shared between `main.py:lifespan` (prod boot) and `conftest.py` (tests) — single source of truth, can't drift.
- ✅ `seed_spec_roles_if_missing()` ensures all SPEC §4.3 roles present (idempotent).
- ✅ Demo users seeded: `admin@demo.isp / admin123` (super_admin) and `agent@demo.isp / agent123` (limited scope).
- ⚠️ **Rotate `admin123` / `agent123` in staging.** Default passwords are dev-only.

### Audit/event append-only behavior
- ✅ DB triggers in migration `b70ef3b98e27` raise `RestrictViolationError` on UPDATE/DELETE against `event` and `audit_log` for **every role including the table owner**. Verified empirically — the `delete_tenant_cleanly()` helper had to be updated to SKIP these tables.

### Tenant isolation
- ✅ Every tenant-scoped table carries `RLS tenant_isolation NULLIF-guarded` policy (D1 doctrine).
- ✅ App runs as `gaahex_app` (NOSUPERUSER NOBYPASSRLS); migrations run as `gaahex` (owner). RLS engages for every app query.
- ✅ Per-request `gaahex.tenant_id` GUC bound by `routers/auth.py::current_user` against the JWT `tenant` claim.
- ✅ CI `backend-rls` job re-runs the RLS subset under the `gaahex_app` role — proves NOSUPERUSER login + GRANTs are sufficient.

### M0 killer test coverage in CI
- ✅ `test_api.py::test_m0_killer_2nd_entity_config_only` — runs every CI invocation (collected by `pytest --tb=short -q`).
- ✅ Exercises all 5 kernel engines (security/entity-def/authz/database/workflow/audit) through a brand-new entity that lives ONLY in config.

---

## 3. Manual M0 flow verification plan

This is the **eyes-on verification** the killer test can't fully replace — CI proves the API surface; staging proves the wired UI. Run as `admin@demo.isp` (or staging-rotated equivalent).

| Step | Action | Expected | Evidence to capture |
|---|---|---|---|
| 1. Studio opens | Navigate to Studio shell | Sidebar tree loads with Entities/Notifications/Webhooks/etc | screenshot of studio root |
| 2. Create config-driven entity | EntitiesPane → "New entity" → name="SLA", key=`sla_demo`, slug=`sla-demos`, 3 fields (`name` required text · `target` number · `status`), 3 statuses (`DRAFT` initial → `ACTIVE` → `RETIRED`), 2 transitions | 201 returned; success toast; modal closes | network 201 + DB row in `entity_def` |
| 3. Entity appears in nav | Reload sidebar (or auto-refresh) | "SLA demos" entry appears under **Admin Panel → Records** | screenshot of nav showing new entity |
| 4. Create record | Open SLA-demos view → "New" → fill name="P1 Outage" + target=`250` | Record created, listed; status=`DRAFT` (from `is_initial`); auto-generated reference number | screenshot of list with new record |
| 5. Read record | Click the row → detail panel/drawer | All field values display correctly | screenshot of detail view |
| 6. Update record | Edit `target` → save | PATCH 200; new value displays; status still `DRAFT` (no silent transition) | network log + screenshot |
| 7. Transition record | Status action → `ACTIVE` | Status pill updates; transition rejected if undeclared (e.g. `DRAFT → RETIRED`) | screenshot before/after |
| 8. Audit trail | Detail → "Audit" tab (canonical 9-tab spec) | At least 3 events: `CREATE`, `UPDATE`, `TRANSITION`. Each has actor, timestamp, payload. | screenshot of audit list |
| 9. RBAC gating | Logout → login as `agent@demo.isp` (no `sla_demo.*` grants) → try the entity | Either entity hidden from nav, or 403 on direct URL | screenshot of denial |
| 10. Tenant isolation | (Requires 2nd tenant.) Confirm the SLA records DON'T appear when logged in as a different tenant's admin | List empty for the 2nd tenant; direct GET → 404 | screenshot or log |
| 11. Page reload persistence | Hard reload (Ctrl-F5) the entity list | Entity + records still there (came from DB, not in-memory) | screenshot post-reload |
| 12. No hardcoded assumptions | Inspect: nav uses `route_slug`, list/detail come from `/api/{slug}`, no `if slug === 'sla_demo'` anywhere | All routing is generic | confirm via DevTools network panel |

**Failure threshold:** If any of steps 4–8 (the platform thesis itself) fails, declare NO-GO and roll back. Steps 1–3 and 9–12 are equally important but failures there are typically configuration issues, not thesis breaks.

---

## 4. GO/NO-GO REPORT

### Verdict: **GO**

### Conditions:
1. **Staging boot succeeds with the env-var matrix above.** If the deploy contract refuses to boot, the missing env var IS the blocker — set it and retry.
2. **Manual flow steps 1–12 above all pass.** Items 4–8 are the M0 thesis; items 1–3 and 9–12 are environmental.

### Current blockers: **NONE**

### Risks (watch but don't block):

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Manual UI flow steps reveal a surprise | Low (CI killer test covers the API surface) | Medium — postpones the manual smoke | Item-by-item triage; the killer test will keep working while UI is fixed |
| Real provider creds (Stripe/SendGrid/Twilio) misconfigured | Medium | High — the deploy contract refuses to boot but doesn't tell you the cred is wrong, only that the provider isn't `mock` | Provider-by-provider smoke before flipping `ENVIRONMENT=production` |
| Test-DB pollution caveat carries to staging? | Low — staging uses real Postgres, not the conftest auto-drop | Low | Standard alembic migration path |
| 2 architecture findings re-prioritize | Very low | Negligible | Both documented, neither blocks user flow |

### Verification evidence checklist:

Provide these in the staging report after the smoke runs:

- [ ] **CI run URL** showing the most recent green build (Pytest 1768/0/0 + drift checker green + frontend tsc clean).
- [ ] **Boot log** from staging showing the deploy contract passed (no `RuntimeError` from `_assert_production_deploy_contract`).
- [ ] **`alembic current` output** from staging matching latest migration head.
- [ ] **Screenshot pack** covering manual flow steps 1–12 above.
- [ ] **Network log export** (HAR) covering step 2 (POST /meta/entities) and step 4 (POST /api/sla-demos) — proves config-only creation.
- [ ] **DB query result** from staging showing the auto-generated permissions: `SELECT key FROM permission_def WHERE key LIKE 'sla_demo.%'` — should return 4 rows.
- [ ] **Audit query result**: `SELECT type, entity_key, created_at FROM event WHERE entity_key='sla_demo' ORDER BY created_at` — should show CREATE + UPDATE + TRANSITION rows in order.

### Rollback plan:

If the smoke fails after deployment:

1. **Application-only failure** (UI bug, transient API failure, config-driven entity stuck): keep the binary, fix forward in dev → re-deploy. The audit trail is append-only and the data is intact.
2. **Migration failure mid-run**: `alembic downgrade -1` to the previous head. Stop the FastAPI process before reverting the binary. Tenant data stays intact (every migration is reversible per project convention).
3. **Catastrophic data corruption** (theoretical): restore from the staging snapshot taken immediately before deploy (CI/infra responsibility, document the snapshot id in the deploy ticket).
4. **No-go on the thesis itself** (creating an entity doesn't render correctly): file a P0, revert frontend container to last good tag, document the breaking commit hash for forensic.

The killer test in CI is the canary: if any future PR breaks M0, the CI run **will fail before the merge**, not after. Phase 0 thesis stays protected automatically.

---

## Sign-off

This report says GO because:

- ✅ Every gate measurable in CI is **green**.
- ✅ The killer test proves the thesis end-to-end against the live test DB.
- ✅ The production deploy contract refuses to boot a misconfigured env.
- ✅ The append-only audit + RLS isolation are enforced **at the DB layer** (not just in code that someone could bypass).
- ⚠️ The single remaining unknown is the **frontend smoke** — but the frontend builds clean, mounts the studio entity creator + the dynamic entity view, and the killer test confirms the API contract those views consume.

If staging smoke (steps 1–12) passes, M0 is ready to ship.

— Ընգեր, 2026-06-05
