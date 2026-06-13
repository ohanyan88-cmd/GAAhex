# 09 — Design System Standards

Covers: Button, Badge, Chip, Form, Table, Modal, Toast/Alert, Empty State, Card, Tabs, Icon,
Color, Spacing, Typography. All component states/types below are token-based, permission-aware,
localization-safe, and use canonical values (enum values `UPPER_SNAKE_CASE`).

## Global Design System Law
Pages must not invent local UI. Reusable components are preferred over page-specific UI.
Components must support localization/long labels, responsive layouts, accessibility,
permission-based disabled/hidden states, loading/empty/error states, destructive-action safety,
audit-safe clarity, dense workflows, keyboard usability, screen-reader clarity, stable hierarchy.
Forbidden globally: random per-page styling, one-off components, hardcoded colors, arbitrary
font sizes, random margins/padding, frontend-only permission behavior, local enum/status
meanings, UI text as business logic, translated labels as stored values, color as the only
meaning indicator, inaccessible icon-only actions.

---

## Button Standard — LOCKED
Variants: `PRIMARY, SECONDARY, TERTIARY, DESTRUCTIVE, GHOST, ICON_ONLY` (no custom variants).
States: `DEFAULT, HOVER, FOCUS, ACTIVE, DISABLED, LOADING, PERMISSION_DENIED`.
One primary action per action area. Destructive actions use the destructive variant and require
confirmation when they delete/disable/revoke/cancel/overwrite/permanently change. Submit buttons
show loading and prevent duplicate submission. Disabled buttons explain non-obvious reasons.
Icon-only buttons have accessible labels. Tokens only. Permissions enforced backend even if
hidden/disabled. Labels action-oriented, localizable, long-text safe.
Forbidden: hardcoded colors, one-off styles, destructive action in primary/secondary styling,
submit without loading protection, icon-only without label, disabled without reason,
frontend-only enforcement, button text as business logic.

**State → family mapping (D18, locked).** A button is an interactive control, so its
default/hover/active/focus paint is Azure; destructive paint is Semantic-danger; disabled paint is
Slate. Cobalt and Gold are never used on a button.

| State                 | Family   | Tier-1 semantic token(s)                       |
|-----------------------|----------|------------------------------------------------|
| `DEFAULT` (PRIMARY)   | Azure    | `--gx-interactive` (bg/text)                   |
| `HOVER`               | Azure    | `--gx-interactive-hover`                       |
| `ACTIVE` (selected)   | Azure    | `--gx-interactive` border + `--gx-interactive-soft` bg |
| `FOCUS` (ring)        | Azure    | `--gx-interactive` (focus ring)                |
| `DEFAULT` (SECONDARY / TERTIARY / GHOST) | Slate | `--gx-text-1/2/3`, `--gx-border` |
| `DEFAULT` (DESTRUCTIVE)                  | Semantic | `--gx-danger-fg` (text), Semantic-family bg per design system |
| `DISABLED`            | Slate    | `--gx-text-3`, `--gx-border`                   |
| `LOADING`             | (no color change — spinner only over the variant's existing paint) |
| `PERMISSION_DENIED`   | Slate    | Same paint as `DISABLED`; reason surfaced per Permission rules |

Hover affordance per D17 ↔ D18 reconciliation: buttons are **interactive controls**, so hover is
azure tint + soft azure glow (never gold — gold-on-hover is reserved for container elements like
KPI tiles and cards). Only the D18 Tier-1 semantic tokens above are permitted; Tier-0 raw scale
references (`--azure-500`, `--cobalt-700`, etc.) are forbidden in component code.

## Badge Standard — LOCKED
Types: `STATUS, PRIORITY, CATEGORY, VISIBILITY, SYSTEM, COUNT`. Non-interactive. Status/priority/
visibility badges use canonical values. Labels translated for display only. Colors from tokens.
Count badges respect permissions (no hidden-count leaks). Readable with long labels. Badges never
define new enum/status meanings or act as buttons.

## Chip Standard — LOCKED
Uses: selected filters, assignees, watchers/subscribers, selected enum values/references,
removable metadata, tags (only if a formal tag standard exists). Removable chips show a clear
remove affordance; removal that changes business data is permission-checked and has loading/error
handling. Filter chips use canonical values; labels translated for display. Chips are not buttons
and not official status badges.

## Form Standard — LOCKED
States: `DEFAULT, LOADING, SUBMITTING, VALIDATION_ERROR, SERVER_ERROR, SUCCESS, DISABLED,
READ_ONLY, PERMISSION_DENIED`. Shared form components only. Server-side validation mandatory;
client-side is UX only. Required fields marked; field errors near fields; global errors at form
level. Submit shows loading; duplicate submission prevented. Clear cancel/back; dirty-state warn
before losing changes. Permission-restricted fields hidden/read-only/disabled. Canonical values;
translated labels display only. Long-label safe; responsive.
Forbidden: frontend-only validation, saving invalid data, no loading state, silent failed submit,
per-page validation bypassing shared backend validation, storing translated labels as values,
hidden fields bypassing permissions, destructive submit without confirmation.

## Table Standard — LOCKED
States: `LOADING, EMPTY, ERROR, POPULATED, FILTERED_EMPTY, PERMISSION_DENIED, BULK_SELECTED`.
Respects permissions, tenant boundaries, visibility, filters. Standardized columns per object;
standardized row action menus; approved sortable fields; filtering per Search & Filter Standard;
empty states per Empty State Standard; standard skeleton loading; consistent pagination. Bulk
actions require explicit permission. Counts never leak unauthorized data. Export respects
Import/Export rules. Long-text safe; reference numbers displayed consistently; status uses Badge
Standard; consistent accessible row-click. Never rely on frontend filtering for security.

## Modal Standard — LOCKED (M2 applied)
Types: `CONFIRMATION, FORM, DETAIL_PREVIEW, WARNING, DESTRUCTIVE_CONFIRMATION, SYSTEM_NOTICE`.
M2 scope: `FORM` modal = quick-create / simple short form only; large forms and complex detail
views use Drawer or Dedicated Page. `DETAIL_PREVIEW` normally uses a Drawer; modal preview is
only for a lightweight read-only preview. Use modals only when interruption is justified.
Destructive actions confirm and explain consequences. Buttons follow Button Standard with one
clear primary. Predictable close; unsaved forms warn before close. Keyboard-accessible, focus-
trapping, focus-returning. Never hide critical permission errors. No modal for every small
action; no nested modals unless unavoidable; no silent close on failed submit; no bypass of
validation/permissions.

## Toast / Alert Standard — LOCKED
Toast types: `SUCCESS, INFO, WARNING, ERROR`. Alert types: `INLINE_INFO, INLINE_WARNING,
INLINE_ERROR, SYSTEM_ALERT, PERMISSION_ALERT`. Toasts = short non-blocking feedback; alerts =
persistent/important. Blocking errors never toast-only. Success toast only after backend
confirmation. User-readable errors; no sensitive internals. Toasts never replace audit/events.
Localized, long-text safe. Critical warnings persist until resolved/intentionally dismissed.

## Empty State Standard — LOCKED
Types: `NO_DATA, NO_SEARCH_RESULTS, NO_PERMISSION, FEATURE_DISABLED, SETUP_REQUIRED,
ERROR_STATE`. Clear and useful. Search empty states never reveal unauthorized hidden records;
permission empty states never expose restricted details; feature-disabled respects Feature Flag
rules. Action buttons respect permissions. Localized. List empty states guide the next valid
action; filtered-empty distinguishes "no data" from "filters exclude data". Icons never replace
text meaning.

## Card Standard — LOCKED
Clear purpose; not a random layout container. Uses spacing/border/radius/shadow/background
tokens. May show summaries, object previews, KPI widgets, grouped actions. Card actions follow
Button Standard; KPI cards follow Reporting & Analytics rules. No unauthorized data; localized,
long-value safe; clickable cards have clear focus/hover and accessible behavior.

## Tabs Standard — LOCKED
For related in-context views only; not primary navigation. Short localizable labels;
permission-based visibility; hidden tabs never leak counts; predictable state; object-detail tabs
align with Object Detail rules; tab counts respect permissions; content enforces backend
permissions; keyboard-accessible; labels never used as logic keys.
Common object-detail tabs: defined once by the **Object Detail Standard** (file 10) —
`Overview, Timeline, Tasks, Comments, Attachments, Approvals, Related, Communications, Audit`.
The Tabs Standard does not define a separate set (D4); there is no separate `Activity` tab — the
`Timeline` tab is the activity history (D13) — and no separate `Documents` tab — documents are a
filtered view of Attachments (E11).

## Icon Standard — LOCKED
Approved icon set only. Icons are never the only source of business meaning. Icon-only actions
need accessible labels. Consistent per object/action; destructive icons align with destructive
styling; icons never define statuses/meaning alone; clear in dense UI; focus/hover when
interactive. No random icon libraries, no icon as sole status indicator, no color as the only
meaning indicator.

## Color Standard — LOCKED (D18 — Color Token Families)
**E20 — design tokens (color token names, spacing scale, typography roles) are design
identifiers, not business enums; they are exempt from the Enum Standard's UPPER_SNAKE rule (like
event names) and use the design-system's own token naming convention (kebab-case `--gx-*`
semantic tokens, plus `--<family>-<step>` Tier-0 raw scales).**

Five color families, one non-overlapping role each (D18, locked 2026-06-04 — see file 13
"Seventh patch"). Component code uses ONLY the Tier-1 semantic tokens below; Tier-0 raw scale
tokens (`--cobalt-500`, `--gold-300`, `--azure-400`, `--slate-700`) are for the design system to
remap and are forbidden in component code.

| Family | Role | Tokens (Tier 1 semantic) |
|---|---|---|
| **Cobalt** | Brand spine — structural chrome only | `--gx-bg`, `--gx-surface`, `--gx-sidebar`, `--gx-primary`, `--gx-primary-hover`, `--gx-primary-active`, `--gx-primary-soft`, `--gx-cobalt` |
| **Gold** | Brand signature — peak/featured moments only | `--gx-gold`, `--gx-gold-soft`, `--gx-text-on-gold` |
| **Azure** | Interactive — all clickable affordances | `--gx-interactive`, `--gx-interactive-hover`, `--gx-interactive-active`, `--gx-interactive-soft`, `--gx-interactive-ring` |
| **Slate** | Neutrals — 90% of data viz + text hierarchy + surfaces | `--gx-text-1`, `--gx-text-2`, `--gx-text-3`, `--gx-text-disabled`, `--gx-border`, `--gx-border-subtle`, `--gx-border-strong`, `--gx-divider` |
| **Semantic** | Status — success / warning / error on value text only | `--gx-success-fg`, `--gx-warning-fg`, `--gx-danger-fg` |

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
and `Inter` are FORBIDDEN in any font stack across the codebase.
Component code MUST reference `var(--gx-font-*)`, never bare family names.

**Backend color-string guard (D18, 2026-06-04).** Palette family names ("cobalt",
"gold", "azure", "slate") and raw hex literals that match palette anchors are
FORBIDDEN as hardcoded strings in backend Python code outside tenant-theme
configuration. Theming is a frontend concern; backend emits theme KEYS, not
values.

Per-family role assignment is exclusive: Cobalt is NEVER used on buttons, links, hover
affordances, chips, status badges, or default data viz; Gold is NEVER used on default chrome,
"ok" states, or hover-on-interactive (use Azure); Azure is NEVER used on passive data viz,
decorative chrome, status signaling, or peak/featured highlight (use Gold); Slate is NEVER used
for status signaling (Semantic) or interactive cues (Azure); Semantic is NEVER used on bar fills,
card backgrounds, or chrome — value text only.

Hover affordance follows the D17 ↔ D18 reconciliation: interactive controls (buttons, links,
chips, drillable rows) hover **Azure**; container elements (KPI tiles, cards, section frames,
drawer panels) hover **Gold**; the active selected state after click is **Azure border +
azure-soft background**; static critical / peak markers are **Gold**.

All colors from approved tokens; no inline hex, no inline RGB, no per-page palettes in page code.
Status colors are Semantic-family only; color is never the only meaning indicator;
error/warning/success consistent platform-wide; feature-specific colors require a new Tier-1
token approved against the family roles above (never introduced ad-hoc in a view);
light/dark support if themes exist; accessibility contrast required. Tenant-specific status
colors forbidden unless approved as display-only theme tokens that do not change meaning.

## Spacing Standard — LOCKED
Standardized spacing scale; page spacing follows PageShell/Universal Page; component spacing
consistent; dense layouts use approved compact spacing only; no per-page spacing hacks; long
localized text must not break spacing; forms/tables/cards/modals/sections use approved patterns;
responsive behavior preserves hierarchy. No random margins/padding, no negative-margin hacks
unless explicitly justified.

## Typography Standard — LOCKED
Roles: `PageTitle, SectionTitle, SubsectionTitle, Body, BodySmall, Label, HelperText, ErrorText,
TableHeader, TableCell, BadgeText, ButtonText, Caption, Metadata`. Approved tokens only; page
titles follow PageShell; consistent section titles; readable table text; distinct error/helper
text; localized text renders correctly; long labels wrap safely; no random font sizes; no skipped
hierarchy; typography never the only permission/security indicator. No custom fonts per page; no
uppercase-only labels that harm localization/readability.

## Locked Decision
The design system is token-based, accessible, localization-safe, permission-aware, dense, and
consistent. No page-specific random UI.
