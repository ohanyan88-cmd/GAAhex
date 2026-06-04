# Token Migration Standard

**Status**: LOCKED · Phase 6 deliverable; Phase 5 implementation playbook
**Owner**: Architecture / Design System
**Last updated**: 2026-06-04
**Source audit**: `docs/audit/TOKENIZATION-AUDIT-2026-06-04.md`

How GAAhex chrome consumes design tokens, and how to migrate the long tail
of hand-rolled styles to the canonical `--gx-*` system.

---

## 1. The token contract

The canonical token registry lives in `frontend/src/styles/gaahex-tokens.css`:

* **Tier 0 — raw color scales** (theme-independent): 69 stops across
  cobalt / azure / gold / slate / green / amber / red / violet / viz.
* **Tier 1 — semantic `--gx-*` tokens** (237 declarations): surfaces, text,
  borders, brand, primary, interactive, hover/pressed/selected/ring, status,
  12 ISP/network statuses, chart roles, shadows, glows, skeleton.
* **Scales**: `--gx-space-0..12` (4px base, 13 steps), `--gx-radius-*`,
  `--gx-border-*`, `--gx-text-xs..6xl` (11 font sizes), weights, motion
  durations, z-index, sizing, shadows.

`gaahex-tokens.css` is the **single source**. `color-tokens.css` is a
legacy file scheduled for reconciliation (D19 — Phase 5 sequence item T-P3-1).

## 2. D17 / D18 / D19 discipline

* **D17 — KPI tile**: no premium highlight; coloured value text + tooltip.
  No `translateY` on hover.
* **D18 — Five color families with one role each**:
  - **Cobalt** = brand spine (titles, primary background)
  - **Gold** = signature accent (KPI value text, focus on hero metric)
  - **Azure** = interactive (hover, active link, selected tab underline)
  - **Slate** = neutrals (borders, body text, surfaces)
  - **Semantic** = status (success / warning / danger / info)

  Mixing roles is the violation: gold on a button hover, cobalt on an
  interactive element, etc. The portal SPA's `--primary` is the canonical
  violation today and the Phase 5 P4-1 migration target.

* **D19 — Rule ↔ implementation parity**: no standing rule/code
  contradiction. Reconcile by amending whichever is wrong.

## 3. Forbidden patterns (Phase 6 `check_drift.py` enforces)

* **No hardcoded hex literal in a TSX inline `style={{}}`** (except the
  documented `DYNAMIC-VAR` chart-geometry escape hatch).
* **No `rgba(0, 0, 0, ...)` for a scrim** — use `var(--gx-overlay)` (Phase 5
  P1-2 introduces this token).
* **No `--gx-x` reference without a definition.** Phantom tokens caused
  silent dark-theme breakage; the four known (`--gx-bg-2`, `--gx-surface-1`,
  `--gx-warning-bg`, `--gx-warning-border`) are Phase 5 P1-5.
* **No defensive hex fallback** like `var(--gx-text-3, #64748b)` — the token
  is Tier 1, the fallback is cruft.
* **No bare `px` for spacing/font** — use `var(--gx-space-*)` /
  `var(--gx-text-*)`.
* **No new `--nms-*` token** unless the NMS namespace is explicitly part of
  the change. (Decision still open on consolidation.)
* **No backend Python hex constant** — D18 backend-color-string guard. The
  invoice/receipt HTML must read from a `BRAND_PRINT_PALETTE` dict at
  `backend/app/branding/theme_constants.py` (Phase 5 P1-7).
* **No `--gx-text-3` on `--gx-surface-2`** at sizes below 18pt — WCAG AA
  contrast failure documented in the audit (Phase 5 P1-3 lifts the token).

## 4. Migration patterns

### Pattern A — replace a scrim

Before:

```tsx
style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)' }}
```

After (assumes Phase 5 P1-2 has landed `--gx-overlay`):

```tsx
style={{ position: 'fixed', inset: 0, background: 'var(--gx-overlay)' }}
```

Better still: wrap the chrome in `<Overlay>` from `components/Overlay.tsx`
and let the primitive own the scrim entirely.

### Pattern B — replace a hex inline style

Before:

```tsx
<div style={{ color: '#64748b', borderColor: '#E2E8F0' }}>...</div>
```

After:

```tsx
<div style={{ color: 'var(--gx-text-3)', borderColor: 'var(--gx-border-subtle)' }}>...</div>
```

If the property is used in 3+ files with the same color → hoist to a
shared CSS class instead of inline.

### Pattern C — replace bare px spacing

Before:

```tsx
<div style={{ display: 'flex', gap: 12, padding: '16px 20px' }}>
```

After:

```tsx
<div style={{ display: 'flex', gap: 'var(--gx-space-3)', padding: 'var(--gx-space-4) var(--gx-space-5)' }}>
```

When the same `display: 'flex'` layout appears 3+ times → use `<Inline>` or
`<Stack>` from `page-shell/primitives/` (`<Stack>` for column, `<Inline>`
for row).

### Pattern D — replace a raw button

Before:

```tsx
<button className="btn btn-primary btn-md" onClick={handleSave}>Save</button>
```

After:

```tsx
<Button variant="primary" size="md" onClick={handleSave}>Save</Button>
```

`<Button>` carries the disabled state, the loading spinner contract, the
icon-slot pattern, and the focus-ring tokens. The raw `btn-md` class
diverges on all of these.

### Pattern E — replace a raw input

Before:

```tsx
<input className="inp" value={x} onChange={...} />
```

After:

```tsx
<Input value={x} onChange={...} size="md" />
```

Inside a form, wrap with `<FormField label="..." error={err}>` to get the
label + error message stack for free.

## 5. Phase 5 sequence

Per the tokenization audit, the migration is sequenced into four
sub-phases. Reference `docs/audit/ARCHITECTURE-STABILIZATION-PLAN.md`
Phase 5 section for the live tracker.

* **Phase 5a — Critical violations** (1-2 weeks): portal cookie wiring,
  `--gx-overlay` token, `--gx-text-3` contrast lift, 12 `<div onClick>`
  keyboard handlers, phantom token resolution, backend HTML hardening,
  Python hex → `theme_constants.py`.
* **Phase 5b — Shared component standardization** (2-4 weeks): build the
  9 missing primitives (`<Pagination>`, `<LoadShell>`, `<ConversationRow>`,
  `<StudioDrawer>`, `<HomeListRow>`, `.kv-grid`, `.gx-chip`, `.gx-tag`,
  `.gx-monochip`, …), migrate the call sites listed in the
  spec-without-impl section.
* **Phase 5c — Full token migration** (4-8 weeks): drop ~65 defensive hex
  fallbacks, migrate ~110 raw `btn-md` to `<Button>`, ~348 raw `inp` to
  `<Input>`, ~1,100 `LAYOUT-ONE-OFF` inline styles to `<Stack>` /
  `<Inline>` / `<Grid>`.
* **Phase 5d — Portal + i18n + cleanup** (2-3 weeks): portal D18
  migration, portal i18n bootstrap, backend HTML i18n, remove 63 orphan
  `--gx-*` tokens.

## 6. Acceptance gates per phase

A Phase 5 sub-phase is "done" when:

1. The Phase 6 `check_drift.py` baseline for the relevant pattern has been
   reduced to the new floor.
2. `frontend/node_modules/.bin/tsc --noEmit` is clean.
3. A visual smoke test of the affected views passes in both dark and light
   themes.
4. The adoption tracker in this doc + the relevant primitive standard is
   updated.

Do not mark a phase done without all four.

## 7. Adoption tracker

| Surface | Pre-Phase-1 state | Current state | Phase-5 target |
|---|---|---|---|
| Inline `style={{}}` instances | 2,509 | 2,509 (largely unchanged; some delta in DashboardView refactor) | ≤500 (legitimate `DYNAMIC-VAR` only) |
| Raw `btn-md` instances | 111 | 111 | 0 |
| Raw `inp` instances | 348 | 348 | 0 |
| Layout one-offs (`style={{ display: 'flex' }}`) | 293 | 293 | 0 |
| Phantom `--gx-*` tokens | 4 | 4 | 0 |
| Orphan `--gx-*` tokens | 63 | 63 | 0 |
| Defensive hex fallback (`var(--gx-x, #hex)`) | ~65 | ~65 | 0 |
| Portal `--gx-*` token adoption | 0% | 0% | 100% |
| Backend Python hex constants | 14 | 14 | 0 (all in `theme_constants.py`) |
| `--gx-text-3` contrast on `--gx-surface-2` | ~3.4-3.6:1 (fails AA) | unchanged | ≥4.5:1 (passes AA) |
| `--gx-tap-min: 44px` wired into controls | NO | NO | YES at ≤768px |

This tracker is the authoritative baseline against which Phase 5 PRs are
graded. Move the numbers down with each PR; don't add to them.
