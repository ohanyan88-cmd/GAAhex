// PageShell — public API.
//
// Pages import ONLY from this file:
//
//   import { PageShell, EmptyState } from '@/page-shell'
//   import type { PageType, KPISpec, FiltersSpec } from '@/page-shell'
//
// Individual zone components (PageHeader, KPIBar, ActionBar, FilterBar,
// ContextPanel) are also exported for advanced cases where a page needs to
// recompose a zone outside the orchestrator. For 95% of pages the top-level
// `PageShell` composition is enough.
export { PageShell } from './PageShell'
export { PageHeader } from './PageHeader'
export { KPIBar } from './KPIBar'
export { ActionBar } from './ActionBar'
export { FilterBar } from './FilterBar'
export { ContextPanel } from './ContextPanel'
export { EmptyState } from './EmptyState'

export type {
  PageType,
  PageShellProps,
  StatusSummary,
  StatusSummaryVariant,
  KPISpec,
  PrimaryAction,
  SecondaryAction,
  ViewKind,
  ViewSwitcher,
  SearchFilter,
  QuickFilter,
  QuickFilterOption,
  SavedView,
  FiltersSpec,
  ContextPanelSpec,
  EmptyStateProps,
} from './types'
