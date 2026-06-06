# GAAhex — User Personas (C.1)

> **Layer:** Product & UX Research (Track C). **Status:** CREATE ✅ · REVIEW ✅ · AUDIT ✅ ·
> NORMALIZE ✅ (added personas 11–12, closed domain coverage) · GAP ANALYSIS ✅ (2 of 4 gaps
> closed; 2 remain pilot-dependent) → **awaiting Gev LOCK sign-off**. First authored 2026-06-06.
> Per **LAW-GV3**: CREATE → REVIEW → AUDIT → NORMALIZE → GAP ANALYSIS → LOCK → PROCEED.
> This file is the canonical persona registry; product, UX, IA, onboarding, and analytics
> work reads from here. Do not duplicate personas elsewhere — link to this file.

## Purpose

Who actually uses GAAhex, what their day is, where it hurts, and what "good" means to
them. The platform was architected from **51 cores → 12 domains → locked nav tree**. These
personas are the cross-check: *does the architecture serve real ISP work, or just itself?*
Every persona maps to the domains/nav surfaces it touches so IA review (C.3) can test the
nav tree per-persona.

## LAW-GV5 source evidence (searched before authoring)

- `docs/standards/01-strategic-product-direction.md` — explicit role names: Support / NOC / Dispatch / Sales / Billing / Administration / Management
- `docs/architecture/02_DOMAIN_ARCHITECTURE.md` §7 — 12 domains (CRM, OSS, BSS, Network, Inventory, Workforce, Billing, Portal, Studio, Automation, Reporting, Administration)
- `docs/architecture/04_NAVIGATION_ARCHITECTURE.md` §7.1 — locked nav tree (the IA each persona is tested against)
- `docs/runbooks/DAILY-LOOP.md` — Lead → Customer → Order → Service → Ticket operational chain
- `docs/standards/CONTENT_VOICE_STANDARD.md` — voice the product speaks to these personas

## Concretizing context

Written against **a ~5,000-subscriber fiber ISP in Yerevan** (PPPoE + IPoE, Huawei + ZTE
OLTs, flat-rate monthly billing in dram). This is the architecture's documented M1 target
shape. **Swap in the locked pilot ISP's real team, taxonomy, and scale when ready** — the
persona structure stays; only the specifics change.

## Scope honesty

- **Codified here:** Gev's operator knowledge — roles, day-in-the-life, frustrations, success metrics, GAAhex touchpoints.
- **NOT yet validated:** real user interviews, usability testing, brand-new needs discovery. Those wait for pilot ISP engagement (queued as C.5 Pilot Interview Script).

---

## The 10 personas

Each persona: **Who · A day · Frustrations (today, pre-GAAhex) · Success metric · GAAhex surfaces (domain → nav)**.

### 1. Support Agent — "Anush" (Tier-1, customer-facing)
- **Who:** Front line. Answers calls/chats, opens and resolves tickets, knows the common 20 problems cold. Lives in a queue all day.
- **A day:** Picks tickets from the support queue, triages (billing vs technical vs install), resolves what she can, escalates outages to NOC and field jobs to Dispatch. Watches her SLA clock.
- **Frustrations today:** Ticket state lives in 3 places (phone notes, a spreadsheet, memory). No single customer history. SLA breaches discovered after the customer is already angry.
- **Success metric:** First-contact resolution rate ↑; SLA-breach count ↓; time-to-first-response.
- **GAAhex surfaces:** **Helpdesk** (queues, tickets, SLA sweep) · customer 360 (CRM) · raises **Work Items** for field jobs. Nav: Workspace → Helpdesk; Customers.

### 2. NOC Engineer — "Davit" (Tier-2, network operations)
- **Who:** Watches the network. Owns incidents, correlates customer-impact, coordinates with field + vendors. Reads OLT/RADIUS health.
- **A day:** Morning health sweep (OLT uplinks, RADIUS auth failures, dunning-unrelated outages). When an OLT PON drops, sees which customers are impacted via relationship roll-up, opens an incident, drives it to resolution.
- **Frustrations today:** No map from "PON port X down" → "these 40 subscribers." Optical-power data scattered across vendor CLIs. Incident comms ad-hoc.
- **Success metric:** MTTR ↓; customer-impact known within minutes; repeat-incident rate ↓.
- **GAAhex surfaces:** **Network/OSS** (NOC dashboard, devices, incidents) · customer-impact via Relationship Core traversal · **Workforce** hand-off. Nav: Network/Operations.

### 3. Field Technician — "Sergey" (mobile-first, installs & repairs)
- **Who:** In a van. Does installs, repairs, surveys. Phone is the only screen he has. Needs the address, the job, the gear, and a way to close it out — offline if the basement has no signal.
- **A day:** Pulls his assigned work items for the day, drives the route, installs the ONT, binds the CPE, marks the job done with photos, moves to the next.
- **Frustrations today:** Paper work orders. Calls the office to know what's next. Re-visits because the gear/serial wasn't on the order.
- **Success metric:** Jobs/day ↑; truck-rolls per install ↓; first-time-fix rate.
- **GAAhex surfaces:** **Workforce** (Work Items: install/repair/survey, mobile) · Mobile/Offline (sync queue, server-wins conflict) · service activation triggers OLT/RADIUS. Nav: Workforce → My work.

### 4. Dispatch Coordinator — "Marina" (workforce scheduling)
- **Who:** The air-traffic controller for the field crew. Assigns jobs to technicians, balances load, reschedules around no-shows.
- **A day:** Looks at the dispatch board (jobs × technicians × time), assigns by skill/region/availability, watches for SLA-at-risk installs, reshuffles when a tech calls in sick.
- **Frustrations today:** A whiteboard and a phone. No view of who's free, who's overloaded, what's running late.
- **Success metric:** Schedule utilization ↑; late/missed appointments ↓; same-day reschedule speed.
- **GAAhex surfaces:** **Workforce** (dispatch board, assignment, calendar) · scheduling filters (date range, region). Nav: Workforce → Dispatch; Calendar.

### 5. Sales Rep — "Tigran" (CRM, acquisition)
- **Who:** Brings in new subscribers and B2B accounts. Works leads through the pipeline to activated customer.
- **A day:** New leads in, qualifies, moves them through the sales pipeline, hands a won deal to provisioning (order → service activation). Tracks his own numbers.
- **Frustrations today:** Leads in a notebook, no pipeline visibility, no handoff to ops — "sold" deals stall before install.
- **Success metric:** Lead→customer conversion ↑; cycle time ↓; pipeline value.
- **GAAhex surfaces:** **CRM** (leads, pipeline — Sales view) · order creation → **Billing**/provisioning handoff. Nav: Customers → Pipeline.

### 6. Billing Clerk — "Lusine" (BSS/Billing)
- **Who:** Owns the money flow. Runs invoicing, chases overdue accounts (dunning), reconciles payments.
- **A day:** Runs the billing cycle (subscriptions → issued invoices), reviews dunning (overdue → action), reconciles incoming payments (Idram/TelCell/ARCA), handles billing disputes from Support.
- **Frustrations today:** Manual invoice runs, no idempotency (double-bills), payment reconciliation by hand, no dunning automation.
- **Success metric:** Collection rate ↑; AR aging ↓; billing errors ↓; days-sales-outstanding.
- **GAAhex surfaces:** **Billing/BSS** (subscriptions, invoices, payments, dunning, payment gateway) · money in **luma** (minor units). Nav: Billing & Revenue.

### 7. Tenant Admin — "Karen" (the ISP's own configurator)
- **Who:** The customer ISP's power user. Configures *their* GAAhex — entities, fields, pages, workflows, roles, nav — without code. This persona is the living proof of the "config over code" thesis.
- **A day:** Adds a custom field to the service form, defines a new entity for their specific workflow, tunes a lifecycle's stages, sets per-tenant feature flags (e.g., dunning automation on/off), manages their staff's roles.
- **Frustrations today:** Every other platform = "submit a ticket to the vendor, wait 3 weeks for a code change." Can't shape the tool to their actual process.
- **Success metric:** Time-to-configure a new workflow (minutes, not weeks); zero vendor dependency for business-rule changes.
- **GAAhex surfaces:** **Studio** (entity/field/page/workflow builders) · per-tenant feature flags (`tenant_flag.py`) · roles/permissions. Nav: Studio. **Killer-test persona.**

### 8. Super Admin / Platform Operator — "Gev" (multi-tenant platform owner)
- **Who:** Runs the *platform* across all tenant ISPs. Onboards new tenants, watches platform health, holds the keys mortals don't.
- **A day:** Stands up a new tenant from config, monitors cross-tenant platform health (RLS engaged, deploy contract green, audit immutable), manages deploy-shape feature gates (RADIUS/OLT/import/warehouse availability), reviews platform-level audit.
- **Frustrations today (the meta-problem GAAhex exists to solve):** Every ISP wants a custom build; can't scale to a 2nd customer without forking the codebase.
- **Success metric:** Stand up tenant N+1 with **config only** (the platform thesis); zero cross-tenant leaks; one codebase, many ISPs.
- **GAAhex surfaces:** **Administration** (tenant lifecycle, platform health, deploy-shape gates, super-admin scope) · Observability (NOC, golden signals). Nav: Administration.

### 9. End Customer / Subscriber — "the household / SMB" (Portal, self-service)
- **Who:** The ISP's actual subscriber. Doesn't care about GAAhex — wants to see their bill, pay it, open a ticket when the internet's down. Touches GAAhex only through the **customer portal**.
- **A day (rare touch):** Logs into the portal, checks balance, pays an invoice online, opens a support ticket, sees their service status.
- **Frustrations today:** Calls the office for everything. No self-service. No idea what they owe or why.
- **Success metric:** Self-service rate ↑ (fewer support calls); online payment adoption; portal satisfaction.
- **GAAhex surfaces:** **Portal** (`frontend-portal`: Bills B35, Support B36, Services B37, Dashboard) · customer-scoped auth (`kind=customer`, HttpOnly cookie target). Nav: Portal (isolated — cannot reach Workspace pages).

### 10. Management / Owner — "the ISP director" (Reporting)
- **Who:** Runs the business. Doesn't operate tickets or invoices — reads the numbers and steers.
- **A day:** Opens the dashboards: MRR, churn, AR aging, subscriber growth, SLA health, field productivity. Asks "are we growing, are we collecting, are we keeping customers."
- **Frustrations today:** Numbers compiled by hand into a monthly spreadsheet, always stale, never trustworthy.
- **Success metric:** Decisions made on live data; one source of truth; KPIs visible without asking staff.
- **GAAhex surfaces:** **Reporting/Analytics** (dashboards — 29 charts live, KPI tiles per D17, scheduled reports). Nav: Analytics → Dashboards.

### 11. Warehouse / Stock Clerk — "Hovik" (Inventory) — *M1 scope*
- **Who:** Owns the physical gear — ONTs, routers, fiber, splitters. Receives vendor stock, issues serial-tracked equipment to field techs, runs counts.
- **A day:** Books in a vendor shipment, issues an ONT (by serial) to Sergey for today's installs, flags low stock on a popular router model, reconciles a count discrepancy.
- **Frustrations today:** Gear "walks off," no serial → customer trace, stockouts silently kill scheduled installs.
- **Success metric:** Stock accuracy ↑; install-blocking stockouts ↓; shrinkage ↓.
- **GAAhex surfaces:** **Inventory/Warehouse** (stock_item, transfer, receiving, bin) · serial links to **Work Items** (gear issued per install). Nav: Inventory. **Note:** warehouse subsystem is currently fail-closed/absent — this persona documents the M1 need.

### 12. Compliance / Data-Protection Officer — "Ani" (Administration) — *partial today*
- **Who:** Owns GDPR/data-protection duties. Handles subscriber access & erasure requests, ensures audit + retention defensibility.
- **A day:** Receives a subscriber data-access request, runs the access export, processes an erasure request through the privacy workflow, verifies the audit trail, responds within the legal SLA.
- **Frustrations today:** No system for data-subject requests, PII scattered across tables, "erasure" not real, no audit defensibility if regulators ask.
- **Success metric:** DSAR turnaround within legal SLA; zero unfulfilled erasure; audit defensible.
- **GAAhex surfaces:** **Administration/Compliance** (PrivacyRequest model, Art.15 access export, Art.17 anonymize) · append-only audit. Nav: Administration → Compliance. **Note:** minimum-viable today; full Art.12/21 pipeline + legal review pending.

---

## Persona → domain coverage matrix

| Persona | Primary domain | Primary nav surface |
|---|---|---|
| Support Agent | Helpdesk (CRM-adjacent) | Workspace → Helpdesk |
| NOC Engineer | Network / OSS | Network / Operations |
| Field Technician | Workforce | Workforce → My work (mobile) |
| Dispatch Coordinator | Workforce | Workforce → Dispatch; Calendar |
| Sales Rep | CRM | Customers → Pipeline |
| Billing Clerk | Billing / BSS | Billing & Revenue |
| Tenant Admin | Studio | Studio |
| Super Admin | Administration | Administration |
| End Customer | Portal | Portal (isolated) |
| Management | Reporting / Analytics | Analytics → Dashboards |
| Warehouse Clerk | Inventory | Inventory |
| Compliance Officer | Administration (Compliance) | Administration → Compliance |

**Coverage check:** all 12 domains now have at least one persona except **Automation**
(touched by Tenant Admin via workflow config — cross-cutting, not human-primary-owned).
Flag for C.3 IA review: *does Automation ever need a dedicated "Automation Author" operator
persona, or does it stay a Tenant-Admin capability?*

## Open gaps surfaced by this pass (for REVIEW → AUDIT)

1. ~~Warehouse/Inventory has no primary persona~~ → **RESOLVED** in NORMALIZE pass: added persona 11 (Warehouse/Stock Clerk), flagged M1-scope.
2. ~~Compliance/DPO persona absent~~ → **RESOLVED** in NORMALIZE pass: added persona 12 (Compliance/DPO Officer), flagged partial-today.
3. **Personas are operator-knowledge, not interview-validated** — every "frustration" is hypothesized from Gev's domain knowledge, not confirmed with the pilot ISP's actual staff (C.5 closes this). *Open — needs pilot.*
4. **Scale assumption (~5k subs) is a placeholder** — replace with the locked pilot's real subscriber count, OLT vendors, and auth mix. *Open — needs Gev/pilot.*

## Next in Track C (after this LOCKs)

- **C.2** `CUSTOMER_JOURNEY_MAPS.md` — Lead → Customer → Service → Incident → Resolution → Renewal/Churn, per persona, with emotional touchpoints.
- **C.3** `INFORMATION_ARCHITECTURE_REVIEW.md` — audit the locked nav tree (04 §7.1) against each persona above.
- **C.4** `ONBOARDING_FLOW.md` · **C.5** `PILOT_INTERVIEW_SCRIPT.md` · **C.6** `ANALYTICS_EVENTS_PLAN.md`.
