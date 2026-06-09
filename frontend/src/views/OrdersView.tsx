// OrdersView — provisioning orders list (Wave A §3).
//
// Doctrine: real data only. Every value comes from /api/orders; every button maps to a real backend
// route on backend/app/routers/orders.py. Buttons that don't apply to the row's status are hidden
// (not greyed out), so we never show an inert control.
//
// Lifecycle: DRAFT → SUBMITTED → PROVISIONING → COMPLETED, or → CANCELLED at any pre-COMPLETED step.
//   POST /api/orders/{id}/submit   — DRAFT → SUBMITTED
//   POST /api/orders/{id}/advance  — SUBMITTED→PROVISIONING→COMPLETED (one step per call)
//   POST /api/orders/{id}/cancel   — anything except COMPLETED/CANCELLED → CANCELLED
//
// Permissions: gated via fetchCapabilities() — `order.view` to see the page at all, `order.create`
// for the New-order button, `order.edit` for the lifecycle buttons. The backend re-enforces, but
// hiding here keeps the UI honest.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { bget, bpost, loadCustomers, loadCustomerOptions } from '../lib/billing'
import { money } from '../lib/money'
import { can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { humanizeStatus } from '../lib/humanize'
import {
  ArchiveIcon, SearchIcon, CheckIcon, CloseIcon, ArrowRightIcon,
} from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { Button, Pagination, StatusPill } from '../primitives'
import { fmtDate } from '../lib/time'
import {
  type OrderRow, mapOrderStatus, nextAdvanceLabel, stage8RowPill,
} from './orders/types'
import { CreateOrderModal } from './orders/CreateOrderModal'
import { OrderDetailModal } from './orders/OrderDetailModal'
import { Stage8Modal } from './orders/Stage8Modal'

// ── View ─────────────────────────────────────────────────────────────────────
export default function OrdersView({ capabilities }: {
  capabilities?: Capabilities  // SM-2 — App's capabilities snapshot
}) {
  const { token } = useAuth()
  const [list, setList] = useState<OrderRow[] | null>(null)
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [customerOptions, setCustomerOptions] = useState<{ id: string; label: string }[]>([])
  // SM-2 — receive caps via prop instead of refetching.
  const caps: Capabilities = capabilities ?? FULL_ACCESS
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)

  // Toolbar interaction state.
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  // Modal state.
  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [stage8Id, setStage8Id] = useState<string | null>(null)

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<OrderRow[]>(token!, '/api/orders')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) {
      console.error('[orders] list failed', res.status)
      setError('Failed to load orders')
      setList([])
      return
    }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

  useEffect(() => {
    let alive = true
    // SM-2 — capabilities now flow as a prop from App.tsx; no per-view refetch.
    loadCustomers(token!).then((m) => { if (alive) setCustomerNames(m) }).catch(() => {})
    loadCustomerOptions(token!).then((opts) => { if (alive) setCustomerOptions(opts) }).catch(() => {})
    return () => { alive = false }
  }, [token])

  useEffect(() => { setPage(1) }, [query, statusFilter, sortKey, sortDir])

  const all = list ?? []
  const custName = (o: OrderRow) =>
    o.customer_id ? (customerNames[o.customer_id] ?? o.customer_id.slice(0, 8)) : '—'

  // KPI aggregates from the list (no extra fetch).
  const draftCount = all.filter((o) => o.status === 'DRAFT').length
  const inFlightCount = all.filter((o) => o.status === 'SUBMITTED' || o.status === 'PROVISIONING').length
  const completedCount = all.filter((o) => o.status === 'COMPLETED').length
  const completedValue = all.filter((o) => o.status === 'COMPLETED').reduce((s, o) => s + (o.total || 0), 0)
  // Stage 8: SUBMITTED orders that haven't passed the gate yet.
  const awaitingStage8 = all.filter((o) => o.status === 'SUBMITTED' && o.control_pass !== true).length

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Drafts', value: draftCount, subtitle: 'not yet submitted', onClick: () => setStatusFilter('DRAFT') },
    { label: 'In flight', value: inFlightCount, subtitle: 'submitted or provisioning', warning: true, onClick: () => setStatusFilter('SUBMITTED') },
    { label: 'Awaiting Stage 8', value: awaitingStage8, subtitle: 'gate not passed', warning: awaitingStage8 > 0, onClick: () => setStatusFilter('SUBMITTED') },
    { label: 'Completed', value: completedCount, subtitle: 'provisioned', onClick: () => setStatusFilter('COMPLETED') },
    { label: 'Completed value', value: money(completedValue), subtitle: 'sum of totals' },
  ] : []

  // Permission gates.
  const canView = canDo(caps, 'order', 'view')
  const canCreate = canDo(caps, 'order', 'create')
  const canEdit = canDo(caps, 'order', 'edit')

  // Filter + search + sort + paginate.
  const filtered = useMemo(() => {
    let rows = all
    if (statusFilter) rows = rows.filter((o) => o.status === statusFilter)
    const q = query.trim().toLowerCase()
    if (q) {
      rows = rows.filter((o) => [
        o.number ?? '',
        custName(o),
        o.status ?? '',
        String(o.total ?? ''),
      ].join(' ').toLowerCase().includes(q))
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query, statusFilter, customerNames])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (o: OrderRow): string | number => {
      switch (k) {
        case 'number': return o.number ?? ''
        case 'customer': return custName(o)
        case 'status': return o.status ?? ''
        case 'total': return o.total ?? 0
        case 'created': return o.created_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, customerNames])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  // Lifecycle actions. Each maps to one backend route; on success we toast + refresh.
  async function doAdvance(o: OrderRow) {
    try {
      const updated: any = await bpost(token!, `/api/orders/${o.id}/advance`)
      const to = (updated?.status ?? '').toLowerCase()
      toast.success(`Order ${o.number} → ${to}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  async function doSubmit(o: OrderRow) {
    try {
      await bpost(token!, `/api/orders/${o.id}/submit`)
      toast.success(`Order ${o.number} submitted`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  async function doCancel(o: OrderRow) {
    if (!window.confirm(`Cancel order ${o.number}? This cannot be undone.`)) return
    try {
      await bpost(token!, `/api/orders/${o.id}/cancel`)
      toast.success(`Order ${o.number} cancelled`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied || !canView) {
    return <PermissionDenied message="You don't have permission to view orders." />
  }

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', 'Orders & Validation']}
      icon={<ArchiveIcon size={18} />}
      title="Orders & Validation"
      subtitle="Order pipeline · Stage 8 control gate"
      kpis={kpis}
      primaryAction={!unavailable && canCreate ? {
        label: 'New order',
        icon: <Plus size={14} />,
        onClick: () => setCreateOpen(true),
      } : undefined}
      filters={{
        search: { value: query, onChange: setQuery, placeholder: 'Search orders…' },
        quick: [{
          label: 'Status',
          value: statusFilter,
          options: [
            { label: 'All statuses', value: '' },
            { label: 'Draft', value: 'DRAFT' },
            { label: 'Submitted', value: 'SUBMITTED' },
            { label: 'Provisioning', value: 'PROVISIONING' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Cancelled', value: 'CANCELLED' },
          ],
          onChange: setStatusFilter,
        }],
      }}
    >
        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">Loading…</p>}
        {unavailable && (
          <EmptyState
            icon={<ArchiveIcon size={40} />}
            title="Orders aren't available yet"
            message="Orders will appear here once the provisioning service is enabled."
          />
        )}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState
            icon={<ArchiveIcon size={40} />}
            title="No orders"
            message={canCreate ? 'Start by creating a draft order for a customer.' : 'No orders to show yet.'}
            action={canCreate ? (
              <Button variant="primary" size="sm"
            onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> New order
              </Button>
            ) : undefined}
          />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {([
                      ['number', 'Order #'],
                      ['customer', 'Customer'],
                      ['status', 'Status'],
                      ['total', 'Total'],
                      ['created', 'Created'],
                    ] as [string, string][]).map(([k, lbl]) => (
                      <th
                        key={k}
                        scope="col"
                        className={k === 'total' ? 'num' : ''}
                        onClick={() => toggleSort(k)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-2)' }}>
                          {lbl}
                          {sortKey === k
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    <th scope="col">Stage 8</th>
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((o) => {
                    const advLbl = nextAdvanceLabel(o.status)
                    const canFinalCancel = o.status !== 'COMPLETED' && o.status !== 'CANCELLED'
                    return (
                      <tr
                        key={o.id}
                        onClick={() => setDetailId(o.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td><span className="mono">{o.number}</span></td>
                        <td>{custName(o)}</td>
                        <td>{o.status
                          ? <StatusPill variant={mapOrderStatus(o.status)} label={humanizeStatus(o.status)} size="sm" />
                          : <span>—</span>}</td>
                        <td className="num"><span className="mono tnum">{money(o.total)}</span></td>
                        <td>{fmtDate(o.created_at)}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const p = stage8RowPill(o)
                            return (
                              <button
                                type="button"
                                className="btn-reset"
                                title={p.title ?? `Open Stage 8 checks for ${o.number}`}
                                onClick={() => setStage8Id(o.id)}
                                style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
                                aria-label={`Stage 8 ${p.label} — open details`}
                              >
                                <StatusPill variant={p.variant} label={p.label} size="sm" />
                              </button>
                            )
                          })()}
                        </td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            {(() => {
                              const actions: RowAction[] = []
                              if (canEdit && o.status === 'DRAFT') {
                                actions.push({ key: 'submit', label: 'Submit for provisioning', icon: <ArrowRightIcon size={14} />, onClick: () => doSubmit(o) })
                              }
                              if (canEdit && advLbl) {
                                actions.push({ key: 'advance', label: `Advance to ${advLbl}`, icon: <CheckIcon size={14} />, onClick: () => doAdvance(o) })
                              }
                              if (canEdit && canFinalCancel) {
                                actions.push({ key: 'cancel', label: 'Cancel order', icon: <CloseIcon size={14} />, danger: true, onClick: () => doCancel(o) })
                              }
                              return <RowActionsMenu actions={actions} ariaLabel="Order actions" />
                            })()}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <EmptyState
                          icon={<SearchIcon size={34} />}
                          title="No matching orders"
                          message="Try a different search term or clear the status filter."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />
          </div>
        )}

        {/* Create modal — single draft order with a single line item. */}
        {createOpen && (
          <CreateOrderModal
            customerOptions={customerOptions}
            onClose={() => setCreateOpen(false)}
            onDone={() => { setCreateOpen(false); load() }}
          />
        )}

        {/* Detail / edit modal */}
        {detailId && (
          <OrderDetailModal
            id={detailId}
            customerNames={customerNames}
            canEdit={canEdit}
            onClose={() => { setDetailId(null); load() }}
          />
        )}

        {/* Stage 8 control-gate drawer */}
        {stage8Id && (() => {
          const ord = all.find((o) => o.id === stage8Id) ?? null
          return (
            <Stage8Modal
              order={ord}
              orderId={stage8Id}
              canEdit={canEdit}
              onClose={() => setStage8Id(null)}
              onChanged={load}
            />
          )
        })()}
    </PageShell>
  )
}
