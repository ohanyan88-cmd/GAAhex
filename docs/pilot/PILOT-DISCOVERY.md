# Pilot ISP — Discovery

**Status:** FRAMEWORK · awaiting real pilot input
**Created:** 2026-06-10 · M1 Phase 3 prerequisite (`Pilot.Discovery` in the execution queue)
**Purpose:** capture the pilot ISP's real operational model so the 3–5 tenant-custom entities
(M1 Phase 3) are defined from **fact**, not assumption — and so provider integration (Phase 2)
doesn't get built against a shape that later changes (rework avoidance).

> ⚠️ **How to read this file.** Sections marked **`⬜ PILOT INPUT`** require answers from the real
> pilot ISP (or Gev). They are deliberately NOT filled with invented data — fabricating the pilot's
> branches / customer types / tariffs would violate LAW-GV5 (search-first, no invention) and the
> "no fake data" doctrine. Sections marked **`✅ PLATFORM TODAY`** describe what GAAhex already
> ships, so we know what is reuse vs. genuinely new. When the pilot answers, replace each `⬜` block
> with the concrete value + the date it was confirmed.

> **Output contract.** Once this file is filled, it drives:
> - the Phase 3 custom-entity list (the "Custom Entity Discovery" section maps 1:1 to `POST /meta/entities` payloads in the onboarding runbook),
> - the Phase 2 provider selection (only wire the providers the pilot actually uses),
> - the KT-M1-1 / KT-M1-2 fixtures (their lifecycles should mirror the pilot's real ones).

---

## 0. Pilot identity — ✅ HouseNet (confirmed 2026-06-10 by Gev + housenet.am)

**Pilot = HouseNet** (https://www.housenet.am). FTTH ISP in Armenia.
Coverage: Vagharshapat (Etchmiadzin), Armavir, Metsamor, Nalbandyan, Bambakashat, Jrashen.

### ✅ CONFIRMED (Gev 2026-06-10 + public site)

| Area | HouseNet |
|---|---|
| **Customer types** | Residential + Business *(no reseller/gov confirmed yet — assume these two)* |
| **Services** | Internet only + IPTV. **NO VoIP/phone.** Internet residential: Lite 40 / Plus 100 / Max 200 / Ultra 300 / Ultimate 500 Mbps (6,000–12,900 AMD/mo). Business: Corp Start 40 / Elite 80 / Pro 100 / Premium 300 (7,000–40,000 AMD/mo). IPTV: 129–130 channels (standalone 4,000 AMD/mo; Premium = Dolby Atmos). |
| **Bundles** | **Fixed packages** (operator-defined; customer does not mix-and-match). Internet+TV bundled into the named plans. |
| **Provisioning** | **Platform DEFAULT flow** — HouseNet uses the system's standard provisioning lifecycle (no custom variant). |
| **Equipment** | VSOL HG5020 (WiFi6 router/ONU) · Xiaomi Mi Router 4A · Google Chromecast w/ Google TV · onn Android TV 4K box. |
| **Integrations — notifications** | **SMS + Telegram + WhatsApp** (customer messaging). Email = the GAAhex Mail module (per-tenant SMTP, ✅ shipped). |
| **RADIUS / BNG** | **NONE.** HouseNet does not use RADIUS → M1 Phase 2.D (FreeRADIUS) is OUT for this pilot. |
| **Monitoring / network** | **Built-in GAAhex NMS section** (no external system). Everything connects to HouseNet's **VSOL OLTs** (provision + monitor via VSOL CLI — see [[vsol-v1600-cli-dialect]]). |

### ✅ DISCOVERY COMPLETE (Gev 2026-06-10)
1. **Payment** — HouseNet accepts **ALL** methods: Idram · Telcell · bank transfer · cash at office · card. (Existing payment-gateway adapters cover these — REMAINING-WORK item P.)
2. **Custom entities** — **ZERO.** Standard {customer, invoice, ticket, service} + the built-in NMS cover HouseNet entirely. → **M1 Phase 3 (custom entity catalog) is TRIVIAL / effectively a no-op for this pilot.**

### 🔨 ENGINEERING surfaced — the next major build: PER-TENANT MESSAGING CHANNELS
Gev's directive: build SMS / Telegram / WhatsApp **exactly like the Mail module — per-tenant, multi-tenant from day one** ("imagine 5 customers tomorrow, each with their OWN separate" channel credentials). Each tenant ISP configures its own bot/sender/credentials, encrypted at rest, RLS-scoped, routed through `channels.dispatch` per-tenant — the `mail_account` → `SmtpEmailGateway` pattern applied to messaging.
- **Telegram** — HouseNet already uses it → per-tenant Bot API (bot token + chat resolution).
- **SMS** — HouseNet has none; wants it via **Viva Armenia (Viva-MTS)** SMS gateway → per-tenant Viva API credentials.
- **WhatsApp** — new; per-tenant WhatsApp Business Cloud API credentials.
- (Existing `channels.py` SMS=Twilio / email adapters are GLOBAL env-based; this module makes channels **per-tenant** like Mail.)
- **NMS ↔ VSOL wiring** — the NMS section actually driving HouseNet's VSOL OLTs (provision/monitor via the documented VSOL CLI) — separate track.

---

### Original framework fields (legacy — superseded by the confirmed table above)

| Field | Value |
|---|---|
| Pilot ISP name | **HouseNet** (housenet.am) |
| Rough subscriber count | ⬜ PILOT INPUT |
| Current system being replaced | ⬜ PILOT INPUT |
| Pre-existing data to migrate (Y/N + rough volume) | ⬜ PILOT INPUT |
| Target cutover window | ⬜ PILOT INPUT |

---

## 1. Organization

**✅ PLATFORM TODAY:** OrgNode tree (ltree-pathed, RLS-scoped), Roles (RoleDef + Assignment at a node),
scope rules (self / node / subtree), per-node ownership of records. Technician/team hierarchy is
modeled as org nodes + role assignments — no new model needed.

| Question | Answer |
|---|---|
| Branches / offices (names + hierarchy) | ⬜ PILOT INPUT |
| Regions / service areas | ⬜ PILOT INPUT |
| Teams (sales / support / NOC / field / finance / …) | ⬜ PILOT INPUT |
| Technician hierarchy (lead tech → tech → contractor?) | ⬜ PILOT INPUT |
| Who can see whose data (scope expectations) | ⬜ PILOT INPUT |
| Approx. headcount per team | ⬜ PILOT INPUT |

**Mapping note:** each branch/region → an OrgNode; each team → a role at a node; technician hierarchy
→ nested nodes or role tiers. Confirm whether any of this needs a *config* entity vs. just org tree.

---

## 2. Customers

**✅ PLATFORM TODAY:** built-in `customer` entity (config-defined): fields name/email/phone/plan/status;
lifecycle `PROSPECT → ACTIVE → SUSPENDED ⇄ ACTIVE → CHURNED`; guard `email present` on PROSPECT→ACTIVE.
`customer_type` is NOT yet an enum field — M1 adds it via config (S1).

| Question | Answer |
|---|---|
| Customer segments actually used | ⬜ PILOT INPUT (candidates: RESIDENTIAL · BUSINESS · WHOLESALE · GOVERNMENT) |
| Per-segment fields that differ | ⬜ PILOT INPUT |
| Required vs. optional customer fields | ⬜ PILOT INPUT |
| KYC / regulatory fields (tax id, national id, license) | ⬜ PILOT INPUT |
| Customer lifecycle states the pilot uses | ⬜ PILOT INPUT (platform default: PROSPECT/ACTIVE/SUSPENDED/CHURNED) |
| Any state the platform default is missing (e.g. LEAD, PENDING_KYC) | ⬜ PILOT INPUT |

---

## 3. Services

**✅ PLATFORM TODAY:** `tariff_plan` catalog + `service` records exist as built-ins; service lifecycle
is config-defined. Bundles are not first-class — confirm if needed.

| Question | Answer |
|---|---|
| Service types offered | ⬜ PILOT INPUT (candidates: INTERNET · IPTV · VOIP · BUNDLE) |
| Per-service-type attributes (speed, channels, DID numbers…) | ⬜ PILOT INPUT |
| Bundle definitions (which services combine, pricing) | ⬜ PILOT INPUT |
| Tariff / plan catalog (names, speeds, prices, FUP) | ⬜ PILOT INPUT |
| Contract terms per service (commitment length, early-term fee) | ⬜ PILOT INPUT |
| Does a customer hold multiple concurrent services? | ⬜ PILOT INPUT |

---

## 4. Provisioning

**✅ PLATFORM TODAY:** WorkItem-movement (workflow) engine drives any status lifecycle declared via
`/meta/entities/{slug}/transitions`. Guards (incl. cross-record GXL as of 2026-06-10) gate transitions.
Provisioning is a workflow on the `service` entity — no provisioning-specific engine.

| Question | Answer |
|---|---|
| Provisioning stages (the real order) | ⬜ PILOT INPUT (candidate: PENDING → SURVEY_SCHEDULED → SURVEY_DONE → INSTALL_BOOKED → ACTIVATED) |
| **Create** — what triggers a new service order | ⬜ PILOT INPUT |
| **Activate** — preconditions (payment? survey? stock?) | ⬜ PILOT INPUT |
| **Suspend** — triggers (non-payment, abuse, request) | ⬜ PILOT INPUT |
| **Restore** — preconditions to un-suspend | ⬜ PILOT INPUT |
| **Disconnect** — soft vs. hard, reclaim equipment? | ⬜ PILOT INPUT |
| Provisioning variants per service type | ⬜ PILOT INPUT |
| Manual vs. automated steps (which need a human) | ⬜ PILOT INPUT |
| Cross-record guard conditions (e.g. "activate only if balance_due == 0") | ⬜ PILOT INPUT — these become GXL guards |

---

## 5. Billing

**✅ PLATFORM TODAY:** invoice / payment / dunning models exist; invoice lifecycle, payment allocation,
collections cases, credit notes all present. Payment **gateway** adapters scaffolded (Stripe + 4 local
processors), live wiring is Phase 2.

| Question | Answer |
|---|---|
| **Invoice lifecycle** states | ⬜ PILOT INPUT (platform has DRAFT/ISSUED/PAID/OVERDUE/VOID-ish) |
| Billing cadence (monthly / prepaid / postpaid / per-usage) | ⬜ PILOT INPUT |
| Proration rules | ⬜ PILOT INPUT |
| **Payment lifecycle** + accepted methods | ⬜ PILOT INPUT |
| **Debt / dunning lifecycle** (reminder cadence, suspend threshold) | ⬜ PILOT INPUT |
| Tax / VAT handling | ⬜ PILOT INPUT |
| Billing exceptions (disputes, write-offs, partial pay) | ⬜ PILOT INPUT |
| Currency | ⬜ PILOT INPUT |

---

## 6. Inventory / Network

**✅ PLATFORM TODAY:** NetworkInventory module (fiber routes, IPAM, RADIUS, broadcast tabs); OLT/ONU
vendor drivers exist (Huawei/ZTE/VSOL) but live hardware integration is post-M1-B (xfail'd hardware tests).

| Question | Answer |
|---|---|
| **OLT** vendors + models in the field | ⬜ PILOT INPUT (drivers: Huawei MA5800, ZTE C320, VSOL — confirm which) |
| **ONU** types | ⬜ PILOT INPUT |
| **Router / CPE** models issued to customers | ⬜ PILOT INPUT |
| **Fiber** plant tracking depth (routes, cables, cores) | ⬜ PILOT INPUT |
| **Splitter** hierarchy (1:8, 1:16, 1:32…) | ⬜ PILOT INPUT |
| **POP** / site list | ⬜ PILOT INPUT |
| Inventory ↔ customer linkage (which device serves which service) | ⬜ PILOT INPUT |
| Stock / warehouse tracking needed at pilot? | ⬜ PILOT INPUT |

---

## 7. Integrations

**✅ PLATFORM TODAY:** provider abstraction layer with `mock` defaults; deploy contract refuses `mock`
in production. Adapters present: SendGrid (email), Twilio (SMS), Stripe (payment), FreeRADIUS (RADIUS).

| Integration | Pilot uses? | Provider / details |
|---|---|---|
| **SMS** | ⬜ PILOT INPUT | ⬜ (platform: Twilio) |
| **Email** | ⬜ PILOT INPUT | ⬜ (platform: SendGrid) |
| **Payment** | ⬜ PILOT INPUT | ⬜ (platform: Stripe + ARCA/iDram/TelCell/EasyPay) |
| **RADIUS / BNG** | ⬜ PILOT INPUT | ⬜ (platform: FreeRADIUS; only if pilot drives a BNG) |
| **Monitoring** (SNMP/NMS/uptime) | ⬜ PILOT INPUT | ⬜ |
| Other (accounting export, gov reporting, maps) | ⬜ PILOT INPUT | ⬜ |

**Phase 2 gating rule:** only the integrations the pilot actually uses get wired. Each flips its
`*_PROVIDER` env var from `mock` to real and passes the deploy contract — no premature wiring.

---

## 8. Custom Entity Discovery

The heart of the M1 thesis: entities the pilot needs that the platform doesn't ship, each born from
`POST /meta/entities` (config only — no model classes, no routers). Classify each candidate.

### Required (blocks pilot go-live)
| Entity | Why | Fields (sketch) | Lifecycle (sketch) | Cross-record guards? |
|---|---|---|---|---|
| ⬜ PILOT INPUT | | | | |

> Candidates surfaced by the platform but unconfirmed for THIS pilot: `SiteSurvey`, `TowerInspection`,
> `OutageIncident`, `CustomerComplaint`, `RegulatoryReport`. Do **not** build any until the pilot
> confirms it's Required.

### Nice-to-have (post-go-live)
| Entity | Why | Defer reason |
|---|---|---|
| ⬜ PILOT INPUT | | |

### Rejected (explicitly out)
| Entity | Why rejected |
|---|---|
| ⬜ PILOT INPUT | |

**Acceptance for `Pilot.Discovery` (queue):** the *count* and *shape* of Required custom entities is
known and signed off → Phase 3 can define them via config; Phase 2 knows which providers to wire.

---

## 9. Open questions for Gev / pilot

1. Is there a real pilot data export we can inspect, or is discovery interview-only?
2. Which integrations are in-scope for the *first* cutover vs. later?
3. Any regulatory / compliance entity that is non-negotiable for go-live?
4. Does the pilot run its own RADIUS/BNG (decides whether Phase 2.D is in M1 or deferred)?

---

*This framework was authored 2026-06-10 as the structural half of `Pilot.Discovery`. The data half is
blocked on real pilot input — see the `⬜ PILOT INPUT` markers above.*
