// PageShell — public API.
//
// Pages import ONLY from this file:
//
//   import { PageShell, EmptyState } from '@/page-shell'
//   import type { PageType, KPISpec, FiltersSpec } from '@/page-shell'
//
// EN: Individual zone components (PageHeader, KPIBar, GxCommandBar, FilterBar,
//     ContextPanel) are also exported for advanced cases where a page needs to
//     recompose a zone outside the orchestrator. For 95% of pages the top-level
//     `PageShell` composition is enough.
// HY: Zone components-ə naeєv export en advanced case-eri hamar, erb page-ə
//     zone-ə verjaskazmum é orchestrator-ic durs: 95%-i hamar PageShell-ə bavaran é:
export { PageShell } from './PageShell'
export { PageHeader } from './PageHeader'
export { KPIBar } from './KPIBar'
export { GxCommandBar } from '../components/CommandBar/gx-CommandBar'
export { FilterBar } from './FilterBar'
export { ContextPanel } from './ContextPanel'
export { EmptyState } from './EmptyState'
export { SlideOutPanel } from './SlideOutPanel'
export type { SlideOutPanelProps } from './SlideOutPanel'

// Layout primitives — Stack / Inline / Grid / Card / SectionHeading.
// Re-exported so pages can: `import { Stack, Card } from '@/page-shell'`.
export * from './primitives'

export type {
  PageType,
  PageShellProps,
  StatusSummary,
  StatusSummaryVariant,
  KPISpec,
  PrimaryAction,
  SecondaryAction,
  BulkAction,
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
