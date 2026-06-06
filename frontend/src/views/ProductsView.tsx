import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, bpatch, type Product } from '../lib/billing'
import {
  COMMERCIAL_PRODUCT_CATEGORIES, SUPPORTING_PRODUCT_CATEGORIES,
  type ProductCategory,
} from '../lib/lifecycle'
import { money, toMinor } from '../lib/money'
import { toast } from '../components/Toast'
import { confirmDialog } from '../components/Modal'
import { EmptyState, ErrorBanner } from '../components/States'
import {
  ArchiveIcon, GearIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { PageShell, type KPISpec } from '../page-shell'
import { usePageConfig } from '../lib/pageConfig'
import { useCustomFields } from '../components/CustomCells'
import { Button, Pagination, StatusPill } from '../primitives'

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
  // Category filter — UI today. Backend Product has no `category` column yet; if/when
  // it lands, this state becomes the actual filter key. Falls back to a tolerant
  // `(p as any).category` read so any custom-field category populated through Studio
  // already participates in the filter.
  const [category, setCategory] = useState<ProductCategory | 'All'>('All')

  async function load() {
    setError(''); setUnavailable(false); setList(null)
    const res = await bget<Product[]>(token, '/api/products')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (!res.ok) { setError('Failed to load products'); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir, category])

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

  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Catalog size', value: all.length, subtitle: `${activeCount} active`, onClick: () => setQuery('') },
    { label: 'Active', value: activeCount, subtitle: 'offerable', onClick: () => setQuery('active') },
    ...(retiredCount > 0 ? [{ label: 'Retired', value: retiredCount, subtitle: 'read-only', muted: true, onClick: () => setQuery('retired') }] : []),
  ] : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const cat = category
    return all.filter((p) => {
      if (cat !== 'All') {
        // Tolerant category read — `category` is not yet a first-class column;
        // Studio custom-field populates it, otherwise the chip filter is a no-match.
        const pc = String((p as any).category ?? '').trim()
        if (pc !== cat) return false
      }
      if (!q) return true
      const fields = [
        p.name ?? '',
        p.key ?? '',
        p.cycle ?? '',
        String(p.default_amount ?? ''),
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  }, [all, query, category])

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
    <PageShell
      type="REGISTRY"
      breadcrumb={['Billing & Revenue', cfg.title]}
      icon={<ArchiveIcon size={18} />}
      title={cfg.title}
      subtitle="Product catalog drives subscription pricing"
      kpis={kpis}
      primaryAction={!unavailable ? {
        label: draft ? 'Close' : 'New product',
        icon: <Plus size={14} />,
        onClick: () => setDraft(draft ? null : { ...EMPTY }),
      } : undefined}
      secondaryActions={canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      // TL-5 — search lifts from the in-card toolbar into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search products' } }}
    >
        {/* Category chips — Commercial vs Supporting grouping per approved catalog model. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--gx-space-7)', alignItems: 'center', margin: '12px 0 8px' }}>
          <CategoryChip label="All" active={category === 'All'} onClick={() => setCategory('All')} primary />
          <CategoryGroup
            title="Commercial Products"
            categories={COMMERCIAL_PRODUCT_CATEGORIES}
            active={category}
            onPick={setCategory}
          />
          <CategoryGroup
            title="Supporting Products"
            categories={SUPPORTING_PRODUCT_CATEGORIES}
            active={category}
            onPick={setCategory}
          />
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
            <div className="rec-form-actions"><Button variant="gold" size="md" onClick={save} disabled={!draft.name.trim() || (!draft.id && !draft.key.trim())}>{draft.id ? 'Save' : 'Create'}</Button></div>
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
            {/* TL-5 — search moved up to PageShell zone D (filters prop). */}
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
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    {cf.headers()}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
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
                      <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                          <Button variant="ghost" size="sm"
            onClick={() => setDraft({ id: p.id, key: p.key ?? '', name: p.name ?? '', default_amount: p.default_amount != null ? String(p.default_amount / 100) : '', cycle: p.cycle ?? 'monthly', active: p.active !== false })}
                          >Edit</Button>
                          {p.active !== false && (
                            <Button variant="ghost" size="sm" onClick={() => retire(p)}>Retire</Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={cfg.columns.length + 1 + cfg.customFields.length} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching products.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* T-P2-2 — canonical <Pagination> primitive. */}
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={PAGE_SIZE}
              total={sorted.length}
              onChange={setPage}
            />

          </div>
        )}
    </PageShell>
  )
}

function CategoryChip({ label, active, onClick, primary = false }: { label: string; active: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '5px 11px',
        // D18: active filter chip = azure (interactive selection); 'primary' variant stays text-1 (high-emphasis label)
        background: active
          ? (primary ? 'var(--gx-text-1)' : 'var(--gx-interactive)')
          : 'var(--gx-bg-subtle)',
        color: active ? '#ffffff' : 'var(--gx-text-2)',
        // D18: active chip outline matches background — azure for the default variant
        border: '1px solid ' + (active
          ? (primary ? 'var(--gx-text-1)' : 'var(--gx-interactive)')
          : 'var(--gx-border)'),
        borderRadius: 999,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function CategoryGroup<T extends string>({ title, categories, active, onPick }: {
  title: string
  categories: readonly T[]
  active: T | 'All'
  onPick: (c: T | 'All') => void
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--gx-space-3)', padding: '4px 10px 4px 12px', background: 'var(--gx-surface)', border: '1px solid var(--gx-border)', borderRadius: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--gx-text-3)', letterSpacing: '0.06em', marginRight: 4 }}>
        {title}
      </span>
      {categories.map((c) => (
        <CategoryChip key={c} label={c} active={active === c} onClick={() => onPick(c)} />
      ))}
    </div>
  )
}
