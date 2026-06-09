import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  listWorkItems,
  type WorkItem, type WorkItemFilters,
} from '../lib/workitems'
import { listUsers, type User } from '../lib/users'
import { loadCustomers } from '../lib/billing'
import { resolveUserDisplay } from '../components/UserPicker'
import { EmptyState, ErrorBanner } from '../components/States'
import { InboxIcon, RowsIcon, SearchIcon } from '../components/icons'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, Pagination } from '../primitives'
import WorkItemsTable, { makeStatusChangeHandler } from '../components/WorkItemsTable'
import ErrorBoundary from '../components/ErrorBoundary'
import LoadingState from '../components/LoadingState'
import { PageShell } from '../page-shell'
import type { KPISpec } from '../page-shell'
import WorkItemDetailModal from './workitems/WorkItemDetailModal'
import CreateWorkItemModal from './workitems/CreateWorkItemModal'
import { KINDS } from './workitems/types'
import type { Tab } from './workitems/types'

export default function WorkItemsView({
  canConfigure = false,
  configVersion = 0,
  onConfigure,
}: {
  canConfigure?: boolean
  configVersion?: number
  onConfigure?: () => void
}) {
  const { token } = useAuth()
  const cfg = usePageConfig(token!, 'workitems', configVersion)
  const [items, setItems] = useState<WorkItem[] | null>(null)
  const cf = useCustomFields('workitems', cfg.customFields, (items ?? []).map((item) => item.id))
  const [allItems, setAllItems] = useState<WorkItem[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)

  const [tab, setTab] = useState<Tab>('active')
  const [kindFilter, setKindFilter] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  // Suppress unused prop warning — canConfigure/onConfigure reserved for future toolbar
  void canConfigure; void onConfigure

  async function loadUsers() {
    const res = await listUsers(token!)
    if (res.ok && Array.isArray(res.data)) setUsers(res.data)
  }

  async function loadData() {
    setError('')
    setUnavailable(false)
    setItems(null)

    const filters: WorkItemFilters = {}
    if (tab === 'mine') filters.mine = true
    if (kindFilter) filters.kind = kindFilter

    const res = await listWorkItems(token!, filters)
    if (res.status === 404) { setUnavailable(true); setItems([]); setAllItems([]); return }
    if (!res.ok) { setError('Failed to load work items'); setItems([]); setAllItems([]); return }
    let list = Array.isArray(res.data) ? res.data : []

    setAllItems(list)

    if (tab === 'active') {
      list = list.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED')
    }

    setItems(list)
    setCustomerNames(await loadCustomers(token!))
  }

  useEffect(() => { loadUsers() }, [token])
  useEffect(() => { loadData() }, [token, tab, kindFilter])
  useEffect(() => { setPage(1) }, [tab, kindFilter, query, sortKey, sortDir])

  const custName = (item: WorkItem) =>
    item.customer_id ? (customerNames[item.customer_id] ?? item.customer_id.slice(0, 8)) : '—'

  const activeCount = allItems.filter((i) => i.status !== 'DONE' && i.status !== 'CANCELLED').length
  const allCount = allItems.length
  const doneCount = allItems.filter((i) => i.status === 'DONE').length
  const blockedCount = allItems.filter((i) => i.status === 'BLOCKED').length
  const inProgressCount = allItems.filter((i) => i.status === 'IN_PROGRESS').length

  const list = items ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter((item) => {
      const fields = [
        item.title ?? '', item.id ?? '', item.kind ?? '',
        item.status ?? '', item.priority ?? '',
        custName(item),
        resolveUserDisplay(item.assigned_user_id, users) ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, query, customerNames, users])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (item: WorkItem): string | number => {
      switch (k) {
        case 'title': return item.title ?? ''
        case 'kind': return item.kind ?? ''
        case 'customer': return custName(item)
        case 'status': return item.status ?? ''
        case 'priority': return item.priority ?? ''
        case 'assignee': return resolveUserDisplay(item.assigned_user_id, users) ?? ''
        case 'due': return item.due_at ?? ''
        case 'scheduled': return item.scheduled_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, customerNames, users])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  const kpis: KPISpec[] = allItems.length > 0 ? [
    { label: 'TODO',        value: allItems.filter(i => i.status === 'TODO').length },
    { label: 'In Progress', value: inProgressCount, warning: inProgressCount > 0 },
    { label: 'Blocked',     value: blockedCount,     danger: blockedCount > 0 },
    { label: 'Done',        value: doneCount },
  ] : []

  if (unavailable) {
    return (
      <PageShell
        type="OPERATIONS"
        breadcrumb={['Tech & NOC', 'Work Items']}
        icon={<RowsIcon size={18} />}
        title="Work Items"
        subtitle="Field operations work queue"
      >
        <EmptyState
          icon={<InboxIcon size={40} />}
          title="Work Items aren't available yet"
          message="This service will appear here once the work items module is enabled."
        />
      </PageShell>
    )
  }

  return (
    <PageShell
      type="OPERATIONS"
      breadcrumb={['Tech & NOC', 'Work Items']}
      icon={<RowsIcon size={18} />}
      title="Work Items"
      subtitle="Field operations work queue"
      kpis={kpis.length > 0 ? kpis : undefined}
      primaryAction={{ label: 'New work item', onClick: () => setCreateOpen(true) }}
    >
      {/* Tabs */}
      <div className="tabs">
        {([
          ['active', 'Active', activeCount],
          ['all', 'All', allCount],
          ['mine', 'Mine', null],
        ] as [Tab, string, number | null][]).map(([t, label, count]) => (
          <button
            key={t}
            className={'tab' + (tab === t ? ' on' : '')}
            onClick={() => setTab(t)}
          >
            {label}
            {count !== null && <span className="tab-count">{count}</span>}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} onRetry={loadData} />}
      <ErrorBoundary onReset={loadData}>
        {items === null && !error && <LoadingState kind="rows" label="Loading work items…" />}
        {items && items.length === 0 && !error && (
          <EmptyState
            icon={<InboxIcon size={40} />}
            title="No work items"
            message="Create a work item or adjust your filters."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                New item
              </Button>
            }
          />
        )}

        {items && items.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: 'var(--gx-space-6) var(--gx-space-7)', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search work items"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 'var(--gx-text-13)' }}
                />
              </div>
              <select
                className="inp inp-sm"
                aria-label="Filter by kind"
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                style={{ marginLeft: 'var(--gx-space-4)' }}
              >
                <option value="">All kinds</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                ))}
              </select>
              <span className="spacer" />
            </div>

            <WorkItemsTable
              items={pageRows}
              columns={cfg.columns}
              users={users}
              customerNames={customerNames}
              sortKey={sortKey}
              sortDir={sortDir}
              onSortChange={toggleSort}
              onRowClick={(item) => setDetailId(item.id)}
              onStatusChange={makeStatusChangeHandler(token!, loadData)}
              cfHeaders={cf.headers()}
              cfCellsFor={(id) => cf.cells(id)}
              customFieldCount={cfg.customFields.length}
            />

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}
      </ErrorBoundary>

      {detailId && (
        <WorkItemDetailModal
          id={detailId}
          users={users}
          customerNames={customerNames}
          onClose={() => { setDetailId(null); loadData() }}
        />
      )}

      {createOpen && (
        <CreateWorkItemModal
          onClose={() => setCreateOpen(false)}
          onDone={() => { setCreateOpen(false); loadData() }}
        />
      )}
    </PageShell>
  )
}
