# Pre-Launch Configuration Checklist

**Purpose:** Every vendor decision, infrastructure choice, code hardening, and tracked gap
that must be resolved before the first paying customer or production deploy.

Status legend:
- 🔴 MUST do before ANY production deploy (security / data integrity)
- 🟡 MUST do before FIRST SALE (correctness / compliance)
- 🟢 DO before scaling to second customer or high load
- 📋 CUSTOMER CONVERSATION — ask the customer
- ✅ DONE — file:line reference given

---

## Recently Shipped — 2026-06-02

- Wave A: Communication, Configuration, Escalation, Relationship, ImportExport — first-class models + routers + migrations
- Wave B+C: Approval DELEGATE/REQUEST_CHANGES ext (`c4f7a2b9e618`), Webhook DEAD_LETTERED delivery status (`c4f7a9d31e58`), Reference Number Postgres SEQUENCEs (`e4f9c2a8b716` + `utils/refnum.py`), Idempotency Middleware (`c8d3a4f91b6e` + `middleware/idempotency.py`)
- Queue Ownership defaults (`3c31f1734821`) — `assignment_strategy`, `visibility`, `owning_department`, `is_active` on `helpdesk_queue`
- Background Job Standard extension — 7-value `BackgroundJobStatus` + retry + idempotency_key (`89518e0c00a7`)
- Workflow Engine GateType + WorkflowStatus + versioning + reference number on `workflow_def` (`c443f037e6ac`)
- B5 dunning action verbs UPPER_SNAKE — NOTICE/THROTTLE/WALLED_GARDEN/TERMINATE migration (`7b1e0d3b41fd`)
- D14 `deletion_state` 5-value enum (ACTIVE/ARCHIVED/SOFT_DELETED/PENDING_PURGE/PURGED) on all lifecycle entities (`6bf1bea1e0cd`)
- D1 Workflow Engine + Event System extension — `event_name`, `category`, `correlation_id`, `causation_id` on Event (`85e76746332e`)
- R3 Queue ownership defaults, Job extension snake+camelCase serialization, Workflow gate type
- R4-A Dunning action verbs UPPER_SNAKE (`7b1e0d3b41fd`)
- R4-B CustomerView Activity duplicate removed — canonical 9-tab scaffold now live in `CustomerView.tsx`
- R4-C Reporting aggregate-leakage protection — `_alive()` guard on 22+ endpoints in `analytics.py` + `reports.py`
- R5-C Drawer Types catalog (`frontend/src/lib/drawer-types.ts`) + Action Menu catalog (`frontend/src/lib/action-menu.ts`)
- CI fix: `frontend/src/vite-env.d.ts` with `ImportMetaEnv` interface (VITE_STRIPE_PUBLISHABLE_KEY)
- Status enum normalization (`f18655752e1c`): `workflow_instance.status`, `automation_rule.event_type`, `dunning_case.status` → UPPER_SNAKE

---

## SECTION 1 — Blockers (🔴 must resolve before ANY prod deploy)

| # | Item | State | Action |
|---|---|---|---|
| 45 | 🔴 Comment hold DB trigger | Router-only soft guard | Write BEFORE UPDATE / BEFORE DELETE trigger (same class as `b70ef3b98e27`). Hard precondition before first legal hold AND prod deploy. `app/models/comment.py:86` |
| 36 | 🔴 `GAAEX_FIELD_KEY` encryption key | Dev deterministic key | `python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"` → set in prod `.env` |
| 37 | 🔴 `ENVIRONMENT=production` | Not set | Activates all production contract guards in `config.py` |
| 38 | 🔴 `OWNER_DATABASE_URL` ≠ `DATABASE_URL` | Same in dev | `DATABASE_URL` → `gaaex_app` (RLS-limited); `OWNER_DATABASE_URL` → `gaaex` (DDL owner) |
| 39 | 🔴 JWT secret | `dev-only-change-me` | Set strong random `JWT_SECRET` (32+ chars) |
| 40 | 🔴 `REQUIRE_STRONG_SECRETS=true` | Off by default | Activates the weak-secret boot guard |
| 41 | 🔴 HTTPS / TLS | HTTP only | Add nginx/traefik to docker-compose with Let's Encrypt or customer cert |
| 42 | 🔴 CORS origins | `*` default | Set `CORS_ORIGINS=https://app.customer.com` |
| 43 | 🔴 Webhook SSRF guard | Confirm off by default | Set `WEBHOOK_ALLOW_PRIVATE=false` in prod |
| 44 | 🔴 Rate limiting | Off by default | Set `RATE_LIMIT_ENABLED=true`, tune `RATE_LIMIT_PER_MIN` |
| 74 | 🔴 Postgres backups | No backup strategy | `pg_dump` cron + off-site storage. 📋 Ask customer: retention period, where backups go |
| 75 | 🔴 Docker volume persistence | Named volumes (ephemeral) | Set `driver_opts.device` to mounted persistent disk path |
| 1 | 🔴 Stripe live secret key | Test `sk_test_…` | Replace with `sk_live_…` |
| 2 | 🔴 Stripe live publishable key | Test `pk_test_…` | Replace with `pk_live_…` |
| 3 | 🔴 Stripe live webhook secret | Test `whsec_…` | Re-run `stripe listen --forward-to …` against prod URL |

---

## SECTION 2 — High Priority (🟡 before first sale)

### 2a. Data Integrity

| # | Item | State | Action |
|---|---|---|---|
| 48 | 🟡 Central Legal Hold registry | `RetentionCategory` enum exists; no `legal_hold` table | Write Data Retention Standard → build `legal_hold` table → replace per-module stubs |
| 49 | 🟡 Notification module (full) | `notification.py` extended; `NotificationDef` seeded | Build full delivery fanout: watcher→event→notification→delivery. Required before automation alerts reach users |
| 50 | 🟡 `PortalTicketReply.direction` | Lowercase `"inbound"` (`app/models/portal_ticket_reply.py:31`) | Migration: `UPDATE portal_ticket_reply SET direction = UPPER(direction)`. Fold into Communication module normalization pass |
| 52 | 🟡 Event `event_name` backfill | NULL for legacy rows | Background job: map `type="comment_added"` → `event_name="Comment.Added"` etc. Mapping table in `app/models/event.py:docstring` |
| 53 | 🟡 Event `reference_number` backfill | NULL for legacy rows | Same job: assign `EVT-000001` to legacy rows using `utils/refnum.py` |
| 55 | 🟡 Object Detail 9-tab scaffold | CustomerView has canonical 9 tabs ✅; other views (Ticket, Order…) may not | Audit each detail view against the canonical tab set (Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit) |
| 56 | 🟡 Business calendar for SLA | 24×7 wall-clock; `sla.calendar_id` stubbed nullable | Build `Calendar` model + `CalendarBackend`; wire `sla_record.calendar_id`. Required before SLAs respect business hours |
| 57 | 🟡 `routers/interactions.py` legacy channel mapping | `note/other/in_person → INTERNAL_CHAT` (one-way collapse) | Revisit if real data has these values in prod |
| 58 | 🟡 Attachment `preview_available` | Always false | Background job + `poppler`/`Pillow` for PDF/Image/Text previews |

### 2b. Status enum normalization (R5-B — in-flight)

| # | Item | State | Action |
|---|---|---|---|
| 87 | 🟡 `Tenant.status` | Lowercase `"active"` (`app/models/tenant.py:18`) | Migration + insert-path sweep → `"ACTIVE"` |
| 88 | 🟡 `User.status` | Lowercase `"active"` (`app/models/user.py:26`) | Same |

### 2c. Security / Compliance

| # | Item | State | Action |
|---|---|---|---|
| 83 | 🟡 User data export | Not built | `GET /api/users/{id}/export` — GDPR right-to-access |
| 84 | 🟡 User data purge | Not built | `DELETE /api/users/{id}/purge` — GDPR right-to-erasure |
| 85 | 🟡 Audit log export with date range | Basic endpoint exists | Add pagination + date-range filter |
| 34 | 🟡 Malware scan | `SKIPPED` in v1 | Wire ClamAV or cloud scan via `ScanBackend` Protocol |

### 2d. Payment & Messaging (vendor config)

| # | Item | State | Action |
|---|---|---|---|
| 4 | 🟡 Stripe API version pin | `2024-06-20` | Review and pin to latest stable before go-live |
| 16 | 🟡 Twilio live credentials | Mock in dev | Set `SMS_GATEWAY_PROVIDER=twilio`, `TWILIO_FROM_NUMBER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| 18 | 🟡 SMS delivery confirmations | Twilio status webhook | Set `TWILIO_STATUS_CALLBACK_URL` to prod URL |
| 19 | 🟡 SendGrid API key | Mock in dev | Set `EMAIL_GATEWAY_PROVIDER=sendgrid`, `SENDGRID_API_KEY` |
| 20 | 🟡 Verified sender domain | Not set | Configure DKIM/SPF in SendGrid dashboard for customer's domain |
| 21 | 🟡 From email/name | Not set | Set `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` |

### 2e. Network / OLT / RADIUS

| # | Item | State | Action |
|---|---|---|---|
| 25 | 🟡 Real device testing | Not done | Test `HuaweiDriver` + `ZteDriver` against one real OLT before go-live |
| 25a | 🟡 VSOL OLT driver | Not built | 📋 Ask customer if they have VSOL equipment. If yes, build `VsolDriver` in `app/services/olt/drivers/vsol.py`. VSOL uses CLI over Telnet/SSH or SNMP v2c. Register in `factory.py` |
| 26 | 🟡 FreeRADIUS credentials | Mock in dev | Set `RADIUS_BACKEND_PROVIDER=freeradius`, `RADIUS_HOST`, `RADIUS_SECRET`, `RADIUS_NAS_IP` |
| 29 | 🟡 RADIUS provisioning test | Not done | Provision one test subscriber end-to-end before go-live |

### 2f. PaymentMethodView wiring (R5-A — in-flight)

| # | Item | State | Action |
|---|---|---|---|
| 45a | 🟡 PaymentMethodView in App.tsx | `PaymentMethodView.tsx` + `AddPaymentMethodDrawer.tsx` exist; NOT in `App.tsx` View union | Add view type entry to `App.tsx`. Set `VITE_STRIPE_PUBLISHABLE_KEY` env var. UX placement is a product decision |

### 2g. Infrastructure

| # | Item | State | Action |
|---|---|---|---|
| 77 | 🟡 Monitoring | No APM | Prometheus + Grafana or cloud APM. 📋 Ask customer |
| 78 | 🟡 Log aggregation | stdout only | Loki + Grafana, or ELK. 📋 Ask customer |
| 79 | 🟡 Health check endpoint | `GET /api/health` exists | Wire to uptime monitor |
| 80 | 🟡 Notification delivery queue | Sync fire-and-forget | Async queue (Celery/Redis or Postgres job table) before high volume |
| 31 | 🟡 Swap to MinIO | Local disk v1 | Before multi-node or prod: add MinIO to `docker-compose.yml`, set `STORAGE_BACKEND=minio` |

---

## SECTION 3 — Code Gaps (minor / tracked divergences)

| # | Item | Gap | Effort |
|---|---|---|---|
| 94 | Reference prefix completeness | Sequences exist for used prefixes; full 39-prefix registry in `00-standards-index.md` | Generate for top-5 remaining: CUS, CNT, EMP, LED, SIT — minor |
| 95 | API routes `/api/v1/` versioning | All routes at `/api/` not `/api/v1/` | Breaking change — plan for v2 if needed, not urgent |

---

## SECTION 4 — Recently Resolved (marked DONE this session)

| # | Item | Resolved by |
|---|---|---|
| 46 | Reference number sequences | `backend/app/utils/refnum.py` + migration `e4f9c2a8b716` |
| 47 | Idempotency-Key middleware | `backend/app/middleware/idempotency.py` + migration `c8d3a4f91b6e` |
| 59 | WorkflowDef GateType | `backend/app/models/meta.py:158-177` + migration `c443f037e6ac` |
| 60 | Background Job 7-value status | `backend/app/models/job.py:12-31` + migration `89518e0c00a7` |
| 62 | Communication module | `backend/app/models/communication.py` + migration `3dac5acb70b7` |
| 63 | Relationship / Entity Link | `backend/app/models/relationship.py` + migration `02b1e0fef42e` |
| 64 | `deletionState` 5-value enum on lifecycle entities | `backend/alembic/versions/6bf1bea1e0cd_deletion_state_rollout.py` |
| 66 | Configuration first-class table | `backend/app/models/configuration.py` + migration `19da2573e24e` |
| 68 | Import / Export first-class jobs | `backend/app/models/import_export.py` + migration `c15fe3b567af` |
| 69 | Queue Ownership defaults | `backend/app/models/helpdesk.py:38-41` + migration `3c31f1734821` |
| 70 | Escalation first-class model | `backend/app/models/escalation.py` + migration `fa16384aa026` |
| 71 | Approval DELEGATE + REQUEST_CHANGES | `backend/app/models/approval.py:91-101` + migration `c4f7a2b9e618` |
| 72 | Webhook DEAD_LETTERED delivery status | `backend/app/models/webhook.py:62-104` + migration `c4f7a9d31e58` |
| 73 | API v1 routing — tracked gap only | Logged as #95; deferred, not urgent |
| 45b | CustomerView Activity duplicate | `frontend/src/views/CustomerView.tsx` — 9-tab scaffold, no redundant ActivityTimeline |
| 89 | `WorkflowInstance.status` UPPER_SNAKE | `backend/alembic/versions/f18655752e1c` |
| 90 | `AutomationRule.event_type` UPPER_SNAKE | Same migration `f18655752e1c` |
| 91 | `DunningCase.status` UPPER_SNAKE | Same migration `f18655752e1c` |
| 92 | `Interaction.channel/direction` | Communication module build + `b470247667d5` migration |
| 93 | RBAC permission keys lowercase | `docs/standards/13-consistency-patch-notes.md` D2 amendment + `15-permission-registry.md` |
| 76 | `postgis/postgis:16-3.4` image | Already done in `docker-compose.yml` |

---

## SECTION 5 — Customer Conversation Items 📋

1. **OLT inventory**: Full list of OLT models, IPs, credentials, protocol per device. **Ask: any VSOL OLTs?** (driver not yet built)
2. **FreeRADIUS schema**: Custom user attributes? Subscriber table structure?
3. **Payment preference**: Stripe / Idram / ARca / Telcell / EasyPay / cash-only for v1?
4. **SMS preference**: Twilio OK, or local Armenian carrier API needed?
5. **Email domain**: Which domain for customer-facing billing/support emails?
6. **Backup policy**: Where do backups go? Retention period?
7. **Single-node or HA**: Is one server enough for the 90-day test?
8. **SSL/HTTPS**: Public domain + Let's Encrypt, or LAN-only self-signed?
9. **Monitoring**: Existing monitoring infrastructure to integrate with?
10. **Data residency**: Any legal requirements about data location?
11. **Existing systems**: BSS/OSS with data to import?
12. **Feature flags**: Which modules to enable on day 1?
13. **File size limits**: 100 MB per file default — OK, or need per-type limits?
14. **SLA business calendar**: Do SLAs need to respect business hours (9–5 Mon–Fri)?
15. **Subscriber count growth**: 15k now — expected growth in 12 months?
16. **Multi-currency**: AMD only, or international invoices needed?

---

## SECTION 6 — Payment Gateway Stubs (📋 activate per customer choice)

| # | Gateway | State | Action |
|---|---|---|---|
| 5–7 | Idram 🇦🇲 | Structural impl in `app/adapters/payment/idram.py`; two credential slots remain | 📋 Ask customer. Set `IDRAM_MERCHANT_ID`, `IDRAM_SECRET_KEY` |
| 8–10 | ARca 🇦🇲 | Stub in `app/adapters/payment/arca.py` | 📋 Ask customer. ARca uses legacy SOAP/XML API |
| 11–12 | Telcell 🇦🇲 | Stub in `app/adapters/payment/telcell.py` | 📋 Ask customer |
| 13–14 | EasyPay 🇦🇲 | Stub in `app/adapters/payment/easypay.py` | 📋 Ask customer |
| 15 | Per-tenant gateway config | v1: one gateway per deployment | 🟢 Build when second customer has different currency/gateway needs |

---

## SECTION 7 — Scale / Polish (🟢 before second customer or high load)

| # | Item | Action |
|---|---|---|
| 17 | Armenian local SMS 🇦🇲 | 📋 Ask customer: VivaCell-MTS / Beeline / Ucom APIs. Build `ArmeniaSmsGateway` if Twilio delivery to `.am` is unreliable |
| 22 | Customer email domain | Ask: what domain for billing/support emails? |
| 30 | Storage backend | Local disk OK for single-node on-prem v1 |
| 32 | Swap to S3 | For cloud SaaS: `STORAGE_BACKEND=s3` + credentials |
| 33 | Upload directory mount | `/app/uploads` — mount to persistent disk in `docker-compose.yml` volumes |
| 35 | Max file size | 100 MB default. 📋 Ask customer if different limits per object type |
| 81 | Multi-node / HA | 📋 Ask customer: one server OK for v1? |
| 82 | MinIO / S3 for attachments | Add MinIO to docker-compose (see §2e) |
| 86 | Data residency clause | 📋 Ask customer: any requirements about data storage location? |

---

*Last updated: 2026-06-02 — R6-A audit pass.*
*Update this doc whenever a new tracked gap is noted in a commit message or session.*
