import { useEffect, useState } from 'react'
import { bget, bpost, type Party } from '../lib/billing'
import { toast } from '../components/Toast'
import { EmptyState, ErrorBanner, PermissionDenied } from '../components/States'
import { UsersIcon } from '../components/icons'
import { useI18n } from '../lib/i18n'
import ViewHead from '../components/ViewHead'

// Parties UI (A17 /api/parties) — the "who" layer (individuals / organizations / carriers) that
// Accounts hang off. Lighter than Accounts. Shows the parent→child hierarchy hint via an indent.
const TYPES = ['individual', 'organization', 'carrier']

function statusPill(status: string | null | undefined) {
  const s = (status ?? '').toUpperCase()
  const cls = s === 'ACTIVE' ? 'pill pill-success' : s === 'INACTIVE' || s === 'CLOSED' ? 'pill pill-muted' : 'pill'
  return status ? <span className={cls}>{status}</span> : <span>—</span>
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

  async function load() {
    setError(''); setUnavailable(false); setDenied(false); setList(null)
    const res = await bget<Party[]>(token, '/api/parties')
    if (res.status === 404) { setUnavailable(true); setList([]); return }
    if (res.status === 403) { setDenied(true); setList([]); return }
    if (!res.ok) { setError(t('parties.loadError', 'Failed to load parties')); setList([]); return }
    setList(Array.isArray(res.data) ? res.data : [])
  }

  useEffect(() => { load() }, [token])

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

  if (denied) return <PermissionDenied message={t('parties.denied', "You don't have permission to view parties.")} />

  return (
    <div>
      <ViewHead icon={<UsersIcon size={20} />} title={t('nav.parties', 'Parties')} actions={!unavailable && <button className="btn btn-primary btn-md" onClick={() => setCreating((c) => !c)}>{creating ? t('common.close', 'Close') : t('parties.new', '+ New Party')}</button>} />

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
        <div className="grid-wrap"><table className="grid">
          <thead><tr>
            <th scope="col">{t('parties.type', 'Type')}</th>
            <th scope="col">{t('common.name', 'Name')}</th>
            <th scope="col">{t('parties.parent', 'Parent')}</th>
            <th scope="col">{t('common.status', 'Status')}</th>
          </tr></thead>
          <tbody>
            {list.map((p) => {
              const pn = parentName(p)
              return (
                <tr key={p.id}>
                  <td><span className="pill pill-muted">{p.type ?? '—'}</span></td>
                  <td>{pn ? <span className="party-child">{p.name ?? '—'}</span> : (p.name ?? '—')}</td>
                  <td>{pn || <span className="muted">—</span>}</td>
                  <td>{statusPill(p.status)}</td>
                </tr>
              )
            })}
          </tbody>
        </table></div>
      )}
    </div>
  )
}
