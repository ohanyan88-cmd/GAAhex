# GAAhex Palette + Font Sweep Spec — 2026-06-04

> **Status:** LOCKED by Gev 2026-06-04. All crew sweeps work from this spec.
> **Authority:** D18 (color families final) + D19 (rule ↔ implementation parity)
> **Owner:** Ոսկերիչ (brand spec author); orchestrator (dispatch + review)
> **Single source of truth** for this sweep. Crew members do NOT improvise outside the
> rules, scopes, and forbidden patterns described below.

---

## 1. Locked decisions

These five decisions are Gev's locks for this sweep and are not re-litigated by any crew
member during execution.

1. **Portal → GAAhex rebrand happens in this same sweep, in separate commits per zone.**
   The folder `frontend-portal/` is NOT renamed in this sweep (content only). Path
   strings, route names, code identifiers that read `portal` stay where the path stays;
   what changes is product-facing brand text and user-visible "Portal"/"GAAex" strings
   that refer to the product brand, not the customer-self-service module.

2. **`docs/BRAND.md` gets a DEPRECATED header now**, not a full rewrite. The palette is
   locked per D18; this file points readers to `docs/standards/09-design-system-standards.md`
   and `docs/standards/13-consistency-patch-notes.md`. The full pointer rewrite waits
   for the BRAND_BIBLE.md landing (separate M1-D stream).

3. **Font sweep removes `system-ui` and standalone `Inter` from the entire codebase**,
   replacing them with the Plex stack (UI/body = `'IBM Plex Sans'`, display = `'Space
   Grotesk'`, mono = `'IBM Plex Mono'`). Exceptions:
   - `docs/branding/_research/06-typography-inter-vs-plex.md` keeps both
     `Inter` and `system-ui` as **explanatory context** (it's the decision record that
     chose Plex over Inter). Locked decision stays Plex.
   - The SVG logo proposal (`docs/branding/logo-proposals/v3-gaa-g-shape.svg`) updates
     its wordmark font ref from `'IBM Plex Sans', 'Inter', system-ui, sans-serif` →
     `'Space Grotesk', 'IBM Plex Sans', sans-serif`. The comment line in that SVG
     about "no Arial — defect from prod logo not repeated" loses its `Inter` reference
     to match.

4. **`v3-gaa-g-shape.svg` is exploration, NOT in sweep.** It receives only the font
   ref fix described above. No other content edits. Rendered logo assets
   (`GAAhex-mark.svg`, `GAAhex-logo-cobalt-gold.svg`, `GAAhex-logo-reversed.svg`,
   favicons) take their values from the production Tier-0 raw scale in
   `frontend/src/styles/gaahex-tokens.css`; their hex values are NOT independently
   edited — if a logo asset has the wrong cobalt or gold, fix the cobalt-N or gold-N
   value in the asset to match the token file, do not introduce a new shade.

5. **`design-system/` workspace is IN sweep, owned by Կոճ** (separately from Կյաժ's
   frontend code). The folder `design-system/ui_kits/portal/` is NOT renamed in this
   sweep (content only). The workspace README's "proposed reskin" caveat updates to
   "D18-aligned, palette locked 2026-06-04."

---

## 2. Token alias map (HARD: pre-D18 → D18)

Recon verdict from `gaahex-tokens.css` + grep across `frontend/src/**`:

- `--gx-primary*` is **NOT a legacy alias**. Per the comment at lines 121–126 and
  335–339 of `frontend/src/styles/gaahex-tokens.css`, `--gx-primary*` is the canonical
  Tier-1 token for the **Cobalt brand spine** (structural chrome). Values are
  intentionally decoupled from `--azure-*` so the chrome-cascade is unaffected by
  interactive-family changes. **Keep `--gx-primary*` as-is. It is the brand-spine token.**
- `--gx-accent-gold` / `--gx-accent-gold-soft` are referenced in the D18 family table in
  `docs/standards/09-design-system-standards.md` line 335 — but the actual master
  token file uses `--gx-gold` / `--gx-gold-soft`. This is a **rule ↔ implementation
  mismatch** under D19 and is reconciled by **updating the D18 family table in standards/09
  to list the actual names** (`--gx-gold`, `--gx-gold-soft`). No code change required.
  Logged in §4 (D18 delta) below.
- `--gx-interactive*` is the Azure family — already in use, expand coverage per the
  per-zone playbook in §8.
- No `--gx-accent`, `--gx-neon`, `--gx-premium`, or `--gx-brand-primary` raw tokens
  exist in `frontend/src/styles/gaahex-tokens.css`. Grep across `frontend/src/**` for
  these returned **zero hits**. They are referenced ONLY in standards prose (e.g.,
  `--gx-brand-primary` in the D18 table). Standards prose is reconciled in §4.
- `frontend/src/styles/_tokens.css` defines a **separate, older naming family**:
  `--brand`, `--primary`, `--primary-hover`, `--primary-soft`, `--accent`,
  `--accent-hover`, `--accent-soft`, `--accent-text`, `--font-body: system-ui`. This is
  the **real legacy alias surface**. Decision: Կայծ owns this file. The legacy names
  remain (other code may reference them) BUT their **values** are pinned to D18:
  - `--brand` → keep cobalt (`#1C3B68` matches `--cobalt-700`)
  - `--primary` → re-map to `var(--gx-interactive)` (azure interactive family)
  - `--primary-hover` → `var(--gx-interactive-hover)`
  - `--primary-soft` → `var(--gx-interactive-soft)`
  - `--accent` → `var(--gx-gold)`
  - `--accent-hover` → keep gold scale lookup (`var(--gold-400)`)
  - `--accent-soft` → `var(--gx-gold-soft)`
  - `--accent-text` → `var(--gx-text-on-gold)`
  - `--font-body` → `var(--gx-font-sans)`
  Verification: post-sweep grep for raw hex `#3B82F6 | #2563EB | #1D4ED8` (the legacy
  azure-ish primary values) in `_tokens.css` returns zero hits.
- `frontend/src/styles/color-tokens.css` has a stale **comment** on line 45
  (`/* primary = AZURE (interactive) */`) that contradicts the value below it (which is
  the cobalt brand-spine spine). Կայծ fixes the comment to read
  `/* primary = COBALT brand spine — decoupled from --azure-* per D18 (2026-06-04) */`.
  No value change.
- `frontend/src/styles/nms-tokens.css` already routes `--nms-neon-cyan` →
  `--gx-interactive` (line 49) per the Eighth patch audit. The remaining `--nms-neon-*`
  family names stay (they're scoped to the NMS surface and the values now resolve to
  D18 tokens). Verification: `--nms-neon-cyan` and `--nms-accent-gold` resolve via
  `var(--gx-...)` not raw hex.

**Hard rule for all crew (Կյաժ, Կոճ, Կայծ, Չոռնի):** Tier-0 raw scale tokens
(`--cobalt-NNN`, `--gold-NNN`, `--azure-NNN`, `--slate-NNN`) are **forbidden in
component code**. They are allowed only in:
- `frontend/src/styles/gaahex-tokens.css` (the master file that defines Tier-1 ← Tier-0
  mappings)
- `frontend/src/styles/color-tokens.css` (a parallel mapping surface, same rule)
- `frontend/src/styles/nms-tokens.css` (the NMS Tier-1.5 family, may reference Tier-0
  to derive `--nms-*` values)

Anywhere else — including `_tokens.css`, `_studio-kit.css`, `_dashboard-kit.css`, every
`*.css` under `frontend/src/styles/`, every `*.tsx` under `frontend/src/views/`,
`components/`, `studio/`, `primitives/`, `page-shell/` — Tier-0 is forbidden.
Post-sweep grep verifies (see §10).

---

## 3. Font replacement rules

### Replacements (everywhere outside the exception list in §1.3):

| Found | Replace with |
|---|---|
| `system-ui` (bare) in a `font-family`, `--font-*`, or `--gx-font-*` declaration | Remove the `system-ui` keyword from the stack. The stack should already start with `'IBM Plex Sans'` or `'Space Grotesk'`; `'Segoe UI'` stays as the Windows host fallback; `-apple-system` stays as the macOS fallback; final fallback is `sans-serif`. |
| `'Inter'` or `Inter,` standalone in a font stack | Remove `'Inter'` from the stack entirely; the stack should already lead with `'IBM Plex Sans'` or `'Space Grotesk'`. |
| `--font-body: system-ui, ...` in `_tokens.css` and `frontend-portal/src/styles/styles.css` | `--font-body: var(--gx-font-sans)` (chain through the master token). |
| Bare `font-family: system-ui` declaration in any file | `font-family: var(--gx-font-sans)` |

### Canonical post-sweep stacks (master file, no changes):

```
--gx-font-display: 'Space Grotesk', 'Segoe UI', sans-serif;
--gx-font-sans:    'IBM Plex Sans', 'Segoe UI', -apple-system, sans-serif;
--gx-font-mono:    'IBM Plex Mono', 'SF Mono', ui-monospace, 'Cascadia Code', monospace;
--gx-font-am:      'Noto Sans Armenian', 'IBM Plex Sans', sans-serif;
```

Note: the master file in `frontend/src/styles/gaahex-tokens.css` currently has
`system-ui` in the display and sans stacks at lines 206 and 207. Կայծ removes it from
both lines as part of the supporting-tokens sweep. The fallback chain `'Segoe UI' →
sans-serif` (display) and `'Segoe UI' → -apple-system → sans-serif` (sans) is enough
on every target OS. Same edit applies to `color-tokens.css` lines 193–194 and
`design-system/colors_and_type.css` lines 110–111.

### Exception list (system-ui / Inter PERMITTED to remain):

- `docs/branding/_research/06-typography-inter-vs-plex.md` — both `Inter` and
  `system-ui` are explanatory references in the decision record. No edits.
- `docs/branding/logo-proposals/v3-gaa-g-shape.svg` — `Inter` is removed from both the
  source-code comment (line 14) and the wordmark `font-family` (line 114) per §1.3 / §1.4.
- `docs/branding/AUDIT.md` and `docs/branding/PROPOSAL.md` — both reference `system-ui`
  and `Inter` as **descriptions of the problem they were written to fix**. These docs
  are historical-record. No edits in this sweep.

---

## 4. D18 delta — verbatim text for Լոջ to insert into `docs/standards/09-design-system-standards.md`

Լոջ replaces the existing D18 family table (currently at line 332 onwards in `09-design-system-standards.md`) with the version below. The only change is the **Cobalt** and **Gold** rows, to reconcile the table with the actual Tier-1 token names in `frontend/src/styles/gaahex-tokens.css` (D19 compliance).

```markdown
| Family | Role | Tokens (Tier 1 semantic) |
|---|---|---|
| **Cobalt** | Brand spine — structural chrome only | `--gx-bg`, `--gx-surface`, `--gx-sidebar`, `--gx-primary`, `--gx-primary-hover`, `--gx-primary-active`, `--gx-primary-soft`, `--gx-cobalt` |
| **Gold** | Brand signature — peak/featured moments only | `--gx-gold`, `--gx-gold-soft`, `--gx-text-on-gold` |
| **Azure** | Interactive — all clickable affordances | `--gx-interactive`, `--gx-interactive-hover`, `--gx-interactive-active`, `--gx-interactive-soft`, `--gx-interactive-ring` |
| **Slate** | Neutrals — 90% of data viz + text hierarchy + surfaces | `--gx-text-1`, `--gx-text-2`, `--gx-text-3`, `--gx-text-disabled`, `--gx-border`, `--gx-border-subtle`, `--gx-border-strong`, `--gx-divider` |
| **Semantic** | Status — success / warning / error on value text only | `--gx-success-fg`, `--gx-warning-fg`, `--gx-danger-fg` |
```

Then Լոջ appends the following block immediately AFTER the table (and before the
"Each family has its own raw scale (Tier 0)..." paragraph):

```markdown
**D18 — FINAL stamp (2026-06-04).** Master token file
(`frontend/src/styles/gaahex-tokens.css`) is the canonical source for these names.
`--gx-primary*` is the Cobalt brand-spine path, intentionally decoupled from
`--azure-*` so the chrome cascade is independent of the interactive family. The
older `--gx-brand-primary` and `--gx-accent-gold` names referenced in earlier
drafts of this table never existed in code; this revision lists the names that DO
exist. (D19 reconciliation, this patch.)

**Font stack lock (D18, 2026-06-04).** The canonical font stacks are
`--gx-font-display` (Space Grotesk), `--gx-font-sans` (IBM Plex Sans),
`--gx-font-mono` (IBM Plex Mono), `--gx-font-am` (Noto Sans Armenian). `system-ui`
and `Inter` are FORBIDDEN in any font stack across the codebase (one exception:
the typography decision record at `docs/branding/_research/06-typography-inter-vs-plex.md`).
Component code MUST reference `var(--gx-font-*)`, never bare family names.

**Backend color-string guard (D18, 2026-06-04).** Palette family names ("cobalt",
"gold", "azure", "slate") and raw hex literals that match palette anchors are
FORBIDDEN as hardcoded strings in backend Python code outside tenant-theme
configuration. Theming is a frontend concern; backend emits theme KEYS, not
values.
```

---

## 5. D19 delta — verbatim text for Լոջ to insert into `docs/standards/13-consistency-patch-notes.md` (Eighth patch section)

Լոջ appends the block below to the end of the Eighth patch ("Audit performed for this
patch" subsection currently at lines 529–548), as a continuation of the audit:

```markdown
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
```

---

## 6. `13-consistency-patch-notes.md` Ninth patch entry — verbatim for Լոջ

Լոջ inserts the block below at the END of the file (after the Eighth patch and the D19
scope-expansion block from §5):

```markdown
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
```

---

## 7. `docs/BRAND.md` DEPRECATED header — verbatim for Լոջ

Լոջ inserts the **exact** five lines below as the very FIRST content of
`docs/BRAND.md`, before any existing heading or paragraph:

```markdown
> **DEPRECATED — 2026-06-04.** This document predates D18 (Color Token Families) and
> uses a 2-family Cobalt+Gold palette plus a `system-ui` font stack that no longer
> match the locked design system. **Canonical sources:** the palette and font rules
> live in `docs/standards/09-design-system-standards.md` (Color Standard, D18 family
> table) and `docs/standards/13-consistency-patch-notes.md` (Seventh patch D18, Eighth
> patch D19, Ninth patch sweep). Full pointer rewrite of this file is queued behind
> `docs/branding/BRAND_BIBLE.md` (M1-D stream). Until then: treat the content below as
> historical-record only; do NOT cite it in code review.
```

---

## 8. Per-zone playbook

### 8.1 Frontend code — Կյաժ

**Scope:** `frontend/src/` only. NOT `frontend-portal/` (that's Կոճ). NOT
`design-system/` (that's Կոճ).

**Hot zones from recon:**
- `frontend/src/views/NocDashboardView.tsx` — already cleaned in Eighth patch audit;
  re-verify zero `--gx-cobalt-*` / `--gx-gold-*` raw refs and no bare `system-ui`.
- `frontend/src/views/OrgView.tsx`, `InteractionsView.tsx` — `--gx-primary` references
  here are CORRECT per D18 (Cobalt brand spine). Do NOT swap to `--gx-interactive`
  unless the element is an interactive control. Read each call site.
- `frontend/src/views/customer-tabs/*.tsx` — verify `--gx-interactive` usage on
  buttons/links/active rows; nothing else.
- `frontend/src/components/charts/Spark.tsx`, `ChartPicker.tsx`,
  `WorkItemsTable.tsx`, `WorkItemsBoard.tsx`, `NotificationBell.tsx`,
  `RecordDrawer.tsx` — same audit pass.
- `frontend/src/styles/_dashboard-kit.css`, `_studio-kit.css`, `_comms.css`,
  `_helpdesk.css`, `_drawer.css`, `_data-tables.css`, `_overlays.css`,
  `_notifications.css`, `_section-polish.css`, `_studio-legacy.css` — these files
  showed `--gx-primary` / `--gx-interactive` usage in recon; verify no Tier-0 raw,
  no `system-ui`, no `Inter`.
- `frontend/src/styles/_helpdesk.css` and others — bare hex strings (`#XXXXXX`,
  `rgb(...)`) in component-feature CSS are forbidden unless they're inside a
  documented theme override block.

**Rules:**
- NO Tier-0 raw token refs (`--gx-cobalt-NNN`, `--gx-gold-NNN`, `--gx-azure-NNN`,
  `--gx-slate-NNN`) in any file under `frontend/src/` outside the three
  master-token files. Use Tier-1 semantic only.
- NO bare hex strings (`#XXXXXX`) or `rgb(...)` / `rgba(...)` in component code
  unless they are inside a clearly-marked theme override file. Even there, prefer
  `var(--gx-*)`.
- NO `system-ui` in any font stack.
- NO standalone `Inter` in any font stack.
- `--gx-primary*` stays — it IS the cobalt brand-spine token. Do not "rename" it.
- For interactive elements (buttons, links, focus rings, active rows), use the
  `--gx-interactive*` family.

**Forbidden patterns (regex hints — Կյաժ scans for these and removes/migrates):**
- `--gx-cobalt-\d+` (Tier-0 in component code → migrate to Tier-1)
- `--gx-gold-\d+` (same)
- `--gx-azure-\d+` (same)
- `--gx-slate-\d+` (same)
- `\bsystem-ui\b` (font stack → drop the keyword)
- `'Inter'|"Inter"` standalone in `font-family` (drop)
- `Portal\b` or `GAAex\b` as product-brand text in user-visible strings
  (`title`, `aria-label`, `placeholder`, JSX text, error messages, README) →
  `GAAhex`. Do NOT touch `portal` in variable names, route paths, file names,
  module IDs, or anything that would break a code reference.
- `#3B82F6 | #2563EB | #1D4ED8` (legacy azure-primary hexes) outside the master
  token files

**Verification (post-sweep grep that should return zero):**
```
rg "--gx-(cobalt|gold|azure|slate)-[0-9]" frontend/src --type css --type tsx
rg "\bsystem-ui\b" frontend/src
rg "[\"']Inter[\"']" frontend/src
rg "\bPortal\b|\bGAAex\b" frontend/src/views frontend/src/components frontend/src/page-shell frontend/src/primitives frontend/src/studio
```

---

### 8.2 `frontend-portal/` — Կոճ

**Scope:** content of `frontend-portal/` ONLY. Folder name stays. Route paths stay.
Module identifiers stay.

**Hot zones from recon:**
- `frontend-portal/index.html` — 1 Portal/GAAex hit (product-brand text in `<title>`
  or meta).
- `frontend-portal/src/views/PortalShell.tsx`, `LoginView.tsx` — Portal/GAAex
  product-brand text in user-visible strings.
- `frontend-portal/src/styles/styles.css` — `--font-body: system-ui, ...` (line 53).

**Rules:**
- Same Tier rules as §8.1 (Tier-0 raw token refs forbidden in component code).
- `--font-body` in `styles.css` re-points to `var(--gx-font-sans)` via the
  master token chain. If `frontend-portal` does not already import
  `gaahex-tokens.css`, leave the family-name fallback in place (`'IBM Plex Sans',
  'Segoe UI', -apple-system, sans-serif`) but remove `system-ui`.
- Product-brand text `Portal` → `GAAhex` only when the word refers to the brand,
  NOT when it refers to the customer self-service module. When in doubt, leave
  the string and flag in your return summary; Ոսկերիչ will adjudicate.
- File / class name `PortalShell` STAYS — it's a code identifier.

**Verification:**
```
rg "\bsystem-ui\b" frontend-portal
rg "[\"']Inter[\"']" frontend-portal
rg "\bGAAex\b" frontend-portal
```

---

### 8.3 Supporting tokens — Կայծ

**Scope:** five files only.
- `frontend/src/styles/gaahex-tokens.css` (the master)
- `frontend/src/styles/color-tokens.css`
- `frontend/src/styles/nms-tokens.css`
- `frontend/src/styles/_tokens.css`
- `frontend/src/styles/primitives.css`
- `frontend/src/styles/studio.css`

Plus the root-level configs Կայծ already owns (see Կայծ's existing scope; not
re-listed here).

**Rules per file:**

- **`gaahex-tokens.css`** — remove `system-ui` from lines 206 and 207
  (`--gx-font-display` and `--gx-font-sans`). NO other edits. This file is the
  master; every other token consumer flows from here.
- **`color-tokens.css`** — remove `system-ui` from lines 193–194. Fix the stale
  comment on line 45 (`/* primary = AZURE (interactive) */`) to read
  `/* primary = COBALT brand spine — decoupled from --azure-* per D18 (2026-06-04) */`.
  No value changes; the file's `--gx-primary*` values are already correct (cobalt).
- **`nms-tokens.css`** — verify `--nms-neon-cyan` still routes to
  `--gx-interactive` (line 49 should already match). No edits expected.
- **`_tokens.css`** — re-point the legacy `--brand / --primary / --primary-hover /
  --primary-soft / --accent / --accent-hover / --accent-soft / --accent-text /
  --font-body` family to their D18 master-token chains, per the alias map in §2 of
  this spec. The legacy names PERSIST (other code may reference them). Only
  values change.
- **`primitives.css` and `studio.css`** — recon shows `--gx-primary` and
  `--gx-interactive` references. Verify they're semantic (no Tier-0). Verify no
  `system-ui`. No `Inter`.

**Forbidden patterns:**
- Any Tier-0 raw scale value (`#3B82F6`, `#0EA5E9`, `#1C3B68`, etc.) introduced
  fresh into a file that didn't already have it. If you need a new color,
  it goes through `gaahex-tokens.css` first.

**Verification:**
```
rg "\bsystem-ui\b" frontend/src/styles
rg "[\"']Inter[\"']" frontend/src/styles
rg "#3B82F6|#2563EB|#1D4ED8" frontend/src/styles/_tokens.css
```

---

### 8.4 `design-system/` workspace — Կոճ

**Scope:**
- `design-system/preview/**` (HTML previews and `_components.css`)
- `design-system/ui_kits/portal/**` (content only — folder name stays)
- `design-system/colors_and_type.css`
- `design-system/app.css` if present (recon did not surface it; verify during sweep —
  if absent, skip)
- `design-system/README.md`
- `design-system/CLAUDE_CODE_GUIDE.md` (recon shows 4 Portal/GAAex hits — clean
  brand-text)
- `design-system/INTEGRATION.md` (2 Portal/GAAex hits — clean brand-text)

**Rules:**
- Same Tier-0 rule as §8.1.
- `colors_and_type.css` lines 110–111 — remove `system-ui` from
  `--gx-font-display` and `--gx-font-sans` stacks.
- `preview/_components.css` line 1 mention of `system-ui` — drop.
- `ui_kits/portal/` `.jsx` files — Portal/GAAex brand-text → GAAhex; preserve any
  variable/identifier named `portal` or `Portal` in code (route names, prop
  names, component names).
- `README.md` — replace any "proposed reskin" caveat with: **"D18-aligned,
  palette locked 2026-06-04. See `docs/standards/09-design-system-standards.md`
  D18 family table for canonical token names; this workspace mirrors that."**
  (Կոճ chooses the most natural placement; the sentence is verbatim.)

**Verification:**
```
rg "\bsystem-ui\b" design-system
rg "[\"']Inter[\"']" design-system
rg "\bPortal\b|\bGAAex\b" design-system
```

---

### 8.5 Standards + specs + `docs/BRAND.md` — Լոջ

**Scope (5 files):**
- `docs/standards/09-design-system-standards.md` — apply the D18 delta from §4.
- `docs/standards/13-consistency-patch-notes.md` — apply the D19 scope-expansion
  block from §5 AND the Ninth patch entry from §6.
- `docs/BRAND.md` — prepend the DEPRECATED header from §7. NO other edits.
- `docs/specs/DESIGN_SYSTEM.md` — add Batch 28 supersede notes (described below).
  NO full rewrite.
- `docs/specs/LAUNCH-HARDENING.md` — if it contains palette/font references that
  contradict D18 (recon shows 2 Portal/GAAex hits; verify whether they're product
  brand or module name), clean brand-text only.

**`DESIGN_SYSTEM.md` Batch 28 supersede notes (verbatim, Լոջ chooses placement):**

In §4 Typography (line 78 area, `Font: system-ui (inherits OS font)`), Լոջ
inserts a note immediately BEFORE that line:

```markdown
> **Batch 28 supersede (2026-06-04).** The locked font stack is now
> `--gx-font-display` (Space Grotesk), `--gx-font-sans` (IBM Plex Sans),
> `--gx-font-mono` (IBM Plex Mono), per D18 in
> `docs/standards/09-design-system-standards.md`. The "system-ui inherits OS
> font" line below is historical — treat the standard as canonical.
```

At the line 222 area where the file lists `system-ui, -apple-system, "Segoe UI",
sans-serif (body, UI)`, Լոջ inserts immediately above it:

```markdown
> **Batch 28 supersede (2026-06-04).** Canonical body/UI stack is
> `var(--gx-font-sans)`, resolving to `'IBM Plex Sans', 'Segoe UI',
> -apple-system, sans-serif`. The line below is historical record.
```

Anywhere the file declares a palette value that contradicts D18, insert:

```markdown
> **Batch 28 supersede (2026-06-04).** Palette values are canonical in D18
> (`docs/standards/09-design-system-standards.md`). Treat any divergence below
> as historical record.
```

**Verification:**
```
rg "\bsystem-ui\b|\bInter\b" docs/standards docs/specs docs/BRAND.md
```
(After Լոջ's pass, only the Batch 28 supersede / DEPRECATED header context lines
will contain those strings — every other hit is historical-quoted text.)

---

### 8.6 Backend — Չոռնի

**Scope:** ~12 files. Recon hot zones from grep "Portal|GAAex":
- `backend/app/routers/portal.py`, `portal_auth.py`, `portal_billing.py`,
  `portal_service.py`, `portal_support.py`, `auth.py`
- `backend/app/services/payments/stripe_gateway.py`, `stripe_events.py`
- `backend/app/services/comms/twilio_sms.py`
- `backend/app/services/radius/factory.py`
- `backend/app/models/customer_user.py`, `portal_ticket_reply.py`,
  `stripe_webhook_event.py`
- `backend/app/seed.py`, `seed_catalog.py`
- `backend/docs/kernel-build/STEP-01-DEF-TABLES.md`, `STEP-07-ROUTER-SWEEP-RESULTS.md`
- `backend/docs/spec-build/STEP-07-NAV-REGISTRY.md`,
  `STEP-07-2-ROUTER-SWEEP.md`, `STEP-04-4-FIELD-ENCRYPTION.md`,
  `STEP-02-RELATIONSHIP-MAP.md`
- `backend/tests/test_portal*.py`, `test_hardening.py`, `test_configurations.py`

**Rules:**
- Module-identifier `portal` STAYS in route paths (`/portal/...`), router names,
  test file names, model class names, etc. Code identifiers are not brand text.
- Product-brand text "Portal" referring to GAAhex itself → "GAAhex".
  Product-brand text "GAAex" (any reference) → "GAAhex". These appear mainly in
  docstrings, log messages, comments, seed data labels, and test strings.
- **Color-string scan.** Search every file under `backend/` for hardcoded palette
  family names as strings outside tenant-theme configuration:
  - Literal words `"cobalt" | "gold" | "azure" | "slate"` in Python strings
  - Raw hex literals matching palette anchors (`#3B7BE0`, `#C5A059`, `#0EA5E9`,
    `#1C3B68`, `#0F2138`, etc.)
  - If found in a tenant-theme path (a file whose docstring or path indicates
    theming): leave it, document it, and flag for Կայծ.
  - If found anywhere else: remove or replace with a theme KEY, NOT a value.
- Email templates / PDF templates: brand-text only.

**Verification:**
```
rg "\bGAAex\b" backend
rg "\bPortal\b" backend/app/routers backend/app/services backend/app/models backend/app/seed.py backend/app/seed_catalog.py
rg "['\"]cobalt['\"]|['\"]gold['\"]|['\"]azure['\"]|['\"]slate['\"]" backend
rg "#3B7BE0|#C5A059|#0EA5E9|#1C3B68|#0F2138" backend
```

---

## 9. Pre-flight grep checklist (orchestrator runs before dispatch)

These commands establish a baseline count so the post-sweep diff is measurable.
Orchestrator runs them, captures output, hands counts to crew at dispatch time so
each crew member knows their starting line.

```powershell
# Cobalt / Gold / Azure / Slate raw-scale leaks outside master token files
rg "--(cobalt|gold|azure|slate)-[0-9]+" frontend\src --type css --type tsx -c
rg "--gx-(cobalt|gold|azure|slate)-[0-9]+" frontend\src --type css --type tsx -c

# Legacy alias surface
rg "--gx-(primary|interactive|gold|accent-gold|brand-primary|neon|premium)" -c

# Fonts
rg "\bsystem-ui\b" -c
rg "[\"']Inter[\"']" -c

# Brand-text
rg "\bPortal\b" -c
rg "\bGAAex\b" -c

# Backend color strings (zone 8.6 baseline)
rg "['\"]cobalt['\"]|['\"]gold['\"]|['\"]azure['\"]|['\"]slate['\"]" backend -c
rg "#3B7BE0|#C5A059|#0EA5E9|#1C3B68|#0F2138" backend -c
```

Save the baseline as `docs/branding/sweep-baseline-2026-06-04.txt` (orchestrator
creates this; not a crew file). Post-sweep, run the same commands and diff.

---

## 10. Post-flight verification (orchestrator runs after all crew check in)

All of these MUST return zero hits (or, where noted, return only the explicit
exception list from §1.3 / §3 / §8.5):

```powershell
# (1) No Tier-0 raw scale in component code
rg "--gx-(cobalt|gold|azure|slate)-[0-9]+" frontend\src --type tsx --type ts --type jsx --type js
rg "--gx-(cobalt|gold|azure|slate)-[0-9]+" frontend\src\styles -g "!gaahex-tokens.css" -g "!color-tokens.css" -g "!nms-tokens.css"

# (2) No system-ui / standalone Inter outside the exception list
rg "\bsystem-ui\b" -g "!docs/branding/_research/06-typography-inter-vs-plex.md" -g "!docs/branding/AUDIT.md" -g "!docs/branding/PROPOSAL.md" -g "!docs/branding/SWEEP_SPEC_2026-06-04.md" -g "!docs/specs/DESIGN_SYSTEM.md" -g "!docs/standards/13-consistency-patch-notes.md"
rg "[\"']Inter[\"']" -g "!docs/branding/_research/06-typography-inter-vs-plex.md" -g "!docs/branding/PROPOSAL.md" -g "!docs/branding/SWEEP_SPEC_2026-06-04.md"

# (3) Standards consistent with D18 / D19 (no orphan token names)
rg "--gx-brand-primary|--gx-accent-gold\b" docs/standards
# (should return zero; old names removed from the family table in §4)

# (4) Brand-text — Portal/GAAex as PRODUCT BRAND only (manual review for
# false positives where 'portal' is a module name)
rg "\bGAAex\b"
# (zero expected platform-wide)
rg "\bPortal\b" -g "!frontend-portal/**" -g "!backend/app/routers/portal*.py" -g "!backend/app/routers/auth.py" -g "!backend/tests/test_portal*.py" -g "!backend/app/models/portal_*.py" -g "!backend/app/services/**" -g "!design-system/ui_kits/portal/**" -g "!docs/standards/**" -g "!docs/branding/**" -g "!*.md"
# (low/zero expected — non-zero hits are reviewed manually)

# (5) Visual — orchestrator runs the dev server, loads NocDashboardView,
# DashboardView, OrgView, CustomerView, and one Studio pane. Key tokens
# (--gx-primary, --gx-interactive, --gx-gold, --gx-text-1/2/3) all resolve
# to visible color. No bare 'serif' / 'monospace' fallback rendering anywhere.
```

If any check fails, the responsible crew member's commit is reverted and
re-issued.

---

## 11. Out of scope for THIS sweep (explicit list)

No crew member treats themselves as authorized to do any of the following in
this sweep. If you think one is needed, return-summary it; do not do it.

- **`frontend-portal/` folder rename.** Folder stays. Content only.
- **`design-system/ui_kits/portal/` folder rename.** Folder stays. Content only.
- **`v3-gaa-g-shape.svg` further work** beyond the single font-ref fix in §1.3.
- **`docs/branding/BRAND_BIBLE.md` authoring.** Separate M1-D stream.
- **`docs/specs/DESIGN_SYSTEM.md` full rewrite.** Only Batch 28 supersede notes in
  this sweep (§8.5).
- **`docs/BRAND.md` full pointer-rewrite.** Only the DEPRECATED header (§7).
- **Code-identifier renames** (route `/portal/...`, router names, class names,
  variable names, file paths containing `portal`). Brand-text only.
- **New token introduction.** No new `--gx-*` names land in this sweep. If a
  crew member finds a missing token, return-summary it for Ոսկերիչ's review.
- **D18 family table value changes.** Names get reconciled (§4); palette values
  stay locked.
- **Backend tenant-theme refactor.** Color-string scan is read-and-flag in
  tenant-theme paths; only non-theme strings get cleaned.
- **Git operations.** Crew members do not commit or push; the orchestrator
  handles git after each zone signs off.
