# GAAhex — build guide

GAAhex is the platform aiming to be the only place of work for an entire ISP. The **architecture
blueprint** is in `../GAAhex-Vision/` (start at its `README.md`); this repo is the **build**.

**Where we are:** Phase 0 / **M0** — see `../GAAhex-Vision/6-platform-delivery/31-phase-0-scope.md`
for the milestone plan (M0–M6) and the locked tech stack.

**The thesis we're proving:** the system renders & behaves from **configuration**, enforced by 5
fixed kernel engines (WorkItem movement · auth/authz · database · audit/log · security) — with no
hardcoded screens or business rules. The killer test: stand up a 2nd entity with **config only**.

## Run (dev)
```bash
docker compose up -d                                   # Postgres(:5433) + Redis(:6380)
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8099
```
Swagger: http://127.0.0.1:8099/docs

## Conventions
- **Everything written down** — decisions go into the blueprint docs, not just memory.
- **Kernel Line:** engines are fixed; what's expressed on top is configuration.
- Keep the code clean and the kernel small.

---

# 🎨 Brand (LOCKED — consult before any visual/identity work)

`docs/branding/v3.0/` holds the **certified canonical brand package** (Brand v3.0, LOCKED 2026-06-06). Logo, color, typography, voice, naming, brand architecture — all source-of-truth lives there. The pointer is `docs/branding/README.md`.

- **D18 Color Architecture is authoritative.** Cobalt = spine · Gold = signature · Azure (`#0EA5E9`) = interactive · Slate = neutrals · Semantic = status. One family, one role; **roles never overlap.**
- **Trademark:** the canonical name is **GAAhex™**.
- **No redesign, reinterpretation, or "improvement."** Logo geometry / spacing / typography / brand architecture are unchanged. Any new asset must derive from `docs/branding/v3.0/00-source/gaahex-master.*`.
- **Runtime assets** in `frontend/public/` (`logo/`, `favicon/`, `app-icons/`, `social/`) are v3.0 derivatives as of 2026-06-06. The pre-v3.0 originals (the old `_archive-pre-v3.0/` rollback copy) were removed 2026-06-13 (Gev) as redundant — they remain recoverable from git history (any commit before the v3.0 cutover) if an emergency rollback is ever needed.
- **Runtime tokens** in `frontend/src/styles/gaahex-tokens.css` are governed by D19 Path A (sealed 2026-06-05). Brand-source tokens at `docs/branding/v3.0/11-figma/tokens/gaahex-tokens.css` are the reference; the runtime is the canonical at-deploy values.

A change that would relax any brand rule is a sealed-baseline conversation, not a casual PR.

---

# 📐 Standards (LOCKED — consult before implementing)

`docs/standards/` holds **70 LOCKED platform standards** (the single source of truth for every
data model, enum, permission key, UI primitive, page type, and lifecycle behavior on this platform).
**Every agent — backend or frontend — must consult the relevant standard before implementing a
change.** If your code would diverge from a standard, FLAG IT in your return summary so the
orchestrator can decide: align, document an exception, or revise the standard.

## Where to look first
- **`docs/standards/00-standards-index.md`** — canonical index of all 70 standards (TOC + status + dependencies)
- **`docs/standards/14-enum-registry.md`** — every enum name, owner department, and `UPPER_SNAKE_CASE` values
- **`docs/standards/15-permission-registry.md`** — `object.action` permission keys (immutable once released)
- **`docs/standards/13-consistency-patch-notes.md`** — normalization patches (B1–B5, S1–S5, D1–D20). D17 = KPI Tile Standard (no premium highlight, colored value text + tooltip). D18 = Color Token Families (Cobalt = brand spine · Gold = signature · Azure = interactive · Slate = neutrals · Semantic = status — each family has one role only). D19 = Rule ↔ Implementation Parity (no standing rule/code contradiction; reconcile by amending whichever is wrong). **D20 = Token discipline — no static inline styles, no hardcoded hex/px; every visual value is a `--gx-*` token via a CSS class. Read before writing ANY frontend code.**

## What overrides what
- A LOCKED standard overrides personal style choices
- All 70 standards are LOCKED. The 7 formerly `SOURCE NOT PROVIDED` items (Global Status, Security & Permission, Automation, Integration, Data Validation, Search & Filter, Navigation base) were written code-accurate as files 16–22 in the Fifth patch (see file 13). No standard is provisional.
- The Strategic Product Direction (file 01) is the parent of all other standards — re-read it if any deeper standard seems to conflict

## Quick conformance checks before shipping code
- All status / type / category values are `UPPER_SNAKE_CASE` (B1)
- All business-visible IDs are UUIDs with the matching reference-number prefix from file 00 (S5/D8)
- Every tenant-scoped entity carries `tenantId` (D1)
- Every page consumes `PageShell` + the 6 standard zones (file 10)
- Every detail page exposes the common tab set (Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit — file 10 §Object Detail) before any object-specific tabs
- Every permission grant follows `object.action` (file 15) — keys are immutable
