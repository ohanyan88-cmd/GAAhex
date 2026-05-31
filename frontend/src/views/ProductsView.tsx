import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, bpatch, type Product } from '../lib/billing'
import { money, toMinor } from '../lib/money'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  ArchiveIcon, SearchIcon, GearIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import ViewHead from '../components/ViewHead'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { StatusPill } from '../primitives'

type Draft = { id?: string; key: string; name: string; default_amount: string; cycle: string; active: boolean }
const EMPTY: Draft = { key: '', name: '', default_amount: '', cycle: 'monthly', active: true }

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapProductStatus(p: Product): { label: string; variant: PillVariant } {
  // Product objects expose `active`; DRAFT/RETIRED aren't on the type but may exist via status field.
  const status = ((p as any).status ?? (p.active === false ? 'RETIRED' : 'ACTIVE')).toString().toUpperCase()
  if (status === 'ACTIVE') return { label: 'active', variant: 'active' }
  if (status === 'DRAFT') return { label: 'draft', variant: 'neutral' }
  if (status === 'RETIRED') return { label: 'retired', variant: 'neutral' }
  return { label: status.toLowerCase(), variant: 'neutral' }
}

function renderProductCell(colKey: string, p: Product) {
  switch (colKey) {
    case 'name': return p.name ?? '—'
    case 'key': return <span className="mono" style={{ color: 'var(--gx-text-3)' }}>{p.key ?? '—'}</span>
    case 'amount': return <span className="mono tnum">{money(p.default_amount)}</span>
    case 'cycle': return <span style={{ color: 'var(--gx-text-2)', textTransform: 'capitalize' }}>{p.cycle ?? '—'}</span>
    case 'active': {
      const sp = mapProductStatus(p)
      return <StatusPill variant={sp.variant} label={sp.label} size="sm" />
    }
    default: return '—'
  }
}

export default function ProductsView({ token, canConfigure = false, configVersion = 0, onConfigure }: { token: string; canConfigure?: boolean; configVersion?: number; onConfigure?: () => void }) {
  const cfg = usePageConfig(token, 'products', configVersion)
  const [list, setList] = useState<Product[] | null>(null)
  const cf = useCustomFields(token, 'products', cfg.customFields, (list ?? []).map((p) => p.id))
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Product[]>(token, '/api/products')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load products'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

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

  const all = list ?? []
  const activeCount = all.filter(p => p.active !== false).length
  const retiredCount = all.filter(p => p.active === false).length

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) => {
      const fields = [
        p.name ?? '',
        p.key ?? '',
        p.cycle ?? '',
        String(p.default_amount ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (p: Product): string | number => {
      switch (k) {
        case 'name': return p.name ?? ''
        case 'key': return p.key ?? ''
        case 'amount': return p.default_amount ?? 0
        case 'cycle': return p.cycle ?? ''
        case 'active': return p.active === false ? 0 : 1
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

  function colThClass(colKey: string): string { return colKey === 'amount' ? 'num' : '' }
  function colTdClass(colKey: string): string { return colKey === 'amount' ? 'num' : '' }

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs"><span>Billing</span><span className="sep">/</span><span style={{ color: 'var(--gx-text-1)' }}>{cfg.title}</span></div>

        <ViewHead
          icon={<ArchiveIcon size={18} />}
          title={cfg.title}
          sub={`${all.length} product${all.length !== 1 ? 's' : ''} · catalog drives subscription pricing`}
          actions={!unavailable && (
            <>
              {canConfigure && onConfigure && (
                <button className="btn btn-ghost btn-sm" onClick={onConfigure} title="Configure this page">
                  <GearIcon size={13} style={{ color: 'var(--gx-gold)' }} />
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setDraft(draft ? null : { ...EMPTY })}>
                <Plus size={14} /> {draft ? 'Close' : 'New product'}
              </button>
            </>
          )}
        />

        {all.length > 0 && (
          <div className="kpi-strip">
            <div className="kpi">
              <span className="klbl">Catalog size</span>
              <div className="kval tnum" style={{ fontSize: 24 }}>{all.length}</div>
              <span className="hint" style={{ fontSize: 11 }}>{activeCount} active</span>
            </div>
            <div className="kpi kpi--marquee">
              <span className="klbl">Active</span>
              <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-gold)' }}>{activeCount}</div>
              <span className="hint" style={{ fontSize: 11 }}>offerable</span>
            </div>
            {retiredCount > 0 && (
              <div className="kpi">
                <span className="klbl">Retired</span>
                <div className="kval tnum" style={{ fontSize: 24, color: 'var(--gx-text-3)' }}>{retiredCount}</div>
                <span className="hint" style={{ fontSize: 11 }}>read-only</span>
              </div>
            )}
          </div>
        )}

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
        {unavailable && <EmptyState icon={<ArchiveIcon size={40} />} title="Products aren't available yet" message="The product catalog will appear once billing is enabled." />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<ArchiveIcon size={40} />} title="No products" message="Create your first plan to offer it on subscriptions." />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {cfg.columns.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        className={colThClass(c.key)}
                        onClick={() => toggleSort(c.key)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {c.label}
                          {sortKey === c.key
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-primary)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-primary)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => (
                    <tr key={p.id}>
                      {cfg.columns.map((c) => (
                        <td key={c.key} className={colTdClass(c.key)}>
                          {renderProductCell(c.key, p)}
                        </td>
                      ))}
                      {cf.cells(p.id)}
                      <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDraft({ id: p.id, key: p.key ?? '', name: p.name ?? '', default_amount: p.default_amount != null ? String(p.default_amount / 100) : '', cycle: p.cycle ?? 'monthly', active: p.active !== false })}
                          >Edit</button>
                          {p.active !== false && (
                            <button className="btn btn-ghost btn-sm" onClick={() => retire(p)}>Retire</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching products.
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
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                  <ChevronLeft size={15} />
                </button>
                {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(p => (
                  <button key={p} className={'btn btn-sm btn-icon ' + (p === page ? 'btn-secondary' : 'btn-ghost')} onClick={() => setPage(p)}>{p}</button>
                ))}
                <button className="btn btn-ghost btn-sm btn-icon" disabled={page >= pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
