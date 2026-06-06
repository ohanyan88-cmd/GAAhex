import { Button } from '../primitives'
import { useEffect, useState } from 'react'
import { Modal } from '../components/Modal'
import { bget, bpost, loadProducts, openDocument, type Subscription, type Invoice, type Product } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { toast } from '../components/Toast'
import { EmptyState } from '../components/States'
import InteractionsView from '../views/InteractionsView'
import { PrinterIcon, CreditCardIcon } from '../components/icons'

type Service = { id: string; type?: string; name?: string; status?: string | null }
type Acct = { id: string; type?: string; currency?: string; billing_cycle?: string; status?: string | null }
type Payment = { id: string; invoice_id: string; amount: number; method: string; paid_at: string | null; note: string | null }

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
  const [accounts, setAccounts] = useState<Acct[]>([])
  const [unrated, setUnrated] = useState<Record<string, number>>({})
  const [products, setProducts] = useState<Product[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
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
    // accounts layer (17a, Stage-1 dormant — empty until the accounts↔customer link is wired)
    const ar = await bget<Acct[]>(token, `/api/accounts?customer=${encodeURIComponent(customerId)}`)
    setAccounts(ar.ok && Array.isArray(ar.data) ? ar.data : [])
    // unrated usage counts per subscription (light: one query, counted client-side)
    const ur = await bget<any[]>(token, '/api/usage?rated=false')
    const m: Record<string, number> = {}
    if (ur.ok && Array.isArray(ur.data)) for (const u of ur.data) if (u.subscription_id) m[u.subscription_id] = (m[u.subscription_id] || 0) + 1
    setUnrated(m)
    // fetch payments for this customer
    const pr = await bget<Payment[]>(token, `/api/payments?customer=${encodeURIComponent(customerId)}`)
    if (pr.status === 404) setPayments([])
    else setPayments(pr.ok && Array.isArray(pr.data) ? pr.data : [])
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

  async function rateUsage(subId: string) {
    try {
      await bpost(token, '/api/usage/rate', { subscription_id: subId })
      toast.success('Usage rated into a draft invoice')
      await load()
    } catch (e) {
      const err = e as Error & { status?: number }
      toast.error(err.status === 404 ? 'Usage rating isn’t available yet' : err.message)
    }
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
            <h3>Account</h3>
            <Button variant="ghost" size="sm"
            onClick={async () => { const e = await openDocument(token, `/api/customers/${customerId}/statement`); if (e) toast.error(e) }}>
              <PrinterIcon size={14} /> Statement
            </Button>
          </div>

          <h3>Accounts</h3>
          {accounts.length === 0
            ? <p className="muted">No accounts yet.</p>
            : (
              <div className="grid-wrap"><table className="grid">
                <thead><tr><th scope="col">Type</th><th scope="col">Currency</th><th scope="col">Cycle</th><th scope="col">Status</th></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td><span className="pill">{a.type ?? '—'}</span></td>
                      <td>{a.currency ?? '—'}</td>
                      <td>{a.billing_cycle ?? '—'}</td>
                      <td>{a.status ? <span className="pill">{a.status}</span> : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}

          {/* Balance summary */}
          {subs !== null && !unavailable && (() => {
            const billedTotal = invoices
              .filter(inv => ['ISSUED', 'OVERDUE', 'PAID'].includes((inv.status ?? '').toUpperCase()))
              .reduce((sum, inv) => sum + (inv.total ?? 0), 0)
            const paidTotal = payments.reduce((sum, p) => sum + (p.amount ?? 0), 0)
            const balance = Math.max(0, billedTotal - paidTotal)
            return (
              <div style={{ display: 'flex', gap: 'var(--gx-space-5)', marginBottom: 'var(--gx-space-6)', flexWrap: 'wrap' }}>
                {[
                  { label: 'Total billed', value: billedTotal },
                  { label: 'Total paid', value: paidTotal },
                  { label: 'Outstanding', value: balance, highlight: balance > 0 },
                ].map(({ label, value, highlight }) => (
                  <div key={label} style={{
                    flex: '1 1 120px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)',
                    padding: 'var(--gx-space-6) var(--gx-space-8)', border: '1px solid var(--border)'
                  }}>
                    <div style={{ fontSize: 'var(--gx-text-11)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', marginBottom: 'var(--gx-space-3)' }}>{label}</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: highlight ? 'var(--danger)' : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                      {money(value)}
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}

          <div className="bill-section-head" style={{ marginTop: 18 }}>
            <h3>Subscriptions</h3>
            <Button variant="ghost" size="sm" onClick={() => setCreating((c) => !c)}>{creating ? 'Cancel' : '+ New subscription'}</Button>
          </div>

          {creating && (
            <div className="rec-form" style={{ marginBottom: 'var(--gx-space-6)' }}>
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
              <div className="rec-form-actions"><Button variant="gold" size="md" onClick={createSub} disabled={!planName.trim()}>Create</Button></div>
            </div>
          )}

          {subs.length === 0
            ? <p className="muted">No subscriptions.</p>
            : (
              <table className="grid">
                <thead><tr><th>Plan</th><th>Amount</th><th>Cycle</th><th>Status</th><th className="actions-col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {subs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.plan_name ?? '—'}</td>
                      <td>{money(s.amount)}</td>
                      <td>{s.cycle ?? '—'}</td>
                      <td>{s.status ? <span className="pill">{s.status}</span> : '—'}</td>
                      <td className="actions-col row-actions">
                        {(s.status ?? '').toUpperCase() !== 'CANCELLED' && <Button variant="ghost" size="sm" onClick={() => generate(s.id)}>Generate invoice</Button>}
                        {unrated[s.id] ? <Button variant="ghost" size="sm" onClick={() => rateUsage(s.id)}>Rate usage ({unrated[s.id]})</Button> : null}
                      </td>
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

          {payments.length > 0 && (
            <div style={{ marginTop: 'var(--gx-space-12)' }}>
              <div style={{ fontSize: 'var(--gx-text-13)', fontWeight: 600, marginBottom: 'var(--gx-space-5)', display: 'flex', alignItems: 'center', gap: 'var(--gx-space-4)' }}>
                <CreditCardIcon size={15} /> Recent payments
              </div>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.slice(0, 10).map(p => (
                    <tr key={p.id}>
                      <td>{p.paid_at ? new Date(p.paid_at).toLocaleDateString() : '—'}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.amount)}</td>
                      <td className="muted">{p.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {payments.length > 10 && (
                <p className="muted" style={{ fontSize: 'var(--gx-text-sm)', marginTop: 'var(--gx-space-3)' }}>Showing 10 of {payments.length} payments</p>
              )}
            </div>
          )}
          {payments.length === 0 && subs !== null && !unavailable && (
            <p className="muted" style={{ marginTop: 'var(--gx-space-5)', fontSize: 'var(--gx-text-13)' }}>No payments recorded for this customer.</p>
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
