// OrderDetailModal — detail/edit drawer for a single order.
// Extracted from OrdersView.tsx; no logic changes.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useI18n } from '../../lib/i18n'
import { bget, bpost } from '../../lib/billing'
import { money } from '../../lib/money'
import { toast } from '../../components/Toast'
import RecordDrawer, { type RecordDrawerField } from '../../components/RecordDrawer'
import { ErrorBanner } from '../../components/States'
import { humanizeStatus } from '../../lib/humanize'
import { ArrowRightIcon, CheckIcon, CloseIcon } from '../../components/icons'
import { Button } from '../../primitives'
import { fmtDate } from '../../lib/time'
import { type OrderRow, mapOrderStatus, nextAdvanceLabel, nextOrderStatus } from './types'

export function OrderDetailModal({
  id, customerNames, canEdit, onClose,
}: {
  id: string
  customerNames: Record<string, string>
  canEdit: boolean
  onClose: () => void
}) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [order, setOrder] = useState<OrderRow | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setError('')
    const res = await bget<OrderRow>(token!, `/api/orders/${id}`)
    if (!res.ok) {
      setError(res.status === 404 ? t('orders.notFound', 'Order not found') : t('orders.failedToLoad', 'Failed to load order'))
      return
    }
    setOrder(res.data)
  }
  useEffect(() => { load() }, [token, id])

  async function action(verb: 'submit' | 'advance' | 'cancel') {
    if (!order || busy) return
    if (verb === 'cancel' && !window.confirm(`Cancel order ${order.number}?`)) return
    // One config-driven transition route ({to}) for every move — no per-verb endpoints. The advance
    // target is resolved from the SST; submit/cancel are fixed.
    const to = verb === 'submit' ? 'order_validated'
      : verb === 'cancel' ? 'cancelled'
      : nextOrderStatus(order.status)
    if (!to) return
    setBusy(true)
    try {
      await bpost(token!, `/api/orders/${order.id}/transition`, { to })
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
  const canFinalCancel = status && status !== 'activation' && status !== 'cancelled'

  // Map OrderRow status → RecordDrawer status pill variant. Keeps the same
  // mapping logic as the row pill (mapOrderStatus) but coerced to the drawer's
  // 5-variant scale.
  const statusVariant = order?.status ? mapOrderStatus(order.status) : undefined
  const drawerStatus = statusVariant && order?.status
    ? { label: humanizeStatus(order.status), variant: statusVariant as 'active' | 'degraded' | 'critical' | 'neutral' | 'info' }
    : undefined

  const fields: RecordDrawerField[] = order ? [
    { key: 'customer', label: t('orders.col.customer', 'Customer'), value: cust },
    { key: 'total', label: t('orders.col.total', 'Total'), value: <span className="mono tnum">{money(order.total)}</span> },
    { key: 'created', label: t('orders.col.created', 'Created'), value: fmtDate(order.created_at) },
    { key: 'items', label: t('orders.detail.items', 'Items'), value: order.items && order.items.length > 0 ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)' }}>
        {order.items.map((it) => (
          <div key={it.id} style={{ display: 'flex', gap: 'var(--gx-space-3)', fontSize: 'var(--gx-text-sm)' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.description}</span>
            <span className="mono tnum" style={{ color: 'var(--gx-text-3)' }}>×{it.quantity}</span>
            <span className="mono tnum" style={{ minWidth: 64, textAlign: 'right' }}>{money(it.line_total)}</span>
          </div>
        ))}
      </div>
    ) : <span className="muted">{t('orders.detail.noItems', 'No items on this order.')}</span> },
  ] : []

  return (
    <>
      <RecordDrawer
        open
        onClose={onClose}
        entityKey="ORD"
        id={order ? order.number : id.slice(0, 8)}
        title={order ? `${t('orders.detail.orderTitle', 'Order')} ${order.number}` : t('common.loading', 'Loading…')}
        subtitle={order?.customer_id ? cust : undefined}
        status={drawerStatus}
        fields={fields}
        footer={
          canEdit && order ? (
            <>
              {canFinalCancel && (
                <Button variant="ghost" size="sm"
            disabled={busy} onClick={() => action('cancel')}>
                  <CloseIcon size={13} /> {t('orders.action.cancel', 'Cancel order')}
                </Button>
              )}
              {status === 'order_created' && (
                <Button variant="primary" size="sm"
            disabled={busy} onClick={() => action('submit')}>
                  <ArrowRightIcon size={13} /> {t('common.submit', 'Submit')}
                </Button>
              )}
              {advLbl && (
                <Button variant="primary" size="sm"
            disabled={busy} onClick={() => action('advance')}>
                  <CheckIcon size={13} /> {advLbl}
                </Button>
              )}
            </>
          ) : null
        }
      />
      {error && (
        <div style={{ position: 'fixed', top: 'var(--gx-space-8)', left: 'var(--gx-space-8)', zIndex: 'var(--gx-z-toast)', maxWidth: 320 }}>
          <ErrorBanner message={error} onRetry={load} />
        </div>
      )}
    </>
  )
}
