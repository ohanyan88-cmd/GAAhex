import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, type Party } from '../lib/billing'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  UsersIcon, GearIcon, MoreVerticalIcon,
} from '../components/icons'
import {
  Plus, ChevronsUpDown, ArrowUp, ArrowDown,
} from 'lucide-react'
import { useI18n } from '../lib/i18n'
import { PageShell, type KPISpec } from '../page-shell'
import { Button, Pagination, StatusPill} from '../primitives'

// Parties UI (A17 /api/parties) — the "who" layer (individuals / organizations / carriers) that
// Accounts hang off. Lighter than Accounts. Shows the parent→child hierarchy hint via an indent.
const TYPES = ['individual', 'organization', 'carrier']

type PillVariant = 'active' | 'degraded' | 'critical' | 'neutral' | 'info'
function mapPartyStatus(s: string | null | undefined): PillVariant {
  const v = (s ?? '').toUpperCase()
  if (v === 'ACTIVE') return 'active'
  if (v === 'INACTIVE' || v === 'CLOSED') return 'neutral'
  if (v === 'PENDING' || v === 'PROSPECT') return 'info'
  return 'info'
}

export default function PartiesView({ token, canConfigure = false, onConfigure }: { token: string; canConfigure?: boolean; onConfigure?: () => void }) {
  const { t } = useI18n()
  const [list, setList] = useState<Party[] | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [denied, setDenied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [type, setType] = useState('individual')
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')

  // Toolbar / table interaction state.
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 25

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Party[]>(token, '/api/parties')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('parties.loadError', 'Failed to load parties')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])
  useEffect(() => { setPage(1) }, [query, sortKey, sortDir])

  const parentName = (p: Party) => p.parent_name ?? (p.parent_party_id ? (list?.find((x) => x.id === p.parent_party_id)?.name ?? p.parent_party_id.slice(0, 8)) : '')

  async function create() {
    if (!name.trim()) return
    try {
      await bpost(token, '/api/parties', { type, name: name.trim(), parent_party_id: parent || undefined })
      toast.success(t('parties.created', 'Party created'))
      setCreating(false); setType('individual'); setName(''); setParent('')
      await load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const all = list ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter((p) => {
      const fields = [
        p.id ?? '',
        p.name ?? '',
        p.type ?? '',
        parentName(p) ?? '',
        p.status ?? '',
      ].join(' ').toLowerCase()
      return fields.includes(q)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, query])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const k = sortKey
    const dir = sortDir
    const get = (p: Party): string => {
      switch (k) {
        case 'type': return p.type ?? ''
        case 'name': return p.name ?? ''
        case 'parent': return parentName(p) ?? ''
        case 'status': return p.status ?? ''
        default: return ''
      }
    }
    return [...filtered].sort((a, b) => String(get(a)).localeCompare(String(get(b))) * dir)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }

  if (denied) return <PermissionDenied message={t('parties.denied', "You don't have permission to view parties.")} />

  // KPI tiles — derived from the loaded list, no fabricated values.
  const indivCount = all.filter(p => (p.type ?? '').toLowerCase() === 'individual').length
  const orgCount = all.filter(p => (p.type ?? '').toLowerCase() === 'organization').length
  const carrierCount = all.filter(p => (p.type ?? '').toLowerCase() === 'carrier').length
  const kpis: KPISpec[] = all.length > 0 ? [
    { label: 'Total', value: all.length, subtitle: 'parties on record', onClick: () => setQuery('') },
    ...(indivCount > 0 ? [{ label: 'Individuals', value: indivCount, subtitle: 'people', onClick: () => setQuery('individual') }] : []),
    ...(orgCount > 0 ? [{ label: 'Organizations', value: orgCount, subtitle: 'companies', onClick: () => setQuery('organization') }] : []),
    ...(carrierCount > 0 ? [{ label: 'Carriers', value: carrierCount, subtitle: 'upstream', onClick: () => setQuery('carrier') }] : []),
  ] : []

  return (
    <PageShell
      type="REGISTRY"
      breadcrumb={['Admin Panel', t('nav.parties', 'Parties')]}
      icon={<UsersIcon size={18} />}
      title={t('nav.parties', 'Parties')}
      subtitle="Party records (persons + organizations)"
      kpis={kpis}
      primaryAction={!unavailable ? {
        label: creating ? t('common.close', 'Close') : t('parties.new', 'New party'),
        icon: <Plus size={14} />,
        onClick: () => setCreating((c) => !c),
      } : undefined}
      secondaryActions={!unavailable && canConfigure && onConfigure ? [
        { label: 'Configure', icon: <GearIcon size={13} />, onClick: onConfigure },
      ] : undefined}
      // TL-5 — search lifts into PageShell zone D.
      filters={{ search: { value: query, onChange: setQuery, placeholder: 'Search parties' } }}
    >
        {creating && (
          <div className="rec-form">
            <label className="field"><span>{t('parties.type', 'Type')}</span>
              <select className="inp inp-md" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
            </label>
            <label className="field"><span>{t('common.name', 'Name')} *</span><input className="inp inp-md" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('parties.namePlaceholder', 'Acme Telecom LLC')} /></label>
            <label className="field"><span>{t('parties.parent', 'Parent')}</span>
              <select className="inp inp-md" value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">{t('parties.noParent', '— none —')}</option>
                {(list ?? []).map((p) => <option key={p.id} value={p.id}>{p.name ?? p.id.slice(0, 8)}</option>)}
              </select>
            </label>
            <div className="rec-form-actions"><Button variant="gold" size="md" onClick={create} disabled={!name.trim()}>{t('common.create', 'Create')}</Button></div>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={load} />}
        {list === null && !error && <p className="muted">{t('common.loading', 'Loading…')}</p>}
        {unavailable && <EmptyState icon={<UsersIcon size={40} />} title={t('parties.unavailable', "Parties aren't available yet")} message={t('parties.unavailableMsg', 'The parties layer will appear here once enabled.')} />}
        {list && !unavailable && list.length === 0 && !error && (
          <EmptyState icon={<UsersIcon size={40} />} title={t('parties.empty', 'No parties')} message={t('parties.emptyMsg', 'Create the people and organizations you do business with.')} />
        )}

        {list && list.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', position: 'relative' }}>
            {/* TL-5 — search lifted to PageShell zone D. */}
            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    {(['type', 'name', 'parent', 'status'] as const).map((k) => (
                      <th
                        key={k}
                        scope="col"
                        onClick={() => toggleSort(k)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {k === 'type' ? t('parties.type', 'Type')
                           : k === 'name' ? t('common.name', 'Name')
                           : k === 'parent' ? t('parties.parent', 'Parent')
                           : t('common.status', 'Status')}
                          {sortKey === k
                            // D18: active sort indicator = azure (interactive cue)
                            ? (sortDir === 1 ? <ArrowUp size={12} style={{ color: 'var(--gx-interactive)' }} /> : <ArrowDown size={12} style={{ color: 'var(--gx-interactive)' }} />)
                            : <ChevronsUpDown size={12} style={{ opacity: 0.35 }} />}
                        </span>
                      </th>
                    ))}
                    <th scope="col" className="actions-col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const pn = parentName(p)
                    return (
                      <tr
                        key={p.id}
                        onClick={() => console.log('[parties] open', p.id)}
                      >
                        <td>{p.type ?? '—'}</td>
                        <td>{pn ? <span className="party-child">{p.name ?? '—'}</span> : (p.name ?? '—')}</td>
                        <td>{pn || <span style={{ color: 'var(--gx-text-3)' }}>—</span>}</td>
                        <td>{p.status ? <StatusPill variant={mapPartyStatus(p.status)} label={p.status} size="sm" /> : <span>—</span>}</td>
                        <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                            <button
                              className="iconbtn"
                              aria-label="Row menu"
                              title="Row actions"
                              onClick={(e) => { e.stopPropagation(); console.log('[parties] row menu', p.id) }}
                            >
                              <MoreVerticalIcon size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {pageRows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--gx-space-9)', color: 'var(--gx-text-3)' }}>
                        No matching parties.
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
    </PageShell>
  )
}
