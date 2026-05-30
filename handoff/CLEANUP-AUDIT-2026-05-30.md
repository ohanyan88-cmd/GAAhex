# Layered/Duplicate Code Audit — 2026-05-30

Scope: `frontend/src` (styles.css = 2827 lines, gaaex-tokens.css = 470, color-tokens.css = 222,
primitives.css = 109). Read-only catalog. **Do not delete yet — Gev to triage.**

Method: read every section of styles.css; for each candidate, grepped `frontend/src/**/*.tsx`
to find inbound usage. "Used by: none" = `className="X"` (or `className={'X' + ...}`) matches **zero** files.

---

## CSS — confirmed duplicates (legacy can be deleted)

### `.toggle` / `.toggle-thumb` vs `.gx-toggle` / `.gx-toggle .knob`
- Legacy `.toggle{.on,-thumb}` at styles.css:1610-1627 — **used by: none** (orphaned)
- New `.gx-toggle{.on,.knob}` at styles.css:1630-1633 — used by: `views/SettingsView.tsx:28`
- Recommendation: **delete legacy** (`.toggle` block).

### `.shell` / `.sidebar*` / `.nav*` (whole legacy app-shell block) vs `.app` / `.sb-*` / `.tb`
- Legacy block at styles.css:283-532 — `className="shell"`, `"sidebar"`, `"sidebar-brand"`,
  `"sidebar-logo"`, `"sidebar-brand-name"`, `"sidebar-scroll"`, `"sidebar-tenant*"`,
  `"nav"`, `"nav-icon"`, `"nav-count"`, `"nav-label*"`, `"nav-section*"`, `"nav-standalone"`,
  `"nav-backdrop"`, `"nav-toggle"`, `"nav-collapsed"` — **all used by: none**
  (only `nav-scrim` survives as a kit class).
- New kit shell at styles.css:2538-2594 (`.app{.collapsed}`, `.sb*`, `.tb*`) — used by `App.tsx:357,365,369,380,398,409,426,428` and across the topbar.
- Recommendation: **delete entire legacy shell** (lines 283-532, ~250 lines). Biggest single win.

### `.content` / `.content > header/main` (legacy content frame) vs `.main` (kit)
- Legacy `.content{,>header,>main,>main.no-pad}` at styles.css:535-562 — **used by: none**
  (no `className="content"` anywhere).
- New `.main` at styles.css:2570 — used by App.tsx shell.
- Recommendation: **delete legacy** content rules.

### `.user-chip*` (legacy header chip) vs in-line user-menu in App.tsx
- Legacy `.user-chip{,-name,-role,-caret}{.on}` at styles.css:569-589 — **used by: none**
- New: App.tsx renders the user trigger inline as a plain button + `.user-menu .menu` (kit `.menu`).
- Recommendation: **delete legacy** user-chip block.

### `.user-pop*` (legacy account dropdown) vs kit `.menu` + `.menu-head*` (primitives.css)
- Legacy `.user-pop{,-head,-name,-email,-section,-label,-item,-row,-divider,-signout,-rolebadge}`
  at styles.css:593-642 — **only one survivor**: `user-pop-divider` referenced once in
  `modals/SecurityModal.tsx:91`. The rest **unused**.
- New: `.menu`/`.menu-item`/`.menu-sep` (styles.css:2806-2812) + `.menu-head*` extensions
  (primitives.css:103-107) — used by App.tsx user menu and across.
- Recommendation: **migrate** that one `user-pop-divider` ref to `menu-sep`, then **delete**
  the whole `.user-pop*` block.

### `.toast` / `.toast-region` / `.toast-{success,error,warning,info}` / `.toast-{icon,msg,close}` vs `.gx-toast*` / `.gx-toast-host`
- Legacy `.toast{,-region,-success,-error,-warning,-info,-icon,-msg,-close}` at
  styles.css:1121-1153 — **used by: none** (zero `className` matches).
- New `.gx-toast-host` / `.gx-toast{.success,.danger,.warning,.info}` at styles.css:2819-2829
  — used by `components/Toast.tsx:58` (the only toast host).
- styles.css itself even documents this (line 2799-2802 comment: *"safe-but-quiet retired"*).
- Recommendation: **delete legacy** toast block.

### `.overlay-backdrop` / `.overlay-panel` / `.modal-{sm,md,lg,fullscreen}` / `.modal-{head,title,body,foot}` vs `.gx-scrim` + `.gx-dialog{,-head}`
- Legacy `.overlay-backdrop`, `.overlay-panel`, `.modal-*` at styles.css:1086-1119 — `className`
  matches: only `profile-modal-foot` (2 hits in ProfileModal.tsx:124, SecurityModal.tsx:85), and
  that's a **different selector** scoped under `.profile-modal-foot` (legacy rule on line 661).
  The actual `.modal-{sm,md,lg,head,body,foot,title,fullscreen}` and `.overlay-{backdrop,panel}`
  — **used by: none**.
- New `.gx-scrim`/`.gx-dialog{,-head}` at styles.css:2653, 2815-2816 — used by `components/Modal.tsx:46`.
- Recommendation: **delete legacy** overlay/modal block (lines 1086-1119), plus the
  `.overlay-panel.cmdk` add-on on line 1169 (cmdk markup is unused — see dead component below).

### `.dd-menu` / `.dd-item{.danger}` / `.dd-divider` vs `.menu*` (kit)
- Legacy `.dd-menu`, `.dd-item`, `.dd-divider` at styles.css:1658-1674 — **used by: none**
- New `.menu`/`.menu-item`/`.menu-sep` — live (see toast section above).
- Recommendation: **delete legacy** `.dd-*` block.

### `.kanban` / `.kcol*` / `.kcard*` vs `.kan-col` / `.kan-card` / `.kan-avatar` (LeadPipeline)
- Legacy `.kanban`, `.kcol{,-head,-count,-body}`, `.kcard{,-title,-meta,-value,-foot,-avatar}`
  at styles.css:1314-1363 — **used by: none**
- New `.kan-{col,col-head,card,avatar,newform}` at styles.css:1821-1834 — used in
  `views/LeadPipelineView.tsx`.
- Recommendation: **delete legacy** kanban block.

### `.cal-shell` / `.cal-side` / `.cal-main` / `.cal-head` / `.cal-view-tabs` / `.cal-view-tab` / `.cal-month` / `.cal-dow` / `.cal-day{*}` / `.cal-chip{*}` / `.cal-mini{*}` / `.cal-list-{row,dot}` vs new `.cal-grid` / `.cal-h` / `.cal-evs` / `.cal-ev` / `.cal-layout` / `.cal-rail` / `.cal-nav` / `.cal-cal` / `.cal-check` / `.cal-cell`
- Legacy calendar block at styles.css:1511-1607 — `className` matches: **none of these
  legacy names appear in any tsx**.
- New calendar classes — used by `views/CalendarView.tsx:293,295,311,317,362,381,382,392,394,439,441,448,462,466,472,…`.
- Recommendation: **delete legacy** calendar block (~95 lines). NOTE: the styles
  CalendarView.tsx actually uses (`.cal-grid`, `.cal-h`, `.cal-ev`, `.cal-layout`, `.cal-rail`,
  `.cal-cell`, `.cal-nav`, `.cal-cal`, `.cal-check`) are **NOT defined in styles.css** — they
  must live in the kit / another sheet. Verify before delete (separate finding below).

### `.messages` / `.thread-{list,item,title,sub,pane,head}{,.on}` / `.msg{,.me,-head,-bubble,-compose,-scroll,-placeholder}` vs new MessagesView markup
- Legacy messages block at styles.css:1232-1280 — **used by: none** (MessagesView uses
  `msgr-tabs` and other kit/inline styles, not these).
- Recommendation: **delete legacy** messages block (~50 lines).

### `.skel` / `.skel-row` / `.skel-cell` — declared TWICE in styles.css
- Definition 1 at styles.css:1386-1396 (uses `accent` gradient + `skeleton-shimmer` keyframe).
- Definition 2 at styles.css:1816-1819 (uses `border` gradient + `shimmer` keyframe).
- The second definition (lower in file) wins.
- Used by `views/DashboardView.tsx`, `views/ReportBuilderView.tsx`, `views/StudioView.tsx`.
- Recommendation: **delete definition 1** (lines 1386-1396), and the unused
  `@keyframes skeleton-shimmer` at line 1708.

### `.kpi` (legacy big-number) vs `.kpi-strip .kpi` + `.gx-dash .kpi`
- Legacy `.kpi{,-sub,-cur,-delta{.pos,.neg}}` at styles.css:959-976 — used by 18 views directly
  (PartiesView, AccountsView, LeadPipelineView, InvoicesView, HelpdeskView, DashboardView,
  PaymentGatewayView, PaymentsView, ProductsView, SubscriptionsView, UsageView, WorkItemsView,
  WebhooksView, ResourcePoolsView, ServicesView, ReportBuilderView, CustomerView).
- Newer scoped `.kpi-strip .kpi` (styles.css:2622-2636) and `.gx-dash .kpi`
  (styles.css:2688-2706) — both **reset** the legacy `.kpi` rule (font-size:38px, mono, accent).
- The two scoped overrides themselves duplicate ~70% of properties (label/value/foot/delta/marquee).
- Recommendation: **kept as-is for now** — Gev's prior fix (mirror, not delete) is in place.
  But this is the textbook "layered" pattern: legacy `.kpi` is what every view actually has on
  the DOM, then two scoped rules selectively undo it. Future cleanup: pick ONE shape for `.kpi`
  (the kit one) and delete the legacy + the resets. Counts as 1 reskin task, not a quick win.

### `.btn{,-primary,-accent,-ghost,-danger,-block,-sm,-md,-lg}` + `.inp{,-sm,-md,-lg,-numeric,-area,-help,-err}` + `.field` + `.pill{,-dot,-success,-warning,-danger,-accent,-muted}` + `.badge` + `.mono` + `.spacer` — declared in BOTH styles.css and primitives.css with DIFFERENT VALUES
- styles.css:683-816 declares the LEGACY versions (uses `--primary`, `--surface`, `--text-3`,
  `--border`, `--font-mono`, `--pill`, etc.).
- primitives.css:10-48 declares the KIT versions (uses `--gx-primary`, `--gx-surface-2`,
  `--gx-text-2`, `--gx-border`, `--gx-font-mono`, `--gx-radius-full`, etc.) — VERBATIM from
  `design-system/ui_kits/portal/app.css` lines 18-57.
- Import order in `main.tsx`: `primitives.css` (line 7) THEN `styles.css` (line 10) —
  so **legacy styles.css versions WIN**. Result: every `.btn`, `.inp`, `.pill`, `.field`,
  `.badge` in the app today is using the legacy values, not the kit values. That's the exact
  thing the kit was supposed to install.
- This is a HIGH-IMPACT layering: ~135 lines of legacy rules in styles.css clobbering ~50
  lines of kit rules in primitives.css. Same class names, different values.
- Recommendation: **delete legacy `.btn`/`.inp`/`.field`/`.pill`/`.badge`/`.mono`/`.spacer`
  rules from styles.css** (lines 683-816 minus `.iconbtn` which is unique and live), keep
  the primitives.css versions. **NEEDS DESIGN VERIFY** — visual diff expected.

---

## Token-file duplicates

### `gaaex-tokens.css` (470 lines) vs `color-tokens.css` (222 lines)
Both files define the FULL `--gx-*` semantic token set in `:root` / `[data-theme="dark"]` /
`[data-theme="light"]` — and with **different values**:
- `gaaex-tokens.css:316` light `--gx-primary: var(--azure-500)` (=`#3B7BE0`)
- `color-tokens.css:46`  dark `--gx-primary: #3B7BE0`
- `gaaex-tokens.css:401` light `--gx-primary: var(--azure-600)` (=`#2C63BC`)
- `color-tokens.css:113` light `--gx-primary: #2C63BC`
Same final value for primary; but `--gx-success-fg`, `--gx-danger-fg`, `--gx-info-fg`,
`--gx-success-soft` etc. are NOT identical between the two files (gaaex-tokens uses 0.18 alpha
for soft fills, color-tokens uses 0.12-0.16 in light mode etc.).
- Import order in main.tsx: `gaaex-tokens.css` (line 6) THEN `color-tokens.css` (line 9), so
  `color-tokens.css` WINS for any duplicate token (but primitive scales `--cobalt-*`/`--gold-*`
  /`--azure-*`/`--viz-*`/`--gx-space-*`/`--gx-radius-*`/`--gx-text-*`/`--gx-control-*`/etc. live
  ONLY in `gaaex-tokens.css`, so it can't be deleted).
- Recommendation: **collapse to one file**. Either (a) move `color-tokens.css` semantic block
  INTO `gaaex-tokens.css` and delete `color-tokens.css`, or (b) move primitive scales OUT of
  `gaaex-tokens.css` into `color-tokens.css`. The decorator stories already import
  `color-tokens.css` + `styles.css` and skip `gaaex-tokens.css` (`primitives/stories/_decorator.tsx:8`),
  which means **Storybook primitives are missing the `--cobalt-*`/`--azure-*`/`--gx-space-*`
  scales** — separate bug surfaced by this audit.

### Dead `--*-bg-image` overlay tokens
- `--sidebar-bg-image`, `--header-bg-image`, `--content-bg-image` declared in styles.css:115-117
  and consumed in styles.css:307, 539, 545 (`.sidebar`, `.content`, `.content > header`) — but
  those three selectors are themselves in the dead legacy shell block (see top finding).
- Recommendation: **delete with the shell block**.

### Other tokens
No `--gx-palette-*` / `--gx-appearance-*` tokens found anywhere — palette/appearance system
already removed cleanly (matches memory). No leftover token rot in primitives.css or tailwind.css
(latter is just 3 lines of `@tailwind` directives).

---

## CSS — suspicious but uncertain (need human eye)

### `.notif-*` (NotificationCenter block, styles.css:1037-1083)
- All 18 occurrences of `notif-*` classes are in `components/NotificationCenter.tsx` only.
- That ONE consumer is alive (imported by App.tsx). So this is NOT a duplicate — it's just a
  one-consumer block. **No action.** Listed here only because it looked suspicious at first.

### `.emoji-pop` / `.icon-picker-pop` / `.emoji-{search,tabs,tab,grid,cell,empty}` (styles.css:1294-1311)
- `.emoji-*` selectors used by `components/EmojiPicker.tsx` and `views/MessagesView.tsx` (the
  emoji-picker is mounted from MessagesView). Live.
- `.icon-picker-pop` listed in the GLASS surfaces selector list (styles.css:248) and in the rule
  at 1295, but **no `className="icon-picker-pop"` anywhere**. Likely dead but used to exist —
  separate verify.

### `.cmdk-*` (styles.css:1156-1230)
- All ~25 `.cmdk-*` selectors used ONLY by `components/CommandPalette.tsx`.
- BUT `CommandPalette` itself is **never imported** (see dead-components below).
- Conclusion: if CommandPalette is deleted, the whole `.cmdk-*` block dies with it.

### `.profile-avatar*` / `.profile-modal-foot` / `.field-block` / `.field-label` (styles.css:647-669)
- Used by `modals/ProfileModal.tsx`, `modals/SecurityModal.tsx`. **Live.**

### `.security-section-label` / `.security-stub*` / `.shortcuts-table` / `.shortcut-kbd` / `.whatsnew-*` (styles.css:663-682)
- Used by `modals/SupportModals.tsx`, `modals/SecurityModal.tsx`. **Live.**

### `.wiz-step{,s,-no,.on,.done}` / `.wiz-conn{.done}` (styles.css:1457-1469)
- **No `className="wiz-*"` matches anywhere.** Likely dead (CreateTenantWizard probably
  uses kit-style steps). Worth verifying — but kept as "uncertain" rather than "confirmed delete"
  because CreateTenantWizard.tsx might compose the class via template.

### `.task-calendar-embed` (styles.css:1602-1607)
- **No usage.** Likely dead (orphaned from a previous version of CalendarView). Safe-delete
  candidate.

### `.bars` / `.bar-row` / `.bar-{label,track,fill,val}` (styles.css:978-992)
- **No usage.** No view uses `.bar-row` / `.bar-fill` markup. Likely dead.

### `.trend` / `.trend-{col,bars,bar,x,legend}` (styles.css:1009-1014)
- **No usage.** Likely dead (replaced by `<LineChart>` SVG component).

### `.donut` / `.donut-{wrap,total}` / `.legend{,-row,-dot,-name,-val}` (styles.css:994-1006)
- **No `className="donut*"` matches.** `.donut*` likely dead; `.legend*` matches only inside
  OrgView (different `.org-sun-legend*` etc.). The bare `.legend` rule looks dead.

### `.timeline{::before}` / `.timeline-{item,dot,body,meta}` (styles.css:1017-1035)
- Used by `components/ActivityTimeline.tsx` and `components/RecordDrawer.tsx`. **Live.**
  (Kit also has a scoped `.gx-drawer .timeline` override at styles.css:2669 — that's the only
  intentional cascade.)

### `.score-*` / `.ask-*` (styles.css:1830-1847)
- **No usage.** Comment at line 1827 calls them "Recovered real-app classes" but they're
  apparently not in any tsx anymore (AskGaaexView uses different markup). Likely dead.

### `.lang-switch` / `.lang-opt` (styles.css:1848-1851)
- Used in `App.tsx:591-593`. **Live.**

### `.swatch{,-row,-wrap}{.on}` (styles.css:1644-1654)
- `.swatch` referenced only as `org-sun-swatch` (different class). The bare `.swatch*` block
  appears dead.

### `.card{,-wide}` / `.logo-{lg,sm}` / `.center` (styles.css:1414-1454)
- `.card` is widely used (`className="card"` matches in 10 files) — **live**.
- `.card-wide`, `.logo-lg`, `.logo-sm` — match only in App.tsx and StudioView.tsx and
  EntityView.tsx (logos for login/wizard). Likely **live**.
- `.center` (login wrapper) — matches in many files. **Live.**

### `.view-head` / `.view-icon` / `.view-title-wrap` / `.view-sub` / `.view-head-actions` / `.list-toolbar` / `.saved-views` (styles.css:876-900)
- `.view-head` used by App.tsx, OrgView, DashboardView, ServicesView, ViewHead.tsx,
  EntityView. **Live.**

---

## Dead components / files

- `frontend/src/components/CommandPalette.tsx` — **no inbound imports**. (Export exists, never
  imported.) Likely abandoned in favour of header `Search` icon. Deletes the whole `.cmdk-*`
  CSS block with it.
- `frontend/src/components/SystemStatusChip.tsx` — **no inbound imports**. (Export exists,
  never imported.)
- (everything else in `components/`, `views/`, `modals/`, `primitives/`, `studio/` has ≥1
  inbound import.)

---

## Dead tokens

- `--sidebar-bg-image`, `--header-bg-image`, `--content-bg-image` (styles.css:115-117) — only
  consumed by the legacy shell block; dies with it.
- No `--gx-palette-*` / `--gx-appearance-*` (already gone — good).
- All `--cobalt-*` / `--gold-*` / `--azure-*` / `--slate-*` / `--green-*` / `--amber-*` /
  `--red-*` / `--violet-*` / `--viz-*` token scales are referenced somewhere; keep.

---

## Duplicated handler pattern (NOTED — refactor candidate, NOT for this pass)

Inline open/close-with-Escape/click-outside menu pattern repeats:
- `App.tsx`: 3 instances — `userMenuOpen` (lines 154,224-238), `tenantMenuOpen` (155,250-264),
  `createMenuOpen` (156,242-246).
- `views/OrgView.tsx:219` — kebab menu.
- `components/NotificationCenter.tsx` — notif pop.
- `components/CommandPalette.tsx:516` — palette ESC handler.
- ≥6 inline copies → strong `useDropdown(initial?: boolean)` hook candidate. **Do not refactor
  in cleanup pass** — flagged per instructions.

---

## Summary

- **Confirmed-deletable rule blocks**: 11 (`.toggle`, legacy shell `.shell/.sidebar*/.nav*`,
  legacy `.content`, `.user-chip*`, `.user-pop*` after 1 migration, `.toast*`, `.overlay/.modal*`,
  `.dd-*`, `.kanban/.kcol/.kcard`, legacy `.messages/.thread/.msg`, duplicate `.skel` def #1).
  Total deletable lines in styles.css: **~600 of 2827 (~21%)**.
- **High-impact same-name overrides to resolve**: 2 (`.btn`/`.inp`/`.field`/`.pill`/`.badge`/
  `.mono`/`.spacer` in styles.css vs primitives.css; tokens in gaaex-tokens.css vs color-tokens.css)
  — design verify required.
- **Suspicious blocks (uncertain, need eye)**: 8 (`.wiz-*`, `.task-calendar-embed`, `.bars*`,
  `.trend*`, `.donut*`/`.legend` (bare), `.swatch*`, `.score-*`, `.ask-*`, `.icon-picker-pop`).
- **Dead components**: 2 (`CommandPalette.tsx` + `SystemStatusChip.tsx`).
- **Dead tokens**: 3 (`--sidebar-bg-image`, `--header-bg-image`, `--content-bg-image`)
  — die with the shell block.
- **Migrations required before delete** (legacy class still has at least 1 live ref):
  - `.user-pop-divider` (1 ref in `modals/SecurityModal.tsx:91`) → switch to `.menu-sep` before
    deleting `.user-pop*`.
  - `.profile-modal-foot` (2 refs in `modals/ProfileModal.tsx:124`, `modals/SecurityModal.tsx:85`)
    is a SEPARATE selector from the dead `.modal-foot` and can stay.
- **Refactor candidate (flagged, NOT executed)**: `useDropdown` hook to dedupe ~6 inline
  open-with-Escape menus.

## Side findings (out of scope but surfaced)

- `frontend/src/views/CalendarView.tsx` uses `.cal-grid`, `.cal-h`, `.cal-ev`, `.cal-layout`,
  `.cal-rail`, `.cal-cell`, `.cal-cal`, `.cal-check`, `.cal-nav`, `.cal-evs` — **none of these
  selectors exist in styles.css**. They must be defined in the kit / another stylesheet — verify
  the cascade is intact before deleting the legacy `.cal-*` block.
- `primitives/stories/_decorator.tsx:8-9` imports only `color-tokens.css` + `styles.css` —
  Storybook is missing the primitive scales (`--cobalt-*`, `--gx-space-*`, `--gx-radius-*`,
  `--gx-text-*`, `--gx-control-*`, font tokens) that live ONLY in `gaaex-tokens.css`. Bug:
  Storybook color/spacing/typography stories likely render with fallbacks.
- styles.css:2799-2802 already CONFESSES the layered pattern: *"The legacy `.toast-region` /
  `.toast` / `.overlay-backdrop` / `.modal-*` selectors are left alive (no orphaned markup uses
  them after this prompt's Toast.tsx + Modal.tsx + Overlay.tsx refactor; safe-but-quiet
  retired)."* — this audit confirms they're indeed unused, so the "safe-but-quiet" justification
  no longer holds; delete them.
