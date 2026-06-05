# D19 — Token Registry Reconciliation Plan

**Status:** ANALYSIS · planning only · NO CODE CHANGES yet
**Date:** 2026-06-05 (autonomous session, Gev away from desk)
**Anchored on:** `docs/architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md` ([TD11](#td11-from-baseline)) + the D19 doctrine in `docs/standards/13-consistency-patch-notes.md` ("Rule ↔ Implementation Parity — no standing rule/code contradiction").

> **Important.** This document **only analyzes** the token registry. No code change in this commit. A finding below is **critical**: my earlier T-P3-10 codemod (266 bare-px → space tokens) is likely **rendering a visually different result than the original bare-px values** because of the same divergence this doc analyzes. Gev needs eyes on it before any code action.

---

## TL;DR

- `gaahex-tokens.css` defines **136** `--gx-*` keys.
- `color-tokens.css` defines **79** `--gx-*` keys.
- **62** keys are defined in BOTH files. By CSS cascade order (`color-tokens.css` loads after `gaahex-tokens.css` in `main.tsx`), the `color-tokens.css` value wins at runtime for every overlap.
- Of the 62 overlapping keys: **37 have identical values** (harmless duplication), **21 have divergent values** (color-tokens.css overrides), **4 are orphans** (consumed by nothing — safe to delete from either file).
- **14** keys exist ONLY in `color-tokens.css` and are orphan — pure dead weight.
- The 21 divergent keys include the **spacing scale** (`--gx-space-3` through `--gx-space-12`). These divergences mean the admin SPA renders with a meaningfully different spacing scale than the values documented in `gaahex-tokens.css` — and meaningfully different from what my T-P3-10 codemod assumed.

---

## 🚨 Critical finding: T-P3-10 codemod outcome ≠ T-P3-10 codemod intent

In a prior session I ran T-P3-10 (266 bare-px values → `var(--gx-space-N)` tokens) using the gaahex-tokens.css scale:

| px | I assumed (gaahex-tokens.css) | Reality at runtime (color-tokens.css wins) |
|---|---|---|
| 8 | `--gx-space-3` = `8px` | `--gx-space-3` = `6px` |
| 12 | `--gx-space-4` = `12px` | `--gx-space-4` = `8px` |
| 16 | `--gx-space-5` = `16px` | `--gx-space-5` = `10px` |
| 20 | `--gx-space-6` = `20px` | `--gx-space-6` = `12px` |
| 24 | `--gx-space-7` = `24px` | `--gx-space-7` = `16px` |
| 32 | `--gx-space-8` = `32px` | `--gx-space-8` = `20px` |
| 80 | `--gx-space-12` = `80px` | `--gx-space-12` = `24px` |

**Practical effect:** every site touched by T-P3-10 is now rendering ~25–70% tighter than it did before the codemod. The admin SPA's spacing scale shrank uniformly across 73 files / 266 sites.

This wasn't caught because:
- `tsc` passes (token references are syntactically valid).
- pytest passes (it doesn't render pixels).
- The drift checker passes (the migration was the intent).
- No visual review happened between the codemod and now.

**This is the doctrine D19 was written to prevent** — a rule said one thing (the gaahex-tokens.css token scale) and the code did another (color-tokens.css overrides). My codemod assumed the doctrine; the runtime followed the code.

### What I am NOT doing (and why)

- **Not reverting T-P3-10.** Per Gev's standing instruction "do not reopen broad cleanup", reverting 73 files would re-introduce the bare-px count and lose the tokenization win. The migration is mechanically correct; only the value of the destination tokens is wrong.
- **Not editing either token file unilaterally.** The decision of WHICH scale is canonical (gaahex's larger spacing vs color's tighter spacing) is a design choice — Gev's call, not mine, and certainly not one to make without eyes on the actual rendered UI.
- **Not adjusting the codemod mapping retroactively.** Changing the px → space mapping table after the fact would re-touch every file again with a different value, doubling the visual churn.

### What I AM doing

- Documenting the finding here, prominently, so Gev sees it the moment he opens the repo.
- Capturing the exact data (key-by-key divergence below) so the reconciliation decision is informed.
- Proposing two reconciliation paths in [§5](#5-proposed-reconciliation-paths), with explicit risk and rollback for each.

---

## 1. Background

Per the [2026-06-05 sealed baseline TD11](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#td11-t-p3-1--gaahex-tokenscss-vs-color-tokenscss-double-registry-d19):

> Both files define `--gx-*` tokens; `color-tokens.css` loads after `gaahex-tokens.css` and wins by cascade order for the 86 keys they share. Headers in both files document this. Merging properly requires a key-by-key visual audit across both themes — a multi-day task. Until then, **new tokens go in `gaahex-tokens.css`**; `color-tokens.css` is override-only.

This document is the "key-by-key" inventory the TD entry promised. The actual reconciliation (deletions / edits / cascade fix) is **not** in this document. This is the data; the decision is Gev's.

### Load order (from `frontend/src/main.tsx`)

```typescript
import './styles/gaahex-tokens.css'   // line  8  — defines 136 keys
import './styles/primitives.css'
import './styles/tailwind.css'
import './styles/color-tokens.css'    // line 11  — defines 79 keys (62 overlap)
```

CSS cascade: same-specificity declarations from a later stylesheet win. So for every key defined in BOTH files, the `color-tokens.css` value is what the browser uses.

---

## 2. Aggregate stats

| Metric | Count |
|---|---|
| `gaahex-tokens.css` defines | 136 keys |
| `color-tokens.css` defines | 79 keys |
| **In both** (color wins) | **62** |
| `gaahex-tokens.css` only | 74 |
| `color-tokens.css` only | 17 |
| **In both AND orphan** (safe to delete from either) | **4** |
| `color-tokens.css` only AND orphan (safe to delete) | **14** |
| In both AND consumed AND **identical values** | 37 |
| In both AND consumed AND **divergent values** | **21** |

---

## 3. The 21 divergent keys (color wins; gaahex value is documentation drift)

Each row below is **a real visual override**. The column "Rendered" is what the browser actually paints; "Gaahex doc" is what the registry file claims; the gap between them is the D19 violation.

### 3a. Spacing scale (the codemod hits these hardest)

| Key | Rendered (color-tokens.css) | Gaahex doc | Used by |
|---|---|---|---|
| `--gx-space-3` | `6px` | `8px` | T-P3-10 codemod (~90 sites); `<Stack gap="sm">` semantic |
| `--gx-space-4` | `8px` | `12px` | T-P3-10 codemod (~50 sites); `<Stack gap="md">` semantic |
| `--gx-space-5` | `10px` | `16px` | T-P3-10 codemod (~40 sites); `<Stack gap="md">` semantic |
| `--gx-space-6` | `12px` | `20px` | T-P3-10 codemod (~25 sites); `<Stack gap="lg">` semantic |
| `--gx-space-12` | `24px` | `80px` | rarely used; would be very wrong if used as documented |

Practical impact: every place I migrated bare px to a space token is rendering smaller than before. ~25-70% tighter, uniformly.

### 3b. Brand colors

| Key | Rendered (color-tokens.css) | Gaahex doc |
|---|---|---|
| `--gx-cobalt` | `#1C3B68` (logo mid — core) | `var(--cobalt-700)` = `#1C3B68` |
| `--gx-gold` | `#C5A059` (logo mid — core) | `var(--gold-500)` = `#C5A059` |
| `--gx-danger` | `#F0666B` | `var(--red-400)` = `#F0666B` |
| `--gx-info` | `#5293F2` | `var(--azure-400)` (LIGHTER) |
| `--gx-online` | `#34C77B` | `var(--green-400)` = `#34C77B` |
| `--gx-neutral` | `#94A3B8` | `var(--slate-400)` = `#94A3B8` |

For brand colors most divergences are presentation-equivalent (the gaahex doc references a primitive that resolves to the same hex). The exception:
- `--gx-info`: color says `#5293F2`, gaahex says `var(--azure-400)` which is `#38BDF8` — these are **different blues** (color's is darker, gaahex's is lighter). Real visual divergence on info badges.

### 3c. Interactive surface

| Key | Rendered | Gaahex doc | Notes |
|---|---|---|---|
| `--gx-link` | `#5293F2` | `var(--gx-interactive)` | Decoupled — `--gx-interactive` is `var(--azure-500) = #0EA5E9`, so links are darker blue in render than docs imply |
| `--gx-ring` | `rgba(82, 147, 242, 0.55)` | `var(--gx-interactive-ring)` | Focus ring color drift |
| `--gx-selected` | `rgba(59, 123, 224, 0.16)` | `var(--gx-interactive-soft)` | Selection tone drift |

### 3d. Typography

| Key | Rendered | Gaahex doc |
|---|---|---|
| `--gx-font-mono` | `'IBM Plex Mono', 'SF Mono', ui-monospace, monospace` | `'IBM Plex Mono', 'SF Mono', ui-monospace, 'Cascadia Code', monospace` |

Identical-except-for-`Cascadia Code` insertion in gaahex. Cosmetic only; both files have the right primary font.

---

## 4. The orphan inventory (safe to remove, decoupled from the divergence question)

### 4a. In BOTH files AND consumed by nothing (4 keys)

Safe to remove from either file with zero visual impact:

- `--gx-maintenance`
- `--gx-provisioned`
- `--gx-quality-good`
- `--gx-radius-none`

These are all part of the NMS network-status family — the [sealed baseline TD3](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#td3-48-orphan---gx--tokens) accepts them as documented future-use. The question for this file is just: do they need to be in BOTH places? No. Pick one.

### 4b. In `color-tokens.css` ONLY AND orphan (14 keys)

Pure dead weight in `color-tokens.css`. Already removed equivalents from `gaahex-tokens.css` in a prior session (T-P3-6) but `color-tokens.css` kept them.

- `--gx-active`
- `--gx-glow-primary`
- `--gx-link-hover`
- `--gx-pressed`
- `--gx-primary-active`
- `--gx-primary-hover`
- `--gx-raised`
- `--gx-shadow-focus`
- `--gx-space-10`
- `--gx-space-20`
- `--gx-text-22`
- `--gx-text-9`
- `--gx-weight-normal`
- `--gx-z-dropdown`

Action: deletable from `color-tokens.css` in one pass with zero risk. **Recommended low-risk cleanup.** Confirmed via grep — none of these are referenced by any `.tsx`/`.ts`/`.css`/`.html` file anywhere in `frontend/src/`.

---

## 5. Proposed reconciliation paths

These are **options for Gev**, not actions I'm taking. Each path has a different blast radius and review surface.

### Path A — "Color-tokens.css is canonical" (lowest risk)

Premise: the admin SPA's CURRENT rendered look is what users expect, because that's what's been shipping. The gaahex-tokens.css values are aspirational / documentation drift. Adopt the rendered reality as canonical.

**Steps (Gev approves; engineer executes — NOT this PR):**

1. Edit `gaahex-tokens.css` to match `color-tokens.css` for all 21 divergent keys.
2. Delete `color-tokens.css` entirely.
3. Remove its `import './styles/color-tokens.css'` line from `main.tsx`.
4. Run the visual smoke (the 22-step M0 + M1 manual flow in the staging readiness report) and confirm zero visual change. (There shouldn't be any — by definition; the rendered values are unchanged.)

**Pros:** Single source of truth; zero rendering change.
**Cons:** The spacing scale that admins write to (gaahex doc) no longer matches the spacing tokens (gaahex doc) — they shrink. But the docs *will* match the runtime, which is the D19 goal.
**T-P3-10 status post-Path-A:** the codemod's outcome IS the intent — the rendered spacing IS what the tokens say.

### Path B — "Gaahex-tokens.css is canonical" (highest risk — visual change)

Premise: the gaahex-tokens.css values are the intended design (larger spacing, more breathing room), and `color-tokens.css` is dead-code drift from before the redesign. Promote the gaahex values to runtime.

**Steps:**

1. Delete `color-tokens.css` entirely.
2. Remove its `import` from `main.tsx`.
3. Now the spacing scale SHIFTS upward: every site using `var(--gx-space-3)` renders at `8px` instead of `6px`, etc. The admin SPA gets a uniform ~25-70% loosening.
4. Mandatory visual review across every page — KPIs, modals, tables, drawers, customer detail, studio panes, settings. Maybe 100+ screenshots.

**Pros:** The design system's documented intent becomes reality.
**Cons:** Every layout shifts. Some sites that *intentionally* used 6/8/10px spacing (because color-tokens.css always rendered 6/8/10) get bumped up. Some layouts that fit just-right at the tighter scale break at the looser scale. **Days of visual triage.**
**T-P3-10 status post-Path-B:** the codemod's outcome NOW matches its intent. But every untouched site that DIDN'T go through the codemod (and is using literal `padding: 16` somewhere) keeps the old rendering; only the codemod's sites visually change. That asymmetry is its own problem.

### Path C — "Decouple T-P3-10's mapping from the conflict" (compromise)

Premise: don't fix D19 today; fix the codemod's mapping so its outcome matches its intent under the current cascade.

**Steps:**

1. Run a corrective codemod that re-touches the 266 sites from T-P3-10 with a CORRECTED mapping: `8px → space-4` (not space-3), `12px → space-5` (not space-4), etc. — using the color-tokens.css values as the source of truth for what the token currently renders.
2. Update the M1 plan to note that the token scale's runtime values are color-tokens.css's, not gaahex-tokens.css's.

**Pros:** Restores the original rendered spacing of the 266 sites (the codemod's intent — visual identity to the pre-codemod state). Doesn't require deleting either file.
**Cons:** Doesn't fix D19 itself — both files still exist with overlapping definitions. T-P3-10's number of sites touched doubles in the git history. Still requires visual review of the 266 sites to confirm the corrective codemod actually restored their pre-codemod look.
**T-P3-10 status post-Path-C:** the codemod's outcome IS the original intent (pre-codemod rendered look). D19 stays open.

### My recommendation (if forced to pick): **Path A**

- Lowest risk (zero pixel change).
- Single source of truth (the D19 win).
- Documents-the-reality, which is the honest move when reality has drifted from documentation.
- Future PRs can then move the spacing scale UP (toward the original gaahex aspiration) deliberately, as a designed change with visual review — not as an accidental side effect of D19 reconciliation.

But this is **Gev's call.** I'm flagging the choice space; I'm not making the choice unilaterally because every path changes either rendered pixels OR documentation truth.

---

## 6. The clean win we can take RIGHT NOW (orphan cleanup)

Independent of the divergence question, the 14 orphan keys in `color-tokens.css` (listed in [§4b](#4b-in-color-tokenscss-only-and-orphan-14-keys)) can be deleted today with **zero risk**. None are referenced anywhere; deleting them just reduces `color-tokens.css`'s line count by ~14 lines.

I am NOT taking this win in this session. Two reasons:
1. Even "safe orphan" deletions need a visual smoke I can't run from here.
2. Doing the 14-orphan cleanup separately from the bigger D19 path muddles the git history when Gev decides on a path.

When Gev picks Path A or B, the 14-orphan deletion folds into that PR for free. If he picks Path C, the 14-orphan deletion can be its own 1-PR clean-up.

---

## 7. Risk-not-fixing analysis

If neither path is taken, what's the failure mode?

- **Visual drift between docs and reality** (the spacing scale renders 25-70% tighter than `gaahex-tokens.css` documents). Already true today; T-P3-10 made it worse but didn't introduce it.
- **Future codemods could repeat my T-P3-10 mistake.** Anyone reading `gaahex-tokens.css` and writing migration code would assume those are the live values. The headers in both files document the cascade order, but a quick read of just one file would miss it.
- **The drift checker doesn't catch this.** It checks textual patterns, not runtime values. No mechanical net is currently in place for "did the documented value match the rendered value?"

### Mitigation (low-risk, doc-only)

I could add **headers WITHIN the divergent keys themselves** in `gaahex-tokens.css` — a comment immediately before each divergent definition saying:

```css
/* ⚠️ OVERRIDDEN by color-tokens.css. Runtime value: 6px (not 8px below).
   See docs/audit/D19-TOKEN-REGISTRY-RECONCILIATION-PLAN.md */
--gx-space-3: 8px;
```

This is purely additive (comments only, zero runtime change) and would prevent the next contributor from making my T-P3-10 mistake. But adding 21 such comments across `gaahex-tokens.css` is itself a meaningful diff that should be reviewed.

**I am NOT making this edit in this session** for the same reason as the orphan cleanup — it muddles the eventual reconciliation diff. If you decide to defer reconciliation, the in-file comment mitigation is a separate, safe PR you can authorize.

---

## 8. Acceptance criteria for closing D19 (TD11)

D19 is "closed" when:

- [ ] **DD1.** One source of truth: either `gaahex-tokens.css` OR `color-tokens.css` exists; not both. (Path A or Path B taken.)
- [ ] **DD2.** Every `--gx-*` token used by any frontend file resolves to its documented value at runtime. (Verified by parsing the CSS file + grep'ing `var(--gx-)` usage; the orphan-detection script in this analysis is the seed for that test.)
- [ ] **DD3.** A drift-checker rule (HARD) added: forbid defining a `--gx-*` key in any file other than the canonical one (or a documented theme-override file like a future `colors-light.css` if introduced).
- [ ] **DD4.** The visual smoke (M0 + M1 manual flow) passes against the reconciled CSS.
- [ ] **DD5.** [Sealed baseline TD11](../architecture/SEALED-ARCHITECTURE-BASELINE-2026-06-05.md#td11-t-p3-1--gaahex-tokenscss-vs-color-tokenscss-double-registry-d19) is removed from the TD list (or marked RESOLVED) in the next successor sealed baseline.

---

## 9. What this analysis does NOT change

Per the sealed baseline's rules + Gev's "do not change architecture" guardrail:

- **No code changes** in this commit. This file is doc-only.
- **No invariant relaxation.** TD11 stays where it is in the baseline.
- **No drift rule added.** That belongs to the eventual reconciliation PR.
- **No file deletion.** Both `gaahex-tokens.css` and `color-tokens.css` still load identically to before.
- **No T-P3-10 codemod revert.** The bare-px values are gone; the tokens stay.

The thesis stays intact. The killer test stays green. The CI stays green. The visual drift is **documented**, not **fixed**.

— Ընգեր, 2026-06-05 (autonomous session)
