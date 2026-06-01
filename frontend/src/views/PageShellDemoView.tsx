// PageShellDemoView — visual smoke test for the new PageShell framework.
//
// SEVEN sub-demos, one per page type, behind a top tab strip. Click a tab,
// see how the shell composes the zones for that page type. This is FRAMEWORK
// validation — the data is intentionally placeholder/zero (no fake business
// data per Gev's zero-hardcoded-values rule) so we're proving layout, not
// content.
//
// NOT wired into App.tsx / nav-config — the orchestrator will route this
// after review. To wire later, add:
//
//   import PageShellDemoView from './views/PageShellDemoView'
//   { path: '/page-shell-demo', element: <PageShellDemoView /> }
//
// (or whatever the routing mechanism is at that time).
import { useState } from 'react'
import {
  UsersIcon,
  HomeIcon,
  CalendarIcon,
  MapIcon,
  ChartIcon,
  MessageIcon,
  GearIcon,
  LayersIcon,
} from '../components/icons'
import { PageShell, EmptyState } from '../page-shell'
import type { PageType, KPISpec, FiltersSpec } from '../page-shell'

/* ─── shared placeholder helpers ──────────────────────────────────────────
   Use zero-values + obvious "no data yet" copy so we never invent business
   data. Real data lands when a page migrates onto PageShell.
   ────────────────────────────────────────────────────────────────────── */

const ZERO_KPIS: KPISpec[] = [
  { label: 'Total', value: 0, subtitle: 'no data yet' },
  { label: 'Active', value: 0, subtitle: 'no data yet' },
  { label: 'Pending', value: 0, subtitle: 'no data yet' },
  { label: 'New this month', value: 0, subtitle: 'no data yet' },
]

function emptyBody(label: string) {
  return (
    <EmptyState
      title={`${label} workspace`}
      message="Real records will render here once a page migrates onto PageShell."
    />
  )
}

/* ─── sub-demo: WORKSPACE ─────────────────────────────────────────────── */

function WorkspaceDemo() {
  return (
    <PageShell
      type="workspace"
      breadcrumb={['Home']}
      icon={<HomeIcon size={18} />}
      title="Workspace"
      subtitle="Mixed dashboard / overview layout"
      statusSummary={{ label: 'Live', variant: 'success' }}
      kpis={ZERO_KPIS.slice(0, 3)}
      primaryAction={{ label: 'Customize', onClick: () => {} }}
      secondaryActions={[{ label: 'Refresh', onClick: () => {} }]}
    >
      {emptyBody('Workspace')}
    </PageShell>
  )
}

/* ─── sub-demo: REGISTRY ──────────────────────────────────────────────── */

function RegistryDemo() {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [view, setView] = useState<'table' | 'board' | 'calendar' | 'map'>('table')

  const filters: FiltersSpec = {
    search: { value: q, onChange: setQ, placeholder: 'Search records…' },
    quick: [
      {
        label: 'Status',
        value: status,
        options: [
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Suspended', value: 'suspended' },
        ],
        onChange: setStatus,
      },
    ],
    savedViews: [
      { id: 'sv-default', name: 'All records', isDefault: true },
      { id: 'sv-active', name: 'Active only' },
    ],
  }

  return (
    <PageShell
      type="registry"
      breadcrumb={['CRM', 'Records']}
      icon={<UsersIcon size={18} />}
      title="Registry"
      subtitle="List-centric records registry"
      statusSummary="0 records"
      kpis={ZERO_KPIS}
      views={{
        current: view,
        options: ['table', 'board', 'calendar', 'map'],
        onChange: (next) => setView(next as typeof view),
      }}
      primaryAction={{ label: 'New record', onClick: () => {} }}
      secondaryActions={[
        { label: 'Import', onClick: () => {} },
        { label: 'Export', onClick: () => {} },
      ]}
      filters={filters}
    >
      {emptyBody('Registry')}
    </PageShell>
  )
}

/* ─── sub-demo: PIPELINE ──────────────────────────────────────────────── */

function PipelineDemo() {
  const [view, setView] = useState<'board' | 'table'>('board')
  return (
    <PageShell
      type="pipeline"
      breadcrumb={['CRM', 'Pipeline']}
      icon={<LayersIcon size={18} />}
      title="Pipeline"
      subtitle="Kanban / stage-progression layout"
      kpis={ZERO_KPIS.slice(0, 4)}
      views={{
        current: view,
        options: ['board', 'table'],
        onChange: (next) => setView(next as typeof view),
      }}
      primaryAction={{ label: 'New lead', onClick: () => {} }}
    >
      {emptyBody('Pipeline')}
    </PageShell>
  )
}

/* ─── sub-demo: OPERATIONS ────────────────────────────────────────────── */

function OperationsDemo() {
  return (
    <PageShell
      type="operations"
      breadcrumb={['NOC', 'Dispatch']}
      icon={<MapIcon size={18} />}
      title="Operations"
      subtitle="Map · queue · status grid"
      statusSummary={{ label: 'All systems nominal', variant: 'success' }}
      kpis={ZERO_KPIS.slice(0, 5).concat({ label: 'On call', value: 0, subtitle: 'no data yet' })}
      primaryAction={{ label: 'Create incident', onClick: () => {} }}
      contextPanel={{
        title: 'Incident detail',
        content: (
          <p style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>
            Select an incident to see its detail here.
          </p>
        ),
      }}
    >
      <div style={{ background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 8, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)' }}>
        Map / queue panel
      </div>
      <div style={{ background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 8, minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gx-text-3)' }}>
        Status panel
      </div>
    </PageShell>
  )
}

/* ─── sub-demo: ANALYTICS ─────────────────────────────────────────────── */

function AnalyticsDemo() {
  return (
    <PageShell
      type="analytics"
      breadcrumb={['Reports']}
      icon={<ChartIcon size={18} />}
      title="Analytics"
      subtitle="Chart and KPI grid layout"
      kpis={ZERO_KPIS}
      primaryAction={{ label: 'New report', onClick: () => {} }}
      secondaryActions={[{ label: 'Export PDF', onClick: () => {} }]}
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--gx-surface)',
            border: '1px solid var(--gx-border)',
            borderRadius: 8,
            minHeight: 160,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--gx-text-3)',
            fontSize: 12,
          }}
        >
          Chart card #{i + 1} (no data yet)
        </div>
      ))}
    </PageShell>
  )
}

/* ─── sub-demo: COMMUNICATION ─────────────────────────────────────────── */

function CommunicationDemo() {
  return (
    <PageShell
      type="communication"
      breadcrumb={['Inbox']}
      icon={<MessageIcon size={18} />}
      title="Communication"
      subtitle="3-pane list / thread / context layout"
      kpis={ZERO_KPIS.slice(0, 3)}
      primaryAction={{ label: 'Compose', onClick: () => {} }}
    >
      <div style={{ borderRight: '1px solid var(--gx-border)', padding: 16, color: 'var(--gx-text-3)', fontSize: 12 }}>
        Thread list (no data yet)
      </div>
      <div style={{ borderRight: '1px solid var(--gx-border)', padding: 16, color: 'var(--gx-text-3)', fontSize: 12 }}>
        Selected thread (none)
      </div>
      <div style={{ padding: 16, color: 'var(--gx-text-3)', fontSize: 12 }}>
        Context (no record selected)
      </div>
    </PageShell>
  )
}

/* ─── sub-demo: CONFIGURATION ─────────────────────────────────────────── */

function ConfigurationDemo() {
  return (
    <PageShell
      type="configuration"
      breadcrumb={['Settings', 'General']}
      icon={<GearIcon size={18} />}
      title="Configuration"
      subtitle="Flexible settings / admin layout"
      primaryAction={{ label: 'Save changes', onClick: () => {} }}
      secondaryActions={[{ label: 'Discard', onClick: () => {} }]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>
        <div style={{ background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--gx-font-display)', fontSize: 14, color: 'var(--gx-text-1)' }}>Section A</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--gx-text-3)' }}>Settings cards land here when a page migrates onto PageShell.</p>
        </div>
        <div style={{ background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--gx-font-display)', fontSize: 14, color: 'var(--gx-text-1)' }}>Section B</h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--gx-text-3)' }}>Settings cards land here when a page migrates onto PageShell.</p>
        </div>
      </div>
    </PageShell>
  )
}

/* ─── sub-demo: PLACEHOLDER ───────────────────────────────────────────── */

function PlaceholderDemo() {
  return (
    <PageShell
      type="placeholder"
      breadcrumb={['Roadmap']}
      icon={<CalendarIcon size={18} />}
      title="Placeholder"
      subtitle="A page that hasn't shipped yet"
      // Intentionally pass kpis + actions — PageShell hides them under
      // 'placeholder' to prove the zone-visibility rules.
      kpis={ZERO_KPIS}
      primaryAction={{ label: 'Hidden', onClick: () => {} }}
    />
  )
}

/* ─── top-level demo with tab strip ───────────────────────────────────── */

const TYPES: PageType[] = [
  'workspace',
  'registry',
  'pipeline',
  'operations',
  'analytics',
  'communication',
  'configuration',
  'placeholder',
]

const DEMOS: Record<PageType, () => JSX.Element> = {
  workspace: WorkspaceDemo,
  registry: RegistryDemo,
  pipeline: PipelineDemo,
  operations: OperationsDemo,
  analytics: AnalyticsDemo,
  communication: CommunicationDemo,
  configuration: ConfigurationDemo,
  placeholder: PlaceholderDemo,
}

export default function PageShellDemoView() {
  const [active, setActive] = useState<PageType>('registry')
  const Demo = DEMOS[active]
  return (
    <div className="ps-demo-root">
      <div className="ps-demo-tabs" role="tablist" aria-label="Page type">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            className="ps-demo-tab"
            aria-pressed={active === t}
            onClick={() => setActive(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="ps-demo-stage">
        <Demo />
      </div>
    </div>
  )
}
