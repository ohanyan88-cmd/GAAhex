# GAAhex — Production Remediation Plan

**Source audit**: `docs/audit/PRODUCTION-CERT-2026-06-04.md` (commit `1b03a78`)
**Plan author**: Lead Production Remediation Engineer (Orchestrator + 8-agent crew)
**Date**: 2026-06-04
**Mode**: Code + migrations + docs + tests; real-world layer (load test, restore drill, pen-test, GDPR audit) explicitly OUT OF SCOPE

---

## Scope reality

The certification found **27 Critical + 32 High + 33 Medium + 6 Low** findings. Closing every Critical at the rigor Gev's prompt requires (root cause, tests, evidence) is a multi-week senior-team engagement. This plan:

- **Aggressively closes** the 15-18 Criticals that are 1-file → 1-week-eng scope
- **Documents as BLOCKED** the ~9 Criticals that are multi-week / multi-person / external-dependency scope, with concrete unblock paths
- **Treats Highs opportunistically** in the same code areas while we're there
- **Preserves** all foundations the audit cleared (D6 RLS, append-only triggers, deploy contract, Fernet, fail-soft, Dockerfile)

After this remediation pass: verdict **remains NO-GO** because some Criticals stay open (RADIUS wiring, OLT wiring, import engine, warehouse subsystem, full GDPR pipeline, workflow engine collapse). But risk score should drop 78 → ~55 and readiness 28 → ~50. Path to CONDITIONAL GO becomes finite and trackable.

---

## Categorization legend

- **CLOSE THIS SESSION** — work is 1-file or 1-week-eng equivalent; will be executed by a parallel agent
- **BLOCKED-multi-week-eng** — fix requires 1-4 weeks of focused work (architectural collapse, full subsystem, multi-table data engineering)
- **BLOCKED-product-decision** — needs Gev or stakeholder decision before code can be written
- **BLOCKED-external-dependency** — requires real RADIUS/OLT hardware, real legal counsel, real load gen, real pen-test team

---

## Findings inventory — what closes, what doesn't

### Financial integrity (D7/D8 Critical)

| # | Finding | Files | Migration? | Status | Why |
|---|---|---|---|---|---|
| F1 | Stripe webhook lacks currency validation | `services/payments/stripe_events.py:148` | N | CLOSE THIS SESSION | 1-line guard + test |
| F2 | Stripe webhook lacks amount-vs-outstanding | `services/payments/stripe_events.py:148` | N | CLOSE THIS SESSION | 1-block guard + test |
| F3 | Auto-PAID flip ignores refunded_amount | `billing_payment.py:171`, `stripe_events.py:173`, `payment_gateway.py:275` | N | CLOSE THIS SESSION | 3-site SUM rewrite |
| F4 | mint_new_version race + missing partial unique | `services/product_versions.py:97-128` | Y | CLOSE THIS SESSION | 1 migration + lock |
| F5 | CN COUNT+1 race | `routers/credit_notes.py:74`, `imports_exports.py:106/115` | N | CLOSE THIS SESSION | switch to `next_reference_number` |
| F6 | credit_note + payment_allocation DELETE triggers missing | (DB triggers) | Y | CLOSE THIS SESSION | 1 migration mirroring `prevent_delete_invoice` |
| F7 | settle_order race | `payment_gateway.py:253-296` | N | CLOSE THIS SESSION | add `with_for_update()` |
| F8 | allocate_payment race | `services/payment_allocation.py:76-148` | N | CLOSE THIS SESSION | add `with_for_update()` + check trigger |
| F9 | usage float math | `routers/usage.py:40,110`, `models/usage.py:30` | N | CLOSE THIS SESSION | Decimal coercion |

### Security (D4 Critical)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| S1 | Webhook mock-fallback in production | `config.py:135`, `services/payments/factory.py`, `services/comms/factory.py` | N | CLOSE THIS SESSION |
| S2 | Deactivated user can log in + refresh | `routers/auth.py:82-131` | N | CLOSE THIS SESSION |
| S3 | Portal HTML XSS | `routers/portal_billing.py:145-176, 276-289` | N | CLOSE THIS SESSION |
| S4 | Portal token in localStorage | `frontend-portal/src/lib/api.ts:2-13` | N | BLOCKED-product-decision (HttpOnly cookie migration affects API contract — needs decision; document mitigation via XSS fix + CSP) |
| S5 | Public /org-tree leaks tenants | `main.py:307-330` | N | CLOSE THIS SESSION |
| S6 | Password change doesn't revoke refresh tokens | `routers/me.py:79-98` | N | CLOSE THIS SESSION |

### Token / session (D5)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| T1 | Portal no logout / no tnbf | `routers/portal_auth.py`, `models/customer_user.py` | Y | CLOSE THIS SESSION |
| T2 | Refresh replay doesn't revoke family | `models/refresh_token.py`, `routers/auth.py:104-131` | Y | CLOSE THIS SESSION |
| T3 | Refresh doesn't reject inactive users | `routers/auth.py:117-122` | N | CLOSE THIS SESSION (paired with S2) |
| T4 | API keys no expiry | `models/apikey.py`, `routers/apikeys.py` | Y | CLOSE THIS SESSION |
| T5 | API keys no scope | `models/apikey.py`, auth dep | Y | CLOSE THIS SESSION |

### Auditability (D27)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| A1 | Auth router emits zero Events | `routers/auth.py` | N | CLOSE THIS SESSION (login/logout/failure/refresh emit) |

### Backup / restore (D23)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| B1 | Backup script not committed | `scripts/backup-nightly.sh`, `scripts/backup-offsite.sh` | N | CLOSE THIS SESSION (extract from OPS-BACKUP.md) |

### Compliance / privacy (D22, D29)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| C1 | PII in INFO logs | `backend/app/channels.py:51-69` | N | CLOSE THIS SESSION (redact to `body_len`) |
| C2 | GDPR right-to-access not built | (new code) | Y (audit) | BLOCKED-multi-week-eng (PII tagging on every model + per-entity export builder + permission + audit) |
| C3 | GDPR right-to-erasure not built | (new code) | Y (audit) | BLOCKED-multi-week-eng (retention sweep + legal hold + PII redaction across Event/Communication/Invoice) |
| C4 | PURGED state decorative | `lifecycle.py:340-363` | N | BLOCKED-multi-week-eng (depends on C3 retention service) |

### Scale / performance (D25)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| P1 | Unbounded list reads entire entity | `routers/records.py:216-258` | N | CLOSE THIS SESSION (SQL pagination + cap) |
| P2 | `pagination.DEFAULT_LIMIT = None` | `pagination.py:26` | N | CLOSE THIS SESSION (default 100, max 1000) |
| P3 | customer360 3× scans | `routers/customer360.py:147-160` | N | BLOCKED-multi-week-eng (needs `record_ref` indexed lookup table) |

### Architecture / Code (D1/D2/D3 Critical)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| AC1 | Two parallel workflow engines | `workflow.py`, `kernel/workflow_engine.py` | N | BLOCKED-multi-week-eng (architectural collapse, multi-week senior-eng) |
| AC2 | main.py 22KB single include | `main.py:53,187-292` | N | BLOCKED-multi-week-eng (module-composition refactor) |
| AC3 | 18+ god files > 1KLOC | (many) | N | BLOCKED-multi-week-eng (per-file splits) |
| AC4 | Idempotency middleware TOCTOU | `middleware/idempotency.py:96-184` | N | CLOSE THIS SESSION (PENDING-row pattern) |

### Operational wiring (D10/D32 Critical)

| # | Finding | Files | Migration? | Status |
|---|---|---|---|---|
| O1 | FreeRADIUS NotImplementedError | `services/radius/freeradius_backend.py:70-95` | N | BLOCKED-external-dependency (needs real RADIUS host + pyrad implementation) |
| O2 | RADIUS not wired to service lifecycle | `routers/services.py`, `services/install_board.py` | N | BLOCKED-multi-week-eng + depends on O1 |
| O3 | OLT driver not wired to install_board.activate_service | `services/install_board.py:401-409` | N | BLOCKED-multi-week-eng + needs real OLT chassis |
| O4 | Import engine is metadata stub | `routers/imports_exports.py:272-314` | N | BLOCKED-multi-week-eng (CSV parser + validation + per-row insert) |
| O5 | Warehouse subsystem absent | (new code) | Y | BLOCKED-multi-week-eng (entire new module — stock_item, transfer, receiving, bin) |
| O6 | docker-compose missing backend service | `docker-compose.yml` | N | CLOSE THIS SESSION |

### High findings — also closable this session

| # | Finding | Files | Status |
|---|---|---|---|
| H1 | No bespoke login brute-force throttle | `config.py`, `routers/auth.py` | CLOSE THIS SESSION (per-account counter via existing Redis URL → in-process counter for now + plan for Redis) |
| H2 | `User.email` global uniqueness leaks user existence | `models/user.py:23` | BLOCKED-multi-week-eng (data migration risk; will need careful migration with collision handling) |
| H3 | CORS `*` not blocked in prod contract | `config.py` | CLOSE THIS SESSION |
| H4 | No CSP header | `main.py:136-153` | CLOSE THIS SESSION |
| H5 | WorkItem /assign IDOR | `routers/workitems.py:353-387` | CLOSE THIS SESSION |
| H6 | Content-Disposition filename injection | `routers/attachments.py:326` | CLOSE THIS SESSION |
| H7 | Config writes have no schema validation | `routers/configurations.py:131-138` | BLOCKED-product-decision (needs schema-per-key contract from Studio team) |
| H8 | `_parse_dt` accepts tz-naive | `routers/_billing_shared.py:286-295` | CLOSE THIS SESSION |
| H9 | `_add_cycle` Feb 29 anchor loss | `routers/_billing_shared.py:106-114` | BLOCKED-product-decision (needs `Subscription.billing_anchor_day` migration + policy) |
| H10 | Dunning step from `now()` not opened_at | `services/dunning.py:354-356` | CLOSE THIS SESSION |
| H11 | Many `dict` payloads bypass Pydantic | (~30 routers) | BLOCKED-multi-week-eng (sweep) |
| H12 | No structured logging | (many) | BLOCKED-multi-week-eng (logging migration) |
| H13 | No request-id middleware | `main.py` | CLOSE THIS SESSION |
| H14 | No error tracker | (config) | CLOSE THIS SESSION (Sentry hook added; key TBD) |
| H15 | Readiness probe leaks DB error | `routers/health.py:86-100` | CLOSE THIS SESSION |
| H16 | Audit retention not encoded | (DB + code) | BLOCKED-multi-week-eng |
| H17 | No PII tagging on models | (many models) | BLOCKED-multi-week-eng |
| H18 | Hard-delete path doesn't exist | (new service) | BLOCKED-multi-week-eng (paired with C3) |
| H19 | CSV/XLSX formula injection in export | `routers/export.py:88-96` | CLOSE THIS SESSION |
| H20 | Single Postgres + Redis no HA | (infra) | BLOCKED-external-dependency (infra) |

---

## What this session WILL deliver

### Migrations (alembic) — 1 atomic merge revision

1. `mint_open_version_partial_unique.py` — `CREATE UNIQUE INDEX uq_product_version_one_open ON product_version (product_id) WHERE effective_to IS NULL;`
2. DELETE triggers for `credit_note` + `payment_allocation` (mirror `prevent_delete_invoice`)
3. `refresh_token.session_id UUID NOT NULL` (backfill = id, then NOT NULL) for family-revocation
4. `customer_user.token_not_before TIMESTAMPTZ NULL` for portal logout/tnbf
5. `api_key.expires_at TIMESTAMPTZ NULL` + `api_key.scopes JSONB NULL` for expiry+scope
6. `payment_allocation` CHECK trigger: `SUM(amount) per payment_id <= payment.amount`

### Code changes — across multiple files

- **Auth router** (`routers/auth.py`): emit `LOGIN_SUCCESS / LOGIN_FAILED / LOGOUT / REFRESH_REPLAY` Events. Reject inactive users on login + refresh. Revoke session family on replay detection. `revoke_all_for_user()` helper.
- **Refresh path**: rotate with `session_id` preserved. Replay → kill entire family.
- **Password change** (`routers/me.py`): on success → `revoke_all_for_user(user.id)`.
- **Public `/org-tree`** (`main.py:307`): gate behind `Depends(current_user)` + tenant scope.
- **Stripe events** (`services/payments/stripe_events.py`): currency check + amount-vs-outstanding + refunded_amount in SUM.
- **Auto-PAID SUM** (3 sites): `SUM(amount - COALESCE(refunded_amount,0))` everywhere.
- **Credit-note numbering** (3 sites): switch to `next_reference_number(s, tenant_id, prefix, width)`.
- **Settle/allocate**: `with_for_update()` on entry.
- **mint_new_version**: `pg_advisory_xact_lock(hashtext('product_version:'||product_id))` at top.
- **Usage**: `Decimal(str(v))` coercion; Mapped[Decimal] in model.
- **Portal HTML escape**: `_e()` helper into `portal_billing.invoice_document` + `payment_receipt`.
- **Content-Disposition sanitize**: strip CRLF + quote chars in `attachments.py:326`.
- **WorkItem /assign**: `_assigned_user_or_422(tenant_id, user_id)`.
- **Pagination** (`pagination.py:26`): `DEFAULT_LIMIT = 100`, `MAX_LIMIT = 1000`, reject `?limit > MAX_LIMIT`.
- **records.py list_records**: push `q`, filter, sort, pagination into SQL `select().offset().limit()`.
- **PII redaction** (`channels.py:51-69`): `body_len=%d` + redact `to` to last-4.
- **Readiness probe** (`routers/health.py:99`): generic `db_unavailable`, log raw server-side.
- **CORS + mock-provider production contract** (`config.py:135-175`): refuse boot in prod if `cors_origins == "*"` OR any of `payment_gateway_provider/email_gateway_provider/sms_gateway_provider` == `mock`.
- **CSP header middleware** (`main.py`): add `default-src 'self'`.
- **Request-ID middleware**: mint/propagate `X-Request-ID` into `contextvars`.
- **Idempotency middleware TOCTOU**: PENDING-row INSERT-first pattern.
- **`_parse_dt` tz-naive guard** (5 routers).
- **Dunning step opened_at anchor** (`services/dunning.py:354-356`).
- **CSV/XLSX formula injection** (`routers/export.py:88-96`): prepend `'` for leading `= + - @ \t \r`.
- **Backup scripts**: `scripts/backup-nightly.sh` + `scripts/backup-offsite.sh`.
- **docker-compose.yml**: add `backend:` service with healthcheck + env_file.
- **API key expiry+scope**: enforcement in `_user_from_api_key`.
- **Portal `/portal/auth/logout`** endpoint + `tnbf` check in `current_customer`.

### Tests added

Per finding, at minimum one regression test:
- `test_stripe_webhook_currency_mismatch_rejected`
- `test_stripe_webhook_amount_exceeds_outstanding_rejected`
- `test_refunded_payment_keeps_invoice_paid_only_when_net_paid` (3 paths)
- `test_concurrent_mint_new_version_partial_unique`
- `test_credit_note_numbering_is_sequence_based`
- `test_credit_note_delete_blocked`
- `test_payment_allocation_delete_blocked`
- `test_settle_order_with_for_update_serializes_concurrent_callbacks`
- `test_allocate_payment_over_allocation_rejected_under_concurrency`
- `test_usage_amount_uses_decimal`
- `test_deactivated_user_cannot_login`
- `test_deactivated_user_refresh_rejected`
- `test_refresh_replay_kills_family`
- `test_password_change_revokes_refresh_tokens`
- `test_login_success_emits_audit_event`
- `test_login_failed_emits_audit_event`
- `test_org_tree_requires_auth`
- `test_portal_xss_html_escaped`
- `test_content_disposition_filename_sanitized`
- `test_workitem_assign_cross_tenant_rejected`
- `test_pagination_default_100_max_1000`
- `test_records_list_uses_sql_pagination`
- `test_pii_not_logged_at_info`
- `test_prod_contract_refuses_mock_providers`
- `test_prod_contract_refuses_cors_wildcard`
- `test_api_key_expired_rejected`
- `test_api_key_scope_enforced`
- `test_portal_logout_revokes`
- `test_portal_tnbf_kills_old_tokens`

### Docs updated

- `docs/audit/PRODUCTION-CERT-2026-06-04.md` (existing; remains historical)
- `docs/audit/PRODUCTION-REMEDIATION-PLAN-2026-06-04.md` (this file)
- `docs/audit/PRODUCTION-REMEDIATION-REPORT-2026-06-04.md` (synthesis after fix run)

### What this session WILL NOT close

- 9 multi-week-eng Criticals (AC1-3, C2-4, O1-5)
- ~12 multi-week-eng Highs (H2, H11, H12, H16-18, H20)
- 2 product-decision blockers (S4 portal cookie, H7 config schema, H9 anchor_day policy)

For all of these the report will carry concrete unblock paths + estimates.

---

## Risk discipline

Every change preserves:
- D6 Tenant Isolation (114-table RLS + GUC binding + storage prefixes)
- Append-only Event / Invoice / Payment / CreditNote triggers
- Production deploy contract DB-role split
- Fernet field encryption
- Fail-soft scheduler / workflow / webhook
- Outbound httpx timeouts
- Tenant-filter pragma WHY comments

Migrations follow the `d1a7b2c4e6f8_rls_product_version_close_cross_tenant_leak.py` template:
1. Add column nullable
2. Backfill
3. NOT NULL
4. Index + FK
5. Policy / trigger
6. All reversed in `downgrade()`

---

## Execution plan

**Stage 1 (parallel, 8 agents)** — all independent file scopes:

- **Pack F (Financial)**: Stripe currency + amount + refunded_amount + CN numbering + mint advisory lock + settle/allocate with_for_update + usage Decimal
- **Pack T (Tokens/Auth/Audit)**: Auth audit emit + inactive-user rejection + refresh family revocation + password-change revoke + portal logout/tnbf + API key expiry+scope
- **Pack S (Security)**: /org-tree gate + mock-provider production guard + CORS prod guard + CSP header + idempotency TOCTOU
- **Pack P (Portal)**: Portal XSS escape + Content-Disposition sanitize + WorkItem IDOR
- **Pack X (Performance)**: pagination DEFAULT_LIMIT + records.py SQL pagination + CSV formula injection + dunning opened_at
- **Pack O (Observability)**: PII redaction + readiness probe + request-id middleware
- **Pack D (DevOps)**: docker-compose backend service + backup scripts + scripts/restore.sh
- **Pack M (Migrations)**: Single merge revision with all 6 schema changes

**Stage 2 (orchestrator-only)**:
- Run alembic upgrade head
- Run pytest -k "remediation"
- Synthesize remediation report
- Commit + push

---

End of plan. Execution begins immediately.
