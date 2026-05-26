import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { bget, bpost, type Subscription, type Invoice } from './billing'
import { money, toMinor } from './money'
import { toast } from './Toast'
import { EmptyState } from './States'

// A customer's billing-at-a-glance: their subscriptions + recent invoices, with generate-invoice and
// new-subscription actions. Reads /api/subscriptions?customer= and /api/invoices?customer=.
// Degrades quietly (shows "not available") when the billing endpoints 404.
export default function CustomerBillingModal({ token, customerId, customerLabel, onClose }: {
  token: string
  customerId: string
  customerLabel: string
  onClose: () => void
}) {
  const [subs, setSubs] = useState<Subscription[] | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [plan, setPlan] = useState('')
  const [amount, setAmount] = useState('')
  const [cycle, setCycle] = useState('monthly')

  async function load() {
    setError(''); setUnavailable(false); setSubs(null)
    const sr = await bget<Subscription[]>(token, `/api/subscriptions?customer=${encodeURIComponent(customerId)}`)
    if (sr.status === 404) { setUnavailable(true); setSubs([]); return }
    if (!sr.ok) { setError('Failed to load billing'); setSubs([]); return }
    setSubs(Array.isArray(sr.data) ? sr.data : [])
    const ir = await bget<Invoice[]>(token, `/api/invoices?customer=${encodeURIComponent(customerId)}`)
    if (ir.ok && Array.isArray(ir.data)) setInvoices(ir.data)
  }

  useEffect(() => { load() }, [token, customerId])

  async function generate(subId: string) {
    try {
      await bpost(token, `/api/subscriptions/${subId}/generate-invoice`)
      toast.success('Invoice generated')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function createSub() {
    if (!plan.trim()) return
    try {
      await bpost(token, '/api/subscriptions', { customer: customerId, plan: plan.trim(), amount: toMinor(amount), cycle })
      toast.success('Subscription created')
      setCreating(false); setPlan(''); setAmount(''); setCycle('monthly')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal open onClose={onClose} title={`Billing · ${customerLabel}`} size="lg">
      {error && <p className="err">{error}</p>}
      {subs === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState title="Billing isn't available yet" message="This customer's billing will appear once the billing service is enabled." />}

      {subs && !unavailable && (
        <>
          <div className="bill-section-head">
            <h3>Subscriptions</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : '+ New subscription'}</button>
          </div>

          {creating && (
            <div className="rec-form" style={{ marginBottom: 12 }}>
              <label className="field"><span>Plan *</span><input className="inp inp-md" value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Fiber 100" /></label>
              <label className="field"><span>Amount (֏)</span><input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="field"><span>Cycle</span>
                <select className="inp inp-md" value={cycle} onChange={(e) => setCycle(e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={createSub} disabled={!plan.trim()}>Create</button></div>
            </div>
          )}

          {subs.length === 0
            ? <p className="muted">No subscriptions.</p>
            : (
              <table className="grid">
                <thead><tr><th>Plan</th><th>Amount</th><th>Cycle</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.plan ?? '—'}</td>
                      <td>{money(s.amount)}</td>
                      <td>{s.cycle ?? '—'}</td>
                      <td>{s.status ? <span className="pill">{s.status}</span> : '—'}</td>
                      <td className="row-actions"><button className="btn btn-ghost btn-sm" onClick={() => generate(s.id)}>Generate invoice</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

          <h3 style={{ marginTop: 18 }}>Recent invoices</h3>
          {invoices.length === 0
            ? <p className="muted">No invoices.</p>
            : (
              <table className="grid">
                <thead><tr><th>Invoice</th><th>Status</th><th>Total</th></tr></thead>
                <tbody>
                  {invoices.slice(0, 8).map((inv) => (
                    <tr key={inv.id}>
                      <td>{inv.number ?? inv.id.slice(0, 8)}</td>
                      <td>{inv.status ? <span className="pill">{inv.status}</span> : '—'}</td>
                      <td>{money(inv.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </>
      )}
    </Modal>
  )
}
