// PageShell — public type surface.
//
// The page-type union is the single source of truth for how a page renders. It
// drives default zone visibility (e.g. `placeholder` hides KPI & Action bars),
// the default Workspace wrapper layout (e.g. `registry` → table-friendly,
// `pipeline` → kanban-friendly), and the data attributes downstream CSS hooks
// into. The shape is intentionally narrow — every prop is OPTIONAL except
// `type`, `title`, and `children`. Pages opt into zones by passing the
// matching prop; absent props = absent zones (see zone-visibility table in
// PageShell.tsx for the resolution rules).
import type { ReactNode } from 'react'

/* ─── Page type system ──────────────────────────────────────────────────── */

// PageType — canonical UPPER_SNAKE per standard 14 (Central Enum Registry, E19)
// and standard 10 (Page Type Standard). One of exactly 8 values.
export type PageType =
  | 'WORKSPACE'      // mixed dashboard / home / overview layout
  | 'REGISTRY'       // list/table-centric (Customers, Products, Tariffs)
  | 'PIPELINE'       // kanban / stage progression (Leads, Sales)
  | 'OPERATIONS'     // map + queue + status (Dispatch, NOC)
  | 'ANALYTICS'      // charts + cards grid (Reports, Insights)
  | 'COMMUNICATION'  // 3-pane list/thread/context (Inbox, Helpdesk)
  | 'CONFIGURATION'  // flexible settings/admin
  | 'PLACEHOLDER'    // coming-soon / stub state (no KPIs, no actions)

/* ─── Status summary chip ────────────────────────────────────────────────── */

export type StatusSummaryVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface StatusSummary {
  label: string
  variant?: StatusSummaryVariant
}

/* ─── KPI bar ────────────────────────────────────────────────────────────── */

export interface KPISpec {
  label: string
  value: string | number
  /** Optional unit (e.g. "AMD", "Mbps") shown next to the value. */
  unit?: string
  /** Optional delta string (e.g. "+4.2%"). */
  delta?: string
  /** Delta direction — drives green/red colorway. */
  deltaPositive?: boolean
  /** Baseline label shown after the delta (default "vs 7d"). e.g. "WoW". */
  deltaBase?: string
  /** Small note pinned to the card's top-right corner (e.g. a date range). */
  cornerNote?: ReactNode
  /** Optional 0–100 progress/utilisation ratio. When set, the KPI card renders a
   *  thin progress bar at the bottom (cockpit/NOC-style enrichment). */
  progress?: number
  /** Progress bar accent — 'gold' for critical/peak, else neutral. */
  progressVariant?: 'neutral' | 'gold' | 'success' | 'danger'
  /** Small label rendered inline at the end of the progress bar (e.g. "23%"). */
  progressLabel?: ReactNode
  /** Optional mini-chart (e.g. a sparkline) shown in the card's bottom group. */
  chart?: ReactNode
  /** Sub-line under the value (e.g. "5 active"). */
  subtitle?: ReactNode
  /** Click handler — when present the tile becomes interactive. */
  onClick?: () => void
  /** Danger accent — value rendered in danger fg. */
  danger?: boolean
  /** Warning accent — value rendered in warning fg. */
  warning?: boolean
  /** Muted accent — value rendered in muted color. */
  muted?: boolean
  /** Loading skeleton state. */
  loading?: boolean
  /** Hover-revealed info popover — second half of the KPI Tile Standard (D17).
   *  One-or-two sentences: what the metric counts, how it's computed, and (for
   *  clickable tiles) what clicking does. Plain text or rich ReactNode. */
  tooltip?: ReactNode
}

/* ─── Action bar ─────────────────────────────────────────────────────────── */

export interface PrimaryAction {
  label: string
  onClick: () => void
  /** Optional icon (renders to the left of the label). */
  icon?: ReactNode
  disabled?: boolean
  loading?: boolean
}

export interface SecondaryAction {
  label: string
  onClick: () => void
  icon?: ReactNode
  disabled?: boolean
}

export type ViewKind = 'table' | 'board' | 'calendar' | 'map' | 'timeline' | 'gallery'

export interface ViewSwitcher {
  current: ViewKind
  options: ViewKind[]
  onChange?: (next: ViewKind) => void
}

/* ─── Filter bar ─────────────────────────────────────────────────────────── */

export interface SearchFilter {
  value: string
  onChange: (next: string) => void
  placeholder?: string
}

export interface QuickFilterOption {
  label: string
  value: string
}

export interface QuickFilter {
  label: string
  value: string
  options: QuickFilterOption[]
  onChange: (next: string) => void
}

export interface SavedView {
  id: string
  name: string
  isDefault?: boolean
}

export interface FiltersSpec {
  search?: SearchFilter
  quick?: QuickFilter[]
  /** Advanced filter content — typically rendered inside a popover when the
   *  "Advanced" toggle is clicked. PageShell renders the toggle; the page
   *  controls what's in the drawer. */
  advanced?: ReactNode
  savedViews?: SavedView[]
  /** Called when a saved view is selected. */
  onSelectSavedView?: (id: string) => void
}

/* ─── Context panel (Zone F) ─────────────────────────────────────────────── */

export interface ContextPanelSpec {
  content: ReactNode
  /** Default open state. The user can toggle via the panel header. */
  defaultOpen?: boolean
  /** Optional fixed title shown at the top of the drawer. */
  title?: string
}

/* ─── Master PageShell props ─────────────────────────────────────────────── */

export interface PageShellProps {
  /** REQUIRED — drives default zone visibility & workspace wrapper layout. */
  type: PageType

  /* Zone A — header */
  breadcrumb?: string[]
  icon?: ReactNode
  title: string
  subtitle?: string
  statusSummary?: string | StatusSummary
  /** Optional page-level tab strip (e.g. a <DetailTabList>) rendered under the
   *  title — composes sub-pages (e.g. Overview / Work) into one logical page.
   *  Distinct from the action-bar `views` switcher (Zone C). */
  pageTabs?: ReactNode

  /* Zone B — KPI bar */
  kpis?: KPISpec[]

  /* Zone C — action bar */
  views?: ViewSwitcher
  primaryAction?: PrimaryAction
  secondaryActions?: SecondaryAction[]

  /* Zone D — filter bar */
  filters?: FiltersSpec

  /* Zone E — workspace body */
  children?: ReactNode
  /** Override the workspace wrapper className for one-off pages. */
  workspaceClassName?: string

  /* Zone F — context panel (optional) */
  contextPanel?: ReactNode | ContextPanelSpec

  /* Escape hatches */
  className?: string
}

/* ─── Empty-state primitive ──────────────────────────────────────────────── */

export interface EmptyStateProps {
  icon?: ReactNode
  title: string
  message?: string
  action?: ReactNode
  /** Visual variant — `coming-soon` applies a stub treatment used by the
   *  `placeholder` page type. */
  variant?: 'default' | 'coming-soon' | 'error'
}
