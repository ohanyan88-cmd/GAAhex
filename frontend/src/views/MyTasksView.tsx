// MyTasksView — the Workspace → My Tasks page.
//
// SCOPE: only the CURRENT user's work items. Always calls listWorkItems(token,
// { mine: true }) so the backend's per-user filter (workitems.py:118) is the
// source of truth. The view never falls back to mock/illustrative data — if the
// fetch yields nothing or fails, the page renders the empty/error state.
//
// SHELL (P1): ViewHead + toolbar (search, Table/Board toggle, New) + empty
// board/table placeholders. Data + actions wire in P2/P3.

import { useState } from 'react'
import ViewHead from '../components/ViewHead'
import WorkItemsTable from '../components/WorkItemsTable'
import WorkItemsBoard from '../components/WorkItemsBoard'
import { EmptyState } from '../components/States'
import { CheckIcon, GearIcon, InboxIcon, SearchIcon } from '../components/icons'
import { Plus, Rows3, Columns3 } from 'lucide-react'

// Default column set for My Tasks. SLA is intentionally absent — WorkItem has
// no `sla_due_at`. We surface `due_at` as the closest real proxy.
const MY_TASKS_COLUMNS = [
  { key: 'title',     label: 'Title',    visible: true },
  { key: 'kind',      label: 'Kind',     visible: true },
  { key: 'status',    label: 'Status',   visible: true },
  { key: 'priority',  label: 'Priority', visible: true },
  { key: 'due',       label: 'Due',      visible: true },
  { key: 'scheduled', label: 'Scheduled', visible: true },
]

type ViewMode = 'table' | 'board'

export default function MyTasksView({
  token,
  canConfigure = false,
  onConfigure,
}: {
  token: string
  canConfigure?: boolean
  onConfigure?: () => void
}) {
  void token // P2 will use this for listWorkItems({ mine: true })

  const [mode, setMode] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')

  // Subtitle is computed from real fetched counts in P2. P1 shell renders the
  // page with NO subtitle (no source yet → render nothing per doctrine).
  const subtitle: string | undefined = undefined

  // Placeholder no-op handlers — wired in P2 (fetch) and P3 (mutate).
  const noopSort = () => {}
  const noopRowClick = () => {}
  const noopStatus = async () => {}

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs">
          <span>Workspace</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>My Tasks</span>
        </div>

        <ViewHead
          icon={<CheckIcon size={18} />}
          title="My Tasks"
          sub={subtitle}
          actions={
            <>
              <div className="seg" role="tablist" aria-label="View mode">
                <button
                  role="tab"
                  aria-selected={mode === 'table'}
                  className={mode === 'table' ? 'on' : ''}
                  onClick={() => setMode('table')}
                >
                  <Rows3 size={13} /> Table
                </button>
                <button
                  role="tab"
                  aria-selected={mode === 'board'}
                  className={mode === 'board' ? 'on' : ''}
                  onClick={() => setMode('board')}
                >
                  <Columns3 size={13} /> Board
                </button>
              </div>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} /> Configure page
                </button>
              )}
              <button className="btn btn-primary btn-sm">
                <Plus size={14} /> New
              </button>
            </>
          }
        />

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
            <div className="tb-search" style={{ width: 320 }}>
              <SearchIcon size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search my tasks"
                style={{
                  flex: 1, background: 'none', border: 'none', outline: 'none',
                  color: 'var(--gx-text-1)', fontSize: 13,
                }}
              />
            </div>
            <span className="spacer" />
          </div>

          {/* P1 shell renders the empty state. P2 swaps in the live list. */}
          {mode === 'table' ? (
            <WorkItemsTable
              items={[]}
              columns={MY_TASKS_COLUMNS}
              users={[]}
              customerNames={{}}
              sortKey={null}
              sortDir={1}
              onSortChange={noopSort}
              onRowClick={noopRowClick}
              onStatusChange={noopStatus}
            />
          ) : (
            <div style={{ padding: 14 }}>
              <WorkItemsBoard
                items={[]}
                users={[]}
                onRowClick={noopRowClick}
                onStatusChange={noopStatus}
              />
            </div>
          )}

          <div style={{ padding: 14 }}>
            <EmptyState
              icon={<InboxIcon size={40} />}
              title="No tasks yet"
              message="Tasks assigned to you will appear here."
            />
          </div>
        </div>
      </div>
    </div>
  )
}
