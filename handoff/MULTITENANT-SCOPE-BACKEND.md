# Multi-Tenant Scope Catalog — Backend Refactor

**Status:** Complete inventory of all multi-tenant code in backend  
**Date:** 2026-05-30  
**Objective:** Precise scope catalog for safe deletion of multi-tenancy (single-tenant only transition)

---

## 1. Tenant Model & CRUD

### Core Model
- **File:** pp/models/tenant.py:11-24
  - **Table:** 	enant (primary key: id UUID)
  - **Columns:** name, status, currency, locale, logo_text, onboarded_at, created_at
  - **Key comment:** "The hard isolation boundary: one ISP company or group."

### Tenant Settings Routes
- **File:** pp/routers/tenant_settings.py:1-105
  - **Endpoints:**
    - GET /api/tenant/settings — Read tenant profile
    - PUT /api/tenant/settings — Update name/currency/locale/logo_text
    - POST /api/tenant/onboarded — Mark onboarding complete
  - **Gate:** tenant.settings permission
  - **All reads filtered by:** user.tenant_id

### Tenant Provisioning (Admin-Only)
- **File:** pp/routers/admin.py:34-67
  - **Endpoint:** POST /api/admin/tenants — Provision new tenant
  - **Gate:** Caller must have config.manage capability (super_admin)
- **File:** pp/provisioning.py:27-88
  - **Creates:** Tenant → org tree → first admin → baseline config
  - **Runs on:** OWNER session (RLS-bypass)

---

## 2. Tenant_id Columns — Complete Inventory

**Total models with tenant_id:** 38 of 40 SQLAlchemy models

**Models with NON-NULLABLE tenant_id (37 tables):**
access.py (permission_def, role_def, assignment), apikey.py, approval.py, automation.py, billing.py (subscription, invoice, payment_order, job_run), calendar.py (user_calendar, calendar_event), comm.py (thread, message), customer_user.py, dashboard.py (dashboard_def, widget_def), event.py, helpdesk.py (helpdesk_ticket, helpdesk_queue), interaction.py, job.py, meta.py (entity_def, field_def, status_def, workflow_def, relation_def), notification.py, notification_pref.py, order.py (order, order_line), orgnode.py, page_config.py, page_field_value.py, party.py (party, account), payment_gateway.py, portal_ticket_reply.py, product.py, record.py, report.py, report_schedule.py, respool.py (resource_pool, pool_member), saved_view.py, search_history.py, service.py (service, service_interval), usage.py, user.py, webhook.py (webhook, webhook_event), workitem.py, refresh_token.py

**Model with NULLABLE tenant_id (global):**
translation.py (tenant_id NULL = global i18n defaults; tenant_id set = per-tenant overrides)

---

## 3. Current_tenant / Tenant Injection

### JWT Token Claim
- **File:** app/security.py:20-29 — create_access_token(subject, extra)
- **Staff token claims:** sub=user_id, tenant=tenant_id, email, iat, exp
- **Portal token claims:** sub=customer_user_id, kind="customer", customer_id, tenant_id

### Current User Dependency (Staff)
- **File:** app/routers/auth.py:138-174
  - Resolves User via OWNER session (no RLS yet)
  - Sets RLS: await set_tenant_guc(s, user.tenant_id)
  - Rejects portal tokens: if kind="customer": 401
  - Auth paths: Bearer JWT OR X-API-Key header

### Current Customer Dependency (Portal)
- **File:** app/routers/portal_auth.py:113-149
  - Resolves CustomerUser via OWNER session
  - Requires: kind="customer" claim
  - Defense-in-depth: Asserts cu.tenant_id == token_tenant_id (S4)
  - Sets RLS: await set_tenant_guc(s, tenant_id)

### Tenant GUC Binding
- **File:** app/db.py:32-50
  - **GUC variable:** gaaex.tenant_id
  - **Setter:** async def set_tenant_guc(session, tenant_id)
    - Uses SET LOCAL session-wide (survives mid-request commits)
    - No-op if tenant_id is None
    - Cleared on session teardown to NULL (fail-safe)

### Multi-Tenant Portal Safety (S5 — B38 Hardening)
- **File:** app/routers/portal_auth.py:52-72
  - If no tenant_id hint → pick the FIRST tenant IFF exactly ONE active tenant
  - **S5 Guard:** if multiple active tenants exist, force caller to supply tenant_id
  - **Enforcement:** if len(active_tenants) > 1: raise 400 "tenant_id required"

---

## 4. JWT Tenant Claim Encoding

### Staff Token Generation
- **File:** app/routers/auth.py:83
  - Encoded at login and refresh with tenant_id
  - Payload: create_access_token(str(user.id), {"tenant": str(user.tenant_id), "email": user.email})

### Portal Token Generation
- **File:** app/routers/portal_auth.py:96-100
  - create_access_token(str(cu.id), {"kind": "customer", "customer_id": str(cu.customer_id), "tenant_id": str(cu.tenant_id)})
  - Portal-specific kind: "customer" marker

### Token Verification
- **File:** app/security.py:32-33
  - Standard JWT decode; expiry verified automatically

---

## 5. Multi-Tenant Safety Hardening (B38 Explicit Guards)

### Portal Multi-Tenant Check (S5)
- **File:** app/routers/portal_auth.py:64-72
  - When no tenant_id hint: reject if multiple active tenants exist
  - Code: if len(active_tenants) > 1: raise HTTPException(400, "tenant_id required")

### Scheduler Cross-Tenant Loop (E25)
- **File:** app/scheduler.py:99-185
  - Runs on OWNER session (RLS-bypass)
  - Iterates all active tenants, resolves system actor per tenant
  - Each job gets fresh owner session per tenant
  - Fail-soft: one tenant/job failure never blocks others

---

## 6. Row-Level Security (RLS) Policies

### Primary RLS Migration
- **File:** alembic/versions/3a9203795d07_enable_rls_tenant_isolation.py
  - **Revision ID:** 3a9203795d07
  - **Date:** 2026-05-26 11:00:11
  - **Tables affected:** 34 tables
  - **RLS engine:** PostgreSQL gaaex_app role (NOSUPERUSER NOBYPASSRLS)
  - **Policy pattern:** CREATE POLICY tenant_isolation ON table USING (key = NULLIF(current_setting('gaaex.tenant_id', true), '')::uuid)
  - **Two-engine architecture:**
    1. OWNER engine (OwnerSessionLocal): RLS-bypass role (superuser)
    2. APP engine (SessionLocal): Will enforce RLS when gaaex_app role is used in production

### Secondary RLS: Post-Migration Tables (13 additional migrations)
Tables created AFTER the primary RLS migration inherit via ALTER DEFAULT PRIVILEGES. Explicit policy additions in:
- 4f162718a0be (thread, message — B28)
- 18062d97ef59 (order, order_line — 17a)
- 3aaf9ce9edeb (party, account — 17a)
- 618f5b791c26 (subscription, invoice, payment_order, job_run — B33)
- 5dbf421773ca (usage tables — B32)
- 71c6d6acef90 (product/catalog — B32)
- 6e5dbe4b40a8 (service/interaction — B32)
- a4f8e2d1c9b7f3e0 (user_calendar, calendar_event — A30)
- a3d7e9f1b2c4 (page_field_value — A32)
- a1f4c8e23d709b52 (workitem — B32)
- b1c768523e3e (webhook, webhook_event — B33)
- 7f342faffc15 (api_key)
- 642fa959d432 (notification_pref — added because table created AFTER enable-RLS but policy was forgotten)
- c1a2b3d4e5f6 (customer_user — B34)

**Total:** 1 primary engine migration + 13 secondary table-specific/batch migrations

---

## 7. Customer Portal vs. Tenant (SEPARATE CONCERN CONFIRMED)

### Customer User Model
- **File:** app/models/customer_user.py:17-33
- **Columns:**
  - tenant_id (FK tenant.id) — which ISP owns this customer account
  - customer_id (FK record.id) — which Customer record (entity) this login belongs to
  - email, password_hash, name, is_active, created_at, last_login_at
- **Uniqueness constraint:** (tenant_id, email)

### Confirmation: SEPARATE from Tenant
- **Tenant boundary:** ISP company (multi-tenant isolation)
- **Customer boundary:** Customer Record entity within an ISP's CRM
- **Customer Portal token:** Includes kind="customer", customer_id, AND tenant_id
- **Staff routes:** Reject customer tokens
- **Portal routes:** Require customer tokens
- **RLS scope:** Customer portal queries still filter by tenant_id GUC (the ISP boundary), PLUS additional customer-specific filtering

**CRITICAL FINDING:** Customer portal is the customer↔staff split WITHIN a tenant, NOT a second layer of multi-tenancy. Removing tenant entirely WILL break customer portal scoping if confused.

---

## 8. Seed Data & Demo Tenant

### Seed Entry Point
- **File:** app/main.py:39-47 (Lifespan hook)
  - await seed_if_empty() — Creates demo tenant + org tree + admin user
  - await seed_meta_if_empty() — CRM entities
  - await seed_access_if_empty() — Permissions + roles
  - await seed_portal_if_empty() — Demo customer portal user

### Tenant Creation
- **File:** app/seed.py:13-38
  - tenant = Tenant(name="Demo ISP")
  - Demo tenant UUID: Generated dynamically via uuid.uuid4() — NO hardcoded UUID in seed code

### Demo Users
- **Admin:** admin@demo.isp / admin123
- **Agent:** agent@demo.isp / agent123
- **Portal:** portal@demo.isp / portal123

### Seed Idempotency
Each function checks count before seeding (only runs if database is empty).

---

## 9. Queries Filtering by Tenant_id

### Query Count
- **Routers:** 139 occurrences of .where(...tenant_id / filter_by(tenant_id=...) patterns across 42 router files
- **Pattern:** Almost all staff queries follow ...where(Table.tenant_id == user.tenant_id)

### Coverage
- Tenant settings, calendar, billing, records, portal auth, access, etc. — all tenant-scoped queries filter explicitly

---

## 10. Cross-Tenant Primitives & Global Access

### System/Scheduler (OWNER Session)
- **File:** app/scheduler.py:99-185
  - Runs on OwnerSessionLocal (RLS-bypass)
  - Executes batch jobs for ALL active tenants in sequence
  - Query all Tenants, resolve each tenant's system actor, dispatch jobs with fresh owner session per tenant

### Provisioning (Admin-Only, OWNER Session)
- **File:** app/provisioning.py + app/routers/admin.py
  - Runs on get_owner_session() (RLS-bypass)
  - Gate: Caller must have config.manage
  - Creates new tenant + config in one transaction

### Translation (Global Defaults + Tenant Overrides)
- **File:** app/models/translation.py:23 + app/routers/i18n.py
  - Global: tenant_id IS NULL
  - Tenant override: tenant_id = <some_tenant>
  - Read merge: SELECT ... WHERE tenant_id IS NULL OR tenant_id == user.tenant_id

### No "super_user sees all tenants" feature
- Staff tokens carry tenant: tenant_id (always single-tenant in token)
- Scheduler is the only cross-tenant reader (privileged OWNER role)
- Admin provisioning gate: Existing super_admin can create new tenants, but cannot query them as staff (must log in as new tenant's admin)

---

## Single-Tenant Refactor Approaches

### Option A: Keep tenant_id Columns, Hardcode Single Value

**Approach:**
- Define THE_TENANT_ID = UUID(...) constant
- Remove /api/tenants and /api/admin/tenants endpoints
- Remove tenant provisioning flow
- Update seed to hardcode tenant_id
- Update portal_auth to always use THE_TENANT_ID
- Leave RLS policies in place

**Blast Radius:** Minimal
- Changes: ~5 routes + seed + config constant
- Queries still work: WHERE tenant_id = THE_TENANT_ID
- RLS still works: Policies filter the single tenant
- No migration cost: tenant_id columns can stay
- Customer portal still works: Filters by tenant_id + customer_id

**Risks:** Low
- Conceptual overhead (vestigial columns)
- Accidental cross-tenant queries possible (RLS catches them)

**Safety rating:** ⭐⭐⭐⭐ (Very safe; RLS is a safety net)

---

### Option B: Drop tenant_id Columns Entirely

**Approach:**
- Remove tenant_id from all 38 models
- Remove tenant_isolation RLS policies from all 34+ tables
- Remove set_tenant_guc() calls
- Drop Tenant table (or keep as metadata-only)
- Remove provisioning + portal_auth multi-tenant logic
- Update seed to NOT create tenant rows
- Update 140+ query sites to remove WHERE tenant_id = ...

**Blast Radius:** Large
- 38 tables need alembic migrations (drop column + FK + RLS policy)
- 140+ query sites need updates
- RLS removal: lose database-level isolation guarantee
- Customer portal risk: If customer scoping is confused with tenant scoping, accidental customer data leaks

**Risks:** High
- **CRITICAL:** If developer mistakes "remove tenant scoping" with "remove customer scoping", customer portal data leaks (portal user sees ALL customers in system, not just their own Record)
- Hard to verify all query sites were updated correctly (no RLS safety net)
- Harder to rollback (dropped columns require migration reversal + data reconstruction)

**Safety rating:** ⭐⭐ (Risky; requires careful verification that no customer records leak; RLS safety net is gone)

---

## RECOMMENDATION: Option A is SAFER

**Rationale:**
1. **Backward compatibility:** tenant_id columns are harmless if hardcoded
2. **RLS as safety net:** Policies still work; mistakes caught at DB layer
3. **Customer portal safety:** tenant_id scoping is SEPARATE from customer_id scoping; keeping tenant_id ensures accidental customer-boundary violations are RLS-blocked
4. **Migration complexity:** Option B requires changes to 140+ query sites + RLS drops; Option A requires changes to ~5 routes + seed
5. **Reversibility:** Option A is easily reverted; Option B would require re-adding columns + policies

**Implementation Path (Option A):**
1. Define SINGLE_TENANT_ID constant (env var or config)
2. Remove /api/admin/tenants + /api/tenant/* endpoints (or keep read-only)
3. Remove provisioning.py + admin provisioning flow
4. Update seed to hardcode Tenant(id=SINGLE_TENANT_ID, name=...)
5. Update portal_auth to always return SINGLE_TENANT_ID
6. Leave all queries, RLS policies, and columns as-is
7. Test: verify portal customer scoping still works + no accidental customer leaks

---

## Files Involved in Removal (Option A — Routes & Provisioning)

**Routes to remove/disable:**
- app/routers/admin.py — DELETE
- app/routers/tenant_settings.py — DELETE (or keep settings read-only, gate updates)
- app/provisioning.py — DELETE

**Seed to update:**
- app/seed.py:13-38 — Change to Tenant(id=SINGLE_TENANT_ID, name=...)

**Config/Constants to add:**
- app/config.py — Add SINGLE_TENANT_ID

**Main routes registration to update:**
- app/main.py:123-124 — Remove admin + tenant_settings router includes

**No alembic migrations needed:** Data stays as-is; just migrate one tenant's UUID to SINGLE_TENANT_ID if demo DB has multi-tenant schema

---

## Conclusion

**Multi-tenant scope is WELL-CONTAINED:**
- Clear tenant model + FK relationships (38 tables)
- RLS as second-layer defense (34+ tables with policies)
- Portal tenant scoping is SEPARATE from customer scoping (confirmed)
- Provisioning flow is isolated (admin.py, provisioning.py, one seed function)
- Cross-tenant reads only in scheduler + provisioning (both privileged, OWNER session)

**Option A (keep columns, hardcode value) is significantly safer:**
- RLS remains as safety net against accidental customer-boundary violations
- Minimal code changes (5 routes + seed + config)
- No risk of accidentally removing customer portal isolation
- Easier to verify correctness (RLS blocks mistakes)
- Reversible without schema migration
