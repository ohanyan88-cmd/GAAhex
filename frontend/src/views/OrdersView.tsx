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
import { can as canDo, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
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
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { Button, Pagination, StatusPill } from '../primitives'
import { fmtDate } from '../lib/time'

// ── Stage 8 types ────────────────────────────────────────────────────────────
// Mirrors the response shape of POST /api/orders/{id}/stage8-check.
type Stage8CheckKey = 'credit_check' | 'deposit' | 'payment_method' | 'mandatory_approvals'
type Stage8CheckStatus = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_REQUIRED' | 'EXPIRED' | 'NOT_LINKED'
type Stage8Status = {
  pass: boolean
  blockers: string[]
  checks: Record<Stage8CheckKey, Stage8CheckStatus>
}

// ── Types ────────────────────────────────────────────────────────────────────
// Mirrors the dict shape from orders.py::_order(). Stage 8 fields are optional —
// when the backend serializer hasn't been extended to include them they're simply
// undefined and the UI degrades (pill shows "Pending", deposit buttons hide).
type OrderRow = {
  id: string
  number: string
  customer_id: string | null
  owner_node_id: string | null
  status: string                          // DRAFT | SUBMITTED | PROVISIONING | COMPLETED | CANCELLED
  total: number                           // luma
  created_at: string | null
  items?: OrderItemRow[]
  // ── Stage 8 (Phase B.1) ──
  control_pass?: boolean | null
  control_pass_at?: string | null
  control_gate_block_reason?: string | null
  deposit_required?: string | number | null     // Decimal AMD, serialized as string
  deposit_collected?: string | number | null
  deposit_held_until?: string | null
  payment_method_id?: string | null
  deposit_payment_id?: string | null
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


// Friendly verb for the next /advance hop, derived from the order's current status.
function nextAdvanceLabel(status: string): string | null {
  const v = (status ?? '').toUpperCase()
  if (v === 'SUBMITTED') return 'Provision'
  if (v === 'PROVISIONING') return 'Complete'
  return null
}

// Stage 8 column pill — derived from the persisted control_pass verdict on the
// order row. Clicking the pill opens the full Stage 8 drawer (which fetches the
// fresh predicate via /stage8-check).
function stage8RowPill(o: OrderRow): { variant: PillVariant; label: string; title?: string } {
  const cp = o.control_pass
  if (cp === true)  return { variant: 'active',   label: 'Pass' }
  if (cp === false) return { variant: 'critical', label: 'Fail', title: o.control_gate_block_reason ?? undefined }
  return { variant: 'neutral', label: 'Pending' }
}

// Map a Stage 8 per-check status → pill variant.
function stage8CheckVariant(s: Stage8CheckStatus): PillVariant {
  switch (s) {
    case 'PASS':         return 'active'
    case 'FAIL':         return 'critical'
    case 'PENDING':      return 'info'
    case 'NOT_REQUIRED': return 'neutral'
    case 'EXPIRED':      return 'critical'
    case 'NOT_LINKED':   return 'critical'
    default:             return 'neutral'
  }
}

// Decimal-or-number → number (luma-free; the deposit fields are AMD Decimals
// serialized as strings, NOT luma — backend collect_deposit body is "amount").
function toAmd(v: string | number | null | undefined): number {
  if (v == null) return 0
  const n = typeof v === 'string' ? parseFloat(v) : v
  return isFinite(n) ? n : 0
}

// ── View ─────────────────────────────────────────────────────────────────────
export default function OrdersView({ token, capabilities }: {
  token: string
  capabilities?: Capabilities  // SM-2 — App's capabilities snapshot
}) {
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
    // SM-2 — capabilities now flow as a prop from App.tsx; no per-view refetch.
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
              <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} /> New order
              </button>
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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

        {/* Stage 8 control-gate drawer */}
        {stage8Id && (() => {
          const ord = all.find((o) => o.id === stage8Id) ?? null
          return (
            <Stage8Modal
              token={token}
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
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
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

// ── Stage 8 modal ────────────────────────────────────────────────────────────
// Renders the Stage 8 Control Gate panel for one order:
//   * 4 check rows (Credit Check / Deposit / Payment Method / Approvals)
//   * blockers list
//   * Re-run check, Apply verdict, Release to Provisioning, Collect deposit
// On mount fetches POST /api/orders/{id}/stage8-check. Re-run reuses the same
// route. Apply / Release / Collect-deposit hit their own routes and refetch.
function Stage8Modal({
  token, order, orderId, canEdit, onClose, onChanged,
}: {
  token: string
  order: OrderRow | null            // snapshot from the list (for deposit_required/status); null if list missed
  orderId: string
  canEdit: boolean
  onClose: () => void
  onChanged: () => void             // tell parent to refetch /api/orders
}) {
  const [check, setCheck] = useState<Stage8Status | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)

  async function runCheck() {
    setError(''); setDenied(false); setUnavailable(false); setLoading(true)
    try {
      // /stage8-check is a POST predicate (read-only) — call via bpost so the
      // helper raises on non-2xx, then catch + classify here.
      const data = await bpost<Stage8Status>(token, `/api/orders/${orderId}/stage8-check`)
      setCheck(data)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 403) { setDenied(true) }
      else if (err.status === 404) { setUnavailable(true) }
      else { setError(err.message || 'Failed to run Stage 8 check') }
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { runCheck() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orderId])

  async function doApply() {
    if (busy) return
    setBusy(true)
    try {
      const updated = await bpost<{ stage8?: Stage8Status }>(token, `/api/orders/${orderId}/stage8-apply`)
      toast.success('Stage 8 verdict applied')
      if (updated?.stage8) setCheck(updated.stage8)
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function doRelease() {
    if (busy) return
    setBusy(true)
    try {
      await bpost(token, `/api/orders/${orderId}/release`)
      toast.success(`Order released to provisioning`)
      onChanged()
      onClose()
    } catch (e) {
      // 409 → backend includes the block reason in detail; surface verbatim.
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Deposit gating uses the snapshot order; if the snapshot is missing or the
  // backend hasn't extended /api/orders to include the deposit fields yet, we
  // show the button conservatively (only when we can prove a shortfall).
  const depositReq = toAmd(order?.deposit_required)
  const depositColl = toAmd(order?.deposit_collected)
  const depositShortfall = depositReq > 0 && depositColl < depositReq

  // Release button: only meaningful when the live check says pass AND the order
  // is currently SUBMITTED. Apply must run first if control_pass is still stale.
  const canRelease = !!check?.pass && order?.status === 'SUBMITTED'

  // 4 fixed check rows — render in a stable order regardless of what the
  // backend returns (missing key → render as Pending so the user sees the slot).
  const checkRows: { key: Stage8CheckKey; label: string }[] = [
    { key: 'credit_check',       label: 'Credit check' },
    { key: 'deposit',            label: 'Deposit' },
    { key: 'payment_method',     label: 'Payment method' },
    { key: 'mandatory_approvals', label: 'Mandatory approvals' },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      title={order ? `Stage 8 — Order ${order.number}` : 'Stage 8 control gate'}
      subtitle={order ? humanizeStatus(order.status) : undefined}
      size="md"
      footer={
        <>
          <button className="btn btn-ghost btn-sm" disabled={loading || busy} onClick={runCheck}>
            Re-run check
          </button>
          {canEdit && (
            <button className="btn btn-secondary btn-sm" disabled={loading || busy || denied || unavailable} onClick={doApply}>
              Apply verdict
            </button>
          )}
          {canEdit && depositShortfall && (
            <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setDepositOpen(true)}>
              Collect deposit
            </button>
          )}
          {canEdit && canRelease && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={doRelease}>
              <ArrowRightIcon size={13} /> Release to Provisioning
            </button>
          )}
        </>
      }
    >
      {denied && (
        <p className="muted" style={{ margin: 0 }}>
          Permission denied — Stage 8 checks require admin.
        </p>
      )}
      {unavailable && (
        <p className="muted" style={{ margin: 0 }}>
          Stage 8 endpoint not yet available.
        </p>
      )}
      {error && !denied && !unavailable && (
        <ErrorBanner message={error} onRetry={runCheck} />
      )}
      {!denied && !unavailable && !error && (
        <>
          {/* Overall verdict band */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
            borderRadius: 8, border: '1px solid var(--gx-border-subtle)',
            background: 'var(--gx-surface-2)', marginBottom: 12,
          }}>
            <span style={{ fontSize: 12, color: 'var(--gx-text-3)' }}>Verdict</span>
            {loading
              ? <span className="muted" style={{ fontSize: 12 }}>Running…</span>
              : check
                ? <StatusPill
                    variant={check.pass ? 'active' : 'critical'}
                    label={check.pass ? 'Pass' : 'Fail'}
                    size="sm"
                  />
                : <span className="muted" style={{ fontSize: 12 }}>—</span>}
          </div>

          {/* 4 check rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checkRows.map((row) => {
              const v: Stage8CheckStatus = (check?.checks?.[row.key] ?? 'PENDING') as Stage8CheckStatus
              return (
                <div key={row.key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', border: '1px solid var(--gx-border-subtle)', borderRadius: 6,
                }}>
                  <span style={{ fontSize: 13, color: 'var(--gx-text-1)' }}>{row.label}</span>
                  {loading && !check
                    ? <span className="muted" style={{ fontSize: 12 }}>…</span>
                    : <StatusPill variant={stage8CheckVariant(v)} label={humanizeStatus(v)} size="sm" />}
                </div>
              )
            })}
          </div>

          {/* Blockers */}
          {check && check.blockers && check.blockers.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gx-text-3)', marginBottom: 6 }}>
                Blockers
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--gx-text-2)', lineHeight: 1.6 }}>
                {check.blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}

          {/* Deposit snapshot (only when the row has deposit data) */}
          {order && depositReq > 0 && (
            <div style={{
              marginTop: 14, padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--gx-border-subtle)', background: 'var(--gx-surface-2)',
            }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gx-text-3)', marginBottom: 6 }}>
                Deposit
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Collected</span>
                <span className="mono tnum">{depositColl.toLocaleString()} ֏</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>Required</span>
                <span className="mono tnum">{depositReq.toLocaleString()} ֏</span>
              </div>
              {depositShortfall && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--gx-warning-fg)', marginTop: 4 }}>
                  <span>Shortfall</span>
                  <span className="mono tnum">{(depositReq - depositColl).toLocaleString()} ֏</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Collect-deposit nested modal */}
      {depositOpen && (
        <CollectDepositModal
          token={token}
          orderId={orderId}
          suggested={depositShortfall ? (depositReq - depositColl) : 0}
          onClose={() => setDepositOpen(false)}
          onDone={() => { setDepositOpen(false); onChanged(); runCheck() }}
        />
      )}
    </Modal>
  )
}

// ── Collect-deposit nested modal ─────────────────────────────────────────────
function CollectDepositModal({
  token, orderId, suggested, onClose, onDone,
}: {
  token: string
  orderId: string
  suggested: number                  // AMD shortfall to pre-fill
  onClose: () => void
  onDone: () => void
}) {
  const [amount, setAmount] = useState<string>(suggested > 0 ? String(suggested) : '')
  const [paymentMethodId, setPaymentMethodId] = useState<string>('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const amt = parseFloat(amount)
    if (!isFinite(amt) || amt <= 0 || busy) return
    setBusy(true)
    try {
      const body: { amount: number; payment_method_id?: string } = { amount: amt }
      const pm = paymentMethodId.trim()
      if (pm) body.payment_method_id = pm
      await bpost(token, `/api/orders/${orderId}/collect-deposit`, body)
      toast.success(`Deposit collected: ${amt.toLocaleString()} ֏`)
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
      title="Collect deposit"
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="md" onClick={onClose} disabled={busy}>Cancel</Button>
          <button
            className="btn btn-primary btn-md"
            disabled={busy || !isFinite(parseFloat(amount)) || parseFloat(amount) <= 0}
            onClick={submit}
          >
            {busy ? 'Collecting…' : 'Collect'}
          </button>
        </>
      }
    >
      <div className="rec-form" style={{ boxShadow: 'none', border: 0, padding: 0, marginBottom: 0 }}>
        <label className="field">
          <span>Amount (֏) <span style={{ color: 'var(--gx-danger-fg)' }}>*</span></span>
          <input
            className="inp inp-md inp-numeric"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
        </label>
        <label className="field">
          <span>Payment method ID <span className="muted" style={{ fontSize: 11 }}>(optional)</span></span>
          <input
            className="inp inp-md"
            value={paymentMethodId}
            onChange={(e) => setPaymentMethodId(e.target.value)}
            placeholder="UUID — leave blank for cash/transfer"
          />
        </label>
        <p className="hint" style={{ fontSize: 11, margin: 0 }}>
          When a payment method ID is provided the backend simulates a card charge.
          Otherwise the deposit is recorded without gateway activity.
        </p>
      </div>
    </Modal>
  )
}
