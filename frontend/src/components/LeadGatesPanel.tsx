// LeadGatesPanel — the lifecycle control-gate spine, relocated to the Pipeline page (Gev 2026-06-11).
//
// Self-contained: fetches leads/orders/customers itself, renders the four-gate strip, and owns the
// click-through window modal. It sits at the top of the Pipeline page (above the 3 pipeline tabs)
// because the gates span the whole lead → order → customer lifecycle, not just one tab.
//
// Behaviour is faithful to the old Leads-header strip: live counts per gate; click a card to open a
// window listing the records in that gate; click a record to jump to it (lead → Leads page, order →
// order detail modal, customer → customer page). No fake numbers.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { bget } from '../lib/billing'
import { can, FULL_ACCESS, type Capabilities } from '../lib/capabilities'
import { OBJ } from '../lib/permissions-constants'
import { StatusPill } from '../primitives'
import { Modal } from './Modal'
import { mapEntityStatus } from '../views/entity/types'
import { OrderDetailModal } from '../views/orders/OrderDetailModal'
import { LeadGatesStrip, GATES } from './LeadGatesStrip'

type Row = {
  id: string
  status?: string | null
  ref?: unknown; number?: unknown
  name?: unknown; title?: unknown
  phone?: unknown; customer_id?: unknown
}

// Same shape as the old EntityView local — keeps the lead reference label identical across pages.
const leadRef = (id: unknown) => 'LED-' + String(id).replace(/-/g, '').slice(-6).toUpperCase()

export function LeadGatesPanel({
  capabilities = FULL_ACCESS,
  onOpenCustomer,
}: {
  capabilities?: Capabilities
  onOpenCustomer?: (id: string) => void
}) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const canEdit = can(capabilities, OBJ.ORDER, 'edit')

  const [leads, setLeads] = useState<Row[]>([])
  const [orders, setOrders] = useState<Row[]>([])
  const [customers, setCustomers] = useState<Row[]>([])
  const [gateOpen, setGateOpen] = useState<string | null>(null)
  const [orderOpen, setOrderOpen] = useState<string | null>(null)

  // Each gate is backed by a different entity (Commercial=leads · Technical/Billing=orders ·
  // Customer Care=customers), so the strip needs all three lists to show real counts.
  useEffect(() => {
    if (!token) return
    const pick = (v: any): Row[] => (Array.isArray(v) ? v : (v?.rows ?? v?.items ?? v?.orders ?? []))
    void (async () => {
      const [l, o, c] = await Promise.all([
        bget<any>(token, '/api/leads'),
        bget<any>(token, '/api/orders'),
        bget<any>(token, '/api/customers'),
      ])
      if (l.ok) setLeads(pick(l.data))
      if (o.ok) setOrders(pick(o.data))
      if (c.ok) setCustomers(pick(c.data))
    })()
  }, [token])

  const customerNames = Object.fromEntries(
    customers.map((c) => [String(c.id), String((c as { name?: unknown }).name ?? '')]),
  )

  return (
    <>
      <LeadGatesStrip
        leads={leads}
        orders={orders}
        customers={customers}
        onOpenGate={(gateKey) => setGateOpen(gateKey)}
      />

      {gateOpen && (() => {
        const gate = GATES.find((g) => g.key === gateOpen)
        if (!gate) return null
        const data: Row[] = gate.entity === 'lead' ? leads : gate.entity === 'order' ? orders : customers
        const recs = data.filter((r) => gate.statuses.includes(r.status ?? ''))
        const [one, many] = gate.entity === 'order' ? ['order', 'orders'] : gate.entity === 'customer' ? ['customer', 'customers'] : ['lead', 'leads']
        const idLabel = (r: Row) => (r.ref ? String(r.ref) : r.number ? String(r.number) : leadRef(r.id))
        const mainLabel = (r: Row) => (r.name ? String(r.name) : r.title ? String(r.title) : (r.customer_id ? `Customer ${String(r.customer_id).slice(0, 8)}` : '—'))
        const row = (r: Row) => (
          <>
            <span className="mono" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-link)' }}>{idLabel(r)}</span>
            <span style={{ fontWeight: 'var(--gx-weight-semibold)', flex: 1 }}>{mainLabel(r)}</span>
            {r.phone ? <span className="mono" style={{ fontSize: 'var(--gx-text-11)', color: 'var(--gx-text-3)' }}>{String(r.phone)}</span> : null}
            {r.status ? <StatusPill variant={mapEntityStatus(r.status)} label={r.status} size="sm" /> : null}
          </>
        )
        const rowStyle = { display: 'flex', alignItems: 'center', gap: 'var(--gx-space-5)', padding: 'var(--gx-space-5) var(--gx-space-6)', background: 'var(--gx-surface-2)', border: '1px solid var(--gx-border)', borderRadius: 'var(--gx-radius-md)', textAlign: 'left' as const, width: '100%', cursor: 'pointer' }
        const go = (r: Row) => {
          setGateOpen(null)
          if (gate.entity === 'order') setOrderOpen(r.id)
          else if (gate.entity === 'customer') onOpenCustomer?.(r.id)
          else navigate('/leads')
        }
        return (
          <Modal open onClose={() => setGateOpen(null)} title={gate.name}
            subtitle={`${recs.length} ${recs.length === 1 ? one : many} currently in this part`} size="md">
            {recs.length === 0 ? (
              <div style={{ padding: 'var(--gx-space-9)', textAlign: 'center', color: 'var(--gx-text-3)', fontSize: 'var(--gx-text-sm)' }}>
                No {many} in this part yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gx-space-3)' }}>
                {recs.map((r) => (
                  <button key={r.id} type="button" onClick={() => go(r)} style={rowStyle}>{row(r)}</button>
                ))}
              </div>
            )}
          </Modal>
        )
      })()}

      {orderOpen && (
        <OrderDetailModal
          id={orderOpen}
          customerNames={customerNames}
          canEdit={canEdit}
          onClose={() => setOrderOpen(null)}
        />
      )}
    </>
  )
}

export default LeadGatesPanel
