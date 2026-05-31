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
import { bget, bpost, loadCustomers, loadCustomerOptions } from '../lib/billing'
import { money } from '../lib/money'
import { fetchCapabilities, can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { toast } from '../components/Toast'
import { Modal } from '../components/Modal'
import RecordDrawer, { type RecordDrawerField } from '../components/RecordDrawer'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { humanizeStatus } from '../lib/humanize'
import {
  ArchiveIcon, SearchIcon, CheckIcon, CloseIcon, ArrowRightIcon,
} from '../components/icons'
import RowActionsMenu, { type RowAction } from '../components/RowActionsMenu'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import ViewHead from '../components/ViewHead'
import { StatusPill, KPITile } from '../primitives'

// ── Types ────────────────────────────────────────────────────────────────────
// Mirrors the dict shape from orders.py::_order().
type OrderRow = {
  id: string
  number: string
  customer_id: string | null
  owner_node_id: string | null
  status: string                          // DRAFT | SUBMITTED | PROVISIONING | COMPLETED | CANCELLED
  total: number                           // luma
  created_at: string | null
  items?: OrderItemRow[]
}

type OrderItemRow = {
  id: string
  product_id: string | null
  description: string
  quantity: number
  unit_amount: number                     // luma
  line_total: number                      // luma
}

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapOrderStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'COMPLETED') return 'active'
  if (v === 'PROVISIONING') return 'degraded'
  if (v === 'SUBMITTED') return 'info'
  if (v === 'CANCELLED') return 'neutral'
  return 'info' // DRAFT
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Friendly verb for the next /advance hop, derived from the order's current status.
function nextAdvanceLabel(status: string): string | null {
  const v = (status ?? '').toUpperCase()
  if (v === 'SUBMITTED') return 'Provision'
  if (v === 'PROVISIONING') return 'Complete'
  return null
}

// ── View ─────────────────────────────────────────────────────────────────────
export default function OrdersView({ token }: { token: string }) {
  const [list, setList] = useState<OrderRow[] | null>(null)
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [customerOptions, setCustomerOptions] = useState<{ id: string; label: string }[]>([])
  const [caps, setCaps] = useState<Capabilities>(FULL_ACCESS)
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

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<OrderRow[]>(token, '/api/orders')
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
    fetchCapabilities(token).then((c) => { if (alive) setCaps(c) }).catch(() => {})
    loadCustomers(token).then((m) => { if (alive) setCustomerNames(m) }).catch(() => {})
    loadCustomerOptions(token).then((opts) => { if (alive) setCustomerOptions(opts) }).catch(() => {})
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
      const updated: any = await bpost(token, `/api/orders/${o.id}/advance`)
      const to = (updated?.status ?? '').toLowerCase()
      toast.success(`Order ${o.number} → ${to}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  async function doSubmit(o: OrderRow) {
    try {
      await bpost(token, `/api/orders/${o.id}/submit`)
      toast.success(`Order ${o.number} submitted`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }
  async function doCancel(o: OrderRow) {
    if (!window.confirm(`Cancel order ${o.number}? This cannot be undone.`)) return
    try {
      await bpost(token, `/api/orders/${o.id}/cancel`)
      toast.success(`Order ${o.number} cancelled`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  if (denied || !canView) {
    return <PermissionDenied message="You don't have permission to view orders." />
  }

  return (
    <div className="view">
      <div className="view-inner section-page fade">
        <div className="crumbs">
          <span>Orders &amp; Revenue</span>
          <span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>Orders</span>
        </div>

        <ViewHead
          icon={<ArchiveIcon size={18} />}
          title="Orders"
          sub={`${all.length} order${all.length !== 1 ? 's' : ''} · provisioning lifecycle`}
          actions={
            !unavailable ? (
              <>
                {canCreate && (
                  <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                    <Plus size={14} /> New order
                  </button>
                )}
              </>
            ) : undefined
          }
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <KPITile
              label="Drafts"
              value={draftCount}
              subtitle="not yet submitted"
              size="sm"
              onClick={() => setStatusFilter('DRAFT')}
              ariaLabel={`Drafts — ${draftCount}. Click to filter to draft.`}
            />
            <KPITile
              label="In flight"
              value={inFlightCount}
              subtitle="submitted or provisioning"
              size="sm"
              warning
              onClick={() => setStatusFilter('SUBMITTED')}
              ariaLabel={`In flight — ${inFlightCount}. Click to filter.`}
            />
            <KPITile
              label="Completed"
              value={completedCount}
              subtitle="provisioned"
              size="sm"
              premium
              onClick={() => setStatusFilter('COMPLETED')}
              ariaLabel={`Completed — ${completedCount}. Click to filter to completed.`}
            />
            <KPITile
              label="Completed value"
              value={money(completedValue)}
              subtitle="sum of totals"
              size="sm"
            />
          </div>
        )}

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
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> New order
              </button>
            ) : undefined}
          />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search orders"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <select
                className="inp inp-sm"
                aria-label="Filter by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ marginLeft: 8 }}
              >
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="PROVISIONING">Provisioning</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <span className="spacer" />
            </div>

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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {lbl}
                          {sortKey === k
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
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
                      <td colSpan={6} style={{ padding: 0 }}>
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

            <div className="table-foot">
              <span className="hint">
                {sorted.length === 0
                  ? '0 records'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map((p) => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create modal — single draft order with a single line item. */}
        {createOpen && (
          <CreateOrderModal
            token={token}
            customerOptions={customerOptions}
            onClose={() => setCreateOpen(false)}
            onDone={() => { setCreateOpen(false); load() }}
          />
        )}

        {/* Detail / edit modal */}
        {detailId && (
          <OrderDetailModal
            token={token}
            id={detailId}
            customerNames={customerNames}
            canEdit={canEdit}
            onClose={() => { setDetailId(null); load() }}
          />
        )}
      </div>
    </div>
  )
}

// ── Create modal ─────────────────────────────────────────────────────────────
function CreateOrderModal({
  token, customerOptions, onClose, onDone,
}: {
  token: string
  customerOptions: { id: string; label: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [customerId, setCustomerId] = useState('')
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitAmount, setUnitAmount] = useState('')   // major ֏
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!customerId || !description.trim() || busy) return
    setBusy(true)
    try {
      const qty = Math.max(1, parseInt(quantity, 10) || 1)
      const unitMinor = Math.round((parseFloat(unitAmount) || 0) * 100)
      await bpost(token, '/api/orders', {
        customer_id: customerId,
        items: [{
          description: description.trim(),
          quantity: qty,
          unit_amount: unitMinor,
        }],
      })
      toast.success('Order drafted')
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New order"
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary btn-md"
            disabled={busy || !customerId || !description.trim()}
            onClick={submit}
          >
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Customer <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <select className="inp inp-md" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— select —</option>
            {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Line description <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Fiber 100 Mbps install"
            autoFocus
          />
        </label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 1, minWidth: 100 }}>
            <span>Quantity</span>
            <input
              className="inp inp-md inp-numeric"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            <span>Unit amount (֏)</span>
            <input
              className="inp inp-md inp-numeric"
              type="number"
              min={0}
              step="0.01"
              value={unitAmount}
              onChange={(e) => setUnitAmount(e.target.value)}
            />
          </label>
        </div>
        <p className="hint" style={{ fontSize: 11, margin: 0 }}>
          The order is created as a DRAFT. Use Submit, then Advance to provision it.
        </p>
      </div>
    </Modal>
  )
}

// ── Detail modal ─────────────────────────────────────────────────────────────
function OrderDetailModal({
  token, id, customerNames, canEdit, onClose,
}: {
  token: string
  id: string
  customerNames: Record<string, string>
  canEdit: boolean
  onClose: () => void
}) {
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    const res = await bget<OrderRow>(token, `/api/orders/${id}`)
    if (!res.ok) {
      setError(res.status === 404 ? 'Order not found' : 'Failed to load order')
      return
    }
    setOrder(res.data)
  }
  useEffect(() => { load() }, [token, id])

  async function action(verb: 'submit' | 'advance' | 'cancel') {
    if (!order || busy) return
    if (verb === 'cancel' && !window.confirm(`Cancel order ${order.number}?`)) return
    setBusy(true)
    try {
      await bpost(token, `/api/orders/${order.id}/${verb}`)
      toast.success(`Order ${verb}${verb === 'cancel' ? 'led' : verb === 'advance' ? 'd' : 'ted'}`)
      await load()
    } catch (e) { toast.error((e as Error).message) }
    finally { setBusy(false) }
  }

  const cust = order?.customer_id
    ? (customerNames[order.customer_id] ?? order.customer_id.slice(0, 8))
    : '—'
  const status = order?.status ?? ''
  const advLbl = nextAdvanceLabel(status)
  const canFinalCancel = status && status !== 'COMPLETED' && status !== 'CANCELLED'

  // Map OrderRow status → RecordDrawer status pill variant. Keeps the same
  // mapping logic as the row pill (mapOrderStatus) but coerced to the drawer's
  // 5-variant scale.
  const statusVariant = order?.status ? mapOrderStatus(order.status) : undefined
  const drawerStatus = statusVariant && order?.status
    ? { label: humanizeStatus(order.status), variant: statusVariant as 'active' | 'degraded' | 'critical' | 'neutral' | 'info' }
    : undefined

  const fields: RecordDrawerField[] = order ? [
    { key: 'customer', label: 'Customer', value: cust },
    { key: 'total', label: 'Total', value: <span className="mono tnum">{money(order.total)}</span> },
    { key: 'created', label: 'Created', value: fmtDate(order.created_at) },
    { key: 'items', label: 'Items', value: order.items && order.items.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.items.map((it) => (
          <div key={it.id} style={{ display: 'flex', gap: 8, fontSize: 12 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.description}</span>
            <span className="mono tnum" style={{ color: 'var(--gx-text-3)' }}>×{it.quantity}</span>
            <span className="mono tnum" style={{ minWidth: 64, textAlign: 'right' }}>{money(it.line_total)}</span>
          </div>
        ))}
      </div>
    ) : <span className="muted">No items on this order.</span> },
  ] : []

  return (
    <>
      <RecordDrawer
        open
        onClose={onClose}
        entityKey="ORD"
        id={order ? order.number : id.slice(0, 8)}
        title={order ? `Order ${order.number}` : 'Loading order…'}
        subtitle={order?.customer_id ? cust : undefined}
        status={drawerStatus}
        fields={fields}
        footer={
          canEdit && order ? (
            <>
              {canFinalCancel && (
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action('cancel')}>
                  <CloseIcon size={13} /> Cancel order
                </button>
              )}
              {status === 'DRAFT' && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action('submit')}>
                  <ArrowRightIcon size={13} /> Submit
                </button>
              )}
              {advLbl && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action('advance')}>
                  <CheckIcon size={13} /> {advLbl}
                </button>
              )}
            </>
          ) : null
        }
      />
      {error && (
        <div style={{ position: 'fixed', top: 16, left: 16, zIndex: 9999, maxWidth: 320 }}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}
    </>
  )
}
