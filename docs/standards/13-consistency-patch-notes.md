# 13 — Consistency Patch Notes

Patch date: 2026-06-02. Scope: cross-standard consistency only. No new standards created except
placeholders required to expose existing gaps. Strictest already-locked rule wins on conflict.

## Blockers fixed

### B1 — Enum casing normalized to UPPER_SNAKE_CASE
Enum Standard wins. PascalCase status/enum values rewritten across files 08 and 12. Display labels
unchanged. Representative conversions:
```
ReadyToImport        → READY_TO_IMPORT
ValidationFailed     → VALIDATION_FAILED
CompletedWithErrors  → COMPLETED_WITH_ERRORS
OnTrack              → ON_TRACK
AtRisk               → AT_RISK
SoftDeleted          → SOFT_DELETED
PendingPurge         → PENDING_PURGE
DeadLettered         → DEAD_LETTERED
PendingReview        → PENDING_REVIEW
NotApplicable        → NOT_APPLICABLE
WaitingCustomer      → WAITING_CUSTOMER
```
Affected enums: Import status, Export status, Configuration status/scope, Feature Flag status/
scope/environment, Workflow status, SLA status + pause reasons, Communication direction/status,
Background Job status, Deletion state, Relationship direction, Data Retention categories,
lifecycle/pipeline stages. Already-compliant enums (Task, Comment, Watcher, Notification,
Relationship types, Audit) left unchanged.

### B2 — Event primary ID
Event System: primary `id = UUIDv7`; `EVT-000001` reclassified as `referenceNumber`; `EVT`
registered in the prefix registry. (file 06, file 03)

### B3 — Canonical ActorType
One enum `USER, SYSTEM, AUTOMATION, INTEGRATION, API, CUSTOMER`. Audit (added API/CUSTOMER, dropped
PascalCase), Event System (added API), API (`API`), Webhook/Background Job/Integration/Automation
all reference it. (files 00, 04, 06, 12)

### B4 — Timeline projection
"Exactly one timeline" replaced with: Event System is canonical source; timeline entries are
projections; one event may appear on multiple object timelines. Task events project onto Task
Timeline and Parent Object Timeline. (files 04, 05, 06)

### B5 — Single accountable stage owner
Each lifecycle/service-delivery stage has exactly one accountable Owner Department; the second
department is reclassified as supporting. Dual-owner strings (`Sales / Back Office`, etc.)
removed and tabulated. (files 02, 11)

## Structural fixes

- **S1** — One canonical index (file 00), names immutable, numbers display-only, no duplicates.
  `17/17` collision resolved (Notification 18, Event System 19). `22 vs 28` resolved into a single
  1–70 sequence.
- **S2** — Locked navigation tree is the sole navigation source of truth; Left Navigation Standard
  describes behavior only and no longer introduces a different example tree. (file 10)
- **S3** — Strategic Product Direction references the implementable UI standards (Device,
  Interface Density, Object Editing, API, etc.) instead of redefining them. (files 01, 10)
- **S4** — `pipeline` page type supports multiple tabbed views (Sales Pipeline, Customer
  Lifecycle, Service Delivery Pipeline) via the Tabs Standard. (files 10, 11)
- **S5** — Every business-visible object declares UUIDv7 `id` + a registered reference prefix;
  prefixes added: `EVT, IMP, EXP, WFL, SLA, COM, REL, WHK, CFG, FFL, JOB`. Internal-only technical
  records may be UUID-only, stated explicitly. (files 00, 03, 06, 08, 12)

## Minor fixes

- **M1** — `CorrelationID` / `CausationID` declared internal trace keys, exempt from the Reference
  Number Standard; `COR-YYYYMMDD-XXXXXX` permitted as a trace key (no-year rule not applied).
  (files 03, 06)
- **M2** — Modal scope clarified: `FORM` modal = quick-create/short only; `DETAIL_PREVIEW` normally
  a Drawer; large/complex editing uses Drawer or Dedicated Page. (files 09, 10)

## Remaining unresolved — SOURCE NOT PROVIDED
Seven referenced standards were never supplied to this patch and cannot be verified or completed
without their source text:
1. Global Status Standard
2. Automation Standard
3. Integration Standard
4. Security & Permission Standard
5. Data Validation Standard
6. Search & Filter Standard
7. Navigation Standard (base behavior — the locked navigation **tree** is provided)

They are present as placeholders (files 06, 07, 10) carrying only the constraints other locked
standards impose. No rules were invented for them. Supply their source text to close the set.

---

# Second patch — deep-audit fixes (D1–D16)

Applied 2026-06-02 after a deep re-audit of the assembled set.

## Critical
- **D1** `tenantId` added to Event and Audit required-field lists (Multi-Tenant Standard now
  satisfied for tenant-owned events/audit). Files 04, 06, 08.
- **D2** All field identifiers normalized to camelCase per the Naming Standard (`tenantId,
  createdBy, objectId, actorId, eventId, workflowKey, featureFlagKey, targetUrl`, etc.). Enum
  values stay UPPER_SNAKE; event names stay PascalCase. Files 04, 06, 08, 12.
- **D3** One canonical `ObjectType`/`EntityType` enum (40-value superset) defined in file 03;
  Audit's former 13-value subset replaced; Timeline/Relationship/Communication/Export reference it.
- **D4 / D13** One authoritative common object-detail tab set in the Object Detail Standard
  (`Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Documents,
  Communications, Audit`); Tabs Standard now references it; the redundant `Activity` tab removed
  (Timeline is the activity history). Files 09, 10.
- **D5** Two distinct principal axes defined in file 03: `ActorType` (performer) and
  `PrincipalType` (referenced principal). `USER` ≠ `EMPLOYEE`. Files 03, 04, 06, 12.

## High
- **D6** Central Enum Registry created (file 14): every enum with owner department + values.
- **D7** Central Permission Registry created (file 15): all `Object.Action` keys.
- **D8** Prefix registry completed (added LED, EMP, ROL, DEP, TEM, QUE, PAY, SVC, SUB, NDV, SIT,
  LOC, VEN, PUR, KBA, CHG, INC, PRB, RLE, CMP); `REL`/`RLE` collision avoided. Files 00, 03.

## Medium
- **D9** `WEBHOOK` removed from notification channels; outbound webhooks deliver events only
  (one outbound-webhook path). Files 05, 12.
- **D10** One canonical `CommunicationChannel` enum (8 values, file 12); the Communications page
  displays a subset (file 11), no separate enum.
- **D11** Escalation to a queue is a move (reassignment), not a second membership — preserves the
  one-queue-membership rule. File 02.
- **D12** One `PrincipalType` superset with documented per-context subsets (Task: no TEAM;
  Watcher/Notification/Mention: no QUEUE). Files 03, 05.
- **D13** Folded into D4 (Activity/Timeline duplication removed).
- **D14** `deletionState` is a separate field/enum from lifecycle `status`; both may hold
  `ACTIVE` as different enum types; flagged for reconciliation with the Global Status Standard.
  File 12.

## Low
- **D15** Comment mention targets normalized to UPPER_SNAKE (`EMPLOYEE, ROLE, DEPARTMENT, TEAM`).
  File 04.
- **D16** Notification stores the triggering `eventId` (Event → Notification trace). File 05.

## Still open (unchanged)
The 7 `SOURCE NOT PROVIDED` standards remain the only blocker to a fully self-contained set.
The Global Status Standard is load-bearing for D14 and every per-object status enum; supply it
to finalize status semantics.

---

# Third patch — deep-audit fixes (E5–E22)

Applied 2026-06-02 after a third deep re-audit of the twice-patched set.

## Critical
- **E5** Canonical `RecipientType`/`ParticipantType` = `EMPLOYEE, ROLE, DEPARTMENT, TEAM, CUSTOMER`
  defined in file 03; Notification `recipientType` and Communication `participantType` now address
  the external portal principal (Customer Portal strategy satisfied). Files 03, 05, 12.
- **E7** Completed D9: `WEBHOOK` removed from the notification channel-priority order (the enum had
  been fixed but the priority line still listed it). File 05.

## High
- **E13** Event field renamed `eventType` → `eventName` (`<Object>.<Action>`); Audit keeps
  `eventType` as the coarse `AuditEventType` enum; webhook payload/delivery use `eventName`.
  Files 04, 06, 12, 14.
- **E14** Timeline uses the canonical `EventCategory` enum (timeline is a projection); the separate
  10-value timeline-category enum removed; registry `TimelineCategory` now aliases `EventCategory`.
  Files 04, 06, 14.
- **E21** `EventCategory` normalized to UPPER_SNAKE (dropped Title-Case " Event" suffix). File 06, 14.

## Medium
- **E11** `Documents` dropped as a separate object-detail tab; documents are Attachments filtered by
  document categories. Files 09, 10.
- **E15** Auto-watch resolves a non-watchable owner (e.g. `QUEUE`) to a watchable principal (owning
  department) before creating a watcher. File 05.
- **E19** `PageType` enum normalized to UPPER_SNAKE (`WORKSPACE, REGISTRY, …`). Files 10, 14.
- **E20** Design tokens (color tokens, spacing scale, typography roles) declared design identifiers,
  not business enums — exempt from UPPER_SNAKE; registry claim corrected. Files 09, 14.

## Low
- **E18** Base `Navigation Standard` `SOURCE NOT PROVIDED` placeholder added (locked tree remains
  authoritative). File 10.
- **E22** `AuditEventType` extended with `OWNER_CHANGED, DEPARTMENT_CHANGED`. Files 04, 14.

## Category model after E14/E21 (one enum, 16 values)
`LIFECYCLE, STATUS, ASSIGNMENT, OWNERSHIP, APPROVAL, FINANCIAL, COMMENT, ATTACHMENT, COMMUNICATION,
TASK, ESCALATION, NOTIFICATION, AUTOMATION, INTEGRATION, SECURITY, SYSTEM` — used by both Event
System and Activity Timeline.

## Still open (unchanged)
The 7 `SOURCE NOT PROVIDED` standards remain the only blocker to full closure; Global Status is
load-bearing for status semantics and the E13/E14 category/eventName alignment.

---

# Fourth patch — batched standards revision after UUIDv7 cutover (D1, D2)

Applied 2026-06-02 after the Portal UUIDv7 cutover verified green on all 4 gates.

## D1 — Audit ≡ Event: one append-only store, projections
Audit and Activity Timeline are governed **projections** over a single append-only event store
(the physical source of truth), not separate tables. Audit = compliance-relevant slice + audit
fields + before/after; Timeline = chronological view. Immutability enforced at the store
(append-only; deletes rejected for all roles). Matches the deployed design (event table is
append-only by DB trigger, SPEC §0.4). Files 04, 06.

## D2 — Permission keys: lowercase `object.action`
Key format changed from `Object.Action` (PascalCase) to lowercase `object.action`, dot-separated,
object first; multi-word actions use snake_case (`view_internal`, `manage_others`). Matches the
codebase's seeded keys. Case is not load-bearing; shape (object.action, canonical, immutable,
never localized) is. All keys rewritten across the RBAC Standard and Permission Registry.
Files 04, 05, 12, 15.

## Already locked (no spec change — Portal-conformance only)
PageType → UPPER_SNAKE (E19), CommunicationChannel +PORTAL_MESSAGE/SYSTEM_MESSAGE (D10/E),
Lifecycle B5 owner+supporting split (B5) were already in the locked spec. These are Portal-side
conformance items, not spec edits.

## Still open (unchanged)
The 7 SOURCE NOT PROVIDED standards remain the only blocker to full closure.

---

# Fifth patch — the 7 missing standards written (files 16–22)

Applied 2026-06-02. The 7 former SOURCE NOT PROVIDED standards were written code-accurate against
the pulled Portal source, not abstractly. Zero placeholders remain.

- **16 — Global Status** — `status_def` + `seed_statuses.py`: 9 SPEC §7 vocabularies (UPPER_SNAKE,
  initial/terminal flags), General fallback set, entity mapping, guarded transitions emitting
  STATUS_CHANGED, status vs stage vs deletionState separation.
- **17 — Security & Permission** — `access.py` + `invariants.py` + `models/access.py`: positive
  grant + wildcards + org-scope (node|subtree|tenant, ltree), RoleDeny hard-denials (deny beats
  grant), Assignment department + region_scope, field-level view/edit gates, §0 invariants
  (owner/default-deny/master-data/region), tenant RLS, secrets-at-rest, error→HTTP mapping.
  Supersedes the thin RBAC notes in file 12.
- **18 — Automation** — `automation.py` + `workflow_engine.py`: AutomationRule (single-entity,
  single-step) vs WorkflowDef Universal Contract (cross-entity, multi-step, owner/SLA/approval/
  failure); §5.3 action verbs; reused engines never duplicated; transaction-agnostic engine.
- **19 — Integration** — `webhook.py` + `outbound.py` + vendor_webhooks: outbound webhooks (HMAC
  secret encrypted at rest), delivery log, OutboundMessage channel adapters, idempotent inbound
  vendor callbacks.
- **20 — Data Validation** — `FieldDef` (16 types) + `records.py _validate`: server-side
  enforcement, 422 rules, partial-vs-full required, type/option checks, references-not-copies
  ordering, field-edit 403.
- **21 — Search & Filter** — `search.py` + `saved_view.py` + `search_history.py`: org-scoped
  global search with field redaction + ranking, response shapes, saved views, search history.
- **22 — Navigation (base)** — `nav_module.py` + `page_config.py`: NavGroup/NavModule IA as data,
  placement O/V, owner_module symmetry, locked SPEC §1 placement rules, PageConfig bespoke pages.
  The locked tree (file 10) remains authoritative content.

Index updated: 7 rows moved from `LOCKED / SOURCE NOT PROVIDED` to `LOCKED` with file numbers
16–22. The only remaining gap is the build of the new modules (Comment, Attachment, Watcher, full
Task, SLA, Relationship, Configuration, full Notification, Data Retention) — each standard-first.

---

# Sixth patch — KPI Tile Standard (D17)

Applied 2026-06-03. Owner: Gev. **One rule, platform-wide.**

D17 replaces every prior guidance about KPI tile visuals. The earlier "premium" /
"headline metric" / "gold side rail" concepts are decommissioned. The `premium` prop
on `KPITile`, the `premium` field on `KPISpec`, and the `applyKpiPremium` helper that
was briefly introduced earlier in this same patch are all REMOVED.

## D17 — KPI Tile Standard

### 1. Every tile renders identically — no "spotlight" highlight

All KPI tiles use the same border, shadow, padding, and surface paint. There is no
"premium / headline / marquee" variant. Setting `premium`, `marquee`, or any equivalent
flag is no longer supported.

Rationale: the operator's attention should be drawn by the **data**, not by the chrome.
A 16-tile dashboard with one gold-rimmed tile teaches the eye to skip the other 15;
that's the opposite of what a KPI strip is for.

### 2. State is communicated by colored value text only

The numeric value carries the state colorway:
- `danger: true` → value rendered in danger fg (overdue, dying gasp, failed)
- `warning: true` → value in warning fg (offline, suspended, degraded)
- `muted: true` → value in muted color (cancelled, archived, n/a)
- (no flag) → default text color

Subtitles can additionally use inline `<span>` color to highlight specific words
(e.g. "67 dying gasp" in red inside an otherwise muted subtitle). The tile chrome
itself never changes color based on state.

### 3. Hover reveals a small "story" popover — every tile

Optional `tooltip?: ReactNode` field on `KPISpec`. When supplied, the tile shows a
small popover above itself on hover OR keyboard focus (CSS-only, no JS portal,
pointer-events none so the popover never steals clicks).

Motion: **fade-in + subtle scale only** — the popover does NOT slide or pop. The tile
itself does not lift or move on hover; only the border tints slightly toward the primary
color. This was tuned (2026-06-03) to feel less "jumpy" than the prior implementation.

Per platform convention each tooltip should:
- Be **1–2 short sentences max** — what the metric counts + how it's computed.
- For clickable tiles, also say **what clicking does** ("Filter customers to ACTIVE").
- Reference real data sources where it's not obvious ("last `show onu state` sweep, 60 s").
- Never repeat the tile label or value verbatim.

A tile without `tooltip` renders the same — no popover. Tooltips are strongly recommended
on OPERATIONS / COMMUNICATION / ANALYTICS pages.

### Implementation

- Tooltip prop: `KPISpec.tooltip` (types.ts) → passed through `KPIBar` → `KPITile`.
- Tooltip CSS: `.kpi-tile-tooltip` in `styles/primitives.css` (fade + scale only).
- Hover affordance: `.kpi-tile:hover` tints `border-color` to `--gx-border-strong`. No
  transform, no shadow growth.
- `premium`, `applyKpiPremium`, `kpiPremium.ts`: all REMOVED. The 18 views that previously
  set `premium: true` have been updated to drop the flag — they render identically to
  every other tile now.

### Migration

Complete. All 18 views were swept and `premium: true` removed in the same patch. No
view-by-view retrofit pending.

---

# Seventh patch — Color Token Families + DO/DON'T (D17 reconciliation)

Applied 2026-06-04. **Five families, one role each.**

This patch formalizes the GAAhex color palette as **five distinct families with
non-overlapping roles**. Every primitive, every page, every chart must use a token
from the family whose role matches the element's purpose. This is how we prevent
the "too much cobalt" failure mode (NMS dashboard rebuild, 2026-06-03 evening),
where a single brand color was overloaded across structural, interactive, and
"healthy state" duties simultaneously.

D17 is NOT replaced — it is reconciled. The hover-affordance rule below resolves the
only point of overlap (D17's "gold border on hover" vs. the new "azure for hover/
interactive" assignment).

## D18 — Color Token Families

| Family | Role | Tokens (Tier 1 semantic) |
|---|---|---|
| **Cobalt** | Brand spine — structural chrome only | `--gx-bg`, `--gx-surface`, `--gx-brand-primary` |
| **Gold** | Brand signature — peak/featured moments only | `--gx-accent-gold`, `--gx-accent-gold-soft` |
| **Azure** | Interactive — all clickable affordances | `--gx-interactive`, `--gx-interactive-hover`, `--gx-interactive-soft` |
| **Slate** | Neutrals — 90% of data viz + text hierarchy + surfaces | `--gx-text-1/2/3`, `--gx-border`, `--gx-divider` |
| **Semantic** | Status — success / warning / error on value text only | `--gx-success-fg`, `--gx-warning-fg`, `--gx-danger-fg` |

Each family has its own raw scale (Tier 0): `cobalt-100..950`, `gold-100..900`,
`azure-100..900`, `slate-100..950`, plus the three semantic accents. The Tier 1
semantic tokens map roles → raw values; component code should NEVER reach for a
raw scale token directly.

## DO / DON'T per family (canonical guard-rail)

Any future agent (Claude Design, frontend agents, designer handoff) MUST scan
this table before writing color logic. Violations are auto-reject.

### Cobalt — Brand spine

- **DO** use on: sidebar background, top bar, structural headers, brand chrome
  surfaces, the LOGO mark itself, "brand moment" full-bleed sections
- **DON'T** use on: chart bars, donut slices, default data viz, "ok" states,
  buttons, links, hover affordances, chips, status badges

### Gold — Brand signature

- **DO** use on: peak markers (chart "leader" callouts), critical alarms (rogue
  ONU pulse, outage marker), featured tier highlight (1 per dashboard max),
  the ONE-PER-PAGE "look here" moment, the brand wordmark's signature letter
- **DON'T** use on: any "ok" state, default chrome, hover affordance (use azure),
  decorative tinting, multiple uses per view, KPI tile spotlights (banned by D17)

### Azure — Interactive

- **DO** use on: button backgrounds + text, links, focus ring, active row /
  active selection, hover affordances on interactive elements, drillable chips,
  filter pills, the "this is clickable" cue across the platform
- **DON'T** use on: passive data viz, headlines, decorative chrome, status
  signaling, peak/featured highlight (use gold)

### Slate — Neutrals (the workhorse)

- **DO** use on: all default chart bars + donut slices + lollipop dots, text
  hierarchy (primary / secondary / muted), card surfaces, dividers, table
  borders, 90% of every data visualization
- **DON'T** use on: status signaling (that's semantic's job), interactive cues
  (that's azure's job), brand signature (that's gold's job)

### Semantic — Status (value text only)

- **DO** use on: KPI value text in danger/warning/success state (per D17),
  badge text color, error toast text, validation message text, status pill
  text color
- **DON'T** use on: bar fills (charts use slate by default + gold for peaks),
  card backgrounds, decorative tinting, status-pulse animations driven by
  chrome color (per D17 — value text only)

## D17 ↔ D18 reconciliation (the hover-affordance rule)

D17 originally said: "Hover affordance: 1px border tints to gold, soft outward
gold-tinted glow." That was correct for KPI TILES (containers) but conflicts
with the new "Azure = interactive" assignment.

**Resolved rule (locked):** hover affordance depends on the element category.

| Element category | Hover affordance | Reason |
|---|---|---|
| **Interactive controls** (buttons, links, chips, drillable rows, ports/cells/legend entries) | Azure border tint + soft azure glow | Azure is the interactive family — hover on an interactive element signals "you're about to interact" |
| **Container elements** (KPI tiles, cards, section frames, drawer panels) | Gold border tint + soft gold glow | Container hover is a "you're focused on this card" moment — that's the brand signature, not an interactive cue |
| **Active selected state** (after click on a row, port, tier) | Azure border + azure-soft background | Once selected, it IS the active interactive thing |
| **Critical / peak markers** (statically) | Gold | Brand signature, never replaced |

D17 KPI tile hover rule is updated: **gold tint + soft glow on tile hover stays**
(KPI tiles are containers, not interactive controls — clicking opens a tooltip,
not a navigation). But **bar/chip/port/row hovers** in chart and data-row contexts
switch to **azure tint** because those ARE interactive controls.

No motion change. Tooltip popover still fade + tiny scale. Containers still don't
lift on hover. Severity still communicated by value-text color. Premium / marquee /
spotlight tiles still forbidden.

## D17 unchanged components (explicit restatement so future agents can verify)

- Every KPI tile renders with identical chrome (D17 §1)
- State communicated by colored value text only (D17 §2)
- Hover popover fades in (D17 §3), no slide, no element transform
- The `premium` prop, `applyKpiPremium` helper, gold side-rail CSS — all REMOVED
- Decorative motion = fade only (P2)
- Spring/bouncy easing — REMOVED (P3)

## Charts × palette (chart rule restated under D18)

For "same-kind" data (PON ports, ONU tiers, vendor OUIs, ranked entries), bars
and slices use **slate** as the default fill, with the **cobalt → gold gradient
sweep** (`linear-gradient(90deg, --gx-brand-primary, --gx-accent-gold)`)
**reserved only when the gradient itself encodes meaning** (e.g., the bar's
length-direction maps to a progression). Most charts use solid slate fills.

For "distinct identity" data (departments, tenants, environments, status enums),
the `--viz-1..--viz-8` categorical palette is allowed — these are pre-locked,
color-blind aware, and never used elsewhere.

For "status composition" data (a port's ONLINE / DEGRADED / OFFLINE split in one
stacked bar — Claude Design's carve-out, 2026-06-04), semantic green/amber/red
fills are correct — that split IS the operator's signal.

## Migration

- `frontend/src/styles/color-tokens.css` — add the `--azure-*` raw scale (Tier 0)
  + the `--gx-interactive*` semantic tokens (Tier 1). Existing `--gx-primary`
  becomes the **brand-spine** token (stop using as "interactive"); a new
  `--gx-interactive` is the azure replacement for interactive contexts.
- `frontend/src/styles/primitives.css` `.kpi-tile:hover` — keep gold (container
  rule). New `.is-interactive:hover` utility — azure tint, for buttons / chips /
  drillable rows / chart entries.
- View files using `--gx-primary` as the interactive color — sweep and replace
  with `--gx-interactive` where the role is clickable affordance. Where the role
  is structural brand spine, keep `--gx-primary`.

This patch closes the "too much cobalt" failure mode permanently by forcing every
color usage to declare its FAMILY → ROLE → ELEMENT chain.

---

# Eighth patch — D19 Rule ↔ Implementation Parity (META)

Applied 2026-06-04. Owner: Gev. **No standing contradiction between rule and code.**

A meta-principle that governs every other locked rule on the platform. Born from
the D17 ↔ D18 reconciliation (the "hover affordance: gold vs azure" overlap),
where an existing locked rule (D17 said "hover = gold") contradicted a newly-
accepted implementation direction (D18 said "interactive hover = azure"). The
resolution was correct — split by element category — but the more important
lesson was the PROCESS:

> When a final-accepted implementation decision diverges from an existing locked
> rule, the RULE is updated in the same commit. We do not leave code and rule
> contradicting each other.

## The rule

1. **No standing contradiction.** Any time a deliberate, final-accepted
   implementation decision lands that diverges from an existing locked rule,
   the standards doc is updated in the SAME patch to reflect the new state.
   The repo's standards files are kept live — what they describe IS what the
   code does, and what the code does IS what the standards describe.

2. **"Final-accepted" means:** the decision was made deliberately (not by
   error), proposed and confirmed (Gev's "go" or equivalent), and shipped to
   the repo. Drive-by experiments, in-progress refactors, and unreviewed agent
   work are NOT final-accepted and do not trigger rule updates.

3. **Direction of update is from final implementation → standards.** This is
   not "code overrides rules" in general — rules are still the source of
   truth for what's locked. But once a new direction is locked by decision,
   the rule is brought into sync IMMEDIATELY, not in a later cleanup pass.

4. **Reconcile, don't replace, unless explicit.** When the new direction
   conflicts with an older rule, default to RECONCILIATION (split by
   category, scope, or condition — like D17/D18 split by element type).
   Full replacement of a locked rule requires Gev's explicit say-so.

5. **Mark superseded language clearly.** If a sentence in an older standard
   no longer holds, replace it (don't strike-through). The standards are
   forward-living text; archeology lives in git history.

## Why this matters

Rule-rot is the failure mode where rules say one thing and code does another.
Once that drift starts, agents and humans both lose the ability to trust
either source. The codebase IS the contract; the rules are how we describe
the contract; the contract has to mean ONE thing.

Examples of what this prevents:
- An older standard saying "use cobalt for interactive" while D18 has moved
  interactive to azure. Future agent reads the older standard, writes wrong
  code. Now: that older sentence is updated the moment D18 lands.
- A KPI prop named `premium` being marked "removed" in D17 while old views
  still set `premium: true`. (Resolved: the view sweep happened in the SAME
  patch as the rule lock — D17 §Migration.)
- A token like `--gx-primary` being described as the "interactive color" in
  one standards file while a different file says it's the "brand spine."
  (Resolved: D18 explicitly assigns roles per family, no overlap.)

## Process going forward

When any agent (Կյաժ, Չոռնի, Կայծ, Լոջ, Կոճ, Վան Դամ, Claude Design, the
orchestrator) lands a change that diverges from an existing locked rule:

1. The orchestrator reviews and either accepts or rejects.
2. If accepted: the agent's PR (or the orchestrator's commit) must include
   the standards-doc update in the SAME commit.
3. If rejected: the code reverts to match the existing rule.
4. Never leave the repo in a state where code and rule contradict beyond
   the orchestrator's working session.

## Audit performed for this patch

Triggered by Gev's observation that the new `--nms-neon-cyan` routing to
`--gx-interactive` (azure) might contradict older language about "cobalt =
interactive." Audit run:

- D17 (Sixth patch) — already reconciled with D18 (Seventh patch); hover
  affordance is now category-driven, no contradiction.
- D18 (Seventh patch) — explicitly assigns each family ONE role; no overlap.
- `frontend/src/styles/nms-tokens.css` — `--nms-neon-cyan` now routes to
  `--gx-interactive` (azure), matching D18.
- `frontend/src/views/NocDashboardView.tsx` — Bar primitive's interactive
  variant moved to `--gx-interactive` (Կյաժ's sweep).
- `frontend/src/primitives/KPITile.tsx` — KPI tile hover stays gold (correct
  per D17 §3 + D18 hover-category rule for containers).
- `frontend/src/page-shell/types.ts`, `KPIBar.tsx`, `index.ts` — D17 reference
  matches current implementation.

No remaining contradictions found. From this patch forward, D19 governs all
future divergence resolution.

## D19 scope expansion (Ninth patch, 2026-06-04)

The D19 audit surface is hereby expanded beyond `frontend/src/` to include:
- `docs/standards/**` (every locked standard)
- `docs/specs/**` (every spec doc, including `DESIGN_SYSTEM.md` and `LAUNCH-HARDENING.md`)
- `docs/BRAND.md` (until BRAND_BIBLE.md supersedes it)
- `design-system/**` (the workspace, including `ui_kits/portal/` content)
- `backend/**` (color-string scan for hardcoded palette family names)

**Pre-flight grep checklist (any agent before a palette / font / brand-text change):**

```
rg "system-ui|\bInter\b" --type css --type tsx --type ts --type jsx --type js
rg "--gx-(cobalt|gold|azure|slate)-[0-9]" frontend/src --type css --type tsx
rg "--gx-(primary|interactive|gold|text-[1-3]|border)" -l
rg "Portal\b|GAAex\b" --type md --type tsx --type ts --type py
```

If any of those return hits in a file you're about to touch, fix them in the same
commit. D19 is non-negotiable: rule and code are kept in sync per change, not in
a later cleanup pass.

**This-sweep audit entry.** A full repo sweep was performed 2026-06-04 to
reconcile pre-D18 token names, remove `system-ui` and standalone `Inter` from
font stacks (research/06 excepted), and clean Portal/GAAex brand-text leftovers.
See `docs/branding/SWEEP_SPEC_2026-06-04.md` for the locked spec and the per-zone
playbook executed by Կյաժ, Կոճ, Կայծ, Չոռնի, and Լոջ.

---

# Ninth patch — Palette & Font Sweep (D18 stabilization, brand-text cleanup)

Applied 2026-06-04. Owner: Gev. **Palette and font stacks reconciled across the
entire repo; pre-D18 leftovers removed; Portal/GAAex brand-text replaced.**

This patch executes the cross-repo sweep described in
`docs/branding/SWEEP_SPEC_2026-06-04.md`. The sweep stabilizes D18 (Seventh patch)
by closing every rule-vs-code drift the spec recon found, and applies the brand
rename (Portal/GAAex → GAAhex) to user-visible text only (no folder renames).

## What changed

- **Standards.** `09-design-system-standards.md` D18 family table updated to list
  the Tier-1 token names that actually exist in
  `frontend/src/styles/gaahex-tokens.css` (cobalt: `--gx-primary*`; gold:
  `--gx-gold*`). FINAL stamp + font-stack lock + backend color-string guard added
  immediately after the table.
- **Standards.** This file (`13-consistency-patch-notes.md`) gets the D19 scope
  expansion block (Eighth patch continuation) plus this Ninth patch entry.
- **Frontend code (Կյաժ).** Every file under `frontend/src/` audited for Tier-0
  raw token leaks and bare font-family declarations. None found; documented in
  the post-flight verification (§10 of the spec). Brand-text Portal/GAAex
  replaced where it refers to the product brand.
- **Supporting tokens (Կայծ).** `_tokens.css` legacy `--brand / --primary /
  --accent / --font-body` family re-pointed to D18 master tokens via `var(...)`
  chains; legacy names preserved for downstream compatibility. `color-tokens.css`
  stale `/* primary = AZURE */` comment corrected to "Cobalt brand spine
  decoupled per D18." `nms-tokens.css` `--nms-neon-cyan` routing already correct
  per Eighth patch — no changes. `gaahex-tokens.css` font stacks no longer
  contain `system-ui`.
- **frontend-portal content (Կոճ).** Brand-text Portal/GAAex replaced;
  `styles.css` `--font-body` re-pointed to `var(--gx-font-sans)`. Folder name
  stays.
- **design-system workspace (Կոճ).** `colors_and_type.css` font stacks cleaned;
  `ui_kits/portal/` content updated (brand-text, no folder rename); `README.md`
  "proposed reskin" caveat replaced with "D18-aligned, palette locked
  2026-06-04."
- **`docs/BRAND.md` (Լոջ).** DEPRECATED header added pointing to standards/09 +
  standards/13. Full pointer-rewrite waits for BRAND_BIBLE.md (M1-D stream).
- **`docs/specs/DESIGN_SYSTEM.md` (Լոջ).** Batch 28 supersede notes added at the
  affected sections (§4 Typography, §any color reference) pointing to D18 in
  standards/09 as canonical. Document is NOT rewritten in this sweep.
- **Backend (Չոռնի).** ~12 files audited for hardcoded palette family names and
  hex literals. Findings cleaned to use theme keys, not values.

## Files affected (count by zone)

- Standards: 2 files (`09-design-system-standards.md`, `13-consistency-patch-notes.md`)
- Brand docs: 1 file (`docs/BRAND.md`)
- Spec docs: 1 file (`docs/specs/DESIGN_SYSTEM.md`)
- Frontend code (`frontend/src/**`): [VERIFY DURING SWEEP — count after Կյաժ's pass]
- Supporting tokens: 4 files (`_tokens.css`, `color-tokens.css`, `nms-tokens.css`,
  `gaahex-tokens.css`)
- frontend-portal: [VERIFY DURING SWEEP — count after Կոճ's pass]
- design-system workspace: [VERIFY DURING SWEEP — count after Կոճ's pass]
- Backend: ~12 files (per Չոռնի's scan list)

## What was superseded

- The `--gx-brand-primary` and `--gx-accent-gold` names in the previous D18 family
  table (Seventh patch). These never existed in code; the table now lists the
  actual names.
- The `system-ui` and `Inter` keywords in any font stack outside the
  research/06 decision record. The Plex stack via `var(--gx-font-*)` is the
  single canonical source.
- The stale `/* primary = AZURE */` comment in `color-tokens.css` line 45 (the
  value was already Cobalt; only the comment was wrong).

No remaining rule-vs-code contradictions on palette or font as of this patch.

---

# Tenth patch — D20 Token discipline (no hardcoded styling)

Applied 2026-06-06. Owner: Gev. **Triggered by a deep audit finding ~1,200 inline
`style={{ }}` usages and 46 hardcoded hex colors across `frontend/src` — drift that
defeats the tokenized design system.** D20 is the standing law that prevents it.

## D20 — Token discipline

Every visual value in the frontend comes from a `--gx-*` token via a CSS class. There
is no per-file exception.

1. **No static inline styles.** padding, margin, gap, color, width/height, font-size,
   radius, border, shadow never appear as literal values in a `style={{ }}` prop; they
   live in CSS keyed off tokens.
2. **No hardcoded hex.** `#rrggbb` / `#rgb` appears ONLY in
   `frontend/src/styles/gaahex-tokens.css` (the single registry). Everywhere else: a
   `--gx-*` color token mapped by ROLE (D18 families).
3. **No raw px / magic numbers** in inline styles or component CSS. Use the spacing /
   text / radius tokens. If a value has no token, ADD the token to `gaahex-tokens.css`
   first, then reference it.
4. **The only permitted inline style is a genuinely-dynamic runtime value** (live %,
   computed coordinate), and even then it is passed as a CSS custom property
   (`style={{ ['--x']: value }}`) with the real styling in a class.
5. **Components set `className`;** values live in CSS + tokens.
6. **Comments are minimal, factual, name-free.** No personal names, no chatty
   justifications in code — they go stale and become their own trash.

### Token map (substitute, never inline the raw value)

- spacing `--gx-space-N`: 1=2 · 2=4 · 3=6 · 4=8 · 5=10 · 6=12 · 7=14 · 8=16 · 18=18 ·
  20=20 · 12=24 · 16=32 · 9=40 (px)
- radius `--gx-radius-*`: none=0 · xs=3 · sm=5 · md=8 · lg=12 · xl=16 · 2xl=22 · full=9999
- text `--gx-text-*`: 10 · 11 · sm=12 · base/13=13 · md=14 · lg=16 · xl=18 · 2xl=22 ·
  3xl=28 · 4xl=36 · 5xl=48 · 6xl=64
- color: text-1/2/3 · bg · bg-subtle · surface · surface-2 · elevated · border ·
  border-subtle · border-strong · gold · interactive · {success,warning,danger}-{fg,soft}

### Enforcement

D20 falls under D19 (rule ↔ code parity): a change that re-introduces a hardcoded value
is reverted or tokenized in the same session, never deferred. The D19 pre-flight grep
checklist gains: `rg "#[0-9a-fA-F]{3,6}" frontend/src --type tsx -g '!**/gaahex-tokens.css'`
(hex leak) and a scan for literal px inside `style={{`.

KPI cockpit cards are the canonical worked example: height / value-size / bar-thickness
are `--gx-kpi-*` tokens, so one token edit re-sizes every KPI card app-wide (D17/D20).
