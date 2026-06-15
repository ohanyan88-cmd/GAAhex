// PageShell — the universal page wrapper. Every GAAhex page consumes this
// component going forward; the migration of existing views happens in a
// later phase. This file is the FRAMEWORK orchestrator: it accepts the
// composition spec, decides which zones to render based on the page type +
// supplied props, and lays them out via a CSS grid.
//
// Zone visibility resolution:
//
//   ┌────────────────┬──────────────────────────────────────────────────────┐
//   │ Zone           │ Rendered when                                         │
//   ├────────────────┼──────────────────────────────────────────────────────┤
//   │ A · Header     │ Always.                                               │
//   │ B · KPIBar     │ `kpis` non-empty AND type ≠ 'PLACEHOLDER'.            │
//   │ C · CommandBar │ Any of {views, primaryAction, secondaryActions} AND   │
//   │                │ type ≠ 'PLACEHOLDER'.                                 │
//   │ D · FilterBar  │ `filters` provided AND has content.                   │
//   │ E · Workspace  │ Always — wraps `children`. If type === 'PLACEHOLDER'  │
//   │                │ and no children, renders a default EmptyState.        │
//   │ F · ContextPnl │ `contextPanel` provided.                              │
//   └────────────────┴──────────────────────────────────────────────────────┘
import './styles.css'
import { isValidElement, type ReactNode } from 'react'
import { PageHeader } from './PageHeader'
import { KPIBar } from './KPIBar'
import { GxCommandBar } from '../components/CommandBar/gx-CommandBar'
import { FilterBar } from './FilterBar'
import { ContextPanel } from './ContextPanel'
import { EmptyState } from './EmptyState'
import { HexScatter } from './HexScatter'
import type { PageShellProps, ContextPanelSpec } from './types'

function normalizeContextPanel(value: PageShellProps['contextPanel']): ContextPanelSpec | null {
  if (value == null || value === false) return null
  // If it's a ReactNode (element / string / number / array), wrap it.
  if (
    isValidElement(value) ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    Array.isArray(value)
  ) {
    return { content: value as ReactNode }
  }
  // Otherwise it's a ContextPanelSpec object.
  return value as ContextPanelSpec
}

export function PageShell({
  type,
  breadcrumb,
  icon,
  title,
  subtitle,
  description,
  statusSummary,
  pageTabs,
  kpis,
  views,
  primaryAction,
  secondaryActions,
  filters,
  children,
  workspaceClassName,
  contextPanel,
  className,
}: PageShellProps) {
  const isPlaceholder = type === 'PLACEHOLDER'
  // CSS hooks remain in lowercase (unchanged contract); the enum value is the
  // canonical UPPER_SNAKE per standard 14. We translate here at the boundary.
  const cssPageType = type.toLowerCase()

  // Zone visibility resolution (see header doc-comment above).
  const showKPIs = !isPlaceholder && !!kpis && kpis.length > 0
  // EN: Zone C (CommandBar) shows when views OR any action is present, and not a placeholder.
  //     Actions moved out of PageHeader (Zone A) into CommandBar (Zone C) — Ph1d.
  // HY: Zone C (CommandBar) erệum é, erb views kam actions kan, ev PLACEHOLDER chi:
  //     Actions-ə PageHeader-ic (Zone A) teɡhafoxvec CommandBar (Zone C) — Ph1d:
  const showActions =
    !isPlaceholder &&
    (!!views || !!primaryAction || (!!secondaryActions && secondaryActions.length > 0))
  // search now lives in the header (Zone A); the FilterBar (Zone D) is for quick /
  // advanced / saved-view filters only.
  const showFilters =
    !!filters &&
    ((filters.quick && filters.quick.length > 0) ||
      !!filters.advanced ||
      (filters.savedViews && filters.savedViews.length > 0))
  const ctxSpec = normalizeContextPanel(contextPanel)
  const showContext = !!ctxSpec

  // Default placeholder body — coming-soon EmptyState when caller passes none.
  const body =
    isPlaceholder && (children == null || children === false) ? (
      <EmptyState
        title={`${title} — coming soon`}
        message={subtitle ?? 'This page is part of the platform roadmap.'}
        variant="coming-soon"
      />
    ) : (
      children
    )

  const wrapperCls = ['ps-workspace', workspaceClassName].filter(Boolean).join(' ')
  const rootCls = ['ps', className].filter(Boolean).join(' ')

  return (
    <div
      className={rootCls}
      data-page-type={cssPageType}
      data-context={showContext ? 'shown' : 'hidden'}
    >
      <HexScatter />
      <PageHeader
        breadcrumb={breadcrumb}
        icon={icon}
        title={title}
        subtitle={subtitle}
        description={description}
        statusSummary={statusSummary}
        pageTabs={pageTabs}
        search={filters?.search}
      />
      {showKPIs && <KPIBar kpis={kpis!} />}
      {showActions && (
        <GxCommandBar views={views} primary={primaryAction} secondary={secondaryActions} />
      )}
      {showFilters && <FilterBar filters={filters!} />}
      <div className="ps-body">
        <div className={wrapperCls} data-page-type={cssPageType}>
          {body}
        </div>
      </div>
      {showContext && <ContextPanel spec={ctxSpec!} />}
    </div>
  )
}
