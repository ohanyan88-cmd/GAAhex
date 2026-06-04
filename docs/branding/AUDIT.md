# GAAhex Brand Audit — Ոսկերիչ, 2026-06-04

> Audit-only. Read-only across the repo except for files inside
> `docs/branding/`. Findings here become the worklist in `PROPOSAL.md` →
> Execution Plan, dispatched later by the orchestrator to Լոջ / Կյաժ / Կայծ.

## 0. Scope & method

- **Tree audited:** `Desktop/GAAhex/` (excluding `node_modules/`, `dist/`)
- **Files of record consulted:**
  - `CLAUDE.md` (orchestrator brief)
  - `docs/BRAND.md` (current brand declaration)
  - `docs/specs/DESIGN_SYSTEM.md` (Batch 28, 2026-05-27)
  - `design-system/README.md` (proposed reskin doc)
  - `docs/standards/09-design-system-standards.md` (LOCKED)
  - `docs/standards/13-consistency-patch-notes.md` (D17, D18, D19 sections)
  - `docs/standards/01-strategic-product-direction.md`
  - `frontend/src/styles/gaahex-tokens.css` (token implementation)
  - `frontend/src/styles/nms-tokens.css` (D18 routing exemplar)
  - `frontend/src/components/icons.tsx` (icon layer)
  - `frontend/package.json` (lucide-react ^1.17.0 confirmed)
  - `frontend/index.html` (favicon + manifest + theme-color)
  - `frontend/public/logo/*.svg` (3 logo variants)
  - Sample `views/*.tsx` copy strings (via Grep)
- **Memory consulted (read-only):**
  - `MEMORY.md`, `gev-identity.md`, `portal-rules.md`,
    `portal-m1-strategy.md`, `color-families-d18.md`,
    `kpi-tile-standard-d17.md`, `.md`,
    `gaahex-agent-crew.md`
- **Method:** descriptive audit. Three artefacts are compared against the
  current D17/D18/D19 lock and against each other. Deltas listed with
  file:section + current → proposed for handoff to Լոջ.

---

## 1. State of the brand today

There are **three independent brand artefacts** in the repo, and they do not
agree. Roughly:

| Artefact | Status | What it says |
|---|---|---|
| `docs/BRAND.md` | predates D18; predates the GAAhex rename in spirit | Cobalt + Gold only; uses `--bg/--surface/--text/--primary/--accent/--brand` tokens; font is `system-ui`; dark-first |
| `docs/specs/DESIGN_SYSTEM.md` (Batch 28, 2026-05-27) | predates D18 entirely; very thorough but stale on color families | Cobalt + Gold + Sidebar tokens; uses `--bg/--surface/--primary/--accent` tokens; identical font stack to BRAND.md; defines 46 icons; defines 22 pages in depth |
| `design-system/README.md` | aligned with the **azure-as-interactive** D18 principle (calls it out by name) | Cobalt = structure / Azure = action / Gold = prestige / Slate = neutrals — **closest** to the locked D18; uses `--gx-*` tokens; Space Grotesk + IBM Plex Sans + IBM Plex Mono fonts; specifies Lucide |
| `frontend/src/styles/gaahex-tokens.css` | **the actual code** | D18 family roles explicit in comments; full `--gx-*` token tier; azure-500 anchor; Plex Sans / Mono + Space Grotesk loaded from `/public/fonts/`; Cobalt + Gold + Azure + Slate + Semantic — five families implemented |

**This is the central audit finding: the design-system/README.md and gaahex-tokens.css are D18-aligned. The docs/BRAND.md and docs/specs/DESIGN_SYSTEM.md are NOT.** They predate D18 and still describe the old "Cobalt + Gold + interactive cobalt" world that the D18 patch was explicitly created to fix ("too much cobalt" failure mode, NMS dashboard 2026-06-03 evening).

Per **D19 (Rule ↔ Implementation Parity, LOCKED 2026-06-04)**, this is exactly the kind of standing contradiction D19 was written to prevent. The code is correct. The docs are stale. The standards/code stays as the source of truth; the brand docs must be brought into sync. **This is the headline of the audit.**

---

## 2. D18 alignment delta — file by file

### 2.1 `docs/BRAND.md` (the worst offender — pre-D18)

| Location | Current state | D18-aligned proposal |
|---|---|---|
| §1 "Brand core" table | Names two colors only: Deep Cobalt + Matte Gold | Five families: Cobalt (brand spine), Gold (signature), Azure (interactive), Slate (neutrals), Semantic (status). Cite D18 explicitly. |
| §2 "Semantic tokens" `--primary` | "brightened cobalt for buttons/links" — **assigns cobalt to interactive role** | This is the exact "too much cobalt" failure mode D18 fixes. `--primary` becomes the structural-brand token; `--gx-interactive` (azure) is the buttons/links token. |
| §2 `--accent` (gold) | "active states, focus rings, signature highlights" — includes "active states" | D18 says active state = azure border + azure-soft bg (interactive family). Gold is signature/peak only — one per view max. |
| §3 "Allocation rules" → "Primary actions" | "use `--primary` (brightened cobalt)" | Use `--gx-interactive` (azure). Reserve `--primary` for structural brand chrome. |
| §3 "Accent — gold is precious" → "active/selected emphasis, focus rings" | Mixes gold into active + focus | Gold for container hover (KPI tile, card) only (D17 § hover rule). Focus ring is azure in dark, azure in light (matches D18; replaces the old "gold focus ring" pattern). |
| §4 Iconography | Says emoji are banned; links to `frontend/src/icons.tsx` | Still valid. Update path: now `frontend/src/components/icons.tsx`. Note Lucide-react wrapper layer (it's lucide under the hood since the reskin). |
| §5 Component library link | "specified in `frontend/COMPONENTS.md`" | Verify this file exists; if not, retire the reference. (Not verified in this audit — flag for Լոջ.) |
| §6 Typography | `system-ui, -apple-system, "Segoe UI", sans-serif` | Contradicts `gaahex-tokens.css` which loads IBM Plex Sans + Plex Mono + Space Grotesk from `/public/fonts/`. Doc must be rewritten against the code. |

### 2.2 `docs/specs/DESIGN_SYSTEM.md` (Batch 28, 2026-05-27)

| Location | Current state | D18-aligned proposal |
|---|---|---|
| §1.2 "Color Rationale" | Only Cobalt + Gold + Obsidian/Charcoal mentioned | Add Azure + Slate as full citizen families. Reframe as five families per D18. |
| §2.3 "Brand Tokens" → `--primary` dark = `#3A6FB5` | Listed as "Buttons, links (brightened on dark)" | Per D18, buttons/links use `--gx-interactive` (azure-500 = `#0EA5E9`), not the cobalt-derived `--primary`. The `--primary` is structural. |
| §2.5 Focus Ring → Dark = `rgba(197,160,89,0.55)` (gold) | "gold focus ring (the GAAhex signature)" | D18 split: focus on interactive elements is azure ring (`--gx-interactive-ring`); brand-moment focus may stay gold. Default focus = azure. |
| §3.2 Palette options | Lists `midnight / forest / slate / sepia / high-contrast` palettes | Risky — none of these are D18-validated. Recommend pruning to dark + light + high-contrast for M1; defer the others to M3+. Each new palette is a full five-family declaration, not a token tweak. |
| §10 Icon Library | "46 SVGs" — hand-rolled list | Already wrapped as lucide-react per the icons.tsx header. Update spec to declare Lucide as the locked library (already true in `design-system/README.md` §4). |
| §11.1 Buttons → `.btn-primary` dark bg = `#1C3B68` | Cobalt button background | D18 violation: buttons are interactive, must use azure. Rewrite to azure-500 / azure-400 hover. (`gaahex-tokens.css` already has `--gx-interactive*` ready.) |
| §11.2 Inputs → "hover: gold border" | Gold tint on every input hover | D18 violation: inputs are interactive controls — hover is azure tint. Containers (cards, KPI tiles) get gold hover. |

### 2.3 `design-system/README.md` (the closest to D18, only minor drift)

| Location | Current state | D18-aligned proposal |
|---|---|---|
| §3 "The big idea" | "cobalt is structure, azure is action, gold is prestige, slate is everything else" | Almost verbatim D18. Add the fifth family (Semantic) explicitly. |
| §3 Color — Cobalt | "Never a button fill (too dark to be interactive on dark)" | Correct. Aligned. |
| §3 Color — Gold ratio | "Roughly a 90/8/2 split of slate / azure / gold across any screen" | Sound rule; not in D18 explicitly. Recommend lifting into the brand bible as a measurable discipline (the "≤2% gold" budget). |
| §3 Typography | Space Grotesk + IBM Plex Sans + IBM Plex Mono | Matches `gaahex-tokens.css`. Aligned. |
| §4 Iconography | "Lucide" — locked | Aligned. |
| §6 Caveats | "This is a proposed reskin: it intentionally diverges from the current in-app tokens per your request to 'ignore the existing design and offer a new one.'" | This caveat is now **stale and misleading.** The reskin shipped; this *is* the current design. Rewrite the caveat — or delete it — when this file becomes the canonical brand doc (proposed in Execution Plan). |

---

## 3. Logo state

### 3.1 What exists today

In `frontend/public/logo/`:
- `GAAhex-logo-cobalt-gold.svg` — full-color wordmark, 380×170 viewBox
- `GAAhex-logo-reversed.svg` — light/platinum on dark variant
- `GAAhex-mark.svg` — standalone mark, 512×512 square viewBox

Plus app icons at `public/app-icons/` (PNG 192/512 + maskable + apple-touch) and favicons at `public/favicon/` (16/32/48 PNG + ICO + SVG).

### 3.2 What the marks actually depict

Looking at `GAAhex-logo-cobalt-gold.svg` directly:

- **"G" element** at x≈70–116 — a circle-with-bar shape (open circle + horizontal stroke). Renders in **cobalt gradient**.
- **"A" element** at x≈150–200 — a triangular/peaked stroke that reads as a capital A. Cobalt gradient strokes; cobalt-filled triangular tip at the top; **three small gold-filled triangles below the apex stack like a pyramid/triadic mark**.
- **"EX" mark** at x≈258 — a circle stroked in gold, with the text "EX" centered in gold, rendered in Arial/Helvetica fallback.

### 3.3 Honest assessment

This is a wordmark trying to spell out "G·A·EX" with structural glyphs, where the second A is the "pyramid" element. The construction is competent but with **three real problems** to flag:

1. **The "EX" cell uses Arial/Helvetica** as the font (`font-family="Arial, Helvetica, sans-serif"`). Hardcoded inside the SVG. This means the logo's wordmark portion is **brand-incoherent with the rest of the system** (which is Space Grotesk + Plex Sans). Anyone reading the logo carefully sees a typeface they will never see anywhere else in the platform.
2. **Heavy use of gradients** (3-stop cobalt, 3-stop gold). Gradients in logos work, but Gev's stated taste (Notion/Linear/Tailscale, flat vector, anti-luxury) is **flat fills, not gradients**. Linear's wordmark is flat ink. Tailscale's mark is flat ink. Vercel's mark is flat ink. The gradient choice reads "premium telecom" — that's the casino-sparkle/luxury direction Gev rejected.
3. **The shapes are doing a lot of work.** "G as circle + bar" and "A as stroked triangle with three gold pyramid triangles below" require the viewer to decode them. At favicon size (16×16), the cobalt + gold + Arial-EX will all collapse to mush. The `GAAhex-mark.svg` (standalone, no EX) at favicon size will too — it's still 7 stroke + fill paths.

### 3.4 What Gev approved (per session memory and the CLAUDE.md taste)

The CLAUDE.md and `design-system/README.md` both consistently describe the
target taste as "premium operations console" / "Bloomberg-terminal seriousness
softened by a premium, trustworthy brand." The memory and Gev's chat record
(per the brief into this session) names Notion / Linear / Tailscale as the
taste anchors and explicitly excludes luxury / casino / Web3-maximalism /
mobile-game aesthetics.

**The current logo is closer to the rejected direction than to the approved one.** The gradients are luxury-coded. The Arial EX is a tell that the design wasn't finished as a system. The standalone mark is too complex for a favicon.

This is not a small finding. It belongs in PROPOSAL.md as a recommended **logo refresh brief** (deliverable: `LOGO_BRIEF.md` for an external designer or for Gev to feed into an AI image tool). Not a destructive change in this audit — we don't replace the logo. We propose it for the orchestrator.

---

## 4. Typography state

### 4.1 What the platform actually loads (the truth)

From `frontend/src/styles/gaahex-tokens.css` lines 22–102:

- **Display:** Space Grotesk (variable, 400/500/600/700) from `/public/fonts/space-grotesk-var.woff2`
- **UI / body:** IBM Plex Sans (variable, 400/500/600/700) from `/public/fonts/ibm-plex-sans-var.woff2`
- **Mono:** IBM Plex Mono (static, 400/500/600) from `/public/fonts/ibm-plex-mono-400.woff2` etc.
- **Armenian fallback:** Noto Sans Armenian (declared in `--gx-font-am`)

### 4.2 What the docs say

- `docs/BRAND.md` §6: `system-ui, -apple-system, "Segoe UI", sans-serif` — **wrong**, predates the type system.
- `docs/specs/DESIGN_SYSTEM.md` §4: same `system-ui` stack — **also wrong**.
- `design-system/README.md` §3: Space Grotesk + IBM Plex Sans + IBM Plex Mono — **correct, matches the code**.

### 4.3 Verdict

The type system is **intentional and locked in code.** The brand docs are stale by two-three sprints. This is a one-pass doc rewrite, not a system change. See Execution Plan for the Լոջ worklist item.

**One thing not verified in this audit (not in scope to read):** whether `/public/fonts/*.woff2` files actually exist. Ոսկերիչ did not touch font files. Flag for Կայծ to verify in a separate pass; if missing, fonts silently fall back to system-ui at runtime, and the brand suffers without anyone noticing.

---

## 5. Voice state

### 5.1 Sample strings from `frontend/src/views/`

From `AccountsView.tsx` (representative):

| Surface | Copy |
|---|---|
| View title | `"Accounts"` |
| Subtitle | `"Multi-tenant B2B parent-child accounting"` |
| Section heading | `"Summary"` |
| Empty state title | `"No accounts"` |
| Empty state message | `"Create an account against a party to start billing it."` |
| Empty state (unavailable) | `"Accounts aren't available yet"` / `"The accounts layer will appear here once enabled."` |
| Section empty | `"No activity recorded yet"` / `"Changes to this account will appear here."` |
| Comments empty | `"No comments recorded yet"` / `"Comments on this account will appear here."` |
| Approvals empty | `"No approvals recorded yet"` / `"Approval requests on this account will appear here."` |
| Audit empty | `"No audit entries recorded yet"` / `"Field-level changes to this account will appear here."` |

### 5.2 What this reveals

**Good:**
- Sentence case throughout. ✓ (matches `design-system/README.md` §2)
- Terse, no fluff. ✓
- The "will appear here" pattern is consistent across empty states — **this is a real voice pattern in the wild.**
- Active voice. ✓
- No emoji. ✓ (matches the `docs/BRAND.md` §4 hard rule)
- Explanatory subtitle ("Multi-tenant B2B parent-child accounting") — explains what the screen is *for*, not just what it's called. Good.

**Concerns:**
- The "recorded yet" pattern is fine but slightly bureaucratic. "No activity yet" reads as well as "No activity recorded yet" and saves a word — but consistency matters more than micro-optimization. Leave for now.
- Subtitles like "Multi-tenant B2B parent-child accounting" are operator-correct but slightly enterprisey; lean more honest with phrasing like "Customer accounts and balances" when natural. Not urgent.
- No surface in the sampled views speaks Armenian. Per `portal-rules.md`, code/file paths are English (correct) but the platform itself will run for Armenian-speaking operators in M1. **The localization layer exists in the code** (`t('accounts.empty', 'No accounts')` pattern, English fallback). That's the right architecture. But the Armenian copy itself isn't part of the brand bible yet, and it should be — the voice in Armenian needs the same discipline as the voice in English.

### 5.3 Alignment with honesty floor (`.md`)

The sampled copy is honest and direct in the way the Aşough brief calls for. No
performed warmth, no fake-friendly. It also doesn't have any of the family-
register depth — but that's correct: the books carry that register, not the
product chrome.

**Verdict: voice in code is healthier than voice in docs.** There is no voice
doc in `docs/`, but the patterns in the code are coherent and would survive
being formalized verbatim. The proposal is to codify the patterns that exist,
not invent a new voice over them.

---

## 6. Iconography state

- **Library:** lucide-react ^1.17.0 (per `frontend/package.json`)
- **Wrapper:** `frontend/src/components/icons.tsx` re-exports lucide icons under the original GAAhex names (`BellIcon` = `Bell`, etc.) for backwards compatibility
- **Style:** stroke="currentColor", strokeWidth=2, fill="none", viewBox="0 0 24 24" (per the wrapper header comment)
- **Defaults:** size 18px, strokeWidth 2
- **Spec doc:** `design-system/README.md` §4 declares Lucide as the locked library and maps ISP-domain concepts to specific Lucide icons (`router`, `server`, `radio`, etc.)
- **Hard rule (from `docs/BRAND.md` §4):** zero emoji in product UI; allowed only in human-authored chat/email bodies.

**Verdict: iconography is the healthiest part of the brand surface today.** It's locked, consistent, code-aligned, and documented. The only doc work is to bring `docs/specs/DESIGN_SYSTEM.md` §10 (which still describes 46 hand-rolled SVGs) into sync with the lucide-react reality. Worklist item for Լոջ.

---

## 7. Gaps — what doesn't exist yet

- **No brand bible.** Three partial brand docs exist; none of them is a brand bible. Nothing pulls voice + visual + logo + usage + misuse + legal into one operating doc.
- **No standalone voice doc.** Patterns in the code are good but uncodified.
- **No logo construction grid spec.** No clear-space rule. No minimum-size table. No misuse gallery. (The logos exist, but the rules for *using* them don't.)
- **No motion guidelines beyond tokens.** `gaahex-tokens.css` has duration + easing tokens; nothing says *when* to use which motion (other than the D17 KPI tile rules and the D18 hover-affordance split). A short "motion voice" doc would help.
- **No illustration system.** Per `design-system/README.md` §3: *"The brand is graphic, not photographic — the pyramid mark, cobalt/gold gradients, and the network topology itself are the imagery."* That's a position, not a system. If we ever need an empty-state illustration that isn't an icon-at-40px, we have no source.
- **No photography direction.** Same — declared as "if photos appear, cool-toned" but undefined for real use (technician avatars, partner case studies, marketing pages).
- **No co-brand / partner-logo rules.** Stripe Elements will render inside GAAhex Pay views in M1-C. We need a one-line rule for "GAAhex + Stripe lockup" — even just "don't combine the wordmarks."
- **No localization layer in the brand doc.** Voice rules for Armenian are absent; the platform will be Armenian-language in M1.
- **No "what GAAhex is NOT" section.** Defining the negative space is half the brand. We have it in memory (`portal-rules.md`, `gev-identity.md`, the session brief) but not on paper for the next agent to read.
- **No tenant-customization guidance.** `docs/specs/DESIGN_SYSTEM.md` §1 declares "tenant admins can upload their own logo and configure a brand color — this overrides `--brand` and `--primary` tokens." This is a real feature but the brand bible doesn't say what's overridable, what isn't (the GAAhex chrome around the tenant brand should still be GAAhex), and what the constraints are (contrast minimums, etc.).

---

## 8. Three biggest brand-state surprises

For the orchestrator's attention:

### Surprise 1 — Three docs, three different brands

`docs/BRAND.md`, `docs/specs/DESIGN_SYSTEM.md`, and `design-system/README.md` describe **three different versions** of the brand. The code is one version (D18, current). Only `design-system/README.md` is close to the code. The other two are stale enough that a new agent reading them would write *the wrong code*. This is a D19 violation by definition.

### Surprise 2 — Gold focus ring is the brand's signature, per the docs — and it's wrong

`docs/BRAND.md` §2 and `docs/specs/DESIGN_SYSTEM.md` §2.5 both proudly claim **gold focus ring is the GAAhex signature**. Per D18 + D17 reconciliation, **focus on interactive elements is azure, not gold.** Gold is reserved for container hover (KPI tiles, cards). The "gold focus ring" line is exactly the kind of pre-D18 vestige D19 was written to catch. It's also a real visual bug if someone reads the docs and writes a focus style.

### Surprise 3 — The logo wordmark contains Arial

`GAAhex-logo-cobalt-gold.svg` line 31 — the "EX" portion is rendered as
`font-family="Arial, Helvetica, sans-serif"`. The platform doesn't use Arial
anywhere else. This is either a finishing-pass oversight or evidence that the
logo was assembled by trial and never given a proper type pass. Either way,
it's a real defect: the brand wordmark contains a font that conflicts with the
brand type system. **The fix is non-trivial** — it requires either outlining
the EX as paths (so no font dependency) or rebuilding the EX cell in the
brand's actual display face (Space Grotesk). Both are designer-grade tasks,
not text-edit tasks. PROPOSAL.md captures this in the Logo Brief.

---

## 9. What the audit explicitly did NOT cover

For honesty (per the honesty floor):

- **Did not verify font files exist** at `/public/fonts/*.woff2`. Flag for Կայծ.
- **Did not run any tests, build, or dev server.** Per Ոսկերիչ's hard rules.
- **Did not touch `backend/.env`.** Per Ոսկերիչ's hard rules.
- **Did not read every view** — sampled `AccountsView.tsx` deeply, grepped patterns across all views. A full voice sweep across 22 production views is a separate pass (Լոջ-grade).
- **Did not audit Storybook.** `package.json` has Storybook deps. Whether stories exist for brand surfaces (logo, color, type) is not checked. Worth a follow-up.
- **Did not audit the Armenian copy paths.** `--gx-font-am` declares Noto Sans Armenian; whether the font is loaded and whether Armenian strings exist in views was not surveyed. Worth a follow-up.
- **Did not look at `dist/`** (build output). Brand audit operates on source, not artefacts.
- **Did not audit the `backend/` for any user-facing copy** (e.g., transactional email templates, webhook payload labels). Brand voice extends to backend-authored text; flag for a follow-up pass.

---

End of audit. Worklist lives in `PROPOSAL.md` → Execution Plan.
