import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { bget, bpost, loadProducts, type Subscription, type Invoice, type Product } from './billing'
import { money, toMinor } from './money'
import { toast } from './Toast'
import { EmptyState } from './States'
import InteractionsView from './InteractionsView'

type Service = { id: string; type?: string; name?: string; status?: string | null }

// A customer's billing-at-a-glance: their subscriptions + recent invoices, with generate-invoice and
// a product-prefilled new-subscription form. Reads /api/subscriptions?customer= and /api/invoices?customer=.
// Degrades quietly (shows "not available") when the billing endpoints 404.
export default function CustomerBillingModal({ token, customerId, customerLabel, onClose }: {
  token: string
  customerId: string
  customerLabel: string
  onClose: () => void
}) {
  const [subs, setSubs] = useState<Subscription[] | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [productId, setProductId] = useState('')
  const [planName, setPlanName] = useState('')
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
    const svr = await bget<Service[]>(token, `/api/services?customer=${encodeURIComponent(customerId)}`)
    setServices(svr.ok && Array.isArray(svr.data) ? svr.data : [])
  }

  useEffect(() => { load() }, [token, customerId])
  useEffect(() => { loadProducts(token, true).then(setProducts) }, [token])

  function pickProduct(id: string) {
    setProductId(id)
    const p = products.find((x) => x.id === id)
    if (p) {
      setPlanName(p.name ?? '')
      setAmount(p.default_amount != null ? String(p.default_amount / 100) : '')
      setCycle(p.cycle ?? 'monthly')
    }
  }

  async function generate(subId: string) {
    try {
      await bpost(token, `/api/subscriptions/${subId}/generate-invoice`)
      toast.success('Invoice generated')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function createSub() {
    if (!planName.trim()) return
    try {
      await bpost(token, '/api/subscriptions', {
        customer_id: customerId, product_id: productId || undefined,
        plan_name: planName.trim(), amount: toMinor(amount), cycle,
      })
      toast.success('Subscription created')
      setCreating(false); setProductId(''); setPlanName(''); setAmount(''); setCycle('monthly')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <Modal open onClose={onClose} title={`Customer · ${customerLabel}`} size="lg">
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
              <label className="field"><span>Product</span>
                <select className="inp inp-md" value={productId} onChange={(e) => pickProduct(e.target.value)}>
                  <option value="">— custom —</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Plan name *</span><input className="inp inp-md" value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Fiber 100" /></label>
              <label className="field"><span>Amount (֏)</span><input className="inp inp-md inp-numeric" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
              <label className="field"><span>Cycle</span>
                <select className="inp inp-md" value={cycle} onChange={(e) => setCycle(e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={createSub} disabled={!planName.trim()}>Create</button></div>
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
                      <td>{s.plan_name ?? '—'}</td>
                      <td>{money(s.amount)}</td>
                      <td>{s.cycle ?? '—'}</td>
                      <td>{s.status ? <span className="pill">{s.status}</span> : '—'}</td>
                      <td className="row-actions">{(s.status ?? '').toUpperCase() !== 'CANCELLED' && <button className="btn btn-ghost btn-sm" onClick={() => generate(s.id)}>Generate invoice</button>}</td>
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

          <h3 style={{ marginTop: 18 }}>Services</h3>
          {services.length === 0
            ? <p className="muted">No services.</p>
            : (
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">Service</th><th scope="col">Type</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {services.map((sv) => (
                    <tr key={sv.id}>
                      <td>{sv.name ?? sv.id.slice(0, 8)}</td>
                      <td>{sv.type ?? '—'}</td>
                      <td>{sv.status ? <span className="pill">{sv.status}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}

          <h3 style={{ marginTop: 18 }}>Touchpoints</h3>
          <InteractionsView token={token} customerId={customerId} embedded />
        </>
      )}
    </Modal>
  )
}
