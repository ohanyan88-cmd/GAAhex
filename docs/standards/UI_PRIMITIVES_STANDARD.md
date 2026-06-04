# UI Primitives Standard

**Status**: LOCKED · Phase 6 deliverable
**Owner**: Architecture / Frontend
**Last updated**: 2026-06-04

What UI primitives exist in GAAhex, when to use which, and what to do
*instead of* re-rolling another tab button / drawer chrome / confirm dialog.

---

## 1. The primitive catalog

Use these BEFORE writing new chrome. Every primitive lives in
`frontend/src/primitives/` or `frontend/src/components/`.

| Primitive | Module | Use when |
|---|---|---|
| `Modal` | `components/Modal.tsx` | Centered dialog (forms, confirms, pickers). Built on `Overlay` + `useFocusTrap`. |
| `ModalFooterActions` | `components/Modal.tsx` | Cancel / Confirm button pair inside a Modal `footer` prop. **MO-6** — do not roll your own. |
| `confirmDialog()` | `components/Modal.tsx` | Promise-based replacement for `window.confirm`. Mount `ConfirmHost` in `main.tsx`. |
| `RecordDrawer` | `components/RecordDrawer.tsx` | Right-side slide-over for entity detail (hero + tabs + body + footer). Now uses `useFocusTrap`. |
| `SlideOutPanel` | `page-shell/SlideOutPanel.tsx` | Right-side panel for NMS / dashboard drill-downs. Now uses `useFocusTrap`. |
| `Overlay` | `components/Overlay.tsx` | Generic backdrop + focus trap; the base layer for everything modal-like. |
| `DetailTab` + `DetailTabList` | `primitives/DetailTab.tsx` | Tabbed UI inside a detail view. Wraps with keyboard-accessible `<DetailTabList>`. **TB-1/2/3** — do not roll your own. |
| `KPITile` | `primitives/KPITile.tsx` | Single KPI card (label + value + subtitle). Goes in `PageShell zone B kpis=` prop. |
| `StatusPill` | `primitives/StatusPill.tsx` | Coloured status badge (active / degraded / critical / neutral / info). **Always carries a text label** — never colour-only. |
| `Button` | `primitives/Button.tsx` | Branded button. Supersedes raw `<button className="btn ...">`. Phase 5 migration target. |
| `Input` | `primitives/Input.tsx` | Branded input. Supersedes raw `<input className="inp">`. Phase 5 migration target. |
| `FormField` | `primitives/FormField.tsx` | Label + Input + error message stack. Pair with `validators.ts` from `lib/`. |
| `RowActionsMenu` | `components/RowActionsMenu.tsx` | ⋮ menu in a table row. **TL-4** — do not inline `<button className="btn btn-sm">…</button>` in an actions column. |
| `EmptyState` / `ErrorBanner` / `LoadingState` / `SkeletonRows` | `components/States.tsx` | Standard "nothing to show" / "failed" / "loading" states. Mount conditionally; never write your own. |
| `Toast` (via `toast.*` API) | `components/Toast.tsx` | Top-level notifications. `toast.success/error/info`. |
| `useFocusTrap` | `lib/useFocusTrap.ts` | Hook for any new drawer / modal / overlay. Returns a ref + wires Esc + Tab + focus-restore. |

## 2. Forbidden patterns (Phase 6 `check_drift.py` enforces)

* **No new private `authH`, `_deny`, `_parse_dt`, `fmtDate`, `fmtDateTime`, `moneyDecimal`, `_amd` defs.** All have canonicals (see other standards).
* **No `aria-pressed` on `role="tab"`** — use `aria-selected`. (TB-5 closed this; the rule prevents the next bug.)
* **No hand-rolled `position: fixed, inset: 0` modal scrim.** Use `<Modal>` or `<Overlay>`.
* **No drawer / modal without `useFocusTrap`.** Tab key must not escape the surface (WCAG 2.1.1).
* **No inline `<button className="btn btn-sm">Delete</button>` in a table-row actions column.** Use `<RowActionsMenu>`.
* **No raw `fetch(${BASE}/...)` in a view.** Use `useFetch` / `useFetched` from `hooks/useFetch.ts` (see [[server-state-standard]]).

## 3. The drawer/modal A11y contract

Every drawer or modal MUST:

1. Mount inside `<Overlay>` OR wrap its panel ref with `useFocusTrap`.
2. Carry `role="dialog"` + `aria-modal="true"` + `aria-labelledby` referencing the title element's id.
3. Close on Esc — handled automatically by `useFocusTrap`'s `onEscape` callback.
4. Lock body scroll while open (existing primitives do this; new ones must too).
5. Restore focus to the previously-focused element on close — handled automatically by `useFocusTrap`.

Failing any of these is the bug pattern that DR-2 / DR-3 fixed.

## 4. The tab A11y contract

Every tab strip MUST:

1. Use `role="tab"` on each tab and `role="tablist"` on the container.
2. Use `aria-selected` (NOT `aria-pressed`) to indicate the active tab.
3. Implement roving tabindex — exactly one tab is `tabIndex={0}`, others `tabIndex={-1}`.
4. Wire ArrowLeft/Right (or ArrowUp/Down for vertical) + Home + End to move focus.
5. Use Enter or Space (native button behavior) to select the focused tab.

`<DetailTabList>` provides items 1-4 automatically. Use it.

## 5. Migration playbook

When you touch a view that still hand-rolls a primitive:

1. **Tab button** → import `DetailTab` from `primitives`; wrap the strip in `<DetailTabList ariaLabel="...">`.
2. **Local Cancel/Confirm pair in a modal footer** → `<ModalFooterActions onCancel onConfirm />`.
3. **Inline row action `<button>`s in a table cell** → `<RowActionsMenu items={[...]}/>`.
4. **Raw `<input className="inp">` in a form** → `<Input>` + `<FormField>` wrapping; pair with a `validators.ts` validator.
5. **Hand-rolled drawer chrome** → wrap with `useFocusTrap` and follow §3 contract; ideally use `RecordDrawer` or `SlideOutPanel` directly.

## 6. Spec-without-impl gaps

These primitives are in the canonical token / design-spec but NOT yet
implemented. Adding them is in scope for Phase 5 (tokenization):

* `.gx-chip` — filter chip
* `.gx-tag` (distinct from badge)
* `.gx-monochip` — inline IP/MAC chip (ISP-critical for NMS)
* Standalone `.gx-check` checkbox
* Inline `.gx-alert--info` / `.gx-alert--warning`
* Generic `.gx-tip` tooltip
* `.gx-avatar--sm` / `--lg`
* `.gx-card--clickable`
* `<Pagination>` — Prev / 1 2 3 / Next cluster (4 inline copies exist today)
* `<LoadShell>` — loading/empty/error wrapper (currently `LoadShell<T>` inlined in NetworkInventoryView:505)
* `<ConversationRow>` — avatar + name + message preview (3 conversation views inline it today)
* `<HomeListRow>` — icon + label + chevron (HomeView has 10 hand-rolled sections)
* `<StudioDrawer>` — scrim + panel + section-head class set for the 8 studio panes

Until they exist, Phase 5 migrations may NOT introduce new instances of the
inline patterns these primitives are designed to replace.

## 7. Adoption tracker

| Primitive | Adoption | Notes |
|---|---|---|
| `Modal` + `ConfirmHost` | 18 production sites | 3 studio panes still hand-roll; MO-1/2/3 deferred to Phase 4 Part 2 |
| `RecordDrawer` | 1 production caller (Invoices); focus trap added 2026-06-04 | Other detail views can adopt |
| `SlideOutPanel` | NMS dashboards; focus trap added 2026-06-04 | — |
| `DetailTab` + `DetailTabList` | 2 callers (InvoicesView, AccountsView) | 5 more hand-rolled tab flavors await migration |
| `KPITile` | 37 callers across 11 views; 0 ad-hoc reimplementations | ✅ |
| `StatusPill` | 84 callers across 37 views | ✅ |
| `RowActionsMenu` | Variable — 15+ tables still inline action buttons | TL-4 incremental |
| `Button` | 20 callers; 111 raw `btn-md` sites remain | Phase 5 migration target |
| `Input` | 6 callers; 348 raw `inp` sites remain | Phase 5 migration target |
| `useFocusTrap` | `Overlay`, `Modal`, `ConfigureDrawer`, `RecordDrawer`, `SlideOutPanel` | ✅ full coverage of focus-trap-eligible surfaces |

`docs/audit/ARCHITECTURE-STABILIZATION-PLAN.md` is the authoritative source
for what's still pending; this tracker mirrors the current state at the
Phase 4 Part 1 landing (`e8af54b`).
