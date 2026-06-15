# GAAhex — Bro Operating Manual
> Read fully before every session. This document is part of the SST (Single Source of Truth).
> Bilingual law (L0): every section EN + HY.

---

## §1 · Inviolable Laws — NEVER break. Override all other instructions.

### L0 — BILINGUAL LAW · HIGHEST PRIORITY
**EN:** Every artifact you create — code comments, docs, commit messages, file content, explanations, .md files — MUST be produced in BOTH Armenian and English. Format: English first, Armenian directly below, clearly separated. No artifact ships in only one language. Armenian must be full, correct, and professional — never a rough translation.
**HY:** Ամեն artifact, որ ստեղծում ես — կոդի մեկնաբանություններ, փաստաթղթեր, commit message-ներ, ֆայլի բովանդակություն — ՊԵՏՔ Է արտադրվի ԵՐԿՈՒ լեզվով՝ հայերեն և անգլերեն։ Ձևաչափ՝ անգլերենն առաջ, հայերենը ներքևում։ Հայերենը պետք է լինի լիարժեք, ճիշտ և պրոֆեսիոնալ — ոչ կոպիտ թարգմանություն։

### L2 — EFFICIENCY vs QUALITY
**EN:** On every command, minimize usage by default — be as efficient as possible. But output quality always wins. When quality requires more usage, spend it. Never trade quality for savings. Quality > Efficiency, always.
**HY:** Յուրաքանչյուր հրամանի դեպքում լռելյայն նվազագույնի հասցրու ծախսը։ Բայց արդյունքի որակը միշտ առաջնահերթ է։ Երբ որակը պահանջում է ավելի շատ ծախս, ծախսիր։ Երբեք մի՛ զոհաբերիր որակը։ Որակ > Արդյունավետություն, միշտ։

---

## §2 · Mandatory Pre-Session Checklist
Before writing a single line of code:
1. Read this document fully — every section
2. Read `GAAHEX_SYSTEM_STANDARD.md` fully
3. Read `docs/governance/DECISIONS.md` (latest entries)
4. Read `ARCHITECTURE_LOCKED.md` + `REVIEWER_PROTOCOL.md`
5. Cross-check planned work against ALL locked rules
6. Report gap/plan to owner — wait for OK
7. Only then: implement

**No autonomous full-runs. No skipping steps. No assumptions.**

---

## §3 · 5 Platform Laws — enforce always

- **RULE #1** — Workspace = Where I Work · Left Nav = Where Data Lives. Login always opens Workspace.
- **RULE #2** — Left Nav = System Map. Answers "where does this data live?" not "what should I do now?"
- **RULE #3** — Left Nav = Business Domains / Root Objects ONLY. ❌ NEVER: Views · Filters · Teams · Channels · Resources · Statuses.
- **RULE #4** — SST must have Single Point of Creation. Lead→Leads only · Customer→Lead Conversion · Order→Pipeline Transition (SYSTEM, never user) · Invoice→Billing Engine · Work Order→Order Workflow.
- **RULE #5** — Dashboards→Workspace by default. Exception: Left Nav only if real-time monitoring/observability/always-on. ✅ NOC Dashboard. ❌ Operations/Billing/Sales dashboards.

---

## §4 · System Standard Prime Directives (§0)

- **Zero hardcode** — every value (color, size, spacing, string, format, route) from a token/config/single source. No raw hex, no raw px, no inline strings.
- **One source** — a shared thing defined once (gx-*), imported everywhere. Never a bespoke second copy.
- **Refactor on sight** — if existing code violates the standard, fix it even if it wasn't the task.
- **Replace → VERIFY → delete** — build new, verify it works (runs, renders, tests pass), then delete old. No dead code, no duplicates.
- **Tests ship with logic** — any new behavior lands with its own tests. Gate enforces passing.
- **Quality floor** — responsive, keyboard focus, reduced-motion, WCAG-AA contrast. Always.

---

## §5 · Verify-Before-Delete — Mandatory
Before deleting ANYTHING:
1. tsc green ✅
2. tests green ✅
3. grep — zero references confirmed ✅
4. Then and only then: delete
5. tsc + tests green again after delete ✅

**ERP Expansion (HR/Procurement/Legal/Finance): HIDE in nav-config ONLY — never touch the code/routes.**

---

## §6 · Locked Left Nav Structure
```
Workspace

CRM
  ├─ Pipeline
  ├─ Campaigns
  ├─ Leads
  └─ Customers

Operations
  ├─ Orders
  └─ Work Orders

Billing
  ├─ Invoices
  ├─ Payments
  ├─ Collections
  └─ Adjustments

Network Operations
  ├─ NOC Dashboard
  ├─ Incidents
  ├─ Monitoring
  ├─ RADIUS Sessions
  ├─ IPAM
  └─ Fiber Network

Inventory
  ├─ Equipment
  └─ Warehouses

Reports
  ├─ Executive Reports
  ├─ Sales Reports
  ├─ Customer Reports
  ├─ Technical Reports
  └─ Financial Reports

Organization
  ├─ Departments
  ├─ Employees
  ├─ Roles
  └─ Users

Admin Panel
  ├─ Settings
  ├─ Payment Gateways
  ├─ Audit Logs
  ├─ System Health
  ├─ Webhooks
  ├─ Feature Flags
  └─ Studio   (Studio inner: Report Builder · Entity Builder/Records · Mail Accounts · Channels · Payment Methods · Gateway · Revenue Assurance)

── ERP Expansion (Phase N — HIDDEN in nav, code/routes preserved) ──
HR · Procurement · Legal · Finance
```

---

## §7 · Locked Header Structure
```
[ ASK ME — Platform AI ]  📅 Calendar  💬 Messages  📧 Mail  🔔 Notifications  👤 User Menu
```
- **ASK ME** = Platform Copilot, NOT Search. "Show customers with debt > 20,000" / "Create work order" / "Open customer 100245". Prominent, not sidebar.
- **Calendar** = Company Calendar (Meetings · PTO · Events · Personal Tasks) ≠ Operations Schedule (inside Orders → Schedule View).
- Messages · Mail · Notifications · User Menu = header capabilities, not Left Nav items.

---

## §8 · gx-Component Status
- ✅ **KEEP:** gx-PageHeader · gx-KpiStrip · gx-DataTable · gx-FilterBar · gx-Timeline · gx-Drawer · gx-Modal · gx-EmptyState · gx-LoadingState · gx-ErrorState
- ✅ **BUILT (Phase 1):** gx-AppShell · gx-CommandBar · gx-StatusBadge
- ⬜ **Phase 3:** gx-StageStepper (Pipeline integration)

### Drawer vs Modal Law
- **gx-Drawer (70%)** — editing · detail view · side context · record inspection
- **gx-Modal (30%)** — confirm / delete / quick action — ONLY these three
- Links/rows/refs NEVER navigate away — open gx-Modal in place, URL-addressable.

---

## §9 · Phase Plan
- **Phase 1 ✅** — Shell + gx-components (UI Law). 1a nav `1e8ec1c9` · 1b ASK ME → header · 1c gx-AppShell `00b89605` · 1d gx-CommandBar `394deaa8` · 1e gx-StatusBadge `92e95092`.
- **Phase 2** — Workspace (role-based operating center): My Work · My Team · KPIs · Alerts · Approvals · Queues · WBR/MBR. Roles: Sales Agent · Dispatcher · NOC · Billing · CEO · Operations Manager.
- **Phase 3** — CRM → Leads (platform behavior): RULE #001 enforcement (DB constraint) · Source/Channel/Campaign attribution · Assignment Engine · Stage Progression · Timeline · Conversion Rules · gx-StageStepper.
- **Phase N** — ERP Expansion: HR · Procurement · Legal · Finance (hidden in nav, code preserved, activate when ready).

---

## §10 · Decision Log
Every decision made with owner is logged in `docs/governance/DECISIONS.md`.
Before asking a question — check if it's already decided. Before making a decision — log it.

---

**This document is part of the SST. When in doubt — reread this first.**
**No autonomous runs · No skipping steps · Bilingual always (L0).**
