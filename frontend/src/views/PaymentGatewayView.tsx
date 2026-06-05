import { useEffect, useMemo, useState } from 'react'
import {
  listPaymentOrders, reconcileOrders, openReceipt,
  type PaymentOrder, type PaymentOrderStatus,
} from '../lib/paymentgw'
import { money } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  CreditCardIcon, ReceiptIcon, ArrowRightIcon,
  ChevronLeftIcon, ArrowUpIcon, ArrowDownIcon, PlusIcon, GearIcon,
  MoreVerticalIcon,
} from '../components/icons'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { Button, StatusPill } from '../primitives'
import { fmtDate } from '../lib/time'


type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapOrderStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase() as PaymentOrderStatus | ''
  if (v === 'PAID') return 'active'
  if (v === 'PENDING') return 'info'
  if (v === 'FAILED' || v === 'EXPIRED') return 'critical'
  if (v === 'CANCELLED') return 'neutral'
  return 'neutral'
}

const TAB_DEFS: Array<[string, string]> = [
  ['', 'All'],
  ['PENDING', 'Pending'],
  ['PAID', 'Paid'],
  ['FAILED', 'Failed'],
  ['EXPIRED', 'Expired'],
  ['CANCELLED', 'Cancelled'],
]

export default function PaymentGatewayView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'gateway', configVersion)
  const [orders, setOrders] = useState<PaymentOrder[] | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setOrders(null)
    const res = await listPaymentOrders(token, { status: statusFilter || undefined })
    if (res.status === 404) { setUnavailable(true); setOrders([]); return }
    if (!res.ok) { setError('Failed to load payment orders'); setOrders([]); return }
    setOrders(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token, statusFilter])
  useEffect(() => { setPage(1) }, [statusFilter, query, sortKey, sortDir])

  async function handleReconcile() {
    if (reconciling) return
    setReconciling(true)
    try {
      const result = await reconcileOrders(token)
      toast.success(`Reconciled ${result.reconciled} order(s); ${result.expired} expired.`)
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReconciling(false)
    }
  }

  async function handleOpenReceipt(paymentId: string) {
    const err = await openReceipt(token, paymentId)
    if (err) toast.error(err)
  }

  const all = orders ?? []
  const countFor = (s: string) => all.filter(o => (o.status ?? '').toUpperCase() === s).length
  const paidCount = countFor('PAID')
  const pendingCount = countFor('PENDING')
  const failedCount = countFor('FAILED') + countFor('EXPIRED')
  const totalAmt = all.reduce((a, o) => a + (o.amount ?? 0), 0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((o) => {
      const fields = [
        o.id ?? '',
        o.invoice_id ?? '',
        o.provider ?? '',
        o.status ?? '',
        String(o.amount ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (o: PaymentOrder): string | number => {
      switch (k) {
        case 'id': return o.id ?? ''
        case 'invoice': return o.invoice_id ?? ''
        case 'amount': return o.amount ?? 0
        case 'provider': return o.provider ?? ''
        case 'status': return o.status ?? ''
        case 'initiated': return o.initiated_at ?? ''
        case 'confirmed': return o.confirmed_at ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => {
      const x = get(a), y = get(b)
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x).localeCompare(String(y)) * dir
    })
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Volume', value: `֏${(totalAmt / 1000).toFixed(1)}k`, subtitle: `${all.length} order${all.length !== 1 ? 's' : ''}` },
    { label: 'Paid', value: paidCount, subtitle: 'settled', onClick: () => setStatusFilter('PAID') },
    ...(pendingCount > 0 ? [{ label: 'Pending', value: pendingCount, subtitle: 'awaiting confirmation', warning: true, onClick: () => setStatusFilter('PENDING') }] : []),
    ...(failedCount > 0 ? [{ label: 'Failed/Expired', value: failedCount, subtitle: 'action required', danger: true, onClick: () => setStatusFilter('FAILED') }] : []),
  ] : []

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<CreditCardIcon size={18} />}
      title={cfg.title}
      subtitle="Payment processor integration"
      kpis={kpis}
      primaryAction={{
        label: reconciling ? 'Reconciling…' : 'Reconcile now',
        icon: <PlusIcon size={13} />,
        onClick: handleReconcile,
        disabled: reconciling,
      }}
      secondaryActions={canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      // TL-5 — search lifts into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search orders' } }}
    >
        <div className="tabs">
          {TAB_DEFS.map(([val, label]) => {
            const count = val === '' ? all.length : countFor(val)
            return (
              <button
                key={val}
                className={'tab' + (statusFilter === val ? ' on' : '')}
                onClick={() => setStatusFilter(val)}
              >
                {label} <span className="tab-count">{count}</span>
              </button>
            )
          })}
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {orders === null && !error && <p className="muted">Loading…</p>}

        {unavailable && (
          <EmptyState
            icon={<CreditCardIcon size={40} />}
            title="Payment gateway isn't available yet"
            message="Payment orders will appear here once the gateway service is enabled."
          />
        )}

        {orders && !unavailable && orders.length === 0 && !error && (
          <EmptyState
            icon={<CreditCardIcon size={40} />}
            title="No payment orders"
            message="Payment orders will appear here once customers initiate online payments."
          />
        )}

        {orders && orders.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {/* TL-5 — search lifted to PageShell zone D. */}

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {[
                      { key: 'id', label: 'Order ID' },
                      { key: 'invoice', label: 'Invoice' },
                      { key: 'amount', label: 'Amount', cls: 'num' },
                      { key: 'provider', label: 'Provider' },
                      { key: 'status', label: 'Status' },
                      { key: 'initiated', label: 'Initiated' },
                      { key: 'confirmed', label: 'Confirmed' },
                    ].map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={c.cls ?? ''}
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((o) => (
                    <tr key={o.id}>
                      <td><span className="mono" style={{ fontSize: 12 }}>{o.id.slice(0, 8)}</span></td>
                      <td><span className="mono" style={{ color: 'var(--gx-text-3)' }}>{o.invoice_id ? o.invoice_id.slice(0, 8) : '—'}</span></td>
                      <td className="num"><span className="mono tnum">{money(o.amount)}</span></td>
                      <td style={{ textTransform: 'capitalize', color: 'var(--gx-text-2)' }}>{o.provider ?? '—'}</td>
                      <td>{o.status
                        ? <StatusPill variant={mapOrderStatus(o.status)} label={o.status} size="sm" />
                        : <span>—</span>}
                      </td>
                      <td><span className="mono">{fmtDate(o.initiated_at)}</span></td>
                      <td><span className="mono">{fmtDate(o.confirmed_at)}</span></td>
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          {o.payment_id && (
                            <Button variant="ghost" size="sm"
            onClick={() => handleOpenReceipt(o.payment_id!)}
                              title="Open receipt"
                            >
                              <ReceiptIcon size={13} /> Receipt
                            </Button>
                          )}
                          <button
                            className="iconbtn"
                            aria-label="Row menu"
                            title="Row actions"
                            onClick={(e) => { e.stopPropagation(); console.log('[gateway] row menu', o.id) }}
                          >
                            <MoreVerticalIcon size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching orders.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 orders'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <Button variant="ghost" size="sm"
            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </Button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <Button variant="ghost" size="sm"
            disabled={page>= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </Button>
            </div>
          </div>
        )}
    </PageShell>
  )
}
