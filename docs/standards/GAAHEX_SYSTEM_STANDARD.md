# GAAhex System Standard — v1 (final)
**Audience:** Bro (build/design agent) · **Scope:** every page and component in the GAAhex/GAAex system
**Stack:** FastAPI + PostgreSQL (RLS) + React · component prefix `gx-`

**How to apply (Bro):** save this as a **standing skill** (apply to every task, not one-off) → **audit** the current system against it → **gap report** (by section, severity) → **phased plan** (foundation-first) → wait for owner's OK → execute **phase-by-phase, verify + show owner at each phase end** (no autonomous full-run) → run the §13 checklist before any page is "done".

> **Position (LAW-ST1).** Subordinate to `docs/governance/PROJECT_CONSTITUTION.md`, the PRM, and the Architecture
> Constitution. At the STANDARDS layer this is the **operational umbrella for ALL UI + code** — it consolidates
> and governs the per-area UI/code standards (03 · 09 · 10 · 14 · 16 · 17 · 20 · 21 · 22 · UI_PRIMITIVES ·
> TOKEN_MIGRATION · CONTENT_VOICE · GOVERNANCE) and the Brand v3.0 package; those remain the detail reference.
> **Companion:** `GAAHEX_DESIGN_LANGUAGE.md`. **Colour/logo/font source of truth = `docs/branding/v3.0/`.**
> **Visual target = `docs/design/gaahex_design_sample.html`** (dark + light — the locked look).

---

## 0 · Prime directives (read first)

1. **Apply this standard to EVERY page and component.** Nothing is exempt.
2. **Zero hardcoding.** Every value (color, size, spacing, string, format, route) comes from a **token / config / single source**, called from **one place**. No raw hex, no raw px, no inline strings, no copy-pasted constants.
3. **One source, one component.** A thing that should be shared is defined **once** (`gx-*`) and imported everywhere. Never a bespoke second copy.
4. **Refactor on sight.** If existing code violates this standard, **fix it** — even if it wasn't the task.
5. **Replace → VERIFY → delete.** When you change something: build the new, **verify it actually works** (runs, renders, tests pass), **then delete the old**. No dead code, no duplicates, no commented-out blocks, no noise. Git history preserves anything removed. The repo gets *cleaner* with every change, never noisier.
6. **New logic ships with tests.** Any new behavior (search ranking, phone normalization, human-ref, modal URL-addressability, formatters) lands with its own tests — the gate enforces *passing*, but the tests must be written.
7. **Quality floor, always.** Responsive to mobile, visible keyboard focus, reduced-motion respected, WCAG-AA contrast — non-negotiable.

---

## 1 · Page shell (identical on every page)

```
┌────────────────────────────────────────────────────────────┐
│ GLOBAL TOP BAR   icons · brand · user-menu                  │  ← same everywhere
├────────────────────────────────────────────────────────────┤
│ PAGE HEADER   [hex-icon] Title          [search][2ry][1ry]  │  ← pattern fixed,
│                                                             │     content varies
│ KPI STRIP   [stat][stat][stat][total]                       │  ← standard summary
├────────────────────────────────────────────────────────────┤
│ CONTENT AREA   page-specific — apply §5 element rules       │  ← the only free part
└────────────────────────────────────────────────────────────┘
```

- **Top bar**, **header pattern**, **KPI strip** = one shared shell component. Pages inject only title, icon, actions, KPIs, content.
- **Header actions order:** search → secondary → primary (primary rightmost, one per page).
- **KPI stat card:** uppercase label · big number · trend (`%WoW` + arrow + semantic color) · sparkline **or** progress · optional date range. Cards equal height/width.

---

## 2 · Design Language (visual identity) — the mood Bro reproduces everywhere

**Source of truth = the Brand v3.0 package** (`branding/v3.0/`). Pull exact colours from `11-figma/tokens/gaahex-tokens.css`, the logo from `11-figma/import/gaahex-icon-*.svg`, and the typeface (Sora). Reference Brand v3.0 — never redefine it. Values below are the documented intent.

- **Identity / mood:** an **ISP control-room** — precise, calm authority, in **two modes (dark + light)**. **Data is the hero, the hexagon is the soul.** Gold is a rare signature; Azure is the live signal. Premium and engineered, never flashy.
- **Logo:** the v3.0 honeycomb icon — **4 Cobalt · 2 Azure (signal) · 1 Gold (apex)**. Used as the GAAhex (system) mark, page icon, loaders, empty states. Cobalt cells are theme-aware (`#1C3B68` light / `#4E7FC4` dark); azure + gold fixed. **GAAhex = the system** (its mark/wordmark); the **tenant company** is shown separately with its own name/brand — never lock "GAAhex · Company" together.
- **Palette (D18, theme-aware — exact values in `gaahex-tokens.css`):**
  - **Cobalt** spine `#1C3B68` (dark-chrome `#4E7FC4`) · **Gold** signature `#C5A059` (light-bg `#AC8847`) · **Azure** interactive `#0EA5E9` (hover `#0284C7`)
  - Light: bg `#EEF1F6` · surface `#FFFFFF` · text-1 `#0B0B0C` · text-2 `#475569` · border `#E2E5EA`
  - Dark: bg `#0B0E14` · surface `#15181F` · text-1 `#F4F5F7` · text-2 `#9AA6B8` · border `#262B34`
  - Semantic (status only): success `#16A34A` · warning `#D97706` · danger `#DC2626` · info `#2563EB`
  - **Roles:** green = healthy/positive · red = risk/overdue · azure = interactive · **Gold = rare brand-atmosphere** (logo apex + ambient), never a workhorse.
- **Aurora-Glass (signature surface treatment):**
  - **Background:** scattered **hexagons** — varied sizes, random positions, faint, brand-hued (cobalt/azure/gold) — plus subtle ambient diagonal glow. **The scatter is unique per page** (each page renders its own random layout) so no two screens feel identical.
  - **Surfaces are glass:** cards / search / chips are **~51% transparent + backdrop-blur**, so the hexagons and glow read softly through them. Hairline glass borders, restrained glow, card radius ~14px.
  - Modals/overlays use the same glass.
- **Typography:**
  - **Sora** (brand display/UI) · **tabular figures** for numbers/IDs/phone/money · **micro-labels UPPERCASE, letter-spaced** (PAYMENTS TODAY · INVOICE) — a signature tell.
  - **Script coverage (REQUIRED):** AM + EN + RU — fonts must cover **Armenian + Cyrillic + Latin**. Sora covers Latin; pair with **Noto Sans Armenian + Noto Sans** (Cyrillic) fallbacks. A gap = broken Armenian/Russian.
- **Signature:** the **hexagon** (logo, page icons, empty states, the bg scatter) + **azure live-signal** (thin sparklines, subtle pulse). **Spend boldness once per view.**
- **Data-viz:** thin azure sparklines · rounded **semantic** progress · trend chips (arrow + semantic) · minimal, honest charts in cobalt/azure.
- **Status pills:** muted, **UPPERCASE** (`IN_PROGRESS` · `OPEN` · `ORG`). **Alert chips:** icon + semantic tint.
- **Motion:** restrained — hover lift, modal fade+scale, subtle live-pulse; reduced-motion respected.

*Visual reference: `docs/design/gaahex_design_sample.html` (dark + light — the locked look). This drives the tokens in §3.*

---

## 3 · Tokens — single source + naming (Brand v3.0 / D18)

**Everything is a token.** Components read tokens; pages read components. No raw values anywhere. **Source = `branding/v3.0/11-figma/tokens/gaahex-tokens.css`** (plus `.scss/.json/.ts` siblings). The role-based names below are the real, shipped scheme — short; category implied; a `-{scale}` suffix **only** where a genuine ramp exists. Keep the good names — **do not rename for cosmetics**.

```
--gx-{role}            single value per role
--gx-{role}-{scale}    only where a real ramp exists
```

| Group | Tokens (real D18) |
|---|---|
| brand | `--gx-cobalt` `--gx-gold` `--gx-gold-light` `--gx-azure` |
| interactive | `--gx-interactive` `--gx-interactive-hover` `--gx-interactive-active` `--gx-ring` |
| surface / bg | `--gx-bg` `--gx-surface` `--gx-surface-2` · **glass:** `--gx-glass` `--gx-glass-border` |
| text | `--gx-text-1` `--gx-text-2` `--gx-text-3` |
| border | `--gx-border` `--gx-border-strong` `--gx-divider` |
| status (semantic) | `--gx-success` `--gx-warning` `--gx-danger` `--gx-info` + ISP states `--gx-online` `--gx-provisioned` `--gx-maintenance` |
| logo | `--gx-logo-cobalt` (theme-aware cell colour) |
| type | `--gx-font-family` (`'Sora'…`) · tabular figures for data |
| space (4px ladder) | `--gx-space-1`…`--gx-space-4` (4/8/16/24) — extend the ladder, keep the 4px base |
| radius | `--gx-radius-md` 8 · `--gx-radius-lg` 12 · `--gx-radius-xl` 28 |
| motion | `--gx-dur-*` · `--gx-ease` |

**Rules**
- **D18 mapping:** Cobalt = structural spine · Gold = signature (rare) · **Azure = interactive** · Slate = neutrals · **Semantic = status only**.
- **Theme-aware (dark ↔ light):** semantic tokens — `--gx-bg` `--gx-surface` `--gx-surface-2` `--gx-text-*` `--gx-border` `--gx-glass` `--gx-logo-cobalt` — **flip** between modes; brand hues + semantic colours **stay**. **One token set, two value-maps; components never change.**
- **One accent:** Gold spent once per view; everything else quiet. Status colours **only** for status, never decoration.
- If a value isn't a token yet, **make it a token** — never inline it.
- **Real cleanup (not cosmetic rename):** fix the **4px space-ladder** values · **tokenize the ~12 stray consumer hex + gradients** · tokenize the **glass alpha + backdrop-blur** (Aurora-Glass). Names stay; only the genuinely-broken gets fixed.

---

## 4 · Component standard (`gx-`, one source)

Core set (define once, import everywhere): `gx-Button` `gx-Badge` `gx-Input` `gx-SearchBox` `gx-Card` `gx-StatCard` `gx-Table` `gx-Tabs` `gx-Chip` `gx-Modal` `gx-Toast` `gx-Dropdown` `gx-EmptyState` `gx-Skeleton` `gx-ErrorState` `gx-DefinitionList`.

- **Uniform sizing — longest wins.** Within a type, every instance matches the largest/longest sibling so a group reads even. Size variants (`sm/md/lg`) come from tokens, never ad-hoc.
- **Hover standardized per type.** Card / table-row / button / chip hover defined once, reused. Same type = same hover everywhere.
- **States on every data component** (required): `empty` · `loading` (skeleton) · `error` · `no-results`. An empty screen invites an action; an error says what happened and how to fix it — in the interface's voice, never vague, never an apology.
- **Permission-aware via one `can()` helper (default-deny)** against the 317 permission keys (`object.action`). Not allowed = consistently hidden or disabled — never a dead button.
- **Copy is design material.** Active voice, sentence case, an action keeps its name through the flow (button "Publish" → toast "Published"). Name things by what the user controls, not how the system is built.

---

## 5 · Element-selection rules (smart & varied — never monotone)

Match the element to the **shape of the data**. Do **not** default everything to cards or tables.

| Data shape | Element |
|---|---|
| one number / KPI | **stat** callout |
| 2–5 attributes of one thing | **card** |
| same attributes across many items | **table** |
| scannable / pickable list | **list** or mini-cards |
| sequence / process / steps | **stepper / timeline / flow** |
| trend / distribution / magnitude | **chart** |
| structure / hierarchy / relationships | **diagram** |
| status across categories | **badge / RAG grid** |
| a few key–value pairs | **definition list** (not a table) |
| long explanation | **prose + headings** (not stuffed in a card) |

Then: **mix types intentionally** so the page breathes · vary density · clear visual hierarchy · whitespace · restraint. Numbered markers (01/02) only when the content is truly a sequence.

---

## 6 · Global search (system-wide, every page)

**Box on every page.** One unified `/search?q=` endpoint.

- **Context scope (3 layers):** default scope = the current page's entity (shown first) · cross-entity hits **always** appear as a secondary **"Also found in"** group (never hidden) · **scope chips** `[ current · others · All ]` switch instantly.
- **Prefix optional** (accelerator, never required). **Exact full-ID breaks scope** — surfaces at top across all entities; partial/fuzzy matches respect scope.
- **Multi-interpretation:** a query is searched as **ID + phone + passport + name/address in parallel**; every result carries a **match-reason badge** (ID / Phone / …) with the matched part highlighted. Same number being both an ID and a phone → both shown, labeled.
- **ID collisions** across entities → grouping + type badge; internal unique key = `(type, number)` or UUID, human number stays per-entity.
- **Phone without code:** normalized phone column (digits only, code/spaces stripped) · match by **substring/suffix** via `pg_trgm` GIN index (`74 74 74` → `077 74 74 74`).
- **RLS-scoped** · rank `exact-ID > exact-phone > partial`, recency tiebreak.

---

## 7 · Human references — never raw IDs

- The UI **never** shows raw system identifiers — no UUIDs, hashes, or internal codes like `TKT/019e9c85`. Those are internal only.
- Always show a **human reference** via `humanRef()`: a friendly sequential number and/or a meaningful label.
  - ticket `019e9c85…` → **#1042 · "<subject>"** · lead → the person's **name** · invoice → **INV-000010**
- Friendly sequential refs (`INV-000010`) are fine; raw UUIDs/hashes are not.
- If a technical reference is genuinely needed (support), expose it **subtly and copyable** in the detail view or a tooltip — never as the primary label.

---

## 8 · Navigation — modals in place (one modal type)

- **Clicking a link / reference / row never navigates to another page.** It opens a **modal overlay in place** showing the detail and any related content needed.
- **One modal system-wide:** a single `gx-Modal` (on a shared Overlay + `useFocusTrap`) — identical structure (header · body · footer), open/close, backdrop, sizes (`sm/md/lg`), motion. Every modal looks and behaves the same.
- **Standard behavior:** backdrop-click and `Esc` close · focus trapped while open, returned on close · one modal at a time (no ad-hoc stacking) · large content uses the same modal scaled, never a separate route.
- **URL-addressable:** the opened detail reflects in the URL so refresh, deep-link, and the back button work — but it always renders as the in-place modal, never a full page change.

---

## 9 · i18n — zero hardcoded strings · AM + EN + RU

- No user-facing string is hardcoded. All text comes from **one translations source**, **trilingual: AM + EN + RU**.
- Keys are stable; the same action keeps the same wording across the flow.
- Fonts must cover **Armenian + Cyrillic + Latin** (see §2 typography).
- Formatting is **not** in the strings — it goes through §10.

## 10 · Formatters — one place, locale-aware

- Single module for **currency (֏), date, phone, number** — locale-aware across AM/RU/EN. Every display value passes through it. No inline `toLocaleString`, no ad-hoc date math, no manual phone spacing.

## 11 · Responsive + accessibility baseline

- Breakpoints from `--gx-bp-*`. Tables collapse to cards on mobile; the shell adapts.
- Visible keyboard focus (azure focus ring), logical tab order, ARIA roles, WCAG-AA contrast, reduced-motion respected.

## 12 · Code quality gate

- **Gate:** lint + format + type-check + tests must pass; nothing lands with noise.
- Consistent naming + folder structure · data-fetch in **one layer** (not scattered fetches) · writes go through the event store · **camelCase wire contract** enforced at the data-layer seam (one snake→camel mapper; backend stays as-is for now — move the seam to the API/Pydantic aliases later if multiple consumers appear).
- Enforce §0.4–0.6: refactor on sight · replace → **verify** → delete old · new logic ships with tests.

---

## 13 · Per-page checklist (run before "done")

- [ ] Shell present (top bar · header pattern · KPI strip)
- [ ] **Design language applied** (§2 mood: dark surfaces · hairline · hex signature · uppercase micro-labels · semantic green/red · azure interactive)
- [ ] All elements are `gx-*` from one source — no bespoke copies
- [ ] **Tokens only** — zero hardcoded color/px/string/format · names follow §3
- [ ] Uniform sizing (longest wins) · hover standardized per type
- [ ] Element types matched to data (§5) — not all cards / all tables
- [ ] **No raw IDs/UUIDs in UI** — human references only (§7)
- [ ] **Links open the standard `gx-Modal` in place** — never navigate away (§8)
- [ ] States present: empty · loading · error · no-results
- [ ] Search wired (scope chips · cross-entity · match-reason · phone-normalized)
- [ ] Permission-aware actions (317 keys, one default-deny `can()`)
- [ ] **i18n AM/EN/RU** — no hardcoded strings · fonts cover Armenian + Cyrillic + Latin · formatters used
- [ ] Responsive · keyboard focus · contrast
- [ ] New logic has tests · old/dead code deleted · lint/format/tests pass

---

*Tokens → components → pages. One source, no hardcode, clean repo. Dark control-room mood, hexagon signature, spend boldness once (Gold). Verify before you delete. Every change leaves the system cleaner than it was.*
