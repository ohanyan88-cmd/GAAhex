// MyTasksView — the Workspace → My Tasks page.
//
// SCOPE: only the CURRENT user's work items. Always calls listWorkItems(token,
// { mine: true }) so the backend's per-user filter (workitems.py:118) is the
// source of truth. The view never falls back to mock/illustrative data — if the
// fetch yields nothing or fails, the page renders the empty / 403 / nothing state.
//
// DOCTRINE: empty source → render nothing. A real fetched 0 → show "0 open".
// Errors hide the table/board entirely and log to console (no banner).

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../lib/i18n'
import WorkItemsTable, { makeStatusChangeHandler } from '../components/WorkItemsTable'
import WorkItemsBoard from '../components/WorkItemsBoard'
import { EmptyState, PermissionDenied, SkeletonRows } from '../components/States'
import { CheckIcon, GearIcon, InboxIcon } from '../components/icons'
import { Plus } from 'lucide-react'
import {
  listWorkItems,
  type WorkItem, type WorkItemPriority, type WorkItemStatus,
} from '../lib/workitems'
import { listUsers, type User } from '../lib/users'
import { loadCustomers } from '../lib/billing'
import { WORKITEM_OPEN, WORKITEM_ALL } from '../lib/status-constants'
import { DetailTab, DetailTabList } from '../primitives'
import { PageShell, type KPISpec, type FiltersSpec, type PrimaryAction, type SecondaryAction, type ViewSwitcher } from '../page-shell'
import MyTaskDetailModal from './mytasks/MyTaskDetailModal'
import MyTaskCreateModal from './mytasks/MyTaskCreateModal'
import { statusLabel } from './mytasks/helpers'
import { MY_TASKS_COLUMNS, PRIORITIES } from './mytasks/types'
import type { ViewMode, LoadState } from './mytasks/types'

export default function MyTasksView({
  canConfigure = false,
  onConfigure,
  onNavigate,
}: {
  canConfigure?: boolean
  onConfigure?: () => void
  onNavigate?: (target: string) => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [users, setUsers] = useState<User[]>([])
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<WorkItemPriority | ''>('')
  const [statusFilter, setStatusFilter] = useState<WorkItemStatus | ''>('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  async function loadData() {
    setState({ kind: 'loading' })
    const res = await listWorkItems(token!, { mine: true })
    if (res.status === 403) { setState({ kind: 'forbidden' }); return }
    if (!res.ok) {
      console.error('[mytasks] listWorkItems failed', res.status)
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ok', items: Array.isArray(res.data) ? res.data : [] })
  }

  useEffect(() => { loadData() }, [token])

  useEffect(() => {
    (async () => {
      const res = await listUsers(token!)
      if (res.ok && Array.isArray(res.data)) setUsers(res.data)
    })()
    ;(async () => {
      try { setCustomerNames(await loadCustomers(token!)) } catch { /* hide-if-missing */ }
    })()
  }, [token])

  // ── Derived data ───────────────────────────────────────────────────────────

  const items = state.kind === 'ok' ? state.items : []

  const openCount = items.filter((i) => i.status && (WORKITEM_OPEN as readonly string[]).includes(i.status)).length
  const overdueCount = items.filter((i) => {
    if (!i.due_at) return false
    if (i.status && (i.status === 'DONE' || i.status === 'CANCELLED')) return false
    const due = new Date(i.due_at)
    return !isNaN(due.getTime()) && due.getTime() < Date.now()
  }).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((it) => {
      if (priorityFilter && it.priority !== priorityFilter) return false
      if (statusFilter && it.status !== statusFilter) return false
      if (q) {
        const hay = [it.title ?? '', it.id ?? '', it.kind ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, query, priorityFilter, statusFilter])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const get = (it: WorkItem): string => {
      switch (sortKey) {
        case 'title': return it.title ?? ''
        case 'kind': return it.kind ?? ''
        case 'status': return it.status ?? ''
        case 'priority': return it.priority ?? ''
        case 'due': return it.due_at ?? ''
        case 'scheduled': return it.scheduled_at ?? ''
        case 'assignee': return it.assigned_user_id ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => get(a).localeCompare(get(b)) * sortDir)
  }, [filtered, sortKey, sortDir])

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  const handleStatusChange = makeStatusChangeHandler(token!, loadData)

  // ── PageShell specs ────────────────────────────────────────────────────────

  const subtitle: string | undefined = state.kind === 'ok'
    ? (overdueCount > 0 ? `${openCount} open · ${overdueCount} overdue` : `${openCount} open`)
    : 'Personal execution bench'

  const kpiSpec: KPISpec[] | undefined = state.kind === 'ok'
    ? (() => {
        const pendingCount = items.filter((i) => i.status === 'TODO').length
        const doneCount = items.filter((i) => i.status === 'DONE').length
        return [
          { label: t('mytasks.kpi.open', 'Open'),    value: openCount },
          { label: t('mytasks.kpi.pending', 'Pending'), value: pendingCount },
          { label: t('mytasks.kpi.done', 'Done'),    value: doneCount },
          { label: t('mytasks.kpi.overdue', 'Overdue'), value: overdueCount, danger: overdueCount > 0 },
        ]
      })()
    : undefined

  const filtersSpec: FiltersSpec = {
    search: { value: query, onChange: setQuery, placeholder: t('mytasks.searchPlaceholder', 'Search my tasks') },
    quick: [
      {
        label: t('common.status', 'Status'),
        value: statusFilter,
        options: [
          { label: t('mytasks.filter.allStatuses', 'All statuses'), value: '' },
          ...WORKITEM_ALL.map((s) => ({ label: statusLabel(s), value: s })),
        ],
        onChange: (next) => setStatusFilter(next as WorkItemStatus | ''),
      },
      {
        label: t('mytasks.filter.priorityLabel', 'Priority'),
        value: priorityFilter,
        options: [
          { label: t('mytasks.filter.allPriorities', 'All priorities'), value: '' },
          ...PRIORITIES.map((p) => ({ label: p.charAt(0) + p.slice(1).toLowerCase(), value: p })),
        ],
        onChange: (next) => setPriorityFilter(next as WorkItemPriority | ''),
      },
    ],
  }

  const primaryAction: PrimaryAction = {
    label: t('mytasks.newTask', '+ New Task'),
    icon: <Plus size={14} />,
    onClick: () => setCreateOpen(true),
  }
  const secondaryActions: SecondaryAction[] | undefined =
    canConfigure && onConfigure
      ? [{ label: t('common.configure', 'Configure'), icon: <GearIcon size={13} />, onClick: onConfigure }]
      : undefined

  const viewSwitcher: ViewSwitcher = {
    current: mode,
    options: ['table', 'board'],
    onChange: (next) => setMode(next as ViewMode),
  }

  // ── Render branches ────────────────────────────────────────────────────────

  if (state.kind === 'forbidden') {
    return (
      <PageShell
        type="WORKSPACE"
        breadcrumb={[t('nav.workspace', 'Workspace'), t('mytasks.pageTitle', 'My Day')]}
        icon={<CheckIcon size={18} />}
        title={t('mytasks.pageTitle', 'My Day')}
        subtitle={t('mytasks.pageSubtitle', 'Personal execution bench')}
      >
        <PermissionDenied />
      </PageShell>
    )
  }

  const body = state.kind === 'error' ? null : state.kind === 'loading' ? (
    <SkeletonRows rows={6} />
  ) : sorted.length === 0 ? (
    <EmptyState
      icon={<InboxIcon size={40} />}
      title={items.length === 0 ? t('mytasks.emptyTitle', 'No tasks assigned to you') : t('mytasks.noMatchTitle', 'No tasks match your filters')}
      message={items.length === 0
        ? t('mytasks.emptyMessage', 'Tasks assigned to you will appear here.')
        : t('mytasks.noMatchMessage', 'Try clearing search or filters.')}
    />
  ) : mode === 'table' ? (
    <WorkItemsTable
      items={sorted}
      columns={MY_TASKS_COLUMNS}
      users={users}
      customerNames={customerNames}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={toggleSort}
      onRowClick={(item) => setDetailId(item.id)}
      onStatusChange={handleStatusChange}
    />
  ) : (
    <WorkItemsBoard
      items={sorted}
      users={users}
      onRowClick={(item) => setDetailId(item.id)}
      onStatusChange={handleStatusChange}
    />
  )

  return (
    <>
      <PageShell
        type="WORKSPACE"
        breadcrumb={[t('nav.workspace', 'Workspace'), t('mytasks.pageTitle', 'My Day')]}
        icon={<CheckIcon size={18} />}
        title={t('mytasks.pageTitle', 'My Day')}
        subtitle={subtitle}
        kpis={kpiSpec}
        pageTabs={
          <DetailTabList ariaLabel="My Day sections">
            <DetailTab active={false} onSelect={() => onNavigate?.('home')}>{t('tab.overview', 'Overview')}</DetailTab>
            <DetailTab active onSelect={() => {}}>{t('mytasks.tab.work', 'Work')}</DetailTab>
          </DetailTabList>
        }
        views={viewSwitcher}
        primaryAction={primaryAction}
        secondaryActions={secondaryActions}
        filters={filtersSpec}
      >
        {body}
      </PageShell>

      {detailId && (
        <MyTaskDetailModal
          id={detailId}
          users={users}
          customerNames={customerNames}
          onClose={() => { setDetailId(null); loadData() }}
        />
      )}

      {createOpen && (
        <MyTaskCreateModal
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); loadData() }}
        />
      )}
    </>
  )
}
