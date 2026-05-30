import { useEffect, useMemo, useState } from 'react'
import { bget, bpost, type Party } from '../lib/billing'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import {
  UsersIcon, SearchIcon, PlusIcon, DownloadIcon,
  ArrowUpIcon, ArrowDownIcon, ArrowRightIcon, ChevronLeftIcon,
} from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'
import { StatusPill } from '../primitives'

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

// 3-dot row-menu icon (inline; no emoji rule — inline SVG only).
function MoreVerticalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="5" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="19" r="1.4" />
    </svg>
  )
}

export default function PartiesView({ token }: { token: string }) {
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
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
  useEffect(() => { setPage(1); setSelected(new Set()) }, [query, sortKey, sortDir])

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
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1))
    else { setSortKey(k); setSortDir(1) }
  }
  function toggleRow(id: string) {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function togglePageAll() {
    setSelected((s) => {
      const n = new Set(s)
      if (allOnPageSelected) pageRows.forEach((r) => n.delete(r.id))
      else pageRows.forEach((r) => n.add(r.id))
      return n
    })
  }

  if (denied) return <PermissionDenied message={t('parties.denied', "You don't have permission to view parties.")} />

  return (
    <div className="view">
      <div className="view-inner fade">
        <div className="crumbs">
          <span>CRM</span><span className="sep">/</span>
          <span style={{ color: 'var(--gx-text-1)' }}>{t('nav.parties', 'Parties')}</span>
        </div>

        <ViewHead
          icon={<UsersIcon size={18} />}
          title={t('nav.parties', 'Parties')}
          sub={`${all.length} record${all.length !== 1 ? 's' : ''} · individuals · organizations · carriers`}
          actions={
            !unavailable && (
              <button className="btn btn-primary btn-sm" onClick={() => setCreating((c) => !c)}>
                <PlusIcon size={13} /> {creating ? t('common.close', 'Close') : t('parties.new', 'New party')}
              </button>
            )
          }
        />

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
            <div className="rec-form-actions"><button className="btn btn-accent btn-md" onClick={create} disabled={!name.trim()}>{t('common.create', 'Create')}</button></div>
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
            {selected.size > 0 && (
              <div className="bulkbar">
                <span style={{ fontWeight: 600, fontSize: 12.5 }}>{selected.size} selected</span>
                <span className="spacer" />
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { console.log('[parties] bulk export', Array.from(selected)); toast.success(`Export queued for ${selected.size} part${selected.size !== 1 ? 'ies' : 'y'}`) }}
                >
                  <DownloadIcon size={13} /> Export
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            )}

            <div className="toolbar" style={{ padding: '12px 14px', margin: 0 }}>
              <div className="tb-search" style={{ width: 280 }}>
                <SearchIcon size={14} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search parties"
                  style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--gx-text-1)', fontSize: 13 }}
                />
              </div>
              <span className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { console.log('[parties] export all'); toast.success(`Export queued for ${sorted.length} part${sorted.length !== 1 ? 'ies' : 'y'}`) }}
              >
                <DownloadIcon size={13} /> Export
              </button>
            </div>

            <div className="grid-wrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={togglePageAll}
                        aria-label="Select all rows on this page"
                      />
                    </th>
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
                          {sortKey === k && (sortDir === 1 ? <ArrowUpIcon size={11} /> : <ArrowDownIcon size={11} />)}
                        </span>
                      </th>
                    ))}
                    <th style={{ width: 32 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((p) => {
                    const pn = parentName(p)
                    return (
                      <tr
                        key={p.id}
                        className={selected.has(p.id) ? 'sel' : ''}
                        onClick={() => console.log('[parties] open', p.id)}
                      >
                        <td onClick={(e) => { e.stopPropagation(); toggleRow(p.id) }} style={{ cursor: 'default' }}>
                          <input
                            type="checkbox"
                            checked={selected.has(p.id)}
                            onChange={() => toggleRow(p.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select party ${p.name ?? p.id.slice(0, 8)}`}
                          />
                        </td>
                        <td>{p.type ?? '—'}</td>
                        <td>{pn ? <span className="party-child">{p.name ?? '—'}</span> : (p.name ?? '—')}</td>
                        <td>{pn || <span style={{ color: 'var(--gx-text-3)' }}>—</span>}</td>
                        <td>{p.status ? <StatusPill variant={mapPartyStatus(p.status)} label={p.status} size="sm" /> : <span>—</span>}</td>
                        <td onClick={(e) => e.stopPropagation()} style={{ width: 32 }}>
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
                      <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--gx-text-3)' }}>
                        No matching parties.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-foot">
              <span style={{ color: 'var(--gx-text-3)', fontSize: 12 }}>
                {sorted.length === 0
                  ? '0 parties'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
              </span>
              <span className="spacer" />
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                <ChevronLeftIcon size={13} /> Prev
              </button>
              <span style={{ fontSize: 12, color: 'var(--gx-text-2)' }}>Page {page} of {pageCount}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                Next <ArrowRightIcon size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
