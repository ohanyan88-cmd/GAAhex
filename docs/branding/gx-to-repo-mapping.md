# gx-* → Repo-Class Mapping Table

> The translation contract between design-Claude's `gx-*` styleguide spec
> (in `transfer/design-system/ds-components.css`) and the repo's actual
> primitive classes / components. Closes the OWED artifact from the
> design-Claude transfer at HEAD `3b9baeb` (basis commit on his side:
> `a9bec13`).

## How to use

When implementing a Stage 6 template, look up the `gx-*` spec name in the
left column → pick up the repo equivalent on the right → use that class or
component. Mismatches in the Delta column flag real work: a missing repo
primitive, a missing spec coverage, or a naming/semantic gap a designer-engineer
pair needs to decide before either side moves. Spec line numbers refer to
`design-claude-handoff-2026-06-04-v6/transfer/design-system/ds-components.css`
(v6 zip); repo lines refer to files inside `frontend/src/`.

## Mapping

### Button family

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-btn` | L21–32 | `.btn` (`styles/primitives.css` L10) + `Button.tsx` (`primitives/Button.tsx` L33) | parity ✓; repo uses single-dash `btn-*` modifiers, spec uses BEM `gx-btn--*` |
| `.gx-btn--primary` | L40–42 | `.btn-primary` (`primitives.css` L16) | parity ✓ post-`a9bec13` (azure via `--gx-interactive`); both sides ship hover state |
| `.gx-btn--secondary` | L44–46 | `.btn-secondary` (`primitives.css` L18) | parity ✓; spec adds `:active` recolor that repo lacks |
| `.gx-btn--tertiary` | L48–50 | — | spec-only; repo has no tertiary variant. Engineering decision: add or drop |
| `.gx-btn--ghost` | L52–53 | `.btn-ghost` (`primitives.css` L20) | parity ✓ |
| `.gx-btn--danger` | L55–57 | `.btn-danger` (`primitives.css` L24) | parity ✓; spec adds danger-soft focus ring repo does not specialise |
| `.gx-btn--gold` | L60–62 | `.btn-gold` (`primitives.css` L22) | parity ✓; brand-moment CTA on both sides |
| `.gx-btn--link` | L64–65 | `.btn-link` (`primitives.css` L59) | parity ✓; D18-aligned (azure via `--gx-interactive`) |
| `.gx-btn--icon` | L67 | `.btn-icon` (`primitives.css` L28) | parity ✓ |
| `.gx-btn--sm` | L68–69 | `.btn-sm` (`primitives.css` L26) | parity ✓ |
| `.gx-btn--lg` | L70 | `.btn-lg` (`primitives.css` L27) | parity ✓ |
| `.gx-btn.is-loading` | L73–77 | `Button.tsx` `<Spinner/>` (L20) | spec is CSS-driven loader; repo wires loader through TSX component, not a class |

### Form / input family

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-field` | L84 | `.field` (`primitives.css` L38) + `FormField.tsx` (`primitives/FormField.tsx` L13) | parity ✓; both use flex-column gap-6 |
| `.gx-field-label` | L85–86 | `.field > span` (`primitives.css` L39) | parity ✓; spec also supports `.req` asterisk inside the label, repo renders the asterisk via inline-styled span in `FormField.tsx` L18 |
| `.gx-field-help` | L102 | `.field-hint` (`primitives.css` L73) | naming mismatch; behavior parity ✓ |
| `.gx-field-err` | L103 | `.field-error` (`primitives.css` L74) | naming mismatch; behavior parity ✓ |
| `.gx-inp` | L87–100 | `.inp` (`primitives.css` L31) + `Input.tsx` (`primitives/Input.tsx` L32) | parity ✓ post-`a9bec13`; both use `--gx-interactive` for focus ring |
| `.gx-inp[aria-invalid="true"]` / `.is-invalid` | L98 | `.inp-error` (`primitives.css` L66) | semantic match; spec drives via ARIA, repo drives via prop-class. Caller adds `aria-invalid` when using `error` prop — currently NOT enforced |
| `.gx-inp[readonly]` / `.is-readonly` | L99 | — | spec-only; repo `<Input readOnly>` falls back to native readonly + inline opacity (no dedicated class) |
| `.gx-inp[disabled]` / `.is-disabled` | L100 | inline `style.opacity:.5` in `Input.tsx` (L46) | spec exposes class hook for storyboarded disabled state; repo only renders disabled via native attribute |
| `textarea.gx-inp` | L101 | — | no textarea primitive in repo; `<textarea>` is hand-rolled per call site |
| `.gx-search` | L106–112 | `Input.tsx` `variant="search"` (L29) + legacy `.search`/`.search-md` (`_forms.css` L41–62) | spec defines a self-contained `.gx-search` wrapper; repo splits the search affordance across (a) `<Input variant="search">` (icon-inside-padding) and (b) legacy `.search-*` classes still used by older nav search. **Consolidation flag.** Note: spec mandates "NO keyboard-shortcut badge" — repo `_forms.css` still defines `.search-kbd` (L57) but per CLAUDE.md rule it must never render |
| `.gx-select` | L115–117 | `select.inp` (`primitives.css` L37) | parity ✓; both render a custom chevron via background-image |
| `.gx-check` | L120–121 | — | spec-only; repo uses raw `<input type="checkbox">` or in-table `.dtr-check-box` (`primitives.css` L210). No standalone checkbox primitive |
| `.gx-toggle` | L122–130 | `.gx-toggle` (`_studio-legacy.css` L42–45) | naming parity ✓ but **legacy / studio-only**; not used in production app code. Spec ships a proper `<input>` + `.track` + `:checked` recipe; repo legacy uses `.on` class on the button |

### Badge / pill / chip / tag / monochip family

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-badge` | L134–136 | `.badge` (`primitives.css` L50) | parity ✓ post-D18 (slate neutral background, not cobalt) |
| `.gx-badge--gold` | L137 | — | spec-only; repo currently has no gold count-badge variant |
| `.gx-badge--neutral` | L138 | base `.badge` IS the neutral default in repo (L50) | semantic match; repo treats neutral as base, spec treats it as modifier |
| `.gx-pill` | L141–143 | `.pill` (`primitives.css` L41) + `StatusPill.tsx` (`primitives/StatusPill.tsx` L14) | parity ✓; both render dot+label, no color-only signalling |
| `.gx-pill--success` | L144 | `.pill-success` (`primitives.css` L43) | parity ✓ |
| `.gx-pill--warning` | L145 | `.pill-warning` (`primitives.css` L44) | parity ✓ |
| `.gx-pill--danger` | L146 | `.pill-danger` (`primitives.css` L45) | parity ✓ |
| `.gx-pill--info` | L147 | `.pill-info` (`primitives.css` L46) | parity ✓ |
| `.gx-pill--neutral` | L148 | `.pill-neutral` (`primitives.css` L47) | parity ✓ |
| `.gx-pill--gold` | L149 | `.pill-gold` (`primitives.css` L48) | parity ✓ |
| `.gx-chip` | L152–160 | — | spec-only; repo has no filter-chip primitive. Filter chips are currently hand-rolled per page (FilterBar in `page-shell/FilterBar.tsx` renders selects + Inputs, not chips). **Build flag if Stage 6 templates need chip-based filtering** |
| `.gx-tag` | L163–165 | — | spec-only; repo has no metadata-tag primitive. Tag-shaped usages currently fall back to `.pill-neutral` |
| `.gx-monochip` | L168–170 | `.dtc-mono` (`primitives.css` L199) + `.mono` utility (`primitives.css` L51) | partial match; spec is a self-contained inline chip for IP/MAC/ID, repo uses table-cell utility + raw `.mono` class. **Build flag for inline IP/MAC/serial chips outside tables** |
| `.gx-avatar` | L173–175 | `.avatar` (`_app-shell.css` L46) + `OrgIdentity.tsx` (`components/OrgIdentity.tsx`) | naming mismatch; behavior parity ✓ (cobalt gradient, 28×28 default, initials) |
| `.gx-avatar--sm` | L176 | — | spec-only; repo `.avatar` has no size modifier |
| `.gx-avatar--lg` | L177 | — | spec-only; repo `.avatar` has no size modifier |

### KPI tile family

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-kpi` | L182–186 | `.kpi-tile` (`primitives.css` L82) + `KPITile.tsx` (`primitives/KPITile.tsx` L84) | parity ✓ on D17 (border tints gold on hover, soft outward gold glow, NO movement). Naming mismatch: spec `gx-kpi`, repo `kpi-tile` |
| `.gx-kpi-top` | L187 | — (composed inline in `KPITile.tsx` L104) | spec has explicit top-row class; repo composes inline |
| `.gx-kpi-label` | L188 | `.kpi-tile-label` (`primitives.css` L132) | parity ✓ |
| `.gx-kpi-icon` | L189 | inline via `<Icon size={11}/>` in `KPITile.tsx` L105 | spec has class hook, repo inlines icon styling |
| `.gx-kpi-value` | L190–191 | `.kpi-tile-value` (`primitives.css` L133) | parity ✓ |
| `.gx-kpi-value.is-danger` | L192 | `.kpi-tile-value.danger` (`primitives.css` L135) | parity ✓; naming differs (`.is-danger` vs `.danger`) |
| `.gx-kpi-value.is-warning` | L193 | `.kpi-tile-value.warning` (`primitives.css` L136) | parity ✓; naming differs |
| `.gx-kpi-value.is-muted` | L194 | `.kpi-tile-value.muted` (`primitives.css` L137) | parity ✓; naming differs |
| `.gx-kpi-delta` | L195 | `.kpi-tile-delta` (`primitives.css` L140) | parity ✓ |
| `.gx-kpi-delta.up` | L196 | `.kpi-tile-delta.up` (`primitives.css` L141) | parity ✓ |
| `.gx-kpi-delta.down` | L197 | `.kpi-tile-delta.down` (`primitives.css` L141) | parity ✓ |
| `.gx-kpi-tip` | L199–205 | `.kpi-tile-tooltip` (`primitives.css` L155) | parity ✓ on D17 (300 ms dwell, fade + subtle scale, no slide). Naming differs |

### Card

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-card` | L208 | `.card-primitive` (`page-shell/primitives/primitives.css` L12) + `Card.tsx` (`page-shell/primitives/Card.tsx` L35) | naming mismatch (`gx-card` vs `card-primitive`); behavior parity ✓ |
| `.gx-card--pad` | L209 | `.card-primitive--pad-{sm,md,lg}` (`primitives.css` L12) | repo expands the single `--pad` modifier into a 3-step size scale |
| `.gx-card-head` | L210 | `SectionHeading.tsx` `.sh` + `.sh__left/.sh__action` (`primitives/primitives.css` L14, `page-shell/primitives/SectionHeading.tsx`) | semantic match via separate primitive; spec is one class on the card, repo is a sibling primitive used at the top of the Card body |
| `.gx-card-title` | L211 | `.sh__title` (`primitives/primitives.css` L14) | semantic match |
| `.gx-card--clickable` | L212–214 | — | spec-only; repo has no clickable-card modifier (`KPITile` is the closest clickable-surface primitive but its anatomy is KPI-specific) |

### Tabs

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-tabs` | L217 | `.tabs` (`_tabs.css` L2) **or** `.gx-drawer .drawer-tabs` (`_drawer.css` L16) | **two repo flavors:** legacy pill-tabs (`.tabs`/`.tab.on` — pill background fills) and drawer underline-tabs (`.drawer-tab` — bottom border accent). Spec follows the underline-tab pattern. **Naming + visual flag** |
| `.gx-tab` | L218–222 | `.tab` (`_tabs.css` L3) / `.drawer-tab` (`_drawer.css` L17) | spec uses bottom underline (`::after`), repo `.tab` uses filled pill; only `.drawer-tab` matches spec visually |
| `.gx-tab[aria-selected="true"]` / `.is-selected` | L223–224 | `.tab.on` (`_tabs.css` L16) / `.drawer-tab.on` (`_drawer.css` L19) | semantic match; spec drives via ARIA, repo drives via `.on` class |
| `.gx-tab-count` | L222 | `.tab-count` (`_tabs.css` L21) | naming parity ✓ |

### Table

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-table` | L228 | `table.grid` (`_data-tables.css` L26) | naming mismatch; behavior parity ✓ (separate `border-collapse: separate` in spec vs `border-collapse: collapse` in repo) |
| `.gx-table th` | L229–230 | `table.grid th` (`_data-tables.css` L46) | parity ✓ (uppercase, tracking-wide, mono color-3) |
| `.gx-table td` | L231 | `table.grid td` (`_data-tables.css` L47) | parity ✓ |
| `.gx-table tbody tr:hover` | L232–233 | `table.grid tbody tr:hover` (`_data-tables.css` L58) | parity ✓ (`--gx-hover`) |
| `.gx-table tbody tr.is-selected` | L234 | `table.grid tbody tr.sel` (`_data-tables.css` L59) | naming differs (`.is-selected` vs `.sel`); behavior parity ✓ |
| `.gx-table--compact` | L235 | `.dtr-sm` (`primitives.css` L208) | semantic match; spec targets the table, repo targets the row |
| `.gx-table .num` | L236 | `.dtc-numeric` (`primitives.css` L201) + `.num` utility (`_addendum.css` L43) | semantic match; behaviour parity ✓ |
| — | — | `DataTableRow.tsx` (`primitives/DataTableRow.tsx`) + `DataTableCell.tsx` (`primitives/DataTableCell.tsx`) | repo wraps row/cell in TSX primitives; spec exposes only CSS classes |

### Tooltip (generic)

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-tip` | L239 | — | spec-only; repo has no generic CSS-only tooltip primitive. KPI tooltips use the KPI-specialised `.kpi-tile-tooltip`, button/cell tooltips use native `title=""` |
| `.gx-tip-bubble` | L240–244 | — | spec-only; see above |

### Alert (inline)

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-alert` | L247–249 | `.error-banner` (`_states.css` L22) + `ErrorBanner` (`components/States.tsx` L77) | partial match: repo only models the error variant. Spec has info/warning/error layers |
| `.gx-alert--info` | L250, L253 | — | spec-only; no info-alert primitive in repo |
| `.gx-alert--warning` | L251, L254 | — | spec-only; no warning-alert primitive in repo |
| `.gx-alert--error` | L252, L255 | `.error-banner` (`_states.css` L22) | semantic match for error only |

### Toast

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-toast` | L258–261 | `.gx-toast` (`_overlays.css` L19) + `Toast.tsx` (`components/Toast.tsx`) | **naming parity ✓** — repo already uses the `gx-toast` selector (one of the few places repo and spec agree on the `gx-` prefix). Visual delta: repo has `border-left: 3px solid` accent stripe; spec is borderless plus icon-coloured |
| `.gx-toast--success` | L262 | `.gx-toast.success` (`_overlays.css` L20) | semantic match; spec uses BEM `--success`, repo uses chained `.success` |
| `.gx-toast--error` | L263 | `.gx-toast.danger` (`_overlays.css` L21) | naming differs (spec `--error` vs repo `.danger`); behavior parity ✓. `Toast.tsx` L43 already maps `'error' → 'danger'` |
| `.gx-toast-title` | L264 | — | spec-only; repo toasts render a single message line (no separate title/body) |
| `.gx-toast-body` | L265 | the `<span>{t.message}</span>` slot in `Toast.tsx` L63 | semantic match; repo is single-line |
| `.gx-toast.is-animating` | L267 | repo always-on `animation:gxtoastin` in `.gx-toast` (`_overlays.css` L19) | spec gates the entrance animation with a class; repo plays on every render |
| — | — | `.gx-toast-host` (`_overlays.css` L18) + `<ToastHost>` (`components/Toast.tsx` L47) | repo-only: portal host wrapper. Spec assumes caller mounts toasts |

### Empty state

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-empty` | L270–271 | `.state` (referenced in `States.tsx` L8) **and** `.empty-state` (`_states.css` L2) | **two repo flavors:** the modern `<EmptyState>`/`<LoadingState>` family uses `.state`; the older `.empty-state` class remains in `_states.css` but is not referenced by current TSX. `EmptyState` component lives in `components/States.tsx` L41 AND in `page-shell/EmptyState.tsx` (likely duplicate). **Consolidation flag** |
| `.gx-empty-ic` | L272 | `.state-icon` (referenced in `States.tsx` L11) | naming differs; behavior parity ✓ |
| `.gx-empty-title` | L273 | `.state-title` (referenced in `States.tsx` L13) | naming differs; behavior parity ✓ |
| `.gx-empty-body` | L274 | `.state-msg` (referenced in `States.tsx` L51) | naming differs; behavior parity ✓ |

### Skeleton / spinner

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-skel` | L277–278 | `.skel` (`_addendum.css` L5) + `.kpi-tile-skeleton` (`primitives.css` L144) | naming parity (minus prefix); behavior parity ✓. Note: `States.tsx` L34 references `.skeleton` and `.skeleton-row` classes that are **NOT defined in any repo CSS** — orphan reference (uses legacy class names from a previous primitive). **Repo fix flag** |
| `.gx-spinner` | L280–281 | `SpinnerIcon` SVG (`components/icons.tsx`) used in `States.tsx` L11 | spec is a CSS spinner; repo is an animated SVG component. Different mechanism, same role |

### Breadcrumb

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-crumbs` | L284 | `.crumbs` (`_data-tables.css` L12) | naming parity (minus prefix); behavior parity ✓ |
| `.gx-crumbs a` | L285–286 | — (no explicit rule) | repo crumbs render anchors without a dedicated state hook |
| `.gx-crumbs .sep` | L287 | `.crumbs .sep` (`_data-tables.css` L13) | parity ✓ |
| `.gx-crumbs .cur` | L288 | — | spec-only; repo has no current-crumb class |

### Divider / section head

| `gx-*` spec | Source (ds-components.css) | Repo equivalent | Delta / notes |
|---|---|---|---|
| `.gx-divider` | L291 | `.section-divider` (`_section-heading.css` L8) | naming mismatch; behavior parity ✓ (1px hairline) |
| `.gx-sechead` | L292 | `.section-head` (`_section-heading.css` L2) + `.sh` (`page-shell/primitives/primitives.css`) | **two repo flavors**: legacy `.section-head` and new `.sh` (SectionHeading primitive). Spec is the new pattern |
| `.gx-sechead-l` | L293 | `.sh__title` (`page-shell/primitives/primitives.css`) | naming differs; behavior parity ✓ |
| `.gx-sechead-rule` | L294 | — | spec-only; repo `.section-head` does not include a trailing rule |

## Components in spec without a repo equivalent yet

Flag for orchestrator decision (build, defer, or treat as styleguide-only):

- `.gx-btn--tertiary` — tertiary button variant
- `.gx-inp[readonly]` / `.is-readonly` — dedicated read-only class hook for the input
- `textarea.gx-inp` — textarea primitive
- `.gx-check` — standalone checkbox primitive (repo only has the table-row check)
- `.gx-badge--gold` — gold count-badge variant
- `.gx-chip` — filter / selected / removable chip primitive
- `.gx-tag` — metadata tag primitive
- `.gx-monochip` — inline IP / MAC / serial / VLAN chip (repo has table-cell `.dtc-mono` only)
- `.gx-avatar--sm` / `.gx-avatar--lg` — avatar size modifiers
- `.gx-card--clickable` — clickable-card modifier (separate from KPITile)
- `.gx-tip` / `.gx-tip-bubble` — generic CSS-only tooltip primitive
- `.gx-alert--info` / `.gx-alert--warning` — info and warning inline-alert variants
- `.gx-toast-title` / `.gx-toast-body` — toast title/body split (repo is single-line)
- `.gx-crumbs .cur` — current-crumb class
- `.gx-sechead-rule` — trailing hairline rule in section header

## Repo classes without a spec equivalent

Flag for design-side coverage gap or note as repo-internal:

- `Button.tsx` `loading` prop with `<Spinner/>` — spec models this as a `.is-loading` CSS class only
- `.inp-error` + `Input.tsx` `error` prop — spec uses `[aria-invalid="true"]`; semantically the same but the wiring contract is different
- `.kpi-tile.error` (`primitives.css` L142) — error-state KPI tile; spec has no error-state KPI
- `.kpi-tile-sub` (`primitives.css` L138) — optional sub-line under value; spec has no sub-line slot
- `.kpi-tile-foot` (`primitives.css` L139) — explicit footer row (delta + accessory split); spec leaves delta inline
- `.kpi-tile-skeleton` (`primitives.css` L144) — KPI-specialised skeleton; spec only ships generic `.gx-skel`
- `DataTableRow.tsx` / `.dtr` family + `DataTableCell.tsx` / `.dtc` family — repo's TSX-level row/cell primitives have no spec equivalent (spec is CSS-only on the `.gx-table` level)
- `.dtr-check` / `.dtr-check-box` (`primitives.css` L209–212) — row selection checkbox; spec has no row-selection model
- `.bulkbar` (`_data-tables.css` L85) — bulk-action bar; spec has no bulk-select pattern
- `.kpi-strip` (`_data-tables.css` L65) — KPI strip grid wrapper; spec leaves grid composition to the caller (`KPIBar.tsx` in `page-shell/` is the repo's equivalent)
- `RowActionsMenu.tsx` + `.row-actions-menu` / `.row-actions-pop` (`components/RowActionsMenu.tsx`) — overflow ⋮ menu for table rows; spec has no row-actions pattern. Renders via portal-positioned `.menu` + `.menu-item` primitives
- `.menu` / `.menu-item` / `.menu-sep` (`_overlays.css` L5–11) — dropdown menu primitives; spec has no menu primitive (spec's `.gx-alert` and `.gx-toast` are the only overlays specced)
- `.menu-head` / `.menu-head-name` / `.menu-head-email` / `.menu-head-rolebadge` / `.menu-label` (`primitives.css` L218–223) — user-account menu rich head; spec has no user-menu pattern
- `.user-menu-pop` (`primitives.css` L215) — account-menu positioning helper
- `.gx-scrim` (`_drawer.css` L10) — modal/drawer backdrop; spec has no scrim primitive
- `.gx-drawer` + `.drawer-head` / `.drawer-hero` / `.drawer-tabs` / `.drawer-tab` / `.drawer-body` (`_drawer.css` L12–20) — slide-out record detail drawer; spec calls out drawer slide as the one allowed transform (L10–12 prose) but defines no drawer CSS
- `.gx-dialog` / `.gx-dialog-head` (`_overlays.css` L14–15) — modal dialog chrome; spec defines no dialog primitive
- `Modal.tsx` (`components/Modal.tsx`) — modal component wrapping the dialog chrome; spec-side has no modal primitive
- `.kv` / `.kv-k` / `.kv-v` (`_drawer.css` L21–23) — key/value row used inside the drawer; spec has no KV pattern
- `.notif-wrap` / `.notif-pop` / `.notif-item` etc. (`_notifications.css` L2–26) — NotificationBell popover; spec has no notification pattern
- `Toast.tsx` `<ToastHost>` (L47) — repo-side portal host for the toast queue; spec assumes caller-mounted toasts
- `score-badge` / `score-hot` / `score-warm` / `score-cold` (`_addendum.css` L19–22) — lead-score badge variants; spec-only color treatment is `.gx-pill--*` semantic colors, no score variant
- `.kan-col` / `.kan-card` / `.kan-avatar` / `.kan-newform` (`_addendum.css` L10–14, L23) — Kanban column + card primitives; spec has no Kanban pattern
- `.ask-msg` / `.ask-bubble` / `.ask-proposal` (`_addendum.css` L24–36) — Ask-GAAhex chat primitives; spec has no chat pattern
- `.lang-switch` / `.lang-opt` (`_addendum.css` L37–40) — language switcher; spec has no language-toggle pattern
- `.search-md` / `.search-input` / `.search-icon` / `.search-clear` / `.search-kbd` (`_forms.css` L41–62) — legacy search affordance; spec consolidates this into `.gx-search`. The `.search-kbd` class is the keyboard-shortcut badge slot that **must never render** per the CLAUDE.md hard UI rule
- `KPIBar.tsx` (`page-shell/KPIBar.tsx`) — KPI strip layout primitive
- `PageShell.tsx` + `PageHeader.tsx` + `ActionBar.tsx` + `FilterBar.tsx` + `ContextPanel.tsx` + `SlideOutPanel.tsx` (`page-shell/`) — repo's page-shell zones; spec defines no page-shell pattern (page-shell is the repo's contract per platform standard file 10, file 18, etc.)
- `Stack.tsx` / `Inline.tsx` / `Grid.tsx` / `.stk` / `.inl` / `.gd` (`page-shell/primitives/`) — layout primitives. Spec relies on caller-driven flex/grid, no layout primitive
- `OrgIdentity.tsx`, `RecordDrawer.tsx`, `UserMenu.tsx`, `UserPicker.tsx`, `RefPicker.tsx`, `Select.tsx`, `Composer.tsx`, `EmojiPicker.tsx`, `WorkItemsBoard.tsx`, `WorkItemsTable.tsx`, `ActivityTimeline.tsx`, `NotificationBell.tsx`, `CustomCells.tsx`, `FieldInput.tsx`, `ChartPicker.tsx`, `ErrorBoundary.tsx`, `LoadingState.tsx`, `Overlay.tsx`, `NoAccess.tsx`, `ViewHead.tsx`, `Donut.tsx`, `LineChart.tsx`, `Spark.tsx` — application-level components with no `gx-*` spec equivalent (most are GAAhex-domain primitives the spec deliberately leaves out)

## Provenance + freshness

- Spec source: design-Claude handoff `transfer/design-system/ds-components.css` at v6 zip (basis commit on his side: `a9bec13`)
- Repo target: HEAD `3b9baeb` at production of this document
- Owed-artifact status: **CLOSED on the repo side.** If the next designer iterates the spec, this doc needs a refresh pass — re-run the mapping on the same two files
- D18 (Color Token Families) alignment: every primary / interactive / focus / selected token-using primitive on the repo side is post-`a9bec13` (azure on interactive, cobalt only on brand spine, gold only on signature). Spot-confirmed at `primitives.css` L13, L34, L58, L125, L211
- D17 (KPI Tile Standard) alignment: KPI primitives on both sides ship the locked behaviour — colored value text for state, hover = gold border + soft outward glow + tooltip dwell (no movement). Spot-confirmed at `primitives.css` L120–129, L155–195; spec L186, L199–205
