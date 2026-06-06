# GAAhex — Customer Journey Maps (C.2)

> **Layer:** Product & UX Research (Track C). **Status:** CREATE — first authored 2026-06-06.
> Per **LAW-GV3**: CREATE → REVIEW → AUDIT → NORMALIZE → GAP ANALYSIS → LOCK → PROCEED.
> Reads from [`USER_PERSONAS.md`](./USER_PERSONAS.md) (C.1). Feeds [`INFORMATION_ARCHITECTURE_REVIEW.md`](./INFORMATION_ARCHITECTURE_REVIEW.md) (C.3) and `ANALYTICS_EVENTS_PLAN.md` (C.6).

## Purpose

The end-to-end arcs a subscriber and the operators travel, mapped to **GAAhex surfaces,
locked lifecycle states, and emotional touchpoints**. The test: *at every step, is the right
operator served by the right surface, and is the customer's experience intact?* Where a step
has no working surface, it's a flagged gap — not a glossed assumption.

## LAW-GV5 source evidence (searched before authoring)

- `docs/runbooks/DAILY-LOOP.md` — Lead → Customer → Order → Service → Ticket operational chain
- `docs/specs/BILLING.md` — invoice state machine (DRAFT → ISSUED → PAID/OVERDUE → VOID), dunning
- `docs/specs/HELPDESK.md` — ticket lifecycle (OPEN → IN_PROGRESS → RESOLVED → CLOSED), SLA sweep
- `docs/specs/WORKITEMS.md` — field-work lifecycle (TODO → IN_PROGRESS → DONE)
- `docs/standards/11-pipeline-lifecycle-page-behavior-standards.md` — Lead-to-Customer pipeline, B5 one-owner-per-stage
- `backend/docs/kernel-build/STEP-04-PIPELINE-CONTROL-GATE.md` — Stage-8 control gate (Sales → Fulfillment)
- `docs/specs/PAYMENTS-GATEWAY.md` — online payment flow (Idram/TelCell/ARCA + DevGateway)

## Concretizing context

Same ~5,000-subscriber Yerevan fiber ISP as [C.1](./USER_PERSONAS.md). Swap in the locked
pilot's real taxonomy when available.

**Legend:** 🟢 working surface today · 🟡 partial/manual · 🔴 gap (no working surface yet).

---

## Journey A — Prospect → Subscriber (acquisition + activation)

The most important journey: it crosses Sales → Ops → Field → Billing and contains the
**Stage-8 control gate** (the one mandatory checkpoint between selling and fulfilling).

| # | Stage | What happens | Persona | Customer emotion | GAAhex surface | Status |
|---|---|---|---|---|---|---|
| A1 | Lead captured | Prospect enquires; lead created (`LEAD`) | Sales (Tigran) | curious / hopeful | CRM → Pipeline | 🟢 |
| A2 | Qualified | Coverage + credit check; lead `QUALIFIED` | Sales | "can I even get fiber?" | CRM; coverage check | 🟡 (coverage manual) |
| A3 | Won → Order | Deal won; order created from pipeline item | Sales → Billing | committed | CRM → Order | 🟢 |
| A4 | **Stage-8 control gate** | Order validation: commercial + technical pass before fulfillment | Billing/Revenue Control | (invisible to customer) | `control_gate.py` | 🟢 (gate real; today hard-blocks until `control_pass=TRUE`) |
| A5 | Provisioning | OLT bind + RADIUS account created on service activation | NOC + Field | "when's my install?" | OSS; OLT driver; RADIUS | 🔴 (fail-closed stubs — M1) |
| A6 | Install scheduled | Work item created, dispatched to a technician | Dispatch (Marina) | anticipating | Workforce → Dispatch | 🟢 |
| A7 | Install done | ONT installed, CPE bound, gear issued by serial | Field (Sergey) + Warehouse (Hovik) | relieved / "is it fast?" | Work Items (mobile); Inventory | 🟢 work item / 🔴 inventory |
| A8 | Service active | Service flips active; subscriber can authenticate (PPPoE/IPoE) | NOC | satisfied | OSS service lifecycle | 🟡 (depends on A5) |
| A9 | First invoice | First subscription invoice issued (`ISSUED`) | Billing (Lusine) | "as expected?" | Billing; invoice | 🟢 |

**Emotional low-point:** A5–A8 — the wait between "I said yes" and "internet works." If
provisioning (A5) isn't wired, the install (A7) can't truly activate (A8). **This is the
journey's critical gap and the M1 priority.**

---

## Journey B — Living Subscriber (steady state, monthly)

The 99%-of-the-time journey. Mostly invisible — which is the goal.

| # | Stage | What happens | Persona | Customer emotion | GAAhex surface | Status |
|---|---|---|---|---|---|---|
| B1 | Monthly invoice | Billing cycle issues invoice (idempotent on `last_invoiced_at`) | Billing | neutral | Billing cycle (`run_cycle`) | 🟢 |
| B2 | Notified | Invoice notification (inbox always; email/SMS if opted-in) | (system) | "time to pay" | Notifications | 🟢 |
| B3 | Pays | Pays online via portal or auto; invoice flips `PAID` when cumulative ≥ total | End Customer | "done, easy" | Portal Bills; Payment gateway | 🟡 (portal auth blocker; real providers dormant) |
| B4 | Self-serve check | Views balance, service status, usage | End Customer | in control | Portal Dashboard | 🟡 (portal legacy auth) |
| B5 | Occasional ticket | Opens a support ticket when something's wrong | End Customer → Support | frustrated → hopeful | Portal Support → Helpdesk | 🟡 (portal i18n 0%) |

**Emotional risk:** B3/B4 — the portal is the only surface the customer touches, and it's on
**legacy auth + 0% i18n**. A Yerevan subscriber hitting an English-only portal that 403s on
payment is the worst first impression. **Phase-1 prod blocker.**

---

## Journey C — Incident → Resolution (outage)

Trust is won or lost here. Crosses NOC → Dispatch → Field → Support.

| # | Stage | What happens | Persona | Customer emotion | GAAhex surface | Status |
|---|---|---|---|---|---|---|
| C1 | Outage detected | OLT PON drop / RADIUS auth spike surfaces | NOC (Davit) | (not yet aware) | NOC dashboard; Observability | 🟡 (health signals partial) |
| C2 | Impact roll-up | "Which subscribers are down?" via relationship traversal | NOC | — | Relationship Core | 🟡 |
| C3 | Incident opened | Incident created, severity set, comms started | NOC | angry calls start | Network → Incidents | 🟢 |
| C4 | Field dispatched | If physical, a repair work item → technician | Dispatch → Field | "when fixed?" | Workforce | 🟢 |
| C5 | Tickets correlated | Inbound tickets linked to the incident (one truth) | Support (Anush) | "do they know?" | Helpdesk; SLA | 🟢 |
| C6 | Resolved | Fix applied, service restored, incident + tickets closed | NOC + Support | relieved | OSS; Helpdesk close | 🟢 |
| C7 | Post-mortem | Audit trail + repeat-prevention | NOC | (trust restored or not) | Audit; Reporting | 🟡 |

**Emotional low-point:** C1–C3 — the gap between "their internet is down" and "we know and
we're on it." If impact roll-up (C2) is slow, Support (C5) is blind while customers rage.

---

## Journey D — Dunning / Suspend / Reactivate / Churn

The money-and-goodbye journey. Crosses Billing → Support → Compliance.

| # | Stage | What happens | Persona | Customer emotion | GAAhex surface | Status |
|---|---|---|---|---|---|---|
| D1 | Overdue | Invoice past `due_at` → `OVERDUE`; dunning fires | Billing | "I forgot" / "can't pay" | Dunning (`run_dunning`) | 🟢 (manual; per-tenant flag) |
| D2 | Reminders | Dunning notifications escalate | (system) | nudged / annoyed | Notifications | 🟢 |
| D3 | Suspend | Service suspended after grace; can still reactivate | Billing + NOC | cut off | Service lifecycle | 🟡 |
| D4a | Reactivate | Pays → service resumes | End Customer → Billing | relieved | Portal; Billing | 🟡 |
| D4b | Churn | Cancels; subscription `CANCELLED` | Support | done / regretful | CRM; Billing | 🟢 |
| D5 | Erasure (if requested) | GDPR erasure → PII anonymized on purge | Compliance (Ani) | (legal right) | Privacy (Art.17) | 🟡 (minimum-viable) |

**Emotional fork:** D3 — suspension is the make-or-break. Done coldly (English SMS, no
context) it guarantees churn; done with a clear, human dunning voice it recovers the account.
Ties directly to **Track D (Content/Voice)** — the dunning copy is unwritten.

---

## Cross-journey gap summary (for REVIEW → AUDIT → C.3 IA review)

| Gap | Journey(s) | Severity | Track owner |
|---|---|---|---|
| Provisioning (OLT/RADIUS) fail-closed | A5, A8 | 🔴 critical | M1 Phase 2 (eng) |
| Portal legacy auth + 0% i18n | B3, B4, B5 | 🔴 critical | M1 Phase-1 (eng + Track D) |
| Coverage check manual | A2 | 🟡 | M1 |
| Inventory/warehouse absent | A7 | 🟡 | M1 Phase 3 |
| Incident impact roll-up speed | C1–C2 | 🟡 | M1 (Observability) |
| Dunning/suspension voice unwritten | D1–D3 | 🟡 | Track D (content) |
| GDPR erasure minimum-viable | D5 | 🟡 | Track F (legal) + eng |

**Headline:** the two 🔴 gaps (provisioning + portal) sit on the **happiest and the most-used**
journeys (getting connected, paying the bill). Every architecture decision is sound; these
are wiring + UX-surface gaps, not design gaps. They are the M1 critical path.

## Next in Track C

- **C.3** `INFORMATION_ARCHITECTURE_REVIEW.md` — audit the locked nav tree (04 §7.1) against each persona + each journey step above (does the operator reach the right surface in ≤2 clicks?).
- **C.4** `ONBOARDING_FLOW.md` · **C.5** `PILOT_INTERVIEW_SCRIPT.md` · **C.6** `ANALYTICS_EVENTS_PLAN.md`.
