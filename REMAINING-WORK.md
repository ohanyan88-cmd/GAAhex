# REMAINING WORK — Locked Execution Map
> Decision made: 2026-05-31. Do not reorder without updating this file.
> Rule: nothing new starts until current item is fully done and pushed.
> Payment gateways (item P) = last, intentionally. EasyPay added to the list.

---

## EXECUTION ORDER

---

### R-01 · Fix test fixture ordering — batch21 skips (QUICK WIN)
**What:** `seed_demo_loop_if_empty()` exists and works but doesn't run before the 6 demo-loop
tests check for its output. Fix: call it in the `db` session fixture in `conftest.py`.
**Files:** `backend/tests/conftest.py`
**Done when:** `pytest` reports 0 skipped on test_batch21 seed-loop tests.
**Effort:** ~30 min
**Status:** ⬜ TODO

---

### R-02 · Fix hardcoded localhost URLs in StudioRichPanes (QUICK WIN)
**What:** 4 `fetch('http://127.0.0.1:8099/...')` calls in `FeatureFlagsPane` bypass the central
`BASE` constant. When deployed to any non-localhost env these silently fail.
**Fix:** `import { BASE } from '../../lib/api'` and use `${BASE}/api/feature-flags/...`.
**Files:** `frontend/src/studio/StudioRichPanes.tsx`
**Done when:** No literal `127.0.0.1` left in frontend source except `api.ts` BASE definition.
**Effort:** ~15 min
**Status:** ⬜ TODO

---

### R-03 · OPS: Backup/restore runbook + `.env.production` template
**What:** Two files that must exist before first real customer install.
1. `OPS-BACKUP.md` — step-by-step: pg_dump, restore test, verify, Docker volume backup, Redis
   persistence, file attachments (if any), frequency recommendation.
2. `.env.production.example` — every required env var with description + safe placeholder:
   DATABASE_URL, OWNER_DATABASE_URL, REDIS_URL, SECRET_KEY (≥32 bytes), GAAEX_FIELD_KEY
   (Fernet base64), JWT_SECRET (≥32 bytes), SMTP/SMS gateway vars, ARCA/iDram/TelCell/EasyPay
   credential slots (blank — filled at install time).
**Files:** `OPS-BACKUP.md` (repo root), `.env.production.example` (repo root)
**Done when:** Both files exist and cover all items above.
**Effort:** ~1 hour
**Status:** ⬜ TODO

---

### R-04 · Search facets + highlight
**What:** `GET /api/search` currently returns a plain list. Two things to add:
1. **Facets** — response shape becomes `{results: [...], facets: {entity_key: count, ...}}`.
   Facets = count-by-entity-key across all matching records in the tenant.
2. **Highlight** — each match object gets a `highlight: {field: "...snippet..."}` key showing
   which field matched and the matching excerpt (±30 chars around the hit).
**Files:** `backend/app/routers/search.py`, `backend/tests/test_batch27.py` (un-skip the 2 tests)
**Done when:** `test_facets_per_entity_counts` and `test_highlight_field_present` both pass.
**Effort:** ~2 hours
**Status:** ⬜ TODO

---

### R-05 · Wave 5 polymorphic triggers — asset + pipeline_item
**What:** Migration `d5b9c6f4e21a` already added the generic validator function and wired
`workitem.project_record_id` + `calendar_event.customer_record_id`. Deferred:
- `helpdesk_ticket.asset_record_id` → needs `entity_key='asset'` (now seeded ✅)
- `workitem.asset_record_id` → same
- `resource_pool.physical_asset_record_id` → same
- `order.pipeline_item_record_id` → needs `entity_key='pipeline_item'` (check if seeded)
**Files:** new alembic migration
**Done when:** Migration runs clean; triggers fire correctly on bad entity_key inserts.
**Effort:** ~1 hour
**Status:** ⬜ TODO

---

### R-06 · §4.4 Field-level encryption — ACTIVATE
**What:** Design doc exists at `backend/docs/spec-build/STEP-04-4-FIELD-ENCRYPTION.md`.
Activation means:
- Add Fernet encrypt/decrypt helpers to kernel (already has dev key scaffold)
- Encrypt at rest: `api_key.key_hash` → `key_enc`, `app_user` password field already hashed
  (not needed), `webhook.secret` → `secret_enc`
- Add migration to rename/convert those columns
- Wire the helpers into the routers that read/write them
- Document key-rotation in `OPS-BACKUP.md` (R-03 already has a slot for this)
**Constraint:** `GAAEX_FIELD_KEY` must be set to a real 32-byte Fernet key in prod (`.env.production.example` from R-03 has the slot).
**Files:** `backend/app/kernel/crypto.py` (new), relevant models + routers, new alembic migration
**Done when:** `test_field_crypto.py` fully green; no plaintext secrets in DB for those fields.
**Effort:** ~3 hours
**Status:** ⬜ TODO

---

### R-07 · 3 missing KPI formulas (source-data-blocked)
**What:** These 3 KPIs have `formula_spec=NULL` because their source tables don't exist yet.
Build the minimum source tables + seed the formulas.

| KPI | Source needed | Action |
|---|---|---|
| `assignment_sla_compliance` | assignment timestamps on workitems | Add `assigned_at` + `first_response_at` columns to `workitem` table; wire formula |
| `feasibility_pass_rate` | coverage_check records | Add `coverage_check` entity_def + seed; formula = passed/total |
| `schedule_fill_rate` | scheduling capacity windows | Add `schedule_slot` entity_def + seed; formula = filled/total |

**Files:** new alembic migrations, `seed_catalog.py`, `seed_kpi_formulas.py`
**Done when:** All 14 KPI formulas have `formula_spec != NULL`; `/api/kpis` returns values for all 14.
**Effort:** ~3 hours
**Status:** ⬜ TODO

---

### R-08 · 16 stub nav views — build real pages
**What:** These modules currently show a "coming soon" stub. Build minimal but real views.
Grouped by difficulty:

#### R-08a · Small (entity-backed — EntityView already handles these)
Wire `viewType: 'entity'` + correct `slug` in `nav-config.ts`:
| Module | entity_key / slug |
|---|---|
| Tariff Plans | `tariff_plan` (check seed_catalog) |
| Sales Channels | `sales_channel` |
| Collections | `collection_case` |
| Stock Inventory | `stock_item` |
| Finance (expenses) | `expense` |
| Accounting (invoices alias) | → redirect to `invoices` view |
| Procurement (UI) | `purchase_order` |
| Legal | `contract` |

#### R-08b · Medium (need a dedicated view component)
| Module | What to build |
|---|---|
| Global Search | `GlobalSearchView.tsx` — search bar + results grouped by entity type; uses `/api/search` (after R-04 adds facets) |
| Recent Items | `RecentItemsView.tsx` — calls `/api/activity?limit=50&mine=true`; shows last-accessed records |
| Team Workspace | `TeamWorkspaceView.tsx` — list of org nodes + members with workitem counts; uses `/api/org` |

#### R-08c · Large (ISP-specific, need backend + frontend)
| Module | What to build |
|---|---|
| Network Topology | `NetworkTopologyView.tsx` — graph/map of sites/POPs/circuits; uses `site` + `circuit` entity records |
| Provisioning | `ProvisioningView.tsx` — queue of pending service activations; uses `service` records filtered to PENDING |
| Scheduling | `SchedulingView.tsx` — calendar grid of `schedule_slot` records (needs R-07 source data) |
| Dispatch Board | `DispatchBoardView.tsx` — kanban of `workitem` records by assignment; uses existing workitems API |
| Coverage & GIS | `CoverageView.tsx` — map embed (Leaflet) over `coverage_check` entity records |

**Files:** `frontend/src/lib/nav-config.ts`, `frontend/src/views/*.tsx`, `frontend/src/App.tsx`
**Done when:** Zero modules show "coming soon" stub.
**Effort:** R-08a ~1 hr · R-08b ~4 hrs · R-08c ~2 days
**Status:** ⬜ TODO

---

### R-09 · Wave 4 NOT NULL — remaining 21 FKs
**What:** After R-07 adds `assigned_at`/`first_response_at` to workitem, and after R-08c adds
schedule/coverage data, we'll have enough real rows to assess NULL rates. At that point tighten
the 21 remaining nullable Wave 1 FKs with a pre-flight NULL check per column.
**Constraint:** Do NOT run until we have real customer data (or at minimum R-07/R-08c data) to
confirm 0 NULL rows before each alter.
**Files:** new alembic migration
**Done when:** All 21 columns have been either tightened or explicitly documented as "must stay nullable" with reason.
**Effort:** ~2 hours (mostly the pre-flight checks)
**Status:** ⬜ BLOCKED on R-07 + R-08c data

---

### R-10 · Studio TODOs — 12 remaining pane items
**What:** Non-blocking UI polish in StudioRichPanes.tsx:
1. Page-types registry bind → `/api/studio/page-types`
2. Layout-blocks palette → `/api/studio/layout-blocks`
3. Component palette → `/api/studio/components`
4. Page content save → `PUT /api/pages/{pageId}/content`
5. Automation rule-builder UI (replace free-text condition with field picker)
6. Automation rule persistence → `POST /api/automations`
7. Preview impersonation role picker → `/api/roles`
8. Template gallery + instantiate → `/api/templates`
**Files:** `frontend/src/studio/StudioRichPanes.tsx`, possible new backend endpoints
**Done when:** No `TODO` comments remain in StudioRichPanes.tsx.
**Effort:** ~1 day
**Status:** ⬜ TODO

---

### P · Payment Gateways — LAST (intentionally deferred)
**What:** Every ISP customer picks their own processor. Build a clean, complete foundation that
any gateway can plug into. Then implement all 4 adapters to the extent possible without live
merchant credentials.

**Adapters to finish:**
| Adapter | Current state | What's left |
|---|---|---|
| **ARCA** (Armenian bank card processor) | `verify_callback` ✅; `initiate` stub | Wire real order-registration HTTP call (need merchant credentials slot) |
| **iDram** (Armenian wallet) | Scaffold only | Implement full flow per iDram API spec |
| **TelCell** (Armenian telecom wallet) | Scaffold only | Implement full flow per TelCell API spec |
| **EasyPay** (add new) | Not started | New adapter following same interface as ARCA |

**Interface contract** (`adapters/base.py`):
- `initiate(amount, currency, order_id, return_url) → {redirect_url, session_id}`
- `verify_callback(payload) → {status, order_id, amount}`
- `check_status(session_id) → {status}`

**Files:** `backend/app/adapters/payment/arca.py`, `idram.py`, `telcell.py`, new `easypay.py`
**Done when:** All 4 adapters implement the full interface; credential slots documented in `.env.production.example`; each adapter has a unit test with mocked HTTP responses.
**Effort:** ~1 day per adapter (4 days total, excluding live credential testing)
**Status:** ⬜ LAST — do not start until R-01 through R-10 are complete

---

## STATUS BOARD

| # | Item | Effort | Status |
|---|---|---|---|
| R-01 | Fix batch21 conftest skips | 30 min | ✅ |
| R-02 | Fix StudioRichPanes hardcoded URLs | 15 min | ✅ |
| R-03 | OPS runbook + .env.production template | 1 hr | ✅ |
| R-04 | Search facets + highlight | 2 hrs | ✅ |
| R-05 | Wave 5 polymorphic triggers (asset/pipeline_item) | 1 hr | ⬜ |
| R-06 | §4.4 field-level encryption activate | 3 hrs | ⬜ |
| R-07 | 3 missing KPI formulas (add source data) | 3 hrs | ⬜ |
| R-08a | Stub nav views — entity-backed (8 modules) | 1 hr | ⬜ |
| R-08b | Stub nav views — medium (3 modules) | 4 hrs | ⬜ |
| R-08c | Stub nav views — large ISP modules (5 modules) | 2 days | ⬜ |
| R-09 | Wave 4 NOT NULL tightening | 2 hrs | ⬜ BLOCKED on R-07+R-08c |
| R-10 | Studio TODOs (12 pane items) | 1 day | ⬜ |
| P | Payment gateways (ARCA+iDram+TelCell+EasyPay) | 4 days | ⬜ LAST |

**Total estimate (excl. P):** ~4.5 days of focused work
**Payment gateways (P):** ~4 additional days

---

*Last updated: 2026-05-31 · Suite: 632/0 · HEAD: c9547d4*
