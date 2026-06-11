# Design brief — GAAhex **Leads page** redesign

> **You are a senior product designer + frontend engineer.** Redesign the **Leads page** of GAAhex.
> This brief is self-contained, but you are also being given the full set of source files that build
> this page (manifest at the end) — treat the code as ground truth for current behavior, data, and the
> design-system tokens you **must** reuse. Deliver a redesign that drops into this exact system.

---

## 1. What GAAhex is (just enough context)

GAAhex is a single platform that aims to be the **entire place of work for an ISP** (internet service
provider). It is **config-driven**: pages render from configuration, not hardcoded screens. The design
language is a **dark-first, dense, professional operations UI** — think a modern CRM/ops console, not a
marketing site. Pilot operator: **HouseNet** (residential + business internet/IPTV).

The **Leads page** is the **raw-entry inbox of the CRM** — the very first stage of the customer
lifecycle. A "lead" is a prospective customer captured by sales/field/call-center before they become
an order, then a customer. This page is where operators **see, search, triage, and open leads**, and
**create new ones** (including generating a real contract `.docx`).

It is deliberately **LEADS-ONLY** — orders and customers have their own pages. The lifecycle "control
gates" that used to sit on this page now live on the Pipeline page; **do not** add them back here.

---

## 2. Current anatomy of the page (what exists today)

The page is built on **PageShell** — a fixed 6-zone framework every GAAhex page uses. Zones from top:

1. **Header (Zone A)** — page icon + title **"Leads"**, and on the right of the same row:
   **Search box · Download button · `+ New Lead` button**. (These were just moved up here from a body
   toolbar — keep them in the header.)
2. **KPI band (Zone B)** — a row of weekly KPI tiles derived from the leads (e.g. *This week*, *vs last
   week*, status counts) with a small sparkline. KPI tiles follow standard **D17**: no premium
   highlight, colored value text + tooltip.
3. **View switcher** — a segmented control: **Table · Kanban · Cards** (the operator picks how to see
   the leads). Currently a row of 3 buttons at the top of the body.
4. **Body** — one of three views of the **same** lead list (default: 20 most recent):
   - **Table** — borderless rows, rounded outer frame. Columns: `Lead ID · Full Name · Address ·
     Phone · Email · Stage` + a row-actions menu. Clicking a row opens the lead.
   - **Kanban** — columns = the **lead lifecycle stages** (Commercial Gate: lead → validated → assigned
     → deal → contract signed). Responsive "fill" board (columns spread full width; horizontal scroll
     only when narrow). Cards are the lead card (below). Stage-transition buttons on each card.
   - **Cards** — a responsive grid (≈5 cols) of the lead card.
5. The **lead card** (shared by Kanban + Cards): whole card is a click target that opens the lead's
   360° detail; shows name, key contact fields, a **StatusPill** for the stage, and inline
   stage-transition actions.

**Lead data fields** (what one lead contains): full name, address, phone, email, document/passport
number, issued-by, date of birth, service interest, lead source, assigned sales rep, notes,
attachments, and a lifecycle **status/stage**.

**Key flows on the page:** search/filter leads · switch view · open a lead (detail/edit modal) ·
create a new lead via a multi-step **EntityFormModal** (which can **generate & download a real HouseNet
contract `.docx`** in one click) · move a lead through stages · export (Download).

---

## 3. HARD design-system constraints (non-negotiable — this is a LOCKED system)

This platform has a **certified, locked brand + standards package**. Your redesign must live *inside*
it, not replace it. Violating these is a no-go:

- **D20 — Token discipline.** **No hardcoded hex colors, no hardcoded px sizes, no static inline
  styles.** EVERY visual value (color, space, radius, font size, shadow, duration) must be a
  `--gx-*` CSS custom property applied via a CSS class. The full token set is in
  `frontend/src/styles/gaahex-tokens.css` — use those tokens only. (You may *propose* new tokens, but
  flag them; don't invent raw values.)
- **D18 — Color architecture (one family, one role; roles never overlap):**
  - **Cobalt** = brand spine · **Gold** = signature accent (sparing) · **Azure `#0EA5E9`** =
    interactive (links/actions/focus) · **Slate** = neutrals (surfaces/text/borders) ·
    **Semantic** = status only (success/warn/danger/info). Don't use a status color for decoration or
    an accent color for a status.
- **Brand v3.0 is LOCKED.** Don't redesign the logo, typography scale, or brand architecture. Name is
  **GAAhex™**.
- **Dark-first.** The app is dark by default; light theme comes "for free" through the same tokens, so
  never hardcode a color that wouldn't flip.
- **PageShell is the frame.** Keep the redesign expressed through the 6 PageShell zones (Header / KPI /
  Actions / Filters / Body / Context). Don't break out of the shell.
- **Density + accessibility.** Operators live in this screen all day: information-dense, fast,
  keyboard-accessible (real `<button>`s, focus states, aria labels), no decorative fluff.
- **Primitives.** Reuse existing primitives — `Button`, `Input`, `StatusPill` — rather than rolling new
  controls, unless you're proposing a primitive-level improvement (flag it if so).

---

## 4. What we want from you (deliverables)

1. **A redesigned Leads page** — visual concept + the actual implementation (React + CSS classes using
   `--gx-*` tokens), matching the current data/flows. Cover **all three views** (Table, Kanban, Cards),
   the **header** (title + search + Download + New Lead), the **KPI band**, and the **lead card**.
2. **Rationale** — short notes on the key decisions (hierarchy, density, scannability, what you changed
   and why), and how each choice respects D18/D20.
3. **Token usage** — only `--gx-*` tokens; if you need something not in the token file, list the
   proposed new tokens separately so we can decide.
4. **No regressions** — preserve every current capability: 3 view modes, search, export, create-lead
   (incl. the one-click contract `.docx` generation), open/edit a lead, stage transitions, the
   20-most-recent default, leads-only scope.

**Out of scope / do NOT touch:** the lifecycle control-gates (they live on the Pipeline page now),
orders/customers pages, the kernel/backend, the brand identity itself, or any other entity page.
EntityView is a *generic* component that renders every entity — keep your changes scoped to the
**leads** branches/behavior; don't break the generic path for other entities.

---

## 5. Source-file manifest (the files that build this page)

Grouped by role. The first two groups are leads-specific; the design-system group is shared — **read it
to match the system, but don't redesign it.**

### A. The Leads page itself (leads-specific)
- `frontend/src/views/EntityView.tsx` — the page component; look for the `isLeads` branches, the
  `leadCardEV` lead card, the Table/Kanban/Cards switcher, and the leads kanban.
- `frontend/src/views/entity/EntityFormModal.tsx` — the create/edit lead modal (multi-step + contract
  generation).
- `frontend/src/views/entity/FieldInput.tsx` — field renderer used inside the form.
- `frontend/src/views/entity/types.ts` — `pagePropsForSlug`, `mapEntityStatus`, lead types/helpers.
- `frontend/src/views/entity/kpis.tsx` — `deriveLeadsWeeklyKPIs` (the KPI band content) + section icons.
- `frontend/src/views/entity/api.ts` — entity data/export helpers.
- `frontend/src/views/LeadPipelineView.tsx` — the lead kanban board (also reused by the Pipeline page).

### B. Lead domain logic
- `frontend/src/lib/lifecycle.ts` — lifecycle stages + control-gate definitions (drives the kanban
  columns + StatusPill stages).
- `frontend/src/components/LeadGatesStrip.tsx` — the gate strip + `GATES` mapping (lead→order→customer);
  EntityView imports `GATES` to derive the lead kanban stages.
- `frontend/src/components/LeadGatesPanel.tsx` — the gates panel now on the Pipeline page (context only;
  **not** to be added back to Leads).
- `frontend/src/lib/contract.ts` + `frontend/src/lib/api.ts` — contract filename + `generateContractDocx`
  / list / transition API calls used by the page.
- `frontend/src/lib/i18n.ts` — translation keys (search for `leads.*`); EN/HY/RU.
- `frontend/src/lib/capabilities.ts` + `frontend/src/lib/permissions-constants.ts` — permission gating
  (`can(...)`, `OBJ.LEAD`).

### C. Design system (shared — match it, don't redesign it)
- `frontend/src/styles/gaahex-tokens.css` — **the token source of truth (`--gx-*`). Read first.**
- `frontend/src/styles/_data-tables.css` — `.leads-grid`, `.leads-flat`, `.leads-wrap`, gate/table css.
- `frontend/src/styles/_kanban.css` — kanban board / `.kcard` / `.kanban-fill`.
- `frontend/src/styles/primitives.css` + `frontend/src/styles/styles.css` — primitive styles + imports.
- `frontend/src/page-shell/` — the PageShell framework: `PageShell.tsx`, `PageHeader.tsx`, `KPIBar.tsx`,
  `ActionBar.tsx`, `FilterBar.tsx`, `types.ts`, `styles.css`, `index.ts`.
- `frontend/src/primitives/` — `Button`, `Input`, `StatusPill` (+ index).

### D. Brand + standards (rules of the road)
- `docs/branding/v3.0/` — the LOCKED brand package (color, type, voice, naming).
- `docs/standards/` — platform standards; especially **D17** (KPI tiles), **D18** (color families),
  **D20** (token discipline), and **file 10** (PageShell zones + standard page anatomy).

---

### Quick-start reading order for you
1. `gaahex-tokens.css` (the palette + spacing you must use)
2. `docs/standards/13-consistency-patch-notes.md` → D17/D18/D20
3. `EntityView.tsx` (`isLeads` branches + `leadCardEV`)
4. `page-shell/PageShell.tsx` + `PageHeader.tsx` (the frame)
5. `_data-tables.css` + `_kanban.css` (current leads visuals)

Then propose the redesign.
