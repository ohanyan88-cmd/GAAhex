# Pre-Launch Configuration Checklist

**Purpose:** Every vendor decision, infrastructure choice, code hardening, and tracked gap
that must be resolved before the first paying customer or production deploy.
Use this doc when talking to the Armenian ISP partner (and future customers) about what
*they* need to choose and configure — and as a complete picture of what Ընgер still needs to build.

Status:
- 🔴 MUST do before ANY production deploy (security / data integrity)
- 🟡 MUST do before FIRST SALE (correctness / compliance)
- 🟢 DO before scaling to second customer or high load
- 📋 CUSTOMER CONVERSATION — ask the customer, their choice drives the config

---

## SECTION 1 — Payment & Billing Integrations

### 1a. Stripe (international cards)
| # | Item | State | Action |
|---|---|---|---|
| 1 | Live secret key | Test keys in `.env` | Replace `STRIPE_SECRET_KEY=sk_test_…` → `sk_live_…` |
| 2 | Live publishable key | Test keys | Replace `STRIPE_PUBLISHABLE_KEY=pk_test_…` → `pk_live_…` |
| 3 | Live webhook secret | Test `whsec_…` | Re-run `stripe listen --forward-to …` against prod URL → new secret |
| 4 | Stripe API version pin | `2024-06-20` | Review and pin to latest stable before go-live |

### 1b. Idram 🇦🇲 (Armenian local gateway)
| # | Item | State | Action |
|---|---|---|---|
| 5 | Idram merchant account | Not yet created | 📋 Ask customer if they want Idram. Register at idram.am |
| 6 | Idram credentials | Config stub exists (`config.py:idram_merchant_id`) | Set `PAYMENT_PROVIDER=idram`, `IDRAM_MERCHANT_ID`, `IDRAM_SECRET_KEY` |
| 7 | IdramGateway implementation | Stub config only | Build `app/services/payments/idram_gateway.py` implementing `PaymentGateway` Protocol |

### 1c. ARca 🇦🇲 (Armenian card network)
| # | Item | State | Action |
|---|---|---|---|
| 8 | ARca merchant account | Not yet created | 📋 Ask customer. ARca uses legacy SOAP/XML API |
| 9 | ARca credentials | Config stub exists (`config.py:arca_merchant`) | Set `PAYMENT_PROVIDER=arca`, `ARCA_MERCHANT`, `ARCA_PASSWORD` |
| 10 | ArcaGateway implementation | Stub config only | Build `app/services/payments/arca_gateway.py` |

### 1d. Telcell 🇦🇲 (Armenian mobile payments)
| # | Item | State | Action |
|---|---|---|---|
| 11 | Telcell merchant account | Config stub exists | 📋 Ask customer. Popular for mobile users |
| 12 | TelcellGateway implementation | Stub config only | Build gateway implementation |

### 1e. EasyPay 🇦🇲
| # | Item | State | Action |
|---|---|---|---|
| 13 | EasyPay account | Config stub exists | 📋 Ask customer |
| 14 | EasyPayGateway implementation | Stub config only | Build gateway implementation |

### 1f. Multi-gateway per tenant
| # | Item | State | Action |
|---|---|---|---|
| 15 | Per-tenant gateway config | v1: one gateway per deployment | 🟢 Build when second customer has different currency/gateway needs |

---

## SECTION 2 — SMS & Messaging

| # | Item | State | Action |
|---|---|---|---|
| 16 | Twilio live credentials | Mock in dev | Set `SMS_GATEWAY_PROVIDER=twilio`, `TWILIO_FROM_NUMBER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| 17 | Armenian local SMS 🇦🇲 | Not built | 📋 Ask customer: VivaCell-MTS / Beeline / Ucom APIs. Build `ArmeniaSmsGateway` if Twilio delivery to `.am` numbers is unreliable |
| 18 | SMS delivery confirmations | Twilio status webhook | Set `TWILIO_STATUS_CALLBACK_URL` to prod URL |

---

## SECTION 3 — Email

| # | Item | State | Action |
|---|---|---|---|
| 19 | SendGrid API key | Mock in dev | Set `EMAIL_GATEWAY_PROVIDER=sendgrid`, `SENDGRID_API_KEY` |
| 20 | Verified sender domain | Not set | Configure DKIM/SPF in SendGrid dashboard for customer's domain |
| 21 | From email/name | Not set | Set `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` |
| 22 | 📋 Customer email domain | Unknown | Ask: what domain should billing/support emails come from? |

---

## SECTION 4 — Network / OLT / RADIUS

### 4a. OLT (Huawei / ZTE / VSOL)
| # | Item | State | Action |
|---|---|---|---|
| 23 | OLT device credentials | Mock drivers built | 📋 Ask customer for full OLT inventory CSV: model, IP, username, password |
| 24 | Protocol per OLT | Drivers support CLI/SNMP/NETCONF | 📋 Ask: which protocol does each OLT expose? (Huawei MA5800 = CLI/SSH, ZTE C300 = NETCONF, VSOL = typically CLI/Telnet or SNMP) |
| 25 | Real device testing | Not done | Test `HuaweiDriver` + `ZteDriver` against one real OLT before go-live |
| 25a | **VSOL OLT driver** 🇦🇲 | **Not built** | **VSOL (深圳市维网光通科技) is a Chinese GPON/EPON vendor popular in Armenia (low cost, widely deployed by small/mid ISPs). Current driver pool: Huawei + ZTE only. Action: 📋 Ask customer if they have VSOL equipment. If yes, build `VsolDriver` implementing the `OltDriver` Protocol in `app/services/olt/drivers/vsol.py`. VSOL OLTs typically expose CLI over Telnet (port 23) or SSH; some models also support SNMP v2c. Commands differ from Huawei/ZTE — need VSOL device access to map the exact CLI syntax for `get_status`, `provision_onu`, `delete_onu`, `get_optical_power`, `set_vlan`, `apply_line_profile`. Register in `app/services/olt/factory.py` vendor registry.** |

### 4b. FreeRADIUS
| # | Item | State | Action |
|---|---|---|---|
| 26 | FreeRADIUS host | Mock in dev | Set `RADIUS_BACKEND_PROVIDER=freeradius`, `RADIUS_HOST`, `RADIUS_SECRET` |
| 27 | RADIUS user schema | Not mapped | 📋 Ask customer for their attribute schema — may need custom mapping in the adapter |
| 28 | RADIUS NAS IP | Not set | Set `RADIUS_NAS_IP` |
| 29 | 📋 RADIUS provisioning test | Not done | Provision one test subscriber end-to-end before go-live |

---

## SECTION 5 — File / Attachment Storage

| # | Item | State | Action |
|---|---|---|---|
| 30 | Storage backend | Local disk v1 (`STORAGE_BACKEND=local`) | Works for single-node on-prem. See §5a below |
| 31 | 🟡 Swap to MinIO | Not done | Before multi-node or prod: add MinIO to `docker-compose.yml`, set `STORAGE_BACKEND=minio` + credentials. One-file swap in `factory.py` |
| 32 | 🟢 Swap to S3 | Not done | For cloud SaaS: set `STORAGE_BACKEND=s3` + S3 credentials |
| 33 | Upload directory mount | `/app/uploads` (container) | In prod: mount to a persistent disk path in `docker-compose.yml` volumes |
| 34 | Malware scan | v1 skips (scan_result='SKIPPED') | 🟡 Wire ClamAV (free, docker-compose compatible) or a cloud scan API via `ScanBackend` Protocol |
| 35 | Max file size | 100 MB default | 📋 Ask customer if they need different limits per object type / tenant |

---

## SECTION 6 — Security Hardening (🔴 ALL must do before ANY prod deploy)

| # | Item | State | Action |
|---|---|---|---|
| 36 | 🔴 `GAAEX_FIELD_KEY` encryption key | Dev uses deterministic key | Generate: `python -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"` → set in prod `.env` |
| 37 | 🔴 `ENVIRONMENT=production` | Not set | Activates all production contract guards in `config.py` |
| 38 | 🔴 `OWNER_DATABASE_URL` ≠ `DATABASE_URL` | Same in dev | `DATABASE_URL` → `gaaex_app` role (RLS-limited); `OWNER_DATABASE_URL` → `gaaex` (DDL owner). Guard in `config.py:_assert_production_deploy_contract()` |
| 39 | 🔴 JWT secret | `dev-only-change-me` | Set strong random `JWT_SECRET` (32+ chars) |
| 40 | 🔴 `REQUIRE_STRONG_SECRETS=true` | Off by default | Activates the weak-secret boot guard |
| 41 | 🔴 HTTPS / TLS | HTTP only | Add nginx/traefik to docker-compose with Let's Encrypt or customer cert |
| 42 | 🔴 CORS origins | `*` default | Set `CORS_ORIGINS=https://app.customer.com` |
| 43 | 🔴 Webhook SSRF guard | Off by default | Set `WEBHOOK_ALLOW_PRIVATE=false` in prod (it already is — just confirm) |
| 44 | 🔴 Rate limiting | Off by default | Set `RATE_LIMIT_ENABLED=true`, tune `RATE_LIMIT_PER_MIN` |
| 45 | 🔴 Comment hold DB trigger | Router-only today | Write BEFORE UPDATE / BEFORE DELETE trigger (same class as `b70ef3b98e27`). Hard precondition before first legal hold. Tracked in `app/models/comment.py:33` |
| 45a | 🟡 PaymentMethodView wiring | Component shipped (Stripe Elements), not wired into App.tsx | `PaymentMethodView.tsx` exists; needs a view type added to `App.tsx`'s View union + an "Add Card" entry point (from PaymentMethodsView or similar). UX placement is a product decision. `VITE_STRIPE_PUBLISHABLE_KEY` env var also needs to be set for it to function. |
| 45b | 🟡 9-tab CustomerView Activity duplication | Customer 360 now has Timeline tab AND a separate Activity section at the bottom | The C1 Object Detail 9-tab scaffold added Timeline tab per file 10. The pre-existing `ActivityTimeline` section at the bottom of CustomerView is now redundant — should be removed in a polish pass. |

---

## SECTION 7 — Data Integrity & Code Gaps (🟡 before first sale)

| # | Item | State | Action |
|---|---|---|---|
| 46 | 🟡 Reference number sequence | `SELECT COUNT+1` (race-prone) | Replace with per-tenant, per-prefix Postgres `SEQUENCE`. One migration for TSK-, SLA-, INV-, ORD- etc. |
| 47 | 🟡 Idempotency-Key middleware | Not built | API Std 66: all retryable mutations accept `Idempotency-Key` header. Build as platform-wide middleware (not per-endpoint). Tracked in commit history |
| 48 | 🟡 Central Legal Hold registry | Per-module stubs only | Write Data Retention Standard → build `legal_hold` table → replace all per-module stubs (comment.hold, future attachment) |
| 49 | 🟡 Notification module | Not built (file 05) | First-class `Notification` table with channel/priority/status/eventId trace. Required before any automation-generated alert reaches a user |
| 50 | 🟡 `PortalTicketReply.direction` | Lowercase `"inbound"` | Fold into Communication module build. Set `UPPER_SNAKE` |
| 51 | 🟡 `NotificationChannel` lowercase | Some places still lowercase | Fold into Notification module build |
| 52 | 🟡 Event `event_name` backfill | `NULL` for legacy rows | Background job: map `type="comment_added"` → `event_name="Comment.Added"` etc. |
| 53 | 🟡 Event `reference_number` backfill | `NULL` for legacy rows | Same job: assign `EVT-000001` to legacy rows |
| 54 | 🟡 Attachment malware scan | `SKIPPED` in v1 | Wire ClamAV or cloud scan via `ScanBackend` Protocol (stub exists) |
| 55 | 🟡 Object Detail 9-tab scaffold | CustomerView uses only custom tabs | Add canonical 9 tabs (Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit) before custom ones. Comment ✅ Watcher ✅ Task ✅ — Attachment needed first |
| 56 | 🟡 Business calendar for SLA | 24×7 wall-clock only | Build `Calendar` model + `CalendarBackend`; wire `sla_record.calendar_id`. Required before SLAs respect business hours |
| 57 | 🟡 `routers/interactions.py` legacy channel mapping | `note/other/in_person → INTERNAL_CHAT` (one-way collapse) | Revisit if real data has these values in prod |
| 58 | 🟡 Attachment `preview_available` | Always false | Build preview generator for PDF/Image/Text (can use a background job + `poppler`/`Pillow`) |
| 59 | 🟡 `WorkflowDef` GateType enum | No general GateType on workflow engine | Add `COMMERCIAL_GATE, TECHNICAL_GATE …` per Standard 61; wire `correlation_id`/`causation_id` on emitted events |
| 60 | 🟡 `Background Job` status enum | `JobRun` has only `SUCCESS\|ERROR` | Expand to 7-value enum: `PENDING, RUNNING, SUCCEEDED, FAILED, RETRYING, CANCELLED, DEAD_LETTERED`. Add retry tracking + idempotency_key |

---

## SECTION 8 — Modules Not Yet Built (standard-first, each needs its own build session)

| # | Module | Standard | Depends on | Build effort |
|---|---|---|---|---|
| 61 | Notification (full) | file 05 | Event System ✅ Watcher ✅ | Medium |
| 62 | Communication (Interaction rewrite) | file 12 | CommunicationChannel ✅ | Medium |
| 63 | Relationship / Entity Link | file 12 | ObjectType enum | Medium |
| 64 | Deletion / Archive / Restore (`deletionState`) | file 12 | All modules | Medium |
| 65 | Data Retention + Legal Hold | file 12 (Gev writing) | All modules | Medium |
| 66 | Configuration (first-class table) | file 08 | Security | Medium |
| 67 | Feature Flag (extend model) | file 08 | Configuration | Small |
| 68 | Import / Export (first-class jobs) | file 08 | Attachment ✅ | Medium |
| 69 | Queue Ownership (strategy + visibility) | file 02 | Assignment | Medium |
| 70 | Escalation (first-class model) | file 02 | Watcher ✅ SLA ✅ | Medium |
| 71 | Approval (extend model with DELEGATE/REQUEST_CHANGES) | file 02 | Current Approval model | Small |
| 72 | Webhook Standard (delivery status enum, extend model) | file 12 | Background Job | Small |
| 73 | API v1 routing prefix (`/api/v1/`) | file 12 | All routes | Small (breaking) |

---

## SECTION 9 — Infrastructure

| # | Item | State | Action |
|---|---|---|---|
| 74 | 🔴 Postgres backups | No backup strategy | `pg_dump` cron + off-site storage. 📋 Ask customer: retention period, where backups go |
| 75 | 🔴 Docker volume persistence | Named volumes (ephemeral host) | Set `driver_opts.device` to a mounted persistent disk path |
| 76 | 🔴 `postgis/postgis:16-3.4` image | ✅ Already done | — |
| 77 | 🟡 Monitoring | No APM configured | Prometheus + Grafana (docker-compose) or cloud APM. 📋 Ask customer what they use |
| 78 | 🟡 Log aggregation | stdout only | Loki + Grafana, or ELK. 📋 Ask customer |
| 79 | 🟡 Health check endpoint | `GET /api/health` exists | Wire to uptime monitor |
| 80 | 🟡 Notification delivery queue | Sync fire-and-forget today | Async queue (Celery/Redis or Postgres job table) before high volume |
| 81 | 🟢 Multi-node / HA | Single docker-compose | 📋 Ask customer: one server OK for v1? HA needed later? |
| 82 | 🟢 MinIO / S3 for attachments | Local disk in v1 | Add MinIO to docker-compose. See §5 |

---

## SECTION 10 — GDPR / Compliance

| # | Item | State | Action |
|---|---|---|---|
| 83 | 🟡 User data export | Not built | `GET /api/users/{id}/export` — GDPR right-to-access |
| 84 | 🟡 User data purge | Not built | `DELETE /api/users/{id}/purge` — GDPR right-to-erasure |
| 85 | 🟡 Audit log export with date range | Basic endpoint exists | Add pagination + date-range filter for GDPR compliance export |
| 86 | 🟢 Data residency clause | No enforcement | 📋 Ask customer: any requirements about where data is stored? |

---

## SECTION 11 — Customer Conversation Items 📋

Questions to ask the ISP partner before deployment:

1. **OLT inventory**: Full list of OLT models, IPs, credentials, and protocol (CLI/SNMP/NETCONF) per device. **Specifically ask: do you have any VSOL OLTs?** (popular low-cost GPON vendor in Armenia — driver not yet built, needs 1-2 sessions if confirmed).
2. **FreeRADIUS schema**: Do they have custom user attributes? What is their subscriber table structure?
3. **Payment preference**: Stripe (international), Idram, ARca, Telcell, EasyPay, or cash-only for v1?
4. **SMS preference**: Twilio OK, or local Armenian carrier API needed?
5. **Email domain**: Which domain for customer-facing billing/support emails?
6. **Backup policy**: Where do backups go? Retention period?
7. **Single-node or HA**: Is one server enough for the 90-day test?
8. **SSL/HTTPS**: Public domain + Let's Encrypt, or LAN-only self-signed?
9. **Monitoring**: Do they have existing monitoring infrastructure to integrate with?
10. **Data residency**: Any legal requirements about data location?
11. **Existing systems**: Is there an existing BSS/OSS with data to import?
12. **Feature flags**: Which modules to enable on day 1?
13. **File size limits**: 100 MB per file default — OK, or need per-type limits?
14. **SLA business calendar**: Do SLAs need to respect business hours (9-5 Mon-Fri), or is 24×7 OK?
15. **Subscriber count growth**: 15k now — expected growth in 12 months? (Capacity planning)
16. **Multi-currency**: AMD only, or international invoices needed? (Affects Stripe vs Idram priority)

---

## SECTION 12 — Known Code Divergences vs Standards (tracked gaps from audit)

These are items the Standards Audit flagged as DIVERGENT — not blocking but should be aligned:

| # | Item | Gap | Effort |
|---|---|---|---|
| 87 | `Tenant.status` default | lowercase `"active"` | Should be `"ACTIVE"`. 1 migration + insert-path sweep |
| 88 | `User.status` default | lowercase `"active"` | Same |
| 89 | `WorkflowInstance.status` | lowercase `"running"` | Should be `"RUNNING"` per SlaStatus pattern |
| 90 | `AutomationRule.event_type` | lowercase `"create\|update…"` | Should be `"CREATE\|UPDATE"` |
| 91 | `DunningCase.status` | lowercase `"active\|cured…"` | Should be UPPER_SNAKE |
| 92 | `Interaction.channel/direction` | Already fixed for canonical set | Verify no legacy data with old values survives |
| 93 | RBAC permission keys are `entity.verb` | lowercase matches D2 ✅ | Was a gap — now aligned after D2 amendment |
| 94 | Reference prefixes | Only INV-/ORD- of 39 generated | Build generator for top 5: TKT, TSK ✅, CUS, CNT, EVT |
| 95 | API routes `/api/` not `/api/v1/` | Versioning gap | Breaking change — plan for v2 if needed, not urgent |

---

*Last updated: 2026-06-02 — Ընger deep audit pass.*
*Update this doc whenever a new tracked gap is noted in a commit message or session.*
