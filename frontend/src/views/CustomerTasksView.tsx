// CustomerTasksView — CRM → Customer Tasks page.
//
// SCOPE: tasks whose parent_entity_type=customer — i.e. the subset of the Task
// Standard (file 05) tagged to a customer. The Task API (backend/app/routers/
// tasks.py) does NOT expose a `has_customer` filter, but it DOES accept
// parent_entity_type + parent_entity_id as native query params. Since "customer
// tasks" is precisely "tasks linked to a customer parent", we use the native
// filter `parent_entity_type=customer` rather than client-side filtering.
//
// REAL DATA ONLY. If the fetch yields 0, render EmptyState. If it fails, render
// ErrorBanner. Never fabricate rows.
//
// Customer names are resolved via the CRM Customers API (loadCustomers) — the
// same hide-if-missing pattern MyTasksView uses. Failures are non-blocking.

import { useEffect, useMemo, useState } from 'react'
import { bget, loadCustomers } from '../lib/billing'
import { listUsers, type User } from '../lib/users'
import { EmptyState, SkeletonRows, PermissionDenied, ErrorBanner } from '../components/States'
import { CheckIcon, InboxIcon, SearchIcon } from '../components/icons'
import { PageShell, Card, Stack, type FiltersSpec, type KPISpec } from '../page-shell'
import { StatusPill } from '../primitives'

// ── Types (mirror Task router serialize shape; only fields we render) ─────────

type CustomerTask = {
  id: string
  referenceNumber?: string | null
  title: string
  taskType?: string | null
  status?: string | null
  priority?: string | null
  parentEntityType?: string | null
  parentEntityId?: string | null
  assigneeType?: string | null
  assigneeId?: string | null
  dueAt?: string | null
  slaStatus?: string | null
  createdAt?: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; items: CustomerTask[] }
  | { kind: 'forbidden' }
  | { kind: 'error'; message: string }

const STATUS_FILTERS = ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'COMPLETED', 'CANCELLED'] as const
const TERMINAL = new Set(['COMPLETED', 'CANCELLED'])

// ── Pill / label helpers ──────────────────────────────────────────────────────

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'

function statusPill(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'COMPLETED') return 'active'
  if (v === 'IN_PROGRESS') return 'degraded'
  if (v === 'BLOCKED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'info'
}

function statusLabel(s: string | null | undefined): string {
  const v = (s ?? '').toUpperCase()
  if (v === 'OPEN') return 'Open'
  if (v === 'IN_PROGRESS') return 'In Progress'
  if (v === 'BLOCKED') return 'Blocked'
  if (v === 'WAITING') return 'Waiting'
  if (v === 'COMPLETED') return 'Completed'
  if (v === 'CANCELLED') return 'Cancelled'
  return s ?? '—'
}

function priorityPill(priority: string | null | undefined) {
  const p = (priority ?? '').toUpperCase()
  if (!p) return <span className="muted">—</span>
  const variant: PillVariant =
    p === 'URGENT' ? 'critical' :
    p === 'HIGH' ? 'degraded' :
    p === 'LOW' ? 'neutral' : 'info'
  const label = p.charAt(0) + p.slice(1).toLowerCase()
  return <StatusPill variant={variant} label={label} size="sm" />
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// ── Main view ────────────────────────────────────────────────────────────────

export default function CustomerTasksView({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<User[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    bget<CustomerTask[]>(token, '/api/tasks?parent_entity_type=customer')
      .then((r) => {
        if (cancelled) return
        if (r.status === 403) { setState({ kind: 'forbidden' }); return }
        if (r.status === 404) { setState({ kind: 'ok', items: [] }); return }
        if (!r.ok || !Array.isArray(r.data)) {
          console.error('[customer-tasks] listTasks failed', r.status)
          setState({ kind: 'error', message: 'Failed to load customer tasks' })
          return
        }
        // Defensive client filter: keep only rows with a parent customer link.
        // Backend already filters server-side; this guards against drift.
        const items = r.data.filter((t) => t.parentEntityId != null)
        setState({ kind: 'ok', items })
      })
    return () => { cancelled = true }
  }, [token])

  // Auxiliary lookups — failures hide-if-missing, never block the table.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const map = await loadCustomers(token)
        if (!cancelled) setCustomerNames(map)
      } catch { /* hide-if-missing */ }
    })()
    ;(async () => {
      const res = await listUsers(token)
      if (!cancelled && res.ok && Array.isArray(res.data)) setUsers(res.data)
    })()
    return () => { cancelled = true }
  }, [token])

  const items = state.kind === 'ok' ? state.items : []

  const userNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const u of users) m[u.id] = u.name || u.email || u.id.slice(0, 8)
    return m
  }, [users])

  // ── KPIs (real fetched counts only). ───────────────────────────────────────
  const openCount = items.filter((t) => t.status && !TERMINAL.has(t.status.toUpperCase())).length
  const overdueCount = items.filter((t) => {
    if (!t.dueAt || (t.status && TERMINAL.has(t.status.toUpperCase()))) return false
    const d = new Date(t.dueAt)
    return !isNaN(d.getTime()) && d.getTime() < Date.now()
  }).length
  const completedCount = items.filter((t) => (t.status ?? '').toUpperCase() === 'COMPLETED').length

  const kpis: KPISpec[] | undefined = state.kind === 'ok'
    ? [
        { label: 'Total', value: items.length },
        { label: 'Open', value: openCount },
        { label: 'Overdue', value: overdueCount, danger: overdueCount > 0 },
        { label: 'Completed', value: completedCount },
      ]
    : undefined

  // ── Filters spec (search + status). ────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((t) => {
      if (statusFilter && (t.status ?? '').toUpperCase() !== statusFilter) return false
      if (q) {
        const customer = t.parentEntityId ? (customerNames[t.parentEntityId] ?? '') : ''
        const hay = [t.title ?? '', t.referenceNumber ?? '', customer].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, query, statusFilter, customerNames])

  const filters: FiltersSpec = {
    search: {
      value: query,
      onChange: setQuery,
      placeholder: 'Search customer tasks',
    },
    quick: [
      {
        label: 'Status',
        value: statusFilter,
        options: [
          { label: 'All statuses', value: '' },
          ...STATUS_FILTERS.map((s) => ({ label: statusLabel(s), value: s })),
        ],
        onChange: setStatusFilter,
      },
    ],
  }

  const subtitle = state.kind === 'ok'
    ? (overdueCount > 0 ? `${openCount} open · ${overdueCount} overdue` : `${openCount} open`)
    : 'Tasks linked to customers'

  // ── Render branches ────────────────────────────────────────────────────────

  if (state.kind === 'forbidden') {
    return (
      <PageShell
        type="REGISTRY"
        breadcrumb={['CRM', 'Customer Tasks']}
        icon={<CheckIcon size={18} />}
        title="Customer Tasks"
        subtitle="Tasks linked to customers"
      >
        <PermissionDenied />
      </PageShell>
    )
  }

  const body = state.kind === 'loading' ? (
    <SkeletonRows rows={6} />
  ) : state.kind === 'error' ? (
    <ErrorBanner message={state.message} />
  ) : filtered.length === 0 ? (
    <EmptyState
      icon={query || statusFilter ? <SearchIcon size={40} /> : <InboxIcon size={40} />}
      title={items.length === 0 ? 'No customer tasks yet' : 'No tasks match your filters'}
      message={items.length === 0
        ? 'Tasks linked to a customer (parent_entity_type=customer) will appear here.'
        : 'Try clearing search or status filter.'}
    />
  ) : (
    <Card pad="sm" className="ct-table-card">
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Customer</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              <th scope="col">Due</th>
              <th scope="col">Assignee</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const customerLabel = t.parentEntityId
                ? (customerNames[t.parentEntityId] ?? t.parentEntityId.slice(0, 8))
                : '—'
              const assigneeLabel = t.assigneeId
                ? (t.assigneeType === 'EMPLOYEE'
                    ? (userNameById[t.assigneeId] ?? t.assigneeId.slice(0, 8))
                    : `${(t.assigneeType ?? '').toLowerCase()}: ${t.assigneeId.slice(0, 8)}`)
                : '—'
              return (
                <tr key={t.id}>
                  <td>
                    <Stack gap="xs">
                      <span>{t.title || <span className="mono">{t.id.slice(0, 8)}</span>}</span>
                      {t.referenceNumber && (
                        <span className="muted mono" style={{ fontSize: 11 }}>{t.referenceNumber}</span>
                      )}
                    </Stack>
                  </td>
                  <td>{customerLabel}</td>
                  <td>
                    {t.status
                      ? <StatusPill variant={statusPill(t.status)} label={statusLabel(t.status)} size="sm" />
                      : <span className="muted">—</span>}
                  </td>
                  <td>{priorityPill(t.priority)}</td>
                  <td><span className="mono">{fmtDate(t.dueAt)}</span></td>
                  <td>{assigneeLabel}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['CRM', 'Customer Tasks']}
      icon={<CheckIcon size={18} />}
      title="Customer Tasks"
      subtitle={subtitle}
      kpis={kpis}
      filters={filters}
    >
      {body}
    </PageShell>
  )
}
