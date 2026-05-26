import { useEffect, useState } from 'react'
import { bget, bpost, bpatch, type Product } from './billing'
import { money, toMinor } from './money'
import { toast } from './Toast'
import { confirmDialog } from './Modal'
import { EmptyState, ErrorBanner } from './States'
import { CreditCardIcon } from './icons'

type Draft = { id?: string; key: string; name: string; default_amount: string; cycle: string; active: boolean }
const EMPTY: Draft = { key: '', name: '', default_amount: '', cycle: 'monthly', active: true }

export default function ProductsView({ token }: { token: string }) {
  const [list, setList] = useState<Product[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)   // open create/edit form when set

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Product[]>(token, '/api/products')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load products'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

  async function save() {
    if (!draft || !draft.name.trim() || (!draft.id && !draft.key.trim())) return
    try {
      if (draft.id) {
        await bpatch(token, `/api/products/${draft.id}`, {
          name: draft.name.trim(), default_amount: toMinor(draft.default_amount), cycle: draft.cycle, active: draft.active,
        })
        toast.success('Product updated')
      } else {
        await bpost(token, '/api/products', {
          key: draft.key.trim(), name: draft.name.trim(), default_amount: toMinor(draft.default_amount), cycle: draft.cycle, active: draft.active,
        })
        toast.success('Product created')
      }
      setDraft(null)
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  async function retire(p: Product) {
    const ok = await confirmDialog({ title: `Retire ${p.name}`, message: 'Retire this product? Existing subscriptions are unaffected.', confirmLabel: 'Retire', danger: true })
    if (!ok) return
    try {
      await bpost(token, `/api/products/${p.id}/retire`)
      toast.success('Product retired')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  return (
    <div>
      <div className="view-head">
        <h2>Products</h2>
        {!unavailable && <button className="btn btn-primary btn-md" onClick={() => setDraft(draft ? null : { ...EMPTY })}>{draft ? 'Close' : '+ New product'}</button>}
      </div>

      {draft && (
        <div className="rec-form">
          {!draft.id && <label className="field"><span>Key (snake) *</span><input className="inp inp-md" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} placeholder="fiber_100" /></label>}
          <label className="field"><span>Name *</span><input className="inp inp-md" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Fiber 100" /></label>
          <label className="field"><span>Amount (֏)</span><input className="inp inp-md inp-numeric" type="number" value={draft.default_amount} onChange={(e) => setDraft({ ...draft, default_amount: e.target.value })} /></label>
          <label className="field"><span>Cycle</span>
            <select className="inp inp-md" value={draft.cycle} onChange={(e) => setDraft({ ...draft, cycle: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="field"><span>Active</span><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /></label>
          <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={save} disabled={!draft.name.trim() || (!draft.id && !draft.key.trim())}>{draft.id ? 'Save' : 'Create'}</button></div>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {list === null && !error && <p className="muted">Loading…</p>}
      {unavailable && <EmptyState icon={<CreditCardIcon size={40} />} title="Products aren't available yet" message="The product catalog will appear once billing is enabled." />}
      {list && !unavailable && list.length === 0 && !error && (
        <EmptyState icon={<CreditCardIcon size={40} />} title="No products" message="Create your first plan to offer it on subscriptions." />
      )}

      {list && list.length > 0 && (
        <table className="grid">
          <thead><tr><th>Name</th><th>Key</th><th>Amount</th><th>Cycle</th><th>Active</th><th></th></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className={p.active === false ? 'row-muted' : ''}>
                <td>{p.name ?? '—'}</td>
                <td className="muted">{p.key ?? '—'}</td>
                <td>{money(p.default_amount)}</td>
                <td>{p.cycle ?? '—'}</td>
                <td>{p.active === false ? <span className="pill pill-muted">retired</span> : <span className="pill pill-success">active</span>}</td>
                <td className="row-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setDraft({ id: p.id, key: p.key ?? '', name: p.name ?? '', default_amount: p.default_amount != null ? String(p.default_amount / 100) : '', cycle: p.cycle ?? 'monthly', active: p.active !== false })}>Edit</button>
                  {p.active !== false && <button className="btn btn-danger btn-sm" onClick={() => retire(p)}>Retire</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
